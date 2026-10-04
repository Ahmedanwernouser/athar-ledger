// run.mjs — evaluation of the engine against baselines on SYNTHETIC lectures with SIMULATED transcription noise.
//   node eval/run.mjs            full run -> eval/results.json, eval/RESULTS.md, eval/summary.json, eval/timings.json
//   node eval/run.mjs --quick    development lecture (seed 101), engine only, printed to the terminal; writes nothing
//   node eval/run.mjs --jobs=1   number of worker processes (default: 2, or the number of CPUs if smaller)
// (node eval/all.mjs runs this, then books.mjs and english.mjs.)
// The work is split into independent jobs that run in worker processes; rows are assembled in a fixed order, so two
// runs give byte-identical results.json / RESULTS.md / summary.json. Only eval/timings.json differs.
import { writeFileSync, readFileSync } from "node:fs";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { loadCorpus, loadSem, EVAL, writeTiming, writeJson } from "./lib.mjs";
import { buildLecture, asrNoise, asrNoiseP, delNoise, whisperNoise, rng, family, PAR_FAMILY, CUE_H } from "./gen.mjs";
import { analyze } from "../public/js/engine.js";
import { tokenizeTranscript, fold, norm, editDistance, wordSim } from "../public/js/text.js";
import { findCues } from "../public/js/cues.js";

const ARGS = process.argv.slice(2);
const QUICK = ARGS.includes("--quick"), WORKER = ARGS.includes("--worker"), DEV = ARGS.includes("--dev");
// seed 101 is the DEVELOPMENT lecture (thresholds were tuned on it). The reported run uses three other lectures, and
// three more ("fresh") that were generated only after everything was fixed.
const SEEDS = [202, 303, 404], FRESH = [505, 606, 707];
let corpus = null, sem = null;
/** the texts whose sentence vectors a run asked for: kept as eval/embed/requests/<name>.json, so the test machine can embed them */
function writeSemRequests(name, used, missed) {
  if (!used.length) return;
  const f = path.join(EVAL, "embed", "requests", name + ".json"), body = JSON.stringify({ kind: "q", texts: [...new Set(used)].sort() }) + "\n";
  let old = ""; try { old = readFileSync(f, "utf8"); } catch { /* first time */ }
  if (old !== body) writeFileSync(f, body);
  if (missed) console.error(`\n*** sentence vectors: ${missed} of ${new Set(used).size} stretches of speech have no vector in eval/embed/cache/${name}.bin — the "sem" rows fall back to the engine's own order for them. Push eval/embed/requests/${name}.json (GitHub Actions embeds it), then: node eval/embed/pull.mjs\n`);
}

// ---------------- noise conditions ----------------
// "rate" is the probability that a word is hit in the SIMULATION. It is not the word error rate of any recogniser.
const ident = w => ({ words: w, map: w.map((_, i) => i).concat(w.length) });
export const NOISE = { clean: { rate: 0, kind: "std", fn: w => ident(w) } };
for (const k of [1, 2, 3]) {
  const rate = k / 10, id = k * 10;
  NOISE["std" + id] = { rate, kind: "std", fn: (w, s) => asrNoise(w, rate, rng(s * 7 + id)) };                               // noise A (the project's model)
  NOISE["rand" + id] = { rate, kind: "rand", fn: (w, s) => asrNoiseP(w, rate, rng(s * 7 + id), { phonShare: 0 }) };          // random letters only
  NOISE["del" + id] = { rate, kind: "del", fn: (w, s) => delNoise(w, rate, rng(s * 11 + k)) };                               // word deletion only
  NOISE["lex" + id] = { rate, kind: "lex", fn: (w, s) => whisperNoise(w, rate, rng(s * 13 + k), { only: "lex" }) };          // real-word substitution only
  NOISE["whnorep" + id] = { rate, kind: "whnorep", fn: (w, s) => whisperNoise(w, rate, rng(s * 13 + k), { rep: false }) };   // "Whisper-shaped", no repeated phrases
  NOISE["wh" + id] = { rate, kind: "wh", fn: (w, s) => whisperNoise(w, rate, rng(s * 13 + k)) };                             // "Whisper-shaped", with repeated phrases
}
NOISE.two30 = { rate: 0.3, kind: "two", fn: (w, s) => asrNoiseP(w, 0.3, rng(s * 7 + 30), { phonShare: 0, edits: 2 }) };      // two edits per word
const SHAPES = ["rand", "del", "lex", "whnorep", "wh"];

// ---------------- systems: each returns [{ts,te,status,best:[pid],all:[pid],cand:[pid]}] ----------------
let refToPid = null;
function pidsOfSource(s) {
  if (!s) return [];
  if (s.type === "q") { const out = []; for (let a = s.ayah; a <= s.ayahEnd; a++) out.push(refToPid.get(`q${s.surah}:${a}`)); return out; }
  return [refToPid.get(s.ref)];
}
function sysEngine(opts) {
  return (words, blocked) => analyze(words.map(w => ({ w })), corpus, { ...opts, blocked }).ledger.map(e => ({
    ts: e.ts, te: e.te, status: e.status,
    best: pidsOfSource(e.status === "meaning" ? null : e.source),
    all: [e.source, ...(e.parallels || [])].flatMap(s => e.status === "meaning" ? [] : pidsOfSource(s)),
    cand: (e.candidates || e.suggestions || []).map(c => pidsOfSource(c)[0]),
    attribution: e.attribution, ref: e.source ? e.source.ref : null, spoken: e.spoken,
  }));
}
/** B0 — naive: a run of ≥6 words that occurs letter-for-letter in a passage; the first passage found wins. */
function sysExact(words, blocked) {
  const { tok, ftok } = tokenizeTranscript(words.map(w => ({ w })));
  const out = []; let i = 0;
  while (i + 6 <= tok.length) {
    const r = corpus.postings(3, ftok[i] + " " + ftok[i + 1] + " " + ftok[i + 2]);
    let hit = null;
    if (r.length) {
      const s6 = " " + tok.slice(i, i + 6).join(" ") + " ";
      for (const p of r) {
        if (hit) break;
        if (blocked.has(p)) continue;
        const txt = " " + corpus.P[p].n + " ";
        if (txt.includes(s6)) { let L = 6; while (i + L < tok.length && txt.includes(" " + tok.slice(i, i + L + 1).join(" ") + " ")) L++; hit = { p, L }; }
      }
    }
    if (hit) { out.push({ ts: i, te: i + hit.L, status: "verbatim", best: [hit.p], all: [hit.p], cand: [] }); i += hit.L; } else i++;
  }
  return out;
}
/** B1 — naive: bag-of-words TF-IDF retrieval over a sliding 20-word window, one untuned cosine cut (0.5). */
let norms = null;
function sysTfidf(words, blocked) {
  if (!norms) { norms = new Float32Array(corpus.N); for (let p = 0; p < corpus.N; p++) { let s = 0; for (const w of new Set(corpus.ftok(p))) s += corpus.idf(w) ** 2; norms[p] = Math.sqrt(s); } }
  const { ftok } = tokenizeTranscript(words.map(w => ({ w })));
  const out = [], WIN = 20, STEP = 10;
  for (let i = 0; i + WIN <= ftok.length; i += STEP) {
    const ws = [...new Set(ftok.slice(i, i + WIN))]; let qn = 0; const sc = new Map();
    for (const w of ws) { const v = corpus.idf(w); qn += v * v; const post = corpus.wordPost.get(w); if (!post) continue;
      for (const p of post) if (!blocked.has(p)) sc.set(p, (sc.get(p) || 0) + v * v); }
    let bp = -1, bs = 0; for (const [p, s] of sc) { const c = s / (Math.sqrt(qn) * norms[p]); if (c > bs) { bs = c; bp = p; } }
    if (bs >= 0.5) {
      const last = out[out.length - 1];
      if (last && last.best[0] === bp && last.te >= i) last.te = i + WIN; else out.push({ ts: i, te: i + WIN, status: "verbatim", best: [bp], all: [bp], cand: [] });
    }
  }
  return out;
}
/**
 * B2 — a sensible fuzzy baseline, written by the independent reviewer in about 80 lines and NOT tuned:
 * folded 2-/3-gram voting -> plain word-level Smith–Waterman (match = same folded word, or 1 edit for words of ≥4
 * letters) -> one evidence threshold. No cue phrases, no split/glued-word handling, no real-word rule, no suggestions.
 */
function mergeAyahs(groups) {
  groups.sort((x, y) => x.ts - y.ts);
  const out = [];
  for (const g of groups) {
    const l = out[out.length - 1];
    if (l && corpus.isQuran(l.best[l.best.length - 1]) && g.best[0] === l.best[l.best.length - 1] + 1 && g.ts - l.te <= 3) {
      l.te = Math.max(l.te, g.te); l.best.push(...g.best); l.all.push(...g.all); if (g.status === "partial") l.status = "partial";
    } else out.push(g);
  }
  return out;
}
function sysFuzzy(words, blocked, EV = 20) {
  const { ftok } = tokenizeTranscript(words.map(w => ({ w })));
  const n = ftok.length, hits = new Map();
  for (const nn of [3, 2]) for (let i = 0; i + nn <= n; i++) {
    for (const p of corpus.postings(nn, ftok.slice(i, i + nn).join(" "))) { if (blocked.has(p)) continue; let a = hits.get(p); if (!a) hits.set(p, a = []); a.push(i, nn === 3 ? 2 : 1); }
  }
  const clusters = [];
  for (const [pid, a] of hits) {
    const pr = []; for (let k = 0; k < a.length; k += 2) pr.push([a[k], a[k + 1]]); pr.sort((x, y) => x[0] - y[0]);
    let s = pr[0][0], e = s, sc = 0; const flush = () => { if (sc >= 4) clusters.push({ pid, a: s, b: e + 3, sc }); };
    for (const [pos, w] of pr) { if (pos - e > 15) { flush(); s = pos; sc = 0; } e = pos; sc += w; }
    flush();
  }
  clusters.sort((x, y) => y.sc - x.sc || x.a - y.a || x.pid - y.pid);
  const per = new Map(), kept = [];
  for (const c of clusters) { const k = c.a >> 3, q = per.get(k) || 0; if (q >= 10) continue; per.set(k, q + 1); kept.push(c); }
  const found = [];
  for (const c of kept) {
    let FP = corpus.ftok(c.pid);
    if (FP.length > 400) { // narrow long passages to the region sharing bigrams with the window
      const want = new Set(); for (let i = c.a; i < Math.min(n - 1, c.b); i++) want.add(ftok[i] + " " + ftok[i + 1]);
      let lo = FP.length, hi = 0; for (let j = 0; j + 1 < FP.length; j++) if (want.has(FP[j] + " " + FP[j + 1])) { if (j < lo) lo = j; if (j > hi) hi = j; }
      if (hi < lo) continue; FP = FP.slice(Math.max(0, lo - 60), Math.min(FP.length, hi + 60));
    }
    const a = Math.max(0, c.a - 25), b = Math.min(n, c.b + 40), T = ftok.slice(a, b), m = T.length, N = FP.length, W = N + 1;
    const H = new Float32Array((m + 1) * W), B = new Uint8Array((m + 1) * W); let best = 0, bi = 0, bj = 0;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= N; j++) {
      const t = T[i - 1], p = FP[j - 1];
      const s = t === p ? 2 : (Math.min(t.length, p.length) >= 4 && editDistance(t, p, 1) <= 1 ? 1 : -1);
      let v = H[(i - 1) * W + j - 1] + s, bb = 1;
      const up = H[(i - 1) * W + j] - 1; if (up > v) { v = up; bb = 2; }
      const lf = H[i * W + j - 1] - 1; if (lf > v) { v = lf; bb = 3; }
      if (v <= 0) { v = 0; bb = 0; }
      H[i * W + j] = v; B[i * W + j] = bb; if (v > best) { best = v; bi = i; bj = j; }
    }
    if (best <= 0) continue;
    let i = bi, j = bj, match = 0, cols = 0, ev = 0, ts = bi; const te = bi;
    while (i > 0 && j > 0) { const bb = B[i * W + j]; if (!bb) break; cols++;
      if (bb === 1) { const t = T[i - 1], p = FP[j - 1]; if (t === p) { match++; ev += corpus.idf(p); } else if (Math.min(t.length, p.length) >= 4 && editDistance(t, p, 1) <= 1) { match += 0.7; ev += 0.6 * corpus.idf(p); } i--; j--; ts = i; }
      else if (bb === 2) { i--; ts = i; } else j--; }
    const q = match / cols;
    if (match >= 5 && q >= 0.55 && ev >= EV) found.push({ pid: c.pid, ts: a + ts, te: a + te, match, q, status: q >= 0.86 ? "verbatim" : "partial" });
  }
  found.sort((x, y) => y.match - x.match || y.q - x.q || x.ts - y.ts || x.pid - y.pid);
  const groups = [];
  for (const f of found) {
    let home = null;
    for (const g of groups) { const ov = Math.min(g.te, f.te) - Math.max(g.ts, f.ts); if (ov > 0 && ov / Math.min(g.te - g.ts, f.te - f.ts) >= 0.5) { home = g; break; } }
    if (home) { if (f.match >= 0.85 * home.m) home.all.push(f.pid); continue; }
    groups.push({ ts: f.ts, te: f.te, status: f.status, best: [f.pid], all: [f.pid], cand: [], m: f.match });
  }
  return mergeAyahs(groups);
}

export const SYSTEMS = {
  engine: () => sysEngine({}),
  notol: () => sysEngine({ tolerant: false }),
  nocues: () => sysEngine({ useCues: false }),
  novec: () => sysEngine({ useVectors: false }),
  // candidates by meaning ordered with sentence vectors (bge-m3 through the Worker; here from the offline cache, see lib.mjs: loadSem)
  sem: () => sysEngine(sem ? { sem: { index: sem.index, lookup: sem.lookup } } : {}),
  B0: () => sysExact, B1: () => sysTfidf, B2: () => sysFuzzy,
};

// ---------------- judging helpers ----------------
const famCache = new Map(), strictCache = new Map();
const fam = pid => { let f = famCache.get(pid); if (!f) famCache.set(pid, f = family(corpus, pid)); return f; };
const famStrict = pid => { let f = strictCache.get(pid); if (!f) strictCache.set(pid, f = family(corpus, pid, PAR_FAMILY.minShare, PAR_FAMILY.minCount)); return f; };
/**
 * Is passage q another narration of the text that out-of-corpus item `it` was taken from?
 * The generator removed the item's family (shared-trigram rule) from the searchable corpus, so a remaining passage can only
 * be a DIFFERENTLY WORDED narration. It is accepted when
 *   (1) it is linked to a removed narration by the stricter family rule (PAR_FAMILY) in either direction, or
 *   (2) it shares at least 30% of the (idf-weighted) vocabulary of the original passage, in either direction.
 * This judge is automatic and approximate: it can miss a narration whose wording is far, and accept a neighbouring hadith.
 * Every textual citation on these items is listed with its verdict in results.json (ex.oocTextual) so a person can check.
 */
const FAMILY_SHARE = 0.3;
function idfShare(A, B) { const S = new Set(B); let a = 0, b = 0; for (const w of new Set(A)) { const v = corpus.idf(w); b += v; if (S.has(w)) a += v; } return b ? a / b : 0; }
function sameFamily(it, q) {
  if (q == null) return false;
  const F = fam(it.pid);
  if (F.has(q)) return true;
  if (corpus.isQuran(q)) return false;
  for (const m of F) if (!corpus.isQuran(m) && famStrict(m).has(q)) return true;
  for (const m of famStrict(q)) if (F.has(m)) return true;
  const A = corpus.ftok(it.pid), B = corpus.ftok(q);
  return Math.max(idfShare(A, B), idfShare(B, A)) >= FAMILY_SHARE;
}

// ---------------- scoring ----------------
const TEXTUAL = new Set(["verbatim", "partial"]);
const foldedText = new Map();
/** do the (clean) words stand word for word, contiguously, in passage pid? (folded spelling) */
function standsIn(wordsArr, pid) {
  if (pid == null || !wordsArr.length) return false;
  let t = foldedText.get(pid); if (t == null) foldedText.set(pid, t = " " + corpus.ftok(pid).join(" ") + " ");
  return t.includes(" " + wordsArr.map(fold).join(" ") + " ");
}
/**
 * score one system output against one lecture.
 * clean = the lecture's words before noise; map[i] = position of clean word i in the noisy transcript.
 *
 * Labels under the engine's STRICT rule ("verbatim" = no substituted, added or omitted word):
 *   lab.verb    quotations that the speaker said word for word (vq, vh, and the rare ph item left unchanged), detected:
 *               [n, labelled verbatim, labelled partial]
 *   lab.changed quotations whose wording the speaker really changed (ph), detected:
 *               [n, labelled partial, labelled verbatim on a part that IS word for word in the cited passage,
 *                labelled verbatim although the labelled words include a change  <- critical error]
 * Critical errors (see report): critWrongSource + critChangedVerbatim + critFiller + critOOC + critOOCverbMost.
 */
function score(pred, items, map, clean, keepExamples) {
  const m = { vq: [0, 0, 0, 0], vh: [0, 0, 0, 0], ph: [0, 0, 0, 0] }; // n, detected, first source correct, any shown source correct
  const r = { lab: { verb: [0, 0, 0], changed: [0, 0, 0, 0] },
    critWrongSource: 0, critChangedVerbatim: 0, critOOC: 0, critOOCverbMost: 0, critFiller: 0, sideTextual: 0, fillerLead: 0, fillerMeaning: 0,
    // out-of-corpus items, one category per item (the most assertive entry on it); [source of the same family, unrelated source]
    ooc: { n: 0, verbMost: [0, 0], verbShort: [0, 0], partial: [0, 0], meaning: [0, 0], lead: 0, notfound: 0 },
    par: [], parOtherTextual: 0, vhItems: [],
    cueN: 0, cueClean: 0, startErr: 0, endErr: 0, startN: 0, iou8: 0, attrN: 0, attrOK: 0, weak: 0 };
  const ex = { oocTextual: [], filler: [], wrongSource: [], changedVerbatim: [] };
  const used = new Set();
  const itemSpans = items.map(it => ({ it, a: map[it.a], b: map[it.b] }));
  const overlap = (p, s) => Math.max(0, Math.min(p.te, s.b) - Math.max(p.ts, s.a));
  /** the clean words of item `it` that lie under entry p */
  const under = (p, it) => { const w = []; for (let i = it.a; i < it.b; i++) if (map[i] >= p.ts && map[i] < p.te) w.push(clean[i]); return w; };
  for (const s of itemSpans) {
    const { it } = s; const len = Math.max(1, s.b - s.a);
    const ps = pred.map((p, i) => ({ p, i, ov: overlap(p, s) })).filter(x => x.ov > 0);
    ps.forEach(x => used.add(x.i));
    const textual = ps.filter(x => TEXTUAL.has(x.p.status)).sort((x, y) => y.ov - x.ov);
    if (it.kind === "vq" || it.kind === "vh" || it.kind === "ph") {
      const k = m[it.kind]; k[0]++;
      const good = textual.find(x => x.ov / len >= 0.5);
      if (it.kind === "vh") r.vhItems.push([it.b - it.a, it.cue ? 1 : 0, good ? 1 : 0]);
      if (good) {
        k[1]++;
        const t1 = good.p.best.some(p => it.accept.has(p)), any = good.p.all.some(p => it.accept.has(p));
        if (t1) k[2]++; if (any) k[3]++;
        if (!any) { r.critWrongSource++; if (keepExamples) ex.wrongSource.push({ kind: it.kind, cited: good.p.ref, truth: corpus.P[[...it.accept][0]].r, status: good.p.status }); }
        if (it.changed) { const c = r.lab.changed; c[0]++; if (good.p.status === "partial") c[1]++; else if (good.p.all.some(q => standsIn(under(good.p, it), q))) c[2]++; else c[3]++; }
        else { const c = r.lab.verb; c[0]++; c[good.p.status === "verbatim" ? 1 : 2]++; }
        r.startErr += Math.abs(good.p.ts - s.a); r.endErr += Math.abs(good.p.te - s.b); r.startN++;
        if (good.ov / (Math.max(good.p.te, s.b) - Math.min(good.p.ts, s.a)) >= 0.8) r.iou8++;
        if (it.trailCol) { r.attrN++; if (good.p.attribution && good.p.attribution.agrees) r.attrOK++; }
      } else if (ps.some(x => x.p.status === "lead" && x.p.all.some(p => it.accept.has(p)))) r.weak++;
      for (const x of textual) {
        const okSrc = x.p.all.some(p => it.accept.has(p));
        // a second textual citation covering most of the same quotation with a wrong source is also a critical error
        if (x !== good && x.ov / len >= 0.5 && !okSrc) r.critWrongSource++;
        // a textual citation on a small part of the quotation, from a passage that does not contain the whole quotation:
        // not judged automatically (the part may really stand in that passage); counted and reported
        if (x.ov / len < 0.5 && !okSrc) r.sideTextual++;
        // STRICT rule: "verbatim" on words that include a real change of wording is a critical error (any coverage)
        if (it.changed && x.p.status === "verbatim" && !x.p.all.some(q => standsIn(under(x.p, it), q))) {
          r.critChangedVerbatim++;
          if (keepExamples) ex.changedVerbatim.push({ cited: x.p.ref, cover: +(x.ov / len).toFixed(2), saidUnderLabel: under(x.p, it).join(" "), spoken: x.p.spoken });
        }
      }
    } else if (it.kind === "ooc") {
      const o = r.ooc; o.n++;
      // EVERY entry on an out-of-corpus item is judged: right = another narration of the same text, wrong = anything else
      let top = null;   // [rank, wrong?]
      const see = (rank, wrong) => { if (!top || rank > top[0]) top = [rank, wrong]; else if (rank === top[0] && wrong) top[1] = true; };
      for (const x of ps) {
        const st = x.p.status;
        if (TEXTUAL.has(st)) {
          const wrong = !x.p.best.some(q => sameFamily(it, q));   // judged by the source shown FIRST
          const most = st === "verbatim" && x.ov / len >= 0.6;
          if (wrong) r.critOOC++; else if (most) r.critOOCverbMost++;
          if (keepExamples) ex.oocTextual.push({ from: corpus.P[it.pid].r, cited: x.p.ref, status: st, cover: +(x.ov / len).toFixed(2), judged: wrong ? "other source" : "same family", spoken: x.p.spoken });
          see(most ? 5 : st === "verbatim" ? 4 : 3, wrong);
        } else if (st === "meaning") see(2, !sameFamily(it, x.p.cand[0]));
        else if (st === "lead") see(1, false);
      }
      if (!top) o.notfound++; else if (top[0] === 1) o.lead++;
      else o[{ 5: "verbMost", 4: "verbShort", 3: "partial", 2: "meaning" }[top[0]]][top[1] ? 1 : 0]++;
    } else if (it.kind === "par") {
      // judged by FAMILY (it.accept) and, for comparison, by the key phrase alone (it.acceptKey)
      const rankIn = set => {
        if (textual.some(x => x.p.all.some(p => set.has(p)))) return { tx: true, rank: 0 };
        const mm = ps.filter(x => x.p.cand && x.p.cand.length).sort((x, y) => y.ov - x.ov)[0];
        return { tx: false, rank: mm ? mm.p.cand.findIndex(p => set.has(p)) : -1 };
      };
      const f = rankIn(it.accept), k = rankIn(it.acceptKey);
      r.par.push({ id: it.id, tx: f.tx, rank: f.rank, keyTx: k.tx, keyRank: k.rank, cue: it.cueSeen ? 1 : 0, meaning: ps.some(x => x.p.status === "meaning") ? 1 : 0 });
      // a textual match inside a paraphrase with a source outside the intended family: text that really is in that passage,
      // but not the hadith the paraphrase was written from. Counted separately.
      for (const x of textual) if (!x.p.all.some(p => it.accept.has(p))) r.parOtherTextual++;
    } else if (it.kind === "cue") {
      r.cueN++;
      if (!ps.some(x => TEXTUAL.has(x.p.status) || x.p.status === "meaning")) r.cueClean++;
      if (textual.length) { r.critFiller++; if (keepExamples) for (const x of textual) ex.filler.push({ where: "cue-only", cited: x.p.ref, status: x.p.status, spoken: x.p.spoken }); }
    }
  }
  pred.forEach((p, i) => { if (used.has(i)) return;
    if (TEXTUAL.has(p.status)) { r.critFiller++; if (keepExamples) ex.filler.push({ where: "filler", cited: p.ref, status: p.status, spoken: p.spoken }); }
    else if (p.status === "lead") r.fillerLead++; else if (p.status === "meaning") r.fillerMeaning++; });
  return keepExamples ? { m, r, ex } : { m, r };
}

/** what the project's noise model actually did to the words (share of each kind among the words that were hit) */
function noiseShape(clean, nz) {
  const c = { glued: 0, split: 0, foldIdentical: 0, oneEdit: 0, realWord: 0, deleted: 0, inserted: 0, other: 0 }; let hit = 0;
  for (let i = 0; i < clean.length; i++) {
    const a = nz.map[i], b = nz.map[i + 1], k = b - a; let cls = null;
    if (k === 1) {
      if (i > 0 && nz.map[i - 1] === a) cls = "glued";
      else if (nz.words[a] !== clean[i]) {
        const s = wordSim(nz.words[a], clean[i]);
        cls = s === "exact" ? null : corpus.isWord(nz.words[a]) ? "realWord" : s === "asr" ? "foldIdentical" : s === "near" ? "oneEdit" : "other";
      }
    } else if (k === 0) cls = i + 1 < clean.length && nz.words[a] === clean[i] + clean[i + 1] ? "glued" : "deleted";
    else if (k === 2) cls = nz.words[a] + nz.words[a + 1] === clean[i] ? "split" : "inserted";
    else cls = "other";
    if (cls) { hit++; c[cls]++; }
  }
  return { words: clean.length, hit, ...c };
}

// ---------------- absent sayings ----------------
function runAbsent() {
  const A = JSON.parse(readFileSync(path.join(EVAL, "absent_sayings.json"), "utf8"));
  const FILL = JSON.parse(readFileSync(path.join(EVAL, "fillers.json"), "utf8")).fillers;
  // "Truly absent" is checked on every run: a saying is kept only if NO run of 4 consecutive words of it (the whole
  // saying when it has fewer than 4 words) stands in any passage of the core corpus — Qur'an and hadith, folded spelling.
  // A saying that fails the check is dropped and reported with the run and the passage.
  const text = []; for (let p = 0; p < corpus.coreN; p++) text.push(" " + corpus.ftok(p).join(" ") + " ");
  const kept = [], dropped = [];
  for (const s of A.sayings) {
    const F = norm(s).split(" ").map(fold), n = Math.min(4, F.length); let hit = null;
    for (let i = 0; i + n <= F.length && !hit; i++) { const run = " " + F.slice(i, i + n).join(" ") + " ", k = text.findIndex(t => t.includes(run)); if (k >= 0) hit = { saying: s, sharedRun: run.trim(), foundIn: corpus.P[k].r }; }
    if (hit) dropped.push(hit); else kept.push(s);
  }
  const words = [], items = [];
  kept.forEach((s, i) => {
    words.push(...norm(FILL[(3 * i) % FILL.length]).split(" "), ...norm(A.cues[i % A.cues.length]).split(" "));
    const a = words.length; words.push(...norm(s).split(" ")); items.push({ saying: s, a, b: words.length });
    words.push(...norm(FILL[(3 * i + 1) % FILL.length]).split(" "));
  });
  const out = { listed: A.sayings.length, n: kept.length, check: "no run of 4 consecutive words in any core passage", dropped, runs: [] };
  for (const [nid, nz] of [["clean", ident(words)], ["std20", asrNoise(words, 0.2, rng(2020))]]) {
    const led = analyze(nz.words.map(w => ({ w })), corpus).ledger;
    const run = { noise: nid, notfound: 0, lead: 0, meaning: 0, textual: 0, verbatim: 0, partial: 0, citations: [], suggestions: [], fillerTextual: 0 };
    const used = new Set();
    for (const it of items) {
      const a = nz.map[it.a], b = nz.map[it.b];
      const ps = led.filter((e, i) => { const o = Math.min(e.te, b) - Math.max(e.ts, a) > 0; if (o) used.add(i); return o; });
      const tx = ps.filter(e => TEXTUAL.has(e.status)), mn = ps.filter(e => e.status === "meaning");
      if (tx.length) { run.textual++; run[tx.some(e => e.status === "verbatim") ? "verbatim" : "partial"]++; for (const e of tx) run.citations.push({ saying: it.saying, status: e.status, cited: e.source.ref, label: e.source.short, spoken: e.spoken }); }
      else if (mn.length) { run.meaning++; run.suggestions.push({ saying: it.saying, cited: mn[0].source.ref, label: mn[0].source.short }); }
      else if (ps.some(e => e.status === "lead")) run.lead++;
      else run.notfound++;
    }
    led.forEach((e, i) => { if (!used.has(i) && TEXTUAL.has(e.status)) run.fillerTextual++; });
    out.runs.push(run);
  }
  return out;
}

// ---------------- jobs ----------------
const SIZES = { vq: 40, vh: 60, ph: 40, par: 26, ooc: 30, cue: 14 };
function jobList() {
  const J = [];
  const add = (group, seed, gen, noise, systems, cost) => J.push({ key: `${group}/${seed}/${noise.join("+")}`, group, seed, gen, noise, systems, cost });
  for (const seed of SEEDS) {
    for (const nz of ["clean", "std10", "std20", "std30"]) add("main", seed, {}, [nz], ["engine", "notol", "nocues", "novec", "sem", "B0", "B1", "B2"], 40);
    for (const sh of SHAPES) add("noise", seed, {}, [sh + "10", sh + "20", sh + "30"].concat(sh === "rand" ? ["two30"] : []), ["engine", "B2"], 30);
    add("parUnseen", seed, { par: "unseen" }, ["clean"], ["engine", "novec", "sem"], 26);
    add("parStrip", seed, { par: "strip" }, ["clean"], ["engine", "novec", "sem"], 26);
    add("noCue", seed, { cue: "none", trail: false }, ["clean", "std20"], ["engine"], 22);
    add("unseenCue", seed, { cue: "unseen", trail: false }, ["clean", "std20"], ["engine"], 22);
    add("short", seed, { short: true }, ["clean", "std20"], ["engine"], 22);
    add("shortNoCue", seed, { short: true, cue: "none", trail: false }, ["clean", "std20"], ["engine"], 22);
    add("shortUnseenCue", seed, { short: true, cue: "unseen", trail: false }, ["clean", "std20"], ["engine"], 22);
  }
  for (const seed of FRESH) add("fresh", seed, {}, ["clean", "std20"], ["engine"], 22);
  J.push({ key: "absent", group: "absent", cost: 3 });
  return J;
}

const lecCache = new Map();
function runJob(job) {
  if (job.group === "absent") { const t0 = Date.now(); return { absent: runAbsent(), times: [{ key: job.key, s: (Date.now() - t0) / 1000 }] }; }
  const lk = job.seed + JSON.stringify(job.gen);
  let lec = lecCache.get(lk);
  if (!lec) {
    lecCache.clear();
    lec = buildLecture(corpus, job.seed, SIZES, "test", job.gen);
    for (const it of lec.items) if (it.kind === "par") it.cueSeen = findCues(it.frag.map(fold)).some(c => c.kind === "hadith");
    lecCache.set(lk, lec);
  }
  const cueShare = k => { const it = lec.items.filter(x => x.kind === k); return [it.filter(x => x.cue).length, it.length]; };
  const rows = [], times = [];
  for (const nid of job.noise) {
    const nz = NOISE[nid].fn(lec.words, job.seed);
    for (const sid of job.systems) {
      const t0 = Date.now();
      const pred = SYSTEMS[sid]()(nz.words, lec.blocked);
      const s = (Date.now() - t0) / 1000;
      const sc = score(pred, lec.items, nz.map, lec.words, sid === "engine" && job.group === "main");
      if (sid !== "engine") delete sc.r.vhItems;
      const row = { group: job.group, seed: job.seed, noise: nid, system: sid, words: nz.words.length, ...sc };
      if (sid === "engine") { row.cueShare = { vq: cueShare("vq"), vh: cueShare("vh"), ph: cueShare("ph"), ooc: cueShare("ooc") }; row.blocked = lec.blocked.size; }
      if (sid === "engine" && job.group === "main" && NOISE[nid].rate) row.shape = noiseShape(lec.words, nz);
      rows.push(row); times.push({ key: `${job.group}/${job.seed}/${nid}/${sid}`, s });
    }
  }
  const out = { rows, times, semUsed: sem ? [...sem.used] : [], semMissed: sem ? [...sem.missed] : [] };
  if (sem) { sem.used.clear(); sem.missed.clear(); }
  return out;
}

async function initCorpus() {
  corpus = await loadCorpus();
  sem = await loadSem(corpus);
  refToPid = new Map(corpus.P.map((p, i) => [(p.t === "q" ? "q" : "") + p.r, i]));
}

// ---------------- entry points ----------------
if (WORKER) {
  await initCorpus();
  process.on("message", job => { process.send({ key: job.key, out: runJob(job) }); });
  process.send({ ready: true, info: { N: corpus.N, NQ: corpus.NQ, hasVectors: !!corpus.vec, sem: sem ? { model: sem.index.model, dim: sem.index.dim, rows: sem.index.rows } : null } });
} else if (DEV) {
  // Development only (seed 101, never reported): quotations by meaning with a known opener, an unseen opener and no opener,
  // and what the same settings do to speech that quotes nothing. One line per condition; used while changing the engine.
  await initCorpus();
  for (const [name, gen] of [["known", {}], ["unseen", { par: "unseen" }], ["strip", { par: "strip" }]]) {
    const lec = buildLecture(corpus, 101, SIZES, "dev", gen);
    for (const it of lec.items) if (it.kind === "par") it.cueSeen = findCues(it.frag.map(fold)).some(c => c.kind === "hadith");
    for (const nid of ["clean", "std20"]) {
      const nz = NOISE[nid].fn(lec.words, 101), t0 = Date.now();
      const pred = SYSTEMS.engine()(nz.words, lec.blocked), ms = Date.now() - t0;
      const { m, r } = score(pred, lec.items, nz.map, lec.words, false);
      const par = k => r.par.filter(x => x.tx || (x.rank >= 0 && x.rank < k)).length;
      if (sem) { const r2 = score(SYSTEMS.sem()(nz.words, lec.blocked), lec.items, nz.map, lec.words, false).r, p2 = k => r2.par.filter(x => x.tx || (x.rank >= 0 && x.rank < k)).length;
        console.log(`${name}/${nid} with sentence vectors: par t1 ${p2(1)} t3 ${p2(3)} t5 ${p2(5)} /${r2.par.length}  fillerMeaning ${r2.fillerMeaning}  (vectors missing for ${sem.missed.size} stretches so far)`); }
      const st = {}; for (const e of pred) st[e.status] = (st[e.status] || 0) + 1;
      console.log(`${name}/${nid} ${ms}ms  par t1 ${par(1)} t3 ${par(3)} t5 ${par(5)} /${r.par.length} (textual ${r.par.filter(x => x.tx).length}, meaning ${r.par.filter(x => x.meaning).length})` +
        `  vq ${m.vq[1]}/${m.vq[0]} vh ${m.vh[1]}/${m.vh[0]} ph ${m.ph[1]}/${m.ph[0]}  CRIT src ${r.critWrongSource} changedVerbatim ${r.critChangedVerbatim} ooc ${r.critOOC}+${r.critOOCverbMost} fillerTextual ${r.critFiller ?? "-"}` +
        `  fillerLead ${r.fillerLead} fillerMeaning ${r.fillerMeaning}  cueClean ${r.cueClean}/${r.cueN}  entries ${JSON.stringify(st)}`);
    }
  }
  console.log("absent sayings:", JSON.stringify(runAbsent()));
  if (sem) writeSemRequests("dev", [...sem.used], sem.missed.size);
} else if (QUICK) {
  await initCorpus();
  const lec = buildLecture(corpus, 101, SIZES, "dev");
  for (const it of lec.items) if (it.kind === "par") it.cueSeen = true;
  for (const nid of ["clean", "std10", "std20", "std30"]) {
    const nz = NOISE[nid].fn(lec.words, 101), t0 = Date.now();
    const { m, r } = score(SYSTEMS.engine()(nz.words, lec.blocked), lec.items, nz.map, lec.words, false);
    const par = k => r.par.filter(x => x.tx || (x.rank >= 0 && x.rank < k)).length;
    console.log(`${nid}  ${Date.now() - t0}ms  vq ${m.vq[1]}/${m.vq[0]} t1 ${m.vq[2]}  vh ${m.vh[1]}/${m.vh[0]} t1 ${m.vh[2]} any ${m.vh[3]}  ph ${m.ph[1]}/${m.ph[0]} any ${m.ph[3]} weak ${r.weak}` +
      `  said-verbatim [n,verbatim,partial] ${r.lab.verb}  changed [n,partial,verbatim-on-unchanged-part,VERBATIM-WITH-CHANGE] ${r.lab.changed}  CRIT src ${r.critWrongSource} changedVerbatim ${r.critChangedVerbatim} ooc ${r.critOOC}+${r.critOOCverbMost} filler ${r.critFiller} (side ${r.sideTextual})  ooc ${JSON.stringify(r.ooc)}` +
      `  par t1 ${par(1)} t3 ${par(3)} t5 ${par(5)} /${r.par.length} (textual ${r.par.filter(x => x.tx).length})  cueClean ${r.cueClean}/${r.cueN}  fillerLead ${r.fillerLead} fillerMeaning ${r.fillerMeaning}  startErr ${(r.startErr / Math.max(1, r.startN)).toFixed(2)} attr ${r.attrOK}/${r.attrN}`);
  }
} else {
  const T0 = Date.now();
  const jobs = jobList(), order = new Map(jobs.map((j, i) => [j.key, i]));
  const queue = [...jobs].sort((a, b) => b.cost - a.cost || order.get(a.key) - order.get(b.key));
  const jArg = ARGS.find(a => a.startsWith("--jobs="));
  const nProc = Math.max(1, Math.min(jArg ? +jArg.slice(7) : 2, os.cpus().length, jobs.length));
  const done = new Map(); let info = null;
  console.error(`${jobs.length} jobs on ${nProc} worker process(es)…`);
  await new Promise((resolve, reject) => {
    let live = nProc;
    for (let w = 0; w < nProc; w++) {
      const ch = fork(fileURLToPath(import.meta.url), ["--worker"]);
      const next = () => { const j = queue.shift(); if (j) ch.send(j); else { ch.kill(); if (--live === 0) resolve(); } };
      ch.on("message", msg => {
        if (msg.ready) info = msg.info;
        else { done.set(msg.key, msg.out); console.error(`  [${done.size}/${jobs.length}] ${msg.key}  (${Math.round((Date.now() - T0) / 1000)} s)`); }
        next();
      });
      ch.on("error", reject);
      ch.on("exit", code => { if (code) reject(new Error("worker exited with code " + code)); });
    }
  });
  const rows = [], times = [], semUsed = [], semMissed = new Set(); let absent = null;
  for (const j of jobs) { const o = done.get(j.key); if (!o) throw new Error("job did not finish: " + j.key); if (o.absent) absent = o.absent; else rows.push(...o.rows); times.push(...o.times);
    if (o.semUsed) semUsed.push(...o.semUsed); for (const t of o.semMissed || []) semMissed.add(t); }
  writeSemRequests("eval", semUsed, semMissed.size);
  const results = {
    meta: { simulated: true, seeds: SEEDS, freshSeeds: FRESH, devSeed: 101, sizes: SIZES, corpus: info,
      noise: Object.fromEntries(Object.entries(NOISE).map(([k, v]) => [k, { rate: v.rate, kind: v.kind }])), systems: Object.keys(SYSTEMS), sentenceVectors: info && info.sem ? { ...info.sem, stretchesAsked: new Set(semUsed).size, stretchesWithoutVector: semMissed.size } : null,
      cuesInGenerator: { hadith: CUE_H.length, recognisedByEngine: CUE_H.filter(c => findCues(norm(c).split(" ").map(fold)).some(x => x.kind === "hadith")).length } },
    rows, absent,
  };
  writeJson("results.json", results);
  const { report } = await import("./report.mjs");
  writeFileSync(path.join(EVAL, "RESULTS.md"), report(results));
  const { writeSummary } = await import("./summary.mjs");
  writeSummary();
  const engineTimes = {}; for (const t of times) { const [g, , nz, sid] = t.key.split("/"); if (g === "main" && sid === "engine") (engineTimes[nz] ||= []).push(t.s); }
  writeTiming("run", { totalSeconds: Math.round((Date.now() - T0) / 1000), workers: nProc,
    engineSecondsPerLecture: Object.fromEntries(Object.entries(engineTimes).map(([k, v]) => [k, +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)])), perCall: times });
  console.log(`wrote eval/results.json, eval/RESULTS.md, eval/summary.json (timings: eval/timings.json) in ${Math.round((Date.now() - T0) / 1000)} s`);
}
