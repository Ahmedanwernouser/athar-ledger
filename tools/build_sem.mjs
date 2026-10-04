// Sentence vectors of the core library (Qur'an + the nine hadith collections), for finding a quotation BY MEANING.
//   node tools/build_sem.mjs <state dir>
// Each passage is one row; a passage longer than 140 words is cut into rows of 120 words every 100, so that the end of a long
// hadith can be found too. Rows are embedded by the model bge-m3 on Cloudflare Workers AI through the deployed Worker's /embed
// route (free allowance: 10,000 neurons a day). The work is resumable: the state dir keeps what is done (rows-*.bin, state.json);
// when the day's allowance runs out the script stops cleanly and the next run goes on from there.
// Output when complete: <state dir>/complete (a marker). tools/pack_sem.mjs then cuts the vectors to the shipped length.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadCorpus } from "../eval/lib.mjs";
import { embedTexts } from "./embed_client.mjs";

const DIR = process.argv[2]; if (!DIR) { console.error("usage: node tools/build_sem.mjs <state dir>"); process.exit(2); }
mkdirSync(DIR, { recursive: true });
const WORKER = process.env.LIVE_WORKER, ORIGIN = process.env.LIVE_ORIGIN, MODEL = process.env.SEM_MODEL || "bge-m3";
const LONG = 140, CHUNK = 120, STRIDE = 100, SHARD = 4800;

/** the rows of the core: [{pid, a, b}] in passage order (exported for pack_sem.mjs and the tests) */
export function semRows(corpus) {
  const rows = [];
  for (let pid = 0; pid < corpus.coreN; pid++) {
    const n = corpus.tok(pid).length;
    if (n <= LONG) { rows.push({ pid, a: 0, b: n }); continue; }
    for (let a = 0; ; a += STRIDE) { const b = Math.min(n, a + CHUNK); rows.push({ pid, a: b === n ? Math.max(0, n - CHUNK) : a, b }); if (b === n) break; }
  }
  return rows;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!WORKER || !ORIGIN) { console.error("LIVE_WORKER and LIVE_ORIGIN are needed"); process.exit(2); }
  const corpus = await loadCorpus();
  const rows = semRows(corpus), texts = rows.map(r => corpus.tok(r.pid).slice(r.a, r.b).join(" "));
  const h = createHash("sha256"); for (const t of texts) h.update(t + "\n"); const hash = h.digest("hex").slice(0, 16);
  const stateFile = path.join(DIR, "state.json");
  let state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
  if (!state || state.hash !== hash || state.model !== MODEL || state.rows !== rows.length) state = { model: MODEL, hash, rows: rows.length, done: 0, dim: 0, started: new Date().toISOString() };
  console.log(`rows ${rows.length} (passages ${corpus.coreN}), words ${texts.reduce((s, t) => s + t.split(" ").length, 0)}, already done ${state.done}`);
  while (state.done < rows.length) {
    const from = state.done, to = Math.min(rows.length, from + SHARD);
    const r = await embedTexts(texts.slice(from, to), { worker: WORKER, origin: ORIGIN, model: MODEL, kind: "d", onProgress: (g) => { if (g % 960 === 0) console.log(`  ${from + g}/${rows.length}`); } });
    if (r.done < to - from) { console.log(`stopped at row ${from} (${r.error}); nothing of this shard is kept — the next run goes on from here`); break; }
    if (state.dim && state.dim !== r.dim) { console.error("vector length changed"); process.exit(1); }
    writeFileSync(path.join(DIR, `rows-${String(from).padStart(6, "0")}.bin`), Buffer.from(r.vectors.buffer, r.vectors.byteOffset, r.vectors.byteLength));
    state.done = to; state.dim = r.dim; state.updated = new Date().toISOString();
    writeFileSync(stateFile, JSON.stringify(state, null, 1) + "\n");
  }
  if (state.done >= rows.length) { writeFileSync(path.join(DIR, "complete"), hash + "\n"); console.log("complete: " + rows.length + " rows of " + state.dim); }
  else console.log(`done ${state.done}/${rows.length}`);
}
