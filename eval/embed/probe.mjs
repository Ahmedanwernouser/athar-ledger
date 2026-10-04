// Feasibility probe (development lecture, seed 101, never reported): would a multilingual sentence-embedding model that runs
// FREE on Cloudflare Workers AI find the source of a quotation BY MEANING — with and without a cue before it — where the
// corpus-trained word vectors do not, and how often would it "find" a source for speech that quotes nothing?
//   A. the 26 development paraphrases, opener removed, each embedded as one query            -> rank of the true source
//   B. the WHOLE lecture cut into 20-word windows every 10 words (no knowledge of where a quotation is)
//      -> for windows that quote nothing: how high does the best similarity go?   (false alarms)
//      -> for each paraphrase: does some window over it put the true source first, above that level?   (found without a cue)
//   C. two real transcripts (YouTube, from the branch yt-probe-results), windows the same way: what would be shown
// Pool: every accepted source, the current system's best 60 candidates for each query (hard negatives), random hadith and ayahs.
// Runs on the test machine (GitHub Actions) against the deployed Worker's /embed route, asked as the site asks it. No secret
// is involved.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../lib.mjs";
import { buildLecture } from "../gen.mjs";
import { fold, stem, norm } from "../../public/js/text.js";

const HERE = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const redact = s => String(s);       // nothing secret is held here: the Worker is asked as the site asks it
const save = (name, data) => writeFileSync(path.join(OUT, name), redact(typeof data === "string" ? data : JSON.stringify(data, null, 1)) + "\n");
const lines = []; const say = s => { console.log(redact(s)); lines.push(redact(s)); save("SUMMARY.txt", lines.join("\n")); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T_START = Date.now(), BUDGET_MS = 40 * 60 * 1000;

// ---- Workers AI through the deployed Worker's /embed route (the deploy token has no Workers AI permission of its own) ----
const LIVE = String(process.env.LIVE_WORKER || "").replace(/\/+$/, ""), ORIGIN = String(process.env.LIVE_ORIGIN || "");
const MODELS = (process.env.EMBED_MODELS || "bge-m3 qwen3 gemma").split(/\s+/).filter(Boolean);
const stats = {};
// the Worker is deployed by another workflow started by the same push: wait until it offers embeddings
let offered = [];
for (let i = 0; i < 60; i++) {
  try { const h = await (await fetch(LIVE + "/health", { signal: AbortSignal.timeout(15000) })).json(); offered = h.embed || []; } catch { /* not yet */ }
  if (offered.length) break;
  await sleep(15000);
}
say(`the deployed Worker offers: ${offered.join(", ") || "no embedding model (the Workers AI binding is missing)"}`);
if (!offered.length) { save("SUMMARY.txt", lines.join("\n")); process.exit(0); }
async function call(model, body) {
  const st = stats[model] ||= { calls: 0, status: {}, firstError: null };
  for (let tries = 0; tries < 5; tries++) {
    let r;
    try { r = await fetch(LIVE + "/embed", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, model }), signal: AbortSignal.timeout(90000) }); }
    catch (e) { st.status.network = (st.status.network || 0) + 1; await sleep(2000); continue; }
    st.calls++; st.status[r.status] = (st.status[r.status] || 0) + 1;
    const txt = await r.text();
    if (r.ok) {
      try {
        const j = JSON.parse(txt);
        if (j.model !== model) { st.firstError ||= `asked for ${model}, answered by ${j.model}`; return null; }
        const bytes = Buffer.from(j.vectors, "base64"), out = [];
        for (let i = 0; i < j.n; i++) out.push(Float32Array.from({ length: j.dim }, (_, k) => (bytes[i * j.dim + k] << 24) >> 24));
        return out;
      } catch { st.firstError ||= "not JSON: " + txt.slice(0, 200); return null; }
    }
    st.firstError ||= `HTTP ${r.status}: ${txt.slice(0, 300).replace(/\s+/g, " ")}`;
    if (r.status === 429 || r.status >= 500) { await sleep(4000 * (tries + 1)); continue; }
    return null;
  }
  return null;
}
/** texts -> vectors, 48 per call; `kind` "q" (a query) or "d" (a passage) for the models that tell them apart */
async function embed(model, texts, kind, label) {
  const out = [];
  for (let i = 0; i < texts.length; i += 48) {
    if (Date.now() - T_START > BUDGET_MS) { say(`${model} ${label}: time budget reached at ${out.length}/${texts.length}`); return null; }
    const part = texts.slice(i, i + 48).map(t => t.slice(0, 1900));
    const data = await call(model, { texts: part, kind });
    if (!data || data.length !== part.length) { say(`${model} ${label}: gave up at ${out.length}/${texts.length} — ${stats[model].firstError || "no data"}`); return null; }
    for (const v of data) out.push(v);
    if (i % 960 === 0) console.log(`${model} ${label}: ${out.length}/${texts.length} after ${Math.round((Date.now() - T_START) / 1000)} s`);
  }
  return out;
}
const unit = (v, d) => { const x = d ? v.subarray(0, d) : v; let n = 0; for (const a of x) n += a * a; n = Math.sqrt(n) || 1; return Float32Array.from(x, a => a / n); };
const q8 = v => { let m = 0; for (const a of v) if (Math.abs(a) > m) m = Math.abs(a); return unit(Float32Array.from(v, a => Math.round((a / (m || 1)) * 127))); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null);

// ---- the material ----
const corpus = await loadCorpus(); corpus.ensureStems();
const SIZES = { vq: 40, vh: 60, ph: 40, par: 26, ooc: 30, cue: 14 };
const lec = buildLecture(corpus, 101, SIZES, "dev", { par: "strip" });
const W = lec.words.map(w => (typeof w === "string" ? w : w.w));
const par = lec.items.filter(x => x.kind === "par");
const queries = par.map(it => W.slice(it.a, it.b).join(" "));
const WIN = 20, STEP = 10;
const windowsOf = words => { const out = []; for (let i = 0; i < words.length; i += STEP) { out.push({ a: i, b: Math.min(words.length, i + WIN) }); if (i + WIN >= words.length) break; } return out; };
const wins = windowsOf(W);
const itemAt = new Int16Array(W.length).fill(-1); lec.items.forEach((it, k) => { for (let i = it.a; i < it.b; i++) itemAt[i] = k; });
for (const w of wins) {
  const cnt = new Map(); for (let i = w.a; i < w.b; i++) if (itemAt[i] >= 0) cnt.set(itemAt[i], (cnt.get(itemAt[i]) || 0) + 1);
  let best = -1, bn = 0; for (const [k, c] of cnt) if (c > bn) { bn = c; best = k; }
  w.item = best; w.overlap = bn; w.kind = best < 0 ? "none" : lec.items[best].kind;
}
// the current system's best candidates by shared stems (its lexical channel), as hard negatives
const lexTop = q => { const sc = new Map(); for (const w of new Set(q.split(" ").map(x => stem(fold(x))))) { const post = corpus.stemPost.get(w); if (!post) continue; const v = corpus.stemIdf(w); for (const pid of post) if (!lec.blocked.has(pid)) sc.set(pid, (sc.get(pid) || 0) + v); } return [...sc].sort((a, b) => b[1] - a[1]).slice(0, 60).map(x => x[0]); };
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pool = new Set();
for (const it of par) for (const p of it.accept) pool.add(p);
const lexRank = [];
queries.forEach((q, i) => { const top = lexTop(q); top.forEach(p => pool.add(p)); const acc = new Set(par[i].accept); lexRank.push(top.findIndex(p => acc.has(p))); });
const POOL = +(process.env.EMBED_POOL || 8000);
while (pool.size < POOL) { const pid = corpus.NQ + Math.floor(rnd() * (corpus.coreN - corpus.NQ)); if (!lec.blocked.has(pid)) pool.add(pid); }
for (let k = 0; k < 600; k++) pool.add(Math.floor(rnd() * corpus.NQ));
const pids = [...pool]; const texts0 = pids.map(p => corpus.P[p].n.split(" ").slice(0, 160).join(" "));
// two real transcripts (public lectures analysed from their links earlier; kept on a results branch, not in the code)
const real = [];
for (const id of ["ikgqwDVXs8E", "1foxMsRygJg"]) {
  try { const r = await fetch(`https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/yt-probe-results/yt/${id}.transcript.txt`); if (r.ok) { const words = norm(await r.text()).split(" ").filter(Boolean); real.push({ id, words, wins: windowsOf(words) }); } } catch { /* not there: skipped */ }
}
say(`queries ${queries.length}; lecture ${W.length} words in ${wins.length} windows (${wins.filter(w => w.kind === "none").length} quote nothing); pool ${pids.length} passages (~${Math.round(texts0.join(" ").split(" ").length / 1000)}k words); real transcripts ${real.map(r => r.id + " " + r.words.length + " words").join(", ") || "none"}`);
say(`for comparison, the current lexical channel alone (shared stems): source first ${lexRank.filter(r => r === 0).length}/${lexRank.length}, in 5 ${lexRank.filter(r => r >= 0 && r < 5).length}, in 60 ${lexRank.filter(r => r >= 0).length}`);

const report = {};
for (const model of MODELS.filter(m => offered.includes(m))) {
  const t0 = Date.now();
  const Q = await embed(model, queries, "q", "queries"); if (!Q) continue;
  const WV = await embed(model, wins.map(w => W.slice(w.a, w.b).join(" ")), "q", "windows"); if (!WV) continue;
  const RV = []; for (const r of real) RV.push(await embed(model, r.wins.map(w => r.words.slice(w.a, w.b).join(" ")), "q", "real " + r.id));
  const D = await embed(model, texts0, "d", "passages"); if (!D) continue;
  say(`${model}: embedded ${Q.length} queries, ${WV.length} windows, ${D.length} passages in ${Math.round((Date.now() - t0) / 1000)} s; vector length ${D[0].length}; calls ${stats[model].calls}, HTTP ${JSON.stringify(stats[model].status)}`);
  report[model] = {};
  const full = D[0].length;
  for (const [name, dim, quant] of [[`${full} float`, 0, false], ["256 int8 (first 256)", 256, true], ["384 int8 (first 384)", 384, true]]) {
    if (dim && dim >= full) continue;
    const d = D.map(v => (quant ? q8(unit(v, dim)) : unit(v, dim))), prepQ = v => unit(v, dim);
    const best = qv => { let s1 = -2, k1 = -1; for (let k = 0; k < d.length; k++) { const s = dot(qv, d[k]); if (s > s1) { s1 = s; k1 = k; } } return [s1, k1]; };
    // A. one query per paraphrase
    const ranks = [], gold = [];
    Q.map(prepQ).forEach((qv, i) => { const acc = new Set(par[i].accept), sims = d.map((dv, k) => [dot(qv, dv), k]).sort((a, b) => b[0] - a[0]); const r = sims.findIndex(([, k]) => acc.has(pids[k])); ranks.push(r); gold.push(r >= 0 ? +sims[r][0].toFixed(3) : 0); });
    const at = k => ranks.filter(r => r >= 0 && r < k).length;
    // B. the whole lecture in windows
    const wb = WV.map(prepQ).map(best);
    const none = wins.map((w, i) => (w.kind === "none" ? wb[i][0] : null)).filter(x => x != null).sort((a, b) => a - b);
    const levels = { p90: pct(none, 0.9), p99: pct(none, 0.99), max: none.at(-1) };
    const perPar = par.map((it, pi) => { const k = lec.items.indexOf(it), acc = new Set(it.accept); let top = 0, any = 0; wins.forEach((w, i) => { if (w.item !== k || w.overlap < 8) return; if (wb[i][0] > any) any = wb[i][0]; if (acc.has(pids[wb[i][1]]) && wb[i][0] > top) top = wb[i][0]; }); return { top: +top.toFixed(3), any: +any.toFixed(3) }; });
    const sweep = {}; for (const [ln, lv] of Object.entries(levels)) sweep[ln] = { level: +lv.toFixed(3), paraphrasesFoundFirst: perPar.filter(x => x.top > lv).length, paraphrasesWithAWrongFirstAbove: perPar.filter(x => x.any > lv && x.top < x.any).length, windowsThatQuoteNothingAbove: none.filter(x => x > lv).length };
    // by the kind of item under the window: how high is the best similarity where a text IS quoted word for word?
    const byKind = {}; for (const kd of ["vq", "vh", "ph", "ooc", "cue"]) { const a = wins.map((w, i) => (w.kind === kd && w.overlap >= 8 ? wb[i][0] : null)).filter(x => x != null).sort((x, y) => x - y); if (a.length) byKind[kd] = { n: a.length, median: +pct(a, 0.5).toFixed(3) }; }
    report[model][name] = { paraphraseAsOneQuery: { first: at(1), in3: at(3), in5: at(5), in10: at(10), n: ranks.length, ranks, goldSim: gold }, windowsThatQuoteNothing: { n: none.length, median: +pct(none, 0.5).toFixed(3), ...Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, +v.toFixed(3)])) }, sweep, perParaphraseBestWindow: perPar, windowSimilarityByItemKind: byKind };
    say(`${model} | ${name}: A) paraphrase as one query: source first ${at(1)}/${ranks.length}, in 3 ${at(3)}, in 5 ${at(5)}, in 10 ${at(10)}; similarity of the true source: min ${Math.min(...gold)} median ${[...gold].sort((a, b) => a - b)[gold.length >> 1]}`);
    say(`${model} | ${name}: B) windows that quote nothing (${none.length}): best similarity median ${pct(none, 0.5).toFixed(3)}, p90 ${levels.p90.toFixed(3)}, p99 ${levels.p99.toFixed(3)}, max ${levels.max.toFixed(3)}; ` + Object.entries(sweep).map(([k, v]) => `above ${k} (${v.level}): ${v.paraphrasesFoundFirst}/${par.length} paraphrases found with the true source first, ${v.paraphrasesWithAWrongFirstAbove} with a wrong text first, ${v.windowsThatQuoteNothingAbove} empty windows`).join(" | ") + `; by item kind ${JSON.stringify(byKind)}`);
    // C. real transcripts: what would be shown above the level that no empty window of the lecture reaches
    if (!dim) real.forEach((r, ri) => { if (!RV[ri]) return; const rb = RV[ri].map(prepQ).map(best); const sims = rb.map(x => x[0]).sort((a, b) => a - b);
      const shown = rb.map((x, i) => ({ sim: +x[0].toFixed(3), said: r.words.slice(r.wins[i].a, r.wins[i].b).join(" "), source: corpus.P[pids[x[1]]].r, text: corpus.P[pids[x[1]]].n.split(" ").slice(0, 30).join(" ") })).sort((a, b) => b.sim - a.sim).slice(0, 12);
      report[model][name]["real_" + r.id] = { windows: rb.length, median: +pct(sims, 0.5).toFixed(3), max: +sims.at(-1).toFixed(3), aboveLectureMax: sims.filter(x => x > levels.max).length, top: shown };
      say(`${model} | ${name}: C) real transcript ${r.id}: ${rb.length} windows, best similarity median ${pct(sims, 0.5).toFixed(3)}, max ${sims.at(-1).toFixed(3)}, above the lecture's empty-window max: ${sims.filter(x => x > levels.max).length}`); });
  }
  save("probe.json", { queries, report, lexRank, stats });
}
for (const m of MODELS) if (!report[m]) say(`${m}: no result — ${stats[m] ? stats[m].firstError || JSON.stringify(stats[m].status) : "not called"}`);
save("probe.json", { queries, report, lexRank, stats });
save("SUMMARY.txt", lines.join("\n"));
