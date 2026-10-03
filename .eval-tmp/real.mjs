// real.mjs — evaluation on REAL recordings: Whisper transcripts of the team reading eval/recording_script.md.
//   node eval/real.mjs   -> eval/RESULTS_REAL.md   (requires eval/transcripts/*.json from eval/transcribe.mjs)
// Measures (a) the real word error rate of the transcription against the script that was read, and
// (b) what the engine finds in those real transcripts, against the known ground truth.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadCorpus, ROOT } from "./lib.mjs";
import { analyze } from "../public/js/engine.js";
import { norm, editDistance } from "../public/js/text.js";

const TR = path.join(ROOT, ".eval-tmp", "transcripts");
const truth = new Map(JSON.parse(readFileSync(path.join(ROOT, ".eval-tmp", "ground_truth.json"), "utf8")).map(t => [t.clip, t]));
const files = readdirSync(TR).filter(f => f.endsWith(".json"));
if (!files.length) { console.error("لا توجد ملفات تفريغ في eval/transcripts/ — شغّل eval/transcribe.mjs أولًا."); process.exit(1); }
const corpus = await loadCorpus();

/** word error rate = word-level edit distance / reference length (after normalisation) */
function wer(ref, hyp) {
  const a = ref.split(" "), b = hyp.split(" ");
  let prev = b.map((_, j) => j + 1); prev.unshift(0);
  for (let i = 1; i <= a.length; i++) { const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur; }
  return { errors: prev[b.length], n: a.length };
}
const wordsOf = j => (j.words && j.words.length ? j.words.map(x => ({ w: x.word, start: x.start, end: x.end })) : String(j.text || "").split(/\s+/).filter(Boolean).map(w => ({ w })));

const rows = []; let E = 0, N = 0, EQ = 0, NQ = 0;
for (const f of files) {
  const [speaker, clip] = f.replace(/\.json$/, "").split("__");
  const t = truth.get(clip); if (!t) continue;
  const j = JSON.parse(readFileSync(path.join(TR, f), "utf8"));
  const hyp = norm(j.text || wordsOf(j).map(w => w.w).join(" "));
  const all = wer(norm(t.script), hyp); E += all.errors; N += all.n;
  const led = analyze(wordsOf(j), corpus).ledger;
  // the entry that covers the quotation best (by shared words with the quoted text)
  const q = new Set(t.quoted_norm.split(" "));
  const scored = led.map(e => ({ e, s: norm(e.spoken).split(" ").filter(w => q.has(w)).length })).sort((x, y) => y.s - x.s);
  const best = scored.length && scored[0].s >= 3 ? scored[0].e : null;
  const refs = best ? [best.source, ...(best.parallels || []), ...(best.candidates || [])].filter(Boolean).map(s => s.ref) : [];
  const want = t.truth.ref;
  const srcOK = refs.some(r => r === want || (t.truth.type === "q" && r.split(":")[0] === want.split(":")[0] && (() => { const [a, b] = r.split(":")[1].split("-").map(Number), v = +want.split(":")[1]; return v >= a && v <= (b || a); })()));
  const textual = best && (best.status === "verbatim" || best.status === "partial");
  rows.push({ speaker, clip, kind: t.kind, expected: t.expected_class || "حرفي", wer: all.errors / all.n,
    status: best ? best.statusAr : "لا شيء", textual, srcOK, wrong: textual && !srcOK, source: best && best.source ? best.source.short : "" });
}
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + "٪" : "—";
const verb = rows.filter(r => r.kind.startsWith("verbatim")), para = rows.filter(r => !r.kind.startsWith("verbatim"));
const L = ["# نتائج القياس على تسجيلات حقيقية\n",
  `- عدد المقاطع المفرَّغة: ${rows.length} (المتحدثون: ${[...new Set(rows.map(r => r.speaker))].join("، ")}).`,
  `- نموذج التفريغ: ${JSON.parse(readFileSync(path.join(TR, files[0]), "utf8"))._model || "غير مسجَّل"}.`,
  `- **نسبة الخطأ في الكلمات (WER) للتفريغ مقابل النص المقروء: ${pct(E, N)}** (بعد توحيد الإملاء وحذف التشكيل).`,
  `- الاستشهادات الحرفية: اكتُشف نصيًّا ${verb.filter(r => r.textual).length} من ${verb.length} (${pct(verb.filter(r => r.textual).length, verb.length)})؛ المصدر صحيح في ${verb.filter(r => r.textual && r.srcOK).length} منها.`,
  `- **أخطاء حرجة (استشهاد نصي بمصدر خاطئ): ${rows.filter(r => r.wrong).length}**.`,
  `- الاقتباسات بالمعنى/المخلوطة: ${para.length} مقطعًا؛ وُجد مصدرها الصحيح (نصيًّا أو كمرشّح) في ${para.filter(r => r.srcOK).length}.\n`,
  "| المتحدث | المقطع | النوع | WER | الوصف | المصدر المعروض | المصدر صحيح؟ |", "|---|---|---|---|---|---|---|",
  ...rows.sort((a, b) => a.clip.localeCompare(b.clip) || a.speaker.localeCompare(b.speaker)).map(r => `| ${r.speaker} | ${r.clip} | ${r.kind} | ${(100 * r.wer).toFixed(0)}٪ | ${r.status} | ${r.source} | ${r.srcOK ? "نعم" : r.textual ? "**لا**" : "—"} |`), ""];
writeFileSync(path.join(ROOT, ".eval-tmp", "RESULTS_REAL.md"), L.join("\n"));
console.log(L.slice(1, 8).join("\n"));
