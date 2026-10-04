// The agreement check between two transcriptions (public/js/agree.js) and the source positions worker.js attaches for it.
// The two ledgers are produced as the page produces them: the engine, then the worker's finish() on every entry.
import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";
import { finish, diffPositions, setCorpusForTests, setDisplayForTests } from "../public/js/worker.js";
import { compareLedgers, applyAgreement, marksOf, statusOf, timeTolerance, BOTH_EXACT, ONE_EXACT, BOTH_DIFFER_SAME, BOTH_DIFFER_DIFFERENT, ONLY_ONE_COVERS } from "../public/js/agree.js";

const corpus = await loadCorpus();
setCorpusForTests(corpus); setDisplayForTests(null);

const mk = (text, timed = true, t0 = 0) => text.split(/\s+/).filter(Boolean).map((w, i) => (timed ? { w, start: t0 + i * 0.5, end: t0 + i * 0.5 + 0.45 } : { w }));
const ledgerOf = (text, timed = true) => { const words = mk(text, timed), r = analyze(words, corpus); for (const e of r.ledger) finish(e, words, r.tokenToWord); return r.ledger; };
const textual = l => l.filter(e => e.status === "verbatim" || e.status === "partial");
const PRE = "الحمد لله رب العالمين والصلاة والسلام على رسول الله أما بعد فإن موضوعنا اليوم عن الأخلاق وقد قال الله تعالى";
const POST = "وهذه الآية جامعة لمعاني الخير كلها كما ذكر أهل العلم";
const Q = "إن الله يأمر بالعدل والإحسان وإيتاء ذي القربى وينهى عن الفحشاء والمنكر والبغي يعظكم لعلكم تذكرون";      // 16:90
const HP = "وقد قال رسول الله صلى الله عليه وسلم";
const H = "من كان يؤمن بالله واليوم الآخر فليقل خيرا أو ليصمت";
const NEG = "لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه";
const quran = q => `${PRE} ${q} ${POST}`, hadith = h => `${PRE} ${HP} ${h} ${POST}`;
/** compare two transcripts; -> {A, B, r, e (the one textual primary entry), x (its result)} */
function run(a, b, timed = true, opts) {
  const A = ledgerOf(a, timed), B = ledgerOf(b, timed), r = compareLedgers(A, B, opts);
  const i = A.findIndex(e => e.status === "verbatim" || e.status === "partial");
  return { A, B, r, e: A[i], x: r.entries[i] };
}
const classes = x => x.agreement2.positions.filter(p => p.c !== BOTH_EXACT).map(p => [p.c, p.s, p.a, p.b]);

test("worker: every source word of a comparison has its exact position; an ambiguous place gives none", () => {
  const [e] = textual(ledgerOf(quran(Q)));
  assert.equal(e.source.ref, "16:90"); assert.equal(e.posKey, "q:16");
  const pos = e.diff.filter(d => d.source).map(d => d.srcPos);
  assert.ok(pos.every(Number.isInteger));
  for (let i = 1; i < pos.length; i++) assert.equal(pos[i], pos[i - 1] + 1, "positions follow the source, word after word");
  // counted from the first word of the surah: 16:90 does not begin at 0
  let before = 0; for (let a = 1; a < 90; a++) before += corpus.tok(corpus.surahStart[16] + a - 1).length;
  assert.equal(pos[0], before);
  const [h] = textual(ledgerOf(hadith(H)));
  assert.equal(h.posKey, "h:" + h.source.ref);
  assert.ok(h.diff.filter(d => d.source).every(d => Number.isInteger(d.srcPos)));
  // the pure piece: a place that is not unique is not chosen
  const diff = [{ kind: "exact", spoken: "a", source: "a" }, { kind: "exact", spoken: "b", source: "b" }];
  assert.equal(diffPositions(diff, ["a", "b", "x", "a", "b"]), false);
  assert.equal(diff[0].srcPos, undefined);
  assert.equal(diffPositions(diff, ["x", "a", "b"], 100), true);
  assert.deepEqual(diff.map(d => d.srcPos), [101, 102]);
  assert.equal(diffPositions(diff, ["a", "b", "x", "a", "b"], 0, 3), true, "a place already known is checked and used");
  assert.deepEqual(diff.map(d => d.srcPos), [3, 4]);
  const glued = [{ kind: "asr", spoken: "ab", source: "a b" }];
  assert.equal(diffPositions(glued, ["a", "b"]), true);
  assert.deepEqual([glued[0].srcPos, glued[0].srcN], [0, 2]);
});

test("one transcript mis-heard a word, the other has the source's word: verbatim by two transcriptions", () => {
  const { e, x } = run(quran(Q.replace("والإحسان", "والإيمان")), quran(Q));
  assert.equal(e.status, "partial", "the strict status of the primary transcript");
  assert.equal(x.agreement2.paired, true);
  assert.equal(x.agreement2.verdict, "verbatim_supported");
  assert.equal(x.statusCombined, "verbatim");
  assert.deepEqual(classes(x), [[ONE_EXACT, "والاحسان", "والايمان", "والاحسان"]]);
  assert.deepEqual([x.agreement2.confirmed, x.agreement2.unresolved, x.agreement2.oneExact, x.agreement2.disagree], [0, 0, 1, 1]);
  // the other way round (the primary is clean): nothing changes for a verbatim entry
  const back = run(quran(Q), quran(Q.replace("والإحسان", "والإيمان")));
  assert.equal(back.e.status, "verbatim"); assert.equal(back.x.statusCombined, "verbatim");
  assert.equal(back.x.agreement2.verdict, "verbatim_supported");
});

test("both transcripts have the same other word: a confirmed difference, the status stays partial", () => {
  const t = quran(Q.replace("بالعدل", "بالظلم")), { e, x } = run(t, t);
  assert.equal(e.status, "partial");
  assert.equal(x.agreement2.verdict, "difference_confirmed");
  assert.equal(x.agreement2.confirmed, 1);
  assert.equal(x.statusCombined, "partial");
  assert.deepEqual(classes(x), [[BOTH_DIFFER_SAME, "بالعدل", "بالظلم", "بالظلم"]]);
  assert.equal(x.agreement2.confirmedNear, 0, "«بالظلم» does not sound like «بالعدل»");
});

test("two different words, neither the source's: not settled", () => {
  const { e, x } = run(hadith(H.replace("خيرا", "كلاما")), hadith(H.replace("خيرا", "كلمة")));
  assert.equal(e.status, "partial");
  assert.equal(x.agreement2.verdict, "unresolved");
  assert.equal(x.statusCombined, "partial");
  assert.equal(classes(x).length, 1);
  assert.equal(classes(x)[0][0], BOTH_DIFFER_DIFFERENT);
  assert.deepEqual([x.agreement2.confirmed, x.agreement2.unresolved, x.agreement2.disagree], [0, 1, 1]);
});

test("a negation left out at the edge: confirmed when both lack it, a disagreement when one has it", () => {
  const without = hadith(NEG.replace("لا ", ""));
  const both = run(without, without);
  assert.equal(both.e.status, "partial");
  assert.ok(both.e.diff.some(d => d.kind === "del" && d.source === "لا"), "the engine lists the dropped particle");
  assert.equal(both.x.agreement2.verdict, "difference_confirmed");
  assert.deepEqual(classes(both.x), [[BOTH_DIFFER_SAME, "لا", "", ""]]);
  assert.equal(both.x.statusCombined, "partial");
  const one = run(without, hadith(NEG));
  assert.equal(one.e.status, "partial");
  assert.deepEqual(classes(one.x), [[ONE_EXACT, "لا", "", "لا"]]);
  assert.equal(one.x.agreement2.verdict, "verbatim_supported");
  assert.equal(one.x.agreement2.oneExact, 1);
  assert.equal(one.x.statusCombined, "verbatim");
});

test("an entry only the second transcript has is returned as extra; an entry only the primary has is unpaired", () => {
  const filler = "ثم تكلم الشيخ عن أمور أخرى كثيرة في هذا الباب ولم يذكر شيئا من النصوص في ذلك الموضع";
  const a = `${quran(Q)} ${filler}`, b = `${quran(Q)} ${HP} ${H} ${POST}`;
  const { r, B } = run(a, b);
  assert.equal(r.extra.length, 1);
  assert.equal(r.extra[0].entry, B[r.extra[0].index]);
  assert.equal(r.extra[0].entry.source.type, "h");
  assert.equal(r.extra[0].placed, true);
  assert.equal(r.stats.extra, 1);
  const rev = run(b, a);
  const lone = rev.A.findIndex(e => e.source && e.source.type === "h");
  assert.deepEqual(rev.r.entries[lone].agreement2, { paired: false, why: "absent" });
  assert.equal(rev.r.entries[lone].statusCombined, rev.A[lone].status);
  assert.equal(rev.r.extra.length, 0);
});

test("entries of different sources are never paired", () => {
  const { x, r } = run(quran(Q), hadith(H));
  assert.equal(x.agreement2.paired, false);
  assert.equal(x.agreement2.why, "other");
  assert.equal(r.extra.length, 0, "the second transcript's entry stands on the same words: it is not an extra citation");
  assert.equal(r.stats.paired, 0);
});

test("without times entries are paired by the source words they cover", () => {
  const { e, x, A, B } = run(quran(Q.replace("والإحسان", "والإيمان")), quran(Q), false);
  assert.equal(e.start, null); assert.equal(textual(B)[0].start, null);
  assert.equal(x.agreement2.paired, true);
  assert.equal(x.statusCombined, "verbatim");
  // the same words recited twice in the second transcript: nothing tells which one is meant, so no pair is made
  const twice = compareLedgers(A, ledgerOf(`${quran(Q)} ${quran(Q)}`, false));
  assert.equal(twice.entries[A.indexOf(e)].agreement2.paired, false);
});

test("identical transcripts never disagree: every position is BOTH_EXACT or a confirmed difference", () => {
  const t = `${quran(Q.replace("بالعدل", "بالظلم"))} ${hadith(H)} ${hadith(NEG.replace("لا ", ""))} ${hadith(H.replace("خيرا", "طيبا"))}`;
  const A = ledgerOf(t), B = ledgerOf(t), r = compareLedgers(A, B);
  assert.ok(r.stats.paired >= 4);
  assert.equal(r.stats.disagree, 0); assert.equal(r.stats.unresolved, 0); assert.equal(r.extra.length, 0);
  for (const x of r.entries) if (x && x.agreement2.paired) {
    for (const p of x.agreement2.positions) assert.ok(p.c === BOTH_EXACT || p.c === BOTH_DIFFER_SAME, p.c);
    assert.equal(x.agreement2.verdict, x.agreement2.confirmed ? "difference_confirmed" : "verbatim_supported");
  }
  A.forEach((e, i) => { if (r.entries[i]) assert.equal(r.entries[i].statusCombined, e.status, "identical transcripts change no status"); });
});

test("pure and deterministic; applyAgreement writes agreement2 / statusCombined and never the strict status", () => {
  const A = ledgerOf(quran(Q.replace("والإحسان", "والإيمان"))), B = ledgerOf(quran(Q));
  const a0 = JSON.stringify(A), b0 = JSON.stringify(B);
  const r1 = compareLedgers(A, B), r2 = compareLedgers(A, B);
  assert.equal(JSON.stringify(A), a0); assert.equal(JSON.stringify(B), b0);
  assert.equal(JSON.stringify(r1, (k, v) => (k === "entry" ? undefined : v)), JSON.stringify(r2, (k, v) => (k === "entry" ? undefined : v)));
  const e = textual(A)[0];
  assert.equal(statusOf(e), "partial");
  applyAgreement(A, r1);
  assert.equal(e.status, "partial"); assert.equal(e.statusCombined, "verbatim"); assert.equal(statusOf(e), "verbatim");
  assert.equal(e.mushaf, undefined, "the Mushaf replacement still needs the primary words to map one to one");
  const marks = marksOf(e), i = e.diff.findIndex(d => d.kind === "diff");
  assert.deepEqual(marks.get(i), { c: "disagree", b: "والاحسان" });
  assert.equal(marks.size, 1);
  for (const x of A) if (!r1.entries[A.indexOf(x)]) assert.equal(x.agreement2, undefined);
  applyAgreement(A, null);
  assert.equal(e.agreement2, undefined); assert.equal(e.statusCombined, undefined); assert.equal(statusOf(e), "partial");
});

// ---- the rules on hand-made entries (no engine): each case isolates one guard
const ent = (ref, start, end, items, more = {}) => {
  const q = /^\d+:/.test(ref), [surah, ay] = q ? ref.split(":") : [], [a1, a2] = q ? ay.split("-").map(Number) : [];
  let p = more.at || 0;
  const diff = items.map(it => { const [kind, spoken, source] = it; const d = { kind, spoken, source }; if (source) { d.srcPos = p; p += source.split(" ").length; if (source.includes(" ")) d.srcN = 2; } return d; });
  return { status: more.status || (items.every(i => i[0] === "exact") ? "verbatim" : "partial"), start, end, wordStart: more.ws || 0, wordEnd: more.we || items.length - 1,
    source: q ? { type: "q", ref, surah: +surah, ayah: a1, ayahEnd: a2 || a1 } : { type: "h", ref }, posKey: q ? "q:" + surah : "h:" + ref, diff };
};
const ex = w => ["exact", w, w];

test("guards: time overlap, added words, split entries, words only one transcript covers", () => {
  const base = ["a", "b", "c", "d", "e", "f"].map(ex);
  // the same passage quoted again much later is another quotation
  let r = compareLedgers([ent("x:1", 10, 16, base)], [ent("x:1", 200, 206, base)]);
  assert.equal(r.entries[0].agreement2.paired, false);
  assert.equal(r.extra.length, 1);
  // under 30% of the shorter entry (beyond the tolerance): not a pair
  r = compareLedgers([ent("x:1", 0, 40, base)], [ent("x:1", 43.5, 80, base)]);
  assert.equal(r.entries[0].agreement2.paired, false);
  r = compareLedgers([ent("x:1", 0, 40, base)], [ent("x:1", 43.5, 80, base)], { tolerance: 20 });
  assert.equal(r.entries[0].agreement2.paired, true, "a generous tolerance for approximate word times");
  // an added word: confirmed only when both have the same word at the same place
  const withIns = (w, at = 2) => [...base.slice(0, at), ["ins", w, ""], ...base.slice(at)];
  r = compareLedgers([ent("x:1", 0, 6, withIns("zz"))], [ent("x:1", 0, 6, withIns("zz"))]);
  assert.deepEqual([r.entries[0].agreement2.verdict, r.entries[0].agreement2.confirmed], ["difference_confirmed", 1]);
  r = compareLedgers([ent("x:1", 0, 6, withIns("zz"))], [ent("x:1", 0, 6, base)]);
  assert.deepEqual([r.entries[0].agreement2.verdict, r.entries[0].agreement2.disagree, r.entries[0].statusCombined], ["verbatim_supported", 1, "verbatim"]);
  r = compareLedgers([ent("x:1", 0, 6, withIns("zz"))], [ent("x:1", 0, 6, withIns("zz", 4))]);
  assert.equal(r.entries[0].agreement2.confirmed, 0, "the same word at another place confirms nothing");
  r = compareLedgers([ent("x:1", 0, 6, withIns("zz"))], [ent("x:1", 0, 6, withIns("yy"))]);
  assert.equal(r.entries[0].agreement2.verdict, "unresolved");
  // the primary has one entry where the second has two: both stand for it
  const long = "abcdefgh".split("").map(ex); long[1] = ["diff", "B", "b"]; long[6] = ["diff", "G", "g"];
  r = compareLedgers([ent("x:1", 0, 8, long)], [ent("x:1", 0, 4, "abcd".split("").map(ex)), ent("x:1", 4, 8, "efgh".split("").map(ex), { at: 4 })]);
  assert.equal(r.entries[0].agreement2.oneExact, 2);
  assert.equal(r.entries[0].statusCombined, "verbatim");
  assert.equal(r.extra.length, 0);
  // … and the other way round: each primary entry answers for its own words only
  r = compareLedgers([ent("x:1", 0, 4, "abcd".split("").map(ex)), ent("x:1", 4, 8, [ex("e"), ex("f"), ["diff", "G", "g"], ex("h")], { at: 4 })], [ent("x:1", 0, 8, "abcdefgh".split("").map(ex))]);
  assert.deepEqual(r.entries.map(x => x.agreement2.positions.length), [4, 4]);
  assert.deepEqual(r.entries.map(x => x.statusCombined), ["verbatim", "verbatim"]);
  // a difference the second transcript does not cover stays unsettled; a word of the source it does not cover is no objection
  r = compareLedgers([ent("x:1", 0, 6, [ex("a"), ex("b"), ex("c"), ex("d"), ex("e"), ["diff", "F", "f"]])], [ent("x:1", 0, 5, "abcde".split("").map(ex))]);
  assert.deepEqual([r.entries[0].agreement2.verdict, r.entries[0].agreement2.unresolved], ["unresolved", 1]);
  assert.equal(r.entries[0].agreement2.positions[5].c, ONLY_ONE_COVERS);
  r = compareLedgers([ent("x:1", 0, 6, [["diff", "A", "a"], ...base.slice(1)])], [ent("x:1", 0, 5, "abcde".split("").map(ex))]);
  assert.equal(r.entries[0].statusCombined, "verbatim");
  // Qur'an: the same surah with overlapping ayah ranges pairs, another surah or other ayahs never
  r = compareLedgers([ent("2:1-2", 0, 6, base)], [ent("2:2-3", 0, 6, base.slice(2), { at: 2 })]);
  assert.equal(r.entries[0].agreement2.paired, true);
  r = compareLedgers([ent("2:1", 0, 6, base)], [ent("3:1", 0, 6, base)]);
  assert.equal(r.entries[0].agreement2.paired, false);
  r = compareLedgers([ent("2:1", 0, 6, base)], [ent("2:5", 0, 6, base, { at: 40 })]);
  assert.equal(r.entries[0].agreement2.paired, false);
  // an entry whose words have no positions is left alone
  const blind = ent("x:1", 0, 6, base); delete blind.posKey;
  r = compareLedgers([blind], [ent("x:1", 0, 6, base)]);
  assert.deepEqual(r.entries[0].agreement2, { paired: false, why: "nopos" });
  // statuses other than textual get nothing; a verbatim primary is never made worse
  r = compareLedgers([{ status: "notfound", start: 0, end: 5 }, ent("x:1", 0, 6, base)], [ent("x:1", 0, 6, [["diff", "A", "a"], ...base.slice(1)])]);
  assert.equal(r.entries[0], null);
  assert.deepEqual([r.entries[1].agreement2.verdict, r.entries[1].statusCombined], ["verbatim_supported", "verbatim"]);
});

test("a word the engine excused as mis-heard counts as the source's word; a confirmed word that sounds like the source's is flagged", () => {
  const items = k => [ex("a"), [k, "bb", "b"], ex("c"), ex("d")];
  let r = compareLedgers([ent("x:1", 0, 4, items("near"), { status: "verbatim" })], [ent("x:1", 0, 4, items("near"), { status: "verbatim" })]);
  assert.deepEqual([r.entries[0].agreement2.verdict, r.entries[0].agreement2.excused, r.entries[0].agreement2.confirmed], ["verbatim_supported", 1, 0]);
  r = compareLedgers([ent("x:1", 0, 4, items("asr"), { status: "verbatim" })], [ent("x:1", 0, 4, items("exact"))]);
  assert.equal(r.entries[0].agreement2.oneExact, 1);
  const near = [ex("a"), ["diff", "القرن", "القران"], ex("c"), ex("d")];
  r = compareLedgers([ent("x:1", 0, 4, near)], [ent("x:1", 0, 4, near)]);
  assert.deepEqual([r.entries[0].agreement2.confirmed, r.entries[0].agreement2.confirmedNear, r.entries[0].statusCombined], [1, 1, "partial"]);
});

test("timeTolerance: 3 s for real word times, the window length (at most 30 s) for words spread evenly", () => {
  const real = []; let t = 0;
  for (let i = 0; i < 60; i++) { const d = 0.2 + ((i * 7) % 5) * 0.11; real.push({ w: "w", start: t, end: t + d }); t += d + 0.05; }
  assert.equal(timeTolerance(real), 3);
  const spread = [];
  for (let k = 0; k < 4; k++) for (let i = 0; i < 20; i++) spread.push({ w: "w", start: +(k * 30 + i * 1.4).toFixed(2), end: +(k * 30 + (i + 1) * 1.4).toFixed(2) });
  assert.equal(timeTolerance(spread), 28);
  assert.equal(timeTolerance(mk("a b c d e f g h i j", false)), 3);
  assert.equal(timeTolerance([]), 3);
});

test("asr client: answers without word times are spread over the piece; Gemini's direct-upload rule; transcriber labels", async () => {
  const { wordsFromWhisper, sentDirect, spreadWords } = await import("../public/js/asr.js");
  const { transcriberLabel, setLangForTests } = await import("../public/js/i18n.js");
  // timestamps:false (or an empty words list): the words of `text` are spread evenly over the duration, from the offset
  assert.deepEqual(wordsFromWhisper({ text: "a b c d", words: [], duration: 8 }, 10), [0, 1, 2, 3].map(i => ({ w: "abcd"[i], start: 10 + 2 * i, end: 12 + 2 * i })));
  assert.deepEqual(wordsFromWhisper({ text: "a b", timestamps: false, words: [{ word: "a", start: 0, end: 0 }, { word: "b", start: 0, end: 0 }] }, 0, 4), spreadWords("a b", 0, 4));
  assert.deepEqual(wordsFromWhisper({ text: "a b", words: [] }), [{ w: "a" }, { w: "b" }], "no duration known: no times are invented");
  assert.deepEqual(wordsFromWhisper({ text: "x", words: [{ word: " a", start: 1, end: 2 }], provider: "gemini" }), [{ w: "a", start: 1, end: 2 }]);
  // Gemini: sent as it is only when the duration is known, at most 25 minutes, and the file at most 24,000,000 bytes
  assert.equal(sentDirect(5e6, 1500, "gemini"), true);
  assert.equal(sentDirect(5e6, 1501, "gemini"), false);
  assert.equal(sentDirect(5e6, null, "gemini"), false);
  assert.equal(sentDirect(24_000_001, 60, "gemini"), false);
  assert.equal(sentDirect(5e6, null, "groq"), true); assert.equal(sentDirect(5e6, 7200, null), true);
  assert.equal(sentDirect(24_000_001, 60, null), false);
  setLangForTests("ar");
  assert.equal(transcriberLabel({ provider: "groq", model: "whisper-large-v3" }), "Whisper (Groq) · whisper-large-v3");
  assert.equal(transcriberLabel({ provider: "gemini" }), "Gemini 3.5 Transcribe");
  assert.equal(transcriberLabel({ provider: "file", name: "a.json" }), "ملف «a.json»");
  assert.equal(transcriberLabel({ provider: "other-asr", model: "m" }), "other-asr · m");
});
