// Cues recognised by their FORM, whoever is named: a verb, a name and the prayer said after it; a verb of reporting, the
// Prophet's title, the blessing and the particle that opens the content; and announcers of a saying that name nobody.
import test from "node:test";
import assert from "node:assert/strict";
import { findCues } from "../public/js/cues.js";
import { fold, normMixed, stem, norm } from "../public/js/text.js";
import { loadCorpus } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";

const F = t => t.split(/\s+/).map(w => fold(normMixed(w))).filter(Boolean);
const cues = t => { const f = F(t), ws = t.split(/\s+/); return findCues(f).map(c => [c.kind, ws.slice(c.pos, c.end).join(" "), !!c.athar]); };
const corpus = await loadCorpus();
const run = t => analyze(t.split(/\s+/).map((w, i) => ({ w, start: i * 0.5, end: i * 0.5 + 0.4 })), corpus).ledger;

test("a companion named with his prayer: 'قال X رضي الله عنه' announces his words, 'عن X رضي الله عنه' what he narrated", () => {
  assert.deepEqual(cues("ثم قال حذيفة بن اليمان رضي الله عنه كلاما عظيما"), [["saying", "قال حذيفة بن اليمان رضي الله عنه", true]]);
  assert.deepEqual(cues("وتقول أم سلمة رضي الله عنها في ذلك"), [["saying", "وتقول أم سلمة رضي الله عنها", true]]);
  assert.deepEqual(cues("يقول سعيد بن زيد رضي الله تعالى عنه لقد رأيتني")[0].slice(0, 2), ["saying", "يقول سعيد بن زيد رضي الله تعالى عنه"]);
  assert.equal(cues("عن النعمان بن بشير رضي الله عنهما قال سمعت")[0][0], "hadith");
  // names that are in no list
  assert.equal(cues("قال أبو الدرداء عويمر بن زيد رضي الله عنه")[0][0], "saying");
});
test("a scholar named with 'رحمه الله': a saying looked for in books, not in the hadith collections", () => {
  const c = cues("قال الحسن بن علي البربهاري رحمه الله كلاما نفيسا");
  assert.deepEqual(c, [["saying", "قال الحسن بن علي البربهاري رحمه الله", false]]);
});
test("no prayer, no cue; and a chain of narrators is not one name", () => {
  assert.deepEqual(cues("قال الرجل لصاحبه كلاما طويلا في السوق ثم مضى"), []);
  assert.deepEqual(cues("قال فلان عن فلان عن فلان رضي الله عنه").filter(c => c[0] === "saying"), []);
});
test("what the Prophet said, reported with ANY verb: verb + title + blessing + the particle that opens the content", () => {
  for (const v of ["وضح", "نبه", "ذكر", "أرشدنا", "حث", "زجرنا", "رغب", "شدد"]) {
    const c = cues(`ثم ${v} النبي صلى الله عليه وسلم أن الدنيا دار ممر`);
    assert.equal(c.length, 1, v); assert.equal(c[0][0], "hadith", v); assert.ok(c[0][1].startsWith(v), v);
  }
  assert.equal(cues("وقد منع رسول الله صلى الله عليه وعلى آله وسلم من ذلك")[0][0], "hadith");
  assert.deepEqual(cues("حث النبي صلى الله عليه وسلم على الصدقة"), [], "without a particle that opens reported content there is no cue");
  assert.equal(cues("حذرنا نبينا عليه الصلاة والسلام من الغفلة")[0][0], "hadith");
});
test("... but a narrative about him announces nothing", () => {
  for (const t of ["خرج النبي صلى الله عليه وسلم يوما فرأى رجلا", "كان النبي صلى الله عليه وسلم من أحسن الناس خلقا", "لما هاجر النبي صلى الله عليه وسلم إلى المدينة",
                   "في زمن النبي صلى الله عليه وسلم من الأحداث", "سنة النبي صلى الله عليه وسلم على العين والرأس"])
    assert.deepEqual(cues(t), [], t);
});
test("announcers that name nobody ('مقولة مشهورة', 'كان يقول', 'في الأثر') are sayings that may be a companion's", () => {
  for (const t of ["ولهم مقولة مشهورة لا ينبغي أن تنسى", "وكان يقول دائما لأصحابه", "وقد جاء في الأثر أن من فعل"]) { const c = cues(t); assert.equal(c.length, 1, t); assert.deepEqual([c[0][0], c[0][2]], ["saying", true], t); }
});
test("a companion's words kept in a hadith collection are found after 'قال X رضي الله عنه', word for word", () => {
  const l = run("وكان سعيد بن زيد من السابقين يقول سعيد بن زيد رضي الله عنه لقد رأيتني وإن عمر لموثقي على الإسلام قبل أن يسلم عمر");
  assert.ok(l.some(e => e.status === "verbatim" && /3862/.test(e.source.label)));
});
test("a scholar's remark after 'قال العلماء' is not matched against the hadith collections by meaning", () => {
  const l = run("قال العلماء إن هذه المسألة فيها تفصيل طويل لا يتسع له المقام ومن تأمل في أحوال الصحابة رضي الله عنهم وجد عجبا من صبرهم وثباتهم");
  assert.deepEqual(l.filter(e => e.status === "meaning"), []);
});
test("a conjunction with a second particle is stripped like the bare word: the two forms meet", () => {
  const s = w => stem(fold(norm(w)));
  for (const [a, b] of [["فلمقام", "لمقام"], ["وبالوالدين", "بالوالدين"], ["وللذين", "للذين"], ["فلينظر", "لينظر"], ["ولسانه", "لسانه"], ["وبكتابه", "بكتابه"]]) assert.equal(s(a), s(b), a);
  assert.equal(s("وكتابهم"), s("كتابهم"));      // a root letter is not a particle
  assert.equal(s("ولدهم"), "لدهم");             // too short to lose two letters
});
