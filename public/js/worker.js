// worker.js — runs the corpus and the engine off the main thread so the page never freezes.
import { Corpus, httpFetcher } from "./corpus.js";
import { analyze } from "./engine.js";
import { resolveByMeaning, applyMeaning } from "./meaning.js";
import { llmClient } from "./asr.js";
import { norm, takhrijMask } from "./text.js";
import { lookup, describeRef } from "./lookup.js";
import { HadithDisplay, wordsOf } from "./display.js";
import { SemIndex, fetchVectors } from "./sem.js";

let corpus = null;
let display = null;          // HadithDisplay: the original (diacritised) text of the core hadith, when data/display/ exists

// ---------------- Qur'an text: always the verbatim display text, never the search tokens ----------------
const BASMALA_N = "بسم الله الرحمن الرحيم";

/**
 * Tie every search token of an ayah to the word of the verbatim text it was derived from.
 * @param display  the ayah exactly as stored in quran_display.json
 * @param n        the ayah's normalised search form (the basmala that opens verse 1 is not part of it)
 * @returns {ok, basmala, text, pieces}
 *   basmala  the opening basmala, character for character, when verse 1 of a surah other than 1 and 9 carries it ("" otherwise)
 *   text     the ayah without that basmala, character for character
 *   pieces   one string per search token: its display word plus any pause marks that follow it (and a hizb mark before it);
 *            pieces.join(" ") === text.  ok is false when this cannot be established exactly (pieces is then null).
 */
export function mapAyah(display, n, surah, ayah) {
  let words = display.split(" "), basmala = "";
  if (ayah === 1 && surah !== 1 && surah !== 9 && words.length > 4 && norm(words.slice(0, 4).join(" ")) === BASMALA_N) {
    basmala = words.slice(0, 4).join(" "); words = words.slice(4);
  }
  const text = words.join(" "), toks = n.split(" "), pieces = [];
  let ok = true, lead = "";
  for (const w of words) {
    const x = norm(w);
    if (!x) {                                            // a pause mark stays with the word before it; an opening mark (۞) with the word after it
      if (pieces.length) pieces[pieces.length - 1] += " " + w; else lead += w + " ";
      continue;
    }
    if (x !== toks[pieces.length]) { ok = false; break; }
    pieces.push(lead + w); lead = "";
  }
  if (ok && (pieces.length !== toks.length || pieces.join(" ") !== text)) ok = false;
  if (!ok && basmala) return { ok: false, basmala: "", text: display, pieces: null };   // nothing is detached unless the whole mapping holds
  return { ok, basmala, text, pieces: ok ? pieces : null };
}

const ayahCache = new Map();
function ayahOf(pid) {
  let m = ayahCache.get(pid);
  if (!m) {
    const [s, a] = corpus.P[pid].r.split(":").map(Number);
    m = mapAyah(corpus.quranDisplay[pid], corpus.P[pid].n, s, a); m.ayah = a;
    ayahCache.set(pid, m);
  }
  return m;
}

/** the verbatim text of a Qur'an source: `display` (each ayah followed by its number) and `basmala` (shown as a line of its own) */
function quranText(s) {
  const first = corpus.surahStart[s.surah] + s.ayah - 1, last = corpus.surahStart[s.surah] + s.ayahEnd - 1;
  const parts = [];
  for (let pid = first; pid <= last; pid++) { const m = ayahOf(pid); parts.push(`${m.text} ﴿${m.ayah}﴾`); if (pid === first && m.basmala) s.basmala = m.basmala; }
  s.display = parts.join(" ");
  return s;
}

/**
 * Word-by-word comparison of a Qur'an entry: give every source token of the diff its verbatim display word.
 * Sets diff[i].sourceDisplay (and diff[i].ayahEnd = n on the last word of ayah n) and returns {at, whole} — `at` is where
 * the compared words begin in the range (0 = at its first word), `whole` says they cover the range entirely — or changes
 * nothing and returns false when the tokens cannot be placed in the ayah range exactly once.
 */
export function quranDiffDisplay(diff, ayahs) {
  const seq = [];                                   // {tk, piece, end} for every token of the range
  for (const m of ayahs) {
    if (!m.ok) return false;
    const toks = m.n || null, P = m.pieces;
    for (let j = 0; j < P.length; j++) seq.push({ tk: toks ? toks[j] : null, piece: P[j], end: j === P.length - 1 ? m.ayah : 0 });
  }
  const want = [];                                  // {tk, i} : source tokens of the diff, in order
  diff.forEach((d, i) => { if (d.source) for (const tk of d.source.split(" ")) want.push({ tk, i }); });
  if (!want.length || want.length > seq.length) return false;
  const firstLen = ayahs[0].pieces.length, lastStart = seq.length - ayahs[ayahs.length - 1].pieces.length;
  let at = -1;
  for (let k = 0; k + want.length <= seq.length && k < firstLen; k++) {
    if (k + want.length <= lastStart) continue;     // must reach the last ayah of the range
    let same = true;
    for (let j = 0; j < want.length; j++) if (seq[k + j].tk !== want[j].tk) { same = false; break; }
    if (!same) continue;
    if (at >= 0) return false;                      // fits in two places: do not guess
    at = k;
  }
  if (at < 0) return false;
  const shown = diff.map(() => ({ words: [], end: 0 }));
  want.forEach((w, j) => { const x = seq[at + j]; shown[w.i].words.push(x.piece); if (x.end) shown[w.i].end = x.end; });
  diff.forEach((d, i) => { if (shown[i].words.length) { d.sourceDisplay = shown[i].words.join(" "); if (shown[i].end) d.ayahEnd = shown[i].end; } });
  return { at, whole: want.length === seq.length };
}

/**
 * The spoken side of a comparison as it was transcribed: the engine compares normalised tokens ("علي", "allah"), the reader
 * should see the words of the transcript ("على", "Allah,"). Sets diff[i].spokenDisplay when every token of the entry can be
 * tied to exactly one transcript word and that word normalises to the token; otherwise changes nothing.
 */
export function spokenDisplay(e, words, tokenToWord) {
  if (!e.diff || !tokenToWord || !Number.isInteger(e.ts) || !Number.isInteger(e.te) || e.te <= e.ts) return false;
  const idx = []; for (let k = e.ts; k < e.te; k++) idx.push(tokenToWord[k]);
  if (new Set(idx).size !== idx.length) return false;
  const plain = x => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const out = [], at = []; let k = 0;
  for (const d of e.diff) {
    if (!d.spoken) { out.push(null); at.push(null); continue; }
    const shown = [], where = [];
    for (const tk of d.spoken.split(" ")) {
      const w = words[idx[k]]; if (!w || typeof w.w !== "string") return false;
      if (norm(w.w) !== tk && plain(w.w) !== plain(tk)) return false;
      shown.push(w.w); where.push(idx[k++]);
    }
    out.push(shown.join(" ")); at.push(where);
  }
  if (k !== idx.length) return false;
  // wordIdx: the transcript word behind each shown word (the page lets the reviewer correct a mis-transcribed word there)
  e.diff.forEach((d, i) => { if (out[i]) { d.spokenDisplay = out[i]; d.wordIdx = at[i]; } });
  return true;
}

/**
 * The words of a verbatim Qur'an entry exactly as the Mushaf writes them (for the Word document), or null.
 * Given only when every spoken word is tied to one word of the verse and to one word of the transcript, with nothing added,
 * left out or changed: then the run is a contiguous stretch of the display text of the ayah(s). A verse number (﴿n﴾) follows
 * an ayah only when the whole ayah is inside the run. The basmala that opens a surah is not part of an ayah's words here,
 * so it never appears unless it is the ayah itself (al-Fatihah 1). Call after decorate() and spokenDisplay().
 */
export function mushafRun(e) {
  if (!e || e.status !== "verbatim" || !e.diff || !e.diffDisplay || !e.source || e.source.type !== "q" || e.source.via === "en") return null;
  const parts = []; let firstAyah = true;
  for (const d of e.diff) {
    if (!d.source || !d.spoken || !d.sourceDisplay || !d.spokenDisplay || !["exact", "asr", "near"].includes(d.kind)) return null;
    parts.push(d.sourceDisplay);
    if (d.ayahEnd) { if (!firstAyah || e.diffFromStart) parts.push(`﴿${d.ayahEnd}﴾`); firstAyah = false; }
  }
  return parts.length ? parts.join(" ") : null;
}

// ---------------- hadith text: the original wording (diacritics, spelling) where data/display/ has it ----------------
// Everything here is optional: without the folder, when a file cannot be fetched or when a passage's words cannot be
// tied one-to-one to its indexed words, nothing is attached and the page shows what it showed before.

/**
 * A hadith passage's original words, ready to be cut on word boundaries.
 * @param entry  what HadithDisplay.get()/peek() answers: {text, start, exact}
 * @param toks   the passage's indexed words (passage.n.split(" "))
 * @param chain  how many leading indexed words are the chain of narrators (passages kept in full: m = 0, field s)
 * @returns null | {words, pieces, at, chain}: words[i] is the original of toks[i]; pieces are the space-separated pieces
 *          of the text after `start` (words and the punctuation that stands alone between them); at[i] is the piece
 *          that is words[i]. null unless every original word normalises to the indexed word at its position.
 */
export function originalOf(entry, toks, chain = 0) {
  const words = wordsOf(entry, toks.length);
  if (!words || !words.length) return null;
  for (let i = 0; i < words.length; i++) if (norm(words[i]) !== toks[i]) return null;
  const pieces = entry.text.slice(entry.start).split(" ").filter(Boolean), at = [];
  for (let i = 0, k = 0; i < pieces.length && k < words.length; i++) if (pieces[i] === words[k]) { at.push(i); k++; }
  if (at.length !== words.length) return null;
  return { words, pieces, at, chain: Number.isInteger(chain) && chain > 0 && chain < words.length ? chain : 0 };
}
/** the original text from indexed word a to indexed word b (inclusive), with the punctuation standing between them */
export function originalRange(o, a, b) {
  if (!(a >= 0 && b >= a && b < o.words.length)) return "";
  let ps = o.pieces.slice(o.at[a], o.at[b] + 1);
  // a straight quotation mark whose partner lies outside the cut says nothing: unpaired ones are left out
  if (ps.join("").split('"').length % 2 === 0) ps = ps.map(p => p.replace(/"/g, "")).filter(Boolean);
  return ps.join(" ");
}
/** the whole hadith after its chain of narrators, as the dataset writes it */
export function originalFull(o) { return o.pieces.slice(o.chain ? o.at[o.chain] : 0).join(" "); }

/** every place where the token sequence `want` stands in `toks`; null when the original words differ between two places */
function placesOf(want, toks, words) {
  const L = want.length, N = toks.length, out = [];
  if (!L || L > N) return out;
  for (let k = 0; k + L <= N; k++) {
    let same = true;
    for (let j = 0; j < L; j++) if (toks[k + j] !== want[j]) { same = false; break; }
    if (!same) continue;
    if (out.length) for (let j = 0; j < L; j++) if (words[k + j] !== words[out[0] + j]) return null;      // two places, two wordings: do not guess
    out.push(k);
  }
  return out;
}

/**
 * Word-by-word comparison of a hadith entry: give every source token of the diff its original word.
 * The engine's diff lists the source words of one contiguous stretch of the passage; the stretch is found again by its
 * tokens. Sets diff[i].sourceDisplay and returns {at, len, unique} (at: index of the first compared indexed word; unique:
 * the stretch stands in the passage once). When the tokens stand in several places the words are attached only if the
 * original words are the same, letter for letter, in all of them. Otherwise changes nothing and returns false.
 */
export function hadithDiffDisplay(diff, toks, words) {
  if (!Array.isArray(diff) || !words || words.length !== toks.length) return false;
  const want = [], owner = [];
  diff.forEach((d, i) => { if (d.source) for (const tk of d.source.split(" ")) { want.push(tk); owner.push(i); } });
  const places = placesOf(want, toks, words);
  if (!places || !places.length) return false;
  const at = places[0], shown = diff.map(() => []);
  owner.forEach((i, j) => shown[i].push(words[at + j]));
  diff.forEach((d, i) => { if (shown[i].length) d.sourceDisplay = shown[i].join(" "); });
  return { at, len: want.length, unique: places.length === 1 };
}

/**
 * An excerpt the engine cut from a passage's indexed words ("… w w w …") in the original wording, cut at the same words.
 * anchored: an excerpt without a leading "…" starts at the first word of the passage and one without a trailing "…" ends
 * at its last word (true for the engine's excerpts; false for a text that may stand anywhere). The chain of narrators is
 * left out when the excerpt runs on after it. -> string | null (not placed exactly)
 */
export function excerptOriginal(excerpt, toks, o, anchored = true) {
  if (typeof excerpt !== "string" || !o || o.words.length !== toks.length) return null;
  let body = excerpt.trim(), head = false, tail = false;
  if (body.startsWith("… ")) { head = true; body = body.slice(2); }
  if (body.endsWith(" …")) { tail = true; body = body.slice(0, -2); }
  const want = body.split(" ").filter(Boolean), L = want.length, N = toks.length;
  if (!L) return null;
  let places = placesOf(want, toks, o.words);
  if (places === null && anchored) {          // the same words in two wordings: where the excerpt was cut still decides
    places = [];
    const k = !head ? 0 : !tail ? N - L : -1;
    if (k >= 0 && k + L <= N && want.every((w, j) => toks[k + j] === w)) places = [k];
  }
  if (!places || !places.length) return null;
  let k = places[0];
  if (anchored && places.length > 1) k = !head && places.includes(0) ? 0 : !tail && places.includes(N - L) ? N - L : k;
  const end = k + L - 1, lo = end >= o.chain ? Math.max(k, o.chain) : k;
  return (lo > o.chain ? "… " : "") + originalRange(o, lo, end) + (end < N - 1 ? " …" : "");
}

/**
 * The original words of a verbatim hadith entry (for the Word document), or null: the same rule as mushafRun — every
 * spoken word tied to one word of the source and to one word of the transcript, nothing added, left out or changed.
 */
export function sourceRun(e) {
  if (!e || e.status !== "verbatim" || !e.diff || !e.diffDisplay || !e.source || e.source.type !== "h" || e.source.via === "en") return null;
  const parts = [];
  for (const d of e.diff) {
    if (!d.source || !d.spoken || !d.sourceDisplay || !d.spokenDisplay || !["exact", "asr", "near"].includes(d.kind)) return null;
    parts.push(d.sourceDisplay);
  }
  return parts.length ? parts.join(" ") : null;
}

const origCache = new Map();          // core pid -> originalOf(...) | null, for passages whose file is in memory
/** core passage id of a hadith source of the core corpus (Arabic text), or null */
function hadithPid(s) {
  if (!s || s.type !== "h" || typeof s.ref !== "string" || !corpus) return null;
  const pid = corpus.coreRef.get(s.ref);
  return pid != null && corpus.P[pid] && corpus.P[pid].t === "h" ? pid : null;
}
function origOf(pid) {
  if (!display || pid == null) return null;
  if (origCache.has(pid)) return origCache.get(pid);
  let ent; try { ent = display.peek(pid); } catch { ent = undefined; }
  if (ent === undefined) return null;                    // its file is not in memory (not asked for, or it failed)
  let o = null;
  try { o = ent ? originalOf(ent, corpus.tok(pid), corpus.chainLen(pid)) : null; } catch { o = null; }
  if (origCache.size > 6000) origCache.clear();
  origCache.set(pid, o);
  return o;
}
/** the sources of an entry that are shown with a text */
const shownSources = e => (e ? [e.source, e.reference, ...(e.candidates || []), ...(e.suggestions || [])] : []);
const DISPLAY_WAIT_MS = 25000;          // results are not held back longer than this by display files that do not arrive
/**
 * Load the display files that hold the hadith among these sources (the distinct files in parallel; the fetcher repeats
 * a failed request once). Never throws: what could not be loaded simply has no original text.
 */
export async function loadDisplayFor(sources) {
  if (!display || !corpus) return;
  try {
    const pids = []; for (const s of sources) { const pid = hadithPid(s); if (pid != null) pids.push(pid); }
    if (!pids.length || !(await display.ready())) return;
    const m = display.meta, one = new Map();           // one passage per file is enough to bring the file in
    for (const pid of pids) { const k = Math.floor((pid - m.pid_base) / m.K); if (!one.has(k)) one.set(k, pid); }
    const todo = [...one.values()].filter(pid => display.peek(pid) === undefined);
    if (!todo.length) return;
    let timer; const late = new Promise(r => { timer = setTimeout(r, DISPLAY_WAIT_MS); });
    await Promise.race([Promise.all(todo.map(pid => display.get(pid))), late]);
    clearTimeout(timer);
  } catch { /* no original text */ }
}
/** a failed request is repeated once after a short pause */
export function retryingFetcher(fetcher, pause = 250) {
  return async (name, kind) => {
    try { return await fetcher(name, kind); }
    catch { await new Promise(r => setTimeout(r, pause)); return fetcher(name, kind); }
  };
}
/** the original text of the hadith sources of one entry (see the header of this section); call after the files are loaded */
function hadithOriginal(e) {
  if (!display) return;
  for (const s of shownSources(e)) attachOriginal(s);
  const s = e.source, pid = hadithPid(s), o = origOf(pid);
  if (!o) return;
  if (e.diff && s.via !== "en" && (e.status === "verbatim" || e.status === "partial")) {
    let r = false;
    try { r = hadithDiffDisplay(e.diff, corpus.tok(pid), o.words); } catch { r = false; }
    if (r) {
      e.diffDisplay = true;          // the source side of the comparison is drawn from the original words
      s.display = r.unique ? originalRange(o, r.at, r.at + r.len - 1) : o.words.slice(r.at, r.at + r.len).join(" ");
    }
    s.displayFull = originalFull(o);
  }
  // a passage found "by meaning" with the helper: the stretch of corpus text shown for it
  if (e.meaningVia === "llm" && typeof e.meaningText === "string" && e.meaningText) {
    const x = excerptOriginal(e.meaningText, corpus.tok(pid), o, /^… | …$/.test(e.meaningText));
    if (x) e.meaningDisplay = x;
  }
}
/** one hadith source: `arabic` becomes the original text after the chain (flag `original`), `excerptDisplay` the excerpt in the original wording */
function attachOriginal(s) {
  const pid = hadithPid(s), o = origOf(pid);
  if (!o) return s;
  s.arabic = originalFull(o); s.original = true;
  if (typeof s.excerpt === "string" && s.excerpt) {
    let x = null; try { x = excerptOriginal(s.excerpt, corpus.tok(pid), o); } catch { x = null; }
    if (x) s.excerptDisplay = x;
  }
  return s;
}

// ---------------- source positions: where each compared word stands in its source ----------------
// The agreement check between two transcriptions (agree.js) compares two entries of the same source word by word, so
// every source word of a comparison gets its exact position: diff[i].srcPos (index of the indexed word — counted from the
// first word of the SURAH for the Qur'an, from the first indexed word of the passage for a hadith), diff[i].srcN when one
// spoken word stands for several source words, and entry.posKey naming the text the positions belong to. Nothing is
// attached unless the place is established exactly; an entry without positions is never paired.

/** every index k at which the sequence `want` stands in `toks` */
function tokenPlaces(want, toks) {
  const out = [], L = want.length;
  for (let k = 0; L && k + L <= toks.length; k++) {
    let same = true;
    for (let j = 0; j < L; j++) if (toks[k + j] !== want[j]) { same = false; break; }
    if (same) out.push(k);
  }
  return out;
}
/**
 * Give the source words of a diff their positions in `toks` (the indexed words of the passage or ayah range).
 * @param at    where the compared words begin in toks when that is already known (it is checked), null to find it
 * @param base  added to every position (the range's first word counted from the start of the surah)
 * @returns false (nothing attached) unless the words stand at `at`, or at exactly one place in toks
 */
export function diffPositions(diff, toks, base = 0, at = null) {
  if (!Array.isArray(diff) || !Array.isArray(toks)) return false;
  for (const d of diff) { delete d.srcPos; delete d.srcN; }
  const want = [], owner = [];
  diff.forEach((d, i) => { if (d.source) for (const tk of d.source.split(" ")) { want.push(tk); owner.push(i); } });
  if (!want.length || want.length > toks.length) return false;
  if (Number.isInteger(at)) { for (let j = 0; j < want.length; j++) if (toks[at + j] !== want[j]) return false; }
  else { const places = tokenPlaces(want, toks); if (places.length !== 1) return false; at = places[0]; }
  owner.forEach((i, j) => { const d = diff[i]; if (d.srcPos == null) { d.srcPos = base + at + j; } else d.srcN = (d.srcN || 1) + 1; });
  return true;
}
const surahOffs = new Map();          // surah -> [words before ayah 1, before ayah 2, …]
/** how many indexed words of the surah stand before this ayah */
function ayahBase(surah, ayah) {
  let off = surahOffs.get(surah);
  if (!off) { off = [0]; surahOffs.set(surah, off); }
  for (let a = off.length; a < ayah; a++) off.push(off[a - 1] + corpus.tok(corpus.surahStart[surah] + a - 1).length);
  return off[ayah - 1];
}
/** positions for one entry (see the header of this section); `qAt` is what quranDiffDisplay answered for a Qur'an entry */
function sourcePositions(e, qAt = null) {
  const s = e.source;
  delete e.posKey;
  if (!e.diff || !s || s.via === "en" || (e.status !== "verbatim" && e.status !== "partial")) return false;
  let ok = false;
  if (s.type === "q" && s.surah && corpus.surahStart[s.surah] >= 0) {
    const first = corpus.surahStart[s.surah] + s.ayah - 1, last = corpus.surahStart[s.surah] + s.ayahEnd - 1, toks = [];
    for (let pid = first; pid <= last; pid++) toks.push(...corpus.tok(pid));
    ok = diffPositions(e.diff, toks, ayahBase(s.surah, s.ayah), qAt);
    if (ok) e.posKey = "q:" + s.surah;
  } else if (s.type === "h") {
    const pid = hadithPid(s);
    if (pid != null) ok = diffPositions(e.diff, corpus.tok(pid), 0, null);
    if (ok) e.posKey = "h:" + s.ref;
  }
  return ok;
}

/** tests run without a worker scope: give the module its corpus */
export function setCorpusForTests(c) { corpus = c; ayahCache.clear(); origCache.clear(); surahOffs.clear(); }
/** … and its display text (a HadithDisplay, or null for "no display folder") */
export function setDisplayForTests(d) { display = d; origCache.clear(); }

/** everything the page needs for one engine entry: sources as displayed, the words as transcribed, the Mushaf run */
export function finish(e, words, tokenToWord) {
  decorate(e);
  try { spokenDisplay(e, words, tokenToWord); } catch { /* the normalised words stay */ }
  const m = mushafRun(e); if (m) e.mushaf = m;
  const h = sourceRun(e); if (h) e.sourceRun = h;
  return e;
}

/** a source on its own (a lookup candidate, a reference named again): verbatim Qur'an text, translation, the corpus text of a hadith */
function decorateSource(s) {
  if (!s) return s;
  if (s.type === "q" && s.surah && corpus.surahStart[s.surah] >= 0) quranText(s);
  if (s.type === "q" || s.type === "h") {
    const tr = corpus.translationOf(s.ref); if (tr) s.translation = tr;
    if (s.type === "h") { const pid = corpus.coreRef.get(s.ref); if (pid != null) s.arabic = corpus.P[pid].n; }
  }
  try { attachOriginal(s); } catch { /* the search text stays */ }
  return s;
}

/** lookup of one stretch of words -> what the page shows and can turn into a ledger entry */
export function lookupFor(words, max) { return shapeLookup(lookup(words, corpus, max ? { max } : {})); }
/** the same, after the display files of the hadith it found are in memory (their original text is then attached) */
export async function lookupWithDisplay(words, max) {
  const r = lookup(words, corpus, max ? { max } : {});
  await loadDisplayFor(r.candidates.flatMap(c => (c.entry ? shownSources(c.entry) : [c.source])));
  return shapeLookup(r);
}
function shapeLookup(r) {
  const candidates = r.candidates.map(c => {
    if (!c.entry) return { status: "meaning", source: decorateSource({ ...c.source }), score: c.score };
    const e = finish({ ...c.entry }, c.run, c.tokenToWord), L = c.offset;
    // positions in the entry are those of the searched words (the cue phrase put before them is not the reviewer's text)
    let tied = true;
    for (const d of e.diff || []) if (d.wordIdx) { d.wordIdx = d.wordIdx.map(i => i - L); if (d.wordIdx.some(i => i < 0)) tied = false; }
    if (!tied) for (const d of e.diff || []) delete d.wordIdx;
    e.wordStart = Math.max(0, e.wordStart - L); e.wordEnd = Math.max(0, e.wordEnd - L);
    delete e.ts; delete e.te; delete e.id;
    return { status: c.status, source: e.source, entry: e };
  });
  return { candidates, truncated: r.truncated, searched: r.searched, lang: r.lang, english: corpus.hasEnglish(), books: corpus.hasBooks() };
}

/** attach what the page needs to display a source */
function decorate(e) {
  const add = s => { if (s && s.type === "q" && s.surah && corpus.surahStart[s.surah] >= 0) quranText(s); return s; };
  add(e.source); (e.parallels || []).forEach(add); (e.candidates || []).forEach(add); (e.suggestions || []).forEach(add); add(e.reference);
  // word-by-word comparison with the Qur'an: the source side is rebuilt from the verbatim text
  if (e.diff && e.source && e.source.type === "q" && e.source.via !== "en") {
    const s = e.source, first = corpus.surahStart[s.surah] + s.ayah - 1, last = corpus.surahStart[s.surah] + s.ayahEnd - 1, ayahs = [];
    for (let pid = first; pid <= last; pid++) ayahs.push({ ...ayahOf(pid), n: corpus.tok(pid) });
    let ok = false;
    try { ok = quranDiffDisplay(e.diff, ayahs); } catch { ok = false; }
    e.diffDisplay = !!ok;                 // the source side of the comparison can be drawn from the verbatim words
    e.diffWhole = !!(ok && ok.whole);     // what was compared is the whole of the verse(s), not a part
    e.diffFromStart = !!(ok && ok.at === 0);
    try { sourcePositions(e, ok ? ok.at : null); } catch { /* no positions: the entry is not compared with a second transcription */ }
  } else { try { sourcePositions(e); } catch { /* as above */ } }
  // a published English translation of the source (English packs), and the Arabic text when the match was made in English
  for (const s of [e.source, e.reference, ...(e.candidates || []), ...(e.suggestions || [])]) {
    if (!s || (s.type !== "q" && s.type !== "h")) continue;
    const tr = corpus.translationOf(s.ref); if (tr) s.translation = tr;
    if (s.type === "h") { const pid = corpus.coreRef.get(s.ref); if (pid != null) s.arabic = corpus.P[pid].n; }
  }
  // Jalalayn's commentary for a recited ayah (first three ayahs of a range), when the tafsir pack is loaded
  if (e.type === "q" && e.source && e.source.type === "q") {
    const t = [];
    for (let a = e.source.ayah; a <= Math.min(e.source.ayahEnd, e.source.ayah + 2); a++) { const x = corpus.tafsirOf(e.source.surah, a); if (x) t.push({ ayah: a, text: x }); }
    if (t.length) e.tafsir = t;
  }
  try { hadithOriginal(e); } catch { /* the search text stays */ }
  return e;
}

// ---------------- sentence vectors (candidates by meaning for what a cue announced and no text matched) ----------------
let semMeta = null, semIndex = null, semLoader = null, semTried = false;
const semVectors = new Map();         // text -> vector, kept for the session (a correction re-analyses the same transcript)
/**
 * The engine first runs with no vectors and records the stretches of speech it would ask about (the words after a cue that
 * announced a text no passage matched). Only those stretches are sent to the Worker. If anything is missing — no Worker, no
 * index, the day's allowance used up — the first result stands: candidates in the engine's own order.
 */
async function analyzeWithSem(words, cfg, note) {
  const want = new Set();
  const first = analyze(words, corpus, cfg ? { sem: { want } } : {});
  if (!cfg || !semMeta || !want.size) return { r: first, sem: null };
  if (!semIndex && !semTried) { semTried = true; note("index"); semIndex = await SemIndex.load(semLoader, corpus); }
  if (!semIndex || semIndex.model !== cfg.model || semIndex.dim !== cfg.dim) return { r: first, sem: null };
  const ask = [...want].filter(t => !semVectors.has(t));
  if (ask.length) { note("vectors"); for (const [t, v] of await fetchVectors(ask, cfg)) semVectors.set(t, v); }
  const have = [...want].filter(t => semVectors.has(t)).length;
  if (!have) return { r: first, sem: { asked: want.size, answered: 0 } };
  return { r: analyze(words, corpus, { sem: { index: semIndex, lookup: t => semVectors.get(t) || null } }), sem: { asked: want.size, answered: have } };
}

// ---------------- digest: every hadith and every passage of the Qur'an of the lecture, once ----------------
// A lecture that explains one hadith for five minutes says pieces of it five times: five ledger entries, each right about its
// own moment. The digest puts them together: the whole text of the source, which of its words were said anywhere in the
// lecture (and which never were), every moment it was said, and — when the speaker used the wording of two collections —
// each wording on its own. Built from the positions the comparison already established (diff[i].srcPos); nothing is matched
// again and no entry changes.
/** runs of words [{t, said}] for tokens a..b-1 (said: Set of token indexes); text(i, j) gives the display text of tokens i..j */
function runs(a, b, said, text) {
  const out = [];
  for (let i = a; i < b; ) { const on = said.has(i); let j = i; while (j + 1 < b && said.has(j + 1) === on) j++; out.push({ t: text(i, j), said: on }); i = j + 1; }
  return out;
}
/**
 * items: [{ id, type: "h" | "q", ref, surah, ayah, ayahEnd, keyed: bool, said: [positions], parallels: [refs] }] in ledger order
 * (positions as in sourcePositions: from the first indexed word of the passage for a hadith, of the surah for the Qur'an).
 * -> [{ type, ids, wordings: [{ source, segs, total, said, ids }] }] in order of first mention
 */
export function buildDigest(items) {
  const cards = [];
  // ---- hadith: one wording per reference; two wordings are one hadith when each lists the other among its parallels
  const byRef = new Map();
  for (const it of items) if (it.type === "h" && it.ref && corpus.coreRef.get(it.ref) != null) { let g = byRef.get(it.ref); if (!g) byRef.set(it.ref, g = { ref: it.ref, items: [], par: new Set() }); g.items.push(it); for (const p of it.parallels || []) g.par.add(p); }
  const parent = new Map([...byRef.keys()].map(r => [r, r])), find = r => { while (parent.get(r) !== r) r = parent.get(r); return r; };
  for (const g of byRef.values()) for (const p of g.par) { const h = byRef.get(p); if (h && h.par.has(g.ref)) parent.set(find(g.ref), find(p)); }
  // ... or when one text holds nearly all the words of the other (the same hadith as two collections narrate it: a clause
  // more in one, a word different in the other)
  const bag = ref => { const pid = corpus.coreRef.get(ref); return new Set(corpus.ftok(pid).slice(corpus.chainLen(pid)).filter(w => w.length >= 3)); };
  const refs = [...byRef.keys()], bags = new Map(refs.map(r => [r, bag(r)]));
  for (let i = 0; i < refs.length; i++) for (let j = i + 1; j < refs.length; j++) {
    const A = bags.get(refs[i]), B = bags.get(refs[j]), [small, big] = A.size <= B.size ? [A, B] : [B, A];
    if (small.size < 6) continue;
    let both = 0; for (const w of small) if (big.has(w)) both++;
    if (both >= 0.7 * small.size) parent.set(find(refs[i]), find(refs[j]));
  }
  const fam = new Map();
  for (const g of byRef.values()) { const k = find(g.ref); let f = fam.get(k); if (!f) fam.set(k, f = []); f.push(g); }
  for (const f of fam.values()) {
    const wordings = f.map(g => {
      const pid = corpus.coreRef.get(g.ref), toks = corpus.tok(pid), chain = corpus.chainLen(pid), o = origOf(pid);
      const said = new Set(); for (const it of g.items) if (it.keyed) for (const p of it.said) if (p >= chain && p < toks.length) said.add(p);
      // the source's own note on the hadith ("رواه الترمذي وقال…") is shown with the text but is not part of "how much of it was said"
      const tk = takhrijMask(toks); let notes = 0, saidNotes = 0; for (let i = chain; i < toks.length; i++) if (tk[i]) { notes++; if (said.has(i)) saidNotes++; }
      const text = o ? (i, j) => o.pieces.slice(o.at[i], j + 1 < o.at.length ? o.at[j + 1] : o.pieces.length).join(" ") : (i, j) => toks.slice(i, j + 1).join(" ");
      return { source: decorateSource(corpus.describe(pid)), segs: runs(chain, toks.length, said, text), total: toks.length - chain - notes, said: said.size - saidNotes, original: !!o, ids: g.items.map(it => it.id) };
    }).sort((x, y) => y.ids.length - x.ids.length || y.said - x.said);
    cards.push({ type: "h", ids: wordings.flatMap(w => w.ids), wordings });
  }
  // ---- Qur'an: ayahs of one surah that touch or follow one another are one passage
  const bySurah = new Map();
  for (const it of items) if (it.type === "q" && it.surah && corpus.surahStart[it.surah] >= 0 && it.ayah >= 1 && it.ayahEnd >= it.ayah) { let g = bySurah.get(it.surah); if (!g) bySurah.set(it.surah, g = []); g.push(it); }
  for (const [surah, list] of bySurah) {
    const groups = [];
    for (const it of list.slice().sort((x, y) => x.ayah - y.ayah || x.ayahEnd - y.ayahEnd)) { const g = groups[groups.length - 1]; if (g && it.ayah <= g.b + 1) { g.b = Math.max(g.b, it.ayahEnd); g.items.push(it); } else groups.push({ a: it.ayah, b: it.ayahEnd, items: [it] }); }
    for (const g of groups) {
      const first = corpus.surahStart[surah] + g.a - 1, last = Math.min(corpus.surahEnd[surah], corpus.surahStart[surah] + g.b - 1);
      const said = new Set(); for (const it of g.items) if (it.keyed) for (const p of it.said) said.add(p);
      const segs = []; let total = 0, n = 0;
      for (let pid = first; pid <= last; pid++) {
        const m = ayahOf(pid), toks = corpus.tok(pid), base = ayahBase(surah, m.ayah), mine = new Set();
        for (let k = 0; k < toks.length; k++) if (said.has(base + k)) mine.add(k);
        const text = m.ok && m.pieces ? (i, j) => m.pieces.slice(i, j + 1).join(" ") : (i, j) => toks.slice(i, j + 1).join(" ");
        const rs = runs(0, toks.length, mine, text);
        if (rs.length) rs[rs.length - 1].t += ` ﴿${m.ayah}﴾`;
        segs.push(...rs); total += toks.length; n += mine.size;
      }
      const ids = g.items.map(it => it.id);
      cards.push({ type: "q", ids, wordings: [{ source: corpus.describe(first, last), segs, total, said: n, original: true, ids }] });
    }
  }
  const order = new Map(items.map((it, i) => [it.id, i]));
  for (const c of cards) { c.ids.sort((x, y) => order.get(x) - order.get(y)); for (const w of c.wordings) w.ids.sort((x, y) => order.get(x) - order.get(y)); }
  return cards.sort((x, y) => order.get(x.ids[0]) - order.get(y.ids[0]));
}

let meaningCtl = null;
async function onMessage(ev) {
  const { id, type } = ev.data;
  try {
    if (type === "load") {
      ayahCache.clear(); surahOffs.clear();
      const fetcher = httpFetcher(ev.data.base);
      corpus = await Corpus.load(fetcher, p => self.postMessage({ id, progress: p }));
      corpus.ensureStems();
      display = new HadithDisplay(retryingFetcher(fetcher)); origCache.clear();      // nothing is fetched until a hadith is shown
      semLoader = fetcher; semIndex = null; semTried = false; semVectors.clear();
      try { semMeta = await fetcher("sem.json", "json"); } catch { semMeta = null; }  // (the vectors themselves, 17 MB, only when first needed)
      self.postMessage({ id, ok: true, result: { passages: corpus.N, quran: corpus.NQ, hadith: corpus.coreN - corpus.NQ, packs: corpus.available, dense: !!corpus.vec, sem: semMeta ? { model: semMeta.model, dim: semMeta.dim } : null } });
    } else if (type === "loadPack") {
      await corpus.loadPack(ev.data.pack, p => self.postMessage({ id, progress: p }));
      corpus.ensureStems();
      self.postMessage({ id, ok: true, result: { passages: corpus.N, loaded: corpus.packs.map(p => p.id) } });
    } else if (type === "analyze") {
      const { r, sem } = await analyzeWithSem(ev.data.words, ev.data.sem || null, phase => self.postMessage({ id, progress: { sem: phase } }));
      const t0 = Date.now();
      await loadDisplayFor(r.ledger.flatMap(shownSources));          // the original text of the hadith found, before anything is shown
      const t1 = Date.now();
      for (const e of r.ledger) finish(e, ev.data.words, r.tokenToWord);
      self.postMessage({ id, ok: true, result: { ledger: r.ledger, stats: r.stats, tokenToWord: r.tokenToWord, sem, displayMs: { load: t1 - t0, decorate: Date.now() - t1 } } });
    } else if (type === "digest") {
      const items = ev.data.items || [];
      await loadDisplayFor(items.filter(it => it.type === "h").map(it => ({ type: "h", ref: it.ref })));
      self.postMessage({ id, ok: true, result: buildDigest(items) });
    } else if (type === "lookup") {
      // the corpus passages closest to one stretch of words (a selection in the transcript, or typed text)
      self.postMessage({ id, ok: true, result: await lookupWithDisplay(ev.data.words) });
    } else if (type === "resolve") {
      // entries a reviewer added by hand, named again by their stable reference: the same lookup when it still finds that
      // source at those words (status and comparison as they are now), otherwise the source alone, otherwise null
      const out = [];
      for (const it of ev.data.items || []) {
        let found = null;
        try { found = (await lookupWithDisplay(it.words || [], 40)).candidates.find(c => c.source && c.source.ref === it.ref) || null; } catch { found = null; }
        if (found) { out.push(found); continue; }
        const s = describeRef(it.ref, corpus);
        if (s) await loadDisplayFor([s]);
        out.push(s ? { status: null, source: decorateSource(s) } : null);
      }
      self.postMessage({ id, ok: true, result: out });
    } else if (type === "meaning") {
      meaningCtl = new AbortController();
      const r = await resolveByMeaning(ev.data.entry, corpus, llmClient(ev.data.cfg, meaningCtl.signal));
      const done = r && !meaningCtl.signal.aborted ? applyMeaning(ev.data.entry, r) : null;
      if (done) await loadDisplayFor(shownSources(done));
      self.postMessage({ id, ok: true, result: done ? decorate(done) : null });
    } else if (type === "cancel") {
      if (meaningCtl) meaningCtl.abort();
      self.postMessage({ id, ok: true, result: null });
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message || e), code: e && e.name === "AsrError" ? e.code : null, scope: e && e.scope || "", retryAfter: e && e.retryAfter || null });
  }
}
// (the guard lets the two functions above be checked from Node, where there is no worker scope)
if (typeof self !== "undefined" && typeof self.postMessage === "function") self.onmessage = onMessage;
