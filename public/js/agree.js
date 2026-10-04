// agree.js — the agreement check between TWO transcriptions of the same recording.
//
// One transcription cannot tell a slip of the transcriber from a real difference in what the speaker said: under the
// strict rule every changed word makes a quotation "partial". Two transcriptions made independently are evidence:
//   • both have the source's word                                   -> the speaker said it
//   • one has the source's word, the other something else            -> the transcribers disagree; the speaker most likely said the source's word
//   • both have the SAME word and it is not the source's             -> a confirmed difference of wording
//   • both differ from the source and from each other                -> not settled
//
// Both ledgers come from running the same engine on the two transcripts. Entries are compared per SOURCE-WORD position
// (diff[i].srcPos, attached by worker.js only when the place in the source is established exactly). Nothing here guesses:
// an entry without positions is not compared, entries of different sources are never paired.
//
// Pure and deterministic: compareLedgers() reads its arguments and returns new objects; applyAgreement() is the one
// function that writes onto ledger entries.
import { norm, wordSim } from "./text.js";

export const BOTH_EXACT = "BOTH_EXACT", ONE_EXACT = "ONE_EXACT", BOTH_DIFFER_SAME = "BOTH_DIFFER_SAME",
  BOTH_DIFFER_DIFFERENT = "BOTH_DIFFER_DIFFERENT", ONLY_ONE_COVERS = "ONLY_ONE_COVERS";
export const DEFAULTS = {
  tolerance: 3,        // seconds by which the time spans of two entries may miss each other
  minOverlap: 0.3,     // a pair must share at least this part of the shorter entry (time; source words when there are no times)
};
const TEXTUAL = new Set(["verbatim", "partial"]);
const isNum = x => typeof x === "number" && Number.isFinite(x);
const same = x => norm(String(x || "")) || String(x || "").trim();

/** the status every list, filter, count and export shows: the one supported by two transcriptions when there is one */
export const statusOf = e => (e ? e.statusCombined || e.status : undefined);

/**
 * The time tolerance that fits a transcript: 3 s for real word times; when the words were spread evenly over longer
 * windows (subtitle cues, a transcriber without word times) their times are only approximate, and the tolerance grows to
 * the length of those windows (at most 30 s).
 */
export function timeTolerance(words, base = DEFAULTS.tolerance) {
  if (!Array.isArray(words) || words.length < 8) return base;
  let even = 0, n = 0, run = 0, longest = 0, runStart = null;
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1], b = words[i];
    if (!isNum(a.start) || !isNum(a.end) || !isNum(b.start) || !isNum(b.end)) { run = 0; continue; }
    n++;
    const da = a.end - a.start, db = b.end - b.start;
    if (Math.abs(da - db) < 0.025 && Math.abs(b.start - a.end) < 0.015 && da > 0) {      // (times are often rounded to 1/100 s)
      even++; if (!run) runStart = a.start; run++;
      if (b.end - runStart > longest) longest = b.end - runStart;
    } else run = 0;
  }
  if (!n || even / n < 0.6) return base;
  return Math.min(30, Math.max(base, Math.round(longest)));
}

/**
 * One entry as the comparison sees it, or null when it cannot be compared (not a textual match, or its words have no
 * exact positions in the source).
 *   pos   Map(position -> {has, strict, spoken, i})   has: the transcript has the source's word there (exact, a split or
 *         glued word, or a non-word the engine excused as mis-heard); strict: exact or split/glued; spoken "" = left out
 *   ins   [{after, spoken, i}]  words with no source word, each after source position `after`
 */
function model(e, index) {
  if (!e || !TEXTUAL.has(e.status) || !e.posKey || !Array.isArray(e.diff) || !e.source || e.manual) return null;
  const pos = new Map(), ins = [], src = new Map();
  let last = null, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < e.diff.length; i++) {
    const d = e.diff[i];
    if (!d.source) {
      if (d.spoken) ins.push({ after: last, spoken: same(d.spoken), i });
      continue;
    }
    const toks = d.source.split(" ");
    if (!Number.isInteger(d.srcPos) || toks.length !== (d.srcN || 1)) return null;
    const said = d.spoken ? same(d.spoken) : "", join = toks.length > 1 || (d.spoken || "").includes(" ");
    const has = d.kind === "exact" || d.kind === "asr" || d.kind === "near";
    const strict = d.kind === "exact" || (d.kind === "asr" && join);
    for (let j = 0; j < toks.length; j++) {
      const p = d.srcPos + j;
      if (pos.has(p) || (last != null && p !== last + 1)) return null;      // the compared words are one stretch of the source, in order
      pos.set(p, { has: !!d.spoken && has, strict: !!d.spoken && strict, spoken: said, i });
      src.set(p, toks[j]);
      last = p; if (p < lo) lo = p; if (p > hi) hi = p;
    }
  }
  if (!pos.size) return null;
  for (const x of ins) if (x.after == null) x.after = lo - 1;
  const timed = isNum(e.start) && isNum(e.end);
  return { e, index, key: e.posKey, pos, ins, src, lo, hi, timed, start: timed ? e.start : null, end: timed ? Math.max(e.start, e.end) : null };
}

/** may these two be the same quotation? -> a score (larger = better), or null */
function compatible(a, b, o) {
  if (a.key !== b.key) return null;
  const A = a.e.source, B = b.e.source;
  if (A.type !== B.type) return null;
  if (A.type === "q") { if (A.surah !== B.surah || A.ayah > (B.ayahEnd || B.ayah) || B.ayah > (A.ayahEnd || A.ayah)) return null; }
  else if (A.ref !== B.ref) return null;
  const shared = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) + 1;
  if (shared < 1) return null;
  const part = shared / Math.min(a.pos.size, b.pos.size);
  if (a.timed && b.timed) {
    const ov = Math.min(a.end, b.end) - Math.max(a.start, b.start), shorter = Math.min(a.end - a.start, b.end - b.start);
    if (ov < -o.tolerance || ov + o.tolerance < o.minOverlap * shorter) return null;
    return { time: shorter > 0 ? Math.min(1, ov / shorter) : ov >= 0 ? 1 : 0, part, timed: true };
  }
  if (a.timed !== b.timed) return null;
  return part < o.minOverlap ? null : { time: 0, part, timed: false };
}
const rangesMeet = (x, y) => x.lo <= y.hi && y.lo <= x.hi;

/**
 * @param primary  ledger of the primary transcript (entries decorated by worker.js: posKey, diff[i].srcPos)
 * @param second   ledger of the second transcript, from the same engine
 * @param opts     {tolerance, minOverlap}
 * @returns {
 *   entries: one item per primary entry — null (not a textual match) or {agreement2, statusCombined}
 *   extra:   entries of the second ledger (textual) that no primary entry stands for; `placed` false when they have no times
 *   stats:   {textual, paired, upgraded, confirmed, unresolved, disagree, unpaired, extra}
 * }
 */
export function compareLedgers(primary, second, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  primary = Array.isArray(primary) ? primary : []; second = Array.isArray(second) ? second : [];
  const A = primary.map(model), B = second.map(model);

  // ---- pairing: every primary entry with the second-transcript entries that stand for the same words of the same source
  const cands = [];
  for (const a of A) if (a) for (const b of B) if (b) { const s = compatible(a, b, o); if (s) cands.push({ a, b, s }); }
  cands.sort((x, y) => y.s.time - x.s.time || y.s.part - x.s.part || x.a.index - y.a.index || x.b.index - y.b.index);
  const partnersOf = new Map(), ownersOf = new Map(), dropped = new Set();
  // without times nothing tells two recitations of the same words apart: such a choice is not made
  for (const c of cands) if (!c.s.timed) for (const d of cands) {
    if (d === c || d.s.timed) continue;
    if ((d.a === c.a && d.b !== c.b && rangesMeet(d.b, c.b)) || (d.b === c.b && d.a !== c.a && rangesMeet(d.a, c.a))) { dropped.add(c); break; }
  }
  for (const c of cands) {
    if (dropped.has(c)) continue;
    const ps = partnersOf.get(c.a) || [], os = ownersOf.get(c.b) || [];
    if (ps.some(b => rangesMeet(b, c.b)) || os.some(a => rangesMeet(a, c.a))) continue;      // those words already have their counterpart
    ps.push(c.b); partnersOf.set(c.a, ps); os.push(c.a); ownersOf.set(c.b, os);
  }

  const stats = { textual: 0, paired: 0, upgraded: 0, confirmed: 0, unresolved: 0, disagree: 0, unpaired: 0, extra: 0 };
  const overlapsInTime = (x, y) => {
    if (!isNum(x.start) || !isNum(x.end) || !isNum(y.start) || !isNum(y.end)) return false;
    const ov = Math.min(x.end, y.end) - Math.max(x.start, y.start), shorter = Math.min(x.end - x.start, y.end - y.start);
    return ov > 0 && ov >= o.minOverlap * shorter;
  };
  const entries = primary.map((e, index) => {
    if (!e || !TEXTUAL.has(e.status) || e.manual) return null;
    stats.textual++;
    const a = A[index], partners = a ? (partnersOf.get(a) || []).slice().sort((x, y) => x.lo - y.lo || x.index - y.index) : [];
    if (!partners.length) {
      stats.unpaired++;
      const other = second.find(x => x && TEXTUAL.has(x.status) && x.source && overlapsInTime(e, x));
      const why = !a ? "nopos" : other ? (other.source.ref === e.source.ref ? "nopos" : "other") : "absent";
      const agreement2 = { paired: false, why };
      if (why === "other") agreement2.otherRef = other.source.ref;
      return { agreement2, statusCombined: e.status };
    }
    const r = classify(a, partners, ownersOf);
    stats.paired++; stats.confirmed += r.confirmed; stats.unresolved += r.unresolved; stats.disagree += r.disagree;
    const statusCombined = r.verdict === "verbatim_supported" ? "verbatim" : e.status;
    if (statusCombined !== e.status) stats.upgraded++;
    return { agreement2: r, statusCombined };
  });

  // ---- entries only the second transcript has
  const extra = [];
  second.forEach((x, j) => {
    if (!x || !TEXTUAL.has(x.status) || !x.source || (B[j] && ownersOf.has(B[j]))) return;
    if (primary.some(e => e && e.status !== "notfound" && e.status !== "lead" && overlapsInTime(e, x))) return;
    // (without times: the same words of the same source in the primary are the same quotation)
    if (B[j] && !B[j].timed && A.some(a => a && a.key === B[j].key && rangesMeet(a, B[j]))) return;
    extra.push({ index: j, entry: x, placed: isNum(x.start) && isNum(x.end) });
  });
  stats.extra = extra.length;
  return { entries, extra, stats };
}

/** what the two transcripts have at every source position of one primary entry and its counterparts */
function classify(a, partners, ownersOf) {
  const bPos = new Map(), bIns = new Map(), bSrc = new Map();
  for (const b of partners) {
    for (const [p, x] of b.pos) if (!bPos.has(p)) { bPos.set(p, x); bSrc.set(p, b.src.get(p)); }
    for (const x of b.ins) { const l = bIns.get(x.after) || []; l.push(x.spoken); bIns.set(x.after, l); }
  }
  // words of the second transcript that another primary entry stands for are that entry's business
  const elsewhere = new Set();
  for (const b of partners) for (const other of ownersOf.get(b) || []) if (other !== a) for (const p of other.pos.keys()) elsewhere.add(p);
  const all = new Set(a.pos.keys());
  for (const p of bPos.keys()) if (!elsewhere.has(p)) all.add(p);

  const positions = [], count = { [BOTH_EXACT]: 0, [ONE_EXACT]: 0, [BOTH_DIFFER_SAME]: 0, [BOTH_DIFFER_DIFFERENT]: 0, [ONLY_ONE_COVERS]: 0 };
  let unresolved = 0, soft = 0, near = 0;
  for (const p of [...all].sort((x, y) => x - y)) {
    const x = a.pos.get(p) || null, y = bPos.get(p) || null;
    let c;
    if (!x || !y) { c = ONLY_ONE_COVERS; if (x && !x.has) unresolved++; }
    else if (x.has && y.has) { c = x.strict === y.strict ? BOTH_EXACT : ONE_EXACT; if (!x.strict && !y.strict) soft++; }
    else if (x.has || y.has) c = ONE_EXACT;
    else if (x.spoken === y.spoken) c = BOTH_DIFFER_SAME;       // the same other word, or left out by both
    else { c = BOTH_DIFFER_DIFFERENT; unresolved++; }
    count[c]++;
    const item = { p, c, s: (x ? a.src.get(p) : bSrc.get(p)) || "", a: x ? x.spoken : null, b: y ? y.spoken : null, i: x ? x.i : -1 };
    // a confirmed difference whose word SOUNDS like the source's (one letter apart, or the same after phonetic folding):
    // two transcribers can share such a spelling, so it is counted apart — informational, the verdict does not change
    if (c === BOTH_DIFFER_SAME && x.spoken && !x.spoken.includes(" ") && wordSim(x.spoken, item.s) !== "diff") { item.near = true; near++; }
    positions.push(item);
  }
  // words with no source word: confirmed only when both transcripts have the same word at the same place
  const aIns = new Map();
  for (const x of a.ins) { const l = aIns.get(x.after) || []; l.push(x); aIns.set(x.after, l); }
  const added = []; let confirmedAdded = 0, addedDisagree = 0;
  const gaps = new Set(aIns.keys());
  for (const g of bIns.keys()) if (g >= a.lo - 1 && g <= a.hi) gaps.add(g);
  for (const g of [...gaps].sort((x, y) => x - y)) {
    const mine = aIns.get(g) || [], theirs = (bIns.get(g) || []).slice(), covered = bPos.has(g) || bPos.has(g + 1);
    const left = [];
    for (const x of mine) {
      const k = theirs.indexOf(x.spoken);
      if (k >= 0) { theirs.splice(k, 1); confirmedAdded++; added.push({ after: g, c: "confirmed", a: x.spoken, b: x.spoken, i: x.i }); }
      else left.push(x);
    }
    const both = left.length && theirs.length;
    for (const x of left) {
      const c = both || !covered ? "unresolved" : "disagree";
      if (c === "unresolved") unresolved++; else addedDisagree++;
      added.push({ after: g, c, a: x.spoken, b: both ? theirs.join(" ") : covered ? "" : null, i: x.i });
    }
    if (!left.length) for (const w of theirs) { addedDisagree++; added.push({ after: g, c: "disagree", a: "", b: w, i: -1 }); }
    else if (both && theirs.length > left.length) unresolved += theirs.length - left.length;
  }
  const confirmed = count[BOTH_DIFFER_SAME] + confirmedAdded;
  const verdict = confirmed ? "difference_confirmed" : unresolved ? "unresolved" : "verbatim_supported";
  const es = partners.map(b => b.e);
  return {
    paired: true, verdict, confirmed, confirmedNear: near, unresolved, oneExact: count[ONE_EXACT],
    disagree: count[ONE_EXACT] + count[BOTH_DIFFER_DIFFERENT] + addedDisagree,
    oneSided: addedDisagree,      // an added word only one transcript has: the other one agrees with the source there
    bothExact: count[BOTH_EXACT], onlyOne: count[ONLY_ONE_COVERS], excused: soft, positions, added,
    second: {
      wordStart: Math.min(...es.map(x => x.wordStart)), wordEnd: Math.max(...es.map(x => x.wordEnd)),
      start: es.every(x => isNum(x.start)) ? Math.min(...es.map(x => x.start)) : null,
      end: es.every(x => isNum(x.end)) ? Math.max(...es.map(x => x.end)) : null,
      status: es.map(x => x.status), refs: es.map(x => x.source.ref),
    },
  };
}

/**
 * Write the comparison onto the primary ledger: entry.agreement2 and entry.statusCombined (the strict entry.status of the
 * primary transcript is never changed). With `result` null every trace of an earlier comparison is removed.
 */
export function applyAgreement(primary, result) {
  primary.forEach((e, i) => {
    const r = result && result.entries[i];
    if (r) { e.agreement2 = r.agreement2; e.statusCombined = r.statusCombined; }
    else { delete e.agreement2; delete e.statusCombined; }
  });
  return primary;
}

/**
 * How each compared word of a primary entry stands after the comparison, by index in entry.diff:
 *   {c: "confirmed" | "disagree" | "unresolved" | "other", b}    b: what the second transcript has there ("" = nothing,
 *   null = it does not cover the place). "other": the primary has the source's word and the second something else.
 */
export function marksOf(e) {
  const out = new Map(), g = e && e.agreement2;
  if (!g || !g.paired) return out;
  for (const x of g.positions) {
    if (x.i < 0 || x.c === BOTH_EXACT) continue;
    const d = e.diff[x.i], mineOk = d && (d.kind === "exact" || d.kind === "asr" || d.kind === "near");
    let c;
    if (x.c === BOTH_DIFFER_SAME) c = "confirmed";
    else if (x.c === ONE_EXACT) c = mineOk && d.kind === "exact" ? "other" : "disagree";
    else if (x.c === ONLY_ONE_COVERS) { if (mineOk) continue; c = "unresolved"; }
    else c = "unresolved";
    if (!out.has(x.i)) out.set(x.i, { c, b: x.b });
  }
  for (const x of g.added) if (x.i >= 0) out.set(x.i, { c: x.c, b: x.b });
  return out;
}
