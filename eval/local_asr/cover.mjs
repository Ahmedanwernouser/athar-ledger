import fs from "fs";
import { loadCorpus } from "../../eval/lib.mjs";
import { analyze } from "../../public/js/engine.js";
const c = await loadCorpus();
const [f, listFile] = process.argv.slice(2);
const exp = fs.readFileSync(listFile, "utf8").split("\n").filter(Boolean).map(l => { const m = l.match(/(\d{3})\/(\d{3})\.mp3/); return `${+m[1]}:${+m[2]}`; });
const j = JSON.parse(fs.readFileSync(f, "utf8"));
const words = j.words.map(w => ({ w: w.word, start: w.start, end: w.end }));
const r = analyze(words, c);
const found = new Map(); let wrong = [];
for (const e of r.ledger) {
  console.log(" ", String(Math.round(e.start ?? 0)).padStart(4), e.status.padEnd(8), String(e.agreement ?? "").slice(0, 4).padEnd(4), (e.source?.label || "-").padEnd(36), "|", (e.spoken || "").slice(0, 60));
  if (!["verbatim", "partial"].includes(e.status) || !e.source) continue;
  if (e.source.type !== "q") { wrong.push(e.source.label); continue; }
  for (let a = e.source.ayah; a <= (e.source.ayahEnd || e.source.ayah); a++) { const k = `${e.source.surah}:${a}`; found.set(k, e.status); if (!exp.includes(k)) wrong.push(k); }
}
const hit = exp.filter(k => found.has(k));
console.log(`ayahs recited: ${exp.length} | found: ${hit.length} (${Math.round(100 * hit.length / exp.length)}%) | labelled verbatim: ${hit.filter(k => found.get(k) === "verbatim").length} | not recited but cited: ${wrong.length} ${JSON.stringify(wrong)}`);
console.log("missed:", exp.filter(k => !found.has(k)).join(" "));
