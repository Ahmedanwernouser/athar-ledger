// What /yt sends to Gemini for one window of a YouTube video. Kept apart from worker/src.js so that the trial in
// eval/keyprobe/ytmodels.mjs asks each model with exactly the question the Worker asks.
export const YT_DEF_MODELS = "gemini-3.8-flash,gemini-3.5-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite";
export const ytUrl = (id) => "https://www.youtube.com/watch?v=" + id;
const ytClock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const ytPrompt = (from, to, lang) =>
  `Transcribe the speech in this video between ${ytClock(from)} and ${ytClock(to)} verbatim, in the language it is spoken in (mostly ${lang === "en" ? "English; Arabic recitation or quotation is written in Arabic script" : "Arabic"}). ` +
  "Write exactly what is said, word for word, including repetitions, hesitations and mistakes. Do NOT correct, complete or normalise any quotation of the Qur'an or of hadith: " +
  "if the speaker misquotes, write the misquotation. No translation, no summary, no commentary, no diacritics, no speaker names. Give each piece of at most 12 words with the time at which it " +
  "starts, as MM:SS counted from the beginning of the FULL video. If there is no speech in this part, return an empty list.";
const YT_SCHEMA = { type: "ARRAY", items: { type: "OBJECT", properties: { t: { type: "STRING" }, x: { type: "STRING" } }, required: ["t", "x"] } };
export function ytBody(model, id, from, to, lang) {
  return { contents: [{ role: "user", parts: [
      { file_data: { file_uri: ytUrl(id) }, video_metadata: { start_offset: from + "s", end_offset: to + "s", fps: 0.2 } },
      { text: ytPrompt(from, to, lang) }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: YT_SCHEMA,
      ...(/^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {}) } };
}
