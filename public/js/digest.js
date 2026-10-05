// digest.js — what the page tells the worker about one ledger entry so that it can build the digest (worker.js: buildDigest):
// which source, and which of the source's words this entry said (the positions the comparison established, diff[i].srcPos).
// An entry takes part when it names a hadith of the collections or a passage of the Qur'an: found word for word, with
// differences, or — a hadith only — by meaning (then it is listed under its hadith with no words marked).
export function digestItem(e) {
  const s = e && e.source;
  if (!s || e.weakOnly || s.via === "en" || !["verbatim", "partial", "meaning"].includes(e.status) || (s.type !== "h" && s.type !== "q")) return null;
  if (s.type === "q" && e.status === "meaning") return null;
  const keyed = typeof e.posKey === "string", said = [];
  if (keyed) for (const d of e.diff || []) if (d.srcPos != null && d.kind !== "del") for (let k = 0; k < (d.srcN || 1); k++) said.push(d.srcPos + k);
  return { id: e.id, type: s.type, ref: s.ref, surah: s.surah, ayah: s.ayah, ayahEnd: s.ayahEnd, keyed, said, parallels: (e.parallels || []).filter(p => p.type === "h").map(p => p.ref) };
}
