#!/usr/bin/env python3
"""
build_packs.py — builds the optional BOOK PACKS (loaded on demand by the site, one folder per pack).

Input : data/raw/books/*.txt (OpenITI mARkdown) and jalalayn.json   (see tools/fetch_data.sh)
Output: public/data/packs/<pack>/{meta.json, passages_<k>.json, idx2.bin, idx3.bin}  and  public/data/packs.json
        (or under $ATHAR_OUT instead of public/data, e.g. ATHAR_OUT=/some/staging/public/data)

Chunking: a book is cut at its own paragraph and heading boundaries into passages of at most CHUNK words;
a paragraph longer than that becomes overlapping windows (OVERLAP words) so a quotation that straddles a cut
is still found whole. Every passage keeps its chapter heading and the volume and page of its first word; a book whose
page markers are unusable in the source (Bulugh al-Maram) gets no page (v = p = 0) and is cited by heading only.
Not indexed: the Shamela catalogue card at the top of a file, the edition's table of contents (heading الفهارس),
the editor's bracketed outline blocks, and OpenITI milestone tags (msNNNN).
"""
import json, re, hashlib, sys, pathlib, collections
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from build_index import norm, build_index, ROOT, OUT, SHARD_WORDS

BOOKS = ROOT / "data" / "raw" / "books"
CHUNK, OVERLAP, MIN_WORDS = 110, 20, 8

PACKS = {
    "hadith2": {"title": "حديث: رياض الصالحين وبلوغ المرام", "domain": "hadith", "domain_ar": "حديث", "books": {
        "riyad": ["رياض الصالحين", "النووي (ت ٦٧٦هـ)"], "bulugh": ["بلوغ المرام من أدلة الأحكام", "ابن حجر العسقلاني (ت ٨٥٢هـ)"]}},
    "tafsir": {"title": "تفسير: ابن كثير والجلالين", "domain": "tafsir", "domain_ar": "تفسير", "books": {
        "ibnkathir": ["تفسير القرآن العظيم", "ابن كثير (ت ٧٧٤هـ)"], "jalalayn": ["تفسير الجلالين", "المحلي (ت ٨٦٤هـ) والسيوطي (ت ٩١١هـ)"]}},
    "fiqh": {"title": "فقه: بداية المجتهد وعمدة الفقه", "domain": "fiqh", "domain_ar": "فقه", "books": {
        "bidaya": ["بداية المجتهد ونهاية المقتصد", "ابن رشد الحفيد (ت ٥٩٥هـ)"], "umda": ["عمدة الفقه", "ابن قدامة المقدسي (ت ٦٢٠هـ)"]}},
    "seerah": {"title": "سيرة: سيرة ابن هشام وزاد المعاد", "domain": "seerah", "domain_ar": "سيرة", "books": {
        "ibnhisham": ["السيرة النبوية", "ابن هشام (ت ٢١٣هـ)"], "zadmaad": ["زاد المعاد في هدي خير العباد", "ابن قيم الجوزية (ت ٧٥١هـ)"]}},
    "aqeedah": {"title": "عقيدة: الطحاوية والواسطية", "domain": "aqeedah", "domain_ar": "عقيدة", "books": {
        "tahawiyya": ["متن العقيدة الطحاوية", "الطحاوي (ت ٣٢١هـ)"], "wasitiyya": ["العقيدة الواسطية", "ابن تيمية (ت ٧٢٨هـ)"]}},
    # Books about weak and fabricated hadith. The site searches this pack for EVERY hadith, next to the ordinary collections,
    # and reports the two answers separately. Each passage may carry "g": the words of the book itself around its own verdict.
    "daif": {"title": "ضعيف وموضوع: الموضوعات واللآلئ والفوائد والمقاصد وكشف الخفاء", "domain": "hadith-weak", "domain_ar": "ضعيف وموضوع", "weak": True, "books": {
        "mawduat": ["الموضوعات", "ابن الجوزي (ت ٥٩٧هـ)"], "laali": ["اللآلئ المصنوعة في الأحاديث الموضوعة", "السيوطي (ت ٩١١هـ)"],
        "fawaid": ["الفوائد المجموعة في الأحاديث الموضوعة", "الشوكاني (ت ١٢٥٠هـ)"], "maqasid": ["المقاصد الحسنة", "السخاوي (ت ٩٠٢هـ)"],
        "kashf": ["كشف الخفاء ومزيل الإلباس", "العجلوني (ت ١١٦٢هـ)"]}},
}

PAGE = re.compile(r"PageV(\d+)P(\d+)")
MS = re.compile(r"ms\d+")                     # OpenITI milestone tags ("ms0190"): never part of the text
HAS_AR = re.compile("[ء-ي]{2,}")
# Editorial matter that is not the author's text and must not be cited as his:
CARD = re.compile(r"^\s*(?:الكتاب|المؤلف|المحقق|الناشر|الطبعة|عدد الصفحات|عدد الأجزاء|مصدر الكتاب|تاريخ النشر)\s*:|^\s*\[(?:الكتاب|ترقيم)")
CARD_LINES = 40                               # the Shamela catalogue card can only be at the very top of a file
TOC = re.compile("فهرس|الفهارس")              # a heading that opens the edition's table of contents
# Bulugh al-Maram: the source numbers every hadith in a heading line ("### | 5 -"), tags pieces of hadith TEXT as
# headings ("### | : «إذا كان الماء قلتين") and has almost no usable page markers. For such a book the tagged pieces
# are read as text again, and a passage is cited by chapter heading + the number of the hadith its first word is in.
NUMBERED = {"bulugh"}
NUM_HEAD = re.compile(r"(?:\d+\s*/\s*)?(\d+)\s*-?")
PAGE_NOTE = re.compile(r"\[ص:\s*\d+\]")
OUTLINE_MAX = 12                              # longest editor's outline block ("### | [الباب الأول:" ... "...]") dropped

def parse_openiti(path, dropped=None, numbered=False):
    """-> (paragraphs, pages_usable). paragraph: {"words": [normalised words], "pg": [(vol, page) per word], "h": heading}
    Page markers (PageVxxPyyy) are read wherever they occur, on every kind of line; a line that begins with a marker
    or carries no mARkdown prefix is a continuation of the running paragraph (its words are kept).
    dropped: Counter that receives the number of words left out, per reason (card / toc / outline)."""
    lines = [l for l in path.read_text(encoding="utf-8").split("#META#Header#End#")[-1].splitlines() if l.strip()]
    segs = []          # ("text", str, heading, starts_paragraph, hadith number) | ("page", vol, page)
    heading = ""; skip = None; in_toc = False; outline_end = -1; num = 0
    def emit(body, start, why):
        pos = 0
        for m in PAGE.finditer(body):
            t = body[pos:m.start()]
            if t.strip(): 
                if why: dropped[why] += len(norm(MS.sub(" ", t)).split())
                else: segs.append(("text", t, heading, start, num)); start = False
            segs.append(("page", int(m.group(1)), int(m.group(2)))); pos = m.end()
        t = body[pos:]
        if t.strip():
            if why: dropped[why] += len(norm(MS.sub(" ", t)).split())
            else: segs.append(("text", t, heading, start, num))
    if dropped is None: dropped = collections.Counter()
    for i, line in enumerate(lines):
        if line.startswith("### "):
            skip = None
            for m in PAGE.finditer(line): segs.append(("page", int(m.group(1)), int(m.group(2))))
            text = " ".join(MS.sub(" ", PAGE.sub(" ", line.lstrip("#| "))).split())
            if numbered:
                if PAGE_NOTE.fullmatch(text): continue
                m = NUM_HEAD.fullmatch(text)
                if m: num = int(m.group(1)); continue
                if "«" in text or "»" in text or text[:1] in ":-":        # a piece of the hadith, not a heading
                    dropped["recovered_from_heading_lines"] -= len(norm(text).split())   # negative = words gained
                    emit(text, False, None); continue
            in_toc = bool(TOC.search(norm(text))) or (in_toc and not HAS_AR.search(text))
            if text.count("[") > text.count("]"):
                # the editor's outline: a heading that opens a bracket closed a few body lines further down
                j = next((k for k in range(i + 1, min(len(lines), i + 1 + OUTLINE_MAX)) if "]" in lines[k] or lines[k].startswith("### ")), None)
                if j is not None and not lines[j].startswith("### "):
                    outline_end = j
                    first = " ".join(MS.sub(" ", PAGE.sub(" ", lines[i + 1].lstrip("#~ "))).split())
                    if len(norm(text + " " + first).split()) <= 14: text = (text + " " + first)
                text = text.replace("[", "").replace("]", "").strip()
            h = norm(text)
            if h and len(h.split()) <= 14 and HAS_AR.search(h): heading = text
            continue
        if line.startswith("# "): body, start = line[2:], True
        elif line.startswith("~~"): body, start = line[2:], False
        else: body, start = line, False          # "PageV01P027" on its own line, or a bare continuation line
        if start: skip = "card" if (i < CARD_LINES and CARD.search(body)) else None
        why = "toc" if in_toc else "outline" if i <= outline_end else skip
        emit(body, start, why)
    # a page marker closes its page: text takes the page of the NEXT marker (the first valid one)
    marks = [s for s in segs if s[0] == "page"]
    valid = [s for s in marks if s[2] > 0]
    usable = len(valid) >= 2 and len(valid) >= 0.5 * len(marks)     # Bulugh al-Maram: 11 of 1,521 markers are real -> no pages
    nxt = (0, 0); pages = [None] * len(segs)
    for i in range(len(segs) - 1, -1, -1):
        if segs[i][0] == "page":
            if segs[i][2] > 0: nxt = (segs[i][1], segs[i][2])
        else: pages[i] = nxt if usable else (0, 0)
    paras = []
    for i, s in enumerate(segs):
        if s[0] != "text": continue
        w = norm(MS.sub(" ", s[1])).split()
        if not w: continue
        # the printed form of every normalised word (norm() works letter by letter, so word by word gives the same words):
        # used only to quote a book in its own spelling; a printed word that yields two normalised words is carried by the first
        o = []
        for tok in MS.sub(" ", s[1]).split():
            k = len(norm(tok).split())
            if k: o += [tok] + [""] * (k - 1)
        assert len(o) == len(w)
        if s[3] or not paras or paras[-1]["h"] != s[2]:
            paras.append({"words": w, "orig": o, "pg": [pages[i]] * len(w), "h": s[2], "num": s[4]})
        else: paras[-1]["words"] += w; paras[-1]["orig"] += o; paras[-1]["pg"] += [pages[i]] * len(w)
    return paras, usable

def chunk(paras, key):
    """passages of at most CHUNK words; each one is cited by the page on which its FIRST word is printed"""
    out, buf = [], None
    def flush():
        nonlocal buf
        if buf and len(buf["words"]) >= MIN_WORDS: out.append(buf)
        elif buf and out and out[-1]["h"] == buf["h"]: out[-1]["words"] += buf["words"]; out[-1]["orig"] += buf["orig"]; out[-1]["num2"] = buf["num2"]
        buf = None
    for p in paras:
        w = p["words"]
        if len(w) > CHUNK:
            flush()
            for s in range(0, len(w), CHUNK - OVERLAP):
                piece = w[s:s + CHUNK]
                if len(piece) >= MIN_WORDS or s == 0: out.append({"h": p["h"], "num": p["num"], "num2": p["num"], "at": p["pg"][s], "words": piece, "orig": p["orig"][s:s + CHUNK]})
                if s + CHUNK >= len(w): break
            continue
        if buf and (buf["h"] != p["h"] or len(buf["words"]) + len(w) > CHUNK): flush()
        if buf is None: buf = {"h": p["h"], "num": p["num"], "num2": p["num"], "at": p["pg"][0], "words": list(w), "orig": list(p["orig"])}
        else: buf["words"] += w; buf["orig"] += p["orig"]; buf["num2"] = p["num"]
    flush()
    def head(c):      # numbered books: "باب المياه — حديث 5" / "باب المياه — الأحاديث 1–4"
        if not c["num"]: return c["h"][:80]
        return c["h"][:80] + (f" — حديث {c['num']}" if c["num2"] <= c["num"] else f" — الأحاديث {c['num']}–{c['num2']}")
    return [{"t": "b", "r": f"{key}:{i + 1}", "n": " ".join(c["words"]), "h": head(c), "v": c["at"][0], "p": c["at"][1], "_o": c["orig"]}
            for i, c in enumerate(out) if len(c["words"]) >= MIN_WORDS]

# The book's own words about a hadith's rank, copied from its text (never worded by this tool): the phrase, with a few words round it.
VERDICTS = [r"هذا حديث (?:لا يصح|موضوع|باطل|ضعيف|منكر|لا اصل له)", r"حديث موضوع", r"ليس بحديث", r"(?:لا|ليس له) اصل(?: له)?", r"موضوع[هة]?", r"مكذوب[هة]?", r"مختلق[هة]?",
            r"(?:لا|لم) يصح", r"(?:لا|لم) يثبت", r"باطل[هة]?", r"ضعيف[هة]? جدا", r"(?:اسناده|سنده|بسند|باسناد) (?:ضعيف|واه)", r"ضعيف[هة]?", r"واهي?[هة]?", r"معلول[هة]?", r"منكر[هة]?",
            r"لم (?:اقف عليه|اجده|اره)", r"لا اعرفه", r"كذاب", r"وضاع", r"متروك"]
VERDICT_RE = [re.compile(r"(?<![ء-ي])(?:" + v + r")(?![ء-ي])") for v in VERDICTS]      # whole words only ("ضعيفان" is not "ضعيف")
def verdict(words, orig, before=7, after=11):
    """-> the book's words round its verdict, in the book's own spelling (the printed words, not the search form)"""
    s = " ".join(words)
    for rx in VERDICT_RE:
        m = rx.search(s)
        if m:
            k = len(s[:m.start()].split()); j = k + len(m.group(0).split())
            a, b = max(0, k - before), min(len(words), j + after)
            while a > 0 and not orig[a]: a -= 1            # never start inside a printed word
            return " ".join(t for t in orig[a:b] if t).strip(" ،؛:.-\"'()[]«»")
    return ""

def add_verdicts(part):
    """g = the book's own verdict wording in this passage; failing that, in the passage that follows it (an entry is cut into passages)"""
    for i, x in enumerate(part):
        w = x["n"].split(); g = verdict(w, x["_o"])
        if not g and i + 1 < len(part) and part[i + 1]["r"].split(":")[0] == x["r"].split(":")[0]: g = verdict(part[i + 1]["n"].split()[:50], part[i + 1]["_o"][:50])
        if g: x["g"] = g

def jalalayn():
    out = []
    for x in json.load(open(BOOKS / "jalalayn.json", encoding="utf-8"))["quran"]:
        n = norm(x["text"])
        if len(n.split()) >= 4: out.append({"t": "b", "r": f"jalalayn:{x['chapter']}:{x['verse']}", "n": n, "h": "", "v": 0, "p": 0})
    return out

def main():
    manifest = []
    for pid, cfg in PACKS.items():
        P = []; page_refs = {}; dropped = {}
        for key in cfg["books"]:
            if key == "jalalayn": part = jalalayn()
            else:
                drop = collections.Counter()
                paras, usable = parse_openiti(BOOKS / f"{key}.txt", drop, key in NUMBERED)
                part = chunk(paras, key)
                if cfg.get("weak"): add_verdicts(part)
                for x in part: x.pop("_o", None)
                page_refs[key] = usable; dropped[key] = {k: drop[k] for k in sorted(drop)}
            print(f"  {key}: {len(part)} passages, {sum(len(x['n'].split()) for x in part):,} words"
                  + ("" if key == "jalalayn" else f", pages {'yes' if page_refs[key] else 'NO (cited by heading)'}, distinct pages {len({(x['v'], x['p']) for x in part})}, left out {dropped[key]}"))
            P += part
        assert len(P) < 65536, f"{pid}: too many passages for uint16 ids"
        d = OUT / "packs" / pid; d.mkdir(parents=True, exist_ok=True)
        for old in d.glob("passages_*.json"): old.unlink()
        shards, cur, words = [], [], 0
        for x in P:
            cur.append(x); words += len(x["n"].split())
            if words >= SHARD_WORDS: shards.append(cur); cur, words = [], 0
        if cur: shards.append(cur)
        size = 0
        for i, s in enumerate(shards):
            b = json.dumps(s, ensure_ascii=False, separators=(",", ":")).encode("utf-8"); (d / f"passages_{i}.json").write_bytes(b); size += len(b)
        stats = {}
        tuples = [(x["t"], x["r"], x["n"], 1) for x in P]
        for n in (2, 3):
            blob, nk, npost, dropped = build_index(tuples, n)
            (d / f"idx{n}.bin").write_bytes(blob); size += len(blob)
            stats[f"idx{n}"] = {"keys": nk, "postings": npost, "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()}
        meta = {"id": pid, "title": cfg["title"], "domain": cfg["domain"], "domain_ar": cfg["domain_ar"], "weak": bool(cfg.get("weak")),
                "books": {k: {"title": v[0], "author": v[1]} for k, v in cfg["books"].items()},
                "passages": len(P), "words": sum(len(x["n"].split()) for x in P), "shards": len(shards), "bytes": size,
                "chunk_words": CHUNK, "overlap_words": OVERLAP, "index": stats,
                # per book: are page references available, and how many words of editorial matter were left out
                "page_refs": page_refs, "editorial_words_left_out": dropped}
        (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        manifest.append({k: meta[k] for k in ("id", "title", "domain", "domain_ar", "weak", "books", "passages", "words", "bytes")})
        print(f"{pid}: {len(P)} passages, {meta['words']:,} words, {size / 1e6:.1f} MB")
    try: manifest += [m for m in json.load(open(OUT / "packs.json", encoding="utf-8")) if m["id"].startswith("en-")]   # keep the English packs' entries
    except FileNotFoundError: pass
    (OUT / "packs.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

if __name__ == "__main__":
    main()
