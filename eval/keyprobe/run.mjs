// Which of the site's Gemini keys answer, and what limit a refusing one names. Run by .github/workflows/key-probe.yml.
// NOTHING that identifies a key or an account is written: a key is named by its position in the list, and Google's
// messages are kept only as the status, the quota metric / limit they name and the wait they ask for.
import { mkdirSync, writeFileSync } from "node:fs";
const keys = [...new Set(String(process.env.GEMINI_API_KEYS || "").split(/[\s,;]+/).filter(Boolean))];
const MODELS = ["gemini-3.8-flash", "gemini-3.5-flash"], VIDEO = process.env.PROBE_VIDEO || "jQEJVtKnshk";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models/", uri = "https://www.youtube.com/watch?v=" + VIDEO;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = (s, key) => String(s || "").split(key).join("<key>").replace(/projects\/[\w-]+/g, "projects/<p>").replace(/\b\d{6,}\b/g, "<n>").replace(/AIza[\w-]+|AQ\.[\w-]+/g, "<key>").slice(0, 260);
async function ask(key, model, op, body) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}${model}:${op}`, { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    const out = { http: r.status, ms: Date.now() - t0 };
    let j = null; try { j = await r.json(); } catch { /* not json */ }
    if (!r.ok && j && j.error) {
      out.status = j.error.status; out.message = clean(j.error.message, key);
      for (const d of j.error.details || []) {
        if (d.reason) out.reason = d.reason;
        if (d.retryDelay) out.retryDelay = d.retryDelay;
        if (Array.isArray(d.violations)) out.quota = d.violations.map(v => ({ metric: String(v.quotaMetric || "").split("/").pop(), id: v.quotaId, model: v.quotaDimensions && v.quotaDimensions.model, limit: v.quotaValue }));
      }
    } else if (r.ok && j) {
      if (op === "countTokens") out.audioTokens = ((j.promptTokensDetails || []).find(d => d.modality === "AUDIO") || {}).tokenCount;
      else { out.finish = j.candidates && j.candidates[0] && j.candidates[0].finishReason; out.usage = j.usageMetadata && { prompt: j.usageMetadata.promptTokenCount, total: j.usageMetadata.totalTokenCount }; }
    }
    return out;
  } catch (e) { return { http: 0, ms: Date.now() - t0, error: e.name }; }
}
const res = { at: new Date().toISOString(), video: VIDEO, keys: keys.length, models: MODELS, rows: [] };
for (let i = 0; i < keys.length; i++) for (const model of MODELS) {
  const count = await ask(keys[i], model, "countTokens", { contents: [{ role: "user", parts: [{ file_data: { file_uri: uri } }] }] });
  await sleep(1500);
  // twenty seconds of the video: enough to learn whether this key may transcribe at all
  const gen = await ask(keys[i], model, "generateContent", { contents: [{ role: "user", parts: [{ file_data: { file_uri: uri }, video_metadata: { start_offset: "0s", end_offset: "20s", fps: 0.2 } }, { text: "Write the first sentence that is spoken, in its own language. Nothing else." }] }], generationConfig: { temperature: 0 } });
  res.rows.push({ key: i + 1, model, count, gen }); console.log(JSON.stringify(res.rows[res.rows.length - 1]));
  await sleep(1500);
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/result.json", import.meta.url), JSON.stringify(res, null, 1));
