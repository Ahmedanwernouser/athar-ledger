// real.mjs — evaluation on REAL recordings: Whisper transcripts of the team reading eval/recording_script.md.
//   node eval/real.mjs   -> eval/RESULTS_REAL.md   (requires eval/transcripts/<speaker>__clip_NN.json from eval/transcribe.mjs)
// Measures (a) the real word error rate of the transcription against the script that was read — over the whole clip
// and over the quoted words alone — and (b) what the engine finds in those real transcripts, against the ground truth.
// The recordings are READ SPEECH from fully vocalised text: cleaner than a real lecture. The report says so.
//   EVAL_TRANSCRIPTS=<dir>  REAL_OUT=<file>   read transcripts from / write the report to another place (used for testing)
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadCorpus, EVAL, ar } from "./lib.mjs";
import { containing, family } from "./gen.mjs";
import { analyze } from "../public/js/engine.js";
import { norm } from "../public/js/text.js";

const TR = process.env.EVAL_TRANSCRIPTS || path.join(EVAL, "transcripts");
const OUT = process.env.REAL_OUT || path.join(EVAL, "RESULTS_REAL.md");
const truth = new Map(JSON.parse(readFileSync(path.join(EVAL, "ground_truth.json"), "utf8")).map(t => [t.clip, t]));
const files = existsSync(TR) ? readdirSync(TR).filter(f => f.endsWith(".json")).sort() : [];
if (!files.length) { console.error(`لا توجد ملفات تفريغ في ${TR} — شغّل eval/transcribe.mjs أولًا.`); process.exit(1); }
const corpus = await loadCorpus();

/** word-level alignment (Levenshtein). Returns the total number of errors and, for a span [qa,qb) of the reference,
 *  the errors that fall inside it (substitutions and deletions of its words, insertions between its words). */
function wer(ref, hyp, qa = 0, qb = 0) {
  const a = ref.split(" ").filter(Boolean), b = hyp.split(" ").filter(Boolean), W = b.length + 1;
  const D = new Int32Array((a.length + 1) * W);
  for (let j = 0; j <= b.length; j++) D[j] = j;
  for (let i = 1; i <= a.length; i++) { D[i * W] = i;
    for (let j = 1; j <= b.length; j++) D[i * W + j] = Math.min(D[(i - 1) * W + j] + 1, D[i * W + j - 1] + 1, D[(i - 1) * W + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); }
  let i = a.length, j = b.length, inQ = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i * W + j] === D[(i - 1) * W + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { if (a[i - 1] !== b[j - 1] && i - 1 >= qa && i - 1 < qb) inQ++; i--; j--; }
    else if (i > 0 && D[i * W + j] === D[(i - 1) * W + j] + 1) { if (i - 1 >= qa && i - 1 < qb) inQ++; i--; }
    else { if (i > qa && i < qb) inQ++; j--; }
  }
  return { errors: D[a.length * W + b.length], n: a.length, qErrors: inQ, qn: Math.max(0, qb - qa) };
}
const wordsOf = j => (j.words && j.words.length ? j.words.map(x => ({ w: x.word, start: x.start, end: x.end })) : String(j.text || "").split(/\s+/).filter(Boolean).map(w => ({ w })));
/** core passage ids named by one shown source (a Qur'an range names every ayah in it) */
function pidsOf(s) {
  if (!s || typeof s.ref !== "string") return [];
  if (s.type === "q" && s.surah != null) { const out = []; for (let a = s.ayah; a <= (s.ayahEnd ?? s.ayah); a++) { const p = corpus.coreRef.get(`${s.surah}:${a}`); if (p != null) out.push(p); } return out; }
  const p = corpus.coreRef.get(s.ref); return p == null ? [] : [p];
}
/** Every passage that may rightly be shown for a clip: the truth; any passage that CONTAINS the quoted words (identical
 *  verses, parallel narrations with the same wording); and, for hadith, the FAMILY of the truth — parallel narrations
 *  of the same text by the generator's shared-trigram rule, in either direction. Returns a test pid -> boolean. */
function acceptable(t) {
  const acc = new Set();
  if (!t.truth) return () => false;
  const p = corpus.coreRef.get(t.truth.ref); if (p != null) acc.add(p);
  if (t.kind.startsWith("verbatim")) for (const q of containing(corpus, t.quoted_norm.split(" "), t.truth.type === "q")) acc.add(q);
  if (p == null || t.truth.type === "q") return q => acc.has(q);
  for (const q of family(corpus, p)) if (!corpus.isQuran(q)) acc.add(q);
  const back = new Map();
  return q => { if (acc.has(q)) return true; if (corpus.isQuran(q)) return false; let v = back.get(q); if (v == null) back.set(q, v = family(corpus, q).has(p)); return v; };
}
const TEXTUAL = new Set(["verbatim", "partial"]);

const rows = [], skipped = [], models = new Set();
let E = 0, N = 0, EQ = 0, NQ = 0;
for (const f of files) {
  const m = /^(.+)__(clip_\d+)\.json$/.exec(f);
  if (!m) { skipped.push({ f, why: "الاسم ليس بالصيغة <المتحدث>__clip_NN.json" }); continue; }
  const [, speaker, clip] = m, t = truth.get(clip);
  if (!t) { skipped.push({ f, why: `لا يوجد مقطع باسم ${clip} في ground_truth.json` }); continue; }
  let j; try { j = JSON.parse(readFileSync(path.join(TR, f), "utf8")); } catch { skipped.push({ f, why: "ملف JSON غير صالح" }); continue; }
  if (j._model) models.add(j._model);
  const hyp = norm(j.text || wordsOf(j).map(w => w.w).join(" "));
  const ref = norm(t.script), refW = ref.split(" "), qW = t.quoted_norm.split(" ");
  let qa = -1; for (let i = 0; i + qW.length <= refW.length && qa < 0; i++) { let ok = true; for (let k = 0; k < qW.length; k++) if (refW[i + k] !== qW[k]) { ok = false; break; } if (ok) qa = i; }
  // quote-only WER is defined only for clips that contain a quotation from the corpus (not for the abstention clips)
  const w = qa >= 0 && t.truth ? wer(ref, hyp, qa, qa + qW.length) : wer(ref, hyp);
  E += w.errors; N += w.n; EQ += w.qErrors; NQ += w.qn;
  const led = analyze(wordsOf(j), corpus).ledger;
  const acc = acceptable(t);
  const ok = e => [e.source, ...(e.parallels || [])].some(s => pidsOf(s).some(p => acc(p)));
  // the entry that covers the quotation best (by shared words with the quoted text); none for abstention clips
  const q = new Set(qW);
  const scored = led.map(e => ({ e, s: norm(e.spoken || "").split(" ").filter(x => q.has(x)).length })).sort((x, y) => y.s - x.s);
  const best = t.truth && scored.length && scored[0].s >= 3 ? scored[0].e : null;
  const textual = !!best && TEXTUAL.has(best.status);
  const firstOK = textual && pidsOf(best.source).some(p => acc(p));
  const anyOK = textual && ok(best);
  // by-meaning candidates and "not found" suggestions are counted too (as the synthetic evaluation does)
  const list = best ? (best.candidates || best.suggestions || []) : [];
  const rank = list.findIndex(s => pidsOf(s).some(p => acc(p)));
  // false citations: every OTHER textual entry in the clip whose sources are not acceptable (the rest of a clip is filler)
  const others = led.filter(e => e !== best && TEXTUAL.has(e.status) && !ok(e));
  rows.push({ speaker, clip, kind: t.kind, expected: t.expected_class || "حرفي", wer: w.errors / w.n, qwer: w.qn ? w.qErrors / w.qn : null,
    status: best ? best.statusAr : (led.some(e => e.status === "meaning") ? "بالمعنى (اقتراح)" : led.some(e => e.status === "notfound") ? "لم يُعثر عليه" : "لا شيء"),
    textual, verbatimLabel: !!best && best.status === "verbatim", firstOK, anyOK, rank, wrong: textual && !anyOK, falseCites: others.map(e => `${e.source ? e.source.short : "?"} («${e.spoken}»)`),
    meaningShown: led.filter(e => e.status === "meaning").length,
    source: best && best.source ? best.source.short : (rank >= 0 ? list[rank].short + ` (اقتراح رقم ${rank + 1})` : "") });
}
if (skipped.length) { console.error(`تحذير: ${skipped.length} ملفًا لم يُحسب:`); for (const s of skipped) console.error("  -", s.f, "—", s.why); }
if (!rows.length) { console.error("لا يوجد أي ملف تفريغ صالح."); process.exit(1); }

const pct = (a, b) => b ? ar((100 * a / b).toFixed(1)) + "٪" : "—";
const verb = rows.filter(r => r.kind.startsWith("verbatim")), para = rows.filter(r => r.kind === "paraphrase_or_mixed"), abst = rows.filter(r => r.kind === "absent_saying" || r.kind === "cue_only");
const falseTotal = rows.reduce((s, r) => s + r.falseCites.length, 0), wrongBest = rows.filter(r => r.wrong).length;
const KIND = { verbatim_quran: "آية حرفية", verbatim_hadith: "حديث حرفي", paraphrase_or_mixed: "بالمعنى أو مخلوط", absent_saying: "عبارة ليست في المدونة", cue_only: "عبارة استشهاد بلا اقتباس" };
const L = ["# نتائج القياس على تسجيلات حقيقية\n",
  "> **قراءة من نص مكتوب.** التسجيلات قراءة لنص مشكول في غرفة هادئة؛ هي أنظف من محاضرة حقيقية مرتجلة. نسبة الخطأ في محاضرة حقيقية ستكون على الأرجح أعلى.\n",
  `- عدد المقاطع المفرَّغة: ${ar(rows.length)} (المتحدثون: ${[...new Set(rows.map(r => r.speaker))].join("، ")}).`,
  `- نموذج التفريغ: ${models.size ? [...models].join("، ") : "غير مسجَّل في ملفات التفريغ"}.`,
  `- **نسبة الخطأ في الكلمات (WER) للتفريغ مقابل النص المقروء: ${pct(E, N)}** على المقطع كله، و**${pct(EQ, NQ)}** على الكلمات المقتبسة وحدها (بعد توحيد الإملاء وحذف التشكيل).`,
  `- الاستشهادات الحرفية (${ar(verb.length)} مقطعًا): اكتُشف نصيًّا ${ar(verb.filter(r => r.textual).length)} (${pct(verb.filter(r => r.textual).length, verb.length)})؛ المصدر الأول صحيح في ${ar(verb.filter(r => r.firstOK).length)}، وأحد المصادر المعروضة صحيح في ${ar(verb.filter(r => r.anyOK).length)}. المصدر الصحيح: أي مقطع في المدونة يحتوي الكلمات المقتبسة، أو رواية موازية للحديث نفسه.`,
  `- الوصف (القاعدة الصارمة): من ${ar(verb.filter(r => r.textual).length)} استشهادًا حرفيًّا مكتشفًا وُصف ${ar(verb.filter(r => r.verbatimLabel).length)} بأنه مطابق حرفيًّا و${ar(verb.filter(r => r.textual && !r.verbatimLabel).length)} بأنه مطابق جزئيًّا (أي أن التفريغ أظهر فرقًا في الألفاظ). ومن ${ar(para.length)} مقطعًا بالمعنى أو مخلوطًا وُصف ${ar(para.filter(r => r.verbatimLabel).length)} بأنه مطابق حرفيًّا.`,
  `- الاقتباسات بالمعنى أو المخلوطة (${ar(para.length)} مقطعًا): وُجد المصدر تطابقًا نصيًّا في ${ar(para.filter(r => r.anyOK).length)}، وأولَ اقتراح في ${ar(para.filter(r => !r.anyOK && r.rank === 0).length)}، وضمن الاقتراحات الخمسة الأولى في ${ar(para.filter(r => !r.anyOK && r.rank > 0 && r.rank < 5).length)} أخرى.`,
  `- مقاطع الامتناع (${ar(abst.length)} مقطعًا: عبارات ليست في المدونة، وعبارات استشهاد بلا اقتباس): بقي ${ar(abst.filter(r => !r.falseCites.length).length)} بلا أي استشهاد نصي؛ وعُرض اقتراح «بالمعنى» في ${ar(abst.filter(r => r.meaningShown).length)}.`,
  `- **أخطاء حرجة: ${ar(wrongBest + falseTotal)}** = ${ar(wrongBest)} استشهادًا نصيًّا على الاقتباس بمصدر خاطئ + ${ar(falseTotal)} استشهادًا نصيًّا خاطئًا في بقية المقطع (كلام الحشو أو مقاطع الامتناع).`,
  ...(skipped.length ? [`- **ملفات لم تُحسب (${ar(skipped.length)}):** ` + skipped.map(s => `\`${s.f}\` (${s.why})`).join("؛ ") + "."] : []), "",
  "| المتحدث | المقطع | النوع | المتوقَّع | WER | WER الاقتباس | الوصف | المصدر المعروض | المصدر صحيح؟ | استشهادات خاطئة أخرى |", "|---|---|---|---|---|---|---|---|---|---|",
  ...rows.sort((a, b) => a.clip.localeCompare(b.clip) || a.speaker.localeCompare(b.speaker)).map(r =>
    `| ${r.speaker} | ${r.clip} | ${KIND[r.kind] || r.kind} | ${r.expected} | ${ar((100 * r.wer).toFixed(0))}٪ | ${r.qwer == null ? "—" : ar((100 * r.qwer).toFixed(0)) + "٪"} | ${r.status} | ${r.source} | ${r.anyOK ? "نعم" : r.textual ? "**لا**" : r.rank >= 0 ? "اقتراح" : "—"} | ${r.falseCites.length ? "**" + r.falseCites.join("؛ ") + "**" : "—"} |`), ""];
writeFileSync(OUT, L.join("\n"));
console.log(L.slice(1, 11).join("\n"));
