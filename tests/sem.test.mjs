// Sentence vectors (public/js/sem.js): the rows of the core, the nearest-passage search, the Worker's answer, and how the
// engine uses them — only to ORDER the candidates of a text that a cue announced and no passage matched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SEM, semRows, semText, SemIndex, unpackVectors, fetchVectors } from "../public/js/sem.js";
import { loadCorpus, loadSem, DATA } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";

const corpus = await loadCorpus();
const run = (t, o = {}) => analyze(t.split(/\s+/).map(w => ({ w })), corpus, o).ledger;
const TAIL = "ثم مضى الشيخ في شرح هذه المسألة وبيان ما فيها من الفوائد والأحكام";

test("rows: every passage of the core once, a long one in overlapping pieces that reach its end", () => {
  const rows = semRows(corpus);
  const meta = JSON.parse(readFileSync(path.join(DATA, "sem.json"), "utf8"));
  assert.equal(rows.length, meta.rows, "the shipped vectors were built for these rows");
  assert.equal(meta.passages, corpus.coreN);
  assert.equal(readFileSync(path.join(DATA, "sem.bin")).length, meta.rows * meta.dim);
  assert.equal(new Set(rows.map(r => r.pid)).size, corpus.coreN);
  let long = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], n = corpus.tok(r.pid).length, first = i === 0 || rows[i - 1].pid !== r.pid, last = i === rows.length - 1 || rows[i + 1].pid !== r.pid;
    assert.ok(r.b - r.a <= SEM.LONG && r.a >= 0 && r.b <= n);
    if (first) assert.equal(r.a, 0);
    if (last) assert.equal(r.b, n);
    if (!first) { long++; assert.ok(r.a < rows[i - 1].b, "pieces overlap"); }
  }
  assert.ok(long > 500, "there are long passages");
});

test("nearest passages: cosine, the best row of a passage counts, a filter is honoured", () => {
  // 4 rows of 3 numbers; rows 1 and 2 belong to the same passage
  const bytes = Int8Array.from([127, 0, 0, 0, 127, 0, 90, 90, 0, 0, 0, 127]);
  const ix = new SemIndex(bytes, 3, Int32Array.from([10, 20, 20, 30]), "m");
  const t = ix.top(Int8Array.from([100, 100, 0]), 3);
  assert.deepEqual(t.map(h => h.pid), [20, 10, 30]);
  assert.ok(Math.abs(t[0].score - 1) < 1e-6 && Math.abs(t[1].score - Math.SQRT1_2) < 1e-6 && Math.abs(t[2].score) < 1e-6);
  assert.deepEqual(ix.top(Int8Array.from([100, 100, 0]), 3, pid => pid !== 20).map(h => h.pid), [10, 30]);
  assert.deepEqual(ix.top(Int8Array.from([0, 0, 50]), 1).map(h => h.pid), [30]);
});

test("the Worker's answer: n × dim signed bytes in base64; anything else is no vectors", async () => {
  const b64 = Buffer.from(Int8Array.from([127, -64, 0, 1, 2, -127]).buffer).toString("base64");
  assert.deepEqual(unpackVectors(b64, 2, 3).map(v => [...v]), [[127, -64, 0], [1, 2, -127]]);
  assert.equal(unpackVectors(b64, 2, 4), null);
  const real = globalThis.fetch, calls = [];
  try {
    globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); const b = JSON.parse(init.body); return new Response(JSON.stringify({ model: b.model, dim: 3, n: b.texts.length, vectors: Buffer.from(Int8Array.from(b.texts.flatMap((_, i) => [i + 1, 0, 0])).buffer).toString("base64") }), { status: 200 }); };
    const m = await fetchVectors(["a", "b", "a"], { url: "https://w.dev/", model: "bge-m3", dim: 3 });
    assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://w.dev/embed"); assert.deepEqual(calls[0].body, { texts: ["a", "b"], kind: "q", model: "bge-m3", dim: 3 });
    assert.deepEqual([...m.get("a")], [1, 0, 0]); assert.deepEqual([...m.get("b")], [2, 0, 0]);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "embed_unavailable" }), { status: 503 });
    assert.equal((await fetchVectors(["a"], { url: "https://w.dev", model: "bge-m3", dim: 3 })).size, 0, "the allowance used up: no vectors, no error");
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal((await fetchVectors(["a"], { url: "https://w.dev", model: "bge-m3", dim: 3 })).size, 0);
    globalThis.fetch = async (u, init) => new Response(JSON.stringify({ model: "other", dim: 3, n: 1, vectors: "AAAA" }), { status: 200 });
    assert.equal((await fetchVectors(["a"], { url: "https://w.dev", model: "bge-m3", dim: 3 })).size, 0, "another model's vectors are not used");
  } finally { globalThis.fetch = real; }
});

test("the engine asks only about what follows a cue that announced a text no passage matched", () => {
  const want = new Set();
  const t = `قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى ${TAIL} وبين النبي صلى الله عليه وسلم أن الإنسان يحاسب على قصده وما أراده بقلبه لا على ظاهر فعله فقط ${TAIL}`;
  const l = run(t, { sem: { want } });
  assert.ok(l.some(e => e.status === "verbatim"), "the hadith said word for word is found as before");
  assert.ok(want.size >= 1 && want.size <= SEM.PREFIXES.length, "one cue asked, at up to three lengths");
  for (const x of want) assert.ok(x.startsWith("ان الانسان يحاسب"), "only the words after the second cue: " + x);
  assert.ok(![...want].some(x => x.includes("الاعمال بالنيات")), "nothing of the text that was matched");
  // no cue, no question: plain speech is never sent
  const w2 = new Set(); run(`وكنا نتحدث أمس عن أحوال الناس في الأسواق ${TAIL}`, { sem: { want: w2 } });
  assert.equal(w2.size, 0);
  // a scholar's saying is looked for in books, which have no sentence vectors
  const w3 = new Set(); run(`قال الحسن بن علي البربهاري رحمه الله إن العلم ليس بكثرة الرواية وإنما هو نور يقذفه الله في القلب ${TAIL}`, { sem: { want: w3 } });
  assert.equal(w3.size, 0);
});

test("with vectors the candidates follow the sentence model; the status and everything textual stay as they were", () => {
  const t = `وبين النبي صلى الله عليه وسلم أن الإنسان يحاسب على قصده وما أراده بقلبه لا على ظاهر فعله فقط ${TAIL}`;
  const want = new Set(), base = run(t, { sem: { want } });
  // a made-up index that puts one chosen passage first for every stretch asked
  const target = corpus.coreRef.get("bukhari:1"), dim = 4;
  const ix = { model: "fake", dim, top: (q, k, ok) => (ok(target) ? [{ pid: target, score: 0.9 }] : []) };
  const l = run(t, { sem: { index: ix, lookup: x => (want.has(x) ? new Int8Array(dim) : null) } });
  assert.equal(l.length, base.length);
  const e = l.find(x => x.status === "notfound" || x.status === "meaning"), b = base.find(x => x.status === "notfound" || x.status === "meaning");
  assert.equal(e.status, b.status, "vectors never change what an entry is called");
  const list = e.suggestions || e.candidates;
  assert.equal(list[0].ref, "bukhari:1"); assert.equal(list[0].via, "sentence");
  // a stretch without a vector: the engine's own order, exactly as without the option
  const l2 = run(t, { sem: { index: ix, lookup: () => null } });
  assert.deepEqual((l2.find(x => x.suggestions || x.candidates).suggestions || []).map(s => s.ref), (b.suggestions || []).map(s => s.ref));
});

test("the evaluation's offline loader gives the shipped index", async () => {
  const sem = await loadSem(corpus);
  assert.ok(sem && sem.index.rows > 40000 && sem.index.dim === 384 && sem.index.model === "bge-m3");
  assert.equal(sem.lookup("نص لم يُضمَّن قط"), null); assert.equal(sem.missed.size, 1);
  assert.equal(semText(["a", "b"]), "a b");
});
