// Feasibility probe (development lecture, seed 101, never reported): would a strong multilingual sentence-embedding model
// find the source of a quotation BY MEANING where the corpus-trained word vectors do not?
// Queries: the 24 development paraphrases with their opener removed. Pool: every accepted source, the current system's best
// 60 candidates for each query (hard negatives) and 4,000 random hadith / 600 random ayahs. Also embedded: 120 stretches of
// the same lecture that quote nothing, to see how high a false similarity goes.
// Runs on the test machine (GitHub Actions). Keys come from repository secrets and are never printed or saved.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../lib.mjs";
import { buildLecture } from "../gen.mjs";
import { fold, stem } from "../../public/js/text.js";

const HERE = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const KEYS = String(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "").split(/[\s,;]+/).filter(k => k.length > 10);
const redact = s => { let t = String(s); for (const k of KEYS) t = t.split(k).join("<KEY>"); return t; };
const save = (name, data) => writeFileSync(path.join(OUT, name), redact(typeof data === "string" ? data : JSON.stringify(data, null, 1)) + "\n");
const lines = []; const say = s => { console.log(redact(s)); lines.push(redact(s)); };
if (!KEYS.length) { save("SUMMARY.txt", "no key"); process.exit(0); }
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- which embedding models does the key see? ----
let models = [];
try { models = (await (await fetch(BASE + "/models?pageSize=300", { headers: { "x-goog-api-key": KEYS[0] } })).json()).models.filter(m => (m.supportedGenerationMethods || []).some(x => /embed/i.test(x))).map(m => m.name.replace("models/", "")); } catch { /* keep going */ }
say("embedding models visible: " + models.join(", "));
const MODEL = process.env.EMBED_MODEL || ["gemini-embedding-2", "gemini-embedding-001", "text-embedding-004"].find(m => models.includes(m)) || models[0];
say("model used: " + MODEL);

let keyAt = 0, calls = 0;
async function embed(texts, taskType, dim) {
  const out = [];
  for (let i = 0; i < texts.length; i += 100) {
    const body = { requests: texts.slice(i, i + 100).map(t => ({ model: "models/" + MODEL, content: { parts: [{ text: t }] }, taskType, ...(dim ? { outputDimensionality: dim } : {}) })) };
    for (let tries = 0; ; tries++) {
      const r = await fetch(`${BASE}/models/${MODEL}:batchEmbedContents`, { method: "POST", headers: { "x-goog-api-key": KEYS[keyAt], "Content-Type": "application/json" }, body: JSON.stringify(body) });
      calls++;
      if (r.ok) { const j = await r.json(); for (const e of j.embeddings) out.push(Float32Array.from(e.values)); break; }
      const txt = (await r.text()).slice(0, 300);
      if (tries > 12) throw new Error(`embed failed ${r.status}: ${txt}`);
      if (r.status === 429 || r.status === 503 || r.status === 500) { keyAt = (keyAt + 1) % KEYS.length; await sleep(tries < KEYS.length ? 1500 : 20000); continue; }
      throw new Error(`embed failed ${r.status}: ${txt}`);
    }
  }
  return out;
}
const unit = (v, d) => { const x = d ? v.subarray(0, d) : v; let n = 0; for (const a of x) n += a * a; n = Math.sqrt(n) || 1; return Float32Array.from(x, a => a / n); };
const q8 = v => Float32Array.from(v, a => Math.max(-127, Math.min(127, Math.round(a * 127))) / 127);
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// ---- the material ----
const corpus = await loadCorpus(); corpus.ensureStems();
const SIZES = { vq: 40, vh: 60, ph: 40, par: 26, ooc: 30, cue: 14 };
const lec = buildLecture(corpus, 101, SIZES, "dev", { par: "strip" });
const W = lec.words.map(w => (typeof w === "string" ? w : w.w));
const par = lec.items.filter(x => x.kind === "par");
const queries = par.map(it => W.slice(it.a, it.b).join(" "));
// stretches that quote nothing: 16 words, not touching any item
const inItem = new Uint8Array(W.length); for (const it of lec.items) for (let i = Math.max(0, it.a - 4); i < Math.min(W.length, it.b + 4); i++) inItem[i] = 1;
const fillers = []; for (let i = 0; i + 16 < W.length && fillers.length < 120; i += 37) { let ok = true; for (let k = i; k < i + 16; k++) if (inItem[k]) { ok = false; break; } if (ok) fillers.push(W.slice(i, i + 16).join(" ")); }
// the current system's best candidates by shared stems (its lexical channel), as hard negatives
const lexTop = q => { const sc = new Map(); for (const w of new Set(q.split(" ").map(x => stem(fold(x))))) { const post = corpus.stemPost.get(w); if (!post) continue; const v = corpus.stemIdf(w); for (const pid of post) if (!lec.blocked.has(pid) && !corpus.quranLike(pid)) sc.set(pid, (sc.get(pid) || 0) + v); } return [...sc].sort((a, b) => b[1] - a[1]).slice(0, 60).map(x => x[0]); };
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pool = new Set();
for (const it of par) for (const p of it.accept) pool.add(p);
const lexRank = [];
queries.forEach((q, i) => { const top = lexTop(q); top.forEach(p => pool.add(p)); const acc = new Set(par[i].accept); lexRank.push(top.findIndex(p => acc.has(p))); });
while (pool.size < 4600) { const pid = corpus.NQ + Math.floor(rnd() * (corpus.coreN - corpus.NQ)); if (!lec.blocked.has(pid)) pool.add(pid); }
for (let k = 0; k < 600; k++) pool.add(Math.floor(rnd() * corpus.NQ));
const pids = [...pool], texts = pids.map(p => corpus.P[p].n.split(" ").slice(0, 220).join(" "));
say(`queries ${queries.length}, fillers ${fillers.length}, pool ${pids.length} passages`);

const t0 = Date.now();
const D = await embed(texts, "RETRIEVAL_DOCUMENT", 768);
const Q = await embed(queries, "RETRIEVAL_QUERY", 768);
const F = await embed(fillers, "RETRIEVAL_QUERY", 768);
say(`embedded in ${Math.round((Date.now() - t0) / 1000)} s with ${calls} calls; vector length ${D[0].length}`);

const report = {};
for (const [name, dim, quant] of [["768 float", 768, false], ["256 float", 256, false], ["256 int8", 256, true], ["128 int8", 128, true]]) {
  const prep = v => { const u = unit(v, dim); return quant ? unit(q8(u)) : u; };
  const d = D.map(prep), q = Q.map(v => unit(v, dim)), f = F.map(v => unit(v, dim));
  const ranks = [], top1 = [], gold = [];
  q.forEach((qv, i) => {
    const acc = new Set(par[i].accept), sims = d.map((dv, k) => [dot(qv, dv), k]).sort((a, b) => b[0] - a[0]);
    const r = sims.findIndex(([, k]) => acc.has(pids[k])); ranks.push(r); top1.push(+sims[0][0].toFixed(3)); gold.push(+sims[r][0].toFixed(3));
  });
  const fmax = f.map(fv => { let m = -1; for (const dv of d) { const s = dot(fv, dv); if (s > m) m = s; } return +m.toFixed(3); }).sort((a, b) => a - b);
  const at = k => ranks.filter(r => r >= 0 && r < k).length;
  report[name] = { first: at(1), in3: at(3), in5: at(5), in10: at(10), n: ranks.length, ranks, goldSim: gold, top1Sim: top1,
    fillerMaxSim: { median: fmax[fmax.length >> 1], p90: fmax[Math.floor(fmax.length * 0.9)], max: fmax.at(-1) } };
  say(`${name}: source first ${at(1)}/${ranks.length}, in 3 ${at(3)}, in 5 ${at(5)}, in 10 ${at(10)} | similarity of the true source: min ${Math.min(...gold)} median ${[...gold].sort((a, b) => a - b)[gold.length >> 1]} | speech that quotes nothing, best similarity: median ${fmax[fmax.length >> 1]} p90 ${fmax[Math.floor(fmax.length * 0.9)]} max ${fmax.at(-1)}`);
}
say(`for comparison, the current lexical channel alone (shared stems): source first ${lexRank.filter(r => r === 0).length}/${lexRank.length}, in 5 ${lexRank.filter(r => r >= 0 && r < 5).length}, in 60 ${lexRank.filter(r => r >= 0).length}`);
save("probe.json", { model: MODEL, queries, report, lexRank });
save("SUMMARY.txt", lines.join("\n"));
