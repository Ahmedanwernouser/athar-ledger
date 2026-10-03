// vectors.js — dense retrieval for quotations "by meaning" (see tools/train_vectors.py for how the index is built).
//
//   embed(words)     : SIF-weighted sum of unit word vectors, common component removed, unit length
//   search(q, k)     : cosine against every passage window (int8), best window per passage
//   maxSim(q, pid)   : late-interaction re-ranking — every informative query word is matched to its most similar
//                      word in the passage; the idf-weighted average of those similarities is the score
// Nothing here ever decides a verdict: it only proposes candidates that are shown as "بالمعنى — يحتاج تأكيدًا".
import { stem } from "./text.js";

/**
 * The k best passages of `touched` (ids in ascending order) by best[pid * stride + col], highest first, ties by id.
 * A sorted list kept by insertion: no re-sorting, and at most k entries are ever held.
 */
function topK(touched, best, stride, col, k) {
  const pids = [], scores = [];
  for (let t = 0; t < touched.length; t++) {
    const pid = touched[t], s = best[pid * stride + col];
    let n = pids.length;
    if (n === k) { if (s <= scores[n - 1]) continue; n--; }      // full: only a strictly better score gets in
    let i = n;                                                   // equal scores keep the earlier (smaller) id first
    while (i > 0 && scores[i - 1] < s) { pids[i] = pids[i - 1]; scores[i] = scores[i - 1]; i--; }
    pids[i] = pid; scores[i] = s;
  }
  return pids.map((pid, i) => ({ pid, score: scores[i] / 16129 }));
}

export class Vectors {
  /** fetcher resolves names inside data/ ; loads the word table and the core windows */
  static async load(fetcher) {
    const v = new Vectors();
    v.fetcher = fetcher;
    v.meta = await fetcher("vec/meta.json", "json");
    v.D = v.meta.dim;
    const [vocab, wv, sif, pc] = await Promise.all([fetcher("vec/vocab.json", "json"), fetcher("vec/wv.bin", "buffer"),
      fetcher("vec/sif.bin", "buffer"), fetcher("vec/pc.bin", "buffer")]);
    v.index = new Map(vocab.map((w, i) => [w, i]));
    v.wv = new Int8Array(wv); v.sif = new Float32Array(sif); v.pcs = { ar: new Float32Array(pc) };
    try { v.pcs.en = new Float32Array(await fetcher("vec/pc_en.bin", "buffer")); } catch { /* Arabic-only index */ }
    v.parts = [];   // {id, base, vec:Int8Array, owner:Uint16Array}
    v._idCache = new Map();
    return v;
  }
  has(id) { return this.parts.some(p => p.id === id); }
  async addPack(id, base) {
    if (this.has(id)) return;
    const [vec, map] = await Promise.all([this.fetcher(`vec/vec_${id}.bin`, "buffer"), this.fetcher(`vec/map_${id}.bin`, "buffer")]);
    const owner = new Uint16Array(map), v = new Int8Array(vec);
    // a window is owned by a 16-bit passage number inside its pack: the two files must describe the same windows
    if (owner.length * this.D !== v.length) throw new Error(`dense index of pack "${id}" is inconsistent: ${owner.length} windows but ${v.length} vector bytes (dim ${this.D})`);
    this.parts.push({ id, base, vec: v, owner });
  }

  /** words: normalised (NOT folded) tokens -> Float32Array(D) unit vector, or null when no word is known */
  embed(words, lang = "ar") {
    const pc = this.pcs[lang] || this.pcs.ar;
    const D = this.D, out = new Float32Array(D); let n = 0;
    for (const w of words) {
      const i = this.index.get(stem(w)); if (i == null) continue;
      const s = this.sif[i] / 127, o = i * D;
      for (let d = 0; d < D; d++) out[d] += s * this.wv[o + d];
      n++;
    }
    if (n < 2) return null;
    let dot = 0; for (let d = 0; d < D; d++) dot += out[d] * pc[d];
    let norm = 0; for (let d = 0; d < D; d++) { out[d] -= dot * pc[d]; norm += out[d] * out[d]; }
    norm = Math.sqrt(norm) || 1; for (let d = 0; d < D; d++) out[d] /= norm;
    return out;
  }

  /**
   * search() for several queries in ONE pass over the index (the same results as calling search() once per query; the
   * pass over ~10^5 windows is what costs, and the prefixes of one quotation are searched together).
   * @returns one [{pid, score}] list per query
   */
  searchMany(qs, k, accept = () => true) {
    const Q = qs.length;
    if (Q === 0) return [];
    const D = this.D, G = (Q + 1) >> 1, PACK = 16777216;
    // Two queries share one double: q_even + q_odd * 2^24. A dot product is at most 64 * 127 * 127 < 2^20 in size, so
    // the two sums never touch inside the 53-bit mantissa and are taken apart exactly afterwards (integer arithmetic,
    // the same numbers search() gets).
    const qp = new Float64Array(G * D);
    for (let x = 0; x < Q; x++) { const g = (x >> 1) * D, f = x & 1 ? PACK : 1; for (let d = 0; d < D; d++) qp[g + d] += Math.round(qs[x][d] * 127) * f; }
    const q0 = qp.subarray(0, D), q1 = G > 1 ? qp.subarray(D, 2 * D) : q0, q2 = G > 2 ? qp.subarray(2 * D, 3 * D) : q0;
    let total = 0; for (const part of this.parts) total = Math.max(total, part.base + 65536);
    // best[pid * 2G + x]: the best window score of passage pid for query x
    if (!this._bestInt || this._bestInt.length < total * 2 * G) this._bestInt = new Int32Array(total * 2 * G);
    const best = this._bestInt, W2 = 2 * G;
    const touched = [];
    // one loop per group count, so each stays a tight loop of its own
    const open = pid => { touched.push(pid); const bo = pid * W2; for (let x = 0; x < W2; x++) best[bo + x] = -2147483648; return bo; };
    for (const part of this.parts) {
      const { vec, owner, base } = part, nW = owner.length;
      let lastPid = -1, lastOk = false, bo = 0;
      if (G === 3) {
        for (let w = 0, o = 0; w < nW; w++, o += D) {
          const pid = base + owner[w];
          if (pid !== lastPid) { lastPid = pid; lastOk = accept(pid); if (lastOk) bo = open(pid); }
          if (!lastOk) continue;
          let s0 = 0, s1 = 0, s2 = 0;
          for (let d = 0; d < D; d++) { const v = vec[o + d]; s0 += q0[d] * v; s1 += q1[d] * v; s2 += q2[d] * v; }
          let hi = Math.round(s0 / PACK), lo = s0 - hi * PACK;
          if (lo > best[bo]) best[bo] = lo; if (hi > best[bo + 1]) best[bo + 1] = hi;
          hi = Math.round(s1 / PACK); lo = s1 - hi * PACK;
          if (lo > best[bo + 2]) best[bo + 2] = lo; if (hi > best[bo + 3]) best[bo + 3] = hi;
          hi = Math.round(s2 / PACK); lo = s2 - hi * PACK;
          if (lo > best[bo + 4]) best[bo + 4] = lo; if (hi > best[bo + 5]) best[bo + 5] = hi;
        }
      } else if (G === 2) {
        for (let w = 0, o = 0; w < nW; w++, o += D) {
          const pid = base + owner[w];
          if (pid !== lastPid) { lastPid = pid; lastOk = accept(pid); if (lastOk) bo = open(pid); }
          if (!lastOk) continue;
          let s0 = 0, s1 = 0;
          for (let d = 0; d < D; d++) { const v = vec[o + d]; s0 += q0[d] * v; s1 += q1[d] * v; }
          let hi = Math.round(s0 / PACK), lo = s0 - hi * PACK;
          if (lo > best[bo]) best[bo] = lo; if (hi > best[bo + 1]) best[bo + 1] = hi;
          hi = Math.round(s1 / PACK); lo = s1 - hi * PACK;
          if (lo > best[bo + 2]) best[bo + 2] = lo; if (hi > best[bo + 3]) best[bo + 3] = hi;
        }
      } else {
        for (let w = 0, o = 0; w < nW; w++, o += D) {
          const pid = base + owner[w];
          if (pid !== lastPid) { lastPid = pid; lastOk = accept(pid); if (lastOk) bo = open(pid); }
          if (!lastOk) continue;
          for (let g = 0, qo = 0; g < G; g++, qo += D) {
            let s = 0;
            for (let d = 0; d < D; d++) s += qp[qo + d] * vec[o + d];
            const hi = Math.round(s / PACK), lo = s - hi * PACK;
            if (lo > best[bo + 2 * g]) best[bo + 2 * g] = lo; if (hi > best[bo + 2 * g + 1]) best[bo + 2 * g + 1] = hi;
          }
        }
      }
    }
    const out = [];
    for (let x = 0; x < Q; x++) out.push(topK(touched, best, W2, x, k));
    return out;
  }

  /** -> [{pid, score}] best k passages by cosine; `accept(pid)` filters (kind of source, held-out passages ...) */
  search(q, k, accept = () => true) {
    const D = this.D;
    const qi = new Int32Array(D); for (let d = 0; d < D; d++) qi[d] = Math.round(q[d] * 127);   // integer dot products
    let total = 0; for (const part of this.parts) total = Math.max(total, part.base + 65536);
    if (!this._best || this._best.length < total) this._best = new Int32Array(total);
    const best = this._best; best.fill(-2147483648);
    const touched = [];
    for (const part of this.parts) {
      const { vec, owner, base } = part, nW = owner.length;
      let lastPid = -1, lastOk = false;
      for (let w = 0, o = 0; w < nW; w++, o += D) {
        const pid = base + owner[w];
        if (pid !== lastPid) { lastPid = pid; lastOk = accept(pid); if (lastOk) touched.push(pid); }   // windows of one passage are contiguous
        if (!lastOk) continue;
        let s = 0;
        for (let d = 0; d < D; d += 8) {
          s += qi[d] * vec[o + d] + qi[d + 1] * vec[o + d + 1] + qi[d + 2] * vec[o + d + 2] + qi[d + 3] * vec[o + d + 3]
             + qi[d + 4] * vec[o + d + 4] + qi[d + 5] * vec[o + d + 5] + qi[d + 6] * vec[o + d + 6] + qi[d + 7] * vec[o + d + 7];
        }
        if (s > best[pid]) best[pid] = s;
      }
    }
    return topK(touched, best, 1, 0, k);
  }

  /** unique word-vector ids of a word list (cached per passage id when `key` is given) */
  ids(words, key = null) {
    if (key != null) { const c = this._idCache.get(key); if (c) return c; }
    const seen = new Set();
    for (const w of words) { const i = this.index.get(stem(w)); if (i != null) seen.add(i); }
    const out = Int32Array.from(seen);
    if (key != null) { if (this._idCache.size > 20000) this._idCache.clear(); this._idCache.set(key, out); }
    return out;
  }

  /** query side of maxSim, prepared once per query: [{i, idf}] for informative known words */
  prepare(qWords, idfOf, minIdf = 2) {
    const out = [], seen = new Set();
    for (const w of qWords) {
      const st = stem(w), i = this.index.get(st);
      if (i == null || seen.has(i)) continue; seen.add(i);
      const idf = idfOf(st); if (idf >= minIdf) out.push({ i, idf });
    }
    return out;
  }

  /** late-interaction score in [0,1]: every informative query word is matched to its most similar passage word */
  maxSim(prepared, pIdx) {
    if (!pIdx.length || !prepared.length) return 0;
    const D = this.D, wv = this.wv;
    let num = 0, den = 0;
    for (const { i, idf } of prepared) {
      let mx = 0; const qo = i * D;
      for (let k = 0; k < pIdx.length; k++) {
        const j = pIdx[k];
        if (j === i) { mx = 16129; break; }
        let s = 0; const po = j * D;
        for (let d = 0; d < D; d += 4) s += wv[qo + d] * wv[po + d] + wv[qo + d + 1] * wv[po + d + 1] + wv[qo + d + 2] * wv[po + d + 2] + wv[qo + d + 3] * wv[po + d + 3];
        if (s > mx) mx = s;
      }
      num += idf * mx / 16129; den += idf;
    }
    return den ? num / den : 0;
  }
}
