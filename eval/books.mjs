// books.mjs — do verbatim quotations from the BOOK PACKS get found and attributed to the right book?  (SIMULATION)
//   node eval/books.mjs   -> eval/results_books.json, eval/RESULTS_BOOKS.md, eval/summary.json
// Every pack is loaded at once (the hardest setting: the most competing text). Quotations are placed in filler speech
// after «قال المؤلف رحمه الله», at 0% and 15% simulated transcription noise. Four sets, each with its own fixed seed:
//   long   20–39 words   (the only length the first version of this file measured)
//   medium  8–12 words
//   short   5–7 words
//   core   10–19 words that ALSO occur verbatim in the core (Qur'an / nine hadith collections)
// plus 30 long quotations from Tafsir al-Jalalayn, reported on their own line (the first version excluded that book).
// A quotation is the quoted words only: a fragment that contains a chain of narrators, a «قال …» phrase or a «رواه …»
// note is re-drawn, because the engine (correctly) reports only the quoted words and such an item would be a mixed span.
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadCorpusWith, EVAL, wilson, writeTiming, writeJson, ar } from "./lib.mjs";
import { asrNoise, rng } from "./gen.mjs";
import { analyze } from "../public/js/engine.js";
import { norm, fold } from "../public/js/text.js";
import { findCues } from "../public/js/cues.js";

const FILL = JSON.parse(readFileSync(path.join(EVAL, "fillers.json"), "utf8")).fillers;
const corpus = await loadCorpusWith(["hadith2", "tafsir", "fiqh", "seerah", "aqeedah"]);
const packs = corpus.packs.slice(1);
const NARR = new Set(["رواه", "أخرجه", "اخرجه", "متفق", "حدثنا", "أخبرنا", "قال", "وقال", "فقال", "قالت", "فقالت", "يقول", "قالوا", "فقالوا"].map(w => fold(norm(w))));
const quotedOnly = F => !F.some(w => NARR.has(w)) && findCues(F).length === 0;

const SETS = [
  { id: "long", min: 20, span: 20, seed: 77 },
  { id: "medium", min: 8, span: 5, seed: 78 },
  { id: "short", min: 5, span: 3, seed: 79 },
  { id: "core", min: 10, span: 10, seed: 80, alsoInCore: true },
  { id: "jalalayn", min: 20, span: 20, seed: 81, jalalayn: true },
];
function inCore(pid, s, L) {
  const T = corpus.tok(pid), F = corpus.ftok(pid), str = " " + T.slice(s, s + L).join(" ") + " ";
  for (let q = 0; q + 3 <= L; q += 3) for (const p of corpus.postings(3, F.slice(s + q, s + q + 3).join(" "))) if (p < corpus.coreN && (" " + corpus.P[p].n + " ").includes(str)) return true;
  return false;
}
function build(set) {
  const r = rng(set.seed), pick = a => a[Math.floor(r() * a.length)];
  const words = [], items = [];
  for (const pk of packs) {
    if (set.jalalayn && pk.id !== "tafsir") continue;
    const n = pk.id === "aqeedah" ? 15 : 30;
    let tries = 0;
    for (let k = 0; k < n; ) {
      if (++tries > 2e6) throw new Error(`cannot draw ${set.id} quotations from ${pk.id}`);
      const pid = pk.base + Math.floor(r() * pk.n), T = corpus.tok(pid);
      if (corpus.P[pid].r.startsWith("jalalayn") !== !!set.jalalayn || T.length < set.min + 4) continue;
      const L = Math.min(T.length, set.min + Math.floor(r() * set.span)), s = Math.floor(r() * (T.length - L + 1));
      if (!quotedOnly(corpus.ftok(pid).slice(s, s + L))) continue;
      if (set.alsoInCore && !inCore(pid, s, L)) continue;
      words.push(...norm(pick(FILL)).split(" "), ...norm("قال المؤلف رحمه الله").split(" "));
      const a = words.length; words.push(...T.slice(s, s + L));
      items.push({ pack: pk.id, book: corpus.P[pid].r.split(":")[0], a, b: words.length });
      words.push(...norm(pick(FILL)).split(" "));
      k++;
    }
  }
  return { words, items };
}

const TEXTUAL = new Set(["verbatim", "partial"]);
const out = { meta: { simulated: true, passages: corpus.N, cue: "قال المؤلف رحمه الله", noiseRates: [0, 0.15], packs: packs.map(p => ({ id: p.id, title: p.meta.title })) }, sets: [] };
const times = {};
for (const set of SETS) {
  const { words, items } = build(set);
  const lens = items.map(x => x.b - x.a);
  for (const rate of [0, 0.15]) {
    const nz = rate ? asrNoise(words, rate, rng(5)) : { words, map: words.map((_, i) => i).concat(words.length) };
    const t0 = Date.now(), led = analyze(nz.words.map(w => ({ w })), corpus).ledger;
    times[`${set.id}/${rate}`] = { seconds: +((Date.now() - t0) / 1000).toFixed(1), words: nz.words.length };
    const res = { set: set.id, rate, words: nz.words.length, lenMin: Math.min(...lens), lenMax: Math.max(...lens), books: [...new Set(items.map(x => x.book))].sort(), byPack: [], fillerTextual: 0, fillerExamples: [] };
    const used = new Set();
    for (const pk of packs) {
      const c = { pack: pk.id, title: pk.meta.title, n: 0, det: 0, first: 0, any: 0, prim: 0 };
      for (const it of items.filter(x => x.pack === pk.id)) {
        c.n++; const a = nz.map[it.a], b = nz.map[it.b];
        led.forEach((x, i) => { if (Math.min(x.te, b) - Math.max(x.ts, a) > 0) used.add(i); });
        const e = led.filter(x => TEXTUAL.has(x.status) && (Math.min(x.te, b) - Math.max(x.ts, a)) / Math.max(1, b - a) >= 0.5)[0];
        if (!e) continue; c.det++;
        const all = [e.source, ...(e.parallels || []), ...(e.inBooks || [])];
        if (e.source.collection === it.book) c.first++;
        if (all.some(s => s.collection === it.book)) c.any++;
        if (e.source.type !== "b") c.prim++;
      }
      if (c.n) res.byPack.push(c);
    }
    // false citations: textual entries that touch no quotation at all (filler speech and the cue phrase)
    led.forEach((x, i) => { if (!used.has(i) && TEXTUAL.has(x.status)) { res.fillerTextual++; if (res.fillerExamples.length < 8) res.fillerExamples.push({ status: x.status, cited: x.source.ref, spoken: x.spoken }); } });
    const sum = k => res.byPack.reduce((s, c) => s + c[k], 0);
    res.total = { n: sum("n"), det: sum("det"), first: sum("first"), any: sum("any"), prim: sum("prim") };
    res.total.ci = wilson(res.total.det, res.total.n);
    out.sets.push(res);
  }
}
writeJson("results_books.json", out);
writeTiming("books", times);

// ---------------- report ----------------
const get = (id, rate) => out.sets.find(s => s.set === id && s.rate === rate);
if (get("long", 0).books.length !== 9) throw new Error("the main sample is expected to draw from nine books, got " + get("long", 0).books.length);
const frac = t => `${ar(t.det)} من ${ar(t.n)}`;
const ci = t => `${ar(t.ci[0])}–${ar(t.ci[1])}٪`;
const pc = r => ar(Math.round(r * 100)) + "٪";
const L = ["# نتائج القياس — الاقتباس الحرفي من حزم الكتب (محاكاة)\n",
  "> **محاكاة.** نصوص مُركَّبة آليًا وضجيج تفريغ محاكى. هذه ليست أرقام تسجيلات حقيقية.\n",
  `- كل الحزم محمَّلة معًا (${ar(corpus.N.toLocaleString("en"))} مقطعًا).`,
  `- الاقتباسات مأخوذة من تسعة كتب (${get("long", 0).books.map(b => corpus.books[b] ? corpus.books[b].title : b).join("، ")}). تفسير الجلالين خارج هذه العيّنة: النسخة الأولى من هذا القياس استثنته دون تعليل مكتوب، والأرجح أن السبب أن متنه ألفاظ الآية نفسها تتخللها كلمات شرح قصيرة. أُبقيت العيّنة على الكتب التسعة لتبقى الأرقام قابلة للمقارنة، وقيس الجلالين في سطر مستقل.`,
  "- كل اقتباس يوضع داخل كلام حشو بعد عبارة «قال المؤلف رحمه الله». الاقتباس هو الكلمات المقتبسة وحدها: لا سند فيه ولا «قال …» ولا «رواه …».",
  "- «اكتُشف»: استشهاد نصي (حرفي أو جزئي) يغطي ٥٠٪ أو أكثر من موضع الاقتباس. مجال الثقة: ويلسون ٩٥٪.",
  "- «استشهاد في الحشو»: استشهاد نصي لا يلمس أي اقتباس. هذا خطأ.",
  "- نسبة الضجيج = نسبة الكلمات المصابة في المحاكاة، وليست نسبة خطأ نظام تفريغ حقيقي.\n",
  "## بحسب طول الاقتباس (محاكاة)\n",
  "| طول الاقتباس | نسبة الكلمات المصابة | اكتُشف | مجال الثقة ٩٥٪ | المصدر الأول هو الكتاب | الكتاب ضمن المصادر المعروضة | نُسب أولًا إلى القرآن أو الحديث | استشهاد في الحشو |", "|---|---|---|---|---|---|---|---|"];
const LABEL = { long: "٢٠–٣٩ كلمة", medium: "٨–١٢ كلمة", short: "٥–٧ كلمات", core: "١٠–١٩ كلمة، والنص موجود أيضًا في القرآن أو كتب الحديث التسعة", jalalayn: "٢٠–٣٩ كلمة من تفسير الجلالين" };
for (const set of SETS) for (const rate of [0, 0.15]) { const s = get(set.id, rate);
  L.push(`| ${LABEL[set.id]} | ${pc(rate)} | ${frac(s.total)} | ${ci(s.total)} | ${ar(s.total.first)} | ${ar(s.total.any)} | ${ar(s.total.prim)} | ${ar(s.fillerTextual)} |`); }
L.push("", "## بحسب الحزمة — اقتباسات ٢٠–٣٩ كلمة (محاكاة)\n",
  "| نسبة الكلمات المصابة | الحزمة | اكتُشف | المصدر الأول هو الكتاب | الكتاب ضمن المصادر المعروضة | نُسب أولًا إلى القرآن أو الحديث |", "|---|---|---|---|---|---|");
for (const rate of [0, 0.15]) for (const c of get("long", rate).byPack) L.push(`| ${pc(rate)} | ${c.title} | ${ar(c.det)} من ${ar(c.n)} | ${ar(c.first)} | ${ar(c.any)} | ${ar(c.prim)} |`);
L.push("", "## بحسب الحزمة — اقتباسات ٨–١٢ كلمة (محاكاة)\n",
  "| نسبة الكلمات المصابة | الحزمة | اكتُشف | المصدر الأول هو الكتاب | الكتاب ضمن المصادر المعروضة | نُسب أولًا إلى القرآن أو الحديث |", "|---|---|---|---|---|---|");
for (const rate of [0, 0.15]) for (const c of get("medium", rate).byPack) L.push(`| ${pc(rate)} | ${c.title} | ${ar(c.det)} من ${ar(c.n)} | ${ar(c.first)} | ${ar(c.any)} | ${ar(c.prim)} |`);
const l0 = get("long", 0), l1 = get("long", 0.15), m0 = get("medium", 0), m1 = get("medium", 0.15), s0 = get("short", 0), s1 = get("short", 0.15), c0 = get("core", 0), j0 = get("jalalayn", 0);
const fillerAll = out.sets.reduce((s, x) => s + x.fillerTextual, 0);
L.push("", "## القراءة (محاكاة)\n",
  `- في المحاكاة: اقتباسات من ٢٠–٣٩ كلمة من تسعة كتب: اكتُشف ${frac(l0.total)} على نص نظيف، و${frac(l1.total)} عند ضجيج ${pc(0.15)}.`,
  `- في المحاكاة: الاقتباسات الأقصر تُكتشف أقل. من ٨–١٢ كلمة: ${frac(m0.total)} على نص نظيف و${frac(m1.total)} مع الضجيج. من ٥–٧ كلمات: ${frac(s0.total)} و${frac(s1.total)}.`,
  `- في المحاكاة: إذا كان النص المقتبس من الكتاب موجودًا أيضًا في القرآن أو كتب الحديث التسعة، يُعرض المصدر الأصلي أولًا — وهذا مقصود. من ${ar(c0.total.n)} اقتباسًا من هذا النوع اكتُشف ${ar(c0.total.det)}، وكان الكتاب المصدرَ الأول في ${ar(c0.total.first)}، وظهر ضمن المصادر المعروضة في ${ar(c0.total.any)}.`,
  `- في المحاكاة: من ${ar(j0.total.n)} اقتباسًا من تفسير الجلالين اكتُشف ${ar(j0.total.det)}؛ كان الجلالين المصدرَ الأول في ${ar(j0.total.first)}، ونُسب ${ar(j0.total.prim)} أولًا إلى القرآن أو الحديث.`,
  `- في المحاكاة: مجموع الاستشهادات النصية في كلام الحشو، في كل التجارب أعلاه: ${ar(fillerAll)}.` + (fillerAll ? " أمثلة منها في `eval/results_books.json` (الحقل `fillerExamples`)." : ""),
  "- هذه الأرقام لا تقول شيئًا عن تفريغ صوتي حقيقي.", "",
  "أزمنة التشغيل في `eval/timings.json` (تتغير من تشغيل إلى آخر؛ كل ما عداها ثابت).", "");
writeFileSync(path.join(EVAL, "RESULTS_BOOKS.md"), L.join("\n"));
const { writeSummary } = await import("./summary.mjs");
writeSummary();
if (!process.env.ATHAR_EVAL_QUIET) console.log(L.slice(9).join("\n"));
