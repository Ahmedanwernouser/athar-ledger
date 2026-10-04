// Same-sounding spellings are the same spoken word; different words are not merged.
import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";
import { sameSound, wordsFromText, norm } from "../public/js/text.js";

const corpus = await loadCorpus();
const FILL = "ثم اعلموا رحمكم الله أن هذا الأمر عظيم وأن الناس في زماننا كثيرا ما يغفلون عنه";
const run = t => analyze(wordsFromText(`${FILL} ${t} ${FILL}`), corpus).ledger.filter(e => ["verbatim", "partial"].includes(e.status));

test("sameSound: spelling variants of one pronunciation are equal; distinct words are not", () => {
  for (const [a, b] of [["كمشكاة", "كمشكات"], ["قلى", "قلا"], ["مؤمن", "مومن"], ["شيء", "شي"], ["سئل", "سيل"], ["الصلاة", "الصلات"]]) assert.ok(sameSound(norm(a), norm(b)), a + " = " + b);
  for (const [a, b] of [["إلى", "إلا"], ["هذي", "هذا"], ["أني", "أنا"], ["على", "علا"], ["بيت", "بيه"], ["العدل", "الظلم"], ["يغفر", "يكفر"], ["القرآن", "القرن"], ["في", "فا"], ["لي", "لا"]]) assert.ok(!sameSound(norm(a), norm(b)), a + " ≠ " + b);
});

test("a verse transcribed with sound-alike spellings is still verbatim; a real word change is not", () => {
  const ok = run("قال الله تعالى مثل نوره كمشكات فيها مصباح المصباح في زجاجة");
  assert.equal(ok.length, 1); assert.equal(ok[0].source.surah, 24); assert.equal(ok[0].status, "verbatim");
  const duha = run("قال الله تعالى والضحى والليل إذا سجى ما ودعك ربك وما قلا");
  assert.equal(duha[0].source.surah, 93); assert.equal(duha[0].status, "verbatim");
  const bad = run("قال الله تعالى إن الله يأمر بالظلم والإحسان وإيتاء ذي القربى وينهى عن الفحشاء والمنكر والبغي");
  assert.equal(bad[0].status, "partial");
  const neg = run("قال الله تعالى شهد الله أنه لا إله إلى هو والملائكة وأولو العلم قائما بالقسط");
  assert.equal(neg[0].status, "partial", "«إلى» for «إلا» is a different word");
});
