// tweets.mjs — REAL human-written text with an external gold standard: the 473 tweets of the QDetect paper
// (El-Beltagy & Rafea 2021, "QDetect: an intelligent tool for detecting Quranic verses in any text").
//
//   node eval/tweets.mjs               dev / test / all numbers; misses and extras of the DEV half only
//   node eval/tweets.mjs --hadith      also list every textual hadith citation made on the DEV half (no gold: read by a person)
//   node eval/tweets.mjs --dhikr       also count everyday dhikr that is an ayah, without a cue (engine option fragDhikr)
//   node eval/tweets.mjs --write      also write eval/results_tweets.json (counts only — no tweet text)
//   node eval/tweets.mjs --quiet      numbers only
//   node eval/tweets.mjs --show-test   list the TEST half's misses and extras. For the final error analysis ONLY:
//                                      nothing may be tuned after looking at them.
//
// The data is NOT ours to ship (the QDetect repository is GPL-3.0 and the tweets belong to their authors). It is read
// from data/raw/external/qdetect/Tweets_Gold.txt (git-ignored): id <TAB> tweet <TAB> number of Qur'anic verses / fragments.
// Split, fixed before any tuning: dev = even 0-based line index, test = odd. Thresholds were chosen on dev only.
// Counting rule (the one the QDetect authors use for their own tool): per tweet, gold count g against the number t of
// textual Qur'an citations found: tp += min(g, t), fn += max(0, g − t), fp += max(0, t − g); g = t = 0 is a true negative.
// It counts fragments per tweet; it does not check WHICH ayah was found.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT, loadCorpus, writeJson } from "./lib.mjs";
import { analyze } from "../public/js/engine.js";
import { wordsFromText } from "../public/js/text.js";

export const GOLD = path.join(ROOT, "data", "raw", "external", "qdetect", "Tweets_Gold.txt");
export const QDETECT = { revisedGold: { P: 0.989, R: 0.967, F: 0.978 }, paper: { P: 0.968, R: 0.948 } };
export const hasGold = () => existsSync(GOLD);
const HOWTO = `The QDetect tweets are not shipped with this project (GPL-3.0 repository; the tweets belong to their authors).
To run this benchmark, fetch them yourself:
  git clone https://github.com/SElBeltagy/Quran_Detector.git /tmp/qd
  mkdir -p data/raw/external/qdetect && cp /tmp/qd/data/Tweets_Gold.txt data/raw/external/qdetect/
(expected file: ${path.relative(ROOT, GOLD)})`;

export function loadGold() {
  return readFileSync(GOLD, "utf8").split("\n").filter(l => l.trim()).map((l, i) => {
    const s = l.split("\t");
    return { i, half: i % 2 === 0 ? "dev" : "test", id: s[0], text: s[1], n: +s[2] };
  });
}
const textual = e => (e.status === "verbatim" || e.status === "partial") && e.source;
export function score(rows) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const { g, t } of rows) {
    if (g === 0 && t === 0) tn++;
    else { tp += Math.min(g, t); fn += Math.max(0, g - t); fp += Math.max(0, t - g); }
  }
  const P = tp + fp ? tp / (tp + fp) : 1, R = tp + fn ? tp / (tp + fn) : 1;
  return { tweets: rows.length, tp, fp, fn, tn, P: +P.toFixed(3), R: +R.toFixed(3), F: +(P + R ? 2 * P * R / (P + R) : 0).toFixed(3) };
}
/** run the engine over the tweets -> one row per tweet */
export function runTweets(corpus, gold, options = {}) {
  return gold.map(x => {
    const led = analyze(wordsFromText(x.text), corpus, options).ledger;
    const q = led.filter(e => textual(e) && e.source.type === "q"), h = led.filter(e => textual(e) && e.source.type === "h");
    return { ...x, g: x.n, t: q.length, q, h };
  });
}
export function summary(rows) {
  return { dev: score(rows.filter(r => r.half === "dev")), test: score(rows.filter(r => r.half === "test")), all: score(rows) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (!hasGold()) { console.error(HOWTO); process.exit(2); }
  const args = new Set(process.argv.slice(2));
  const corpus = await loadCorpus(), gold = loadGold();
  const rows = runTweets(corpus, gold), s = summary(rows);
  const line = (name, x) => `${name.padEnd(28)} tweets ${String(x.tweets ?? "").padStart(3)}  tp ${String(x.tp ?? "").padStart(3)}  fp ${String(x.fp ?? "").padStart(2)}  fn ${String(x.fn ?? "").padStart(2)}  tn ${String(x.tn ?? "").padStart(3)}  P ${x.P.toFixed(3)}  R ${x.R.toFixed(3)}  F ${x.F === undefined ? "  —  " : x.F.toFixed(3)}`;
  console.log("QDetect tweets (real text, external gold). dev = even line index (used for tuning), test = odd (held out).");
  console.log(line("Athar  dev", s.dev)); console.log(line("Athar  test", s.test)); console.log(line("Athar  all", s.all));
  let d = null;
  if (args.has("--dhikr") || args.has("--write")) {
    d = summary(runTweets(corpus, gold, { fragDhikr: true }));
    console.log(line("Athar+dhikr  dev", d.dev)); console.log(line("Athar+dhikr  test", d.test)); console.log(line("Athar+dhikr  all", d.all));
  }
  console.log(line("QDetect all (revised gold)", QDETECT.revisedGold)); console.log(line("QDetect all (paper)", QDETECT.paper));
  if (args.has("--write")) {
    const before = summary(runTweets(corpus, gold, { fragQuran: false }));
    writeJson("results_tweets.json", {
      _note: "REAL text with an external gold standard: the 473 tweets of the QDetect paper (El-Beltagy & Rafea 2021). Counts only; the tweets are not shipped (see eval/README.md). dev = even line index of Tweets_Gold.txt (thresholds were chosen on it), test = odd (held out). Counting rule of the QDetect authors: fragments per tweet, not which ayah.",
      engine: s, engineWithoutShortFragments: before, engineCountingEverydayDhikr: d,
      hadithTextualCitations: { dev: rows.filter(r => r.half === "dev").reduce((a, r) => a + r.h.length, 0), test: rows.filter(r => r.half === "test").reduce((a, r) => a + r.h.length, 0), note: "no gold for hadith" },
      qdetectPublished_allTweets: QDETECT,
    });
    console.log("wrote eval/results_tweets.json");
  }
  if (args.has("--quiet")) process.exit(0);
  const show = half => {
    const sel = rows.filter(r => r.half === half);
    console.log(`\nMISSED (${half}): gold | found | tweet`);
    for (const r of sel) if (r.g > r.t) console.log(`  ${r.g} | ${r.t} | #${r.i} ${r.text.slice(0, 220)}${r.q.length ? "\n        found: " + r.q.map(e => `${e.source.ref} ${e.status} «${e.spoken}»`).join(" ## ") : ""}`);
    console.log(`\nEXTRA (${half}): gold | found | tweet`);
    for (const r of sel) if (r.t > r.g) console.log(`  ${r.g} | ${r.t} | #${r.i} ${r.text.slice(0, 220)}\n        found: ${r.q.map(e => `${e.source.ref} ${e.status} «${e.spoken}»`).join(" ## ")}`);
  };
  show("dev");
  if (args.has("--show-test")) { console.log("\n===== TEST half (final error analysis only — no tuning after this) ====="); show("test"); }
  if (args.has("--hadith")) {
    console.log("\nTEXTUAL HADITH CITATIONS (dev) — no gold, to be judged by reading:");
    let k = 0;
    for (const r of rows) if (r.half === "dev") for (const e of r.h) console.log(`  [${++k}] #${r.i} ${e.status} ${e.source.label ?? e.source.ref} (${e.source.ref})\n      quoted: «${e.spoken}»\n      tweet : ${r.text.slice(0, 260)}`);
    console.log(`  total: ${k}`);
  }
}
