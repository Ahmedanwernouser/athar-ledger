// flags.js — what makes a ledger entry worth a second look whatever its match status.
// A display layer only: the finding itself (status, source) is untouched. Used by the page, the CSV and the video index.
//   weak         found only in books of weak / fabricated hadith
//   weakmention  the ordinary source stands, and such a book mentions the text too
//   attr         the speaker named another place than where the text was found
//   tail         what was presented as the text runs on with words that are not the source's
//   grade        the speaker himself called the hadith weak
export function flagsOf(e) {
  const f = [];
  if (e.weakOnly) f.push("weak"); else if (e.weakBooks && e.weakBooks.length) f.push("weakmention");
  if (e.attribution && e.attribution.agrees === false) f.push("attr");
  if (e.tailUnmatched) f.push("tail");
  if ((e.spokenGrades || []).some(g => g.kind === "weak")) f.push("grade");
  return f;
}
