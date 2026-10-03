// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadCorpus, DATA } from "../eval/lib.mjs";
import { norm, fold, fnv1a, wordSim, wordsFromText, stem } from "../public/js/text.js";
import { align } from "../public/js/align.js";
import { analyze } from "../public/js/engine.js";
import { findCues } from "../public/js/cues.js";

const corpus = await loadCorpus();
const run = (text, opts) => analyze(wordsFromText(text), corpus, opts).ledger;
const FILL = "ثم اعلموا رحمكم الله أن هذا الأمر عظيم وأن الناس في زماننا كثيرا ما يغفلون عنه";

test("JS normalisation + hashing match the Python builder", () => {
  for (const v of JSON.parse(readFileSync(path.join(DATA, "hash_vectors.json"), "utf8"))) {
    assert.equal(fold(norm(v.in)), v.norm_fold);
    assert.equal(fnv1a(fold(norm(v.in))), v.fnv1a);
  }
});

test("word similarity classes", () => {
  assert.equal(wordSim("الصلاه", "الصلاه"), "exact");
  assert.equal(wordSim("السلاه", "الصلاه"), "asr");      // ص/س
  assert.equal(wordSim("الصلا", "الصلاه"), "near");
  assert.equal(wordSim("من", "عن"), "diff");
  assert.equal(wordSim("الزكاه", "الصلاه"), "diff");
  assert.equal(stem(fold("الغضب")), stem(fold("يغضب")));
});

test("alignment handles split and glued words", () => {
  const w = () => 1;
  const T = "قال انما الاع مال بالنيات وانما لكلامرئ ما نوي".split(" "), P = "انما الاعمال بالنيات وانما لكل امرئ ما نوي".split(" ");
  const al = align(T, T.map(fold), P, P.map(fold), w);
  assert.ok(al.ops.some(o => o.op === "joinT") && al.ops.some(o => o.op === "joinP"));
  assert.equal(al.ops.filter(o => o.op === "diff").length, 0);
});

test("verbatim hadith with cue -> حرفي, parallel sources listed, attribution confirmed", () => {
  const L = run(`${FILL} قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى دنيا يصيبها أو إلى امرأة ينكحها فهجرته إلى ما هاجر إليه رواه البخاري ${FILL}`);
  const e = L.find(x => x.status === "verbatim");
  assert.ok(e, "found");
  assert.equal(e.type, "h");
  assert.ok([e.source, ...e.parallels].some(s => s.ref === "bukhari:1"));
  assert.ok(e.attribution && e.attribution.agrees);
  assert.ok(!norm(e.spoken).includes("رسول"), "the cue is not part of the quotation");
});

test("ASR-style errors are tolerated and labelled", () => {
  const L = run(`${FILL} قال رصول الله صلى الله عليه وسلم انما الاعمال بالنيات وانما لكل امرا ما نوا فمن كانت هجرته الى دنيا يسيبها او الى امراة ينكهها فهجرته الى ما هاجر اليه ${FILL}`);
  const e = L.find(x => x.type === "h" && x.source);
  assert.ok(e && (e.status === "verbatim" || e.status === "partial"));
  assert.ok(e.counts.asr + e.counts.near >= 2);
});

test("multi-ayah recitation is reported as an ayah range", () => {
  const L = run(`${FILL} قال الله تعالى قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد ${FILL}`);
  const e = L.find(x => x.type === "q" && x.status === "verbatim");
  assert.ok(e, "found");
  assert.equal(e.source.surah, 112);
  assert.equal(e.source.ayah, 1); assert.equal(e.source.ayahEnd, 4);
});

test("wrong spoken surah is flagged neutrally", () => {
  const L = run(`${FILL} قال الله تعالى في سورة البقرة قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد ${FILL}`);
  const e = L.find(x => x.type === "q" && x.status === "verbatim");
  assert.ok(e && e.attribution && e.attribution.agrees === false);
});

test("a cue with no quotation -> 'not found', never a match", () => {
  const L = run(`${FILL} قال رسول الله صلى الله عليه وسلم كلاما عظيما في هذا الباب سنذكره بعد قليل ${FILL}`);
  assert.ok(L.length >= 1 && L.every(x => x.status === "notfound"));
});

test("devotional formulas and plain speech produce no citation", () => {
  const L = run(`${FILL} نحمد الله تعالى ونصلي ونسلم على رسول الله صلى الله عليه وسلم وعلى آله وصحبه أجمعين ${FILL} بسم الله الرحمن الرحيم والحمد لله رب العالمين`);
  assert.equal(L.filter(x => x.status === "verbatim" || x.status === "partial").length, 0);
});

test("invented 'hadith' is not matched", () => {
  const L = run(`${FILL} قال رسول الله صلى الله عليه وسلم من أكل التفاح في يوم الثلاثاء دخل الجنة بغير حساب ولا عقاب وكتب له أجر سبعين شهيدا ${FILL}`);
  assert.equal(L.filter(x => x.status === "verbatim" || x.status === "partial").length, 0);
  assert.ok(L.some(x => x.status === "notfound" || x.status === "meaning"));
});

test("partial quotation -> مخلوط with visible differences", () => {
  const L = run(`${FILL} قال النبي صلى الله عليه وسلم من كان يؤمن بالله واليوم الآخر فليقل كلاما طيبا أو ليسكت ومن كان يؤمن بالله واليوم الآخر فليكرم جاره ${FILL}`);
  const e = L.find(x => x.type === "h" && x.source);
  assert.ok(e && ["partial", "verbatim"].includes(e.status));
  assert.ok(e.diff.some(d => d.kind !== "exact"));
});

test("cues merge and never overlap", () => {
  const f = wordsFromText("وفي الحديث الصحيح عن النبي صلى الله عليه وسلم أنه قال الله أكبر").map(w => fold(norm(w.w)));
  const c = findCues(f);
  assert.equal(c.length, 1); assert.equal(c[0].kind, "hadith");
});

test("deterministic: same input -> identical ledger", () => {
  const t = `${FILL} قال الله تعالى إن الله يأمر بالعدل والإحسان وإيتاء ذي القربى ${FILL}`;
  assert.deepEqual(run(t), run(t));
});

test("Whisper-style output: punctuation, tashkeel, ﷺ, word objects with leading spaces", () => {
  const raw = `${FILL}. وقالَ رسولُ اللهِ ﷺ: «إنَّما الأعمالُ بالنيّاتِ، وإنَّما لكلِّ امرئٍ ما نوى». ${FILL}، ثم قال الله تعالى: ﴿قُلْ هُوَ اللَّهُ أَحَدٌ * اللَّهُ الصَّمَدُ﴾ صدق الله العظيم.`;
  const words = raw.split(/\s+/).map((w, i) => ({ word: " " + w, w: " " + w, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const L = analyze(words, corpus).ledger;
  const h = L.find(x => x.type === "h" && x.status === "verbatim"), q = L.find(x => x.type === "q" && x.status === "verbatim");
  assert.ok(h && [h.source, ...h.parallels].some(s => s.ref === "bukhari:1"));
  assert.ok(q && q.source.surah === 112 && q.source.ayah === 1 && q.source.ayahEnd === 2);
  assert.ok(h.start > 0 && q.start > h.start, "timestamps carried through");
});

test("an unmatched quotation stops at the sentence end when the transcript has punctuation", () => {
  const L = run(`${FILL}. قال رسول الله صلى الله عليه وسلم: اطلبوا العلم ولو في الصين. ${FILL} ${FILL}`);
  const e = L.find(x => x.status === "notfound");
  assert.ok(e && /الصين\.?$/.test(e.spoken.trim()), e && e.spoken);
});

test("hadith links use sunnah.com book/in-book numbering and the printed number", () => {
  const pid = corpus.P.findIndex(p => p.r === "muslim:6643"), d = corpus.describe(pid);
  assert.equal(d.url, "https://sunnah.com/muslim/45/140");
  assert.equal(d.number, "2609a");      // sunnah.com writes the dataset's "2609.01" as 2609a (review: Muslim labels must keep the sub-number)
  assert.equal(d.linkLevel, "hadith");
});
