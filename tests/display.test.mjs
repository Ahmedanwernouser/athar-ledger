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

// ---------------- the pure functions the worker uses to show the original text (no data files needed) ----------------
import { originalOf, originalRange, originalFull, hadithDiffDisplay, excerptOriginal, sourceRun, retryingFetcher } from "../public/js/worker.js";

// a small hadith: chain, then a matn in which one stretch is repeated ("من كان يؤمن بالله")
const ORIG = 'حَدَّثَنَا زَيْدٌ قَالَ قَالَ رَسُولُ اللَّهِ صلى الله عليه وسلم " مَنْ كَانَ يُؤْمِنُ بِاللَّهِ فَلْيَقُلْ خَيْرًا، وَمَنْ كَانَ يُؤْمِنُ بِاللَّهِ فَلْيُكْرِمْ جَارَهُ " .';
const entryOf = (text, start = 0, exact = true) => ({ ref: "x:1", text, start, exact });
const toksOf = (text, start = 0) => norm(text.slice(start)).split(" ");

test("originalOf: one original word per indexed word; ranges are cut on word boundaries; the chain is left out of the full text", () => {
  const toks = toksOf(ORIG), o = originalOf(entryOf(ORIG), toks, 3);
  assert.ok(o, "mapped");
  assert.equal(o.words.length, toks.length);
  assert.deepEqual(o.words.map(norm), toks);
  assert.equal(o.words[toks.indexOf("خيرا")], "خَيْرًا،", "punctuation stays attached to its word");
  const a = toks.indexOf("من"), b = toks.indexOf("خيرا");
  assert.equal(originalRange(o, a, b), "مَنْ كَانَ يُؤْمِنُ بِاللَّهِ فَلْيَقُلْ خَيْرًا،");
  // the punctuation that stands alone between two words is kept; a quotation mark without its partner is not
  assert.equal(originalRange(o, a - 1, a), "وسلم مَنْ");
  assert.equal(originalRange(o, a - 1, toks.length - 1).split('"').length, 1, "an unpaired quotation mark is dropped");
  assert.ok(originalFull(originalOf(entryOf(ORIG), toks, 0)).includes('" مَنْ كَانَ'), "the full text is the dataset's text, quotation marks included");
  assert.ok(originalFull(o).startsWith("قَالَ رَسُولُ اللَّهِ"), "the first 3 words (the chain) are left out");
  assert.equal(originalFull(originalOf(entryOf(ORIG), toks, 0)), ORIG);
  assert.equal(originalRange(o, 5, 2), "");
  assert.equal(originalRange(o, 0, toks.length), "");
  // start > 0: only the text after the chain was indexed
  const start = ORIG.indexOf("قَالَ رَسُولُ");
  const o2 = originalOf(entryOf(ORIG, start), toksOf(ORIG, start));
  assert.equal(originalFull(o2), ORIG.slice(start));
  // not exact, another word count, a word that is not the indexed word at its position: no mapping at all
  assert.equal(originalOf(entryOf(ORIG, 0, false), toks), null);
  assert.equal(originalOf(entryOf(ORIG), toks.slice(1)), null);
  assert.equal(originalOf(entryOf(ORIG), toks.map((w, i) => (i === 4 ? "اخر" : w))), null);
  assert.equal(originalOf(null, toks), null);
});

test("hadithDiffDisplay: each source word of the comparison gets the original word AT ITS POSITION", () => {
  const toks = toksOf(ORIG), o = originalOf(entryOf(ORIG), toks, 3);
  const at = toks.indexOf("فليقل") - 4;       // "من كان يؤمن بالله فليقل خيرا"
  const diff = [
    { kind: "exact", spoken: "من", source: "من" }, { kind: "exact", spoken: "كان", source: "كان" }, { kind: "exact", spoken: "يؤمن", source: "يؤمن" },
    { kind: "exact", spoken: "بالله", source: "بالله" }, { kind: "exact", spoken: "فليقل", source: "فليقل" }, { kind: "ins", spoken: "كلاما", source: "" },
    { kind: "diff", spoken: "طيبا", source: "خيرا" }, { kind: "del", spoken: "", source: "ومن" }, { kind: "asr", spoken: "كانيؤمن", source: "كان يؤمن" },
  ];
  const r = hadithDiffDisplay(diff, toks, o.words);
  assert.deepEqual(r, { at, len: 9, unique: true });
  assert.deepEqual(diff.map(d => d.sourceDisplay), ["مَنْ", "كَانَ", "يُؤْمِنُ", "بِاللَّهِ", "فَلْيَقُلْ", undefined, "خَيْرًا،", "وَمَنْ", "كَانَ يُؤْمِنُ"]);
  for (const d of diff) if (d.source) assert.equal(norm(d.sourceDisplay), d.source, "the shown word is the compared word");
  assert.equal(originalRange(o, r.at, r.at + r.len - 1), "مَنْ كَانَ يُؤْمِنُ بِاللَّهِ فَلْيَقُلْ خَيْرًا، وَمَنْ كَانَ يُؤْمِنُ");
  // a stretch that stands twice with the same original words: shown (the words are the same wherever it is), flagged not unique
  const twice = [{ kind: "exact", spoken: "كان", source: "كان" }, { kind: "exact", spoken: "يؤمن", source: "يؤمن" }, { kind: "exact", spoken: "بالله", source: "بالله" }];
  assert.equal(hadithDiffDisplay(twice, toks, o.words).unique, false);
  assert.deepEqual(twice.map(d => d.sourceDisplay), ["كَانَ", "يُؤْمِنُ", "بِاللَّهِ"]);
  // … with different original words in the two places ("من" / "ومن" normalise apart, so use a doctored text): nothing is shown
  const two = "قَالَ الرَّجُلُ خَيْرًا ثُمَّ قَالَ الرَّجُلَ شَرًّا", t2 = toksOf(two), o2 = originalOf(entryOf(two), t2);
  const amb = [{ kind: "exact", spoken: "قال", source: "قال" }, { kind: "exact", spoken: "الرجل", source: "الرجل" }];
  assert.equal(hadithDiffDisplay(amb, t2, o2.words), false);
  assert.ok(amb.every(d => d.sourceDisplay === undefined), "no word is attached when its place is not certain");
  // words that are not in the passage, an empty comparison, a word list of another length
  assert.equal(hadithDiffDisplay([{ kind: "exact", spoken: "صدقه", source: "صدقه" }], toks, o.words), false);
  assert.equal(hadithDiffDisplay([{ kind: "ins", spoken: "قال", source: "" }], toks, o.words), false);
  assert.equal(hadithDiffDisplay(twice.map(d => ({ ...d })), toks, o.words.slice(1)), false);
  assert.equal(hadithDiffDisplay(null, toks, o.words), false);
});

test("excerptOriginal: the engine's excerpt in the original wording, cut at the same words, the chain left out", () => {
  const toks = toksOf(ORIG), o = originalOf(entryOf(ORIG), toks, 3), N = toks.length;
  const mid = toks.slice(12, 16).join(" ");
  assert.equal(excerptOriginal(`… ${mid} …`, toks, o), `… ${originalRange(o, 12, 15)} …`);
  // from the first word: the chain is not shown, and the text then starts at the matn without "…"
  assert.equal(excerptOriginal(toks.slice(0, 9).join(" ") + " …", toks, o), originalRange(o, 3, 8) + " …");
  assert.equal(excerptOriginal(toks.join(" "), toks, o), originalRange(o, 3, N - 1));
  assert.equal(excerptOriginal("… " + toks.slice(N - 3).join(" "), toks, o), "… " + originalRange(o, N - 3, N - 1));
  // an excerpt whose words stand twice with the same wording is placed by where it was cut
  assert.ok(excerptOriginal("… كان يؤمن بالله …", toks, o).includes("كَانَ يُؤْمِنُ بِاللَّهِ"));
  // not placed: null, and the caller keeps the stored excerpt
  assert.equal(excerptOriginal("… كلمات ليست في النص …", toks, o), null);
  assert.equal(excerptOriginal("", toks, o), null);
  assert.equal(excerptOriginal(undefined, toks, o), null);
  assert.equal(excerptOriginal(mid, toks, null), null);
  // a text that may stand anywhere (not anchored): found in the middle without "…" marks around it
  assert.equal(excerptOriginal(mid, toks, o, false), `… ${originalRange(o, 12, 15)} …`);
});

test("sourceRun: only a verbatim hadith whose every word is tied one to one; retryingFetcher repeats a failed request once", async () => {
  const d = (kind, spoken, source, sd = source && source + "ٌ") => ({ kind, spoken, source, sourceDisplay: sd, spokenDisplay: spoken });
  const e = { status: "verbatim", diffDisplay: true, source: { type: "h", ref: "x:1" }, diff: [d("exact", "تبسمك", "تبسمك"), d("asr", "في", "في"), d("near", "وجه", "وجه")] };
  assert.equal(sourceRun(e), "تبسمكٌ فيٌ وجهٌ");
  assert.equal(sourceRun({ ...e, status: "partial" }), null);
  assert.equal(sourceRun({ ...e, diffDisplay: false }), null);
  assert.equal(sourceRun({ ...e, source: { type: "q", ref: "1:1" } }), null);
  assert.equal(sourceRun({ ...e, source: { type: "h", ref: "x:1", via: "en" } }), null);
  assert.equal(sourceRun({ ...e, diff: [...e.diff, d("ins", "يا", "")] }), null, "an added word");
  assert.equal(sourceRun({ ...e, diff: [...e.diff, d("del", "", "صدقه")] }), null, "an omitted word");
  assert.equal(sourceRun({ ...e, diff: [...e.diff, d("diff", "حسنه", "صدقه")] }), null, "a changed word");
  assert.equal(sourceRun({ ...e, diff: e.diff.map((x, i) => (i ? x : { ...x, spokenDisplay: undefined })) }), null, "a word not tied to the transcript");
  assert.equal(sourceRun({ ...e, diff: e.diff.map((x, i) => (i ? x : { ...x, sourceDisplay: undefined })) }), null, "a word without its original");
  let calls = 0;
  const f = retryingFetcher(async name => { calls++; if (calls === 1) throw new Error("network"); return { name }; }, 1);
  assert.deepEqual(await f("a.json", "json"), { name: "a.json" });
  assert.equal(calls, 2);
  calls = 0;
  const dead = retryingFetcher(async () => { calls++; throw new Error("404"); }, 1);
  await assert.rejects(() => dead("a.json", "json"));
  assert.equal(calls, 2, "one retry, not more");
});
