// The cited-transcript document, saved sessions and pasted video transcripts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadCorpus } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";
import { buildCitedDoc, footnoteFor, toSession, fromSession, parseStampedText, youtubeId, citedDocx, sourceWording, sourceRunText, FN_SOURCE_WORDS } from "../public/js/report.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DATA } from "../eval/lib.mjs";
import { HadithDisplay } from "../public/js/display.js";
import { finish, loadDisplayFor, setCorpusForTests, setDisplayForTests } from "../public/js/worker.js";
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
  const body = text({ paragraphs: d.paragraphs.filter(p => !p.style) }).replace(/[﴿﴾«»]/g, "").replace(/\s+/g, " ").trim();
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

// ---------------- the original (diacritised) hadith text in the document ----------------
const HAS_DISPLAY = fs.existsSync(path.join(DATA, "display", "meta.json"));
const noDisplay = HAS_DISPLAY ? false : "no public/data/display/ folder";
const DIACRITIC = /[\u064b-\u0652]/;
/** the ledger as the page has it (worker's finish), with or without the display text */
async function pageLedger(withDisplay) {
  setCorpusForTests(corpus);
  setDisplayForTests(withDisplay ? new HadithDisplay(async (name, kind) => { const b = await readFile(path.join(DATA, name)); return kind === "json" ? JSON.parse(b.toString("utf8")) : b.buffer; }) : null);
  const r = analyze(words, corpus);
  await loadDisplayFor(r.ledger.map(e => e.source));
  return r.ledger.map(e => ({ ...finish(e, words, r.tokenToWord), key: `m:${e.wordStart}-${e.wordEnd}` }));
}

test("footnote of a partial hadith: quotes the source's original words when they are known, the old sentence otherwise", () => {
  const src = { type: "h", ref: "muslim:173", label: "صحيح مسلم 47a", short: "مسلم 47a", collection: "muslim" };
  const e = { status: "partial", source: { ...src, display: "مَنْ كَانَ يُؤْمِنُ بِاللَّهِ وَالْيَوْمِ الآخِرِ فَلْيَقُلْ خَيْرًا أَوْ لِيَصْمُتْ،" }, parallels: [] };
  const fn = footnoteFor(e, null).text;
  assert.ok(fn.includes("بلفظ يختلف عن المنطوق؛ لفظ المصدر: «مَنْ كَانَ يُؤْمِنُ بِاللَّهِ وَالْيَوْمِ الآخِرِ فَلْيَقُلْ خَيْرًا أَوْ لِيَصْمُتْ»."), fn);
  assert.ok(!fn.includes("يُراجَع لفظ المصدر"), "the old sentence is replaced, not repeated");
  assert.ok(fn.endsWith(" *"));
  // no original text: the sentence as it was
  const old = footnoteFor({ ...e, source: src }, null).text;
  assert.ok(old.includes("بلفظ يختلف عن المنطوق في بعض الكلمات؛ يُراجَع لفظ المصدر.") && !old.includes("«"), old);
  // a match made through an English translation has no Arabic matched range
  assert.ok(footnoteFor({ ...e, source: { ...e.source, via: "en" } }, null).text.includes("يُراجَع لفظ المصدر"));
  // verbatim: nothing changes, with or without the text
  assert.equal(footnoteFor({ ...e, status: "verbatim" }, null).text, footnoteFor({ ...e, status: "verbatim", source: src }, null).text);
  // the Qur'an footnote is as before
  const q = { status: "partial", source: { type: "q", ref: "68:4", label: "سورة القلم — الآية 4", display: "وَإِنَّكَ لَعَلَىٰ خُلُقٍ عَظِيمٍ ﴿4﴾" }, parallels: [] };
  assert.ok(footnoteFor(q, null).text.includes("ونص الآية: وَإِنَّكَ"));
  // a long range is cut at FN_SOURCE_WORDS words with an ellipsis
  const long = Array.from({ length: 75 }, (_, i) => "كَلِمَةٌ" + i).join(" ");
  const cut = sourceWording(long);
  assert.equal(cut.split(" ").length, FN_SOURCE_WORDS + 1);
  assert.ok(cut.endsWith(" …") && cut.startsWith("كَلِمَةٌ0 ") && cut.includes("كَلِمَةٌ59") && !cut.includes("كَلِمَةٌ60"));
  assert.ok(footnoteFor({ ...e, source: { ...src, display: long } }, null).text.includes("كَلِمَةٌ59 …»."));
  assert.equal(sourceWording('" إِنَّمَا الأَعْمَالُ " .'), "إِنَّمَا الأَعْمَالُ", "quotation marks and punctuation at the edges are left out");
  assert.equal(sourceWording(""), ""); assert.equal(sourceWording(undefined), ""); assert.equal(sourceWording(' " . '), "");
  setLangForTests("en");
  assert.ok(footnoteFor(e, null).text.includes("the source reads: «مَنْ كَانَ يُؤْمِنُ"));
  assert.ok(footnoteFor({ ...e, source: src }, null).text.includes("check the source text."));
  setLangForTests("ar");
});

test("option: a verbatim hadith is written with the source's original words only when every word is tied one to one", () => {
  const d = (kind, spoken, sourceDisplay) => ({ kind, spoken, source: spoken, spokenDisplay: spoken, sourceDisplay });
  const ws = "قال النبي تبسمك في وجه أخيك لك صدقة. ثم مضى".split(" ").map(w => ({ w }));
  const diff = [d("exact", "تبسمك", "تَبَسُّمُكَ"), d("exact", "في", "فِي"), d("exact", "وجه", "وَجْهِ"), d("exact", "أخيك", "أَخِيكَ"), d("exact", "لك", "لَكَ"), d("exact", "صدقة.", "صَدَقَةٌ")];
  const e = { key: "m:2-7", status: "verbatim", wordStart: 2, wordEnd: 7, diff, diffDisplay: true, sourceRun: '" تَبَسُّمُكَ فِي وَجْهِ أَخِيكَ لَكَ صَدَقَةٌ ،', parallels: [],
    source: { type: "h", ref: "tirmidhi:1956", label: "جامع الترمذي 1956", collection: "tirmidhi" } };
  const body = x => x.paragraphs.filter(p => !p.style).map(p => p.runs.map(r => r.text || "").join("")).join(" ");
  const off = buildCitedDoc({ words: ws, ledger: [e], summary: false });
  assert.ok(body(off).includes("«تبسمك في وجه أخيك لك صدقة». ثم مضى"), body(off));
  assert.equal(off.counts.hadithText, 0);
  const on = buildCitedDoc({ words: ws, ledger: [e], summary: false, hadithText: true });
  assert.ok(body(on).includes("قال النبي «تَبَسُّمُكَ فِي وَجْهِ أَخِيكَ لَكَ صَدَقَةٌ». ثم مضى"), body(on));      // the transcript's full stop stays after the quotation
  assert.equal(on.counts.hadithText, 1);
  assert.ok(on.paragraphs.at(-1).runs[0].text.includes("بلفظ المصدر المشكول") && !off.paragraphs.at(-1).runs[0].text.includes("بلفظ المصدر المشكول"));
  assert.equal(on.footnotes[0].runs[0].text, off.footnotes[0].runs[0].text, "the footnote of a verbatim match does not change");
  // the Mushaf option alone does not touch a hadith
  assert.ok(body(buildCitedDoc({ words: ws, ledger: [e], summary: false, mushaf: true })).includes("«تبسمك في وجه"));
  const said = ws.slice(2, 8).map(w => w.w);
  assert.equal(sourceRunText(e, said), "تَبَسُّمُكَ فِي وَجْهِ أَخِيكَ لَكَ صَدَقَةٌ");
  // never: a partial match, no run from the worker, words in the document that are not the compared words, an English match, a verse
  assert.equal(sourceRunText({ ...e, status: "partial" }, said), null);
  assert.equal(sourceRunText({ ...e, sourceRun: undefined }, said), null);
  assert.equal(sourceRunText(e, [...said.slice(0, 5), "صدقةٌ"]), null);
  assert.equal(sourceRunText(e, said.slice(1)), null);
  assert.equal(sourceRunText({ ...e, source: { ...e.source, via: "en" } }, said), null);
  assert.equal(sourceRunText({ ...e, source: { ...e.source, type: "q" } }, said), null);
  const partial = buildCitedDoc({ words: ws, ledger: [{ ...e, status: "partial" }], summary: false, hadithText: true });
  assert.ok(body(partial).includes("«تبسمك في وجه أخيك لك صدقة»") && partial.counts.hadithText === 0, "a partial match stays as transcribed");
  // a word the reviewer corrected after the analysis: the document's words are no longer the compared words -> left alone
  const fixed = ws.map((w, i) => (i === 3 ? { w: "فى" } : w));
  assert.ok(body(buildCitedDoc({ words: fixed, ledger: [e], summary: false, hadithText: true })).includes("«تبسمك فى وجه"));
});

test("sample document with the display text: the partial hadith's footnote quotes the source; the option rewrites only verbatim hadith", { skip: noDisplay }, async () => {
  const page = await pageLedger(true);
  const partial = page.find(e => e.status === "partial" && e.source.type === "h");
  const off = buildCitedDoc({ words, ledger: page, title: "محاضرة", mushaf: true });
  const fn = off.footnotes.map(f => f.runs[0].text).find(x => x.includes("لفظ المصدر: «"));
  assert.ok(fn && fn.includes(partial.source.display.split(" ").slice(0, 6).join(" ")) && DIACRITIC.test(fn), fn);
  assert.ok(!off.footnotes.some(f => f.runs[0].text.includes("يُراجَع لفظ المصدر")));
  const quotes = x => x.paragraphs.flatMap(p => p.runs).filter(r => r.quote && r.text.startsWith("«")).map(r => r.text);
  assert.ok(quotes(off).every(q => !DIACRITIC.test(q)), "off: every hadith quotation is as transcribed");
  const on = buildCitedDoc({ words, ledger: page, title: "محاضرة", mushaf: true, hadithText: true });
  const verbatim = page.filter(e => e.status === "verbatim" && e.source.type === "h");
  assert.ok(verbatim.length >= 2 && on.counts.hadithText === verbatim.filter(e => e.sourceRun).length && on.counts.hadithText >= 1);
  const written = quotes(on).filter(q => DIACRITIC.test(q));
  assert.equal(written.length, on.counts.hadithText);
  for (const q of written) assert.ok(verbatim.some(e => e.sourceRun && e.sourceRun.includes(q.slice(1, -1))), q);
  assert.ok(!written.some(q => q.includes(partial.source.display.split(" ")[6])), "the partial hadith is not rewritten");
  assert.deepEqual(on.footnotes, off.footnotes, "the option does not change any footnote");
  assert.equal(on.counts.mushaf, off.counts.mushaf);
  // without the display text the document is what it was before the display data existed
  const plain = await pageLedger(false);
  const before = buildCitedDoc({ words, ledger: plain, title: "محاضرة", mushaf: true, hadithText: true });
  assert.equal(before.counts.hadithText, 0);
  assert.ok(before.footnotes.some(f => f.runs[0].text.includes("يُراجَع لفظ المصدر")) && !before.footnotes.some(f => f.runs[0].text.includes("لفظ المصدر: «")));
  assert.ok(citedDocx({ words, ledger: page, title: "محاضرة", hadithText: true }).bytes.length > 2000);
});
