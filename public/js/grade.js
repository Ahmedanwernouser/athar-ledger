// grade.js — what the dataset records about the standing of a hadith, in one line. A display layer: the tool grades nothing.
// Sources: the gradings copied with their scholars' names (hadith-api; every hadith of the four Sunan and the Muwatta has one),
// and the plain fact that a hadith stands in Sahih al-Bukhari or Sahih Muslim (the dataset records no grading for those two,
// so without this line the soundest hadith of all would look as if nothing were known about them).

const WEAK = /ضعيف|منكر|موضوع|باطل|شاذ|معلول|Daif|Munkar|Malool|Shadh|Maudu|Batil/i;
const STRONG = /صحيح|حسن|Sahih|Hasan/i;
/** "strong" (sahih / hasan in any form), "weak", or "neutral" (a word about the KIND of report only: موقوف, مقطوع, مرسل) */
export function gradeClass(text) {
  const s = String(text || "");
  if (WEAK.test(s)) return "weak";
  if (STRONG.test(s)) return "strong";
  return "neutral";
}
const SAHIHAYN = new Set(["bukhari", "muslim"]);
const most = list => { const c = new Map(); for (const x of list) c.set(x, (c.get(x) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0][0]; };

/**
 * One hadith source (as corpus.describe gives it: collection, grades [{by, grade}]) and the other places the same words stand.
 * -> null for anything that is not a hadith of the collections, else
 *    { kind: "sahihayn", collection }                                   it stands in one of the two Sahih
 *    { kind: "strong" | "weak", grade, by: [names], also }              every recorded grading agrees
 *    { kind: "mixed", strong: {grade, by}, weak: {grade, by}, also }    the recorded gradings differ
 *    { kind: "none", also }                                             nothing recorded for this source
 *    `also`: a collection among the parallels that is one of the two Sahih (or null)
 */
export function gradeSummary(source, parallels = []) {
  if (!source || source.type !== "h" || source.weak || !source.collection) return null;
  if (SAHIHAYN.has(source.collection)) return { kind: "sahihayn", collection: source.collection };
  const alsoIn = (parallels || []).find(p => p && p.type === "h" && SAHIHAYN.has(p.collection));
  const also = alsoIn ? alsoIn.collection : null;
  const gs = (source.grades || []).map(g => ({ ...g, cls: gradeClass(g.grade) })).filter(g => g.cls !== "neutral");
  if (!gs.length) {
    const kindOnly = (source.grades || [])[0];
    return { kind: "none", also, ...(kindOnly ? { note: kindOnly.grade } : {}) };
  }
  const side = cls => { const x = gs.filter(g => g.cls === cls); return x.length ? { grade: most(x.map(g => g.grade)), by: [...new Set(x.map(g => g.by))] } : null; };
  const strong = side("strong"), weak = side("weak");
  if (strong && weak) return { kind: "mixed", strong, weak, also };
  const one = strong || weak;
  return { kind: strong ? "strong" : "weak", grade: one.grade, by: one.by, also };
}
/** is this a hadith whose every recorded grading is weak, with no place in the two Sahih? (worth an alert) */
export function gradedWeak(source, parallels) { const g = gradeSummary(source, parallels); return !!g && g.kind === "weak" && !g.also; }
