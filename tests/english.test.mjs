import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpusWith } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";
import { wordsFromText, normEn, normMixed, stem, fold } from "../public/js/text.js";
import { findQuranReferences, findCues } from "../public/js/cues.js";

const corpus = await loadCorpusWith(["en-quran", "en-hadith"]);
const run = text => analyze(wordsFromText(text), corpus).ledger;
const FILL = "So brothers and sisters, today we want to reflect on good character and how it shapes the life of a believer.";

test("English normalisation and stemming", () => {
  assert.equal(normEn("Allāh’s Messenger (ﷺ) said, “The reward…”"), "allah s messenger said the reward");
  assert.equal(normMixed("٢٥٥"), "255");
  assert.equal(stem("believers"), stem("believer"));
});

test("a verse read in English resolves to the Arabic ayah, and the spoken reference is checked", () => {
  const L = run(`${FILL} Allah says in Surah Al-Baqarah, verse 255: Allah - there is no deity except Him, the Ever-Living, the Sustainer of all existence. Neither drowsiness overtakes Him nor sleep. ${FILL}`);
  const e = L.find(x => x.type === "q" && x.status === "verbatim");
  assert.ok(e); assert.equal(e.source.ref, "2:255"); assert.equal(e.source.via, "en");
  assert.equal(e.attribution.code, "ref_ok");
});

test("a wrong spoken reference is flagged", () => {
  const L = run(`${FILL} Allah says in Surah An-Nisa verse 3: Indeed, Allah orders justice and good conduct and giving to relatives and forbids immorality and bad conduct and oppression. ${FILL}`);
  const e = L.find(x => x.type === "q" && x.status === "verbatim");
  assert.equal(e.source.ref, "16:90"); assert.equal(e.attribution.code, "ref_mismatch");
});

test("a hadith read in English resolves to the Arabic hadith; 'reported by Bukhari' is confirmed", () => {
  const L = run(`${FILL} The Prophet, peace be upon him, said: The reward of deeds depends upon the intentions and every person will get the reward according to what he has intended. This was reported by Bukhari. ${FILL}`);
  const e = L.find(x => x.type === "h" && x.status === "verbatim");
  assert.ok(e && [e.source, ...e.parallels].some(s => s.ref === "bukhari:1"));
  assert.equal(e.attribution.code, "collection_ok");
});

test("Arabic recitation inside English speech is still matched in Arabic", () => {
  const L = run(`${FILL} and he recited قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد and then he explained it. ${FILL}`);
  const e = L.find(x => x.type === "q" && x.status === "verbatim");
  assert.ok(e && e.source.surah === 112 && !e.source.via);
});

test("an English saying that is not in the corpus is not matched", () => {
  const L = run(`${FILL} The Prophet said: seek knowledge even if you have to go to China. ${FILL}`);
  assert.equal(L.filter(x => x.status === "verbatim" || x.status === "partial").length, 0);
  assert.ok(L.some(x => x.status === "notfound"));
});

test("explicit references are parsed in both languages", () => {
  const tok = s => wordsFromText(s).flatMap(w => normMixed(w.w).split(" ")).filter(Boolean).map(fold);
  assert.deepEqual(findQuranReferences(tok("as in Surah Yusuf verse 87")).map(r => [r.surah, r.ayah]), [[12, 87]]);
  assert.deepEqual(findQuranReferences(tok("chapter 2 verse 255")).map(r => [r.surah, r.ayah]), [[2, 255]]);
  assert.deepEqual(findQuranReferences(tok("في سورة البقرة الآية 255")).map(r => [r.surah, r.ayah]), [[2, 255]]);
  assert.equal(findCues(tok("the prophet peace be upon him said that"))[0].kind, "hadith");
});

test("a standalone reference becomes a lead showing the referenced verse", () => {
  const L = run(`${FILL} For this you should read Surah Yusuf verse 87 at home. ${FILL}`);
  const e = L.find(x => x.source && x.source.ref === "12:87") || L.find(x => x.reference && x.reference.ref === "12:87");
  assert.ok(e);
});
