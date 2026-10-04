// Brings the vectors that GitHub Actions made for eval/embed/requests/<name>.json into eval/embed/cache/, cut to the length
// of the shipped index, so the evaluation runs offline.
//   git fetch origin embed-results && node eval/embed/pull.mjs            (reads the fetched branch with `git show`)
//   node eval/embed/pull.mjs <dir with <name>.bin and <name>.json>         (or a folder)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REQ = path.join(HERE, "requests"), CACHE = path.join(HERE, "cache");
mkdirSync(CACHE, { recursive: true });
const DIM = JSON.parse(readFileSync(path.join(HERE, "..", "..", "public", "data", "sem.json"), "utf8")).dim;
const dir = process.argv[2];
const get = (f) => (dir ? (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f)) : null)
  : (() => { try { return execFileSync("git", ["show", "FETCH_HEAD:embed/" + f], { maxBuffer: 1 << 30 }); } catch { return null; } })());
for (const f of readdirSync(REQ).filter(x => x.endsWith(".json"))) {
  const name = f.replace(/\.json$/, ""), req = JSON.parse(readFileSync(path.join(REQ, f), "utf8"));
  const hash = createHash("sha256").update(JSON.stringify([req.kind, req.texts])).digest("hex").slice(0, 16);
  const mb = get(name + ".json"), bb = get(name + ".bin");
  if (!mb || !bb) { console.log(`${name}: no vectors on the branch yet`); continue; }
  const meta = JSON.parse(mb.toString("utf8"));
  if (meta.hash !== hash) { console.log(`${name}: the vectors on the branch were made for other texts (${meta.hash} / ${hash})`); continue; }
  if (bb.length !== meta.n * meta.dim || meta.dim < DIM) { console.log(`${name}: unexpected size`); continue; }
  const full = new Int8Array(bb.buffer, bb.byteOffset, bb.length), out = new Int8Array(meta.n * DIM);
  for (let r = 0; r < meta.n; r++) { let m = 0; for (let k = 0; k < DIM; k++) { const a = Math.abs(full[r * meta.dim + k]); if (a > m) m = a; }
    for (let k = 0; k < DIM; k++) out[r * DIM + k] = Math.round((full[r * meta.dim + k] / (m || 1)) * 127); }
  writeFileSync(path.join(CACHE, name + ".bin"), Buffer.from(out.buffer));
  writeFileSync(path.join(CACHE, name + ".json"), JSON.stringify({ n: meta.n, dim: DIM, model: meta.model, hash }) + "\n");
  console.log(`${name}: ${meta.n} vectors of ${DIM}`);
}
