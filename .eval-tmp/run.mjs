// run.mjs — evaluation of the engine against baselines on synthetic lectures with simulated ASR noise.
//   node eval/run.mjs            full run (3 seeds × 4 noise levels × 5 systems) -> eval/results.json + eval/RESULTS.md
//   node eval/run.mjs --quick    1 seed, engine only (for calibration)
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadCorpus, ROOT } from "./lib.mjs";
import { buildLecture, asrNoise, rng } from "./gen.mjs";
import { analyze } from "../public/js/engine.js";
import { tokenizeTranscript, fold } from "../public/js/text.js";

const QUICK = process.argv.includes("--quick");
// seed 101 is the DEVELOPMENT lecture (thresholds were tuned on it); the reported run uses three unseen lectures
const SEEDS = QUICK ? [101] : [202, 303, 404];
const WERS = [0, 0.1, 0.2, 0.3];
const corpus = await loadCorpus();

// ---------------- systems: each returns [{ts,te,status,pids:[best,...parallels], cand:[pids for 'meaning']}] ----------------
const refToPid = new Map(corpus.P.map((p, i) => [(p.t === "q" ? "q" : "") + p.r, i]));
function pidsOfSource(s) {
  if (!s) return [];
  if (s.type === "q") { const out = []; for (let a = s.ayah; a <= s.ayahEnd; a++) out.push(refToPid.get(`q${s.surah}:${a}`)); return out; }
  return [refToPid.get(s.ref)];
}
function sysEngine(opts) {
  return (words, blocked) => analyze(words.map(w => ({ w })), corpus, { ...opts, blocked }).ledger.map(e => ({
    ts: e.ts, te: e.te, status: e.status,
    best: pidsOfSource(e.status === "meaning" ? null : e.source),
    all: [e.source, ...e.parallels].flatMap(s => e.status === "meaning" ? [] : pidsOfSource(s)),
    cand: (e.candidates || e.suggestions || []).map(c => pidsOfSource(c)[0]),
    attribution: e.attribution,
  }));
}
/** B0 — exact string search: a run of ≥6 words that occurs letter-for-letter in a passage. */
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
/** B1 — bag-of-words TF-IDF retrieval over a sliding window (the usual "semantic search" baseline, lexical version). */
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

const SYSTEMS = QUICK ? { "أثَر (المحرك الكامل)": sysEngine({}) } : {
  "أثَر (المحرك الكامل)": sysEngine({}),
  "استبعاد: بلا تسامح مع أخطاء التفريغ": sysEngine({ tolerant: false }),
  "استبعاد: بلا عبارات الاستشهاد": sysEngine({ useCues: false }),
  "استبعاد: بلا متجهات (ألفاظ فقط)": sysEngine({ useVectors: false }),
  "B0 بحث نصي حرفي": sysExact,
  "B1 استرجاع TF-IDF": sysTfidf,
};

// ---------------- scoring ----------------
const TEXTUAL = new Set(["verbatim", "partial"]);
function score(pred, items, map, nTok) {
  const m = { vq: [0, 0, 0, 0], vh: [0, 0, 0, 0], ph: [0, 0, 0, 0] }; // n, detected, top1, any
  const r = { classOK: 0, classN: 0, critWrongSource: 0, critOOC: 0, critFiller: 0, fillerLead: 0, fillerMeaning: 0,
    oocN: 0, oocAbstain: 0, oocPartial: 0, oocFlagged: 0, parN: 0, parTop1: 0, parTop3: 0, parTop5: 0, parMeaning: 0, parWrong: 0, parTextual: 0, parOtherTextual: 0,
    cueN: 0, cueClean: 0, startErr: 0, startN: 0, attrN: 0, attrOK: 0, weak: 0 };
  const used = new Set();
  const itemSpans = items.map(it => ({ it, a: map[it.a], b: map[it.b] }));
  const overlap = (p, s) => Math.max(0, Math.min(p.te, s.b) - Math.max(p.ts, s.a));
  for (const s of itemSpans) {
    const { it } = s; const len = Math.max(1, s.b - s.a);
    const ps = pred.map((p, i) => ({ p, i, ov: overlap(p, s) })).filter(x => x.ov > 0);
    ps.forEach(x => used.add(x.i));
    const textual = ps.filter(x => TEXTUAL.has(x.p.status)).sort((x, y) => y.ov - x.ov);
    if (it.kind === "vq" || it.kind === "vh" || it.kind === "ph") {
      const k = m[it.kind]; k[0]++;
      const good = textual.find(x => x.ov / len >= 0.5);
      if (good) {
        k[1]++;
        const t1 = good.p.best.some(p => it.accept.has(p)), any = good.p.all.some(p => it.accept.has(p));
        if (t1) k[2]++; if (any) k[3]++;
        if (!any) r.critWrongSource++;
        if (it.expect !== "either") { r.classN++; if (good.p.status === it.expect) r.classOK++; }
        r.startErr += Math.abs(good.p.ts - s.a); r.startN++;
        if (it.trailCol) { r.attrN++; if (good.p.attribution && good.p.attribution.agrees) r.attrOK++; }
      } else if (ps.some(x => x.p.status === "lead" && x.p.all.some(p => it.accept.has(p)))) r.weak++;
      // a second, wrong textual citation on the same quotation is also a critical error
      for (const x of textual) if (x !== good && x.ov / len >= 0.5 && !x.p.all.some(p => it.accept.has(p))) r.critWrongSource++;
    } else if (it.kind === "ooc") {
      r.oocN++;
      // critical: most of an out-of-corpus quotation is declared "verbatim". A PARTIAL match with another
      // narration is reported separately: it is honest output (the reviewer sees exactly which words agree).
      if (textual.some(x => x.p.status === "verbatim" && x.ov / len >= 0.6)) r.critOOC++;
      else if (textual.length) r.oocPartial++; else r.oocAbstain++;
      if (ps.some(x => x.p.status === "notfound")) r.oocFlagged++;
    } else if (it.kind === "par") {
      r.parN++;
      const tx = textual.find(x => x.p.all.some(p => it.accept.has(p)));
      // the correct source among the candidates/suggestions shown for this spot (whatever the status)
      const mm = ps.filter(x => x.p.cand && x.p.cand.length).sort((x, y) => y.ov - x.ov)[0];
      if (ps.some(x => x.p.status === "meaning")) r.parMeaning++;
      if (tx) { r.parTextual++; r.parTop1++; r.parTop3++; r.parTop5++; }
      else if (mm) { const k = mm.p.cand.findIndex(p => it.accept.has(p));
        if (k === 0) r.parTop1++; if (k >= 0 && k < 3) r.parTop3++; if (k >= 0 && k < 5) r.parTop5++; if (k < 0) r.parWrong++; }
      // a textual match inside a paraphrase is, by construction, text that really is in that passage; whether it is
      // the hadith the speaker meant cannot be decided automatically, so it is counted separately, not as an error
      for (const x of textual) if (!x.p.all.some(p => it.accept.has(p))) r.parOtherTextual++;
    } else if (it.kind === "cue") {
      r.cueN++;
      if (!ps.some(x => TEXTUAL.has(x.p.status) || x.p.status === "meaning")) r.cueClean++;
      if (textual.length) r.critFiller++;
    }
  }
  pred.forEach((p, i) => { if (used.has(i)) return;
    if (TEXTUAL.has(p.status)) r.critFiller++; else if (p.status === "lead") r.fillerLead++; else if (p.status === "meaning") r.fillerMeaning++; });
  return { m, r, nTok };
}

// ---------------- run ----------------
const results = [];
for (const seed of SEEDS) {
  const lec = buildLecture(corpus, seed, undefined, QUICK ? "dev" : "test");
  for (const wer of WERS) {
    const nz = wer ? asrNoise(lec.words, wer, rng(seed * 7 + Math.round(wer * 100))) : { words: lec.words, map: lec.words.map((_, i) => i).concat(lec.words.length) };
    for (const [name, sys] of Object.entries(SYSTEMS)) {
      const t0 = Date.now();
      const pred = sys(nz.words, lec.blocked);
      const sc = score(pred, lec.items, nz.map, nz.words.length);
      results.push({ seed, wer, system: name, ms: Date.now() - t0, words: nz.words.length, ...sc });
      if (QUICK) {
        const { m, r } = sc;
        console.log(`WER ${wer}  ${(Date.now() - t0)}ms  vq ${m.vq[1]}/${m.vq[0]} t1 ${m.vq[2]}  vh ${m.vh[1]}/${m.vh[0]} t1 ${m.vh[2]} any ${m.vh[3]}  ph ${m.ph[1]}/${m.ph[0]} any ${m.ph[3]} weak ${r.weak}` +
          `  class ${r.classOK}/${r.classN}  CRIT src ${r.critWrongSource} ooc ${r.critOOC} filler ${r.critFiller}  oocPartial ${r.oocPartial}  ooc flagged ${r.oocFlagged}/${r.oocN}` +
          `  par t1 ${r.parTop1} t3 ${r.parTop3} t5 ${r.parTop5} /${r.parN}  cueClean ${r.cueClean}/${r.cueN}  fillerLead ${r.fillerLead} fillerMeaning ${r.fillerMeaning}  startErr ${(r.startErr / Math.max(1, r.startN)).toFixed(2)} attr ${r.attrOK}/${r.attrN}`);
      }
    }
  }
}
if (!QUICK) {
  writeFileSync(path.join(ROOT, ".eval-tmp", "results.json"), JSON.stringify(results, null, 1));
  const { report } = await import("./report.mjs");
  writeFileSync(path.join(ROOT, ".eval-tmp", "RESULTS.md"), report(results, { seeds: SEEDS, wers: WERS, corpus }));
  console.log("wrote eval/results.json and eval/RESULTS.md");
}
