// What "Ask Athar" looks up by itself (public/js/tools.js): a text by its reference, texts near a topic, a short saying in
// the books of fabricated and famous hadith, and the count of a written word in the Qur'an. No language model in any of it.
import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpusWith } from "../eval/lib.mjs";
import { parseRefs, topicWords, topicSearch, countInQuran, phraseInWeakBooks } from "../public/js/tools.js";
import { describeRef } from "../public/js/lookup.js";

const corpus = await loadCorpusWith(["daif"]);

test("a reference in a question: ayah by surah and number, by name, by numbers; a range; a surah alone", () => {
  assert.deepEqual(parseRefs("البقرة 255", corpus), ["2:255"]);
  assert.deepEqual(parseRefs("ما نص الآية 255 من سورة البقرة؟", corpus), ["2:255"]);
  assert.deepEqual(parseRefs("سورة البقرة الآية ٢٥٥", corpus), ["2:255"]);
  assert.deepEqual(parseRefs("آية الكرسي", corpus), ["2:255"]);
  assert.deepEqual(parseRefs("2:285-286", corpus), ["2:285-286"]);
  assert.deepEqual(parseRefs("خواتيم سورة البقرة", corpus), ["2:285-286"]);
  assert.deepEqual(parseRefs("من الآية 1 إلى 5 من سورة الكهف", corpus), ["18:1-5"]);
  assert.deepEqual(parseRefs("سورة الإخلاص", corpus), ["112:1-4"]);
  assert.deepEqual(parseRefs("آل عمران 102", corpus), ["3:102"]);
});
test("a reference that does not exist names nothing; neither does a question without one", () => {
  assert.deepEqual(parseRefs("البقرة 999", corpus), []);
  assert.deepEqual(parseRefs("300:1", corpus), []);
  assert.deepEqual(parseRefs("ما حكم صلاة الجماعة؟", corpus), []);
  assert.deepEqual(parseRefs("البخاري 99999", corpus), []);
});
test("a hadith by the number people cite is the hadith printed under that number", () => {
  for (const [q, col, num] of [["حديث رقم 1 في صحيح البخاري", "bukhari", "1"], ["البخاري 6018", "bukhari", "6018"], ["مسلم 55", "muslim", "55"], ["الأربعين النووية 19", "nawawi", "19"], ["سنن أبي داود رقم 4607", "abudawud", "4607"]]) {
    const refs = parseRefs(q, corpus); assert.equal(refs.length, 1, q);
    const d = describeRef(refs[0], corpus); assert.equal(d.collection, col, q); assert.equal(String(d.number).replace(/[a-z]+$/i, ""), num, q);
  }
});
test("the words of a topic: fillers and question words left out, two-letter words kept", () => {
  assert.deepEqual(topicWords("أحاديث عن بر الوالدين"), ["بر", "الوالدين"]);
  assert.deepEqual(topicWords("ما ورد في فضل الصدقة"), ["الصدقه"]);
  assert.deepEqual(topicWords("عن في من"), []);
});
test("texts near a topic hold the topic's words together, one hadith once, of the kind asked for", () => {
  const hits = topicSearch("بر الوالدين", corpus, { kind: "h", k: 5 });
  assert.ok(hits.length >= 3);
  assert.match(corpus.P[hits[0].pid].n, /(^| )[وفب]?بر الوالدين( |$)/);
  for (const h of hits) { assert.equal(h.via, "words"); assert.ok(!corpus.isQuran(h.pid)); assert.ok(h.pid < corpus.coreN, "only the core collections are suggested"); }
  const nums = hits.map(h => { const d = corpus.describe(h.pid); return d.collection + "|" + String(d.number).replace(/[a-z]+$/i, ""); });
  assert.equal(new Set(nums).size, nums.length, "the narrations under one number are one suggestion");
  const ay = topicSearch("الصبر", corpus, { kind: "q", k: 4 }); assert.ok(ay.length && ay.every(h => corpus.isQuran(h.pid)));
  assert.deepEqual(topicSearch("عن في", corpus), []);
  assert.deepEqual(topicSearch("زقزقنبوط", corpus), []);
});
test("a famous saying that is no hadith of the collections is found word for word in the books that list such sayings", () => {
  for (const q of ["حب الوطن من الإيمان", "الجنة تحت أقدام الأمهات", "اطلبوا العلم ولو في الصين"]) {
    const hits = phraseInWeakBooks(q, corpus); assert.ok(hits.length >= 1, q);
    assert.equal(new Set(hits.map(h => h.col)).size, hits.length, "one passage a book");
    for (const h of hits) { const p = corpus.P[h.pid]; assert.ok(h.pid >= corpus.coreN); assert.equal(corpus.books[h.col].domain, "hadith-weak");
      assert.equal(p.n.split(" ").slice(h.ps, h.pe).join(" "), q.replace(/[إأ]/g, "ا").replace(/ة/g, "ه"), "the place is where the words stand");
      assert.equal(typeof h.about, "string"); if (h.about) assert.equal(h.about, p.g, "the book's words are the book's, untouched"); }
  }
});
test("a text those books do not hold is not found; one word or a very long text is not looked for", () => {
  assert.deepEqual(phraseInWeakBooks("النظافة من الإيمان بالله ورسوله اليوم", corpus), []);
  assert.deepEqual(phraseInWeakBooks("الإيمان", corpus), []);
  assert.deepEqual(phraseInWeakBooks(Array(20).fill("كلمة").join(" "), corpus), []);
});
test("counting a word in the Qur'an counts its written form: itself, and with an article or attached particle", () => {
  const c = countInQuran("الجنّة", corpus);
  assert.equal(c.shown, "الجنة"); assert.equal(c.shownBare, "جنة");
  assert.ok(c.exact.times >= c.exact.ayat && c.exact.ayat > 0);
  assert.ok(c.withAffix.times >= c.exact.times && c.withAffix.ayat >= c.exact.ayat);
  assert.equal(c.first.length, 5); assert.equal(c.first[0], "2:35");
  // counted again, straight from the text
  let n = 0; for (let pid = 0; pid < corpus.coreN; pid++) if (corpus.isQuran(pid)) n += corpus.P[pid].n.split(" ").filter(w => w === "الجنه").length;
  assert.equal(c.exact.times, n);
  const none = countInQuran("زقزقنبوط", corpus); assert.equal(none.withAffix.times, 0); assert.deepEqual(none.first, []);
  assert.equal(countInQuran("و", corpus), null);
});
