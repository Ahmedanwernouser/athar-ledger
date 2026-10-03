// gen.mjs — builds SYNTHETIC lecture transcripts with known ground truth, then corrupts them with
// SIMULATED speech-recognition noise. This measures the matching engine in isolation; it is NOT a
// measurement of a real ASR system (see eval/README.md).
import { readFileSync } from "node:fs";
import path from "node:path";
import { norm, fold } from "../public/js/text.js";
import { ROOT } from "./lib.mjs";

export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const ASSETS = JSON.parse(readFileSync(path.join(ROOT, "eval", "fillers.json"), "utf8"));

export const CUE_Q = ["قال الله تعالى", "وقال سبحانه وتعالى", "يقول ربنا جل وعلا", "قال الله عز وجل في كتابه الكريم", "يقول الله تعالى"];
export const CUE_H = ["قال رسول الله صلى الله عليه وسلم", "وفي الحديث الصحيح عن النبي صلى الله عليه وسلم أنه قال",
  "ثبت عنه عليه الصلاة والسلام أنه قال", "يقول النبي صلى الله عليه وسلم", "وقال صلى الله عليه وسلم"];
// cue wordings that are NOT in public/js/cues.js (run.mjs counts how many of them the engine recognises anyway)
export const CUE_Q_UNSEEN = ["جاء في التنزيل الحكيم", "ومما انزله الله على نبيه", "استمعوا الى كلام رب العالمين", "ونقرا في المصحف الشريف", "ومن ايات الذكر الحكيم"];
export const CUE_H_UNSEEN = ["ومن كلام سيد المرسلين", "ورد في السنة المطهرة", "ومما يروى في هذا الباب", "جاء في الاثر النبوي", "ومن هدي خير البرية"];
// Paraphrase openers. Every paraphrase in fillers.json begins with a verb + «النبي/رسول الله صلى الله عليه وسلم».
// "unseen": the verb is swapped for one that is not in the cue list; "strip": the whole opener is removed.
const OPEN_MAP = { "بين": "وضح", "حذر": "نبه", "أخبر": "ذكر", "أخبرنا": "حدثنا", "علمنا": "أرشدنا", "أوصى": "حث", "نهى": "منع", "نهانا": "زجرنا", "قال": "ذكر" };
export function reopen(text, mode) {
  if (mode === "std") return text;
  const w = text.split(" ");
  if (mode === "unseen") { if (!OPEN_MAP[w[0]]) throw new Error("no unseen opener for: " + w[0]); w[0] = OPEN_MAP[w[0]]; return w.join(" "); }
  if (mode === "strip") { let k = w.indexOf("وسلم") + 1; if (w[k] === "ما" && w[k + 1] === "معناه") k += 2; return w.slice(k).join(" "); }
  throw new Error("reopen mode? " + mode);
}
const TRAIL_H = { bukhari: "رواه البخاري", muslim: "رواه مسلم", abudawud: "رواه أبو داود", tirmidhi: "رواه الترمذي", nasai: "رواه النسائي", ibnmajah: "رواه ابن ماجه" };
const JUNK = ["يعني", "أي", "طبعا", "هكذا", "تماما", "الأمر", "شيء", "كذلك", "أيضا", "حقا"];

/** all passages whose text contains the word sequence `frag` (array of normalised words) */
export function containing(corpus, frag, onlyQuran = null) {
  const s = " " + frag.join(" ") + " ";
  const cand = new Set();
  const F = frag.map(fold);
  for (let i = 0; i + 3 <= F.length && cand.size === 0; i++) {
    for (const p of corpus.postings(3, F.slice(i, i + 3).join(" "))) cand.add(p);
  }
  if (cand.size === 0) { // every trigram was pruned as too frequent: fall back to a scan
    for (let p = 0; p < corpus.N; p++) cand.add(p);
  }
  const out = [];
  for (const p of cand) {
    if (onlyQuran != null && corpus.isQuran(p) !== onlyQuran) continue;
    if ((" " + corpus.P[p].n + " ").includes(s)) out.push(p);
  }
  return out;
}

/** passages sharing many trigrams with `pid` — used to hold a whole "family" of parallel narrations out */
export const PAR_FAMILY = { minShare: 0.3, minCount: 3 };
export function family(corpus, pid, minShare = 0.12, minCount = 2) {
  const F = corpus.ftok(pid), count = new Map();
  let total = 0;
  for (let i = 0; i + 3 <= F.length; i++) {
    const ps = corpus.postings(3, F[i] + " " + F[i + 1] + " " + F[i + 2]);
    if (!ps.length) continue; total++;
    for (const p of ps) count.set(p, (count.get(p) || 0) + 1);
  }
  const out = new Set([pid]);
  for (const [p, c] of count) if (c >= Math.max(minCount, minShare * total)) out.add(p);
  return out;
}

// A quotation is the QUOTED WORDS ONLY. Hadith passages are indexed as narrative + «قال رسول الله صلى الله عليه وسلم» + text;
// a speaker supplies his own cue and then quotes the text. So a fragment never contains the salutation formula, and when
// the passage opens with narration that leads to the formula (within its first 14 words) the fragment starts after it.
const SAY = new Set(["قال", "فقال", "وقال", "يقول", "قالت", "فقالت", "ان", "انه"]);
function quoteStart(T) {
  for (let i = 0; i < Math.min(T.length, 14); i++) if (T[i] === "وسلم") { let k = i + 1; while (k < T.length && SAY.has(T[k])) k++; return k; }
  return 0;
}
// ... and it contains no chain-of-narrators words and none of the collector's own remarks («قال أبو عيسى هذا حديث حسن»):
// some indexed passages still carry such residue, and no speaker quotes it as the Prophet's words.
const CHAIN = new Set(["حدثنا", "وحدثنا", "حدثني", "وحدثني", "حدثه", "اخبرنا", "واخبرنا", "اخبرني", "واخبرني", "انبانا", "عيسي", "الاسناد", "اسناده"]);
const quotedOnly = frag => !frag.some(w => w === "وسلم" || CHAIN.has(w));

/**
 * Build one synthetic lecture.
 * opts: { cue: "std" | "none" | "unseen",      citation cue before each quotation (default: the generator's own, all known to the engine)
 *         par: "std" | "unseen" | "strip",     opener of the by-meaning items
 *         short: false | true,                 verbatim hadith quotes of 5–8 words instead of 8–35
 *         trail: true | false }                «رواه …» after some verbatim hadith
 * The options do not change how the random stream is consumed, so a seed gives the same quotations under every option.
 * @returns {words:[string], items:[{kind, a, b, accept:Set<pid>|null, expect, ...}], blocked:Set<pid>}
 */
export function buildLecture(corpus, seed, sizes = { vq: 40, vh: 60, ph: 40, par: 26, ooc: 30, cue: 14 }, parSet = "test", opts = {}) {
  const O = { cue: "std", par: "std", short: false, trail: true, ...opts };
  const cueOf = (r, std, alt) => { const k = Math.floor(r() * std.length); return O.cue === "std" ? std[k] : O.cue === "unseen" ? alt[k] : ""; };
  const r = rng(seed);
  const words = [], items = [];
  const filler = k => { for (let i = 0; i < k; i++) words.push(...pick(r, ASSETS.fillers).split(" ")); };
  const blocked = new Set();
  const hadithPids = [];
  // only passages whose text was isolated from its chain of narrators (m=1)
  for (let p = corpus.NQ; p < corpus.coreN; p++) { const L = corpus.tok(p).length; if (corpus.P[p].m === 1 && L >= 12 && L <= 120) hadithPids.push(p); }

  // out-of-corpus items first (their families are removed from the searchable corpus)
  const oocItems = [];
  while (oocItems.length < sizes.ooc) {
    const p = pick(r, hadithPids);
    if (blocked.has(p)) continue;
    const T = corpus.tok(p), q0 = quoteStart(T), L = Math.min(T.length - q0, 10 + Math.floor(r() * 25)), s = q0 + Math.floor(r() * (T.length - q0 - L + 1));
    const frag = T.slice(s, s + L);
    if (L < 8 || !quotedOnly(frag)) continue;
    // hold out the passage, its parallel narrations AND every passage sharing any 4-word run with the fragment,
    // (as normalised text). Differently-worded narrations of the same hadith CAN remain; run.mjs therefore judges every
    // citation on these items as right (another narration of the same text) or wrong (an unrelated source).
    const out = family(corpus, p);
    for (let i = 0; i + 4 <= frag.length; i++) containing(corpus, frag.slice(i, i + 4)).forEach(x => out.add(x));
    if (out.size > 80 || [...out].some(x => corpus.isQuran(x))) continue;
    out.forEach(x => blocked.add(x));
    oocItems.push({ kind: "ooc", frag, cue: cueOf(r, CUE_H, CUE_H_UNSEEN), accept: null, expect: "none", pid: p });
  }
  const plan = [...oocItems];

  // verbatim Qur'an (1–3 consecutive ayahs)
  for (let k = 0; k < sizes.vq; ) {
    const p = Math.floor(r() * corpus.NQ), s = +corpus.P[p].r.split(":")[0];
    const span = 1 + Math.floor(r() * 3), end = Math.min(corpus.surahEnd[s], p + span - 1);
    const frag = []; for (let q = p; q <= end; q++) frag.push(...corpus.tok(q));
    if (frag.length < 5 || frag.length > 60) continue;
    const accept = new Set(); for (let q = p; q <= end; q++) accept.add(q);
    containing(corpus, corpus.tok(p), true).forEach(x => accept.add(x));
    const has = r() < 0.8, c = has ? cueOf(r, CUE_Q, CUE_Q_UNSEEN) : "";
    plan.push({ kind: "vq", frag, cue: c, accept, expect: "verbatim" }); k++;
  }
  // verbatim hadith fragments and partial (edited) ones
  const mkH = (kind) => {
    for (;;) {
      const p = pick(r, hadithPids);
      if (blocked.has(p)) continue;
      const T = corpus.tok(p), q0 = quoteStart(T), room = T.length - q0;
      const L = O.short && kind === "vh" ? Math.min(room, 5 + Math.floor(r() * 4)) : Math.min(room, (kind === "ph" ? 14 : 8) + Math.floor(r() * 28));
      if (L < (kind === "ph" ? 14 : O.short ? 5 : 8)) continue;
      const s = r() < 0.5 ? q0 : q0 + Math.floor(r() * (room - L + 1));
      const orig = T.slice(s, s + L);
      if (!quotedOnly(orig)) continue;
      const accept = new Set(containing(corpus, orig, false));
      [...accept].forEach(x => { if (blocked.has(x)) accept.delete(x); });
      if (!accept.size) continue;
      let frag = orig, expect = "verbatim", agree = 1, changed = false;
      if (kind === "ph") {
        frag = []; let same = 0, cols = 0;
        for (const w of orig) {
          const x = r();
          if (x < 0.13) { cols++; continue; }                               // word omitted
          if (x < 0.22) { frag.push(pick(r, JUNK)); cols++; continue; }     // word replaced
          frag.push(w); same++; cols++;
          if (r() < 0.06) { frag.push(pick(r, JUNK)); cols++; }             // extra word
        }
        agree = same / cols;
        if (frag.length < 8 || agree < 0.6) continue;
        // STRICT rule: a quotation with ANY omitted, replaced or added word is "partial"; "verbatim" only if the random
        // edits happened to change nothing. (run.mjs additionally checks whether the words under a "verbatim" label
        // really stand word for word in the cited passage — the engine may rightly call an unchanged PART verbatim.)
        changed = frag.join(" ") !== orig.join(" ");
        expect = changed ? "partial" : "verbatim";
      }
      const col = corpus.P[p].r.split(":")[0];
      const trail = kind === "vh" && TRAIL_H[col] && r() < 0.35 ? TRAIL_H[col] : "";
      const has = r() < 0.85, c = has ? cueOf(r, CUE_H, CUE_H_UNSEEN) : "";
      return { kind, frag, cue: c, trail: O.trail ? trail : "", trailCol: trail && O.trail ? col : null, accept, expect, agree, changed };
    }
  };
  for (let k = 0; k < sizes.vh; k++) plan.push(mkH("vh"));
  for (let k = 0; k < sizes.ph; k++) plan.push(mkH("ph"));
  // paraphrases (texts written by the assistant; the reference is located through a key phrase)
  // paraphrases 1–24 are the development set (settings were chosen on them); 25–50 are held out for the report
  let np = 0;
  const pool = parSet === "dev" ? ASSETS.paraphrases.slice(0, 24) : ASSETS.paraphrases.slice(24);
  const base = parSet === "dev" ? 0 : 24;
  pool.forEach(([text, keys], idx) => {
    if (np >= sizes.par) return;
    // (1) passages that contain one of the key phrases; (2) their FAMILY: parallel narrations of the same text, by the
    // same shared-trigram rule that defines a family for the out-of-corpus hold-out, but stricter (PAR_FAMILY) because
    // here a looser family would make the system look better
    const acceptKey = new Set(keys.flatMap(key => containing(corpus, norm(key).split(" "), false)));
    [...acceptKey].forEach(x => { if (blocked.has(x)) acceptKey.delete(x); });
    if (!acceptKey.size) return;
    const accept = new Set(acceptKey);
    for (const p of acceptKey) for (const q of family(corpus, p, PAR_FAMILY.minShare, PAR_FAMILY.minCount)) if (!blocked.has(q) && !corpus.isQuran(q)) accept.add(q);
    plan.push({ kind: "par", frag: norm(reopen(text, O.par)).split(" "), cue: "", accept, acceptKey, expect: "meaning", id: base + idx + 1 }); np++;
  });
  for (let k = 0; k < sizes.cue; k++) plan.push({ kind: "cue", frag: norm(pick(r, ASSETS.cueOnly)).split(" "), cue: "", accept: null, expect: "none" });

  // shuffle, interleave with filler
  for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }
  filler(2);
  for (const it of plan) {
    if (it.cue) words.push(...norm(it.cue).split(" "));
    const a = words.length; words.push(...it.frag); const b = words.length;
    if (it.trail) words.push(...norm(it.trail).split(" "));
    items.push({ ...it, a, b });
    filler(1 + Math.floor(r() * 3));
  }
  return { words, items, blocked };
}

// ---------- simulated ASR noise ----------
const PHON = { "ص": "س", "س": "ص", "ذ": "ز", "ز": "ذ", "ض": "د", "ظ": "ز", "ط": "ت", "ت": "ط", "ق": "ك", "ك": "ق", "ث": "س", "ه": "ا", "ع": "ا", "ح": "ه", "د": "ض" };
const LETTERS = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي";
const INSERT = ["ان", "في", "من", "قال", "يعني", "هو", "على", "ما"];
/**
 * The project's noise model. `rate` = probability that a word is hit ("نسبة الكلمات المصابة في المحاكاة"); it is NOT a
 * measured word error rate of any recogniser.
 * @returns {words:[string], map:[index of first noisy word for each clean word]}
 * Most of what it generates is what the engine has an explicit tolerance for: a letter of the same phonetic class,
 * one changed/dropped/added letter, two glued words, one split word. The rest: a dropped word, an inserted word, or an
 * error in a short word. It never replaces a word with another real word and never repeats a phrase — see
 * realWordNoise() and whisperNoise() below for those. run.mjs measures the actual shares (results.json: noiseShape).
 */
export function asrNoise(words, wer, r) {
  const out = [], map = new Array(words.length + 1);
  for (let i = 0; i < words.length; i++) {
    map[i] = out.length;
    let w = words[i];
    if (r() >= wer) { out.push(w); continue; }
    const x = r();
    if (x < 0.42) {            // substitution
      const pos = [...w].map((c, k) => (PHON[c] ? k : -1)).filter(k => k >= 0);
      if (pos.length && r() < 0.7) { const k = pick(r, pos); w = w.slice(0, k) + PHON[w[k]] + w.slice(k + 1); }
      else { const k = Math.floor(r() * w.length); w = w.slice(0, k) + pick(r, [...LETTERS]) + w.slice(k + 1); }
      out.push(w);
    } else if (x < 0.57) {     // a letter dropped or added
      if (w.length > 3 && r() < 0.6) { const k = Math.floor(r() * w.length); w = w.slice(0, k) + w.slice(k + 1); }
      else { const k = Math.floor(r() * (w.length + 1)); w = w.slice(0, k) + pick(r, [...LETTERS]) + w.slice(k); }
      out.push(w);
    } else if (x < 0.72) {     // word deleted
    } else if (x < 0.82) {     // word inserted
      out.push(w, pick(r, INSERT));
    } else if (x < 0.90 && w.length >= 5) { // word split in two
      const k = 2 + Math.floor(r() * (w.length - 3)); out.push(w.slice(0, k), w.slice(k));
    } else if (i + 1 < words.length) {      // glued to the next word
      map[i + 1] = out.length; out.push(w + words[i + 1]); i++;
    } else out.push(w);
  }
  map[words.length] = out.length;
  for (let i = words.length - 1; i >= 0; i--) if (map[i] == null) map[i] = map[i + 1];
  return { words: out, map };
}

/** word deletion only, at rate p */
export function delNoise(words, p, r) {
  const out = [], map = new Array(words.length + 1);
  for (let i = 0; i < words.length; i++) { map[i] = out.length; if (r() >= p) out.push(words[i]); }
  map[words.length] = out.length; return { words: out, map };
}
/**
 * "Whisper-shaped" errors — the independent reviewer's GUESS at what a real recogniser does; still synthetic.
 * The recogniser outputs real words. Of the words that are hit:
 *   30% become a different real word of similar shape (same first letter, length ±1, from the lecture's own vocabulary)
 *   20% are dropped (short function words are dropped more often)
 *   15% get an affix change (ال / و / final ا ن ه ي, ون↔ين)
 *   13% are merged with the next word, 7% split
 *   15% are followed by a hallucinated repetition of the previous 3–6 words (rep:false switches this off)
 * only: "lex" -> real-word substitution only.
 */
export function whisperNoise(words, rate, r, { rep = true, only = null } = {}) {
  const vocab = [...new Set(words)], byKey = new Map();
  for (const v of vocab) { const k = v[0]; let a = byKey.get(k); if (!a) byKey.set(k, a = []); a.push(v); }
  const out = [], map = new Array(words.length + 1);
  const affix = w => {
    const x = r();
    if (x < 0.25) return w.startsWith("ال") && w.length > 4 ? w.slice(2) : "ال" + w;
    if (x < 0.45) return w.startsWith("و") && w.length > 3 ? w.slice(1) : "و" + w;
    if (x < 0.6 && w.endsWith("ون")) return w.slice(0, -2) + "ين";
    if (x < 0.6 && w.endsWith("ين")) return w.slice(0, -2) + "ون";
    if (x < 0.8 && w.length > 3) return w.slice(0, -1);
    return w + pick(r, ["ا", "ن", "ه", "ي"]);
  };
  for (let i = 0; i < words.length; i++) {
    map[i] = out.length;
    const w = words[i];
    const p = w.length <= 3 ? Math.min(1, rate * 1.4) : rate;
    if (r() >= p) { out.push(w); continue; }
    let x = r();
    if (only === "lex") x = 0.1;
    if (w.length <= 3 && x < 0.5 && only !== "lex") continue;                     // short function word dropped
    if (x < 0.30) { const c = (byKey.get(w[0]) || []).filter(v => v !== w && Math.abs(v.length - w.length) <= 1); out.push(c.length ? pick(r, c) : pick(r, vocab)); }
    else if (x < 0.50) { /* dropped */ }
    else if (x < 0.65) out.push(affix(w));
    else if (x < 0.78 && i + 1 < words.length) { map[i + 1] = out.length; out.push(w + words[i + 1]); i++; }
    else if (x < 0.85 && w.length >= 5) { const k = 2 + Math.floor(r() * (w.length - 3)); out.push(w.slice(0, k), w.slice(k)); }
    else if (!rep) out.push(w);
    else { out.push(w); const k = 3 + Math.floor(r() * 4), again = out.slice(Math.max(0, out.length - k)); const m = 1 + Math.floor(r() * 2); for (let q = 0; q < m; q++) out.push(...again); }
  }
  map[words.length] = out.length;
  for (let i = words.length - 1; i >= 0; i--) if (map[i] == null) map[i] = map[i + 1];
  return { words: out, map };
}
/** the project's model with a chosen share of phonetic substitutions and number of edits per word (used by --extra) */
export function asrNoiseP(words, wer, r, { phonShare = 0.7, edits = 1 } = {}) {
  const out = [], map = new Array(words.length + 1);
  const sub1 = w => {
    const pos = [...w].map((c, k) => (PHON[c] ? k : -1)).filter(k => k >= 0);
    if (pos.length && r() < phonShare) { const k = pick(r, pos); return w.slice(0, k) + PHON[w[k]] + w.slice(k + 1); }
    const k = Math.floor(r() * w.length); return w.slice(0, k) + pick(r, [...LETTERS]) + w.slice(k + 1);
  };
  const indel1 = w => {
    if (w.length > 3 && r() < 0.6) { const k = Math.floor(r() * w.length); return w.slice(0, k) + w.slice(k + 1); }
    const k = Math.floor(r() * (w.length + 1)); return w.slice(0, k) + pick(r, [...LETTERS]) + w.slice(k);
  };
  for (let i = 0; i < words.length; i++) {
    map[i] = out.length;
    let w = words[i];
    if (r() >= wer) { out.push(w); continue; }
    const x = r();
    if (x < 0.42) { for (let e = 0; e < edits; e++) w = sub1(w); out.push(w); }
    else if (x < 0.57) { for (let e = 0; e < edits; e++) w = indel1(w); out.push(w); }
    else if (x < 0.72) { /* deleted */ }
    else if (x < 0.82) out.push(w, pick(r, INSERT));
    else if (x < 0.90 && w.length >= 5) { const k = 2 + Math.floor(r() * (w.length - 3)); out.push(w.slice(0, k), w.slice(k)); }
    else if (i + 1 < words.length) { map[i + 1] = out.length; out.push(w + words[i + 1]); i++; }
    else out.push(w);
  }
  map[words.length] = out.length;
  for (let i = words.length - 1; i >= 0; i--) if (map[i] == null) map[i] = map[i + 1];
  return { words: out, map };
}
