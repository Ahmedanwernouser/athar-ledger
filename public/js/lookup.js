// lookup.js — search the corpus for one stretch of words: a reviewer's selection in the transcript, or typed text.
// The engine is run on the words as an ANNOUNCED quotation (once after a hadith cue, once after a Qur'an cue), so that a
// short text is found too; what it matches textually comes first, then the hybrid "by meaning" suggestions of both runs.
// Nothing here judges anything: the result is a list of corpus passages for a person to choose from.
import { analyze } from "./engine.js";

export const LOOKUP_MAX_WORDS = 120, LOOKUP_MAX = 8;
const HAS_AR = /[ء-ي]/;
const CUES = {
  ar: ["قال رسول الله صلى الله عليه وسلم", "قال الله تعالى"],
  en: ["the prophet peace be upon him said", "allah says in the quran"],
};
const RANK = { verbatim: 2, partial: 1 };
const textOf = w => (typeof w === "string" ? w : w && typeof w.w === "string" ? w.w : "").trim();

/**
 * words: [{w}] | [string]   (only the first LOOKUP_MAX_WORDS are searched)
 * -> { candidates, truncated, searched, lang }
 *    candidate: { status: "verbatim"|"partial"|"meaning", source, score?,
 *                 entry?, run?, tokenToWord?, offset? }   — the last four for a textual match: the engine's entry, the words
 *                 it was run on, and how many cue words precede the searched words in that run
 */
export function lookup(words, corpus, { max = LOOKUP_MAX, analyzeFn = analyze } = {}) {
  const all = (Array.isArray(words) ? words : []).map(textOf).filter(Boolean);
  const sel = all.slice(0, LOOKUP_MAX_WORDS), truncated = all.length > sel.length;
  const lang = HAS_AR.test(sel.join(" ")) ? "ar" : "en";
  if (!sel.length) return { candidates: [], truncated, searched: 0, lang };
  const textual = new Map(), loose = new Map();
  for (const phrase of CUES[lang]) {
    const pre = phrase.split(" "), L = pre.length, run = [...pre, ...sel].map(w => ({ w }));
    const r = analyzeFn(run, corpus);
    for (const e of r.ledger) {
      if (e.wordEnd < L) continue;                                   // something inside the cue phrase itself
      if (RANK[e.status] && e.source && e.source.ref) {
        const old = textual.get(e.source.ref);
        const better = !old || RANK[e.status] > RANK[old.status] || (RANK[e.status] === RANK[old.status] && (e.evidence || 0) > (old.entry.evidence || 0));
        if (better) textual.set(e.source.ref, { status: e.status, source: e.source, entry: e, run, tokenToWord: r.tokenToWord, offset: L });
        continue;
      }
      for (const c of e.candidates || e.suggestions || (e.source ? [e.source] : [])) {
        if (!c || !c.ref) continue;
        const score = Number.isFinite(c.score) ? c.score : 0, old = loose.get(c.ref);
        if (!old || score > old.score) loose.set(c.ref, { status: "meaning", source: c, score });
      }
    }
  }
  const out = [...textual.values()].sort((a, b) => RANK[b.status] - RANK[a.status] || (b.entry.evidence || 0) - (a.entry.evidence || 0));
  for (const c of [...loose.values()].sort((a, b) => b.score - a.score)) if (!textual.has(c.source.ref)) out.push(c);
  return { candidates: out.slice(0, max), truncated, searched: sel.length, lang };
}

/** the passage a stable reference names ("2:255", "2:255-257", "bukhari:1", a book passage's reference), described; or null */
export function describeRef(ref, corpus) {
  if (typeof ref !== "string" || !ref) return null;
  const q = ref.match(/^(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$/);
  if (q) {
    const a = corpus.coreRef.get(`${q[1]}:${q[2]}`), b = q[3] ? corpus.coreRef.get(`${q[1]}:${q[3]}`) : a;
    return a == null || b == null || b < a ? null : corpus.describe(a, b);
  }
  let pid = corpus.coreRef.get(ref);
  if (pid == null) { const P = corpus.P; for (let i = corpus.coreN || 0; i < P.length; i++) if (P[i] && P[i].r === ref) { pid = i; break; } }
  return pid == null ? null : corpus.describe(pid);
}
