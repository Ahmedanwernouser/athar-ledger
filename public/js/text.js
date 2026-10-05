// text.js — Arabic normalisation, phonetic folding, hashing and word similarity.
// MUST stay identical to tools/build_index.py (checked by tests/engine.test.mjs against hash_vectors.json).

const DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/** Normalise: strip diacritics/tatweel, unify alef/yeh/teh-marbuta, keep Arabic letters only. */
export function norm(s) {
  return s
    .replace(/[ی]/g, "ي").replace(/[ک]/g, "ك")   // Farsi yeh/kaf sometimes produced by ASR
    .replace(DIAC, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^ء-ي ]/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** English normalisation (identical to norm_en in tools/build_packs_en.py): lower-case ASCII letters and digits only. */
export function normEn(s) {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
const HAS_AR = /[\u0621-\u064a]/;
const AR_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/g;
// Letters used by Persian/Urdu keyboards (and some ASR output) for Arabic words; transcript side only, the corpus has none.
const FOREIGN = { "\u06cc": "ي", "\u06d2": "ي", "\u06a9": "ك", "\u06c1": "ه", "\u06be": "ه", "\u06c0": "ه", "\u06c3": "ه", "\u06d5": "ه" };
const FOREIGN_RE = /[\u06cc\u06d2\u06a9\u06c1\u06be\u06c0\u06c3\u06d5]/g;
/** Coerce anything that may arrive as a transcript word ({w}, a bare string, null, a number ...) to a string. */
export function wordText(x) {
  const v = x != null && typeof x === "object" ? x.w : x;
  return v == null ? "" : String(v);
}
/** One spoken word of either script -> normalised form (may contain a space when a word splits, "" when nothing is left). */
export function normMixed(w) {
  w = wordText(w);
  // NFKC folds Arabic presentation forms (ﻗﻞ, ﻻ, ﷲ, ﷺ) into ordinary letters; Eastern digits become ASCII digits
  w = w.normalize("NFKC").replace(FOREIGN_RE, ch => FOREIGN[ch]).replace(AR_DIGITS, d => String(d.charCodeAt(0) & 15));
  if (HAS_AR.test(w)) return norm(w);
  return normEn(w);
}
export const isLatin = t => { const c = t.charCodeAt(0); return (c >= 97 && c <= 122) || (c >= 48 && c <= 57); };

// Letters that speech recognisers commonly confuse are merged — for candidate retrieval
// and for labelling a difference as "probably an ASR artefact". Never used to assert identity silently.
const FOLD = { "ص": "س", "ث": "س", "ض": "د", "ظ": "ز", "ذ": "ز", "ط": "ت", "ق": "ك", "ح": "ه",
               "ع": "ا", "ء": "ا", "ئ": "ا", "ؤ": "و", "غ": "ك", "خ": "ه" };
const FOLD_RE = new RegExp("[" + Object.keys(FOLD).join("") + "]", "g");
const foldCh = ch => FOLD[ch];
export function fold(s) {
  return s.replace(FOLD_RE, foldCh);
}

const enc = new TextEncoder();
export function fnv1a(s) {
  let h = 0x811c9dc5;
  const b = enc.encode(s);
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * Very light stemmer for a FOLDED word: strips the article/conjunctions, common suffixes and the imperfect-verb
 * prefix. Used only to propose "by meaning" candidates (الغش ~ غشنا ، الغضب ~ يغضب); never for a verdict.
 */
export function stem(w) {
  if (isLatin(w)) return stemEn(w);
  let s = w;
  let cut = false;
  for (const p of ["وال", "بال", "كال", "فال", "لل", "ال"]) if (s.startsWith(p) && s.length - p.length >= 3) { s = s.slice(p.length); cut = true; break; }
  if (!cut && s.length >= 5 && "وفبل".includes(s[0])) {
    const first = s[0]; s = s.slice(1);
    // a conjunction may carry a second particle: "فلمقام" = ف + ل + مقام, "وبالوالدين" = و + ب + ال + والدين, "وللذين" = و + لل + ذين
    if ("وف".includes(first)) {
      let two = false;
      for (const p of ["بال", "كال", "لل"]) if (s.startsWith(p) && s.length - p.length >= 3) { s = s.slice(p.length); two = true; break; }
      if (!two && s.length >= 5 && "لب".includes(s[0]) && !s.startsWith("ال")) s = s.slice(1);      // (the letters a bare word loses too, so "ولسانه" and "لسانه" meet)
    }
    if (s.startsWith("ال") && s.length >= 5) s = s.slice(2);
  }
  for (const x of ["هما", "كما", "هم", "هن", "كم", "نا", "ها", "ون", "ين", "ان", "ات", "وا", "يه", "ه", "ك", "ي", "ت", "ا"])
    if (s.endsWith(x) && s.length - x.length >= 3) { s = s.slice(0, -x.length); break; }
  if (s.length >= 4 && "يتن".includes(s[0])) s = s.slice(1);
  return s;
}

/** Equally light English stemmer (plural, -ed, -ing, -ly). Same purpose, same caveat. Mirrored in tools/train_vectors.py. */
export function stemEn(w) {
  let s = w;
  if (s.length > 4 && s.endsWith("ies")) return s.slice(0, -3) + "y";
  if (s.length > 5 && s.endsWith("sses")) return s.slice(0, -2);
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 5 && s.endsWith("ly")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss") && !s.endsWith("us")) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

/** Levenshtein distance with early exit when it exceeds `max`. */
export function editDistance(a, b, max = 3) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1), cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i; let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const c = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

/** true when a and b are at most ONE edit apart (substitution, insertion or deletion) — no allocation */
export function within1(a, b) {
  const la = a.length, lb = b.length, d = la - lb;
  if (d > 1 || d < -1) return false;
  const m = la < lb ? la : lb;
  let i = 0;
  while (i < m && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  if (i === m) return true;                       // one is a prefix of the other (lengths differ by at most one)
  // the rest after the first difference must be identical: skip one character on the longer side, or on both
  let x = d >= 0 ? i + 1 : i, y = d <= 0 ? i + 1 : i;
  while (x < la && a.charCodeAt(x) === b.charCodeAt(y)) { x++; y++; }
  return x === la;
}

// ---- the same word in another grammatical form ----
// "أعنّا" for "أعنّي", "كتابهم" for "كتابه", "يعلمون" for "تعلمون", "والصلاة" for "الصلاة": one letter apart, yet a real
// difference of wording — never a transcription slip. No vocabulary can list every inflected form, so the forms are
// compared directly: when both words are the SAME stem with different affixes (pronoun suffix, verb person / number /
// gender marker, article, conjunction or preposition prefix), the pair is a grammatical variant.
const INFL_PRE = ["", "و", "ف", "ب", "ل", "ك", "س", "ال", "وال", "فال", "بال", "كال", "لل", "ولل", "فلل", "ي", "ت", "ن", "ا",
  "وي", "وت", "ون", "وا", "في", "فت", "فن", "فا", "لي", "لت", "لن", "سي", "ست", "سن", "سا", "وب", "ول", "فب", "فل"];
const INFL_SUF = ["", "ي", "ني", "نا", "ه", "ها", "هم", "هن", "هما", "ك", "كم", "كن", "كما", "ت", "تم", "تن", "تما", "وا", "ون", "ين", "ان", "ات", "ا"];
const PRONOUN_SUF = new Set(["ي", "ني", "نا", "ه", "ها", "هم", "هن", "هما", "ك", "كم", "كن", "كما"]);
const ARTICLE = /^[وفبك]?(?:ال|لل)/;
function inflSplits(w) {
  const out = [], art = ARTICLE.test(w);
  for (const p of INFL_PRE) {
    if (p && !w.startsWith(p)) continue;
    for (const s of INFL_SUF) {
      if (s && !w.endsWith(s)) continue;
      if (w.length - p.length - s.length < 2) continue;
      // a noun with the article takes no pronoun ("الصلاه" does not end in a pronoun: that ه is the ta marbuta)
      if (art && PRONOUN_SUF.has(s)) continue;
      out.push(w.slice(p.length, w.length - s.length), p, s);
    }
  }
  return out;
}
/**
 * true when a and b (normalised, different) are one stem with different affixes. A final "وا" written "و" ("قالو") is
 * spelling, not grammar.
 */
// Speech has no spelling. Two normalised forms that are written differently but SOUND the same are the same spoken word:
//   • hamza seats and a dropped final hamza:   مؤمن = مومن ، سئل = سيل ، شيء = شي
//   • final ة (stored as ه) heard in liaison as ت:   كمشكاة = كمشكات   (words of 4+ letters)
//   • final alif written ا or ى (stored as ي):        قلى = قلا
// Pairs where the two spellings are different words that matter (إلى / إلا ، هذي / هذا ، أني / أنا ...) are never merged.
const NOT_SAME = new Set(["الي", "الا", "علي", "علا", "لدي", "لدا", "هذي", "هذا", "اني", "انا", "لي", "لا", "بي", "با", "في", "فا", "ما", "مي", "حتي", "حتا", "بلي", "بلا", "متي", "متا", "اذي", "اذا", "اما", "امي", "لما", "لمي", "كما", "كمي", "هي", "ها", "ذي", "ذا", "ني", "نا"]);
const soundForm = w => w.replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ء/g, "");
export function sameSound(a, b) {
  if (a === b) return true;
  if (!a || !b || NOT_SAME.has(a) || NOT_SAME.has(b)) return false;
  const x = soundForm(a), y = soundForm(b);
  if (x === y) return x.length >= 2;
  if (x.length !== y.length || x.length < 3 || x.slice(0, -1) !== y.slice(0, -1)) return false;
  const p = x[x.length - 1] + y[y.length - 1];
  if ((p === "هت" || p === "ته") && x.length >= 4) return true;
  // final alif written ا in the transcript where the source has ى (alif maqsura, stored as ي): only for words known to end in ى,
  // so that «أعنّا» is never taken for «أعنّي»
  if (p === "اي") return MAQSURA.has(b);
  if (p === "يا") return MAQSURA.has(a);
  return false;
}
/** normalised forms of words whose spelling ends in alif maqsura (filled from the Qur'an text when the corpus loads) */
export const MAQSURA = new Set();
export function noteMaqsura(text) {
  for (const w of String(text).split(/\s+/)) { const bare = w.replace(DIAC, "").replace(/[^ء-ي]/g, ""); if (bare.length >= 3 && bare.endsWith("ى")) MAQSURA.add(norm(bare)); }
}
export function inflectionOf(a, b) {
  if (a === b || isLatin(a) || isLatin(b)) return false;
  if ((a.endsWith("و") && b === a + "ا") || (b.endsWith("و") && a === b + "ا")) return false;
  const A = inflSplits(a), B = inflSplits(b);
  for (let i = 0; i < A.length; i += 3) for (let j = 0; j < B.length; j += 3)
    if (A[i] === B[j] && (A[i + 1] !== B[j + 1] || A[i + 2] !== B[j + 2])) return true;
  return false;
}

/**
 * Compare a spoken word (from the transcript) with a source word. Both are already normalised.
 *   "exact" — identical after normalisation
 *   "asr"   — identical after phonetic folding (ص/س, ذ/ز, ق/ك ...): almost certainly a transcription artefact
 *   "near"  — one letter apart (two for long words) and not a grammatical variant of the source word: a mis-heard non-word
 *   "diff"  — a different word
 * isWord(a): optional test "is this spoken form a word of the corpus vocabulary?" (see Corpus.isWord)
 */
export function wordSim(a, b, fa = fold(a), fb = fold(b), isWord = null) {
  if (a === b) return "exact";
  let k = "diff";
  if (fa === fb) k = "asr";
  else {
    const la = fa.length, lb = fb.length, m = la < lb ? la : lb;
    if (m >= 8) { if (la - lb <= 2 && lb - la <= 2 && editDistance(fa, fb, 2) <= 2) k = "near"; }
    else if (m >= 4 && within1(fa, fb)) k = "near";
  }
  // Real-word rule: a spoken form that is itself a word of the corpus is a WORDING difference (يكفر / يغفر, كفور / غفور),
  // never a transcription artefact — only a non-word may be excused as mis-heard.
  // ... and so is the same word in another grammatical form, whether or not the corpus happens to contain that form.
  if (k !== "diff" && isWord && (isWord(a) || (k === "near" && inflectionOf(a, b)))) return "diff";
  return k;
}

/**
 * Turn a transcript into normalised tokens that remember which original word they came from.
 * words: [{w, start?, end?}]  ->  {tok:[string], ftok:[string], src:[index into words]}
 */
export function tokenizeTranscript(words) {
  const tok = [], ftok = [], src = [];
  for (let i = 0; i < words.length; i++) {
    const n = normMixed(words[i]);
    if (!n) continue;
    for (const t of n.split(" ")) { tok.push(t); ftok.push(fold(t)); src.push(i); }
  }
  return { tok, ftok, src };
}

/** Plain text -> word list without timestamps (paste mode). */
export function wordsFromText(text) {
  return text.split(/\s+/).filter(Boolean).map(w => ({ w }));
}

export function fmtTime(sec) {
  if (sec == null || Number.isNaN(sec)) return "";
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = x => String(x).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}

// ---------------- takhrij inside a stored hadith text ----------------
// A compilation (the Forty of an-Nawawi, Riyad as-Salihin, Bulugh al-Maram) prints, after or inside the hadith, where it
// is from and what was said of it: «رواه الترمذي [رقم: 2516] وقال: حديث حسن صحيح. وفي رواية غير الترمذي: …»; at-Tirmidhi
// ends his own with «قال أبو عيسى هذا حديث حسن صحيح». These words are not the wording of the hadith: a speaker who says
// «أخرجه الترمذي» where the book has «رواه الترمذي» has not changed the hadith. They are found by form — a word that
// opens such a note, then every following word that belongs to the vocabulary of such notes — and are left out of the
// count of differences and of "how much of the text was said". (Tokens are in the search form: norm().)
const TK_COLLECTORS = ["البخاري", "مسلم", "الترمذي", "النسائي", "داود", "ماجه", "احمد", "مالك", "الدارمي", "الحاكم", "البيهقي", "الطبراني", "الدارقطني", "حبان", "خزيمه", "البزار", "يعلي", "شيبه", "الشيخان", "الشافعي", "عيسي", "عبد", "الرزاق", "الامام", "ابن", "ابو", "ابي", "الموطا", "المسند", "السنن", "الصحيحين", "الصحيح", "صحيحه", "صحيحيهما", "مسنده", "سننه", "المستدرك", "الجامع", "الكبير", "الاوسط", "الصغير", "وغيره", "وغيرهما", "وغيرهم"];
const TK_WORDS = new Set([...TK_COLLECTORS, "قال", "حديث", "حسن", "صحيح", "غريب", "ضعيف", "جيد", "في", "روايه", "روايته", "غير", "رقم", "عليه", "اللفظ", "له", "لفظ", "لفظه", "بلفظ", "باسناد", "اسناده", "سنده", "بسند", "صححه", "حسنه", "ضعفه", "هذا", "عن", "من", "علي", "شرط", "شرطهما", "هما", "زاد", "الوجه", "لا", "نعرفه", "الا", "هكذا", "اخرجه", "رواه", "رواها", "خرجه", "متفق", "ايضا", "وهو", "هو", "كتاب", "باب"]);
const tkBase = w => (TK_WORDS.has(w) ? w : w.length > 2 && (w[0] === "و" || w[0] === "ف" || w[0] === "ل") ? (TK_WORDS.has(w.slice(1)) ? w.slice(1) : w.startsWith("لل") && TK_WORDS.has("ال" + w.slice(2)) ? "ال" + w.slice(2) : "") : "");
const TK_OPEN = new Set(["رواه", "رواها", "اخرجه", "خرجه"]);
const TK_NAMES = new Set([...TK_COLLECTORS.filter(w => !["ابن", "ابو", "ابي", "عبد", "الامام", "الكبير", "الاوسط", "الصغير"].includes(w)), "حسن", "صحيح", "ضعيف", "غريب", "متفق"]);
const tkCache = new WeakMap();
/** @param toks  the words of a stored hadith text in search form  ->  Uint8Array, 1 where a word belongs to such a note */
export function takhrijMask(toks) {
  let m = tkCache.get(toks); if (m) return m;
  m = new Uint8Array(toks.length);
  const b = toks.map(tkBase), num = w => /^[0-9٠-٩]+$/.test(w);
  for (let i = 0; i < toks.length; i++) {
    const opens = TK_OPEN.has(b[i]) || (b[i] === "متفق" && b[i + 1] === "عليه") || (b[i] === "في" && b[i + 1] === "روايه" && toks[i] !== "في")      // «وفي رواية …»
      || (b[i] === "قال" && toks[i + 1] === "ابو" && toks[i + 2] === "عيسي") || (b[i] === "زاد" && b[i + 1] && TK_COLLECTORS.includes(b[i + 1]));
    if (!opens) continue;
    let j = i; while (j < toks.length && (b[j] || num(toks[j]))) j++;
    // «وفي رواية قال…» with no book named and no grading may be the narrator's own words: a note names a book or a grading
    let named = false; for (let k = i; k < j; k++) if (TK_NAMES.has(b[k])) { named = true; break; }
    if (named) { for (let k = i; k < j; k++) m[k] = 1; i = j - 1; }
  }
  tkCache.set(toks, m); return m;
}
