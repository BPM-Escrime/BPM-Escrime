/**
 * Garde-fou (#1940) : le dépôt a été transféré vers BPM-Escrime/BPM-Escrime.
 * Anciens emplacements : voir OLD_REPOS (chemins découpés pour ne pas se signaler eux-mêmes).
 * L'ancien chemin ne vit que par la redirection GitHub, qui tombe si le nom est repris
 * (risque de détournement de la mise à jour automatique).
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const OLD_REPOS = [
  ['klinnex', 'bellepoule-modern'].join('/'),
  ['BellePoule-Modern', 'bellepoule-modern'].join('/'),
  ['BPM-Escrime', 'bellepoule-modern'].join('/'),
];
const SCANNED = ['src', 'plugins', 'package.json', 'flake.nix'];

function listFiles(target: string): string[] {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target).flatMap(name => {
    if (name === 'node_modules' || name.startsWith('.git')) return [];
    return listFiles(path.join(target, name));
  });
}

describe('emplacement du dépôt GitHub (#1940)', () => {
  it('aucune référence aux anciens dépôts dans le code et le plugin', () => {
    const offenders = SCANNED.map(p => path.join(ROOT, p))
      .filter(p => fs.existsSync(p))
      .flatMap(listFiles)
      .filter(f => /\.(ts|tsx|js|json|html|md|nix)$/.test(f))
      .filter(f => {
        const text = fs.readFileSync(f, 'utf8');
        return OLD_REPOS.some(old => text.includes(old));
      })
      .map(f => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
