// make_samples.mjs — builds the two TEXT demo samples shipped with the site (no audio; word times are estimated).
// The lecture text was written by the assistant to exercise every kind of ledger entry.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./lib.mjs";
import { asrNoise, rng } from "./gen.mjs";

const LECTURE = `بسم الله الرحمن الرحيم الحمد لله رب العالمين والصلاة والسلام على أشرف المرسلين أما بعد أيها الإخوة الكرام حديثنا اليوم عن حسن الخلق وأثره في حياة المسلم وهو باب عظيم من أبواب الدين
قال الله تعالى في سورة القلم وإنك لعلى خلق عظيم وهذه شهادة من الله لنبيه الكريم ينبغي أن نقف عندها طويلا
وأول ما نبدأ به إصلاح القصد فقد قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى رواه البخاري فالنية أساس كل عمل وبها يتفاضل الناس
ثم ننتقل إلى اللسان وفي الحديث الصحيح عن النبي صلى الله عليه وسلم أنه قال من كان يؤمن بالله واليوم الآخر فليقل كلاما طيبا أو ليسكت ومن كان يؤمن بالله واليوم الآخر فليكرم جاره فانظروا كيف ربط الإيمان بالكلمة وبحق الجار
يقول ربنا جل وعلا في سورة البقرة إن الله يأمر بالعدل والإحسان وإيتاء ذي القربى وينهى عن الفحشاء والمنكر والبغي يعظكم لعلكم تذكرون وهذه الآية جمعت أصول الأخلاق كلها
ومن أيسر أبواب الخير البشاشة فقد قال صلى الله عليه وسلم تبسمك في وجه أخيك لك صدقة رواه البخاري فلا تحقرن من المعروف شيئا
وأما الغضب فقد بين النبي صلى الله عليه وسلم أن القوي الحقيقي ليس من يغلب الناس في المصارعة وإنما هو من يملك نفسه حين يغضب وهذا معنى عظيم يحتاجه كل واحد منا
ويتناقل الناس كثيرا أنه قال رسول الله صلى الله عليه وسلم اطلبوا العلم ولو في الصين وكذلك يقولون قال رسول الله صلى الله عليه وسلم النظافة من الإيمان فينبغي التثبت قبل النسبة
وقال بعض أهل العلم إن حسن الخلق يظهر عند الغضب لا عند الرضا وهذه كلمة تستحق التأمل
ونختم بالتوحيد الذي هو أصل كل خلق كريم قال الله تعالى قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد نسأل الله أن يرزقنا حسن الخلق وأن يجعلنا من أهله وجزاكم الله خيرا`;

const LECTURE_EN = `Brothers and sisters, today we want to reflect on good character and how it shapes the life of a believer in every situation.
Allah says in Surah Al-Qalam, verse 4: And indeed, you are of a great moral character. This is a testimony from Allah about His Prophet, and we should stop at it for a long time.
The first thing is the intention. The Prophet, peace be upon him, said: The reward of deeds depends upon the intentions and every person will get the reward according to what he has intended. This was reported by Bukhari.
Then the tongue. In a hadith the Prophet said: Whoever believes in Allah and the Last Day should speak a good word or keep quiet, and whoever believes in Allah and the Last Day should be generous to his neighbour.
Allah says in Surah Al-Baqarah, verse 90: Indeed, Allah orders justice and good conduct and giving to relatives and forbids immorality and bad conduct and oppression. He admonishes you that perhaps you will be reminded.
As for anger, the Prophet explained that the strong man is not the one who can wrestle people down, but the one who controls himself when he is angry.
People often repeat that the Prophet said: seek knowledge even if you have to go to China. We should verify before we attribute.
And he recited: قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد. May Allah grant us good character. Read also Surah Yusuf verse 87.`;
const clean = LECTURE.split(/\s+/).filter(Boolean);
const timed = ws => ws.map((w, i) => ({ w, start: +(i * 0.46).toFixed(2), end: +(i * 0.46 + 0.4).toFixed(2) }));
const out = path.join(ROOT, "public", "samples");
writeFileSync(path.join(out, "demo-clean.json"), JSON.stringify({ estimatedTimes: true, words: timed(clean) }));
const noisy = asrNoise(clean, 0.12, rng(7)).words;
writeFileSync(path.join(out, "demo-noisy.json"), JSON.stringify({ estimatedTimes: true, words: timed(noisy) }));
writeFileSync(path.join(out, "demo-en.json"), JSON.stringify({ estimatedTimes: true, words: timed(LECTURE_EN.split(/\s+/).filter(Boolean)) }));
writeFileSync(path.join(out, "manifest.json"), JSON.stringify([
  { id: "demo-clean", title: "محاضرة قصيرة عن حسن الخلق", note: "نص تجريبي كتبه الفريق (بلا صوت؛ الأزمنة تقديرية). فيه آيات وأحاديث حرفية، حديث بلفظ مغيَّر، نسبة منطوقة لا توافق المدونة، اقتباس بالمعنى، وعبارتان شائعتان لا توجدان في المدونة.", transcript: "samples/demo-clean.json" },
  { id: "demo-noisy", title: "المحاضرة نفسها بعد محاكاة أخطاء التفريغ", note: "النص نفسه بعد إفساد ١٢٪ من كلماته آليًّا (محاكاة لأخطاء التفريغ الصوتي) لإظهار كيف يُعلِّم السجلُّ الفروق المحتملة.", transcript: "samples/demo-noisy.json" },
  { id: "demo-en", title: "A short English lecture on good character", note: "Sample text written by the team (no audio; times are estimated). It loads the English translations (≈ 55 MB) and shows: verses and hadith read in translation, an explicit reference that does not match, a paraphrase, a popular saying that is not in the corpus, and an Arabic recitation inside English speech.", transcript: "samples/demo-en.json" },
], null, 1));
console.log("samples written:", clean.length, "words");
