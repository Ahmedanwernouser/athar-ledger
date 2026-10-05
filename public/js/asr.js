// asr.js — speech-to-text through the project's Cloudflare Worker (which holds the Groq key).
// Small files are sent as they are. Large files are decoded in the browser, down-mixed to 16 kHz mono
// and sent in ~10-minute WAV pieces (overlapping by two seconds), so the per-request limit is never exceeded.
//
// The client sends ONLY the form fields `file` and `language`, and `provider` ("groq" | "gemini") when the reader chose a
// transcriber (left out = the Worker's default); the Worker sets the model and everything else.
// Two transcribers can be used on the same recording (see agree.js): the decoded audio is shared by all passes.
// Nothing here is shown to the user as it is: errors carry a CODE (AsrError.code) and progress carries a
// {code, args} object; app.js turns both into a sentence in the interface language.

const DIRECT_LIMIT = 24_000_000;       // bytes; the Worker refuses a little above this
const CHUNK_SECONDS = 600;
const OVERLAP_SECONDS = 2;
const RATE = 16000;
const MAX_DECODE_SECONDS = 3 * 3600;   // beyond this the decoded audio does not fit in a browser tab
const GEMINI_DIRECT_SECONDS = 25 * 60; // Gemini gives word times for at most 30 minutes per request: longer files go in pieces
export const PROVIDERS = ["groq", "gemini"];

/**
 * code: one of the Worker's error codes, or network | disabled | decode | too_long | empty | bad_response | aborted | unknown
 * scope: which limit answered a 429 ("burst" | "hour" for rate_limited, "ip" | "day" for daily_cap), "" when not given
 * retryAfter: seconds the Worker asks to wait (its Retry-After header), or null
 */
export class AsrError extends Error {
  constructor(code, detail = "", scope = "", retryAfter = null) { super(code); this.name = "AsrError"; this.code = code; this.detail = detail; this.scope = scope; this.retryAfter = retryAfter; }
}

const SERVER_CODES = new Set(["user_key_invalid", "bad_file", "bad_form", "length_required", "origin", "too_large", "daily_cap", "rate_limited", "upstream_busy", "upstream", "busy",
  "server_not_configured", "internal", "llm_disabled", "bad_json", "too_short", "provider_unavailable", "bad_video", "bad_window", "yt_unavailable", "too_long"]);
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

async function sendOne(blob, name, language, cfg, signal, provider = null) {
  const post = async () => {
    const fd = new FormData();
    fd.append("file", blob, name);
    fd.append("language", language === "en" ? "en" : "ar");
    if (PROVIDERS.includes(provider)) fd.append("provider", provider);
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

/**
 * The transcribers the Worker offers: {default, available: [...]} from GET /health, or null when the Worker does not say
 * (an older Worker, no network, no answer within 4 s) — the page then behaves as it always did: one transcriber, no choice.
 */
export async function asrProviders(cfg, timeout = 4000) {
  if (!cfg || !cfg.asrUrl) return null;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(endpoint(cfg, "/health"), { signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json(), a = j && j.asr;
    if (!a || typeof a !== "object" || !Array.isArray(a.available)) return null;
    const available = PROVIDERS.filter(p => a.available.includes(p));
    if (!available.length) return null;
    const n = x => (Number.isInteger(x) && x >= 0 ? x : null), y = j.yt && typeof j.yt === "object" ? j.yt : null;
    // how many keys the site transcribes links with, and how many of them still have some of today's allowance
    const yt = y && n(y.keys) != null && n(y.free) != null ? { keys: y.keys, free: y.free, models: n(y.models) || 0, backIn: n(y.back_in) } : null;
    return { default: available.includes(a.default) ? a.default : available[0], available, youtube: j.youtube === true, yt, ask: j.ask === true, embed: Array.isArray(j.embed) ? j.embed.filter(x => typeof x === "string") : [] };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

const isNum = x => typeof x === "number" && Number.isFinite(x);
/** the words of a text spread evenly from `from` to `to` (seconds): what is done when a transcriber gives no word times */
export function spreadWords(text, from, to) {
  const ws = String(text || "").trim().split(/\s+/).filter(Boolean), d = (to - from) / Math.max(1, ws.length);
  return ws.map((w, i) => ({ w, start: from + i * d, end: from + (i + 1) * d }));
}
/**
 * Whisper verbose_json -> [{w,start,end}] (falls back to spreading segment text evenly when word times are missing)
 * @param span  length in seconds of the audio that was sent: used when the answer has a text and no times at all
 *              (`timestamps: false`, or an empty `words`) — its words are then spread evenly over the piece
 */
export function wordsFromWhisper(json, offset = 0, span = null) {
  if (!json || typeof json !== "object") return [];
  if (json.timestamps !== false && Array.isArray(json.words) && json.words.length) {
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
  if (!out.length && typeof json.text === "string") {
    const len = isNum(json.duration) && json.duration > 0 ? json.duration : isNum(span) && span > 0 ? span : null;
    return len != null ? spreadWords(json.text, offset, offset + len) : json.text.split(/\s+/).filter(Boolean).map(w => ({ w }));
  }
  return out;
}
/** did this answer come without word times (they were then estimated)? */
const untimed = json => !!json && (json.timestamps === false || !(Array.isArray(json.words) && json.words.length)) && !(Array.isArray(json.segments) && json.segments.length);

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

/** is this recording sent as it is to this transcriber? (otherwise it is decoded and sent in pieces) */
export function sentDirect(size, seconds, provider) {
  if (size > DIRECT_LIMIT) return false;
  return provider !== "gemini" || (seconds != null && seconds <= GEMINI_DIRECT_SECONDS);
}
/**
 * Get a recording ready to be transcribed (possibly more than once: the decoded audio is reused by every pass and by
 * every transcriber).
 * @param providers  the transcribers that will be used ([] or [null] = the Worker's default)
 * @returns {file, pcm, seconds}  pcm is null when the file is sent as it is to every one of them
 */
export async function prepare(file, onProgress = () => {}, signal = null, providers = []) {
  const gemini = providers.includes("gemini");
  const seconds = gemini || file.size > DIRECT_LIMIT ? await probeDuration(file) : null;
  if (signal && signal.aborted) throw new AsrError("aborted");
  if ((providers.length ? providers : [null]).every(p => sentDirect(file.size, seconds, p))) return { file, pcm: null, seconds };
  onProgress(0.03, { code: "asr.decode" });
  if (seconds != null && seconds > MAX_DECODE_SECONDS) throw new AsrError("too_long");
  let pcm;
  try { pcm = await decodeMono16k(file); }
  catch (e) {
    // "EncodingError" is the browser saying the bytes are not audio it can read; anything else at this size is memory
    throw new AsrError(e && e.name === "EncodingError" && file.size < 300e6 ? "decode" : "too_long");
  }
  if (signal && signal.aborted) throw new AsrError("aborted");
  return { file, pcm, seconds };
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
 * One pass over a prepared recording with one transcriber.
 * @param prep        from prepare()
 * @param language    "ar" | "en"
 * @param onProgress  (fraction 0..1, {code, args})
 * @param provider    "groq" | "gemini" | null (the Worker's default)
 * @returns {words: [{w,start,end}], provider, model, estimated}   provider / model as the Worker names them ("" when it
 *          does not); estimated: some piece came without word times and its words were spread evenly
 */
export async function transcribeWith(prep, language, cfg, onProgress = () => {}, signal = null, provider = null) {
  if (!cfg.asrUrl) throw new AsrError("disabled");
  const meta = { provider: "", model: "", estimated: false };
  const note = json => {
    if (typeof json.provider === "string" && json.provider) meta.provider = json.provider.slice(0, 40);
    if (typeof json.model === "string" && json.model) meta.model = json.model.slice(0, 80);
    if (untimed(json)) meta.estimated = true;
  };
  // (the decoded audio may be there for another transcriber: a file this one takes whole is still sent whole)
  if (sentDirect(prep.file.size, prep.seconds ?? null, provider)) {
    onProgress(0.1, { code: "asr.send" });
    const json = await sendOne(prep.file, prep.file.name || "audio", language, cfg, signal, provider);
    onProgress(1, { code: "asr.done" });
    note(json);
    return { words: wordsFromWhisper(json, 0, prep.seconds ?? null), ...meta };
  }
  if (!prep.pcm) {      // prepared for another transcriber: this one needs the pieces
    onProgress(0.03, { code: "asr.decode" });
    try { prep.pcm = await decodeMono16k(prep.file); } catch (e) { throw new AsrError(e && e.name === "EncodingError" && prep.file.size < 300e6 ? "decode" : "too_long"); }
    if (signal && signal.aborted) throw new AsrError("aborted");
  }
  const pcm = prep.pcm, plan = chunkPlan(pcm.length / RATE), words = [];
  for (let k = 0; k < plan.length; k++) {
    const c = plan[k];
    onProgress(0.1 + 0.9 * (k / plan.length), { code: "asr.part", args: [k + 1, plan.length] });
    const json = await sendOne(encodeWav(pcm.subarray(Math.round(c.from * RATE), Math.round(c.to * RATE))), `part-${k + 1}.wav`, language, cfg, signal, provider);
    note(json);
    for (const w of wordsFromWhisper(json, c.from, c.to - c.from)) {
      if (w.start == null) { words.push(w); continue; }
      const mid = (w.start + w.end) / 2;
      if (mid >= c.lo && mid < c.hi) words.push(w);      // the two-second overlap is transcribed twice; each word is kept once
    }
  }
  onProgress(1, { code: "asr.done" });
  return { words, ...meta };
}
/** the same, answering the words alone */
export async function transcribePrepared(prep, language, cfg, onProgress = () => {}, signal = null, provider = null) {
  return (await transcribeWith(prep, language, cfg, onProgress, signal, provider)).words;
}

/** one pass over one file (kept for callers that do not need to reuse the decoded audio) */
export async function transcribe(file, cfg, onProgress = () => {}, signal = null) {
  if (!cfg.asrUrl) throw new AsrError("disabled");
  return transcribePrepared(await prepare(file, onProgress, signal), cfg.language === "en" ? "en" : "ar", cfg, onProgress, signal);
}

// ---------------- a YouTube video from its link (the Worker's /yt, Gemini) ----------------
const YT_WINDOW = 600, YT_OVERLAP = 8;
// Models that answered "high demand" (or nothing at all) in the last five minutes: named to the Worker so that it asks them last. (Measured:
// such an answer can take half a minute to come, and nothing on the Worker's side remembers it from one window to the next.)
const ytBusy = new Map(), YT_BUSY_MS = 300000;
const ytNoteBusy = j => { if (j && Array.isArray(j.busy)) for (const m of j.busy.slice(0, 8)) if (typeof m === "string" && /^[a-z0-9.-]{1,40}$/.test(m)) ytBusy.set(m, Date.now() + YT_BUSY_MS); };
const ytAfter = () => { const now = Date.now(), out = []; for (const [m, until] of ytBusy) { if (until > now) out.push(m); else ytBusy.delete(m); } return out.slice(0, 6); };
const plainWord = w => String(w).normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "").replace(/[\u064B-\u0652\u0670\u0640]/g, "").toLowerCase();
async function ytPost(cfg, body, signal, onWait = null) {
  const post = async () => {
    let r;
    const after = body.from != null ? ytAfter() : [];
    try { r = await fetch(endpoint(cfg, "/yt"), { method: "POST", headers: { "Content-Type": "application/json", ...(cfg.userKey ? { "X-Athar-Key": cfg.userKey } : {}) }, body: JSON.stringify(after.length ? { ...body, after } : body), signal }); }      // the reader's own Gemini key, when one was entered
    catch { throw new AsrError(signal && signal.aborted ? "aborted" : "network"); }
    let j = null; try { j = await r.json(); } catch { /* not json */ }
    ytNoteBusy(j);
    return { r, j };
  };
  let { r, j } = await post();
  // patience, twice at most: the Worker's counter takes one write a second (503), a model is busy for a moment (502),
  // or the free quota per minute is spent (429 upstream_busy: the wait it names, at most a minute)
  // (the quota per minute is the usual reason a long video stops half way, so that one is waited for four times)
  for (let tries = 0; tries < 4; tries++) {
    const busy = r.status === 429 && j && j.error === "upstream_busy";
    if (!(r.status === 503 || busy || (r.status === 502 && j && j.error === "upstream")) || (!busy && tries >= 2)) break;
    const ra = Number(r.headers.get("Retry-After"));
    if (busy && ra > 600) throw new AsrError("yt_quota", String(r.status), cfg.userKey ? "own" : "", ra);       // the free quota of the DAY is spent on every key: waiting a minute changes nothing
    const wait = cfg.ytRetryMs ?? (r.status === 503 ? 2000 : busy ? Math.min(Math.max(Number.isFinite(ra) ? ra * 1000 : 0, 20000 + 15000 * tries), 65000) : 15000);
    if (onWait && wait >= 5000) onWait(wait);
    await sleep(wait, signal);
    ({ r, j } = await post());
  }
  if (r.status === 429 && j && j.error === "upstream_busy" && Number(r.headers.get("Retry-After")) > 600) throw new AsrError("yt_quota", String(r.status), cfg.userKey ? "own" : "", Number(r.headers.get("Retry-After")));
  if (!r.ok) throw errorOf(r, j);
  if (!j || typeof j !== "object") throw new AsrError("bad_response");
  return j;
}
/**
 * Does Google accept this key? Asked when the reader saves his own key. -> "ok" | "bad" | "unknown" (no answer, or an
 * answer that says nothing about the key: the key is then kept, and the first link will tell).
 */
export async function checkOwnKey(cfg, key, timeout = 20000) {
  if (!cfg.asrUrl || !key) return "unknown";
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(endpoint(cfg, "/yt"), { method: "POST", headers: { "Content-Type": "application/json", "X-Athar-Key": key }, body: JSON.stringify({ probe: true }), signal: ctl.signal });
    let j = null; try { j = await r.json(); } catch { /* not json */ }
    if (r.ok && j && j.ok === true) return "ok";
    return r.status === 400 && j && j.error === "user_key_invalid" ? "bad" : "unknown";
  } catch { return "unknown"; }
  finally { clearTimeout(timer); }
}
/** the windows a video of `seconds` is asked for in: each begins a little before the previous one ended */
export function ytPlan(seconds) {
  const out = [];
  for (let k = 0; k * YT_WINDOW < seconds; k++) out.push({ from: Math.max(0, k * YT_WINDOW - (k ? YT_OVERLAP : 0)), to: Math.min(Math.ceil(seconds), (k + 1) * YT_WINDOW), cut: k * YT_WINDOW });
  return out;
}
/**
 * Join two neighbouring windows. The second begins a few seconds before the first ended, so the same words stand at the end
 * of A and at the start of B: the join is made at the LAST run of three words they share there (A up to it, B after it).
 * A word cut off by the end of window A is thus never kept. When no such run is found the cut is made by time.
 */
export function ytStitch(A, B, cut) {
  if (!A.length || !B.length) return A.concat(B);
  const tail = A.slice(-70), a0 = A.length - tail.length, head = B.filter(w => w.start < cut + 20).slice(0, 70);
  const ta = tail.map(w => plainWord(w.w)), hb = head.map(w => plainWord(w.w));
  for (let j = hb.length - 3; j >= 0; j--) {
    if (!hb[j] || !hb[j + 1] || !hb[j + 2]) continue;
    for (let i = ta.length - 3; i >= 0; i--) {
      if (ta[i] === hb[j] && ta[i + 1] === hb[j + 1] && ta[i + 2] === hb[j + 2]) return A.slice(0, a0 + i + 3).concat(B.slice(j + 3));
    }
  }
  return A.filter(w => w.start < cut).concat(B.filter(w => w.start >= cut));
}
/**
 * @returns {words, provider, model, seconds, approx: true, truncated}  — word times are estimated inside each short piece
 */
/** `resume`: what an earlier call returned as partial ({words, seconds, title, author, model, truncated, partial: {k}}): the work goes on from its window k */
export async function transcribeYoutube(video, language, cfg, onProgress = () => {}, signal = null, resume = null) {
  if (!cfg.asrUrl) throw new AsrError("disabled");
  const again = resume && resume.partial && resume.partial.k > 0 && Array.isArray(resume.words) && resume.words.length && resume.seconds > 0 ? resume : null;
  let seconds, about;
  if (again) { seconds = again.seconds; about = { title: again.title || "", author: again.author || "" }; }
  else {
    onProgress(0.02, { code: "yt.length" });
    const head = await ytPost(cfg, { video }, signal); seconds = head.seconds;
    if (!(seconds > 0)) throw new AsrError("yt_unavailable");
    about = { title: typeof head.title === "string" ? head.title.slice(0, 200) : "", author: typeof head.author === "string" ? head.author.slice(0, 100) : "" };
  }
  const plan = ytPlan(seconds); let words = again ? again.words : [], model = again ? again.model || "" : "", truncated = !!(again && again.truncated);
  for (let k = again ? Math.min(again.partial.k, plan.length - 1) : 0; k < plan.length; k++) {
    const at = 0.05 + 0.95 * (k / plan.length);
    onProgress(at, { code: "yt.part", args: [k + 1, plan.length] });
    if (k) await sleep(1100, signal);                       // the Worker's counter cannot take two writes within a second
    let j;
    try { j = await ytPost(cfg, { video, from: plan[k].from, to: plan[k].to, language: language === "en" ? "en" : "ar" }, signal, ms => onProgress(at, { code: "yt.wait", args: [Math.round(ms / 1000)] })); }
    catch (e) {
      // a later window failed: what was transcribed so far is kept and said to be partial, not thrown away
      if (!k || !words.length || (e instanceof AsrError && e.code === "aborted")) throw e;
      return { words, provider: "gemini", model, seconds, ...about, approx: true, truncated, partial: { upTo: plan[k].cut, k, why: e instanceof AsrError ? e : new AsrError("unknown") } };
    }
    if (typeof j.model === "string" && j.model) model = j.model.slice(0, 80);
    if (j.truncated) truncated = true;
    const part = wordsFromWhisper(j, 0, null).filter(w => w.start != null);
    words = k ? ytStitch(words, part, plan[k].cut) : part;
  }
  for (let i = 1; i < words.length; i++) if (words[i].start < words[i - 1].start) { words[i] = { ...words[i], start: words[i - 1].start, end: Math.max(words[i].end, words[i - 1].start) }; }   // a join never runs time backwards
  onProgress(1, { code: "asr.done" });
  return { words, provider: "gemini", model, seconds, ...about, approx: true, truncated };
}

// ---------------- the checker and the chat (Worker /ask) ----------------
/**
 * One question to the Worker's /ask: {mode: "check", items} -> {verdicts} ; {mode: "chat", q, facts, prev, lang} -> {type, ids, text}.
 * A busy counter store is waited for once. Failures are AsrError (the same codes as the other routes).
 */
export async function askPost(cfg, body, signal = null) {
  if (!cfg.asrUrl) throw new AsrError("disabled");
  const post = async () => {
    let r;
    try { r = await fetch(endpoint(cfg, "/ask"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }); }
    catch { throw new AsrError(signal && signal.aborted ? "aborted" : "network"); }
    let j = null; try { j = await r.json(); } catch { /* not json */ }
    return { r, j };
  };
  let { r, j } = await post();
  if (r.status === 503) { await sleep(2000, signal); ({ r, j } = await post()); }
  if (!r.ok) throw errorOf(r, j);
  if (!j || typeof j !== "object") throw new AsrError("bad_response");
  return j;
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
