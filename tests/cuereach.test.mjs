// How far a cue reaches. A cue lowers the bar for the text it announces — and for nothing else:
//   · one cue announces one quotation: a second, different text within its reach must stand on its own;
//   · a text that begins after several content words that belong to no text needs as many content words as plain speech;
//   · an open particle at the very end of a match ("... أن") is not one of the words that make a short match a quotation;
//   · a cue known only by its form ("قال <a name> رضي الله عنه") announces, but its words stay in the comparison.
import test from "node:test";
import assert from "node:assert/strict";
import { findCues } from "../public/js/cues.js";
import { fold, normMixed } from "../public/js/text.js";
import { loadCorpusWith } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";

const F = t => t.split(/\s+/).map(w => fold(normMixed(w))).filter(Boolean);
const corpus = await loadCorpusWith(["tafsir"]);
const run = (t, o = {}) => analyze(t.split(/\s+/).map(w => ({ w })), corpus, o).ledger;
const textual = l => l.filter(e => e.status === "verbatim" || e.status === "partial").map(e => e.spoken);
const TAIL = "ثم مضى الشيخ في شرح هذه المسألة";

test("a listed cue is masked out of the comparison; a cue known by its form is not", () => {
  const listed = findCues(F("قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات"))[0];
  assert.deepEqual(listed.mask, [[listed.pos, listed.end]]);
  const form = findCues(F("ثم قال حذيفة بن اليمان رضي الله عنه كلاما عظيما"))[0];
  assert.equal(form.form, true); assert.deepEqual(form.mask, []);
  // a form cue that touches a listed one is merged with it: only the listed words are masked
  const both = findCues(F("عن النعمان بن بشير رضي الله عنهما قال قال رسول الله صلى الله عليه وسلم الحلال بين"));
  assert.equal(both.length, 1); assert.equal(both[0].kind, "hadith");
  assert.ok(both[0].mask.length >= 1 && both[0].mask.every(([a]) => a >= 7), "the narrator's name is not masked");
  assert.deepEqual(findCues(F("ثم قال حذيفة بن اليمان رضي الله عنه كلاما عظيما"), { form: false }), []);
  // the listed phrase says what follows: a companion named, then "قال رسول الله ﷺ", announces a hadith — and the listed cue is not lost
  const two = findCues(F("قال ابن عمر رضي الله عنهما قال رسول الله صلى الله عليه وسلم بني الإسلام على خمس"));
  assert.equal(two.length, 1); assert.equal(two[0].kind, "hadith"); assert.equal(two[0].end, 13); assert.ok(!two[0].athar && !two[0].form);
});

test("one cue announces one quotation: a second short text right after the first must stand on its own", () => {
  const t = `قال رسول الله صلى الله عليه وسلم إن الله جميل يحب الجمال المرء مع من أحب يوم ${TAIL}`;
  assert.deepEqual(textual(run(t)), ["إن الله جميل يحب الجمال"]);
  assert.deepEqual(textual(run(t, { oneCueOneQuote: false })), ["إن الله جميل يحب الجمال", "المرء مع من أحب يوم"], "without the rule the cue is spent twice");
  // announced by its own cue, the second text is found
  assert.deepEqual(textual(run(`قال رسول الله صلى الله عليه وسلم إن الله جميل يحب الجمال وقال صلى الله عليه وسلم المرء مع من أحب يوم ${TAIL}`)),
    ["إن الله جميل يحب الجمال", "المرء مع من أحب يوم"]);
});
test("... and the same text going on after an aside is still one quotation", () => {
  const l = textual(run(`قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات يعني وإنما لكل امرئ ما نوى فمن كانت هجرته إلى الله ورسوله ${TAIL}`));
  assert.equal(l.length, 1); assert.match(l[0], /^إنما الأعمال بالنيات.*ورسوله$/);
});

test("words of the speaker after a cue are not a quotation of a book that happens to share a connective phrase", () => {
  // the cue announced words that are in no loaded text; the phrase after them is in Tafsir Ibn Kathir, as it is in any lecture
  const far = "وأقبل على القرآن قال المؤلف رحمه الله ولانتشاره في الصحابة رضي الله عنهم والمقصود من هذا كله أن نعود إلى الأصل وأن نتمسك به";
  assert.deepEqual(textual(run(far)), []);
  // right after the cue: five matched words, the last of them an open particle whose clause is not in the source
  const near = "وأقبل على القرآن قال المؤلف رحمه الله والمقصود من هذا كله أن نعود إلى الأصل وأن نتمسك به";
  assert.deepEqual(textual(run(near)), []);
  assert.deepEqual(textual(run(near, { openTail: false })), ["والمقصود من هذا كله أن"], "without the rule the phrase is cited");
  // both are still reported as an announced text that was not found — never silently dropped
  assert.ok(run(far).some(e => e.status === "notfound" || e.status === "meaning"));
});

test("a short text right after its cue is still found, with an aside in between too", () => {
  assert.deepEqual(textual(run(`قال رسول الله صلى الله عليه وسلم يعني في هذا من حسن إسلام المرء تركه ما لا يعنيه ${TAIL}`)), ["من حسن إسلام المرء تركه ما لا يعنيه"]);
  assert.deepEqual(textual(run(`قال رسول الله صلى الله عليه وسلم المرء مع من أحب يوم ${TAIL}`)), ["المرء مع من أحب يوم"]);
});
