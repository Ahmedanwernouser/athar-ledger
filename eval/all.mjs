// all.mjs — ONE command that regenerates every SIMULATED number of the evaluation.
//   node eval/all.mjs
// Runs, in order:
//   eval/run.mjs      Arabic: synthetic lectures, noise shapes, baselines, by-meaning, out-of-corpus  -> results.json, RESULTS.md
//   eval/books.mjs    quotations from the book packs, by quote length                                 -> results_books.json, RESULTS_BOOKS.md
//   eval/english.mjs  English lectures (indexed and non-indexed translations)                         -> results_en.json, RESULTS_EN.md
// and then rebuilds eval/summary.json (the headline numbers, key "headline", plus the detailed sections).
// Two runs give byte-identical RESULTS*.md, results*.json and summary.json. Running times are the only thing that
// changes; they go to eval/timings.json and nowhere else.
// Nothing here uses real audio. For recordings see transcribe.mjs and real.mjs.
// One step is NOT a simulation and runs only when its data is on this machine: eval/tweets.mjs (real tweets with an
// external gold standard; the data is not shipped — see eval/README.md) -> eval/results_tweets.json.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { EVAL, writeTiming } from "./lib.mjs";
import { writeSummary } from "./summary.mjs";
import { hasGold } from "./tweets.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pass = process.argv.slice(2).filter(a => a.startsWith("--jobs="));
const STEPS = [["run.mjs", pass], ["books.mjs", []], ["english.mjs", []]];
const T0 = Date.now(), seconds = {};
for (const [script, args] of STEPS) {
  const t0 = Date.now();
  console.error(`\n== node eval/${script} ==`);
  const r = spawnSync(process.execPath, [path.join(here, script), ...args], { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ATHAR_EVAL_QUIET: "1" } });
  if (r.status !== 0) { console.error(`eval/${script} failed (exit code ${r.status}). Nothing after it was run.`); process.exit(r.status || 1); }
  seconds[script] = Math.round((Date.now() - t0) / 1000);
}
writeSummary();
if (hasGold()) {
  console.error("\n== node eval/tweets.mjs --write --quiet  (real text: QDetect tweets) ==");
  const r = spawnSync(process.execPath, [path.join(here, "tweets.mjs"), "--write", "--quiet"], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) { console.error(`eval/tweets.mjs failed (exit code ${r.status}).`); process.exit(r.status || 1); }
} else console.error("\n(eval/tweets.mjs skipped: the QDetect tweets are not on this machine — run `node eval/tweets.mjs` for instructions)");
seconds.total = Math.round((Date.now() - T0) / 1000);
writeTiming("all", seconds);
const OUT = ["RESULTS.md", "RESULTS_BOOKS.md", "RESULTS_EN.md", "summary.json", "results.json", "results_books.json", "results_en.json"];
console.log(`\nDone in ${seconds.total} s (run ${seconds["run.mjs"]} s, books ${seconds["books.mjs"]} s, english ${seconds["english.mjs"]} s). SIMULATION ONLY — no real audio.`);
console.log("sha256 of the generated files (identical between two runs; eval/timings.json is the only file that differs):");
for (const f of OUT) console.log("  " + createHash("sha256").update(readFileSync(path.join(EVAL, f))).digest("hex").slice(0, 16) + "  eval/" + f);
