// cues.js — spoken "citation cues": phrases that announce a quotation, plus spoken attributions
// ("رواه البخاري", "في سورة البقرة"). Everything is matched on normalised + phonetically folded tokens,
// so a cue is still recognised when the transcription mis-spells it.
import { fold, normMixed } from "./text.js";
import { SURAHS } from "./corpus.js";

const F = s => s.split(/\s+/).map(w => fold(normMixed(w))).filter(Boolean).join(" ");
const cross = (as, bs) => as.flatMap(a => bs.map(b => `${a} ${b}`));

const SAY = ["قال", "وقال", "فقال", "يقول", "ويقول", "قول", "لقول", "بقول", "كقول", "وقول"];
const SAY_HIS = ["قوله", "لقوله", "بقوله", "كقوله", "وقوله"];

const GOD = ["الله", "الله تعالى", "الله عز وجل", "الله سبحانه وتعالى", "الله تبارك وتعالى", "الله جل وعلا",
  "تعالى", "سبحانه", "سبحانه وتعالى", "عز وجل", "جل وعلا", "جل جلاله", "تبارك وتعالى", "ربنا", "ربنا سبحانه",
  "ربنا جل وعلا", "ربنا تبارك وتعالى", "ربنا عز وجل", "الحق سبحانه", "الحق تبارك وتعالى", "المولى", "ربكم", "ربي"];
const QURAN_FIXED = ["في كتابه", "في كتاب الله", "في محكم التنزيل", "في محكم كتابه", "في القرآن الكريم", "الآية الكريمة",
  "في الآية", "هذه الآية", "قوله تعالى", "اقرأ قول الله", "اقرؤوا قول الله", "أعوذ بالله من الشيطان الرجيم",
  ...cross(SAY_HIS, ["تعالى", "سبحانه", "عز وجل", "جل وعلا", "سبحانه وتعالى", "تبارك وتعالى"])];

const PROPHET = ["رسول الله", "النبي", "نبينا", "الرسول", "رسولنا", "المصطفى", "الحبيب", "حبيبنا", "سيدنا رسول الله",
  "سيدنا النبي", "سيدنا محمد", "نبينا محمد", "صلى الله عليه وسلم", "عليه الصلاة والسلام", "عليه السلام",
  "النبي الكريم", "الرسول الكريم", "رسول الله الكريم"];
const HADITH_FIXED = ["في الحديث", "وفي الحديث", "جاء في الحديث", "ورد في الحديث", "في الحديث الصحيح", "وفي الحديث الصحيح", "في الحديث الشريف", "وفي الحديث الشريف",
  "في الحديث القدسي", "الحديث القدسي", "في الصحيحين", "في صحيح البخاري", "في صحيح مسلم", "ثبت عنه", "صح عنه", "ثبت عن النبي",
  "صح عن النبي", "روى البخاري", "روى مسلم", "روى الإمام", "أخرج البخاري", "أخرج مسلم", "عند البخاري", "عند مسلم",
  "عن النبي", "عن رسول الله", "سمعت رسول الله", "سمعت النبي", "حديث النبي", "حديث رسول الله", "أن النبي", "أن رسول الله",
  "عن أبي هريرة", "عن ابن عمر", "عن عائشة", "عن أنس", "عن ابن عباس", "عن أبي سعيد", "عن جابر", "عن ابن مسعود",
  "عن عمر بن الخطاب", "عن معاذ", "عن أبي ذر", "عن أبي موسى", "حديث أبي هريرة", "حديث ابن عمر", "حديث عائشة", "حديث عمر",
  "بين النبي", "وبين النبي", "حذر النبي", "وحذر النبي", "أخبر النبي", "أخبرنا النبي", "علمنا النبي", "أوصى النبي",
  "وصية النبي", "أمرنا النبي", "نهى النبي", "نهانا النبي", "جعل النبي"];

const SAYING = ["قال الإمام", "قال شيخ الإسلام", "قال ابن تيمية", "قال ابن القيم", "قال الشافعي", "قال الإمام الشافعي",
  "قال الإمام أحمد", "قال الإمام مالك", "قال أبو حنيفة", "قال الحسن البصري", "قال بعض السلف", "قال أحد السلف",
  "قال العلماء", "قال أهل العلم", "قال ابن كثير", "قال النووي", "قال ابن حجر", "قال الغزالي", "قال ابن الجوزي",
  "قال ابن رجب", "قال سفيان", "قال الفضيل", "قال ابن المبارك", "قال عمر بن الخطاب", "قال علي بن أبي طالب",
  "قال ابن مسعود", "قال ابن عباس", "قال الشاعر", "قال الحكماء", "قال أحد الصالحين", "قال بعض الصالحين", "قال بعض أهل العلم",
  "قال بعض العلماء", "قال أحد العلماء", "قال الإمام الشافعي رحمه الله", "قال بعضهم"]
  .flatMap(p => [p, "و" + p, "كما " + p, p.replace(/^قال/, "يقول")]);
// Ways of announcing somebody's words that name nobody: they hold for any speaker.
const SAYING_GENERIC = ["مقولة", "مقولة مشهورة", "قولة مشهورة", "كلمة مشهورة", "كلمة عظيمة", "في الأثر", "جاء في الأثر", "ورد في الأثر", "وفي الأثر",
  "كما قيل", "وقد قيل", "قيل قديما", "قال القائل", "كما قال القائل", "قال الحكيم", "من أقوال السلف", "من كلام السلف",
  "كان يقول", "وكان يقول", "فكان يقول", "كانت تقول", "وكانت تقول", "كانوا يقولون", "وكانوا يقولون"];

const TRAILING = [["صدق الله العظيم", "quran"], ["أو كما قال", "hadith"], ["رواه", "hadith"], ["أخرجه", "hadith"],
  ["متفق عليه", "hadith"], ["حديث صحيح", "hadith"], ["حديث حسن", "hadith"]];

// ---------------- English ----------------
const EN_HON = ["", "peace be upon him", "peace and blessings be upon him", "sallallahu alayhi wa sallam", "sallallahu alaihi wasallam",
  "sallallahu alaihi wa sallam", "salallahu alayhi wasallam", "saw", "pbuh", "muhammad", "muhammad peace be upon him"];
const EN_PROPHET = ["the prophet", "the messenger of allah", "the messenger", "prophet muhammad", "the holy prophet", "rasulullah", "allah s messenger",
  "our prophet", "our beloved prophet", "the prophet of allah", "the messenger of god", "rasool allah", "the noble prophet"];
const EN_SAID = ["said", "says", "has said", "told us", "taught us", "tells us", "teaches us", "informed us", "warned us", "advised us", "once said", "also said"];
const EN_HADITH = [...EN_PROPHET.flatMap(p => EN_HON.flatMap(h => EN_SAID.map(v => `${p} ${h} ${v}`.replace(/\s+/g, " ")))),
  "in a hadith", "in the hadith", "the hadith says", "there is a hadith", "in an authentic hadith", "in another hadith", "the hadith states",
  "it was narrated", "it is narrated", "it has been narrated", "it is reported", "it was reported", "on the authority of", "narrated by",
  "abu hurairah reported", "abu hurayrah reported", "abu hurairah narrated", "abu huraira narrated", "aisha reported", "aisha narrated", "anas reported",
  "ibn umar reported", "ibn abbas reported", "the prophet warned", "the prophet informed us", "the prophet explained", "he said peace be upon him",
  "in a hadith qudsi", "the prophet used to say"];
const EN_GOD = ["allah", "allah subhanahu wa ta ala", "allah the almighty", "allah the exalted", "allah almighty", "god", "god almighty", "our lord", "the almighty"];
const EN_QURAN = [...EN_GOD.flatMap(g => ["says", "said", "tells us", "states", "has said", "mentions", "reminds us", "commands us"].flatMap(v => [`${g} ${v}`, `${g} ${v} in the quran`])),
  "in the quran", "the quran says", "the quran states", "the verse says", "the ayah says", "this verse", "this ayah", "in surah", "in surat", "in sura",
  "in the holy quran", "the noble quran says", "allah s words", "the words of allah", "in his book", "in the book of allah", "he says in the quran"];
const EN_SAYING = ["imam", "ibn taymiyyah", "ibn al qayyim", "ibn qayyim", "imam shafi i", "imam ahmad", "imam malik", "imam abu hanifa", "al ghazali", "ibn kathir",
  "an nawawi", "imam nawawi", "hasan al basri", "the scholars", "one of the scholars", "the salaf", "one of the salaf", "umar ibn al khattab", "ali ibn abi talib", "ibn mas ud", "ibn abbas"]
  .flatMap(p => [`${p} said`, `${p} says`, `${p} once said`]);
const EN_TRAILING = [["reported by", "hadith"], ["narrated by", "hadith"], ["related by", "hadith"], ["agreed upon", "hadith"], ["authentic hadith", "hadith"],
  ["sadaqallahul azeem", "quran"]];

// The isti'adha opens a recitation but also every lecture: it lowers the bar like any Qur'an cue, yet it is too weak
// to make a bare devotional formula ("بسم الله الرحمن الرحيم") count as a quoted ayah.
const WEAK = new Set([F("أعوذ بالله من الشيطان الرجيم")]);
function build(list, kind, trailing = false, extra = null) {
  return list.map(p => ({ toks: F(p).split(" "), kind, trailing, weak: WEAK.has(F(p)), ...(extra || {}) })).filter(c => c.toks[0]);
}
const CUES = [
  ...build([...cross(SAY, GOD), ...QURAN_FIXED], "quran"),
  ...build([...cross(SAY, PROPHET), ...HADITH_FIXED], "hadith"),
  ...build(SAYING, "saying"),
  // `athar`: the words may be a companion's, and those are kept in the hadith collections (a scholar's are looked for in books only)
  // (`form`: like the cues known by their form, these words also stand INSIDE narrations — "أن ابن عمر كان يقول ..." — so they
  // announce without being taken out of the comparison)
  ...build(SAYING_GENERIC, "saying", false, { athar: true, form: true }),
  ...TRAILING.flatMap(([p, k]) => build([p], k, true)),
  ...build(EN_QURAN, "quran"), ...build(EN_HADITH, "hadith"), ...build(EN_SAYING, "saying"),
  ...EN_TRAILING.flatMap(([p, k]) => build([p], k, true)),
];
// index by first token for fast scanning; longer cues first so the longest one wins
const BY_FIRST = new Map();
for (const c of CUES) { let a = BY_FIRST.get(c.toks[0]); if (!a) BY_FIRST.set(c.toks[0], a = []); a.push(c); }
for (const a of BY_FIRST.values()) a.sort((x, y) => y.toks.length - x.toks.length);

// "قال الله" must not swallow "قال الله ... صلى الله عليه وسلم": hadith/saying cues are longer or distinct, and
// the engine never trusts the cue for the verdict — it only decides where to look harder.
const KIND_RANK = { saying: 3, hadith: 2, quran: 1 };


// The blessing on the Prophet ("صلى الله عليه وعلى آله وصحبه وسلم تسليما كثيرا") in any of its spellings: a run of at most 9
// tokens made only of blessing words, starting with "صلى" and ending at "وسلم"/"سلم" (+ an optional "تسليما" and "كثيرا").
const BLESS = new Set(["صلي", "الله", "عليه", "وعلي", "اله", "واله", "وصحبه", "صحبه", "واصحابه", "اصحابه", "وازواجه", "وسلم", "سلم", "تسليما", "كثيرا"].map(F));
const BLESS_END = new Set([F("وسلم"), F("سلم")]);
export function blessingLength(ftok, i) {
  if (ftok[i] !== F("صلى")) return 0;
  let end = 0;
  for (let k = 0; k < 9 && i + k < ftok.length; k++) {
    const t = ftok[i + k];
    if (!BLESS.has(t)) break;
    if (BLESS_END.has(t)) end = k + 1;
  }
  while (end && BLESS.has(ftok[i + end]) && [F("تسليما"), F("كثيرا")].includes(ftok[i + end])) end++;
  return end;
}

// ---- cues by FORM, whoever is named ----
// "قال ابن عمر رضي الله عنهما", "يقول سفيان الثوري رحمه الله", "عن سعيد بن زيد رضي الله عنه قال": the prayer said after a name
// tells that a person was just named, and the verb before the name that his words follow. No list of names is involved.
const SAY_SET = new Set([...SAY, "قالت", "وقالت", "فقالت", "تقول", "وتقول", "قالوا", "وقالوا"].map(F));
const AN = F("عن"), RADIYA = new Set(["رضي", "رضى"].map(F)), ALLAH = F("الله"), TAALA = F("تعالى");
const ANHU = new Set(["عنه", "عنها", "عنهما", "عنهم", "عنهن"].map(F));
const RAHIMA = new Set(["رحمه", "رحمها", "رحمهم", "رحمهما", "يرحمه"].map(F));
/** length of a prayer for a companion ("رضي الله [تعالى] عنه") or for a scholar ("رحمه الله [تعالى]") at i, with its kind; 0 when there is none */
function prayerAt(ftok, i) {
  if (RADIYA.has(ftok[i]) && ftok[i + 1] === ALLAH) { const k = ftok[i + 2] === TAALA ? 3 : 2; if (ANHU.has(ftok[i + k])) return { len: k + 1, who: "companion" }; }
  if (RADIYA.has(ftok[i]) && ANHU.has(ftok[i + 1])) return { len: 2, who: "companion" };            // "رضي عنه" as often transcribed
  if (RAHIMA.has(ftok[i]) && ftok[i + 1] === ALLAH) return { len: ftok[i + 2] === TAALA ? 3 : 2, who: "scholar" };
  return null;
}
const NAME_MAX = 6;       // "أبي عبد الرحمن عبد الله بن مسعود"
// "<verb> النبي صلى الله عليه وسلم أن / عن / من ...": what the Prophet said, taught, forbade or warned of, reported with ANY verb
// ("وضّح النبي ﷺ أن ...", "حثّ النبي ﷺ على ...", "زجرنا رسول الله ﷺ عن ..."). The title followed by the blessing names him; the
// particle after it opens the reported content. A narrative ("خرج النبي ﷺ إلى ...", "كان النبي ﷺ يحب ...") has no such particle.
const TITLES = ["رسول الله", "النبي", "نبينا", "الرسول", "رسولنا", "المصطفى", "الحبيب", "حبيبنا", "سيدنا رسول الله", "سيدنا النبي", "نبينا محمد", "سيدنا محمد"]
  .map(p => F(p).split(" ")).sort((a, b) => b.length - a.length);
const REPORT_OPEN = new Set(["أن", "أنه", "أنها", "أننا", "بأن", "بأنه", "عن", "من", "ما"].map(F));
const NOT_A_VERB = new Set(["كان", "وكان", "فكان", "لما", "ولما", "فلما", "حين", "حينما", "عندما", "عند", "مع", "إلى", "على", "في", "من", "عن", "ثم", "أن", "إن", "مثل", "هو", "يا", "هذا", "ذلك", "قبل", "بعد",
  "سنة", "هدي", "حياة", "سيرة", "زمن", "عهد", "أصحاب", "صحابة", "مسجد", "قبر", "بيت", "زوجة", "زوجات", "آل", "أهل", "حب", "محبة", "اتباع", "طاعة"].map(F));
const HON_PEACE = F("عليه الصلاة والسلام").split(" ");
function reportCues(ftok) {
  const out = [];
  for (let i = 1; i < ftok.length; i++) {
    const title = TITLES.find(tt => tt.every((x, k) => ftok[i + k] === x));
    if (!title) continue;
    const j = i + title.length;
    const bl = blessingLength(ftok, j) || (HON_PEACE.every((x, k) => ftok[j + k] === x) ? HON_PEACE.length : 0);
    if (!bl) continue;
    const verb = ftok[i - 1];
    if (!verb || verb.length < 2 || NOT_A_VERB.has(verb) || SAY_SET.has(verb) || !REPORT_OPEN.has(ftok[j + bl])) continue;
    out.push({ pos: i - 1, end: j + bl, kind: "hadith", trailing: false, weak: false, form: true });
    i = j + bl - 1;
  }
  return out;
}
function formCues(ftok) {
  const out = reportCues(ftok);
  for (let i = 0; i < ftok.length; i++) {
    const say = SAY_SET.has(ftok[i]), an = ftok[i] === AN;
    if (!say && !an) continue;
    for (let j = i + 2; j <= i + 1 + NAME_MAX && j < ftok.length; j++) {
      if (SAY_SET.has(ftok[j - 1]) || ftok[j - 1] === AN) break;             // another verb / another link of a chain: not one name
      const pr = prayerAt(ftok, j);
      if (!pr) continue;
      // "عن فلان رضي الله عنه" announces what he narrated (a hadith or his own words): looked for in the hadith collections;
      // "قال فلان رضي الله عنه / رحمه الله" announces his own words
      out.push({ pos: i, end: j + pr.len, kind: an ? "hadith" : "saying", trailing: false, weak: false, form: true, ...(!an && pr.who === "companion" ? { athar: true } : {}) });
      break;
    }
  }
  return out;
}

/** -> [{pos, end, kind, trailing, weak, mask}] sorted by pos, non-overlapping (longest, then most specific).
 *  `mask`: the spans of a cue that are a LISTED phrase — words that announce a quotation and are never part of one. A cue
 *  known only by its form ("قال <a name> رضي الله عنه") has none: the same words open many narrations inside the sources. */
export function findCues(ftok, opt = {}) {
  const out = [];
  for (let i = 0; i < ftok.length; i++) {
    const cands = BY_FIRST.get(ftok[i]);
    if (!cands) continue;
    let best = null;
    for (const c of cands) {
      const L = c.toks.length;
      if (i + L > ftok.length) continue;
      let ok = true;
      for (let k = 1; k < L; k++) if (ftok[i + k] !== c.toks[k]) { ok = false; break; }
      if (!ok) continue;
      if (!best || L > best.toks.length || (L === best.toks.length && KIND_RANK[c.kind] > KIND_RANK[best.kind])) best = c;
    }
    if (best) { out.push({ pos: i, end: i + best.toks.length, kind: best.kind, trailing: best.trailing, weak: best.weak, ...(best.athar ? { athar: true } : {}), ...(best.form ? { form: true } : {}) }); i += best.toks.length - 1; }
  }
  // cues recognised by their form are added where no listed cue already stands (a listed one is more specific about its kind)
  if (opt.form !== false) for (const c of formCues(ftok)) if (!out.some(x => !x.trailing && x.pos < c.end && c.pos < x.end)) out.push(c);
  out.sort((a, b) => a.pos - b.pos);
  // extend a hadith/quran cue over an immediately following honorific so the quote window starts after it
  const HON = [F("صلى الله عليه وسلم"), F("صلى الله عليه وآله وسلم"), F("عليه الصلاة والسلام"), F("رضي الله عنه"), F("رضي الله عنها"),
    F("رضي الله عنهما"), F("سبحانه وتعالى"), F("عز وجل"), F("تبارك وتعالى"), F("في كتابه الكريم"), F("في كتابه العزيز"), F("أنه قال"), F("قال"),
    "peace be upon him", "peace and blessings be upon him", "sallallahu alayhi wa sallam", "sallallahu alaihi wasallam", "may allah be pleased with him",
    "may allah be pleased with her", "subhanahu wa ta ala", "in the quran", "in the holy quran", "that", "said", "he said", "saying"]
    .map(s => s.split(" "));
  for (const c of out) {
    if (c.trailing) continue;
    let moved = true;
    while (moved) {
      moved = false;
      for (const h of HON) {
        if (h.every((t, k) => ftok[c.end + k] === t)) { c.end += h.length; moved = true; break; }
      }
      // any other way of writing the blessing ("صلى الله عليه وعلى آله وسلم", "... وآله وصحبه وسلم تسليما كثيرا"): a run of
      // blessing words that starts with "صلى" and reaches "وسلم" — a rule, not a list of spellings
      if (!moved) { const k = blessingLength(ftok, c.end); if (k) { c.end += k; moved = true; } }
    }
  }
  for (const c of out) c.mask = c.form ? [] : [[c.pos, c.end]];
  // drop cues that begin inside an earlier (extended) cue; merge cues that touch ("في الحديث الصحيح" + "عن النبي ...")
  const merged = [];
  for (const c of out) {
    const p = merged[merged.length - 1];
    // (a cue reached by the honorifics of the one before it — "عن X رضي الله عنه قال" + "قال رسول الله ﷺ" — is joined to it, not lost)
    if (p && !p.trailing && c.pos < p.end && (c.trailing || c.end <= p.end)) continue;
    if (p && !p.trailing && !c.trailing && c.pos - p.end <= 1) {
      p.end = c.end; p.weak = p.weak && c.weak; p.mask.push(...c.mask);
      // a listed phrase says what follows ("قال ابن عمر رضي الله عنهما" + "قال رسول الله ﷺ" announces a hadith); a form only that somebody spoke
      if (p.form && !c.form) { p.kind = c.kind; delete p.form; delete p.athar; if (c.athar) p.athar = true; }
      else { if (c.athar && !(c.form && !p.form)) p.athar = true; if (!(c.form && !p.form) && KIND_RANK[c.kind] > KIND_RANK[p.kind]) p.kind = c.kind; }
      continue;
    }
    merged.push(c);
  }
  return merged;
}

// ---- spoken gradings ("هذا حديث ضعيف", "لا يصح", "إسناده منقطع", "صححه الألباني") ----
// The speaker's OWN judgement on a hadith, as spoken. The tool never decides whether it is right and never says which hadith it
// is about: the engine shows the words, at their time, beside the nearest hadith, and the reviewer decides. Closed lists, folded.
const G_SUBJECT = new Set(["الحديث", "حديث", "هذا", "هذه", "اسناده", "سنده", "اسناد", "الاسناد", "الخبر", "الاثر", "الروايه", "هو", "وهو", "فهو"].map(F));
const G_SUBJECT_STRICT = new Set(["الحديث", "حديث", "اسناده", "سنده", "اسناد", "الاسناد", "الروايه"].map(F));
const G_WEAK_FREE = ["لا يصح", "لم يصح", "لا يثبت", "لم يثبت", "لا اصل له", "ضعفه", "ضعفوه", "ضعفها", "ليس بصحيح", "غير صحيح", "ليس بثابت", "غير ثابت"];
const G_WEAK_SUBJ = ["ضعيف", "ضعيفه", "ضعيف جدا", "منكر", "موضوع", "باطل", "مكذوب", "منقطع", "شاذ", "مرسل", "مضطرب", "معلول", "فيه علة", "فيه ضعف"];
const G_STRONG_FREE = ["صححه", "حسنه", "صححوه", "حسنوه"];
const G_STRONG_SUBJ = ["صحيح", "صحيحه", "حسن", "حسنه", "ثابت", "ثابته"];
const GRADES = [
  ...G_WEAK_FREE.map(p => [p, "weak", false]), ...G_WEAK_SUBJ.map(p => [p, "weak", true]),
  ...G_STRONG_FREE.map(p => [p, "strong", false]), ...G_STRONG_SUBJ.map(p => [p, "strong", "strict"]),
].map(([p, kind, subj]) => ({ toks: F(p).split(" "), kind, subj })).sort((a, b) => b.toks.length - a.toks.length);
const G_BY_FIRST = new Map();
for (const g of GRADES) { let a = G_BY_FIRST.get(g.toks[0]); if (!a) G_BY_FIRST.set(g.toks[0], a = []); a.push(g); }
/** -> [{pos, end, kind: "weak" | "strong"}] sorted; a grading word counts only where the sentence is about a hadith or an isnad */
export function findGradings(ftok) {
  const out = [];
  for (let i = 0; i < ftok.length; i++) {
    const cands = G_BY_FIRST.get(ftok[i]);
    if (!cands) continue;
    for (const g of cands) {
      const L = g.toks.length;
      if (i + L > ftok.length || !g.toks.every((t, k) => ftok[i + k] === t)) continue;
      if (g.subj) {
        const set = g.subj === "strict" ? G_SUBJECT_STRICT : G_SUBJECT;
        let ok = false;
        for (let k = Math.max(0, i - 4); k < i; k++) if (set.has(ftok[k])) { ok = true; break; }
        if (!ok) continue;
      }
      // "لا يصح أن تفعل" / "لا يصح لمسلم": a ruling about conduct, not about a hadith
      if (["لا يصح", "لم يصح"].includes(g.toks.join(" ").replace(/\s+/g, " ")) || g.toks.length === 2 && g.toks[1] === F("يصح")) {
        const nx = ftok[i + L] || "";
        if (nx === F("ان") || nx === F("أن") || (nx.length > 2 && nx[0] === "ل" && nx !== F("له"))) continue;
      }
      out.push({ pos: i, end: i + L, kind: g.kind });
      i += L - 1;
      break;
    }
  }
  return out;
}

// ---- spoken attribution ("رواه البخاري ومسلم", "متفق عليه", "في سورة البقرة") ----
// A collection name counts only after a transmission verb or reporting phrase ("رواه", "أخرجه", "في صحيح", "reported by")
// or directly after another collection name ("... البخاري ومسلم"): "كل مؤمن ومسلم", "a believer and Muslim" and
// "الإمام مالك" in ordinary speech name no book.
const NAMES = [
  ["البخاري", "bukhari"], ["مسلم", "muslim"], ["أبو داود", "abudawud"], ["أبي داود", "abudawud"], ["أبوداود", "abudawud"], ["أبو داوود", "abudawud"],
  ["الترمذي", "tirmidhi"], ["النسائي", "nasai"], ["ابن ماجه", "ibnmajah"], ["مالك", "malik"],
  ["bukhari", "bukhari"], ["bukhaari", "bukhari"], ["al bukhari", "bukhari"], ["muslim", "muslim"], ["abu dawud", "abudawud"], ["abu dawood", "abudawud"],
  ["abu daud", "abudawud"], ["abu dawod", "abudawud"], ["tirmidhi", "tirmidhi"], ["tirmizi", "tirmidhi"], ["at tirmidhi", "tirmidhi"], ["al tirmidhi", "tirmidhi"],
  ["nasai", "nasai"], ["nasa i", "nasai"], ["an nasai", "nasai"], ["an nasa i", "nasai"], ["al nasai", "nasai"], ["ibn majah", "ibnmajah"], ["ibn maja", "ibnmajah"], ["malik", "malik"],
].map(([p, col]) => ({ toks: F(p).split(" "), col })).sort((x, y) => y.toks.length - x.toks.length);
// verbs/phrases after which a collection name is a spoken attribution. type: "trail" = says where the PRECEDING text is from
const COL_VERBS = [
  ...["رواه", "ورواه", "أخرجه", "وأخرجه", "خرجه", "رواهما", "أخرجهما"].map(p => [p, "trail"]),
  ...["روى", "وروى", "أخرج", "وأخرج", "عند", "في صحيح", "صحيح", "في سنن", "سنن", "في جامع", "جامع", "في موطأ", "موطأ", "في رواية", "رواية", "وفي رواية", "لفظ", "بلفظ"].map(p => [p, "any"]),
  ...["reported by", "narrated by", "related by", "recorded by", "collected by", "transmitted by", "reported in", "narrated in", "recorded in", "collected in", "found in"].map(p => [p, "trail"]),
  ...["sahih", "sahih al", "sunan", "jami", "in", "في", "وفي"].map(p => [p, "any"]),
].map(([p, type]) => ({ toks: F(p).split(" "), type })).sort((x, y) => y.toks.length - x.toks.length);
const COL_FIXED = [
  ["متفق عليه", ["bukhari", "muslim"], "trail"], ["الصحيحين", ["bukhari", "muslim"], "any"], ["الشيخان", ["bukhari", "muslim"], "any"], ["الشيخين", ["bukhari", "muslim"], "any"],
  ["الموطأ", ["malik"], "any"], ["agreed upon", ["bukhari", "muslim"], "trail"], ["muwatta", ["malik"], "any"], ["the two sahihs", ["bukhari", "muslim"], "any"],
].map(([p, cols, type]) => ({ toks: F(p).split(" "), cols, type }));
const F_IMAM = [F("الإمام"), "imam", "al"], EN_AND = "and", F_WA = F("و");
const EN_AFTER = new Set(["reported", "narrated", "recorded", "related", "transmitted", "collected", "reports", "narrates", "records", "relates"]);
// names that are ordinary words too need a real transmission verb; "في البخاري" / "in Bukhari" is enough for the others
const AMBIGUOUS = new Set(["muslim", "malik"]);
const WEAK_VERB = new Set(["in", F("في"), F("وفي")]);
const NEAR_VERBS = ["رواه", "ورواه", "أخرجه", "وأخرجه"].map(F);
const seqAt = (ftok, i, toks) => { for (let k = 0; k < toks.length; k++) if (ftok[i + k] !== toks[k]) return false; return true; };
function nameAt(ftok, i, joined) {     // joined: the name must carry "و" / "and" (it continues a list)
  for (const nm of NAMES) {
    if (!joined) { if (seqAt(ftok, i, nm.toks)) return { col: nm.col, len: nm.toks.length }; continue; }
    if (ftok[i] === F_WA + nm.toks[0] && seqAt(ftok, i + 1, nm.toks.slice(1))) return { col: nm.col, len: nm.toks.length };
    if ((ftok[i] === EN_AND || ftok[i] === F_WA) && seqAt(ftok, i + 1, nm.toks)) return { col: nm.col, len: nm.toks.length + 1 };
    if ((ftok[i] === EN_AND || ftok[i] === F_WA) && F_IMAM.includes(ftok[i + 1]) && seqAt(ftok, i + 2, nm.toks)) return { col: nm.col, len: nm.toks.length + 2 };
  }
  return null;
}
/**
 * spoken mentions of hadith collections: [{pos, end, cols:[...], type}], sorted, non-overlapping
 * type "trail": says where the PRECEDING text is from ("رواه ..."); "any": either side ("في صحيح ...");
 * "bare": an unmistakable name with no verb — not an attribution by itself (see the engine)
 */
export function findCollectionSpans(ftok, a = 0, b = ftok.length) {
  const out = [];
  for (let i = Math.max(0, a); i < Math.min(b, ftok.length); i++) {
    let end = -1, type = "any"; const cols = [];
    const fx = COL_FIXED.find(f => seqAt(ftok, i, f.toks));
    const vb = fx ? null : COL_VERBS.find(v => seqAt(ftok, i, v.toks));
    if (fx) { cols.push(...fx.cols); end = i + fx.toks.length; type = fx.type; }
    else if (vb) {
      let j = i + vb.toks.length;
      const fx2 = COL_FIXED.find(f => f.type === "any" && seqAt(ftok, j, f.toks));      // "رواه الشيخان", "في الصحيحين"
      if (fx2) { cols.push(...fx2.cols); end = j + fx2.toks.length; type = vb.type; }
      else {
        if (F_IMAM.includes(ftok[j])) j++;
        let nm = nameAt(ftok, j, false);
        if (nm && AMBIGUOUS.has(nm.col) && vb.toks.length === 1 && WEAK_VERB.has(vb.toks[0])) nm = null;   // "in Muslim countries", "في مسلم"
        // "رواه أحمد والترمذي": a collection that is not in the corpus may open the list
        if (!nm && vb.type === "trail" && nameAt(ftok, j + 1, true)) { end = j + 1; type = vb.type; }
        if (nm) { cols.push(nm.col); end = j + nm.len; type = vb.type; }
      }
    } else {
      // English: "Bukhari reported ...", "Muslim narrated ..."
      const nm = /^[a-z]/.test(ftok[i] || "") ? nameAt(ftok, i, false) : null;
      if (nm && EN_AFTER.has(ftok[i + nm.len])) { cols.push(nm.col); end = i + nm.len; }
      else {
        // a mis-transcribed verb ("رواا الترمذي", "روه البخاري"): one letter away from "رواه" / "أخرجه", then a name
        const t = ftok[i] || "";
        const nx = t.length >= 3 && NEAR_VERBS.some(v => lev1(v, t)) ? nameAt(ftok, i + 1, false) : null;
        if (nx) { cols.push(nx.col); end = i + 1 + nx.len; type = "trail"; }
        else {
          // a name that is no ordinary word, standing alone ("... ابن ماجه"): weak — the engine uses it only directly after a quotation
          const bare = nameAt(ftok, i, false);
          if (bare && !AMBIGUOUS.has(bare.col)) { cols.push(bare.col); end = i + bare.len; type = "bare"; }
        }
      }
    }
    if (end < 0) continue;
    for (let guard = 0; guard < 8; guard++) {       // "... ومسلم وأبو داود والترمذي"
      const nx = nameAt(ftok, end, true);
      if (nx) { cols.push(nx.col); end += nx.len; continue; }
      // an unknown name inside the list ("... وأحمد والترمذي")
      if (type === "bare") break;
      if (type === "trail" && ftok[end] && ftok[end].startsWith(F_WA) && ftok[end].length > 3 && nameAt(ftok, end + 1, true)) { end++; continue; }
      break;
    }
    if (!cols.length) continue;
    out.push({ pos: i, end, cols: [...new Set(cols)], type });
    i = end - 1;
  }
  return out;
}
/** collections named by the speaker inside token range [a,b) */
export function findCollectionMentions(ftok, a, b) {
  const found = new Set();
  for (const sp of findCollectionSpans(ftok, a, b)) if (sp.end <= b && sp.type !== "bare") sp.cols.forEach(c => found.add(c));
  return [...found];
}

const SURAHS_EN = ["Fatihah","Baqarah","Imran","Nisa","Maidah","Anam","Araf","Anfal","Tawbah","Yunus","Hud","Yusuf","Rad","Ibrahim","Hijr","Nahl","Isra","Kahf","Maryam","Taha","Anbiya","Hajj","Muminun","Nur","Furqan","Shuara","Naml","Qasas","Ankabut","Rum","Luqman","Sajdah","Ahzab","Saba","Fatir","Yasin","Saffat","Sad","Zumar","Ghafir","Fussilat","Shura","Zukhruf","Dukhan","Jathiyah","Ahqaf","Muhammad","Fath","Hujurat","Qaf","Dhariyat","Tur","Najm","Qamar","Rahman","Waqiah","Hadid","Mujadila","Hashr","Mumtahanah","Saff","Jumuah","Munafiqun","Taghabun","Talaq","Tahrim","Mulk","Qalam","Haqqah","Maarij","Nuh","Jinn","Muzzammil","Muddaththir","Qiyamah","Insan","Mursalat","Naba","Naziat","Abasa","Takwir","Infitar","Mutaffifin","Inshiqaq","Buruj","Tariq","Ala","Ghashiyah","Fajr","Balad","Shams","Layl","Duha","Sharh","Tin","Alaq","Qadr","Bayyinah","Zalzalah","Adiyat","Qariah","Takathur","Asr","Humazah","Fil","Quraysh","Maun","Kawthar","Kafirun","Nasr","Masad","Ikhlas","Falaq","Nas"];
// transliterations vary ("Baqara", "Baqarah", "Bakara"): compare a reduced spelling
const reduce = w => w.toLowerCase().replace(/[^a-z]/g, "").replace(/^(aal|ali|al|an|ar|as|ash|at|az|ad|adh|ath)(?=[a-z]{3})/, "").replace(/q/g, "k").replace(/ee/g, "i").replace(/oo|ou/g, "u")
  .replace(/(.)\1+/g, "$1").replace(/h$/, "").replace(/aa/g, "a");
const SURAH_EN_RED = SURAHS_EN.map(reduce);
// other names in common use
const SURAH_EN_ALT = new Map([["bani israil", 17], ["bani israel", 17], ["bani israeel", 17], ["mumin", 40], ["dahr", 76], ["baraah", 9], ["bara ah", 9], ["tawba", 9],
  ["ha mim sajdah", 41], ["inshirah", 94], ["lahab", 111], ["tabbat", 111], ["tawhid", 112], ["tawheed", 112], ["zilzal", 99], ["tabarak", 67], ["malaikah", 35],
  ["ya sin", 36], ["ta ha", 20], ["al imran", 3], ["ali imran", 3], ["aal imran", 3]].map(([k, n]) => [reduce(k.replace(/ /g, "")), n]));
const EN_ARTICLES = new Set(["al", "an", "ar", "as", "ash", "at", "az", "ad", "adh", "ath", "aal", "ali", "ya"]);
// everyday English words that are one letter away from a surah name ("said" ~ Sad, "nor" ~ Nur ...)
const EN_COMMON = new Set(["said", "says", "say", "sad", "the", "this", "that", "was", "has", "had", "his", "her", "him", "nor", "not", "for", "and", "are", "can", "may", "must", "will", "with", "what",
  "when", "where", "which", "who", "why", "how", "our", "your", "their", "there", "here", "then", "than", "them", "they", "these", "those", "have", "from", "about", "after", "before", "also",
  "today", "night", "light", "right", "first", "last", "next", "each", "every", "some", "many", "much", "more", "most", "very", "only", "even", "such", "same", "other", "another",
  "name", "names", "time", "times", "verse", "verses", "chapter", "number", "revealed", "recited", "called", "which", "mean", "means", "start", "starts", "begin", "begins", "ends", "tells",
  "talks", "speaks", "mentions", "teaches", "contains", "itself", "alone", "again", "three", "seven", "would", "should", "could", "people", "allah", "quran", "prophet", "hadith"]);
function englishSurah(ftok, i) {    // tokens after "surah": -> {n, len} | null
  let j = i, name = "";
  if (EN_ARTICLES.has(ftok[j])) { name = ftok[j] === "ya" ? "ya" : ""; j++; }
  if (j >= ftok.length || !/^[a-z]+$/.test(ftok[j])) return null;
  const pick = r => { const k = SURAH_EN_RED.indexOf(r); return k >= 0 ? k + 1 : SURAH_EN_ALT.get(r) ?? null; };
  // a name written with a hyphen or an apostrophe arrives as two or three tokens ("Ta-Ha", "Al-Ma'idah", "Bani Isra'il")
  for (const extra of [2, 1]) {
    let ok = true, joined = name + ftok[j];
    for (let k = 1; k <= extra; k++) { if (!/^[a-z]+$/.test(ftok[j + k] || "")) { ok = false; break; } joined += ftok[j + k]; }
    if (!ok) continue;
    const n = pick(reduce(joined));
    if (n) return { n, len: j - i + 1 + extra };
  }
  const r = reduce(name + ftok[j]);
  let n = EN_COMMON.has(ftok[j]) && !name ? null : pick(r);
  if (!n && r.length >= 5 && !EN_COMMON.has(ftok[j])) {     // one letter off, if that is unambiguous
    const near = SURAH_EN_RED.map((x, idx) => [idx, x]).filter(([, x]) => Math.abs(x.length - r.length) <= 1 && x[0] === r[0] && lev1(x, r));
    if (near.length === 1) n = near[0][0] + 1;
  }
  return n ? { n, len: j - i + 1 } : null;
}
function lev1(a, b) {   // edit distance <= 1
  if (a === b) return true;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}
// other Arabic names in common use
const SURAH_ALT_AR = [["بني إسرائيل", 17], ["سبحان", 17], ["المؤمن", 40], ["الدهر", 76], ["هل أتى", 76], ["براءة", 9], ["حم السجدة", 41], ["تبت", 111], ["اللهب", 111], ["التوحيد", 112],
  ["الانشراح", 94], ["ألم نشرح", 94], ["تبارك", 67], ["عم", 78], ["الزلزال", 99], ["الملائكة", 35], ["القتال", 47], ["اقرأ", 96], ["لم يكن", 98], ["النبإ", 78]];
const SURAH_TOKS = [...SURAHS.map((s, i) => ({ toks: F(s).split(" "), n: i + 1 })), ...SURAH_ALT_AR.map(([s, n]) => ({ toks: F(s).split(" "), n }))]
  .sort((x, y) => y.toks.length - x.toks.length);
const F_SURAH = [F("سورة"), F("بسورة"), F("وسورة"), F("لسورة"), F("فسورة"), F("كسورة"), "surah", "surat", "sura", "soorah", "surahs"];
const F_AYAH = new Set([F("الآية"), F("آية"), F("الاية"), F("ايه"), F("رقم"), F("الآيات"), F("آيات"), F("الآيتان"), F("الآيتين"), F("والآية"), "verse", "verses", "ayah", "ayat", "aya", "number", "ayahs", "no"]);
const F_AYAH_PLURAL = new Set([F("الآيات"), F("آيات"), F("الآيتان"), F("الآيتين"), "verses", "ayat", "ayahs"]);
const F_RANGE = new Set([F("إلى"), F("الى"), F("حتى"), "to", "through", "thru", "until", "till"]);
const F_AND = new Set(["and", F("و")]);
const F_OF = new Set(["of", "in", "from", F("من"), F("في")]);
// "سورة الإخلاص 3 مرات", "Surah Al-Ikhlas 3 times": a count, not an ayah number
const F_COUNTER = new Set([F("مرات"), F("مرة"), F("مرار"), F("أيام"), F("ركعات"), F("سنوات"), F("سنين"), F("دقائق"), F("ساعات"), "times", "time", "days", "years", "minutes", "hours", "rakat", "rakahs", "x"]);
// number of ayahs in each surah (Hafs count), to reject a spoken ayah number that cannot exist
export const AYAH_COUNTS = [7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6];

function surahAt(ftok, i) {     // "سورة X" / "surah X" / "chapter N" starting at i -> {n, end} | null
  const num = t => (/^\d{1,3}$/.test(t || "") ? +t : null);
  if (F_SURAH.includes(ftok[i])) {
    const ar = SURAH_TOKS.find(s => s.toks.every((t, k) => ftok[i + 1 + k] === t));
    if (ar) return { n: ar.n, end: i + 1 + ar.toks.length };
    const en = englishSurah(ftok, i + 1);
    return en ? { n: en.n, end: i + 1 + en.len } : null;
  }
  if (ftok[i] === "chapter" && num(ftok[i + 1]) && num(ftok[i + 1]) <= 114) return { n: num(ftok[i + 1]), end: i + 2 };
  return null;
}
/**
 * Explicit spoken references to the Qur'an in [a,b): "سورة البقرة الآية 255", "الآية 5 من سورة المائدة", "Surah Al-Baqarah verse 255",
 * "chapter 2 verse 255", "verse 255 of Surah Al-Baqarah", "Surah Al-Kahf verses 1 to 10".
 * -> [{pos, end, surah, ayah|null, ayahEnd|null}]   (ayah is null for a bare surah mention or an ayah number the surah does not have)
 */
export function findQuranReferences(ftok, a = 0, b = ftok.length) {
  const out = [], num = t => (/^\d{1,3}$/.test(t || "") ? +t : null);
  for (let i = Math.max(0, a); i < Math.min(b, ftok.length); i++) {
    const su = surahAt(ftok, i);
    if (!su) continue;
    const surah = su.n, j = su.end;
    let pos = i, ayah = null, ayahEnd = null, end = j, plural = false, word = false;
    for (let k = j; k < Math.min(j + 4, ftok.length); k++) {       // "... verse 255" / "... 255" / "... في الآية 255"
      if (num(ftok[k]) != null) {
        if (!word && F_COUNTER.has(ftok[k + 1])) break;             // "... 3 times"
        ayah = num(ftok[k]); end = k + 1;
        // a range: "1 to 10", "1 - 10" (the hyphen is lost in tokenisation), "verses 1 and 2"
        if (F_RANGE.has(ftok[k + 1]) && num(ftok[k + 2]) > ayah) { ayahEnd = num(ftok[k + 2]); end = k + 3; }
        else if ((plural || F_AND.has(ftok[k + 1])) && word && F_AND.has(ftok[k + 1]) && num(ftok[k + 2]) > ayah) { ayahEnd = num(ftok[k + 2]); end = k + 3; }
        else if (word && num(ftok[k + 1]) > ayah && !F_COUNTER.has(ftok[k + 2])) { ayahEnd = num(ftok[k + 1]); end = k + 2; }
        break;
      }
      if (F_AYAH.has(ftok[k])) { word = true; if (F_AYAH_PLURAL.has(ftok[k])) plural = true; continue; }
      if (F_OF.has(ftok[k]) && F_AYAH.has(ftok[k + 1])) continue;   // "سورة البقرة في الآية 255"
      break;
    }
    if (ayah == null && F_OF.has(ftok[i - 1])) {                    // "verse 255 of surah ...", "الآية 5 من سورة ..."
      if (num(ftok[i - 2]) != null && F_AYAH.has(ftok[i - 3])) { ayah = num(ftok[i - 2]); pos = i - 3; }
      else if (num(ftok[i - 2]) != null && F_RANGE.has(ftok[i - 3]) && num(ftok[i - 4]) != null && num(ftok[i - 2]) > num(ftok[i - 4])
        && (F_AYAH.has(ftok[i - 5]) || (F_OF.has(ftok[i - 5]) && F_AYAH.has(ftok[i - 6])))) {
        ayah = num(ftok[i - 4]); ayahEnd = num(ftok[i - 2]); pos = F_AYAH.has(ftok[i - 5]) ? i - 5 : i - 6;
      } else if (num(ftok[i - 2]) != null && num(ftok[i - 3]) != null && F_AYAH.has(ftok[i - 4]) && num(ftok[i - 2]) > num(ftok[i - 3])) {
        ayah = num(ftok[i - 3]); ayahEnd = num(ftok[i - 2]); pos = i - 4;
      }
    }
    const max = AYAH_COUNTS[surah - 1];
    const r = { pos, end, surah, ayah, ayahEnd: null };
    if (ayah != null && (ayah < 1 || ayah > max)) { r.ayah = null; r.badAyah = ayah; }      // no such ayah: keep the surah, drop the number
    else if (ayah != null && ayahEnd != null && ayahEnd <= max) r.ayahEnd = ayahEnd;
    out.push(r);
    i = end - 1;
  }
  return out;
}
/** surah numbers named by the speaker ("سورة البقرة") inside [a,b) */
export function findSurahMentions(ftok, a, b) {
  const found = new Set();
  for (let i = Math.max(0, a); i < Math.min(b, ftok.length); i++) { const su = surahAt(ftok, i); if (su && F_SURAH.includes(ftok[i])) found.add(su.n); }
  return [...found];
}

// ---- devotional formulas: said constantly in religious speech, so they are never evidence of a quotation ----
const FORMULAS = ["صلى الله عليه وسلم", "صلى الله عليه وآله وسلم", "عليه الصلاة والسلام", "عليه السلام", "رضي الله عنه", "رضي الله عنها",
  "رضي الله عنهما", "رضي الله عنهم", "رحمه الله", "رحمهم الله", "سبحانه وتعالى", "تبارك وتعالى", "عز وجل", "جل وعلا", "جل جلاله",
  "إن شاء الله", "بإذن الله", "بسم الله الرحمن الرحيم", "الحمد لله رب العالمين", "لا إله إلا الله", "لا حول ولا قوة إلا بالله",
  "أعوذ بالله من الشيطان الرجيم", "السلام عليكم ورحمة الله وبركاته", "اللهم صل وسلم", "وعلى آله وصحبه", "يا رسول الله", "قال رسول الله",
  "جزاكم الله خيرا", "بارك الله فيكم", "والله أعلم",
  "peace be upon him", "peace and blessings be upon him", "may allah be pleased with him", "may allah be pleased with her", "may allah be pleased with them",
  "subhanahu wa ta ala", "sallallahu alayhi wa sallam", "sallallahu alaihi wasallam", "sallallahu alaihi wa sallam", "in the name of allah", "all praise is due to allah",
  "in the name of allah the most gracious the most merciful", "in the name of allah the most beneficent the most merciful", "in the name of allah the entirely merciful the especially merciful",
  "in the name of allah the beneficent the merciful", "in the name of allah most gracious most merciful", "in the name of god the most gracious the most merciful",
  "in the name of allah the compassionate the merciful", "the most gracious the most merciful", "the most beneficent the most merciful", "the entirely merciful the especially merciful",
  "all praise is due to allah lord of the worlds", "all praise is due to allah the lord of the worlds", "all praise is for allah lord of the worlds", "all praise is for allah the lord of the worlds",
  "all praise belongs to allah lord of the worlds", "all praise belongs to allah the lord of the worlds", "all praise belongs to allah", "all praises are due to allah", "all praise be to allah",
  "praise be to allah lord of the worlds", "praise be to allah the lord of the worlds", "praise be to allah", "all praise and thanks be to allah", "all praise and thanks are due to allah",
  "all praise is due to allah lord of all the worlds", "lord of the worlds", "peace and blessings be upon the messenger of allah", "peace and blessings be upon his messenger",
  "there is no god but allah", "the messenger of allah", "o messenger of allah", "allah s messenger", "may allah have mercy on him", "by the will of allah",
  "may allah reward you", "allah knows best", "assalamu alaikum wa rahmatullahi wa barakatuh"].map(p => F(p).split(" "));
/** marks tokens that belong to a devotional formula */
export function formulaMask(ftok) {
  const mask = new Uint8Array(ftok.length);
  for (let i = 0; i < ftok.length; i++) {
    for (const f of FORMULAS) {
      const t0 = ftok[i];
      if ((t0 === f[0] || t0 === "و" + f[0] || t0 === "ف" + f[0]) && f.every((t, k) => k === 0 || ftok[i + k] === t)) for (let k = 0; k < f.length; k++) mask[i + k] = 1;
    }
  }
  return mask;
}

// ---- words of everyday dhikr: a text made only of these is devotion, not a quotation, unless it is announced or long ----
export const DEVOTIONAL = new Set(("سبحان الله وبحمده بحمده العظيم الحمد والحمد لله ولله اكبر والله لا اله ولا الا وحده شريك له الملك وله وهو على كل شيء قدير حول قوة بالله "
  + "استغفر واستغفر واتوب اتوب اليه اللهم صل وسلم وبارك على محمد وعلى ال وال نبينا سيدنا رب العالمين ربي ربنا ولك لك تبارك وتعالى ما شاء حسبنا حسبي ونعم الوكيل اشهد واشهد ان وان "
  + "رسول عبده ورسوله وسبحان العلي الكريم عدد خلقه ورضا نفسه وزنة عرشه ومداد كلماته كثيرا طيبا مباركا فيه حمدا بكرة واصيلا").split(/\s+/).map(w => fold(normMixed(w))));

// ---- short exact fragments of an ayah (engine step 3d) ----
// Everyday dhikr whose words ARE an ayah or part of one. Said in plain speech it is devotion, not a quotation, so no
// path of the engine cites it without a Qur'an cue, a reference or ﴿ ﴾ (the tail forms cover "وإنا لله وإنا إليه راجعون", where the
// first word differs from the ayah, and "حسبي الله ونعم الوكيل").
const DHIKR = ["إنا لله وإنا إليه راجعون", "لله وإنا إليه راجعون", "حسبنا الله ونعم الوكيل", "الله ونعم الوكيل", "وما توفيقي إلا بالله", "توفيقي إلا بالله",
  "لا قوة إلا بالله", "قوة إلا بالله", "ما شاء الله", "توكلت على الله", "حسبي الله", "على الله توكلنا", "سبحان ربي", "تبارك الله", "أستغفر الله", "ذو الجلال والإكرام", "ذي الجلال والإكرام",
  "له الملك وله الحمد وهو على كل شيء قدير", "له الملك وله الحمد", "أفوض أمري إلى الله", "نعم المولى ونعم النصير",
  // the salawat (not an ayah): said in plain speech they are devotion, not a quotation of the hadith that teaches them
  "اللهم صل على محمد وعلى آل محمد", "كما صليت على إبراهيم وعلى آل إبراهيم", "اللهم بارك على محمد وعلى آل محمد", "بارك على محمد وعلى آل محمد",
  "كما باركت على إبراهيم وعلى آل إبراهيم", "صليت على آل إبراهيم", "باركت على آل إبراهيم", "في العالمين إنك حميد مجيد", "إنك حميد مجيد"].map(p => F(p).split(" "));
/** marks tokens that belong to such a phrase */
export function dhikrMask(ftok) {
  const mask = new Uint8Array(ftok.length);
  for (let i = 0; i < ftok.length; i++) {
    const t0 = ftok[i];
    for (const f of DHIKR) if ((t0 === f[0] || t0 === "و" + f[0] || t0 === "ف" + f[0]) && f.every((t, k) => k === 0 || ftok[i + k] === t)) for (let k = 0; k < f.length; k++) mask[i + k] = 1;
  }
  return mask;
}
// Function words (particles, prepositions, pronouns, demonstratives, auxiliary verbs), alone and after و / ف. A short
// fragment is measured without the function words at its two ends, and they never count as content words.
// Normalised spelling, not folded. (Written for this project.)
const FUNC_BASE = ("من الى عن على في حتى مع عند لدى بين قبل بعد دون غير سوى منذ فوق تحت كل بعض اي ايها يا "
  + "ان انه انها انهم انك انكم اني انا انما كان كانه لكن لكنه بل ثم او ام اما اذ اذا لو لولا لما كي كما مما عما فيما بما لما "
  + "لا ما لم لن ليس قد هل الا هو هي هم هن هما انت انتم نحن ذلك ذلكم تلك هذا هذه هؤلاء اولئك هنا هناك "
  + "الذي التي الذين اللاتي اللائي كان كانوا كانت كنتم كنت يكون تكون به بها بهم بكم بك له لها لهم لك لكم لنا لي "
  + "فيه فيها فيهم فيكم منه منها منهم منكم مني عليه عليها عليهم عليكم علينا اليه اليها اليهم اليكم الينا اليك عنه عنها عنهم عنكم "
  + "معه معها معهم معكم عنده عندهم عندكم بينهم بينكم بينهما").split(/\s+/).map(w => normMixed(w));
export const FUNCTION_WORDS = new Set(FUNC_BASE.flatMap(w => [w, "و" + w, "ف" + w]).concat(["و", "ف", "ب", "ل", "ك", "لقد", "ولقد", "فلقد"]));
// Words of the Qur'an that are SPELLED like a function word (alone or after و / ف) but are a content word where they
// stand: "وهن" in ﴿إني وهن العظم مني﴾ is the verb wahana, not و + هن; "فلك" in ﴿كل في فلك يسبحون﴾ is an orbit, not ف + لك.
// Found by listing every token of the Qur'an that FUNCTION_WORDS contains and reading its occurrences. null = a content
// word wherever the Qur'an has it; otherwise the ayahs in which it is one (everywhere else it is the function word).
// In those places the word counts as a content word and is never stripped from the edge of a fragment.
export const QURAN_HOMOGRAPHS = new Map(Object.entries({
  "وهن": null, "وهنا": null, "فلك": null, "فتحت": null, "فسوي": null, "سوي": null,
  "ولي": ["2:107", "2:120", "2:257", "3:68", "6:51", "6:70", "9:74", "9:116", "13:37", "17:111", "18:26", "27:10", "28:31", "29:22", "31:7", "32:4", "41:34", "42:8", "42:31", "42:44", "45:19"],
  "وكل": ["32:11"], "وفي": ["53:37"], "فان": ["55:26"], "وهم": ["12:24"], "هم": ["5:11"],
  "ام": ["3:7", "6:92", "7:150", "13:39", "20:94", "28:7", "28:10", "42:7", "43:4"],
  "علي": ["42:51"], "قبل": ["2:177", "12:26", "27:37"], "الا": ["9:8", "9:10"], "قد": ["12:26", "12:27", "12:28"], "لما": ["89:19"], "مني": ["75:37"],
}).map(([w, refs]) => [normMixed(w), refs && new Set(refs)]));
// Particles that cannot end a clause (prepositions, conjunctions, negations, conditionals, relative pronouns): an exact run
// that stops on one of them was cut off or goes on with a changed word ("واذكر ربك إذا [غفلت]"), so it is not cited.
export const OPEN_PARTICLES = new Set(("من الى عن على في حتى مع عند لدى بين قبل بعد دون غير سوى ان اذ اذا لو لولا لما كي كما لكن بل ثم او ام اما لا ما لم لن ليس قد لقد هل الا انما "
  + "الذي التي الذين اللاتي اللائي يا ايها كل").split(/\s+/).map(w => normMixed(w)).flatMap(w => [w, "و" + w, "ف" + w]));
