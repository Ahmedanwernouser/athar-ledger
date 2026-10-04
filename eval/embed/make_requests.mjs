// Writes the texts whose vectors the by-meaning development needs (development lecture, seed 101; never reported):
//   q:<i>        each development paraphrase, opener removed, exactly its own words
//   p<L>:<i>     the L words that follow the opener (the paraphrase and, when it is shorter, the speech after it)
//   w<S>:<a>     every window of S words of the lecture, every S/2 words (no knowledge of where a quotation is)
//   node eval/embed/make_requests.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../lib.mjs";
import { buildLecture } from "../gen.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const corpus = await loadCorpus();
const SIZES = { vq: 40, vh: 60, ph: 40, par: 26, ooc: 30, cue: 14 };
const lec = buildLecture(corpus, 101, SIZES, "dev", { par: "strip" });
const W = lec.words.map(w => (typeof w === "string" ? w : w.w));
const par = lec.items.filter(x => x.kind === "par");
const texts = [], labels = [];
const add = (label, a, b) => { labels.push(label); texts.push(W.slice(a, Math.min(W.length, b)).join(" ")); };
par.forEach((it, i) => add(`q:${i}`, it.a, it.b));
for (const L of [9, 16, 24, 40]) par.forEach((it, i) => add(`p${L}:${i}`, it.a, it.a + L));
for (const S of [12, 20, 32]) for (let a = 0; a < W.length; a += S / 2) { add(`w${S}:${a}`, a, a + S); if (a + S >= W.length) break; }
writeFileSync(path.join(HERE, "requests", "dev101.json"), JSON.stringify({ kind: "q", labels, texts }) + "\n");
console.log(texts.length, "texts,", texts.join(" ").split(" ").length, "words");
