// A cue followed by the speaker's own explanation announces no quotation; the blessing on the Prophet is skipped in any spelling.
import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";
import { findCues, blessingLength } from "../public/js/cues.js";
import { fold, norm } from "../public/js/text.js";
const corpus = await loadCorpus();
const run = t => analyze(t.split(/\s+/).map((w, i) => ({ w, start: i * 0.5, end: i * 0.5 + 0.4 })), corpus).ledger;
const F = t => t.split(/\s+/).map(w => fold(norm(w)));
const H = "من سلك طريقا يلتمس فيه علما سهل الله له به طريقا إلى الجنة";

test("blessing: every spelling is one run, and nothing else is", () => {
  for (const b of ["صلى الله عليه وسلم", "صلى الله عليه وعلى آله وسلم", "صلى الله عليه وعلى آله وصحبه وسلم تسليما كثيرا", "صلى الله عليه وآله وسلم"])
    assert.equal(blessingLength(F(b + " ثم"), 0), F(b).length, b);
  assert.equal(blessingLength(F("صلى الله على محمد"), 0), 0, "no 'وسلم': not a blessing run");
  assert.equal(blessingLength(F("قال الله"), 0), 0);
});
test("cue + blessing + explanation: no 'announced but not found' and no suggestions from the blessing words", () => {
  for (const b of ["صلى الله عليه وسلم", "صلى الله عليه وعلى آله وسلم", "صلى الله عليه وعلى آله وصحبه وسلم"]) {
    const l = run(`ثم قال رحمه الله عن النبي ${b} أما الثاني فهو الطريق المعنوي وهو أن يلتمس فيه علما`);
    assert.deepEqual(l.filter(e => e.status === "notfound" || (e.candidates || []).length), [], b);
  }
});
test("cue + blessing + a real hadith is still found", () => {
  for (const b of ["صلى الله عليه وسلم", "صلى الله عليه وعلى آله وسلم"]) {
    const l = run(`عن النبي ${b} ${H}`);
    const e = l.find(x => x.status === "verbatim");
    assert.ok(e && /مسلم|Muslim/.test(e.source.label || e.source.collection || JSON.stringify(e.source)), b);
  }
});
test("a hadith announced and NOT in the corpus is still reported", () => {
  const l = run("وقال النبي صلى الله عليه وسلم احذروا بيع الأرنب الزرقاء مقابل الحصان الأخضر الطائر فوق الجبل البعيد");
  assert.ok(l.some(e => e.status === "notfound" || e.status === "meaning" || e.status === "lead"));
});

test("talk about narrators after a cue ('عن معاذ وطبعا مكحول متأخر ... يعني ...') is not an announced quotation", () => {
  const l = run("عن معاذ وطبعا مكحول متأخر خالص يعني يمكن أبو وائل شقيق ابن سلم متقدم عن مكحول");
  assert.deepEqual(l.filter(e => e.status === "notfound"), []);
});
test("a narrator's name that occurs only in the compiler's commentary of a hadith is not a hadith quotation", () => {
  const l = run("وهذا الحديث رواه عبد الرحمن بن جبير بن نفير عن أبيه");
  assert.deepEqual(l.filter(e => e.status === "verbatim" || e.status === "partial"), []);
});
test("a spoken grading is shown beside the nearest hadith, in the speaker's words, and only there", () => {
  const l = run(`قال النبي صلى الله عليه وسلم ${H} وهذا الحديث ضعيف لا يصح من هذا الوجه`);
  const e = l.find(x => x.status === "verbatim");
  assert.equal(e.spokenGrades.length, 1);
  assert.equal(e.spokenGrades[0].kind, "weak");
  assert.match(e.spokenGrades[0].text, /ضعيف/);
  assert.equal(typeof e.spokenGrades[0].start, "number");
});
test("a ruling about conduct or a word like 'حسن' on its own is not a grading", () => {
  for (const tail of ["ولا يصح أن تقول هذا لأحد", "وهذا كلام حسن جدا", "ولا يصح لمسلم أن يفعل ذلك"]) {
    const e = run(`قال النبي صلى الله عليه وسلم ${H} ${tail}`).find(x => x.status === "verbatim");
    assert.ok(e && !(e.spokenGrades || []).length, tail);
  }
});
test("the grading of a different hadith far away is not attached", () => {
  const far = ("ثم تكلمنا في أمور كثيرة عن الصبر والرضا والتوكل والإخلاص والخشوع والتواضع والزهد والورع والتقوى وحسن الخلق والصدق والأمانة وبر الوالدين وصلة الأرحام ").repeat(3);
  const e = run(`قال النبي صلى الله عليه وسلم ${H} ${far} وهذا الحديث ضعيف`).find(x => x.status === "verbatim");
  assert.ok(e && !(e.spokenGrades || []).length);
});
test("a cue followed by a verdict on the chain, or by the chain itself, announces no text", () => {
  for (const t of ["عن معاذ بن جبل رضي الله عنه وطبعا الإسناد هنا منقطع ليه لأن مكحولا لم يسمع من معاذ",
                   "عن معاذ عن مكحول عن معاذ وطبعا مكحول لم يدرك معاذا",
                   "رواه مكحول عن معاذ بن جبل رضي عنه. وطبعا الإسناد هنا منقطع ليه؟ لأن مكحولا متأخر.",
                   "قال رسول الله صلى الله عليه وسلم وهذا مرسل لا يثبت عند أهل العلم"]) {
    assert.deepEqual(run(t).filter(e => e.status === "notfound" || (e.suggestions || []).length), [], t);
  }
});
test("... and a real hadith after the same cue is still found, and an absent one still reported", () => {
  assert.ok(run(`عن معاذ رضي الله عنه قال قال رسول الله صلى الله عليه وسلم ${H}`).some(e => e.status === "verbatim"));
  assert.ok(run("قال رسول الله صلى الله عليه وسلم اذهبوا الى السوق فان التجارة تسعة اعشار الرزق وزرقاء الخبز تحت المنضدة").some(e => e.status === "notfound"));
});
test("a quotation begun, broken off for an aside and begun again is ONE citation, with the source named at the first start", () => {
  // (the words of a real lecture, as transcribed from its link on 4 Oct 2026)
  const l = run("في صحيح البخاري من حديث سعيد بن زيد قال لقد رأيتني، وطبعًا أنتم عارفين سعيد بن زيد أحد العشرة المبشرين بالجنة وكان زوج أخت عمر بن الخطاب وعمر لم يكن أسلم آنذاك يقول سعيد بن زيد رضي الله عنه: لقد رأيتني وإن عمر لموثقي على الإسلام عمر بن الخطاب ماسكه مكتفه هو وأخته");
  assert.deepEqual(l.filter(e => e.status === "notfound"), []);
  const e = l.find(x => x.source && /3862|3867|6942/.test(x.source.label));
  assert.ok(e && ["verbatim", "partial"].includes(e.status), JSON.stringify(l.map(x => [x.status, x.source && x.source.label])));
  assert.ok(e.attribution && e.attribution.agrees === true, "the collection named before the aside is checked against this citation");
});
test("... but an announced text that is NOT said again nearby is still reported as not found", () => {
  const l = run("قال رسول الله صلى الله عليه وسلم اذهبوا الى السوق فان التجارة تسعة اعشار الرزق. ثم بعد كلام طويل في موضوع آخر تماما قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى");
  assert.ok(l.some(e => e.status === "notfound") && l.some(e => e.status === "verbatim"));
});
