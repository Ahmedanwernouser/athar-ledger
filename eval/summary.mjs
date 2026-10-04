// summary.mjs — one machine-readable file with the headline numbers of the SIMULATED evaluation: eval/summary.json.
// Built from eval/results.json (run.mjs), eval/results_books.json (books.mjs) and eval/results_en.json (english.mjs),
// whichever exist. report.mjs takes its numbers from the same functions, so the reports and summary.json cannot disagree.
//   node eval/summary.mjs    rebuild eval/summary.json from the result files (no computation)
import { fileURLToPath } from "node:url";
import { wilson, readJson, writeJson } from "./lib.mjs";

const r1 = x => Math.round(x * 10) / 10;
const pct = (a, b) => (b ? 100 * a / b : 0);
/** share over lectures: pooled k/n, mean of the per-lecture percentages, and their min–max */
function share(rows, kf, nf) {
  const v = rows.map(r => pct(kf(r), nf(r)));
  const k = rows.reduce((s, r) => s + kf(r), 0), n = rows.reduce((s, r) => s + nf(r), 0);
  // pct = mean of the per-lecture percentages; min/max = range over the lectures; ci95 = Wilson interval on the pooled k/n
  return { k, n, pct: r1(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)), min: r1(Math.min(...v)), max: r1(Math.max(...v)), ci95: wilson(k, n) };
}
/** a count per lecture: mean, min, max, total */
function count(rows, f) {
  const v = rows.map(f);
  return { mean: r1(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)), min: Math.min(...v), max: Math.max(...v), total: v.reduce((a, b) => a + b, 0) };
}
// Critical errors (all five kinds; see RESULTS.md for the wording):
//   wrong source on a detected quotation + "verbatim" on words that include a real change + textual citation in filler
//   + textual citation of an unrelated source on an out-of-corpus item + "verbatim" over most of an out-of-corpus item
const critical = r => r.r.critWrongSource + r.r.critChangedVerbatim + r.r.critFiller + r.r.critOOC + r.r.critOOCverbMost;
const kn = (k, n) => ({ k, n, pct: r1(pct(k, n)), ci95: wilson(k, n) });
const tot = (rows, f) => rows.reduce((a, r) => a + f(r), 0);

/** the headline metrics of one system on one condition (rows = one row per lecture) */
export function block(rows) {
  if (!rows.length) return null;
  const all = r => r.m.vq[0] + r.m.vh[0] + r.m.ph[0], det = r => r.m.vq[1] + r.m.vh[1] + r.m.ph[1], first = r => r.m.vq[2] + r.m.vh[2] + r.m.ph[2];
  return {
    lectures: rows.length,
    quranDetected: share(rows, r => r.m.vq[1], r => r.m.vq[0]),
    hadithVerbatimDetected: share(rows, r => r.m.vh[1], r => r.m.vh[0]),
    hadithChangedDetected: share(rows, r => r.m.ph[1], r => r.m.ph[0]),
    firstSourceCorrectOfDetected: share(rows, first, det),       // conditional on detection
    firstSourceCorrectOfAll: share(rows, first, all),            // unconditional: detected AND first source correct / all quotations
    // labels under the strict rule (pooled over the lectures)
    labels: {
      saidWordForWord: { detected: tot(rows, r => r.r.lab.verb[0]), labelledVerbatim: kn(tot(rows, r => r.r.lab.verb[1]), tot(rows, r => r.r.lab.verb[0])), downgradedToPartial: kn(tot(rows, r => r.r.lab.verb[2]), tot(rows, r => r.r.lab.verb[0])) },
      wordingChanged: { detected: tot(rows, r => r.r.lab.changed[0]), labelledPartial: kn(tot(rows, r => r.r.lab.changed[1]), tot(rows, r => r.r.lab.changed[0])),
        labelledVerbatimOnAnUnchangedPart: tot(rows, r => r.r.lab.changed[2]), labelledVerbatimAlthoughChanged: tot(rows, r => r.r.lab.changed[3]) },
    },
    boundaryIoUAtLeast80: share(rows, r => r.r.iou8, r => r.r.startN),
    criticalPerLecture: count(rows, critical),
    criticalParts: { wrongSource: count(rows, r => r.r.critWrongSource), verbatimLabelOnChangedWording: count(rows, r => r.r.critChangedVerbatim), fillerCitation: count(rows, r => r.r.critFiller),
      outOfCorpusWrongCitation: count(rows, r => r.r.critOOC), outOfCorpusVerbatimOnMostOfIt: count(rows, r => r.r.critOOCverbMost) },
    criticalPerLectureWithoutLabelErrors: count(rows, r => critical(r) - r.r.critChangedVerbatim),
    notJudged_textualOnASmallPartFromAnotherPassage: count(rows, r => r.r.sideTextual),
  };
}
/** by-meaning items. The same paraphrases appear in every lecture, so n is the number of DISTINCT paraphrases;
 *  a paraphrase counts when it is found in most of the lectures in which it appears (a tie counts as not found). */
export function meaning(rows) {
  if (!rows.length) return null;
  const ids = new Map();
  for (const r of rows) for (const p of r.r.par) { let a = ids.get(p.id); if (!a) ids.set(p.id, a = []); a.push(p); }
  const maj = f => { let k = 0; for (const a of ids.values()) if (2 * a.filter(f).length > a.length) k++; return k; };
  const top = k => p => p.tx || (p.rank >= 0 && p.rank < k);
  const n = ids.size, k1 = maj(top(1));
  return {
    n, firstShown: k1, ci95: wilson(k1, n),
    asTextualMatch: maj(p => p.tx), asFirstSuggestion: k1 - maj(p => p.tx),
    inFirst3: maj(top(3)), inFirst5: maj(top(5)),
    openerRecognisedAsCue: maj(p => p.cue === 1),
    firstShownByKeyPhraseOnly: maj(p => p.keyTx || p.keyRank === 0),
    perLecture: rows.map(r => ({ seed: r.seed, n: r.r.par.length, firstShown: r.r.par.filter(top(1)).length, asTextualMatch: r.r.par.filter(p => p.tx).length, inFirst3: r.r.par.filter(top(3)).length, inFirst5: r.r.par.filter(top(5)).length })),
  };
}
/** out-of-corpus items, pooled over the lectures */
export function outOfCorpus(rows) {
  if (!rows.length) return null;
  const s = k => rows.reduce((a, r) => a + (Array.isArray(r.r.ooc[k]) ? 0 : r.r.ooc[k]), 0);
  const two = k => ({ sameFamily: rows.reduce((a, r) => a + r.r.ooc[k][0], 0), wrongSource: rows.reduce((a, r) => a + r.r.ooc[k][1], 0) });
  return { items: s("n"), notFound: s("notfound"), leadOnly: s("lead"), meaning: two("meaning"), partialOnSubPhrase: two("partial"), verbatimOnShortSubPhrase: two("verbShort"), verbatimOnMostOfIt: two("verbMost"),
    wrongTextualCitations: rows.reduce((a, r) => a + r.r.critOOC, 0),
    verbatimOnMostOfIt_expectedZeroByConstruction: true };
}
const RATE = { clean: 0, std10: 10, std20: 20, std30: 30 };

export function summarizeRun(res) {
  const rows = (group, noise, system) => res.rows.filter(r => r.group === group && r.noise === noise && r.system === system);
  const S = { seeds: res.meta.seeds, lectures: res.meta.seeds.length, itemsPerLecture: res.meta.sizes, corpusPassages: res.meta.corpus.N,
    hadithQuoteLengthWordsInMainTables: "8–35", perNoise: {}, byMeaning: { hybrid: {}, wordsOnly: {}, sentence: {} }, sentenceVectors: res.meta.sentenceVectors || null };
  for (const [nid, rate] of Object.entries(RATE)) {
    S.perNoise[rate] = Object.fromEntries(res.meta.systems.map(sys => [sys, block(rows("main", nid, sys))]).filter(x => x[1]));
    S.byMeaning.hybrid[rate] = meaning(rows("main", nid, "engine"));
    S.byMeaning.wordsOnly[rate] = meaning(rows("main", nid, "novec"));
    S.byMeaning.sentence[rate] = meaning(rows("main", nid, "sem"));
  }
  S.byMeaning.unseenOpener = { hybrid: meaning(rows("parUnseen", "clean", "engine")), wordsOnly: meaning(rows("parUnseen", "clean", "novec")), sentence: meaning(rows("parUnseen", "clean", "sem")) };
  S.byMeaning.noOpener = { hybrid: meaning(rows("parStrip", "clean", "engine")), wordsOnly: meaning(rows("parStrip", "clean", "novec")), sentence: meaning(rows("parStrip", "clean", "sem")) };
  // other noise shapes (engine and B2)
  S.noiseConditions = {};
  for (const nid of Object.keys(res.meta.noise)) {
    if (nid in RATE || !rows("noise", nid, "engine").length) continue;
    S.noiseConditions[nid] = { rate: Math.round(res.meta.noise[nid].rate * 100), kind: res.meta.noise[nid].kind, engine: block(rows("noise", nid, "engine")), B2: block(rows("noise", nid, "B2")) };
  }
  // what the project's noise model did (share of the words that were hit)
  S.noiseShape = {};
  for (const nid of ["std10", "std20", "std30"]) {
    const sh = rows("main", nid, "engine").map(r => r.shape).filter(Boolean); if (!sh.length) continue;
    const t = k => sh.reduce((a, s) => a + s[k], 0), hit = t("hit");
    const p = k => r1(pct(t(k), hit));
    S.noiseShape[RATE[nid]] = { wordsHitPct: r1(pct(hit, t("words"))), glued: p("glued"), split: p("split"), foldIdentical: p("foldIdentical"), oneEdit: p("oneEdit"),
      becameAnotherRealWord: p("realWord"), deleted: p("deleted"), inserted: p("inserted"), other: p("other"),
      coveredByAToleranceRule: r1(pct(t("glued") + t("split") + t("foldIdentical") + t("oneEdit"), hit)) };
  }
  // verbatim-hadith detection by quote length and cue condition (pooled over the lectures; Wilson 95%)
  const bucket = (g, nid, lo, hi, cued) => { let k = 0, n = 0;
    for (const r of rows(g, nid, "engine")) for (const [len, cue, det] of r.r.vhItems) { if (len < lo || len > hi || (cued && !cue)) continue; n++; k += det; }
    return n ? kn(k, n) : null; };
  const cond = (g, lo, hi, cued) => ({ clean: bucket(g, "clean", lo, hi, cued), noise20: bucket(g, "std20", lo, hi, cued) });
  S.hadithByQuoteLength = {
    "5-8": { withCue: cond("short", 5, 8, true), noCue: cond("shortNoCue", 5, 8, false), unseenCueWording: cond("shortUnseenCue", 5, 8, true) },
    "8-15": { withCue: cond("main", 8, 15, true), noCue: cond("noCue", 8, 15, false), unseenCueWording: cond("unseenCue", 8, 15, true) },
    "16-35": { withCue: cond("main", 16, 35, true), noCue: cond("noCue", 16, 35, false), unseenCueWording: cond("unseenCue", 16, 35, true) },
    "8-35 (the main tables)": { withCue: cond("main", 8, 35, true), noCue: cond("noCue", 8, 35, false), unseenCueWording: cond("unseenCue", 8, 35, true) },
  };
  { const rr = rows("main", "clean", "engine"); S.cueShareInMainLectures = { verbatimHadith: r1(pct(tot(rr, r => r.cueShare.vh[0]), tot(rr, r => r.cueShare.vh[1]))), quran: r1(pct(tot(rr, r => r.cueShare.vq[0]), tot(rr, r => r.cueShare.vq[1]))), outOfCorpus: r1(pct(tot(rr, r => r.cueShare.ooc[0]), tot(rr, r => r.cueShare.ooc[1]))) }; }
  // whole lectures with no cue / with cue wordings the engine does not know
  S.cueConditions = { noCue: { clean: block(rows("noCue", "clean", "engine")), noise20: block(rows("noCue", "std20", "engine")) },
    unseenCueWording: { clean: block(rows("unseenCue", "clean", "engine")), noise20: block(rows("unseenCue", "std20", "engine")) } };
  S.outOfCorpus = Object.fromEntries(Object.entries(RATE).map(([nid, rate]) => [rate, outOfCorpus(rows("main", nid, "engine"))]));
  S.outOfCorpusTextualCitations = Object.fromEntries(Object.entries(RATE).map(([nid, rate]) => [rate, rows("main", nid, "engine").flatMap(r => (r.ex ? r.ex.oocTextual : []).map(x => ({ seed: r.seed, ...x })))]));
  S.fillerCitations = Object.fromEntries(Object.entries(RATE).map(([nid, rate]) => [rate, rows("main", nid, "engine").flatMap(r => (r.ex ? r.ex.filler : []).map(x => ({ seed: r.seed, ...x })))]));
  S.verbatimLabelsOnChangedWording = Object.fromEntries(Object.entries(RATE).map(([nid, rate]) => [rate, rows("main", nid, "engine").flatMap(r => (r.ex ? r.ex.changedVerbatim : []).map(x => ({ seed: r.seed, ...x })))]));
  S.wrongSourceCitations = Object.fromEntries(Object.entries(RATE).map(([nid, rate]) => [rate, rows("main", nid, "engine").flatMap(r => (r.ex ? r.ex.wrongSource : []).map(x => ({ seed: r.seed, ...x })))]));
  S.outOfCorpusB2 = Object.fromEntries(Object.entries(RATE).map(([nid, rate]) => [rate, outOfCorpus(rows("main", nid, "B2"))]));
  S.engineDetails = Object.fromEntries(Object.entries(RATE).map(([nid, rate]) => { const rr = rows("main", nid, "engine"); return [rate, {
    cueOnlyLeftWithoutMatch: share(rr, r => r.r.cueClean, r => r.r.cueN), spokenAttributionCheckOK: share(rr, r => r.r.attrOK, r => r.r.attrN),
    meanStartErrorWords: Math.round(100 * rr.reduce((a, r) => a + r.r.startErr, 0) / Math.max(1, rr.reduce((a, r) => a + r.r.startN, 0))) / 100,
    meanEndErrorWords: Math.round(100 * rr.reduce((a, r) => a + r.r.endErr, 0) / Math.max(1, rr.reduce((a, r) => a + r.r.startN, 0))) / 100,
    leadsInFiller: count(rr, r => r.r.fillerLead), meaningInFiller: count(rr, r => r.r.fillerMeaning), otherTextualInsideParaphrases: count(rr, r => r.r.parOtherTextual) }]; }));
  S.freshSeeds = { seeds: res.meta.freshSeeds, clean: block(rows("fresh", "clean", "engine")), noise20: block(rows("fresh", "std20", "engine")) };
  if (res.absent) S.absentSayings = { listed: res.absent.listed, sayings: res.absent.n, check: res.absent.check, droppedBecauseA4WordRunIsInTheCorpus: res.absent.dropped,
    ...Object.fromEntries(res.absent.runs.map(r => [r.noise === "clean" ? "clean" : "noise20", { notFound: r.notfound, leadOnly: r.lead, meaningSuggestion: r.meaning, textualCitation: r.textual, ofWhichVerbatim: r.verbatim, ofWhichPartial: r.partial, textualCitationsInTheFillerAround: r.fillerTextual, citations: r.citations, suggestions: r.suggestions }])) };
  return S;
}
export function summarizeBooks(b) {
  const o = { passagesLoaded: b.passages ?? b.meta.passages, booksInMainSample: 9, jalalaynReportedSeparately: true, sets: {} };
  for (const s of b.sets) (o.sets[s.set] ||= { lengthWords: `${s.lenMin}–${s.lenMax}` })[s.rate ? "noise15" : "clean"] =
    { detected: s.total.det, n: s.total.n, ci95: s.total.ci, firstSourceIsTheBook: s.total.first, bookAmongShownSources: s.total.any, attributedFirstToQuranOrHadith: s.total.prim, falseCitationsInFiller: s.fillerTextual };
  if (b.cueThenFiller) o.cueFollowedByOwnWords = { trials: b.cueThenFiller.trials, falseTextualCitations: b.cueThenFiller.textual };
  return o;
}
export function summarizeEnglish(e) {
  return { lectures: e.meta.lectures, seeds: e.meta.seeds, coverageRule: e.meta.cover, itemsPerLecture: e.meta.countsPerLecture, rows: Object.fromEntries(e.rows.map(c => [Math.round(c.rate * 100), {
    indexedTranslationVerses: { n: c.vq[0], detected: c.vq[1], referenceCorrect: c.vq[2], ci95ReferenceCorrect: c.vqCI },
    translatedHadith: { n: c.vh[0], detected: c.vh[1], referenceCorrect: c.vh[2], ci95ReferenceCorrect: c.vhCI },
    nonIndexedTranslationVerses: { n: c.held[0], textualWithCorrectReference: c.held[2], ci95: c.heldCI, perLecture: c.heldPerLecture, referenceWithinFirst5: c.held[3], ci95First5: c.heldTop5CI },
    wrongReferenceCitations: c.wrong, cueOnlyLeftWithoutMatch: { k: c.cue[1], n: c.cue[0] }, falseCitationsInFiller: c.fillerTextual,
    citationsOf39_18OnTheFillerSentenceThatParaphrasesIt: { k: c.fillerAllusion, n: c.allusionSentences } }])) };
}
/** The numbers the README and the slides quote, in one small block. Everything here is also in the detailed sections. */
export function headline(S) {
  const H = { _note: "SIMULATION ONLY. Percentages are means over the lectures with [min, max] over the lectures; k/n are pooled over the lectures with a Wilson 95% interval (ci95, in %). 'noisePct' is the share of words hit in the simulation, not a recogniser's WER." };
  const A = S.arabic;
  if (A) {
    const pick = b => b && ({
      quranDetectedPct: b.quranDetected.pct, quranDetectedRange: [b.quranDetected.min, b.quranDetected.max], quranDetectedCI95: b.quranDetected.ci95,
      hadithVerbatimDetectedPct: b.hadithVerbatimDetected.pct, hadithVerbatimDetectedRange: [b.hadithVerbatimDetected.min, b.hadithVerbatimDetected.max], hadithVerbatimDetectedCI95: b.hadithVerbatimDetected.ci95,
      hadithChangedWordingDetectedPct: b.hadithChangedDetected.pct, hadithChangedWordingDetectedRange: [b.hadithChangedDetected.min, b.hadithChangedDetected.max], hadithChangedWordingDetectedCI95: b.hadithChangedDetected.ci95,
      firstSourceCorrectOfDetectedPct: b.firstSourceCorrectOfDetected.pct, firstSourceCorrectOfDetectedCI95: b.firstSourceCorrectOfDetected.ci95,
      firstSourceCorrectOfAllQuotationsPct: b.firstSourceCorrectOfAll.pct, firstSourceCorrectOfAllQuotationsCI95: b.firstSourceCorrectOfAll.ci95,
      boundaryIoUAtLeast80PctOfDetected: b.boundaryIoUAtLeast80.pct,
      criticalErrorsPerLecture: b.criticalPerLecture.mean, criticalErrorsPerLectureRange: [b.criticalPerLecture.min, b.criticalPerLecture.max], criticalErrorsTotalOverLectures: b.criticalPerLecture.total,
    });
    H.arabic_mainTables_quotes8to35words = { lectures: A.lectures, seeds: A.seeds, developmentSeed: 101,
      byNoisePct: Object.fromEntries(Object.entries(A.perNoise).map(([rate, o]) => [rate, { engine: pick(o.engine), baselineB2: pick(o.B2), naiveB0: pick(o.B0), naiveB1: pick(o.B1), engineWithoutTolerance: pick(o.notol) }])) };
    H.arabic_strictVerbatimLabel = Object.fromEntries(Object.entries(A.perNoise).map(([rate, o]) => { const l = o.engine.labels; return [rate, {
      saidWordForWord_labelledVerbatim: l.saidWordForWord.labelledVerbatim, saidWordForWord_downgradedToPartial_priceOfStrictRule: l.saidWordForWord.downgradedToPartial,
      wordingChanged_labelledPartial: l.wordingChanged.labelledPartial, wordingChanged_labelledVerbatim_criticalError: l.wordingChanged.labelledVerbatimAlthoughChanged }]; }));
    const mg = m => m && ({ firstShown: m.firstShown, n: m.n, ci95: m.ci95, ofWhichTextualMatch: m.asTextualMatch, ofWhichFirstSuggestion: m.asFirstSuggestion, inFirst3: m.inFirst3, inFirst5: m.inFirst5 });
    H.arabic_byMeaning = { _note: "26 paraphrases written by the same AI assistant that wrote the engine; all begin with an opener. Judged by hadith family. `sentenceVectors`: candidates ordered with sentence vectors (bge-m3 through the Worker; in this run from the offline cache) — what the deployed site does when its Worker offers the model; `hybrid`: the engine alone, in the browser.",
      sentenceVectorsUsed: A.sentenceVectors,
      openerKnownToEngine_byNoisePct: Object.fromEntries(Object.keys(A.perNoise).map(rate => [rate, { sentenceVectors: mg(A.byMeaning.sentence[rate]), hybrid: mg(A.byMeaning.hybrid[rate]), wordsOnly: mg(A.byMeaning.wordsOnly[rate]) }])),
      openerUnknownToEngine_clean: { sentenceVectors: mg(A.byMeaning.unseenOpener.sentence), hybrid: mg(A.byMeaning.unseenOpener.hybrid), wordsOnly: mg(A.byMeaning.unseenOpener.wordsOnly) },
      noOpener_clean: { sentenceVectors: mg(A.byMeaning.noOpener.sentence), hybrid: mg(A.byMeaning.noOpener.hybrid), wordsOnly: mg(A.byMeaning.noOpener.wordsOnly) } };
    H.arabic_hadithVerbatimDetectionByQuoteLength = A.hadithByQuoteLength;
    H.arabic_otherNoiseShapes_engine_vs_B2 = Object.fromEntries(Object.entries(A.noiseConditions).map(([nid, c]) => [nid, { kind: c.kind, noisePct: c.rate,
      engine: { quranDetectedPct: c.engine.quranDetected.pct, hadithVerbatimDetectedPct: c.engine.hadithVerbatimDetected.pct, hadithVerbatimDetectedCI95: c.engine.hadithVerbatimDetected.ci95, hadithChangedWordingDetectedPct: c.engine.hadithChangedDetected.pct, criticalErrorsPerLecture: c.engine.criticalPerLecture.mean },
      baselineB2: c.B2 && { quranDetectedPct: c.B2.quranDetected.pct, hadithVerbatimDetectedPct: c.B2.hadithVerbatimDetected.pct, hadithChangedWordingDetectedPct: c.B2.hadithChangedDetected.pct, criticalErrorsPerLecture: c.B2.criticalPerLecture.mean } }]));
    H.arabic_noiseA_shareCoveredByAToleranceRulePct = Object.fromEntries(Object.entries(A.noiseShape).map(([rate, x]) => [rate, x.coveredByAToleranceRule]));
    H.arabic_outOfCorpus_byNoisePct = A.outOfCorpus;
    if (A.absentSayings) H.arabic_trulyAbsentSayings = { sayings: A.absentSayings.sayings, clean: A.absentSayings.clean && { notFound: A.absentSayings.clean.notFound, leadOnly: A.absentSayings.clean.leadOnly, meaningSuggestion: A.absentSayings.clean.meaningSuggestion, textualCitation: A.absentSayings.clean.textualCitation },
      noise20: A.absentSayings.noise20 && { notFound: A.absentSayings.noise20.notFound, leadOnly: A.absentSayings.noise20.leadOnly, meaningSuggestion: A.absentSayings.noise20.meaningSuggestion, textualCitation: A.absentSayings.noise20.textualCitation } };
    H.arabic_freshSeedsCheck = { seeds: A.freshSeeds.seeds, clean: pick(A.freshSeeds.clean), noise20: pick(A.freshSeeds.noise20) };
  }
  if (S.books) { H.books_detectedByQuoteLength = S.books.sets; if (S.books.cueFollowedByOwnWords) H.books_cueFollowedByOwnWords = S.books.cueFollowedByOwnWords; }
  if (S.english) H.english_byNoisePct = Object.fromEntries(Object.entries(S.english.rows).map(([rate, c]) => [rate, {
    indexedVerses_referenceCorrect: { k: c.indexedTranslationVerses.referenceCorrect, n: c.indexedTranslationVerses.n, ci95: c.indexedTranslationVerses.ci95ReferenceCorrect },
    translatedHadith_referenceCorrect: { k: c.translatedHadith.referenceCorrect, n: c.translatedHadith.n, ci95: c.translatedHadith.ci95ReferenceCorrect },
    nonIndexedTranslationVerses_textualWithCorrectReference: { k: c.nonIndexedTranslationVerses.textualWithCorrectReference, n: c.nonIndexedTranslationVerses.n, ci95: c.nonIndexedTranslationVerses.ci95 },
    nonIndexedTranslationVerses_referenceWithinFirst5: { k: c.nonIndexedTranslationVerses.referenceWithinFirst5, n: c.nonIndexedTranslationVerses.n, ci95: c.nonIndexedTranslationVerses.ci95First5 },
    wrongReferenceCitations: c.wrongReferenceCitations.length, falseCitationsInFiller: c.falseCitationsInFiller }]));
  return H;
}
export function buildSummary() {
  const res = readJson("results.json"), b = readJson("results_books.json"), e = readJson("results_en.json");
  const S = { _note: "SIMULATION ONLY (محاكاة): synthetic lectures and simulated transcription noise. No number here was measured on real audio. Noise levels are the share of words hit in the simulation, not the word error rate of a recogniser.",
    _produced_by: "node eval/all.mjs  (= node eval/run.mjs, node eval/books.mjs, node eval/english.mjs)", headline: null };
  if (res && res.rows) S.arabic = summarizeRun(res);
  if (b && b.sets) S.books = summarizeBooks(b);
  if (e && e.rows) S.english = summarizeEnglish(e);
  S.headline = headline(S);
  return S;
}
export function writeSummary() { writeJson("summary.json", buildSummary()); }
if (process.argv[1] === fileURLToPath(import.meta.url)) { writeSummary(); console.log("wrote eval/summary.json"); }
