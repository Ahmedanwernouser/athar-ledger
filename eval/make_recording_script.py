#!/usr/bin/env python3
"""Builds the READ-ALOUD script for recording test audio + its ground truth (fixed seed -> reproducible).
This is READ SPEECH from fully vocalised text: cleaner than a real lecture. Results on it are an optimistic bound.
Everything quoted comes verbatim from the corpus (with tashkeel, so the reader pronounces it correctly);
paraphrase items are written by the team's assistant (Claude) and are labelled as such."""
import json, random, re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from build_index import norm
random.seed(2026)

q = json.load(open(ROOT/"data/raw/ara-quransimple.json", encoding="utf-8"))["quran"]
H = {}
for e in ["bukhari","muslim","abudawud","tirmidhi","nasai","ibnmajah"]:
    H[e] = json.load(open(ROOT/f"data/raw/ara-{e}.json", encoding="utf-8"))["hadiths"]

FILLER = [
 "ثم اعلموا رحمكم الله أن هذا الأمر عظيم، وأن الناس في زماننا كثيرًا ما يغفلون عنه.",
 "وقد تكلم العلماء في هذه المسألة كلامًا طويلًا، ونحن نختصر لكم أهم ما قيل فيها.",
 "ولننظر الآن إلى هذا المعنى من جانب آخر، وهو أثره في سلوك الإنسان اليومي.",
 "والمقصود من هذا كله أن نعود إلى الأصل، وأن نفهم كلام الشرع كما فهمه أهل العلم.",
 "ومما ينبغي التنبيه عليه أن العلم لا يؤخذ من العناوين، وإنما يؤخذ من الأصول.",
 "وأعود فأقول: إن الإنسان إذا تأمل في حاله وجد أنه محتاج إلى التذكير المستمر.",
 "ولا يخفى عليكم أن الحديث في هذا الباب متشعب، ولكن نقف عند أبرز ما فيه.",
 "فتأملوا معي هذا المعنى، فإنه من أنفع ما يمكن أن نتعلمه في مجلسنا هذا.",
]
CUE_Q = ["قال الله تعالى في كتابه الكريم", "وقال سبحانه وتعالى", "يقول ربنا جل وعلا"]
CUE_H = ["وقال رسول الله صلى الله عليه وسلم", "وفي الحديث الصحيح عن النبي صلى الله عليه وسلم أنه قال", "ثبت عنه عليه الصلاة والسلام أنه قال"]

items = []
# 1) verbatim Quran (10 ayahs of 8-22 words)
cand = [x for x in q if x["verse"] != 1 and 8 <= len(norm(x["text"]).split()) <= 22]
for x in random.sample(cand, 10):
    items.append({"kind": "verbatim_quran", "cue": random.choice(CUE_Q), "spoken": x["text"],
                  "truth": {"type": "q", "ref": f'{x["chapter"]}:{x["verse"]}'}})
# 2) verbatim hadith (14, matn 10-30 words, single-collection spread)
n_h = 0
for e, k in [("bukhari",5),("muslim",4),("abudawud",2),("tirmidhi",2),("ibnmajah",1)]:
    pool = []
    for h in H[e]:
        t = re.sub("[\u200e\u200f]", "", h["text"])
        a, b = t.find('"'), t.rfind('"')
        if a < 0 or b <= a: continue
        body = re.sub(r"\s+", " ", t[a + 1:b]).strip()
        L = len(norm(body).split())
        if 10 <= L <= 30 and '"' not in body: pool.append((h["hadithnumber"], body))
    for num, body in random.sample(pool, k):
        items.append({"kind": "verbatim_hadith", "cue": random.choice(CUE_H), "spoken": body,
                      "truth": {"type": "h", "ref": f"{e}:{num}"}})
# 3) paraphrase / mixed items (text authored by the assistant; ground truth refs checked against the corpus)
PARA = [
 ("بالمعنى", "وقد بيّن النبي صلى الله عليه وسلم أن القوي الحقيقي ليس من يغلب الناس في المصارعة، وإنما هو من يملك نفسه حين يغضب.", "bukhari:6114"),
 ("بالمعنى", "وحذّر النبي صلى الله عليه وسلم من الغش في البيع والشراء، وبيّن أن الغاشّ ليس على طريقتنا.", "muslim:283"),
 ("بالمعنى", "ومن علامات الإسلام الصحيح أن يأمن الناس أذى لسانك ويدك.", "bukhari:10"),
 ("مخلوط", "وقد جعل النبي صلى الله عليه وسلم جوهر الدين في النصيحة، قال: الدين النصيحة، ثم فسّرها بأنها لله ولكتابه ولرسوله ولأئمة المسلمين وعامتهم.", "muslim:196"),
 ("مخلوط", "وفي أول حديث في صحيح البخاري أن الأعمال بالنيات، وأن لكل امرئ ما نوى، فالعبرة بالقصد قبل العمل.", "bukhari:1"),
 ("مخلوط", "وقد قال عليه الصلاة والسلام: إن الدين يسر، ثم حذّر من التشدد الذي يُنهك صاحبه.", "bukhari:39"),
]
for cls, text, ref in PARA:
    items.append({"kind": "paraphrase_or_mixed", "expected_class": cls, "cue": "", "spoken": text,
                  "truth": {"type": "h", "ref": ref}, "note": "author: Claude (assistant); not a verbatim corpus text"})
random.shuffle(items)

# 4) abstention clips, appended AFTER the shuffle so that clips 01–30 stay exactly as they were:
#    three sayings that are NOT in the corpus (from eval/absent_sayings.json — assembled by the assistant, for testing
#    abstention only, not a ruling on authenticity), each introduced with «قال رسول الله», and three citation cues that are
#    followed by ordinary speech instead of a quotation.
ABSENT = json.load(open(ROOT/"eval/absent_sayings.json", encoding="utf-8"))["sayings"]
for text in ["المعدة بيت الداء والحمية رأس الدواء", "نحن قوم لا نأكل حتى نجوع وإذا أكلنا لا نشبع",
             "اعمل لدنياك كأنك تعيش أبدا واعمل لآخرتك كأنك تموت غدا"]:
    assert text in ABSENT, text
    items.append({"kind": "absent_saying", "expected_class": "لا استشهاد نصي", "cue": "وقال رسول الله صلى الله عليه وسلم", "spoken": text, "truth": None,
                  "note": "widely circulated saying that is not in the corpus; the engine must not show a textual citation"})
for text in ["قال رسول الله صلى الله عليه وسلم كلامًا عظيمًا في هذا الباب، سنذكره بعد قليل إن شاء الله.",
             "قال الله تعالى في آيات كثيرة ما يبيّن هذا المعنى ويؤكده لمن تدبّر.",
             "وفي الحديث عن النبي صلى الله عليه وسلم فوائد كثيرة تتعلق بهذه المسألة، ولعلنا نعود إليها في درس قادم."]:
    items.append({"kind": "cue_only", "expected_class": "لا استشهاد نصي", "cue": "", "spoken": text, "truth": None,
                  "note": "a citation cue with no quotation after it; the engine must not show a textual citation"})

# --- outputs ---
out = ["# نص التسجيل — اقرأ بصوت طبيعي كأنك تحاضر\n",
       "التعليمات: سجّل كل **مقطع** في ملف منفصل (هاتف عادي يكفي، غرفة هادئة)، سمِّ الملف برقم المقطع (clip_01.m4a ...).",
       "اقرأ الفقرة بالترتيب: جملة التمهيد ← عبارة الاستشهاد ← النص المقتبس ← جملة ختام. لا تُشكّل ولا تتوقف. ",
       "يُفضَّل أن يسجّل ٢–٣ أشخاص مختلفين نفس المقاطع (ذكر/أنثى، لهجات مختلفة) — هذا يُحسّن القياس.\n",
       "> **تنبيه:** هذه **قراءة من نص مكتوب ومشكول**، في غرفة هادئة. هي أنظف من محاضرة حقيقية مرتجلة، فنسبة الخطأ التي تُقاس عليها ستكون على الأرجح أقل من نسبة الخطأ في محاضرة حقيقية. اكتبوا ذلك عند ذكر النتيجة.\n",
       "المقاطع ٣١–٣٣ فيها عبارات متداولة **ليست في المدونة** تسبقها عبارة «وقال رسول الله صلى الله عليه وسلم»، والمقاطع ٣٤–٣٦ فيها عبارة استشهاد يتبعها كلام عادي بلا اقتباس. الغرض: قياس امتناع الأداة عن نسبة ما ليس عندها. اقرؤوها كغيرها.\n"]
truth = []
for i, it in enumerate(items, 1):
    f1, f2 = random.sample(FILLER, 2)
    parts = [f1] + ([it["cue"] + ":"] if it["cue"] else []) + [it["spoken"], f2]
    out.append(f"## clip_{i:02d}\n" + " ".join(parts) + "\n")
    t = {"clip": f"clip_{i:02d}", **{k: it[k] for k in it if k != "cue"}, "script": " ".join(parts)}
    # accept any corpus passage whose text contains the quoted words (same hadith appears in several books)
    t["quoted_norm"] = norm(it["spoken"])
    truth.append(t)
(ROOT/"eval/recording_script.md").write_text("\n".join(out), encoding="utf-8")
(ROOT/"eval/ground_truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(items), "clips;", sum(1 for t in truth if t["kind"].startswith("verbatim")), "verbatim;",
      sum(1 for t in truth if t["kind"] == "absent_saying"), "absent sayings;", sum(1 for t in truth if t["kind"] == "cue_only"), "cue-only")
