// display.js — ORIGINAL text of the core hadith passages (spelling and diacritics as in the dataset), loaded lazily.
//
// The search index keeps normalised text only. data/display/ (built by tools/build_display.py) keeps, per hadith
// passage, the text as the dataset has it and the offset where the indexed text (what follows the chain of narrators)
// begins. It is OPTIONAL: when the folder is absent or a file cannot be fetched every call answers null and the
// caller keeps showing what it showed before.
//
//   const disp = new HadithDisplay(fetcher);          // the fetcher given to Corpus.load: fetcher(name, "json")
//   await disp.get(pid) / disp.get("bukhari:1")       // -> { ref, text, start, exact } | null
//   await disp.words(pid)                             // -> original words, one per indexed word, | null
//
// Plain ES module without imports: works in a page, in a Web Worker and in Node.
//
// Files: display/meta.json {K, pid_base, count, shards, collections, first[]}, display/h_<k>.json {k, r[], t[], o[], x[]}
// holding the hadith passages k*K … k*K+K-1, where hadith index = core passage id - pid_base (the Qur'an comes first).

const LETTER = /[\u0621-\u063f\u0641-\u064a\u0671]/;      // what norm() keeps as a letter (tools/build_display.py: _LETTER)
const RETRY_MS = 30000;                                    // a failed fetch is not repeated before this

export class HadithDisplay {
  /** fetcher(name, "json") -> Promise, as for Corpus.load; dir is the folder below the data root */
  constructor(fetcher, { dir = "display/" } = {}) {
    this.fetcher = fetcher; this.dir = dir;
    this._meta = undefined;         // undefined: not asked yet; Promise -> meta | null
    this._metaAt = 0;
    this._shards = new Map();       // k -> { p: Promise<shard|null>, v: shard|null|undefined, at }
    this.meta = null;
  }

  /** -> true when display text is available (meta.json loaded and understood) */
  async ready() { return !!(await this._loadMeta()); }

  /** pid (core passage id) or reference ("bukhari:1") -> { ref, text, start, exact } | null.
   *  text: the whole hadith as in the dataset; text.slice(start): the part after the chain of narrators, i.e. the
   *  text that was indexed (start = 0 when the passage is indexed in full); exact: words() is available. */
  async get(pidOrRef) {
    try {
      const meta = await this._loadMeta();
      if (!meta) return null;
      const k = this._shardOf(pidOrRef);
      if (k < 0) return null;
      const s = await this._loadShard(k);
      return s ? this._entry(s, k, pidOrRef) : null;
    } catch { return null; }
  }

  /** the same, without waiting: undefined while its file is not in memory (call get() to load it) */
  peek(pidOrRef) {
    if (!this.meta) return undefined;
    const k = this._shardOf(pidOrRef);
    if (k < 0) return null;
    const s = this._shards.get(k);
    return s && s.v ? this._entry(s.v, k, pidOrRef) : undefined;
  }

  /** original words aligned 1:1 with the indexed words of the passage (passage.n.split(" ")), each with its
   *  diacritics and the punctuation attached to it; null when there is no text or the mapping is not exact.
   *  expected (optional): the number of indexed words, or the indexed text; a different count answers null
   *  (protects against display files built from another index). */
  async words(pidOrRef, expected) {
    const e = await this.get(pidOrRef);
    return e ? wordsOf(e, expected) : null;
  }

  // ---- internals
  _entry(s, k, x) {
    let i;
    if (typeof x === "number") i = x - this.meta.pid_base - k * this.meta.K;
    else {
      if (!s.byRef) s.byRef = new Map(s.r.map((r, j) => [r, j]));
      i = s.byRef.get(x);
    }
    if (i === undefined || !(i >= 0 && i < s.t.length)) return null;
    if (!s.inexact) s.inexact = new Set(s.x);
    return { ref: s.r[i], text: s.t[i], start: s.o[i], exact: !s.inexact.has(i) };
  }

  /** shard number of a core pid or a reference, -1 when it cannot be one of ours */
  _shardOf(x) {
    const m = this.meta;
    if (typeof x === "number") {
      const h = x - m.pid_base;
      return Number.isInteger(h) && h >= 0 && h < m.count ? Math.floor(h / m.K) : -1;
    }
    if (typeof x !== "string") return -1;
    const key = refKey(x, m.collections);
    if (!key) return -1;
    // references are stored in corpus order (collection, then number): the shard is the last one whose first
    // reference is not after x
    if (!m._firstKeys) m._firstKeys = m.first.map(r => refKey(r, m.collections));
    let lo = 0, hi = m._firstKeys.length - 1, k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, f = m._firstKeys[mid];
      if (f[0] < key[0] || (f[0] === key[0] && f[1] <= key[1])) { k = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return k;
  }

  _loadMeta() {
    if (this._meta && (this.meta || Date.now() - this._metaAt < RETRY_MS)) return this._meta;
    this._metaAt = Date.now();
    this._meta = Promise.resolve().then(() => this.fetcher(this.dir + "meta.json", "json")).then(m => {
      const ok = m && m.version === 1 && m.K > 0 && Number.isInteger(m.pid_base) && Array.isArray(m.first)
        && Array.isArray(m.collections) && m.first.length === m.shards;
      return (this.meta = ok ? m : null);
    }, () => null);
    return this._meta;
  }

  _loadShard(k) {
    let s = this._shards.get(k);
    if (s && (s.v || s.v === undefined || Date.now() - s.at < RETRY_MS)) return s.p;
    s = { v: undefined, at: Date.now() };
    s.p = Promise.resolve().then(() => this.fetcher(`${this.dir}h_${k}.json`, "json")).then(d => {
      const ok = d && d.k === k && Array.isArray(d.t) && Array.isArray(d.r) && Array.isArray(d.o) && Array.isArray(d.x)
        && d.r.length === d.t.length && d.o.length === d.t.length;
      return (s.v = ok ? d : null);
    }, () => (s.v = null));
    this._shards.set(k, s);
    return s.p;
  }
}

/** entry of get() -> the original words that correspond to the indexed words, or null (see HadithDisplay.words) */
export function wordsOf(entry, expected) {
  if (!entry || !entry.exact) return null;
  const w = entry.text.slice(entry.start).split(" ").filter(p => LETTER.test(p));
  if (expected !== undefined && expected !== null) {
    const n = typeof expected === "number" ? expected : String(expected).split(" ").length;
    if (n !== w.length) return null;
  }
  return w;
}

function refKey(ref, collections) {
  const c = ref.indexOf(":");
  if (c < 1) return null;
  const col = collections.indexOf(ref.slice(0, c)), num = Number(ref.slice(c + 1));
  return col < 0 || !Number.isFinite(num) ? null : [col, num];
}
