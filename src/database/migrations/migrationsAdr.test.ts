/**
 * Garde-fou des migrations (docs/adr/0011-migrations-schema-3-0.md) : jusqu'à la 3.0,
 * toute migration de schéma exige une ADR acceptée, citée dans sa description
 * (`docs/adr/00NN`). La 46 est la première soumise à la règle.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS } from './migrations';

const FIRST_UNDER_ADR = 46;
const ADR_DIR = join(__dirname, '..', '..', '..', 'docs', 'adr');
const adrFiles = readdirSync(ADR_DIR);

const adrFile = (num: string) => adrFiles.find(f => f.startsWith(`${num}-`));
const adrStatus = (file: string) =>
  /\*\*Statut\*\*\s*:\s*(.+)/.exec(readFileSync(join(ADR_DIR, file), 'utf8'))?.[1] ?? '';

describe('migrations et ADR (ADR-0011)', () => {
  it('les versions se suivent sans trou ni doublon', () => {
    ALL_MIGRATIONS.forEach((m, i) => expect(m.version).toBe(i + 1));
  });

  const governed = ALL_MIGRATIONS.filter(m => m.version >= FIRST_UNDER_ADR);

  it.each(governed.map(m => [m.version, m] as const))(
    'la migration %i cite une ADR acceptée',
    (_v, m) => {
      const refs = [...m.description.matchAll(/docs\/adr\/(\d{4})/g)].map(r => r[1]);
      expect(refs, `citer docs/adr/00NN dans la description : « ${m.description} »`).not.toEqual(
        []
      );
      const accepted = refs.some(num => {
        const file = adrFile(num);
        return !!file && /^Acceptée/.test(adrStatus(file));
      });
      expect(accepted, `ADR ${refs.join(', ')} absente ou non acceptée`).toBe(true);
    }
  );
});
