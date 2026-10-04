// report.mjs — turns eval/results.json into eval/RESULTS.md (Arabic). Every number in the prose comes from the results;
// nothing is typed by hand. Every table and every claim carries the word «محاكاة».
//   node eval/report.mjs    re-render eval/RESULTS.md from eval/results.json (no computation)
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { EVAL, readJson, ar } from "./lib.mjs";
import { summarizeRun } from "./summary.mjs";

const SYS = {
  engine: "أثَر (المحرك الكامل)",
  notol: "استبعاد: بلا تسامح مع أخطاء التفريغ",
  nocues: "استبعاد: بلا عبارات الاستشهاد",
  novec: "استبعاد: بلا متجهات (ألفاظ فقط)",
  B0: "B0 مرجع ساذج: بحث نصي حرفي",
  B1: "B1 مرجع ساذج: استرجاع TF-IDF",
  B2: "B2 المرجع الأساسي: بحث تقريبي + محاذاة",
};
const NOISE_AR = {
  std: "الضجيج أ (نموذج المشروع)", rand: "حروف عشوائية فقط (بلا استبدال صوتي)", del: "حذف كلمات فقط", lex: "استبدال الكلمة بكلمة حقيقية أخرى فقط",
  whnorep: "«على شكل Whisper» بلا تكرار عبارات", wh: "«على شكل Whisper» مع تكرار عبارات", two: "تغييران في الكلمة الواحدة",
};
const SHAPE_ORDER = ["rand", "del", "lex", "whnorep", "wh", "two"];
const f1 = x => ar(x.toFixed(1));
const sh = s => s ? `${f1(s.pct)} (${f1(s.min)}–${f1(s.max)})` : "—";
const cn = c => c ? `${f1(c.mean)} (${ar(c.min)}–${ar(c.max)})` : "—";
const ci = c => `${ar(c[0])}–${ar(c[1])}٪`;
const kn = s => s ? `${ar(s.k)} من ${ar(s.n)} (${f1(s.pct)}٪؛ ${ci(s.ci95)})` : "—";
const P = r => ar(r) + "٪";
const signed = d => (d >= 0 ? "+" : "−") + f1(Math.abs(d));
const RATES = [0, 10, 20, 30];

export function report(res) {
  const S = summarizeRun(res), L = [], z = res.meta.sizes;
  const main0 = res.rows.filter(r => r.group === "main" && r.noise === "clean" && r.system === "engine");
  const words = main0[0].words, blocked = main0.map(r => r.blocked);
  const HB = S.hadithByQuoteLength, CS = S.cueShareInMainLectures;
  L.push("# نتائج القياس — محرك المطابقة على محاضرات مُركَّبة وضجيج تفريغ **مُحاكى** (محاكاة)\n");
  L.push("> **اقرأ هذا أولًا: كل ما في هذا الملف محاكاة.** الأرقام تقيس **محرك المطابقة وحده** على نصوص مُركَّبة آليًا ثم مُشوَّهة بضجيج من تصميمنا. " +
    "هي **ليست** قياسًا لنظام تفريغ حقيقي (Whisper) على صوت حقيقي، ولم يُختبر أي صوت حقيقي بعد. القياس على تسجيلات حقيقية يُجرى بـ `eval/transcribe.mjs` ثم `eval/real.mjs` بعد توفّر التسجيلات.\n");

  L.push("## الإعداد (محاكاة)\n");
  L.push(`- المدونة: الأساسية فقط، بلا حزم الكتب: ${ar(res.meta.corpus.N.toLocaleString("en"))} مقطعًا (${ar(res.meta.corpus.NQ.toLocaleString("en"))} آية + ${ar((res.meta.corpus.N - res.meta.corpus.NQ).toLocaleString("en"))} حديثًا).`);
  L.push(`- ${ar(S.lectures)} محاضرات مُركَّبة للاختبار (البذور ${res.meta.seeds.map(ar).join("، ")}). البذرة ${ar(res.meta.devSeed)} والاقتباسات بالمعنى ١–٢٤ استُخدمت لضبط العتبات، ولا تدخل في أي رقم هنا.`);
  L.push(`- في كل محاضرة: ${ar(z.vq)} استشهادًا قرآنيًّا حرفيًّا (١–٣ آيات)، ${ar(z.vh)} حديثًا حرفيًّا (٨–٣٥ كلمة)، ${ar(z.ph)} حديثًا غُيّرت ألفاظه (حذف واستبدال وزيادة)، ` +
    `${ar(z.par)} اقتباسًا بالمعنى (كتبها المساعد الآلي)، ${ar(z.ooc)} حديثًا **خارج المدونة**، ${ar(z.cue)} عبارة استشهاد بلا اقتباس، وبينها كلام حشو (نحو ${ar(words.toLocaleString("en"))} كلمة).`);
  L.push(`- عبارات الاستشهاد: قبل ${P(Math.round(CS.verbatimHadith))} من الأحاديث الحرفية و${P(Math.round(CS.quran))} من الآيات و${P(Math.round(CS.outOfCorpus))} من أحاديث «خارج المدونة» عبارة مثل «قال رسول الله صلى الله عليه وسلم». المولِّد يستخدم ${ar(res.meta.cuesInGenerator.hadith)} عبارات للحديث، ويعرف المحرك ${ar(res.meta.cuesInGenerator.recognisedByEngine)} منها.`);
  L.push(`- «خارج المدونة»: حديث حقيقي يُحذف من المدونة هو ورواياته وكل مقطع يشاركه أي أربع كلمات متتالية (${blocked.map(ar).join("، ")} مقطعًا محذوفًا في المحاضرات الثلاث). قد تبقى في المدونة رواية أخرى للحديث نفسه بألفاظ مختلفة.`);
  L.push("- «نسبة الضجيج» في هذا الملف هي **نسبة الكلمات المصابة في المحاكاة** (احتمال إصابة كل كلمة). ليست نسبة خطأ الكلمات لنظام تفريغ، ولا تُسمّى كذلك.");
  L.push(`- الأرقام بصيغة «س (ص–ع)»: المتوسط (الأدنى–الأعلى) عبر ${ar(S.lectures)} محاضرات فقط؛ هذا مدى ثلاث قيم، لا مجال ثقة. الأرقام بصيغة «ك من ن» مجموعة على المحاضرات الثلاث، ومعها مجال ثقة ويلسون ٩٥٪.`);
  L.push("- **من كتب ماذا:** المساعد الآلي نفسه كتب المحرك والمولِّد والاقتباسات بالمعنى. المراجع المستقل كتب النظام المرجعي B2 وأشكال الضجيج الأخرى وشرطَي الافتتاح.\n");

  L.push("### شكل «الضجيج أ» — نموذج ضجيج المشروع (محاكاة)\n");
  L.push("| نسبة الكلمات المصابة (المطلوبة) | المصابة فعلًا | كلمتان ملتصقتان | كلمة مشطورة | حرف من الفئة الصوتية نفسها | حرف واحد مختلف | صارت كلمة حقيقية أخرى | كلمة محذوفة | كلمة زائدة | غير ذلك | **ما له قاعدة تسامح في المحرك** |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [rate, s] of Object.entries(S.noiseShape)) L.push(`| ${P(rate)} | ${f1(s.wordsHitPct)}٪ | ${f1(s.glued)}٪ | ${f1(s.split)}٪ | ${f1(s.foldIdentical)}٪ | ${f1(s.oneEdit)}٪ | ${f1(s.becameAnotherRealWord)}٪ | ${f1(s.deleted)}٪ | ${f1(s.inserted)}٪ | ${f1(s.other)}٪ | **${f1(s.coveredByAToleranceRule)}٪** |`);
  const s20 = S.noiseShape[20];
  L.push("");
  L.push(`في المحاكاة، الضجيج أ: نحو ${P(Math.round(s20.coveredByAToleranceRule))} من الكلمات المصابة تُصاب بما صُمّم المحرك لتحمّله (حرف من الفئة الصوتية نفسها، حرف واحد مختلف، كلمتان ملتصقتان أو كلمة مشطورة)؛ ` +
    `والباقي حذف كلمة أو زيادتها أو خطأ لا قاعدة له (ومنه نحو ${P(Math.round(s20.becameAnotherRealWord))} صارت فيها الكلمة المشوَّهة كلمة حقيقية أخرى بالمصادفة). ` +
    "لا يتعمّد هذا النموذج استبدال كلمة بكلمة حقيقية أخرى ولا يكرّر عبارات. لذلك لا يصحّ وصفه بأنه «ضجيج لا يتوقعه المحرك»، وأُضيفت أشكال ضجيج أخرى في جدول مستقل أدناه.\n");

  L.push("### التعريفات (محاكاة)\n");
  L.push("- **الاكتشاف**: استشهاد نصي (حرفي أو جزئي) يغطي ٥٠٪ أو أكثر من موضع الاقتباس الحقيقي.");
  L.push("- **المصدر الأول صحيح**: المصدر المعروض أولًا مقطع يحتوي النص المقتبس فعلًا. يُذكر بصيغتين: **مما اكتُشف** (مشروط بالاكتشاف)، و**من كل الاقتباسات** (اكتُشف والمصدر الأول صحيح ÷ كل الاقتباسات).");
  L.push("- **حرفي وجزئي (القاعدة الصارمة)**: المحرك يصف الاقتباس بأنه حرفي فقط إذا لم يُظهر التفريغ أي كلمة مستبدلة أو زائدة أو ناقصة. لذلك لا تُذكر هنا «نسبة تصنيف صحيح» واحدة، بل ثلاثة أرقام: " +
    "(أ) على نص نظيف: كم من الاقتباسات المقولة حرفيًّا وُصف بأنه حرفي؛ (ب) كم من الاقتباسات التي غُيّرت ألفاظها فعلًا وُصف بأنه جزئي (المطلوب: كلها)؛ " +
    "(ج) مع الضجيج: كم من الاقتباسات المقولة حرفيًّا نزل وصفه إلى جزئي. (ج) ثمن القاعدة الصارمة وليس خطأ: التفريغ المشوَّه يُظهر فروقًا، فيعرضها المحرك ولا يدّعي المطابقة الحرفية.");
  L.push("- **أخطاء حرجة** (عدد لكل محاضرة) = مجموع خمسة: (١) استشهاد نصي يغطي ٥٠٪ أو أكثر من اقتباس موجود في المدونة، ولا يحتوي أيٌّ من مصادره المعروضة النص؛ " +
    "(٢) وصف «حرفي» على كلمات فيها تغيير حقيقي في اللفظ (أي: الكلمات التي قالها المتحدث تحت هذا الوصف لا ترد متتالية كما هي في أيٍّ من المصادر المعروضة)؛ " +
    "(٣) أي استشهاد نصي داخل كلام الحشو أو على عبارة استشهاد بلا اقتباس؛ (٤) **أي** استشهاد نصي (جزئي أو حرفي، مهما كانت تغطيته) على حديث خارج المدونة، ومصدره ليس رواية أخرى للحديث نفسه؛ " +
    "(٥) وصف «حرفي» يغطي ٦٠٪ أو أكثر من حديث خارج المدونة. " +
    "لا يدخل فيها: اقتراح «بالمعنى» بمصدر خاطئ (يُعدّ في جدول «خارج المدونة»)، ولا الاقتباس الذي لم يُكتشف، ولا استشهاد نصي على جزء صغير (أقل من ٥٠٪) من اقتباس بمقطع آخر لا يحتوي الاقتباس كله — هذا الأخير لا يُحكم عليه آليًّا، ويُذكر عدده في جدول التفاصيل.");
  L.push("- **حدود الموضع دقيقة**: نسبة ما اكتُشف وكان تقاطع الموضع المعروض مع الموضع الحقيقي ÷ اتحادهما (IoU) ٠٫٨ أو أكثر.");
  L.push("- **رواية أخرى للحديث نفسه** (للحكم على الاستشهاد في أحاديث «خارج المدونة»): المصدر المعروض أولًا مقطع يرتبط بإحدى الروايات المحذوفة بقاعدة «العائلة» (مشاركة مقاطع ثلاثية الكلمات، بالحدّ الأشدّ) في أي من الاتجاهين، أو يشارك المقطع الأصلي ٣٠٪ أو أكثر من مفرداته (موزونة بندرتها). الحكم آلي وتقريبي: قد يفوته حديث بألفاظ بعيدة، وقد يقبل حديثًا مجاورًا. كل استشهاد نصي على هذه الأحاديث مدرج مع الحكم عليه في `eval/results.json` (الحقل `ex.oocTextual`) ليراجعه إنسان.");
  L.push("- **بالمعنى**: " + ar(S.byMeaning.hybrid[0].n) + " اقتباسًا بالمعنى لم تُستخدم في اختيار الإعدادات. الاقتباسات نفسها تتكرر في المحاضرات الثلاث، فالعدد الفعلي " + ar(S.byMeaning.hybrid[0].n) + " لا أكثر. " +
    "يُحسب الاقتباس «صحيحًا» إذا ظهر مصدره في أغلب المحاضرات التي ورد فيها. الصحة تُحكم **بالعائلة**: المصدر المعروض من عائلة الحديث المقصود (المقطع الذي يحتوي العبارة المفتاحية، أو رواية موازية له بقاعدة العائلة التي يستخدمها المولِّد لحذف أحاديث «خارج المدونة»، مع حدّ أشدّ). مجال الثقة: ويلسون ٩٥٪.");
  L.push("- **الأنظمة المرجعية**: **B2** هو المرجع الذي يُقارن به: بحث تقريبي كتبه المراجع المستقل في نحو ٨٠ سطرًا بلا ضبط (تصويت بمقاطع الكلمات، ثم محاذاة Smith–Waterman على مستوى الكلمة تتسامح مع حرف واحد، وعتبة واحدة). " +
    "**B0** و**B1** ساذجان: B0 يأخذ أول مقطع يحتوي ست كلمات متطابقة، و B1 نافذة TF-IDF من عشرين كلمة بعتبة واحدة غير مضبوطة؛ الفارق الكبير عنهما لا يدل على شيء كثير. الأنظمة المرجعية لا تعرض اقتراحات، ولم تُصمَّم على القاعدة الصارمة للوصف «حرفي».\n");

  for (const rate of RATES) {
    L.push(`## نسبة الكلمات المصابة ${P(rate)} — الضجيج أ (محاكاة)\n`);
    L.push("| النظام | اكتشاف القرآن ٪ | اكتشاف الحديث الحرفي ٪ | اكتشاف الحديث المغيَّر ٪ | المصدر الأول صحيح مما اكتُشف ٪ | المصدر الأول صحيح من كل الاقتباسات ٪ | حدود الموضع دقيقة ٪ | أخطاء حرجة لكل محاضرة | منها: «حرفي» على لفظ مغيَّر |");
    L.push("|---|---|---|---|---|---|---|---|---|");
    for (const [sys, b] of Object.entries(S.perNoise[rate])) L.push(`| ${SYS[sys]} | ${sh(b.quranDetected)} | ${sh(b.hadithVerbatimDetected)} | ${sh(b.hadithChangedDetected)} | ${sh(b.firstSourceCorrectOfDetected)} | ${sh(b.firstSourceCorrectOfAll)} | ${sh(b.boundaryIoUAtLeast80)} | ${cn(b.criticalPerLecture)} | ${cn(b.criticalParts.verbatimLabelOnChangedWording)} |`);
    L.push("");
  }

  L.push("## الوصف: حرفي أم جزئي — المحرك الكامل، القاعدة الصارمة (محاكاة)\n");
  L.push("| نسبة الكلمات المصابة | اقتباسات قيلت حرفيًّا واكتُشفت | وُصفت بأنها حرفية | نزل وصفها إلى جزئي | اقتباسات غُيّرت ألفاظها واكتُشفت | وُصفت بأنها جزئية | وُصف جزء منها لم يتغيّر بأنه حرفي (صحيح) | وُصفت بأنها حرفية مع وجود التغيير (**خطأ حرج**) |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const rate of RATES) { const l = S.perNoise[rate].engine.labels;
    L.push(`| ${P(rate)} | ${ar(l.saidWordForWord.detected)} | ${kn(l.saidWordForWord.labelledVerbatim)} | ${kn(l.saidWordForWord.downgradedToPartial)} | ${ar(l.wordingChanged.detected)} | ${kn(l.wordingChanged.labelledPartial)} | ${ar(l.wordingChanged.labelledVerbatimOnAnUnchangedPart)} | **${ar(l.wordingChanged.labelledVerbatimAlthoughChanged)}** |`); }
  L.push("");
  for (const [rate, list] of Object.entries(S.verbatimLabelsOnChangedWording)) for (const c of list)
    L.push(`- محاكاة، ضجيج ${P(rate)}، البذرة ${ar(c.seed)} — «حرفي» على لفظ مغيَّر (خطأ حرج): المصدر المعروض ${c.cited}؛ ما قاله المتحدث تحت الوصف: «${c.saidUnderLabel}».`);
  L.push("");

  L.push("## الاقتباس بالمعنى (محاكاة)\n");
  L.push("الأعداد من " + ar(S.byMeaning.hybrid[0].n) + " اقتباسًا. **كلها كتبها المساعد الآلي نفسه الذي كتب المحرك، وكلها تبدأ بعبارة افتتاح.** «المصدر أولًا» = وُجد تطابقًا نصيًّا **أو** كان أولَ اقتراح. الاقتراحات **للمراجعة**، وليست مطابقات.\n");
  L.push("| الحالة | النظام | وُجد تطابقًا نصيًّا | أول اقتراح (غير نصي) | **المصدر أولًا** | مجال الثقة ٩٥٪ | ضمن أول ٣ | ضمن أول ٥ | اقتباسات عرف المحرك افتتاحها عبارةَ استشهاد | المصدر أولًا بمعيار العبارة المفتاحية وحدها |");
  L.push("|---|---|---|---|---|---|---|---|---|---|");
  const mrow = (label, sys, m) => m && L.push(`| ${label} | ${sys} | ${ar(m.asTextualMatch)} | ${ar(m.asFirstSuggestion)} | **${ar(m.firstShown)} من ${ar(m.n)}** | ${ci(m.ci95)} | ${ar(m.inFirst3)} | ${ar(m.inFirst5)} | ${ar(m.openerRecognisedAsCue)} | ${ar(m.firstShownByKeyPhraseOnly)} |`);
  const SV = "**متجهات جُمل** (bge-m3) + ألفاظ";
  for (const rate of RATES) { mrow(`افتتاح يعرفه المحرك، ضجيج ${P(rate)}`, SV, S.byMeaning.sentence[rate]); mrow(`افتتاح يعرفه المحرك، ضجيج ${P(rate)}`, "هجين (ألفاظ + متجهات)", S.byMeaning.hybrid[rate]); mrow(`افتتاح يعرفه المحرك، ضجيج ${P(rate)}`, "ألفاظ فقط", S.byMeaning.wordsOnly[rate]); }
  mrow("**افتتاح لا يعرفه المحرك**، نص نظيف", SV, S.byMeaning.unseenOpener.sentence); mrow("**افتتاح لا يعرفه المحرك**، نص نظيف", "هجين (ألفاظ + متجهات)", S.byMeaning.unseenOpener.hybrid); mrow("**افتتاح لا يعرفه المحرك**، نص نظيف", "ألفاظ فقط", S.byMeaning.unseenOpener.wordsOnly);
  mrow("**بلا افتتاح**، نص نظيف", SV, S.byMeaning.noOpener.sentence); mrow("**بلا افتتاح**، نص نظيف", "هجين (ألفاظ + متجهات)", S.byMeaning.noOpener.hybrid); mrow("**بلا افتتاح**، نص نظيف", "ألفاظ فقط", S.byMeaning.noOpener.wordsOnly);
  L.push("");
  { const sv = S.sentenceVectors;
    L.push(sv ? `«متجهات جُمل»: ما يفعله الموقع المنشور حين يقدّم وسيطه النموذج — الكلمات التي تلي عبارة الاستشهاد (٩ و١٦ و٢٤ كلمة) تُضمَّن بنموذج ${sv.model} (Cloudflare Workers AI) وتُقارَن بمتجهات نصوص المدونة الأساسية (${ar(sv.rows.toLocaleString("en"))} صفًّا × ${ar(sv.dim)})، ثم تُدمج قوائمها مع قائمة الألفاظ بالرتبة. في هذا التشغيل أُخذت متجهات الكلام من \`eval/embed/cache/\` (ضُمّنت مرة واحدة عبر الوسيط): ${ar(sv.stretchesAsked.toLocaleString("en"))} مقطع كلام، منها ${ar(sv.stretchesWithoutVector)} بلا متجه. «هجين»: المحرك وحده داخل المتصفح (متجهات كلمات مدرَّبة على المدونة)، وهو ما يعمل حين لا وسيط أو حين يطفئ القارئ الخيار.`
      : "«متجهات جُمل»: الملف `public/data/sem.bin` غير موجود في هذا التشغيل، فالصف يساوي «هجين».");
    L.push(""); }
  L.push("«افتتاح يعرفه المحرك»: كل اقتباس يبدأ بعبارة مثل «بيّن النبي صلى الله عليه وسلم أن…»، وهذه العبارات موجودة حرفيًّا في قائمة عبارات الاستشهاد في المحرك. «افتتاح لا يعرفه المحرك»: استُبدل الفعل بفعل غير موجود في القائمة (وضّح، نبّه، ذكر، أرشدنا، حثّ، منع…). «بلا افتتاح»: حُذفت العبارة كلها.\n");

  L.push("## أشكال ضجيج أخرى (محاكاة)\n");
  L.push("أشكال كتبها المراجع المستقل. «على شكل Whisper» تخمين لشكل أخطاء نظام حقيقي (كلمات حقيقية بديلة، إسقاط، تغيير لواحق، دمج، وتكرار عبارات) — وهو أيضًا محاكاة، لا قياس. المحاضرات الثلاث نفسها.\n");
  L.push("| شكل الضجيج | نسبة الكلمات المصابة | النظام | اكتشاف القرآن ٪ | اكتشاف الحديث الحرفي ٪ | اكتشاف الحديث المغيَّر ٪ | المصدر الأول صحيح مما اكتُشف ٪ | أخطاء حرجة لكل محاضرة |");
  L.push("|---|---|---|---|---|---|---|---|");
  const nrow = (label, rate, sys, b) => b && L.push(`| ${label} | ${P(rate)} | ${SYS[sys]} | ${sh(b.quranDetected)} | ${sh(b.hadithVerbatimDetected)} | ${sh(b.hadithChangedDetected)} | ${sh(b.firstSourceCorrectOfDetected)} | ${cn(b.criticalPerLecture)} |`);
  for (const rate of [10, 20, 30]) { nrow(NOISE_AR.std + " — للمقارنة", rate, "engine", S.perNoise[rate].engine); nrow(NOISE_AR.std + " — للمقارنة", rate, "B2", S.perNoise[rate].B2); }
  const conds = Object.values(S.noiseConditions).sort((x, y) => SHAPE_ORDER.indexOf(x.kind) - SHAPE_ORDER.indexOf(y.kind) || x.rate - y.rate);
  for (const c of conds) { nrow(NOISE_AR[c.kind], c.rate, "engine", c.engine); nrow(NOISE_AR[c.kind], c.rate, "B2", c.B2); }
  L.push("");

  L.push("## اكتشاف الحديث الحرفي بحسب طول الاقتباس وعبارة الاستشهاد — المحرك الكامل (محاكاة)\n");
  L.push("مجموع المحاضرات الثلاث. «مع عبارة يعرفها المحرك»: الاقتباسات التي سبقتها عبارة من عبارات المولِّد. «عبارة لا يعرفها المحرك»: صياغات مثل «ومن كلام سيد المرسلين» ليست في قائمة المحرك. اقتباسات ٥–٨ كلمات من محاضرات مستقلة بالبذور نفسها.\n");
  L.push("| طول الاقتباس | عبارة الاستشهاد | نص نظيف | الضجيج أ ٢٠٪ |");
  L.push("|---|---|---|---|");
  const LEN = { "5-8": "٥–٨ كلمات", "8-15": "٨–١٥ كلمة", "16-35": "١٦–٣٥ كلمة" }, CUE = { withCue: "مع عبارة يعرفها المحرك", noCue: "بلا أي عبارة", unseenCueWording: "عبارة لا يعرفها المحرك" };
  for (const [lk, la] of Object.entries(LEN)) for (const [ck, ca] of Object.entries(CUE)) { const x = HB[lk][ck]; if (x && x.clean) L.push(`| ${la} | ${ca} | ${kn(x.clean)} | ${kn(x.noise20)} |`); }
  L.push("");
  L.push("### المحاضرة كلها بلا عبارات استشهاد، وبعبارات لا يعرفها المحرك (محاكاة)\n");
  L.push("| الشرط | نسبة الكلمات المصابة | اكتشاف القرآن ٪ | اكتشاف الحديث الحرفي ٪ | اكتشاف الحديث المغيَّر ٪ | المصدر الأول صحيح مما اكتُشف ٪ | أخطاء حرجة لكل محاضرة |");
  L.push("|---|---|---|---|---|---|---|");
  const crow = (label, rate, b) => b && L.push(`| ${label} | ${P(rate)} | ${sh(b.quranDetected)} | ${sh(b.hadithVerbatimDetected)} | ${sh(b.hadithChangedDetected)} | ${sh(b.firstSourceCorrectOfDetected)} | ${cn(b.criticalPerLecture)} |`);
  crow("عبارات المولِّد (الجدول الأساسي)", 0, S.perNoise[0].engine); crow("عبارات المولِّد (الجدول الأساسي)", 20, S.perNoise[20].engine);
  crow("بلا أي عبارة استشهاد", 0, S.cueConditions.noCue.clean); crow("بلا أي عبارة استشهاد", 20, S.cueConditions.noCue.noise20);
  crow("عبارات لا يعرفها المحرك", 0, S.cueConditions.unseenCueWording.clean); crow("عبارات لا يعرفها المحرك", 20, S.cueConditions.unseenCueWording.noise20);
  L.push("");

  L.push("## أحاديث «خارج المدونة»: ماذا عرض المحرك؟ (محاكاة)\n");
  L.push("لكل حديث فئة واحدة: أقوى ما عُرض عليه. «رواية أخرى» = المصدر المعروض رواية أخرى للحديث نفسه بقيت في المدونة؛ «مصدر آخر» = مصدر لا علاقة له بالعائلة. **العمود «حرفي على أغلبه» متوقَّع أن يكون صفرًا من طريقة البناء** (كل مقطع يشارك الحديث أربع كلمات متتالية محذوف)، فلا يدل وحده على حسن الامتناع.\n");
  L.push("| نسبة الكلمات المصابة | العدد | لم يُعثر عليه | مصدر مرشّح فقط | «بالمعنى»: رواية أخرى / مصدر آخر | جزئي على جزء منه: رواية أخرى / مصدر آخر | حرفي على جزء قصير (أقل من ٦٠٪): رواية أخرى / مصدر آخر | حرفي على أغلبه (٦٠٪ فأكثر): رواية أخرى / مصدر آخر | استشهادات نصية بمصدر آخر (خطأ حرج) |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  const two = t => `${ar(t.sameFamily)} / ${ar(t.wrongSource)}`;
  for (const [rate, o] of Object.entries(S.outOfCorpus)) L.push(`| ${P(rate)} | ${ar(o.items)} | ${ar(o.notFound)} | ${ar(o.leadOnly)} | ${two(o.meaning)} | ${two(o.partialOnSubPhrase)} | ${two(o.verbatimOnShortSubPhrase)} | ${two(o.verbatimOnMostOfIt)} | ${ar(o.wrongTextualCitations)} |`);
  L.push("");
  for (const [rate, list] of Object.entries(S.outOfCorpusTextualCitations)) for (const c of list.filter(c => c.judged !== "same family"))
    L.push(`- محاكاة، ضجيج ${P(rate)}، البذرة ${ar(c.seed)} — استشهاد نصي بمصدر آخر: حديث مأخوذ من ${c.from} ← عُرض ${c.cited} (${c.status === "verbatim" ? "حرفي" : "جزئي"}، يغطي ${P(Math.round(100 * c.cover))} من الاقتباس؛ الكلمات المطابَقة: «${c.spoken}»).`);
  L.push("");

  if (S.absentSayings) {
    const A = S.absentSayings;
    L.push("## عبارات متداولة ليست في المدونة أصلًا (محاكاة)\n");
    L.push(`${ar(A.listed)} عبارة مشهورة على الألسنة تُنسب إلى النبي صلى الله عليه وسلم (\`eval/absent_sayings.json\`). تُفحص كل عبارة آليًّا في كل تشغيل: لا تبقى إلا إذا لم ترد أي أربع كلمات متتالية منها في أي مقطع من المدونة الأساسية. ` +
      (A.droppedBecauseA4WordRunIsInTheCorpus.length ? `استُبعدت بهذا الفحص ${ar(A.droppedBecauseA4WordRunIsInTheCorpus.length)}: ${A.droppedBecauseA4WordRunIsInTheCorpus.map(d => `«${d.saying}» (وردت «${d.sharedRun}» في ${d.foundIn})`).join("، ")}. ` : "لم تُستبعد أي عبارة بهذا الفحص. ") +
      `بقيت ${ar(A.sayings)} عبارة، وُضعت كل واحدة بعد عبارة استشهاد بالحديث داخل كلام حشو. القائمة جمعها المساعد الآلي لاختبار الامتناع فقط؛ ليست حكمًا على ثبوت أي عبارة، ولم يراجعها مختص.\n`);
    L.push("| نسبة الكلمات المصابة (الضجيج أ) | العدد | لم يُعثر عليه | مصدر مرشّح فقط | «بالمعنى» مع مصدر مقترح | **استشهاد نصي (خطأ)** | منه حرفي / جزئي |");
    L.push("|---|---|---|---|---|---|---|");
    for (const [k, rate] of [["clean", 0], ["noise20", 20]]) if (A[k]) L.push(`| ${P(rate)} | ${ar(A.sayings)} | ${ar(A[k].notFound)} | ${ar(A[k].leadOnly)} | ${ar(A[k].meaningSuggestion)} | **${ar(A[k].textualCitation)}** | ${ar(A[k].ofWhichVerbatim)} / ${ar(A[k].ofWhichPartial)} |`);
    L.push("");
    for (const [k, rate] of [["clean", 0], ["noise20", 20]]) if (A[k]) {
      for (const c of A[k].citations) L.push(`- محاكاة، ضجيج ${P(rate)} — استشهاد نصي خاطئ: «${c.saying}» ← ${c.label} (${c.status === "verbatim" ? "حرفي" : "جزئي"}؛ الكلمات المطابَقة: «${c.spoken}»).`);
      for (const c of A[k].suggestions) L.push(`- محاكاة، ضجيج ${P(rate)} — «بالمعنى» (اقتراح للمراجعة، لا مطابقة): «${c.saying}» ← ${c.label}.`);
    }
    L.push("");
  }

  L.push("## تفاصيل المحرك الكامل (محاكاة)\n");
  L.push("| نسبة الكلمات المصابة | (١) مصدر لا يحتوي النص | (٢) «حرفي» على لفظ مغيَّر | (٣) استشهاد نصي في الحشو | (٤) استشهاد نصي بمصدر آخر على حديث خارج المدونة | (٥) «حرفي» على أغلب حديث خارج المدونة | **المجموع لكل محاضرة** | لم يُحكم عليه: استشهاد نصي على جزء صغير من اقتباس بمقطع آخر | عبارة استشهاد بلا اقتباس بقيت بلا تطابق ٪ | فحص النسبة المنطوقة «رواه …» صحيح ٪ | خطأ البداية / النهاية (كلمات) |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const rate of RATES) { const b = S.perNoise[rate].engine, d = S.engineDetails[rate], c = b.criticalParts;
    L.push(`| ${P(rate)} | ${cn(c.wrongSource)} | ${cn(c.verbatimLabelOnChangedWording)} | ${cn(c.fillerCitation)} | ${cn(c.outOfCorpusWrongCitation)} | ${cn(c.outOfCorpusVerbatimOnMostOfIt)} | **${cn(b.criticalPerLecture)}** | ${cn(b.notJudged_textualOnASmallPartFromAnotherPassage)} | ${sh(d.cueOnlyLeftWithoutMatch)} | ${sh(d.spokenAttributionCheckOK)} | ${ar(d.meanStartErrorWords.toFixed(2))} / ${ar(d.meanEndErrorWords.toFixed(2))} |`); }
  L.push("");

  const F = S.freshSeeds;
  if (F.clean) {
    L.push("## محاضرات جديدة للتحقق (محاكاة)\n");
    L.push(`البذور ${F.seeds.map(ar).join("، ")} لم تُستخدم في أي ضبط ولا في الجداول أعلاه. المحرك الكامل فقط. إن تقاربت أرقامها مع الجدول الأساسي فالبذور الأساسية ليست منتقاة.\n`);
    L.push("| نسبة الكلمات المصابة | اكتشاف القرآن ٪ | اكتشاف الحديث الحرفي ٪ | اكتشاف الحديث المغيَّر ٪ | المصدر الأول صحيح مما اكتُشف ٪ | المصدر الأول صحيح من كل الاقتباسات ٪ | أخطاء حرجة لكل محاضرة |");
    L.push("|---|---|---|---|---|---|---|");
    for (const [rate, b] of [[0, F.clean], [20, F.noise20]]) L.push(`| ${P(rate)} | ${sh(b.quranDetected)} | ${sh(b.hadithVerbatimDetected)} | ${sh(b.hadithChangedDetected)} | ${sh(b.firstSourceCorrectOfDetected)} | ${sh(b.firstSourceCorrectOfAll)} | ${cn(b.criticalPerLecture)} |`);
    L.push("");
  }

  // ---------------- interpretation: every number below is read from the results ----------------
  const E = r => S.perNoise[r].engine, B = r => S.perNoise[r].B2;
  const e0 = E(0), e20 = E(20), e30 = E(30), t30 = S.perNoise[30].notol;
  const h0 = S.byMeaning.hybrid[0], w0 = S.byMeaning.wordsOnly[0], h30 = S.byMeaning.hybrid[30], w30 = S.byMeaning.wordsOnly[30], u = S.byMeaning.unseenOpener.hybrid, st = S.byMeaning.noOpener.hybrid;
  const verb = (a, b) => a > b ? "رفعت" : a < b ? "أنزلت" : "لم تغيّر";
  const o0 = S.outOfCorpus[0], sumTwo = t => t.sameFamily + t.wrongSource;
  const NC = S.noiseConditions;
  L.push("## ما الذي تقوله هذه الأرقام — وما الذي لا تقوله (محاكاة)\n");
  L.push(`- **في المحاكاة**، وعلى اقتباسات من ٨–٣٥ كلمة يسبق أغلبَها عبارةُ استشهاد يعرفها المحرك: اكتشف المحرك ${f1(e0.hadithVerbatimDetected.pct)}٪ من الأحاديث الحرفية و${f1(e0.quranDetected.pct)}٪ من الآيات على نص نظيف، و${f1(e20.hadithVerbatimDetected.pct)}٪ و${f1(e20.quranDetected.pct)}٪ عند الضجيج أ ٢٠٪. ` +
    `المصدر الأول صحيح في ${f1(e0.firstSourceCorrectOfDetected.pct)}٪ و${f1(e20.firstSourceCorrectOfDetected.pct)}٪ مما اكتُشف، أي في ${f1(e0.firstSourceCorrectOfAll.pct)}٪ و${f1(e20.firstSourceCorrectOfAll.pct)}٪ من كل الاقتباسات. الأخطاء الحرجة: ${f1(e0.criticalPerLecture.mean)} و${f1(e20.criticalPerLecture.mean)} لكل محاضرة. حدود الموضع دقيقة في ${f1(e0.boundaryIoUAtLeast80.pct)}٪ و${f1(e20.boundaryIoUAtLeast80.pct)}٪ مما اكتُشف.`);
  { const b = k => HB[k], x = (k, c, n) => b(k)[c] && b(k)[c][n] ? `${f1(b(k)[c][n].pct)}٪` : "—";
    L.push(`- **في المحاكاة**، طول الاقتباس يغيّر النتيجة. اكتشاف الحديث الحرفي مع عبارة يعرفها المحرك، على نص نظيف ثم عند الضجيج أ ٢٠٪: ٥–٨ كلمات ${x("5-8", "withCue", "clean")} و${x("5-8", "withCue", "noise20")}؛ ٨–١٥ كلمة ${x("8-15", "withCue", "clean")} و${x("8-15", "withCue", "noise20")}؛ ١٦–٣٥ كلمة ${x("16-35", "withCue", "clean")} و${x("16-35", "withCue", "noise20")}. ` +
      `وبلا أي عبارة استشهاد: ٥–٨ كلمات ${x("5-8", "noCue", "clean")} و${x("5-8", "noCue", "noise20")}؛ ٨–١٥ كلمة ${x("8-15", "noCue", "clean")} و${x("8-15", "noCue", "noise20")}؛ ١٦–٣٥ كلمة ${x("16-35", "noCue", "clean")} و${x("16-35", "noCue", "noise20")}. ` +
      `وبعبارة لا يعرفها المحرك: ٥–٨ كلمات ${x("5-8", "unseenCueWording", "clean")} و${x("5-8", "unseenCueWording", "noise20")}؛ ٨–١٥ كلمة ${x("8-15", "unseenCueWording", "clean")} و${x("8-15", "unseenCueWording", "noise20")}؛ ١٦–٣٥ كلمة ${x("16-35", "unseenCueWording", "clean")} و${x("16-35", "unseenCueWording", "noise20")}.`); }
  { const l0 = e0.labels, l20 = e20.labels, l30 = e30.labels, bad = RATES.reduce((a, r) => a + E(r).labels.wordingChanged.labelledVerbatimAlthoughChanged, 0);
    L.push(`- **في المحاكاة**، الوصف «حرفي» بالقاعدة الصارمة: (أ) على نص نظيف وُصف بأنه حرفي ${kn(l0.saidWordForWord.labelledVerbatim)} من الاقتباسات المقولة حرفيًّا. ` +
      `(ب) من الاقتباسات التي غُيّرت ألفاظها وُصف بأنه جزئي ${kn(l0.wordingChanged.labelledPartial)} على نص نظيف و${kn(l20.wordingChanged.labelledPartial)} عند ضجيج ٢٠٪؛ ووُصف بأنه حرفي مع وجود التغيير ${ar(bad)} (مجموع نسب الضجيج الأربع والمحاضرات الثلاث) — وهذا يُعدّ خطأ حرجًا. ` +
      `(ج) مع الضجيج نزل إلى «جزئي» وصفُ ${f1(E(10).labels.saidWordForWord.downgradedToPartial.pct)}٪ من الاقتباسات المقولة حرفيًّا عند ١٠٪، و${f1(l20.saidWordForWord.downgradedToPartial.pct)}٪ عند ٢٠٪، و${f1(l30.saidWordForWord.downgradedToPartial.pct)}٪ عند ٣٠٪. هذا ثمن القاعدة الصارمة وليس خطأ: المحرك يعرض الفروق التي في التفريغ ولا يدّعي المطابقة الحرفية؛ ومعناه أن أغلب ما يُتلى حرفيًّا سيظهر «جزئيًّا» إذا كان التفريغ مشوَّهًا بهذا القدر.`); }
  L.push(`- **في المحاكاة**: إيقاف التسامح مع أخطاء التفريغ يُنزل اكتشاف الحديث الحرفي من ${f1(e30.hadithVerbatimDetected.pct)}٪ إلى ${f1(t30.hadithVerbatimDetected.pct)}٪ عند الضجيج أ ٣٠٪. والضجيج أ مبنيّ في أغلبه على ما يعالجه التسامح، فالفائدة على تفريغ حقيقي غير معلومة.`);
  { // margin over B2, in words chosen from the numbers
    const rng = f => { const d = RATES.map(r => f(E(r)) - f(B(r))); return { lo: Math.min(...d), hi: Math.max(...d) }; };
    const word = d => d.lo > -3 && d.hi < 3 ? "متقاربان" : d.lo >= 3 ? "يتقدّم المحرك" : d.hi <= -3 ? "يتقدّم B2" : d.lo > -3 ? "متقاربان أو يتقدّم المحرك بحسب نسبة الضجيج" : d.hi < 3 ? "متقاربان أو يتقدّم B2 بحسب نسبة الضجيج" : "لا اتجاه ثابت";
    const span = d => `من ${signed(d.lo)} إلى ${signed(d.hi)} نقطة`;
    const dh = rng(b => b.hadithVerbatimDetected.pct), dc = rng(b => b.hadithChangedDetected.pct), dq = rng(b => b.quranDetected.pct), df = rng(b => b.firstSourceCorrectOfDetected.pct);
    const cr = (f, sys) => { const v = RATES.map(r => f(sys(r))); return `${f1(Math.min(...v))}–${f1(Math.max(...v))}`; };
    const b20 = B(20);
    L.push(`- **في المحاكاة**، مقارنةً ببحث تقريبي بسيط (B2)، والفرق = المحرك − B2 عبر نسب الضجيج الأربع: اكتشاف الحديث الحرفي ${span(dh)} (${word(dh)})؛ اكتشاف الحديث المغيَّر ${span(dc)} (${word(dc)})؛ اكتشاف القرآن ${span(dq)} (${word(dq)})؛ المصدر الأول صحيح مما اكتُشف ${span(df)} (${word(df)}). ` +
      `الأخطاء الحرجة لكل محاضرة: ${cr(b => b.criticalPerLecture.mean, E)} للمحرك مقابل ${cr(b => b.criticalPerLecture.mean, B)} لـ B2؛ وإذا استُثني خطأ «حرفي على لفظ مغيَّر» (B2 لم يُصمَّم على القاعدة الصارمة): ${cr(b => b.criticalPerLectureWithoutLabelErrors.mean, E)} مقابل ${cr(b => b.criticalPerLectureWithoutLabelErrors.mean, B)}. ` +
      `مثال عند ٢٠٪: الحديث الحرفي ${f1(e20.hadithVerbatimDetected.pct)}٪ مقابل ${f1(b20.hadithVerbatimDetected.pct)}٪، القرآن ${f1(e20.quranDetected.pct)}٪ مقابل ${f1(b20.quranDetected.pct)}٪، المصدر الأول ${f1(e20.firstSourceCorrectOfDetected.pct)}٪ مقابل ${f1(b20.firstSourceCorrectOfDetected.pct)}٪. ` +
      "B0 و B1 مرجعان ساذجان، والفارق الكبير عنهما لا يدل على شيء كثير.");
  }
  L.push(`- **في المحاكاة**، بالمعنى: ${verb(h0.firstShown, w0.firstShown)} المتجهات عدد الاقتباسات التي ظهر مصدرها أولًا ${h0.firstShown === w0.firstShown ? `(${ar(h0.firstShown)} من ${ar(h0.n)} في الحالتين)` : `من ${ar(w0.firstShown)} إلى ${ar(h0.firstShown)} من ${ar(h0.n)}`} على نص نظيف ` +
    `(مجال الثقة ${ci(h0.ci95)} مقابل ${ci(w0.ci95)})، و${h30.firstShown === w30.firstShown ? `بقي ${ar(h30.firstShown)} في الحالتين` : `من ${ar(w30.firstShown)} إلى ${ar(h30.firstShown)}`} عند ضجيج ٣٠٪. الفرق غير محسوم بهذا العدد. ` +
    `ومن ${ar(h0.firstShown)}، ${ar(h0.asTextualMatch)} وُجدت تطابقًا نصيًّا و${ar(h0.asFirstSuggestion)} أولَ اقتراح.`);
  if (u) L.push(`- **في المحاكاة**: الاقتباسات بالمعنى (${ar(h0.n)} اقتباسًا) كتبها المساعد الآلي نفسه الذي كتب المحرك، وتبدأ كلها بعبارة يعرفها المحرك مثل «بيّن النبي». إذا بدأت بعبارة لا يعرفها ${u.firstShown < h0.firstShown ? "نزل" : u.firstShown > h0.firstShown ? "ارتفع" : "بقي"} العدد من ${ar(h0.firstShown)} إلى ${ar(u.firstShown)} من ${ar(u.n)} (${ci(u.ci95)})، منها ${ar(u.asFirstSuggestion)} أولَ اقتراح و${ar(u.asTextualMatch)} تطابقًا نصيًّا. وبلا افتتاح: ${ar(st.firstShown)} من ${ar(st.n)} (${ci(st.ci95)})، منها ${ar(st.asFirstSuggestion)} أولَ اقتراح. الاقتراحات تعتمد على عبارة الاستشهاد.`);
  L.push(`- **في المحاكاة**، أحاديث «خارج المدونة» (${ar(o0.items)} حديثًا، نص نظيف): ${ar(o0.notFound)} «لم يُعثر عليه»، ${ar(o0.leadOnly)} مصدر مرشّح فقط، ${ar(sumTwo(o0.meaning))} عُرض لها مصدر «بالمعنى» (${ar(o0.meaning.wrongSource)} منها بمصدر آخر غير الحديث)، ` +
    `${ar(sumTwo(o0.partialOnSubPhrase))} تطابق جزئي على جزء منها (${ar(o0.partialOnSubPhrase.wrongSource)} بمصدر آخر)، ${ar(sumTwo(o0.verbatimOnShortSubPhrase))} وُصف جزء قصير منها بأنه حرفي (${ar(o0.verbatimOnShortSubPhrase.wrongSource)} بمصدر آخر)، ` +
    `و${ar(sumTwo(o0.verbatimOnMostOfIt))} وُصف أغلبها بأنه حرفي. أن لا يوصف أغلب النص بأنه حرفي متوقَّع من طريقة البناء (كل ما يشاركه أربع كلمات محذوف)، فلا يدل وحده على حسن الامتناع.`);
  if (S.absentSayings && S.absentSayings.clean) { const a = S.absentSayings.clean, an = S.absentSayings.noise20;
    L.push(`- **في المحاكاة**، عبارات متداولة ليست في المدونة أصلًا (${ar(S.absentSayings.sayings)} عبارة بعد عبارة استشهاد، لا ترد أي أربع كلمات متتالية منها في المدونة): ${ar(a.notFound)} «لم يُعثر عليه»، ${ar(a.leadOnly)} مصدر مرشّح، ${ar(a.meaningSuggestion)} «بالمعنى» مع مصدر مقترح، و${ar(a.textualCitation)} استشهاد نصي` +
      (an ? `؛ وعند الضجيج أ ٢٠٪: ${ar(an.notFound)}، ${ar(an.leadOnly)}، ${ar(an.meaningSuggestion)}، ${ar(an.textualCitation)}.` : ".") + " الاقتراح «بالمعنى» على عبارة ليست في المدونة يعرض مصدرًا لا يحتوي العبارة؛ هو للمراجعة، وقد يُفهم خطأً أنه مصدرها."); }
  { const g = (k, f) => NC[k] ? `${f1(f(NC[k].engine))}٪` : "—", hv = b => b.hadithVerbatimDetected.pct, qd = b => b.quranDetected.pct;
    L.push(`- **في المحاكاة**، شكل الضجيج يغيّر النتيجة. اكتشاف الحديث الحرفي عند ١٠٪ و٢٠٪ و٣٠٪: الضجيج أ ${f1(hv(E(10)))}٪ و${f1(hv(e20))}٪ و${f1(hv(e30))}٪؛ حروف عشوائية فقط ${g("rand10", hv)} و${g("rand20", hv)} و${g("rand30", hv)}؛ حذف كلمات فقط ${g("del10", hv)} و${g("del20", hv)} و${g("del30", hv)}؛ ` +
      `استبدال بكلمات حقيقية فقط ${g("lex10", hv)} و${g("lex20", hv)} و${g("lex30", hv)}؛ «على شكل Whisper» بلا تكرار ${g("whnorep10", hv)} و${g("whnorep20", hv)} و${g("whnorep30", hv)}، ومع تكرار العبارات ${g("wh10", hv)} و${g("wh20", hv)} و${g("wh30", hv)} ` +
      `(والقرآن معه ${g("wh10", qd)} و${g("wh20", qd)} و${g("wh30", qd)}). بحسب فحص المراجع: تكرار العبارة داخل الاقتباس يشطره إلى استشهادين قصيرين لا يبلغ أيٌّ منهما نصف الاقتباس.`); }
  L.push("- **المحاكاة لا تقول**: كم يخطئ Whisper فعلًا في تلاوة أو في محاضرة بلهجة، ولا كيف تتوزع أخطاؤه. كل أشكال الضجيج هنا من تصميمنا أو من تخمين المراجع. لم يُختبر أي صوت حقيقي.");
  L.push("- **المحاكاة لا تقول** شيئًا عن صحة الحديث. المحرك يقارن ألفاظًا بمدونة؛ لا يحكم على ثبوت.\n");
  L.push("## إعادة الإنتاج (محاكاة)\n```bash\nnode eval/all.mjs        # كل شيء: هذا الملف + RESULTS_BOOKS.md + RESULTS_EN.md + summary.json\n```\n");
  L.push("الأمر يعيد إنتاج كل رقم محاكى في هذه الملفات وفي `eval/summary.json` كما هو، حرفًا بحرف (النتائج حتمية). **أزمنة التشغيل وحدها غير قابلة لإعادة الإنتاج**؛ لذلك لا تظهر في هذا الملف، وتُكتب في `eval/timings.json`.\n");
  return L.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = readJson("results.json");
  if (!res || !res.rows) { console.error("eval/results.json غير موجود — شغّل node eval/run.mjs أولًا."); process.exit(1); }
  writeFileSync(path.join(EVAL, "RESULTS.md"), report(res));
  const { writeSummary } = await import("./summary.mjs"); writeSummary();
  console.log("wrote eval/RESULTS.md and eval/summary.json");
}
