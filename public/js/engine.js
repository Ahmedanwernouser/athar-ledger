// engine.js — the spoken-citations engine. Deterministic: no language model takes part in any verdict.
//
//   transcript words ─► seeds (folded 2-/3-gram index) ─► clusters ─► word alignment against the source
//                    ─► verdict from counted evidence ─► grouping of parallel sources ─► spoken-attribution check
//   cue phrases with no textual match ─► "by meaning" candidates (shared rare words) or "not found in corpus"
//
// Wording rule: the engine only ever says what it found in ITS corpus. "Not found" never means "false".
//
// What "verbatim" means here (strict): every spoken word of the matched span agrees with the source word for word —
// no substituted, added or omitted word. Split/glued words and a few mis-heard NON-words are tolerated as transcription
// artefacts; a spoken form that is itself a real word (يكفر for يغفر) is a wording difference. Everything else that
// still clears the evidence thresholds is "partial", with the differences listed in `diff`.
import { tokenizeTranscript, stem, isLatin, wordText, fold, normMixed } from "./text.js";
import { align, summarize } from "./align.js";
import { findCues, findGradings, findCollectionSpans, findQuranReferences, formulaMask, dhikrMask, DEVOTIONAL, FUNCTION_WORDS, QURAN_HOMOGRAPHS, OPEN_PARTICLES } from "./cues.js";

export const STATUS = {
  verbatim: { ar: "مطابق حرفيًا", fidelity: "حرفي", rank: 4 },
  partial: { ar: "مطابق جزئيًا", fidelity: "مخلوط", rank: 3 },
  meaning: { ar: "بالمعنى — يحتاج تأكيدًا", fidelity: "بالمعنى", rank: 2 },
  lead: { ar: "مصدر مرشّح", fidelity: "غير محدَّد", rank: 1 },
  notfound: { ar: "لم يُعثر عليه في المدونة", fidelity: "—", rank: 0 },
};

export const DEFAULTS = {
  seedGap: 20,          // tokens between seed hits that still belong to one cluster
  seedMin: 12,          // minimum summed idf of seed hits to verify a cluster
  seedMinCue: 5,        // ... when a citation cue is nearby
  cueReach: 45,         // tokens after a cue in which a quotation is expected
  gradeReach: 40,       // tokens after a hadith in which a spoken grading ("هذا حديث ضعيف") is attached to it
  gradeAhead: 8,        // ... and before the next hadith, when the grading comes first
  cueAnswer: 16,        // a citation must begin within this many tokens after a cue to count as its quotation
  margin: 25,           // transcript tokens added around a cluster before aligning
  band: 16,             // the alignment is computed within this many words of the diagonals on which speech and source share word pairs (0 = everywhere)
  maxClusters: Infinity, // no cap: every candidate that passes the seed thresholds is verified (the alignment is cheap enough now)
  perRegion: 24,        // candidates verified per 8-token stretch of speech (core)
  perRegionBooks: 14,   // ... and from book packs
  seedShare: 0.3,       // a candidate needs at least this share of the best seed evidence in its stretch
  quranReach: 24,       // ... for an ayah: counted together with the neighbouring ayahs seeded within this many tokens
  // minimum evidence (summed idf of the matched words) to report a textual match — lower right after a cue phrase.
  // For an ayah in plain speech (no cue, reference or brackets) the function words count only funcWeight of theirs.
  eMin: 20, eMinCue: 12, eMinQuran: 16, eMinQuranCue: 7,
  qVerbatim: 0.86,      // share of aligned words that agree: the bar for a CLOSE match (verbatim if also strict, else partial)
  nearExact: 0.10,      // ... with at most this share of changed words. Detection only: it never makes a match "verbatim"
  maxMisheard: 0.20,    // "verbatim" tolerates at most this share of mis-heard (asr + near) words
  qPartial: 0.55,       // -> "مخلوط"
  minWords: 5,          // minimum informative matched words (cue phrases and devotional formulas do not count)
  // Function words (particles, prepositions, pronouns) are not content: of the informative words, this many must be
  // content words — fewer when the quotation is announced (cue / reference / brackets), more in plain speech —
  minContent: 3, minContentCue: 2,   // (an exact run of an ayah's words in plain speech: minContentCue)
  minContentChanged: null,   // a number: content words needed by an ayah in plain speech whose wording is NOT exact (null = minContent)
  funcWeight: 0.5,      // an ayah in plain speech: a function word gives only this share of its evidence (against eMinQuran)
  shortMin: 2,          // a short canonical text right after its cue: informative words needed (exact, from the start of the text)
  shortEvidence: 5,
  // Short EXACT fragments of an ayah (step 3d): three or more words, contiguous, identical in normalised spelling.
  // Qur'an only. Evidence = summed idf of the fragment without the function words at its ends. See eval/README.md.
  fragQuran: true,
  fragEvCue: 8,         // ... announced (Qur'an cue / reference / brackets): at least 2 content words (1 for a whole ayah) and this much evidence
  fragEvWhole: 12,      // ... a whole ayah in plain speech: at least 3 content words and this much evidence
  fragEvPlain: 19,      // ... part of an ayah in plain speech: at least 3 content words and this much evidence
  fragEvMid: 23,        // ... when it has exactly 3 content words and neither begins nor ends an ayah (idioms: "مشارق الأرض ومغاربها")
  fragMaxOcc: 40,       // identical fragments in other ayahs that are verified (listed as parallels)
  fragDhikr: false,     // true: everyday dhikr that is an ayah ("حسبنا الله ونعم الوكيل") is cited even without a cue (benchmark comparison only)
  chainShare: 0.34,     // a match in which narrators' chain words reach this share (transmission verbs count double) is a chain, not a text
  devotionalMin: 8,     // a text made only of everyday dhikr words needs a cue or this many informative words
  anchorMax: 60,        // candidates tried for a short text right after a cue
  mergeTokens: 1500,    // source tokens aligned at once when neighbouring ayah ranges are merged into one recitation
  realWords: true,      // real-word rule: a spoken form that is itself a corpus word is a wording difference (false = ablation)
  // "by meaning" without a language model is weak evidence: shared rare word stems after a cue.
  meaningMin: 16,       // -> status "بالمعنى — يحتاج تأكيدًا" (needs >=4 shared stems, or a score >= meaningStrong)
  meaningStrong: 20,
  suggestMin: 11,       // below meaningMin: offered only as search suggestions under "not found"
  meaningMinWords: 3,
  meaningWindow: 40,
  meaningTop: 5,
  useVectors: true,     // hybrid (words + dense) candidates when the dense index is loaded
  denseK: 100, rerankK: 40, prefixLens: [6, 9, 12, 16, 24, 40], rerankMode: "mix", lexWeight: 1,   // chosen on the development paraphrases (eval/README.md)
  tolerant: true,       // ASR-aware matching (false = ablation)
  useCues: true,
  blocked: null,        // Set of passage ids to ignore (used by the evaluation to hold passages out)
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rank = m => STATUS[m.status].rank;
const N = s => new Set(s.split(/\s+/).filter(Boolean).map(w => normMixed(w)));
// A negation / exception / condition particle directly before the quoted words changes their meaning when it is left out
// ("لا إكراه في الدين" -> "إكراه في الدين"); the same for an exception right after them ("لا إله" without "إلا الله").
const EDGE_HEAD = N("لا ولا فلا ما وما فما لم ولم فلم لن ولن فلن ليس وليس فليس إلا غير لولا لو ولو no not never none except unless nor");
const EDGE_TAIL = N("إلا except but");
const PREP = new Set(["في", "وفي", "من", "in", "of", "from"].map(w => fold(normMixed(w))));
const SAY_END = N("قال يقول فقال وقال قالت وسلم السلام said says");   // words after which a matn begins inside a narration
const DIGITS = /^\d+$/;
const SOLID = { exact: 1, asr: 1, joinT: 1, joinP: 1 };
// Words a chain of narrators is made of. Chains survive inside some indexed texts ("... ح وحدثنا أبو الربيع وأبو كامل
// قالا حدثنا حماد ...", "وقال ابن زريع عن روح بن القاسم عن زيد بن أسلم ..."); a match that consists largely of these
// words is a chain read aloud, not a quotation, and is never reported.
const CHAIN_STRONG = new Set([...N("حدثنا حدثني حدثه حدثهم أخبرنا أخبرني أخبره أنبأنا ثنا الإسناد مثله بمثله نحوه بنحوه")].flatMap(w => [w, "و" + w, "ف" + w]).concat("ح"));
const CHAIN_WEAK = N("عن وعن بن ابن وابن أبي أبو وأبو بنت");

// ---- where the quoted words of a hadith passage begin ----
// The index holds a hadith without its chain of narrators but WITH the narrative around the quoted speech, so most
// passages open with "قال رسول الله صلى الله عليه وسلم ...", "أن النبي صلى الله عليه وسلم قال ...", "سمعت رسول الله
// صلى الله عليه وسلم يقول ...". Those words announce the text; a quotation that starts right after them starts at the
// beginning of the text (excerpt.head = false).
const FS = p => p.split(/\s+/).map(w => fold(normMixed(w)));
const LEAD_HONOR = ["صلى الله عليه وسلم", "صلى الله عليه وآله وسلم", "عليه الصلاة والسلام", "عليه السلام", "رضي الله عنه", "رضي الله عنها", "رضي الله عنهما",
  "رضي الله عنهم", "peace be upon him", "peace and blessings be upon him", "may allah be pleased with him", "may allah be pleased with her"].map(FS);
const LEAD_NAMED = ["رسول الله", "النبي", "the prophet", "the messenger of allah", "allah s messenger"].map(FS);
const LEAD_SAY = new Set(FS("قال يقول فقال وقال قالت said says"));
const seqAt = (ft, i, toks) => { for (let k = 0; k < toks.length; k++) if (ft[i + k] !== toks[k]) return false; return true; };
const LEAD_CACHE = new WeakMap();
/** index of the first word of the text proper in a hadith passage: after the chain (`s`, kept only where the builder could not remove it) and the announcing phrase */
function matnStart(corpus, pid) {
  let cache = LEAD_CACHE.get(corpus); if (!cache) LEAD_CACHE.set(corpus, cache = new Map());
  let v = cache.get(pid); if (v !== undefined) return v;
  const c0 = corpus.chainLen(pid), ft = corpus.ftok(pid).slice(c0, c0 + 24);
  const cues = findCues(ft).filter(c => !c.trailing && c.kind !== "saying");
  let i = 0;
  for (let moved = true; moved && i < ft.length;) {
    moved = false;
    const c = cues.find(c => c.pos === i);
    if (c) { i = c.end; moved = true; continue; }
    const h = LEAD_HONOR.find(h => seqAt(ft, i, h));
    if (h) { i += h.length; moved = true; continue; }
    const nm = LEAD_NAMED.find(nm => seqAt(ft, i, nm) && (LEAD_SAY.has(ft[i + nm.length]) || LEAD_HONOR.some(h => seqAt(ft, i + nm.length, h))));
    if (nm) { i += nm.length; moved = true; continue; }
    if (LEAD_SAY.has(ft[i])) { i++; moved = true; }
  }
  v = c0 + (i >= ft.length || i > 16 ? 0 : i);     // a passage that is nothing but such a phrase has no separate beginning
  cache.set(pid, v);
  return v;
}

export function analyze(words, corpus, options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (!Array.isArray(words)) words = [];
  const t0 = Date.now();
  const { tok, ftok, src } = tokenizeTranscript(words);
  const n = tok.length;
  const wOf = i => wordText(words[i]);
  const wObj = i => { const x = words[i]; return x && typeof x === "object" ? x : {}; };
  const cues = o.useCues ? findCues(ftok) : [];
  const wt = fw => clamp(corpus.idf(fw) / 3, 0.3, 1);
  const idf = fw => corpus.idf(fw);
  const blocked = o.blocked;
  const off = pid => corpus.isDead(pid) || (blocked !== null && blocked.has(pid));
  const KIND = { quran: 1, hadith: 2, saying: 3 };

  // cue lookup: is there a (leading) cue ending shortly before token i?
  const cueNear = new Uint8Array(n);
  for (const c of cues) {
    if (c.trailing) { for (let i = Math.max(0, c.pos - o.cueReach); i < c.pos; i++) cueNear[i] = 1; }
    else for (let i = c.pos; i < Math.min(n, c.end + o.cueReach); i++) cueNear[i] = 1;
  }

  // tokens that belong to a leading cue phrase ("قال رسول الله صلى الله عليه وسلم"): they announce a quotation,
  // they are not part of it, so they never count as evidence
  const cueMask = new Uint8Array(n);
  for (const c of cues) if (!c.trailing) for (let i = c.pos; i < Math.min(n, c.end); i++) cueMask[i] = 1;
  const formMask = formulaMask(ftok), dMask = dhikrMask(ftok);

  // words that SAY where a text is from are not quoted words either: trailing cues ("رواه", "متفق عليه"), collection
  // mentions ("رواه البخاري ومسلم", "في صحيح مسلم") and explicit Qur'an references ("في سورة النحل الآية 90")
  const metaMask = new Uint8Array(n);
  const colSpans = findCollectionSpans(ftok), refs = findQuranReferences(ftok);
  for (const c of cues) if (c.trailing) for (let i = c.pos; i < Math.min(n, c.end); i++) metaMask[i] = 1;
  for (const sp of colSpans) if (sp.type !== "bare") for (let i = sp.pos; i < sp.end; i++) metaMask[i] = 1;
  for (const r of refs) {
    // "من قرأ سورة الكهف ..." is part of a hadith: a bare surah name is a reference only with an ayah number, after a
    // preposition ("في سورة ..."), or next to a cue phrase
    const nearCue = cueMask[r.pos] || (r.pos > 0 && cueMask[r.pos - 1]) || (r.end < n && cueMask[r.end]);
    r.isRef = r.ayah != null || r.badAyah != null || nearCue || (r.pos > 0 && PREP.has(ftok[r.pos - 1]));
    if (r.isRef) for (let i = r.pos; i < r.end; i++) metaMask[i] = 1;
  }

  // "announced": a leading cue ended shortly before this token, or a trailing cue ("رواه ...") follows
  const cueLead = new Uint8Array(n), cueTrail = new Uint8Array(n);
  // "directly announced": the first words after a leading cue (reference words in between do not count)
  const cueDirect = new Uint8Array(n), cueDirectStrong = new Uint8Array(n);
  for (const c of cues) {
    if (c.trailing) { for (let i = Math.max(0, c.pos - 6); i <= Math.min(n - 1, c.pos + 1); i++) cueTrail[i] = KIND[c.kind]; continue; }
    for (let i = Math.max(0, c.end - 1); i <= Math.min(n - 1, c.end + 8); i++) cueLead[i] = KIND[c.kind];
    for (let i = c.end, free = 0; i < Math.min(n, c.end + 16) && free < 3; i++) {
      cueDirect[i] = KIND[c.kind]; if (!c.weak) cueDirectStrong[i] = KIND[c.kind];
      if (!metaMask[i] && !cueMask[i]) free++;
    }
  }

  const sentenceEnd = new Uint8Array(n);
  let punctuated = false;       // does the transcript carry sentence punctuation at all? (pasted raw text often has none)
  for (let i = 0; i < n; i++) if ((i === n - 1 || src[i + 1] !== src[i]) && /[.؟?!…]["”»)]?$/.test(wOf(src[i]))) { sentenceEnd[i] = 1; punctuated = true; }

  // punctuation between token s-1 and token s, from the original words (pasted text; a transcript has none)
  const between = s => {
    if (s > 0 && s < n && src[s - 1] === src[s]) return wOf(src[s]);
    let t = s > 0 ? /[^\p{L}\p{N}]*$/u.exec(wOf(src[s - 1]))[0] : "";
    for (let k = s > 0 ? src[s - 1] + 1 : 0, z = s < n ? src[s] : words.length; k < z; k++) t += " " + wOf(k);
    return s < n ? t + " " + /^[^\p{L}\p{N}]*/u.exec(wOf(src[s]))[0] : t;
  };
  const ORNATE = /[\uFD3E\uFD3F{}]/, Q_OPEN = /[(\[«"“'‘]/, Q_CLOSE = /[)\]»"”'’]/;
  // How is the stretch [s, e) of speech presented?  2 = announced as Qur'an (a Qur'an cue or a reference directly before
  // it, "صدق الله العظيم" / a reference directly after it, or ﴿ ﴾ / { } around it), 1 = enclosed in ordinary quotation
  // marks / brackets, 0 = plain speech.
  const context = (s, e) => {
    if (cueDirectStrong[s] === KIND.quran || cueTrail[e - 1] === KIND.quran) return 2;
    for (const r of refs) if (r.isRef && ((r.end <= s && s - r.end <= 1) || (r.pos >= e && r.pos - e <= 1))) return 2;
    // brackets count only when they close right after the run (or the text ends there): the quoted string is the run
    const op = between(s);
    if (ORNATE.test(op) && (e === n || ORNATE.test(between(e)))) return 2;
    return Q_OPEN.test(op) && Q_CLOSE.test(between(e)) ? 1 : 0;
  };
  // A word spelled like a function word that is a content word at this place of the Qur'an ("وهن" in 19:4)
  const homograph = (w, pid) => {
    const v = QURAN_HOMOGRAPHS.get(w);
    if (v === undefined || pid < 0 || pid >= corpus.NQ) return false;
    if (v === null) return true;
    const d = corpus.describe(pid);
    return v.has(d.surah + ":" + d.ayah);
  };

  const X = { tok, ftok, corpus, o, wt, idf, n, cueMask, metaMask, formMask, dMask, cueLead, cueTrail, cueDirect, cueDirectStrong, sentenceEnd, context, homograph,
    isWord: o.tolerant && o.realWords ? w => corpus.isWord(w) : null };

  // ---------- 1) seeds ----------
  const hits = new Map(); // pid -> [pos, weight, shingle id, ...]
  const lnN = Math.log(corpus.N);
  const gramIds = new Map();
  for (const nn of [3, 2]) {
    for (let i = 0; i + nn <= n; i++) {
      const key = nn === 3 ? ftok[i] + " " + ftok[i + 1] + " " + ftok[i + 2] : ftok[i] + " " + ftok[i + 1];
      const r = corpus.lookup(nn, key);
      if (!r) continue;
      const w = (lnN - Math.log(r.df)) * (nn === 3 ? 1 : 0.5);
      // only a repeated 3-gram marks "the same quotation again" (2-grams repeat inside ordinary texts)
      let id = -1;
      if (nn === 3) { id = gramIds.get(key); if (id === undefined) gramIds.set(key, id = gramIds.size); }
      for (const part of r.parts) {
        const { post, base } = part;
        for (let k = part.a; k < part.b; k++) {
          const pid = base + post[k];
          if (off(pid)) continue;
          let a = hits.get(pid); if (!a) hits.set(pid, a = []);
          a.push(i, w, id);
        }
      }
    }
  }

  // ---------- 2) clusters ----------
  const clusters = [];
  const seedOk = (s, e, sc, cnt) => sc >= (cueNear[s] || cueNear[Math.min(n - 1, e)] ? o.seedMinCue : o.seedMin) && (cnt >= 2 || sc >= o.seedMin);
  for (const [pid, a] of hits) {
    const trip = [];
    for (let k = 0; k < a.length; k += 3) trip.push([a[k], a[k + 1], a[k + 2]]);
    trip.sort((x, y) => x[0] - y[0]);
    let i0 = 0;
    const flush = i1 => {
      let sc = 0; for (let k = i0; k < i1; k++) sc += trip[k][1];
      const s = trip[i0][0], e = trip[i1 - 1][0];
      if (!seedOk(s, e, sc, i1 - i0)) return;
      clusters.push({ pid, a: s, b: e + 3, score: sc });
      // The same quotation said again shortly after itself: its word groups come round a second time. One alignment
      // finds only one of the repetitions, so each round is also verified on its own stretch of speech.
      const seenId = new Set(), subs = []; let cur = null;
      for (let k = i0; k < i1; k++) {
        const [pos, w, id] = trip[k];
        if (!cur || (id >= 0 && seenId.has(id))) { cur = { s: pos, e: pos, sc: 0, cnt: 0 }; subs.push(cur); seenId.clear(); }
        if (id >= 0) seenId.add(id);
        cur.e = pos; cur.sc += w; cur.cnt++;
      }
      if (subs.length < 2) return;
      // an ayah is aligned together with the ayahs before it, so its stretch reaches back by their length
      let back = 4;
      if (corpus.quranLike(pid)) { const lo = Math.max(corpus.quranRange(pid)[0], pid - 3); for (let q = lo; q < pid; q++) back += corpus.tok(q).length; }
      subs.forEach((sub, k) => {
        if (!seedOk(sub.s, sub.e, sub.sc, sub.cnt)) return;
        clusters.push({ pid, a: sub.s, b: sub.e + 3, score: sub.sc, tMin: k ? Math.max(0, sub.s - back) : 0, tMax: k + 1 < subs.length ? subs[k + 1].s : n });
      });
    };
    for (let k = 1; k < trip.length; k++) if (trip[k][0] - trip[k - 1][0] > o.seedGap) { flush(k); i0 = k; }
    flush(trip.length);
  }
  // strongest first; ties in an order that does not depend on the order in which packs were loaded
  clusters.sort((x, y) => y.score - x.score || corpus.stableRank(x.pid) - corpus.stableRank(y.pid) || x.a - y.a || (x.tMin ?? -1) - (y.tMin ?? -1));
  {
    // A recitation leaves its seed evidence spread over several ayahs (one cluster each), while a hadith or a book that
    // quotes the same surah holds all of it in ONE passage. So a Qur'an cluster is weighed together with the clusters of
    // the neighbouring ayahs of its surah on the same stretch of speech — otherwise "قل هو الله أحد الله الصمد ..." would
    // lose every ayah to the hadith that narrates someone reciting it.
    const bySurah = new Map();
    for (const cl of clusters) {
      if (!corpus.quranLike(cl.pid)) continue;
      const k = corpus.quranRange(cl.pid)[0];
      let g = bySurah.get(k); if (!g) bySurah.set(k, g = []); g.push(cl);
    }
    for (const g of bySurah.values()) {
      if (g.length < 2) continue;
      const by = g.slice().sort((x, y) => x.a - y.a);
      const lower = v => { let lo = 0, hi = by.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (by[mid].a < v) lo = mid + 1; else hi = mid; } return lo; };
      const per = new Map();
      for (const cl of g) {
        // ayahs of the same surah near this one, on the speech around it (each ayah once: its strongest cluster there)
        per.clear();
        for (let k = lower(cl.a - o.quranReach), z = lower(cl.a + o.quranReach + 1); k < z; k++) {
          const d = by[k];
          if (Math.abs(d.pid - cl.pid) <= 12 && (per.get(d.pid) || 0) < d.score) per.set(d.pid, d.score);
        }
        let sum = 0; for (const v of per.values()) sum += v;
        if (sum > cl.score) cl.agg = sum;
      }
    }
    // keep only the strongest candidates per stretch of speech (the true source always has the most seed evidence)
    const perBucket = new Map(), kept = [], bucketBest = new Map();
    for (const cl of clusters) {
      // clusters arrive strongest first: one far weaker than the best in its stretch cannot be the source or a parallel
      const bb = bucketBest.get(cl.a >> 3);
      if (bb === undefined) bucketBest.set(cl.a >> 3, cl.score); else if ((cl.agg ?? cl.score) < o.seedShare * bb) continue;
      // separate quotas for the Qur'an, the hadith collections and books, so a much-quoted verse is never crowded out
      // by the hadith that quote it or by commentaries on it
      const cls = corpus.tier(cl.pid);
      const k = (cl.a >> 3) * 3 + cls, c = perBucket.get(k) || 0;
      if (c >= (cls === 2 ? o.perRegionBooks : o.perRegion)) continue;
      perBucket.set(k, c + 1); kept.push(cl);
    }
    clusters.length = 0; clusters.push(...kept);
  }
  if (clusters.length > o.maxClusters) clusters.length = o.maxClusters;

  // ---------- 3) verify each cluster by alignment ----------
  let found = [];
  const seen = new Set(); // dedupe identical (source span, transcript span)
  const cover = new Uint16Array(n); // how many accepted matches already cover a token (caps redundant work)
  const keyOf = m => `${m.pidA}-${m.pidB}:${m.ps}:${m.ts}-${m.te}`;
  const accept = m => {
    if (!m) return false;
    const key = keyOf(m);
    if (seen.has(key)) return false; seen.add(key);
    found.push(m);
    if (!m.echo) for (let i = m.ts; i < m.te; i++) cover[i]++;
    return true;
  };
  for (const cl of clusters) {
    const mid = (cl.a + cl.b) >> 1;
    if (cover[Math.min(n - 1, mid)] >= 14) continue;
    accept(verify(cl, X));
  }

  // ---------- 3b) a short canonical text right after its cue ("قال ﷺ الدين النصيحة", "قال تعالى فويل للمصلين") ----------
  // Two or three words leave too little seed evidence for a cluster, so the texts that BEGIN with the words after the
  // cue are looked up directly. verify() accepts them only as an exact match from the start of the text.
  for (const c of cues) {
    if (c.trailing || c.weak || c.kind === "saying") continue;
    let s = c.end;       // reference words between the cue and the text are skipped ("قال ﷺ في صحيح مسلم: ...")
    while (s < n && s < c.end + 10 && (metaMask[s] || cueMask[s])) s++;
    if (s + 2 > n) continue;
    // (a quotation of ordinary length already found there needs no second look; a short one may be in other books too)
    if (found.some(m => m.status !== "lead" && !m.echo && m.ts >= s - 1 && m.ts <= s + 2 && m.sum.inf >= o.minWords)) continue;
    const fits = c.kind === "quran" ? pid => corpus.quranLike(pid) : pid => !corpus.quranLike(pid) && !corpus.isBook(pid);
    const collect = nn => {
      if (s + nn > n) return [];
      const r = corpus.lookup(nn, ftok.slice(s, s + nn).join(" ")); if (!r) return [];
      const out = [];
      for (const part of r.parts) for (let k = part.a; k < part.b; k++) { const pid = part.base + part.post[k]; if (!off(pid) && fits(pid)) out.push(pid); }
      return out;
    };
    // only texts that BEGIN with these words: an ayah, a matn, or the matn inside a narration ("... قال: الدين النصيحة")
    const begins = pid => {
      const Pp = corpus.tok(pid), FPp = corpus.ftok(pid), j0 = c.kind === "quran" ? 0 : matnStart(corpus, pid);
      for (let j = j0; j + 1 < FPp.length; j++) {
        if (FPp[j] === ftok[s] && FPp[j + 1] === ftok[s + 1] && (j === j0 || (c.kind !== "quran" && SAY_END.has(Pp[j - 1])))) return true;
        if (c.kind === "quran") break;
      }
      return false;
    };
    const pids = [...new Set([...collect(3), ...collect(2)])].filter(begins).sort((x, y) => corpus.stableRank(x) - corpus.stableRank(y)).slice(0, o.anchorMax);
    for (const pid of pids) accept(verify({ pid, a: s, b: Math.min(n, s + 3), score: 0, tMin: s, tMax: Math.min(n, s + 20), anchored: true }, X));
  }

  // ---------- 3d) short exact fragments of an ayah ("واستعينوا بالصبر والصلاة", "قل أعوذ برب الناس") ----------
  // Three to five words leave too little seed evidence for a cluster. The Qur'an is small and fixed, so an EXACT run of
  // its words is evidence by itself — when the words are informative enough. Rule (thresholds chosen on the development
  // half of the QDetect tweets and on the development lecture):
  //   - the run is contiguous and identical word for word in normalised spelling (no phonetic folding, no near match,
  //     no gap), inside one surah, at least three words long;
  //   - it does not end on a particle that cannot end a clause ("في", "إذا", "الذين");
  //   - announced (a Qur'an cue or reference directly before it, "صدق الله العظيم" / a reference directly after it,
  //     ﴿ ﴾, { } or ordinary quotation marks / brackets that enclose exactly the run): two content words and
  //     evidence >= fragEvCue (one content word for a whole ayah announced as Qur'an: ﴿كل من عليها فان﴾);
  //   - in plain speech the run is measured without the function words at its two ends (for part of an ayah: also
  //     without common words there) and must still be three words long, with three content words and evidence >=
  //     fragEvWhole for a whole ayah, fragEvPlain for part of one, fragEvMid for exactly three content words from the
  //     middle of an ayah (neither its beginning nor its end); never inside the stretch that a hadith / saying cue
  //     announces;
  //   - devotional formulas and everyday dhikr are not content words unless a Qur'an cue directly precedes.
  // The match itself is built by verify(), so the strict rules (an omitted negation at the edge -> partial, excerpt
  // flags, parallels in other ayahs, the surah the speaker named) apply as for any other quotation.
  if (o.fragQuran && corpus.NQ > 0 && n >= 3) {
    const Q = corpus.quranStream();
    const covered = new Uint8Array(n);
    for (const m of found) if (m.status !== "lead" && !m.echo) for (let i = m.ts; i < m.te; i++) covered[i] = 1;
    // the stretch of speech that a hadith / saying cue announces: Qur'anic words there are part of the narration
    const announced = new Uint8Array(n);
    for (const c of cues) if (!c.trailing) for (let i = c.pos; i < Math.min(n, c.end + o.cueReach); i++) announced[i] = c.weak ? 0 : KIND[c.kind];
    let prevEnd = 0;
    for (let i = 0; i + 3 <= n; i++) {
      const occ = Q.grams.get(tok[i] + " " + tok[i + 1] + " " + tok[i + 2]);
      if (occ === undefined) continue;
      // the longest exact continuation, and every place in the Qur'an where it stands
      let L = 0, best = [];
      for (const p of occ) {
        if (off(Q.pid[p]) || off(Q.pid[p + 2])) continue;
        const end = Q.start[corpus.quranRange(Q.pid[p])[1] + 1];
        let k = 3;
        while (i + k < n && p + k < end && Q.tok[p + k] === tok[i + k] && !off(Q.pid[p + k])) k++;
        if (k > L) { L = k; best = [p]; } else if (k === L) best.push(p);
      }
      if (L < 3 || i + L <= prevEnd) continue;
      prevEnd = i + L;
      // words that announce or locate a quotation are not quoted words
      let s = i, e = i + L;
      while (s < e && (cueMask[s] || metaMask[s])) s++;
      for (let k = s; k < e; k++) if (cueMask[k] || metaMask[k]) { e = k; break; }
      // a quotation does not stop on "في" / "إذا" / "الذين" (﴿كل من عليها فان﴾ does not: that "فان" is not ف + إن)
      if (e - s < 3 || (OPEN_PARTICLES.has(tok[e - 1]) && !(QURAN_HOMOGRAPHS.has(tok[e - 1]) && best.some(p => homograph(tok[e - 1], Q.pid[p + (e - 1 - i)]))))) continue;
      let cov = 0; for (let k = s; k < e; k++) cov += covered[k];
      if (cov * 2 >= e - s) continue;
      const ctx = context(s, e);
      if (!ctx && (announced[s] === KIND.hadith || announced[s] === KIND.saying)) continue;
      // Announced: the run as it stands. Plain speech: measured without the function words at its two ends, and for
      // part of an ayah also without common words there ("رحمكم [الله] واذكر ربك ..." — a chance neighbour must not
      // add weight).
      const at = p => p + (s - i), len = e - s;
      const wholeAt = p => { const g = at(p); return Q.start[Q.pid[g]] === g && Q.start[Q.pid[g + len - 1] + 1] === g + len; };
      const whole = best.some(wholeAt);
      const touches = best.some(p => { const g = at(p); return Q.start[Q.pid[g]] === g || Q.start[Q.pid[g + len - 1] + 1] === g + len; });
      const masked = k => ctx !== 2 && (formMask[k] === 1 || (dMask[k] === 1 && !o.fragDhikr));
      // (a function word, unless the ayah has a content word of the same spelling at this place: "وهن العظم")
      const func = k => FUNCTION_WORDS.has(tok[k]) && !(QURAN_HOMOGRAPHS.has(tok[k]) && best.some(p => homograph(tok[k], Q.pid[p + (k - i)])));
      const edgeWord = ctx ? () => false : whole ? func : k => func(k) || idf(ftok[k]) < 3;
      let cs = s, ce = e;
      while (cs < ce && edgeWord(cs)) cs++;
      while (ce > cs && edgeWord(ce - 1)) ce--;
      if (ce - cs < 3 && !o.fragDhikr) continue;
      let content = 0, ev = 0, plain = 0;
      for (let k = cs; k < ce; k++) {
        if (masked(k)) continue;
        ev += idf(ftok[k]);
        if (func(k)) continue;
        content++;
        if (!DEVOTIONAL.has(ftok[k])) plain++;
      }
      if (!ctx && !plain && !o.fragDhikr) continue;                 // nothing but words of everyday dhikr
      let ok = ctx ? content >= (ctx === 2 && whole ? 1 : 2) && ev >= o.fragEvCue
        : content >= 3 && ev >= (whole ? o.fragEvWhole : content === 3 && !touches ? o.fragEvMid : o.fragEvPlain);
      // benchmark comparison only: four or more words that are nothing but a listed dhikr phrase count as the ayah
      if (!ok && o.fragDhikr && len >= 4) { ok = true; for (let k = s; k < e; k++) if (!dMask[k]) { ok = false; break; } }
      // A changed word right next to the run is a changed quotation, not a short exact one ("قل أعوذ برب البشر"): when
      // the speech goes straight on (no sentence end, bracket or cue in between) with a word that is not the ayah's,
      // and that word stands where the LAST (or first) word of the ayah should be, or the speech rejoins the ayah one
      // word later, this place in the Qur'an is not cited by this path. A dropped or added "و" / "ف" is not a change.
      const sameButConj = (w, p) => p === "و" + w || p === "ف" + w || w === "و" + p || w === "ف" + p;
      const changedNextTo = p => {
        const g = at(p), a0 = Q.start[Q.pid[g]], a1 = Q.start[Q.pid[g + len - 1] + 1];
        if (g + len < a1 && e < n && !sentenceEnd[e - 1] && !cueMask[e] && !metaMask[e] && !Q_CLOSE.test(between(e)) && !ORNATE.test(between(e))
          && !sameButConj(tok[e], Q.tok[g + len]) && (g + len + 1 === a1 || (e + 1 < n && tok[e + 1] === Q.tok[g + len + 1]))) return true;
        return g > a0 && s > 0 && !sentenceEnd[s - 1] && !cueMask[s - 1] && !metaMask[s - 1] && !Q_OPEN.test(between(s)) && !ORNATE.test(between(s))
          && !sameButConj(tok[s - 1], Q.tok[g - 1]) && (g - 1 === a0 || (s > 1 && tok[s - 2] === Q.tok[g - 2]));
      };
      if (ok) best = best.filter(p => !changedNextTo(p));
      if (!ok || !best.length) continue;
      // a whole ayah before the same words inside a longer ayah; otherwise in the order of the mushaf
      best.sort((x, y) => wholeAt(y) - wholeAt(x) || x - y);
      for (const p of best.slice(0, o.fragMaxOcc)) {
        const g = at(p);
        accept(verify({ pid: Q.pid[g], a: s, b: e, score: 0, tMin: s, tMax: e, win: { lo: Q.pid[g], hi: Q.pid[g + (e - s) - 1] }, frag: true }, X));
      }
    }
  }

  // ---------- 3c) long recitations: neighbouring ayah ranges on neighbouring speech are ONE recitation ----------
  {
    const groups = new Map();
    for (const m of found) {
      if (!m.isQ || m.status === "lead") continue;
      const k = corpus.quranRange(m.pidA)[0];
      let g = groups.get(k); if (!g) groups.set(k, g = []); g.push(m);
    }
    const drop = new Set(), add = [];
    const lenOf = (p, q) => { let L = 0; for (let x = p; x <= q; x++) L += corpus.tok(x).length; return L; };
    for (const [, g] of [...groups].sort((x, y) => x[0] - y[0])) {
      if (g.length < 2) continue;
      g.sort((x, y) => x.ts - y.ts || x.pidA - y.pidA || y.te - x.te || y.pidB - x.pidB);
      const chains = [];
      for (const m of g) {
        // overlapping or abutting speech, and the ayahs continue where the chain stands (never back to an earlier ayah)
        const ch = chains.find(c => m.ts <= c.te + 3 && m.pidA >= c.pidA && m.pidA <= c.pidB + 1 && (m.ts < c.te - 3 || m.pidA >= c.pidB)
          && (m.pidB <= c.pidB || c.len + lenOf(c.pidB + 1, m.pidB) <= o.mergeTokens));
        if (!ch) { chains.push({ ts: m.ts, te: m.te, pidA: m.pidA, pidB: m.pidB, len: lenOf(m.pidA, m.pidB), members: [m] }); continue; }
        if (m.pidB > ch.pidB) { ch.len += lenOf(ch.pidB + 1, m.pidB); ch.pidB = m.pidB; }
        if (m.te > ch.te) ch.te = m.te;
        ch.members.push(m);
      }
      for (const ch of chains) {
        if (ch.members.length < 2) continue;
        const [lo, hi] = corpus.quranRange(ch.pidA);
        const big = verify({ pid: ch.pidA, a: ch.ts, b: ch.te, score: 0, win: { lo: Math.max(lo, ch.pidA - 1), hi: Math.min(hi, ch.pidB + 1) } }, X);
        if (!big || big.status === "lead") continue;
        // the single alignment is the truth; what it contains (shorter ranges, refrains inside the range) is not a parallel
        const inside = m => m.ts >= big.ts - 1 && m.te <= big.te + 1 && m.pidA >= big.pidA && m.pidB <= big.pidB;
        if (!ch.members.some(inside)) continue;
        for (const m of g) if (inside(m)) drop.add(m);
        add.push(big);
      }
    }
    if (drop.size || add.length) {
      found = found.filter(m => !drop.has(m));
      for (const m of add) { const key = keyOf(m); if (!found.some(x => keyOf(x) === key)) found.push(m); }
    }
  }

  // ---------- 4) group overlapping matches into citations ----------
  const net = m => m.det.inf - m.det.diff - m.det.ins - m.det.del;   // informative words that agree (by sound) minus words that do not
  const textual = m => (m.status === "lead" ? 0 : 1);
  const srank = m => corpus.stableRank(m.pidA);
  const exactM = m => m.sum.diff + m.sum.ins + m.sum.del + m.sum.asr + m.sum.near === 0;
  // longest agreeing span first: a long quotation with a few differences outranks a short exact fragment inside it
  found.sort((x, y) => textual(y) - textual(x) || net(y) - net(x) || rank(y) - rank(x) || y.sum.evidence - x.sum.evidence || (x.frag && y.frag ? y.whole - x.whole : 0) || srank(x) - srank(y) || x.ts - y.ts || x.ps - y.ps);
  let cites = [];
  for (const m of found) {
    if (m.echo) continue;
    let home = null, clash = false;
    for (const c of cites) {
      const ov = Math.min(c.te, m.te) - Math.max(c.ts, m.ts);
      if (ov <= 0) continue;
      const share = ov / Math.min(c.te - c.ts, m.te - m.ts);
      if (share >= 0.5) { home = c; break; }
      if (share > 0.2) clash = true;
    }
    if (home) {
      const b = home.best;
      // (word for word the same on both sides: "whole text" against "part of a longer text" is still the same wording)
      const sameTier = (rank(m) >= rank(b) || (rank(m) >= 3 && exactM(m) && exactM(b))) && m.sum.q >= b.sum.q - 0.12 && m.sum.evidence >= 0.6 * b.sum.evidence;
      if (sameTier) { if (home.alts.length < 40) home.alts.push(m); }
      else if (home.others.length < 40) home.others.push(m);     // the same words found elsewhere in another wording
      continue;
    }
    if (clash && rank(m) <= 1) continue;
    cites.push({ ts: m.ts, te: m.te, best: m, alts: [], others: [], refs: [], colAfter: [], colBefore: [] });
  }
  // a hadith that contains the words of an ayah found here ("... فيقول إنا لله وإنا إليه راجعون ...") is listed under the
  // ayah as a parallel; by itself it would have been too little to report
  for (const m of found) {
    if (!m.echo) continue;
    const home = cites.find(c => c.best.isQ && rank(c.best) >= 3 && m.ts >= c.ts - 1 && m.te <= c.te + 1 && m.sum.inf >= 0.85 * c.best.sum.inf);
    if (home && home.alts.length < 40) home.alts.push(m);
  }

  // Among sources that match about equally well, prefer the primary one: Qur'an, then the hadith collections,
  // then books (a tafsir or a fiqh book that merely quotes the verse/hadith is listed under "also found in").
  // The cue decides between Qur'an and hadith when the words are in both: after "قال رسول الله ﷺ" a few words that
  // also occur inside an ayah are the hadith, unless a whole ayah was recited.
  for (const c of cites) {
    const all = [c.best, ...c.alts];
    const ck = cueDirect[c.best.ts];
    const baseTier = x => corpus.tier(x.pidA);
    const tierOf = x => (baseTier(x) === 0 && ck === KIND.hadith && !x.wholeAyah ? 1.5 : baseTier(x));
    const bi = c.best.sum.inf;
    // a book that quotes the verse / hadith usually matches a word or two more (its own "قال تعالى", a connecting word):
    // the primary source still is the source as long as it covers the same quoted words, give or take two
    const bookBest = baseTier(c.best) === 2;
    const eligible = all.filter(x => (x.sum.inf >= 0.85 * bi || (x.sum.inf >= 4 && bi - x.sum.inf <= 1) || (bookBest && baseTier(x) < 2 && x.sum.inf >= 4 && bi - x.sum.inf <= 2)) && rank(x) >= rank(c.best));
    let top = eligible.sort((x, y) => tierOf(x) - tierOf(y) || y.sum.q - x.sum.q || y.sum.evidence - x.sum.evidence || srank(x) - srank(y))[0];
    if (!(top && top !== c.best && tierOf(top) < tierOf(c.best))) top = c.best;
    // right after an explicit Qur'an cue a Qur'an match is the source, whatever else contains the same words
    if (ck === KIND.quran && baseTier(top) !== 0) {
      const q = all.filter(x => baseTier(x) === 0).sort((x, y) => y.sum.inf - x.sum.inf || y.sum.q - x.sum.q || srank(x) - srank(y))[0];
      if (q) top = q;
    }
    if (top !== c.best) { c.alts = all.filter(x => x !== top); c.best = top; c.ts = top.ts; c.te = top.te; }
    c.tierOf = tierOf;
  }

  // Everyday dhikr whose words are an ayah ("وإنا لله وإنا إليه راجعون" at the end of a condolence) is not a quotation of
  // a hadith in which somebody says it: without a cue, a hadith citation made of nothing else is dropped. (The ayah
  // itself, when its words are said exactly, is still found, with such hadith as parallels.)
  cites = cites.filter(c => {
    const b = c.best;
    if (b.isQ || b.hasCue) return true;
    let d = 0;
    for (let i = b.ts; i < b.te; i++) { if (dMask[i]) d++; else if (!formMask[i] && !DEVOTIONAL.has(ftok[i])) return true; }
    return d < 3;
  });

  // ---------- 5) what the speaker SAID about the source: every spoken reference belongs to ONE citation ----------
  cites.sort((x, y) => x.ts - y.ts || x.te - y.te);
  {
    const gap = (x, y) => { let g = 0; for (let i = Math.max(0, x); i < Math.min(n, y); i++) if (!cueMask[i] && !formMask[i] && !metaMask[i]) g++; return g; };
    const leadCueIn = (x, y, except) => cues.some(c => !c.trailing && c.pos >= x && c.pos < y && c.kind !== except);
    const around = (pos, end) => {
      let prev = null, next = null;
      for (const c of cites) {
        if (c.te <= pos) { if (!prev || c.te > prev.te) prev = c; }
        else if (c.ts >= end) { if (!next) next = c; }
        else return null;                       // inside a quotation: part of the quoted text, not a statement about it
      }
      return { prev, next };
    };
    for (const sp of colSpans) {
      const nb = around(sp.pos, sp.end); if (!nb) continue;
      if (sp.type === "bare") {      // a bare name counts only when it closes a quotation ("... [الحديث] ابن ماجه")
        if (nb.prev && gap(nb.prev.te, sp.pos) <= 2 && !leadCueIn(nb.prev.te, sp.pos, null)) nb.prev.colAfter.push(...sp.cols);
        continue;
      }
      const okPrev = nb.prev && gap(nb.prev.te, sp.pos) <= 8 && !leadCueIn(nb.prev.te, sp.pos, null);
      const dNext = nb.next ? gap(sp.end, nb.next.ts) : Infinity, okNext = dNext <= 12;
      // "رواه X" speaks about the text BEFORE it; "في صحيح X ..." / "روى X ..." usually opens the next quotation
      if (sp.type === "trail" ? okPrev : okPrev && !(okNext && (dNext <= 2 || cueMask[sp.pos]))) nb.prev.colAfter.push(...sp.cols);
      else if (okNext) nb.next.colBefore.push(...sp.cols);
    }
    for (const r of refs) {
      const nb = around(r.pos, r.end); if (!nb) continue;
      const dNext = nb.next ? gap(r.end, nb.next.ts) : Infinity, dPrev = nb.prev ? gap(nb.prev.te, r.pos) : Infinity;
      const okNext = dNext <= (r.ayah != null ? 4 : 2);
      const okPrev = dPrev <= 4 && !leadCueIn(nb.prev.te, r.pos, "quran");
      let own = okNext ? nb.next : okPrev ? nb.prev : null;
      // "[آية] سورة البقرة الآية 255 ثم قال تعالى [آية أخرى]": the reference closes the first quotation
      if (okNext && okPrev && dPrev <= 1 && leadCueIn(r.end, nb.next.ts, null) && !leadCueIn(nb.prev.te, r.pos, null)) own = nb.prev;
      if (own) own.refs.push(r);
    }
  }
  // the speaker named the place: among equally good identical texts, the one at that place is the source (2:5 / 31:5);
  // a refrain verse is checked against the named ayah itself, because the list of parallels is capped (55:13 … 55:77)
  for (const c of cites) {
    const b = c.best;
    if (!b.isQ || !c.refs.length) continue;
    const exact = c.refs.filter(r => r.ayah != null), want = exact.length ? exact : c.refs;
    const at = (m, r) => { const d = corpus.describe(m.pidA, m.pidB); return d.surah === r.surah && (r.ayah == null || (r.ayah <= d.ayahEnd && (r.ayahEnd ?? r.ayah) >= d.ayah)); };
    if (want.some(r => at(b, r))) continue;
    const asGood = m => m.isQ && rank(m) >= rank(b) && m.sum.q >= b.sum.q - 0.02 && m.sum.inf >= 0.85 * b.sum.inf;
    let pick = c.alts.find(m => asGood(m) && want.some(r => at(m, r))) || null;
    for (const r of exact) {
      if (pick) break;
      let pid = null;
      if (b.pidA < corpus.NQ) pid = corpus.coreRef.get(`${r.surah}:${r.ayah}`) ?? null;
      else { const [lo, hi] = corpus.quranRange(b.pidA); if (corpus.describe(b.pidA).surah === r.surah && lo + r.ayah - 1 <= hi) pid = lo + r.ayah - 1; }
      if (pid == null || off(pid)) continue;
      const hi = Math.min(corpus.quranRange(pid)[1], pid + (b.pidB - b.pidA));
      const m = verify({ pid, a: c.ts, b: c.te, score: 0, win: { lo: pid, hi }, tMin: Math.max(0, c.ts - 2), tMax: Math.min(n, c.te + 2) }, X);
      if (m && asGood(m) && m.pidA === pid) pick = m;
    }
    if (pick) { c.alts = [b, ...c.alts.filter(x => x !== pick)]; c.best = pick; c.ts = pick.ts; c.te = pick.te; }
  }

  // the same for hadith: of several collections with the same wording, the one the speaker named is shown as the source
  for (const c of cites) {
    const b = c.best, said = c.colAfter.length ? c.colAfter : c.colBefore;
    if (b.isQ || corpus.isBook(b.pidA) || !said.length) continue;
    const colOf = m => corpus.describe(m.pidA).collection;
    if (said.includes(colOf(b))) continue;
    const pick = c.alts.filter(m => !m.isQ && !corpus.isBook(m.pidA) && (rank(m) >= rank(b) || (rank(m) >= 3 && exactM(m) && exactM(b))) && m.sum.q >= b.sum.q - 0.02 && m.sum.inf >= b.sum.inf && said.includes(colOf(m)))
      .sort((x, y) => said.indexOf(colOf(x)) - said.indexOf(colOf(y)) || srank(x) - srank(y))[0];
    if (pick) { c.alts = [b, ...c.alts.filter(x => x !== pick)]; c.best = pick; c.ts = pick.ts; c.te = pick.te; }
  }

  // ---------- 6) cues without a textual match ----------
  const taken = new Uint8Array(n);
  for (const c of cites) for (let i = c.ts; i < c.te; i++) taken[i] = 1;
  const extra = [];
  const nextLead = new Array(cues.length).fill(null);
  for (let ci = cues.length - 1, nx = null; ci >= 0; ci--) { nextLead[ci] = nx; if (!cues[ci].trailing) nx = cues[ci]; }
  for (let ci = 0; ci < cues.length; ci++) {
    const cue = cues[ci];
    if (cue.trailing) continue;
    const next = nextLead[ci];
    let wEnd = Math.min(n, cue.end + o.meaningWindow, next ? Math.max(next.pos, cue.end + 6) : n);
    // real transcripts carry punctuation: the announced quotation most likely ends at the first sentence end
    for (let i = cue.end + 2; i < wEnd - 1; i++) if (sentenceEnd[i]) { wEnd = i + 1; break; }
    if (wEnd - cue.end < 3) continue;
    let covered = false;
    // the cue is answered only by a citation that starts right after it (same sentence when the transcript is punctuated)
    let reach = Math.min(n, cue.end + o.cueAnswer, next ? next.pos : n);
    for (let i = cue.end + 2; i < reach; i++) if (sentenceEnd[i]) { reach = i + 1; break; }
    for (let i = cue.end; i < reach; i++) if (taken[i]) { covered = true; break; }
    if (covered) continue;
    const mm = cue.kind === "saying" && !corpus.hasBooks() ? null : meaningCandidates(cue, wEnd, tok, ftok, corpus, o);
    if (mm && mm.strong) {
      extra.push({ ts: cue.pos, te: mm.te, cue, status: "meaning", meaning: mm });
      for (let i = cue.pos; i < mm.te; i++) taken[i] = 1;
    } else if (commentaryAt(ftok, cue.end, wEnd)) {
      continue;   // the words after the cue are the speaker explaining ("أما الثاني فهو ..."), not an announced quotation
    } else {
      // stop the span at a sentence-ish length; the quotation boundary is unknown
      const te = Math.min(wEnd, cue.end + 14);
      extra.push({ ts: cue.pos, te, cue, status: "notfound", meaning: mm });
    }
  }

  // ---------- 7) assemble the ledger ----------
  const ledger = [];
  const wordTime = i => wObj(src[clamp(i, 0, n - 1)]);
  const spokenText = (a, b) => { const A = src[a], B = src[Math.min(b, n) - 1]; return words.slice(A, B + 1).map(wordText).join(" "); };
  const cueBefore = ts => { let best = null; for (const c of cues) { if (c.trailing || c.pos > ts) continue; if (ts - c.end <= 12) best = c; } return best; };

  // An announced quotation that stops before the end of its source and then RUNS ON with words that are not the
  // source's next words ("قال ﷺ من كان يؤمن بالله واليوم الآخر فليقتل جاره وليأخذ ماله"): the matched words are exact, yet
  // what was presented as the saying is not what the source says. The entry is flagged (tailUnmatched), nothing else
  // changes: quoting part of a text and then commenting on it is ordinary and correct, and only the transcript's own
  // punctuation tells a comment from a continuation. So the rule is narrow:
  //   - a Qur'an / hadith cue directly precedes the matched words, and the source goes on after them;
  //   - the speech goes on after them with at least three content words before the sentence end, "رواه ...", the next
  //     announcing phrase or the next citation;
  //   - those words do not follow the source;
  //   - a transcript without any punctuation shows no sentence ends, so there the stretch must be closed by a cue or
  //     by the end of the transcript within 12 words.
  const tailRunsOn = c => {
    const b = c.best;
    if (b.isB || !b.tail || rank(b) < 3) return null;
    const k = cueDirect[b.ts];
    if (k !== KIND.quran && k !== KIND.hadith) return null;
    if (sentenceEnd[b.te - 1]) return null;
    let stop = b.te, content = 0, closed = false;
    while (true) {
      if (stop >= n || cueMask[stop] || metaMask[stop]) { closed = true; break; }
      if (taken[stop] || stop >= b.te + 12) break;
      if (!formMask[stop] && !DIGITS.test(tok[stop])) content++;
      stop++;
      if (sentenceEnd[stop - 1]) { closed = true; break; }
    }
    if (content < 3 || (!punctuated && !closed)) return null;
    const al = align(tok.slice(b.te, stop), ftok.slice(b.te, stop), b.P.slice(b.peLocal, b.peLocal + 16), b.FP.slice(b.peLocal, b.peLocal + 16), wt, { tolerant: o.tolerant, isWord: X.isWord });
    let agree = 0;
    if (al) for (const op of al.ops) if (SOLID[op.op] === 1 || op.op === "near" || op.soft) agree += op.op === "joinT" ? 2 : 1;
    return agree * 2 < stop - b.te ? spokenText(b.te, stop) : null;
  };

  for (const c of cites) {
    const b = c.best;
    const d = corpus.describe(b.pidA, b.pidB);
    c.alts.sort((x, y) => c.tierOf(x) - c.tierOf(y) || (corpus.describe(x.pidA).rank || 0) - (corpus.describe(y.pidA).rank || 0) || srank(x) - srank(y));
    const sources = [b, ...c.alts].map(x => ({ ...corpus.describe(x.pidA, x.pidB), q: +x.sum.q.toFixed(3), status: x.status }));
    // unique by ref, keep order (best first)
    const uniq = []; const seenRef = new Set();
    for (const s of sources) if (!seenRef.has(s.ref)) { seenRef.add(s.ref); uniq.push(s); }
    const cue = cueBefore(c.ts);
    const entry = {
      ts: c.ts, te: c.te, wordStart: src[c.ts], wordEnd: src[c.te - 1],
      start: wordTime(c.ts).start ?? null, end: wordTime(c.te - 1).end ?? null,
      spoken: spokenText(c.ts, c.te),
      type: d.type, status: b.status, statusAr: STATUS[b.status].ar, fidelity: STATUS[b.status].fidelity,
      agreement: +b.sum.q.toFixed(3),
      counts: { exact: b.sum.exact, asr: b.sum.asr + b.sum.join, near: b.sum.near, diff: b.sum.diff, added: b.sum.ins, omitted: b.sum.del },
      evidence: +b.sum.evidence.toFixed(1),
      // of the agreeing words, those that are not function words (particles, prepositions, pronouns), and their evidence
      contentWords: b.sum.content, contentEvidence: +b.sum.contentEvidence.toFixed(1),
      // informational: the quotation starts after the beginning of the ayah / passage (head), the source goes on after it (tail)
      excerpt: { head: b.head, tail: b.tail },
      // found as a short exact fragment of an ayah (3+ words), below the evidence a quotation of ordinary length needs
      shortFragment: b.frag === true,
      source: uniq[0],
      parallels: uniq.slice(1).filter(s => s.type !== "b" || uniq[0].type === "b"),
      inBooks: uniq[0].type === "b" ? [] : uniq.slice(1).filter((s, i, arr) => s.type === "b" && arr.findIndex(x => x.label === s.label) === i).slice(0, 8),
      diff: renderDiff(b, tok),
      cue: cue ? cue.kind : null,
      attribution: null,
    };
    entry.attribution = checkAttribution(entry, uniq, c, corpus);
    // informational, like `excerpt`: what was said right after the matched words is not how the source goes on
    const run = tailRunsOn(c);
    entry.tailUnmatched = run !== null;
    if (run !== null) entry.tailUnmatchedSpoken = run;
    ledger.push(entry);
  }
  for (const x of extra) {
    const e = {
      ts: x.ts, te: x.te, wordStart: src[x.ts], wordEnd: src[x.te - 1],
      start: wordTime(x.ts).start ?? null, end: wordTime(x.te - 1).end ?? null,
      spoken: spokenText(x.ts, x.te), type: x.cue.kind === "quran" ? "q" : x.cue.kind === "hadith" ? "h" : "s",
      status: x.status, statusAr: STATUS[x.status].ar, fidelity: STATUS[x.status].fidelity,
      agreement: null, counts: null, evidence: x.status === "meaning" ? +x.meaning.cands[0].score.toFixed(3) : 0,
      source: null, parallels: [], inBooks: [], diff: null, cue: x.cue.kind, attribution: null,
    };
    if (x.meaning) {
      const list = x.meaning.cands.map(k => ({ ...corpus.describe(k.pid), shared: k.shared, score: +k.score.toFixed(x.meaning.mode === "hybrid" ? 3 : 1),
        via: x.meaning.mode, excerpt: excerpt(corpus, k.pid, k.sharedF) }));
      if (x.status === "meaning") { e.candidates = list; e.source = list[0]; }
      else { e.suggestions = list.slice(0, 5); e.evidence = 0; }   // closest passages: a search hint, not a match
    }
    if (x.cue.kind === "saying") {
      const books = corpus.hasBooks();
      e.noteCode = books ? "saying_notfound" : "saying_core_only";
      e.note = books
        ? "قول منسوب إلى عالم: لم يُعثر على لفظه في الكتب المحمَّلة."
        : "قول منسوب إلى عالم: المدونة الأساسية قرآن وحديث فقط. حمّل حزم الكتب للبحث في التفسير والفقه والسيرة والعقيدة.";
    } else if (x.status === "notfound" && !corpus.hasEnglish()) {
      // English speech can only be compared with the English translations, and those are an optional pack
      let latin = 0; for (let i = x.cue.end; i < x.te; i++) if (isLatin(tok[i])) latin++;
      if (latin * 2 > x.te - x.cue.end) {
        e.noteCode = "en_pack_missing";
        e.note = "الكلام بالإنجليزية وحزمة الترجمات الإنجليزية غير محمَّلة: لم يُبحث إلا في النصوص العربية.";
      }
    }
    // an explicit reference spoken inside this spot ("... verse 255") tells the reviewer where to look
    const r = refs.find(r => !r.used && r.ayah != null && r.end > x.ts - 6 && r.pos < x.te + 6);
    if (r) { const pid = corpus.coreRef.get(`${r.surah}:${r.ayah}`); if (pid != null) { r.used = true; e.reference = corpus.describe(pid); e.type = "q"; } }
    ledger.push(e);
  }
  // explicit references that stand alone (no quotation found near them): listed as leads so the reviewer can check
  for (const r of refs) {
    if (r.used || r.ayah == null) continue;
    const pid = corpus.coreRef.get(`${r.surah}:${r.ayah}`); if (pid == null) continue;
    if (ledger.some(e => r.end > e.ts - 25 && r.pos < e.te + 25 && e.type === "q")) continue;
    ledger.push({ ts: r.pos, te: r.end, wordStart: src[r.pos], wordEnd: src[r.end - 1], start: wordTime(r.pos).start ?? null, end: wordTime(r.end - 1).end ?? null,
      spoken: spokenText(r.pos, r.end), type: "q", status: "lead", statusAr: STATUS.lead.ar, fidelity: STATUS.lead.fidelity, agreement: null, counts: null, evidence: 0,
      source: corpus.describe(pid), parallels: [], inBooks: [], diff: null, cue: "quran", attribution: null, noteCode: "ref_only",
      note: "ذكر المتحدث هذا المرجع صراحة ولم يُعثر قربه على نص مطابق. النص المعروض هو نص المرجع المذكور." });
  }
  ledger.sort((a, b) => a.ts - b.ts || a.te - b.te);
  // The speaker's own grading of a hadith, as spoken: shown beside the nearest hadith (the one just said, or the one about to be)
  // with the speaker's words and their time. The tool does not interpret it and does not claim to know which text it is about.
  const gradings = findGradings(ftok);
  const spokenWords = (a, b) => { const seen = new Set(), out = []; for (let i = a; i < b; i++) { const k = src[i]; if (!seen.has(k)) { seen.add(k); out.push(wOf(k)); } } return out.join(" "); };   // the speaker's words as transcribed
  if (gradings.length) {
    const isH = e => (e.source && e.source.type === "h") || (e.status === "notfound" && e.cue === "hadith") || (e.status === "meaning" && e.source && e.source.type === "h");
    const hs = ledger.filter(isH);
    for (const g of gradings) {
      let host = null, where = "after";
      for (const e of hs) if (e.te <= g.pos + 1 && g.pos - e.te <= o.gradeReach) host = e;          // the nearest hadith said before it
      if (!host) { host = hs.find(e => e.ts >= g.end - 1 && e.ts - g.end <= o.gradeAhead) || null; where = "before"; }
      if (!host) continue;
      const list = host.spokenGrades || (host.spokenGrades = []), last = list[list.length - 1];
      if (last && last.kind === g.kind && g.pos - last.endTok <= 4) { last.endTok = g.end; last.text = spokenWords(last.fromTok, Math.min(n, g.end + 2)); continue; }   // "ضعيف لا يصح": one grading, not two
      const from = Math.max(0, g.pos - 5);
      list.push({ kind: g.kind, where, text: spokenWords(from, Math.min(n, g.end + 2)), start: wObj(src[clamp(g.pos, 0, n - 1)]).start ?? null, fromTok: from, endTok: g.end });
    }
    for (const e of hs) if (e.spokenGrades) { if (e.spokenGrades.length > 3) e.spokenGrades.length = 3; for (const x of e.spokenGrades) { delete x.fromTok; delete x.endTok; } }
  }
  ledger.forEach((e, i) => { e.id = i + 1; });

  return {
    ledger, cues,
    stats: { tokens: n, words: words.length, clusters: clusters.length, verified: found.length, ms: Date.now() - t0 },
    tokenToWord: src,
  };
}

// ---------------------------------------------------------------------------------------------

/**
 * Build the source token window for a cluster. Qur'an: neighbouring ayahs are joined so multi-ayah recitation aligns.
 * forced = {lo, hi}: exactly these ayahs (used when ranges are merged and when a spoken reference is checked).
 */
function sourceWindow(pid, corpus, forced) {
  if (!corpus.quranLike(pid)) return { P: corpus.tok(pid), FP: corpus.ftok(pid), bounds: null, first: pid };
  const [start, end] = corpus.quranRange(pid);     // same surah (and same translation, for English)
  const lo = forced ? forced.lo : Math.max(start, pid - 3);
  const P = [], FP = [], bounds = [];
  let hi = lo;
  for (let q = lo; q <= (forced ? forced.hi : end); q++) {
    const t = corpus.tok(q);
    if (!forced && q > pid && P.length + t.length > 420) break;
    bounds.push(P.length);
    for (let k = 0; k < t.length; k++) { P.push(t[k]); FP.push(corpus.ftok(q)[k]); }
    hi = q;
    if (!forced && q >= pid + 10) break;
  }
  return { P, FP, bounds, first: lo, last: hi };
}


// The compiler's own words after a hadith ("قال أبو عيسى هذا حديث حسن غريب ... وروي بعضهم هذا الحديث عن ...") are in the index with it, but
// they are not the Prophet's words: a match that lies wholly after the first such marker quotes the commentary, not the hadith.
const COMMENT_MARKS = ["قال أبو عيسى", "هذا حديث حسن", "هذا حديث صحيح", "هذا حديث غريب", "هذا حديث ضعيف"].map(p => p.split(" ").map(w => fold(w)));
function commentaryStart(FP) {
  for (let i = 8; i < FP.length; i++) for (const m of COMMENT_MARKS) if (m.every((w, k) => FP[i + k] === w)) return i;
  return -1;
}

function verify(cl, X) {
  const { tok, ftok, corpus, o, wt, idf, n, cueMask, metaMask, formMask } = X;
  const win = sourceWindow(cl.pid, corpus, cl.win);
  let { P, FP } = win, pOff = 0;
  if (!P.length) return null;
  // A chain of narrators that the index still carries (the builder could not cut it off: passage flag m = 0, `s` =
  // its probable length) is not quoted text, and neither is the phrase that announces the text ("قال رسول الله صلى
  // الله عليه وسلم ..."): nothing before the first word of the text proper is aligned, so those words give no evidence,
  // are never part of a quotation, and a match that lies inside them cannot become a citation.
  const lead = win.bounds ? 0 : matnStart(corpus, cl.pid);
  if (lead) { P = P.slice(lead); FP = FP.slice(lead); pOff = lead; }
  // very long hadith: align only around the region that produced the seeds
  if (!cl.win && P.length > 380) {
    const want = new Set();
    for (let i = cl.a; i < Math.min(n - 1, cl.b); i++) want.add(ftok[i] + " " + ftok[i + 1]);
    let lo = P.length, hi = 0;
    for (let j = 0; j + 1 < FP.length; j++) if (want.has(FP[j] + " " + FP[j + 1])) { if (j < lo) lo = j; if (j > hi) hi = j; }
    if (hi < lo) return null;
    lo = Math.max(0, lo - 60); hi = Math.min(P.length, hi + 60);
    if (hi - lo > 700) hi = lo + 700;
    P = P.slice(lo, hi); FP = FP.slice(lo, hi); pOff += lo;
  }
  const tMin = cl.tMin ?? 0, tMax = cl.tMax ?? n;
  let a = Math.max(tMin, cl.a - o.margin), b = Math.min(tMax, cl.b + o.margin);
  if (b - a < 2) return null;
  // Where can the quotation lie in the source? On the diagonals where the seeded stretch of speech and the source share
  // a pair of words. Only a band around those diagonals is aligned (most candidates share one or two pairs with a long
  // text, and the full matrix was nearly all wasted work). A candidate that shares no pair of words with the text
  // proper was seeded only by its announcing phrase ("قال رسول الله صلى الله عليه وسلم") or its chain: not a quotation.
  let dLo = Infinity, dHi = -Infinity;
  if (o.band > 0 && !cl.win && !cl.anchored) {
    const want = new Map();       // first word of a spoken pair -> [second word, position, ...]
    for (let i = cl.a, z = Math.min(n - 1, cl.b - 1); i < z; i++) {
      const w = want.get(ftok[i]);
      if (w === undefined) want.set(ftok[i], [ftok[i + 1], i]); else w.push(ftok[i + 1], i);
    }
    for (let j = 0, z = FP.length - 1; j < z; j++) {
      const w = want.get(FP[j]);
      if (w === undefined) continue;
      const nx = FP[j + 1];
      for (let k = 0; k < w.length; k += 2) if (w[k] === nx) { const d = j - w[k + 1]; if (d < dLo) dLo = d; if (d > dHi) dHi = d; }
    }
    if (dHi < dLo) return null;
  }
  let al = null;
  for (let round = 0; round < 3; round++) {
    const band = dHi >= dLo ? { lo: dLo + a - o.band, hi: dHi + a + o.band } : null;
    al = align(tok.slice(a, b), ftok.slice(a, b), P, FP, wt, { tolerant: o.tolerant, isWord: X.isWord, band });
    if (!al) return null;
    const touchL = al.ts <= 1 && a > tMin, touchR = al.te >= (b - a) - 1 && b < tMax;
    if (!touchL && !touchR) break;
    if (touchL) a = Math.max(tMin, a - 40);
    if (touchR) b = Math.min(tMax, b + 60);
  }
  const isQ = corpus.quranLike(cl.pid), isB = corpus.isBook(cl.pid);
  const bnd = win.bounds, full = win.P.length;
  const atStart = x => x + pOff === lead || (bnd !== null && bnd.includes(x + pOff));
  const atEnd = x => x + pOff === full || (bnd !== null && bnd.includes(x + pOff));
  const on = (op, mask) => op.ti >= 0 && (mask[a + op.ti] === 1 || (op.ti2 != null && mask[a + op.ti2] === 1));
  const solid = op => SOLID[op.op] === 1;

  // a bare number between the words is a pasted ayah marker ("(1)", "﴿١﴾"), not an added word
  let ops = al.ops.filter(op => !(op.op === "ins" && DIGITS.test(tok[a + op.ti])));

  // The quotation does not begin inside the phrase that announces it, nor inside a spoken reference ("في سورة النحل
  // الآية 90"), and it does not run on into "رواه البخاري": such words are cut off both ends, together with the one or
  // two stray words outside them ("عنه قال رسول الله ﷺ ..."). A cue-like phrase stays when an ayah itself begins
  // with it ("وقال ربكم ادعوني ...") and inside an ayah that the speaker went on reciting.
  const informative = op => solid(op) && !on(op, cueMask) && !on(op, metaMask) && !on(op, formMask);
  {
    let cut = 0;
    for (let k = 0, cnt = 0; k < ops.length && cnt <= 2; k++) {
      const op = ops[k];
      if (on(op, metaMask)) { cut = k + 1; cnt = 0; continue; }
      if (on(op, cueMask)) {
        if (k === cut) { if (isQ && solid(op) && atStart(op.pi) && (k === 0 || !on(ops[k - 1], cueMask))) break; cut = k + 1; cnt = 0; continue; }
        if (!isQ) { cut = k + 1; cnt = 0; continue; }
      }
      if (solid(op) && !on(op, formMask)) cnt++;
    }
    let end = ops.length;
    for (let k = ops.length - 1, cnt = 0; k >= cut && cnt <= 2; k--) {
      if (on(ops[k], metaMask)) { end = k; cnt = 0; } else if (informative(ops[k])) cnt++;
    }
    while (cut < end && !solid(ops[cut])) cut++;
    while (end > cut && !solid(ops[end - 1])) end--;
    if (cut >= end) return null;
    if (cut > 0 || end < ops.length) ops = ops.slice(cut, end);
  }
  // A single common word matched across a gap at either end ("... بالبيت العتيق [ذلك] ومن") is chance: the
  // quotation ended before the gap. Never across a substituted word or an omitted particle — those are real findings.
  {
    const isGap = op => op.op === "ins" || op.op === "del" || op.op === "diff";
    const particle = w => EDGE_HEAD.has(w) || EDGE_TAIL.has(w);
    const harmless = op => (op.op === "ins" && !particle(tok[a + op.ti])) || (op.op === "del" && !particle(P[op.pi]));
    const weak = frag => frag.length === 1 && frag[0].pi2 == null && idf(FP[frag[0].pi]) < 4;
    for (let turn = 0; turn < 2; turn++) {
      let z = ops.length - 1; while (z >= 0 && !isGap(ops[z])) z--;
      if (z >= 0 && weak(ops.slice(z + 1))) {
        let y = z; while (y >= 0 && isGap(ops[y])) y--;
        if (y >= 0 && ops.slice(y + 1, z + 1).every(harmless)) ops = ops.slice(0, y + 1);
      }
      let a0 = 0; while (a0 < ops.length && !isGap(ops[a0])) a0++;
      if (a0 < ops.length && weak(ops.slice(0, a0))) {
        let y = a0; while (y < ops.length && isGap(ops[y])) y++;
        if (y < ops.length && ops.slice(a0, y).every(harmless)) ops = ops.slice(y);
      }
    }
    let c0 = 0, c1 = ops.length;
    while (c0 < c1 && !solid(ops[c0])) c0++;
    while (c1 > c0 && !solid(ops[c1 - 1])) c1--;
    if (c0 >= c1) return null;
    if (c0 > 0 || c1 < ops.length) ops = ops.slice(c0, c1);
  }
  if (!isQ) {
    let w = 0, cnt = 0;
    for (const op of ops) if (op.ti >= 0) { cnt++; const x = tok[a + op.ti]; w += CHAIN_STRONG.has(x) ? 2 : CHAIN_WEAK.has(x) ? 1 : 0; }
    if (w >= o.chainShare * cnt) return null;
  }
  let lts = Infinity, lte = -1, ps = Infinity, pe = -1;
  for (const op of ops) {
    if (op.ti >= 0) { if (op.ti < lts) lts = op.ti; const z = op.ti2 ?? op.ti; if (z + 1 > lte) lte = z + 1; }
    if (op.pi >= 0) { if (op.pi < ps) ps = op.pi; const z = op.pi2 ?? op.pi; if (z + 1 > pe) pe = z + 1; }
  }
  const ts = a + lts, te = a + lte;
  if (!isQ && !isB) { const cm = commentaryStart(FP); if (cm >= 0 && ps >= cm) return null; }   // a match inside the compiler's commentary is not a quotation

  // A particle that turns the meaning round, standing in the source directly before (or after) the quoted words and not
  // spoken: shown as an omitted word. Never across an ayah / passage boundary.
  let edge = false;
  if (ps > 0 && !atStart(ps) && EDGE_HEAD.has(P[ps - 1]) && !(ts > 0 && (tok[ts - 1] === P[ps - 1] || ftok[ts - 1] === FP[ps - 1]))) {
    ops = [{ op: "del", ti: -1, pi: ps - 1 }, ...ops]; ps--; edge = true;
  }
  if (pe < P.length && !atEnd(pe) && EDGE_TAIL.has(P[pe]) && !(te < n && (tok[te] === P[pe] || ftok[te] === FP[pe]))) {
    ops = [...ops, { op: "del", ti: -1, pi: pe }]; pe++; edge = true;
  }

  // a cue only lowers the bar for the kind of source it announces (a hadith cue says nothing about a verse)
  const fits = k => (isB ? k > 0 : k === (isQ ? 1 : 2));   // a book may be announced by any cue ("قال ابن القيم", "في الحديث" ...)
  const hasCue = fits(X.cueLead[ts]) || fits(X.cueTrail[Math.min(n - 1, te)]) || fits(X.cueTrail[te - 1]);
  const direct = fits(X.cueDirectStrong[ts]);
  // devotional formulas are said all the time and prove nothing — except right after "قال الله تعالى", where
  // "الحمد لله رب العالمين" is the ayah being quoted
  // (ctx: how the matched words are presented — 2 announced as Qur'an, 1 in quotation marks / brackets, 0 plain speech)
  const ctx = X.context(ts, te), quranSaid = isQ && (direct || ctx === 2);
  const formula = isQ && direct ? () => false : op => on(op, formMask);
  // function words (particles, prepositions, pronouns) agree with half the corpus: they are counted apart from the
  // content words. A pair is a function word when the spoken or the source word is one — unless the ayah has a content
  // word of that spelling there.
  const pidAt = x => { if (!bnd) return cl.pid; let k = 0; while (k + 1 < bnd.length && bnd[k + 1] <= x + pOff) k++; return win.first + k; };
  const isFunc = op => {
    if (op.pi2 != null) return false;
    const w = P[op.pi];
    if (!FUNCTION_WORDS.has(w) && (op.ti2 != null || !FUNCTION_WORDS.has(tok[a + op.ti]))) return false;
    return !(isQ && QURAN_HOMOGRAPHS.has(w) && X.homograph(w, pidAt(op.pi)));
  };
  const sum = summarize({ ops }, FP, idf, op => on(op, cueMask) || on(op, metaMask) || formula(op), ftok.slice(a, b), isFunc);
  if (sum.inf < o.shortMin) return null;
  // Is this passage being quoted at all? For THAT question a word that sounds like the source word counts as
  // agreeing even when it is a real word (a transcription slip often is one). What the match is CALLED, and every
  // number shown, comes from the strict reading above.
  const det = ops.some(op => op.soft) ? summarize({ ops: ops.map(op => (op.soft ? { ...op, op: op.soft } : op)) }, FP, idf, op => on(op, cueMask) || on(op, metaMask) || formula(op), ftok.slice(a, b), isFunc) : sum;

  // does the alignment cover whole ayah(s) / the whole passage, start to end?
  const S = ps + pOff, E = pe + pOff;
  let whole, wholeAyah = false;
  if (bnd) {
    whole = bnd.includes(S) && (E === full || bnd.includes(E));
    for (let k = 0; k < bnd.length && !wholeAyah; k++) if (bnd[k] >= S && (k + 1 < bnd.length ? bnd[k + 1] : full) <= E) wholeAyah = true;
  } else whole = S <= lead && E === full;

  // A short exact fragment of an ayah (step 3d decided that it is evidence enough): exactly the run that was looked up,
  // word for word. An omitted negation / exception at its edge makes it partial, as for every quotation.
  if (cl.frag) {
    let exactN = 0, edgeN = 0;
    for (const op of ops) { if (op.op === "exact") exactN++; else if (op.op === "del" && op.ti === -1) edgeN++; else return null; }
    if (ts !== cl.a || te !== cl.b || exactN !== cl.b - cl.a || edgeN !== (edge ? ops.length - exactN : 0)) return null;
    let pidA = cl.pid, pidB = cl.pid;
    if (bnd) { const find = x => { let k = 0; while (k + 1 < bnd.length && bnd[k + 1] <= x) k++; return k; }; pidA = win.first + find(S); pidB = win.first + find(E - 1); }
    return { pid: cl.pid, pidA, pidB, ts, te, ps: S, pe: E, sum, det, status: edge ? "partial" : "verbatim", ops, tOff: a, P, FP, peLocal: pe, whole, wholeAyah, isQ, isB, edge, echo: false, frag: true, hasCue,
      head: !atStart(ps), tail: !atEnd(pe) };
  }

  // everyday dhikr ("سبحان الله وبحمده سبحان الله العظيم") in plain speech is devotion, not a quotation
  if (!hasCue && sum.inf < o.devotionalMin && ops.every(op => !solid(op) || DEVOTIONAL.has(FP[op.pi]))) return null;
  // ... and so is everyday dhikr whose words are an ayah ("إنا لله وإنا إليه راجعون" in a condolence, "له الملك وله الحمد
  // وهو على كل شيء قدير"): the ayah is cited only when it is announced as Qur'an, or when the dhikr is part of a longer
  // recitation — that is, when enough content words of the ayah were said besides the dhikr and the formulas.
  // The same for a hadith in which somebody says such words ("... مصيبة فقالوا إنا لله وإنا إليه راجعون"): without a hadith
  // cue it is kept only to be listed under the ayah when the ayah itself is cited (see `echo` below).
  let dhikrOnly = false;
  if (!(isQ ? quranSaid : hasCue) && ops.some(op => on(op, X.dMask))) {
    let own = 0;
    for (const op of ops) if (solid(op) && !on(op, X.dMask) && !on(op, formMask) && !on(op, cueMask) && !on(op, metaMask) && !isFunc(op)) own += op.pi2 != null ? 2 : 1;
    dhikrOnly = own < o.minContent;
    if (dhikrOnly && isQ) return null;
  }

  const eMin = isQ ? (hasCue ? o.eMinQuranCue : o.eMinQuran) : (hasCue ? o.eMinCue : o.eMin);
  const changedN = sum.diff + sum.ins + sum.del;
  // strict: word for word, and only a few words excused as mis-heard
  const strict = changedN === 0 && sum.asr + sum.near <= o.maxMisheard * sum.matched;
  // Enough to say that THIS text is being quoted? Function words agree with half the corpus ("تاريخ بني إسرائيل من بعد
  // موسى" in plain speech has five words of 2:246, two of them function words), so they never count towards the minimum
  // of content words, and for an ayah in plain speech (no cue, no reference, no brackets) they give only part of their
  // evidence.
  const announced = hasCue || (isQ ? ctx > 0 : ctx === 1);
  // (the Qur'an is small and fixed: words of it in a row, letter for letter, need no third content word — the evidence
  // rule below decides; a hadith or a book is weighed by all its matched words, as before)
  const exactRun = isQ && changedN === 0 && sum.asr + sum.near + sum.join === 0;
  const minC = announced || exactRun ? o.minContentCue : isQ && o.minContentChanged != null ? o.minContentChanged : o.minContent;
  const ev = m => (announced || !isQ ? m.evidence : m.contentEvidence + o.funcWeight * (m.evidence - m.contentEvidence));
  let status = null;
  if (dhikrOnly) ;
  else if (det.q >= o.qVerbatim && (det.diff + det.ins + det.del) / det.cols <= o.nearExact && det.longestRun >= Math.min(4, det.matched)) {
    if (det.inf >= o.minWords && det.content >= minC && ev(det) >= eMin) status = strict ? "verbatim" : "partial";
    else if (isQ && whole && hasCue && det.evidence >= 2.5) status = strict ? "verbatim" : "partial";   // short ayah recited whole after a cue
  }
  if (!status && !dhikrOnly && det.q >= o.qPartial && det.longestRun >= 3 && det.inf >= o.minWords + 1 && det.content >= minC && ev(det) >= eMin * 1.25) status = "partial";
  // A short canonical text right after its cue: exact, from the first word of the matn, and closed by the end of the
  // sentence or by "رواه ...". The beginning of a longer hadith is a partial quotation; a whole text is verbatim.
  if (!status && !dhikrOnly && !isQ && !isB && direct && changedN === 0 && sum.asr + sum.near === 0 && sum.evidence >= o.shortEvidence) {
    const startsMatn = S <= lead || SAY_END.has(win.P[S - 1]);
    const closed = te >= n || X.sentenceEnd[te - 1] === 1 || metaMask[te] === 1 || cueMask[te] === 1;
    // ... or at least three exact words with real evidence from inside a narration ("من غشنا فليس منا")
    if (closed && ts - cueEndBefore(X, ts) <= 1 && (startsMatn || (sum.inf >= 3 && sum.evidence >= o.eMinCue))) status = whole ? "verbatim" : "partial";
  }
  if (!status && !dhikrOnly && !cl.anchored && det.q >= 0.4 && det.longestRun >= 3 && det.inf >= o.minWords && det.content >= minC && ev(det) >= eMin * 1.5) status = "lead";
  // The exact words of a Qur'anic phrase inside a hadith, below the bar for a hadith citation but above the one for an
  // ayah: kept only to be listed as a parallel when the ayah itself is found on the same words (see grouping).
  let echo = false;
  if (!status && !isQ && !isB && !cl.anchored && changedN === 0 && sum.asr + sum.near === 0 && sum.inf >= o.minWords && sum.evidence >= o.eMinQuran) { status = "verbatim"; echo = true; }
  if (!status) return null;
  // map back to passages
  let pidA = cl.pid, pidB = cl.pid;
  if (bnd) {
    const find = x => { let k = 0; while (k + 1 < bnd.length && bnd[k + 1] <= x) k++; return k; };
    pidA = win.first + find(S); pidB = win.first + find(E - 1);
  }
  // head: the quotation begins after the first word of the ayah / of the hadith's text; tail: the source goes on after it
  return { pid: cl.pid, pidA, pidB, ts, te, ps: S, pe: E, sum, det, status, ops, tOff: a, P, FP, peLocal: pe, whole, wholeAyah, isQ, isB, edge, echo, hasCue,
    head: bnd ? !atStart(ps) : S > lead, tail: !atEnd(pe) };
}
/** index of the first token after the masked (cue / reference) run that ends right before `ts` */
function cueEndBefore(X, ts) {
  let i = ts;
  while (i > 0 && !X.cueMask[i - 1] && !X.metaMask[i - 1] && ts - i < 2) i--;
  return i > 0 && (X.cueMask[i - 1] || X.metaMask[i - 1]) ? i : -Infinity;
}

/** word-by-word comparison for display: spoken vs source */
function renderDiff(m, tok) {
  const out = [];
  for (const o of m.ops) {
    const sp = o.ti >= 0 ? tok[m.tOff + o.ti] + (o.ti2 != null ? " " + tok[m.tOff + o.ti2] : "") : "";
    const so = o.pi >= 0 ? m.P[o.pi] + (o.pi2 != null ? " " + m.P[o.pi2] : "") : "";
    const kind = o.op === "joinT" || o.op === "joinP" ? "asr" : o.op;
    out.push({ kind, spoken: sp, source: so });
  }
  return out;
}

/**
 * "By meaning" candidates for what follows a cue — hybrid retrieval, never reported as a match:
 *   1. lexical : passages sharing rare word stems with the spoken words (tolerant of transcription errors)
 *   2. dense   : nearest passage windows in the embedding space trained on this corpus (synonyms, rewording)
 *   3. fusion  : reciprocal-rank fusion of the two lists
 *   4. re-rank : late-interaction MaxSim between the spoken words and each candidate passage
 * Without the dense index (files missing, or useVectors=false) only step 1 runs, as before.
 */

// Words with which a speaker MOVES ON to explaining ("أما الثاني فهو ...", "يعني ...", "هذا الحديث ..."): a cue followed by one of them has
// announced no quotation, so no "announced but not found" is raised for it. A closed list of discourse markers, used only
// where nothing was found; a quotation that really is in the corpus is found by its words and never reaches this test.
const COMMENTARY = new Set(["اما", "فاما", "واما", "يعني", "اي", "فهو", "وهو", "فهذا", "وهذا", "هذا", "هذه", "ذلك", "فذلك", "اذن", "فاذن", "هنا", "فهنا", "المراد", "والمراد", "المعني", "ومعني"]);
// Words of talk ABOUT narrators and chains ("متأخر", "متقدم", "تلميذ", "السند", "يعني", "طبعا"): three of them in the window after a cue
// ("عن معاذ وطبعا مكحول متأخر خالص يعني ...") mean the speaker is discussing an isnad, not announcing a text.
const ISNAD_TALK = new Set(["متاخر", "متقدم", "تلميذ", "تلميذه", "راوي", "الراوي", "الاسناد", "اسناد", "السند", "سند", "مدلس", "ترجمه", "طبقه", "يعني", "طبعا"].map(w => fold(w)));
function commentaryAt(ftok, i, wEnd = i + 20) {
  if (COMMENTARY.has(ftok[i]) || COMMENTARY.has(ftok[i + 1]) && ftok[i].length <= 2) return true;
  let k = 0; for (let j = i; j < Math.min(wEnd, ftok.length, i + 25); j++) if (ISNAD_TALK.has(ftok[j])) k++;
  return k >= 3;
}
function meaningCandidates(cue, wEnd, tok, ftok, corpus, o) {
  corpus.ensureStems();
  const kindOk = cue.kind === "quran" ? pid => corpus.quranLike(pid) : cue.kind === "saying" ? pid => corpus.isBook(pid) : pid => !corpus.quranLike(pid);
  // English speech is compared with the English translations, Arabic speech with the Arabic texts
  let latin = 0; for (let i = cue.end; i < wEnd; i++) if (isLatin(tok[i])) latin++;
  const en = latin * 2 > wEnd - cue.end;
  const ok = pid => corpus.isEnglish(pid) === en && kindOk(pid) && !corpus.isDead(pid) && !(o.blocked && o.blocked.has(pid));
  // --- 1) lexical
  const score = new Map(), shared = new Map(), seenW = new Set();
  for (let i = cue.end; i < wEnd; i++) {
    if (ftok[i].length < 3) continue;
    const w = stem(ftok[i]);
    if (seenW.has(w)) continue; seenW.add(w);
    const post = corpus.stemPost.get(w);
    if (!post) continue;
    const v = corpus.stemIdf(w);
    for (const pid of post) {
      if (!ok(pid)) continue;
      score.set(pid, (score.get(pid) || 0) + v);
      let s = shared.get(pid); if (!s) shared.set(pid, s = []); s.push(i);
    }
  }
  const lex = [];
  for (const [pid, sc] of score) {
    const sh = shared.get(pid);
    if (sh.length < 2) continue;
    const len = corpus.tok(pid).length;
    lex.push({ pid, score: sc / (1 + 0.5 * Math.log(Math.max(1, len / 20))), sharedIdx: sh });   // long passages share words by chance
  }
  lex.sort((x, y) => y.score - x.score || x.pid - y.pid);
  const sharedOf = pid => (shared.get(pid) || []);
  const pack = (pid, sc, extra = {}) => ({ pid, score: sc, shared: sharedOf(pid).length, sharedF: sharedOf(pid).map(i => stem(ftok[i])), ...extra });
  const lastShared = pid => (sharedOf(pid).length ? Math.max(...sharedOf(pid)) + 2 : wEnd);

  const lexStrong = lex.length && lex[0].sharedIdx.length >= o.meaningMinWords && lex[0].score >= o.meaningMin && (lex[0].sharedIdx.length >= 4 || lex[0].score >= o.meaningStrong);
  const vec = o.useVectors ? corpus.vec : null;
  // the end of the quotation is unknown, so several lengths of "what follows the cue" are tried
  const span = wEnd - cue.end;
  const prefixes = [...new Set(o.prefixLens.map(L => Math.min(L, span)))].map(L => tok.slice(cue.end, cue.end + L));
  const embedded = vec ? prefixes.map(w => ({ w, q: vec.embed(w, en ? "en" : "ar") })).filter(x => x.q) : [];
  const qs = embedded.map(x => x.q);
  if (!qs.length) {   // words only
    const cands = lex.filter(c => c.sharedIdx.length >= o.meaningMinWords && c.score >= o.suggestMin).slice(0, o.meaningTop);
    if (!cands.length) return null;
    return { mode: "lexical", te: Math.min(wEnd, lastShared(cands[0].pid)), strong: !!lexStrong, cands: cands.map(c => pack(c.pid, c.score)) };
  }
  // --- 2) dense, 3) fusion
  const denseBest = new Map();
  let bestPrefix = embedded[0].w, bestTop = -1;
  const hitLists = vec.searchMany(qs, o.denseK, ok);      // all prefixes in one pass over the index
  for (let x = 0; x < embedded.length; x++) {
    const { w } = embedded[x], hits = hitLists[x];
    if (hits.length && hits[0].score > bestTop) { bestTop = hits[0].score; bestPrefix = w; }   // the length that fits some passage best
    for (const c of hits) if ((denseBest.get(c.pid) ?? -1) < c.score) denseBest.set(c.pid, c.score);
  }
  const dense = [...denseBest].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, o.denseK);
  const rrf = new Map();
  lex.slice(0, o.denseK).forEach((c, r) => rrf.set(c.pid, (rrf.get(c.pid) || 0) + o.lexWeight / (60 + r)));
  dense.forEach(([pid], r) => rrf.set(pid, (rrf.get(pid) || 0) + 1 / (60 + r)));
  const fused = [...rrf].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, o.rerankK);
  // --- 4) re-rank
  const idfOf = st => corpus.vstemIdf(st);
  const prepBest = vec.prepare(bestPrefix, idfOf), prepAll = o.rerankMode === "max" ? prefixes.map(w => vec.prepare(w, idfOf)) : null;
  let cands = fused.map(([pid]) => {
    const P = vec.ids(corpus.tok(pid), pid); let best = 0;
    if (prepAll) { for (const pr of prepAll) { const m = vec.maxSim(pr, P); if (m > best) best = m; } }
    else best = vec.maxSim(prepBest, P);
    if (o.rerankMode === "mix") best = 0.5 * best + 0.5 * (denseBest.get(pid) || 0);
    return pack(pid, best, { dense: +(denseBest.get(pid) || 0).toFixed(3) });
  }).sort((x, y) => y.score - x.score || x.pid - y.pid);
  if (lexStrong) { const k = cands.findIndex(c => c.pid === lex[0].pid); if (k > 0) cands.unshift(cands.splice(k, 1)[0]); }
  if (cue.kind === "hadith" && corpus.hasBooks()) {
    // a hadith cue: the hadith collections come first, commentaries and other books after them
    const core = cands.filter(c => !corpus.isBook(c.pid)).slice(0, 3), books = cands.filter(c => corpus.isBook(c.pid)).slice(0, o.meaningTop - core.length);
    cands = [...core, ...books];
  }
  cands = cands.slice(0, o.meaningTop);
  if (!cands.length) return null;
  // The re-rank score orders candidates well but is NOT a calibrated confidence (unrelated speech also finds
  // "similar" passages), so it never promotes a candidate to "بالمعنى" by itself: only strong word overlap does.
  return { mode: "hybrid", te: Math.min(wEnd, lexStrong ? lastShared(cands[0].pid) : cue.end + 14), strong: !!lexStrong, cands };
}

function excerpt(corpus, pid, sharedF) {
  const P = corpus.tok(pid), FP = corpus.ftok(pid), want = new Set(sharedF);
  let lo = P.length, hi = 0;
  FP.forEach((w, j) => { if (want.has(stem(w))) { if (j < lo) lo = j; if (j > hi) hi = j; } });
  if (hi < lo) return P.slice(0, 45).join(" ") + (P.length > 45 ? " …" : "");
  lo = Math.max(0, lo - 4); hi = Math.min(P.length, Math.max(hi + 5, lo + 12));
  if (hi - lo > 60) hi = lo + 60;
  return (lo > 0 ? "… " : "") + P.slice(lo, hi).join(" ") + (hi < P.length ? " …" : "");
}

/**
 * Compare what the speaker SAID the source was with where the text was actually found. Neutral wording only.
 * c.refs / c.colAfter / c.colBefore hold the spoken references and collection names that belong to THIS citation.
 * codes: ref_ok, ref_mismatch, surah_ok, surah_mismatch, collection_ok, collection_partial, collection_mismatch,
 *        collection_other_wording (the named book has this text in another wording; the spoken wording is another book's)
 */
function checkAttribution(entry, sources, c, corpus) {
  if (entry.type === "q") {
    const qs = sources.filter(s => s.type === "q");
    // an explicit reference with an ayah number ("سورة البقرة الآية 255", "Surah Al-Baqarah verse 255") is checked exactly
    const near = c.refs.filter(r => r.ayah != null);
    if (near.length) {
      near.forEach(r => { r.used = true; });
      const ok = near.some(r => qs.some(s => s.surah === r.surah && r.ayah <= s.ayahEnd && (r.ayahEnd ?? r.ayah) >= s.ayah));
      return { kind: "reference", code: ok ? "ref_ok" : "ref_mismatch", said: near.map(r => `${r.surah}:${r.ayah}${r.ayahEnd ? "-" + r.ayahEnd : ""}`), foundIn: qs.map(s => s.ref), agrees: ok,
        text: ok ? "المرجع المنطوق (السورة ورقم الآية) موافق لموضع النص في المصحف."
                 : "ذُكر مرجع (سورة ورقم آية) غير الموضع الذي وُجد فيه النص في المدونة — يُراجع." };
    }
    const said = [...new Set(c.refs.map(r => r.surah))];
    if (!said.length) return null;
    const foundIn = [...new Set(qs.map(s => s.surah))];
    const ok = said.some(s => foundIn.includes(s));
    return { kind: "surah", code: ok ? "surah_ok" : "surah_mismatch", said, foundIn, agrees: ok,
      text: ok ? "النسبة المنطوقة إلى السورة موافقة لموضع النص في المصحف."
               : "ذُكرت سورة غير التي وُجد فيها النص في المدونة — يُراجع." };
  }
  // "رواه ..." after the quotation speaks about it; names before it are used only when nothing follows
  const said = [...new Set(c.colAfter.length ? c.colAfter : c.colBefore)];
  if (!said.length) return null;
  const foundIn = [...new Set(sources.filter(s => s.type === "h").map(s => s.collection))];
  const colOf = m => { const p = corpus.P[m.pidA]; if (p.t === "b") return null; const r = p.t === "e" ? p.r.slice(3) : p.r; return corpus.quranLike(m.pidA) ? null : r.slice(0, r.indexOf(":")); };
  const elsewhere = new Set(c.others.map(colOf).filter(Boolean));     // matched there too, but in a different wording
  const confirmed = said.filter(s => foundIn.includes(s)), missing = said.filter(s => !foundIn.includes(s));
  const otherWording = missing.filter(s => elsewhere.has(s)), absent = missing.filter(s => !elsewhere.has(s));
  const code = missing.length === 0 ? "collection_ok" : absent.length === 0 ? "collection_other_wording" : confirmed.length || otherWording.length ? "collection_partial" : "collection_mismatch";
  const out = { kind: "collection", code, said, foundIn, agrees: absent.length === 0,
    text: code === "collection_ok" ? "النسبة المنطوقة موافقة: النص موجود في المدونة في الكتاب المذكور."
      : code === "collection_other_wording" ? "الحديث موجود في الكتاب المذكور ضمن المدونة بلفظ آخر؛ اللفظ المنطوق أقرب إلى رواية كتاب آخر."
      : code === "collection_partial" ? "النسبة المنطوقة مؤكَّدة جزئيًا: لم يُعثر على هذا اللفظ في بعض الكتب المذكورة ضمن المدونة."
      : "لم يُعثر على هذا اللفظ في الكتاب المذكور ضمن نسخة المدونة؛ وُجد في غيره — يُراجع (قد يكون بلفظ آخر أو برواية أخرى)." };
  if (otherWording.length) out.otherWording = otherWording;
  return out;
}
