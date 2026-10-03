// worker.js — runs the corpus and the engine off the main thread so the page never freezes.
import { Corpus, httpFetcher } from "./corpus.js";
import { analyze } from "./engine.js";
import { resolveByMeaning, applyMeaning } from "./meaning.js";
import { llmClient } from "./asr.js";
import { norm } from "./text.js";

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
  const out = []; let k = 0;
  for (const d of e.diff) {
    if (!d.spoken) { out.push(null); continue; }
    const shown = [];
    for (const tk of d.spoken.split(" ")) {
      const w = words[idx[k++]]; if (!w || typeof w.w !== "string") return false;
      if (norm(w.w) !== tk && plain(w.w) !== plain(tk)) return false;
      shown.push(w.w);
    }
    out.push(shown.join(" "));
  }
  if (k !== idx.length) return false;
  e.diff.forEach((d, i) => { if (out[i]) d.spokenDisplay = out[i]; });
  return true;
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
      r.ledger.forEach(decorate);
      for (const e of r.ledger) { try { spokenDisplay(e, ev.data.words, r.tokenToWord); } catch { /* the normalised words stay */ } }
      self.postMessage({ id, ok: true, result: { ledger: r.ledger, stats: r.stats, tokenToWord: r.tokenToWord } });
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
