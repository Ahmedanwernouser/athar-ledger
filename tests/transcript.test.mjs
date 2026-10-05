// The whole transcript, to read or to keep: paragraphs, plain text, subtitles.
import test from "node:test";
import assert from "node:assert/strict";
import { transcriptParagraphs, transcriptText, transcriptSrt } from "../public/js/report.js";

const W = (text, t0 = 0, step = 0.5) => text.split(" ").map((w, i) => ({ w, start: t0 + i * step, end: t0 + i * step + 0.4 }));
const many = (n, word = "كلمة") => Array.from({ length: n }, (_, i) => `${word}${i}`).join(" ");

test("paragraphs: every word once and in order; cut at a sentence end, at a pause, where a clause ends, or at 150 words", () => {
  const a = W(many(45) + ". " + many(50));
  const ps = transcriptParagraphs(a);
  assert.deepEqual(ps.flatMap(p => [p.from, p.to]).filter((x, i, arr) => i === 0 || i === arr.length - 1), [0, a.length]);
  for (let i = 1; i < ps.length; i++) assert.equal(ps[i].from, ps[i - 1].to);
  assert.equal(ps[0].to, 45, "the sentence end after 45 words closes the first paragraph");
  assert.equal(transcriptParagraphs(W(many(400))).every(p => p.to - p.from <= 150), true);
  // no punctuation (a model's transcript): a long paragraph closes before a word that opens a clause, not in mid-sentence
  const c = [...many(70).split(" "), "ثم", ...many(30).split(" ")].map(w => ({ w }));
  assert.equal(transcriptParagraphs(c)[0].to, 70, "closed before «ثم»");
  const b = [...W(many(15)), ...W(many(15), 60)];                    // a long silence between two stretches
  assert.equal(transcriptParagraphs(b)[0].to, 15);
  assert.deepEqual(transcriptParagraphs([]), []);
});
test("plain text: all the words, a paragraph a line; with times each paragraph says when it begins", () => {
  const a = [...W(many(15)), ...W(many(15, "لفظ"), 125)];
  const plain = transcriptText(a), timed = transcriptText(a, { timed: true });
  assert.equal(plain.replace(/\s+/g, " ").trim(), a.map(w => w.w).join(" "));
  assert.ok(timed.startsWith("[0:00] كلمة0") && timed.includes("\n\n[2:05] لفظ0"));
  assert.equal(transcriptText([{ w: "بلا" }, { w: "أزمنة" }], { timed: true }), "بلا أزمنة\n");      // no times: no brackets
  assert.equal(transcriptText([]), "");
});
test("subtitles: numbered cues, valid times, no cue longer than 10 words, none running into the next; nothing without times", () => {
  const a = W("قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات. وإنما لكل امرئ ما نوى فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله", 3);
  const srt = transcriptSrt(a), cues = srt.trim().split("\n\n").map(c => c.split("\n"));
  assert.equal(cues.map(c => c[2]).join(" "), a.map(w => w.w).join(" "), "every word, once");
  cues.forEach((c, k) => { assert.equal(c[0], String(k + 1)); assert.match(c[1], /^\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}$/); assert.ok(c[2].split(" ").length <= 10); });
  const sec = x => { const [h, m, s] = x.replace(",", ".").split(":").map(Number); return h * 3600 + m * 60 + s; };
  const times = cues.map(c => c[1].split(" --> ").map(sec));
  assert.ok(times.every(([s, e], k) => e > s && (k === 0 || s >= times[k - 1][1] - 1e-9)));
  assert.equal(times[0][0], 3);
  assert.ok(cues[0][2].endsWith("بالنيات."), "a sentence end closes a cue");
  assert.equal(transcriptSrt([{ w: "بلا" }, { w: "أزمنة" }]), "");
});
