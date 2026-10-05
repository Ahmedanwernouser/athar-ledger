// Which Gemini models may the site's keys ask, and which of them transcribe a YouTube link? Run by key-probe.yml.
// Nothing that identifies a key is written (a key is named by its position).
import { mkdirSync, writeFileSync } from "node:fs";
const keys = [...new Set(String(process.env.GEMINI_API_KEYS || "").split(/[\s,;]+/).filter(Boolean))];
const ROOT = "https://generativelanguage.googleapis.com/v1beta/", VIDEO = process.env.PROBE_VIDEO || "jQEJVtKnshk", uri = "https://www.youtube.com/watch?v=" + VIDEO;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = { at: new Date().toISOString(), keys: keys.length, models: [], trials: [] };
const key = keys[1] || keys[0];
try {
  const r = await fetch(ROOT + "models?pageSize=200", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  res.models = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => ({ name: String(m.name || "").replace(/^models\//, ""), in: m.inputTokenLimit, out: m.outputTokenLimit }));
} catch (e) { res.listError = e.name; }
const want = res.models.map(m => m.name).filter(n => /^gemini-/.test(n) && /flash/.test(n) && !/image|tts|audio|live|embedding|preview-\d\d-\d\d$/.test(n)).slice(0, 14);
for (let i = 0; i < want.length; i++) {
  const k = keys[(i + 2) % keys.length], model = want[i], t0 = Date.now(); let out = { model, key: ((i + 2) % keys.length) + 1 };
  try {
    const r = await fetch(`${ROOT}models/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": k, "Content-Type": "application/json" }, signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ file_data: { file_uri: uri }, video_metadata: { start_offset: "0s", end_offset: "30s", fps: 0.2 } }, { text: "Transcribe the speech word for word in its own language. Only the transcript." }] }], generationConfig: { temperature: 0 } }) });
    out.http = r.status; out.ms = Date.now() - t0;
    const j = await r.json().catch(() => null);
    if (r.ok && j) { const tx = ((j.candidates || [])[0]?.content?.parts || []).map(p => p.text || "").join(""); out.chars = tx.length; out.sample = tx.slice(0, 160); out.tokens = j.usageMetadata && j.usageMetadata.promptTokenCount; }
    else if (j && j.error) { out.status = j.error.status; for (const d of j.error.details || []) { if (d.retryDelay) out.retryDelay = d.retryDelay; if (Array.isArray(d.violations)) out.quota = d.violations.map(v => ({ id: v.quotaId, limit: v.quotaValue })); } }
  } catch (e) { out.error = e.name; out.ms = Date.now() - t0; }
  res.trials.push(out); await sleep(1500);
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/models.json", import.meta.url), JSON.stringify(res, null, 1));
