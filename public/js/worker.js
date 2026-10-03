// worker.js — runs the corpus and the engine off the main thread so the page never freezes.
import { Corpus, httpFetcher } from "./corpus.js";
import { analyze } from "./engine.js";
import { resolveByMeaning, applyMeaning } from "./meaning.js";
import { llmClient } from "./asr.js";
import { norm } from "./text.js";
import { lookup, describeRef } from "./lookup.js";

let corpus = null;

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

/** tests run without a worker scope: give the module its corpus */
export function setCorpusForTests(c) { corpus = c; ayahCache.clear(); }

/** everything the page needs for one engine entry: sources as displayed, the words as transcribed, the Mushaf run */
export function finish(e, words, tokenToWord) {
  decorate(e);
  try { spokenDisplay(e, words, tokenToWord); } catch { /* the normalised words stay */ }
  const m = mushafRun(e); if (m) e.mushaf = m;
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
  return s;
}

/** lookup of one stretch of words -> what the page shows and can turn into a ledger entry */
export function lookupFor(words, max) {
  const r = lookup(words, corpus, max ? { max } : {});
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
  }
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
  return e;
}

let meaningCtl = null;
async function onMessage(ev) {
  const { id, type } = ev.data;
  try {
    if (type === "load") {
      ayahCache.clear();
      corpus = await Corpus.load(httpFetcher(ev.data.base), p => self.postMessage({ id, progress: p }));
      corpus.ensureStems();
      self.postMessage({ id, ok: true, result: { passages: corpus.N, quran: corpus.NQ, hadith: corpus.coreN - corpus.NQ, packs: corpus.available, dense: !!corpus.vec } });
    } else if (type === "loadPack") {
      await corpus.loadPack(ev.data.pack, p => self.postMessage({ id, progress: p }));
      corpus.ensureStems();
      self.postMessage({ id, ok: true, result: { passages: corpus.N, loaded: corpus.packs.map(p => p.id) } });
    } else if (type === "analyze") {
      const r = analyze(ev.data.words, corpus);
      for (const e of r.ledger) finish(e, ev.data.words, r.tokenToWord);
      self.postMessage({ id, ok: true, result: { ledger: r.ledger, stats: r.stats, tokenToWord: r.tokenToWord } });
    } else if (type === "lookup") {
      // the corpus passages closest to one stretch of words (a selection in the transcript, or typed text)
      self.postMessage({ id, ok: true, result: lookupFor(ev.data.words) });
    } else if (type === "resolve") {
      // entries a reviewer added by hand, named again by their stable reference: the same lookup when it still finds that
      // source at those words (status and comparison as they are now), otherwise the source alone, otherwise null
      const out = (ev.data.items || []).map(it => {
        let found = null;
        try { found = lookupFor(it.words || [], 40).candidates.find(c => c.source && c.source.ref === it.ref) || null; } catch { found = null; }
        if (found) return found;
        const s = describeRef(it.ref, corpus);
        return s ? { status: null, source: decorateSource(s) } : null;
      });
      self.postMessage({ id, ok: true, result: out });
    } else if (type === "meaning") {
      meaningCtl = new AbortController();
      const r = await resolveByMeaning(ev.data.entry, corpus, llmClient(ev.data.cfg, meaningCtl.signal));
      self.postMessage({ id, ok: true, result: r && !meaningCtl.signal.aborted ? decorate(applyMeaning(ev.data.entry, r)) : null });
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
