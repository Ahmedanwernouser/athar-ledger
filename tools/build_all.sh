#!/usr/bin/env bash
# build_all.sh — rebuilds EVERYTHING the site loads from data/raw/, in the only order that is consistent:
#   1. build_index.py     core: Qur'an + nine hadith collections (passages, indices, grades, meta, data/raw.sha256)
#   2. build_display.py   display/: the hadith passages of step 1 in their original spelling, with diacritics (lazy-loaded)
#   3. build_packs.py     book packs (OpenITI texts + Jalalayn)
#   4. build_packs_en.py  English packs
#   5. train_vectors.py   dense vectors for the core and every pack   (needs: pip install gensim numpy; a few minutes)
#   6. selfcheck.py       verifies the result (structure, hashes, vector/passages consistency, simulated retrieval)
#
#   tools/build_all.sh                                    builds into public/data
#   ATHAR_OUT=/path/to/staging/public/data tools/build_all.sh   builds there instead, public/data is not touched
#   SKIP_VECTORS=1 tools/build_all.sh                     skips step 5 (selfcheck then reports stale/missing vectors)
#
# `npm run build:core` runs step 1 only (run build_display.py after it: display/ must match the passages). Raw inputs: tools/fetch_data.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONDONTWRITEBYTECODE=1          # no tools/__pycache__
[ -n "${ATHAR_OUT:-}" ] && export ATHAR_OUT && echo "output: $ATHAR_OUT" || echo "output: public/data"
[ -s data/raw/ara-quransimple.json ] || { echo "data/raw is empty: run tools/fetch_data.sh first" >&2; exit 1; }
echo "== 1/6 core index";      python3 tools/build_index.py
echo "== 2/6 hadith display";  python3 tools/build_display.py
echo "== 3/6 book packs";      python3 tools/build_packs.py
echo "== 4/6 English packs";   python3 tools/build_packs_en.py
if [ -z "${SKIP_VECTORS:-}" ]; then echo "== 5/6 vectors"; python3 tools/train_vectors.py; else echo "== 5/6 vectors SKIPPED"; fi
echo "== 6/6 selfcheck";       python3 tools/selfcheck.py
echo "done."
