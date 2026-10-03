// slim.mjs — scratch runner: engine only, the scoring of the pre-review eval/run.mjs, engine and data chosen by env.
//   ENGINE_DIR=<dir with engine.js corpus.js ...>  DATA_DIR=<public/data>  node .eval-tmp/slim.mjs
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildLecture, asrNoise, rng } from "./gen.mjs";
const ED = process.env.ENGINE_DIR || "/home/claude/athar-ledger/public/js", DATA = process.env.DATA_DIR || "/home/claude/athar-ledger/public/data";
const { Corpus } = await import(ED + "/corpus.js");
const { analyze } = await import(ED + "/engine.js");
const corpus = await Corpus.load(async (name, kind) => { const b = await readFile(path.join(DATA, name)); return kind === "json" ? JSON.parse(b.toString("utf8")) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
const SEEDS = (process.env.SEEDS || "202,303,404").split(",").map(Number), WERS = [0, 0.1, 0.2, 0.3];
const refToPid = new Map(corpus.P.map((p, i) => [(p.t === "q" ? "q" : "") + p.r, i]));
function pidsOfSource(s) {
  if (!s) return [];
  if (s.type === "q") { const out = []; for (let a = s.ayah; a <= s.ayahEnd; a++) out.push(refToPid.get(`q${s.surah}:${a}`)); return out; }
  return [refToPid.get(s.ref)];
}
const sys = (words, blocked) => analyze(words.map(w => ({ w })), corpus, { blocked }).ledger.map(e => ({
  ts: e.ts, te: e.te, status: e.status, best: pidsOfSource(e.status === "meaning" ? null : e.source),
  all: [e.source, ...e.parallels].flatMap(s => e.status === "meaning" ? [] : pidsOfSource(s)),
  cand: (e.candidates || e.suggestions || []).map(c => pidsOfSource(c)[0]), attribution: e.attribution, ref: e.source && e.source.ref, spoken: e.spoken, note: e.noteCode }));
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


const rows = [], detail = [];
for (const seed of SEEDS) {
  const lec = buildLecture(corpus, seed, undefined, "test");
  for (const wer of WERS) {
    const nz = wer ? asrNoise(lec.words, wer, rng(seed * 7 + Math.round(wer * 100))) : { words: lec.words, map: lec.words.map((_, i) => i).concat(lec.words.length) };
    const t0 = Date.now();
    const pred = sys(nz.words, lec.blocked);
    const sc = score(pred, lec.items, nz.map, nz.words.length);
    rows.push({ seed, wer, ms: Date.now() - t0, ...sc });
    // per-item outcome, to compare two runs item by item
    for (const it of lec.items) { const a = nz.map[it.a], b = nz.map[it.b]; const ps = pred.filter(p => Math.min(p.te, b) - Math.max(p.ts, a) > 0);
      detail.push({ seed, wer, kind: it.kind, a: it.a, text: it.frag.slice(0, 12).join(" "), expect: it.expect, got: ps.map(p => `${p.status}:${p.ref || ""}${p.note ? ":" + p.note : ""}`).join(" | ") }); }
  }
}
const pct = (a, b) => (b ? 100 * a / b : 0), avg = xs => xs.reduce((x, y) => x + y, 0) / xs.length;
console.log(`engine ${ED}\ndata ${DATA}\n| noise | Qur'an detected | verbatim hadith detected | changed hadith detected | first source correct | classification correct | critical errors / lecture (src+ooc+filler) | by-meaning first suggestion | top3 | attribution ok | s / lecture |`);
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const wer of WERS) {
  const R = rows.filter(r => r.wer === wer), f = g => avg(R.map(g)).toFixed(1);
  console.log(`| ${Math.round(wer * 100)}% | ${f(r => pct(r.m.vq[1], r.m.vq[0]))} | ${f(r => pct(r.m.vh[1], r.m.vh[0]))} | ${f(r => pct(r.m.ph[1], r.m.ph[0]))} | ${f(r => pct(r.m.vq[2] + r.m.vh[2] + r.m.ph[2], r.m.vq[1] + r.m.vh[1] + r.m.ph[1]))} | ${f(r => pct(r.r.classOK, r.r.classN))} | ${f(r => r.r.critWrongSource + r.r.critOOC + r.r.critFiller)} (${R.map(r => r.r.critWrongSource).join("/")} + ${R.map(r => r.r.critOOC).join("/")} + ${R.map(r => r.r.critFiller).join("/")}) | ${f(r => pct(r.r.parTop1, r.r.parN))} | ${f(r => pct(r.r.parTop3, r.r.parN))} | ${R.map(r => r.r.attrOK + "/" + r.r.attrN).join(" ")} | ${f(r => r.ms / 1000)} |`);
}
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(detail, null, 0));
