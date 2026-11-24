/**
 * BPM - Escrime - Échappement HTML unique côté TypeScript (#2204)
 *
 * Même règle que escHtml de src/remote/common.js (pages distantes, scripts classiques) :
 * &, <, >, ", ' et ` échappés ; null/undefined → '' ; 0 → '0'.
 * Parité vérifiée par escapeHtml.test.ts : toute divergence fait échouer la CI.
 * Licensed under GPL-3.0
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/** Échappe une valeur avant insertion dans du HTML (texte ou attribut entre guillemets) */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`]/g, c => ESCAPES[c] ?? c);
}
