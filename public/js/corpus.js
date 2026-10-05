// corpus.js — loads the static corpus (core: Qur'an + nine hadith collections) and optional BOOK PACKS
// (tafsir, fiqh, seerah, aqeedah, more hadith), each with its own shingle indexes. Passage ids are global:
// the core comes first, packs are appended in the order they are loaded.
// Works in the browser (fetch) and in Node (fs) through an injected `fetcher(name, kind)`.
import { fold, fnv1a, stem, normEn, noteMaqsura, norm } from "./text.js";
import { Vectors } from "./vectors.js";

export const SURAHS = ["الفاتحة","البقرة","آل عمران","النساء","المائدة","الأنعام","الأعراف","الأنفال","التوبة","يونس","هود","يوسف","الرعد","إبراهيم","الحجر","النحل","الإسراء","الكهف","مريم","طه","الأنبياء","الحج","المؤمنون","النور","الفرقان","الشعراء","النمل","القصص","العنكبوت","الروم","لقمان","السجدة","الأحزاب","سبأ","فاطر","يس","الصافات","ص","الزمر","غافر","فصلت","الشورى","الزخرف","الدخان","الجاثية","الأحقاف","محمد","الفتح","الحجرات","ق","الذاريات","الطور","النجم","القمر","الرحمن","الواقعة","الحديد","المجادلة","الحشر","الممتحنة","الصف","الجمعة","المنافقون","التغابن","الطلاق","التحريم","الملك","القلم","الحاقة","المعارج","نوح","الجن","المزمل","المدثر","القيامة","الإنسان","المرسلات","النبأ","النازعات","عبس","التكوير","الانفطار","المطففين","الانشقاق","البروج","الطارق","الأعلى","الغاشية","الفجر","البلد","الشمس","الليل","الضحى","الشرح","التين","العلق","القدر","البينة","الزلزلة","العاديات","القارعة","التكاثر","العصر","الهمزة","الفيل","قريش","الماعون","الكوثر","الكافرون","النصر","المسد","الإخلاص","الفلق","الناس"];

export const COLLECTIONS = {
  bukhari: { ar: "صحيح البخاري", slug: "bukhari", rank: 1 },
  muslim: { ar: "صحيح مسلم", slug: "muslim", rank: 2 },
  abudawud: { ar: "سنن أبي داود", slug: "abudawud", rank: 3 },
  tirmidhi: { ar: "جامع الترمذي", slug: "tirmidhi", rank: 4 },
  nasai: { ar: "سنن النسائي", slug: "nasai", rank: 5 },
  ibnmajah: { ar: "سنن ابن ماجه", slug: "ibnmajah", rank: 6 },
  malik: { ar: "موطأ مالك", slug: "malik", rank: 7 },
  nawawi: { ar: "الأربعون النووية", slug: "nawawi40", rank: 8 },
  qudsi: { ar: "الأحاديث القدسية", slug: "qudsi40", rank: 9 },
};

const arNum = n => Number(n).toLocaleString("ar-EG", { useGrouping: false });

// The shingle indexes and the dense index address a passage inside its pack with 16 bits.
export const MAX_PACK_PASSAGES = 65536;
function checkPackSize(id, n) {
  if (n > MAX_PACK_PASSAGES) throw new Error(`pack "${id}" has ${n} passages, but the index format (16-bit postings) supports at most ${MAX_PACK_PASSAGES} per pack — split the pack`);
}
// collections whose sunnah.com address "<slug>:<printed number>" is valid without a letter suffix
const NUMBER_LINK = new Set(["bukhari", "ibnmajah", "abudawud", "tirmidhi", "nasai"]);
/** "2609.01" -> "2609a" (the way sunnah.com writes the sub-numbers of Sahih Muslim); "55" stays "55" */
function muslimNumber(printed) {
  const m = /^(\d+)\.0*(\d+)$/.exec(String(printed));
  if (!m) return String(printed);
  const k = +m[2];
  return k >= 1 && k <= 26 ? m[1] + String.fromCharCode(96 + k) : String(printed);
}

function parseIndex(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "ATH1") throw new Error("bad index file");
  const nk = dv.getUint32(4, true), np = dv.getUint32(8, true);
  const keys = new Uint32Array(buf.slice(12, 12 + 4 * nk));
  const cnt = new Uint8Array(buf.slice(12 + 4 * nk, 12 + 5 * nk));
  const post = new Uint16Array(buf.slice(12 + 5 * nk, 12 + 5 * nk + 2 * np));
  const offs = new Uint32Array(nk + 1);
  for (let i = 0; i < nk; i++) offs[i + 1] = offs[i] + cnt[i];
  return { keys, offs, post };
}
function find(ix, h) {
  const { keys, offs } = ix;
  let lo = 0, hi = keys.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1, k = keys[mid];
    if (k === h) return [offs[mid], offs[mid + 1]];
    if (k < h) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}

export class Corpus {
  /** fetcher(name, "json"|"buffer") -> Promise.  Loads the core only; packs are added with loadPack(). */
  static async load(fetcher, onProgress = () => {}) {
    const c = new Corpus();
    c.fetcher = fetcher;
    c.meta = await fetcher("meta.json", "json");
    const total = c.meta.shards + 3; let done = 0;
    const tick = () => onProgress(++done / total);
    const shardP = [];
    for (let i = 0; i < c.meta.shards; i++) shardP.push(fetcher(`passages_${i}.json`, "json").then(x => (tick(), x)));
    const [i2, i3, qd, ...shards] = await Promise.all([
      fetcher("idx2.bin", "buffer").then(x => (tick(), x)),
      fetcher("idx3.bin", "buffer").then(x => (tick(), x)),
      fetcher("quran_display.json", "json").then(x => (tick(), x)),
      ...shardP]);
    c.quranDisplay = qd;
    // words that end in alif maqsura: a transcript may spell them with a plain alif (قلى / قلا)
    for (const v of (Array.isArray(qd) ? qd : Object.values(qd))) noteMaqsura(typeof v === "string" ? v : (v && (v.t || v.text || v.d)) || "");
    c.P = shards.flat();
    checkPackSize("core", c.P.length);
    c.N = c.P.length; c.coreN = c.N;
    c.NQ = c.meta.quran_passages;
    c.packs = [{ id: "core", base: 0, n: c.N, idx: { 2: parseIndex(i2), 3: parseIndex(i3) }, meta: { domain: "core", books: {} } }];
    c.books = {};                 // book key -> {title, author, domain, domain_ar, pack}
    c.tafsirPid = new Map();      // "s:a" -> pid of the Jalalayn passage
    c.enRef = new Map();          // core reference ("2:255", "bukhari:1") -> pid of its English translation
    c.enEditions = {};            // Qur'an translation id -> shown name
    c.coreRef = new Map(c.P.map((p, i) => [p.r, i]));   // core reference -> core pid
    c._qRange = new Map();
    c._tok = []; c._ftok = [];
    c.df = new Map(); c.wordPost = new Map(); c._wordUpTo = 0;
    c._vocab = new Set(); c._vocabUpTo = 0;      // normalised (not folded) word forms, built on first use
    c.dead = new Uint8Array(c.N);                // passages that never take part in matching (see loadPack)
    c._auditLinks();
    try { c.grades = await fetcher("grades.json", "json"); } catch { c.grades = null; }
    try { c.available = await fetcher("packs.json", "json"); } catch { c.available = []; }
    c._buildWordIndex();
    c._surahBounds();
    // dense index (optional: everything still works, by words only, if these files are missing)
    try { c.vec = await Vectors.load(fetcher); await c.vec.addPack("core", 0); } catch { c.vec = null; }
    onProgress(1);
    return c;
  }

  hasPack(id) { return this.packs.some(p => p.id === id); }

  /** Load one book pack (idempotent). */
  async loadPack(id, onProgress = () => {}) {
    if (this.hasPack(id)) return;
    const f = (name, kind) => this.fetcher(`packs/${id}/${name}`, kind);
    const meta = await f("meta.json", "json");
    const total = meta.shards + 2; let done = 0; const tick = () => onProgress(++done / total);
    const [i2, i3, ...shards] = await Promise.all([
      f("idx2.bin", "buffer").then(x => (tick(), x)), f("idx3.bin", "buffer").then(x => (tick(), x)),
      ...Array.from({ length: meta.shards }, (_, i) => f(`passages_${i}.json`, "json").then(x => (tick(), x)))]);
    const base = this.N, P = shards.flat();
    checkPackSize(id, P.length);
    const dead = [];
    if (meta.lang === "en") {
      // English packs carry the original text ("d"); the matching form is derived here exactly as the builder did
      const firstEd = meta.editions ? Object.keys(meta.editions)[0] : null;
      if (meta.editions) Object.assign(this.enEditions, meta.editions);
      for (let i = 0; i < P.length; i++) {
        const p = P[i]; p.n = normEn(p.d);
        if (p.r.startsWith("enq:")) { const [, ed, s, a] = p.r.split(":"); if (ed === firstEd) this.enRef.set(`${s}:${a}`, base + i); }
        // The upstream dataset pairs some English Muwatta entries with a DIFFERENT Arabic hadith under the same number,
        // so an English Muwatta text must never resolve to (or be shown as the translation of) an Arabic hadith.
        else if (p.r.startsWith("en:malik:")) dead.push(base + i);
        else this.enRef.set(p.r.slice(3), base + i);
      }
    }
    for (const p of P) this.P.push(p);
    this.N = this.P.length;
    { const d = new Uint8Array(this.N); d.set(this.dead); for (const pid of dead) d[pid] = 1; this.dead = d; }
    this.packs.push({ id, base, n: P.length, idx: { 2: parseIndex(i2), 3: parseIndex(i3) }, meta });
    for (const [k, b] of Object.entries(meta.books)) this.books[k] = { ...b, domain: meta.domain, domain_ar: meta.domain_ar, pack: id };
    for (let i = 0; i < P.length; i++) if (P[i].r.startsWith("jalalayn:")) this.tafsirPid.set(P[i].r.slice(9), base + i);
    this._buildWordIndex();
    this.stemPost = null;         // rebuilt on next use
    this._rank = null;
    if (this.vec) { try { await this.vec.addPack(id, base); } catch { /* pack without vectors: lexical candidates only */ } }
  }

  /**
   * All passages containing the folded shingle of n words, across the core and every loaded pack.
   * @returns null | {df, parts:[{post, a, b, base}]}
   */
  lookup(n, shingle) {
    const h = fnv1a(shingle);
    let df = 0, parts = null;
    for (const pk of this.packs) {
      const r = find(pk.idx[n], h);
      if (!r) continue;
      df += r[1] - r[0];
      (parts || (parts = [])).push({ post: pk.idx[n].post, a: r[0], b: r[1], base: pk.base });
    }
    return parts ? { df, parts } : null;
  }
  /** true when at least one BOOK pack (tafsir, fiqh ...) is loaded — translations are not books */
  hasBooks() { return this.packs.some(p => p.id !== "core" && p.meta.lang !== "en" && !p.meta.weak); }
  /** true when the weak / fabricated hadith books are loaded */
  hasWeak() { return this.packs.some(p => p.meta.weak); }
  /** true when an English pack (translations) is loaded */
  hasEnglish() { return this.packs.some(p => p.meta.lang === "en"); }
  /** permanently excluded from matching and from "by meaning" retrieval */
  isDead(pid) { return this.dead[pid] === 1; }

  /**
   * Is this normalised (NOT folded) form a word of the corpus? Used by the real-word rule: a spoken form that is
   * itself a word is a wording difference, not a transcription artefact. Built once, extended when packs load.
   */
  isWord(w) {
    if (this._vocabUpTo < this.N) {
      const v = this._vocab;
      for (let pid = this._vocabUpTo; pid < this.N; pid++) for (const x of this.P[pid].n.split(" ")) v.add(x);
      this._vocabUpTo = this.N;
    }
    return this._vocab.has(w);
  }

  /** An ordering of passages that does not depend on the order in which packs were loaded (core first, packs by id). */
  stableRank(pid) {
    if (pid < this.coreN) return pid;
    if (!this._rank) {
      let off = this.coreN; this._rank = [];
      for (const pk of this.packs.slice(1).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) { this._rank.push({ base: pk.base, end: pk.base + pk.n, off }); off += pk.n; }
    }
    for (const r of this._rank) if (pid >= r.base && pid < r.end) return r.off + (pid - r.base);
    return pid;
  }

  /**
   * sunnah.com addresses a hadith by book / number-in-book. In the dataset some (book, number) pairs are used twice and
   * some in-book counters restart or run backwards, so a deep link built from them would open a DIFFERENT hadith.
   * Those passages are remembered here and get a link to the book page instead.
   */
  _auditLinks() {
    const noDeep = this._noDeep = new Uint8Array(this.coreN);
    const rows = [];
    for (let pid = this.NQ; pid < this.coreN; pid++) {
      const p = this.P[pid]; if (p.t !== "h" || !p.x) continue;
      const k = p.r.indexOf(":"), col = p.r.slice(0, k);
      if (col === "nawawi" || col === "qudsi") continue;
      if (p.x[0] > 0 && p.x[1] > 0) rows.push([col, +p.r.slice(k + 1) || 0, pid]);
    }
    rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || a[2] - b[2]));   // dataset order inside each collection
    const first = new Map(), max = new Map(), restarted = new Set();
    for (const [col, , pid] of rows) {
      const [book, inBook] = this.P[pid].x, bk = col + "/" + book, key = bk + "/" + inBook;
      const f = first.get(key);
      if (f != null) { noDeep[f] = 1; noDeep[pid] = 1; } else first.set(key, pid);       // the same address twice
      const mx = max.get(bk);
      if (mx != null && inBook === 1) restarted.add(bk);          // the counter restarts: every later number is shifted
      if (restarted.has(bk) || (mx != null && inBook <= mx)) noDeep[pid] = 1;            // ... or steps backwards
      max.set(bk, Math.max(mx || 0, inBook));
    }
  }

  /** label, number and link of a hadith; `pid` is null for a translation whose Arabic text is not in the corpus */
  _hadith(col, num, x, pid) {
    const c = COLLECTIONS[col];
    // x = [book, hadith-in-book, printed number]; "num" (the dataset's running number) stays the stable id (ref)
    const [book, inBook, printed] = x || [0, 0, null];
    const root = `https://sunnah.com/${c.slug}`;
    const out = { type: "h", collection: col, rank: c.rank, numbering: "printed" };
    if (col === "nawawi" || col === "qudsi") {
      const shown = String(inBook || num);
      return { ...out, number: shown, label: `${c.ar} — رقم ${shown}`, short: `${c.ar} ${shown}`, url: `${root}:${shown}`, linkLevel: "hadith" };
    }
    // no printed number in the dataset: the builder stored the running number in its place (always with book 0)
    const missing = printed == null || printed === "" || (!(book > 0) && String(printed) === String(num) && col === "muslim");
    let shown = missing ? null : col === "muslim" ? muslimNumber(printed) : String(printed).replace(/\.0*\d+$/, "");
    let url = root, linkLevel = "collection";
    if (book > 0 && inBook > 0 && !(pid != null && this._noDeep[pid])) { url = `${root}/${book}/${inBook}`; linkLevel = "hadith"; }
    else if (book > 0) { url = `${root}/${book}`; linkLevel = "book"; }
    else if (!missing && NUMBER_LINK.has(col) && /^\d+$/.test(String(printed))) { url = `${root}:${printed}`; linkLevel = "hadith"; }
    if (col === "malik") {
      // the Muwatta numbers are the dataset's own count; sunnah.com's Arabic reference numbers differ
      shown = String(printed ?? num);
      return { ...out, number: shown, numbering: "dataset", label: `${c.ar} — رقم ${shown} (ترقيم قاعدة البيانات)`, short: `${c.ar} ${shown}`, url, linkLevel };
    }
    if (shown == null) {
      if (col === "muslim") return { ...out, number: null, numberMissing: true, numbering: "none", label: `${c.ar} — بلا رقم في قاعدة البيانات`, short: `${c.ar} (بلا رقم)`, url, linkLevel };
      shown = String(num);
    }
    return { ...out, number: shown, label: `${c.ar} — رقم ${shown}`, short: `${c.ar} ${shown}`, url, linkLevel };
  }

  /** convenience: global passage ids for a shingle */
  postings(n, shingle) {
    const r = this.lookup(n, shingle); if (!r) return [];
    const out = [];
    for (const p of r.parts) for (let k = p.a; k < p.b; k++) out.push(p.base + p.post[k]);
    return out;
  }

  tok(pid) { return this._tok[pid] ?? (this._tok[pid] = this.P[pid].n.split(" ")); }
  /**
   * Number of leading words of a hadith passage that are (probably) its chain of narrators. The builder removes the
   * chain (flag m = 1); where it could not decide it keeps the full text (m = 0) and records the probable length in `s`.
   * These words are never quoted text: the engine takes no evidence from them.
   */
  chainLen(pid) { const p = this.P[pid]; return p.t === "h" && p.m !== 1 && p.s > 0 ? p.s : 0; }
  ftok(pid) { return this._ftok[pid] ?? (this._ftok[pid] = this.tok(pid).map(fold)); }

  _buildWordIndex() {
    // document frequency for every folded word; postings only for words rare enough to be informative.
    // Incremental: only passages added since the last call are scanned.
    const MAXP = 400, df = this.df, post = this.wordPost;
    for (let pid = this._wordUpTo; pid < this.N; pid++) {
      const seen = new Set(fold(this.P[pid].n).split(" "));   // not cached: only passages that are actually compared keep token arrays
      for (const w of seen) {
        const d = (df.get(w) || 0) + 1; df.set(w, d);
        if (d <= MAXP) { let a = post.get(w); if (!a) post.set(w, a = []); a.push(pid); }
        else if (d === MAXP + 1) post.delete(w);
      }
    }
    this._wordUpTo = this.N; this._lnN = Math.log(this.N);
  }
  /** inverse document frequency of a folded word (unknown words are treated as rare) */
  idf(fw) { const d = this.df.get(fw); return d ? this._lnN - Math.log(d) : this._lnN; }

  /** stem -> passages, built on first use (only needed for "by meaning" candidates) */
  ensureStems() {
    if (this.stemPost) return;
    // A stem found in too many passages says nothing and is not indexed. The limit is a SHARE of the library (5%), not a
    // number of passages: a fixed number silently dropped ordinary words ("ساعة") as soon as a book pack was loaded, so the
    // candidates by meaning got worse the more books the reader added. (5% was compared with 3.5% and 8% on the development
    // lecture: 8% lets filler speech share enough words with a passage to look like a quotation.)
    const MAXP = Math.max(1500, Math.round(this.N * 0.05)), df = new Map(), post = new Map(), vdf = new Map();
    for (let pid = 0; pid < this.N; pid++) {
      const chain = this.chainLen(pid);            // narrators' names are not what a hadith is about
      const words = chain ? this.P[pid].n.split(" ").slice(chain) : this.P[pid].n.split(" ");
      const vs = new Set(); for (const w of words) vs.add(stem(w));          // unfolded stems: the dense model's vocabulary
      for (const w of vs) vdf.set(w, (vdf.get(w) || 0) + 1);
      const seen = new Set(); for (const w of words) if (w.length >= 3) seen.add(stem(fold(w)));
      for (const w of seen) {
        const d = (df.get(w) || 0) + 1; df.set(w, d);
        if (d <= MAXP) { let a = post.get(w); if (!a) post.set(w, a = []); a.push(pid); }
        else if (d === MAXP + 1) post.delete(w);
      }
    }
    this.stemDf = df; this.stemPost = post; this.vstemDf = vdf;
    // "rare" stems (3.5% of the library, 1,500 passages for the core alone): only these can make a match BY MEANING; the
    // wider index above only orders suggestions
    this.stemRareMax = Math.max(1500, Math.round(this.N * 0.035));
  }
  vstemIdf(st) { const d = this.vstemDf.get(st); return d ? this._lnN - Math.log(d) : this._lnN; }
  stemIdf(st) { const d = this.stemDf.get(st); return d ? this._lnN - Math.log(d) : this._lnN; }

  /** grades recorded in the source dataset for a hadith reference, e.g. [{by:"الألباني", grade:"صحيح"}] */
  gradesOf(ref) {
    const g = this.grades; if (!g) return null;
    const v = g.map[ref]; if (!v) return null;
    const out = []; for (let i = 0; i < v.length; i += 2) out.push({ by: g.scholars[v[i]], grade: g.grades[v[i + 1]] });
    return out;
  }

  _surahBounds() {
    this.surahStart = new Array(115).fill(-1); this.surahEnd = new Array(115).fill(-1);
    for (let pid = 0; pid < this.NQ; pid++) {
      const s = +this.P[pid].r.split(":")[0];
      if (this.surahStart[s] < 0) this.surahStart[s] = pid;
      this.surahEnd[s] = pid;
    }
  }

  isQuran(pid) { return pid < this.NQ; }
  isEnglish(pid) { return this.P[pid].t === "e"; }
  /** Qur'an text in Arabic or in an English translation */
  quranLike(pid) { return pid < this.NQ || this.P[pid].r.startsWith("enq:"); }
  isBook(pid) { return this.P[pid].t === "b"; }
  /** a passage of a book about weak / fabricated hadith (pack "daif"): searched for every hadith, reported on its own */
  isWeak(pid) { if (pid < this.coreN) return false; for (const pk of this.packs) if (pk.meta.weak && pid >= pk.base && pid < pk.base + pk.n) return true; return false; }
  /** 0 = Qur'an, 1 = hadith collections, 2 = books, 3 = books of weak / fabricated hadith: the order in which equal matches are preferred */
  tier(pid) { return this.quranLike(pid) ? 0 : this.isBook(pid) ? (this.isWeak(pid) ? 3 : 2) : 1; }
  /** ids of the first and last ayah of the surah (and translation) that `pid` belongs to */
  quranRange(pid) {
    if (pid < this.NQ) { const s = +this.P[pid].r.split(":")[0]; return [this.surahStart[s], this.surahEnd[s]]; }
    const pre = this.P[pid].r.slice(0, this.P[pid].r.lastIndexOf(":") + 1);
    let r = this._qRange.get(pre);
    if (!r) {
      let lo = pid, hi = pid;
      while (lo > 0 && this.P[lo - 1].r.startsWith(pre)) lo--;
      while (hi + 1 < this.N && this.P[hi + 1].r.startsWith(pre)) hi++;
      this._qRange.set(pre, r = [lo, hi]);
    }
    return r;
  }
  /**
   * The Arabic Qur'an as ONE stream of normalised words (not folded), with an index of every run of three words that
   * lies inside one surah. Built on first use. Used by the engine to find short EXACT fragments of an ayah.
   * -> {tok:[word], pid:Int32Array (ayah of each word), start:Int32Array (first word of each ayah; start[NQ] = length),
   *     grams: Map("w1 w2 w3" -> [position, ...])}
   */
  quranStream() {
    if (this._qStream) return this._qStream;
    const tok = [], pidOf = [], start = new Int32Array(this.NQ + 1);
    for (let pid = 0; pid < this.NQ; pid++) { start[pid] = tok.length; for (const w of this.tok(pid)) { tok.push(w); pidOf.push(pid); } }
    start[this.NQ] = tok.length;
    const pid = Int32Array.from(pidOf), grams = new Map();
    for (let s = 1; s <= 114; s++) {
      if (this.surahStart[s] < 0) continue;
      const a = start[this.surahStart[s]], b = start[this.surahEnd[s] + 1];
      for (let g = a; g + 3 <= b; g++) {
        const key = tok[g] + " " + tok[g + 1] + " " + tok[g + 2];
        const arr = grams.get(key); if (arr) arr.push(g); else grams.set(key, [g]);
      }
    }
    return (this._qStream = { tok, pid, start, grams });
  }
  /** published English translation of a core reference, if the English packs are loaded */
  translationOf(ref) {
    const key = ref.includes("-") ? ref.slice(0, ref.indexOf("-")) : ref;     // an ayah range -> its first ayah onwards
    const pid = this.enRef.get(key); if (pid == null) return null;
    const p = this.P[pid];
    if (p.r.startsWith("enq:")) {
      const ed = p.r.split(":")[1], last = ref.includes("-") ? +ref.split("-")[1] : +key.split(":")[1], first = +key.split(":")[1];
      const parts = []; for (let k = 0; k <= Math.min(last - first, 9); k++) parts.push(this.P[pid + k].d);
      return { text: parts.join(" "), edition: this.enEditions[ed] || ed };
    }
    return { text: p.d, edition: "sunnah.com" };
  }

  /** Jalalayn's commentary on an ayah, if the tafsir pack is loaded */
  tafsirOf(surah, ayah) { const pid = this.tafsirPid.get(`${surah}:${ayah}`); return pid == null ? null : this.P[pid].n; }

  /**
   * Where in a passage of a weak-hadith book its own verdict words ("g") stand: {at, end, open} in the passage's words, or
   * null when they are not in THIS passage. (The build step also copied a verdict from the passage that FOLLOWS when a
   * passage had none of its own — and such books list one hadith after another, so that verdict is usually about the
   * next hadith. Found on 5 Oct 2026: a hadith of Sahih Muslim shown with another hadith's "باطل… كذب". A verdict that
   * is not in the passage is therefore never shown.)  open = the excerpt itself opens a new entry "(…" before its end.
   */
  verdictAt(pid) {
    const p = this.P[pid]; if (!p || !p.g) return null;
    if (p._g !== undefined) return p._g;
    const g = norm(p.g).split(" ").filter(Boolean), tk = this.tok(pid); let at = -1;
    const k = Math.min(g.length, 5);
    if (k >= 3) outer: for (let i = 0; i + k <= tk.length; i++) { for (let j = 0; j < k; j++) if (tk[i + j] !== g[j]) continue outer; at = i; break; }
    return (p._g = at < 0 ? null : { at, end: Math.min(tk.length, at + g.length) });
  }
  /**
   * The book's verdict words for a text matched at words [ps, pe) of the passage — only when they can be ABOUT that text:
   * they begin after the text begins, and not more than `reach` words after it ends, with no new entry opened in between
   * (an entry of such a book opens with "(" before its hadith). Otherwise "".
   */
  bookWordsFor(pid, ps, pe, reach = 30) {
    const p = this.P[pid], v = this.verdictAt(pid); if (!v) return "";
    if (v.end <= ps || v.at > pe + reach) return "";
    // the printed excerpt: a "(" after the matched text and before the verdict's own words opens another hadith
    const raw = String(p.g), cut = raw.indexOf("("), close = raw.indexOf(")");
    if (cut >= 0 && v.at >= pe) { const before = norm(raw.slice(0, cut)).split(" ").filter(Boolean).length; if (v.at + before >= pe && before < 7) return ""; }
    if (close >= 0 && (cut < 0 || close < cut) && v.at >= pe) { /* the excerpt begins inside an entry's heading and closes it: the verdict follows that heading, not ours */ const head = norm(raw.slice(0, close)).split(" ").filter(Boolean).length; if (v.at + head > pe) return ""; }
    return raw;
  }

  /** Human label + deep link for a passage (or an ayah range pidA..pidB). */
  describe(pid, pidEnd = pid) {
    const p = this.P[pid];
    if (p.t === "e") {
      // a translation: report the ARABIC source it translates, and remember which translation matched
      if (p.r.startsWith("enq:")) {
        const [, ed, s, a] = p.r.split(":"), b = this.P[pidEnd].r.split(":")[3];
        const A = this.coreRef.get(`${s}:${a}`), B = this.coreRef.get(`${s}:${b}`);
        return { ...this.describe(A, B), via: "en", edition: this.enEditions[ed] || ed };
      }
      const ref = p.r.slice(3), core = this.coreRef.get(ref);
      if (core != null) return { ...this.describe(core), via: "en", edition: "sunnah.com" };
      const [col, num] = ref.split(":");   // the Arabic text of this one is not in the corpus (too short to index, or mis-paired upstream)
      return { ...this._hadith(col, num, p.x || [0, 0, col === "muslim" ? num : null], null), ref, via: "en", edition: "sunnah.com" };
    }
    if (p.t === "q") {
      const [s, a] = p.r.split(":").map(Number);
      const b = +this.P[pidEnd].r.split(":")[1];
      return {
        type: "q", collection: "quran", surah: s, ayah: a, ayahEnd: b,
        label: `سورة ${SURAHS[s - 1]} — ${a === b ? "الآية " + a : "الآيات " + a + "–" + b}`,
        short: `${SURAHS[s - 1]} ${a === b ? a : a + "–" + b}`,
        url: a === b ? `https://quran.com/${s}:${a}` : `https://quran.com/${s}/${a}-${b}`, linkLevel: "ayah",
        ref: a === b ? `${s}:${a}` : `${s}:${a}-${b}`,
      };
    }
    if (p.t === "b") {
      const key = p.r.split(":")[0], bk = this.books[key] || { title: key, author: "", domain: "book", domain_ar: "كتاب" };
      if (key === "jalalayn") {
        const [, s, a] = p.r.split(":").map(Number);
        return { type: "b", domain: bk.domain, domainAr: bk.domain_ar, collection: key, book: bk.title, author: bk.author,
          label: `${bk.title} — سورة ${SURAHS[s - 1]}، الآية ${arNum(a)}`, short: `الجلالين ${SURAHS[s - 1]} ${a}`, url: `https://quran.com/${s}:${a}`, ref: p.r };
      }
      const where = p.p ? ` — ${p.v ? "ج" + arNum(p.v) + " " : ""}ص${arNum(p.p)}` : "";
      return { type: "b", domain: bk.domain, domainAr: bk.domain_ar, collection: key, book: bk.title, author: bk.author, heading: p.h || "",
        ...(bk.domain === "hadith-weak" ? { weak: true, weakKind: bk.kind === "mushtahir" ? "mushtahir" : "mawdu", bookWords: this.verdictAt(pid) ? p.g : "" } : {}),
        label: `${bk.title}، ${bk.author}${where}`, short: `${bk.title}${where}`, url: null, ref: p.r };
    }
    const [col, num] = p.r.split(":");
    return { ...this._hadith(col, num, p.x, pid), ref: p.r, matnOnly: p.m === 1, grades: this.gradesOf(p.r) };
  }
}

/** Browser fetcher */
export function httpFetcher(base) {
  return async (name, kind) => {
    const r = await fetch(base + name);
    if (!r.ok) throw new Error(`تعذّر تحميل ${name} (${r.status})`);
    return kind === "json" ? r.json() : r.arrayBuffer();
  };
}
