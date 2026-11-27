/**
 * Ex aequo à la barre dans la formule (docs/adr/0040) : réglage `ties` de la règle de
 * qualification du tour et du `take` d'une branche de scission ; « barrage » attend F1b.
 */
import { describe, expect, it } from 'vitest';
import { Category, CompetitionSettings, Weapon } from '../../types';
import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import { formulaOf, type FormulaV2, type SplitPhase } from './formulaV2';
import { applyOperationsV2, formulaV2Issues, tiesIssue } from './formulaV2Operations';

let n = 0;
const id = () => `id-${++n}`;
const settings = buildDefaultCompetitionSettings({
  weapon: Weapon.EPEE,
  category: Category.SENIOR,
}) as CompetitionSettings;
const ctx = { weapon: Weapon.EPEE, category: Category.SENIOR, settings };
const scope = { weapon: Weapon.EPEE };
const qualify = (ties: unknown) =>
  applyOperationsV2(
    ctx,
    [
      {
        op: 'setPhase',
        phase: 'pool-0',
        settings: { qualification: { mode: 'fixed_count', count: 16, ties } },
      },
    ],
    id
  );

describe('ex aequo à la barre dans la formule (ADR-0040)', () => {
  it('réglage absent : comportement actuel, aucune remarque', () => {
    const f = formulaOf(ctx);
    expect(f.phases.find(p => p.kind === 'pool')?.qualification.ties).toBeUndefined();
    expect(formulaV2Issues(f, scope)).toEqual([]);
  });

  it('« initial_ranking » et « all » : acceptés et gardés sur la règle du tour', () => {
    for (const ties of ['all', 'initial_ranking']) {
      const f = qualify(ties);
      const pool = f.phases.find(p => p.kind === 'pool');
      expect(pool?.qualification).toEqual({ mode: 'fixed_count', count: 16, ties });
      expect(formulaV2Issues(f, scope)).toEqual([]);
    }
  });

  it('« barrage » refusé jusqu’au lot F1b ; valeur inconnue refusée', () => {
    expect(formulaV2Issues(qualify('barrage'), scope)).toContain(
      'tour 1 : ex aequo à la barre : barrage pas encore disponible'
    );
    expect(formulaV2Issues(qualify('tirage'), scope)).toContain(
      'tour 1 : ex aequo à la barre : all ou initial_ranking attendu'
    );
    expect(tiesIssue(undefined)).toBeNull();
  });

  it('branche de scission par rang : « take.ties » jugé de même', () => {
    const f = applyOperationsV2(
      ctx,
      [
        { op: 'removePhase', phase: 'tableau' },
        { op: 'insertPhase', brick: 'split', at: 1 },
      ],
      id
    );
    const withTies = (ties: string): FormulaV2 => ({
      ...f,
      phases: f.phases.map(p =>
        p.kind === 'split'
          ? ({
              ...p,
              branches: p.branches.map((b, i) =>
                i === 0 ? { ...b, take: { ...b.take!, ties } } : b
              ),
            } as SplitPhase)
          : p
      ),
    });
    expect(formulaV2Issues(withTies('initial_ranking'), scope)).toEqual([]);
    expect(formulaV2Issues(withTies('barrage'), scope)).toContain(
      'branche Tableau A : ex aequo à la barre : barrage pas encore disponible'
    );
  });
});
