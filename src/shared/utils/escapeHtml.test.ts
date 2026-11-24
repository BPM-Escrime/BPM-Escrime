/**
 * Parité de l'échappement HTML (#2204) : une seule règle pour le PDF, le contrat de prêt
 * et les pages distantes. Échoue si une implémentation diverge ou si une copie réapparaît.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { escapeHtml } from './escapeHtml';

const { escHtml: remoteEscHtml } = require('../../remote/common.js') as {
  escHtml: (v: unknown) => string;
};

const SAMPLES: unknown[] = [
  '<img src=x onerror="a()">',
  `O'Brien & fils \`x\``,
  '&amp; déjà échappé',
  'Zoé <Été> "à" \'ç\'',
  '',
  null,
  undefined,
  0,
  42,
  false,
];

describe('escapeHtml (src/shared/utils)', () => {
  it('échappe & < > " \' et `', () => {
    expect(escapeHtml(`<a href="x" title='y'>&\`</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&#96;&lt;/a&gt;'
    );
  });

  it('null et undefined donnent une chaîne vide, 0 reste 0', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(0)).toBe('0');
  });

  it('même résultat que escHtml de src/remote/common.js', () => {
    for (const s of SAMPLES) expect(escapeHtml(s)).toBe(remoteEscHtml(s));
    for (let code = 0; code < 256; code++) {
      const ch = String.fromCharCode(code);
      expect(escapeHtml(ch)).toBe(remoteEscHtml(ch));
    }
  });

  it('aucune copie locale dans app.js, bookToc.ts, clubLoanContract.ts', () => {
    const root = path.join(__dirname, '..', '..');
    const files = [
      'remote/app.js',
      'shared/utils/pdfExport/bookToc.ts',
      'shared/utils/clubLoanContract.ts',
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      expect(src, f).not.toMatch(/&amp;/);
    }
  });
});
