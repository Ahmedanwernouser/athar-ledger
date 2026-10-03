// Reviewer workflow: corpus lookup, entries added by hand, corrected words, the saved session that carries them,
// the citation index for a video description, the committee summary, and Mushaf spelling in the Word document.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadCorpus } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";
import { lookup, describeRef, LOOKUP_MAX_WORDS } from "../public/js/lookup.js";
import { finish, lookupFor, mushafRun, setCorpusForTests } from "../public/js/worker.js";
import { buildCitedDoc, footnoteFor, toSession, fromSession, committeeSummary, summaryLines, descriptionIndex, mushafText, citedDocx } from "../public/js/report.js";
import { toCsv } from "../public/js/exporter.js";
import { norm } from "../public/js/text.js";
import { setLangForTests } from "../public/js/i18n.js";

setLangForTests("ar");
const corpus = await loadCorpus();
setCorpusForTests(corpus);
const sample = JSON.parse(fs.readFileSync(new URL("../public/samples/demo-clean.json", import.meta.url), "utf8"));
const words = sample.words;
const full = ws => { const r = analyze(ws, corpus); return r.ledger.map(e => ({ ...finish(e, ws, r.tokenToWord), key: `m:${e.wordStart}-${e.wordEnd}` })); };
const ledger = full(words);
const body = d => d.paragraphs.filter(p => !p.style).map(p => p.runs.map(r => r.text || "").join("")).join("\n");
const at = phrase => { const ws = phrase.split(" "); for (let i = 0; i + ws.length <= words.length; i++) if (ws.every((w, k) => words[i + k].w === w)) return [i, i + ws.length - 1]; throw new Error("not in the sample: " + phrase); };
/** a manual entry the way the page builds one from a lookup candidate */
function manual(a, b, cand) {
  const base = cand.entry ? { ...cand.entry } : { diff: null, agreement: null, counts: null, parallels: [], inBooks: [] };
  return { ...base, manual: true, key: `u:${a}-${b}`, wordStart: a, wordEnd: b, start: words[a].start, end: words[b].end, spoken: words.slice(a, b + 1).map(w => w.w).join(" "),
    type: cand.source.type === "q" ? "q" : "h", status: cand.status, source: cand.source, cue: null, attribution: null };
}

test("lookup: a short text is found as an announced quotation; a paraphrase gets its source among the suggestions; never more than 8", () => {
  const q = lookup("وإنك لعلى خلق عظيم".split(" "), corpus);
  assert.equal(q.candidates[0].status, "verbatim"); assert.equal(q.candidates[0].source.ref, "68:4");
  const short = lookup(["الدين", "النصيحة"], corpus);
  assert.ok(short.candidates.some(c => c.entry && c.source.type === "h"), "two words after a cue are found textually");
  const [a, b] = at("أن القوي الحقيقي ليس من يغلب الناس في المصارعة وإنما هو من يملك نفسه حين يغضب");
  const r = lookup(words.slice(a, b + 1), corpus);
  assert.ok(r.candidates.length > 0 && r.candidates.length <= 8);
  const hit = r.candidates.find(c => c.source.ref === "bukhari:6114");
  assert.ok(hit, "the hadith of the strong man is offered"); assert.equal(hit.status, "meaning");
  assert.equal(new Set(r.candidates.map(c => c.source.ref)).size, r.candidates.length, "each source once");
  // nothing close, nothing typed, a very long text
  assert.deepEqual(lookup([], corpus).candidates, []);
  const long = lookup(Array.from({ length: 300 }, (_, i) => words[i % words.length]), corpus);
  assert.equal(long.truncated, true); assert.equal(long.searched, LOOKUP_MAX_WORDS);
});

test("lookup in the worker: Qur'an candidates carry the verbatim display text, hadith candidates the corpus text; positions are those of the searched words", () => {
  const r = lookupFor("وإنك لعلى خلق عظيم".split(" ").map(w => ({ w })));
  const c = r.candidates[0];
  assert.equal(c.source.display, `${corpus.quranDisplay[corpus.coreRef.get("68:4")]} ﴿4﴾`);
  assert.equal(c.entry.wordStart, 0); assert.equal(c.entry.wordEnd, 3);
  assert.deepEqual(c.entry.diff.filter(d => d.spoken).flatMap(d => d.wordIdx), [0, 1, 2, 3]);
  const h = lookupFor(["الدين", "النصيحة"]).candidates.find(x => x.source.type === "h");
  assert.ok(h.source.arabic && h.source.arabic.includes("النصيحه".slice(0, 5)));
});

test("a reference is described again from its stable id (single ayah, ayah range, hadith); an unknown one gives null", () => {
  assert.equal(describeRef("68:4", corpus).ref, "68:4");
  const r = describeRef("112:1-4", corpus); assert.equal(r.ayah, 1); assert.equal(r.ayahEnd, 4);
  assert.equal(describeRef("bukhari:6114", corpus).collection, "bukhari");
  for (const bad of ["", "999:1", "nobook:1", null, "2:5-3"]) assert.equal(describeRef(bad, corpus), null, String(bad));
});

test("manual entry: quoted and footnoted in the document without a star and marked as the reviewer's; it keeps its place over the tool's guess there", () => {
  const [a, b] = at("القوي الحقيقي ليس من يغلب الناس في المصارعة وإنما هو من يملك نفسه حين يغضب");
  const cand = lookupFor(words.slice(a, b + 1)).candidates.find(c => c.source.ref === "bukhari:6114");
  const m = manual(a, b, cand), withM = [...ledger, m];
  const fn = footnoteFor(m, "yes");
  assert.ok(fn.text.includes("صحيح البخاري") && fn.text.includes("(أضافه المراجع)") && !fn.text.includes("*"));
  assert.ok(!footnoteFor(m, null).text.includes("*"), "a person chose it: no star even without a verdict");
  assert.equal(footnoteFor(m, "no"), null);
  const d = buildCitedDoc({ words, ledger: withM, reviews: { [m.key]: { v: "yes" } } }), base = buildCitedDoc({ words, ledger });
  const notes = d.footnotes.map(f => f.runs[0].text);
  assert.equal(notes.filter(x => x.includes("(أضافه المراجع)")).length, 1);
  assert.equal(d.counts.manual, 1);
  // the "not found" entry of the tool that covers the same words loses its footnote to the reviewer's entry
  const nf = ledger.find(e => e.status === "notfound" && e.wordStart <= b && e.wordEnd >= a);
  assert.ok(nf, "the sample announces this hadith and the tool does not find it");
  assert.equal(d.footnotes.length, base.footnotes.length);
  assert.equal(body(d).replace(/[﴿﴾«»]/g, "").replace(/\s+/g, " ").trim(), words.map(w => w.w).join(" "), "no word lost or moved");
  assert.ok(d.paragraphs.some(p => p.style === "Note" && p.runs[0].text.includes("أضافه المراجع")));
  // a textual candidate keeps the engine's status and comparison
  const [qa, qb] = at("فلا تحقرن من المعروف شيئا");
  const c2 = lookupFor(words.slice(qa + 1, qb + 1)).candidates[0];
  assert.ok(["verbatim", "partial", "meaning"].includes(c2.status));
  // CSV carries the entry and says who added it
  const csv = toCsv(withM.map((e, i) => ({ ...e, id: i + 1 })), {});
  assert.ok(csv.split("\r\n").some(l => l.includes("bukhari:6114") && l.includes("أضافه المراجع")));
});

test("saved session: manual entries and corrections survive a round trip; damaged ones are dropped", () => {
  const ws = Array.from({ length: 10 }, (_, i) => ({ w: "ك" + i, start: i, end: i + 0.5 }));
  const manualList = [{ a: 2, b: 4, ref: "bukhari:6114", status: "meaning", src: { type: "h", label: "صحيح البخاري — رقم 6114", short: "البخاري 6114", url: "https://sunnah.com/bukhari:6114", collection: "bukhari", number: "6114", junk: { x: 1 } } },
    { a: 3, b: 5, ref: "muslim:1", status: "partial" },                 // overlaps the first: dropped
    { a: 7, b: 99, ref: "muslim:1", status: "partial" },                // outside the transcript
    { a: 8, b: 8, ref: "68:4", status: "nonsense", src: { type: "q", surah: 68, ayah: 4, ayahEnd: 4, url: "javascript:alert(1)" } }, { a: 6, b: 6 }, null];
  const fixes = { 1: "خيرا", 3: "", 5: "  كلمتان   معا ", 99: "x", "-1": "x", 2: 7, abc: "x" };
  const s = fromSession(JSON.parse(toSession({ words: ws, title: "T", review: { "u:2-4": { v: "yes", note: "", sig: "meaning|bukhari:6114" } }, manual: manualList, fixes })));
  assert.equal(s.manual.length, 2);
  assert.deepEqual(s.manual[0], { a: 2, b: 4, ref: "bukhari:6114", status: "meaning", src: { ref: "bukhari:6114", type: "h", label: "صحيح البخاري — رقم 6114", short: "البخاري 6114", url: "https://sunnah.com/bukhari:6114", collection: "bukhari", number: "6114" } });
  assert.deepEqual(s.manual[1], { a: 8, b: 8, ref: "68:4", status: "meaning", src: { ref: "68:4", type: "q", surah: 68, ayah: 4, ayahEnd: 4 } });
  assert.deepEqual(s.fixes, { 1: "خيرا", 3: "", 5: "كلمتان معا" });
  assert.equal(s.words[1].w, "ك1", "the session keeps the words as transcribed next to the corrections");
  assert.equal(s.review["u:2-4"].v, "yes");
  // a session written before these fields existed opens with none
  const old = fromSession({ athar_session: 1, words: [["a"], ["b"], ["c"], ["d"]], review: {} });
  assert.deepEqual(old.manual, []); assert.deepEqual(old.fixes, {});
});

test("corrected words: the document and the CSV use them; a removed word is left out; the closing note says so", () => {
  const [a] = at("كلاما طيبا");
  const fixed = words.map((w, i) => (i === a ? { ...w, w: "خيرا" } : i === a + 1 ? { ...w, w: "" } : w));
  // the engine sees the words without the removed one; positions are mapped back to the transcript
  const back = [], run = []; fixed.forEach((w, i) => { if (w.w) { run.push(w); back.push(i); } });
  const L = full(run).map(e => ({ ...e, wordStart: back[e.wordStart], wordEnd: back[e.wordEnd], key: `m:${back[e.wordStart]}-${back[e.wordEnd]}` }));
  const before = ledger.find(e => e.source && e.source.ref === "muslim:173"), after = L.find(e => e.source && e.source.ref === "muslim:173");
  assert.ok(after && after.spoken.includes("فليقل خيرا أو") && !after.spoken.includes("طيبا"));
  const changed = e => e.diff.filter(d => d.kind !== "exact").length;
  assert.ok(changed(after) < changed(before), "two differences fewer after the correction");
  for (const mushaf of [false, true]) {
    const d = buildCitedDoc({ words: fixed, ledger: L, mushaf, fixed: 2 }), text = body(d);
    assert.ok(text.includes("فليقل خيرا أو ليسكت") && !text.includes("كلاما") && !text.includes("طيبا"), "mushaf " + mushaf);
    assert.ok(d.paragraphs.at(-1).runs[0].text.includes("صحّح المراجع 2"));
  }
  assert.ok(toCsv(L, {}).includes("فليقل خيرا أو ليسكت"));
});

test("citation index for a video description: one line per timed textual citation, rejected ones left out, h:mm:ss from one hour on", () => {
  const txt = descriptionIndex(ledger, {});
  const lines = txt.split("\n"), textual = ledger.filter(e => ["verbatim", "partial"].includes(e.status));
  assert.equal(lines.length, textual.length);
  assert.equal(lines[0], "0:17 آية — سورة القلم ٤");
  assert.ok(lines.some(l => /^0:46 حديث — صحيح مسلم \S+: من كان يؤمن بالله واليوم الآخر فليقل كلاما…$/.test(l)), txt);
  assert.ok(lines.some(l => l.includes("آيات — سورة الإخلاص ١–٤")), txt);
  assert.ok(!txt.includes("اطلبوا العلم"), "an announced quotation that was not found is not a chapter");
  // rejected entries are left out
  const first = textual[0];
  assert.equal(descriptionIndex(ledger, { [first.key]: { v: "no" } }).split("\n").length, lines.length - 1);
  // "0:00 المقدمة" only on request and only when no citation is at 0:00
  assert.equal(descriptionIndex(ledger, {}, { intro: true }).split("\n")[0], "0:00 المقدمة");
  const atZero = ledger.map(e => (e === first ? { ...e, start: 0.2 } : e));
  assert.ok(descriptionIndex(atZero, {}, { intro: true }).startsWith("0:00 آية — "));
  // an hour or more
  const late = ledger.map(e => ({ ...e, start: e.start + 3600 }));
  assert.ok(descriptionIndex(late, {}).startsWith("1:00:17 آية"));
  // no times: nothing to list
  assert.equal(descriptionIndex(ledger.map(e => ({ ...e, start: null })), {}), "");
  // manual entries are listed; English labels in the English interface
  const [a, b] = at("القوي الحقيقي ليس من يغلب الناس في المصارعة وإنما هو من يملك نفسه حين يغضب");
  const m = manual(a, b, lookupFor(words.slice(a, b + 1)).candidates.find(c => c.source.ref === "bukhari:6114"));
  assert.ok(descriptionIndex([...ledger, m], {}).split("\n").some(l => l.includes("صحيح البخاري") && l.startsWith("1:2") && l.endsWith(": القوي الحقيقي ليس من يغلب الناس في المصارعة…")));
  setLangForTests("en");
  try { const en = descriptionIndex(ledger, {}).split("\n"); assert.equal(en[0], "0:17 Verse — Al-Qalam 68:4"); assert.ok(en.some(l => l.startsWith("0:46 Hadith — Sahih Muslim "))); }
  finally { setLangForTests("ar"); }
});

test("committee summary: counts follow the ledger and the verdicts as they are now", () => {
  const textual = ledger.filter(e => ["verbatim", "partial"].includes(e.status));
  const s = committeeSummary(ledger, {});
  assert.equal(s.total, ledger.length);
  assert.equal(s.quran, textual.filter(e => e.source.type === "q").length);
  assert.equal(s.hadith, textual.filter(e => e.source.type === "h").length);
  assert.equal(Object.values(s.collections).reduce((x, y) => x + y, 0), s.hadith);
  assert.equal(s.notfound, ledger.filter(e => e.status === "notfound").length);
  assert.equal(s.attribution, ledger.filter(e => e.attribution && e.attribution.agrees === false).length);
  assert.ok(s.attribution >= 1, "the sample holds a spoken attribution that does not agree");
  assert.deepEqual(s.review, { yes: 0, no: 0, unsure: 0, none: ledger.length });
  assert.equal(Object.values(s.status).reduce((x, y) => x + y, 0), ledger.length);
  // verdicts: a rejected hadith is no longer counted as a citation; a manual entry is
  const h = textual.find(e => e.source.type === "h"), q = textual.find(e => e.source.type === "q");
  const [a, b] = at("القوي الحقيقي ليس من يغلب الناس في المصارعة وإنما هو من يملك نفسه حين يغضب");
  const m = manual(a, b, lookupFor(words.slice(a, b + 1)).candidates.find(c => c.source.ref === "bukhari:6114"));
  const s2 = committeeSummary([...ledger, m], { [h.key]: { v: "no" }, [q.key]: { v: "yes" }, [m.key]: { v: "yes" }, [textual[2].key]: { v: "unsure" } });
  assert.equal(s2.hadith, s.hadith); assert.equal(s2.collections.bukhari, (s.collections.bukhari || 0) + 1 - (h.source.collection === "bukhari" ? 1 : 0));
  assert.equal(s2.manual, 1); assert.deepEqual(s2.review, { yes: 2, no: 1, unsure: 1, none: ledger.length + 1 - 4 });
  const lines = summaryLines(s2);
  assert.ok(lines.find(l => l.label === "أحاديث").value.includes("البخاري"));
  assert.ok(lines.find(l => l.label === "حالة المراجعة").value.includes("صحيح ٢"));
  // the document carries the summary after the subtitle, as short paragraphs
  const d = buildCitedDoc({ words, ledger });
  assert.equal(d.paragraphs[1].style, "Subtitle"); assert.equal(d.paragraphs[2].style, "SummaryHead");
  assert.equal(d.paragraphs.filter(p => p.style === "Summary" || p.style === "SummaryNote").length, lines.length);
  assert.equal(buildCitedDoc({ words, ledger, summary: false }).paragraphs.filter(p => p.style === "Summary").length, 0);
});

test("Mushaf spelling: a verbatim Arabic Qur'an match is written as a contiguous stretch of the ayah text; nothing else is touched", () => {
  const strip = s => s.replace(/\s*\([٠-٩]+\)/g, "").replace(/^﴿|﴾$/g, "");
  const quoted = d => d.paragraphs.flatMap(p => p.runs).filter(r => r.quote).map(r => r.text);
  const off = buildCitedDoc({ words, ledger }), on = buildCitedDoc({ words, ledger, mushaf: true });
  const q = ledger.filter(e => e.status === "verbatim" && e.source.type === "q");
  assert.ok(q.length >= 3); assert.equal(on.counts.mushaf, q.length); assert.equal(off.counts.mushaf, 0);
  const A = quoted(off), B = quoted(on); assert.equal(A.length, B.length);
  let replaced = 0;
  const textual = ledger.filter(e => ["verbatim", "partial"].includes(e.status));
  textual.forEach((e, i) => {
    if (e.status !== "verbatim" || e.source.type !== "q") { assert.equal(B[i], A[i], "hadith and partial matches stay as transcribed"); return; }
    replaced++;
    assert.notEqual(B[i], A[i]);
    // contiguous inside the display text of the ayah(s), basmala not included
    const s = e.source, first = corpus.surahStart[s.surah] + s.ayah - 1, last = corpus.surahStart[s.surah] + s.ayahEnd - 1;
    let range = ""; for (let pid = first; pid <= last; pid++) range += (range ? " " : "") + corpus.quranDisplay[pid];
    const got = strip(B[i]);
    assert.ok(range.includes(got), `${s.ref}: ${got}`);
    assert.equal(norm(got), norm(strip(A[i])), "the same words, in the Mushaf's spelling");
    assert.ok(!norm(got).startsWith("بسم الله الرحمن الرحيم") || s.surah === 1);
  });
  assert.equal(replaced, q.length);
  // verse numbers only for whole ayahs
  const ikhlas = B[textual.findIndex(e => e.source.ref === "112:1-4")];
  assert.deepEqual(ikhlas.match(/\([٠-٩]+\)/g), ["(١)", "(٢)", "(٣)", "(٤)"]);
  const part = full("قال الله تعالى إن الله يأمر بالعدل والإحسان ثم سكت".split(" ").map(w => ({ w }))).find(e => e.source && e.source.ref === "16:90");
  assert.equal(part.status, "verbatim");
  assert.ok(part.mushaf && !/﴿\d+﴾/.test(part.mushaf), "part of an ayah: no verse number");
  assert.ok(corpus.quranDisplay[corpus.coreRef.get("16:90")].includes(part.mushaf));
  // the hizb ornament that opens an ayah in the Tanzil text is a page mark, not a word: it does not open a quotation
  assert.ok(corpus.quranDisplay[corpus.coreRef.get("16:90")].startsWith("۞"));
  assert.ok(!B[textual.findIndex(e => e.source.ref === "16:90")].includes("۞"));
  // a surah opening recited without its basmala: the basmala is not added
  const fil = full("قال الله تعالى ألم تر كيف فعل ربك بأصحاب الفيل ألم يجعل كيدهم في تضليل".split(" ").map(w => ({ w }))).find(e => e.source && e.source.surah === 105);
  assert.ok(fil.mushaf && !norm(fil.mushaf).includes("بسم الله"));
  // a partial Qur'an match is never replaced, and the rules refuse anything not tied word for word
  const partial = full("قال الله تعالى إن الله يأمر بالعدل والإحسان وإعطاء ذي القربى وينهى عن الفحشاء والمنكر".split(" ").map(w => ({ w }))).find(e => e.source && e.source.ref === "16:90");
  if (partial.status === "partial") assert.equal(partial.mushaf, undefined);
  assert.equal(mushafText({ ...q[0], status: "partial" }, words.slice(q[0].wordStart, q[0].wordEnd + 1).map(w => w.w)), null);
  assert.equal(mushafText(q[0], ["غير", "الكلمات"]), null, "the words in the document are not the compared words");
  assert.equal(mushafText({ ...q[0], source: { ...q[0].source, via: "en" } }, words.slice(q[0].wordStart, q[0].wordEnd + 1).map(w => w.w)), null);
  assert.equal(mushafRun({ ...q[0], diff: [...q[0].diff, { kind: "ins", spoken: "زيادة", spokenDisplay: "زيادة" }] }), null, "an added word: left as transcribed");
  assert.equal(mushafRun({ ...q[0], diffDisplay: false }), null);
  // off reproduces the document without the option; the closing note names Tanzil only when something was written that way
  assert.deepEqual(buildCitedDoc({ words, ledger, mushaf: false }), off);
  assert.ok(on.paragraphs.at(-1).runs[0].text.includes("برسم المصحف") && on.paragraphs.at(-1).runs[0].text.includes("تنزيل"));
  assert.ok(!off.paragraphs.at(-1).runs[0].text.includes("برسم المصحف") && off.paragraphs.at(-1).runs[0].text.includes("كما خرج من التفريغ"));
  assert.deepEqual(on.footnotes, off.footnotes, "footnotes do not change");
  const { bytes } = citedDocx({ words, ledger, mushaf: true });
  assert.ok(new TextDecoder().decode(bytes).includes("خُلُقٍ عَظِيمٍ"));
});
