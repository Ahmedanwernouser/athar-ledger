// The two things a language model is asked on behalf of the ledger, and how its answers are reduced before they leave
// the Worker. Kept apart from src.js so that the same text is what the tests and the live probe exercise.
//
//  check: "is the speaker QUOTING this text in the marked stretch, or do a few words merely coincide?"
//         The answer that leaves is one digit per item (1 quoting, 0 coincidence) or nothing. No word of the model is shown.
//  chat:  a question about a lecture's ledger and about search results in the sources. The model may only point at the
//         facts it was given (by their ids) and write a few connecting sentences; verses, hadith, numbers and gradings
//         are shown to the reader from the sources' data, never from the model's words.

export const ASK = { MAX_BODY: 40000, CHECK_ITEMS: 6, SAID: 420, SOURCE: 700, FACTS: 30, FACT: 420, FACTS_TOTAL: 6500, Q: 300, PREV: 1100, TEXT: 1100, IDS: 8,
  PASSAGES: 16, PASSAGE: 900, PASSAGES_TOTAL: 5200 };      // passages: the lecturer's own words (the transcript), sent beside the facts

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
/** a sentence that says something was repeated / said more than once, when no fact says so («ذُكر مرتين», «٣ مرات») */
const REPEATS = /(كرر|تكرر|مكرر|مرتين|مرات|اكثر من مره|twice|repeated|more than once|times)/;
function repeatsOnItsOwn(sentence, hay) { return REPEATS.test(fold(sentence)) && !/(مرتين|مرات|twice|times)/.test(hay); }
/** what a refusal says is fixed here: the model decides only THAT it refuses (measured: it wrote "هذا خارج عملك" to the reader) */
const REFUSAL = { ar: "هذا خارج عملي: لا أُفتي ولا أشرح من عندي، ويُسأل عنه أهل العلم. أستطيع أن أعرض لك ما استُشهد به، ومصدره، ودرجته المنقولة، وهل طابق لفظُه المصدر.", en: "That is outside what I do: I give no rulings and no explanations of my own; ask the people of knowledge. I can show what was cited, its source, its recorded grading, and whether its wording matched the source." };
const GRADE = /^(ال)?(صحيح|صحيحه|صحاح|حسن|حسنه|ضعيف|ضعيفه|موضوع|موضوعه|مكذوب|باطل|منكر|واه|ثابت|ثابته|sahih|hasan|daif|weak|authentic|fabricated|sound)$/i;
/** does this sentence use a grading word that does not stand in the facts with the same word after it (or before it)? */
function gradesOnItsOwn(sentence, hay, carried = null) {
  const ws = fold(sentence).split(" ").filter(Boolean);
  for (let i = 0; i < ws.length; i++) {
    if (!GRADE.test(ws[i])) continue;
    // «هذا الموضوع», «في الموضوع»: the topic, not the grading «موضوع» (measured 5 Oct: «من النصوص القريبة من هذا الموضوع» — the very words rule ١٤ asks for — was dropped)
    if (ws[i] === "الموضوع" && !/^(ال)?(حديث|خبر|اثر)$/.test(ws[i - 1] || "")) continue;
    const next = ws[i + 1] ? ws[i] + " " + ws[i + 1] : null, prev = i ? ws[i - 1] + " " + ws[i] : null;
    // … or as the grading itself of some fact («الدرجة: صحيح — …»): "حديث الترمذي 2195 صحيح" says what that fact says
    const asGrade = hay.includes(" الدرجه " + ws[i].replace(/^ال/, "").replace(/ه$/, "")) || hay.includes(" grading " + ws[i]);      // («درجته صحيحة» says «الدرجة: صحيح»)
    // … or as a grading the facts carry in their own notation: «(صحيح — الألباني)» beside another collection that holds
    // the hadith, «اختُلف فيه: صحيح (…) · ضعيف (…)». (Measured 5 Oct on Groq and on Gemini: "where does it stand?" was
    // answered rightly with each collection's grading, and every such sentence was dropped — only "see the cards" was left.)
    const base = ws[i].replace(/^ال/, "").replace(/ه$/, "");
    if (!(asGrade || (carried && carried.has(base)) || (next && hay.includes(next)) || (prev && hay.includes(prev)))) return true;
  }
  return false;
}
/** a reference written out in words («رقم ألف وثلاثمائة…», «الآية سبعة وعشرون»): numbers are copied as digits or not at all
 *  (measured 5 Oct on Gemini: «رقم ألف وثلاثمائة وتسعة» for 1369) */
const NUM_WORD = /(^| )(رقم|برقم|الايه|ايه|الحديث) (ال)?(واحد|اثنان|اثنين|ثلاث[ء-ي]*|اربع[ء-ي]*|خمس[ء-ي]*|ست[هة]?|ستون|ستين|ستمائه|سبع[ء-ي]*|ثمان[ء-ي]*|تسع[ء-ي]*|عشر[ء-ي]*|احد عشر|مائ[ء-ي]*|مئ[ء-ي]*|الف|الفين|الفان|الاف)( |$)/;
const spellsNumber = (sentence) => NUM_WORD.test(fold(sentence));
const lev = (a, b, max) => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; let low = i; for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < low) low = cur[j]; } if (low > max) return max + 1; prev = cur; }
  return prev[b.length];
};
/**
 * A word of a quoted text that the model miscopied is put back as the text has it. The words that stand between «» in
 * the facts are the sources' own (an ayah, a hadith, what was said). A long word of the answer that stands NOWHERE in
 * the facts or the question, and is one or two letters away from exactly one such word, was meant to be that word
 * (measured 5 Oct on Gemini: «واستانينوا بالصبر» for «واستعينوا»). Nothing else is touched.
 */
function restoreQuoted(out, inp, hay) {
  const quoted = new Map();
  for (const f of inp.facts) for (const m of String(f.text).matchAll(/«([^«»]+)»/g)) for (const w of m[1].split(/\s+/)) { const k = fold(w); if (k.length >= 5 && !k.includes(" ")) quoted.set(k, w.replace(/[.,،؛:!؟?"“”…]+$/g, "").replace(/^["“”]+/, "")); }
  if (!quoted.size) return out;
  return out.replace(/[ء-يً-ْٰ]{5,}/g, (w) => {
    const k = fold(w); if (k.length < 5 || hay.includes(" " + k + " ")) return w;
    const max = k.length >= 7 ? 2 : 1; let hit = null, n = 0;
    for (const [q, orig] of quoted) if (q[0] === k[0] && lev(k, q, max) <= max) { if (hit !== orig) n++; hit = orig; }
    return n === 1 ? hit : w;
  });
}
const ID = /^[LSM]\d{1,3}$/, PID = /^T\d{1,3}$/;
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
  // passages of the transcript (ids T…): the lecturer's own words, with the time they were said at. They are listed with
  // the facts (a quotation from them is a quotation the reader can check) and have a budget of their own.
  let ptotal = 0, pn = 0;
  for (const f of Array.isArray(body && body.passages) ? body.passages.slice(0, ASK.PASSAGES) : []) {
    const id = typeof (f && f.id) === "string" ? f.id : "", text = line(f && f.text, ASK.PASSAGE);
    if (!PID.test(id) || !text || facts.some((x) => x.id === id)) continue;
    if (ptotal + text.length > ASK.PASSAGES_TOTAL) break;
    ptotal += text.length; pn++; facts.push({ id, text });
  }
  const lang = body && body.lang === "en" ? "en" : "ar";
  return { q, facts, prev: line(body && body.prev, ASK.PREV), lang, passages: pn };
}
export const CHAT_SYSTEM = (lang) => [
  "أنت «أثَر»: مساعد يجيب عن أسئلة حول ما استُشهد به في محاضرة، وحول نتائج بحث في مصادر محددة (القرآن وكتب الحديث وكتب محمَّلة). تعمل من «الوقائع» المعطاة لك فقط.",
  "قواعد لا استثناء فيها:",
  "١) لا تستعمل أي معلومة من خارج الوقائع: لا من حفظك ولا من علمك العام. ما ليس في الوقائع فأنت لا تعرفه.",
  "٢) لكل واقعة تبني عليها جوابك ضع رمزها في ids، وستُعرض بطاقتها للمستخدم بنصّها الكامل ومصدرها ودرجتها من المصادر نفسها. لذلك لا تكتب أنت نص آية أو حديث ليس في الوقائع، ولا تكتب الرموز (مثل L3) داخل text.",
  "٣) المصدر والدرجة: إن ذكرتهما فبألفاظ الواقعة نفسها بلا تغيير ولا تلخيص ولا ترجيح. «في صحيح البخاري» معناها أن الحديث في ذلك الكتاب، وليست حكمًا تصوغه بلفظ آخر. واقعة تقول «لا درجة مسجّلة» فقل ذلك كما هو، ولا تصف حديثًا بأنه صحيح أو ضعيف من عندك.",
  "٤) لا تُفتِ ولا تستنبط حكمًا شرعيًّا ولا تفسّر آية أو حديثًا برأيك. سؤال عن حكم («ما حكم…»، «هل يجوز…»، «هل يجب…») أو طلب شرح معنى نص حين لا يكون في المقاطع T شرح المحاضر له، نوعه refuse. الرفض لهذين فقط (ونقل شرح المحاضر نفسه من المقاطع T ليس شرحًا من عندك: انظر القاعدة ١٣). السؤال عن صحة حديث أو درجته أو مصدره («هل حديث كذا صحيح؟»، «ما درجته؟»، «أين ورد؟») ليس طلب فتوى ولا يُرفض أبدًا: إن وُجدت واقعته فنوعه answer وتنقل ما تقوله عن درجته ومصدره كما هو (ولو كان «لا درجة مسجّلة» أو «ليس في كتب الحديث المحمَّلة»)، وإن لم توجد فنوعه notfound. وكذلك السؤال عن لفظ ما قيل — هل الآية أو الحديث كما قيل صحيح اللفظ، مطابق، محرَّف، ناقص؟ — فليس حكمًا شرعيًّا: هو سؤال عن «الحالة» في الواقعة («مطابق حرفيًا»، «مطابق مع فروق»، «قيل منه كذا من كذا كلمة»)، فنوعه answer وتنقل ما تقوله الواقعة.",
  "٩) من سأل عن رابط أو مصدر نصٍّ فجوابه answer برمز واقعته: بطاقتها التي تُعرض تحمل رابط المصدر. لا تقل إنك لم تجد رابطًا لواقعة موجودة.",
  "١٠) العدّ والتكرار كما في الواقعة فقط: «ذُكر مرة واحدة» لا تُسمّى تكرارًا، ولا تقل عن نص إنه كُرِّر إلا إذا قالت واقعته «ذُكر مرتين» أو أكثر. من طلب «الآيات» أو «الأحاديث» فاذكرها كلها برموزها، لا واحدة منها.",
  "١١) المقارنة بين نصّين في الوقائع جائزة بما في الوقائع وحده: مصدر كلٍّ، ودرجته، وكم قيل منه، وحالته. ومن سأل عن درجة «كل» حديث فاذكر كل حديث في الوقائع بدرجته كما هي.",
  "١٣) المقاطع التي رمزها T من كلام المحاضر نفسه كما فُرِّغ آليًّا (قد يخطئ التفريغ في كلمة)، ومع كل مقطع زمنه. بها تجيب عن: «لخّص المحاضرة»، «ماذا قال الشيخ عن كذا؟»، «متى تكلّم عن كذا؟»، و«اشرح لي هذا الحديث/الآية» — فتنقل ما قاله المحاضر هو في شرحه، منسوبًا إليه («ذكر المحاضر أن…»، «قال عند 2:10…»)، وتضع رموز المقاطع في ids. لا تزد على كلامه معنًى من عندك ولا ترجّح ولا تصحّح له. إن لم يكن في المقاطع شرح لما سُئلت عنه فقل إن المحاضر لم يشرحه في المقاطع المتاحة (notfound). التلخيص: أهم ما قاله بترتيبه، في خمس جمل على الأكثر. كلام المحاضر ليس مصدرًا لدرجة حديث: الدرجة من الوقائع L و S فقط.",
  "١٤) أنواع وقائع S: «النص الذي سمّاه السؤال بمرجعه» هو المطلوب نفسه فاذكره برمزه. «نص قريب من موضوع السؤال» اقتراح من بحث بالموضوع: قدّمه هكذا («من النصوص القريبة من هذا الموضوع في المصادر…») واذكر رموزه، ولا تقل إنه «الحديث الوارد في» الموضوع ولا إنه كل ما ورد فيه، ودع ما لا علاقة له بالسؤال. «وهو أيضًا في: …» تخريج الحديث: من سأل «من أخرجه؟» أو «أين ورد؟» فاذكر الكتب كما هي مع درجة كلٍّ إن ذُكرت. «آية تشترك في اللفظ مع …» جواب من سأل هل في الحديث شيء من القرآن: قل إن بينهما اشتراكًا في اللفظ واذكر الآية، ولا تزد. «وردت في أحاديث: …» جواب من سأل عن الأحاديث التي ذُكرت فيها الآية. «مذكور في كتب الموضوعات والمشتهرات» مع «كلام الكتاب»: انقل كلام الكتاب بين علامتي تنصيص كما هو ولا تلخّصه بحكم من عندك؛ ومن سأل «هل هذا حديث؟» عن نص لا واقعة له فنوعه notfound وتقول إنه لم يُعثر عليه في المصادر المحمَّلة وإن ذلك ليس حكمًا عليه.",
  "١٢) الواقعة التي رمزها M معلومات عن المحاضرة نفسها (عنوانها كما في يوتيوب، مدتها، من فرّغها). من سأل عن اسم الشيخ أو عنوان المحاضرة فمنها، وقل إنه من عنوان الفيديو.",
  "٥) إن لم يكن في الوقائع شيء عن المسؤول عنه فالنوع notfound، وتقول في text ما الذي لم تجده، في جملة واحدة. لا تخمّن ولا تكمل من عندك. أما إذا وُجدت الواقعة المسؤول عنها فالنوع answer ورمزها في ids، حتى لو كانت بلا درجة مسجّلة أو قيل فيها إنها لم يُعثر عليها: قل ما تقوله الواقعة عنها.",
  "٦) الوقائع التي رمزها L من سجل المحاضرة (ما قاله المتحدث). التي رمزها S نتائج بحث في المصادر عن نص السؤال: استعملها فقط إذا كانت هي المسؤول عنها، وقل إنها نتيجة بحث في المصادر لا شيء قيل في المحاضرة.",
  "٧) الأزمنة والأرقام تُنقل كما هي في الواقعة (مثل 1:42 أو رقم 55a) ولا تُكتب بالحروف ولا تُحوَّل.",
  "٨) text: من جملة إلى خمس، " + (lang === "en" ? "in English" : "بالعربية الفصحى الواضحة") + "، بلا تنسيق ولا قوائم ولا ترقيم. ids: رموز الوقائع التي بنيت عليها جوابك، الأهم أولًا، ثمانية على الأكثر.",
  "أجب بكائن JSON واحد فقط بهذا الشكل: {\"type\":\"answer\",\"ids\":[\"L1\"],\"text\":\"...\"} حيث type واحد من answer أو notfound أو refuse.",
].join("\n");
export function chatUser(inp) {
  const F = inp.facts.filter((f) => f.id[0] !== "T"), T = inp.facts.filter((f) => f.id[0] === "T");
  const facts = (F.length ? F.map((f) => `[${f.id}] ${f.text}`).join("\n") : "(لا وقائع)") + (T.length ? "\n\nمقاطع من كلام المحاضر (تفريغ آلي):\n" + T.map((f) => `[${f.id}] ${f.text}`).join("\n") : "");
  return `الوقائع:\n${facts}\n\n${inp.prev ? "ما سبق في هذه المحادثة (للسياق فقط): " + inp.prev + "\n\n" : ""}السؤال: ${inp.q}`;
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
  let out = line(String(typeof j.text === "string" ? j.text : "").replace(/[<>`*_#]/g, " ").replace(/\[?\b[LSMT]\d{1,3}\b\]?/g, " "), ASK.TEXT);
  out = out.replace(/«([^«»]{12,})»|"([^"]{12,})"|“([^“”]{12,})”/g, (m, x, y, z) => (hay.includes(fold(x || y || z)) ? m : "«…»"));
  // a sentence that grades (صحيح، حسن، ضعيف، موضوع …) in words the facts do not carry is dropped: gradings come from the sources' data only
  // the gradings the facts themselves carry, wherever they write one: after «الدرجة:», after «اختُلف فيه:», after "(" or "·"
  const carried = new Set();
  for (const f of inp.facts) for (const m of String(f.text).matchAll(/(?:الدرجة:|اختُلف فيه:|[(·])\s*([^\s()—·،:]+)/g)) { const w = fold(m[1]); if (GRADE.test(w)) carried.add(w.replace(/^ال/, "").replace(/ه$/, "")); }
  out = restoreQuoted(out, inp, hay);
  out = out.split(/(?<=[.!؟?])\s+/).filter((sent) => !gradesOnItsOwn(sent, hay, carried) && !repeatsOnItsOwn(sent, hay) && !spellsNumber(sent)).join(" ").trim();
  if (type === "refuse") return { type, ids, text: REFUSAL[inp.lang === "en" ? "en" : "ar"] };
  if (!out) out = type === "answer" ? (inp.lang === "en" ? "See the cards below." : "انظر البطاقات أدناه.") : "";
  if (!out) return null;
  return { type, ids, text: out };
}
