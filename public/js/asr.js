// asr.js — speech-to-text through the project's Cloudflare Worker (which holds the Groq key).
// Small files are sent as they are. Large files are decoded in the browser, down-mixed to 16 kHz mono
// and sent in ~10-minute WAV pieces (overlapping by two seconds), so the per-request limit is never exceeded.
//
// The client sends ONLY two form fields, `file` and `language`; the Worker sets the model and everything else.
// Nothing here is shown to the user as it is: errors carry a CODE (AsrError.code) and progress carries a
// {code, args} object; app.js turns both into a sentence in the interface language.

const DIRECT_LIMIT = 24_000_000;       // bytes; the Worker refuses a little above this
const CHUNK_SECONDS = 600;
const OVERLAP_SECONDS = 2;
const RATE = 16000;
const MAX_DECODE_SECONDS = 3 * 3600;   // beyond this the decoded audio does not fit in a browser tab

/**
 * code: one of the Worker's error codes, or network | disabled | decode | too_long | empty | bad_response | aborted | unknown
 * scope: which limit answered a 429 ("burst" | "hour" for rate_limited, "ip" | "day" for daily_cap), "" when not given
 * retryAfter: seconds the Worker asks to wait (its Retry-After header), or null
 */
export class AsrError extends Error {
  constructor(code, detail = "", scope = "", retryAfter = null) { super(code); this.name = "AsrError"; this.code = code; this.detail = detail; this.scope = scope; this.retryAfter = retryAfter; }
}

const SERVER_CODES = new Set(["bad_file", "bad_form", "length_required", "origin", "too_large", "daily_cap", "rate_limited", "upstream_busy", "upstream", "busy",
  "server_not_configured", "internal", "llm_disabled", "bad_json", "too_short"]);
function codeOf(status, body) {
  const e = body && typeof body.error === "string" ? body.error : "";
  if (SERVER_CODES.has(e)) return e;
  if (status === 429) return "rate_limited";
  if (status === 413) return "too_large";
  if (status === 403) return "origin";
  if (status === 503) return "busy";
  return "unknown";
}
/** the error a failed reply stands for, with the limit's scope and the wait the Worker asked for */
function errorOf(r, body) {
  const ra = Number(r.headers.get("Retry-After"));
  return new AsrError(codeOf(r.status, body), String(r.status), body && typeof body.scope === "string" ? body.scope : "", Number.isFinite(ra) && ra > 0 ? ra : null);
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) return reject(new AsrError("aborted"));
  const id = setTimeout(resolve, ms);
  if (signal) signal.addEventListener("abort", () => { clearTimeout(id); reject(new AsrError("aborted")); }, { once: true });
});
const endpoint = (cfg, path) => cfg.asrUrl.replace(/\/+$/, "") + path;

async function sendOne(blob, name, language, cfg, signal) {
  const post = async () => {
    const fd = new FormData();
    fd.append("file", blob, name);
    fd.append("language", language === "en" ? "en" : "ar");
    let r;
    try { r = await fetch(endpoint(cfg, "/asr"), { method: "POST", body: fd, signal }); }
    catch { throw new AsrError(signal && signal.aborted ? "aborted" : "network"); }
    let body = null;
    try { body = await r.json(); } catch { /* not json */ }
    return { r, body };
  };
  let { r, body } = await post();
  if (r.status === 503 && (!body || !body.error || body.error === "busy")) { await sleep(2000, signal); ({ r, body } = await post()); }
  if (!r.ok) throw errorOf(r, body);
  if (!body || typeof body !== "object") throw new AsrError("bad_response");
  return body;
}

const isNum = x => typeof x === "number" && Number.isFinite(x);
/** Whisper verbose_json -> [{w,start,end}] (falls back to spreading segment text evenly when word times are missing) */
export function wordsFromWhisper(json, offset = 0) {
  if (!json || typeof json !== "object") return [];
  if (Array.isArray(json.words) && json.words.length) {
    const out = [];
    for (const x of json.words) {
      if (!x || typeof x.word !== "string") continue;
      const w = x.word.trim(); if (!w) continue;
      out.push(isNum(x.start) && isNum(x.end) ? { w, start: x.start + offset, end: x.end + offset } : { w });
    }
    if (out.length) return out;
  }
  const out = [];
  for (const s of Array.isArray(json.segments) ? json.segments : []) {
    if (!s || typeof s.text !== "string") continue;
    const ws = s.text.trim().split(/\s+/).filter(Boolean);
    if (!isNum(s.start) || !isNum(s.end)) { ws.forEach(w => out.push({ w })); continue; }
    const d = (s.end - s.start) / Math.max(1, ws.length);
    ws.forEach((w, i) => out.push({ w, start: s.start + i * d + offset, end: s.start + (i + 1) * d + offset }));
  }
  if (!out.length && typeof json.text === "string") return json.text.split(/\s+/).filter(Boolean).map(w => ({ w }));
  return out;
}

export function encodeWav(samples, rate = RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}

/** duration in seconds from the media metadata, or null when the browser cannot tell */
function probeDuration(file) {
  return new Promise(resolve => {
    let url = null;
    const done = v => { clearTimeout(timer); if (url) URL.revokeObjectURL(url); resolve(v); };
    const timer = setTimeout(() => done(null), 4000);
    try {
      const a = document.createElement("audio"); a.preload = "metadata";
      a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : null);
      a.onerror = () => done(null);
      url = URL.createObjectURL(file); a.src = url;
    } catch { done(null); }
  });
}

/** The whole file as 16 kHz mono samples. Only ONE Float32Array survives: channels are mixed in place into the
 *  first channel's own storage, and the file bytes and the AudioBuffer are out of reach when this returns. */
async function decodeMono16k(file) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: RATE });
  try {
    let audio = await ctx.decodeAudioData(await file.arrayBuffer());
    const n = audio.length, ch = audio.numberOfChannels, out = audio.getChannelData(0);
    if (ch > 1) {
      for (let c = 1; c < ch; c++) { const d = audio.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i]; }
      for (let i = 0; i < n; i++) out[i] /= ch;
    }
    audio = null;
    return out;
  } finally { ctx.close(); }
}

/**
 * Get a recording ready to be transcribed (possibly more than once: the decoded audio is reused by every pass).
 * @returns {file, pcm}  pcm is null when the file is small enough to be sent as it is
 */
export async function prepare(file, onProgress = () => {}, signal = null) {
  if (file.size <= DIRECT_LIMIT) return { file, pcm: null };
  onProgress(0.03, { code: "asr.decode" });
  const seconds = await probeDuration(file);
  if (signal && signal.aborted) throw new AsrError("aborted");
  if (seconds != null && seconds > MAX_DECODE_SECONDS) throw new AsrError("too_long");
  let pcm;
  try { pcm = await decodeMono16k(file); }
  catch (e) {
    // "EncodingError" is the browser saying the bytes are not audio it can read; anything else at this size is memory
    throw new AsrError(e && e.name === "EncodingError" && file.size < 300e6 ? "decode" : "too_long");
  }
  if (signal && signal.aborted) throw new AsrError("aborted");
  return { file, pcm };
}

/** the pieces a long recording is cut into: [{from, to, lo, hi}] in seconds; a word belongs to the piece whose [lo, hi) holds its middle */
export function chunkPlan(totalSeconds) {
  const step = CHUNK_SECONDS - OVERLAP_SECONDS, plan = [];
  const n = Math.max(1, Math.ceil((totalSeconds - OVERLAP_SECONDS) / step));
  for (let k = 0; k < n; k++) {
    const from = k * step, to = Math.min(totalSeconds, from + CHUNK_SECONDS);
    plan.push({ from, to, lo: k === 0 ? -Infinity : from + OVERLAP_SECONDS / 2, hi: k === n - 1 ? Infinity : from + step + OVERLAP_SECONDS / 2 });
  }
  return plan;
}

/**
 * @param prep        from prepare()
 * @param language    "ar" | "en"
 * @param onProgress  (fraction 0..1, {code, args})
 * @returns [{w,start,end}]
 */
export async function transcribePrepared(prep, language, cfg, onProgress = () => {}, signal = null) {
  if (!cfg.asrUrl) throw new AsrError("disabled");
  if (!prep.pcm) {
    onProgress(0.1, { code: "asr.send" });
    const json = await sendOne(prep.file, prep.file.name || "audio", language, cfg, signal);
    onProgress(1, { code: "asr.done" });
    return wordsFromWhisper(json);
  }
  const pcm = prep.pcm, plan = chunkPlan(pcm.length / RATE), words = [];
  for (let k = 0; k < plan.length; k++) {
    const c = plan[k];
    onProgress(0.1 + 0.9 * (k / plan.length), { code: "asr.part", args: [k + 1, plan.length] });
    const json = await sendOne(encodeWav(pcm.subarray(Math.round(c.from * RATE), Math.round(c.to * RATE))), `part-${k + 1}.wav`, language, cfg, signal);
    for (const w of wordsFromWhisper(json, c.from)) {
      if (w.start == null) { words.push(w); continue; }
      const mid = (w.start + w.end) / 2;
      if (mid >= c.lo && mid < c.hi) words.push(w);      // the two-second overlap is transcribed twice; each word is kept once
    }
  }
  onProgress(1, { code: "asr.done" });
  return words;
}

/** one pass over one file (kept for callers that do not need to reuse the decoded audio) */
export async function transcribe(file, cfg, onProgress = () => {}, signal = null) {
  if (!cfg.asrUrl) throw new AsrError("disabled");
  return transcribePrepared(await prepare(file, onProgress, signal), cfg.language === "en" ? "en" : "ar", cfg, onProgress, signal);
}

// ---------------- optional "by meaning" helper ----------------
const LLM_GAP_MS = 1200;       // the Worker's counter cannot take two writes within a second
let lastLlm = 0;
/** an error after which asking the model again is pointless (a limit was reached, the helper is off, the network is gone, the reader cancelled) */
export const llmStops = e => e instanceof AsrError && ["daily_cap", "rate_limited", "llm_disabled", "server_not_configured", "origin", "network", "aborted"].includes(e.code);
/**
 * returns async (spoken, kind, candidates|null) -> string ("0" / "" = no answer).
 * Calls are spaced out and retried once when the Worker is busy. `lang` tells the Worker the language of the spoken words.
 * Failures are AsrError (same codes as above).
 */
export function llmClient(cfg, signal = null) {
  return async (spoken, kind, candidates = null) => {
    const lang = /[\u0621-\u064A]/.test(spoken) ? "ar" : "en";
    const post = async () => {
      const wait = lastLlm + LLM_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait, signal);
      try {
        return await fetch(endpoint(cfg, "/llm"), { method: "POST", headers: { "Content-Type": "application/json" }, signal,
          body: JSON.stringify(candidates ? { spoken, kind, lang, candidates } : { spoken, kind, lang }) });
      } catch { throw new AsrError(signal && signal.aborted ? "aborted" : "network"); }
      finally { lastLlm = Date.now(); }
    };
    let r = await post();
    if (r.status === 503) { await sleep(1500, signal); r = await post(); }
    let j = null;
    try { j = await r.json(); } catch { /* not json */ }
    if (r.status === 502 && j && j.error === "empty") return candidates ? "0" : "";
    if (!r.ok) throw errorOf(r, j);
    if (!j || typeof j !== "object") throw new AsrError("bad_response");
    return candidates ? String(j.choice || 0) : (typeof j.text === "string" ? j.text : "");
  };
}
