// The chat asked WITHOUT a lecture (5 Oct 2026): the facts are what the page itself found for each question
// (eval/keyprobe/chat3.json — captured from the page: a text by its reference, takhrij, texts near a topic, the ayah a
// hadith shares words with), put to Groq with the Worker's own prompt and reducer. Nothing that identifies the key is written.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { CHAT_SYSTEM, chatUser, parseChat, chatInput } from "../../worker/ask.js";
const key = process.env.GROQ_API_KEY || "", H = { Authorization: "Bearer " + key, "Content-Type": "application/json" };
const MODELS = String(process.env.ASK_MODELS || "qwen/qwen3.8-27b").split(",");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const params = model => ({ temperature: 0, max_completion_tokens: 700, ...(model.includes("gpt-oss") ? { reasoning_effort: "low", include_reasoning: false } : { reasoning_effort: "none", reasoning_format: "hidden" }), response_format: { type: "json_object" } });
const QS = JSON.parse(readFileSync(new URL("./chat3.json", import.meta.url), "utf8")).filter(x => Array.isArray(x.facts));
const out = { at: new Date().toISOString(), models: MODELS, rows: [] };
for (const model of MODELS) for (const { q, want, facts } of QS) {
  const inp = chatInput({ q, prev: "", lang: "ar", facts, passages: [] }), row = { model, q, want, facts: facts.length }, t0 = Date.now();
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: H, signal: AbortSignal.timeout(60000), body: JSON.stringify({ model, ...params(model), messages: [{ role: "system", content: CHAT_SYSTEM("ar") }, { role: "user", content: chatUser(inp) }] }) });
    row.http = r.status; row.ms = Date.now() - t0;
    const j = await r.json().catch(() => null);
    if (r.ok && j) { const raw = String(j.choices?.[0]?.message?.content ?? ""); row.raw = raw.slice(0, 900); row.got = parseChat(raw, inp); row.tokens = j.usage?.total_tokens; }
    else if (j && j.error) row.error = String(j.error.message || j.error.code || "").replace(/org_\w+/g, "<org>").slice(0, 200);
  } catch (e) { row.http = 0; row.error = e.name; }
  out.rows.push(row); await sleep(22000);
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/chat3.json", import.meta.url), JSON.stringify(out, null, 1));
