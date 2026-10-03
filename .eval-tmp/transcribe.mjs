// transcribe.mjs — run on YOUR machine to transcribe the team's recordings with Groq Whisper.
//   GROQ_API_KEY=...  node eval/transcribe.mjs          (the key stays in your shell; never commit it)
// Reads  eval/recordings/clip_XX.(m4a|mp3|wav|ogg|webm)   (optionally in sub-folders per speaker: recordings/ahmed/clip_01.m4a)
// Writes eval/transcripts/<speaker>__clip_XX.json  (Whisper verbose_json, kept verbatim as evidence)
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./lib.mjs";
const KEY = process.env.GROQ_API_KEY;
if (!KEY) { console.error("ضع المفتاح في متغير البيئة GROQ_API_KEY ثم أعد التشغيل."); process.exit(1); }
const MODEL = process.env.ASR_MODEL || "whisper-large-v3";
const REC = path.join(ROOT, ".eval-tmp", "recordings"), OUT = path.join(ROOT, ".eval-tmp", "transcripts");
const files = [];
const walk = (d, speaker) => { for (const f of readdirSync(d)) { const p = path.join(d, f);
  if (statSync(p).isDirectory()) walk(p, f); else if (/\.(m4a|mp3|wav|ogg|webm|mp4)$/i.test(f)) files.push({ p, speaker, clip: f.replace(/\.[^.]+$/, "") }); } };
walk(REC, "speaker1");
if (!files.length) { console.error("لا توجد تسجيلات في eval/recordings/"); process.exit(1); }
for (const f of files) {
  const out = path.join(OUT, `${f.speaker}__${f.clip}.json`);
  if (existsSync(out)) { console.log("موجود:", out); continue; }
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(f.p)]), path.basename(f.p));
  fd.append("model", MODEL); fd.append("language", "ar"); fd.append("response_format", "verbose_json");
  fd.append("timestamp_granularities[]", "word"); fd.append("timestamp_granularities[]", "segment"); fd.append("temperature", "0");
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + KEY }, body: fd });
  if (!r.ok) { console.error("فشل", f.p, r.status, (await r.text()).slice(0, 200)); if (r.status === 429) await new Promise(s => setTimeout(s, 20000)); continue; }
  const j = await r.json(); j._model = MODEL; j._file = path.basename(f.p);
  writeFileSync(out, JSON.stringify(j)); console.log("تم:", out);
  await new Promise(s => setTimeout(s, 3500));   // stay under the free-tier requests-per-minute limit
}
