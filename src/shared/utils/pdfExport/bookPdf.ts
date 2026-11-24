/**
 * BPM - Escrime - Dossier PDF : assemblage page de garde + sommaire + sections (#1325)
 * Commun au dossier individuel (fullCompetitionPdf) et au dossier équipes (teamPdf).
 * Licensed under GPL-3.0
 */

import { defaultPlatform } from '../../platform/platforms';
import { savePDF, pdfLang, pdfT } from './core';
import { buildBookFrontHTML, escHtml, orderBookSections, type BookSectionKind } from './bookToc';

export function extractBodyContent(html: string): string {
  const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return m ? m[1].trim() : '';
}

export function extractStyleContent(html: string): string {
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  const parts: string[] = [];
  let m;
  while ((m = re.exec(html)) !== null) parts.push(m[1]);
  return parts.join('\n');
}

export interface BookItem {
  kind: BookSectionKind;
  title: string;
  html: string;
}

export interface BookInput {
  items: BookItem[];
  /** Types inclus, dans l'ordre d'impression ; défaut : tout, ordre d'origine */
  sectionOrder?: BookSectionKind[];
  competitionTitle: string;
  bookTitle: string;
  filename: string;
  logo?: string;
}

/**
 * Pages de chaque section, comptées par le bureau (ADR-0030) ; undefined sans bureau ou au
 * premier échec : le sommaire est alors sans numéros de page.
 */
export async function countSectionPages(sections: string[]): Promise<number[] | undefined> {
  try {
    const desktop = defaultPlatform.desktop;
    if (!desktop?.countHtmlPages) return undefined;
    const counts: number[] = [];
    for (const html of sections) {
      const pages = await desktop.countHtmlPages(html);
      if (!pages) return undefined;
      counts.push(pages);
    }
    return counts;
  } catch {
    return undefined;
  }
}

export async function exportBookPDF(input: BookInput): Promise<void> {
  const { sectionOrder, competitionTitle, bookTitle, filename, logo } = input;
  const chosen = orderBookSections(input.items, sectionOrder);
  const sections = chosen.map(i => i.html);
  const titles = chosen.map(i => i.title);
  if (sections.length === 0) throw new Error(pdfT('no_data', 'Aucune donnée à exporter'));

  // Sommaire avec numéros de page réels (#1325) : pages de chaque section comptées par un rendu,
  // puis page de garde (1) + sommaire (1) en tête ; repli sur un sommaire sans numéros.
  const pageCounts = await countSectionPages(sections);
  const front = buildBookFrontHTML({
    competitionTitle,
    toc: titles.map(title => ({ title })),
    pageCounts,
    labels: {
      contents: pdfT('book_contents', 'Sommaire'),
      page: pdfT('book_page', 'Page'),
    },
    logo,
  });
  sections.unshift(front);

  const allStyles = sections.map(extractStyleContent).join('\n');
  const allBodies = sections
    .map(
      (html, i) =>
        (i === 0 ? '' : '<div class="full-export-break"></div>\n') + extractBodyContent(html)
    )
    .join('\n');

  const combined = `<!DOCTYPE html>
<html lang="${pdfLang()}">
<head>
  <meta charset="UTF-8">
  <title>${escHtml(bookTitle)}</title>
  <style>
    ${allStyles}
    .full-export-break { break-before: page; }
  </style>
</head>
<body>
${allBodies}
</body>
</html>`;

  await savePDF(combined, filename);
}
