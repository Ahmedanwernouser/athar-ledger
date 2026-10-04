// Node helpers shared by tests and the evaluation: load the corpus from disk.
import { readFile } from "node:fs/promises";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Corpus } from "../public/js/corpus.js";
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = path.join(ROOT, "public", "data");
const diskLoader = async (name, kind) => {
  const b = await readFile(path.join(DATA, name));
  return kind === "json" ? JSON.parse(b.toString("utf8")) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
export async function loadCorpus() { return Corpus.load(diskLoader); }
/**
 * Sentence vectors for the evaluation: the shipped index (public/data/sem.bin) and the vectors of the stretches of speech
 * the evaluation asks about. Those were embedded once through the Worker (eval/embed/cache.mjs, run by GitHub Actions) and
 * are kept in eval/embed/cache/<name>.bin beside the texts they belong to (eval/embed/requests/<name>.json), so every run is
 * offline and repeatable. -> { index, lookup(text), used: Set, missed: Set } or null when the index is not there.
 */
export async function loadSem(corpus) {
  const { SemIndex } = await import("../public/js/sem.js");
  const { createHash } = await import("node:crypto");
  const index = await SemIndex.load(diskLoader, corpus);
  if (!index) return null;
  const cache = new Map(), REQ = path.join(ROOT, "eval", "embed", "requests"), CACHE = path.join(ROOT, "eval", "embed", "cache");
  for (const f of existsSync(CACHE) ? readdirSync(CACHE).filter(x => x.endsWith(".json")) : []) {
    const name = f.replace(/\.json$/, ""), rf = path.join(REQ, name + ".json"), bf = path.join(CACHE, name + ".bin");
    if (!existsSync(rf) || !existsSync(bf)) continue;
    const meta = JSON.parse(readFileSync(path.join(CACHE, f), "utf8")), req = JSON.parse(readFileSync(rf, "utf8"));
    const hash = createHash("sha256").update(JSON.stringify([req.kind, req.texts])).digest("hex").slice(0, 16);
    if (hash !== meta.hash || meta.dim !== index.dim || meta.n !== req.texts.length) continue;       // the texts changed since the vectors were made
    const b = readFileSync(bf), all = new Int8Array(b.buffer, b.byteOffset, b.length);
    req.texts.forEach((t, i) => { if (!cache.has(t)) cache.set(t, all.subarray(i * meta.dim, (i + 1) * meta.dim)); });
  }
  const used = new Set(), missed = new Set();
  return { index, used, missed, lookup: t => { used.add(t); const v = cache.get(t) || null; if (!v) missed.add(t); return v; } };
}
/** core + the named book packs */
export async function loadCorpusWith(packs) { const c = await loadCorpus(); for (const p of packs) await c.loadPack(p); return c; }

// ---------------- evaluation helpers ----------------
export const EVAL = path.join(ROOT, "eval");
/** Wilson 95% score interval for k successes out of n -> [low, high] as percentages rounded to integers */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 100];
  const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.round(100 * Math.max(0, c - h)), Math.round(100 * Math.min(1, c + h))];
}
/** Running times are the only thing that differs between two runs, so they live in their own file. */
export function writeTiming(key, value) {
  const f = path.join(EVAL, "timings.json");
  let t = {};
  if (existsSync(f)) { try { t = JSON.parse(readFileSync(f, "utf8")); } catch { t = {}; } }
  t._note = "Running times in seconds on the machine that produced the RESULTS files. They change from run to run and from machine to machine; nothing else in eval/ does.";
  t[key] = value;
  writeFileSync(f, JSON.stringify(t, null, 1) + "\n");
}
export const readJson = (name, dflt = null) => { const f = path.join(EVAL, name); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : dflt; };
export const writeJson = (name, obj) => writeFileSync(path.join(EVAL, name), JSON.stringify(obj, null, 1) + "\n");
/** Western digits -> Arabic-Indic digits, for the Arabic reports */
export const ar = x => String(x).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]).replace(/\./g, "٫");
