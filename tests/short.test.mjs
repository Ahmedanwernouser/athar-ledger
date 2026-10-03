// node --test tests/short.test.mjs
// Short EXACT fragments of an ayah (engine step 3d): three or more words, Qur'an only. What must be found, and — more
// important for sacred text — what must NOT become a citation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadCorpus, EVAL } from "../eval/lib.mjs";
import { hasGold, loadGold } from "../eval/tweets.mjs";
import { analyze } from "../public/js/engine.js";
import { wordsFromText, tokenizeTranscript } from "../public/js/text.js";

const corpus = await loadCorpus();
const run = (text, opts) => analyze(wordsFromText(text), corpus, opts).ledger;
const textual = L => L.filter(e => e.status === "verbatim" || e.status === "partial");
const one = (text, opts) => { const L = textual(run(text, opts)); assert.equal(L.length, 1, `one citation expected in: ${text} (got ${L.map(e => e.source.ref + " " + e.spoken).join(" | ") || "none"})`); return L[0]; };
const none = (text, opts) => { const L = textual(run(text, opts)); assert.equal(L.length, 0, `no citation expected in: ${text} (got ${L.map(e => `${e.source.ref} ${e.status} «${e.spoken}»`).join(" | ")})`); };
const FILL = "ثم اعلموا يا إخواني أن هذا الأمر عظيم";
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

test("short fragments: found with the right surah and ayah, as exact words of the ayah", () => {
  const cases = [
    // announced by a cue
    ["قال تعالى واستعينوا بالصبر والصلاة", "2:45", 3],
    ["قال تعالى قل أعوذ برب الناس", "114:1", 4],
    ["قال تعالى واذكر ربك إذا نسيت وهذا من الأدب مع الله", "18:24", 4],
    ["قال تعالى إن الدين عند الله الإسلام", "3:19", 5],
    ["يقول الله تعالى وتظنون بالله الظنونا", "33:10", 3],
    ["قوله تعالى تحسبهم جميعا وقلوبهم شتى", "59:14", 4],
    ["قال الله تعالى ادعوني أستجب لكم", "40:60", 3],
    ["قال تعالى لا إكراه في الدين", "2:256", 4],
    // written inside Qur'an brackets, or enclosed exactly by quotation marks / brackets
    ["- ﴿ وَاذْكُر ربّكَ إِذَا نَسِيتَ ﴾ - سُبحان الله", "18:24", 4],
    ["﴿واستعينوا بالصبر والصلاة﴾", "2:45", 3],
    ["{وتظنون بالله الظنونا}", "33:10", 3],
    ["\"وَاستَعينوا بِالصَّبرِ وَالصَّلاةِ\"", "2:45", 3],
    ["لا تفوّت قراءة سورة (قل هو الله أحد) في هذه الليالي", "112:1", 4],
    // in plain speech: informative words only
    ["واستعينوا بالصبر والصلاة", "2:45", 3],
    ["قل اعوذ برب الناس", "114:1", 4],
    [`${FILL} وتظنون بالله الظنونا وهذا عجيب`, "33:10", 3],
    [`${FILL} تحسبهم جميعا وقلوبهم شتى`, "59:14", 4],
    ["وين المصلحه حتى ياخذه الله اخذ عزيز مقتدر لأن فضله عظيم", "54:42", 3],
    ["ما قل ودل #ذرهم في خوضهم يلعبون", "6:91", 4],
  ];
  for (const [text, ref, words] of cases) {
    const e = one(text);
    assert.equal(e.source.ref, ref, text); assert.equal(e.source.type, "q");
    assert.equal(e.status, "verbatim", text);
    assert.deepEqual(e.counts, { exact: words, asr: 0, near: 0, diff: 0, added: 0, omitted: 0 }, text);
    assert.equal(e.te - e.ts, words, text);
  }
});

test("short fragments: flagged as such, with the excerpt flags of any partial-ayah quotation", () => {
  const a = one("قال تعالى واستعينوا بالصبر والصلاة");          // the beginning of 2:45
  assert.equal(a.shortFragment, true); assert.deepEqual(a.excerpt, { head: false, tail: true }); assert.equal(a.cue, "quran");
  const b = one(`${FILL} وتظنون بالله الظنونا`);                 // the end of 33:10
  assert.deepEqual(b.excerpt, { head: true, tail: false });
  const c = one("قل اعوذ برب الناس");                           // a whole ayah
  assert.deepEqual(c.excerpt, { head: false, tail: false });
  // a quotation of ordinary length is labelled the same way and is not a "short fragment"
  const d = one("وهذا الأمر عظيم إذا تداينتم بدين إلى أجل مسمى فاكتبوه وليكتب بينكم كاتب بالعدل ثم نقول");
  assert.equal(d.status, "verbatim"); assert.equal(d.shortFragment, false); assert.deepEqual(d.excerpt, { head: true, tail: true });
});

test("short fragments: the strict rules still apply", () => {
  // the negation directly before the quoted words was left out -> partial, shown as an omitted word
  const e = one("قال تعالى تقربوا الصلاة وأنتم سكارى");
  assert.equal(e.source.ref, "4:43"); assert.equal(e.status, "partial"); assert.equal(e.counts.omitted, 1);
  assert.ok(e.diff.some(d => d.kind === "del" && d.source === "لا"));
  // what was announced as the ayah runs on with words that are not the ayah's
  const t = one("وقال الله تعالى واستعينوا بالصبر والصلاة ثم ذهب الرجل إلى السوق واشترى طعاما كثيرا لأهله.");
  assert.equal(t.status, "verbatim"); assert.equal(t.tailUnmatched, true);
});

test("short fragments: one changed word, or a misspelt one, is never a short citation", () => {
  for (const text of ["قال تعالى واستعينوا بالصبر والزكاة", "واستعينوا بالصبر والزكاة", "قال تعالى واستعينوا بالسبر والصلاة", "واستعينوا بالسبر والصلاة",
    "قال تعالى قل أعوذ برب البشر", "قل ألوذ برب الناس", "﴿ واذكر ربك إذا غفلت ﴾", "قال تعالى واستعينوا بالصبر ثم الصلاة"]) {
    const L = run(text);
    assert.equal(textual(L).length, 0, `${text} -> ${textual(L).map(e => e.status + " " + e.source.ref).join()}`);
    assert.ok(!L.some(e => e.status === "verbatim"), text);
  }
});

test("short fragments: ordinary speech that happens to contain a run of Qur'an words is not cited", () => {
  const sentences = [
    "جلسنا في البيت وكان الجو بين ذلك قواما",
    "يقول بعضهم إن هذا الكلام من عند الله ولا دليل لهم",
    "تغير الناس من بعد ما جاءهم الخبر من المدينة",
    "أخبرونا عن ذلك إن كنتم صادقين في دعواكم",
    "سيبقى أثر هذا العمل إلى يوم القيامة بين الناس",
    "نسأل الله أن يجعلنا من الذين آمنوا وعملوا الصالحات في كل حين",
    "هذه هي الحياة الدنيا وزينتها التي يتنافس فيها الناس",
    "نشكر الله على الدوام في السراء والضراء لأنه أهل لذلك",
    "خير الليالي ليلة القدر خير صلاة عند المسلمين صلاة الفجر",
    "قتلت الحرب أفضل من يمشي على قدم في تلك البلاد",
    "تكلم المحاضر طويلا عن عيسى ابن مريم وعن أمه",
    "وجد في بيت المقدس إبراهيم وموسى وعيسى في نفر من الأنبياء",
    "يزكيان زكاة الرجل الواحد إذا كان لكل واحد منهما نصاب",
    "الإيمان بالله واليوم الآخر من أصول العقيدة عند المسلمين",
    "ثم قال يا قوم اسمعوا كلامي واعقلوه",
    "نرجو المغفرة فإن الله غفور رحيم بعباده",
    "لا تناقش من يريد أن يظهرك مخطئا",
    "والله يهدي من يشاء من عباده الى الخير",
    "نساعد في حينا اليتامى والمساكين وابن السبيل كل شهر",
    "فتح المسلمون البلاد في مشارق الأرض ومغاربها في سنوات قليلة",
    "اجتمع في العقبة من الأنصار اثني عشر نقيبا",
    "كنت حاسه انه خير له وأن الله له حكمة ولطف خفي",
    "لولا أن من الله تعالى علينا لهلكنا",
    "ثم اعلموا يا إخواني واذكر ربك إذا نسيت وهذا عظيم",       // three content words from the middle of an ayah, unannounced
    "ثم إن الدين عند الله الإسلام يا إخواني",                  // common words only: needs a cue
  ];
  assert.ok(sentences.length >= 15);
  for (const s of sentences) {
    assert.ok(longestQuranRun(s) >= 3, `the example must contain 3 consecutive Qur'an words: ${s}`);
    none(s); none(`${FILL} ${s} ${FILL}`);
  }
});

test("short fragments: the project's filler sentences give no citation, alone or joined", () => {
  const F = JSON.parse(readFileSync(path.join(EVAL, "fillers.json"), "utf8")).fillers;
  for (const s of F) none(s);
  none(F.join(" "));
});

test("short fragments: everyday devotional formulas are not citations without a Qur'an cue", () => {
  for (const s of ["بسم الله الرحمن الرحيم", "الحمد لله رب العالمين", "لا حول ولا قوة إلا بالله", "إن شاء الله", "لا إله إلا الله", "ما شاء الله لا قوة إلا بالله",
    "حسبنا الله ونعم الوكيل", "حسبي الله ونعم الوكيل", "وإنا لله وإنا إليه راجعون", "وانا لله وانا اليه راجعون", "وما توفيقي إلا بالله", "تبارك الله ذو الجلال والإكرام",
    "(حسبنا الله ونعم الوكيل)", "\"إن شاء الله\"", "أستغفر الله العظيم وأتوب إليه"]) {
    none(s); none(`${FILL} ${s} ${FILL}`);
  }
  // announced as the word of God, the same words are the ayah
  assert.equal(one("قال تعالى حسبنا الله ونعم الوكيل").source.ref, "3:173");
  assert.equal(one("قال تعالى وما توفيقي إلا بالله").source.ref, "11:88");
  // benchmark option only: dhikr that is an ayah counts even without a cue
  assert.equal(one("حسبنا الله ونعم الوكيل", { fragDhikr: true }).source.ref, "3:173");
  assert.equal(textual(run("إن شاء الله", { fragDhikr: true })).length, 0);
});

test("short fragments: the same words in several ayahs -> first one is the source, the others parallels; a named surah decides", () => {
  const e = one("كل نفس ذائقة الموت يا إخواني فاستعدوا");
  assert.equal(e.source.ref, "3:185"); assert.deepEqual(e.parallels.map(p => p.ref), ["21:35", "29:57"]);
  assert.equal(one("في سورة العنكبوت كل نفس ذائقة الموت").source.ref, "29:57");
  const s = one("كل نفس ذائقة الموت كما في سورة الأنبياء");
  assert.equal(s.source.ref, "21:35"); assert.equal(s.attribution.code, "surah_ok");
  // a refrain that is a whole ayah
  const r = one("فبأي آلاء ربكما تكذبان");
  assert.equal(r.source.ref, "55:13"); assert.ok(r.parallels.length >= 20 && r.parallels.every(p => p.ref.startsWith("55:")));
});

test("short fragments: Qur'an only, and never inside what a hadith cue announces", () => {
  // a hadith cue directly before the words: the short path stays out of it
  assert.ok(!textual(run("قال رسول الله صلى الله عليه وسلم واستعينوا بالصبر والصلاة")).some(e => e.source.type === "q"));
  assert.ok(!textual(run("قال رسول الله صلى الله عليه وسلم يا عباد الله إن الأمر عظيم وتظنون بالله الظنونا")).some(e => e.source.type === "q"));
  // three exact words of a hadith are not enough (hadith thresholds are unchanged)
  none("ثم اعلموا يا إخواني الأعمال بالنيات وإنما وهذا معروف");
  // switched off, nothing of this path is reported
  assert.equal(textual(run("واستعينوا بالصبر والصلاة", { fragQuran: false })).length, 0);
});

test("short fragments: longer quotations are unchanged by the short path", () => {
  const texts = ["قال تعالى ولا تقربوا الزنا إنه كان فاحشة وساء سبيلا", "قُلْ هُوَ اللَّهُ أَحَدٌ (1) اللَّهُ الصَّمَدُ (2) لَمْ يَلِدْ وَلَمْ يُولَدْ (3) وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ (4)",
    "قال رسول الله ﷺ إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى دنيا يصيبها أو إلى امرأة ينكحها فهجرته إلى ما هاجر إليه", "فقلنا إنا لله وإنا إليه راجعون"];
  for (const t of texts) {
    const strip = L => L.map(e => ({ ...e, shortFragment: undefined }));
    assert.deepEqual(strip(run(t)), strip(run(t, { fragQuran: false })), t);
    assert.ok(run(t).every(e => !e.shortFragment));
  }
});

test("short fragments: no Qur'an citation in the gold-negative tweets of the development half (data not shipped)", { skip: !hasGold() && "QDetect tweets absent: see eval/tweets.mjs" }, () => {
  const neg = loadGold().filter(x => x.half === "dev" && x.n === 0);
  assert.ok(neg.length > 150);
  for (const x of neg) {
    const q = textual(run(x.text)).filter(e => e.source.type === "q");
    assert.equal(q.length, 0, `tweet #${x.i}: ${q.map(e => `${e.source.ref} «${e.spoken}»`).join(" | ")}`);
  }
});

test("short fragments: a 10,000-word transcript is still analysed in 5 seconds (core corpus)", () => {
  const F = JSON.parse(readFileSync(path.join(EVAL, "fillers.json"), "utf8")).fillers;
  const parts = [];
  for (let k = 0, n = 0; n < 10000; k++) {
    const s = k % 7 === 3 ? "قال تعالى واستعينوا بالصبر والصلاة" : k % 11 === 5 ? "قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى" : F[k % F.length];
    parts.push(s); n += s.split(" ").length;
  }
  const words = wordsFromText(parts.join(" "));
  analyze(words.slice(0, 500), corpus);          // warm-up (the Qur'an stream index is built on first use)
  const t0 = Date.now(), r = analyze(words, corpus), ms = Date.now() - t0;
  assert.ok(textual(r.ledger).filter(e => e.source.ref === "2:45").length > 50);
  assert.ok(ms <= 5000, `${words.length} words took ${ms} ms`);
});
