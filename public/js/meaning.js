// meaning.js — OPTIONAL help for quotations "by meaning" (paraphrases), which word matching cannot find.
//
// Safety design ("the model proposes, the corpus disposes"):
//   1. A language model is asked which well-known verse/hadith the speaker probably means, and to write it from memory.
//   2. Its answer is NEVER shown and never trusted. It is used only as a search query.
//   3. The query goes through the same deterministic engine. Only if the corpus really contains that text
//      is a source attached — and what the user sees is the corpus text, labelled "بالمعنى — يحتاج تأكيدًا".
//   A model that invents a hadith therefore produces nothing: an invented text is not in the corpus.
import { analyze, STATUS } from "./engine.js";
import { wordsFromText, norm, fold, stem } from "./text.js";
import { llmStops } from "./asr.js";

const UNKNOWN = fold(norm("لا أعرف"));

/**
 * The closed-choice answer as a list position: a whole number from 1 to `max`, written as a number or as digits only
 * ("2", " 2 ", "2."). Everything else — "0", "", 1.5, "2 or 3", NaN, an object such as {error: "empty"}, null — is
 * "none" (0). The model may only point at ONE passage the corpus proposed; an answer that is not exactly that is no answer.
 */
export function choiceOf(answer, max) {
  if (answer && typeof answer === "object") answer = "error" in answer ? null : answer.choice;
  let k = 0;
  if (typeof answer === "number") k = answer;
  else if (typeof answer === "string") { const m = /^\s*(\d{1,3})\s*\.?\s*$/.exec(answer); if (m) k = Number(m[1]); }
  return Number.isInteger(k) && k >= 1 && k <= max ? k : 0;
}
// An informative stem: a word of the corpus that is neither short nor common nor a connective. "إنما", "الذي", "إلى" are
// in every text; sharing them ties nothing to anything.
const FUNCTION = new Set("انما لكن ولكن لعل هؤلاء اولئك الذي التي الذين ليس حين حيث كذلك هكذا ايضا which there their these those would should about".split(" ").map(w => stem(fold(norm(w)))));
const informative = (s, corpus) => s.length >= 3 && corpus.stemDf.has(s) && corpus.stemIdf(s) >= 4 && !FUNCTION.has(s);
/** The recall answer as text: a string, or the server's {text: "..."}; {error: "empty"}, {text: ""} and anything else are "no answer" ("") */
export function textOf(answer) {
  if (answer && typeof answer === "object") answer = "error" in answer ? "" : answer.text;
  return typeof answer === "string" ? answer.trim() : "";
}

/**
 * @param entry  a ledger entry with status "notfound" or "meaning" (cue kind quran/hadith)
 * @param llm    async (spokenText, kind, candidates|null) -> string   (candidates given: answer is the chosen number, "0" = none;
 *               an answer that is not a whole number in range, an empty text, {error:"empty"} or {text:""} all mean "no answer")
 * @returns null | {source, parallels, text, agreement, sharedStems, strength, strengthCode}
 * @throws AsrError when the helper cannot go on (see llmStops in asr.js)
 * The two model calls (step A, then step B) are spaced out by the client itself (asr.js llmClient waits ≥ 1.2 s between calls).
 */
export async function resolveByMeaning(entry, corpus, llm) {
  if (!entry || !["notfound", "meaning"].includes(entry.status) || !["quran", "hadith", "saying"].includes(entry.cue)) return null;
  // Step A — closed choice: the model may only point at one of the corpus passages the hybrid retrieval proposed.
  const list = entry.candidates || entry.suggestions || [];
  if (list.length) {
    let k = 0;
    try { k = choiceOf(await llm(entry.spoken.slice(0, 600), entry.cue, list.slice(0, 5).map(c => c.excerpt)), Math.min(5, list.length)); }
    catch (e) { if (llmStops(e)) throw e; k = 0; }      // a reached limit or a lost connection ends the whole search; anything else is "no answer"
    if (k >= 1) {
      const c = list[k - 1];
      return { source: c, parallels: [], text: c.excerpt, agreement: null, sharedStems: c.shared || 0, strength: "اختيار من مرشّحات المدونة", strengthCode: "choice", via: "choice" };
    }
  }
  if (entry.cue === "saying") return null;
  // Step B — recall: the model writes the wording it believes is meant; the corpus decides whether that text exists.
  let answer;
  try { answer = textOf(await llm(entry.spoken.slice(0, 600), entry.cue, null)); } catch (e) { if (llmStops(e)) throw e; return null; }
  if (!answer) return null;
  const a = fold(norm(answer));
  if (!a || a.replace(/ /g, "").includes(UNKNOWN.replace(/ /g, "")) || a.split(" ").length < 3) return null;
  const res = analyze(wordsFromText(answer.slice(0, 1500)), corpus, { useCues: false, eMin: 14, eMinQuran: 7 });
  const wantType = entry.cue === "quran" ? "q" : "h";
  const hits = res.ledger.filter(e => (e.status === "verbatim" || e.status === "partial") && e.type === wantType && e.agreement >= 0.7)
    .sort((x, y) => y.evidence - x.evidence);
  if (!hits.length) return null;
  const h = hits[0];
  // does the corpus passage share any informative word stem with what was actually spoken?
  corpus.ensureStems();
  const spokenStems = new Set(norm(entry.spoken).split(" ").map(w => stem(fold(w))));
  const srcStems = h.diff.filter(d => d.source).flatMap(d => d.source.split(" ")).map(w => stem(fold(w)));
  const shared = [...new Set(srcStems.filter(s => spokenStems.has(s) && informative(s, corpus)))];
  // The recalled text is in the corpus, but nothing ties it to what was SAID: the model may have recalled a famous text
  // that has nothing to do with the spoken words (the fabricated "اطلبوا العلم ولو في الصين" answered with the hadith of
  // intentions). Without one shared informative word there is no source to show.
  if (!shared.length) return null;
  return {
    source: h.source, parallels: h.parallels,
    text: h.diff.filter(d => d.source).map(d => d.source).join(" "),
    agreement: h.agreement, sharedStems: shared.length,
    strength: shared.length >= 2 ? "أقوى" : "متوسط",
    strengthCode: shared.length >= 2 ? "strong" : "medium",     // the page translates the code ("weak" is no longer produced: no shared word = no source)
  };
}

/** Apply a resolution to a ledger entry (mutates a copy). */
export function applyMeaning(entry, r) {
  return { ...entry, status: "meaning", statusAr: STATUS.meaning.ar, fidelity: STATUS.meaning.fidelity,
    source: r.source, parallels: r.parallels, candidates: null, suggestions: null,
    meaningVia: "llm", meaningText: r.text, meaningStrength: r.strength, meaningStrengthCode: r.strengthCode || null, noteCode: r.via === "choice" ? "llm_choice" : "llm_recall",
    note: r.via === "choice"
      ? "اختار نموذجٌ لغويٌّ هذا النص من بين مرشّحات استرجعها البحث من المدونة. النموذج لا يكتب نصًّا ولا يحكم بصحة؛ يحتاج تأكيدًا بشريًّا."
      : "اقترح نموذجٌ لغويٌّ النصَّ المقصود، ثم عُثر على هذا النص في المدونة. النموذج لم يحكم بشيء وكلامه لا يُعرض؛ المعروض هو نص المدونة. يحتاج تأكيدًا بشريًّا." };
}
