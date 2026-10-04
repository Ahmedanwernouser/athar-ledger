// exporter.js — ledger -> CSV / JSON files. Headers and fixed values follow the interface language.
import { fmtTime } from "./text.js";
import { t, tOpt, srcLabel } from "./i18n.js";
import { statusOf } from "./agree.js";

const COLS = ["id", "start", "end", "word", "kind", "status", "fidelity", "agreement", "spoken", "source", "ref", "url", "sourceText", "parallels", "attr", "review", "note", "origin"];
// when a second transcription was compared (agree.js): `status` is the status the two support together, and these follow it
const TWO_COLS = ["statusStrict", "two", "twoConfirmed", "twoDisagree", "twoUnresolved"];
const colsFor = ledger => (ledger.some(e => e.agreement2) ? [...COLS.slice(0, 6), ...TWO_COLS, ...COLS.slice(6)] : COLS);

/**
 * The original text of the source where the match is, when the worker attached it: the verse(s) as the Mushaf writes them,
 * the matched words of a hadith in the dataset's own wording (diacritics kept). "" otherwise.
 */
export function sourceTextOf(e) {
  const s = e && e.source;
  if (!s || typeof s.display !== "string" || !["verbatim", "partial"].includes(e.status)) return "";
  return s.type === "q" || s.type === "h" ? s.display : "";
}
/** review: key -> {v, note} holding only verdicts that belong to the finding as it is now (stale ones are left out by the caller) */
export function toRows(ledger, review = {}) {
  return ledger.map(e => {
    const rv = review[e.key] || {}, status = statusOf(e), g = e.agreement2 || null;
    return {
      statusStrict: tOpt("status." + e.status) || e.statusAr || "", two: g ? t("two.verdict." + (g.paired ? g.verdict : "unpaired")) : "",
      twoConfirmed: g && g.paired ? g.confirmed : "", twoDisagree: g && g.paired ? g.disagree : "", twoUnresolved: g && g.paired ? g.unresolved : "",
      id: e.id, start: fmtTime(e.start), end: fmtTime(e.end), word: e.wordStart == null ? "" : e.wordStart + 1,
      kind: tOpt("kind." + (e.source && e.source.type === "b" ? "b" : e.type)), status: tOpt("status." + status) || e.statusAr || "", fidelity: tOpt("fid." + status) || e.fidelity || "",
      agreement: e.agreement == null ? "" : Math.round(e.agreement * 100) + "%",
      spoken: e.spoken, source: e.source ? srcLabel(e.source) : "", ref: e.source ? e.source.ref : "",
      url: e.source ? e.source.url || "" : "", sourceText: sourceTextOf(e), parallels: (e.parallels || []).map(p => srcLabel(p, true)).join("؛ "),
      attr: e.attribution ? tOpt("attr." + e.attribution.code) || e.attribution.text || "" : "",
      review: rv.v ? tOpt("rv." + rv.v) : "", note: rv.note || "", origin: e.manual ? t("csv.origin.manual") : e.pass === "t2" ? t("csv.origin.second") : "",
    };
  });
}
/** A cell that a spreadsheet would run as a formula (= + - @, tab, carriage return first) is neutralised with a leading apostrophe. */
export function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
export function toCsv(ledger, review) {
  const rows = toRows(ledger, review), COLS = colsFor(ledger);
  return "﻿" + [COLS.map(c => csvCell(t("csv." + c))).join(","), ...rows.map(r => COLS.map(c => csvCell(r[c])).join(","))].join("\r\n");
}
export function toJson(ledger, review, meta) {
  return JSON.stringify({ tool: t("export.tool"), ...meta, disclaimer: t("export.disclaimer"),
    ledger: ledger.map(e => ({ ...e, diff: undefined, sourceText: sourceTextOf(e) || undefined, review: review[e.key] || null })) }, null, 1);
}
export function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
