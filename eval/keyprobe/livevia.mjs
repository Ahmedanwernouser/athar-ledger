// The DEPLOYED Worker's chat with a key "of the reader's own" (worker/via.js), end to end from the site's origin:
// a Gemini key and the Groq key of the repository's secrets stand in for a reader's keys (sent in the header, as the
// page sends them; nothing of them is written). OpenRouter is asked only with a made-up key: we have none of our own.
import { mkdirSync, writeFileSync } from "node:fs";
const W = process.env.LIVE_WORKER, O = process.env.LIVE_ORIGIN, out = { at: new Date().toISOString(), steps: [] };
const gem = [...new Set(String(process.env.GEMINI_API_KEYS || "").split(/[\s,;]+/).filter(Boolean))].pop() || "", groq = process.env.GROQ_API_KEY || "";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(what, body, key) { const t0 = Date.now(); let s; try { const r = await fetch(W + "/ask", { method: "POST", headers: { Origin: O, "Content-Type": "application/json", ...(key ? { "X-Athar-Key": key } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) }); let j = null; try { j = await r.json(); } catch { /* not json */ } s = { what, http: r.status, ms: Date.now() - t0, j }; } catch (e) { s = { what, http: 0, error: e.name }; }
  // (belt and braces: no step may carry a key)
  const txt = JSON.stringify(s); if ((gem && txt.includes(gem)) || (groq && txt.includes(groq))) s = { what, http: s.http, leaked: true };
  out.steps.push(s); await sleep(2500); }
try { const r = await fetch(W + "/health", { headers: { Origin: O } }); const j = await r.json(); out.health = { http: r.status, ask: j.ask, ask_via: j.ask_via }; } catch (e) { out.health = { error: e.name }; }
const FACTS = [
  { id: "S1", text: "نتيجة بحث في المصادر عن نص السؤال — حديث — مطابق مع فروق — صحيح مسلم — رقم 55a — الدرجة: في صحيح مسلم — وهو أيضًا في: جامع الترمذي 1926 (صحيح — أحمد محمد شاكر و٢ غيره)، سنن النسائي 4200 (حسن صحيح — عبد الفتاح أبو غدة و٢ غيره) — اللفظ المطابق: «الدين النصيحة» — رابط مصدره في بطاقته" }];
const Q = { mode: "chat", q: "أين ورد حديث الدين النصيحة؟", lang: "ar", facts: FACTS }, FATWA = { mode: "chat", q: "ما حكم من ترك النصيحة؟", lang: "ar", facts: FACTS };
const FAKE = "not-a-real-key-000000000000";
await post("probe groq, made-up key (want 400 user_key_invalid)", { probe: true, via: "groq" }, FAKE);
await post("probe gemini, made-up key (want 400)", { probe: true, via: "gemini" }, FAKE);
await post("probe openrouter, made-up key (want 400)", { probe: true, via: "openrouter" }, FAKE);
await post("probe groq, a real key (want ok)", { probe: true, via: "groq" }, groq);
await post("probe gemini, a real key (want ok)", { probe: true, via: "gemini" }, gem);
await post("chat via gemini without a key (want 400 key_needed)", { ...Q, via: "gemini" }, "");
await post("chat via gemini, own key", { ...Q, via: "gemini" }, gem);
await post("chat via gemini, own key: a ruling (want refuse)", { ...FATWA, via: "gemini" }, gem);
await post("chat via groq, own key", { ...Q, via: "groq" }, groq);
await post("chat via openrouter, made-up key (want 400 user_key_invalid)", { ...Q, via: "openrouter" }, FAKE);
await post("chat via gemini, made-up key (want 400 user_key_invalid)", { ...Q, via: "gemini" }, FAKE);
await post("chat, the site's own way (want answer, via groq)", Q, "");
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/livevia.json", import.meta.url), JSON.stringify(out, null, 1));
