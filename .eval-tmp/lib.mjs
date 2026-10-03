// Node helpers shared by tests and the evaluation: load the corpus from disk.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Corpus } from "../public/js/corpus.js";
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = path.join(ROOT, "public", "data");
export async function loadCorpus() {
  return Corpus.load(async (name, kind) => {
    const b = await readFile(path.join(DATA, name));
    return kind === "json" ? JSON.parse(b.toString("utf8")) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  });
}
/** core + the named book packs */
export async function loadCorpusWith(packs) { const c = await loadCorpus(); for (const p of packs) await c.loadPack(p); return c; }
