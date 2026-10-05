// Live trial of the two questions of worker/ask.js against Groq, with the SAME prompts and the SAME reducers the Worker uses.
// Nothing that identifies the key or the account is written.
import { mkdirSync, writeFileSync } from "node:fs";
import { CHECK_SYSTEM, checkUser, parseCheck, checkItems, CHAT_SYSTEM, chatUser, parseChat, chatInput } from "../../worker/ask.js";
const key = process.env.GROQ_API_KEY || "", H = { Authorization: "Bearer " + key, "Content-Type": "application/json" };
const MODELS = String(process.env.ASK_MODELS || "openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b").split(",");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const params = (model, json) => ({ temperature: 0, max_completion_tokens: 1200, ...(model.includes("gpt-oss") ? { reasoning_effort: "low", include_reasoning: false } : { reasoning_effort: "none", reasoning_format: "hidden" }), ...(json ? { response_format: { type: "json_object" } } : {}) });
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
const CHECK = { want: "010110", items: [
  { said: "وبعدين يا جماعة الأشهر الحرم أربعة [[ذو القعدة وذو الحجة والمحرم ورجب]] وإحنا دلوقتي داخلين على شهر ذي القعدة فلازم نستعد", source: H1 },
  { said: "قال النبي صلى الله عليه وسلم في خطبة الوداع إن الزمان قد استدار كهيئته [[السنة اثنا عشر شهرا منها أربعة حرم ثلاث متواليات ذو القعدة وذو الحجة والمحرم]] ورجب مضر", source: H1 },
  { said: "وكنت امبارح [[مع الناس في المسجد بعد صلاة العشاء]] وقعدنا نتكلم في أحوال البلد", source: "صلى بنا رسول الله صلى الله عليه وسلم ثم جلس مع الناس في المسجد بعد صلاة العشاء فحدثهم حتى ذهب عامة الليل" },
  { said: "يعني إيه بقى [[فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله]] يعني اللي نيته لله ياخد أجره كامل", source: H2 },
  { said: "ودايما أقول لكم يا شباب [[من حسن إسلام المرء تركه ما لا يعنيه]] ما تدخلش في اللي مالكش فيه", source: "من حسن إسلام المرء تركه ما لا يعنيه" },
  { said: "وإحنا النهارده هنتكلم عن [[يوم الجمعة وفضل الصلاة على النبي]] فيه وإزاي نستغله", source: "إن من أفضل أيامكم يوم الجمعة فأكثروا علي من الصلاة فيه فإن صلاتكم معروضة علي" },
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
  const items = checkItems({ items: CHECK.items });
  const c = await ask(model, CHECK_SYSTEM, checkUser(items), false);
  out.check.push({ model, want: CHECK.want, got: c.raw != null ? parseCheck(c.raw, items.length) : null, raw: c.raw, http: c.http, ms: c.ms, tokens: c.tokens, limReq: c.limReq, limTok: c.limTok, error: c.error });
  await sleep(4000);
  for (const t of CHATS) {
    const inp = chatInput({ q: t.q, facts: t.facts });
    const r = await ask(model, CHAT_SYSTEM("ar"), chatUser(inp), true);
    out.chat.push({ model, name: t.name, expect: t.expect, parsed: r.raw != null ? parseChat(r.raw, inp) : null, raw: r.raw && r.raw.slice(0, 700), http: r.http, ms: r.ms, tokens: r.tokens, error: r.error });
    await sleep(model.includes("120b") ? 9000 : 6000);
  }
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/ask.json", import.meta.url), JSON.stringify(out, null, 1));
