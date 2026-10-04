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
