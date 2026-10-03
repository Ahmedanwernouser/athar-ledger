// transcribe.mjs — run on YOUR machine to transcribe the team's recordings with Whisper. Two ways:
//
//   (a) directly at Groq, with your own key. Put the key in the environment WITHOUT typing it on the command line
//       (so it does not end up in the shell history), and never commit it:
//           read -s GROQ_API_KEY; export GROQ_API_KEY
//           node eval/transcribe.mjs
//   (b) through the project's Cloudflare Worker (/asr), which holds the key itself:
//           ASR_WORKER_URL=https://<your-worker>.workers.dev  ASR_ORIGIN=https://<your-site>  node eval/transcribe.mjs
//       The Worker accepts a multipart form with ONLY `file` and `language`; it chooses the model and the format itself,
//       checks the Origin against its allow-list, and answers errors as JSON {error: "<code>"}.
//
// Reads  eval/recordings/clip_NN.<ext>   or, per speaker, eval/recordings/<speaker>/clip_NN.<ext>
//        ext: m4a mp3 mp4 wav ogg opus webm flac mpga mpeg   (WhatsApp voice notes are .opus / .ogg)
// Writes eval/transcripts/<speaker>__clip_NN.json  (Whisper verbose_json, kept verbatim as evidence)
// A 429 is retried after the server's Retry-After. The exit code is non-zero if any file failed. The key is never printed.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import { EVAL } from "./lib.mjs";

const KEY = process.env.GROQ_API_KEY || "", WORKER = (process.env.ASR_WORKER_URL || "").replace(/\/+$/, "");
if (!KEY && !WORKER) {
  console.error("ضع المفتاح في متغير البيئة ثم أعد التشغيل:\n  read -s GROQ_API_KEY; export GROQ_API_KEY\nأو استخدم خدمة المشروع: ASR_WORKER_URL=… ASR_ORIGIN=…");
  process.exit(1);
}
const MODEL = process.env.ASR_MODEL || "whisper-large-v3";       // direct mode only; the Worker chooses its own model
const LANG = process.env.ASR_LANGUAGE === "en" ? "en" : "ar";
const REC = path.join(EVAL, "recordings"), OUT = path.join(EVAL, "transcripts");
const AUDIO = /\.(m4a|mp3|mp4|wav|ogg|opus|webm|flac|mpga|mpeg)$/i, NAME = /^clip_\d+$/;
const MIME = { m4a: "audio/mp4", mp3: "audio/mpeg", mp4: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg", webm: "audio/webm", flac: "audio/flac", mpga: "audio/mpeg", mpeg: "audio/mpeg" };
const files = [], ignored = [];
const walk = (d, speaker) => { for (const f of readdirSync(d).sort()) { const p = path.join(d, f);
  if (statSync(p).isDirectory()) walk(p, f);
  else if (f.startsWith(".")) continue;
  else if (!AUDIO.test(f)) ignored.push(`${p} — امتداد غير مدعوم`);
  else if (!NAME.test(f.replace(/\.[^.]+$/, ""))) ignored.push(`${p} — الاسم يجب أن يكون clip_NN (مثل clip_01.m4a)`);
  else files.push({ p, speaker, clip: f.replace(/\.[^.]+$/, ""), ext: f.split(".").pop().toLowerCase() }); } };
if (existsSync(REC)) walk(REC, "speaker1");
if (ignored.length) { console.error(`تحذير: ${ignored.length} ملفًا لن يُفرَّغ:`); for (const x of ignored) console.error("  -", x); }
if (!files.length) { console.error("لا توجد تسجيلات صالحة في eval/recordings/"); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const redact = s => (KEY ? String(s).split(KEY).join("[key]") : String(s)).replace(/gsk_[A-Za-z0-9]+/g, "[key]");
/** one request; returns {ok, json} or {ok:false, status, code, retryAfter} — never throws, never exposes the key */
async function once(f) {
  const fd = new FormData();
  // Groq (and the Worker) recognise the format from the file name's extension; .opus is sent as .ogg
  const name = f.clip + "." + (f.ext === "opus" ? "ogg" : f.ext);
  fd.append("file", new Blob([readFileSync(f.p)], { type: MIME[f.ext] || "application/octet-stream" }), name);
  fd.append("language", LANG);
  let url, headers;
  if (WORKER) { url = WORKER + "/asr"; headers = process.env.ASR_ORIGIN ? { Origin: process.env.ASR_ORIGIN } : {}; }   // ONLY file + language
  else {
    url = "https://api.groq.com/openai/v1/audio/transcriptions"; headers = { Authorization: "Bearer " + KEY };
    fd.append("model", MODEL); fd.append("response_format", "verbose_json");
    fd.append("timestamp_granularities[]", "word"); fd.append("timestamp_granularities[]", "segment"); fd.append("temperature", "0");
  }
  let r;
  try { r = await fetch(url, { method: "POST", headers, body: fd }); } catch (e) { return { ok: false, status: 0, code: "network: " + redact(e.message) }; }
  if (r.ok) { try { return { ok: true, json: await r.json() }; } catch { return { ok: false, status: r.status, code: "bad_json" }; } }
  let code = "";
  try { const j = await r.json(); code = typeof j.error === "string" ? j.error : (j.error && (j.error.code || j.error.type)) || ""; } catch { /* not JSON */ }
  const ra = Number(r.headers.get("Retry-After"));
  return { ok: false, status: r.status, code: redact(code || "http_" + r.status), retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null };
}

const failed = []; let done = 0;
for (const f of files) {
  const out = path.join(OUT, `${f.speaker}__${f.clip}.json`);
  if (existsSync(out)) { console.log("موجود:", out); continue; }
  let res = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    res = await once(f);
    if (res.ok) break;
    // 429: wait as long as the server asks, up to 5 attempts. Network / 5xx: one more attempt only (each one may cost quota).
    const retriable = res.status === 429 ? attempt < 5 : (res.status === 0 || res.status >= 500) && attempt < 2;
    if (res.code === "daily_cap" || !retriable) break;
    const wait = Math.min(res.retryAfter ?? 20 * attempt, 900);
    console.error(`  ${path.basename(f.p)}: ${res.status} ${res.code} — إعادة المحاولة بعد ${wait} ث (المحاولة ${attempt} من 5)`);
    await sleep(wait * 1000);
  }
  if (!res.ok) { failed.push(`${f.p} — ${res.status} ${res.code}`); console.error("فشل:", f.p, res.status, res.code); continue; }
  const j = res.json; j._model = WORKER ? (j.model || "Whisper عبر خدمة المشروع (النموذج يحدده الخادم)") : MODEL; j._file = path.basename(f.p); j._via = WORKER ? "worker" : "groq";
  writeFileSync(out, JSON.stringify(j)); console.log("تم:", out); done++;
  await sleep(3500);   // stay under the free-tier requests-per-minute limit
}
console.log(`فُرِّغ ${done} ملفًا؛ فشل ${failed.length}.`);
if (failed.length) { console.error("الملفات التي فشلت (أعد التشغيل لإكمالها؛ الملفات المنجزة لا تُعاد):"); for (const x of failed) console.error("  -", x); process.exit(2); }
