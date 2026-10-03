// english.mjs — English lectures: quotations read from published translations, and from translations we do NOT have.
//   node eval/english.mjs   -> eval/RESULTS_EN.md
// Synthetic lecture (fixed seed) + SIMULATED transcription noise; not a measurement of real English ASR.
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadCorpusWith, ROOT } from "./lib.mjs";
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
const r = rng(909), pick = a => a[Math.floor(r() * a.length)];
const enQ = corpus.packs.find(p => p.id === "en-quran"), enH = corpus.packs.find(p => p.id === "en-hadith");
const words = [], items = [];
const add = (kind, cue, frag, truth) => {
  words.push(...normEn(pick(FILL)).split(" "));
  if (cue) words.push(...normEn(cue).split(" "));
  const a = words.length; words.push(...frag); items.push({ kind, a, b: words.length, truth });
  words.push(...normEn(pick(FILL)).split(" "));
};
for (let k = 0; k < 40; ) {      // verses read from an indexed translation (1–2 consecutive ayahs)
  const pid = enQ.base + Math.floor(r() * enQ.n), [, ed, s, a] = corpus.P[pid].r.split(":");
  const two = r() < 0.4 && corpus.P[pid + 1] && corpus.P[pid + 1].r.startsWith(`enq:${ed}:${s}:`);
  const frag = [...corpus.tok(pid), ...(two ? corpus.tok(pid + 1) : [])];
  if (frag.length < 8 || frag.length > 70) continue;
  add("vq", r() < 0.8 ? pick(CUE_Q) : "", frag, { surah: +s, ayah: +a }); k++;
}
for (let k = 0; k < 60; ) {      // hadith read from the indexed translation
  const pid = enH.base + Math.floor(r() * enH.n), T = corpus.tok(pid);
  if (T.length < 14) continue;
  const L = Math.min(T.length, 12 + Math.floor(r() * 30)), s = Math.floor(r() * (T.length - L + 1));
  const frag = T.slice(s, s + L), str = " " + frag.join(" ") + " ";
  const accept = new Set(corpus.postings(3, frag.slice(0, 3).join(" ")).filter(p => (" " + corpus.P[p].n + " ").includes(str)).map(p => corpus.P[p].r.slice(3)));
  accept.add(corpus.P[pid].r.slice(3));
  add("vh", r() < 0.85 ? pick(CUE_H) : "", frag, { refs: accept }); k++;
}
for (const [name, file] of Object.entries(heldOut)) {   // verses read from a translation that is NOT in the index
  const Q = JSON.parse(readFileSync(path.join(ROOT, "data", "raw", "en", file), "utf8")).quran;
  for (let k = 0; k < 25; ) {
    const x = Q[Math.floor(r() * Q.length)], frag = normEn(x.text).split(" ");
    if (frag.length < 10 || frag.length > 60) continue;
    add("held", pick(CUE_Q), frag, { surah: x.chapter, ayah: x.verse, edition: name }); k++;
  }
}
for (let k = 0; k < 12; k++) add("cue", "", normEn(pick(CUE_ONLY)).split(" "), null);

const LET = "abcdefghijklmnopqrstuvwxyz";
function noise(ws, wer, rr) {     // simulated English transcription errors: wrong letter, dropped letter, dropped / extra / glued word
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
const inRange = (s, t) => s && s.type === "q" && s.surah === t.surah && t.ayah >= s.ayah - 1 && t.ayah <= s.ayahEnd;
const L = ["# نتائج القياس — المحاضرات الإنجليزية (محاكاة)\n",
  `المدونة: الأساس + ترجمات القرآن الخمس + ترجمة كتب الحديث التسعة (${corpus.N.toLocaleString("en")} مقطعًا). محاضرة مُركَّبة واحدة (بذرة ثابتة): ٤٠ آية و٦٠ حديثًا مقروءة من الترجمات المفهرسة، و٥٠ آية مقروءة من ترجمتين **غير مفهرستين** (Abdel Haleem و Arberry)، و١٢ عبارة استشهاد بلا اقتباس.`,
  "«المرجع صحيح»: المصدر العربي المعروض (أو أحد مواضعه) هو الآية/الحديث المقروء. الضجيج محاكى (حرف خاطئ، حرف ساقط، كلمة ساقطة أو زائدة أو ملتصقة) وليس تفريغًا حقيقيًّا.\n",
  "| الضجيج | آيات من ترجمة مفهرسة: اكتُشفت / المرجع صحيح | أحاديث مترجمة: اكتُشفت / المرجع صحيح | ترجمة غير مفهرسة: تطابق نصي بمرجع صحيح | ترجمة غير مفهرسة: المرجع ضمن أول ٥ (نصي أو اقتراح) | تطابق نصي بمرجع خاطئ | عبارات بلا اقتباس → بلا تطابق | زمن التحليل |",
  "|---|---|---|---|---|---|---|---|"];
for (const wer of [0, 0.1, 0.2]) {
  const nz = wer ? noise(words, wer, rng(31 + wer * 100)) : { words, map: words.map((_, i) => i).concat(words.length) };
  const t0 = Date.now(), led = analyze(nz.words.map(w => ({ w })), corpus).ledger, ms = Date.now() - t0;
  const c = { vq: [0, 0, 0], vh: [0, 0, 0], held: [0, 0, 0], wrong: 0, cue: [0, 0] };
  for (const it of items) {
    const a = nz.map[it.a], b = nz.map[it.b], len = Math.max(1, b - a);
    const over = led.filter(e => Math.min(e.te, b) - Math.max(e.ts, a) > 0);
    const tx = over.filter(e => TEXTUAL.has(e.status) && (Math.min(e.te, b) - Math.max(e.ts, a)) / len >= 0.4);
    const srcs = e => [e.source, ...(e.parallels || [])].filter(Boolean);
    if (it.kind === "vq" || it.kind === "held") {
      const k = c[it.kind]; k[0]++;
      const good = tx.some(e => srcs(e).some(s => inRange(s, it.truth)));
      if (it.kind === "vq") { if (tx.length) k[1]++; if (good) k[2]++; }
      else {
        if (good) k[1]++;
        const sug = over.flatMap(e => (e.candidates || e.suggestions || []).slice(0, 5));
        if (good || sug.some(s => inRange(s, it.truth))) k[2]++;
      }
      if (tx.length && !good) c.wrong++;
    } else if (it.kind === "vh") {
      c.vh[0]++; if (tx.length) c.vh[1]++;
      const good = tx.some(e => srcs(e).some(s => it.truth.refs.has(s.ref)));
      if (good) c.vh[2]++; else if (tx.length) c.wrong++;
    } else { c.cue[0]++; if (!tx.length) c.cue[1]++; }
  }
  L.push(`| ${Math.round(wer * 100)}٪ | ${c.vq[1]}/${c.vq[0]} · ${c.vq[2]} | ${c.vh[1]}/${c.vh[0]} · ${c.vh[2]} | ${c.held[1]}/${c.held[0]} | ${c.held[2]}/${c.held[0]} | ${c.wrong} | ${c.cue[1]}/${c.cue[0]} | ${(ms / 1000).toFixed(1)} ث (${nz.words.length.toLocaleString("en")} كلمة) |`);
}
L.push("", "**القراءة:** القراءة من ترجمة مفهرسة تُلتقط كالعربي. القراءة من ترجمة غير مفهرسة هي الحالة الصعبة: الترجمات تتفاوت في ألفاظها، فيُلتقط جزء منها تطابقًا جزئيًّا مع ترجمة قريبة، والباقي يظهر اقتراحًا أو لا يظهر.",
  "«تطابق نصي بمرجع خاطئ» في القرآن يشمل آيات متشابهة الألفاظ في مواضع أخرى (المتشابهات)، وهي مطابقة صحيحة لفظًا لموضع غير المقصود.", "");
writeFileSync(path.join(ROOT, ".eval-tmp", "RESULTS_EN.md"), L.join("\n"));
console.log(L.slice(4).join("\n"));
