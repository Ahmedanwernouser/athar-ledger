// Does each model of the /yt chain answer the Worker's own question (worker/yt.js) in the form asked for? Run by key-probe.yml.
// Nothing that identifies a key is written (a key is named by its position).
import { mkdirSync, writeFileSync } from "node:fs";
import { YT_DEF_MODELS, ytBody } from "../../worker/yt.js";
const keys = [...new Set(String(process.env.GEMINI_API_KEYS || "").split(/[\s,;]+/).filter(Boolean))];
const MODELS = (process.env.PROBE_MODELS || YT_DEF_MODELS + ",gemini-3-flash-preview").split(","), VIDEO = process.env.PROBE_VIDEO || "jQEJVtKnshk";
const FROM = 0, TO = Number(process.env.PROBE_TO || 180);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = { at: new Date().toISOString(), video: VIDEO, window: [FROM, TO], rows: [] };
let at = 3;
for (const model of MODELS) {
  const row = { model, tries: [] };
  for (let n = 0; n < 4 && !row.ok; n++) {
    const ki = at++ % keys.length, t0 = Date.now(), tr = { key: ki + 1 };
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": keys[ki], "Content-Type": "application/json" },
        body: JSON.stringify(ytBody(model, VIDEO, FROM, TO, "ar")), signal: AbortSignal.timeout(170000) });
      tr.http = r.status; tr.ms = Date.now() - t0;
      const j = await r.json().catch(() => null);
      if (r.ok && j) {
        const c = (j.candidates || [])[0] || {}, text = ((c.content || {}).parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
        tr.finish = c.finishReason; tr.tokens = j.usageMetadata && { prompt: j.usageMetadata.promptTokenCount, out: j.usageMetadata.candidatesTokenCount, thoughts: j.usageMetadata.thoughtsTokenCount };
        let list = null; try { list = JSON.parse(text); } catch { /* not the list */ }
        if (Array.isArray(list)) {
          const good = list.filter(x => x && typeof x.x === "string" && /^\d{1,3}:\d{2}$/.test(String(x.t || "").trim()));
          const secs = good.map(x => { const [m, s] = x.t.split(":").map(Number); return m * 60 + s; });
          row.ok = true; row.pieces = list.length; row.wellTimed = good.length; row.words = list.reduce((n, x) => n + String(x.x || "").split(/\s+/).filter(Boolean).length, 0);
          row.firstAt = secs[0]; row.lastAt = secs[secs.length - 1]; row.rising = secs.every((v, i) => !i || v >= secs[i - 1]); row.maxWordsInPiece = Math.max(0, ...list.map(x => String(x.x || "").split(/\s+/).filter(Boolean).length));
          row.head = list.slice(0, 3).map(x => `${x.t} ${x.x}`).join(" | ").slice(0, 260); row.tail = list.slice(-2).map(x => `${x.t} ${x.x}`).join(" | ").slice(0, 200);
        } else tr.notList = text.slice(0, 120);
      } else if (j && j.error) { tr.status = j.error.status; tr.msg = String(j.error.message || "").split(keys[ki]).join("<key>").replace(/projects\/[\w-]+/g, "projects/<p>").replace(/\b\d{6,}\b/g, "<n>").slice(0, 200);
        for (const d of j.error.details || []) { if (d.retryDelay) tr.retryDelay = d.retryDelay; if (Array.isArray(d.violations)) tr.quota = d.violations.map(v => v.quotaId); } }
    } catch (e) { tr.error = e.name; tr.ms = Date.now() - t0; }
    row.tries.push(tr); await sleep(1500);
  }
  res.rows.push(row);
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/ytmodels.json", import.meta.url), JSON.stringify(res, null, 1));
