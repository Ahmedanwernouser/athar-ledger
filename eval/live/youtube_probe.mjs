// Which request shape lets Gemini transcribe a public YouTube video from its link alone?
// Runs on the test machine (GitHub Actions). Keys come from repository secrets and are never printed or saved.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(HERE, "out-yt");
mkdirSync(OUT, { recursive: true });
const KEYS = String(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "").split(/[\s,;]+/).filter(k => k.length > 10);
const redact = (s) => { let t = String(s); for (const k of KEYS) t = t.split(k).join("<KEY>"); return t; };
const save = (name, data) => writeFileSync(path.join(OUT, name), redact(typeof data === "string" ? data : JSON.stringify(data, null, 1)) + "\n");
const VIDEO = process.env.YT_VIDEO || "1foxMsRygJg";
const URL_ = "https://www.youtube.com/watch?v=" + VIDEO;
const BASE = "https://generativelanguage.googleapis.com";
const summary = [];
if (!KEYS.length) { save("SUMMARY.txt", "no key"); process.exit(0); }

const PROMPT = "Transcribe the speech in this video verbatim, in the language it is spoken in (Arabic). Write exactly what is said, word for word, " +
  "including repetitions, hesitations and mistakes. Do NOT correct, complete or normalise any quotation of the Qur'an or of hadith: if the speaker " +
  "misquotes, write the misquotation. No translation, no summary, no commentary, no diacritics. Output JSON only: an array of objects " +
  '{"s": <start time in seconds, a number>, "t": "<the words spoken, at most 12 words>"} in order, covering the whole video.';

async function call(name, url, body) {
  const rec = { name, url: url.replace(BASE, ""), request: body };
  for (let i = 0; i < KEYS.length; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { method: body ? "POST" : "GET", headers: { "x-goog-api-key": KEYS[i], "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(280000) });
      const text = await r.text();
      rec.status = r.status; rec.ms = Date.now() - t0; rec.key = i + 1; rec.bytes = text.length; rec.response = text.slice(0, r.ok ? 6000 : 3000);
      if (r.ok) { save(name + ".full.json", text); break; }
      if (r.status !== 429 && r.status !== 403) break;       // another key will not change a 400 / 404
    } catch (e) { rec.error = String(e && e.message); rec.ms = Date.now() - t0; break; }
  }
  save(name + ".json", rec);
  summary.push(`${name}: ${rec.status ?? "ERR " + rec.error} in ${rec.ms} ms, ${rec.bytes ?? 0} bytes`);
  return rec;
}

// what the key can see
const m = await call("0-models", BASE + "/v1beta/models?pageSize=200");
let models = [];
try { models = JSON.parse(m.response.length >= 6000 ? (await (await fetch(BASE + "/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": KEYS[0] } })).text()) : m.response).models.map(x => x.name.replace("models/", "")); } catch { /* keep going */ }
save("models.json", models);
const flash = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3-flash", "gemini-2.5-flash"].filter(x => models.includes(x));
const general = flash[0] || models.find(x => /flash/.test(x) && !/lite|tts|image|live|audio|embed/.test(x)) || "gemini-2.5-flash";
summary.push("general model picked: " + general + " (flash candidates present: " + flash.join(", ") + ")");

const tc = { transcription_config: { language_codes: ["ar-EG"], mode: { type: "verbatim", timestamp_granularities: ["word"] } } };
// 1) the transcription model, the link given as a video
await call("1-transcribe-video", BASE + "/v1beta/interactions", { model: "gemini-3.5-transcribe", input: [{ type: "video", uri: URL_ }], generation_config: tc });
// 2) the transcription model, the link given as audio
await call("2-transcribe-audio", BASE + "/v1beta/interactions", { model: "gemini-3.5-transcribe", input: [{ type: "audio", uri: URL_ }], generation_config: tc });
// 3) a general model through the interactions API
await call("3-general-interactions", BASE + "/v1beta/interactions", { model: general, input: [{ type: "text", text: PROMPT }, { type: "video", uri: URL_ }], generation_config: { temperature: 0 } });
// 4) a general model through generateContent
await call("4-general-generate", BASE + `/v1beta/models/${general}:generateContent`, { contents: [{ role: "user", parts: [{ text: PROMPT }, { file_data: { file_uri: URL_ } }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } });
// 5) the same with a second general model, when there is one (to see how much two models differ on the same speech)
if (flash[1]) await call("5-general-generate-b", BASE + `/v1beta/models/${flash[1]}:generateContent`, { contents: [{ role: "user", parts: [{ text: PROMPT }, { file_data: { file_uri: URL_ } }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } });
save("SUMMARY.txt", summary.join("\n"));
console.log(redact(summary.join("\n")));
