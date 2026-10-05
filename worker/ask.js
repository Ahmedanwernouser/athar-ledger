// The two things a language model is asked on behalf of the ledger, and how its answers are reduced before they leave
// the Worker. Kept apart from src.js so that the same text is what the tests and the live probe exercise.
//
//  check: "is the speaker QUOTING this text in the marked stretch, or do a few words merely coincide?"
//         The answer that leaves is one digit per item (1 quoting, 0 coincidence) or nothing. No word of the model is shown.
//  chat:  a question about a lecture's ledger and about search results in the sources. The model may only point at the
//         facts it was given (by their ids) and write a few connecting sentences; verses, hadith, numbers and gradings
//         are shown to the reader from the sources' data, never from the model's words.

export const ASK = { MAX_BODY: 14000, CHECK_ITEMS: 6, SAID: 420, SOURCE: 700, FACTS: 30, FACT: 420, FACTS_TOTAL: 6500, Q: 300, PREV: 500, TEXT: 900, IDS: 8 };

const line = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/<{2,}|>{2,}/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const stripThink = (s) => String(s ?? "").replace(/<think>[\s\S]*?(<\/think>|$)/gi, " ");
/** letters only, the forms that are written two ways made one: for asking "does this stand in the facts?" */
const fold = (s) => String(s ?? "").replace(/[ً-ْٰـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^ء-يa-zA-Z0-9]+/g, " ").trim().toLowerCase();

// ---------------------------------------------------------------- check
/** -> [{said, source}] cleaned, or null when the request is not usable */
export function checkItems(body) {
  const raw = Array.isArray(body && body.items) ? body.items.slice(0, ASK.CHECK_ITEMS) : [];
  const items = raw.map((x) => ({ said: line(x && x.said, ASK.SAID), source: line(x && x.source, ASK.SOURCE) }));
  return items.length && items.every((x) => x.said.length >= 8 && /\[\[.+\]\]/.test(x.said) && x.source.length >= 8) ? items : null;
}
export const CHECK_SYSTEM = [
  "أنت مدقّق نصوص. تُعطى بنودًا مرقّمة. في كل بند «كلام» متحدث وفيه مقطع بين [[ ]]، و«نص» من مصدر (حديث أو أثر أو كتاب).",
  "السؤال عن كل بند: هل المتحدث في المقطع المحدَّد ينقل هذا النص (يرويه أو يتلوه أو يقتبسه أو يستشهد بلفظه)، أم أن هذه كلماته هو في سياق كلامه واتفق أن مثلها في النص؟",
  "علامات النقل (1): عبارة قبله مثل «قال» أو «في الحديث»؛ أو أن المقطع جملة تامة المعنى بلفظ النص وبأسلوب غير أسلوب المتحدث؛ أو أنه يشرحه بعده.",
  "علامات التشابه العارض (0): المقطع أسماء أو تعداد (أشهر، أيام، أماكن، أشخاص)، أو عبارة يومية شائعة، أو ذكر أو دعاء معتاد يقوله الناس، وهو جزء من جملة المتحدث نفسه لا يتم معناه إلا بكلامه قبله وبعده.",
  "أمثلة للقياس عليها:",
  "كلام: وهنسافر إن شاء الله [[يوم الخميس بعد صلاة الفجر]] ونرجع الجمعة — نص: كان إذا أراد سفرا خرج يوم الخميس بعد صلاة الفجر — الحكم 0 (موعد يذكره المتحدث من كلامه).",
  "كلام: والخلفاء الراشدون أربعة [[أبو بكر وعمر وعثمان وعلي]] رضي الله عنهم — نص: خرج علينا ومعه أبو بكر وعمر وعثمان وعلي فقال — الحكم 0 (تعداد أسماء).",
  "كلام: وزي ما اتعلمنا [[لا ضرر ولا ضرار]] فما تأذيش حد — نص: لا ضرر ولا ضرار — الحكم 1 (قاعدة بلفظ النص يستشهد بها).",
  "أجب بسطر واحد فيه رقم واحد (1 أو 0) لكل بند بالترتيب، ملتصقة، بلا أي كلام آخر. مثال لثلاثة بنود: 101",
].join("\n");
export const checkUser = (items) => items.map((x, i) => `البند ${i + 1}\nكلام: ${x.said}\nنص: ${x.source}`).join("\n\n");
/** the model's answer -> "0110" (one digit per item) or null */
export function parseCheck(text, n) {
  const t = stripThink(text).trim();
  if (!/^[01٠١\s,،.\-]+$/.test(t)) return null;          // digits and nothing else: a sentence that happens to hold a 0 or a 1 is not an answer
  const d = t.replace(/[٠١]/g, (c) => (c === "٠" ? "0" : "1")).replace(/[^01]/g, "");
  return d.length === n ? d : null;
}

// ---------------------------------------------------------------- chat
const GRADE = /^(ال)?(صحيح|صحيحه|صحاح|حسن|حسنه|ضعيف|ضعيفه|موضوع|موضوعه|مكذوب|باطل|منكر|واه|ثابت|ثابته|sahih|hasan|daif|weak|authentic|fabricated|sound)$/i;
/** does this sentence use a grading word that does not stand in the facts with the same word after it (or before it)? */
function gradesOnItsOwn(sentence, hay) {
  const ws = fold(sentence).split(" ").filter(Boolean);
  for (let i = 0; i < ws.length; i++) {
    if (!GRADE.test(ws[i])) continue;
    const next = ws[i + 1] ? ws[i] + " " + ws[i + 1] : null, prev = i ? ws[i - 1] + " " + ws[i] : null;
    if (!((next && hay.includes(next)) || (prev && hay.includes(prev)))) return true;
  }
  return false;
}
const ID = /^[LS]\d{1,3}$/;
/** -> {q, facts: [{id, text}], prev, lang} cleaned, or null */
export function chatInput(body) {
  const q = line(body && body.q, ASK.Q);
  if (q.length < 2) return null;
  const facts = []; let total = 0;
  for (const f of Array.isArray(body && body.facts) ? body.facts.slice(0, ASK.FACTS) : []) {
    const id = typeof (f && f.id) === "string" ? f.id : "", text = line(f && f.text, ASK.FACT);
    if (!ID.test(id) || !text || facts.some((x) => x.id === id)) continue;
    if (total + text.length > ASK.FACTS_TOTAL) break;
    total += text.length; facts.push({ id, text });
  }
  const lang = body && body.lang === "en" ? "en" : "ar";
  return { q, facts, prev: line(body && body.prev, ASK.PREV), lang };
}
export const CHAT_SYSTEM = (lang) => [
  "أنت «أثَر»: مساعد يجيب عن أسئلة حول ما استُشهد به في محاضرة، وحول نتائج بحث في مصادر محددة (القرآن وكتب الحديث وكتب محمَّلة). تعمل من «الوقائع» المعطاة لك فقط.",
  "قواعد لا استثناء فيها:",
  "١) لا تستعمل أي معلومة من خارج الوقائع: لا من حفظك ولا من علمك العام. ما ليس في الوقائع فأنت لا تعرفه.",
  "٢) لكل واقعة تبني عليها جوابك ضع رمزها في ids، وستُعرض بطاقتها للمستخدم بنصّها الكامل ومصدرها ودرجتها من المصادر نفسها. لذلك لا تكتب أنت نص آية أو حديث ليس في الوقائع، ولا تكتب الرموز (مثل L3) داخل text.",
  "٣) المصدر والدرجة: إن ذكرتهما فبألفاظ الواقعة نفسها بلا تغيير ولا تلخيص ولا ترجيح. «في صحيح البخاري» معناها أن الحديث في ذلك الكتاب، وليست حكمًا تصوغه بلفظ آخر. واقعة تقول «لا درجة مسجّلة» فقل ذلك كما هو، ولا تصف حديثًا بأنه صحيح أو ضعيف من عندك.",
  "٤) لا تُفتِ ولا تستنبط حكمًا شرعيًّا ولا تفسّر آية أو حديثًا برأيك. سؤال عن حكم («ما حكم…»، «هل يجوز…»، «هل يجب…») نوعه refuse دائمًا، وتقول في text إن هذا خارج عملك وإنه يُسأل عنه أهل العلم.",
  "٥) إن لم يكن في الوقائع شيء عن المسؤول عنه فالنوع notfound، وتقول في text ما الذي لم تجده، في جملة واحدة. لا تخمّن ولا تكمل من عندك. أما إذا وُجدت الواقعة المسؤول عنها فالنوع answer ورمزها في ids، حتى لو كانت بلا درجة مسجّلة أو قيل فيها إنها لم يُعثر عليها: قل ما تقوله الواقعة عنها.",
  "٦) الوقائع التي رمزها L من سجل المحاضرة (ما قاله المتحدث). التي رمزها S نتائج بحث في المصادر عن نص السؤال: استعملها فقط إذا كانت هي المسؤول عنها، وقل إنها نتيجة بحث في المصادر لا شيء قيل في المحاضرة.",
  "٧) الأزمنة والأرقام تُنقل كما هي في الواقعة (مثل 1:42 أو رقم 55a) ولا تُكتب بالحروف ولا تُحوَّل.",
  "٨) text: من جملة إلى خمس، " + (lang === "en" ? "in English" : "بالعربية الفصحى الواضحة") + "، بلا تنسيق ولا قوائم ولا ترقيم. ids: رموز الوقائع التي بنيت عليها جوابك، الأهم أولًا، ثمانية على الأكثر.",
  "أجب بكائن JSON واحد فقط بهذا الشكل: {\"type\":\"answer\",\"ids\":[\"L1\"],\"text\":\"...\"} حيث type واحد من answer أو notfound أو refuse.",
].join("\n");
export function chatUser(inp) {
  const facts = inp.facts.length ? inp.facts.map((f) => `[${f.id}] ${f.text}`).join("\n") : "(لا وقائع)";
  return `الوقائع:\n${facts}\n\n${inp.prev ? "السؤال السابق وجوابه: " + inp.prev + "\n\n" : ""}السؤال: ${inp.q}`;
}
/**
 * the model's answer -> {type, ids, text}, or null when it is not the object asked for.
 * ids are kept only when they were given; a quotation («…» or "…") that does not stand in the facts or in the question
 * is taken out: whatever the reader sees between quotation marks is something the sources (or he himself) said.
 */
export function parseChat(text, inp) {
  const s = stripThink(text), a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let j; try { j = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const type = j.type === "notfound" || j.type === "refuse" ? j.type : j.type === "answer" ? "answer" : null;
  if (!type) return null;
  const known = new Set(inp.facts.map((f) => f.id));
  const ids = type === "answer" ? [...new Set((Array.isArray(j.ids) ? j.ids : []).filter((x) => typeof x === "string" && known.has(x)))].slice(0, ASK.IDS) : [];
  const hay = " " + fold(inp.facts.map((f) => f.text).join(" ") + " " + inp.q) + " ";
  let out = line(String(typeof j.text === "string" ? j.text : "").replace(/[<>`*_#]/g, " ").replace(/\[?\b[LS]\d{1,3}\b\]?/g, " "), ASK.TEXT);
  out = out.replace(/«([^«»]{12,})»|"([^"]{12,})"|“([^“”]{12,})”/g, (m, x, y, z) => (hay.includes(fold(x || y || z)) ? m : "«…»"));
  // a sentence that grades (صحيح، حسن، ضعيف، موضوع …) in words the facts do not carry is dropped: gradings come from the sources' data only
  out = out.split(/(?<=[.!؟?])\s+/).filter((sent) => !gradesOnItsOwn(sent, hay)).join(" ").trim();
  if (!out) out = type === "answer" ? (inp.lang === "en" ? "See the cards below." : "انظر البطاقات أدناه.") : "";
  if (!out) return null;
  return { type, ids, text: out };
}
