// Live end-to-end check of "a YouTube video from its link": the site's own client code (public/js/asr.js) against the REAL
// Worker code (worker/src.js) against the REAL Gemini API, then the engine on the transcript.
// Runs on the test machine (GitHub Actions). Keys come from repository secrets and are never printed or saved.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../../worker/src.js";
import { transcribeYoutube } from "../../public/js/asr.js";
import { loadCorpusWith } from "../lib.mjs";
import { analyze } from "../../public/js/engine.js";

const HERE = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(HERE, "out-yt");
mkdirSync(OUT, { recursive: true });
const KEYS = String(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "").split(/[\s,;]+/).filter(k => k.length > 10);
const redact = (s) => { let t = String(s); for (const k of KEYS) t = t.split(k).join("<KEY>"); return t; };
const save = (name, data) => writeFileSync(path.join(OUT, name), redact(typeof data === "string" ? data : JSON.stringify(data, null, 1)) + "\n");
const summary = []; const say = s => { console.log(redact(s)); summary.push(redact(s)); };
if (!KEYS.length) { save("SUMMARY.txt", "no key"); process.exit(0); }

const kv = () => { const m = new Map(); return { get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } }; };
const ORIGIN = "https://live-test.example";
let keyAt = 0; const upstream = [];
const envNow = () => ({ ALLOWED_ORIGINS: ORIGIN, CAP: kv(), DAILY_CAP: "100000", HOURLY_CAP: "100000", IP_DAILY_CAP: "100000", GEMINI_API_KEY: KEYS[keyAt] });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith("https://w.dev/")) {         // the site's request to its Worker
    for (let tries = 0; ; tries++) {
      const r = await worker.fetch(new Request(url, { ...init, headers: { ...(init.headers || {}), Origin: ORIGIN } }), envNow(), { waitUntil: p => p });
      if (r.status === 429 && tries < KEYS.length - 1) { keyAt = (keyAt + 1) % KEYS.length; continue; }      // another key on a quota answer
      return r;
    }
  }
  const t0 = Date.now(), r = await realFetch(url, init);
  upstream.push({ url: String(url).replace(/^https:\/\/[^/]+/, ""), status: r.status, ms: Date.now() - t0 });
  return r;
};

const corpus = await loadCorpusWith(["daif"]);
const VIDEOS = String(process.env.YT_VIDEOS || "1foxMsRygJg").split(/[\s,]+/).filter(Boolean);
// a longer one from the same public playlist, to exercise more than one window (the first whose length is 11–40 minutes)
try {
  const html = await (await realFetch("https://www.youtube.com/playlist?list=PLZbyN8Td38XgDoErS9Ca3jIxwVsGKizxT&hl=en", { headers: { "Accept-Language": "en", "Cookie": "CONSENT=YES+1" } })).text();
  const ids = [...new Set([...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map(m => m[1]))];
  const lens = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,1500}?"lengthSeconds":"(\d+)"/g)].map(m => [m[1], +m[2]]);
  say(`playlist: ${ids.length} videos seen, ${lens.length} with a length`);
  const long = lens.find(([id, s]) => s >= 660 && s <= 2400 && !VIDEOS.includes(id));
  if (long) { VIDEOS.push(long[0]); say(`longer video picked: ${long[0]} (${long[1]} s)`); }
} catch (e) { say("playlist not readable from here: " + (e && e.message)); }

for (const id of VIDEOS) {
  const t0 = Date.now(); upstream.length = 0;
  try {
    const r = await transcribeYoutube(id, "ar", { asrUrl: "https://w.dev" }, () => {});
    const words = r.words;
    const res = analyze(words, corpus);
    save(`${id}.transcript.txt`, words.map(w => w.w).join(" "));
    save(`${id}.words.json`, { video: id, seconds: r.seconds, model: r.model, truncated: r.truncated, words });
    save(`${id}.ledger.json`, res.ledger.map(e => ({ start: e.start, status: e.status, cue: e.cue, spoken: e.spoken, source: e.source && e.source.label, agreement: e.agreement, weakOnly: e.weakOnly, weakBooks: (e.weakBooks || []).map(w => w.label), grades: (e.spokenGrades || []).map(g => g.kind + ": " + g.text), attribution: e.attribution && e.attribution.code })));
    const back = words.filter((w, i) => i && w.start < words[i - 1].start - 0.01).length;
    say(`${id}: ${r.seconds} s, ${words.length} words, model ${r.model}, ${Math.round((Date.now() - t0) / 1000)} s of work, ${upstream.length} upstream calls (${upstream.map(u => u.status).join(" ")}), ` +
      `last word at ${words.length ? words.at(-1).start : "-"} s, ${back} words out of time order, ${res.ledger.length} ledger entries: ` +
      res.ledger.map(e => `${Math.round(e.start)}s ${e.status}${e.source ? " " + e.source.label : ""}`).join(" | "));
  } catch (e) { say(`${id}: FAILED ${e && e.code ? e.code + " " + (e.detail || "") : e && e.message}; upstream ${JSON.stringify(upstream)}`); }
}
save("SUMMARY.txt", summary.join("\n"));
