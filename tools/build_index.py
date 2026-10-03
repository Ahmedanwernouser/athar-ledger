#!/usr/bin/env python3
"""
build_index.py — reproducible corpus + shingle-index builder (preparation tool, disclosed as BASELINE).

Input : data/raw/ara-*.json  (see tools/fetch_data.sh)
Output: public/data/   (or $ATHAR_OUT, e.g. ATHAR_OUT=/some/staging/public/data to build without touching the site)
          meta.json            counts, parameters, sources, link templates, hadith numbers with no Arabic text upstream
          passages_<k>.json    shards of {t,r,n,m[,x][,s]}: type (q|h), reference, normalised text, matn flag
                               hadith: n = the text AFTER its leading chain of narrators (see matn_start below)
                               m = 1: the chain was removed, or the text has none; m = 0: the full text was kept
                               s (optional, only with m = 0): number of leading words of n that the heuristic
                               believes are the chain (kept because removing them would leave too little)
          quran_display.json   Quran ayahs WITH diacritics (display only)
          idx2.bin, idx3.bin   candidate-generation indexes over word 2-/3-grams (phonetically folded)
          hash_vectors.json    test vectors so the JS implementation can be checked against this one

The index is only a *candidate generator*. Every verdict is decided later by exact comparison
of the normalised text (so hash collisions or folding can never create a false "match").

Binary index layout (little-endian):
  magic  'ATH1'            4 bytes
  nKeys  uint32
  nPost  uint32
  keys   uint32[nKeys]     sorted FNV-1a hashes of folded shingles
  cnt    uint8[nKeys]      posting-list length (capped, see MAX_DF)
  post   uint16[nPost]     passage ids, grouped per key in key order (padded to 4-byte boundary at the end)
"""
import json, os, re, struct, sys, hashlib, collections, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = pathlib.Path(os.environ["ATHAR_OUT"]).resolve() if os.environ.get("ATHAR_OUT") else ROOT / "public" / "data"

HADITH = ["bukhari", "muslim", "abudawud", "tirmidhi", "nasai", "ibnmajah", "malik", "nawawi", "qudsi"]
MIN_WORDS_HADITH = 8      # shorter hadith texts are not searchable by shingles
MAX_DF = 255              # drop shingles that appear in more passages than this (uninformative, e.g. "قال رسول")
SHARD_WORDS = 380_000     # words per passages_<k>.json shard (keeps each file well under the 25 MiB Pages limit)

# ---------- normalisation (must match public/js/text.js) ----------
DIAC = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ]")
def norm(s: str) -> str:
    s = DIAC.sub("", s)
    s = re.sub("[إأآٱ]", "ا", s)
    s = s.replace("ى", "ي").replace("ة", "ه")
    s = re.sub("[^ء-ي ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

# Phonetic folding: letters ASR frequently confuses are merged *for candidate retrieval only*.
FOLD = str.maketrans({"ص": "س", "ث": "س", "ض": "د", "ظ": "ز", "ذ": "ز", "ط": "ت", "ق": "ك",
                      "ح": "ه", "ع": "ا", "ء": "ا", "ئ": "ا", "ؤ": "و", "غ": "ك", "خ": "ه"})
def fold(s: str) -> str:
    return s.translate(FOLD)

def fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h

# ---------- hadith: where does the matn start? (leading chain of narrators = isnad) ----------
# Everything below works on the NORMALISED words of one hadith. Nothing is rewritten: the indexed text is the
# normalised text from word `start` to the end, so narrative, quoted speech and the compiler's tail are all kept.
_STRONG = set("حدثنا حدثني اخبرنا اخبرني انبانا انباني نبانا ثنا حدثناه حدثنيه اخبرناه اخبرنيه حدثتني حدثتنا اخبرتني اخبرتنا سمعت سمعنا".split())
_WEAK = set("عن سمع سمعه حدثه اخبره حدثته اخبرته حدثهم اخبرهم حدثهما اخبرهما حدثها اخبرها يحدث يحدثه يخبر يخبره بلغه يبلغ يرفعه رفعه يرويه".split())
_POST = set("حدثه اخبره حدثته اخبرته حدثهم اخبرهم حدثهما اخبرهما حدثها اخبرها".split())     # "... أن فلانا أخبره"
_QAL = set("قال قالت قالا قالوا يقول تقول يقولان".split())
_AN = set("ان انه انها انهم انهما".split())
_HEARD = set("سمعت سمع وسمعت سمعنا".split())
_ASK = set("يسال سال سالت يسالون سئل يسئل".split())       # "سمعت فلانا يسأل ..." : what was heard is an event, i.e. matn
_PROPHET = {"النبي", "نبي", "رسول"}
_EPITHET = set("زوج ازواج صاحب اصحاب مولي خادم بنت ابنه مؤذن عم ختن حب امراه رديف".split())   # "عائشة زوج النبي ﷺ" is a name
_NOT_A_NARRATOR = set("رجلا رجل صوتا صوت امراه مناديا منادي الناس قوما ناسا شيءا شيا كلاما هذا ذلك الله نداء قراءه".split())
_CONN = set("بن ابن بنت ابي ابو ابا عبد ام بني".split())          # name connectors: they and the word after them are not counted
_NARRATIVE = set("فقال فقالت فقالوا قلت فقلت ثم كان كنت كنا لما فلما اذا يا مع الي لا ما هل قد".split())
_STORY = set("ثم فقال فقالت فقالوا قلت فقلت لما فلما حين يا اذا فاذا بينما بينا وجاءه فجاءه وساله فساله واتاه فاتاه وسئل فسئل".split())   # never part of a narrator's name
MAX_NAME = 7          # counted words between two transmission words (a narrator's name) before the chain is given up
MAX_STRIP = 0.60      # never remove more than this share of a hadith, unless the cut is "anchored" (see hadith_text)
MIN_KEEP = 4          # ... nor leave fewer words than this

def _mark(w):
    """transmission word? returns 2 (حدثنا-class), 1 (عن-class) or 0; a leading و/ف is ignored"""
    if w in _STRONG: return 2
    if w in _WEAK: return 1
    if len(w) > 2 and w[0] in "وف":
        if w[1:] in _STRONG: return 2
        if w[1:] in _WEAK: return 1
    return 0

def hadith_words(t):
    """-> (words, punct_after[], first_quote): normalised words, the punctuation that followed each word in the
    source (1 = comma/colon, 2 = full stop), and the index of the first word after the first quotation mark"""
    t = re.sub("[\u200e\u200f]", "", t)
    words, comma, first_quote = [], [], None
    for k, seg in enumerate(re.split('(["“”«»{﴿])', t)):      # a quoted verse counts like a quotation mark
        if k % 2:
            if first_quote is None: first_quote = len(words)
            continue
        for tok in seg.split():
            ws = norm(tok).split()
            c = 2 if "." in tok else 1 if ("،" in tok or "," in tok or ":" in tok) else 0
            if not ws:
                if c and words: comma[-1] = max(comma[-1], c)
                continue
            words += ws; comma += [0] * (len(ws) - 1) + [c]
    return words, comma, first_quote

def _honorific(w, k):
    """length of an honorific formula starting at k (صلى الله عليه وسلم، رضي الله عنه، عليه السلام ...), else 0"""
    a = w[k:k + 6]
    if len(a) >= 4 and a[0] in ("صلي", "صل") and a[1] == "الله" and a[2] == "عليه":
        if a[3] == "وسلم": return 4
        if len(a) >= 5 and a[3] == "و" and a[4] == "سلم": return 5
        if len(a) >= 5 and a[3] == "واله" and a[4] == "وسلم": return 5
    if len(a) >= 3 and a[0] == "رضي" and a[1] == "الله" and a[2] in ("عنه", "عنها", "عنهما", "عنهم", "عنهن", "تعالي"):
        return 4 if a[2] == "تعالي" and len(a) >= 4 else 3
    if len(a) >= 2 and a[0] in ("عليه", "عليها", "عليهما") and a[1] == "السلام": return 2
    if len(a) >= 2 and a[0] == "رحمه" and a[1] == "الله": return 2
    return 0

def _prophet_at(w, k):
    """number of words of a mention of the Prophet starting at k (النبي / رسول الله / نبي الله [+ honorific]), else 0"""
    if k >= len(w): return 0
    x = w[k]
    if x[:1] in "ول" and x[1:] in ("النبي", "رسول") and len(x) > 4: x = x[1:]   # والنبي ، لرسول
    if x in ("النبي", "للنبي"): n = 1
    elif x in ("رسول", "نبي") and k + 1 < len(w) and w[k + 1] == "الله": n = 2
    else: return 0
    return n + _honorific(w, k + n)

_LEAD = set("قال وقال زاد وزاد رواه ورواه تابعه وتابعه وروي روي".split())
LOOKAHEAD = 12        # a حدثنا-class word this close (same sentence, before any mention of the Prophet) resumes the chain

_NAMEISH = set("يعني هو وهو واللفظ له قال وقال قالا قالوا الاخر الاخران الاخرون جميعا كلهم كلاهما ح يقال".split())

def _resumes(w, comma, k, plain_max=2):
    """position of a حدثنا-class word in w[k:k+LOOKAHEAD] that continues the chain, else 0. Everything in between
    must look like narrators' names: at most `plain_max` words that are not connectors (بن، أبو)، الـ-words,
    و-joined names or the usual asides (يعني، وهو، واللفظ له), and no sentence end, story word or mention of the Prophet."""
    plain = 0; after_conn = False
    for d in range(k, min(len(w), k + LOOKAHEAD)):
        x = w[d]
        if _prophet_at(w, d) or (d > k and comma[d - 1] == 2) or x in _NARRATIVE or x in _STORY: return 0
        if _mark(x) == 2 and x[0] != "ف" and x not in ("سمعت", "وسمعت", "سمعنا"): return d
        if x in _CONN: after_conn = True; continue
        if not (after_conn or x in _NAMEISH or x[:2] == "ال" or (x[0] == "و" and len(x) > 3) or x[0] == "ل" and x[1:3] == "اب"):
            plain += 1
            if plain > plain_max: return 0
        after_conn = False
    return 0

def matn_start(words, comma, first_quote=None):
    """Heuristic start of the matn. Returns (start, why): start == 0 means "no leading isnad recognised".
    The chain is the initial run of transmission words and names: MARK name MARK name ... and it ends
      * at قال/قالت/يقول that is not followed by another transmission word            -> matn starts after it
      * at أن/أنه/أنها that does not introduce another link ("أنه سمع"، "أن فلانا أخبره") -> matn starts after it
      * at the first mention of the Prophet ﷺ (the end of every chain): "عن النبي ﷺ قال" / "سمعت رسول الله ﷺ يقول"
        are consumed, any other wording is kept from its transmission word on
      * when a name runs longer than MAX_NAME words: after the comma that closes the name if there is one,
        otherwise before the last transmission word (that last link is kept rather than guessed at)."""
    w, n = words, len(words)
    i = 0
    last = 0                                   # position of the transmission word that opened the current link
    k = 1; cnt = 0; skip = False
    if n and _mark(w[0]): pass
    elif n and w[0] in _LEAD:                  # "وقال الليث حدثني يونس ..." / "وزاد إبراهيم بن طهمان عن الشيباني ..."
        j = next((d for d in range(1, min(n, 10)) if _mark(w[d]) == 2 or (w[d] == "عن" and (2 <= d <= 5 or w[d - 1] == "اسمع"))), None)
        if not j or any(_prophet_at(w, d) or w[d] in _AN or w[d] in _NARRATIVE for d in range(1, j)): return 0, "none"
        last = k = j
    else: return 0, "none"
    while k < n:
        x = w[k]
        h = _honorific(w, k)
        if h: k += h; continue
        if x == "ح" : k += 1; cnt = 0; continue                        # tahwil: a second chain starts
        pr = _prophet_at(w, k)
        if pr:
            if k > 0 and w[k - 1] in _EPITHET: k += pr; continue       # "زوج النبي ﷺ" belongs to the narrator's name
            if cnt == 0 or (cnt == 1 and w[k - 1] == "به"):            # the link itself names the Prophet
                e = k + pr
                if e < n and w[e] in _AN and e + 1 < n and w[e + 1] in _QAL: return e + 2, "prophet"
                if e < n and w[e] in _QAL: return e + 1, "prophet"
                return last, "prophet-kept"
            c = [j for j in range(last + 1, k) if comma[j]]             # "عن ابن عمر، كان رسول الله ﷺ ..."
            if c and c[0] - last <= 5 and c[0] + 1 == k and w[last] in ("عن", "وعن"): return c[0] + 1, "name-comma"
            return last, "prophet-kept"
        mk = _mark(x)
        if mk:
            if x in ("سمعت", "سمع", "وسمعت", "سمعنا") and k + 1 < n and w[k + 1] in _NOT_A_NARRATOR: return k, "heard-kept"
            if x in _ASK and w[last] in _HEARD: return last, "heard-kept"   # "عن صلاة رسول الله" after "سمعت أبي يسأل أبا برزة"
            last = k; k += 1; cnt = 0
            if x in _POST and k < n and not (w[k] in _AN or w[k] in _QAL or _mark(w[k]) or _honorific(w, k)):
                # "... أن ابن عباس أخبره <matn>" -- unless a name and another link follow ("عن أبيه حدثه أبو المنهال عن ...")
                if not (w[k] in _CONN and any(_mark(y) for y in w[k + 1:k + 5]) and not any(y in _STORY or y in _NARRATIVE for y in w[k:k + 5])):
                    return k, "post"
            continue
        if x in _QAL:
            nxt = w[k + 1:k + 3]
            if nxt and _mark(nxt[0]) == 2: k += 1; cnt = 0; continue                       # قال حدثنا / قال سمعت
            if nxt and nxt[0] in _QAL and len(nxt) > 1 and _mark(nxt[1]) == 2: k += 2; cnt = 0; continue   # قال قال حدثنا
            j = _resumes(w, comma, k + 1)
            if j: last = k = j; cnt = 0; continue                                          # قال يحيى أخبرنا وقال الآخران حدثنا فلان
            return k + 1, "qal"
        if x in _AN:
            nxt = w[k + 1] if k + 1 < n else ""
            if nxt == "كان" and k + 2 < n and _mark(w[k + 2]): k += 2; continue            # أنه كان يحدث
            if _mark(nxt) and nxt != "عن":
                if nxt in ("سمع", "سمعت") and k + 2 < n and w[k + 2] in _NOT_A_NARRATOR: return k + 1, "an"
                k += 1; continue                                                           # أنه سمع / أنه أخبره / أنه بلغه
            if nxt in _QAL and x != "ان":
                if k + 2 < n and _mark(w[k + 2]) == 2: k += 2; cnt = 0; continue           # أنه قال أخبرني فلان: the chain goes on
                return k + 2, "an-qal"                                                     # أنه قال
            j = next((d for d in range(k + 1, min(n, k + 2 + MAX_NAME)) if w[d] in _POST), None)
            if j and not any(_prophet_at(w, d) or w[d] in _QAL or w[d] in _AN for d in range(k + 1, j)):
                k = j; continue                                                            # أن فلانا أخبره
            return k + 1, "an"
        if x in _ASK and w[last] in _HEARD: return last, "heard-kept"   # "سمعت جابرا يُسأل عن ..." is the story, not a link
        if x in _STORY: return (k, "story") if cnt else (last, "heard-kept" if w[last] in _HEARD else "link-kept")
        if x in _CONN: skip = True; k += 1; continue
        if skip: skip = False
        else: cnt += 1
        nx = w[k + 1] if k + 1 < n else ""
        if nx[:1] == "و" and len(nx) > 2 and (comma[k] or nx[1:] in _CONN or (k + 2 < n and w[k + 2] == "بن")):
            cnt = 0                                                    # "حدثنا فلان، وفلان، وفلان" : a list of teachers
        if cnt > MAX_NAME:
            j = _resumes(w, comma, k, 4)
            if j: last = k = j; cnt = 0; continue
            c = [j for j in range(last + 1, k) if comma[j]]
            if c and c[0] - last <= 5 and not (w[c[0] + 1][:1] == "و" and len(w[c[0] + 1]) > 3): return c[0] + 1, "name-comma"
            return last, "link-kept"
        k += 1
    return last, "end"       # the whole text is a chain ("... بهذا الإسناد مثله")

_FILLER = set("عن ان انه النبي نبي رسول الله صلي عليه وسلم واله و سلم قال يقول الحديث فذكر وذكر يرفعه رفعه الي يبلغ به يرويه روايه".split())
_XREF = set("مثله بمثله نحوه بنحوه بمعناه ومثله ونحوه الاسناد اسناده باسناده نحو مثل بمثل بنحو".split())

def hadith_text(t):
    """-> (indexed normalised text, m, s, why): applies matn_start with the safety limits.
    m = 1: the leading chain was removed (or the text has none); m = 0: the full text is kept, and s (if not None)
    is the number of leading words the heuristic takes for the chain."""
    words, comma, fq = hadith_words(t)
    full = " ".join(words)
    start, why = matn_start(words, comma, fq)
    if fq is not None and start > fq: start, why = fq, "quote"      # never start later than the first quotation mark
    n = len(words)
    if start <= 0:
        # no leading chain recognised: matn/narrative as it stands, unless transmission words show up near the start
        m = 0 if any(_mark(x) == 2 for x in words[:25]) else 1
        return full, m, None, why
    # A cut is ANCHORED when independent evidence says the matn starts exactly there: it is the first quotation
    # mark, or a consumed "عن النبي ﷺ قال" / "سمعت رسول الله ﷺ يقول" formula, or the Prophet ﷺ (the top of every
    # chain) is first mentioned within the next three words. Only anchored cuts may exceed MAX_STRIP.
    anchored = why == "prophet" or start == fq or any(_prophet_at(words, k) for k in range(start, min(n, start + 3)))
    if n - start < MIN_KEEP or (start > MAX_STRIP * n and not anchored):
        return full, 0, start, why + "+limit"
    rest = words[start:]
    if len(rest) < MIN_WORDS_HADITH and (sum(x not in _FILLER for x in rest) < 2 or any(x in _XREF or "اسناد" in x or "معناه" in x for x in rest)):
        # "عن النبي ﷺ بمثله" / "... بهذا الإسناد": a chain plus a cross-reference, there is no matn to index on its own
        return full, 0, start, why + "+no-matn"
    # "... قال سمعت رسول الله ﷺ ينهى عن ..." / "حدثنا رسول الله ﷺ وهو الصادق المصدوق": the last link names the Prophet, so
    # it is the top of the chain and the text is kept from that word on
    top = why == "heard-kept" or (why == "prophet-kept" and _prophet_at(words, start + 1) > 0)
    if (_mark(words[start]) == 2 and not top) or words[start] == "ح":
        return full, 0, start, why + "+chain-left"       # what follows the cut is still a chain: keep all, flag it
    return " ".join(words[start:]), 1, None, why

# ---------- grades (copied from the dataset; translated only when the wording is unambiguous) ----------
SCHOLARS = {"Al-Albani": "الألباني", "Zubair Ali Zai": "زبير علي زئي", "Muhammad Muhyi Al-Din Abdul Hamid": "محمد محيي الدين عبد الحميد",
            "Shuaib Al Arnaut": "شعيب الأرناؤوط", "Ahmad Muhammad Shakir": "أحمد محمد شاكر", "Bashar Awad Maarouf": "بشار عواد معروف",
            "Abu Ghuddah": "عبد الفتاح أبو غدة", "Muhammad Fouad Abd al-Baqi": "محمد فؤاد عبد الباقي", "Salim al-Hilali": "سليم الهلالي"}
GRADES = {"sahih": "صحيح", "daif": "ضعيف", "hasan": "حسن", "hasan sahih": "حسن صحيح", "sahih agreed upon": "صحيح (متفق عليه)",
          "isnaad hasan": "إسناده حسن", "hasan isnaad": "إسناده حسن", "isnaad sahih": "إسناده صحيح", "sahih isnaad": "إسناده صحيح",
          "sahih muslim": "صحيح (في مسلم)", "sahih bukhari": "صحيح (في البخاري)", "sahih bukhari and muslim": "صحيح (في الصحيحين)",
          "sahih bukhari sahih muslim": "صحيح (في الصحيحين)", "sahih lighairihi": "صحيح لغيره", "hasan lighairihi": "حسن لغيره",
          "daif isnaad": "إسناده ضعيف", "sanad daif": "إسناده ضعيف", "very daif": "ضعيف جدًا", "very daif isnaad": "إسناده ضعيف جدًا",
          "mauquf sahih": "موقوف صحيح", "sahih muquf": "موقوف صحيح", "maqtu sahih": "مقطوع صحيح", "sahih maqtu": "مقطوع صحيح",
          "mauquf daif": "موقوف ضعيف", "daif muquf": "موقوف ضعيف", "maqtu daif": "مقطوع ضعيف", "daif maqtu": "مقطوع ضعيف",
          "mauquf hasan": "موقوف حسن", "maqtu hasan": "مقطوع حسن", "hasan maqtu": "مقطوع حسن", "shadh": "شاذ", "munkar": "منكر",
          "mawdu": "موضوع", "batil": "باطل", "sahih mutawatir": "صحيح متواتر", "sahih hadith": "صحيح", "maqtu": "مقطوع",
          "daif munkar": "ضعيف منكر", "munkar daif": "ضعيف منكر"}
def grade_ar(g: str) -> str:
    key = re.sub(r"\(\d+\)", " ", g)                 # drop cross-reference numbers like "(1023)"
    key = re.sub(r"[^a-z ]", " ", key.lower()); key = re.sub(r"\s+", " ", key).strip()
    return GRADES.get(key, g.strip())                 # unknown wording is kept exactly as in the dataset

# ---------- load ----------
def load_passages():
    passages = []   # (type, ref, norm_text, matn_flag, x, s)
    display = []    # quran display (diacritised)
    grades = {}     # hadith ref -> [(scholar, grade)] as recorded in the source dataset (NOT judged by this tool)
    info = {"missing": {}, "too_short": {}, "isnad": {}}   # what the dataset lacks, and what the isnad heuristic did
    q = json.load(open(RAW / "ara-quransimple.json", encoding="utf-8"))["quran"]
    BASMALA = "بسم الله الرحمن الرحيم"
    for x in q:
        text = x["text"]
        # the source file prepends the basmala to verse 1 of every surah; it is a verse only in al-Fatiha,
        # so it is detached elsewhere IN THE SEARCH INDEX ONLY; the displayed text below stays verbatim
        if x["verse"] == 1 and x["chapter"] != 1:
            w = text.split(" ")
            if norm(" ".join(w[:4])) == BASMALA and len(w) > 4: text = " ".join(w[4:])
        passages.append(("q", f"{x['chapter']}:{x['verse']}", norm(text), 1, None, None))
        display.append(x["text"])   # shown exactly as in the source (Tanzil terms: verbatim, no changes)
    for e in HADITH:
        st = collections.Counter(); removed = []
        for h in json.load(open(RAW / f"ara-{e}.json", encoding="utf-8"))["hadiths"]:
            num = h["hadithnumber"]
            full = norm(re.sub("[\u200e\u200f]", "", h["text"]))
            full_words = len(full.split())
            if full_words == 0: info["missing"].setdefault(e, []).append(num); continue      # number present, Arabic text empty upstream
            if full_words < MIN_WORDS_HADITH: info["too_short"].setdefault(e, []).append(num); continue
            # indexed text = the hadith after its leading chain of narrators (narrative, quoted speech and tail all kept)
            n, m, s, why = hadith_text(h["text"])
            assert n == full or full.endswith(" " + n), (e, num)   # only a prefix is ever removed
            cut = full_words - len(n.split())
            st["m1_isnad_removed" if cut else "m1_no_isnad_in_text" if m else "m0_chain_known" if s else "m0_undecided"] += 1
            if cut: removed.append(cut)
            ref = h.get("reference") or {}
            # x = [book, hadith-in-book, printed number]: sunnah.com addresses a hadith by book/in-book number, and the
            # number scholars cite (e.g. Muslim 2609) is "arabicnumber", not the dataset's running "hadithnumber"
            passages.append(("h", f"{e}:{num}", n, m, [ref.get("book", 0), ref.get("hadith", 0), str(h.get("arabicnumber", num))], s))
            gr = [(SCHOLARS.get(g["name"], g["name"]), grade_ar(g["grade"])) for g in h.get("grades", []) if g.get("grade", "").strip(" -")]
            if gr: grades[f"{e}:{num}"] = gr
        removed.sort()
        q = lambda f: removed[min(len(removed) - 1, int(f * len(removed)))] if removed else 0
        info["isnad"][e] = {**{k: st[k] for k in ("m1_isnad_removed", "m1_no_isnad_in_text", "m0_chain_known", "m0_undecided")},
                            "removed_words": {"total": sum(removed), "min": q(0), "p10": q(.1), "median": q(.5), "p90": q(.9), "max": q(1)}}
    return passages, display, grades, info

def build_index(passages, n):
    inv = collections.defaultdict(set)
    for pid, (_, _, txt, *_rest) in enumerate(passages):
        w = fold(txt).split()
        for k in range(len(w) - n + 1):
            inv[fnv1a(" ".join(w[k:k + n]))].add(pid)
    keys = sorted(k for k, v in inv.items() if len(v) <= MAX_DF)
    dropped = sum(1 for v in inv.values() if len(v) > MAX_DF)
    cnt = bytearray(); post = []
    for k in keys:
        ids = sorted(inv[k]); cnt.append(len(ids)); post.extend(ids)
    assert max(post) < 65536
    blob = bytearray(b"ATH1")
    blob += struct.pack("<II", len(keys), len(post))
    blob += struct.pack(f"<{len(keys)}I", *keys)
    blob += cnt
    blob += struct.pack(f"<{len(post)}H", *post)
    while len(blob) % 4: blob.append(0)
    return bytes(blob), len(keys), len(post), dropped

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    passages, display, grades, info = load_passages()
    assert len(passages) < 65536, "passage ids no longer fit in uint16"
    nq = sum(1 for p in passages if p[0] == "q")
    print(f"passages: {len(passages)} (quran {nq}, hadith {len(passages) - nq})")

    # shards of normalised text
    shards, cur, words = [], [], 0
    for pid, (t, r, n, m, x, s) in enumerate(passages):
        rec = {"t": t, "r": r, "n": n, "m": m}
        if x: rec["x"] = x
        if s: rec["s"] = s          # optional: with m = 0, the first s words of n are (probably) the chain of narrators
        cur.append(rec); words += len(n.split())
        if words >= SHARD_WORDS:
            shards.append(cur); cur, words = [], 0
    if cur: shards.append(cur)
    for old in OUT.glob("passages_*.json"): old.unlink()
    for i, s in enumerate(shards):
        (OUT / f"passages_{i}.json").write_text(json.dumps(s, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "quran_display.json").write_text(json.dumps(display, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # grades recorded in the source dataset, compacted
    sch = sorted({x for v in grades.values() for x, _ in v}); grd = sorted({y for v in grades.values() for _, y in v})
    si = {x: i for i, x in enumerate(sch)}; gi = {y: i for i, y in enumerate(grd)}
    (OUT / "grades.json").write_text(json.dumps({"scholars": sch, "grades": grd,
        "map": {k: [z for x, y in v for z in (si[x], gi[y])] for k, v in grades.items()}}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"grades: {len(grades)} hadith, {len(grd)} distinct grade strings")

    stats = {}
    for n in (2, 3):
        blob, nk, npost, dropped = build_index(passages, n)
        (OUT / f"idx{n}.bin").write_bytes(blob)
        stats[f"idx{n}"] = {"keys": nk, "postings": npost, "dropped_high_df": dropped, "bytes": len(blob),
                            "sha256": hashlib.sha256(blob).hexdigest()}
        print(f"idx{n}: keys={nk} postings={npost} dropped(df>{MAX_DF})={dropped} size={len(blob)/1e6:.1f} MB")

    vec = ["قال رسول الله", "إنما الأعمال بالنيات", "الحمد لله رب العالمين", "صدق وذكر"]
    (OUT / "hash_vectors.json").write_text(json.dumps(
        [{"in": v, "norm_fold": fold(norm(v)), "fnv1a": fnv1a(fold(norm(v)))} for v in vec], ensure_ascii=False, indent=1), encoding="utf-8")

    # provenance: SHA-256 of EVERY raw input (core, book packs, English packs and the two eval-only translations)
    raw_hashes = {p.relative_to(RAW).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in sorted(RAW.rglob("*")) if p.is_file() and not p.name.startswith(".")}
    # the same list as a file that `sha256sum -c` understands (run it inside data/raw): data/raw.sha256, or, when
    # building into a staging directory, <staging>/data/raw.sha256 (override with ATHAR_RAW_SHA)
    sha_file = pathlib.Path(os.environ["ATHAR_RAW_SHA"]) if os.environ.get("ATHAR_RAW_SHA") else \
        (OUT.parent.parent if os.environ.get("ATHAR_OUT") else ROOT) / "data" / "raw.sha256"
    sha_file.parent.mkdir(parents=True, exist_ok=True)
    sha_file.write_text("".join(f"{h}  {name}\n" for name, h in raw_hashes.items()), encoding="utf-8")
    for e in HADITH: print(f"  {e}: {info['isnad'][e]}  missing={len(info['missing'].get(e, []))}")
    words = sum(len(p[2].split()) for p in passages)
    meta = {
        "version": 1, "passages": len(passages), "quran_passages": nq, "hadith_passages": len(passages) - nq,
        "shards": len(shards), "min_words_hadith": MIN_WORDS_HADITH, "max_df": MAX_DF, "shingles": [2, 3],
        "hash": "fnv1a32-utf8", "index": stats, "raw_sha256": raw_hashes, "words": words,
        # hadith numbers that exist in the dataset with an EMPTY Arabic text (they cannot be found by this tool),
        # and numbers whose text is shorter than min_words_hadith (not indexed either)
        "missing": {e: {"count": len(v), "numbers": v} for e, v in sorted(info["missing"].items())},
        "too_short": {e: {"count": len(v), "numbers": v} for e, v in sorted(info["too_short"].items())},
        # what the isnad heuristic did (see matn_start in tools/build_index.py); passage field m: 1 = text is matn/narrative
        # (chain removed, or none in the text), 0 = full text kept (optional field s = words of leading chain)
        "isnad": {"max_strip": MAX_STRIP, "min_keep": MIN_KEEP, "collections": info["isnad"]},
        "link_templates": {  # UNVERIFIED until tested by a human in a browser (see docs/SOURCES_AND_LICENSES.md)
            "q": "https://quran.com/{surah}:{ayah}",
            "h": "https://sunnah.com/{collection}/{book}/{hadith_in_book}"
        },
        "collections": {"bukhari": "صحيح البخاري", "muslim": "صحيح مسلم", "abudawud": "سنن أبي داود",
                        "tirmidhi": "جامع الترمذي", "nasai": "سنن النسائي", "ibnmajah": "سنن ابن ماجه",
                        "malik": "موطأ مالك", "nawawi": "الأربعون النووية", "qudsi": "الأحاديث القدسية"},
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

if __name__ == "__main__":
    main()
