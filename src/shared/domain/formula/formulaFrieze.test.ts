import { describe, expect, it } from 'vitest';
import { Category, CustomDEConfig, CustomPoolRoundConfig, Weapon } from '../../types';
import { createDefaultCustomFormula } from '../../utils/tournamentTemplates';
import { deriveSettingsFromFormula } from '../../utils/customFormulaSettings';
import { simulateFormula } from '../../utils/customRankingCalculator';
import { draftFromSettings } from './formulaDraft';
import {
  customCanRemove,
  customFrieze,
  customInsert,
  customInsertOptions,
  customPhaseNode,
  customRemove,
  draftCanRemove,
  draftFrieze,
  draftInsert,
  draftInsertOptions,
  draftRemove,
  draftToSimulationFormula,
  normalizeCustomFormula,
  summarizeCustomFormula,
  summarizeDraft,
} from './formulaFrieze';

const epee = () => draftFromSettings(Weapon.EPEE, Category.SENIOR, undefined);

describe('frise : épée, fleuret, sabre, Sabre Laser', () => {
  it('standard : un tour de poules puis le tableau', () => {
    const d = epee();
    expect(draftFrieze(d, Weapon.EPEE).map(p => p.key)).toEqual(['pool-0', 'tableau']);
  });

  it('« ＋ » : poules avant le tableau, rien après le tableau', () => {
    const d = epee();
    expect(draftInsertOptions(d, Weapon.EPEE, 0)).toEqual(['pool']);
    expect(draftInsertOptions(d, Weapon.EPEE, 1)).toEqual(['pool']);
    expect(draftInsertOptions(d, Weapon.EPEE, 2)).toEqual([]);
  });

  it('tableau proposé en fin de frise seulement quand il est absent', () => {
    const d = { ...epee(), hasDirectElimination: false };
    expect(draftInsertOptions(d, Weapon.EPEE, 1)).toEqual(['pool', 'tableau']);
    expect(draftInsertOptions(d, Weapon.EPEE, 0)).toEqual(['pool']);
    expect(draftInsert(d, Weapon.EPEE, 'tableau', 1)).toEqual({ hasDirectElimination: true });
  });

  it('insérer un tour en tête décale les qualifiés', () => {
    const d = { ...epee(), poolRounds: 2, poolRoundQualifiers: [24] };
    expect(draftInsert(d, Weapon.EPEE, 'pool', 0)).toEqual({
      poolRounds: 3,
      poolRoundQualifiers: [0, 24],
    });
    expect(draftInsert(d, Weapon.EPEE, 'pool', 2)).toEqual({
      poolRounds: 3,
      poolRoundQualifiers: [24, 0],
    });
  });

  it('brique interdite : aucun changement', () => {
    expect(draftInsert(epee(), Weapon.EPEE, 'tableau', 1)).toEqual({});
    expect(draftInsert(epee(), Weapon.EPEE, 'quest', 1)).toEqual({});
    const full = { ...epee(), poolRounds: 5, poolRoundQualifiers: [0, 0, 0, 0] };
    expect(draftInsertOptions(full, Weapon.EPEE, 0)).toEqual([]);
  });

  it('retrait : il reste toujours une phase de combat', () => {
    const d = epee();
    expect(draftCanRemove(d, Weapon.EPEE, { kind: 'tableau', key: 'tableau' })).toBe(true);
    expect(draftCanRemove(d, Weapon.EPEE, { kind: 'pool', round: 0, key: 'pool-0' })).toBe(false);
    const poolsOnly = { ...d, ...draftRemove(d, Weapon.EPEE, { kind: 'tableau', key: 'tableau' }) };
    expect(draftFrieze(poolsOnly, Weapon.EPEE).map(p => p.key)).toEqual(['pool-0']);
    expect(draftCanRemove(poolsOnly, Weapon.EPEE, { kind: 'pool', round: 0, key: 'pool-0' })).toBe(
      false
    );
  });

  it('Sabre Laser : Tour Quest après les poules', () => {
    const d = draftFromSettings(Weapon.LASER, Category.SENIOR, undefined);
    expect(draftInsertOptions(d, Weapon.LASER, 1)).toContain('quest');
    const withQuest = { ...d, ...draftInsert(d, Weapon.LASER, 'quest', 1) };
    expect(draftFrieze(withQuest, Weapon.LASER).map(p => p.kind)).toContain('quest');
    expect(draftInsertOptions(d, Weapon.EPEE, 1)).not.toContain('quest');
  });

  it('résumé sur une ligne', () => {
    expect(summarizeDraft(epee(), Weapon.EPEE)).toEqual([
      { kind: 'pools', rounds: 1, maxScore: 5 },
      expect.objectContaining({ kind: 'tableau', maxScore: 15 }),
    ]);
  });
});

describe('frise : arme « Autre »', () => {
  const base = () => createDefaultCustomFormula();
  let n = 0;
  const newId = () => `id-${++n}`;
  const defaults = () => {
    const f = base();
    return {
      pool: f.phases[0].config as CustomPoolRoundConfig,
      tableau: f.phases[1].config as CustomDEConfig,
    };
  };

  it('« Classement final » retiré, il est implicite', () => {
    const f = base();
    expect(f.phases.some(p => p.type === 'classification')).toBe(true);
    const norm = normalizeCustomFormula(f);
    expect(norm.phases.map(p => p.type)).toEqual(['pool_round', 'direct_elimination']);
    expect(customFrieze(f).map(p => p.key)).toEqual(['pool-0', 'tableau']);
  });

  it('normalisation : premier tableau seul, en dernier ; réglages exécutés inchangés', () => {
    const f = base();
    const [pool, de, cls] = f.phases;
    const odd = {
      ...f,
      phases: [de, pool, { ...de, id: 'de2' }, { ...pool, id: 'p2' }, cls],
    };
    const norm = normalizeCustomFormula(odd);
    expect(norm.phases.map(p => p.id)).toEqual([pool.id, 'p2', de.id]);
    expect((norm.phases[1].config as CustomPoolRoundConfig).roundIndex).toBe(1);
    expect(deriveSettingsFromFormula(norm)).toEqual(deriveSettingsFromFormula(odd));
  });

  it('insérer un tour reprend les réglages du tour voisin, tous qualifiés', () => {
    const f = base();
    const out = customInsert(f, 'pool', 1, newId, defaults());
    const pools = out.phases.filter(p => p.type === 'pool_round');
    expect(pools).toHaveLength(2);
    const added = pools[1].config as CustomPoolRoundConfig;
    expect(added.roundIndex).toBe(1);
    expect(added.maxScore).toBe((pools[0].config as CustomPoolRoundConfig).maxScore);
    expect(added.advancementRule).toEqual({ mode: 'all' });
  });

  it('tableau : seulement en fin de frise, et une seule fois', () => {
    const f = base();
    expect(customInsertOptions(f, 1)).toEqual(['pool']);
    expect(customInsertOptions(f, 2)).toEqual([]);
    const noDe = customRemove(f, { kind: 'tableau', key: 'tableau' });
    expect(customInsertOptions(noDe, 1)).toEqual(['pool', 'tableau']);
    const back = customInsert(noDe, 'tableau', 1, newId, defaults());
    expect(customFrieze(back).map(p => p.key)).toEqual(['pool-0', 'tableau']);
  });

  it('retrait : il reste une phase de combat, le dernier tour ne se retire pas', () => {
    const f = normalizeCustomFormula(base());
    expect(customCanRemove(f, { kind: 'pool', round: 0, key: 'pool-0' })).toBe(false);
    const two = customInsert(f, 'pool', 1, newId, defaults());
    const one = customRemove(two, { kind: 'pool', round: 0, key: 'pool-0' });
    expect(one.phases.filter(p => p.type === 'pool_round')).toHaveLength(1);
    expect((one.phases[0].config as CustomPoolRoundConfig).roundIndex).toBe(0);
  });

  it('nœud d’une phase de la frise', () => {
    const f = base();
    expect(customPhaseNode(f, { kind: 'tableau', key: 'tableau' })?.index).toBe(1);
    expect(customPhaseNode(f, { kind: 'pool', round: 0, key: 'pool-0' })?.index).toBe(0);
  });

  it('résumé sur une ligne', () => {
    expect(summarizeCustomFormula(base())).toEqual([
      { kind: 'pools', rounds: 1, maxScore: 5 },
      { kind: 'tableau', maxScore: 15, thirdPlace: true },
    ]);
  });
});

describe('simulation de la formule de l’épée… Sabre Laser', () => {
  it('2 tours (24 qualifiés) puis tableau : effectifs simulés', () => {
    const d = { ...epee(), poolRounds: 2, poolRoundQualifiers: [24] };
    const sim = simulateFormula(40, draftToSimulationFormula(d, Weapon.EPEE), 'E');
    expect(sim.phases.map(p => p.type)).toEqual(['pool_round', 'pool_round', 'direct_elimination']);
    expect(sim.phases[0].inputFencers).toBe(40);
    expect(sim.phases[1].inputFencers).toBe(24);
    expect(sim.phases[2]).toMatchObject({ inputFencers: 24, bracketSize: 32 });
  });

  it('poules seules : pas de tableau', () => {
    const d = { ...epee(), hasDirectElimination: false };
    expect(draftToSimulationFormula(d, Weapon.EPEE).phases.map(p => p.type)).toEqual([
      'pool_round',
    ]);
  });
});
