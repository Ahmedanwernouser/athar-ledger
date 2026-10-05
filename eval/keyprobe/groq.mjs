// Which chat models the site's Groq key may use today, what limits they carry, and whether a model can answer the one
// closed question the ledger would ask it: "is the speaker QUOTING this hadith here, or do a few words merely coincide?"
// Nothing that identifies the key or the account is written.
import { mkdirSync, writeFileSync } from "node:fs";
const key = process.env.GROQ_API_KEY || "", H = { Authorization: "Bearer " + key, "Content-Type": "application/json" };
const out = { at: new Date().toISOString(), hasKey: !!key, models: [], trials: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (key) {
  try {
    const r = await fetch("https://api.groq.com/openai/v1/models", { headers: H }); const j = await r.json();
    out.models = (j.data || []).filter(m => m.active !== false).map(m => ({ id: m.id, ctx: m.context_window, owner: m.owned_by })).sort((a, b) => a.id.localeCompare(b.id));
  } catch (e) { out.modelsError = e.name; }
  const HADITH = "إن الزمان قد استدار كهيئته يوم خلق الله السموات والأرض السنة اثنا عشر شهرا منها أربعة حرم ثلاث متواليات ذو القعدة وذو الحجة والمحرم ورجب مضر الذي بين جمادى وشعبان";
  const CASES = [
    { want: "0", name: "months named in passing", said: "وبعدين يا جماعة الأشهر الحرم أربعة [[ذو القعدة وذو الحجة والمحرم ورجب]] وإحنا دلوقتي داخلين على شهر ذي القعدة فلازم نستعد", src: HADITH },
    { want: "1", name: "the hadith recited", said: "قال النبي صلى الله عليه وسلم في خطبة الوداع إن الزمان قد استدار كهيئته يوم خلق الله السموات والأرض [[السنة اثنا عشر شهرا منها أربعة حرم ثلاث متواليات ذو القعدة وذو الحجة والمحرم]] ورجب مضر", src: HADITH },
    { want: "1", name: "a part recited, then explained", said: "يعني إيه بقى [[فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله]] يعني اللي نيته لله ياخد أجره", src: "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله ومن كانت هجرته لدنيا يصيبها أو امرأة يتزوجها فهجرته إلى ما هاجر إليه" },
    { want: "0", name: "ordinary words that also stand in a hadith", said: "وكنت امبارح [[مع الناس في المسجد بعد صلاة العشاء]] وقعدنا نتكلم في أحوال البلد", src: "صلى بنا رسول الله صلى الله عليه وسلم ثم جلس مع الناس في المسجد بعد صلاة العشاء فحدثهم حتى ذهب عامة الليل" },
  ];
  const SYSTEM = "أنت مدقّق. يُعطى لك كلام متحدث وفيه مقطع بين [[ ]]، ونص حديث من كتب السنة. أجب برقم واحد فقط: 1 إذا كان المتحدث في هذا المقطع يروي أو يقتبس هذا الحديث نفسه، و0 إذا كانت الكلمات مجرد تشابه عارض وهو يتكلم بكلامه هو. لا تكتب أي شيء غير الرقم.";
  const want = ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "moonshotai/kimi-k2-instruct", "qwen/qwen3-32b"].filter(id => out.models.some(m => m.id === id)).slice(0, 5);
  for (const model of want) for (const c of CASES) {
    const t0 = Date.now(); const row = { model, case: c.name, want: c.want };
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: H, signal: AbortSignal.timeout(60000),
        body: JSON.stringify({ model, temperature: 0, max_completion_tokens: 400, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `كلام المتحدث:\n${c.said}\n\nنص الحديث:\n${c.src}` }] }) });
      row.http = r.status; row.ms = Date.now() - t0;
      for (const h of ["x-ratelimit-limit-requests", "x-ratelimit-limit-tokens", "x-ratelimit-remaining-requests", "x-ratelimit-remaining-tokens"]) if (r.headers.get(h)) row[h.replace("x-ratelimit-", "")] = r.headers.get(h);
      const j = await r.json().catch(() => null);
      if (r.ok && j) { row.answer = String(j.choices?.[0]?.message?.content ?? "").trim().slice(0, 40); row.tokens = j.usage?.total_tokens; row.ok = row.answer === c.want; }
      else if (j && j.error) row.error = String(j.error.code || j.error.type || "").slice(0, 60);
    } catch (e) { row.http = 0; row.error = e.name; }
    out.trials.push(row); await sleep(2500);
  }
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/groq.json", import.meta.url), JSON.stringify(out, null, 1));
