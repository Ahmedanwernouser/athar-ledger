// Compares two real transcriptions of the same audio (Gemini and Whisper) through public/js/agree.js.
// Input: the *.gemini.json / *.groq.json files of the live test.  node eval/live/agree.mjs <dir> <name> [<name> ...]
import fs from "fs";
import { loadCorpus } from "../lib.mjs";
import { analyze } from "../../public/js/engine.js";
import { finish, setCorpusForTests, setDisplayForTests } from "../../public/js/worker.js";
import { compareLedgers } from "../../public/js/agree.js";
const corpus = await loadCorpus(); setCorpusForTests(corpus); setDisplayForTests(null);
const [dir, ...names] = process.argv.slice(2);
const ledger = (f) => { const j = JSON.parse(fs.readFileSync(f, "utf8")); const words = j.words.map(w => ({ w: w.word, start: w.start, end: w.end })); const r = analyze(words, corpus); for (const e of r.ledger) finish(e, words, r.tokenToWord); return r.ledger; };
const tot = {};
for (const n of names) {
  const A = ledger(`${dir}/${n}.gemini.json`), B = ledger(`${dir}/${n}.groq.json`);
  const r = compareLedgers(A, B);
  const up = [], conf = [];
  r.entries.forEach((x, i) => { if (!x) return; const e = A[i]; if (x.statusCombined === "verbatim" && e.status !== "verbatim") up.push(e); if (x.agreement2?.verdict === "difference_confirmed") conf.push(e); });
  console.log(n, JSON.stringify(r.stats), "| upgraded to verbatim:", up.map(e => e.source?.label).join("; ") || "-", "| difference confirmed:", conf.length);
  for (const k of Object.keys(r.stats)) tot[k] = (tot[k] || 0) + r.stats[k];
}
console.log("TOTAL", JSON.stringify(tot));
