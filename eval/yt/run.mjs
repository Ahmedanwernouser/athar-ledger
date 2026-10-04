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
const VIDEOS = String(process.env.YT_VIDEOS || "1foxMsRygJg ikgqwDVXs8E").split(/[\s,]+/).filter(Boolean);
// ---- is the length the Worker reports (countTokens: audio tokens / 32) the real length, for short AND long videos? ----
// Ground truth: "lengthSeconds" in the video's own watch page, read from this machine. Candidates: the owner's playlist and a
// search for long lectures. One video of 11–40 minutes is then transcribed in full, to exercise several windows.
const page = async (url) => (await realFetch(url, { headers: { "Accept-Language": "en", "Cookie": "CONSENT=YES+1; SOCS=CAI" } })).text();
const trueLength = async (id) => { try { const m = /"lengthSeconds":"(\d+)"/.exec(await page("https://www.youtube.com/watch?v=" + id + "&hl=en")); return m ? +m[1] : null; } catch { return null; } };
const askLength = async (id) => { const r = await globalThis.fetch("https://w.dev/yt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video: id }) }); const j = await r.json().catch(() => ({})); return j.seconds ?? j.error; };
if (process.env.YT_LENGTH_CHECK === "1") try {
  const cand = [], printed = new Map();
  const pl = await page("https://www.youtube.com/playlist?list=PLZbyN8Td38XgDoErS9Ca3jIxwVsGKizxT&hl=en");
  cand.push(...[...new Set([...pl.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map(m => m[1]))].slice(0, 6));
  for (const q of ["محاضرة كاملة الشيخ الحويني", "خطبة الجمعة كاملة", "شرح الأربعين النووية الدرس الأول"]) {
    const sr = await page("https://www.youtube.com/results?search_query=" + encodeURIComponent(q) + "&sp=EgIYAg%253D%253D&hl=en");
    cand.push(...[...new Set([...sr.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map(m => m[1]))].slice(0, 5));
    // the results page prints each video's length ("simpleText":"1:02:33") inside its own entry
    for (const m of sr.matchAll(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,6000}?"lengthText":\{[\s\S]{0,300}?"simpleText":"([0-9:]+)"/g)) {
      const p = m[2].split(":").map(Number); printed.set(m[1], p.reduce((a, b) => a * 60 + b, 0));
    }
  }
  const rows = []; let picked = false;
  for (const id of [...new Set([VIDEOS[0], ...cand])].slice(0, 22)) {
    const truth = (await trueLength(id)) ?? printed.get(id) ?? null, got = await askLength(id);
    rows.push({ id, truth, worker: got, diff: typeof got === "number" && truth ? got - truth : null });
    if (!picked && typeof got === "number" && got >= 660 && got <= 2400 && (truth == null || Math.abs(got - truth) <= 5)) { VIDEOS.push(id); picked = true; }
  }
  save("lengths.json", rows);
  const num = rows.filter(r => r.diff != null);
  say(`length check on ${rows.length} videos (${num.length} comparable): worst difference ${num.length ? Math.max(...num.map(r => Math.abs(r.diff))) : "-"} s; ` + rows.map(r => `${r.id}: page ${r.truth} / worker ${r.worker}`).join(", "));
  say(picked ? `longer video picked for a full run: ${VIDEOS.at(-1)}` : "no video of 11–40 minutes with a confirmed length was found");
} catch (e) { say("length check could not run: " + (e && e.message)); }

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
      `last word at ${words.length ? words.at(-1).start : "-"} s, ${back} words out of time order, ${r.partial ? "PARTIAL up to " + r.partial.upTo + " s (" + r.partial.why.code + "), " : "complete, "}${res.ledger.length} ledger entries: ` +
      res.ledger.map(e => `${Math.round(e.start)}s ${e.status}${e.source ? " " + e.source.label : ""}`).join(" | "));
  } catch (e) { say(`${id}: FAILED ${e && e.code ? e.code + " " + (e.detail || "") : e && e.message}; upstream ${JSON.stringify(upstream)}`); }
}
// ---- the DEPLOYED Worker, asked as the site asks it (its own key, its own counters): the length, then the first window ----
const LIVE = String(process.env.LIVE_WORKER || "").replace(/\/+$/, ""), LIVE_ORIGIN = String(process.env.LIVE_ORIGIN || "");
if (LIVE && LIVE_ORIGIN) {
  try {
    const ask = async (body) => { const t0 = Date.now(); const r = await realFetch(LIVE + "/yt", { method: "POST", headers: { Origin: LIVE_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, ms: Date.now() - t0, left: r.headers.get("X-Athar-Remaining"), j: await r.json().catch(() => ({})) }; };
    const h = await (await realFetch(LIVE + "/health")).json().catch(() => ({}));
    const a = await ask({ video: VIDEOS[0] });
    const to = Math.min(a.j.seconds || 60, 600);
    const b = await ask({ video: VIDEOS[0], from: 0, to, language: "ar" });
    say(`deployed Worker: health youtube=${h.youtube}; length ${a.status} ${JSON.stringify(a.j)} in ${a.ms} ms; window 0–${to}: ${b.status} in ${b.ms} ms, ${(b.j.words || []).length} words, model ${b.j.model || "-"}, error ${b.j.error || "-"}, units left today ${b.left}`);
    if (b.j.text) save("deployed.transcript.txt", b.j.text);
    const bad = await ask({ video: "AAAAAAAAAAA" });
    say(`deployed Worker, a video that does not exist: ${bad.status} ${JSON.stringify(bad.j)}`);
  } catch (e) { say("deployed Worker not reachable: " + (e && e.message)); }
}
save("SUMMARY.txt", summary.join("\n"));
