// The DEPLOYED Worker's /ask, asked the way the site asks it (the site's origin, no key of ours): is the checker on,
// does a coincidence come back as "0" and a quotation as "1", and does the chat answer from the facts and refuse a ruling?
import { mkdirSync, writeFileSync } from "node:fs";
const W = process.env.LIVE_WORKER, O = process.env.LIVE_ORIGIN, out = { at: new Date().toISOString(), steps: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(body) { const t0 = Date.now(); try { const r = await fetch(W + "/ask", { method: "POST", headers: { Origin: O, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) }); let j = null; try { j = await r.json(); } catch { /* not json */ } return { http: r.status, ms: Date.now() - t0, j }; } catch (e) { return { http: 0, error: e.name }; } }
try { const r = await fetch(W + "/health", { headers: { Origin: O } }); const j = await r.json(); out.health = { http: r.status, ask: j.ask, youtube: j.youtube, configured: j.configured }; } catch (e) { out.health = { error: e.name }; }
const H = "إن الزمان قد استدار كهيئته يوم خلق الله السموات والأرض السنة اثنا عشر شهرا منها أربعة حرم ثلاث متواليات ذو القعدة وذو الحجة والمحرم ورجب مضر الذي بين جمادى وشعبان";
out.steps.push({ what: "check (want 01)", ...(await post({ mode: "check", items: [
  { said: "وبعدين يا جماعة الأشهر الحرم أربعة [[ذو القعدة وذو الحجة والمحرم ورجب]] وإحنا دلوقتي داخلين على شهر ذي القعدة فلازم نستعد", source: H },
  { said: "وخلّي بالك من الكلمة دي [[المسلم من سلم المسلمون من لسانه ويده]] دي قاعدة تمشي عليها في حياتك كلها", source: "المسلم من سلم المسلمون من لسانه ويده والمهاجر من هجر ما نهى الله عنه" }] })) });
await sleep(3000);
const FACTS = [
  { id: "L2", text: "في المحاضرة — حديث — صحيح البخاري — رقم 1 — الدرجة: في صحيح البخاري — قيل منه 8 من 23 كلمة · ذُكر مرة واحدة (0:31) — الحالة: مطابق حرفيًا — قيل: «إنما الأعمال بالنيات وإنما لكل امرئ ما نوى»" },
  { id: "L7", text: "في المحاضرة عند 1:42 — حديث — مطابق حرفيًا — ليس في كتب الحديث المحمَّلة؛ مذكور في: كشف الخفاء ومزيل الإلباس، العجلوني — تنبيه: ليس في كتب الحديث المحمَّلة — قيل: «اطلبوا العلم ولو في الصين»" },
  { id: "L6", text: "في المحاضرة عند 1:23 — حديث — لم يُعثر عليه في المصادر — أقرب نص في المصادر: صحيح البخاري — رقم 6114 — قيل: «بين النبي أن القوي الحقيقي ليس من يغلب الناس في المصارعة»" }];
for (const q of ["هل حديث اطلبوا العلم ولو في الصين صحيح؟", "ما حكم من لم يطلب العلم؟", "هل ذكر الشيخ حديثًا عن الصيام؟"]) { out.steps.push({ what: "chat: " + q, ...(await post({ mode: "chat", q, lang: "ar", facts: FACTS })) }); await sleep(3000); }
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/live.json", import.meta.url), JSON.stringify(out, null, 1));
