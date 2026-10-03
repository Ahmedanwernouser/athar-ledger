// node --test tests/four.test.mjs
// Four defects of the matching engine, each with the cases that must be found and — more important for sacred text —
// the cases that must NOT become a citation or must NOT be called "verbatim":
//   1. function words counted as informative words (plain speech cited as an ayah);
//   2. everyday dhikr in plain speech cited as an ayah / a hadith;
//   3. a grammatical variant of the source word ("أعنّا" for "أعنّي") excused as a transcription slip;
//   4. Qur'an words spelled like a function word ("وهن" = wahana, not و + هن) discounted as function words.
import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../eval/lib.mjs";
import { analyze, DEFAULTS } from "../public/js/engine.js";
import { summarize } from "../public/js/align.js";
import { wordsFromText, tokenizeTranscript, wordSim, inflectionOf, normMixed } from "../public/js/text.js";
import { FUNCTION_WORDS, QURAN_HOMOGRAPHS, dhikrMask } from "../public/js/cues.js";

const corpus = await loadCorpus();
const run = (text, opts) => analyze(wordsFromText(text), corpus, opts).ledger;
const textual = L => L.filter(e => e.status === "verbatim" || e.status === "partial");
const show = L => L.map(e => `${e.source.ref} ${e.status} «${e.spoken}»`).join(" | ") || "none";
const one = (text, opts) => { const L = textual(run(text, opts)); assert.equal(L.length, 1, `one citation expected in: ${text} (got ${show(L)})`); return L[0]; };
const none = (text, opts) => { const L = textual(run(text, opts)); assert.equal(L.length, 0, `no citation expected in: ${text} (got ${show(L)})`); };
const FILL = "ثم اعلموا يا إخواني أن هذا الأمر عظيم";
const both = f => text => { f(text); f(`${FILL} ${text} ${FILL}`); };
/** longest exact run of Qur'an words in the text (to prove that a negative example really contains one) */
function longestQuranRun(text) {
  const Q = corpus.quranStream(), { tok } = tokenizeTranscript(wordsFromText(text));
  let best = 0;
  for (let i = 0; i + 3 <= tok.length; i++) for (const p of Q.grams.get(tok.slice(i, i + 3).join(" ")) || []) {
    let k = 3; while (i + k < tok.length && Q.tok[p + k] === tok[i + k]) k++;
    if (k > best) best = k;
  }
  return best;
}

// ------------------------------------------------------------------ 1. function words

test("1 plain speech that shares function words with an ayah is not a citation", () => {
  for (const s of ["تاريخ بني إسرائيل من بعد موسى", "تكلمنا في الدرس الماضي عن تاريخ بني إسرائيل من بعد موسى عليه السلام وما جرى لهم",
    "وهذا من فضل الله علينا وعلى الناس", "ليس لك من الأمر شيء في هذه القضية"]) {
    assert.ok(longestQuranRun(s) >= 5, `the example must contain 5 consecutive Qur'an words: ${s}`);
    both(none)(s);
  }
});

test("1 the same words are cited when they are announced, and inside a longer recitation", () => {
  for (const [text, ref, words] of [
    ["قال تعالى ألم تر إلى الملإ من بني إسرائيل من بعد موسى", "2:246", 10],
    ["﴿من بني إسرائيل من بعد موسى﴾", "2:246", 6],
    ["قال تعالى ذلك من فضل الله علينا وعلى الناس", "12:38", 7],
    ["قال الله تعالى ليس لك من الأمر شيء", "3:128", 5],
    // plain speech, no cue: the content words carry the citation
    [`${FILL} ألم تر إلى الملإ من بني إسرائيل من بعد موسى إذ قالوا لنبي لهم ابعث لنا ملكا نقاتل في سبيل الله`, "2:246", 21],
    [`${FILL} ذلك من فضل الله علينا وعلى الناس ولكن أكثر الناس لا يشكرون`, "12:38", 12],
  ]) {
    const e = one(text);
    assert.equal(e.source.ref, ref, text); assert.equal(e.status, "verbatim", text); assert.equal(e.counts.exact, words, text);
  }
});

test("1 an exact run of an ayah with two rare content words is still found in plain speech", () => {
  for (const [text, ref] of [["لا يفتر عنهم وهم فيه مبلسون", "43:75"], ["غير المغضوب عليهم ولا الضالين", "1:7"]]) {
    const e = one(`${FILL} ${text} ${FILL}`);
    assert.equal(e.source.ref, ref); assert.equal(e.status, "verbatim"); assert.equal(e.contentWords, 2);
  }
});

test("1 content words are counted apart from function words (entry.contentWords / contentEvidence)", () => {
  const e = one("﴿من بني إسرائيل من بعد موسى﴾");
  assert.equal(e.counts.exact, 6); assert.equal(e.contentWords, 3);
  assert.ok(e.contentEvidence > 0 && e.contentEvidence < e.evidence);
  // the summary itself: "من" and "بعد" agree and are informative, but they are not content words
  const FP = ["بني", "اسراايل", "من", "بعد", "موسي"], ops = FP.map((_, i) => ({ op: "exact", ti: i, pi: i }));
  const idf = w => (w === "من" ? 0.5 : w === "بعد" ? 2 : 4), fn = o => o.pi === 2 || o.pi === 3;
  const s = summarize({ ops }, FP, idf, () => false, FP, fn);
  assert.equal(s.inf, 5); assert.equal(s.content, 3); assert.equal(s.evidence, 14.5); assert.equal(s.contentEvidence, 12);
  const all = summarize({ ops }, FP, idf, () => false, FP);          // without the test every informative word is content
  assert.equal(all.content, 5); assert.equal(all.contentEvidence, all.evidence);
});

test("1 a hadith in plain speech needs three content words; announced, it is found as before", () => {
  none(`${FILL} لو أنكم توكلتم على الله ${FILL}`);
  none(`${FILL} على الموت إنما بايعناه على أن لا ${FILL}`);
  const e = one("قال رسول الله صلى الله عليه وسلم لو أنكم توكلتم على الله حق توكله لرزقكم كما يرزق الطير");
  assert.equal(e.source.type, "h"); assert.equal(e.status, "verbatim");
  // announced quotations keep the lower bar: five informative words, two of them content words
  const k = one("قال رسول الله صلى الله عليه وسلم لو أنكم توكلتم على الله");
  assert.equal(k.source.type, "h"); assert.equal(k.contentWords, 2);
  assert.ok(DEFAULTS.minContent > DEFAULTS.minContentCue);
});

// ------------------------------------------------------------------ 2. everyday dhikr

test("2 everyday dhikr and formulas in plain speech are not citations, in any path", () => {
  for (const s of [
    "توفي والد صديقي أمس فقلت له إنا لله وإنا إليه راجعون وعظم الله أجركم", "فقلنا إنا لله وإنا إليه راجعون", "فقالوا إنا لله وإنا إليه راجعون",
    "عظم الله أجركم وأحسن عزاءكم وإنا لله وإنا إليه راجعون", "أصابتهم مصيبة فقالوا إنا لله وإنا إليه راجعون",
    "بسم الله الرحمن الرحيم", "الحمد لله رب العالمين", "بسم الله الرحمن الرحيم الحمد لله رب العالمين والصلاة والسلام على أشرف المرسلين",
    "لا حول ولا قوة إلا بالله", "حسبنا الله ونعم الوكيل", "حسبي الله ونعم الوكيل", "حسبنا الله ونعم الوكيل نعم المولى ونعم النصير",
    "وما توفيقي إلا بالله", "إن شاء الله", "لا إله إلا الله", "لا إله إلا الله محمد رسول الله", "سبحان الله وبحمده", "سبحان الله وبحمده سبحان الله العظيم",
    "لا إله إلا الله وحده لا شريك له له الملك وله الحمد وهو على كل شيء قدير", "ولا حول ولا قوة إلا بالله له الملك وله الحمد وهو على كل شيء قدير",
    "قلت في نفسي وأفوض أمري إلى الله والله المستعان",
    "اللهم صل على محمد وعلى آل محمد كما صليت على إبراهيم وعلى آل إبراهيم إنك حميد مجيد", "اللهم صل وسلم وبارك على نبينا محمد وعلى آله وصحبه أجمعين",
    "صلى الله عليه وسلم", "عليه الصلاة والسلام",
  ]) both(none)(s);
});

test("2 announced as Qur'an (cue, reference or ﴿ ﴾), the same words are the ayah", () => {
  for (const [text, ref, words] of [
    ["قال تعالى إنا لله وإنا إليه راجعون", "2:156", 5],
    ["قال تعالى الذين إذا أصابتهم مصيبة قالوا إنا لله وإنا إليه راجعون", "2:156", 10],
    ["كما في سورة البقرة إنا لله وإنا إليه راجعون", "2:156", 5],
    ["﴿إنا لله وإنا إليه راجعون﴾", "2:156", 5],
    ["قال تعالى له الملك وله الحمد وهو على كل شيء قدير", "64:1", 9],
    ["قال تعالى وأفوض أمري إلى الله", "40:44", 4],
    ["قال تعالى حسبنا الله ونعم الوكيل", "3:173", 4],
  ]) {
    const e = one(`${FILL} ${text}`);
    assert.equal(e.source.ref, ref, text); assert.equal(e.status, "verbatim", text); assert.equal(e.counts.exact, words, text);
  }
  // the reference is checked like any other
  assert.equal(one("كما في سورة البقرة إنا لله وإنا إليه راجعون").attribution.code, "surah_ok");
});

test("2 dhikr that is part of a longer recitation is cited with the whole passage, as before", () => {
  for (const [text, ref, words] of [
    ["الذين إذا أصابتهم مصيبة قالوا إنا لله وإنا إليه راجعون", "2:156", 10],
    ["يسبح لله ما في السماوات وما في الأرض له الملك وله الحمد وهو على كل شيء قدير", "64:1", 17],
    ["وأفوض أمري إلى الله إن الله بصير بالعباد", "40:44", 8],
  ]) {
    const e = one(`${FILL} ${text} ${FILL}`);
    assert.equal(e.source.ref, ref, text); assert.equal(e.status, "verbatim", text); assert.equal(e.counts.exact, words, text);
  }
});

test("2 the salawat are the hadith only when they are announced as one", () => {
  const e = one("قال رسول الله صلى الله عليه وسلم قولوا اللهم صل على محمد وعلى آل محمد كما صليت على إبراهيم وعلى آل إبراهيم إنك حميد مجيد");
  assert.equal(e.source.type, "h"); assert.equal(e.cue, "hadith");
  // the phrases are marked whether or not they follow "و"
  const { ftok } = tokenizeTranscript(wordsFromText("قلت وإنا لله وإنا إليه راجعون ثم له الملك وله الحمد"));
  assert.deepEqual([...dhikrMask(ftok)], [0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1]);
});

// ------------------------------------------------------------------ 3. grammatical variants are wording differences

test("3 the same stem with another affix is a grammatical variant; a mis-heard non-word is not", () => {
  const N = w => normMixed(w);
  for (const [a, b] of [["أعنا", "أعني"], ["كتابهم", "كتابه"], ["كتاب", "كتابه"], ["يعلمون", "تعلمون"], ["نعبد", "يعبد"], ["المؤمنون", "المؤمنين"],
    ["واتقوا", "اتقوا"], ["فاتقوا", "واتقوا"], ["الصلاة", "والصلاة"], ["بالحق", "الحق"], ["رزقناكم", "رزقناهم"], ["ربك", "ربكم"], ["قالت", "قال"], ["أنزل", "نزل"],
    ["عبادتكم", "عبادتك"]])
    assert.equal(inflectionOf(N(a), N(b)), true, `${a} / ${b}`);
  for (const [a, b] of [["الصلا", "الصلاة"], ["قالو", "قالوا"], ["مفتا", "مفتاح"], ["الرحمان", "الرحمن"], ["يغفز", "يغفر"], ["وحسنن", "وحسن"], ["وشكك", "وشكرك"],
    ["مضطجا", "مضطجعا"], ["the", "them"], ["أعني", "أعني"]])
    assert.equal(inflectionOf(N(a), N(b)), false, `${a} / ${b}`);
  // wordSim applies it together with the real-word rule (only when a vocabulary test is given)
  const noWord = () => false;
  assert.equal(wordSim("اعنا", "اعني"), "near");
  assert.equal(wordSim("اعنا", "اعني", undefined, undefined, noWord), "diff");
  assert.equal(wordSim("وحسنن", "وحسن", undefined, undefined, noWord), "near");
  assert.equal(wordSim("وشكرق", "وشكرك", undefined, undefined, noWord), "asr");
});

test("3 a one-letter grammatical difference makes the quotation partial, never verbatim", () => {
  const CUE = "قال رسول الله صلى الله عليه وسلم";
  assert.equal(corpus.isWord("اعنا"), false, "the case is only a test of the guard while the corpus lacks this form");
  const e = one(`${CUE} اللهم أعنا على ذكرك وشكرك وحسن عبادتك`);
  assert.equal(e.status, "partial"); assert.equal(e.counts.diff, 1); assert.equal(e.counts.near, 0);
  assert.deepEqual(e.diff.filter(d => d.kind !== "exact"), [{ kind: "diff", spoken: "اعنا", source: "اعني" }]);
  // the source wording itself
  const v = one(`${CUE} اللهم أعني على ذكرك وشكرك وحسن عبادتك`);
  assert.equal(v.status, "verbatim"); assert.equal(v.source.ref, e.source.ref);
  // mis-heard non-words stay excused: a phonetic confusion (ق for ك) and a doubled letter
  const a = one(`${CUE} اللهم أعني على ذكرك وشكرق وحسن عبادتك`);
  assert.equal(a.status, "verbatim"); assert.equal(a.counts.asr, 1);
  const n = one(`${CUE} اللهم أعني على ذكرك وشكرك وحسنن عبادتك`);
  assert.equal(n.status, "verbatim"); assert.equal(n.counts.near, 1);
  // the guard belongs to the real-word rule (ablation switch)
  assert.equal(one(`${CUE} اللهم أعنا على ذكرك وشكرك وحسن عبادتك`, { realWords: false }).status, "verbatim");
});

test("3 the same in an ayah: a changed pronoun or person is listed as a difference", () => {
  // إياك نعبد وإياك نستعين — "يستعين" / "نستعينه" are other forms of the same verb
  for (const [said, src] of [["يستعين", "نستعين"]]) {
    const e = one(`قال تعالى الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين إياك نعبد وإياك ${said} اهدنا الصراط المستقيم`);
    assert.equal(e.status, "partial");
    assert.ok(e.diff.some(d => d.kind === "diff" && d.spoken === normMixed(said) && d.source === src), JSON.stringify(e.diff.filter(d => d.kind !== "exact")));
  }
});

// ------------------------------------------------------------------ 4. homographs of function words

test("4 «وهن» is a content word of 19:4: the fragment is found when it is announced", () => {
  for (const text of ["قال تعالى إني وهن العظم مني", "﴿إني وهن العظم مني﴾", "{إني وهن العظم مني}", "يقول الله تعالى إني وهن العظم مني واشتعل الرأس شيبا"]) {
    const e = one(text);
    assert.equal(e.source.ref, "19:4", text); assert.equal(e.status, "verbatim", text);
  }
  const e = one("قال تعالى إني وهن العظم مني");
  assert.equal(e.shortFragment, true); assert.equal(e.contentWords, 2);      // وهن + العظم
});

test("4 other Qur'an words spelled like a function word count as content where they are one", () => {
  for (const [text, ref] of [
    ["قال تعالى كل في فلك يسبحون", "21:33"],            // فلك: an orbit, not ف + لك
    ["﴿كل من عليها فان﴾", "55:26"],                     // فان: perishing, not ف + إن — a whole ayah with one content word
    ["قال تعالى كل من عليها فان", "55:26"],
    ["قال تعالى وإبراهيم الذي وفى", "53:37"],            // وفى: fulfilled, not و + في
    ["قال تعالى الذي خلق فسوى", "87:2"],                // فسوى: proportioned, not ف + سوى
    ["قال تعالى وعنده أم الكتاب", "13:39"],             // أم: mother, not the particle
    ["﴿حملته أمه وهنا على وهن﴾", "31:14"],
    ["قال تعالى ولقد همت به وهم بها", "12:24"],          // وهمّ: he inclined, not و + هم
    ["﴿الله ولي الذين آمنوا﴾", "2:257"],                // وليّ: guardian, not و + لي
    ["قال تعالى حتى إذا فتحت يأجوج ومأجوج", "21:96"],   // فُتحت: were opened, not ف + تحت
    ["قال تعالى إنه علي حكيم", "42:51"],                 // عليّ: exalted, not على
  ]) {
    const e = one(text);
    assert.equal(e.source.ref, ref, text); assert.equal(e.status, "verbatim", text);
  }
  // where the same spelling IS the function word it stays one: "ولي دين" (109:6) is و + لي
  assert.equal(one("قال تعالى لكم دينكم ولي دين").contentWords, 2);
});

test("4 the table of homographs agrees with the Qur'an text", () => {
  const Q = corpus.quranStream();
  const at = new Map();      // token -> Set of "surah:ayah" where it occurs
  for (let g = 0; g < Q.tok.length; g++) {
    if (!QURAN_HOMOGRAPHS.has(Q.tok[g])) continue;
    const d = corpus.describe(Q.pid[g]);
    let s = at.get(Q.tok[g]); if (!s) at.set(Q.tok[g], s = new Set()); s.add(`${d.surah}:${d.ayah}`);
  }
  for (const [w, refs] of QURAN_HOMOGRAPHS) {
    assert.ok(FUNCTION_WORDS.has(w), `${w} is listed because the function-word set contains it`);
    assert.ok(at.has(w), `${w} occurs in the Qur'an`);
    if (refs) for (const r of refs) assert.ok(at.get(w).has(r), `${w} occurs in ${r}`);
  }
  // the scan that produced the table: every Qur'an token that is a function word only by splitting off و / ف
  const split = new Set();
  for (const t of Q.tok) if (t.length > 2 && (t[0] === "و" || t[0] === "ف") && FUNCTION_WORDS.has(t) && FUNCTION_WORDS.has(t.slice(1))) split.add(t);
  assert.equal(split.size, 161);
  for (const w of ["وهن", "وهنا", "فلك", "فتحت", "فسوي", "ولي", "وكل", "وفي", "فان", "وهم"]) assert.ok(split.has(w) && QURAN_HOMOGRAPHS.has(w), w);
});

test("4 in plain speech a homograph is no licence: the plain-speech rules still apply", () => {
  none(`${FILL} كل من عليها فان ${FILL}`);        // one content word, no announcement
  none(`${FILL} وعنده أم الكتاب ${FILL}`);
});
