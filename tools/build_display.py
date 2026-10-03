#!/usr/bin/env python3
"""
build_display.py — DISPLAY text of the core hadith passages (original spelling and diacritics), for lazy loading.

The search index stores only normalised text (no diacritics, unified letters), which is right for matching and wrong
for showing or printing a hadith. This tool writes, next to the index, the ORIGINAL text of every core hadith passage
exactly as the dataset has it, plus the character offset at which the indexed text (what follows the leading chain of
narrators) begins, so the page can show the whole hadith or only its matn, and can map every indexed word to the
original word it came from.

Input : data/raw/ara-<collection>.json                     the dataset (read-only)
        <OUT>/meta.json, <OUT>/passages_<k>.json           the core index built by build_index.py (run it first)
Output: <OUT>/display/meta.json, <OUT>/display/h_<k>.json   OUT = public/data, or $ATHAR_OUT (same as build_index.py)

  h_<k>.json   {"k": k, "r": [ref, …], "t": [original text, …], "o": [matn offset, …], "x": [i, …]}
               parallel arrays for the hadith passages  k*K … k*K+K-1  (hadith index = passage id - meta.pid_base)
               t  the dataset's text, cleaned lightly: U+200E/200F/202A-202E/FEFF/FFFC removed, "<br>" and control
                  characters turned into a space, runs of whitespace collapsed; letters, diacritics, quotation marks
                  and punctuation are untouched
               o  JavaScript string index (UTF-16 code units) where the indexed text starts: norm(t[o:]) == passage.n
                  0 for passages indexed in full (m = 0, or no chain in the text)
               x  positions (within the shard) whose words do NOT map one-to-one onto the indexed words (two words
                  glued by punctuation, a damaged character upstream …): show the text, do not highlight per word
  meta.json    K, counts, statistics, the first reference of every shard (references are ordered, so the shard of a
               reference is found without a table), SHA-256 and size of every file, and the SHA-256 of the
               passages_*.json files this was built from (selfcheck.py refuses a display/ built from another index)

The mapping rule (also implemented in public/js/display.js and verified here for every passage):
  the pieces of t[o:] separated by a space, minus the pieces without an Arabic letter (pure punctuation),
  normalise one by one to exactly the words of passage.n.
"""
import json, re, sys, hashlib, pathlib, unicodedata
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from build_index import norm, DIAC, OUT, RAW, HADITH

MAX_BYTES = 2_500_000      # target size of one shard, uncompressed (the host's hard limit is 25 MiB)
K_STEP = 250               # K is the largest multiple of this that keeps every shard under MAX_BYTES
DISP = OUT / "display"

_STRAY = "[\u202a-\u202e\ufeff\ufffc]"
_LETTER = re.compile("[\u0621-\u063f\u0641-\u064a\u0671]")     # what norm() keeps as a letter (display.js: LETTER)
_OPEN = set("\"«“‘({[﴿")

def _tidy(t, repl):
    t = re.sub(r"<br\s*/?>", " ", t, flags=re.I)
    t = re.sub(_STRAY, repl, t)
    t = "".join(" " if unicodedata.category(c) == "Cc" else c for c in t)
    return re.sub(r"\s+", " ", t).strip()

def clean(raw):
    """-> (display text, same): light cleaning only; same = its normalisation is unchanged by the cleaning"""
    t = re.sub("[\u200e\u200f]", "", raw)                  # exactly what build_index.py removes before norm()
    base = norm(t)
    for repl in ("", " "):                                # a stray mark inside a word separates words in the index
        c = _tidy(t, repl)
        if norm(c) == base: return c, True
    return c, False

def word_starts(t):
    """character index of the start of every normalised word of t, and whether the word opens its space-separated piece"""
    out = []; pos = 0
    for piece in t.split(" "):
        first = True; inword = False
        for j, ch in enumerate(piece):
            if _LETTER.match(ch):
                if not inword:
                    out.append((pos if first else pos + j, first)); first = False; inword = True
            elif DIAC.match(ch): pass                      # a diacritic/tatweel: inside the word
            else: inword = False
        pos += len(piece) + 1
    return out

def matn_offset(t, n_words):
    """character index in t where the last n_words normalised words begin (0 when that is the whole text)"""
    ws = word_starts(t)
    cut = len(ws) - n_words
    if cut <= 0: return 0
    off, first = ws[cut]
    if first:
        # an opening quotation mark standing alone just before the matn belongs to it:  قال " إنما الأعمال …
        while off >= 2:
            b = t.rfind(" ", 0, off - 1) + 1; prev = t[b:off - 1]
            if not prev or any(c not in _OPEN for c in prev): break
            if '"' in prev and t.count('"', 0, b) % 2: break               # that one closes an earlier quotation
            off = b
    return off

def mapped_words(t, off):
    """the rule of display.js words(): pieces of t[off:] that contain a letter"""
    return [p for p in t[off:].split(" ") if _LETTER.search(p)]

u16 = lambda s: len(s.encode("utf-16-le")) // 2
dumps = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

def main():
    meta = json.load(open(OUT / "meta.json", encoding="utf-8"))
    core_sha = hashlib.sha256(); P = []
    for i in range(meta["shards"]):
        b = (OUT / f"passages_{i}.json").read_bytes(); core_sha.update(b); P += json.loads(b)
    base = meta["quran_passages"]
    H = P[base:]
    assert all(p["t"] == "q" for p in P[:base]) and all(p["t"] == "h" for p in H), "core: Qur'an passages must come first"
    raw = {}
    for e in HADITH:
        for h in json.load(open(RAW / f"ara-{e}.json", encoding="utf-8"))["hadiths"]:
            raw[f"{e}:{h['hadithnumber']}"] = h["text"]
    st = dict(passages=len(H), m1=0, m0=0, offset_exact=0, offset_fallback=0, matn_cut=0, words_exact=0, words_inexact=0,
              cleaning_changed_norm=0, damaged_upstream=0)
    R, T, O, X = [], [], [], []
    bad = []
    for p in H:
        if p["r"] not in raw: sys.exit(f"build_display: {p['r']} is indexed but not in data/raw (rebuild the index first)")
        t, same = clean(raw[p["r"]])
        st["cleaning_changed_norm"] += not same
        st["damaged_upstream"] += "\ufffd" in t
        st["m1" if p["m"] else "m0"] += 1
        nw = p["n"].split(" ")
        off = matn_offset(t, len(nw))
        if norm(t[off:]) != p["n"]:
            # residue: show the whole text (correct only if the whole text IS the indexed text; counted either way)
            bad.append(p["r"]); off = 0; st["offset_fallback"] += 1
        else: st["offset_exact"] += 1
        if p["m"] == 0 and off: sys.exit(f"build_display: {p['r']} has m = 0 but the indexed text is not the full text")
        st["matn_cut"] += off > 0
        exact = [norm(x) for x in mapped_words(t, off)] == nw
        st["words_exact" if exact else "words_inexact"] += 1
        R.append(p["r"]); T.append(t); O.append(u16(t[:off])); X.append(not exact)
    # ---- shards: K passages each, K = the largest multiple of K_STEP whose biggest file fits MAX_BYTES
    def shards(K):
        return [dumps({"k": a // K, "r": R[a:a + K], "t": T[a:a + K], "o": O[a:a + K],
                       "x": [i for i, x in enumerate(X[a:a + K]) if x]}) for a in range(0, len(R), K)]
    size = [len(dumps([r, t, o])) + 1 for r, t, o in zip(R, T, O)]         # bytes one passage adds to its file
    fits = lambda K: max(sum(size[a:a + K]) for a in range(0, len(R), K)) + 64 + 6 * sum(X) <= MAX_BYTES
    K = max(K_STEP, (len(R) // K_STEP + 1) * K_STEP)
    while K > K_STEP and not fits(K): K -= K_STEP
    files = shards(K)
    DISP.mkdir(parents=True, exist_ok=True)
    for old in DISP.glob("h_*.json"): old.unlink()
    info = {}
    for k, b in enumerate(files):
        (DISP / f"h_{k}.json").write_bytes(b)
        info[f"h_{k}.json"] = {"bytes": len(b), "sha256": hashlib.sha256(b).hexdigest(), "count": len(R[k * K:(k + 1) * K])}
    dmeta = {
        "version": 1, "kind": "hadith-display",
        "note": "original hadith text for display; h_<k>.json holds hadith passages k*K .. k*K+K-1, hadith index = passage id - pid_base",
        "K": K, "pid_base": base, "count": len(R), "shards": len(files),
        "collections": HADITH, "first": [R[k * K] for k in range(len(files))],
        "bytes": sum(len(b) for b in files), "max_file_bytes": max(len(b) for b in files),
        "stats": st, "offset_fallback_refs": bad[:200],
        "core_passages_sha256": core_sha.hexdigest(),
        "files": info,
    }
    (DISP / "meta.json").write_text(json.dumps(dmeta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"display: {len(R)} hadith passages -> {len(files)} files (K = {K}), {dmeta['bytes']:,} bytes, largest {dmeta['max_file_bytes']:,}")
    print(f"  offsets exact {st['offset_exact']}, fallback to 0: {st['offset_fallback']}; matn starts after a chain in {st['matn_cut']}")
    print(f"  word mapping exact {st['words_exact']}, not exact {st['words_inexact']} (text shown without per-word highlights)")
    print(f"  cleaning changed the normalisation: {st['cleaning_changed_norm']}; passages with U+FFFD upstream: {st['damaged_upstream']}")
    print(f"  -> {DISP}")

if __name__ == "__main__":
    main()
