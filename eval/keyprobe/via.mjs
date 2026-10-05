// The chat put to the other services the reader may choose (worker/via.js): which free models OpenRouter lists today
// (a public list, no key), and Gemini asked the twelve questions of chat3.json with the Worker's own prompt, envelope and
// reducer. A Gemini key of the site is used for this trial only (named by its position; nothing of it is written).
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { CHAT_SYSTEM, chatUser, parseChat, chatInput } from "../../worker/ask.js";
import { viaRequest, viaText, viaKeyCheck, VIA_DEF_MODELS } from "../../worker/via.js";
const keys = [...new Set(String(process.env.GEMINI_API_KEYS || "").split(/[\s,;]+/).filter(Boolean))], sleep = ms => new Promise(r => setTimeout(r, ms));
const out = { at: new Date().toISOString(), openrouter: {}, gemini: { rows: [] } };
try {
  const r = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(30000) }), j = await r.json();
  const all = j.data || [];
  out.openrouter = { http: r.status, total: all.length, router: all.filter(m => /^openrouter\//.test(m.id)).map(m => m.id),
    free: all.filter(m => /:free$/.test(m.id) || (m.pricing && +m.pricing.prompt === 0 && +m.pricing.completion === 0)).map(m => ({ id: m.id, ctx: m.context_length, json: (m.supported_parameters || []).includes("response_format") })) };
} catch (e) { out.openrouter = { error: e.name }; }
try { const c = viaKeyCheck("openrouter", "sk-or-not-a-key-000000"); const r = await fetch(c.url, { ...c.init, signal: AbortSignal.timeout(20000) }); out.openrouter.badKey = r.status; } catch (e) { out.openrouter.badKey = e.name; }
const QS = JSON.parse(readFileSync(new URL("./chat3.json", import.meta.url), "utf8")).filter(x => Array.isArray(x.facts));
const pos = keys.length - 1, key = keys[pos];
if (key) {
  try { const c = viaKeyCheck("gemini", key); const r = await fetch(c.url, { ...c.init, signal: AbortSignal.timeout(20000) }); out.gemini.keyCheck = r.status; } catch (e) { out.gemini.keyCheck = e.name; }
  try { const c = viaKeyCheck("gemini", "AQ.not-a-key-0000000000"); const r = await fetch(c.url, { ...c.init, signal: AbortSignal.timeout(20000) }); out.gemini.badKey = r.status; } catch (e) { out.gemini.badKey = e.name; }
  const models = String(process.env.VIA_MODELS || VIA_DEF_MODELS.gemini).split(",");
  for (const { q, want, facts } of QS) {
    const inp = chatInput({ q, prev: "", lang: "ar", facts, passages: [] }), row = { q, want, key: pos + 1 };
    for (const model of models) {
      const t0 = Date.now(), rq = viaRequest("gemini", key, model, CHAT_SYSTEM("ar"), chatUser(inp));
      try {
        const r = await fetch(rq.url, { ...rq.init, signal: AbortSignal.timeout(60000) }); row.model = model; row.http = r.status; row.ms = Date.now() - t0;
        const j = await r.json().catch(() => null);
        if (r.ok && j) { const raw = viaText("gemini", j); row.raw = raw.slice(0, 900); row.got = parseChat(raw, inp); row.tokens = j.usageMetadata?.totalTokenCount; break; }
        row.status = j && j.error ? j.error.status : null;
      } catch (e) { row.http = 0; row.error = e.name; }
    }
    out.gemini.rows.push(row); await sleep(5000);
  }
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/via.json", import.meta.url), JSON.stringify(out, null, 1));
