// A YouTube video from its link: the windows that are asked for, and how two neighbouring windows are joined.
import test from "node:test";
import assert from "node:assert/strict";
import { ytPlan, ytStitch, transcribeYoutube, checkOwnKey, AsrError } from "../public/js/asr.js";

const W = (text, t0, step = 0.5) => text.split(" ").map((w, i) => ({ w, start: t0 + i * step, end: t0 + (i + 1) * step }));
const said = ws => ws.map(w => w.w).join(" ");

test("windows: ten minutes each, every one after the first begins 8 s early, the last ends with the video", () => {
  assert.deepEqual(ytPlan(159), [{ from: 0, to: 159, cut: 0 }]);
  assert.deepEqual(ytPlan(600), [{ from: 0, to: 600, cut: 0 }]);
  assert.deepEqual(ytPlan(1500.4), [{ from: 0, to: 600, cut: 0 }, { from: 592, to: 1200, cut: 600 }, { from: 1192, to: 1501, cut: 1200 }]);
  assert.deepEqual(ytPlan(0), []);
});
test("join at the last three words both windows have: nothing twice, nothing lost, a cut-off word dropped", () => {
  const A = W("قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امـ", 590);
  const B = W("صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته", 592);
  assert.equal(said(ytStitch(A, B, 600)), "قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته");
});
test("the join ignores diacritics and punctuation", () => {
  const A = W("ثم قال: «إنَّما الأعمالُ بالنيّات» وهذا", 595), B = W("إنما الأعمال بالنيات وهذا حديث عظيم", 596);
  assert.equal(said(ytStitch(A, B, 600)), "ثم قال: «إنَّما الأعمالُ بالنيّات» وهذا حديث عظيم");
});
test("no shared run: cut by time at the boundary", () => {
  const A = W("ألف باء جيم دال", 597, 1), B = W("هاء واو زاي حاء", 598, 1);
  assert.equal(said(ytStitch(A, B, 600)), "ألف باء جيم زاي حاء");
  assert.equal(said(ytStitch([], B, 600)), said(B));
  assert.equal(said(ytStitch(A, [], 600)), said(A));
});
test("a phrase repeated earlier in the lecture is not mistaken for the join", () => {
  const A = W("لا إله إلا الله ثم ذكر كلاما طويلا في فضل الذكر ثم قال لا إله إلا الله وحده", 580);
  const B = W("ثم قال لا إله إلا الله وحده لا شريك له", 594);
  assert.equal(said(ytStitch(A, B, 600)), "لا إله إلا الله ثم ذكر كلاما طويلا في فضل الذكر ثم قال لا إله إلا الله وحده لا شريك له");
});
test("the whole path against a stand-in Worker: length first, then each window, joined; errors keep their code", async () => {
  const real = globalThis.fetch, calls = [];
  const reply = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  const words = (text, t0) => text.split(" ").map((w, i) => ({ word: w, start: t0 + i, end: t0 + i + 1 }));
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body); calls.push(b);
    if (b.from == null) return reply({ seconds: 700 });
    return reply(b.from === 0 ? { words: words("واحد اثنان ثلاثة أربعة خمسة", 593), model: "gemini-x", provider: "gemini", approx: true }
                              : { words: words("ثلاثة أربعة خمسة ستة سبعة", 595), model: "gemini-x", provider: "gemini", approx: true });
  };
  try {
    const seen = [];
    const r = await transcribeYoutube("1foxMsRygJg", "ar", { asrUrl: "https://w.example" }, (f, m) => seen.push(m.code));
    assert.deepEqual(calls, [{ video: "1foxMsRygJg" }, { video: "1foxMsRygJg", from: 0, to: 600, language: "ar" }, { video: "1foxMsRygJg", from: 592, to: 700, language: "ar" }]);
    assert.equal(said(r.words), "واحد اثنان ثلاثة أربعة خمسة ستة سبعة");
    assert.ok(r.approx && r.model === "gemini-x" && r.seconds === 700);
    assert.deepEqual(seen, ["yt.length", "yt.part", "yt.part", "asr.done"]);
    globalThis.fetch = async () => reply({ error: "yt_unavailable" }, 404);
    await assert.rejects(transcribeYoutube("1foxMsRygJg", "ar", { asrUrl: "https://w.example" }), e => e instanceof AsrError && e.code === "yt_unavailable");
    await assert.rejects(transcribeYoutube("1foxMsRygJg", "ar", {}), e => e instanceof AsrError && e.code === "disabled");
  } finally { globalThis.fetch = real; }
});
test("a later window that fails after one more try: the part already transcribed is kept and marked partial", async () => {
  const real = globalThis.fetch; let n = 0;
  const reply = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    if (b.from == null) return reply({ seconds: 1500 });
    if (b.from === 0) return reply({ words: [{ word: "كلام", start: 1, end: 2 }, { word: "أول", start: 2, end: 3 }], model: "gemini-x" });
    n++; return reply({ error: "upstream", upstream_status: 503 }, 502);
  };
  try {
    const r = await transcribeYoutube("1foxMsRygJg", "ar", { asrUrl: "https://w.example", ytRetryMs: 0 });
    assert.equal(n, 3, "the failed window is asked twice more");
    assert.equal(said(r.words), "كلام أول");
    assert.equal(r.partial.upTo, 600);
    assert.equal(r.partial.why.code, "upstream");
    // the FIRST window failing is a failure, not an empty partial result
    globalThis.fetch = async (url, init) => (JSON.parse(init.body).from == null ? reply({ seconds: 1500 }) : reply({ error: "upstream" }, 502));
    await assert.rejects(transcribeYoutube("1foxMsRygJg", "ar", { asrUrl: "https://w.example", ytRetryMs: 0 }), e => e.code === "upstream");
  } finally { globalThis.fetch = real; }
});

test("a transcription that stopped half way goes on from its window, without asking for the beginning again", async () => {
  const real = globalThis.fetch; const calls = []; let fail = true;
  const reply = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body); calls.push(b);
    if (b.from == null) return reply({ seconds: 700, title: "T" });
    if (b.from === 0) return reply({ words: [{ word: "واحد", start: 1, end: 2 }, { word: "اثنان", start: 590, end: 591 }], model: "gemini-x" });
    return fail ? reply({ error: "upstream_busy" }, 429) : reply({ words: [{ word: "ثلاثة", start: 601, end: 602 }], model: "gemini-x" });
  };
  try {
    const waits = [];
    const first = await transcribeYoutube("1foxMsRygJg", "ar", { asrUrl: "https://w.example", ytRetryMs: 0 }, (f, m) => { if (m.code === "yt.wait") waits.push(m.args[0]); });
    assert.equal(first.partial.k, 1); assert.equal(first.partial.why.code, "upstream_busy");
    assert.equal(calls.filter(c => c.from === 592).length, 5, "a busy service is waited for four times");
    fail = false; calls.length = 0;
    const r = await transcribeYoutube("1foxMsRygJg", "ar", { asrUrl: "https://w.example", ytRetryMs: 0 }, () => {}, null, first);
    assert.deepEqual(calls, [{ video: "1foxMsRygJg", from: 592, to: 700, language: "ar" }], "only the window that failed is asked for");
    assert.equal(said(r.words), "واحد اثنان ثلاثة"); assert.equal(r.title, "T"); assert.ok(!r.partial);
  } finally { globalThis.fetch = real; }
});

test("the models that were in high demand are named to the next window; a key's quota being spent says whose key it was", async () => {
  const real = globalThis.fetch, calls = [];
  const reply = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...h } });
  const words = (text, t0) => text.split(" ").map((w, i) => ({ word: w, start: t0 + i, end: t0 + i + 1 }));
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body); calls.push(b);
    if (b.from == null) return reply({ seconds: 700 });
    return reply({ words: words(b.from === 0 ? "واحد اثنان ثلاثة أربعة خمسة" : "ثلاثة أربعة خمسة ستة سبعة", b.from === 0 ? 593 : 595), model: "gemini-3.5-flash-lite", provider: "gemini", approx: true,
      ...(b.from === 0 ? { busy: ["3.8-flash", "3.5-flash", "<script>", 7] } : {}) });
  };
  try {
    await transcribeYoutube("1foxMsRygJg", "ar", { asrUrl: "https://w.example" });
    assert.equal(calls[0].after, undefined, "asking the length names nothing");
    assert.equal(calls[1].after, undefined, "the first window has nothing to name");
    assert.deepEqual(calls[2].after, ["3.8-flash", "3.5-flash"], "the second window names the busy models, and only what looks like a model name");
    // the day's allowance spent on every key -> yt_quota at once (no waiting); with the reader's own key the message is about that key
    globalThis.fetch = async (url, init) => (JSON.parse(init.body).from == null ? reply({ seconds: 100 }) : reply({ error: "upstream_busy" }, 429, { "Retry-After": "30000" }));
    await assert.rejects(transcribeYoutube("1foxMsRygJg", "ar", { asrUrl: "https://w.example" }), e => e instanceof AsrError && e.code === "yt_quota" && e.scope === "");
    await assert.rejects(transcribeYoutube("1foxMsRygJg", "ar", { asrUrl: "https://w.example", userKey: "AQ.a-key-of-the-reader-0000000000" }), e => e instanceof AsrError && e.code === "yt_quota" && e.scope === "own");
  } finally { globalThis.fetch = real; }
});

test("a reader's own key is checked with Google when it is saved: accepted, refused, or not known", async () => {
  const real = globalThis.fetch, calls = [];
  const reply = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  const KEY = "AQ.a-key-of-the-reader-0000000000", cfg = { asrUrl: "https://w.example/" };
  try {
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return reply({ ok: true }); };
    assert.equal(await checkOwnKey(cfg, KEY), "ok");
    assert.ok(calls[0].url === "https://w.example/yt" && calls[0].init.headers["X-Athar-Key"] === KEY && calls[0].init.body === '{"probe":true}' && !calls[0].url.includes(KEY), "the key travels in a header to the Worker's /yt, never in the address");
    globalThis.fetch = async () => reply({ error: "user_key_invalid" }, 400); assert.equal(await checkOwnKey(cfg, KEY), "bad");
    globalThis.fetch = async () => reply({ ok: null }); assert.equal(await checkOwnKey(cfg, KEY), "unknown");
    globalThis.fetch = async () => reply({ error: "bad_json" }, 400); assert.equal(await checkOwnKey(cfg, KEY), "unknown", "an older Worker that does not know the question is not taken for a refusal");
    globalThis.fetch = async () => { throw new TypeError("network"); }; assert.equal(await checkOwnKey(cfg, KEY), "unknown");
    assert.equal(await checkOwnKey({}, KEY), "unknown");
  } finally { globalThis.fetch = real; }
});

test("a window whose thin answer no second model could confirm is reported with its place", async () => {
  const real = globalThis.fetch;
  const reply = o => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
  const words = (text, t0) => text.split(" ").map((w, i) => ({ word: w, start: t0 + i, end: t0 + i + 1 }));
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    if (b.from == null) return reply({ seconds: 700 });
    return reply({ words: words(b.from === 0 ? "واحد اثنان ثلاثة أربعة خمسة" : "ثلاثة أربعة خمسة ستة سبعة", b.from === 0 ? 593 : 595), model: "gemini-x", provider: "gemini", approx: true, ...(b.from ? { short: true } : {}) });
  };
  try {
    const r = await transcribeYoutube("1foxMsRygJg", "ar", { asrUrl: "https://w.example" });
    assert.deepEqual(r.thin, [[600, 700]]);
  } finally { globalThis.fetch = real; }
});
