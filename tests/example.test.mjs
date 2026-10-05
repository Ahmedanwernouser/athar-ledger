// One real lecture, end to end (a 4½-minute talk on «احفظ الله يحفظك», transcribed from its link on 5 Oct 2026 and reviewed by
// hand with the project's owner). Each test is a general rule that this lecture showed to be missing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCorpusWith } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";
import { gradeSummary } from "../public/js/grade.js";
import { takhrijMask, norm } from "../public/js/text.js";

const corpus = await loadCorpusWith(["daif"]);
const TEXT = readFileSync(new URL("./fixtures/sayegh.txt", import.meta.url), "utf8");
const out = analyze(TEXT.split(/\s+/).filter(Boolean).map(w => ({ w })), corpus);
const L = out.ledger || out.entries || out;
const by = ref => L.filter(e => e.source && e.source.ref === ref);

test("what the lecture quotes is found: two hadith (one said twice) and three ayat", () => {
  assert.equal(by("nawawi:19").length, 2);
  assert.equal(by("tirmidhi:2195").length, 1);
  for (const r of ["14:27", "13:11", "2:255"]) assert.equal(by(r).length, 1, r);
  for (const r of ["14:27", "13:11", "2:255"]) assert.equal(by(r)[0].status, "verbatim", r);
});

test("a book of famous hadith that lists a sound hadith is not quoted as calling it false", () => {
  // Kashf al-Khafa has «بادروا بالأعمال فتنا… رواه مسلم»; the verdict «باطل… كذب» that follows is about the NEXT hadith of the book
  const e = by("tirmidhi:2195")[0];
  for (const w of e.weakBooks || []) assert.ok(!/باطل|كذب/.test(w.bookWords || ""), "another hadith's verdict under this one: " + w.bookWords);
  assert.equal((e.weakBooks || []).length, 0);
});
test("a book's verdict is shown only when it stands in the passage, after the text begins and before the next hadith opens", () => {
  let withG = 0, kept = 0;
  for (let pid = 0; pid < corpus.P.length; pid++) { const p = corpus.P[pid]; if (!p.g) continue; withG++; if (corpus.verdictAt(pid)) kept++; }
  assert.ok(withG > 100 && kept > 0.5 * withG, `verdict words that stand in their own passage: ${kept} of ${withG}`);
  // a known fabricated saying keeps its book's words
  const r = analyze("قال رسول الله صلى الله عليه وسلم اطلبوا العلم ولو في الصين".split(" ").map(w => ({ w })), corpus);
  const e = (r.ledger || r.entries || r)[0];
  assert.ok(e && (e.weakBooks || []).length >= 1, "«اطلبوا العلم ولو بالصين» is still reported from the books of famous and fabricated hadith");
});

test("a compilation's hadith carries the grading of the collection it is narrated in, and says so", () => {
  const e = by("nawawi:19")[0], g = gradeSummary(e.source, e.parallels);
  assert.equal(g.kind, "strong"); assert.equal(g.via.ref, "tirmidhi:2516");
  assert.equal(gradeSummary(e.source, []).kind, "none", "without that narration found, nothing is claimed");
  const t = by("tirmidhi:2195")[0], gt = gradeSummary(t.source, t.parallels);
  assert.ok(gt.kind === "strong" && gt.also === "muslim" && !gt.via);
});

test("the source's note on where a hadith is from is not the hadith's wording", () => {
  const toks = norm("رفعت الاقلام وجفت الصحف رواه الترمذي رقم 2516 وقال حديث حسن صحيح وفي رواية غير الترمذي احفظ الله تجده امامك").split(" ");
  const m = takhrijMask(toks), marked = toks.filter((_, i) => m[i]).join(" ");
  assert.equal(marked, norm("رواه الترمذي رقم 2516 وقال حديث حسن صحيح وفي رواية غير الترمذي"));
  const t2 = norm("يبيع احدهم دينه بعرض من الدنيا قال ابو عيسى هذا حديث حسن صحيح").split(" ");
  assert.equal(t2.filter((_, i) => takhrijMask(t2)[i]).join(" "), norm("قال ابو عيسى هذا حديث حسن صحيح"));
  for (const plain of ["انما الاعمال بالنيات وانما لكل امرئ ما نوى", "قال رسول الله صلى الله عليه وسلم من حسن اسلام المرء تركه ما لا يعنيه", "وفي رواية قال يا رسول الله"]) {
    const t3 = norm(plain).split(" "); assert.equal([...takhrijMask(t3)].reduce((a, b) => a + b, 0), 0, plain);
  }
  // in the lecture: «أخرجه الترمذي وقال حديث حسن صحيح وزاد الإمام أحمد» against «رواه الترمذي … وفي رواية غير الترمذي» is no difference in the hadith
  const e = by("nawawi:19")[0], wd = e.counts.diff + e.counts.added + e.counts.omitted;
  assert.ok(e.diff.some(d => d.meta) && e.diff.filter(d => d.meta && /الترمذي|اخرجه|احمد/.test(d.spoken + d.source)).length >= 3);
  assert.ok(wd <= 13, "differences counted in the hadith itself: " + wd);
  assert.ok(!e.diff.some(d => d.meta && /يحفظك|تجاهك|الصبر/.test(d.source)), "no word of the hadith is taken for a note");
});
