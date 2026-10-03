#!/usr/bin/env python3
"""selfcheck.py — sanity-checks the *built* data: public/data, or the directory named by $ATHAR_OUT (a staging build).
  1. structure: counts, shards, index and vector files against the metadata that describes them (sizes, SHA-256,
     owner ids in range), every pack listed in packs.json, raw-input hashes, the Qur'an display text;
  2. retrieval: reads idx*.bin back and runs simulated-noise retrieval.
Exits with status 1 if a structural check fails.
NOTE: noise is SIMULATED (phonetic substitutions/deletions/insertions); it is not real ASR output."""
import json, struct, random, bisect, sys, pathlib, collections, hashlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from build_index import norm, fold, fnv1a, OUT, RAW, HADITH, _mark
random.seed(5)
print(f"checking {OUT}")
meta = json.load(open(OUT/"meta.json"))
P = []
for i in range(meta["shards"]): P += json.load(open(OUT/f"passages_{i}.json", encoding="utf-8"))

# ---------- 1. structure ----------
FAIL = []
def check(ok, msg):
    if not ok: FAIL.append(msg); print("  FAIL:", msg)
sha = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def check_index(d, m, label):
    for n in (2, 3):
        f = d / f"idx{n}.bin"; st = m["index"][f"idx{n}"]
        check(f.stat().st_size == st["bytes"] and sha(f) == st["sha256"], f"{label}: idx{n}.bin differs from its meta.json")
check(len(P) == meta["passages"] == meta["quran_passages"] + meta["hadith_passages"], "core: passage count differs from meta.json")
check(all(p["t"] == "q" for p in P[:meta["quran_passages"]]) and all(p["t"] == "h" for p in P[meta["quran_passages"]:]), "core: Qur'an passages must come first")
check(len({p["r"] for p in P}) == len(P), "core: duplicate references")
check_index(OUT, meta, "core")
disp = json.load(open(OUT/"quran_display.json", encoding="utf-8"))
qraw = json.load(open(RAW/"ara-quransimple.json", encoding="utf-8"))["quran"]
check(len(disp) == len(qraw) == 6236, "quran_display.json: not 6,236 verses")
H = [p for p in P if p["t"] == "h"]
check(all(p.get("m") in (0, 1) for p in H), "hadith: flag m missing")
check(all("s" not in p or p["m"] == 0 for p in H), "hadith: field s is only allowed with m = 0")
lead = sum(1 for p in H if p["m"] == 1 and _mark(p["n"].split()[0]) == 2 and p["n"].split()[0] not in ("سمعت", "وسمعت", "سمعنا"))
check(lead <= 0.005 * len(H), f"hadith: {lead} passages flagged m=1 still open with a transmission word")
check(min(len(p["n"].split()) for p in H) >= 4, "hadith: a passage shorter than 4 words")
if RAW.exists():
    have = {p.relative_to(RAW).as_posix() for p in RAW.rglob("*") if p.is_file() and not p.name.startswith(".")}
    check(set(meta.get("raw_sha256", {})) == have, "meta.json raw_sha256 does not list every raw input")
    missing = sum(v["count"] for v in meta.get("missing", {}).values())
    nraw = sum(len(json.load(open(RAW/f"ara-{e}.json", encoding="utf-8"))["hadiths"]) for e in HADITH)
    short = sum(v["count"] for v in meta.get("too_short", {}).values())
    check(nraw == len(H) + missing + short, f"hadith: raw {nraw} != indexed {len(H)} + empty upstream {missing} + too short {short}")
packs = json.load(open(OUT/"packs.json", encoding="utf-8")) if (OUT/"packs.json").exists() else []
counts = {"core": len(P)}
for pk in packs:
    d = OUT/"packs"/pk["id"]; m = json.load(open(d/"meta.json", encoding="utf-8"))
    Q = [x for i in range(m["shards"]) for x in json.load(open(d/f"passages_{i}.json", encoding="utf-8"))]
    counts[pk["id"]] = len(Q)
    check(len(Q) == m["passages"] == pk["passages"], f"{pk['id']}: passage count differs between files, meta.json and packs.json")
    check(len(Q) < 65536 and len({x["r"] for x in Q}) == len(Q), f"{pk['id']}: ids/references")
    check_index(d, m, pk["id"])
    if m.get("lang") != "en":
        check(not any("ms0" in x["h"] or "PageV" in x["h"] for x in Q), f"{pk['id']}: markup residue in headings")
        for k, has_pages in m.get("page_refs", {}).items():
            n0 = sum(1 for x in Q if x["r"].startswith(k + ":") and not x["p"]); nk = sum(1 for x in Q if x["r"].startswith(k + ":"))
            check(n0 == (0 if has_pages else nk), f"{pk['id']}/{k}: {n0} of {nk} passages without a page (page_refs = {has_pages})")
if (OUT/"vec"/"meta.json").exists():
    vm = json.load(open(OUT/"vec"/"meta.json")); D = vm["dim"]
    for name, st in vm["files"].items():
        f = OUT/"vec"/name
        check(f.exists() and f.stat().st_size == st["bytes"] and sha(f) == st["sha256"], f"vec/{name} differs from vec/meta.json")
    check((OUT/"vec"/"wv.bin").stat().st_size == vm["vocab"] * D == len(json.load(open(OUT/"vec"/"vocab.json", encoding="utf-8"))) * D, "vec: vocab x dim")
    for pid, n in counts.items():
        mp = OUT/"vec"/f"map_{pid}.bin"
        if not mp.exists(): check(False, f"vec: no vectors for {pid}"); continue
        own = struct.unpack(f"<{mp.stat().st_size // 2}H", mp.read_bytes())
        check(len(own) * D == (OUT/"vec"/f"vec_{pid}.bin").stat().st_size, f"vec_{pid}.bin: windows x dim")
        check(max(own) < n and list(own) == sorted(own), f"map_{pid}.bin: owner ids out of range for {n} passages (vectors are stale: rerun train_vectors.py)")
        check(len(set(own)) >= 0.97 * n, f"map_{pid}.bin: only {len(set(own))} of {n} passages have a vector")
else: print("  (no vec/ directory: vectors not checked)")
print(f"structure: core {len(P)} passages, {len(packs)} packs, " + ("OK" if not FAIL else f"{len(FAIL)} FAILED"))

# ---------- 2. retrieval ----------
def load(n):
    b = open(OUT/f"idx{n}.bin","rb").read(); assert b[:4]==b"ATH1"
    nk, npost = struct.unpack_from("<II", b, 4); o = 12
    keys = struct.unpack_from(f"<{nk}I", b, o); o += 4*nk
    cnt = b[o:o+nk]; o += nk
    post = struct.unpack_from(f"<{npost}H", b, o)
    offs = [0]
    for c in cnt: offs.append(offs[-1]+c)
    return keys, offs, post
IDX = {n: load(n) for n in (2,3)}
def lookup(n, h):
    keys, offs, post = IDX[n]; i = bisect.bisect_left(keys, h)
    if i < len(keys) and keys[i] == h: return post[offs[i]:offs[i+1]]
    return ()
def search(words, k=3):
    w = fold(" ".join(words)).split(); sc = collections.Counter()
    for n in (2,3):
        for i in range(len(w)-n+1):
            for d in lookup(n, fnv1a(" ".join(w[i:i+n]))): sc[d] += n
    return [d for d,_ in sc.most_common(k)]
CONF={'ص':'س','س':'ص','ذ':'ز','ز':'ذ','ض':'د','ظ':'ز','ط':'ت','ق':'ك','ث':'س','ه':'ا','ع':'ا','ح':'ه'}
def noisy(ws, wer):
    out=[]
    for w in ws:
        r=random.random()
        if r<wer/3: continue
        elif r<2*wer/3:
            cs=[i for i,c in enumerate(w) if c in CONF]
            if cs: i=random.choice(cs); w=w[:i]+CONF[w[i]]+w[i+1:]
            else: w=w[:-1] if len(w)>3 else w
            out.append(w)
        elif r<wer: out+=[w,random.choice(['ان','في','من','قال'])]
        else: out.append(w)
    return out
sample = random.sample(range(len(P)), 600)
for L in (8, 15):
    for wer in (0, .15, .30):
        ok=h1=h3=0
        for i in sample:
            ws=P[i]["n"].split()
            if len(ws)<L+1: continue
            s=random.randint(0,len(ws)-L); frag=ws[s:s+L]; q=noisy(frag,wer); top=search(q)
            good=lambda j:" ".join(frag) in P[j]["n"]
            ok+=1; h1+=bool(top) and good(top[0]); h3+=any(good(j) for j in top)
        print(f"frag={L:2d} simWER={int(wer*100):2d}%  top1={h1/ok:.2f} top3={h3/ok:.2f} (n={ok})")
if FAIL: sys.exit(1)
