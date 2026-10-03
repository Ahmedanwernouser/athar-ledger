// report.js — the transcript as a document with sourced footnotes ("نص مخرَّج").
// The words stay exactly as transcribed; every textual citation is set off as a quotation and gets a footnote with its source.
// Footnotes are an automatic draft: one a person has confirmed ("صحيح") is printed plain, every other one carries a "*".
// An entry a person marked "غير صحيح" gets no footnote at all.
import { t, srcLabel } from "./i18n.js";
import { buildDocx } from "./docx.js";

const SENTENCE_END = /[.!?؟…]["'»”)]*$/;
const PARA_MAX = 180, PARA_MIN = 70;
const isArabic = s => /[؀-ۿ]/.test(s);

/** what the footnote of one ledger entry says, or null when the entry gets none */
export function footnoteFor(e, verdict) {
  if (verdict === "no") return null;
  const s = e.source, star = verdict === "yes" ? "" : " *";
  if ((e.status === "verbatim" || e.status === "partial") && s) {
    let x = srcLabel(s);
    const others = (e.parallels || []).filter(p => p.type !== "b").slice(0, 3).map(p => srcLabel(p, true));
    if (s.type !== "q" && others.length) x += t("doc.fn.also", others.join(t("doc.sep"))) + ((e.parallels || []).filter(p => p.type !== "b").length > 3 ? t("doc.fn.more") : "");
    x += ".";
    if (e.status === "partial") x += " " + t(s.type === "q" ? "doc.fn.partial.q" : "doc.fn.partial.h");
    if (e.status === "partial" && s.type === "q" && s.display && s.via !== "en") x += " " + s.display;
    if (s.via === "en") x += " " + t("doc.fn.viaen");
    if (e.attribution && e.attribution.agrees === false) x += " " + t("doc.fn.attr");
    if (e.tailUnmatched) x += " " + t("doc.fn.tail");
    if (verdict === "unsure") x += " " + t("doc.fn.unsure");
    return { text: x + star, quote: true, kind: s.type };
  }
  if (e.status === "meaning" && s) return { text: t("doc.fn.meaning", srcLabel(s)) + star, quote: false, kind: s.type };
  if (e.status === "notfound" && ["quran", "hadith"].includes(e.cue)) return { text: t("doc.fn.notfound") + star, quote: false, kind: e.cue === "quran" ? "q" : "h" };
  return null;
}

/**
 * words:   [{w}]            the transcript as shown
 * ledger:  entries with wordStart / wordEnd (inclusive), status, source …
 * reviews: key -> {v, note} verdicts that belong to the findings as they are now
 * -> { title, rtl, paragraphs, footnotes, counts }
 */
export function buildCitedDoc({ words, ledger, reviews = {}, title = "", date = "" }) {
  const n = words.length, rtl = isArabic(words.slice(0, 60).map(w => w.w).join(" "));
  const owner = new Array(n).fill(null);
  const notes = new Map();      // entry -> footnote
  const counts = { total: 0, confirmed: 0, verbatim: 0, partial: 0, meaning: 0, notfound: 0 };
  for (const e of [...ledger].sort((a, b) => a.wordStart - b.wordStart)) {
    const v = (reviews[e.key] || {}).v || null, fn = footnoteFor(e, v);
    if (!fn) continue;
    const a = Math.max(0, e.wordStart), b = Math.min(n - 1, e.wordEnd);
    if (a > b) continue;
    let free = true; for (let i = a; i <= b; i++) if (owner[i]) { free = false; break; }
    if (!free) continue;      // overlapping entries: the first one keeps the place
    for (let i = a; i <= b; i++) owner[i] = e;
    notes.set(e, fn); counts.total++; counts[e.status]++; if (v === "yes") counts.confirmed++;
  }
  const footnotes = [], paragraphs = [];
  paragraphs.push({ style: "Title", runs: [{ text: title || t("doc.untitled") }] });
  paragraphs.push({ style: "Subtitle", rtl: undefined, runs: [{ text: t("doc.subtitle", date) }] });
  const open = k => (rtl ? (k === "q" ? "﴿" : "«") : "“"), close = k => (rtl ? (k === "q" ? "﴾" : "»") : "”");
  let runs = [], plain = [], inPara = 0;
  const flushPlain = () => { if (plain.length) { runs.push({ text: plain.join(" ") + " " }); plain = []; } };
  const flushPara = () => { flushPlain(); if (runs.length) paragraphs.push({ runs }); runs = []; inPara = 0; };
  for (let i = 0; i < n;) {
    const e = owner[i];
    if (!e) {
      plain.push(words[i].w); inPara++; i++;
      if (inPara >= PARA_MAX || (inPara >= PARA_MIN && SENTENCE_END.test(words[i - 1].w))) flushPara();
      continue;
    }
    flushPlain();
    const fn = notes.get(e), from = i, part = [];
    while (i < n && owner[i] === e) part.push(words[i++].w);
    inPara += i - from;
    const idx = footnotes.push({ runs: [{ text: fn.text }] }) - 1;
    let text = part.join(" "), tail = "";
    if (fn.quote) { const m = text.match(/[.,،؛:!?؟…]+$/); if (m) { tail = m[0]; text = text.slice(0, -tail.length); } text = open(fn.kind) + text + close(fn.kind); }
    runs.push({ text, quote: fn.quote, note: idx });
    runs.push({ text: tail + " " });
  }
  flushPara();
  paragraphs.push({ style: "Note", runs: [{ text: t("doc.note", String(counts.total), String(counts.confirmed)) }] });
  return { title: title || t("doc.untitled"), rtl, paragraphs, footnotes, counts };
}

export function citedDocx(args) {
  const d = buildCitedDoc(args);
  return { bytes: buildDocx({ title: d.title, rtl: d.rtl, lang: d.rtl ? "ar-SA" : "en-US", paragraphs: d.paragraphs, footnotes: d.footnotes }), counts: d.counts };
}

// ---------------- saved sessions ----------------
/** everything needed to come back to a review later: the words, the title, the verdicts, the packs in use */
export function toSession({ words, title, review, packs = [], video = null }) {
  return JSON.stringify({ athar_session: 1, title, packs, video,
    words: words.map(w => (w.start != null ? [w.w, Math.round(w.start * 100) / 100, Math.round((w.end ?? w.start) * 100) / 100] : [w.w])), review }, null, 0);
}
/** -> { words, title, review, packs, video } or null when the object is not a saved session */
export function fromSession(j) {
  if (!j || typeof j !== "object" || j.athar_session !== 1 || !Array.isArray(j.words)) return null;
  const words = [];
  for (const x of j.words) {
    if (!Array.isArray(x) || typeof x[0] !== "string" || !x[0].trim()) continue;
    const ok = Number.isFinite(x[1]) && Number.isFinite(x[2]);
    words.push(ok ? { w: x[0], start: x[1], end: x[2] } : { w: x[0] });
  }
  const review = {};
  if (j.review && typeof j.review === "object") for (const [k, r] of Object.entries(j.review)) {
    if (!r || typeof r !== "object") continue;
    review[k] = { v: ["yes", "no", "unsure"].includes(r.v) ? r.v : null, note: typeof r.note === "string" ? r.note.slice(0, 2000) : "", sig: typeof r.sig === "string" ? r.sig : "" };
  }
  return { words, title: typeof j.title === "string" ? j.title.slice(0, 300) : "", review, packs: Array.isArray(j.packs) ? j.packs.filter(x => typeof x === "string") : [],
    video: typeof j.video === "string" ? j.video : null };
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
