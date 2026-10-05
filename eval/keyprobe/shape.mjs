// What do the site's Gemini keys LOOK like, and does each answer right now? Run by .github/workflows/key-probe.yml.
// NOTHING that identifies a key is written: a key is named by its position; of its text only the family it belongs to
// (the fixed prefix every key of that family shares), its length and the kinds of characters in it are recorded.
import { mkdirSync, writeFileSync } from "node:fs";
const raw = String(process.env.GEMINI_API_KEYS || "");
const parts = raw.split(/[\s,;]+/).filter(Boolean), keys = [...new Set(parts)];
const OLD_RULE = /^[A-Za-z0-9_-]{8,200}$/;                       // what the Worker accepted until 5 Oct 2026
const family = k => (/^AIza/.test(k) ? "AIza…" : /^AQ\./.test(k) ? "AQ.…" : /^[A-Za-z]{2,4}[._-]/.test(k) ? "other with a prefix" : "other");
const kinds = k => [/[A-Z]/.test(k) && "A-Z", /[a-z]/.test(k) && "a-z", /\d/.test(k) && "0-9", /_/.test(k) && "_", /-/.test(k) && "-", /\./.test(k) && ".", /[^A-Za-z0-9_.-]/.test(k) && "OTHER"].filter(Boolean).join(" ");
const BASE = "https://generativelanguage.googleapis.com/v1beta/models/", MODELS = (process.env.PROBE_MODELS || "gemini-3.8-flash,gemini-3.5-flash").split(",");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function ask(key, model) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Answer with the single word: yes" }] }], generationConfig: { temperature: 0, maxOutputTokens: 8 } }), signal: AbortSignal.timeout(60000) });
    const out = { http: r.status, ms: Date.now() - t0 };
    let j = null; try { j = await r.json(); } catch { /* not json */ }
    if (!r.ok && j && j.error) {
      out.status = j.error.status;
      for (const d of j.error.details || []) {
        if (d.reason) out.reason = d.reason;
        if (d.retryDelay) out.retryDelay = d.retryDelay;
        if (Array.isArray(d.violations)) out.quota = d.violations.map(v => ({ id: v.quotaId, model: v.quotaDimensions && v.quotaDimensions.model, limit: v.quotaValue }));
      }
    }
    return out;
  } catch (e) { return { http: 0, ms: Date.now() - t0, error: e.name }; }
}
const res = { at: new Date().toISOString(), listed: parts.length, distinct: keys.length, passOldRule: keys.filter(k => OLD_RULE.test(k)).length, rows: [] };
for (let i = 0; i < keys.length; i++) {
  const k = keys[i], row = { key: i + 1, family: family(k), length: k.length, kinds: kinds(k), passOldRule: OLD_RULE.test(k), now: {} };
  for (const m of MODELS) { row.now[m] = await ask(k, m); await sleep(800); }
  res.rows.push(row);
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/shape.json", import.meta.url), JSON.stringify(res, null, 1));
