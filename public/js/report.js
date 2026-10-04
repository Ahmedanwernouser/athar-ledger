// report.js — the transcript as a document with sourced footnotes ("نص مخرَّج").
// The words stay exactly as transcribed; every textual citation is set off as a quotation and gets a footnote with its source.
// Footnotes are an automatic draft: one a person has confirmed ("صحيح") is printed plain, every other one carries a "*".
// An entry a person marked "غير صحيح" gets no footnote at all.
// An entry the reviewer added by hand ("manual") is a person's choice: its footnote has no "*" and says who added it.
// When two transcriptions were compared (agree.js) the status used everywhere here is the one they support together
// (statusOf). The words in the document are still those of the primary transcript: a quotation that is "verbatim by two
// transcriptions" while its transcribed words differ is quoted as transcribed, and its footnote says so; it is never
// rewritten in the Mushaf's or the source's spelling (that needs the primary words to map one to one, as before).
import { t, srcLabel, num, getLang, collectionName } from "./i18n.js";
import { buildDocx } from "./docx.js";
import { fmtTime } from "./text.js";
import { statusOf } from "./agree.js";

const SENTENCE_END = /[.!?؟…]["'»”)]*$/;
const PARA_MAX = 180, PARA_MIN = 70;
const isArabic = s => /[؀-ۿ]/.test(s);

/** what the footnote of one ledger entry says, or null when the entry gets none */
export function footnoteFor(e, verdict) {
  if (verdict === "no") return null;
  const s = e.source, star = verdict === "yes" || e.manual ? "" : " *", status = statusOf(e);
  if (e.manual && s && e.status === "meaning") return { text: t("doc.fn.manual.meaning", srcLabel(s)) + (verdict === "unsure" ? " " + t("doc.fn.unsure") : "") + " " + t("doc.fn.manual"), quote: false, kind: s.type };
  // found by the second transcription only: the words standing here are the primary transcript's, so nothing is put in quotation marks
  if (e.pass === "t2" && s && (status === "verbatim" || status === "partial")) return { text: srcLabel(s) + ". " + t("doc.fn.second") + (verdict === "unsure" ? " " + t("doc.fn.unsure") : "") + star, quote: false, kind: s.type };
  if ((status === "verbatim" || status === "partial") && s) {
    let x = srcLabel(s);
    const others = (e.parallels || []).filter(p => p.type !== "b").slice(0, 3).map(p => srcLabel(p, true));
    if (s.type !== "q" && others.length) x += t("doc.fn.also", others.join(t("doc.sep"))) + ((e.parallels || []).filter(p => p.type !== "b").length > 3 ? t("doc.fn.more") : "");
    x += ".";
    const wording = status === "partial" && s.type === "h" && s.via !== "en" ? sourceWording(s.display) : "";      // the source's own words, when the worker has them
    if (status === "partial") x += " " + (wording ? t("doc.fn.partial.h.text", wording) : t(s.type === "q" ? "doc.fn.partial.q" : "doc.fn.partial.h"));
    if (status === "partial" && s.type === "q" && s.display && s.via !== "en") x += " " + s.display;
    if (status === "verbatim" && e.status === "partial") x += " " + t("doc.fn.two");
    if (s.via === "en") x += " " + t("doc.fn.viaen");
    if (e.attribution && e.attribution.agrees === false) x += " " + t("doc.fn.attr");
    if (e.tailUnmatched) x += " " + t("doc.fn.tail");
    if (e.weakOnly) x += " " + t("doc.fn.weakonly");
    if (e.weakBooks && e.weakBooks.length) x += " " + t("doc.fn.weak", e.weakBooks.map(w => `${w.book} (${w.author})` + (w.bookWords ? ` «${w.bookWords}»` : "")).join(t("doc.sep")));
    if (e.spokenGrades && e.spokenGrades.length) x += " " + t("doc.fn.grade", e.spokenGrades.map(g => g.text).join(" / "));
    if (verdict === "unsure") x += " " + t("doc.fn.unsure");
    if (e.manual) x += " " + t("doc.fn.manual");
    return { text: x + star, quote: true, kind: s.type };
  }
  if (status === "meaning" && s) return { text: t("doc.fn.meaning", srcLabel(s)) + star, quote: false, kind: s.type };
  if (status === "notfound" && ["quran", "hadith"].includes(e.cue)) return { text: t("doc.fn.notfound") + star, quote: false, kind: e.cue === "quran" ? "q" : "h" };
  return null;
}

export const FN_SOURCE_WORDS = 60;
const EDGE_PUNCT = /^[\s"«»“”.,،؛:]+|[\s"«»“”.,،؛:]+$/g;
/** the original text of a hadith's matched range as a footnote quotes it: at most FN_SOURCE_WORDS words, then "…"; "" when there is none */
export function sourceWording(text, max = FN_SOURCE_WORDS) {
  const ws = String(text || "").split(/\s+/).filter(Boolean);
  if (!ws.length) return "";
  const cut = ws.length > max;
  const body = (cut ? ws.slice(0, max) : ws).join(" ").replace(EDGE_PUNCT, "");
  return body ? body + (cut ? " …" : "") : "";
}
/**
 * The source's original words that replace the transcribed words of a VERBATIM hadith quotation in the document, or null.
 * The same rule as mushafText: only when the worker tied every spoken word to one word of the source (entry.sourceRun)
 * and the words standing in the document are the compared words. A partial match is never rewritten.
 */
export function sourceRunText(e, said) {
  if (!e || e.status !== "verbatim" || !e.sourceRun || !e.diff || !e.source || e.source.type !== "h" || e.source.via === "en") return null;
  const compared = e.diff.filter(d => d.spoken).map(d => d.spokenDisplay || "").join(" ");
  if (!compared || compared !== said.join(" ")) return null;
  // the document puts its own quotation marks around the words and keeps the transcript's closing punctuation after them
  return e.sourceRun.replace(EDGE_PUNCT, "") || null;
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const arDigits = s => String(s).replace(/\d/g, d => AR_DIGITS[+d]);
/**
 * The Mushaf text that replaces the transcribed words of one entry in the document, or null (the words stay as transcribed).
 * Only for a verbatim Qur'an match made directly in Arabic whose every word the worker tied to one word of the verse
 * (entry.mushaf), and only when the words standing in the document ARE the compared words — never a guess.
 * `said` is the entry's stretch of the document, word by word.
 */
export function mushafText(e, said) {
  if (!e || e.status !== "verbatim" || !e.mushaf || !e.diff || !e.source || e.source.type !== "q" || e.source.via === "en") return null;
  const compared = e.diff.filter(d => d.spoken).map(d => d.spokenDisplay || "").join(" ");
  if (!compared || compared !== said.join(" ")) return null;
  // verse numbers go inside the quotation marks ﴿ … ﴾ as (٤); the hizb ornament that opens an ayah is a page mark, not a word
  return e.mushaf.replace(/^۞\s*/, "").replace(/﴿(\d+)﴾/g, (_, k) => `(${arDigits(k)})`);
}

/**
 * words:   [{w}]            the transcript as shown (a word the reviewer corrected carries the corrected text; "" = removed)
 * ledger:  entries with wordStart / wordEnd (inclusive), status, source …
 * reviews: key -> {v, note} verdicts that belong to the findings as they are now
 * mushaf:  write verbatim Qur'an matches in Mushaf spelling (see mushafText)
 * hadithText: write verbatim hadith matches with the source's original (diacritised) words (see sourceRunText)
 * fixed:   how many transcript words the reviewer corrected (said in the closing note)
 * summary: put the committee summary after the subtitle
 * transcribers: who produced the transcript, in words (one name; two when a second transcription was compared) — said in the subtitle
 * -> { title, rtl, paragraphs, footnotes, counts }
 */
export function buildCitedDoc({ words, ledger, reviews = {}, title = "", date = "", mushaf = false, hadithText = false, fixed = 0, summary = true, transcribers = [] }) {
  const n = words.length, rtl = isArabic(words.slice(0, 60).map(w => w.w).join(" "));
  const owner = new Array(n).fill(null);
  const notes = new Map();      // entry -> footnote
  const counts = { total: 0, confirmed: 0, verbatim: 0, partial: 0, meaning: 0, notfound: 0, manual: 0, mushaf: 0, hadithText: 0, two: 0 };
  // what a person placed keeps its place; then the tool's findings in transcript order
  for (const e of [...ledger].sort((a, b) => (b.manual ? 1 : 0) - (a.manual ? 1 : 0) || a.wordStart - b.wordStart)) {
    const v = (reviews[e.key] || {}).v || null, fn = footnoteFor(e, v);
    if (!fn) continue;
    const a = Math.max(0, e.wordStart), b = Math.min(n - 1, e.wordEnd);
    if (a > b) continue;
    let free = true; for (let i = a; i <= b; i++) if (owner[i]) { free = false; break; }
    if (!free) continue;      // overlapping entries: the first one keeps the place
    for (let i = a; i <= b; i++) owner[i] = e;
    notes.set(e, fn); counts.total++; counts[statusOf(e)]++; if (statusOf(e) !== e.status) counts.two++; if (v === "yes") counts.confirmed++; if (e.manual) counts.manual++;
  }
  const footnotes = [], paragraphs = [];
  paragraphs.push({ style: "Title", runs: [{ text: title || t("doc.untitled") }] });
  const who = (Array.isArray(transcribers) ? transcribers : []).filter(x => typeof x === "string" && x);
  const by = who.length > 1 ? " " + t("doc.transcribers.two", who[0], who[1]) : who.length ? " " + t("doc.transcribers.one", who[0]) : "";
  paragraphs.push({ style: "Subtitle", rtl: undefined, runs: [{ text: t("doc.subtitle", date) + by }] });
  if (summary) {
    const lines = summaryLines(committeeSummary(ledger, reviews));
    paragraphs.push({ style: "SummaryHead", rtl: undefined, runs: [{ text: t("sumry.title") }] });
    for (const l of lines) paragraphs.push(l.value == null ? { style: "SummaryNote", rtl: undefined, runs: [{ text: l.label }] }
      : { style: "Summary", rtl: undefined, runs: [{ text: l.label + t("sumry.colon"), bold: true }, { text: l.value }] });
  }
  const open = k => (rtl ? (k === "q" ? "﴿" : "«") : "“"), close = k => (rtl ? (k === "q" ? "﴾" : "»") : "”");
  let runs = [], plain = [], inPara = 0;
  const flushPlain = () => { if (plain.length) { runs.push({ text: plain.join(" ") + " " }); plain = []; } };
  const flushPara = () => { flushPlain(); if (runs.length) paragraphs.push({ runs }); runs = []; inPara = 0; };
  for (let i = 0; i < n;) {
    const e = owner[i];
    if (!e) {
      if (!words[i].w) { i++; continue; }      // a word the reviewer removed
      plain.push(words[i].w); inPara++; i++;
      if (inPara >= PARA_MAX || (inPara >= PARA_MIN && SENTENCE_END.test(words[i - 1].w))) flushPara();
      continue;
    }
    flushPlain();
    const fn = notes.get(e), from = i, part = [];
    while (i < n && owner[i] === e) { if (words[i].w) part.push(words[i].w); i++; }
    inPara += i - from;
    const idx = footnotes.push({ runs: [{ text: fn.text }] }) - 1;
    let text = part.join(" "), tail = "";
    if (fn.quote) {
      const m = text.match(/[.,،؛:!?؟…]+$/); if (m) { tail = m[0]; text = text.slice(0, -tail.length); }
      const written = mushaf ? mushafText(e, part) : null;
      if (written) { text = written; counts.mushaf++; }
      const original = !written && hadithText ? sourceRunText(e, part) : null;
      if (original) { text = original; counts.hadithText++; }
      text = open(fn.kind) + text + close(fn.kind);
    }
    runs.push({ text, quote: fn.quote, note: idx });
    runs.push({ text: tail + " " });
  }
  flushPara();
  const closing = [t("doc.note.notes", String(counts.total), String(counts.confirmed))];
  if (counts.manual) closing.push(t("doc.note.manual", String(counts.manual)));
  if (ledger.some(e => e.agreement2)) closing.push(t("doc.note.two", String(counts.two)));
  if (counts.mushaf) closing.push(t("doc.note.mushaf"));
  if (counts.hadithText) closing.push(t("doc.note.hadithtext"));
  closing.push(fixed ? t("doc.note.fixed", String(fixed)) : counts.mushaf || counts.hadithText ? "" : t("doc.note.raw"));
  closing.push(t("doc.note.judge"));
  paragraphs.push({ style: "Note", runs: [{ text: closing.filter(Boolean).join(" ") }] });
  return { title: title || t("doc.untitled"), rtl, paragraphs, footnotes, counts };
}

export function citedDocx(args) {
  const d = buildCitedDoc(args);
  return { bytes: buildDocx({ title: d.title, rtl: d.rtl, lang: d.rtl ? "ar-SA" : "en-US", paragraphs: d.paragraphs, footnotes: d.footnotes }), counts: d.counts };
}

// ---------------- saved sessions ----------------
/**
 * everything needed to come back to a review later: the words (as transcribed), the title, the verdicts, the packs in use,
 * `manual` — the citations the reviewer added: [{a, b, ref, status, src}] (word range, stable source reference, status, a
 *            small description of the source for when it cannot be described again), and
 * `fixes`  — the transcript words the reviewer corrected: {word index: corrected text} ("" = the word was removed)
 */
export function toSession({ words, title, review, packs = [], video = null, manual = [], fixes = {}, words2 = null, transcribers = [] }) {
  const pack = ws => ws.map(w => (w.start != null ? [w.w, Math.round(w.start * 100) / 100, Math.round((w.end ?? w.start) * 100) / 100] : [w.w]));
  const out = { athar_session: 1, title, packs, video, words: pack(words), review,
    manual: cleanManual(manual, words.length), fixes: cleanFixes(fixes, words.length) };
  // a second transcription of the same recording (as transcribed), and who produced each: reopening compares them again
  if (Array.isArray(words2) && words2.length) out.words2 = pack(words2);
  const who = cleanTranscribers(transcribers); if (who.length) out.transcribers = who;
  return JSON.stringify(out, null, 0);
}
/** who produced the transcript(s): [{provider, model, name}], at most two, short strings only */
export function cleanTranscribers(list) {
  const out = [], str = (x, n) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, n) : "");
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || typeof x !== "object") continue;
    const item = { provider: str(x.provider, 40), model: str(x.model, 80), name: str(x.name, 200) };
    if (item.provider || item.name) out.push(item);
    if (out.length === 2) break;
  }
  return out;
}
const MANUAL_STATUS = ["verbatim", "partial", "meaning"], SRC_TEXT = ["type", "label", "short", "url", "collection", "ref"], SRC_NUM = ["surah", "ayah", "ayahEnd"];
/** the reviewer's own additions, cleaned: anything that is not a word range inside the transcript with a source reference is dropped */
export function cleanManual(list, n) {
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    if (!m || typeof m !== "object" || !Number.isInteger(m.a) || !Number.isInteger(m.b) || m.a < 0 || m.b < m.a || m.b >= n) continue;
    if (typeof m.ref !== "string" || !m.ref || m.ref.length > 200 || out.some(x => x.a <= m.b && m.a <= x.b)) continue;
    const src = { ref: m.ref };
    if (m.src && typeof m.src === "object") {
      for (const k of SRC_TEXT) if (typeof m.src[k] === "string" && k !== "ref") src[k] = m.src[k].slice(0, 400);
      for (const k of SRC_NUM) if (Number.isInteger(m.src[k])) src[k] = m.src[k];
      if (typeof m.src.number === "string" || Number.isFinite(m.src.number)) src.number = String(m.src.number).slice(0, 40);
      if (src.url && !/^https:\/\//.test(src.url)) delete src.url;
    }
    if (!["q", "h", "b"].includes(src.type)) src.type = /^\d+:\d+/.test(m.ref) ? "q" : "h";
    out.push({ a: m.a, b: m.b, ref: m.ref, status: MANUAL_STATUS.includes(m.status) ? m.status : "meaning", src });
  }
  return out.sort((x, y) => x.a - y.a);
}
/** the reviewer's corrections, cleaned: {index inside the transcript: text of at most 200 characters, on one line} */
export function cleanFixes(fixes, n) {
  const out = {};
  if (fixes && typeof fixes === "object") for (const [k, v] of Object.entries(fixes)) {
    const i = Number(k);
    if (!/^\d+$/.test(k) || !Number.isInteger(i) || i >= n || typeof v !== "string") continue;
    out[i] = v.replace(/\s+/g, " ").trim().slice(0, 200);
  }
  return out;
}
/** -> { words, title, review, packs, video, manual, fixes, words2, transcribers } or null when the object is not a saved session */
export function fromSession(j) {
  if (!j || typeof j !== "object" || j.athar_session !== 1 || !Array.isArray(j.words)) return null;
  const unpack = list => {
    const out = [];
    for (const x of list) {
      if (!Array.isArray(x) || typeof x[0] !== "string" || !x[0].trim()) continue;
      const ok = Number.isFinite(x[1]) && Number.isFinite(x[2]);
      out.push(ok ? { w: x[0], start: x[1], end: x[2] } : { w: x[0] });
    }
    return out;
  };
  const words = unpack(j.words), second = Array.isArray(j.words2) ? unpack(j.words2) : [];
  const review = {};
  if (j.review && typeof j.review === "object") for (const [k, r] of Object.entries(j.review)) {
    if (!r || typeof r !== "object") continue;
    review[k] = { v: ["yes", "no", "unsure"].includes(r.v) ? r.v : null, note: typeof r.note === "string" ? r.note.slice(0, 2000) : "", sig: typeof r.sig === "string" ? r.sig : "" };
  }
  return { words, title: typeof j.title === "string" ? j.title.slice(0, 300) : "", review, packs: Array.isArray(j.packs) ? j.packs.filter(x => typeof x === "string") : [],
    video: typeof j.video === "string" ? j.video : null, manual: cleanManual(j.manual, words.length), fixes: cleanFixes(j.fixes, words.length),
    words2: second.length >= 4 ? second : null, transcribers: cleanTranscribers(j.transcribers) };
}

// ---------------- summary for the review committee ----------------
const TEXTUAL = ["verbatim", "partial"], STATUSES = ["verbatim", "partial", "meaning", "lead", "notfound"];
/**
 * Counts taken from the ledger as it is now and the verdicts that belong to it.
 * A "citation" in quran / hadith / books is a textual match (verbatim or partial) or an entry the reviewer added,
 * unless the reviewer marked it incorrect.
 */
export function committeeSummary(ledger, reviews = {}) {
  const s = { total: ledger.length, quran: 0, hadith: 0, books: 0, collections: {}, notfound: 0, attribution: 0, manual: 0, graded: { weak: 0, strong: 0 }, distinctHadith: 0, weakMention: 0, weakOnly: 0,
    status: Object.fromEntries(STATUSES.map(k => [k, 0])), review: { yes: 0, no: 0, unsure: 0, none: 0 },
    two: null };      // when a second transcription was compared: {verbatim, confirmed, unresolved}
  if (ledger.some(e => e.agreement2)) s.two = { verbatim: 0, confirmed: 0, unresolved: 0 };
  let seen = null;
  for (const e of ledger) {
    const v = (reviews[e.key] || {}).v || null;
    s.review[["yes", "no", "unsure"].includes(v) ? v : "none"]++;
    const status = statusOf(e);
    if (s.status[status] != null) s.status[status]++;
    if (s.two && e.agreement2 && e.agreement2.paired) { if (status !== e.status) s.two.verbatim++; s.two.confirmed += e.agreement2.confirmed; s.two.unresolved += e.agreement2.unresolved; }
    if (e.manual) s.manual++;
    if (status === "notfound" && e.cue) s.notfound++;
    if (e.attribution && e.attribution.agrees === false) s.attribution++;
    if (v !== "no" && e.spokenGrades) for (const k of new Set(e.spokenGrades.map(g => g.kind))) s.graded[k]++;
    if (v === "no" || !e.source || !(e.manual || TEXTUAL.includes(status))) continue;
    if (e.weakBooks && e.weakBooks.length) { s.weakMention++; if (e.weakOnly) s.weakOnly++; }
    if (e.weakOnly) continue;                      // a text found only in a book of weak / fabricated hadith is counted on its own line, not as a source
    if (e.source.type === "q") s.quran++;
    else if (e.source.type === "b") s.books++;
    else { s.hadith++; const c = e.source.collection || "?"; s.collections[c] = (s.collections[c] || 0) + 1; (seen || (seen = new Set())).add(e.source.ref || e.source.label); }
  }
  s.distinctHadith = seen ? seen.size : 0;
  return s;
}
/** the summary as lines in the interface language: [{label, value}] (value null = a remark) */
export function summaryLines(s) {
  const sep = t("sumry.sep"), pair = (label, k) => `${label} ${num(k)}`;
  const cols = Object.entries(s.collections).sort((a, b) => b[1] - a[1]).map(([c, k]) => pair(collectionName(c), k)).join(sep);
  return [
    { label: t("sumry.quran"), value: num(s.quran) },
    { label: t("sumry.hadith"), value: num(s.hadith) + (cols ? ` (${cols})` : "") },
    ...(s.hadith > 0 ? [{ label: t("sumry.distinct"), value: num(s.distinctHadith) }] : []),
    { label: t("sumry.books"), value: num(s.books) },
    ...(s.weakMention ? [{ label: t("sumry.weak"), value: num(s.weakMention) + (s.weakOnly ? ` (${t("sumry.weakonly")}: ${num(s.weakOnly)})` : "") }] : []),
    { label: t("sumry.notfound"), value: num(s.notfound) },
    { label: t("sumry.attr"), value: num(s.attribution) },
    ...(s.graded.weak + s.graded.strong ? [{ label: t("sumry.grade"), value: `${num(s.graded.weak)} / ${num(s.graded.strong)}` }] : []),
    { label: t("sumry.status"), value: STATUSES.map(k => pair(t("short." + k), s.status[k])).join(sep) },
    ...(s.two ? [{ label: t("sumry.two"), value: t("sumry.two.value", num(s.two.verbatim), num(s.two.confirmed), num(s.two.unresolved)) }] : []),
    { label: t("sumry.review"), value: [["yes", "rv.yes"], ["no", "rv.no"], ["unsure", "rv.unsure"], ["none", "sumry.none"]].map(([k, key]) => pair(t(key), s.review[k])).join(sep) },
    { label: t("sumry.manual"), value: num(s.manual) },
    { label: t("sumry.rule"), value: null },
  ];
}

// ---------------- citation index for a video description ----------------
const QUOTE_WORDS = 8;
/**
 * One line per textual citation that has a time (verbatim, partial, or added by the reviewer), without those marked incorrect:
 *   0:17 آية — سورة القلم ٤
 *   0:46 حديث — صحيح مسلم 47a: من كان يؤمن بالله واليوم الآخر…
 * intro: put "0:00 المقدمة" first when no citation starts at 0:00 (video sites want chapter lists to begin at 0:00).
 */
export function descriptionIndex(ledger, reviews = {}, { intro = false } = {}) {
  const ar = getLang() === "ar", lines = [];
  const list = ledger.filter(e => e.source && (e.manual || TEXTUAL.includes(statusOf(e))) && Number.isFinite(e.start) && (reviews[e.key] || {}).v !== "no")
    .sort((a, b) => a.start - b.start || a.wordStart - b.wordStart);
  for (const e of list) {
    const s = e.source, time = fmtTime(e.start);
    if (s.type === "q") {
      const many = (s.ayahEnd || s.ayah) !== s.ayah, label = srcLabel(s, true);
      lines.push(`${time} ${t(many ? "idx.verses" : "idx.verse")} — ${ar ? t("idx.surah", arDigits(label)) : label}`);
    } else {
      const ws = String(e.spoken || "").split(/\s+/).filter(Boolean), said = ws.slice(0, QUOTE_WORDS).join(" ").replace(/[.,،؛:!?؟…]+$/, "") + (ws.length > QUOTE_WORDS ? "…" : "");
      // found only in a book of weak / fabricated hadith: the line says so, it is never listed as a plain source
      lines.push(`${time} ${t(s.type === "b" && !e.weakOnly ? "idx.book" : "idx.hadith")} — ${e.weakOnly ? t("idx.weakonly", srcLabel(s, true)) : srcLabel(s, true)}${said ? ": " + said : ""}`);
    }
  }
  if (intro && lines.length && fmtTime(list[0].start) !== "0:00") lines.unshift(`0:00 ${t("idx.intro")}`);
  return lines.join("\n");
}

// ---------------- pasted video transcripts ----------------
const STAMP = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*$/, STAMP_LEAD = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(\S.*)$/;
const SPOKEN_TIME = /^\s*\d+\s*(seconds?|minutes?|hours?|ثانية|ثوان[ٍي]?|دقيقة|دقائق|ساعة|ساعات)\b/i;
/** "0:00 ⏎ text ⏎ 0:05 ⏎ text …" as copied from a video site's transcript panel -> [{w,start,end}] or null when the text is not of that shape */
export function parseStampedText(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const segs = []; let cur = null, stamps = 0, last = -1, back = 0;
  const sec = m => (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3];
  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue;
    let m = line.match(STAMP);
    if (m) { const s = sec(m); if (s < last) back++; last = s; cur = { start: s, text: [] }; segs.push(cur); stamps++; continue; }
    m = line.match(STAMP_LEAD);
    if (m) { const s = sec(m); if (s < last) back++; last = s; cur = { start: s, text: [m[4]] }; segs.push(cur); stamps++; continue; }
    if (SPOKEN_TIME.test(line) && line.length < 40) continue;      // "1 minute, 5 seconds" read-aloud labels
    if (cur) cur.text.push(line);
  }
  if (stamps < 3 || back > stamps / 10) return null;
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const ws = segs[i].text.join(" ").split(/\s+/).filter(Boolean); if (!ws.length) continue;
    let next = null; for (let k = i + 1; k < segs.length; k++) if (segs[k].start > segs[i].start) { next = segs[k].start; break; }
    const a = segs[i].start, b = next != null ? Math.min(next, a + 30) : a + Math.max(2, ws.length * 0.4), d = (b - a) / ws.length;
    ws.forEach((w, k) => out.push({ w, start: a + k * d, end: a + (k + 1) * d }));
  }
  return out.length >= 4 ? out : null;
}
/** a YouTube link in any common form -> the 11-character video id, or null */
export function youtubeId(url) {
  const m = String(url || "").trim().match(/^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#/].*)?$/);
  return m ? m[1] : null;
}

// ---------------- the whole transcript, to read or to keep ----------------
const SENT_END = /[.!?؟…]["'»”)]*$/;
/**
 * The transcript cut into paragraphs for reading: at a sentence end once a paragraph has 40 words, at a pause of 2.5 s
 * once it has 12, and at 90 words whatever comes. -> [{from, to}] (word indexes, `to` exclusive)
 */
export function transcriptParagraphs(words) {
  const out = []; let from = 0;
  for (let i = 0; i < words.length; i++) {
    const n = i - from + 1, last = i === words.length - 1;
    const pause = !last && Number.isFinite(words[i].end) && Number.isFinite(words[i + 1].start) && words[i + 1].start - words[i].end >= 2.5;
    if (last || n >= 90 || (n >= 40 && SENT_END.test(words[i].w)) || (n >= 12 && pause)) { out.push({ from, to: i + 1 }); from = i + 1; }
  }
  return out;
}
/** plain text, one paragraph per line; with `timed`, each paragraph begins with the time of its first word: "[12:05] ..." */
export function transcriptText(words, { timed = false } = {}) {
  return transcriptParagraphs(words).map(p => {
    const text = words.slice(p.from, p.to).map(w => w.w).join(" "), at = words[p.from].start;
    return timed && Number.isFinite(at) ? `[${fmtTime(at)}] ${text}` : text;
  }).join("\n\n") + (words.length ? "\n" : "");
}
const srtTime = s => { const ms = Math.max(0, Math.round(s * 1000)), p = (x, n = 2) => String(x).padStart(n, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
/** subtitles (SRT): cues of at most 10 words and 6 seconds, closed early at a sentence end or a pause. "" when the words carry no times. */
export function transcriptSrt(words) {
  if (!words.length || !words.every(w => Number.isFinite(w.start) && Number.isFinite(w.end))) return "";
  const cues = []; let from = 0;
  for (let i = 0; i < words.length; i++) {
    const n = i - from + 1, last = i === words.length - 1;
    const long = words[i].end - words[from].start >= 6, pause = !last && words[i + 1].start - words[i].end >= 1.2;
    if (last || n >= 10 || long || pause || (n >= 4 && SENT_END.test(words[i].w))) { cues.push([from, i + 1]); from = i + 1; }
  }
  return cues.map(([a, b], k) => {
    const start = words[a].start, next = k + 1 < cues.length ? words[cues[k + 1][0]].start : Infinity;
    const end = Math.min(Math.max(words[b - 1].end, start + 0.4), Math.max(next, start + 0.1));      // a cue never runs into the next one
    return `${k + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${words.slice(a, b).map(w => w.w).join(" ")}\n`;
  }).join("\n");
}
