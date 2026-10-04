// align.js — word-level local alignment (Smith–Waterman) between what was SPOKEN (transcript tokens)
// and what is WRITTEN (source tokens), aware of typical speech-recognition artefacts:
//   • phonetically confusable letters  (ص/س ...)      -> "asr"
//   • a word split in two or two words glued together   -> "joinT" / "joinP"
//   • one-letter slips                                  -> "near"
// Match scores are scaled by how informative the word is, so the alignment cannot creep into
// surrounding speech by hopping between common words (في، من، الله ...).
import { wordSim, within1, editDistance, inflectionOf, sameSound } from "./text.js";

const GAP = 2.0, DIFF = 2.6;
const BASE = { exact: 3.0, asr: 2.7, near: 1.7 };
const DIGITS = /^\d+$/;
// Work arrays, reused between calls and cleared before every use (thousands of alignments per transcript: allocating
// them afresh each time was mostly garbage-collector work). Nothing is carried over from one call to the next.
let H_BUF = new Float32Array(1 << 14), B_BUF = new Uint8Array(1 << 14);
let PW = new Float32Array(512), PP = new Float32Array(512), PLEN = new Uint16Array(512), TP = new Float32Array(256);

/**
 * @param T,FT  transcript tokens (normalised / folded)
 * @param P,FP  source tokens (normalised / folded)
 * @param wt    (foldedSourceWord) -> weight in [0.3,1]
 * @param opt   {tolerant:boolean, isWord?:(w)=>boolean, band?:{lo,hi}}
 *              tolerant=false disables asr/near/join (used for the ablation study)
 *              band: only cells whose diagonal (source index − transcript index) lies in [lo, hi] are computed. The
 *              engine passes the diagonals on which the transcript and the source share word pairs, widened by a
 *              margin: an alignment that means anything runs along them, and the rest of the matrix is skipped.
 *              isWord: corpus vocabulary test for the real-word rule (see wordSim) — a spoken form that is itself a
 *              word is a wording difference even when it sounds like the source word
 * @returns null | {ts,te,ps,pe,ops:[{op,ti,pi,soft?}],score}   (te/pe exclusive)
 */
export function align(T, FT, P, FP, wt, opt = { tolerant: true }) {
  const m = T.length, n = P.length;
  if (!m || !n) return null;
  const W = n + 1;
  const size = (m + 1) * W;
  if (H_BUF.length < size) { let cap = H_BUF.length; while (cap < size) cap *= 2; H_BUF = new Float32Array(cap); B_BUF = new Uint8Array(cap); }
  else { H_BUF.fill(0, 0, size); B_BUF.fill(0, 0, size); }
  const H = H_BUF, B = B_BUF; // B: 0 stop,1 diag,2 up(T extra),3 left(P skipped),4 joinT(2T:1P),5 joinP(1T:2P)
  if (PW.length < n) { let cap = PW.length; while (cap < n) cap *= 2; PW = new Float32Array(cap); PP = new Float32Array(cap); PLEN = new Uint16Array(cap); }
  if (TP.length < m) { let cap = TP.length; while (cap < m) cap *= 2; TP = new Float32Array(cap); }
  const tol = opt.tolerant !== false, isWord = opt.isWord || null;
  // weights: matches score in proportion to how informative the word is; mismatches and gaps are penalised in the same
  // proportion (floored at half), so a mis-heard common word ("the", "في") does not break a long quotation apart
  const pw = PW, pp = PP, tp = TP;
  for (let j = 0; j < n; j++) { pw[j] = wt(FP[j]); pp[j] = Math.max(0.5, pw[j]); }
  // a bare number between words (a pasted ayah marker "(1)", "﴿١﴾") costs nothing to skip
  for (let i = 0; i < m; i++) tp[i] = DIGITS.test(T[i]) ? 0 : Math.max(0.5, wt(FT[i]));
  const band = opt.band || null, EX = BASE.exact, ASR = BASE.asr, NEAR = BASE.near;
  const plen = PLEN;
  if (tol) for (let j = 0; j < n; j++) plen[j] = FP[j].length;
  // glued / split words: the joined pairs are built once per row and per column, and compared only when lengths fit
  let JP = null;
  if (tol) { JP = new Array(n); JP[0] = ""; for (let j = 1; j < n; j++) JP[j] = FP[j - 1] + FP[j]; }
  let best = 0, bi = 0, bj = 0;
  for (let i = 1; i <= m; i++) {
    const t = T[i - 1], ft = FT[i - 1], lt = ft.length, row = i * W, prow = row - W;
    const jt = tol && i >= 2 ? FT[i - 2] + ft : null, ljt = jt === null ? -1 : jt.length;
    let j0 = 1, j1 = n;
    if (band) { j0 = Math.max(1, i + band.lo); j1 = Math.min(n, i + band.hi); }
    for (let j = j0; j <= j1; j++) {
      let s;
      const p = P[j - 1];
      if (t === p) s = EX * pw[j - 1];
      else if (!tol) s = -DIFF * pp[j - 1];
      else {
        // The path is found WITHOUT the real-word rule (a mis-heard word must not break a quotation apart);
        // the rule is applied when the pair is labelled, in the traceback below. (Same test as wordSim, inlined.)
        const fp = FP[j - 1];
        if (ft === fp) s = ASR * pw[j - 1];
        else {
          const lp = plen[j - 1], d = lt - lp, mn = d < 0 ? lt : lp;
          const near = mn >= 8 ? (d <= 2 && d >= -2 && editDistance(ft, fp, 2) <= 2) : (mn >= 4 && d <= 1 && d >= -1 && within1(ft, fp));
          s = near ? NEAR * pw[j - 1] : -DIFF * pp[j - 1];
        }
      }
      let v = H[prow + j - 1] + s, b = 1;
      const up = H[prow + j] - GAP * tp[i - 1]; if (up > v) { v = up; b = 2; }
      const left = H[row + j - 1] - GAP * pp[j - 1]; if (left > v) { v = left; b = 3; }
      if (tol) {
        if (ljt === plen[j - 1] && jt === FP[j - 1]) {
          const jv = H[prow - W + j - 1] + ASR * pw[j - 1]; if (jv > v) { v = jv; b = 4; }
        }
        if (j >= 2 && plen[j - 2] + plen[j - 1] === lt && JP[j - 1] === ft) {
          const jv = H[prow + j - 2] + ASR * (pw[j - 1] + pw[j - 2]); if (jv > v) { v = jv; b = 5; }
        }
      }
      if (v <= 0) { v = 0; b = 0; }
      H[row + j] = v; B[row + j] = b;
      if (v > best) { best = v; bi = i; bj = j; }
    }
  }
  if (best <= 0) return null;
  // traceback
  const ops = [];
  let i = bi, j = bj;
  while (i > 0 && j > 0) {
    const b = B[i * W + j];
    if (b === 0) break;
    if (b === 1) {
      const t = T[i - 1], p = P[j - 1];
      const soft = (t === p || (tol && sameSound(t, p))) ? "exact" : (tol ? wordSim(t, p, FT[i - 1], FP[j - 1]) : "diff");
      // real-word rule: the pair is REPORTED as a wording difference; `soft` keeps what it sounds like, which still
      // counts when deciding whether this passage is being quoted at all
      // (a grammatical variant of the source word — "أعنا" for "أعني" — is a real word form even when no text of the
      // corpus happens to contain it)
      if (isWord && (soft === "asr" || soft === "near") && (isWord(t) || (soft === "near" && inflectionOf(t, p)))) ops.push({ op: "diff", soft, ti: i - 1, pi: j - 1 });
      else ops.push({ op: soft, ti: i - 1, pi: j - 1 });
      i--; j--;
    } else if (b === 2) { ops.push({ op: "ins", ti: i - 1, pi: -1 }); i--; }
    else if (b === 3) { ops.push({ op: "del", ti: -1, pi: j - 1 }); j--; }
    else if (b === 4) { ops.push({ op: "joinT", ti: i - 2, ti2: i - 1, pi: j - 1 }); i -= 2; j--; }
    else { ops.push({ op: "joinP", ti: i - 1, pi: j - 2, pi2: j - 1 }); i--; j -= 2; }
  }
  ops.reverse();
  // trim both ends down to a solid match (exact / asr / join)
  const solid = o => o.op === "exact" || o.op === "asr" || o.op === "joinT" || o.op === "joinP";
  let a = 0, z = ops.length - 1;
  while (a <= z && !solid(ops[a])) a++;
  while (z >= a && !solid(ops[z])) z--;
  if (a > z) return null;
  const tr = ops.slice(a, z + 1);
  const tIdx = tr.flatMap(o => o.op === "joinT" ? [o.ti, o.ti2] : o.ti >= 0 ? [o.ti] : []);
  const pIdx = tr.flatMap(o => o.op === "joinP" ? [o.pi, o.pi2] : o.pi >= 0 ? [o.pi] : []);
  return { ts: Math.min(...tIdx), te: Math.max(...tIdx) + 1, ps: Math.min(...pIdx), pe: Math.max(...pIdx) + 1, ops: tr, score: best };
}

/** Summarise an alignment into counts used for the verdict. */
/**
 * Evidence = summed informativeness (idf) of the words that agree. For every matched pair the LESS informative
 * of the two words counts, so a common spoken word can never borrow weight from a rare look-alike in the source.
 * isFunction(op): optional test "is this pair a function word?" — `content` / `contentEvidence` count the agreeing
 * informative words that are not (without the test every informative word is a content word).
 */
export function summarize(al, FP, idf, noEvidence = () => false, FT = null, isFunction = null) {
  const c = { exact: 0, asr: 0, near: 0, join: 0, diff: 0, ins: 0, del: 0, evidence: 0, longestRun: 0, inf: 0, content: 0, contentEvidence: 0 };
  let run = 0;
  for (const o of al.ops) {
    const skip = noEvidence(o), before = c.evidence;
    const tw = FT && o.ti >= 0 ? idf(o.op === "joinT" ? FT[o.ti] + FT[o.ti2] : FT[o.ti]) : Infinity;
    const idfE = skip ? () => 0 : (o.op === "joinT" ? idf : w => Math.min(idf(w), tw));
    switch (o.op) {
      case "exact": c.exact++; c.evidence += idfE(FP[o.pi]); run++; break;
      case "asr": c.asr++; c.evidence += idfE(FP[o.pi]); run++; break;
      case "joinT": c.join++; c.evidence += idfE(FP[o.pi]); run++; break;
      // two source words heard as one: the spoken word decides how informative the pair is
      case "joinP": c.join += 2; c.evidence += skip ? 0 : (FT ? Math.min(tw, idf(FP[o.pi]) + idf(FP[o.pi2])) : idf(FP[o.pi]) + idf(FP[o.pi2])); run += 2; break;
      case "near": c.near++; c.evidence += 0.6 * idfE(FP[o.pi]); run++; break;
      case "diff": c.diff++; run = 0; break;
      case "ins": c.ins++; run = 0; break;
      case "del": c.del++; run = 0; break;
    }
    if (!skip && o.op !== "diff" && o.op !== "ins" && o.op !== "del") {
      c.inf += o.op === "joinP" ? 2 : 1;   // agreeing words outside cue phrases and formulas
      // ... and of those, the CONTENT words (not particles, prepositions, pronouns): only they show what is being quoted
      if (isFunction === null || !isFunction(o)) { c.content += o.op === "joinP" ? 2 : 1; c.contentEvidence += c.evidence - before; }
    }
    if (run > c.longestRun) c.longestRun = run;
  }
  c.matched = c.exact + c.asr + c.near + c.join;
  c.cols = c.matched + c.diff + c.ins + c.del;
  c.q = (c.exact + c.asr + c.join + 0.7 * c.near) / c.cols;
  return c;
}
