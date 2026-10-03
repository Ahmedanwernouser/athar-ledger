// The original (diacritised) hadith text on the page's data: what the worker attaches to ledger entries, lookup
// candidates and exports, and the silent fallback when data/display/ is absent or cannot be fetched.
// Reads public/data; without a display/ folder there the tests that need it are SKIPPED (the site works without it).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadCorpus, DATA } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";
import { HadithDisplay } from "../public/js/display.js";
import { finish, lookupFor, lookupWithDisplay, loadDisplayFor, setCorpusForTests, setDisplayForTests } from "../public/js/worker.js";
import { toCsv, toJson, toRows, sourceTextOf } from "../public/js/exporter.js";
import { norm } from "../public/js/text.js";
import { setLangForTests } from "../public/js/i18n.js";

setLangForTests("ar");
const skip = fs.existsSync(path.join(DATA, "display", "meta.json")) ? false : "no public/data/display/ folder";
const corpus = await loadCorpus();
setCorpusForTests(corpus);
const fetcher = async (name, kind) => { const b = await readFile(path.join(DATA, name)); return kind === "json" ? JSON.parse(b.toString("utf8")) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const words = JSON.parse(fs.readFileSync(new URL("../public/samples/demo-clean.json", import.meta.url), "utf8")).words;
const shown = e => [e.source, e.reference, ...(e.candidates || []), ...(e.suggestions || [])];
/** the ledger as the worker's "analyze" answers it, with this display object (null = no display folder) */
async function ledgerWith(disp, ws = words) {
  setDisplayForTests(disp);
  const r = analyze(ws, corpus);
  await loadDisplayFor(r.ledger.flatMap(shown));
  return r.ledger.map(e => ({ ...finish(e, ws, r.tokenToWord), key: `m:${e.wordStart}-${e.wordEnd}` }));
}
const DIACRITIC = /[\u064b-\u0652]/;
// two marks on one letter (shadda + vowel) may be stored in either order, and «الْأَ» is also written «الأَ»: canonical form before comparing
const canon = s => s.replace(/[\u064b-\u0652]+/g, m => [...m].sort().join("")).replace(/الْأ/g, "الأ");
const strip = x => JSON.parse(JSON.stringify(x, (k, v) => (["sourceDisplay", "display", "displayFull", "excerptDisplay", "original", "arabic", "sourceRun", "diffDisplay", "meaningDisplay"].includes(k) ? undefined : v)));

test("partial hadith: the source line carries the original words, each at the position of the word it is compared with", { skip }, async () => {
  const ledger = await ledgerWith(new HadithDisplay(fetcher));
  const e = ledger.find(x => x.status === "partial" && x.source.type === "h");
  assert.ok(e, "the sample has a partial hadith");
  assert.equal(e.diffDisplay, true);
  for (const d of e.diff) {
    if (!d.source) { assert.equal(d.sourceDisplay, undefined, "a word the speaker added has no source word"); continue; }
    assert.equal(norm(d.sourceDisplay), d.source, `${d.sourceDisplay} is the original of ${d.source}`);
  }
  const line = e.diff.filter(d => d.source).map(d => d.sourceDisplay).join(" ");
  assert.ok(canon(line).startsWith(canon("مَنْ كَانَ يُؤْمِنُ بِاللَّهِ وَالْيَوْمِ الآخِرِ")), line);
  const changed = e.diff.filter(d => d.kind === "diff");
  assert.deepEqual(changed.map(d => [d.spoken, norm(d.sourceDisplay)]), [["طيبا", "خيرا"], ["ليسكت", "ليصمت"]]);
  assert.ok(changed.every(d => DIACRITIC.test(d.sourceDisplay)));
  // the matched range and the whole hadith, in the dataset's wording
  assert.ok(DIACRITIC.test(e.source.display) && norm(e.source.display) === e.diff.filter(d => d.source).map(d => d.source).join(" "));
  assert.ok(e.source.displayFull.includes(e.source.display) && e.source.displayFull.length >= e.source.display.length);
  assert.equal(e.source.arabic, e.source.displayFull);
  assert.equal(e.source.original, true);
  assert.equal(e.sourceRun, undefined, "a partial match is never rewritten in the document");
  assert.equal(e.spoken, words.slice(e.wordStart, e.wordEnd + 1).map(w => w.w).join(" "), "the spoken text is what was transcribed");
  assert.ok(e.diff.filter(d => d.spoken).every(d => !DIACRITIC.test(d.spokenDisplay || d.spoken)), "the spoken side is untouched");
});

test("verbatim hadith: matched range, full text after the chain, and the run for the Word option; the Qur'an path is unchanged", { skip }, async () => {
  const ledger = await ledgerWith(new HadithDisplay(fetcher));
  const e = ledger.find(x => x.status === "verbatim" && x.source.ref === "bukhari:1");
  assert.ok(canon(e.source.display).startsWith(canon("إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ")), e.source.display);
  assert.equal(norm(e.source.display), e.diff.map(d => d.source).join(" "));
  assert.equal(e.sourceRun, e.diff.map(d => d.sourceDisplay).join(" "));
  assert.ok(!e.source.displayFull.split(" ").some(w => norm(w) === "حدثنا"), "no chain of narrators in the full text");
  const q = ledger.find(x => x.status === "verbatim" && x.source.type === "q");
  assert.ok(q.mushaf && q.source.display.includes("﴿") && q.sourceRun === undefined && q.source.displayFull === undefined);
  // suggestions under a not-found entry / candidates by meaning: excerpts in the original wording, cut at the same words
  const lists = ledger.flatMap(x => [...(x.candidates || []), ...(x.suggestions || [])]).filter(s => s.type === "h");
  assert.ok(lists.length >= 5);
  let mapped = 0;
  for (const s of lists) {
    assert.ok(!DIACRITIC.test(s.excerpt), "the stored excerpt (what the helper is given) stays as it was");
    if (!s.excerptDisplay) continue;
    mapped++;
    const a = norm(s.excerptDisplay), b = s.excerpt.replace(/^… | …$/g, "");
    assert.ok(b.endsWith(a) && DIACRITIC.test(s.excerptDisplay), `${s.ref}: ${s.excerptDisplay}`);      // (only a leading chain may be left out)
  }
  assert.ok(mapped >= lists.length - 2, `${mapped} of ${lists.length} excerpts in the original wording`);
});

test("without display data everything is as before: absent folder, failing fetch, a passage that cannot be mapped", { skip }, async () => {
  const plain = await ledgerWith(null);
  for (const e of plain) {
    if (e.source && e.source.type === "h") { assert.equal(e.source.display, undefined); assert.equal(e.source.displayFull, undefined); assert.ok(!DIACRITIC.test(e.source.arabic || "")); assert.equal(e.diffDisplay, undefined); }
    for (const d of e.diff || []) if (e.source.type === "h") assert.equal(d.sourceDisplay, undefined);
    assert.equal(e.sourceRun, undefined);
  }
  let calls = 0;
  const absent = await ledgerWith(new HadithDisplay(async () => { calls++; throw new Error("404"); }));
  assert.deepEqual(absent, plain, "an absent folder changes nothing");
  assert.equal(calls, 1, "and costs one request");
  // meta.json loads, the files do not
  const broken = await ledgerWith(new HadithDisplay(async (name, kind) => { if (/h_\d+\.json$/.test(name)) throw new Error("network"); return fetcher(name, kind); }));
  assert.deepEqual(broken, plain, "files that cannot be fetched change nothing");
  // files built from another index (texts shifted by one passage): no word is shown at a place it does not belong to
  const shifted = await ledgerWith(new HadithDisplay(async (name, kind) => { const d = await fetcher(name, kind); return /h_\d+\.json$/.test(name) ? { ...d, t: [...d.t.slice(1), d.t[0]], o: [...d.o.slice(1), d.o[0]] } : d; }));
  assert.deepEqual(shifted, plain, "texts that do not belong to the passages change nothing");
  // with display data, everything that is not an added field is identical to the plain ledger
  const rich = await ledgerWith(new HadithDisplay(fetcher));
  assert.deepEqual(strip(rich), strip(plain));
  // lookup: the same fallback
  setDisplayForTests(null);
  const before = lookupFor(["الدين", "النصيحة"]);
  setDisplayForTests(new HadithDisplay(async () => { throw new Error("404"); }));
  assert.deepEqual(await lookupWithDisplay(["الدين", "النصيحة"]), before);
});

test("lookup and resolve: candidates carry the original text of the matched words, or of the excerpt", { skip }, async () => {
  setDisplayForTests(new HadithDisplay(fetcher));
  const r = await lookupWithDisplay(["الدين", "النصيحة"]);
  const h = r.candidates.find(c => c.source.type === "h" && c.entry);
  assert.ok(h && h.entry.diffDisplay && norm(h.source.display) === "الدين النصيحه" && DIACRITIC.test(h.source.display), h && h.source.display);
  const loose = (await lookupWithDisplay("ليس الشديد بالصرعة انما الشديد الذي يملك نفسه".split(" "))).candidates.filter(c => c.source.type === "h");
  assert.ok(loose.length && loose.every(c => DIACRITIC.test(c.source.display || c.source.excerptDisplay || c.source.arabic || "")), "every hadith candidate has original text");
});

test("CSV / JSON: a column with the original source text of the match, after the source columns", { skip }, async () => {
  const ledger = await ledgerWith(new HadithDisplay(fetcher));
  const csv = toCsv(ledger, {}), head = csv.split("\r\n")[0];
  assert.ok(head.includes('"الرابط","نص المصدر في موضع المطابقة (اللفظ الأصلي)","مواضع أخرى"'), head);
  const rows = toRows(ledger, {});
  const e = ledger.find(x => x.status === "partial" && x.source.type === "h"), row = rows[ledger.indexOf(e)];
  assert.equal(row.sourceText, e.source.display);
  assert.ok(csv.includes(e.source.display));
  assert.ok(rows.filter((x, i) => !["verbatim", "partial"].includes(ledger[i].status)).every(x => x.sourceText === ""), "nothing for entries that are not textual matches");
  const q = ledger.find(x => x.status === "verbatim" && x.source.type === "q");
  assert.equal(sourceTextOf(q), q.source.display);
  const j = JSON.parse(toJson(ledger, {}, {}));
  assert.equal(j.ledger[ledger.indexOf(e)].sourceText, e.source.display);
  // without display data the hadith cell is empty and the columns are the same
  const plain = await ledgerWith(null), prow = toRows(plain, {})[plain.findIndex(x => x.status === "partial" && x.source.type === "h")];
  assert.equal(prow.sourceText, "");
  assert.equal(toCsv(plain, {}).split("\r\n")[0], head);
  setLangForTests("en");
  assert.ok(toCsv(ledger, {}).split("\r\n")[0].includes('"Link","Source text at the match (original wording)","Other places"'));
  setLangForTests("ar");
});
