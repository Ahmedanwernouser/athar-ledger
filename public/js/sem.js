// sem.js — sentence vectors: the source of a quotation BY MEANING, among the texts of the core (Qur'an + nine collections).
// Each passage of the core is one row of data/sem.bin (a passage longer than 140 words is several rows), embedded once by the
// model bge-m3 (Cloudflare Workers AI) and cut to its first `dim` numbers, one signed byte each. A stretch of speech is
// embedded by the same model through the Worker's /embed route, and its nearest rows are found here, in the browser.
// The vectors only ORDER candidates for a text that the speaker announced; they never turn speech into a citation.

export const SEM = { LONG: 140, CHUNK: 120, STRIDE: 100, PREFIXES: [9, 16, 24], MAX_CHARS: 1900 };

/** the passage of every row, in row order (the build script and the page must agree on this, so it lives here) */
export function semRows(corpus) {
  const rows = [];
  for (let pid = 0; pid < corpus.coreN; pid++) {
    const n = corpus.tok(pid).length;
    if (n <= SEM.LONG) { rows.push({ pid, a: 0, b: n }); continue; }
    for (let a = 0; ; a += SEM.STRIDE) { const b = Math.min(n, a + SEM.CHUNK); rows.push({ pid, a: b === n ? Math.max(0, n - SEM.CHUNK) : a, b }); if (b === n) break; }
  }
  return rows;
}
/** the text sent for a stretch of speech: its normalised words, as the Worker would cut it */
export const semText = words => words.join(" ").slice(0, SEM.MAX_CHARS);

export class SemIndex {
  /** bytes: Int8Array rows × dim; rowPid: Int32Array, the passage of each row */
  constructor(bytes, dim, rowPid, model) {
    this.bytes = bytes; this.dim = dim; this.rowPid = rowPid; this.rows = rowPid.length; this.model = model;
    const norm = this.norm = new Float32Array(this.rows);
    for (let r = 0, o = 0; r < this.rows; r++) { let s = 0; for (let k = 0; k < dim; k++, o++) s += bytes[o] * bytes[o]; norm[r] = Math.sqrt(s) || 1; }
  }
  /** loader(name, kind) as in Corpus.load; null when the files are not there or do not belong to this corpus */
  static async load(loader, corpus) {
    let meta, buf;
    try { meta = await loader("sem.json", "json"); buf = await loader("sem.bin", "bin"); } catch { return null; }
    const rows = semRows(corpus);
    if (!meta || meta.rows !== rows.length || meta.passages !== corpus.coreN || buf.byteLength !== meta.rows * meta.dim) return null;
    return new SemIndex(new Int8Array(buf), meta.dim, Int32Array.from(rows, r => r.pid), meta.model);
  }
  /** q: Int8Array (at least `dim` long) -> the k nearest PASSAGES [{pid, score}] (cosine; a passage counts by its best row) */
  top(q, k, ok = null) {
    const { bytes, dim, rowPid, norm, rows } = this;
    let qn = 0; for (let j = 0; j < dim; j++) qn += q[j] * q[j]; qn = Math.sqrt(qn) || 1;
    // a small sorted list of the best rows; several rows of one passage may be in it, so it is kept longer than k
    const cap = k * 3, bestS = new Float32Array(cap).fill(-2), bestR = new Int32Array(cap).fill(-1); let low = -2;
    for (let r = 0, o = 0; r < rows; r++, o += dim) {
      let s = 0;
      for (let j = 0; j < dim; j++) s += q[j] * bytes[o + j];
      s /= norm[r];
      if (s <= low) continue;
      if (ok && !ok(rowPid[r])) continue;
      let i = cap - 1;
      while (i > 0 && bestS[i - 1] < s) { bestS[i] = bestS[i - 1]; bestR[i] = bestR[i - 1]; i--; }
      bestS[i] = s; bestR[i] = r; low = bestS[cap - 1];
    }
    const out = [], seen = new Set();
    for (let i = 0; i < cap && out.length < k; i++) { if (bestR[i] < 0) break; const pid = rowPid[bestR[i]]; if (seen.has(pid)) continue; seen.add(pid); out.push({ pid, score: bestS[i] / qn }); }
    return out;
  }
}

/** bytes of a base64 answer of the Worker -> one Int8Array per text */
export function unpackVectors(b64, n, dim) {
  const bin = atob(b64); if (bin.length !== n * dim) return null;
  const out = [];
  for (let i = 0; i < n; i++) { const v = new Int8Array(dim); for (let k = 0; k < dim; k++) v[k] = (bin.charCodeAt(i * dim + k) << 24) >> 24; out.push(v); }
  return out;
}
/**
 * The vectors of `texts`, asked from the Worker in batches. -> Map text -> Int8Array (texts that could not be embedded are
 * simply absent: the engine then orders their candidates as it did before). Never throws.
 */
export async function fetchVectors(texts, { url, model, dim, signal = null, batch = 48, headers = null }) {
  const out = new Map(), uniq = [...new Set(texts)];
  for (let i = 0; i < uniq.length; i += batch) {
    const part = uniq.slice(i, i + batch);
    try {
      const r = await fetch(url.replace(/\/+$/, "") + "/embed", { method: "POST", headers: { "Content-Type": "application/json", ...(headers || {}) }, body: JSON.stringify({ texts: part, kind: "q", model, dim }), signal });
      if (!r.ok) break;
      const j = await r.json();
      if (j.model !== model || j.n !== part.length || j.dim !== dim) break;
      const vs = unpackVectors(j.vectors, j.n, j.dim); if (!vs) break;
      part.forEach((t, k) => out.set(t, vs[k]));
    } catch { break; }
  }
  return out;
}
