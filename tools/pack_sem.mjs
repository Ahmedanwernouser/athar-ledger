// Cuts the sentence vectors built by tools/build_sem.mjs to the length the site ships.
//   node tools/pack_sem.mjs <state dir> [dim=384]   -> public/data/sem.bin (rows × dim signed bytes), public/data/sem.json
// A row keeps its first `dim` numbers, scaled again so that its largest is 127.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../eval/lib.mjs";
import { semRows } from "../public/js/sem.js";

const DIR = process.argv[2], DIM = +(process.argv[3] || 384);
if (!DIR || !existsSync(path.join(DIR, "complete"))) { console.error("usage: node tools/pack_sem.mjs <state dir of a COMPLETE build> [dim]"); process.exit(2); }
const state = JSON.parse(readFileSync(path.join(DIR, "state.json"), "utf8"));
const corpus = await loadCorpus(), rows = semRows(corpus);
if (rows.length !== state.rows) { console.error(`the build has ${state.rows} rows, this corpus ${rows.length}: build again`); process.exit(1); }
const full = new Int8Array(state.rows * state.dim); let off = 0;
for (const f of readdirSync(DIR).filter(x => /^rows-\d+\.bin$/.test(x)).sort()) { const b = readFileSync(path.join(DIR, f)); full.set(new Int8Array(b.buffer, b.byteOffset, b.length), off); off += b.length; }
if (off !== full.length) { console.error("the shards do not add up to rows × dim"); process.exit(1); }
const out = new Int8Array(state.rows * DIM);
for (let r = 0; r < state.rows; r++) {
  let m = 0; for (let k = 0; k < DIM; k++) { const a = Math.abs(full[r * state.dim + k]); if (a > m) m = a; }
  for (let k = 0; k < DIM; k++) out[r * DIM + k] = Math.round((full[r * state.dim + k] / (m || 1)) * 127);
}
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
writeFileSync(path.join(DATA, "sem.bin"), Buffer.from(out.buffer));
writeFileSync(path.join(DATA, "sem.json"), JSON.stringify({ model: state.model, dim: DIM, rows: state.rows, passages: corpus.coreN, builtFromDim: state.dim, textHash: state.hash, built: state.updated }, null, 1) + "\n");
console.log(`sem.bin: ${state.rows} rows × ${DIM} = ${(out.length / 1e6).toFixed(1)} MB`);
