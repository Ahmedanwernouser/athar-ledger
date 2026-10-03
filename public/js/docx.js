// docx.js — a minimal .docx writer with real footnotes, no dependencies.
// A .docx is a zip of XML parts; the zip is written uncompressed ("stored"), which every word processor reads.
//
//   buildDocx({ title, rtl, lang, paragraphs, footnotes }) -> Uint8Array
//     paragraphs: [{ style?: "Title"|"Subtitle"|"Heading"|"SummaryHead"|"Summary"|"SummaryNote"|"Note", runs: [run] }]
//     run:        { text, bold?, quote?, rtl?, note?: footnoteIndex }   (note = index into `footnotes`, placed after the text)
//     footnotes:  [{ runs: [run] }]

const enc = new TextEncoder();
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/** files: [[name, Uint8Array|string]] -> Uint8Array (zip, stored, UTF-8 names, fixed date so the output is reproducible) */
export function zipStore(files) {
  const parts = [], central = []; let off = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const [name, data] of files) {
    const nb = enc.encode(name), d = typeof data === "string" ? enc.encode(data) : data, crc = crc32(d);
    const head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(d.length), ...u32(d.length), ...u16(nb.length), ...u16(0)];
    parts.push(Uint8Array.from(head), nb, d);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(d.length), ...u32(d.length),
      ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
    off += head.length + nb.length + d.length;
  }
  let csize = 0; for (const c of central) csize += c.length;
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(off), ...u16(0)]);
  const all = [...parts, ...central, end]; let total = 0; for (const p of all) total += p.length;
  const out = new Uint8Array(total); let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

// characters XML 1.0 does not allow are dropped; the rest is escaped
const esc = s => String(s ?? "").replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isArabic = s => /[؀-ۿ]/.test(s);

function runXml(r, docRtl) {
  const rtl = r.rtl ?? (r.text ? isArabic(r.text) : docRtl);
  const pr = [];
  if (r.quote) pr.push('<w:rStyle w:val="Quote"/>');
  if (r.bold) pr.push("<w:b/><w:bCs/>");
  if (rtl) pr.push("<w:rtl/>");
  let x = r.text ? `<w:r><w:rPr>${pr.join("")}</w:rPr><w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>` : "";
  if (r.note != null) x += `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${r.note + 2}"/></w:r>`;
  return x;
}
const paraXml = (p, docRtl) => `<w:p><w:pPr>${p.style ? `<w:pStyle w:val="${p.style}"/>` : ""}${(p.rtl ?? docRtl) ? "<w:bidi/>" : ""}</w:pPr>${p.runs.map(r => runXml(r, docRtl)).join("")}</w:p>`;

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function buildDocx({ title = "", rtl = true, lang = "ar-SA", paragraphs = [], footnotes = [] }) {
  const font = "Amiri", ui = "IBM Plex Sans Arabic";
  const fonts = f => `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>`;
  const styles = `${XML}<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr>${fonts(font)}<w:sz w:val="28"/><w:szCs w:val="28"/><w:lang w:val="${rtl ? "en-US" : lang}" w:bidi="${rtl ? lang : "ar-SA"}"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="${rtl ? 400 : 340}" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/><w:jc w:val="${rtl ? "left" : "left"}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80" w:line="320" w:lineRule="auto"/></w:pPr><w:rPr>${fonts(ui)}<w:color w:val="5A6377"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:top w:val="single" w:sz="6" w:space="6" w:color="C9A455"/></w:pBdr><w:spacing w:before="240" w:after="80" w:line="320" w:lineRule="auto"/></w:pPr><w:rPr>${fonts(ui)}<w:color w:val="5A6377"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="SummaryHead"><w:name w:val="Summary Heading"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:pBdr><w:top w:val="single" w:sz="6" w:space="6" w:color="C9A455"/></w:pBdr><w:spacing w:before="200" w:after="40" w:line="320" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr><w:rPr>${fonts(ui)}<w:b/><w:bCs/><w:color w:val="17225A"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Summary"><w:name w:val="Summary"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="300" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr><w:rPr>${fonts(ui)}<w:color w:val="33405F"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="SummaryNote"><w:name w:val="Summary Note"/><w:basedOn w:val="Summary"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="C9A455"/></w:pBdr><w:spacing w:before="40" w:after="280" w:line="280" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="5A6377"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Quote"><w:name w:val="Quote"/><w:rPr><w:b/><w:bCs/><w:color w:val="17225A"/></w:rPr></w:style>
</w:styles>`;
  const sect = `<w:sectPr><w:footnotePr><w:numRestart w:val="continuous"/></w:footnotePr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>${rtl ? "<w:bidi/>" : ""}</w:sectPr>`;
  const document = `${XML}<w:document ${NS}><w:body>${paragraphs.map(p => paraXml(p, rtl)).join("")}${sect}</w:body></w:document>`;
  const fnRef = '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>';
  const fns = `${XML}<w:footnotes ${NS}>
<w:footnote w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:type="continuationSeparator" w:id="1"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
${footnotes.map((f, i) => `<w:footnote w:id="${i + 2}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/>${rtl ? "<w:bidi/>" : ""}</w:pPr>${fnRef}${f.runs.map(r => runXml(r, rtl)).join("")}</w:p></w:footnote>`).join("\n")}
</w:footnotes>`;
  const settings = `${XML}<w:settings ${NS}><w:footnotePr><w:footnote w:id="0"/><w:footnote w:id="1"/></w:footnotePr></w:settings>`;
  const types = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const docRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`;
  const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>Athar</dc:creator></cp:coreProperties>`;
  return zipStore([["[Content_Types].xml", types], ["_rels/.rels", rels], ["docProps/core.xml", core], ["word/document.xml", document],
    ["word/styles.xml", styles], ["word/footnotes.xml", fns], ["word/settings.xml", settings], ["word/_rels/document.xml.rels", docRels]]);
}
