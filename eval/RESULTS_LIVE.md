# Live transcription test — 4 October 2026

The real Worker code (`worker/src.js`) against the real provider APIs, on real audio, run by GitHub Actions
(`.github/workflows/live-asr.yml`, `eval/live/`). Keys are repository secrets. Raw answers and ledgers of every
run are on the branch `live-results`; the audio is never committed.

## What was transcribed
- **Recitation with a known answer** (public repository AmmarBasha2011/Ammar-Quran-Record, pinned commit): `yusuf`
  = 20 ayahs of Surat Yusuf, `medley` = 54 ayahs from 9 surahs.
- **Four real lectures** from archive.org, 12 minutes of each (starting at minute 3): Muhammad Hassan (the Hour and
  the unseen), al-Shaarawi (tafsir), Ibn Uthaymeen (Riyad as-Salihin, the hadith of intentions), al-Nabulsi (a Friday
  sermon). No answer key exists for them; the ledgers were read by a person (see "Reading the lectures").
  A fifth search (sermons of Kishk) returned nothing usable.

## Transcribers
| | Gemini 3.5 Transcribe (through the Worker) | Whisper large-v3 (Groq, through the Worker) | Cohere Transcribe Arabic (called directly) |
|---|---|---|---|
| answered | 6 of 6 clips (one 429 on the first key, the Worker's `upstream_busy`; the next key answered) | 6 of 6 | 6 of 6 |
| time for 12 minutes of audio | 18–22 s | 4–9 s | 2–5 s |
| word timestamps | yes, every word (0–3 words of zero length per clip) | yes (16 and 13 words out of order in two lectures) | none |
| model request/response shape | exactly as the Worker assumed from Google's documentation: no change was needed | | text only |

## Recitation (answer known)
| clip | | Gemini | Whisper | Cohere |
|---|---|---|---|---|
| medley | ayahs found of 54 | 53 | 53 | 52 |
| | labelled verbatim | 17 | 28 | 10 |
| | cited but not recited | 0 | 0 | 0 |
| yusuf | ayahs found of 20 | 19 | 19 | 19 |
| | cited but not recited | 0 | 0 | 0 |

Every transcriber missed the same ayah in each clip (36:1 «يس», 12:20), which is a property of how the letters are
read aloud, not of one model. No transcriber produced a wrong citation. On *wording*, Whisper large-v3 was the closest
to the text of the Qur'an on the medley (28 ayahs verbatim against 17 and 10): the strict "zero different words" label
depends on every word, so a single spelling difference costs it.

## Reading the lectures
I read the ledgers of two lectures (Hassan and Ibn Uthaymeen) in full; every entry I checked pointed to the right source
(al-Ahzab 63, al-Nazi'at 42–46, Bukhari 50, al-Jinn 26–27, Ayat al-Kursi, al-Hashr 7, Bukhari 6604, Muslim 2892, Bukhari 1,
al-Isra 18–19, Muslim 1718…). I did not verify the other two lectures entry by entry. Counts by status:

| lecture | Gemini | Whisper | Cohere |
|---|---|---|---|
| Hassan | 9 verbatim, 9 partial, 2 lead, 3 not found | 5, 11, 1 lead + 2 meaning, 1 | 8, 6, 1 + 1, 2 |
| al-Shaarawi | 2, 1, 4 | 2, 0, 5 | 2, 1, 5 |
| Ibn Uthaymeen | 11, 2, 3 | 7, 5, 3 | 8, 4, 2 + 1 meaning |
| al-Nabulsi | 8, 5, 1 | 5, 7, 1 | 10, 2, 1 |

The same passage was often found by all three; what changes is the word-for-word label. Gemini's text is visibly cleaner
on lectures (Whisper wrote «تبلس سرائه» and «أبو عثر» where Gemini wrote «تبلى السرائر» and «بعثر»), so more entries reach
"verbatim" with it.

## Two transcriptions of the same audio (Gemini + Whisper, `eval/live/agree.mjs`)
56 textual entries of the Gemini ledger: 50 found a partner in the Whisper ledger. **10 were raised to verbatim because
both transcribers agree on the words** (5 of them in the recitation, 3 in the Friday sermon, 1 in Hassan, 1 in Ibn
Uthaymeen). 13 differences from the text were **confirmed by both** (it is the speaker who changed the wording, not the
recognizer), 16 stayed unresolved. On two copies of Whisper the same check raised nothing, because they make the same
mistakes; with an independent second transcriber it does.

## What this does not show
- No answer key for the lectures: these are counts and a reading, not recall or precision.
- 12 minutes of each of four speakers; one clean recording each; no video, no music, no overlapping speech.
- Only one run per clip. Gemini's free-tier limits are not published; one 429 appeared within the first requests.
- The Cohere model was called directly with a trial key (5 requests a minute, not for production use).
