// english.mjs — English lectures: quotations read from published translations, and from translations we do NOT have.
//   node eval/english.mjs   -> eval/results_en.json, eval/RESULTS_EN.md, eval/summary.json
// THREE synthetic lectures (fixed seeds) + SIMULATED transcription noise; not a measurement of real English ASR.
// Detection uses the same rule as the Arabic evaluation: a textual entry that covers ≥50% of the quotation.
// A reference is correct only if the shown Qur'an range contains the ayah that was read (no ±1 leniency).
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadCorpusWith, ROOT, EVAL, wilson, writeTiming, writeJson, ar } from "./lib.mjs";
import { rng } from "./gen.mjs";
import { analyze } from "../public/js/engine.js";
import { normEn } from "../public/js/text.js";

const FILL = ["So brothers and sisters today we want to reflect on good character and how it shapes the life of a believer",
  "And this is something that many of us forget when we are busy with work and family and the daily routine",
  "Let us now look at this meaning from another angle which is how it changes the way we treat our neighbours",
  "I remember one of my teachers used to repeat this advice in every class until we all memorised it",
  "The scholars have spoken about this matter at length and we will only summarise the most important points",
  "If you look at the state of people today you will find that most problems come from haste and lack of patience",
  "We ask Allah to benefit us with what we learn and to make us among those who listen and then follow the best of it",
  "Now the question that comes to mind is how can a person apply this in practical life at home and at work",
  "This is a very wide topic and scholars have written many books about it in the past and in the present",
  "And I want you to think about this carefully because it is one of the most beneficial things we can learn tonight",
  "Young people often ask about this issue and they want a clear and short answer that they can act upon",
  "So whoever wants success should hold on to knowledge and action and keep the company of good people",
  "In the next session we will go into more detail on this point if time allows us to do so",
  "And remember that time is your capital so do not waste it on what does not benefit you in this life or the next",
  "Education begins at home and the father and the mother are the first example for their children",
  "It is very important to distinguish between what is established in the religion and what is only a custom of people"];
const CUE_Q = ["Allah says in the Quran", "Allah says", "Allah the Almighty says", "In the Quran Allah tells us"];
const CUE_H = ["The Prophet peace be upon him said", "The Messenger of Allah said", "In a hadith the Prophet said", "It was narrated that the Prophet said"];
const CUE_ONLY = ["The Prophet said many beautiful things about this topic which we will mention later", "Allah says in many verses what confirms this meaning for those who reflect",
  "In a hadith there is a great lesson about this but we do not have time for it today"];

const corpus = await loadCorpusWith(["en-quran", "en-hadith"]);
const heldOut = { "Abdel Haleem": "q-abdelhaleem.json", "Arberry": "q-ajarberry.json" };
const HELD = Object.fromEntries(Object.entries(heldOut).map(([name, file]) => [name, JSON.parse(readFileSync(path.join(ROOT, "data", "raw", "en", file), "utf8")).quran]));
const enQ = corpus.packs.find(p => p.id === "en-quran"), enH = corpus.packs.find(p => p.id === "en-hadith");
// Three synthetic lectures. 909 is the lecture the first version of this file used; 910 and 911 were added afterwards
// (consecutive numbers, not chosen by looking at results).
const SEEDS = [909, 910, 911];
const COUNTS = { vq: 40, vh: 60, heldPerEdition: 25, cue: 12 };
// One filler sentence («… those who listen and then follow the best of it») itself paraphrases Qur'an 39:18. A citation of
// 39:18 on that sentence is a real allusion, so it is counted apart from the false citations in filler.
const ALLUSION = { idx: FILL.findIndex(f => f.includes("follow the best of it")), surah: 39, ayah: 18 };
function buildLecture(seed) {
  const r = rng(seed), pick = a => a[Math.floor(r() * a.length)];
  const words = [], items = [], allusions = [];
  const filler = () => { const i = Math.floor(r() * FILL.length), a = words.length; words.push(...normEn(FILL[i]).split(" ")); if (i === ALLUSION.idx) allusions.push({ a, b: words.length }); };
  const add = (kind, cue, frag, truth) => {
    filler();
    if (cue) words.push(...normEn(cue).split(" "));
    const a = words.length; words.push(...frag); items.push({ kind, a, b: words.length, truth });
    filler();
  };
  for (let k = 0; k < COUNTS.vq; ) {      // verses read from an indexed translation (1–2 consecutive ayahs)
    const pid = enQ.base + Math.floor(r() * enQ.n), [, ed, s, a] = corpus.P[pid].r.split(":");
    const two = r() < 0.4 && corpus.P[pid + 1] && corpus.P[pid + 1].r.startsWith(`enq:${ed}:${s}:`);
    const frag = [...corpus.tok(pid), ...(two ? corpus.tok(pid + 1) : [])];
    if (frag.length < 8 || frag.length > 70) continue;
    add("vq", r() < 0.8 ? pick(CUE_Q) : "", frag, { surah: +s, ayah: +a }); k++;
  }
  for (let k = 0; k < COUNTS.vh; ) {      // hadith read from the indexed translation
    const pid = enH.base + Math.floor(r() * enH.n), T = corpus.tok(pid);
    // English Muwatta entries are excluded from matching by the engine (mis-paired with the Arabic upstream): never sample them
    if (corpus.P[pid].r.startsWith("en:malik:") || corpus.isDead(pid)) continue;
    if (T.length < 14) continue;
    const L = Math.min(T.length, 12 + Math.floor(r() * 30)), s = Math.floor(r() * (T.length - L + 1));
    const frag = T.slice(s, s + L), str = " " + frag.join(" ") + " ";
    const accept = new Set(corpus.postings(3, frag.slice(0, 3).join(" ")).filter(p => !corpus.isDead(p) && (" " + corpus.P[p].n + " ").includes(str)).map(p => corpus.P[p].r.slice(3)));
    accept.add(corpus.P[pid].r.slice(3));
    add("vh", r() < 0.85 ? pick(CUE_H) : "", frag, { refs: accept }); k++;
  }
  for (const [name, Q] of Object.entries(HELD)) {   // verses read from a translation that is NOT in the index
    for (let k = 0; k < COUNTS.heldPerEdition; ) {
      const x = Q[Math.floor(r() * Q.length)], frag = normEn(x.text).split(" ");
      if (frag.length < 10 || frag.length > 60) continue;
      add("held", pick(CUE_Q), frag, { surah: x.chapter, ayah: x.verse, edition: name }); k++;
    }
  }
  for (let k = 0; k < COUNTS.cue; k++) add("cue", "", normEn(pick(CUE_ONLY)).split(" "), null);
  return { words, items, allusions, pick };
}

const LET = "abcdefghijklmnopqrstuvwxyz";
function noise(ws, wer, rr, pick) {     // simulated English transcription errors: wrong letter, dropped letter, dropped / extra / glued word
  const out = [], map = [];
  for (let i = 0; i < ws.length; i++) {
    map[i] = out.length; let w = ws[i];
    if (rr() >= wer) { out.push(w); continue; }
    const x = rr();
    if (x < 0.45) { const k = Math.floor(rr() * w.length); out.push(w.slice(0, k) + LET[Math.floor(rr() * 26)] + w.slice(k + 1)); }
    else if (x < 0.65) { if (w.length > 3) { const k = Math.floor(rr() * w.length); w = w.slice(0, k) + w.slice(k + 1); } out.push(w); }
    else if (x < 0.8) { /* dropped */ }
    else if (x < 0.9) out.push(w, pick(["the", "and", "of", "so", "well"]));
    else if (i + 1 < ws.length) { map[i + 1] = out.length; out.push(w + ws[i + 1]); i++; } else out.push(w);
  }
  map[ws.length] = out.length; for (let i = ws.length - 1; i >= 0; i--) if (map[i] == null) map[i] = map[i + 1];
  return { words: out, map };
}

const TEXTUAL = new Set(["verbatim", "partial"]);
const COVER = 0.5;
const inRange = (s, t) => !!s && s.type === "q" && s.surah === t.surah && t.ayah >= s.ayah && t.ayah <= s.ayahEnd;
const RATES = [0, 0.1, 0.2];
const nH = Object.keys(heldOut).length * COUNTS.heldPerEdition;
const out = { meta: { simulated: true, lectures: SEEDS.length, seeds: SEEDS, passages: corpus.N, cover: COVER, heldOutEditions: Object.keys(heldOut), countsPerLecture: { vq: COUNTS.vq, vh: COUNTS.vh, held: nH, cue: COUNTS.cue } }, rows: [], perLecture: [] };
const times = {};
const srcs = e => [e.source, ...(e.parallels || [])].filter(Boolean);
function scoreLecture(seed, lec, wer) {
  const { words, items, allusions } = lec;
  // the first lecture keeps the noise seeds of the first version of this file
  const nz = wer ? noise(words, wer, rng(31 + wer * 100 + (seed - SEEDS[0]) * 1000), lec.pick) : { words, map: words.map((_, i) => i).concat(words.length) };
  const t0 = Date.now(), led = analyze(nz.words.map(w => ({ w })), corpus).ledger;
  times[`${seed}/${wer}`] = { seconds: +((Date.now() - t0) / 1000).toFixed(1), words: nz.words.length };
  // n, detected (textual ≥50%), reference correct [, reference within the first 5 shown (textual or suggestion)]
  const c = { seed, rate: wer, words: nz.words.length, vq: [0, 0, 0], vh: [0, 0, 0], held: [0, 0, 0, 0], wrong: [], cue: [0, 0], fillerTextual: 0, fillerAllusion: 0, allusionSentences: allusions.length, fillerExamples: [] };
  const used = new Set();
  for (const it of items) {
    const a = nz.map[it.a], b = nz.map[it.b], len = Math.max(1, b - a);
    const cov = e => (Math.min(e.te, b) - Math.max(e.ts, a)) / len;
    const over = led.filter((e, i) => { const o = cov(e) > 0; if (o) used.add(i); return o; });
    const tx = over.filter(e => TEXTUAL.has(e.status) && cov(e) >= COVER);
    if (it.kind === "vq" || it.kind === "held") {
      const k = c[it.kind]; k[0]++;
      const good = tx.some(e => srcs(e).some(s => inRange(s, it.truth)));
      if (tx.length) k[1]++; if (good) k[2]++;
      if (it.kind === "held") { const sug = over.flatMap(e => (e.candidates || e.suggestions || []).slice(0, 5)); if (good || sug.some(s => inRange(s, it.truth))) k[3]++; }
      if (tx.length && !good) for (const e of tx) c.wrong.push({ seed, kind: it.kind, truth: `${it.truth.surah}:${it.truth.ayah}`, cited: e.source.ref, status: e.status, agreement: e.agreement });
    } else if (it.kind === "vh") {
      c.vh[0]++; if (tx.length) c.vh[1]++;
      const good = tx.some(e => srcs(e).some(s => it.truth.refs.has(s.ref)));
      if (good) c.vh[2]++; else if (tx.length) for (const e of tx) c.wrong.push({ seed, kind: "vh", truth: [...it.truth.refs][0], cited: e.source.ref, status: e.status, agreement: e.agreement });
    } else { c.cue[0]++; if (!over.some(e => TEXTUAL.has(e.status))) c.cue[1]++; }
  }
  // false citations: textual entries that touch no quotation and no cue-only sentence (i.e. inside filler speech)
  led.forEach((e, i) => {
    if (used.has(i) || !TEXTUAL.has(e.status)) return;
    const onAllusion = allusions.some(x => Math.min(e.te, nz.map[x.b]) - Math.max(e.ts, nz.map[x.a]) > 0) && srcs(e).some(s => inRange(s, ALLUSION));
    if (onAllusion) c.fillerAllusion++;
    else { c.fillerTextual++; if (c.fillerExamples.length < 12) c.fillerExamples.push({ seed, status: e.status, cited: e.source.ref, spoken: e.spoken }); }
  });
  return c;
}
const lectures = SEEDS.map(seed => [seed, buildLecture(seed)]);
for (const wer of RATES) {
  const per = lectures.map(([seed, lec]) => scoreLecture(seed, lec, wer));
  out.perLecture.push(...per);
  const add = k => per[0][k].map((_, i) => per.reduce((s, c) => s + c[k][i], 0)), sum = k => per.reduce((s, c) => s + c[k], 0);
  const c = { rate: wer, lectures: per.length, words: sum("words"), vq: add("vq"), vh: add("vh"), held: add("held"), wrong: per.flatMap(x => x.wrong), cue: add("cue"),
    fillerTextual: sum("fillerTextual"), fillerAllusion: sum("fillerAllusion"), allusionSentences: sum("allusionSentences"), fillerExamples: per.flatMap(x => x.fillerExamples) };
  c.vqCI = wilson(c.vq[2], c.vq[0]); c.vhCI = wilson(c.vh[2], c.vh[0]);
  c.heldCI = wilson(c.held[2], c.held[0]); c.heldTop5CI = wilson(c.held[3], c.held[0]);
  c.heldPerLecture = per.map(x => x.held[2]);
  out.rows.push(c);
}
writeJson("results_en.json", out);
writeTiming("english", times);

const pc = r => ar(Math.round(r * 100)) + "٪";
const of = (k, n) => `${ar(k)} من ${ar(n)}`;
const civ = c => `${ar(c[0])}–${ar(c[1])}٪`;
const nLec = SEEDS.length, M = out.meta.countsPerLecture;
const L = ["# نتائج القياس — المحاضرات الإنجليزية (محاكاة)\n",
  `> **محاكاة.** ${ar(nLec)} محاضرات مُركَّبة وضجيج تفريغ محاكى. هذه ليست أرقام تفريغ إنجليزي حقيقي، ولم يُختبر أي صوت حقيقي.\n`,
  `- المدونة: الأساس + ترجمات القرآن الخمس + ترجمة كتب الحديث (${ar(corpus.N.toLocaleString("en"))} مقطعًا). ترجمة الموطأ الإنجليزية مستبعدة من المطابقة في المحرك، ولا يؤخذ منها أي اقتباس في هذا القياس.`,
  `- ${ar(nLec)} محاضرات مُركَّبة (البذور ${SEEDS.map(ar).join("، ")}). في كل محاضرة: ${ar(M.vq)} آية و${ar(M.vh)} حديثًا مقروءة من الترجمات المفهرسة، و${ar(M.held)} آية مقروءة من ترجمتين **غير مفهرستين** (Abdel Haleem و Arberry)، و${ar(M.cue)} عبارة استشهاد بلا اقتباس. الأعداد في الجدول مجموع المحاضرات.`,
  "- «اكتُشف»: استشهاد نصي (حرفي أو جزئي) يغطي ٥٠٪ أو أكثر من موضع الاقتباس — المعيار نفسه في القياس العربي.",
  "- «استشهاد نصي بمرجع خاطئ»: استشهاد نصي يغطي ٥٠٪ أو أكثر من الاقتباس، ومرجعه ليس المقروء. يُعدّ خطأ.",
  "- «المرجع صحيح»: مدى الآيات المعروض يحتوي الآية المقروءة نفسها، أو الحديث المعروض (أو أحد مواضعه) هو الحديث المقروء. لا تسامح بآية مجاورة.",
  "- مجال الثقة: ويلسون ٩٥٪ على مجموع الاقتباسات.",
  "- نسبة الضجيج = نسبة الكلمات المصابة في المحاكاة (حرف خاطئ، حرف ساقط، كلمة ساقطة أو زائدة أو ملتصقة)، وليست نسبة خطأ نظام تفريغ حقيقي.\n",
  "## الجدول (محاكاة)\n",
  "| نسبة الكلمات المصابة | آيات من ترجمة مفهرسة: اكتُشفت / المرجع صحيح | مجال الثقة ٩٥٪ (المرجع صحيح) | أحاديث مترجمة: اكتُشفت / المرجع صحيح | مجال الثقة ٩٥٪ (المرجع صحيح) | ترجمة غير مفهرسة: تطابق نصي بمرجع صحيح | مجال الثقة ٩٥٪ | ترجمة غير مفهرسة: المرجع ضمن أول ٥ (نصي أو اقتراح) | مجال الثقة ٩٥٪ | استشهاد نصي بمرجع خاطئ | عبارات بلا اقتباس بقيت بلا تطابق | استشهاد نصي خاطئ في الحشو | استشهاد بالآية ٣٩:١٨ على جملة حشو تعيد صياغتها |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
for (const c of out.rows) L.push(`| ${pc(c.rate)} | ${ar(c.vq[1])} / ${ar(c.vq[2])} من ${ar(c.vq[0])} | ${civ(c.vqCI)} | ${ar(c.vh[1])} / ${ar(c.vh[2])} من ${ar(c.vh[0])} | ${civ(c.vhCI)} | ${of(c.held[2], c.held[0])} | ${civ(c.heldCI)} | ${of(c.held[3], c.held[0])} | ${civ(c.heldTop5CI)} | ${ar(c.wrong.length)} | ${of(c.cue[1], c.cue[0])} | ${ar(c.fillerTextual)} | ${ar(c.fillerAllusion)} من ${ar(c.allusionSentences)} |`);
L.push("", "## الترجمة غير المفهرسة، لكل محاضرة (محاكاة)\n", `| نسبة الكلمات المصابة | ${SEEDS.map(s => "البذرة " + ar(s)).join(" | ")} |`, `|---|${SEEDS.map(() => "---").join("|")}|`);
for (const c of out.rows) L.push(`| ${pc(c.rate)} | ${c.heldPerLecture.map(k => of(k, M.held)).join(" | ")} |`);
const c0 = out.rows[0], cN = out.rows[out.rows.length - 1];
const wrongAll = out.rows.flatMap(c => c.wrong.map(w => ({ ...w, rate: c.rate })));
const KIND = { vq: "آية من ترجمة مفهرسة", held: "آية من ترجمة غير مفهرسة", vh: "حديث مترجم" };
L.push("", "## القراءة (محاكاة)\n",
  `- محاكاة، ${ar(nLec)} محاضرات: من يقرأ من ترجمة مفهرسة يُلتقط منه ${of(c0.vq[2], c0.vq[0])} آية (${civ(c0.vqCI)}) و${of(c0.vh[2], c0.vh[0])} حديثًا (${civ(c0.vhCI)}) بمرجع صحيح على نص نظيف، و${of(cN.vq[2], cN.vq[0])} (${civ(cN.vqCI)}) و${of(cN.vh[2], cN.vh[0])} (${civ(cN.vhCI)}) عند ضجيج ${pc(cN.rate)}.`,
  `- محاكاة، ${ar(nLec)} محاضرات، ${ar(c0.held[0])} آية: من يقرأ من ترجمة غير مفهرسة يُلتقط منه ${of(c0.held[2], c0.held[0])} على نص نظيف (مجال الثقة ${civ(c0.heldCI)}) و${of(cN.held[2], cN.held[0])} عند ضجيج ${pc(cN.rate)} (${civ(cN.heldCI)})، بمعيار تغطية ٥٠٪ المستخدم في العربي. هذه هي الحالة الصعبة: الترجمات تختلف في ألفاظها.`,
  wrongAll.length
    ? `- في المحاكاة عُرض مرجع خاطئ في ${ar(wrongAll.length)} استشهادًا نصيًّا (مجموع مستويات الضجيج الثلاثة والمحاضرات كلها). هذا خطأ في المرجع، وليس مطابقة صحيحة لموضع آخر:`
    : "- في المحاكاة لم يُعرض مرجع خاطئ في أي استشهاد نصي.",
  ...wrongAll.map(w => `  - ضجيج ${pc(w.rate)}، البذرة ${ar(w.seed)}، ${KIND[w.kind]}: المقروء ${w.truth} ← المعروض ${w.cited} (${w.status === "verbatim" ? "حرفي" : "جزئي"}، نسبة الاتفاق ${ar(Math.round(100 * (w.agreement || 0)))}٪).`),
  `- في المحاكاة: الاستشهادات النصية الخاطئة داخل كلام الحشو: ${out.rows.map(c => `${ar(c.fillerTextual)} عند ${pc(c.rate)}`).join("، ")} (مجموع المحاضرات).` + (out.rows.some(c => c.fillerTextual) ? " نصوصها في `eval/results_en.json` (الحقل `fillerExamples`)." : ""),
  `- في المحاكاة: إحدى جمل الحشو («… those who listen and then follow the best of it») تعيد صياغة الآية ٣٩:١٨ فعلًا، ووردت ${ar(c0.allusionSentences)} مرة في المحاضرات. نسبها المحرك إلى ٣٩:١٨ تطابقًا نصيًّا في ${out.rows.map(c => `${ar(c.fillerAllusion)} عند ${pc(c.rate)}`).join("، ")}. هذه إشارة حقيقية إلى الآية، فلا تُعدّ خطأ، وتُذكر منفصلة.`,
  "- هذه الأرقام لا تقول شيئًا عن تفريغ صوتي حقيقي.", "",
  "أزمنة التشغيل في `eval/timings.json` (تتغير من تشغيل إلى آخر؛ كل ما عداها ثابت).", "");
writeFileSync(path.join(EVAL, "RESULTS_EN.md"), L.join("\n"));
const { writeSummary } = await import("./summary.mjs");
writeSummary();
if (!process.env.ATHAR_EVAL_QUIET) console.log(L.slice(9).join("\n"));
