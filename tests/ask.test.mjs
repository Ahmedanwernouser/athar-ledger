// The checker's and the chat's answers are reduced before anything of a model reaches the page (worker/ask.js), and a
// hadith told in pieces keeps one source among the places that hold each piece equally well (engine, oneSource).
import test from "node:test";
import assert from "node:assert/strict";
import { checkItems, parseCheck, chatInput, parseChat, CHECK_SYSTEM, CHAT_SYSTEM, chatUser, ASK } from "../worker/ask.js";
import { loadCorpus } from "../eval/lib.mjs";
import { analyze } from "../public/js/engine.js";

test("check: the request must mark the stretch; the answer is digits, one per item, or nothing", () => {
  const ok = { said: "الأشهر الحرم [[ذو القعدة وذو الحجة]] وإحنا داخلين", source: "منها أربعة حرم ذو القعدة وذو الحجة والمحرم" };
  assert.equal(checkItems({ items: [ok] }).length, 1);
  assert.equal(checkItems({ items: [{ said: "no mark in this one", source: ok.source }] }), null);
  assert.equal(checkItems({ items: [] }), null);
  assert.equal(checkItems({ items: Array.from({ length: 12 }, () => ok) }).length, ASK.CHECK_ITEMS, "never more than the limit in one question");
  assert.equal(parseCheck("0110", 4), "0110");
  assert.equal(parseCheck(" ١ ٠ ١ ", 3), "101", "Arabic digits and spaces");
  assert.equal(parseCheck("<think>the first is a list</think>01", 2), "01");
  assert.equal(parseCheck("011", 4), null, "one digit short");
  assert.equal(parseCheck("I think 0 and then 1", 2), null, "a sentence that happens to hold the digits is not an answer");
  assert.ok(CHECK_SYSTEM.includes("التشابه العارض") && !CHECK_SYSTEM.includes("إذا لم تكن متأكدًا"), "the question is put without a lean either way; a doubt is settled by the second model");
});

test("chat: only the facts that were given can be pointed at; a grading or a quotation the facts do not carry is taken out", () => {
  const inp = chatInput({ q: "ما صحة حديث الدين النصيحة؟", lang: "ar", facts: [
    { id: "S1", text: "نتيجة بحث في المصادر — حديث — صحيح مسلم — رقم 55a — الدرجة: في صحيح مسلم — اللفظ المطابق: «الدين النصيحة»" },
    { id: "L2", text: "في المحاضرة عند 1:42 — حديث — لا درجة مسجّلة — قيل: «اطلبوا العلم ولو في الصين»" },
    { id: "bad id", text: "x" }, { id: "S1", text: "the same id twice" }] });
  assert.deepEqual(inp.facts.map(f => f.id), ["S1", "L2"]);
  assert.ok(chatUser(inp).includes("[S1]") && CHAT_SYSTEM("ar").includes("لا تُفتِ") && CHAT_SYSTEM("en").includes("in English"));
  const say = o => parseChat(JSON.stringify(o), inp);
  let a = say({ type: "answer", ids: ["S1", "L9", "S1"], text: "الحديث في صحيح مسلم رقم 55a كما في [S1]. وهو حديث حسن عند بعضهم. قال فيه: «من غشنا فليس منا وهذا نص ليس في الوقائع»." });
  assert.deepEqual(a.ids, ["S1"]);
  assert.ok(a.text.includes("صحيح مسلم") && !a.text.includes("حسن") && !a.text.includes("غشنا") && !a.text.includes("S1"), a.text);
  a = say({ type: "answer", ids: ["L2"], text: "هذا الحديث ضعيف." });
  assert.equal(a.text, "انظر البطاقات أدناه.", "an answer that was nothing but an invented grading leaves only the cards");
  a = say({ type: "answer", ids: ["S1"], text: "قال: «الدين النصيحة» وهو في صحيح مسلم." });
  assert.ok(a.text.includes("«الدين النصيحة»"), "a quotation that stands in the facts stays");
  assert.deepEqual(say({ type: "refuse", ids: ["S1"], text: "هذا خارج عملي." }).ids, []);
  assert.equal(say({ type: "essay", text: "..." }), null);
  assert.equal(parseChat("free text, no object", inp), null);
  assert.equal(chatInput({ q: "" }), null);
  const big = chatInput({ q: "سؤال", facts: Array.from({ length: 60 }, (_, i) => ({ id: "L" + (i + 1), text: "ن".repeat(400) })) });
  assert.ok(big.facts.length <= ASK.FACTS && big.facts.reduce((n, f) => n + f.text.length, 0) <= ASK.FACTS_TOTAL, "what is sent to a model is bounded");
});

test("a hadith told in pieces keeps one source among the places that hold a piece equally well", async () => {
  const corpus = await loadCorpus();
  const T = `وبعدين قال ورجل قلبه معلق في المساجد ورجلان تحابا في الله اجتمعا عليه وتفرقا عليه
شوف بقى الصحوبية اللي لله مش لمصلحة ولا لفلوس دي اللي تنفعك يوم القيامة وتلاقيها قدامك
ورجل تصدق بصدقة فأخفاها حتى لا تعلم شماله ما تنفق يمينه ورجل ذكر الله خاليا ففاضت عيناه`;
  const refs = o => analyze(T.split(/\s+/).map(w => ({ w })), corpus, o).ledger.map(e => e.source.ref);
  const off = refs({ oneSource: false }), on = refs({});
  assert.equal(on.length, 2); assert.equal(off.length, 2);
  assert.notEqual(off[0], off[1], "piece by piece, each took its own place");
  assert.equal(on[0], on[1], "together they are one hadith under one source");
  assert.equal(on[1], off[1], "... the place that holds both pieces");
  const st = o => analyze(T.split(/\s+/).map(w => ({ w })), corpus, o).ledger.map(e => e.status + ":" + e.spoken);
  assert.deepEqual(st({}), st({ oneSource: false }), "no status and no wording changes");
});
