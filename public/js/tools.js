// tools.js — what "Ask Athar" can look up by itself, without a language model: a text by its reference, texts near a
// topic, and how often a word stands in the Qur'an. Pure functions over the corpus (run in the page's worker and in the
// tests). Nothing here judges anything: a result is a passage of the sources, or a count of written forms.
import { norm, stem, fold } from "./text.js";
import { SURAHS } from "./corpus.js";

const digits = s => String(s).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
/** the search form of a question, its numbers kept (norm() drops them): letters unified, no diacritics, digits and ":" "-" left */
const N = s => digits(s).replace(/[ً-ْٰـ]/g, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^ء-ي0-9a-zA-Z:\- ]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
/** the surahs by their names in search form, longest first ("ال عمران" before "عمران" could ever match) */
const SURAH_KEYS = SURAHS.map((name, i) => ({ key: N(name), n: i + 1 })).sort((a, b) => b.key.length - a.key.length);
// ayat people ask for by a name (a short closed list of names nobody disputes)
const NAMED = [
  [/ايه الكرسي/, "2:255"], [/ايه الدين|ايه المداينه/, "2:282"], [/ايه النور/, "24:35"], [/(خواتيم|اواخر|اخر ايتين من)( سوره)? البقره/, "2:285-286"],
  [/ايه السيف/, "9:5"], [/ايه الوضوء/, "5:6"], [/ايه التطهير/, "33:33"], [/ايه المباهله/, "3:61"],
];
const COLLECTIONS = [
  ["bukhari", /(صحيح )?البخاري/], ["muslim", /(صحيح )?مسلم/], ["abudawud", /(سنن )?اب[يو] داود/], ["tirmidhi", /(جامع |سنن )?الترمذي/], ["nasai", /(سنن )?النسا[ئي]ي?/],
  ["ibnmajah", /(سنن )?ابن ماجه/], ["malik", /موطا( الامام)?( مالك)?|مالك/], ["nawawi", /الاربع(ين|ون) النوويه|النوويه|النووي/], ["qudsi", /(الاحاديث |الحديث )?القدسي(ه)?/],
];

/**
 * A hadith by the number people cite (the printed number: «البخاري 6018», «مسلم 55») -> the corpus's own reference.
 * The index is built once from the corpus's own descriptions; «55» also finds «55a» (the first of several narrations).
 */
function byNumber(corpus, col, num) {
  let ix = corpus._byNumber;
  if (!ix) {
    ix = corpus._byNumber = new Map();
    for (let pid = 0; pid < corpus.coreN; pid++) {
      if (corpus.isQuran(pid)) continue;
      const d = corpus.describe(pid); if (!d || d.type !== "h" || d.number == null) continue;
      const k = d.collection + "|" + d.number, base = d.collection + "|" + String(d.number).replace(/[a-z]+$/i, "");
      if (!ix.has(k)) ix.set(k, d.ref); if (!ix.has(base)) ix.set(base, d.ref);
    }
  }
  return ix.get(col + "|" + String(num)) || null;
}

/**
 * The references a question names, as the corpus writes them: "2:255", "2:285-286", "bukhari:6018".
 *   «سورة البقرة الآية 255», «البقرة 255», «البقرة: 255», «2:255», «آية الكرسي», «من الآية 1 إلى 5 من سورة الكهف»
 *   «البخاري 6018», «حديث رقم 1 في صحيح مسلم», «الأربعين النووية 19»
 * A surah named alone gives its first ayat (all of a short surah). Only references the corpus has are returned.
 */
export function parseRefs(q, corpus, max = 3) {
  const x = " " + N(q) + " ", out = [], add = r => { if (r && !out.includes(r) && out.length < max) out.push(r); };
  const has = r => corpus.coreRef.get(r) != null, lastOf = s => { let a = 0; while (has(`${s}:${a + 1}`)) a++; return a; };
  const range = (s, a, b) => { if (!has(`${s}:${a}`)) return null; b = b && b > a && has(`${s}:${b}`) ? Math.min(b, a + 9) : a; return b > a ? `${s}:${a}-${b}` : `${s}:${a}`; };
  for (const [rx, ref] of NAMED) if (rx.test(x)) add(ref.includes("-") ? range(...ref.split(/[:-]/).map(Number)) : has(ref) ? ref : null);
  for (const m of x.matchAll(/(?<!\d)(\d{1,3}) ?: ?(\d{1,3})(?: ?- ?(\d{1,3}))?(?!\d)/g)) if (+m[1] >= 1 && +m[1] <= 114) add(range(+m[1], +m[2], m[3] ? +m[3] : 0));
  if (!out.length) for (const { key, n } of SURAH_KEYS) {
    const at = x.indexOf(" " + key + " "); if (at < 0) continue;
    const before = x.slice(Math.max(0, at - 60), at + 1), after = x.slice(at + key.length + 1, at + key.length + 40);
    const named = / سوره $/.test(before) || / سوره ال $/.test(before);
    // a number after the name («البقرة 255», «البقرة آية 255», «البقرة الآيات 1 إلى 5») or before it («الآية 255 من سورة البقرة»)
    const aft = after.match(/^ ?(?:ال)?(?:ايه|ايات|الايات|رقم)? ?(?:رقم )?(\d{1,3})(?: ?(?:-|الي|حتي) ?(\d{1,3}))?/), bef = before.match(/(?:ايه|الايه|الايات|ايات) (?:رقم )?(\d{1,3})(?: ?(?:-|الي|حتي) ?(\d{1,3}))? (?:من |في )?(?:سوره )?$/);
    const m = aft && aft[1] ? aft : bef;
    if (m) add(range(n, +m[1], m[2] ? +m[2] : 0));
    else if (named) { const L = lastOf(n); add(range(n, 1, Math.min(L, L <= 10 ? L : 5))); }
    if (out.length) break;                                  // one surah a question
  }
  for (const [col, rx] of COLLECTIONS) {
    const m = x.match(new RegExp(" (?:" + rx.source + ")(?: حديث| الحديث| برقم| رقم| ح)* ?(?<n>\\d{1,5}) ")) || x.match(new RegExp("(?:حديث |الحديث )?(?:رقم |برقم )(?<n>\\d{1,5}) (?:في |من |عند )(?:كتاب )?(?:" + rx.source + ") "));
    if (m) add(byNumber(corpus, col, m.groups.n));
  }
  return out;
}

const AFFIX = /^(?:وال|فال|بال|كال|ولل|فلل|لل|ال|و|ف|ب|ل|ك)(?=.{3,})/;
const TOPIC_STOP = new Set(["حديث", "احاديث", "الاحاديث", "ايه", "ايات", "الايات", "قران", "القران", "عن", "في", "من", "علي", "الي", "هل", "ما", "ماذا", "هناك", "يوجد", "فيه", "ورد", "وردت", "جاء", "ذكر", "اريد", "اعطني", "هات", "اذكر", "بعض", "التي", "الذي", "تتحدث", "يتحدث", "تتكلم", "يتكلم", "موضوع", "فضل", "شيء", "حول", "اي", "كل", "او", "ثم", "ان", "لا", "لم", "لن", "قد", "هو", "هي", "يا", "بل", "اذ", "لي", "له", "به", "نبوي", "نبويه", "شريف", "كريم", "كريمه", "the", "about", "hadith", "verses", "verse", "on", "of", "any"]);
const bareOf = w => w.replace(AFFIX, "");
/** the words that say what a topic is about, in the corpus's search form (question words and fillers left out) */
export function topicWords(q) { return [...new Set(norm(q).split(" ").filter(w => w.length >= 2 && !TOPIC_STOP.has(w) && !TOPIC_STOP.has(bareOf(w))))].slice(0, 8); }

/**
 * Passages NEAR a topic — a suggestion, never a match. Two ways, joined:
 *   by the words: passages of the core corpus whose text (the chain of narrators left out) holds the topic's words — the
 *     written form itself (with or without an article or attached particle) counts fully, another form of the same stem
 *     counts less; words standing together count more; of two passages the shorter is preferred; one text is listed once;
 *   by the sense: the nearest passages in the sentence-vector index (when `sem` = {index, vec} is given).
 * kind: "h" | "q" | "" (both). -> [{pid, score, via: "words" | "sense" | "both"}], best first, at most k.
 */
export function topicSearch(q, corpus, { kind = "", k = 6, sem = null } = {}) {
  const ws = topicWords(q).map(w => ({ w, b: bareOf(w), s: stem(w), key: stem(fold(w)) })); if (!ws.length) return [];
  corpus.ensureStems();
  const want = pid => pid < corpus.coreN && (kind === "q" ? corpus.isQuran(pid) : kind === "h" ? !corpus.isQuran(pid) : true);
  // where to look: the passages the stem index lists for the topic's words; a topic of words the index does not hold
  // (two-letter words, or words in too many passages) is looked for in every passage
  const pool = new Set(); let indexed = 0;
  for (const x of ws) { const post = x.w.length >= 3 && corpus.stemPost.get(x.key); if (post) { indexed++; for (const pid of post) if (want(pid)) pool.add(pid); } }
  if (!indexed) for (let pid = 0; pid < corpus.coreN; pid++) if (want(pid) && ws.some(x => corpus.P[pid].n.includes(x.b))) pool.add(pid);
  const need = ws.length <= 3 ? ws.length : Math.ceil(ws.length * 0.6), all = ws.reduce((a, x) => a + corpus.stemIdf(x.key), 0) || 1, scored = [];
  for (const pid of pool) {
    const toks = corpus.P[pid].n.split(" "), from = corpus.chainLen(pid) || 0, at = ws.map(() => []), lev = ws.map(() => 0);
    for (let i = from; i < toks.length; i++) { const tk = toks[i]; if (tk.length < 2) continue; const tb = bareOf(tk); let ts = null;
      for (let j = 0; j < ws.length; j++) { const x = ws[j]; let l = tk === x.w || tb === x.b ? 2 : 0;
        if (!l && x.w.length >= 3 && tk.length >= 3) { if (ts === null) ts = stem(tk); if (ts === x.s) l = 1; }
        if (l) { if (l > lev[j]) { lev[j] = l; at[j] = [i]; } else if (l === lev[j]) at[j].push(i); } } }
    const got = lev.filter(Boolean).length; if (got < need) continue;
    let score = ws.reduce((a, x, j) => a + (lev[j] === 2 ? 1 : lev[j] === 1 ? 0.55 : 0) * corpus.stemIdf(x.key), 0) / all;
    // the topic's words standing together: the narrowest stretch that holds one place of each word found
    const lists = at.filter(a => a.length); let best = Infinity, lo0 = lists[0][0], hi0 = lo0;
    for (const p of lists[0]) { let lo = p, hi = p; for (let j = 1; j < lists.length; j++) { let near = lists[j][0]; for (const v of lists[j]) if (Math.abs(v - p) < Math.abs(near - p)) near = v; lo = Math.min(lo, near); hi = Math.max(hi, near); } if (hi - lo < best) { best = hi - lo; lo0 = lo; hi0 = hi; } }
    if (got >= 2) score *= best < got + 1 ? 1.6 : best <= 8 ? 1.25 : 1;
    // the same words in several narrations are one suggestion: told apart by the words around the place found
    const len = toks.length - from; scored.push([pid, score / (1 + Math.log(1 + len / 60) * 0.35), toks.slice(Math.max(from, lo0 - 2), Math.min(hi0, lo0 + 8) + 4).join(" ")]);
  }
  scored.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const out = new Map(), said = new Set();
  for (const [pid, score, head] of scored) {
    // …and the narrations one collection prints under one number (85a, 85b, 85c) are one hadith
    const d = corpus.isQuran(pid) ? null : corpus.describe(pid), num = d && d.number != null ? d.collection + "|" + String(d.number).replace(/[a-z]+$/i, "") : "";
    if (said.has(head) || (num && said.has(num))) continue; said.add(head); if (num) said.add(num);
    out.set(pid, { pid, score, via: "words" }); if (out.size >= k * 3) break;
  }
  if (sem && sem.index && sem.vec) for (const r of sem.index.top(sem.vec, k * 2, want)) {
    const old = out.get(r.pid);
    out.set(r.pid, old ? { pid: r.pid, score: old.score + r.score + 0.5, via: "both" } : { pid: r.pid, score: r.score, via: "sense" });
  }
  // texts found both ways first; then, alternately, the best by sense and the best by words
  const list = [...out.values()], pick = v => list.filter(x => x.via === v).sort((a, b) => b.score - a.score), both = pick("both"), sense = pick("sense"), words = pick("words");
  const res = [...both]; for (let i = 0; res.length < k && (i < sense.length || i < words.length); i++) { if (sense[i]) res.push(sense[i]); if (words[i] && res.length < k) res.push(words[i]); }
  return res.slice(0, k);
}

/**
 * A short text looked for WORD FOR WORD in the loaded books of fabricated and famous hadith (the engine wants more shared
 * words than a three-word saying has before it calls a book passage a match; a saying typed on its own is exactly what
 * such books list). -> [{pid, ps, pe, about}] one passage a book, best first: `about` is the book's own verdict words
 * when they can be about this text (corpus.bookWordsFor), else "". Being listed in such a book is not a verdict by itself.
 */
export function phraseInWeakBooks(text, corpus, max = 3) {
  const ws = norm(String(text)).split(" ").filter(Boolean); if (ws.length < 2 || ws.length > 14 || ws.join("").length < 7) return [];
  const needle = " " + ws.join(" ") + " ", hits = [];
  for (let pid = corpus.coreN; pid < corpus.N; pid++) {
    const p = corpus.P[pid]; if (p.t !== "b") continue;
    const col = p.r.split(":")[0], bk = corpus.books[col]; if (!bk || bk.domain !== "hadith-weak") continue;
    const hay = " " + p.n + " ", at = hay.indexOf(needle); if (at < 0) continue;
    const ps = at === 0 ? 0 : hay.slice(1, at).split(" ").length, pe = ps + ws.length;
    hits.push({ pid, ps, pe, col, about: corpus.bookWordsFor(pid, ps, pe) });
  }
  // the passage whose verdict is about the text first; then the one that opens with it (the entry itself, not a mention)
  hits.sort((a, b) => (b.about ? 1 : 0) - (a.about ? 1 : 0) || a.ps - b.ps || a.pid - b.pid);
  const out = []; for (const h of hits) { if (out.some(x => x.col === h.col)) continue; out.push(h); if (out.length >= max) break; }
  return out;
}

/**
 * How often a word stands in the Qur'an, by its WRITTEN form in the search text (no diacritics; alif, ta marbuta and
 * alif maqsura unified): the form itself, and the form with an article or an attached particle (و ف ب ل ك ال).
 * It is a count of spellings, not of a root: «صبر» does not count «الصابرين».
 * -> { word, exact: {times, ayat}, withAffix: {times, ayat}, first: [refs of the first ayat, up to 5] } | null
 */
export function countInQuran(word, corpus) {
  const w = norm(String(word)).replace(/ /g, ""); if (w.length < 2) return null;
  const bare = w.replace(AFFIX, ""), P = corpus.P; let et = 0, ea = 0, at = 0, aa = 0; const first = [];
  for (let pid = 0; pid < corpus.coreN; pid++) {
    if (!corpus.isQuran(pid)) continue;
    let e = 0, a = 0;
    for (const t of P[pid].n.split(" ")) { if (t === w) e++; if (t === w || t === bare || t.replace(AFFIX, "") === bare) a++; }
    if (e) { et += e; ea++; } if (a) { at += a; aa++; if (first.length < 5) first.push(P[pid].r); }
  }
  const shown = String(word).replace(/[ً-ْٰـ]/g, "").trim();     // as the reader wrote it, for display
  return { word: w, bare, shown, shownBare: shown.replace(AFFIX, ""), exact: { times: et, ayat: ea }, withAffix: { times: at, ayat: aa }, first };
}
