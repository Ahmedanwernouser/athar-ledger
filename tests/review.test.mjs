// Regression tests for the findings of the independent engine review (/tmp/review/engine.md) and the reference
// findings of the data review. One test (or more) per finding; the inputs are the reviewer's reproducing inputs.
import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpus, loadCorpusWith } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";
import { wordsFromText, normMixed, fold, wordSim } from "../public/js/text.js";
import { findQuranReferences, findCollectionMentions, formulaMask } from "../public/js/cues.js";
import { MAX_PACK_PASSAGES } from "../public/js/corpus.js";

const corpus = await loadCorpus();
const FILL = "ثم اعلموا رحمكم الله أن هذا الأمر عظيم وأن الناس في زماننا كثيرا ما يغفلون عنه";
const run = (text, c = corpus, opts) => analyze(wordsFromText(`${FILL} ${text} ${FILL}`), c, opts).ledger;
const textual = L => L.filter(e => e.status === "verbatim" || e.status === "partial");
const one = (text, c) => { const L = textual(run(text, c)); assert.equal(L.length, 1, `expected one citation, got ${L.length}: ${L.map(e => e.source.ref)}`); return L[0]; };
const refsOf = e => [e.source, ...e.parallels].map(s => s.ref);
const F = t => wordsFromText(t).flatMap(w => normMixed(w.w).split(" ")).filter(Boolean).map(fold);

// ------------------------------------------------------------------ CRITICAL

test("C1 verbatim is strict: one substituted, added or omitted word makes the citation partial", () => {
  const good = one("قال الله تعالى إن الله يأمر بالعدل والإحسان وإيتاء ذي القربى وينهى عن الفحشاء والمنكر والبغي يعظكم لعلكم تذكرون");
  assert.equal(good.status, "verbatim"); assert.equal(good.source.ref, "16:90");
  const sub = one("قال الله تعالى إن الله يأمر بالظلم والإحسان وإيتاء ذي القربى وينهى عن الفحشاء والمنكر والبغي يعظكم لعلكم تذكرون");
  assert.equal(sub.status, "partial"); assert.equal(sub.source.ref, "16:90"); assert.equal(sub.counts.diff, 1);
  const add = one("قال الله تعالى إن الله لا يأمر بالعدل والإحسان وإيتاء ذي القربى وينهى عن الفحشاء والمنكر والبغي يعظكم لعلكم تذكرون");
  assert.equal(add.status, "partial"); assert.equal(add.counts.added, 1);
  const del = one("قال الله تعالى الله لا إله إلا هو الحي القيوم تأخذه سنة ولا نوم له ما في السماوات وما في الأرض");
  assert.equal(del.status, "partial"); assert.equal(del.source.ref, "2:255"); assert.equal(del.counts.omitted, 1);
  const exc = one("قال الله تعالى يا أيها الذين آمنوا اتقوا الله حق تقاته ولا تموتن وأنتم مسلمون");
  assert.equal(exc.status, "partial"); assert.equal(exc.source.ref, "3:102");
  assert.ok(exc.diff.some(d => d.kind === "del" && d.source === "الا"));
});

test("C2 a negation dropped at the start of the quotation is shown as omitted and the status is partial", () => {
  const q = one("قال الله تعالى إكراه في الدين قد تبين الرشد من الغي");
  assert.equal(q.source.ref, "2:256"); assert.equal(q.status, "partial");
  assert.deepEqual(q.diff[0], { kind: "del", spoken: "", source: "لا" });
  const h = one("قال رسول الله ﷺ يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه");
  assert.equal(h.status, "partial"); assert.equal(h.diff[0].kind, "del"); assert.equal(h.diff[0].source, "لا");
  const ok = one("قال رسول الله ﷺ لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه");
  assert.equal(ok.status, "verbatim"); assert.equal(ok.counts.omitted, 0);
});

test("C3 a spoken form that is itself a real word is a wording difference, not a transcription artefact", () => {
  const isWord = w => corpus.isWord(w);
  assert.equal(wordSim("يكفر", "يغفر", fold("يكفر"), fold("يغفر")), "asr");
  assert.equal(wordSim("يكفر", "يغفر", fold("يكفر"), fold("يغفر"), isWord), "diff");
  assert.equal(wordSim("السلاه", "الصلاه", fold("السلاه"), fold("الصلاه"), isWord), "asr");     // not a word: still excused
  const a = one("قال الله تعالى إن الله لا يكفر أن يشرك به ويكفر ما دون ذلك لمن يشاء");
  assert.equal(a.status, "partial"); assert.equal(a.counts.diff, 2); assert.ok(refsOf(a).includes("4:48"));
  const b = one("قال الله تعالى قل يا عبادي الذين أسرفوا على أنفسهم لا تقنطوا من رحمة الله إن الله يغفر الذنوب جميعا إنه هو الكفور الرحيم");
  assert.equal(b.status, "partial"); assert.equal(b.source.ref, "39:53");
  assert.equal(one("قال الله تعالى الذي هلك الموت والحياة ليبلوكم أيكم أحسن عملا").status, "partial");
  const d = one("قال الله تعالى صراط الذين أنعمت عليكم غير المغضوب عليكم ولا الضالين");
  assert.equal(d.status, "partial"); assert.equal(d.counts.near, 0); assert.equal(d.counts.diff, 2);
});

test("C3 verbatim tolerates at most 20% mis-heard words", () => {
  // one non-word that sounds like the source word out of 16: a transcription artefact, still verbatim
  const one1 = one("قال الله تعالى إن الله يأمر بالعدل والإهسان وإيتاء ذي القربى وينهى عن الفحشاء والمنكر والبغي يعظكم لعلكم تذكرون");
  assert.equal(one1.status, "verbatim"); assert.equal(one1.counts.asr, 1); assert.equal(one1.diff.find(d => d.kind === "asr").source, "والاحسان");
  // four out of 16 (25%): found, every word still agrees by sound, but no longer called verbatim
  const four = one("قال الله تعالى إن الله يأمر بالعدل والإهسان وإيتاء ذي القربى وينهى عن الفهشاء والمنكر والبغي يعزكم لعلكم تزكرون");
  assert.equal(four.source.ref, "16:90"); assert.equal(four.counts.asr, 4);
  assert.equal(four.counts.diff + four.counts.added + four.counts.omitted, 0);
  assert.equal(four.status, "partial");
});

test("C4 after a hadith cue a few words that also occur in an ayah are the hadith; excerpt flags are set", () => {
  const e = one("قال رسول الله ﷺ من كان يؤمن بالله واليوم الآخر فليقتل جاره وليأخذ ماله");
  assert.equal(e.type, "h", "source is a hadith, not Qur'an 65:2");
  assert.equal(e.excerpt.tail, true, "the source goes on after the matched words");
  const q = one("قال الله تعالى إن الله يأمر بالعدل والاحسان");
  assert.deepEqual(q.excerpt, { head: false, tail: true });
  const w = one("قال الله تعالى ولا تقربوا الزنا إنه كان فاحشة وساء سبيلا");
  assert.deepEqual(w.excerpt, { head: false, tail: false });
});

// ------------------------------------------------------------------ HIGH

test("H1 a refrain verse is checked against the ayah the speaker named", () => {
  const a = one("قال الله تعالى في سورة الرحمن الآية 77 فبأي آلاء ربكما تكذبان");
  assert.equal(a.source.ref, "55:77"); assert.equal(a.attribution.code, "ref_ok");
  const b = one("قال الله تعالى في سورة المرسلات الآية 49 ويل يومئذ للمكذبين");
  assert.equal(b.source.ref, "77:49"); assert.equal(b.attribution.code, "ref_ok");
  const bad = one("قال الله تعالى في سورة الرحمن الآية 5 فبأي آلاء ربكما تكذبان");
  assert.equal(bad.attribution.code, "ref_mismatch");
});

test("H2 a spoken attribution belongs to one citation only", () => {
  const L = textual(run("قال الله تعالى في سورة الإخلاص قل هو الله أحد الله الصمد ثم قال تعالى قل أعوذ برب الفلق من شر ما خلق"));
  assert.equal(L.length, 2);
  assert.equal(L[0].attribution.code, "surah_ok"); assert.equal(L[1].source.surah, 113); assert.equal(L[1].attribution, null);
  const far = one("وقد تكلمنا أمس عن سورة البقرة وأما اليوم فنقرأ قوله تعالى ولا تقربوا الزنا إنه كان فاحشة وساء سبيلا");
  assert.equal(far.source.ref, "17:32"); assert.equal(far.attribution, null);
  const H = textual(run("قال رسول الله ﷺ إنما الأعمال بالنيات وإنما لكل امرئ ما نوى رواه البخاري وقال رسول الله ﷺ من حسن إسلام المرء تركه ما لا يعنيه رواه الترمذي"));
  assert.equal(H.length, 2);
  assert.deepEqual(H[0].attribution.said, ["bukhari"]); assert.equal(H[0].attribution.code, "collection_ok");
  assert.deepEqual(H[1].attribution.said, ["tirmidhi"]); assert.equal(H[1].attribution.code, "collection_ok");
});

test("H3 the named book contains the text: no false collection_mismatch, and the cue is not part of the quotation", () => {
  const e = one("عنه قال رسول الله ﷺ الطهور شطر الإيمان رواه مسلم");
  assert.equal(e.attribution.code, "collection_ok"); assert.ok(refsOf(e).some(r => r.startsWith("muslim:")));
  assert.equal(e.spoken, "الطهور شطر الإيمان");
  const o = one("قال رسول الله ﷺ إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى دنيا يصيبها أو إلى امرأة ينكحها فهجرته إلى ما هاجر إليه رواه مسلم");
  assert.equal(o.attribution.code, "collection_other_wording"); assert.deepEqual(o.attribution.otherWording, ["muslim"]); assert.equal(o.attribution.agrees, true);
});

test("H4 ordinary words are not collection names", () => {
  const e = one("وكل مؤمن ومسلم يعلم أن النبي ﷺ قال من حسن إسلام المرء تركه ما لا يعنيه");
  assert.equal(e.attribution, null);
  assert.equal(one("وكان الإمام مالك يقول إن النبي ﷺ قال من حسن إسلام المرء تركه ما لا يعنيه").attribution, null);
  const m = t => findCollectionMentions(F(t), 0, 99);
  assert.deepEqual(m("every believer and muslim should know that"), []);
  assert.deepEqual(m("in muslim countries people know"), []);
  assert.deepEqual(m("رواه البخاري ومسلم"), ["bukhari", "muslim"]);
  assert.deepEqual(m("reported by bukhari and muslim"), ["bukhari", "muslim"]);
  assert.deepEqual(m("أخرجه مالك في الموطأ"), ["malik"]);
  assert.deepEqual(m("متفق عليه"), ["bukhari", "muslim"]);
});

test("H5 a trailing 'رواه X' is not swallowed into the quotation and is checked", () => {
  const e = one("قال رسول الله ﷺ لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه رواه مسلم");
  assert.ok(!/رواه/.test(e.spoken), e.spoken);
  assert.ok(e.attribution && e.attribution.said.includes("muslim"));
  const b = one("قال رسول الله ﷺ لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه رواه البخاري");
  assert.equal(b.attribution.code, "collection_ok"); assert.equal(b.source.collection, "bukhari");
});

test("H8 short canonical texts right after their cue are found", () => {
  for (const [t, col] of [["إنما الأعمال بالنيات", "bukhari"], ["الدين النصيحة", "muslim"], ["كل مسكر حرام", "muslim"], ["من غشنا فليس منا", "muslim"]]) {
    const e = one(`قال رسول الله ﷺ ${t} رواه ${col === "muslim" ? "مسلم" : "البخاري"}`);
    assert.equal(e.type, "h", t); assert.equal(e.status, "partial", t);       // the beginning / a part of a longer hadith
    assert.equal(e.spoken, t); assert.equal(e.attribution.code, "collection_ok", t);
  }
  const u = one("قال رسول الله ﷺ لا يدخل الجنة قاطع متفق عليه");
  assert.deepEqual(u.attribution.said, ["bukhari", "muslim"]);
  const w = one("قال الله تعالى فويل للمصلين");
  assert.equal(w.source.ref, "107:4"); assert.equal(w.status, "verbatim");
  assert.equal(one("قال الله تعالى بسم الله الرحمن الرحيم").source.ref, "1:1");
  const h = one("قال تعالى الحمد لله رب العالمين أي الثناء على الله بصفاته");
  assert.equal(h.source.ref, "1:2"); assert.equal(h.status, "verbatim");
  // still nothing for invented sayings, however short and however they are closed
  for (const t of ["قال رسول الله ﷺ اطلبوا العلم ولو في الصين رواه مسلم", "قال رسول الله ﷺ النظافة من الإيمان رواه مسلم", "قال رسول الله ﷺ حب الوطن من الإيمان."])
    assert.equal(textual(run(t)).length, 0, t);
});

const ayahs = (s, a, b) => { const out = []; for (let k = a; k <= b; k++) out.push(corpus.P[corpus.coreRef.get(`${s}:${k}`)].n); return out.join(" "); };

test("H6 a long recitation is one citation with the full ayah range and no self-parallels", () => {
  const e = one(ayahs(55, 1, 21));
  assert.equal(e.source.ref, "55:1-21"); assert.equal(e.status, "verbatim");
  assert.ok(!e.parallels.some(p => p.surah === 55), "no sub-ranges of the same recitation listed as parallels");
  const whole = one(ayahs(55, 1, 78));
  assert.equal(whole.source.ref, "55:1-78");
  const d = one(ayahs(93, 1, 11));
  assert.equal(d.source.ref, "93:1-11"); assert.deepEqual(d.parallels.filter(p => p.surah === 93), []);
  // far longer than one alignment window: abutting citations that together cover the recitation, in order
  const L = textual(run(ayahs(2, 1, 80)));
  assert.ok(L.length >= 1 && L.length <= 4, `pieces: ${L.map(x => x.source.ref)}`);
  assert.equal(L[0].source.ayah, 1); assert.equal(L[L.length - 1].source.ayahEnd, 80);
  for (let i = 1; i < L.length; i++) assert.ok(L[i].source.ayah <= L[i - 1].source.ayahEnd + 1 && L[i].ts >= L[i - 1].te - 1);
});

test("H7 a quotation repeated shortly after itself gives one entry per repetition, each with the right source", () => {
  const ikhlas = "قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد";
  const L = textual(analyze(wordsFromText(Array(30).fill(ikhlas).join(" ")), corpus).ledger);
  assert.equal(L.length, 30); assert.ok(L.every(e => e.source.ref === "112:1-4" && e.status === "verbatim"));
  const niyya = "قال رسول الله ﷺ إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى دنيا يصيبها أو إلى امرأة ينكحها فهجرته إلى ما هاجر إليه";
  const H = textual(analyze(wordsFromText(Array(30).fill(`${niyya} ${FILL}`).join(" ")), corpus).ledger);
  assert.equal(H.length, 30); assert.ok(H.every(e => refsOf(e).includes("bukhari:1") && e.status === "verbatim" && e.source.ref === H[0].source.ref));
  const Z = textual(run("قال تعالى ولا تقربوا الزنا إنه كان فاحشة وساء سبيلا وهذه الآية عظيمة جدا يا إخواني فتأملوا فيها جيدا ثم تأملوا قوله تعالى ولا تقربوا الزنا إنه كان فاحشة وساء سبيلا"));
  assert.deepEqual(Z.map(e => e.source.ref), ["17:32", "17:32"]);
});

// ------------------------------------------------------------------ MEDIUM

// (changed with tests/four.test.mjs, defect 2: this test used to require the citation for the bare words "فقلنا إنا لله
// وإنا إليه راجعون". Everyday dhikr without a Qur'an cue, reference or brackets is no longer a citation.)
test("M a Qur'anic phrase announced as Qur'an is credited to the ayah, hadith that contain it are parallels", () => {
  const e = one("قال الله تعالى إنا لله وإنا إليه راجعون");
  assert.equal(e.source.ref, "2:156"); assert.ok(e.parallels.some(p => p.collection === "muslim"));
  assert.equal(textual(run("فقلنا إنا لله وإنا إليه راجعون")).length, 0);
});

test("M pasted ayah markers do not count as added words", () => {
  for (const t of ["قُلْ هُوَ اللَّهُ أَحَدٌ (1) اللَّهُ الصَّمَدُ (2) لَمْ يَلِدْ وَلَمْ يُولَدْ (3) وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ (4)",
    "قُلْ هُوَ اللَّهُ أَحَدٌ ﴿١﴾ اللَّهُ الصَّمَدُ ﴿٢﴾ لَمْ يَلِدْ وَلَمْ يُولَدْ ﴿٣﴾ وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ ﴿٤﴾"]) {
    const e = one(t);
    assert.equal(e.status, "verbatim"); assert.equal(e.source.ref, "112:1-4"); assert.equal(e.counts.added, 0);
  }
});

test("M reference parser: word orders, ranges, counts, hyphenated and alternative names, impossible ayahs", () => {
  const R = t => findQuranReferences(F(t)).map(r => [r.surah, r.ayah, r.ayahEnd]);
  assert.deepEqual(R("الآية 5 من سورة المائدة"), [[5, 5, null]]);
  assert.deepEqual(R("Surah Al-Kahf verses 1 to 10"), [[18, 1, 10]]);
  assert.deepEqual(R("سورة البقرة الآيات 1 إلى 5"), [[2, 1, 5]]);
  assert.deepEqual(R("سورة النساء 3 مرات"), [[4, null, null]]);
  assert.deepEqual(R("Surah Al-Ikhlas 3 times"), [[112, null, null]]);
  assert.deepEqual(R("Surah Ta-Ha verse 14"), [[20, 14, null]]);
  assert.deepEqual(R("سورة الإخلاص الآية 9"), [[112, null, null]]);          // Al-Ikhlas has 4 ayahs
  assert.deepEqual(R("In this surah said the scholars"), []);                   // "said" is not Surah Sad
  for (const [name, n] of [["بني إسرائيل", 17], ["الإسراء", 17], ["غافر", 40], ["المؤمن", 40], ["الإنسان", 76], ["الدهر", 76], ["التوبة", 9], ["براءة", 9],
    ["فصلت", 41], ["حم السجدة", 41], ["المسد", 111], ["تبت", 111], ["الإخلاص", 112], ["التوحيد", 112]])
    assert.deepEqual(R(`في سورة ${name}`), [[n, null, null]], name);
  // end to end: "3 مرات" is not ayah 3, and the surah is confirmed
  const e = one("اقرؤوا سورة الإخلاص 3 مرات قل هو الله أحد الله الصمد لم يلد ولم يولد");
  assert.equal(e.attribution.code, "surah_ok");
  const v = one("الآية 5 من سورة المائدة اليوم أحل لكم الطيبات وطعام الذين أوتوا الكتاب حل لكم");
  assert.equal(v.attribution.code, "ref_ok");
});

test("M identical ayahs: the source is the one in the surah the speaker named", () => {
  const e = one("قال تعالى في سورة لقمان أولئك على هدى من ربهم وأولئك هم المفلحون");
  assert.equal(e.source.ref, "31:5"); assert.ok(e.parallels.some(p => p.ref === "2:5")); assert.equal(e.attribution.code, "surah_ok");
  assert.equal(one("قال تعالى أولئك على هدى من ربهم وأولئك هم المفلحون").source.ref, "2:5");
});

test("M words that are not strings do not crash the analysis", () => {
  for (const w of [[{ w: 255 }], [{ w: null }], [{}], [null], [undefined, { w: "قال" }], ["قل", "هو", "الله", "أحد"], "x", null])
    assert.doesNotThrow(() => analyze(w, corpus));
  const words = wordsFromText(`${FILL} قال الله تعالى قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد ${FILL}`);
  const L = analyze(words.map(x => x.w), corpus).ledger;        // bare strings instead of {w}
  assert.equal(textual(L)[0].source.ref, "112:1-4");
  assert.equal(normMixed({ w: 255 }), "255"); assert.equal(normMixed(null), "");
});

test("M dhikr in plain speech is not a citation; announced, it is", () => {
  assert.equal(textual(run("سبحان الله وبحمده سبحان الله العظيم")).length, 0);
  const e = one("قال رسول الله ﷺ كلمتان خفيفتان على اللسان ثقيلتان في الميزان حبيبتان إلى الرحمن سبحان الله وبحمده سبحان الله العظيم");
  assert.ok(refsOf(e).includes("bukhari:6682") || e.type === "h");
});

// ------------------------------------------------------------------ LOW

test("L presentation forms, Persian/Urdu letters and Eastern digits are folded", () => {
  assert.equal(normMixed("ﻗﻞ"), "قل"); assert.equal(normMixed("ﷲ"), "الله");
  assert.equal(normMixed("کتاب"), "كتاب"); assert.equal(normMixed("علی"), "علي");
  assert.equal(normMixed("۲۵۵"), "255"); assert.equal(normMixed("٢٥٥"), "255");
  const e = one("ﻗﻞ ﻫﻮ ﺍﻟﻠﻪ ﺃﺣﺪ ﺍﻟﻠﻪ ﺍﻟﺼﻤﺪ ﻟﻢ ﻳﻠﺪ ﻭﻟﻢ ﻳﻮﻟﺪ");
  assert.equal(e.source.ref, "112:1-3");
});

test("L a pack with more passages than the 16-bit index can address is refused with a clear error", async () => {
  assert.equal(MAX_PACK_PASSAGES, 65536);
  const c = await loadCorpus();
  const real = c.fetcher;
  c.fetcher = async (name, kind) => {
    if (name === "packs/huge/meta.json") return { shards: 1, books: {}, domain: "x", domain_ar: "x" };
    if (name === "packs/huge/passages_0.json") return Array.from({ length: 65537 }, (_, i) => ({ r: `huge:${i}`, t: "b", n: "ا ب" }));
    if (name.startsWith("packs/huge/")) return real("idx2.bin", kind);
    return real(name, kind);
  };
  await assert.rejects(() => c.loadPack("huge"), /65536|16-bit/);
});

// ------------------------------------------------------------------ links and labels (engine C7; data C1, C2, C3, M1, M5)

test("C7 no two hadith share a deep link; doubtful addresses fall back to the book page", () => {
  const seen = new Map();
  for (let pid = corpus.NQ; pid < corpus.coreN; pid++) {
    const d = corpus.describe(pid);
    assert.ok(["hadith", "book", "collection"].includes(d.linkLevel), d.ref);
    if (d.linkLevel !== "hadith") continue;
    assert.ok(!seen.has(d.url), `${d.ref} and ${seen.get(d.url)} share ${d.url}`);
    seen.set(d.url, d.ref);
  }
  const D = r => corpus.describe(corpus.coreRef.get(r));
  for (const r of ["tirmidhi:2298", "tirmidhi:2146", "malik:146", "malik:168", "malik:221", "ibnmajah:2435"]) {
    const d = D(r); if (!d) continue;
    assert.equal(d.linkLevel, "book", r); assert.match(d.url, /^https:\/\/sunnah\.com\/[a-z]+\/\d+$/, r);
  }
  assert.equal(D("bukhari:1").url, "https://sunnah.com/bukhari/1/1"); assert.equal(D("bukhari:1").linkLevel, "hadith");
  assert.equal(D("2:255") === undefined, false);
  assert.equal(corpus.describe(corpus.coreRef.get("2:255")).linkLevel, "ayah");
});

test("data M1 a hadith with no book number links by its printed number, not to the collection home page", () => {
  const d = corpus.describe(corpus.coreRef.get("ibnmajah:198"));
  assert.equal(d.url, "https://sunnah.com/ibnmajah:198"); assert.equal(d.linkLevel, "hadith");
});

test("data C1/M5 Sahih Muslim: sub-numbers are kept (2609a) and a missing printed number is never replaced by the running number", () => {
  const a = corpus.describe(corpus.coreRef.get("muslim:6643"));
  assert.equal(a.number, "2609a"); assert.equal(a.label, "صحيح مسلم — رقم 2609a"); assert.equal(a.ref, "muslim:6643");
  const labels = new Map();
  for (let pid = corpus.NQ; pid < corpus.coreN; pid++) {
    if (!corpus.P[pid].r.startsWith("muslim:")) continue;
    const d = corpus.describe(pid);
    if (d.numberMissing) { assert.equal(d.number, null); assert.match(d.label, /بلا رقم/); assert.notEqual(d.linkLevel, "hadith"); continue; }
    assert.ok(!labels.has(d.label), `${d.ref} and ${labels.get(d.label)} share the label ${d.label}`);
    labels.set(d.label, d.ref);
  }
  const m = corpus.describe(corpus.coreRef.get("muslim:1350"));
  assert.equal(m.numberMissing, true); assert.ok(!m.label.includes("1350"));
});

test("data C2 Muwatta labels say that the number is the dataset's own count", () => {
  const d = corpus.describe(corpus.coreRef.get("malik:146"));
  assert.equal(d.numbering, "dataset"); assert.match(d.label, /ترقيم قاعدة البيانات/); assert.equal(d.ref, "malik:146");
  assert.equal(corpus.describe(corpus.coreRef.get("bukhari:1")).numbering, "printed");
});

// ------------------------------------------------------------------ with packs

const EFILL = "So brothers and sisters, today we want to reflect on good character and how it shapes the life of a believer.";
const en = await loadCorpusWith(["en-quran", "en-hadith"]);
const runEn = t => analyze(wordsFromText(`${EFILL} ${t} ${EFILL}`), en).ledger;

test("C5 with book packs loaded, a verse with a spoken reference is still the Qur'an, and the reference is not quoted text", async () => {
  const books = await loadCorpusWith(["tafsir", "fiqh"]);
  const e = one("قال الله تعالى في سورة النحل الآية 90 إن الله يأمر بالعدل والاحسان", books);
  assert.equal(e.type, "q"); assert.equal(e.source.ref, "16:90"); assert.equal(e.status, "verbatim");
  assert.equal(e.attribution.code, "ref_ok");
  assert.ok(!/سورة|90/.test(e.spoken), e.spoken);
  assert.equal(run("قال الله تعالى في سورة النحل الآية 90 إن الله يأمر بالعدل والاحسان", books).filter(x => x.noteCode === "ref_only").length, 0);
  // L: the order in which packs are loaded changes nothing
  const other = await loadCorpusWith(["fiqh", "tafsir"]);
  const t = "قال الله تعالى إن الله يأمر بالعدل والإحسان وإيتاء ذي القربى وينهى عن الفحشاء والمنكر والبغي يعظكم لعلكم تذكرون ثم قال رسول الله ﷺ إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى دنيا يصيبها أو إلى امرأة ينكحها فهجرته إلى ما هاجر إليه";
  const shape = c => run(t, c).map(x => [x.status, x.source && x.source.ref, x.parallels.map(p => p.ref), x.inBooks.map(p => p.ref)]);
  assert.deepEqual(shape(books), shape(other));
  assert.ok(run(t, books).some(x => x.inBooks.length > 0));
  // L: the note for an unmatched scholar's saying depends on BOOK packs, not on any pack
  const s = "قال ابن القيم رحمه الله في القلب شعث لا يلمه إلا الإقبال على الله";
  assert.equal(run(s, books).find(x => x.cue === "saying").noteCode, "saying_notfound");
  assert.equal(run(s, en).find(x => x.cue === "saying").noteCode, "saying_core_only");
  assert.equal(run(s).find(x => x.cue === "saying").noteCode, "saying_core_only");
});

test("C1 (English) a removed negation is not verbatim", () => {
  const ok = textual(runEn("Allah says in Surah Al-Baqarah verse 286: Allah does not charge a soul except with that within its capacity."))[0];
  assert.equal(ok.status, "verbatim"); assert.equal(ok.source.ref, "2:286");
  const bad = textual(runEn("Allah says in Surah Al-Baqarah verse 286: Allah does charge a soul except with that within its capacity."))[0];
  assert.equal(bad.status, "partial"); assert.ok(bad.diff.some(d => d.kind === "del" && d.source === "not"));
});

test("M the English basmala and praise formula in plain speech are not a citation", () => {
  const L = runEn("In the name of Allah, the Most Gracious, the Most Merciful. All praise is due to Allah, Lord of the worlds, and peace and blessings be upon His Messenger.");
  assert.equal(textual(L).length, 0, JSON.stringify(textual(L).map(x => x.source.ref)));
  const m = formulaMask(F("in the name of allah the most gracious the most merciful"));
  assert.ok(m.every(x => x === 1));
});

test("H4 (English) 'believer and Muslim' names no book; 'reported by Bukhari' does; 'said' is not Surah Sad", () => {
  const a = textual(runEn("Every believer and Muslim should know that the Prophet said: The reward of deeds depends upon the intentions and every person will get the reward according to what he has intended."))[0];
  assert.ok(a && refsOf(a).includes("bukhari:1")); assert.equal(a.attribution, null);
  const b = textual(runEn("The Prophet said: The reward of deeds depends upon the intentions and every person will get the reward according to what he has intended. Reported by Bukhari."))[0];
  assert.equal(b.attribution.code, "collection_ok");
  const c = textual(runEn("In this surah said the scholars there is a great lesson. Allah says: Indeed, Allah orders justice and good conduct and giving to relatives and forbids immorality and bad conduct and oppression."))[0];
  assert.equal(c.source.ref, "16:90"); assert.equal(c.attribution, null);
});

test("data C3 English Muwatta passages never take part in matching or in 'by meaning' retrieval", () => {
  let n = 0, pid = -1;
  for (let p = en.coreN; p < en.N; p++) if (en.P[p].r.startsWith("en:malik:")) { n++; assert.ok(en.isDead(p)); if (pid < 0 && en.P[p].d.split(/\s+/).length > 60) pid = p; }
  assert.ok(n > 1000);
  assert.ok(![...en.enRef.keys()].some(k => k.startsWith("malik:")), "no Arabic Muwatta hadith is shown with an English Muwatta text as its translation");
  const text = en.P[pid].d.split(/\s+/).slice(8, 55).join(" ");
  const L = runEn(`The Prophet said: ${text}`);
  for (const e of L) for (const s of [e.source, ...(e.parallels || []), ...(e.candidates || []), ...(e.suggestions || [])]) assert.ok(!s || s.collection !== "malik" || s.via !== "en", "resolved through an English Muwatta passage");
  if (en.vec) {
    const q = en.vec.embed(text.toLowerCase().split(/\s+/).slice(0, 12), "en");
    if (q) for (const h of en.vec.search(q, 50, p => !en.isDead(p))) assert.ok(!en.P[h.pid].r.startsWith("en:malik:"));
  }
});

test("L English speech without the English packs: the 'not found' entry says the pack is missing", () => {
  const L = analyze(wordsFromText(`${EFILL} The Prophet said: The reward of deeds depends upon the intentions and every person will get the reward according to what he has intended. ${EFILL}`), corpus).ledger;
  assert.ok(L.length >= 1 && L.every(e => e.status === "notfound"));
  assert.equal(L[0].noteCode, "en_pack_missing");
});

test("purity: an analysis leaves no trace in the next one", () => {
  const B = `${FILL} قال رسول الله ﷺ إنما الأعمال بالنيات وإنما لكل امرئ ما نوى رواه البخاري ${FILL}`;
  const before = JSON.stringify(analyze(wordsFromText(B), corpus).ledger);
  run("قال الله تعالى في سورة الرحمن الآية 77 فبأي آلاء ربكما تكذبان"); run(ayahs(55, 1, 30));
  assert.equal(JSON.stringify(analyze(wordsFromText(B), corpus).ledger), before);
});

test("H2/H4 a mis-transcribed 'رواه' still attributes; a bare unmistakable name counts only right after the quotation", () => {
  const a = one("قال رسول الله ﷺ من حسن إسلام المرء تركه ما لا يعنيه رواا الترمذي");
  assert.deepEqual(a.attribution.said, ["tirmidhi"]); assert.equal(a.attribution.code, "collection_ok");
  const b = one("قال رسول الله ﷺ من حسن إسلام المرء تركه ما لا يعنيه الترمذي");
  assert.deepEqual(b.attribution.said, ["tirmidhi"]);
  const c = one("وكان الترمذي رحمه الله إماما حافظا وقد علمنا أن النبي ﷺ قال من حسن إسلام المرء تركه ما لا يعنيه");
  assert.equal(c.attribution, null);
});

test("H8 reference words between the cue and a short text are skipped", () => {
  const e = one("قال رسول الله ﷺ في صحيح مسلم الطهور شطر الإيمان.");
  assert.equal(e.source.collection, "muslim"); assert.equal(e.attribution.code, "collection_ok"); assert.equal(e.status, "partial");
});

test("C1 strictness is not triggered by a chance word after the end of the quotation", () => {
  // the speech goes on with "ومن ...", which is also the second word of the next ayah (22:30 "ذلك ومن يعظم ...")
  const e = one(`${ayahs(22, 27, 29)} ومن هنا نعلم أن الحج عبادة عظيمة`);
  assert.equal(e.source.ref, "22:27-29"); assert.equal(e.status, "verbatim"); assert.equal(e.counts.omitted, 0);
});

test("C3 a real-word slip is reported as a difference but the quotation is still found", () => {
  // "كل" for "قل", "أهد" for "أحد" (both real words): partial, never lost and never verbatim
  const e = one("قال الله تعالى كل هو الله أهد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد");
  assert.equal(e.source.surah, 112); assert.equal(e.status, "partial"); assert.ok(e.counts.diff >= 1);
});

// ------------------------------------------------------------------ follow-up: rebuilt data (hadith without chains), packs, continuation

test("a recited surah is the Qur'an; hadith that contain it are parallels — the hadith itself when its own words are quoted", () => {
  const ikhlas = "قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد";
  const e = one(ikhlas);
  assert.equal(e.type, "q"); assert.equal(e.source.ref, "112:1-4"); assert.equal(e.status, "verbatim");
  assert.ok(e.parallels.some(p => p.type === "h"), "hadith that narrate the recitation are listed as parallels");
  // announced as a hadith, the whole surah is still the Qur'an (whole ayahs)
  assert.equal(one(`قال رسول الله ﷺ ${ikhlas}`).source.ref, "112:1-4");
  // the narration around the surah is quoted too: now the hadith is the source
  const h = one(`وفي الحديث أقبلت مع رسول الله صلى الله عليه وسلم فسمع رجلا يقرأ ${ikhlas} فقال رسول الله صلى الله عليه وسلم وجبت فسألته ماذا يا رسول الله قال الجنة`);
  assert.equal(h.type, "h"); assert.ok(/وجبت/.test(h.spoken));
});

test("C6 a chain of narrators read aloud is not a citation", () => {
  for (const t of ["حدثنا عبد الله بن يوسف قال أخبرنا مالك عن نافع عن عبد الله بن عمر",
    "حدثنا الحميدي عبد الله بن الزبير قال حدثنا سفيان قال حدثنا يحيى بن سعيد الأنصاري قال أخبرني محمد بن إبراهيم التيمي",
    "وحدثنا أبو الربيع وأبو كامل قالا حدثنا حماد وهو ابن زيد جميعا عن أيوب عن نافع"])
    assert.deepEqual(run(t).filter(e => e.source).map(e => e.source.ref), [], t);
});

test("C6 passages that still carry their chain (m = 0): the chain gives no evidence, the text after it is found from its beginning", () => {
  let tried = 0, found = 0;
  for (let pid = corpus.NQ; pid < corpus.coreN && tried < 25; pid += 7) {
    const p = corpus.P[pid];
    if (p.m === 1 || !(p.s >= 10)) continue;
    const t = p.n.split(" ");
    if (t.length - p.s < 12 || /الاسناد|مثله|نحوه/.test(p.n)) continue;
    tried++;
    assert.equal(corpus.chainLen(pid), p.s);
    const refs = L => L.filter(e => e.source).flatMap(e => [e.source, ...e.parallels]).map(s => s.ref);
    assert.ok(!refs(run(t.slice(0, p.s).join(" "))).includes(p.r), `${p.r}: cited from its chain alone`);
    const e = run(t.slice(p.s).join(" ")).find(x => x.source && refsOf(x).includes(p.r));
    if (!e) continue;
    found++;
    if (e.source.ref === p.r) assert.equal(e.excerpt.head, false, p.r);
    // chain + text: the quotation never reaches back into the chain
    const both = run(t.join(" ")).find(x => x.source && x.source.ref === p.r);
    if (both) assert.ok(!both.spoken.includes(t.slice(0, 3).join(" ")), `${p.r}: ${both.spoken}`);
  }
  assert.ok(tried >= 20 && found >= tried - 3, `found ${found} of ${tried}`);
  assert.equal(corpus.chainLen(corpus.coreRef.get("bukhari:1")), 0);
  assert.equal(corpus.chainLen(corpus.coreRef.get("2:255")), 0);
});

test("excerpt.head for hadith: false when the quotation starts at the first word of the text, whatever announces it in the source", () => {
  const a = one("قال رسول الله ﷺ إنما الأعمال بالنيات وإنما لكل امرئ ما نوى");
  assert.deepEqual(a.excerpt, { head: false, tail: true });
  // the indexed text of this one opens with its own "قال رسول الله صلى الله عليه وسلم": that is not quoted text
  const b = one("قال رسول الله ﷺ الطهور شطر الإيمان والحمد لله تملأ الميزان");
  assert.equal(b.excerpt.head, false); assert.equal(b.spoken, "الطهور شطر الإيمان والحمد لله تملأ الميزان");
  const c = one("فمن كانت هجرته إلى دنيا يصيبها أو إلى امرأة ينكحها فهجرته إلى ما هاجر إليه");
  assert.equal(c.excerpt.head, true);
  // the announcing phrase is never part of the quotation, even when the transcript garbles the cue
  const d = one("كال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى");
  assert.equal(d.spoken, "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى");
});

test("C4 an announced quotation that runs on with words the source does not have is flagged tailUnmatched (no status change)", () => {
  const fab = "قال رسول الله ﷺ من كان يؤمن بالله واليوم الآخر فليقتل جاره وليأخذ ماله";
  // the reviewer's input as it stands: no punctuation, the transcript ends right after the fabricated ending
  const [bad] = textual(analyze(wordsFromText(`${FILL} ${fab}`), corpus).ledger);
  assert.equal(bad.type, "h"); assert.equal(bad.spoken, "من كان يؤمن بالله واليوم الآخر");
  assert.equal(bad.status, "verbatim", "the six matched words are exact: the flag does not change the status");
  assert.deepEqual(bad.excerpt, { head: false, tail: true });
  assert.equal(bad.tailUnmatched, true); assert.equal(bad.tailUnmatchedSpoken, "فليقتل جاره وليأخذ ماله");
  assert.equal(bad.noteCode, undefined);
  // punctuated: the sentence visibly runs on
  const P = `${FILL}.`;
  const runP = t => textual(analyze(wordsFromText(`${P} ${t} ${P}`), corpus).ledger);
  const [bad2] = runP(`${fab}.`);
  assert.equal(bad2.tailUnmatched, true); assert.equal(bad2.status, "verbatim"); assert.match(bad2.tailUnmatchedSpoken, /^فليقتل جاره وليأخذ ماله/);
  // closed by the next announcing phrase within 12 words, no punctuation anywhere
  const [bad3] = textual(run(`${fab} وقال الله تعالى ولا تقربوا الزنا إنه كان فاحشة وساء سبيلا`));
  assert.equal(bad3.tailUnmatched, true);
  // a legitimate partial quotation, a full stop, then commentary: not flagged
  const [ok] = runP("قال رسول الله ﷺ إنما الأعمال بالنيات وإنما لكل امرئ ما نوى. وهذا الحديث أصل عظيم من أصول الدين يا إخواني.");
  assert.equal(ok.status, "verbatim"); assert.equal(ok.excerpt.tail, true); assert.equal(ok.tailUnmatched, false); assert.equal(ok.tailUnmatchedSpoken, undefined);
  // the speaker goes on WITH the source's next words (a few of them garbled): not flagged
  const [cont] = runP("قال رسول الله ﷺ إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى دنيا يصيبها.");
  assert.equal(cont.tailUnmatched, false);
  // the whole text: nothing left in the source
  const [full] = runP("قال رسول الله ﷺ إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى دنيا يصيبها أو إلى امرأة ينكحها فهجرته إلى ما هاجر إليه. وهذا أصل عظيم من أصول الدين.");
  assert.equal(full.excerpt.tail, false); assert.equal(full.tailUnmatched, false);
  // "رواه ..." right after the words is not a continuation
  const [r] = runP("قال رسول الله ﷺ إنما الأعمال بالنيات وإنما لكل امرئ ما نوى رواه البخاري.");
  assert.equal(r.status, "verbatim"); assert.equal(r.tailUnmatched, false);
  // the same for an ayah quoted in part and continued with other words in the same sentence
  const [q] = runP("قال الله تعالى إن الله يأمر بالعدل والإحسان وإيتاء ذي القربى وهذه الآية جامعة لمكارم الأخلاق كلها.");
  assert.equal(q.source.ref, "16:90"); assert.equal(q.status, "verbatim"); assert.equal(q.tailUnmatched, true);
  // no punctuation at all and neither a cue nor the end of the transcript within 12 words: nothing can be said
  const raw = one(fab);
  assert.equal(raw.status, "verbatim"); assert.equal(raw.excerpt.tail, true); assert.equal(raw.tailUnmatched, false);
  // no cue before the words: never flagged
  const [nocue] = textual(analyze(wordsFromText(`${FILL} من كان يؤمن بالله واليوم الآخر فليقتل جاره وليأخذ ماله`), corpus).ledger);
  if (nocue) assert.equal(nocue.tailUnmatched, false);
  // every textual entry carries the flag as a boolean
  for (const e of textual(run("قال الله تعالى قل هو الله أحد الله الصمد"))) assert.equal(typeof e.tailUnmatched, "boolean");
});

test("with every book pack loaded a primary source is never replaced by a book (demo samples)", async () => {
  const { readFile } = await import("node:fs/promises");
  const all = await loadCorpusWith(["hadith2", "tafsir", "fiqh", "seerah", "aqeedah"]);
  for (const id of ["demo-clean", "demo-noisy", "demo-en"]) {
    const { words } = JSON.parse(await readFile(new URL(`../public/samples/${id}.json`, import.meta.url), "utf8"));
    const A = textual(analyze(words, corpus).ledger), B = analyze(words, all).ledger;
    assert.ok(A.length >= 1, id);
    for (const e of A) {
      const f = B.find(x => x.source && x.ts < e.te && x.te > e.ts);
      assert.ok(f, `${id}: ${e.source.ref} is lost when packs are loaded`);
      assert.notEqual(f.source.type, "b", `${id}: ${e.source.ref} became ${f.source.ref}`);
      assert.equal(f.source.type, e.source.type, `${id}: ${e.source.ref} became ${f.source.ref}`);
    }
    if (id !== "demo-clean") continue;
    // Surah al-Ikhlas, recited at 2:04
    const ik = B.find(x => x.source && /كفوا/.test(x.spoken));
    assert.equal(ik.source.ref, "112:1-4"); assert.equal(ik.type, "q"); assert.equal(ik.status, "verbatim");
    assert.ok(Math.abs(ik.start - 124) < 4, `starts at ${ik.start}s`);
    assert.ok(ik.inBooks.length > 0, "the tafsir that quotes the surah is listed under 'also in books'");
  }
});

// ------------------------------------------------------------------ performance work must not change any result

test("perf: the banded alignment and the batched dense search give the same ledger as the plain ones", async () => {
  const { readFile } = await import("node:fs/promises");
  const { words } = JSON.parse(await readFile(new URL("../public/samples/demo-noisy.json", import.meta.url), "utf8"));
  const more = wordsFromText([
    "قال الله تعالى الله لا إله إلا هو الحي القيوم لا تأخذه سنة ولا نوم له ما في السماوات وما في الأرض",
    FILL, "وفي الحديث عن النبي ﷺ أنه قال من حسن إسلام المرء تركه ما لا يعنيه رواه الترمذي", FILL,
    "وقد بين النبي صلى الله عليه وسلم أن الرجل القوي هو الذي يضبط نفسه ساعة الغضب", FILL, ayahs(93, 1, 11), FILL,
    "قال رسول الله ﷺ إنما الأعمال بالنيات وإنما لكل امرئ ما نوى", ayahs(2, 1, 20)].join(" "));
  const text = [...words, ...more];
  const strip = L => JSON.stringify(L);
  assert.equal(strip(analyze(text, corpus).ledger), strip(analyze(text, corpus, { band: 0 }).ledger));
  if (corpus.vec) {
    const toks = "من حسن اسلام المرء تركه ما لا يعنيه وان الله يحب المحسنين الذين ينفقون في السراء والضراء".split(" ");
    for (const Q of [1, 2, 3, 5, 6, 7]) {
      const qs = Array.from({ length: Q }, (_, x) => corpus.vec.embed(toks.slice(x, x + 5 + x)));
      const ok = pid => pid % 5 !== 2;
      assert.deepEqual(corpus.vec.searchMany(qs, 50, ok), qs.map(q => corpus.vec.search(q, 50, ok)), `${Q} queries`);
    }
  }
});

test("perf: a one-edit test without allocation agrees with the edit distance", async () => {
  const { within1, editDistance } = await import("../public/js/text.js");
  const L = "ابتثج"; let r = 7;
  const rnd = n => { r = (r * 1103515245 + 12345) >>> 0; return (r >>> 8) % n; };
  const word = () => { let s = ""; for (let i = 1 + rnd(6); i > 0; i--) s += L[rnd(3)]; return s; };
  for (let k = 0; k < 20000; k++) { const a = word(), b = word(); assert.equal(within1(a, b), editDistance(a, b, 1) <= 1, `${a} ${b}`); }
  assert.equal(fold("الصراط"), "السرات"); assert.equal(fold("abc"), "abc");
});
