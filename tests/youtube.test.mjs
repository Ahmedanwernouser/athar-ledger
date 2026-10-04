// A YouTube video from its link: the windows that are asked for, and how two neighbouring windows are joined.
import test from "node:test";
import assert from "node:assert/strict";
import { ytPlan, ytStitch, transcribeYoutube, AsrError } from "../public/js/asr.js";

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
    assert.equal(n, 2, "the failed window is asked once more");
    assert.equal(said(r.words), "كلام أول");
    assert.equal(r.partial.upTo, 600);
    assert.equal(r.partial.why.code, "upstream");
    // the FIRST window failing is a failure, not an empty partial result
    globalThis.fetch = async (url, init) => (JSON.parse(init.body).from == null ? reply({ seconds: 1500 }) : reply({ error: "upstream" }, 502));
    await assert.rejects(transcribeYoutube("1foxMsRygJg", "ar", { asrUrl: "https://w.example", ytRetryMs: 0 }), e => e.code === "upstream");
  } finally { globalThis.fetch = real; }
});
