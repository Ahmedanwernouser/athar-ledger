// The evaluation's embedding cache. The engine's by-meaning search asks a sentence-embedding model (through the Worker) for
// the vector of each stretch of speech; the test machine of this project cannot reach the Worker, so the texts an evaluation
// needs are written to eval/embed/requests/<name>.json ({ kind: "q" | "d", texts: [...] }), this script — run by GitHub
// Actions — asks the DEPLOYED Worker for their vectors as the site would, and the answers go to the branch `embed-results`
// (<name>.bin: int8, n × dim; <name>.json: { n, dim, model, hash }). No secret is involved.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embedTexts } from "../../tools/embed_client.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REQ = path.join(HERE, "requests"), OUT = path.join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const WORKER = process.env.LIVE_WORKER, ORIGIN = process.env.LIVE_ORIGIN, MODEL = process.env.SEM_MODEL || "bge-m3";
const lines = []; const say = s => { console.log(s); lines.push(s); writeFileSync(path.join(OUT, "SUMMARY.txt"), lines.join("\n") + "\n"); };
for (let i = 0; i < 40; i++) {       // the Worker may be mid-deployment (the same push starts both workflows)
  try { const h = await (await fetch(WORKER + "/health", { signal: AbortSignal.timeout(15000) })).json(); if ((h.embed || []).includes(MODEL)) break; } catch { /* not yet */ }
  await new Promise(r => setTimeout(r, 15000));
}
for (const f of readdirSync(REQ).filter(x => x.endsWith(".json")).sort()) {
  const name = f.replace(/\.json$/, ""), req = JSON.parse(readFileSync(path.join(REQ, f), "utf8"));
  const hash = createHash("sha256").update(JSON.stringify([req.kind, req.texts])).digest("hex").slice(0, 16);
  const t0 = Date.now();
  const r = await embedTexts(req.texts, { worker: WORKER, origin: ORIGIN, model: MODEL, kind: req.kind || "q" });
  if (r.done < req.texts.length) { say(`${name}: stopped at ${r.done}/${req.texts.length} — ${r.error}`); continue; }
  writeFileSync(path.join(OUT, name + ".bin"), Buffer.from(r.vectors.buffer, r.vectors.byteOffset, r.vectors.byteLength));
  writeFileSync(path.join(OUT, name + ".json"), JSON.stringify({ n: r.done, dim: r.dim, model: r.model, hash }) + "\n");
  say(`${name}: ${r.done} texts, dim ${r.dim}, ${Math.round((Date.now() - t0) / 1000)} s`);
}
