#!/usr/bin/env python3
"""
train_vectors.py — dense retrieval index for quotations "by meaning".

No pretrained model is used: word vectors are trained HERE, on the corpus itself (word2vec skip-gram over
light stems), so the whole pipeline stays free, offline and inside the browser.

  word vector      : word2vec(stems), D dims, unit length, int8
  passage windows  : WIN stems, stride STRIDE (a long hadith or a book chunk gets several windows)
  window embedding : sum of SIF-weighted unit word vectors, first principal component removed, unit length, int8
  query (in JS)    : exactly the same recipe (public/js/vectors.js)

Input : the BUILT passages (core + every pack in packs.json) under public/data, or under $ATHAR_OUT if it is set.
        Run it after build_index.py / build_packs.py / build_packs_en.py: map_<pack>.bin holds passage ids, so the
        vectors are only valid for the passages they were computed from (tools/selfcheck.py verifies this).
Output: public/data/vec/{meta.json, vocab.json, wv.bin, sif.bin, pc.bin, pc_en.bin, vec_<pack>.bin, map_<pack>.bin}  (or $ATHAR_OUT/vec)
Requires: pip install gensim numpy.  Training is seeded but word2vec is not bit-reproducible across machines;
the shipped files are the ones the published evaluation used.
"""
import json, sys, pathlib, collections, hashlib
import numpy as np
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from build_index import norm, OUT

D, WIN, STRIDE, EPOCHS, MIN_COUNT, SIF_A = 64, 40, 20, 15, 4, 1e-3

def stem_en(w):   # identical to stemEn() in public/js/text.js
    s = w
    if len(s) > 4 and s.endswith("ies"): return s[:-3] + "y"
    if len(s) > 5 and s.endswith("sses"): return s[:-2]
    if len(s) > 5 and s.endswith("ing"): s = s[:-3]
    elif len(s) > 4 and s.endswith("ed"): s = s[:-2]
    elif len(s) > 5 and s.endswith("ly"): s = s[:-2]
    elif len(s) > 3 and s.endswith("s") and not s.endswith("ss") and not s.endswith("us"): s = s[:-1]
    if len(s) > 3 and s.endswith("e"): s = s[:-1]
    return s

def stem(w):   # must stay identical to stem() in public/js/text.js
    if w and (w[0].isascii() and (w[0].isalpha() or w[0].isdigit())): return stem_en(w)
    s, cut = w, False
    for p in ["وال", "بال", "كال", "فال", "لل", "ال"]:
        if s.startswith(p) and len(s) - len(p) >= 3: s = s[len(p):]; cut = True; break
    if not cut and len(s) >= 5 and s[0] in "وفبل":
        s = s[1:]
        if s.startswith("ال") and len(s) >= 5: s = s[2:]
    for x in ["هما", "كما", "هم", "هن", "كم", "نا", "ها", "ون", "ين", "ان", "ات", "وا", "يه", "ه", "ك", "ي", "ت", "ا"]:
        if s.endswith(x) and len(s) - len(x) >= 3: s = s[:-len(x)]; break
    if len(s) >= 4 and s[0] in "يتن": s = s[1:]
    return s

def load():
    packs = [("core", OUT, json.load(open(OUT / "meta.json"))["shards"])]
    for pk in json.load(open(OUT / "packs.json")):
        d = OUT / "packs" / pk["id"]; packs.append((pk["id"], d, json.load(open(d / "meta.json"))["shards"]))
    from build_packs_en import norm_en
    out = []
    for pid, d, shards in packs:
        P = []
        for i in range(shards): P += json.load(open(d / f"passages_{i}.json", encoding="utf-8"))
        out.append((pid, [[stem(w) for w in (p["n"] if "n" in p else norm_en(p["d"])).split()] for p in P]))
    return out

def main():
    from gensim.models import Word2Vec
    packs = load()
    sents = [t for _, T in packs for t in T]
    print(f"training on {len(sents):,} passages, {sum(map(len, sents)):,} stems")
    m = Word2Vec(sents, vector_size=D, window=6, min_count=MIN_COUNT, sg=1, negative=10, epochs=EPOCHS, sample=1e-4, seed=1, workers=4)
    vocab = list(m.wv.index_to_key); idx = {w: i for i, w in enumerate(vocab)}
    wv = m.wv.vectors / np.linalg.norm(m.wv.vectors, axis=1, keepdims=True)
    wv8 = np.clip(np.round(wv * 127), -127, 127).astype(np.int8)
    wvq = wv8.astype(np.float32) / 127.0                       # passages are embedded from the SAME quantised vectors the browser has
    cnt = collections.Counter(w for t in sents for w in t); tot = sum(cnt.values())
    sif = np.array([SIF_A / (SIF_A + cnt[w] / tot) for w in vocab], dtype=np.float32)

    def windows(T):
        vecs, owner = [], []
        for pid, t in enumerate(T):
            ids = [idx[w] for w in t if w in idx]
            if not ids: continue
            starts = range(0, max(1, len(t) - STRIDE), STRIDE) if len(t) > WIN else [0]
            for s in starts:
                ii = [idx[w] for w in t[s:s + WIN] if w in idx]
                if len(ii) < 2: continue
                vecs.append((wvq[ii] * sif[ii, None]).sum(0)); owner.append(pid)
        return np.array(vecs, dtype=np.float32), np.array(owner, dtype=np.uint16)

    raw = {pid: windows(T) for pid, T in packs}
    # common direction to remove: one per language (Arabic from the core, English from the English Qur'an pack)
    def common(V): return np.linalg.svd(V - V.mean(0), full_matrices=False)[2][0].astype(np.float32)
    pcs = {"ar": common(raw["core"][0])}
    if "en-quran" in raw: pcs["en"] = common(raw["en-quran"][0])
    lang = lambda pid: "en" if pid.startswith("en-") else "ar"
    out = OUT / "vec"; out.mkdir(exist_ok=True)
    for old in list(out.glob("vec_*.bin")) + list(out.glob("map_*.bin")): old.unlink()      # no stale files of removed packs
    files = {}
    def put(name, arr): b = arr.tobytes(); (out / name).write_bytes(b); files[name] = {"bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()}
    (out / "vocab.json").write_text(json.dumps(vocab, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    put("wv.bin", wv8); put("sif.bin", sif); put("pc.bin", pcs["ar"])
    if "en" in pcs: put("pc_en.bin", pcs["en"])
    for pid, (V, owner) in raw.items():
        pc = pcs.get(lang(pid), pcs["ar"])
        V = V - np.outer(V @ pc, pc); V /= (np.linalg.norm(V, axis=1, keepdims=True) + 1e-9)
        put(f"vec_{pid}.bin", np.clip(np.round(V * 127), -127, 127).astype(np.int8)); put(f"map_{pid}.bin", owner)
        print(f"{pid}: {len(owner):,} windows")
    (out / "meta.json").write_text(json.dumps({"dim": D, "win": WIN, "stride": STRIDE, "vocab": len(vocab), "epochs": EPOCHS,
        "min_count": MIN_COUNT, "sif_a": SIF_A, "model": "word2vec skip-gram on light stems, trained on this corpus", "files": files}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("vocab", len(vocab))

if __name__ == "__main__":
    main()
