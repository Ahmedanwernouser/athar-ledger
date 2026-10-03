// books.mjs — do verbatim quotations from the BOOK PACKS get found and attributed to the right book?
//   node eval/books.mjs   -> eval/RESULTS_BOOKS.md
// 30 fragments per pack (20–40 words, fixed seed) are placed in filler speech after a "قال ..." cue, at 0% and 15%
// simulated transcription noise, with every pack loaded at once (the hardest setting: the most competing text).
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadCorpusWith, ROOT } from "./lib.mjs";
import { asrNoise, rng } from "./gen.mjs";
import { analyze } from "../public/js/engine.js";
import { norm } from "../public/js/text.js";
import { readFileSync } from "node:fs";

const FILL = JSON.parse(readFileSync(path.join(ROOT, ".eval-tmp", "fillers.json"), "utf8")).fillers;
const corpus = await loadCorpusWith(["hadith2", "tafsir", "fiqh", "seerah", "aqeedah"]);
const r = rng(77), pick = a => a[Math.floor(r() * a.length)];
const words = [], items = [];
for (const pk of corpus.packs.slice(1)) {
  const n = pk.id === "aqeedah" ? 15 : 30;
  for (let k = 0; k < n; k++) {
    const pid = pk.base + Math.floor(r() * pk.n), T = corpus.tok(pid);
    if (corpus.P[pid].r.startsWith("jalalayn") || T.length < 24) { k--; continue; }
    const L = Math.min(T.length, 20 + Math.floor(r() * 20)), s = Math.floor(r() * (T.length - L + 1));
    words.push(...norm(pick(FILL)).split(" "), ...norm("قال المؤلف رحمه الله").split(" "));
    const a = words.length; words.push(...T.slice(s, s + L));
    items.push({ pack: pk.id, book: corpus.P[pid].r.split(":")[0], a, b: words.length });
    words.push(...norm(pick(FILL)).split(" "));
  }
}
const L = ["# نتائج القياس — الاقتباس الحرفي من حزم الكتب (محاكاة)\n",
  `كل الحزم محمَّلة معًا (${corpus.N.toLocaleString("en")} مقطعًا). ${items.length} اقتباسًا حرفيًّا (٢٠–٤٠ كلمة) من الكتب العشرة داخل كلام حشو، بعد عبارة «قال المؤلف رحمه الله».`,
  "«الكتاب صحيح»: المصدر المعروض أولًا، أو أحد المواضع الأخرى، من الكتاب المقتبَس منه. الاقتباس من كتاب ينقل آية أو حديثًا يُنسب إلى القرآن أو كتب الحديث أولًا — وهذا مقصود.\n",
  "| الضجيج | الحزمة | اكتُشف نصيًّا | المصدر الأول هو الكتاب | الكتاب ضمن المصادر المعروضة | نُسب أولًا إلى القرآن/الحديث |", "|---|---|---|---|---|---|"];
for (const wer of [0, 0.15]) {
  const nz = wer ? asrNoise(words, wer, rng(5)) : { words, map: words.map((_, i) => i).concat(words.length) };
  const t0 = Date.now(), led = analyze(nz.words.map(w => ({ w })), corpus).ledger, ms = Date.now() - t0;
  for (const pk of corpus.packs.slice(1)) {
    let n = 0, det = 0, first = 0, any = 0, prim = 0;
    for (const it of items.filter(x => x.pack === pk.id)) {
      n++; const a = nz.map[it.a], b = nz.map[it.b];
      const e = led.filter(x => ["verbatim", "partial"].includes(x.status) && (Math.min(x.te, b) - Math.max(x.ts, a)) / (b - a) >= 0.5)[0];
      if (!e) continue; det++;
      const all = [e.source, ...e.parallels, ...(e.inBooks || [])];
      if (e.source.collection === it.book) first++;
      if (all.some(s => s.collection === it.book)) any++;
      if (e.source.type !== "b") prim++;
    }
    L.push(`| ${Math.round(wer * 100)}٪ | ${pk.meta.title} | ${det}/${n} | ${first} | ${any} | ${prim} |`);
  }
  L.push(`| ${Math.round(wer * 100)}٪ | زمن تحليل ${nz.words.length.toLocaleString("en")} كلمة | ${(ms / 1000).toFixed(1)} ث | | | |`);
}
writeFileSync(path.join(ROOT, ".eval-tmp", "RESULTS_BOOKS.md"), L.join("\n") + "\n");
console.log(L.slice(3).join("\n"));
