// How soon does a model START answering a ten-minute window when it is asked as a stream, and how long does the whole
// answer take? (For the Worker: when is it worth asking the next model as well?) Run by key-probe.yml. No key is written.
import { mkdirSync, writeFileSync } from "node:fs";
import { YT_DEF_MODELS, ytBody } from "../../worker/yt.js";
const keys = [...new Set(String(process.env.GEMINI_API_KEYS || "").split(/[\s,;]+/).filter(Boolean))];
const MODELS = (process.env.PROBE_MODELS || YT_DEF_MODELS).split(","), VIDEO = process.env.PROBE_VIDEO || "jQEJVtKnshk";
const FROM = 0, TO = 600;
const res = { at: new Date().toISOString(), video: VIDEO, window: [FROM, TO], rows: [] };
async function one(model, key, ki) {
  const t0 = Date.now(), tr = { key: ki + 1 };
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(ytBody(model, VIDEO, FROM, TO, "ar")), signal: AbortSignal.timeout(240000) });
    tr.http = r.status; tr.headersMs = Date.now() - t0;
    if (!r.ok) { const j = await r.json().catch(() => null); if (j && j.error) { tr.status = j.error.status; for (const d of j.error.details || []) { if (d.retryDelay) tr.retryDelay = d.retryDelay; if (Array.isArray(d.violations)) tr.quota = d.violations.map(v => v.quotaId); } } return tr; }
    const dec = new TextDecoder(); let buf = "", text = "", chunks = 0, thoughts = 0, finish = null, usage = null, bad = 0;
    for await (const part of r.body) {
      buf += dec.decode(part, { stream: true }); let i;
      while ((i = buf.indexOf("\n\n")) >= 0 || (i = buf.indexOf("\r\n\r\n")) >= 0) {
        const ev = buf.slice(0, i); buf = buf.slice(i + (buf.startsWith("\r\n\r\n", i) ? 4 : 2));
        for (const line of ev.split(/\r?\n/)) { if (!line.startsWith("data:")) continue;
          let j = null; try { j = JSON.parse(line.slice(5)); } catch { bad++; continue; }
          if (j.error) { tr.midError = j.error.status || j.error.code; continue; }
          const c = (j.candidates || [])[0] || {};
          for (const p of (c.content || {}).parts || []) { if (p.thought) { thoughts++; continue; } if (typeof p.text === "string" && p.text) { if (!text) tr.firstTextMs = Date.now() - t0; text += p.text; } }
          if (!chunks) tr.firstChunkMs = Date.now() - t0; chunks++;
          if (c.finishReason) finish = c.finishReason; if (j.usageMetadata) usage = j.usageMetadata; } } }
    tr.totalMs = Date.now() - t0; tr.chunks = chunks; tr.thoughtParts = thoughts; tr.badLines = bad; tr.finish = finish; tr.tokens = usage && { prompt: usage.promptTokenCount, out: usage.candidatesTokenCount, thoughts: usage.thoughtsTokenCount };
    let list = null; try { list = JSON.parse(text); } catch { /* not the list */ }
    if (Array.isArray(list)) { tr.ok = true; tr.pieces = list.length; tr.words = list.reduce((n, x) => n + String(x.x || "").split(/\s+/).filter(Boolean).length, 0); tr.lastAt = list.length ? list[list.length - 1].t : null; }
    else tr.notList = text.slice(0, 100) + " … " + text.slice(-60);
  } catch (e) { tr.error = e.name; tr.ms = Date.now() - t0; }
  return tr;
}
// every model is asked at the same moment (each on its own key), so the times can be compared; a refusal is tried on two more keys
await Promise.all(MODELS.map(async (model, mi) => {
  const row = { model, tries: [] }; res.rows.push(row);
  for (let n = 0; n < 3; n++) { const ki = (mi + 1 + n * 2) % keys.length; const tr = await one(model, keys[ki], ki); row.tries.push(tr); if (tr.ok) break; }
}));
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/ytstream.json", import.meta.url), JSON.stringify(res, null, 1));
