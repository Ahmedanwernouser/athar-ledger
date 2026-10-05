// The DEPLOYED Worker's /yt, asked the way the site asks it (the site's origin): the length of a video, one window, six
// windows at the same instant, a visitor's own key (one of the site's keys stands in for it — never written), a key that
// is not a key, and the first ten minutes of a long lecture. Run by key-probe.yml. Results name keys by position only.
import { mkdirSync, writeFileSync } from "node:fs";
const W = process.env.LIVE_WORKER, O = process.env.LIVE_ORIGIN, out = { at: new Date().toISOString(), steps: [] };
const keys = [...new Set(String(process.env.GEMINI_API_KEYS || "").split(/[\s,;]+/).filter(Boolean))];
const SHORT = process.env.PROBE_VIDEO || "jQEJVtKnshk", LONG = process.env.PROBE_LONG || "LUY29D1VgyA";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const scrub = s => { let t = String(s); for (const k of keys) t = t.split(k).join("<key>"); return t; };
async function yt(body, own = null) {
  const t0 = Date.now();
  try {
    const r = await fetch(W + "/yt", { method: "POST", headers: { Origin: O, "Content-Type": "application/json", ...(own ? { "X-Athar-Key": own } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(400000) });
    let j = null; try { j = await r.json(); } catch { /* not json */ }
    const o = { http: r.status, ms: Date.now() - t0 };
    for (const h of ["X-Athar-Yt", "X-Athar-Remaining", "Retry-After"]) if (r.headers.get(h)) o[h] = r.headers.get(h);
    if (j) {
      if (Array.isArray(j.words)) { o.model = j.model; o.words = j.words.length; o.firstAt = j.words[0] && j.words[0].start; o.lastAt = j.words.length ? j.words[j.words.length - 1].end : null; o.sample = j.words.slice(0, 14).map(w => w.word).join(" "); if (j.truncated) o.truncated = true; if (j.busy) o.busy = j.busy; }
      else o.j = JSON.parse(scrub(JSON.stringify(j)));
    }
    return o;
  } catch (e) { return { error: e.name, ms: Date.now() - t0 }; }
}
const health = async () => { try { const r = await fetch(W + "/health", { headers: { Origin: O } }); const j = await r.json(); return { http: r.status, youtube: j.youtube, yt: j.yt, configured: j.configured }; } catch (e) { return { error: e.name }; } };
const step = async (what, p) => { const v = await p; out.steps.push({ what, ...(Array.isArray(v) ? { all: v } : v) }); return v; };
out.healthBefore = await health();
const ONLY_LONGER = process.env.ONLY_LONGER === "1";
if (!ONLY_LONGER) {
const head = await step("length of the short video", yt({ video: SHORT }));
const secs = head.j && head.j.seconds ? head.j.seconds : 240;
await step("one window: the whole short video", yt({ video: SHORT, from: 0, to: Math.min(secs, 600), language: "ar" }));
await sleep(1500);
// six windows at the same instant, like six visitors pressing the button together
const cut = Math.floor(Math.min(secs, 240) / 4);
await step("six windows at the same instant", Promise.all([[0, cut], [cut, 2 * cut], [2 * cut, 3 * cut], [3 * cut, 4 * cut], [0, 2 * cut], [2 * cut, 4 * cut]].map(([a, b]) => yt({ video: SHORT, from: a, to: b, language: "ar" }))));
await sleep(1500);
// a visitor's own key
const own = keys[keys.length - 1];
if (own) {
  await step("own key: is it accepted? (probe)", yt({ probe: true }, own));
  await step("own key: one window", yt({ video: SHORT, from: 0, to: Math.min(secs, 120), language: "ar" }, own));
}
const fake = "AQ." + Array.from({ length: 50 }, (_, i) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789_-"[(i * 37 + 11) % 58]).join("");
await step("a made-up key of the right form: probe", yt({ probe: true }, fake));
await step("a made-up key of the right form: one window", yt({ video: SHORT, from: 0, to: 60, language: "ar" }, fake));
await step("a key with a space in it", yt({ probe: true }, "AQ.not a key at all 0000000000000"));
// the lecture the owner tried
const long = await step("length of the long lecture", yt({ video: LONG }));
if (long.j && long.j.seconds) {
  const a = await step("the long lecture: its first ten minutes", yt({ video: LONG, from: 0, to: Math.min(600, long.j.seconds), language: "ar" }));
  if (long.j.seconds > 600) { await sleep(1200); await step("the long lecture: its second ten minutes (told which models were busy)", yt({ video: LONG, from: 592, to: Math.min(1200, long.j.seconds), language: "ar", ...(a.busy ? { after: a.busy } : {}) })); }
}
}
// a lecture longer than ten minutes: three windows one after the other, the second told which models were busy in the first
for (const v of (process.env.PROBE_LONGER || "QuevocZeao8,L6Je11eOoYs,j6IOPpk4b48,-ve9Hw1OKNQ").split(",")) {
  const h = await step("length of " + v, yt({ video: v }));
  if (!(h.j && h.j.seconds > 700)) continue;
  const a = await step(v + ": minutes 0-10", yt({ video: v, from: 0, to: 600, language: "ar" }));
  await sleep(1200);
  const b = await step(v + ": minutes 10-20 (told which models were busy: " + JSON.stringify(a.busy || []) + ")", yt({ video: v, from: 592, to: Math.min(1200, h.j.seconds), language: "ar", ...(a.busy ? { after: a.busy } : {}) }));
  const busy = [...new Set([...(a.busy || []), ...(b.busy || [])])];
  if (h.j.seconds > 1300) { await sleep(1200); await step(v + ": minutes 20-30 (told: " + JSON.stringify(busy) + ")", yt({ video: v, from: 1192, to: Math.min(1800, h.j.seconds), language: "ar", ...(busy.length ? { after: busy } : {}) })); }
  break;
}
out.healthAfter = await health();
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/yt.json", import.meta.url), JSON.stringify(out, null, 1));
