/**
 * Qualification « têtes de poule, puis suivants » (pool_heads, docs/adr/0043, F4b) : tableau
 * généré par le moteur sans composition (épreuve non rapières), croisement des poules ; mode
 * spécial rapières, demi-finales inchangées (règle de la formule ou mode hérité). Base SQLite
 * réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, CompetitionSettings, FencerStatus, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import {
  flatSettingsOf,
  formulaOf,
  type FormulaV2,
} from '../../../shared/domain/formula/formulaV2';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';
import { getCompetitionOrThrow } from './competitions';
import { readSession } from './sessionView';
import { tableauRankingCut, writeSession } from './sport';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db, emitChange: () => {} };
});
afterEach(() => db.close());

const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;

const weapon = Weapon.EPEE;
const base = buildDefaultCompetitionSettings({
  weapon,
  category: Category.SENIOR,
}) as CompetitionSettings;

/** Formule par défaut, tour de poules qualifiant les têtes de poule (`count`) */
function headsFormula(count: number): FormulaV2 {
  const f = formulaOf({ weapon, category: Category.SENIOR, settings: base });
  return {
    ...f,
    phases: f.phases.map(p =>
      p.kind === 'pool' ? { ...p, qualification: { mode: 'pool_heads', count } } : p
    ),
  };
}

/** Épreuve de 6 tireurs pointés (rang d'entrée 1 à 6) ; rapières : mode spécial, sans formule */
function competition(opts: { formula?: FormulaV2; special?: boolean }) {
  const settings = {
    ...base,
    ...(opts.formula ? { ...flatSettingsOf(opts.formula, weapon), formula: opts.formula } : {}),
    ...(opts.special ? { specialMode: 'rapieres' } : {}),
  };
  const comp = db.createCompetition({
    title: 'Têtes de poule',
    date: new Date('2026-12-06'),
    location: 'Gymnase',
    weapon,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    settings: settings as never,
  });
  for (let i = 0; i < 6; i++) {
    db.addFencer(comp.id, {
      lastName: `NOM${i + 1}`,
      firstName: `P${i + 1}`,
      gender: Gender.MALE,
      club: `Club${i}`,
      ranking: i + 1,
      status: FencerStatus.CHECKED_IN,
    });
  }
  const ids = db
    .getFencersByCompetition(comp.id)
    .sort((a, b) => a.ranking! - b.ranking!)
    .map(f => f.id);
  return { comp, ids };
}

/**
 * Deux poules de 3 : A = [f1, f3, f5], B = [f2, f4, f6] ; dans chaque poule, le premier bat les
 * suivants, le deuxième bat le troisième (5-1). Classement de poule : A1 = f1, A2 = f3, B1 = f2,
 * B2 = f4.
 */
async function playTwoPools(competitionId: string, ids: string[]) {
  const groups = [
    [ids[0], ids[2], ids[4]],
    [ids[1], ids[3], ids[5]],
  ];
  const composition = groups.map((g, p) => ({
    poolId: `${competitionId}-p${p + 1}`,
    number: p + 1,
    fencerIds: g,
    matches: [
      [g[0], g[1]],
      [g[0], g[2]],
      [g[1], g[2]],
    ].map(([a, b], m) => ({
      matchId: `${competitionId}-p${p + 1}-m${m}`,
      fencerAId: a,
      fencerBId: b,
    })),
  }));
  await call('generatePools', { competitionId, composition });
  for (const pool of composition) {
    for (const m of pool.matches) {
      await call('recordScore', { competitionId, matchId: m.matchId, scoreA: 5, scoreB: 1 });
    }
  }
}

/** Premier tour du tableau : paires [A, B] de tireurs, par position */
const pairs = (firstRound: any[]) =>
  firstRound.map(m => [m.fencerA?.id, m.fencerB?.id].sort().join('/'));

d('têtes de poule : tableau généré par le moteur (épreuve non rapières)', () => {
  it('2 poules, 4 qualifiés : A1, B1, A2, B2, donc A1–B2 et B1–A2', async () => {
    const { comp, ids } = competition({ formula: headsFormula(4) });
    await playTwoPools(comp.id, ids);
    const sim = await call('generateTableau', { competitionId: comp.id, dryRun: true });
    // Les 4 premières places de poule seulement (f5 et f6 sortent)
    expect(sim.qualified).toBe(4);
    expect(sim.tiedAtBar).toBeNull();
    const [f1, f2, f3, f4] = ids;
    expect(pairs(sim.firstRound).sort()).toEqual(
      [
        [f1, f4],
        [f2, f3],
      ]
        .map(p => p.sort().join('/'))
        .sort()
    );
  });

  it('le tableau tiré garde ces 4 qualifiés, sans composition', async () => {
    const { comp, ids } = competition({ formula: headsFormula(4) });
    await playTwoPools(comp.id, ids);
    const out = await call('generateTableau', { competitionId: comp.id });
    expect(out.qualified).toBe(4);
    const generated = db.eventLog.getSince(comp.id).find(e => e.type === 'TableauGenerated');
    const placed = new Set(
      (generated!.payload as any).matches.flatMap((m: any) => [m.fencerAId, m.fencerBId])
    );
    expect([...placed].filter(Boolean).sort()).toEqual(ids.slice(0, 4).sort());
    // Pas de mode de tableau des rapières écrit : la formule porte le réglage
    expect((generated!.payload as any).rapieresTableauMode).toBeUndefined();
  });

  it('plus de poules que de qualifiés : la formule est refusée (S4), avec la phase en cause', async () => {
    const { comp } = competition({ formula: headsFormula(4) });
    // 12 tireurs en poules de 3 au plus : 4 poules au moins ; 3 qualifiés ne suffisent pas
    for (let i = 6; i < 12; i++) {
      db.addFencer(comp.id, {
        lastName: `NOM${i + 1}`,
        firstName: `P${i + 1}`,
        gender: Gender.MALE,
        club: `Club${i}`,
        ranking: i + 1,
        status: FencerStatus.CHECKED_IN,
      });
    }
    const setPool = (settings: Record<string, unknown>) =>
      call('updateCompetitionFormula', {
        competitionId: comp.id,
        operations: [{ op: 'setPhase', phase: 'pool-0', settings }],
      });
    await expect(
      setPool({ sizeMin: 3, sizeMax: 3, qualification: { mode: 'pool_heads', count: 3 } })
    ).rejects.toMatchObject({
      code: 'invalid_settings',
      message: expect.stringContaining('[pool-0]'),
    });
    await expect(
      setPool({ sizeMin: 3, sizeMax: 3, qualification: { mode: 'pool_heads', count: 4 } })
    ).resolves.toBeDefined();
  });
});

d('têtes de poule : mode spécial rapières, demi-finales inchangées (docs/adr/0043, F4b)', () => {
  const rankingOf = (id: string) => {
    const comp = getCompetitionOrThrow(ctx, id);
    return tableauRankingCut(comp, readSession(ctx, id)).ranking.map(r => r.fencer.id);
  };

  it('formule « têtes de poule » 4 : les 4 demi-finalistes, croisement', async () => {
    const { comp, ids } = competition({ formula: headsFormula(4), special: true });
    await playTwoPools(comp.id, ids);
    expect(rankingOf(comp.id)).toEqual([ids[0], ids[1], ids[2], ids[3]]);
  });

  it('mode hérité « semis » (clé de session rapieres) : même sortie, sans formule', async () => {
    const { comp, ids } = competition({ special: true });
    await playTwoPools(comp.id, ids);
    // Sans réglage : toutes les équipes
    expect(rankingOf(comp.id)).toHaveLength(6);
    writeSession(ctx, comp.id, { rapieres: { version: 2, teams: {}, tableauMode: 'semis' } });
    expect(rankingOf(comp.id)).toEqual([ids[0], ids[1], ids[2], ids[3]]);
  });
});

d('qualification verrouillée après le tirage (S6, docs/adr/0041, amendement du 2026-11-27)', () => {
  const setPool = (competitionId: string, settings: Record<string, unknown>) =>
    call('updateCompetitionFormula', {
      competitionId,
      operations: [{ op: 'setPhase', phase: 'pool-0', settings }],
    });

  it('tableau tiré : changer la qualification du tour est refusé (invalid_settings), le reste passe', async () => {
    const { comp, ids } = competition({ formula: headsFormula(4) });
    // Avant le tirage : la règle se modifie
    await expect(
      setPool(comp.id, { qualification: { mode: 'pool_heads', count: 4 } })
    ).resolves.toBeDefined();
    await playTwoPools(comp.id, ids);
    await call('generateTableau', { competitionId: comp.id });
    await expect(
      setPool(comp.id, { qualification: { mode: 'pool_heads', count: 3 } })
    ).rejects.toMatchObject({
      code: 'invalid_settings',
      message: expect.stringContaining('[pool-0]'),
    });
    await expect(
      setPool(comp.id, { qualification: { mode: 'fixed_count', count: 4 } })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
    // Règle inchangée et autre réglage : permis
    await expect(
      setPool(comp.id, { qualification: { mode: 'pool_heads', count: 4 }, maxScore: 5 })
    ).resolves.toBeDefined();
  });
});

d('clearTableau efface le mode de tableau hérité des rapières (docs/adr/0043, F4b)', () => {
  it('la formule décide ensuite', async () => {
    const { comp, ids } = competition({ special: true });
    await playTwoPools(comp.id, ids);
    writeSession(ctx, comp.id, { rapieres: { version: 2, teams: {}, tableauMode: 'semis' } });
    const ranking = () =>
      tableauRankingCut(getCompetitionOrThrow(ctx, comp.id), readSession(ctx, comp.id)).ranking;
    expect(ranking()).toHaveLength(4);
    const out = await call('clearTableau', { competitionId: comp.id });
    expect(out.cleared).toBe(0);
    const rapieres = (db.getSessionState(comp.id) as any).rapieres;
    expect(rapieres.tableauMode).toBeUndefined();
    expect(rapieres.teams).toEqual({});
    expect(ranking()).toHaveLength(6);
  });

  it('simulation : rien n’est effacé', async () => {
    const { comp } = competition({ special: true });
    writeSession(ctx, comp.id, { rapieres: { version: 2, teams: {}, tableauMode: 'third' } });
    await call('clearTableau', { competitionId: comp.id, dryRun: true });
    expect((db.getSessionState(comp.id) as any).rapieres.tableauMode).toBe('third');
  });
});
