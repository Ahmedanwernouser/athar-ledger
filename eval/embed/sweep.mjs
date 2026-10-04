// Development study (lecture of seed 101, never reported): can sentence vectors find a quotation by meaning with NO cue before
// it, by sweeping the whole lecture in windows?  Offline: the window vectors are in eval/embed/cache/dev101.bin.
//   node eval/embed/sweep.mjs            -> prints the table, writes eval/results_sweep.json
// For each window the nearest passage of the core is found; a rule then decides whether to show it. Counted for each rule:
//   found   paraphrases (of 24, opener removed) for which some window over them is shown with the TRUE source first
//   wrong   paraphrases shown only with another text first
//   false   windows that quote nothing and are shown anyway (and how many separate places that is)
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadCorpus, loadSem, EVAL, writeJson } from "../lib.mjs";
import { buildLecture } from "../gen.mjs";
import { fold, stem } from "../../public/js/text.js";

const corpus = await loadCorpus(); corpus.ensureStems();
const sem = await loadSem(corpus);
if (!sem) { console.error("public/data/sem.bin is missing"); process.exit(1); }
const req = JSON.parse(readFileSync(path.join(EVAL, "embed", "requests", "dev101.json"), "utf8"));
const lec = buildLecture(corpus, 101, { vq: 40, vh: 60, ph: 40, par: 26, ooc: 30, cue: 14 }, "dev", { par: "strip" });
const W = lec.words.map(w => (typeof w === "string" ? w : w.w));
const par = lec.items.filter(x => x.kind === "par");
const ok = pid => !lec.blocked.has(pid);
const itemAt = new Int16Array(W.length).fill(-1); lec.items.forEach((it, k) => { for (let i = it.a; i < it.b; i++) itemAt[i] = k; });
const pst = new Map(), PS = pid => { let s = pst.get(pid); if (!s) pst.set(pid, s = new Set(corpus.tok(pid).map(x => stem(fold(x))))); return s; };
const shared = (a, b, pid) => { let n = 0; const ps = PS(pid); for (const s of new Set(W.slice(a, b).map(x => stem(fold(x))).filter(x => x.length >= 3))) if (ps.has(s) && corpus.stemIdf(s) >= 3) n++; return n; };

const out = { model: sem.index.model, dim: sem.index.dim, paraphrases: par.length, asOneQuery: null, sweep: {} };
// the paraphrase as ONE query (its exact words): what the vectors can do when the place is known
{ const ranks = par.map((it, i) => { const v = sem.lookup(req.texts[req.labels.indexOf(`q:${i}`)]); const acc = new Set(it.accept); return v ? sem.index.top(v, 10, ok).findIndex(h => acc.has(h.pid)) : -2; });
  const at = k => ranks.filter(r => r >= 0 && r < k).length;
  out.asOneQuery = { first: at(1), in3: at(3), in5: at(5), in10: at(10), n: ranks.length };
  console.log(`the paraphrase's own words as one query, against the whole core: true source first ${at(1)}/${ranks.length}, in 3 ${at(3)}, in 5 ${at(5)}, in 10 ${at(10)}`); }
if (sem.missed.size) { console.error(`${sem.missed.size} texts have no vector in eval/embed/cache/dev101.bin`); process.exit(1); }
for (const S of [12, 20, 32]) {
  const wins = [];
  req.labels.forEach((l, i) => { const m = new RegExp(`^w${S}:(\\d+)$`).exec(l); if (!m) return;
    const a = +m[1], b = Math.min(W.length, a + S), cnt = new Map(); for (let k = a; k < b; k++) if (itemAt[k] >= 0) cnt.set(itemAt[k], (cnt.get(itemAt[k]) || 0) + 1);
    let item = -1, ov = 0; for (const [k, c] of cnt) if (c > ov) { ov = c; item = k; }
    const t = sem.index.top(sem.lookup(req.texts[i]), 3, ok);
    wins.push({ i: wins.length, a, b, item, ov, kind: item < 0 ? "none" : lec.items[item].kind, pid: t[0].pid, sim: t[0].score, top3: t.map(h => h.pid) }); });
  wins.forEach((w, k) => { w.lex = shared(w.a, w.b, w.pid); w.agree = [wins[k - 1], wins[k + 1]].some(x => x && x.top3.includes(w.pid)); });
  const none = wins.filter(w => w.kind === "none"), over = wins.filter(w => w.kind === "par" && w.ov >= Math.min(8, S / 2));
  const sims = none.map(w => w.sim).sort((a, b) => a - b);
  const rows = [];
  const rule = (name, f) => { const fp = none.filter(f); let places = 0; fp.forEach((w, k) => { if (!k || fp[k - 1].i !== w.i - 1) places++; });
    const found = new Set(), wrong = new Set(); for (const w of over) if (f(w)) (new Set(lec.items[w.item].accept).has(w.pid) ? found : wrong).add(w.item); for (const k of found) wrong.delete(k);
    rows.push({ rule: name, found: found.size, wrong: wrong.size, falseWindows: fp.length, falsePlaces: places }); };
  for (const t of [0.68, 0.70, 0.72, 0.74]) rule(`similarity >= ${t}`, w => w.sim >= t);
  for (const t of [0.60, 0.66]) rule(`similarity >= ${t} and 2 shared rare stems`, w => w.sim >= t && w.lex >= 2);
  for (const t of [0.60, 0.64]) rule(`similarity >= ${t}, 2 shared rare stems, and the next window agrees`, w => w.sim >= t && w.lex >= 2 && w.agree);
  out.sweep[S] = { windows: wins.length, quoteNothing: none.length, bestSimilarityOfThose: { median: +sims[sims.length >> 1].toFixed(3), p99: +sims[Math.floor(sims.length * 0.99)].toFixed(3), max: +sims.at(-1).toFixed(3) }, rules: rows };
  console.log(`\nwindows of ${S} words: ${wins.length}, of which ${none.length} quote nothing (their best similarity: median ${sims[sims.length >> 1].toFixed(3)}, max ${sims.at(-1).toFixed(3)})`);
  for (const r of rows) console.log(`  ${r.rule.padEnd(72)} found ${String(r.found).padStart(2)}/${par.length}  wrong ${r.wrong}  false ${r.falseWindows} windows in ${r.falsePlaces} places`);
}
writeJson("results_sweep.json", out);
