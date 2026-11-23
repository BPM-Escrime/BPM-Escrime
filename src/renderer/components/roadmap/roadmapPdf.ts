/**
 * BPM - Escrime - PDF de la feuille de route
 * Le HTML de l'aperçu + les règles CSS `.roadmap-doc` relues dans les feuilles
 * chargées : une seule source de style, l'aperçu est exactement le PDF.
 * Licensed under GPL-3.0
 */

const SCOPE = 'roadmap-doc';

const collectRules = (rules: CSSRuleList): string[] => {
  const out: string[] = [];
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      if (rule.selectorText.includes(SCOPE)) out.push(rule.cssText);
    } else if (rule instanceof CSSMediaRule) {
      const inner = collectRules(rule.cssRules);
      if (inner.length) out.push(`@media ${rule.conditionText} {${inner.join('\n')}}`);
    }
  }
  return out;
};

/** Règles `.roadmap-doc` des feuilles de style de la page */
export function collectRoadmapCss(doc: Document = document): string {
  const out: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      out.push(...collectRules(sheet.cssRules));
    } catch {
      // Feuille d'une autre origine : illisible, ignorée
    }
  }
  return out.join('\n');
}

const escTitle = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Document HTML complet, A4, prêt pour l'export PDF ou l'impression */
export function roadmapHtml(node: HTMLElement, title: string, css = collectRoadmapCss()): string {
  return [
    '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">',
    `<title>${escTitle(title)}</title>`,
    '<style>@page { size: A4; margin: 14mm 16mm; } html, body { margin: 0; background: #fff; }',
    css,
    '</style></head><body>',
    node.outerHTML,
    '</body></html>',
  ].join('\n');
}
