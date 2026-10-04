// Live test of the transcription path: the REAL Worker code (worker/src.js) against the REAL provider APIs.
// Runs on the test machine (GitHub Actions); the keys come from repository secrets and are never printed:
// every line written to disk passes through redact().
//   GEMINI_API_KEYS  one or more keys, separated by commas / spaces / new lines (tried in order on 429/403)
//   COHERE_API_KEY   optional; Cohere Transcribe Arabic (text only, no timestamps) called directly: it is a
//                    candidate, not yet a provider of the Worker
//   GROQ_API_KEY     optional; when present the same audio is also transcribed with Whisper and compared
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../../worker/src.js";
import { loadCorpus } from "../lib.mjs";
import { analyze } from "../../public/js/engine.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUDIO = path.join(HERE, "audio"), OUT = path.join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const GEM_KEYS = String(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "").split(/[\s,;]+/).filter(k => k.length > 10);
const GROQ = String(process.env.GROQ_API_KEY || "").trim();
const COHERE = String(process.env.COHERE_API_KEY || "").trim();
const SECRETS = [...GEM_KEYS, GROQ, COHERE].filter(Boolean);
const redact = (s) => { let t = String(s); for (const k of SECRETS) t = t.split(k).join("<KEY>"); return t.replace(/([?&](?:key|upload_id)=)[^&\s"]+/g, "$1<…>"); };
const save = (name, data) => writeFileSync(path.join(OUT, name), redact(typeof data === "string" ? data : JSON.stringify(data, null, 1)) + "\n");
const summary = []; const say = (s) => { console.log(redact(s)); summary.push(redact(s)); };

// ---- every upstream call is recorded (no key, bodies cut) ----
const realFetch = globalThis.fetch; let trace = [];
globalThis.fetch = async (url, init = {}) => {
  const rec = { method: init.method || "GET", url: String(url), headers: Object.keys(init.headers || {}), body: typeof init.body === "string" ? init.body.slice(0, 2000) : init.body ? `<${init.body.size ?? "?"} bytes>` : null };
  const t0 = Date.now();
  try {
    const r = await realFetch(url, init);
    rec.status = r.status; rec.ms = Date.now() - t0;
    rec.resHeaders = Object.fromEntries([...r.headers].filter(([k]) => /^(content-type|retry-after|x-goog-upload-status|x-goog-upload-url)$/i.test(k)));
    if (rec.method !== "HEAD") { try { const t = await r.clone().text(); rec.resBytes = t.length; rec.res = t.slice(0, r.ok ? 3000 : 6000); rec._full = t; } catch { /* body not readable */ } }
    trace.push(rec); return r;
  } catch (e) { rec.error = String(e && e.message); rec.ms = Date.now() - t0; trace.push(rec); throw e; }
};
const flush = (name) => { const full = trace.filter(t => /\/interactions$|generateContent|audio\/transcriptions/.test(t.url) && t.status === 200).at(-1);
  if (full) save(name + ".raw.json", full._full); save(name + ".trace.json", trace.map(({ _full, ...t }) => t)); trace = []; };

// ---- KV stand-in ----
const kv = () => { const m = new Map(); return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } }; };
const ORIGIN = "https://live-test.example";
const envOf = (o) => ({ ALLOWED_ORIGINS: ORIGIN, CAP: kv(), DAILY_CAP: "100000", HOURLY_CAP: "100000", IP_DAILY_CAP: "100000", ...o });
async function viaWorker(file, bytes, provider, env) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: "audio/mpeg" }), path.basename(file));
  fd.append("language", "ar"); fd.append("provider", provider);
  const tmp = new Request("https://x/", { method: "POST", body: fd }); const buf = await tmp.arrayBuffer();
  const req = new Request("https://w.dev/asr", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": tmp.headers.get("Content-Type"), "Content-Length": String(buf.byteLength) }, body: buf });
  const r = await worker.fetch(req, env, { waitUntil: (p) => p });
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, j };
}

// ---- A. what the key can see ----
let models = [];
if (!GEM_KEYS.length) say("NO GEMINI KEY: add the repository secret GEMINI_API_KEYS (Settings → Secrets and variables → Actions).");
for (let i = 0; i < GEM_KEYS.length; i++) {
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": GEM_KEYS[i] } });
    const j = await r.json().catch(() => ({}));
    const n = (j.models || []).length;
    say(`key ${i + 1}: models list HTTP ${r.status}, ${n} models` + (r.ok ? "" : " — " + JSON.stringify(j).slice(0, 300)));
    if (r.ok && !models.length) models = (j.models || []).map(m => ({ name: m.name, methods: m.supportedGenerationMethods, input: m.inputTokenLimit }));
  } catch (e) { say(`key ${i + 1}: models list failed: ${e.message}`); }
}
save("models.json", models); flush("models");
say("models that look like transcription: " + (models.filter(m => /transcri|speech|audio|asr|stt/i.test(m.name)).map(m => m.name).join(", ") || "none"));

// ---- B. transcribe every clip through the Worker ----
const clips = existsSync(AUDIO) ? readdirSync(AUDIO).filter(f => /\.(mp3|wav|m4a)$/i.test(f)).sort() : [];
const only = String(process.env.LIVE_ONLY || "").split(/[\s,]+/).filter(Boolean);
const corpus = await loadCorpus();
let keyAt = 0;
const fmtT = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function ledgerOf(name, j, tag) {
  const words = (j.words || []).map(w => ({ w: w.word, start: w.start, end: w.end }));
  const useWords = words.length ? words : String(j.text || "").split(/\s+/).filter(Boolean).map((w, i) => ({ w, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const r = analyze(useWords, corpus);
  const lines = r.ledger.map(e => `${fmtT(e.start ?? 0)}  ${String(e.status).padEnd(9)} ${(e.source?.label || "-").padEnd(40)} | ${(e.spoken || "").slice(0, 110)}`);
  save(`${name}.${tag}.ledger.txt`, lines.join("\n"));
  const list = path.join(HERE, name + ".list");
  let cover = "";
  if (existsSync(list)) {
    const exp = readFileSync(list, "utf8").split("\n").filter(Boolean).map(l => { const m = l.match(/(\d{3})\/(\d{3})\.mp3/); return `${+m[1]}:${+m[2]}`; });
    const found = new Map(), wrong = [];
    for (const e of r.ledger) {
      if (!["verbatim", "partial"].includes(e.status) || !e.source) continue;
      if (e.source.type !== "q") { wrong.push(e.source.label); continue; }
      for (let a = e.source.ayah; a <= (e.source.ayahEnd || e.source.ayah); a++) { const k = `${e.source.surah}:${a}`; found.set(k, e.status); if (!exp.includes(k)) wrong.push(k); }
    }
    const hit = exp.filter(k => found.has(k));
    cover = ` | ayahs recited ${exp.length}, found ${hit.length} (${Math.round(100 * hit.length / exp.length)}%), labelled verbatim ${hit.filter(k => found.get(k) === "verbatim").length}, cited but not recited ${wrong.length} ${JSON.stringify(wrong)}, missed: ${exp.filter(k => !found.has(k)).join(" ") || "none"}`;
  }
  const by = {}; for (const e of r.ledger) by[e.status] = (by[e.status] || 0) + 1;
  return `ledger ${r.ledger.length} entries ${JSON.stringify(by)}${cover}`;
}
const tsCheck = (j) => { const w = j.words || []; if (!w.length) return "NO word timestamps"; let back = 0, zero = 0; for (let i = 0; i < w.length; i++) { if (i && w[i].start < w[i - 1].start) back++; if (w[i].end <= w[i].start) zero++; }
  return `${w.length} timed words, first ${w[0].start}s, last ${w.at(-1).end}s, out of order ${back}, zero length ${zero}`; };

for (const clip of clips) {
  const name = clip.replace(/\.[^.]+$/, "");
  if (only.length && !only.includes(name)) continue;
  const bytes = readFileSync(path.join(AUDIO, clip));
  if (GEM_KEYS.length) {
    let res = null;
    for (let tries = 0; tries < GEM_KEYS.length; tries++) {
      const t0 = Date.now();
      res = await viaWorker(clip, bytes, "gemini", envOf({ GEMINI_API_KEY: GEM_KEYS[keyAt], ...(process.env.GEMINI_ASR_MODEL ? { GEMINI_ASR_MODEL: process.env.GEMINI_ASR_MODEL } : {}) }));
      say(`${name} gemini via Worker (key ${keyAt + 1}): HTTP ${res.status} in ${Math.round((Date.now() - t0) / 1000)} s` + (res.status === 200 ? "" : " " + JSON.stringify(res.j)));
      flush(`${name}.gemini${tries ? "." + tries : ""}`);
      if (res.status === 200 || ![401, 403, 429].includes(res.j?.upstream_status ?? res.status)) break;
      keyAt = (keyAt + 1) % GEM_KEYS.length;
    }
    if (res.status === 200) { save(name + ".gemini.json", res.j); say(`   ${res.j.model}: ${String(res.j.text).split(/\s+/).length} words in text, ${tsCheck(res.j)}`); say("   " + ledgerOf(name, res.j, "gemini")); }
  }
  if (GROQ) {
    const t0 = Date.now(); const res = await viaWorker(clip, bytes, "groq", envOf({ GROQ_API_KEY: GROQ }));
    say(`${name} groq via Worker: HTTP ${res.status} in ${Math.round((Date.now() - t0) / 1000)} s` + (res.status === 200 ? "" : " " + JSON.stringify(res.j)));
    flush(name + ".groq");
    if (res.status === 200) { save(name + ".groq.json", res.j); say(`   ${res.j.model}: ${tsCheck(res.j)}`); say("   " + ledgerOf(name, res.j, "groq")); }
  }
  if (COHERE) {
    // Written from Cohere's API reference (POST /v2/audio/transcriptions: model, language, file -> {text}); trial keys: 5 requests a minute.
    const fd = new FormData();
    fd.append("model", process.env.COHERE_ASR_MODEL || "cohere-transcribe-arabic-07-2026"); fd.append("language", "ar");
    fd.append("file", new Blob([bytes], { type: "audio/mpeg" }), clip);
    const t0 = Date.now();
    try {
      const r = await fetch("https://api.cohere.com/v2/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + COHERE }, body: fd, signal: AbortSignal.timeout(300000) });
      const j = await r.json().catch(() => null);
      say(`${name} cohere direct: HTTP ${r.status} in ${Math.round((Date.now() - t0) / 1000)} s` + (r.ok ? "" : " " + JSON.stringify(j).slice(0, 400)));
      if (r.ok && j && typeof j.text === "string") { save(name + ".cohere.json", { text: j.text, words: [], provider: "cohere" }); say(`   ${j.text.split(/\s+/).length} words, no timestamps`); say("   " + ledgerOf(name, { text: j.text, words: [] }, "cohere")); }
    } catch (e) { say(`${name} cohere direct failed: ${e.message}`); }
    trace = []; await new Promise((r) => setTimeout(r, 13000));
  }
}
if (!clips.length) say("no audio clips were prepared (see audio.log)");
save("SUMMARY.md", "# Live transcription test\n\n" + new Date().toISOString() + "\n\n```\n" + summary.join("\n") + "\n```");
