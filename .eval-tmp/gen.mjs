// gen.mjs — builds SYNTHETIC lecture transcripts with known ground truth, then corrupts them with
// SIMULATED speech-recognition noise. This measures the matching engine in isolation; it is NOT a
// measurement of a real ASR system (see eval/README.md).
import { readFileSync } from "node:fs";
import path from "node:path";
import { norm, fold } from "../public/js/text.js";
import { ROOT } from "./lib.mjs";

export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const ASSETS = JSON.parse(readFileSync(path.join(ROOT, ".eval-tmp", "fillers.json"), "utf8"));

const CUE_Q = ["قال الله تعالى", "وقال سبحانه وتعالى", "يقول ربنا جل وعلا", "قال الله عز وجل في كتابه الكريم", "يقول الله تعالى"];
const CUE_H = ["قال رسول الله صلى الله عليه وسلم", "وفي الحديث الصحيح عن النبي صلى الله عليه وسلم أنه قال",
  "ثبت عنه عليه الصلاة والسلام أنه قال", "يقول النبي صلى الله عليه وسلم", "وقال صلى الله عليه وسلم"];
const TRAIL_H = { bukhari: "رواه البخاري", muslim: "رواه مسلم", abudawud: "رواه أبو داود", tirmidhi: "رواه الترمذي", nasai: "رواه النسائي", ibnmajah: "رواه ابن ماجه" };
const JUNK = ["يعني", "أي", "طبعا", "هكذا", "تماما", "الأمر", "شيء", "كذلك", "أيضا", "حقا"];

/** all passages whose text contains the word sequence `frag` (array of normalised words) */
export function containing(corpus, frag, onlyQuran = null) {
  const s = " " + frag.join(" ") + " ";
  const cand = new Set();
  const F = frag.map(fold);
  for (let i = 0; i + 3 <= F.length && cand.size === 0; i++) {
    for (const p of corpus.postings(3, F.slice(i, i + 3).join(" "))) cand.add(p);
  }
  if (cand.size === 0) { // every trigram was pruned as too frequent: fall back to a scan
    for (let p = 0; p < corpus.N; p++) cand.add(p);
  }
  const out = [];
  for (const p of cand) {
    if (onlyQuran != null && corpus.isQuran(p) !== onlyQuran) continue;
    if ((" " + corpus.P[p].n + " ").includes(s)) out.push(p);
  }
  return out;
}

/** passages sharing many trigrams with `pid` — used to hold a whole "family" of parallel narrations out */
export function family(corpus, pid, minShare = 0.12) {
  const F = corpus.ftok(pid), count = new Map();
  let total = 0;
  for (let i = 0; i + 3 <= F.length; i++) {
    const ps = corpus.postings(3, F[i] + " " + F[i + 1] + " " + F[i + 2]);
    if (!ps.length) continue; total++;
    for (const p of ps) count.set(p, (count.get(p) || 0) + 1);
  }
  const out = new Set([pid]);
  for (const [p, c] of count) if (c >= Math.max(2, minShare * total)) out.add(p);
  return out;
}

/**
 * Build one synthetic lecture.
 * @returns {words:[string], items:[{kind, a, b, accept:Set<pid>|null, expect, cols?}], blocked:Set<pid>}
 */
export function buildLecture(corpus, seed, sizes = { vq: 40, vh: 60, ph: 40, par: 26, ooc: 30, cue: 14 }, parSet = "test") {
  const r = rng(seed);
  const words = [], items = [];
  const filler = k => { for (let i = 0; i < k; i++) words.push(...pick(r, ASSETS.fillers).split(" ")); };
  const blocked = new Set();
  const hadithPids = [];
  // only passages whose matn was isolated (m=1): what a speaker would actually quote, not chains of narrators
  for (let p = corpus.NQ; p < corpus.coreN; p++) { const L = corpus.tok(p).length; if (corpus.P[p].m === 1 && L >= 12 && L <= 120) hadithPids.push(p); }

  // out-of-corpus items first (their families are removed from the searchable corpus)
  const oocItems = [];
  while (oocItems.length < sizes.ooc) {
    const p = pick(r, hadithPids);
    if (blocked.has(p)) continue;
    const T = corpus.tok(p), L = Math.min(T.length, 10 + Math.floor(r() * 25)), s = Math.floor(r() * (T.length - L + 1));
    const frag = T.slice(s, s + L);
    // hold out the passage, its parallel narrations AND every passage sharing any 4-word run with the fragment,
    // so that nothing textual remains to be found: any textual citation on this item is a genuine false positive
    const out = family(corpus, p);
    for (let i = 0; i + 4 <= frag.length; i++) containing(corpus, frag.slice(i, i + 4)).forEach(x => out.add(x));
    if (out.size > 80 || [...out].some(x => corpus.isQuran(x))) continue;
    out.forEach(x => blocked.add(x));
    oocItems.push({ kind: "ooc", frag, cue: pick(r, CUE_H), accept: null, expect: "none" });
  }
  const plan = [...oocItems];

  // verbatim Qur'an (1–3 consecutive ayahs)
  for (let k = 0; k < sizes.vq; ) {
    const p = Math.floor(r() * corpus.NQ), s = +corpus.P[p].r.split(":")[0];
    const span = 1 + Math.floor(r() * 3), end = Math.min(corpus.surahEnd[s], p + span - 1);
    const frag = []; for (let q = p; q <= end; q++) frag.push(...corpus.tok(q));
    if (frag.length < 5 || frag.length > 60) continue;
    const accept = new Set(); for (let q = p; q <= end; q++) accept.add(q);
    containing(corpus, corpus.tok(p), true).forEach(x => accept.add(x));
    plan.push({ kind: "vq", frag, cue: r() < 0.8 ? pick(r, CUE_Q) : "", accept, expect: "verbatim" }); k++;
  }
  // verbatim hadith fragments and partial (edited) ones
  const mkH = (kind) => {
    for (;;) {
      const p = pick(r, hadithPids);
      if (blocked.has(p)) continue;
      const T = corpus.tok(p);
      const L = Math.min(T.length, (kind === "ph" ? 14 : 8) + Math.floor(r() * 28));
      if (kind === "ph" && L < 14) continue;
      const s = r() < 0.5 ? 0 : Math.floor(r() * (T.length - L + 1));
      const orig = T.slice(s, s + L);
      const accept = new Set(containing(corpus, orig, false));
      [...accept].forEach(x => { if (blocked.has(x)) accept.delete(x); });
      if (!accept.size) continue;
      let frag = orig, expect = "verbatim", agree = 1;
      if (kind === "ph") {
        frag = []; let same = 0, cols = 0;
        for (const w of orig) {
          const x = r();
          if (x < 0.13) { cols++; continue; }                               // word omitted
          if (x < 0.22) { frag.push(pick(r, JUNK)); cols++; continue; }     // word replaced
          frag.push(w); same++; cols++;
          if (r() < 0.06) { frag.push(pick(r, JUNK)); cols++; }             // extra word
        }
        agree = same / cols;
        expect = agree >= 0.9 ? "verbatim" : agree <= 0.84 ? "partial" : "either";
        if (frag.length < 8 || agree < 0.6) continue;
      }
      const col = corpus.P[p].r.split(":")[0];
      const trail = kind === "vh" && TRAIL_H[col] && r() < 0.35 ? TRAIL_H[col] : "";
      return { kind, frag, cue: r() < 0.85 ? pick(r, CUE_H) : "", trail, trailCol: trail ? col : null, accept, expect, agree };
    }
  };
  for (let k = 0; k < sizes.vh; k++) plan.push(mkH("vh"));
  for (let k = 0; k < sizes.ph; k++) plan.push(mkH("ph"));
  // paraphrases (texts written by the assistant; the reference is located through a key phrase)
  // paraphrases 1–24 are the development set (settings were chosen on them); 25–50 are held out for the report
  let np = 0;
  const pool = parSet === "dev" ? ASSETS.paraphrases.slice(0, 24) : ASSETS.paraphrases.slice(24);
  for (const [text, keys] of pool) {
    if (np >= sizes.par) break;
    const accept = new Set(keys.flatMap(key => containing(corpus, norm(key).split(" "), false)));
    [...accept].forEach(x => { if (blocked.has(x)) accept.delete(x); });
    if (!accept.size) continue;
    plan.push({ kind: "par", frag: norm(text).split(" "), cue: "", accept, expect: "meaning" }); np++;
  }
  for (let k = 0; k < sizes.cue; k++) plan.push({ kind: "cue", frag: norm(pick(r, ASSETS.cueOnly)).split(" "), cue: "", accept: null, expect: "none" });

  // shuffle, interleave with filler
  for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }
  filler(2);
  for (const it of plan) {
    if (it.cue) words.push(...norm(it.cue).split(" "));
    const a = words.length; words.push(...it.frag); const b = words.length;
    if (it.trail) words.push(...norm(it.trail).split(" "));
    items.push({ ...it, a, b });
    filler(1 + Math.floor(r() * 3));
  }
  return { words, items, blocked };
}

// ---------- simulated ASR noise ----------
const PHON = { "ص": "س", "س": "ص", "ذ": "ز", "ز": "ذ", "ض": "د", "ظ": "ز", "ط": "ت", "ت": "ط", "ق": "ك", "ك": "ق", "ث": "س", "ه": "ا", "ع": "ا", "ح": "ه", "د": "ض" };
const LETTERS = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي";
const INSERT = ["ان", "في", "من", "قال", "يعني", "هو", "على", "ما"];
/**
 * @param words clean words, @param wer target word error rate, @param r rng
 * @returns {words:[string], map:[index of first noisy word for each clean word], n}
 *   Roughly 70% of the substitutions are phonetic (the kind the engine's folding anticipates),
 *   30% are arbitrary letter errors it does NOT anticipate.
 */
export function asrNoise(words, wer, r) {
  const out = [], map = new Array(words.length + 1);
  for (let i = 0; i < words.length; i++) {
    map[i] = out.length;
    let w = words[i];
    if (r() >= wer) { out.push(w); continue; }
    const x = r();
    if (x < 0.42) {            // substitution
      const pos = [...w].map((c, k) => (PHON[c] ? k : -1)).filter(k => k >= 0);
      if (pos.length && r() < 0.7) { const k = pick(r, pos); w = w.slice(0, k) + PHON[w[k]] + w.slice(k + 1); }
      else { const k = Math.floor(r() * w.length); w = w.slice(0, k) + pick(r, [...LETTERS]) + w.slice(k + 1); }
      out.push(w);
    } else if (x < 0.57) {     // a letter dropped or added
      if (w.length > 3 && r() < 0.6) { const k = Math.floor(r() * w.length); w = w.slice(0, k) + w.slice(k + 1); }
      else { const k = Math.floor(r() * (w.length + 1)); w = w.slice(0, k) + pick(r, [...LETTERS]) + w.slice(k); }
      out.push(w);
    } else if (x < 0.72) {     // word deleted
    } else if (x < 0.82) {     // word inserted
      out.push(w, pick(r, INSERT));
    } else if (x < 0.90 && w.length >= 5) { // word split in two
      const k = 2 + Math.floor(r() * (w.length - 3)); out.push(w.slice(0, k), w.slice(k));
    } else if (i + 1 < words.length) {      // glued to the next word
      map[i + 1] = out.length; out.push(w + words[i + 1]); i++;
    } else out.push(w);
  }
  map[words.length] = out.length;
  for (let i = words.length - 1; i >= 0; i--) if (map[i] == null) map[i] = map[i + 1];
  return { words: out, map };
}
