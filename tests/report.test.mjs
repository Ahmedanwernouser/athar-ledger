// The cited-transcript document, saved sessions and pasted video transcripts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadCorpus } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";
import { buildCitedDoc, footnoteFor, toSession, fromSession, parseStampedText, youtubeId, citedDocx } from "../public/js/report.js";
import { zipStore } from "../public/js/docx.js";
import { setLangForTests } from "../public/js/i18n.js";

setLangForTests("ar");
const corpus = await loadCorpus();
const sample = JSON.parse(fs.readFileSync(new URL("../public/samples/demo-clean.json", import.meta.url), "utf8"));
const words = sample.words;
const ledger = analyze(words, corpus).ledger.map(e => ({ ...e, key: `m:${e.wordStart}-${e.wordEnd}` }));
const text = d => d.paragraphs.map(p => p.runs.map(r => r.text || "").join("")).join("\n");

test("cited document: every textual citation is quoted and footnoted with its source; the words are untouched", () => {
  const d = buildCitedDoc({ words, ledger, title: "محاضرة", date: "٣ أكتوبر" });
  const textual = ledger.filter(e => ["verbatim", "partial"].includes(e.status));
  assert.ok(textual.length >= 5);
  const quoted = d.paragraphs.flatMap(p => p.runs).filter(r => r.quote);
  assert.equal(quoted.length, textual.length);
  for (const r of quoted) assert.ok(/^[﴿«]/.test(r.text) && /[﴾»]$/.test(r.text), r.text);
  assert.ok(d.footnotes.some(f => f.runs[0].text.includes("صحيح البخاري")));
  assert.ok(d.footnotes.some(f => f.runs[0].text.includes("سورة")));
  // nothing of the transcript is lost or reordered
  const body = text({ paragraphs: d.paragraphs.slice(2, -1) }).replace(/[﴿﴾«»]/g, "").replace(/\s+/g, " ").trim();
  assert.equal(body, words.map(w => w.w).join(" ").replace(/\s+/g, " ").trim());
  // every footnote index is used exactly once, in order
  const refs = d.paragraphs.flatMap(p => p.runs).filter(r => r.note != null).map(r => r.note);
  assert.deepEqual(refs, d.footnotes.map((_, i) => i));
});

test("cited document: a human verdict changes the footnote — confirmed has no star, rejected has no footnote", () => {
  const e = ledger.find(x => x.status === "verbatim" && x.source.type === "h");
  assert.ok(footnoteFor(e, null).text.endsWith("*"));
  assert.ok(!footnoteFor(e, "yes").text.includes("*"));
  assert.equal(footnoteFor(e, "no"), null);
  assert.ok(footnoteFor(e, "unsure").text.includes("يحتاج نظرًا"));
  const all = buildCitedDoc({ words, ledger }), without = buildCitedDoc({ words, ledger, reviews: { [e.key]: { v: "no" } } });
  assert.equal(without.footnotes.length, all.footnotes.length - 1);
  const yes = buildCitedDoc({ words, ledger, reviews: { [e.key]: { v: "yes" } } });
  assert.equal(yes.counts.confirmed, 1);
});

test("cited document: an announced quotation that is not in the corpus is footnoted as needing manual sourcing, never given a source", () => {
  const nf = ledger.filter(e => e.status === "notfound" && ["quran", "hadith"].includes(e.cue));
  assert.ok(nf.length >= 1);
  for (const e of nf) { const f = footnoteFor(e, null); assert.ok(f.text.includes("لم يُعثر")); assert.equal(f.quote, false); }
});

test("docx: the file is a readable zip with the document, the footnotes and matching footnote ids", () => {
  const { bytes } = citedDocx({ words, ledger, title: "اختبار <&>", date: "x" });
  assert.equal(String.fromCharCode(...bytes.slice(0, 2)), "PK");
  const s = new TextDecoder().decode(bytes);      // stored (uncompressed), so the XML is readable in place
  for (const part of ["[Content_Types].xml", "word/document.xml", "word/footnotes.xml", "word/styles.xml"]) assert.ok(s.includes(part), part);
  const refs = [...s.matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g)].map(m => +m[1]);
  const defs = [...s.matchAll(/<w:footnote w:id="(\d+)">/g)].map(m => +m[1]);
  assert.ok(refs.length > 0); assert.deepEqual(refs, defs);
  assert.ok(s.includes("اختبار &lt;&amp;&gt;"));
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s.slice(s.indexOf("<w:body>"), s.indexOf("</w:body>"))));
  const z = zipStore([["a.txt", "hello"]]); assert.equal(z.length, 30 + 5 + 5 + 46 + 5 + 22);
});

test("saved session: words, times and verdicts survive a round trip; anything else is refused or cleaned", () => {
  const review = { "m:1-2": { v: "yes", note: "ok", sig: "verbatim|bukhari:1" }, bad: { v: "maybe", note: 5 } };
  const j = JSON.parse(toSession({ words: [{ w: "قال", start: 1.234, end: 1.5 }, { w: "الله" }], title: "T", review, packs: ["tafsir", 3], video: "https://youtu.be/abcdefghijk" }));
  const s = fromSession(j);
  assert.deepEqual(s.words, [{ w: "قال", start: 1.23, end: 1.5 }, { w: "الله" }]);
  assert.equal(s.title, "T"); assert.deepEqual(s.packs, ["tafsir"]);
  assert.deepEqual(s.review["m:1-2"], { v: "yes", note: "ok", sig: "verbatim|bukhari:1" });
  assert.deepEqual(s.review.bad, { v: null, note: "", sig: "" });
  assert.equal(fromSession({ words: [] }), null); assert.equal(fromSession(null), null); assert.equal(fromSession({ athar_session: 2, words: [] }), null);
});

test("pasted video transcript: timestamps on their own lines or leading a line become word times; ordinary text is left alone", () => {
  const w = parseStampedText("0:00\nبسم الله الرحمن الرحيم\n0:04\nالحمد لله رب العالمين\n4 seconds\n1:02:03\nقال رسول الله");
  assert.equal(w.length, 11); assert.equal(w[0].start, 0); assert.equal(w[4].start, 4); assert.equal(w[8].start, 3723);
  assert.ok(w[3].end <= 4 + 1e-9);
  const lead = parseStampedText("0:00 one two\n0:05 three four\n0:09 five six");
  assert.equal(lead.length, 6); assert.equal(lead[2].start, 5);
  assert.equal(parseStampedText("الساعة 3:15 كانت الخطبة ثم قال الله تعالى"), null);
  assert.equal(parseStampedText("0:10\nكلمة\n0:05\nكلمة\n0:01\nكلمة"), null);      // not increasing: not a transcript
});

test("video link: common YouTube forms give the id; anything else gives null", () => {
  for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?t=42", "youtube.com/watch?feature=x&v=dQw4w9WgXcQ&t=1s", "https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/live/dQw4w9WgXcQ?si=abc", "https://www.youtube.com/embed/dQw4w9WgXcQ"])
    assert.equal(youtubeId(u), "dQw4w9WgXcQ", u);
  for (const u of ["", "https://example.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/short", "javascript:alert(1)", "https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ"]) assert.equal(youtubeId(u), null, u);
});
