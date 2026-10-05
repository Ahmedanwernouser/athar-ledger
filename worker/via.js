// The other services the chat of /ask may be put to, each with the READER'S OWN key (header X-Athar-Key): Gemini and
// OpenRouter. What is asked is the same closed question as on Groq (worker/ask.js builds it and reduces the answer); only
// the envelope differs. Kept apart from worker/src.js so that the trial in eval/keyprobe/via.mjs sends exactly what the
// Worker sends. Nothing here reads or writes a key anywhere but the request's own header.
export const VIA_DEF_MODELS = {
  gemini: "gemini-3.5-flash-lite,gemini-3.1-flash-lite",
  openrouter: "openrouter/free",
};
export const VIA_KEY = /^[\x21-\x7e]{20,400}$/, VIA_MODEL = /^[@a-z0-9][a-z0-9._:/-]{2,79}$/i;
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/", OPENROUTER = "https://openrouter.ai/api/v1/";
/** the request that puts one chat question to one model of a service -> {url, init} */
export function viaRequest(via, key, model, system, user, max = 900) {
  if (via === "gemini") return { url: `${GEMINI}models/${encodeURIComponent(model)}:generateContent`, init: { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0, maxOutputTokens: max, responseMimeType: "application/json" } }) } };
  if (via === "openrouter") return { url: OPENROUTER + "chat/completions", init: { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "X-Title": "Athar" },
    body: JSON.stringify({ model, temperature: 0, max_tokens: max, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) } };
  return null;
}
/** the model's words out of the service's answer ("" when there are none) */
export function viaText(via, j) {
  if (via === "gemini") return (((j && j.candidates) || [])[0]?.content?.parts || []).map((p) => (p && !p.thought && typeof p.text === "string" ? p.text : "")).join("");
  const got = j?.choices?.[0]?.message?.content;
  return typeof got === "string" ? got : Array.isArray(got) ? got.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("") : "";
}
/** does the service accept this key? a request that costs nothing -> {url, init} */
export function viaKeyCheck(via, key) {
  if (via === "gemini") return { url: GEMINI + "models?pageSize=1", init: { headers: { "x-goog-api-key": key } } };
  if (via === "openrouter") return { url: OPENROUTER + "key", init: { headers: { Authorization: "Bearer " + key } } };
  if (via === "groq") return { url: "https://api.groq.com/openai/v1/models", init: { headers: { Authorization: "Bearer " + key } } };
  return null;
}
