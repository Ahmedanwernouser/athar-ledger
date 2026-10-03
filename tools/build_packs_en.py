#!/usr/bin/env python3
"""
build_packs_en.py — ENGLISH packs: published translations of the Qur'an and of the nine hadith collections,
keyed to the SAME references as the Arabic core, so a quotation read in English resolves to the Arabic source.

Input : data/raw/en/eng-*.json (hadith-api English editions), q-*.json (quran-api English translations)
Output: public/data/packs/en-quran/ , public/data/packs/en-hadith/   and their entries in public/data/packs.json
        (or under $ATHAR_OUT instead of public/data; run after build_packs.py, which writes the book packs' entries)

Passages keep the ORIGINAL text ("d", shown to the user as the translation); the normalised form used for
matching is derived from it identically here (norm_en) and in the browser (normEn in public/js/text.js).
"""
import json, re, hashlib, sys, pathlib, unicodedata
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from build_index import build_index, ROOT, OUT, SHARD_WORDS

RAW = ROOT / "data" / "raw" / "en"
QURAN = {  # edition id -> shown name. The first one is the translation displayed under Arabic matches.
    "ummmuhammad": "Saheeh International", "muhammadtaqiudd": "Hilali & Khan", "abdullahyusufal": "Yusuf Ali",
    "mohammedmarmadu": "Pickthall", "mustafakhattaba": "Mustafa Khattab (The Clear Quran)"}
HADITH = ["bukhari", "muslim", "abudawud", "tirmidhi", "nasai", "ibnmajah", "malik", "nawawi", "qudsi"]

def norm_en(s: str) -> str:   # must stay identical to normEn() in public/js/text.js
    s = unicodedata.normalize("NFKD", s)
    s = re.sub("[̀-ͯ]", "", s).lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

def write_pack(pid, title, domain_ar, P, extra):
    assert len(P) < 65536, f"{pid}: too many passages"
    d = OUT / "packs" / pid; d.mkdir(parents=True, exist_ok=True)
    for old in d.glob("passages_*.json"): old.unlink()
    shards, cur, words = [], [], 0
    for x in P:
        cur.append(x); words += len(x["d"].split())
        if words >= SHARD_WORDS: shards.append(cur); cur, words = [], 0
    if cur: shards.append(cur)
    size = 0
    for i, s in enumerate(shards):
        b = json.dumps(s, ensure_ascii=False, separators=(",", ":")).encode("utf-8"); (d / f"passages_{i}.json").write_bytes(b); size += len(b)
    stats = {}
    tuples = [("e", x["r"], norm_en(x["d"]), 1) for x in P]
    for n in (2, 3):
        blob, nk, npost, dropped = build_index(tuples, n)
        (d / f"idx{n}.bin").write_bytes(blob); size += len(blob)
        stats[f"idx{n}"] = {"keys": nk, "postings": npost, "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()}
    nwords = sum(len(t[2].split()) for t in tuples)
    meta = {"id": pid, "title": title, "domain": "english", "domain_ar": domain_ar, "lang": "en", "books": {}, "passages": len(P),
            "words": nwords, "shards": len(shards), "bytes": size, "index": stats, **extra}
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{pid}: {len(P)} passages, {nwords:,} words, {size / 1e6:.1f} MB")
    return {k: meta[k] for k in ("id", "title", "domain", "domain_ar", "lang", "books", "passages", "words", "bytes")}

def main():
    out = []
    P = []
    for ed in QURAN:   # each translation is stored contiguously in ayah order, so neighbouring ayahs are neighbouring ids
        for x in json.load(open(RAW / f"q-{ed}.json", encoding="utf-8"))["quran"]:
            P.append({"t": "e", "r": f"enq:{ed}:{x['chapter']}:{x['verse']}", "d": x["text"].strip() or "-"})
    out.append(write_pack("en-quran", "English: 5 translations of the Qur'an", "ترجمات القرآن بالإنجليزية", P, {"editions": QURAN}))
    P = []
    for col in HADITH:
        for h in json.load(open(RAW / f"eng-{col}.json", encoding="utf-8"))["hadiths"]:
            t = h["text"].strip()
            if len(norm_en(t).split()) >= 8: P.append({"t": "e", "r": f"en:{col}:{h['hadithnumber']}", "d": t})
    out.append(write_pack("en-hadith", "English: the nine hadith collections", "ترجمة كتب الحديث بالإنجليزية", P, {}))
    man = [m for m in json.load(open(OUT / "packs.json", encoding="utf-8")) if not m["id"].startswith("en-")] + out
    (OUT / "packs.json").write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")

if __name__ == "__main__":
    main()
