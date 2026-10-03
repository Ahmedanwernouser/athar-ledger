// exporter.js — ledger -> CSV / JSON files. Headers and fixed values follow the interface language.
import { fmtTime } from "./text.js";
import { t, tOpt, srcLabel } from "./i18n.js";

const COLS = ["id", "start", "end", "word", "kind", "status", "fidelity", "agreement", "spoken", "source", "ref", "url", "parallels", "attr", "review", "note"];

/** review: key -> {v, note} holding only verdicts that belong to the finding as it is now (stale ones are left out by the caller) */
export function toRows(ledger, review = {}) {
  return ledger.map(e => {
    const rv = review[e.key] || {};
    return {
      id: e.id, start: fmtTime(e.start), end: fmtTime(e.end), word: e.wordStart == null ? "" : e.wordStart + 1,
      kind: tOpt("kind." + (e.source && e.source.type === "b" ? "b" : e.type)), status: tOpt("status." + e.status) || e.statusAr || "", fidelity: tOpt("fid." + e.status) || e.fidelity || "",
      agreement: e.agreement == null ? "" : Math.round(e.agreement * 100) + "%",
      spoken: e.spoken, source: e.source ? srcLabel(e.source) : "", ref: e.source ? e.source.ref : "",
      url: e.source ? e.source.url || "" : "", parallels: (e.parallels || []).map(p => srcLabel(p, true)).join("؛ "),
      attr: e.attribution ? tOpt("attr." + e.attribution.code) || e.attribution.text || "" : "",
      review: rv.v ? tOpt("rv." + rv.v) : "", note: rv.note || "",
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
  const rows = toRows(ledger, review);
  return "﻿" + [COLS.map(c => csvCell(t("csv." + c))).join(","), ...rows.map(r => COLS.map(c => csvCell(r[c])).join(","))].join("\r\n");
}
export function toJson(ledger, review, meta) {
  return JSON.stringify({ tool: t("export.tool"), ...meta, disclaimer: t("export.disclaimer"),
    ledger: ledger.map(e => ({ ...e, diff: undefined, review: review[e.key] || null })) }, null, 1);
}
export function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
