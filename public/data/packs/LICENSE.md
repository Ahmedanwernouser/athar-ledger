# Licences of the packs in this folder

This folder holds two different kinds of material. They do NOT share one licence.

## 1. Arabic book packs: `hadith2/`, `tafsir/`, `fiqh/`, `seerah/`, `aqeedah/`

Derived from the **OpenITI corpus** (Open Islamicate Texts Initiative, https://github.com/OpenITI,
release record https://zenodo.org/records/10007820), published under
**Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**.
OpenITI's texts were digitised from al-Maktaba al-Shamela; the works themselves are classical (authors d. 213–911 AH).

- **Attribution**: OpenITI must be credited (done in the site footer and here).
- **NonCommercial**: this data may not be used for commercial purposes.
- **ShareAlike**: these derived files are shared under the same licence, CC BY-NC-SA 4.0.

What was changed: each book was cut into passages of about 110 words at its own paragraph and heading boundaries,
normalised for search (diacritics and punctuation removed, letter forms unified) and indexed. Editorial matter that is
not the author's text was left out (a catalogue card and editor's outline in al-Wasitiyya, the indexes of Sirat Ibn Hisham).

Tafsir al-Jalalayn (inside the tafsir pack) comes from fawazahmed0/quran-api (`ara-jalaladdinalmah`, source: tanzil.net).

## 2. English translation packs: `en-quran/`, `en-hadith/`

These are NOT from OpenITI and are NOT Creative Commons.
They are English translations taken from the fawazahmed0/quran-api and hadith-api datasets (the dataset wrappers are
under the Unlicense, but **the translations themselves are copyrighted works of their translators and publishers**:
Saheeh International, Hilali & Khan, Yusuf Ali, Pickthall, Mustafa Khattab for the Qur'an; the hadith translations'
translators are not named in the dataset). **Permission to redistribute them has not been verified.** They are included
by a decision of the project owner for a non-commercial, educational, open-source project; if a rights holder objects
they will be removed. The dataset files have sentence-final punctuation stripped, so they are not verbatim editions.

## Removing the packs

The project's CODE is MIT-licensed and does not depend on this folder: the site works on the core corpus
(Qur'an + nine hadith collections) without it. Note that the meaning vectors in `public/data/vec/` were trained on ALL
texts including these packs; a build without the packs must retrain them on the core only (`tools/build_all.sh`), and
`public/data/packs.json` and the `vec_<pack>.bin` / `map_<pack>.bin` files must be removed as well.
