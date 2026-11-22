/**
 * BellePoule Modern - Paramètres des traductions : `t()` ne remplace que `{{nom}}`.
 * Un `{nom}` simple s'affichait tel quel (« Prêt groupé ({count} matériel(s)) », #1872).
 * Licensed under GPL-3.0
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

function strings(node: unknown, prefix: string, out: [string, string][]): [string, string][] {
  if (typeof node === 'string') out.push([prefix, node]);
  else if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) strings(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

describe('locales : paramètres {{nom}}', () => {
  it.each(files)('%s : aucun paramètre à accolade simple', file => {
    const data: unknown = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const bad = strings(data, '', [])
      .filter(([, v]) => /(?<!\{)\{[A-Za-z_]\w*\}(?!\})/.test(v))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });
});
