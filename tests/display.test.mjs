// node --test tests/display.test.mjs
// Original (diacritised) hadith text for display: public/js/display.js over the files written by tools/build_display.py.
// Data root: $ATHAR_OUT, else the staging build next to the repository (../athar-staging/public/data), else
// public/data. Without a display/ folder in any of them the tests are SKIPPED (the site works without it).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { HadithDisplay, wordsOf } from "../public/js/display.js";
import { norm } from "../public/js/text.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = [process.env.ATHAR_OUT, path.resolve(ROOT, "..", "athar-staging", "public", "data"), path.join(ROOT, "public", "data")].filter(Boolean);
const DATA = roots.find(d => existsSync(path.join(d, "display", "meta.json")) && existsSync(path.join(d, "meta.json")));
const skip = DATA ? false : "no display/ folder yet (build it: ATHAR_OUT=<staging>/public/data python3 tools/build_display.py)";
if (DATA) console.log(`display tests read ${DATA}`);

const fetcher = async (name, kind) => {
  const b = await readFile(path.join(DATA, name));
  return kind === "json" ? JSON.parse(b.toString("utf8")) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
// the core passages of the SAME data root (read directly: these tests do not need the indexes)
let P = [], NQ = 0;
if (DATA) {
  const meta = JSON.parse(readFileSync(path.join(DATA, "meta.json"), "utf8"));
  NQ = meta.quran_passages;
  for (let i = 0; i < meta.shards; i++) P = P.concat(JSON.parse(readFileSync(path.join(DATA, `passages_${i}.json`), "utf8")));
}
const DIACRITIC = /[\u064b-\u0652]/;
const MARKS = new RegExp(DIACRITIC.source + "+", "g");
const canon = s => s.replace(MARKS, m => [...m].sort().join("")).replace(/الْأ/g, "الأ");
const WORDING = canon("إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ");
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

test("bukhari:1: original text with diacritics, start points at the matn", { skip }, async () => {
  const disp = new HadithDisplay(fetcher);
  assert.equal(await disp.ready(), true);
  const pid = P.findIndex(p => p.r === "bukhari:1");
  const e = await disp.get("bukhari:1");
  assert.ok(e, "bukhari:1 has display text");
  assert.deepEqual(await disp.get(pid), e, "the passage id and the reference give the same entry");
  assert.equal(e.ref, "bukhari:1");
  // the order of two marks on one letter (shadda + vowel) is canonicalised before comparing, and the dataset writes
  // «الْأَعْمَالُ» in al-Bukhari where other editions write «الأَعْمَالُ»: the sukun on that lam is ignored
  assert.ok(canon(e.text).includes(WORDING), `diacritised wording as in the dataset: ${e.text.slice(e.start, e.start + 60)}`);
  assert.ok(!/[\u200e\u200f\u202a-\u202e\ufeff]/.test(e.text) && !/\s\s/.test(e.text), "no bidi marks, single spaces");
  assert.ok(e.start > 0, "the chain of narrators precedes the matn");
  const matn = e.text.slice(e.start);
  assert.ok(canon(matn).replace(/^" ?/, "").startsWith(WORDING), `the matn starts at «إنما الأعمال بالنيات»: ${matn.slice(0, 60)}`);
  assert.ok(e.text.slice(0, e.start).split(" ").some(w => norm(w) === "حدثنا"), "the chain is before start");
  assert.ok(!e.text.slice(e.start).split(" ").some(w => norm(w) === "حدثنا"), "and not after it");
  assert.equal(norm(matn), P[pid].n);
  const w = await disp.words(pid);
  assert.equal(canon(w.find(x => norm(x) === "انما")), canon("إِنَّمَا"));
  assert.deepEqual(w.map(norm), P[pid].n.split(" "));
});

test("500 random hadith passages: norm(original[start:]) is the indexed text, words() aligns", { skip }, async () => {
  const disp = new HadithDisplay(fetcher), rand = rng(20261004);
  let exact = 0, bare = 0;
  for (let t = 0; t < 500; t++) {
    const pid = NQ + Math.floor(rand() * (P.length - NQ)), p = P[pid];
    const e = await disp.get(t % 2 ? pid : p.r);                 // by passage id and by reference alternately
    assert.ok(e, `${p.r}: display text`);
    assert.equal(e.ref, p.r);
    assert.equal(norm(e.text.slice(e.start)), p.n, `${p.r}: text after start`);
    if (p.m === 0) assert.equal(e.start, 0, `${p.r}: indexed in full, start must be 0`);
    if (!DIACRITIC.test(e.text)) bare++;
    const w = await disp.words(pid, p.n);
    if (!e.exact) { assert.equal(w, null, `${p.r}: no word list when the mapping is not exact`); continue; }
    exact++;
    assert.deepEqual(w.map(norm), p.n.split(" "), `${p.r}: word mapping`);
    assert.equal(await disp.words(pid, w.length + 1), null, "a different word count answers null");
  }
  assert.ok(exact >= 490, `word mapping exact for ${exact} of 500`);
  assert.ok(bare <= 5, `${bare} of 500 texts have no diacritics at all`);
  assert.ok(disp._shards.size <= disp.meta.shards, "shards are cached, one entry per file");
});

test("every file matches display/meta.json; passage id -> shard needs no table", { skip }, async () => {
  const disp = new HadithDisplay(fetcher);
  await disp.ready();
  const m = disp.meta;
  assert.equal(m.pid_base, NQ);
  assert.equal(m.count, P.length - NQ, "one entry per core hadith passage");
  assert.equal(m.shards, Math.ceil(m.count / m.K));
  for (const pid of [NQ, NQ + m.K - 1, NQ + m.K, P.length - 1]) {
    const e = await disp.get(pid);
    assert.equal(e && e.ref, P[pid].r, `pid ${pid}`);
    assert.deepEqual(disp.peek(P[pid].r), e, "peek() answers from memory once the file is loaded");
  }
  for (const [name, f] of Object.entries(m.files)) assert.ok(f.bytes <= 25 * 1024 * 1024, `${name} is under the 25 MiB limit`);
});

test("unknown reference or passage id -> null", { skip }, async () => {
  const disp = new HadithDisplay(fetcher);
  for (const x of ["bukhari:999999", "bukhari:0", "nosuch:1", "bukhari", "2:255", "", 0, NQ - 1, P.length, -1, 1.5, null, undefined, {}])
    assert.equal(await disp.get(x), null, `get(${JSON.stringify(x)})`);
  assert.equal(await disp.words("nosuch:1"), null);
  assert.equal(wordsOf(null), null);
});

test("fetch failure or absent folder -> null, never throws; a later attempt can succeed", { skip }, async () => {
  let calls = 0;
  const absent = new HadithDisplay(async () => { calls++; throw new Error("404"); });
  assert.equal(await absent.ready(), false);
  assert.equal(await absent.get("bukhari:1"), null);
  assert.equal(await absent.get(NQ), null);
  assert.equal(await absent.words(NQ), null);
  assert.equal(absent.peek(NQ), undefined);
  assert.equal(calls, 1, "a missing meta.json is not fetched again and again");
  const sync = new HadithDisplay(() => { throw new Error("offline"); });       // a fetcher that throws synchronously
  assert.equal(await sync.get("bukhari:1"), null);
  const junk = new HadithDisplay(async () => ({ hello: 1 }));                  // not our format
  assert.equal(await junk.get("bukhari:1"), null);
  // meta loads, the shard does not: null for that passage, the others keep working
  let fail = true, shardCalls = 0;
  const flaky = new HadithDisplay(async (name, kind) => {
    if (/h_0\.json$/.test(name)) { shardCalls++; if (fail) throw new Error("network"); }
    return fetcher(name, kind);
  });
  assert.equal(await flaky.get("bukhari:1"), null);
  assert.equal(await flaky.get("bukhari:2"), null);
  assert.equal(shardCalls, 1, "a failed file is not requested again immediately");
  assert.ok(await flaky.get(P.length - 1), "another shard still loads");
  fail = false; flaky._shards.get(0).at = 0;                                   // as if the retry delay had passed
  assert.equal((await flaky.get("bukhari:1")).ref, "bukhari:1");
});
