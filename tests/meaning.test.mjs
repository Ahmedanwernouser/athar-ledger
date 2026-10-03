import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";
import { wordsFromText } from "../public/js/text.js";
import { resolveByMeaning, choiceOf, textOf } from "../public/js/meaning.js";

const corpus = await loadCorpus();
const FILL = "ثم اعلموا رحمكم الله أن هذا الأمر عظيم وأن الناس في زماننا كثيرا ما يغفلون عنه";
const spoken = `${FILL} بين النبي صلى الله عليه وسلم أن القوي الحقيقي ليس من يغلب الناس في المصارعة وإنما هو من يملك نفسه حين يغضب ${FILL}`;
const entry = analyze(wordsFromText(spoken), corpus).ledger.find(e => e.cue === "hadith");

test("paraphrase is not matched by words alone", () => { assert.ok(entry && entry.status !== "verbatim" && entry.status !== "partial"); });

test("model recalls the real wording -> corpus confirms it -> source attached", async () => {
  const r = await resolveByMeaning(entry, corpus, async (sp, kind, cands) => cands ? "0" : "ليس الشديد بالصرعة إنما الشديد الذي يملك نفسه عند الغضب");
  assert.ok(r);
  assert.ok([r.source, ...r.parallels].some(s => s.ref === "bukhari:6114"));
  assert.ok(r.sharedStems >= 1);
});

test("model invents a hadith -> nothing is attached", async () => {
  const r = await resolveByMeaning(entry, corpus, async (sp, kind, cands) => cands ? "0" : "من صارع الناس في يوم الجمعة كتب الله له أجر ألف شهيد ودخل الجنة بغير حساب");
  assert.equal(r, null);
});

test("model says it does not know / fails -> nothing is attached", async () => {
  assert.equal(await resolveByMeaning(entry, corpus, async (sp, kind, cands) => cands ? "0" : "لا_أعرف"), null);
  assert.equal(await resolveByMeaning(entry, corpus, async () => { throw new Error("429"); }), null);
});

test("closed choice: the model can only pick a passage the corpus proposed", async () => {
  assert.ok(entry.suggestions && entry.suggestions.length >= 2, "hybrid retrieval proposes candidates");
  const r = await resolveByMeaning(entry, corpus, async (sp, kind, cands) => (cands ? "2" : ""));
  assert.equal(r.via, "choice");
  assert.equal(r.source.ref, entry.suggestions[1].ref);
  const bad = await resolveByMeaning(entry, corpus, async (sp, kind, cands) => (cands ? "17" : "لا_أعرف"));
  assert.equal(bad, null);
});

test("hybrid retrieval puts the paraphrased hadith among its suggestions", () => {
  assert.ok(entry.suggestions.some(s => ["bukhari:6114", "muslim:6643", "muslim:6644", "malik:1644"].includes(s.ref)));
});

test("closed choice: an answer that is not a whole number in range is 'none' and never throws", async () => {
  const REAL = "ليس الشديد بالصرعة إنما الشديد الذي يملك نفسه عند الغضب";
  for (const bad of [1.5, "1.5", "2 or 3", NaN, "NaN", "", " ", null, undefined, "0", 0, -1, "-1", 6, "17", "the second", "٢ أو ٣", {}, [], { error: "empty" }, { text: "" }, { choice: 2.5 }, true, "1e0", "0x2", Infinity]) {
    assert.equal(choiceOf(bad, 5), 0, JSON.stringify(bad) ?? String(bad));
    // no choice -> the recall step runs; with nothing recalled there is no source at all
    assert.equal(await resolveByMeaning(entry, corpus, async (sp, kind, cands) => (cands ? bad : "")), null, String(bad));
    // ... and the recall step is really reached (the bad choice was not silently taken as a pick)
    const r = await resolveByMeaning(entry, corpus, async (sp, kind, cands) => (cands ? bad : REAL));
    assert.ok(r && r.via !== "choice", String(bad));
  }
  for (const [good, k] of [["2", 2], [2, 2], [" 2 ", 2], ["2.", 2], ["1", 1], [{ choice: 2 }, 2]]) {
    assert.equal(choiceOf(good, 5), k);
    const r = await resolveByMeaning(entry, corpus, async (sp, kind, cands) => (cands ? good : ""));
    assert.equal(r.via, "choice"); assert.equal(r.source.ref, entry.suggestions[k - 1].ref);
  }
  assert.equal(choiceOf("3", 2), 0, "beyond the list that was offered");
});

test("recall: empty answers from the server are 'no answer'", async () => {
  for (const empty of ["", "   ", null, undefined, { error: "empty" }, { text: "" }, { text: null }, {}, 42, [], false]) {
    assert.equal(textOf(empty), "");
    assert.equal(await resolveByMeaning(entry, corpus, async (sp, kind, cands) => (cands ? "0" : empty)), null, JSON.stringify(empty) ?? String(empty));
    assert.equal(await resolveByMeaning(entry, corpus, async () => empty), null);
  }
  const r = await resolveByMeaning(entry, corpus, async (sp, kind, cands) => (cands ? { error: "empty" } : { text: "ليس الشديد بالصرعة إنما الشديد الذي يملك نفسه عند الغضب" }));
  assert.ok(r && [r.source, ...r.parallels].some(s => s.ref === "bukhari:6114"));
});

test("recall: a real text that shares no informative word with what was said gives no source", async () => {
  // the reviewer's case: a fabricated saying, and the model 'recalls' a famous hadith that has nothing to do with it
  const fake = analyze(wordsFromText(`${FILL} قال رسول الله ﷺ اطلبوا العلم ولو في الصين ${FILL}`), corpus).ledger.find(e => e.cue === "hadith");
  assert.equal(fake.status, "notfound");
  const niyya = "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى دنيا يصيبها أو إلى امرأة ينكحها فهجرته إلى ما هاجر إليه";
  assert.equal(await resolveByMeaning(fake, corpus, async (sp, kind, cands) => (cands ? "0" : niyya)), null);
  // the same recalled text for the paraphrase of another hadith: nothing shared either
  assert.equal(await resolveByMeaning(entry, corpus, async (sp, kind, cands) => (cands ? "0" : niyya)), null);
  // a recall that does share words is still attached, and is never "weak"
  const r = await resolveByMeaning(entry, corpus, async (sp, kind, cands) => (cands ? "0" : "ليس الشديد بالصرعة إنما الشديد الذي يملك نفسه عند الغضب"));
  assert.ok(r.sharedStems >= 1); assert.ok(["strong", "medium"].includes(r.strengthCode));
});
