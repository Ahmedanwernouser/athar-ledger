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

const PROMPT = (from, to) => "Transcribe the speech in this video" + (to ? ` between ${from} and ${to}` : "") + " verbatim, in the language it is spoken in (Arabic). Write exactly what is said, word for word, " +
  "including repetitions, hesitations and mistakes. Do NOT correct, complete or normalise any quotation of the Qur'an or of hadith: if the speaker " +
  "misquotes, write the misquotation. No translation, no summary, no commentary, no diacritics. Give each piece of at most 12 words with the time at which it " +
  "starts, as MM:SS counted from the beginning of the FULL video. If there is no speech in this part, return an empty list.";
const SCHEMA = { type: "ARRAY", items: { type: "OBJECT", properties: { t: { type: "STRING" }, x: { type: "STRING" } }, required: ["t", "x"] } };

async function call(name, url, body) {
  const rec = { name, url: url.replace(BASE, ""), request: body };
  for (let i = 0; i < KEYS.length; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { method: body ? "POST" : "GET", headers: { "x-goog-api-key": KEYS[i], "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(280000) });
      const text = await r.text();
      rec.status = r.status; rec.ms = Date.now() - t0; rec.key = i + 1; rec.bytes = text.length; rec.response = text.slice(0, r.ok ? 6000 : 3000);
      if (r.ok) { save(name + ".full.json", text); break; }
      if (r.status !== 429 && r.status !== 403 && r.status !== 503) break;
    } catch (e) { rec.error = String(e && e.message); rec.ms = Date.now() - t0; break; }
  }
  save(name + ".json", rec);
  summary.push(`${name}: ${rec.status ?? "ERR " + rec.error} in ${rec.ms} ms, ${rec.bytes ?? 0} bytes`);
  return rec;
}
const gen = (model, from, to, extra = {}) => ({
  contents: [{ role: "user", parts: [{ file_data: { file_uri: URL_ }, ...(to ? { video_metadata: { start_offset: from + "s", end_offset: to + "s", ...(extra.fps ? { fps: extra.fps } : {}) } } : extra.fps ? { video_metadata: { fps: extra.fps } } : {}) },
    { text: PROMPT(to ? mmss(from) : "", to ? mmss(to) : "") }] }],
  generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA, ...(extra.low ? { mediaResolution: "MEDIA_RESOLUTION_LOW" } : {}), ...(/gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {}) } });
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const G = m => BASE + `/v1beta/models/${m}:generateContent`;

for (const model of ["gemini-3.5-flash", "gemini-3.8-flash"]) {
  const tag = model.replace("gemini-", "");
  await call(`${tag}-count`, BASE + `/v1beta/models/${model}:countTokens`, { contents: [{ role: "user", parts: [{ file_data: { file_uri: URL_ } }] }] });
  await call(`${tag}-full`, G(model), gen(model, 0, 0));
  await call(`${tag}-full-fps02`, G(model), gen(model, 0, 0, { fps: 0.2 }));
  await call(`${tag}-clip-000-060`, G(model), gen(model, 0, 60, { fps: 0.2 }));
  await call(`${tag}-clip-060-120`, G(model), gen(model, 60, 120, { fps: 0.2 }));
  await call(`${tag}-clip-120-180`, G(model), gen(model, 120, 180, { fps: 0.2 }));
  await call(`${tag}-clip-180-240`, G(model), gen(model, 180, 240, { fps: 0.2 }));
}
// a link that is not a video, and a private / missing one: what does the API answer?
{
  const bad = (id) => ({ contents: [{ role: "user", parts: [{ file_data: { file_uri: "https://www.youtube.com/watch?v=" + id } }, { text: PROMPT("", "") }] }], generationConfig: { temperature: 0 } });
  await call("missing-video", G("gemini-3.5-flash"), bad("AAAAAAAAAAA"));
}
save("SUMMARY.txt", summary.join("\n"));
console.log(redact(summary.join("\n")));
