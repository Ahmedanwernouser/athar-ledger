// flags.js — what makes a ledger entry worth a second look whatever its match status.
// A display layer only: the finding itself (status, source) is untouched. Used by the page, the CSV and the video index.
//   weak         not in the ordinary hadith books; found in a book OF fabricated hadith (الموضوعات ...)
//   mush         not in the ordinary hadith books; found only in a book that rules on sayings in wide circulation (المقاصد الحسنة ...)
//   weakmention  the ordinary source stands, and a book of fabricated hadith has the text too
//                (a book of widespread sayings also holds sound hadith: being in one, beside an ordinary source, is no alert)
//   attr         the speaker named another place than where the text was found
//   tail         what was presented as the text runs on with words that are not the source's
//   grade        the speaker himself called the hadith weak
const mawdu = e => (e.weakBooks || []).some(w => w.weakKind !== "mushtahir");
export function flagsOf(e) {
  const f = [];
  if (e.weakOnly) f.push(mawdu(e) ? "weak" : "mush"); else if (mawdu(e)) f.push("weakmention");
  if (e.attribution && e.attribution.agrees === false) f.push("attr");
  if (e.tailUnmatched) f.push("tail");
  if ((e.spokenGrades || []).some(g => g.kind === "weak")) f.push("grade");
  return f;
}
