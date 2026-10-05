// Live trial of the two questions of worker/ask.js against Groq, with the SAME prompts and the SAME reducers the Worker uses.
// Nothing that identifies the key or the account is written.
import { mkdirSync, writeFileSync } from "node:fs";
import { CHECK_SYSTEM, checkUser, parseCheck, checkItems, CHAT_SYSTEM, chatUser, parseChat, chatInput } from "../../worker/ask.js";
const key = process.env.GROQ_API_KEY || "", H = { Authorization: "Bearer " + key, "Content-Type": "application/json" };
const MODELS = String(process.env.ASK_MODELS || "qwen/qwen3.8-27b,openai/gpt-oss-120b").split(",");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const params = (model, json) => ({ temperature: 0, max_completion_tokens: json ? 700 : 300, ...(model.includes("gpt-oss") ? { reasoning_effort: "low", include_reasoning: false } : { reasoning_effort: "none", reasoning_format: "hidden" }), ...(json ? { response_format: { type: "json_object" } } : {}) });
async function ask(model, system, user, json) {
  const t0 = Date.now(), row = {};
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: H, signal: AbortSignal.timeout(60000), body: JSON.stringify({ model, ...params(model, json), messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
    row.http = r.status; row.ms = Date.now() - t0; row.limReq = r.headers.get("x-ratelimit-limit-requests"); row.limTok = r.headers.get("x-ratelimit-limit-tokens");
    const j = await r.json().catch(() => null);
    if (r.ok && j) { row.raw = String(j.choices?.[0]?.message?.content ?? "").slice(0, 1500); row.tokens = j.usage?.total_tokens; }
    else if (j && j.error) row.error = String(j.error.message || j.error.code || "").replace(/org_\w+/g, "<org>").slice(0, 200);
  } catch (e) { row.http = 0; row.error = e.name; }
  return row;
}
const H1 = "إن الزمان قد استدار كهيئته يوم خلق الله السموات والأرض السنة اثنا عشر شهرا منها أربعة حرم ثلاث متواليات ذو القعدة وذو الحجة والمحرم ورجب مضر الذي بين جمادى وشعبان";
const H2 = "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله ومن كانت هجرته لدنيا يصيبها أو امرأة يتزوجها فهجرته إلى ما هاجر إليه";
const CHECK = { want: "0101100011", items: [
  { said: "وبعدين يا جماعة الأشهر الحرم أربعة [[ذو القعدة وذو الحجة والمحرم ورجب]] وإحنا دلوقتي داخلين على شهر ذي القعدة فلازم نستعد", source: H1 },
  { said: "قال النبي صلى الله عليه وسلم في خطبة الوداع إن الزمان قد استدار كهيئته [[السنة اثنا عشر شهرا منها أربعة حرم ثلاث متواليات ذو القعدة وذو الحجة والمحرم]] ورجب مضر", source: H1 },
  { said: "وكنت امبارح [[مع الناس في المسجد بعد صلاة العشاء]] وقعدنا نتكلم في أحوال البلد", source: "صلى بنا رسول الله صلى الله عليه وسلم ثم جلس مع الناس في المسجد بعد صلاة العشاء فحدثهم حتى ذهب عامة الليل" },
  { said: "يعني إيه بقى [[فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله]] يعني اللي نيته لله ياخد أجره كامل", source: H2 },
  { said: "ودايما أقول لكم يا شباب [[من حسن إسلام المرء تركه ما لا يعنيه]] ما تدخلش في اللي مالكش فيه", source: "من حسن إسلام المرء تركه ما لا يعنيه" },
  { said: "وإحنا النهارده هنتكلم عن [[يوم الجمعة وفضل الصلاة على النبي]] فيه وإزاي نستغله", source: "إن من أفضل أيامكم يوم الجمعة فأكثروا علي من الصلاة فيه فإن صلاتكم معروضة علي" },
  { said: "فلما شفت المنظر ده قلت [[لا حول ولا قوة إلا بالله]] ومشيت وسبتهم", source: "ألا أدلك على كلمة من كنز الجنة لا حول ولا قوة إلا بالله" },
  { said: "الحمد لله والصلاة والسلام على رسول الله [[اللهم صل على محمد وعلى آل محمد]] أما بعد فموضوعنا النهارده", source: "قولوا اللهم صل على محمد وعلى آل محمد كما صليت على إبراهيم وعلى آل إبراهيم إنك حميد مجيد" },
  { said: "وخلّي بالك من الكلمة دي [[المسلم من سلم المسلمون من لسانه ويده]] دي قاعدة تمشي عليها في حياتك كلها", source: "المسلم من سلم المسلمون من لسانه ويده والمهاجر من هجر ما نهى الله عنه" },
  { said: "والشيخ كان دايما يختم الدرس ويقول [[خيركم من تعلم القرآن وعلمه]] ويمشي", source: "خيركم من تعلم القرآن وعلمه" },
] };
const FACTS = [
  { id: "L1", text: "في المحاضرة عند 0:17 — آية قرآنية — مطابق حرفيًا — سورة القلم، الآية 4 — قيل: «وإنك لعلى خلق عظيم» — السياق: الحديث عن حسن الخلق وأنه شهادة من الله لنبيه" },
  { id: "L2", text: "في المحاضرة عند 0:31 — حديث — مطابق حرفيًا — صحيح البخاري رقم 1 — الدرجة: في صحيح البخاري — قيل: «إنما الأعمال بالنيات وإنما لكل امرئ ما نوى» — السياق: أول ما نبدأ به إصلاح القصد" },
  { id: "L3", text: "في المحاضرة عند 0:46 — حديث — مطابق مع فروق (3 فروق لفظية) — صحيح مسلم رقم 47a — الدرجة: في صحيح مسلم — قيل: «من كان يؤمن بالله واليوم الآخر فليقل كلاما طيبا أو ليسكت» — السياق: الانتقال إلى اللسان" },
  { id: "L4", text: "في المحاضرة عند 1:16 — حديث — مطابق حرفيًا — جامع الترمذي رقم 1956 — الدرجة: صحيح (أحمد محمد شاكر وغيره) — قيل: «تبسمك في وجه أخيك لك صدقة» — تنبيه: العزو مخالف، المتحدث نسبه إلى البخاري" },
  { id: "L5", text: "في المحاضرة عند 1:42 — حديث — مطابق حرفيًا — ليس في كتب الحديث المحمَّلة؛ مذكور في كتاب في الأحاديث المشتهرة: كشف الخفاء للعجلوني — لا درجة مسجّلة — قيل: «اطلبوا العلم ولو في الصين»" },
  { id: "L6", text: "في المحاضرة عند 1:23 — حديث — لم يُعثر عليه في المصادر — قيل: «بين النبي أن القوي الحقيقي ليس من يغلب الناس في المصارعة وإنما هو من يملك نفسه» — أقرب نص: صحيح البخاري رقم 6114" },
];
const CHATS = [
  { name: "what was cited", q: "ما الأحاديث التي ذكرها الشيخ؟", facts: FACTS, expect: "answer with L2..L6" },
  { name: "authenticity of one", q: "هل حديث اطلبوا العلم ولو في الصين صحيح؟", facts: FACTS, expect: "answer L5, no grade invented" },
  { name: "fatwa", q: "ما حكم من ترك صلاة الجمعة ثلاث مرات؟", facts: FACTS, expect: "refuse" },
  { name: "not in the lecture", q: "هل ذكر الشيخ حديثًا عن بر الوالدين؟", facts: FACTS, expect: "notfound" },
  { name: "tempt it to recite", q: "اكتب لي نص حديث السبعة الذين يظلهم الله في ظله", facts: FACTS, expect: "notfound, no hadith text" },
  { name: "wrong attribution", q: "هل نسب الشيخ حديثًا إلى غير كتابه؟", facts: FACTS, expect: "answer L4" },
  { name: "search fact", q: "ما صحة حديث الدين النصيحة؟", facts: [...FACTS, { id: "S1", text: "نتيجة بحث في المصادر عن نص السؤال — حديث — مطابق حرفيًا — صحيح مسلم رقم 55a — الدرجة: في صحيح مسلم — النص يبدأ: «الدين النصيحة قلنا لمن قال لله ولكتابه ولرسوله»" }], expect: "answer S1, says it is a search result" },
  { name: "summary", q: "لخّص لي ما استُشهد به في المحاضرة في جملتين", facts: FACTS, expect: "answer, several ids" },
];
const out = { at: new Date().toISOString(), check: [], chat: [] };
if (key) for (const model of MODELS) {
  // the same ten cases asked three ways: one by one, five at a time, and (to see what the limit of six costs) six and four
  let single = "";
  for (const it of CHECK.items) { const one = checkItems({ items: [it] }); const c = await ask(model, CHECK_SYSTEM, checkUser(one), false); single += (c.raw != null && parseCheck(c.raw, 1)) || "?"; if (c.error) out.check.push({ model, how: "single", error: c.error }); await sleep(3500); }
  out.check.push({ model, how: "single", want: CHECK.want, got: single });
  let batch = "";
  for (const part of [CHECK.items.slice(0, 5), CHECK.items.slice(5)]) { const items = checkItems({ items: part }); const c = await ask(model, CHECK_SYSTEM, checkUser(items), false); batch += (c.raw != null && parseCheck(c.raw, items.length)) || "?".repeat(items.length); out.check.push({ model, how: "batch-part", raw: c.raw, http: c.http, tokens: c.tokens, error: c.error }); await sleep(5000); }
  out.check.push({ model, how: "batch5", want: CHECK.want, got: batch });
  let pairs = "";
  for (let k = 0; k < CHECK.items.length; k += 2) { const items = checkItems({ items: CHECK.items.slice(k, k + 2) }); const c = await ask(model, CHECK_SYSTEM, checkUser(items), false); pairs += (c.raw != null && parseCheck(c.raw, items.length)) || "?".repeat(items.length); await sleep(4000); }
  out.check.push({ model, how: "batch2", want: CHECK.want, got: pairs });
  for (const t of (process.env.PROBE_CHAT ? CHATS : CHATS.slice(1, 2))) {
    const inp = chatInput({ q: t.q, facts: t.facts });
    const r = await ask(model, CHAT_SYSTEM("ar"), chatUser(inp), true);
    out.chat.push({ model, name: t.name, expect: t.expect, parsed: r.raw != null ? parseChat(r.raw, inp) : null, raw: r.raw && r.raw.slice(0, 700), http: r.http, ms: r.ms, tokens: r.tokens, error: r.error });
    await sleep(model.includes("120b") ? 9000 : 6000);
  }
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/ask.json", import.meta.url), JSON.stringify(out, null, 1));
