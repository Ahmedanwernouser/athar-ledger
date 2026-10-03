#!/usr/bin/env bash
# Downloads the raw corpora (not committed to git: see .gitignore), verifies them and writes data/raw.sha256
# (SHA-256 of EVERY raw input: ara-*.json, books/*, en/*).
#
# Every download is pinned to an immutable commit, not to a branch. The commits below are the heads of the upstream
# branches ("1" for fawazahmed0/*, "master" for OpenITI/*) on 2026-10-02; all 36 files fetched at these commits were
# checked to be byte-identical to the files this project was built from.
# Sources: fawazahmed0/hadith-api and fawazahmed0/quran-api (Unlicense wrapper repos), OpenITI (CC BY-NC-SA 4.0).
set -euo pipefail
cd "$(dirname "$0")/../data"
mkdir -p raw && cd raw
HADITH_API=df57907be35291c91ad6a6691180e22ca9920784     # fawazahmed0/hadith-api, branch 1
QURAN_API=47ca096b0976443ba2eab2e45cdf0fb4096a2610      # fawazahmed0/quran-api,  branch 1
H=https://raw.githubusercontent.com/fawazahmed0/hadith-api/$HADITH_API/editions
Q=https://raw.githubusercontent.com/fawazahmed0/quran-api/$QURAN_API/editions
for e in bukhari muslim abudawud tirmidhi nasai ibnmajah malik nawawi qudsi; do
  [ -s ara-$e.json ] || curl -fsSL "$H/ara-$e.json" -o ara-$e.json
done
[ -s ara-quransimple.json ] || curl -fsSL "$Q/ara-quransimple.json" -o ara-quransimple.json
# ---- book packs: OpenITI mARkdown texts (digitised from al-Maktaba al-Shamela) + Jalalayn from quran-api ----
mkdir -p books && cd books
O=https://raw.githubusercontent.com/OpenITI
get(){ [ -s "$4" ] || curl -fsSL "$O/$1/$2/data/$3" -o "$4"; }      # repo, commit, path, local name
get 0775AH 61b0c7891699554aeff8dffdb8b1a2a59d2d22ab 0774IbnKathir/0774IbnKathir.TafsirQuran/0774IbnKathir.TafsirQuran.Shamela0008473-ara1.mARkdown ibnkathir.txt
get 0225AH 2cfdc8cf1b89abfd15463d1c429fbb822aa5d9a5 0213IbnHisham/0213IbnHisham.SiraNabawiyya/0213IbnHisham.SiraNabawiyya.Shamela0007450-ara1 ibnhisham.txt
get 0775AH 61b0c7891699554aeff8dffdb8b1a2a59d2d22ab 0751IbnQayyimJawziyya/0751IbnQayyimJawziyya.ZadMacad/0751IbnQayyimJawziyya.ZadMacad.Shamela0021713-ara1 zadmaad.txt
get 0600AH ea4bdc6517a49d07106f223aa0869aa7c21b9589 0595IbnRushdHafid/0595IbnRushdHafid.BidayatMujtahid/0595IbnRushdHafid.BidayatMujtahid.Shamela0021739-ara1 bidaya.txt
get 0625AH f1e38210b32fd0d043949ff6471e869d658c3b16 0620IbnQudamaMaqdisi/0620IbnQudamaMaqdisi.CumdatFiqh/0620IbnQudamaMaqdisi.CumdatFiqh.Shamela0011315-ara1 umda.txt
get 0750AH 7c9c84d9f98581470aa2b7f8bee00ae285c5c707 0728IbnTaymiyya/0728IbnTaymiyya.CaqidaWasitiyya/0728IbnTaymiyya.CaqidaWasitiyya.Shamela0022665-ara1 wasitiyya.txt
get 0325AH 089e665b4958e0f145a46941987fb81cf3dda1b8 0321Tahawi/0321Tahawi.MatnCaqida/0321Tahawi.MatnCaqida.JK000126-ara1 tahawiyya.txt
get 0700AH 3d8ff4e7b035aaa4ca5dda52c7322645f3401dcf 0676Nawawi/0676Nawawi.RiyadSalihin/0676Nawawi.RiyadSalihin.Shamela0012014-ara1.mARkdown riyad.txt
get 0875AH 5835c183b8bbf4ea454d5c1be2b168b669403771 0852IbnHajarCasqalani/0852IbnHajarCasqalani.BulughMaram/0852IbnHajarCasqalani.BulughMaram.Shamela0009111-ara1 bulugh.txt
[ -s jalalayn.json ] || curl -fsSL "$Q/ara-jalaladdinalmah.json" -o jalalayn.json
cd ..
# ---- English packs: published translations with the same numbering as the Arabic core ----
mkdir -p en && cd en
for e in bukhari muslim abudawud tirmidhi nasai ibnmajah malik nawawi qudsi; do [ -s eng-$e.json ] || curl -fsSL "$H/eng-$e.json" -o eng-$e.json; done
# Qur'an translations: 5 are indexed; abdelhaleem and ajarberry are used ONLY by eval/english.mjs as "translations we do not have"
for e in ummmuhammad muhammadtaqiudd abdullahyusufal mohammedmarmadu mustafakhattaba abdelhaleem ajarberry; do [ -s q-$e.json ] || curl -fsSL "$Q/eng-$e.json" -o q-$e.json; done
cd ..
# ---- provenance: every raw input is hashed; an existing list that names all of them is verified, not overwritten ----
n=$(ls ara-*.json books/* en/* | wc -l)
if [ -s ../raw.sha256 ] && [ "$(wc -l < ../raw.sha256)" -eq "$n" ]; then
  sha256sum -c --quiet ../raw.sha256 && echo "ok: $n files match data/raw.sha256"
else
  LC_ALL=C sha256sum ara-*.json books/* en/* > ../raw.sha256
  echo "ok: $n files, hashes written to data/raw.sha256"
fi
