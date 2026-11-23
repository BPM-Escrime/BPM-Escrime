/**
 * BPM - Escrime - Export Word (.docx) de la feuille de route
 * OOXML écrit à la main (aucune dépendance ajoutée) et zippé par JSZip, déjà au bundle :
 * logos en en-tête de chaque page, encadré de titre, bandeaux colorés, tableaux à deux
 * colonnes, puces. Le fichier reste modifiable dans Word, LibreOffice ou Google Docs.
 * Licensed under GPL-3.0
 */

import {
  parseBlocks,
  resolveText,
  type RoadmapDoc,
  type RoadmapLogo,
  type RoadmapSection,
  type RoadmapVariables,
} from '@shared/domain/roadmap/roadmap';
import { base64ToBytes } from '@shared/platform/binary';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_ALL = `xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}"`;

/** A4, marges 2 cm : largeur utile en twips (1/20 pt) */
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 1134;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const LABEL_W = 2300;
/** EMU (1 cm = 360 000) */
const LOGO_H_EMU = 576000;
const CONTENT_W_EMU = Math.round((CONTENT_W / 1440) * 914400);

/** Caractères interdits en XML 1.0 retirés, puis échappement */
export const xmlEscape = (s: string): string =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const run = (text: string, opts: { bold?: boolean; size?: number } = {}) => {
  const props = [
    opts.bold ? '<w:b/><w:bCs/>' : '',
    opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : '',
  ].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
};

const para = (
  content: string,
  opts: { align?: 'center' | 'both' | 'left'; indent?: boolean; after?: number } = {}
) => {
  const ppr = [
    opts.after !== undefined ? `<w:spacing w:after="${opts.after}"/>` : '',
    opts.indent ? '<w:ind w:left="360" w:hanging="240"/>' : '',
    opts.align && opts.align !== 'left' ? `<w:jc w:val="${opts.align}"/>` : '',
  ].join('');
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${content}</w:p>`;
};

/** Texte libre → paragraphes et puces (variables résolues) */
const blocksXml = (text: string, vars: RoadmapVariables, align: 'left' | 'both' = 'left') => {
  const blocks = parseBlocks(resolveText(text, vars));
  if (blocks.length === 0) return para('');
  return blocks
    .map(b =>
      b.kind === 'bullet'
        ? para(run(`•\t${b.text}`), { indent: true })
        : para(run(b.text), { align })
    )
    .join('');
};

const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
    .join('') +
  '</w:tblBorders>';

const table = (cols: number[], rows: string) =>
  `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_W}" w:type="dxa"/>${BORDERS}<w:tblLayout w:type="fixed"/></w:tblPr>` +
  `<w:tblGrid>${cols.map(c => `<w:gridCol w:w="${c}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;

const cell = (width: number, content: string, opts: { span?: number; fill?: string } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${opts.span ? `<w:gridSpan w:val="${opts.span}"/>` : ''}` +
  `${opts.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.fill}"/>` : ''}</w:tcPr>${content}</w:tc>`;

const band = (title: string, fill: string) =>
  `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${cell(CONTENT_W, para(run(title.toUpperCase(), { bold: true }), { align: 'center', after: 0 }), { span: 2, fill })}</w:tr>`;

const spacer = () => para('', { after: 120 });

const sectionXml = (s: RoadmapSection, vars: RoadmapVariables, fill: string): string => {
  const title = resolveText(s.title, vars);
  if (s.layout === 'text') {
    const head = table(
      [CONTENT_W],
      `<w:tr>${cell(CONTENT_W, para(run(title.toUpperCase(), { bold: true }), { align: 'center', after: 0 }), { fill })}</w:tr>`
    );
    return head + spacer() + blocksXml(s.text, vars, 'both') + spacer();
  }
  const rows = s.rows
    .map(
      r =>
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(LABEL_W, blocksXml(r.label, vars))}${cell(CONTENT_W - LABEL_W, blocksXml(r.value, vars))}</w:tr>`
    )
    .join('');
  return table([LABEL_W, CONTENT_W - LABEL_W], band(title, fill) + rows) + spacer();
};

const titleBox = (doc: RoadmapDoc, vars: RoadmapVariables) => {
  const lines = [
    para(run(vars.titre || '…', { bold: true, size: 32 }), { align: 'center', after: 0 }),
  ];
  if (vars.edition)
    lines.push(para(run(vars.edition, { size: 24 }), { align: 'center', after: 0 }));
  if (vars.date)
    lines.push(para(run(capitalize(vars.date), { size: 20 }), { align: 'center', after: 0 }));
  return table([CONTENT_W], `<w:tr>${cell(CONTENT_W, lines.join(''))}</w:tr>`) + spacer();
};

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const ext = (logo: RoadmapLogo) => (logo.dataUrl.startsWith('data:image/jpeg') ? 'jpeg' : 'png');

/** Logos côte à côte, même hauteur, réduits si la ligne dépasse la largeur utile */
const logosXml = (logos: RoadmapLogo[]) => {
  if (logos.length === 0) return para('');
  const gap = 180000;
  const widths = logos.map(l => (LOGO_H_EMU * l.width) / l.height);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (logos.length - 1);
  const k = Math.min(1, CONTENT_W_EMU / total);
  const runs = logos
    .map((l, i) => {
      const cx = Math.round(widths[i] * k);
      const cy = Math.round(LOGO_H_EMU * k);
      const id = i + 1;
      const pic =
        `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
        `<wp:docPr id="${id}" name="Logo ${id}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="${NS_PIC}">` +
        `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="logo${id}.${ext(l)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="rIdLogo${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
        `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
      return i > 0 ? `${run('   ')}${pic}` : pic;
    })
    .join('');
  return para(runs, { align: 'center', after: 0 });
};

const STYLES =
  `${XML_HEAD}<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>' +
  '<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="40" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr>' +
  '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>' +
  '</w:tblPr></w:style></w:styles>';

/** Parties du paquet OOXML (chemin → contenu) ; pur, testé sans zip */
export function buildDocxParts(
  doc: RoadmapDoc,
  vars: RoadmapVariables
): Record<string, string | Uint8Array> {
  const fill = doc.accent.replace('#', '').toUpperCase();
  const body =
    titleBox(doc, vars) +
    doc.sections
      .filter(s => s.enabled)
      .map(s => sectionXml(s, vars, fill))
      .join('');
  const sectPr =
    `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/>` +
    `<w:pgMar w:top="${MARGIN + 900}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;

  const logoRels = doc.logos
    .map(
      (l, i) =>
        `<Relationship Id="rIdLogo${i + 1}" Type="${NS_R}/image" Target="media/logo${i + 1}.${ext(l)}"/>`
    )
    .join('');
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml':
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '</Types>',
    '_rels/.rels':
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels':
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rIdStyles" Type="${NS_R}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rIdHeader" Type="${NS_R}/header" Target="header1.xml"/></Relationships>`,
    'word/_rels/header1.xml.rels': `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${logoRels}</Relationships>`,
    'word/styles.xml': STYLES,
    'word/header1.xml': `${XML_HEAD}<w:hdr ${NS_ALL}>${logosXml(doc.logos)}</w:hdr>`,
    'word/document.xml': `${XML_HEAD}<w:document ${NS_ALL}><w:body>${body}${sectPr}</w:body></w:document>`,
  };
  doc.logos.forEach((l, i) => {
    parts[`word/media/logo${i + 1}.${ext(l)}`] = base64ToBytes(l.dataUrl.split(',')[1] ?? '');
  });
  return parts;
}

/** Fichier .docx (octets) */
export async function buildRoadmapDocx(
  doc: RoadmapDoc,
  vars: RoadmapVariables
): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  // [Content_Types].xml en premier : certains lecteurs l'exigent
  for (const [path, content] of Object.entries(buildDocxParts(doc, vars))) zip.file(path, content);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
