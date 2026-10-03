#!/usr/bin/env bash
# build_all.sh — rebuilds EVERYTHING the site loads from data/raw/, in the only order that is consistent:
#   1. build_index.py     core: Qur'an + nine hadith collections (passages, indices, grades, meta, data/raw.sha256)
#   2. build_packs.py     book packs (OpenITI texts + Jalalayn)
#   3. build_packs_en.py  English packs
#   4. train_vectors.py   dense vectors for the core and every pack   (needs: pip install gensim numpy; a few minutes)
#   5. selfcheck.py       verifies the result (structure, hashes, vector/passages consistency, simulated retrieval)
#
#   tools/build_all.sh                                    builds into public/data
#   ATHAR_OUT=/path/to/staging/public/data tools/build_all.sh   builds there instead, public/data is not touched
#   SKIP_VECTORS=1 tools/build_all.sh                     skips step 4 (selfcheck then reports stale/missing vectors)
#
# `npm run build` runs step 1 only. Raw inputs: tools/fetch_data.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONDONTWRITEBYTECODE=1          # no tools/__pycache__
[ -n "${ATHAR_OUT:-}" ] && export ATHAR_OUT && echo "output: $ATHAR_OUT" || echo "output: public/data"
[ -s data/raw/ara-quransimple.json ] || { echo "data/raw is empty: run tools/fetch_data.sh first" >&2; exit 1; }
echo "== 1/5 core index";      python3 tools/build_index.py
echo "== 2/5 book packs";      python3 tools/build_packs.py
echo "== 3/5 English packs";   python3 tools/build_packs_en.py
if [ -z "${SKIP_VECTORS:-}" ]; then echo "== 4/5 vectors"; python3 tools/train_vectors.py; else echo "== 4/5 vectors SKIPPED"; fi
echo "== 5/5 selfcheck";       python3 tools/selfcheck.py
echo "done."
