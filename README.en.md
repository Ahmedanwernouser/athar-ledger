<div align="center">

<h1>Athar — a ledger of spoken citations</h1>

<p><b>Finds the Qur'an verses and hadith cited in a lecture and compares each to its source, word by word</b></p>

<p>
<a href="https://athar-ledger.pages.dev"><b>🌐 Open the live site</b></a>
&nbsp;&nbsp;•&nbsp;&nbsp;
<a href="README.md"><b>📖 اقرأ هذه الصفحة بالعربية</b></a>
</p>

<p>Free • No sign-up • Arabic and English</p>

<p>AI Challenge: Serving Islamic Content — Track 4: knowledge and verification tools</p>

</div>

## The idea

A single lecture carries verses and hadith recited from memory. A word may change, a hadith may be attributed to the wrong book, or a well-known saying may be presented as a hadith when it is in none of the hadith collections. Checking all of that by hand takes hours.

Athar takes the lecture and gives you a **ledger**: every citation, the moment it was said, the text of its source, and the difference between the two, word by word. Then it leaves the decision to the reviewer.

## Try it in thirty seconds

1. Open https://athar-ledger.pages.dev
2. Paste a YouTube lecture link, or press one of the "Try" buttons under the input box.
3. Read "Summary", then "Ledger", and press any time to hear that place in the video.
4. Download the text with its footnotes as a Word file.
5. Open "Ask Athar" and type: «هل هذا حديث: حب الوطن من الإيمان؟» ("Is this a hadith: love of one's homeland is part of faith?")

## What it does

| | |
|---|---|
| **Three ways in** | A YouTube link (transcribed straight from the link, nothing downloaded), an audio recording, or pasted text. |
| **Word-by-word matching** | What was changed, dropped or added, and what was said out of order. "Verbatim" is given only when not one word differs. |
| **Understands transcription errors** | It tells an error of the automatic transcription (similar letters, two words run together) from a real difference in wording. |
| **Attribution check** | When the speaker says "narrated by al-Bukhari" or "in Surat al-Baqarah", that is compared with where the text actually stands. |
| **A grading for every hadith** | As recorded by hadith scholars, under the name of whoever gave it ("Sahih — al-Albani", "in Sahih Muslim", "disputed"). Copied from the dataset, never produced by the tool. |
| **Famous sayings** | Every text is also looked up in five books of fabricated and famous sayings, and the book's own words about it are shown. |
| **Each hadith once** | However often it is repeated or split across passages: its full text, what was said of it, its source, and every moment it was mentioned. |
| **Ask Athar** | About the lecture ("sum it up", "what did he say about …, and when?"), or about any verse or hadith with no lecture at all: a text by its reference, who narrated it and its grading, whether a text is a hadith, texts near a topic, al-Jalalayn's commentary, and how often a word stands in the Qur'an. |
| **The reviewer decides** | Corrects a word the transcription got wrong, adds a citation the tool missed, rules on every entry, and saves the session for another reviewer to continue. |
| **A finished report** | A Word file with the lecture's text and a footnote giving the source and grading of every verse and hadith; plus a transcript (TXT) and timed subtitles (SRT). |
| **Arabic and English** | The interface is in both, and an English lecture is matched against published translations that lead back to the Arabic text. |
| **A layered library** | The Qur'an and nine hadith collections always; book packs on demand: tafsir, fiqh, seerah, creed. |

## Scholarly integrity

This tool handles the Qur'an and hadith, so it is built on three rules:

- **It gives no rulings and grades no hadith.** A question asking for a ruling is refused in fixed words, and gradings are copied with their authors' names.
- **Descriptions come from counting words, not from a model's opinion.** "Verbatim" and "match with differences" are the result of a deterministic comparison with a known source.
- **Where a language model is used, it is constrained.** In "Ask Athar", a question about one particular text is answered by the page itself from the data, with no model. When a model does word a sentence, an automatic check removes any grading or quotation that is not in the data, and the text, source and grading are always shown on cards taken from the sources themselves.

What it does not find, it says it did not find: "not found" means the text is not in the loaded books in that wording — it is not a verdict on it.

## All of it is free

No subscription, no paid server, no credit card at any step.

| Part | With what | Cost |
|---|---|---|
| Site and library | Cloudflare Pages, static files | Free |
| Detection and matching | A JavaScript engine running in the user's browser | No server at all |
| Proxy | A small Cloudflare Worker that keeps the keys and counts the allowances | Free plan |
| Transcribing recordings | Whisper large-v3 on Groq | Free tier |
| Transcribing YouTube links | Gemini Flash models, with rotating keys | Free tier |
| Search by meaning | bge-m3 on Cloudflare Workers AI | Free tier |
| "Ask Athar" | A model on Groq; or the user's own key on Groq, Gemini or OpenRouter | Free tier |
| Tests and deployment | GitHub Actions | Free |

Anyone who wants a larger allowance enters their own key on the page; the key stays in their browser and is not stored with us.

## In numbers

- **Library:** 6,236 verses and 36,063 hadith from nine collections, and 15 books in packs; 163,048 passages in all (about 9.6 million words).
- **Tests:** 244 tests of the engine and interface and 639 checks of the proxy, run before every deployment.
- **Detecting verses:** 100% on clean text and 95% when 20% of the words carry transcription errors, against 91.7% and 83.3% for a reference fuzzy search.
- **Detecting verbatim hadith:** 99.4%, then 97.8%.
- **Critical errors per lecture:** 0.7, against 8.0 for the reference search.
- **Strict descriptions:** no quotation with altered wording was ever called "verbatim", at any noise level.
- **On real human text** (tweets of the QDetect benchmark, verse detection): precision 97.4%, recall 82.2%.
- **Twenty famous sayings that are in no hadith collection:** not one was matched to a hadith.

The detection, error and strictness figures come from composed lectures with simulated transcription errors, and all of them are reproduced by one command: `npm run eval`. The method, the full tables and what was measured on the deployed service are in `docs/DETAILS.md` and `docs/EVALUATION.md` (Arabic).

## Running it locally

Requirements: Node 20 or newer, and Python 3. No `npm install` is needed: the project has no external dependencies.

```bash
git clone https://github.com/Ahmedanwernouser/athar-ledger && cd athar-ledger
npm run serve     # then open http://localhost:8788
npm test          # 244 tests + 639 checks (about 4 minutes)
npm run eval      # reproduces the evaluation figures (about 4 minutes)
```

Pasting text, the samples, searching the sources and "Ask Athar" questions about a particular text work locally at once. Uploading audio, YouTube links and model wording need the proxy in `worker/` to be deployed; the steps are in `docs/SETUP_FREE_ACCOUNTS.md`.

## Repository layout

```
public/     the whole site: interface, engine (js/), and library (data/)
worker/     the proxy (Cloudflare Worker): transcription, YouTube, sentence vectors, checker and chat
tests/      tests of the engine, the interface and the "Ask Athar" tools
eval/       evaluation: lecture generation, reference systems, results
tools/      building the library and indexes from the sources
docs/       full details, sources and licences, evaluation, setup
Athr_audio&vido .ipynb   the team's Colab experiment for transcribing audio and video
```

The `main` branch is the project, and `baseline-v0` (tag `v0-baseline`) is the starting point. The other branches are written automatically by GitHub Actions (deployment log and results of trials on the deployed service) and are not code.

## Sources

Every text Athar shows is taken from a published source listed here; details and the terms of each source are in `docs/SOURCES_AND_LICENSES.md`.

| Source | What is taken from it | Terms |
|---|---|---|
| [Tanzil](https://tanzil.net) via fawazahmed0/quran-api | The text of the Qur'an, shown exactly as it is | CC BY 3.0 |
| [fawazahmed0/hadith-api](https://github.com/fawazahmed0/hadith-api) | Sahih al-Bukhari, Sahih Muslim, Sunan Abi Dawud, Jami` at-Tirmidhi, Sunan an-Nasa'i, Sunan Ibn Majah, Muwatta Malik, an-Nawawi's Forty, the Qudsi hadith, and the scholars' gradings recorded with them | Unlicense (the collecting repository) |
| [OpenITI](https://github.com/OpenITI) | Tafsir Ibn Kathir, Sirat Ibn Hisham, Zad al-Ma`ad, Bidayat al-Mujtahid, `Umdat al-Fiqh, al-`Aqidah at-Tahawiyyah, al-`Aqidah al-Wasitiyyah, Riyad as-Salihin, Bulugh al-Maram; and the books of fabricated and famous sayings: al-Mawdu`at (Ibn al-Jawzi), al-La'ali' al-Masnu`ah (as-Suyuti), al-Fawa'id al-Majmu`ah (ash-Shawkani), al-Maqasid al-Hasanah (as-Sakhawi), Kashf al-Khafa' (al-`Ajluni) | CC BY-NC-SA 4.0 (non-commercial) |
| fawazahmed0/quran-api | Tafsir al-Jalalayn, and five English translations of the Qur'an (Saheeh International, Hilali & Khan, Yusuf Ali, Pickthall, Mustafa Khattab) | The translations are copyright of their owners |
| fawazahmed0/hadith-api | The English translation of the hadith collections | Translator not named in the source |
| quran.com · sunnah.com · dorar.net | Reference links only; no content is taken from them | — |
| [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3) | Sentence-vector model | MIT |
| Whisper large-v3 (Groq) · Gemini Flash (Google) · qwen3.8-27b and gpt-oss-120b (Groq) | Transcription, wording the chat's answer, and the short-match checker | Each service's terms |
| Amiri · IBM Plex Sans Arabic | Fonts, hosted inside the project | SIL OFL 1.1 |
| QDetect benchmark | Tweets used for evaluation only; not distributed with the project | — |

## Known limits

- The library is what is listed above; what is not in it shows as "not found".
- Quality follows the quality of the transcription, and quotations shorter than eight words are detected less often.
- Quotation by meaning and search by topic are suggestions, shown as such, not matches.
- The ledger is a draft for the human reviewer, not a replacement for one.

## Licence

Code and documentation: **all rights reserved** by Ahmed Anwer — published to be read, run and evaluated; not to be copied or reused without written permission (`LICENSE`). Texts follow the terms of their sources (the table above and `docs/SOURCES_AND_LICENSES.md`). The starting point and what was done inside the challenge window are in `BASELINE.md`, and the tools used are in `docs/AI_TOOLS.md`.

## Team

| Name | Role | Responsibility |
|---|---|---|
| **Ahmed Anwer** | AI and data science engineer | System architecture, the detection and matching engine, the scholarly-integrity rules of "Ask Athar", the proxy and deployment |
| **Ahmed Halim** | AI and data science engineer | The library, its sources and licences; source search inside "Ask Athar"; reference links; evaluation |
| **Mohamed Omar** | AI and data science engineer | Audio and video transcription: experiments with transcription models and voice separation |
| **Ammar Yasser** | AI and data science engineer | The interface and the reviewer's experience: summary, ledger, Word report, Arabic and English |
| **Amr Essam** | AI and data science engineer | The "Ask Athar" interface and the home page; usability testing on real lectures |

Ahmed Anwer and Mohamed Omar hold an MSc in Artificial Intelligence and Data Science from Queen's University, Canada.

**Contact:** Ahmed Anwer — ahmed.a.n.27122014@gmail.com
