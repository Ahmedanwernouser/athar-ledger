// Books of weak / fabricated hadith: searched in parallel, answered separately from the ordinary books.
import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpus, loadCorpusWith } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";
const plain = await loadCorpus(), withWeak = await loadCorpusWith(["daif"]);
const run = (t, c = withWeak) => analyze(t.split(/\s+/).map((w, i) => ({ w, start: i * 0.5, end: i * 0.5 + 0.4 })), c).ledger;
const CUE = "قال رسول الله صلى الله عليه وسلم ";

test("a hadith only in a book of fabricated hadith: not in the ordinary books, found in the weak book, with its own words", () => {
  const l = run(CUE + "القرآن كلام الله لا خالق ولا مخلوق من قال غير ذلك فهو كافر");
  const e = l.find(x => x.weakOnly);
  assert.ok(e, "found as weak-only");
  assert.equal(e.inNormalBooks, false);
  assert.equal(e.type, "h");
  assert.ok(e.weakBooks.length >= 1 && e.weakBooks.every(w => w.weak));
  assert.ok(e.weakBooks.some(w => /موضوع/.test(w.bookWords)), "the book's own verdict wording is carried");
  assert.equal(run(CUE + "القرآن كلام الله لا خالق ولا مخلوق من قال غير ذلك فهو كافر", plain).some(x => x.weakOnly), false, "without the pack nothing changes");
});
test("a hadith in the ordinary books AND in a weak-hadith book: both answers, ordinary source stays the source", () => {
  const l = run("الإيمان عقد بالقلب وإقرار باللسان وعمل بالأركان");
  const e = l.find(x => x.weakBooks && x.weakBooks.length);
  assert.ok(e && e.inNormalBooks && !e.weakOnly);
  assert.ok(e.source && !e.source.weak && e.source.type === "h");
  assert.ok(e.weakBooks.some(w => /كشف الخفاء|المقاصد/.test(w.book)));
});
test("a sound hadith is not labelled by a book that merely quotes it", () => {
  const l = run(CUE + "من سلك طريقا يلتمس فيه علما سهل الله له به طريقا إلى الجنة");
  const e = l.find(x => x.status === "verbatim");
  assert.ok(e && e.inNormalBooks && !e.weakOnly);
  assert.equal(e.weakBooks.length, 0);
});
test("nothing found anywhere: neither answer is invented", () => {
  const l = run(CUE + "اذهبوا الى السوق فان التجارة تسعة اعشار الرزق وزرقاء الخبز تحت المنضدة الخضراء");
  assert.equal(l.filter(x => x.weakOnly || (x.weakBooks || []).length).length, 0);
});
test("the ordinary results are the same with and without the weak pack (the pack only adds)", () => {
  for (const t of [CUE + "من سلك طريقا يلتمس فيه علما سهل الله له به طريقا إلى الجنة", "الإيمان عقد بالقلب وإقرار باللسان وعمل بالأركان", CUE + "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى"]) {
    const a = run(t, plain).map(e => [e.status, e.source && e.source.ref]), b = run(t).filter(e => !e.weakOnly).map(e => [e.status, e.source && e.source.ref]);
    assert.deepEqual(b, a, t);
  }
});
