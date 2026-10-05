// The digest (every hadith / passage of the Qur'an of a lecture once) and the line about a hadith's recorded standing.
import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";
import { setCorpusForTests, setDisplayForTests, finish, buildDigest } from "../public/js/worker.js";
import { digestItem } from "../public/js/digest.js";
import { gradeClass, gradeSummary, gradedWeak } from "../public/js/grade.js";
import { flagsOf } from "../public/js/flags.js";

const corpus = await loadCorpus();
setCorpusForTests(corpus); setDisplayForTests(null);
const ledgerOf = t => { const words = t.split(/\s+/).map(w => ({ w })), r = analyze(words, corpus); r.ledger.forEach((e, i) => { finish(e, words, r.tokenToWord); e.id = i + 1; }); return r.ledger; };
const digest = l => buildDigest(l.map(digestItem).filter(Boolean));
const LECTURE = `بسم الله نبدأ درس اليوم. قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى. ثم نشرح معنى النية وأن العمل بلا نية لا يقبل عند الله وهذا أصل عظيم من أصول الدين.
وقال صلى الله عليه وسلم فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله. يعني أن الجزاء من جنس القصد وهذا واضح.
ونعيد الحديث مرة أخرى قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنية وإنما لكل امرئ ما نوى فمن كانت هجرته إلى دنيا يصيبها أو امرأة يتزوجها فهجرته إلى ما هاجر إليه.
قال الله تعالى الله لا إله إلا هو الحي القيوم لا تأخذه سنة ولا نوم. وهذه أعظم آية في كتاب الله كما تعلمون.
وفي الحديث الذي رواه الترمذي قال رسول الله صلى الله عليه وسلم من حسن إسلام المرء تركه ما لا يعنيه. وهذا حديث عظيم.`;

test("a hadith said in pieces is found piece by piece: the clause between two tellings is not lost", () => {
  const l = ledgerOf(LECTURE);
  const piece = l.find(e => /^فمن كانت هجرته إلى الله ورسوله/.test(e.spoken));
  assert.ok(piece && piece.status === "verbatim" && piece.source.type === "h", "the clause said on its own is a citation of a collection");
  const off = analyze(LECTURE.split(/\s+/).map(w => ({ w })), corpus, { residual: false }).ledger;
  assert.ok(!off.some(e => /^فمن كانت هجرته إلى الله ورسوله/.test(e.spoken) && e.status === "verbatim"), "without the rule only one piece of the stretch is found");
});

test("the digest: one card for the hadith told three times in the wording of two collections, with what was said of each", () => {
  const l = ledgerOf(LECTURE), cards = digest(l);
  const niyya = cards.find(c => c.type === "h" && c.wordings.some(w => w.source.ref === "bukhari:1"));
  assert.ok(niyya, "the hadith of intentions has a card");
  assert.equal(niyya.ids.length, 3, "three mentions");
  assert.equal(niyya.wordings.length, 2, "two wordings");
  const b = niyya.wordings.find(w => w.source.ref === "bukhari:1");
  assert.equal(b.ids.length, 2);
  assert.ok(b.said >= b.total - 2 && b.said <= b.total, "between the two tellings nearly every word of Bukhari's wording was said");
  assert.equal(b.segs.map(g => g.t).join(" ").split(" ").length, b.total, "the card holds the whole text after the chain");
  const other = niyya.wordings.find(w => w !== b);
  assert.ok(other.said > 0 && other.said < other.total && other.segs.some(g => !g.said) && other.segs.some(g => g.said));
  // every card lists its mentions in the order of the lecture, and cards come in the order of first mention
  for (const c of cards) assert.deepEqual(c.ids, [...c.ids].sort((x, y) => x - y));
  assert.deepEqual(cards.map(c => c.ids[0]), cards.map(c => c.ids[0]).sort((x, y) => x - y));
});

test("the digest: a passage of the Qur'an with the words that were recited, ayah mark and all", () => {
  const cards = digest(ledgerOf(LECTURE));
  const q = cards.find(c => c.type === "q");
  assert.ok(q && q.wordings[0].source.surah === 2 && q.wordings[0].source.ayah === 255);
  const w = q.wordings[0];
  assert.ok(w.said >= 10 && w.said < w.total);
  assert.match(w.segs.at(-1).t, /﴿255﴾$/);
  assert.equal(w.segs[0].said, true); assert.ok(/[\u064B-\u0652]/.test(w.segs[0].t), "the verbatim text of the Mushaf, not the search form");
  assert.equal(w.segs.at(-1).said, false, "the end of the ayah was not recited");
});

test("entries that are not a hadith of the collections or the Qur'an take no part", () => {
  assert.equal(digestItem({ status: "notfound", source: null }), null);
  assert.equal(digestItem({ status: "verbatim", weakOnly: true, source: { type: "h", ref: "kashf:1" } }), null);
  assert.equal(digestItem({ status: "verbatim", source: { type: "b", ref: "zadmaad:1" } }), null);
  assert.equal(digestItem({ status: "meaning", source: { type: "q", ref: "2:255" } }), null);
  const m = digestItem({ id: 7, status: "meaning", source: { type: "h", ref: "bukhari:1" }, parallels: [] });
  assert.deepEqual([m.keyed, m.said.length], [false, 0]);
  assert.equal(buildDigest([m])[0].wordings[0].said, 0, "cited by meaning: listed under its hadith, no word marked");
});

test("grades: the wording of the dataset is sorted into sound, weak, or a word about the kind of report", () => {
  for (const g of ["صحيح", "حسن صحيح", "إسناده حسن", "صحيح لغيره", "موقوف صحيح", "Sahih Isnaad Maqtu", "Hasan Sahih Isnaad"]) assert.equal(gradeClass(g), "strong", g);
  for (const g of ["ضعيف", "ضعيف جدًا", "إسناده ضعيف", "منكر", "موضوع", "شاذ", "باطل", "موقوف ضعيف", "Isnaad Daif", "Mauquf Munkar", "Shadh, Sahih"]) assert.equal(gradeClass(g), "weak", g);
  for (const g of ["مقطوع", "Mauquf", "Mursal"]) assert.equal(gradeClass(g), "neutral", g);
});

test("the standing of a hadith in one line: the two Sahih, agreement, disagreement, nothing recorded", () => {
  const src = ref => corpus.describe(corpus.coreRef.get(ref));
  assert.deepEqual(gradeSummary(src("bukhari:1")), { kind: "sahihayn", collection: "bukhari" });
  assert.equal(gradeSummary(corpus.describe(corpus.P.findIndex(p => p.r.startsWith("muslim:")))).kind, "sahihayn");
  const t = gradeSummary(src("tirmidhi:2317"));
  assert.equal(t.kind, "mixed"); assert.ok(t.strong.by.length >= 1 && t.weak.by.length >= 1);
  assert.equal(gradeSummary({ type: "h", collection: "abudawud", grades: [{ by: "الألباني", grade: "صحيح" }, { by: "شعيب الأرناؤوط", grade: "إسناده صحيح" }] }).kind, "strong");
  const w = gradeSummary({ type: "h", collection: "ibnmajah", grades: [{ by: "الألباني", grade: "ضعيف" }] });
  assert.deepEqual([w.kind, w.grade, w.by], ["weak", "ضعيف", ["الألباني"]]);
  assert.equal(gradeSummary({ type: "h", collection: "nawawi", grades: null }, [{ type: "h", collection: "muslim" }]).also, "muslim");
  assert.equal(gradeSummary({ type: "h", collection: "nawawi", grades: null }).kind, "none");
  assert.equal(gradeSummary({ type: "q" }), null); assert.equal(gradeSummary({ type: "b", collection: "zadmaad" }), null);
  // every hadith of the four Sunan and the Muwatta carries a grading; the two Sahih are told by their place
  let n = 0, covered = 0;
  for (let pid = corpus.NQ; pid < corpus.coreN; pid += 37) { const g = gradeSummary(corpus.describe(pid)); n++; if (g && g.kind !== "none") covered++; }
  assert.ok(covered / n > 0.98, `${covered} of ${n} sampled hadith have a line`);
});

test("an alert when every recorded grading is weak and the text is in neither Sahih", () => {
  const weak = { type: "h", collection: "ibnmajah", grades: [{ by: "الألباني", grade: "ضعيف" }] };
  assert.equal(gradedWeak(weak, []), true);
  assert.equal(gradedWeak(weak, [{ type: "h", collection: "bukhari" }]), false, "the same words stand in Sahih al-Bukhari");
  assert.ok(flagsOf({ status: "verbatim", source: weak, parallels: [] }).includes("dweak"));
  assert.ok(!flagsOf({ status: "notfound", source: null }).includes("dweak"));
  assert.ok(!flagsOf({ status: "verbatim", source: { type: "h", collection: "tirmidhi", grades: [{ by: "أ", grade: "صحيح" }, { by: "ب", grade: "ضعيف" }] }, parallels: [] }).includes("dweak"), "a disputed grading is shown, not alerted");
});
