// The chat of worker/ask.js asked the questions of a real session (5 Oct 2026, the lecture of tests/fixtures/sayegh.txt), against
// Groq, with the Worker's own prompt and reducer. Nothing that identifies the key or the account is written.
import { mkdirSync, writeFileSync } from "node:fs";
import { CHAT_SYSTEM, chatUser, parseChat, chatInput } from "../../worker/ask.js";
const key = process.env.GROQ_API_KEY || "", H = { Authorization: "Bearer " + key, "Content-Type": "application/json" };
const MODELS = String(process.env.ASK_MODELS || "qwen/qwen3.8-27b").split(",");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const params = model => ({ temperature: 0, max_completion_tokens: 700, ...(model.includes("gpt-oss") ? { reasoning_effort: "low", include_reasoning: false } : { reasoning_effort: "none", reasoning_format: "hidden" }), response_format: { type: "json_object" } });
const FACTS = [
  { id: "L1", text: "في المحاضرة — حديث — الأربعون النووية — رقم 19 — الدرجة: صحيح — أحمد محمد شاكر و٣ غيره · الحكم على روايته في جامع الترمذي — رقم 2516 — قيل منه ١٠٢ من ١٠٣ كلمة · ذُكر مرتين (0:04، 1:49) — الحالة: مطابق مع فروق — قيل: «كنت خلف النبي صلى الله عليه وسلم يوما فقال يا غلام إني أعلمك كلمات احفظ الله يحفظك احفظ الله تجده تجاهك» — رابط مصدره في بطاقته" },
  { id: "L4", text: "في المحاضرة — حديث — جامع الترمذي — رقم 2195 — الدرجة: صحيح — أحمد محمد شاكر و٢ غيره · وهو في صحيح مسلم — قيل منه ١٤ من ٢٨ كلمة · ذُكر مرة واحدة (2:22) — الحالة: مطابق مع فروق — قيل: «يصبح المرء مؤمنا ويمسي كافرا ويمسي كافرا ويصبح مؤمنا يبيع دينه بعرض من الدنيا» — رابط مصدره في بطاقته" },
  { id: "L5", text: "في المحاضرة — قرآن — سورة إبراهيم — الآية 27 — قيل منه ١١ من ١٨ كلمة · ذُكر مرة واحدة (2:33) — الحالة: مطابق حرفيًا — قيل: «يثبت الله الذين آمنوا بالقول الثابت في الحياة الدنيا وفي الآخرة» — رابط مصدره في بطاقته" },
  { id: "L6", text: "في المحاضرة — قرآن — سورة الرعد — الآية 11 — قيل منه ١١ من ٣٥ كلمة · ذُكر مرة واحدة (2:47) — الحالة: مطابق حرفيًا — قيل: «له معقبات من بين يديه ومن خلفه يحفظونه من أمر الله» — رابط مصدره في بطاقته" },
  { id: "L7", text: "في المحاضرة — قرآن — سورة البقرة — الآية 255 — قيل منه ٦ من ٥٠ كلمة · ذُكر مرة واحدة (2:53) — الحالة: مطابق حرفيًا — قيل: «ولا يئوده حفظهما وهو العلي العظيم» — رابط مصدره في بطاقته" },
  { id: "L2", text: "في المحاضرة عند 1:31 — قول منسوب — لم يُعثر عليه في المصادر — قيل: «يقول الإمام ابن الجوزي تدبرت هذا الحديث فأدهشني وكاد عقلي أن يطير فواسفا على جهلنا بهذا»" },
  { id: "M1", text: "عن المحاضرة نفسها — عنوانها: «(احفظ الله يحفظك) ▪︎ الشيخ توفيق الصايغ» — فيديو من رابط · 4:26 · ٤٥٦ كلمة — المفرِّغ: Gemini (نموذج عام، من رابط يوتيوب) · gemini-3.5-flash-lite" },
];
// the lecturer's own words, cut as the page cuts them (about seventy words a stretch; times as the page would give them)
import { readFileSync } from "node:fs";
const WORDS = readFileSync(new URL("../../tests/fixtures/sayegh.txt", import.meta.url), "utf8").split(/\s+/).filter(Boolean);
const PASSAGES = []; for (let a = 0, i = 1; a < WORDS.length; a += 70, i++) { const sec = Math.round(a * 266 / WORDS.length); PASSAGES.push({ id: "T" + i, text: `عند ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}: ` + WORDS.slice(a, a + 70).join(" ") }); }
// [question, what the previous turn was, what a good answer is]
const QS = [
  ["ما الأحاديث والآيات التي ذُكرت؟", "", "answer: L1 L4 L5 L6 L7"],
  ["ما درجه كل حديث ؟", "", "answer: both hadith with their gradings (L1, L4)"],
  ["ممكن تشرحلي الحديث؟", "", "refuse"],
  ["ممكن تكتبلي الايه بس اللي ذكرت ؟", "", "answer: the three ayat, nothing 'repeated'"],
  ["هل دي ايه صحيحه ولا محرفه؟", "ممكن تكتبلي الايه بس اللي ذكرت ؟ ← ذُكرت في المحاضرة آيات من سور إبراهيم والرعد والبقرة، وكلها في البطاقات.", "answer: matched the Mushaf word for word (L5 L6 L7)"],
  ["هاتلي لينك الحديث", "", "answer: L1 (and L4): the card carries the link"],
  ["كم حديث ذكر", "", "answer: two"],
  ["قارن بينهم", "كم حديث ذكر ← في الوقائع حديثان: حديث الأربعين النووية رقم 19 وحديث جامع الترمذي رقم 2195.", "answer: compares source, grading, how much was said"],
  ["اسم الشيخ ايه؟ اللي الفيديو ليه", "", "answer: from the title (M1)"],
  ["هل حديث احفظ الله يحفظك صحيح؟", "", "answer: L1 with its grading as recorded"],
  ["ما حكم من ترك الصلاة؟", "", "refuse"],
  ["هل ذكر الشيخ حديثا عن الصيام؟", "", "notfound"],
  ["هل كرر الشيخ حديثا؟", "", "answer: L1 was said twice"],
  ["لخّص المحاضرة في خمس جمل", "", "answer from T passages: guarding God's commands, He guards one's religion, body, family; examples"],
  ["ماذا قال المحاضر في شرح حديث احفظ الله يحفظك؟", "", "answer from T: do what He commands, avoid what He forbids; He guards you in religion, body, family, wealth"],
  ["اشرحلي الحديث", "ما الأحاديث؟ ← ذُكر حديث الأربعين النووية رقم 19 وحديث جامع الترمذي رقم 2195.", "answer from T: the lecturer's own explanation, attributed to him — not the model's"],
  ["متى تكلم عن ابن المسيب؟", "", "answer with the time of that passage"],
  ["ماذا قال عن الزهايمر؟", "", "answer from T: those who memorise the Book hardly get it (his words)"],
  ["ماذا قال عن الصيام؟", "", "notfound"],
  ["ما حكم حفظ القرآن؟", "", "refuse"],
];
const out = { at: new Date().toISOString(), models: MODELS, rows: [] };
for (const model of MODELS) for (const [q, prev, want] of QS) {
  const inp = chatInput({ q, prev, lang: "ar", facts: FACTS, passages: PASSAGES }), row = { model, q, want }, t0 = Date.now();
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: H, signal: AbortSignal.timeout(60000), body: JSON.stringify({ model, ...params(model), messages: [{ role: "system", content: CHAT_SYSTEM("ar") }, { role: "user", content: chatUser(inp) }] }) });
    row.http = r.status; row.ms = Date.now() - t0;
    const j = await r.json().catch(() => null);
    if (r.ok && j) { const raw = String(j.choices?.[0]?.message?.content ?? ""); row.raw = raw.slice(0, 700); row.got = parseChat(raw, inp); row.tokens = j.usage?.total_tokens; }
    else if (j && j.error) row.error = String(j.error.message || j.error.code || "").replace(/org_\w+/g, "<org>").slice(0, 200);
  } catch (e) { row.http = 0; row.error = e.name; }
  out.rows.push(row); await sleep(model.includes("qwen") ? 32000 : 28000);      // (the passages make a request about 3,500 tokens; the free tier allows 7-8,000 a minute)
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/chat2.json", import.meta.url), JSON.stringify(out, null, 1));
