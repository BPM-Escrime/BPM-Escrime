/**
 * Formules à plusieurs tours pilotées par le moteur (docs/adr/0042, lot F3) : tirage du tour
 * suivant sans composition, tableau après deux tours, tableau arrêté puis tour de poules,
 * arbitres du tour courant. Par le contrat (invoke), base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import {
  Category,
  CompetitionSettings,
  FencerStatus,
  Gender,
  Weapon,
  type Pool,
  type PoolRanking,
} from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import {
  flatSettingsOf,
  formulaOf,
  type PoolRoundPhase,
  type FormulaV2,
} from '../../../shared/domain/formula/formulaV2';
import { applyOperationsV2 } from '../../../shared/domain/formula/formulaV2Operations';
import { cumulativeRanking } from '../../../shared/domain/pools/roundSeeding';
import { computeOverallRankingFor } from '../../../shared/utils/poolOrchestration';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';
import { CONTRACT_MCP_TOOLS } from '../api/mcpAdapter';
import { contract } from '../../../shared/api/contract';

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
const session = (id: string) => db.getSessionState(id) as Record<string, any>;
const events = (id: string) => db.eventLog.getSince(id);

const weapon = Weapon.EPEE;
const base = buildDefaultCompetitionSettings({
  weapon,
  category: Category.SENIOR,
}) as CompetitionSettings;
const fctx = { weapon, category: Category.SENIOR, settings: base };
let n = 0;
const newId = () => `ph-${++n}`;

/** Formule à deux tours : 6 qualifiés au premier ; le second, poules de 3 et score max 8 */
const twoRounds = (): FormulaV2 => {
  const f = applyOperationsV2(fctx, [{ op: 'insertPhase', brick: 'pool', at: 1 }], newId);
  let i = 0;
  return {
    ...f,
    phases: f.phases.map(p => {
      if (p.kind !== 'pool') return p;
      return i++ === 0
        ? { ...p, qualification: { mode: 'fixed_count', count: 6 } }
        : { ...p, sizeMin: 3, sizeMax: 3, maxScore: 8 };
    }),
  };
};

/** Poules, tableau arrêté à 8 tireurs, poules de 4 pour les restants */
const stoppedAt8 = (): FormulaV2 => {
  const f = formulaOf(fctx);
  const pool = f.phases[0] as PoolRoundPhase;
  const tableau = { ...f.phases[1], stopAt: 8 } as FormulaV2['phases'][number];
  return { ...f, phases: [pool, tableau, { ...pool, id: 'final-pool', sizeMin: 4, sizeMax: 4 }] };
};

/** Épreuve de `count` tireurs pointés (clubs distincts), rang d'entrée 1 à `count` */
function competition(f: FormulaV2, count: number) {
  const comp = db.createCompetition({
    title: 'Plusieurs tours',
    date: new Date('2026-12-06'),
    location: 'Gymnase',
    weapon,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    settings: { ...base, ...flatSettingsOf(f, weapon), formula: f } as never,
  });
  for (let i = 0; i < count; i++) {
    db.addFencer(comp.id, {
      lastName: `NOM${String(i + 1).padStart(2, '0')}`,
      firstName: `P${i + 1}`,
      gender: Gender.MALE,
      club: `Club${i}`,
      ranking: i + 1,
      status: FencerStatus.CHECKED_IN,
    });
  }
  return comp;
}

/** Rang d'entrée d'un tireur, lu dans son nom (NOM07 → 7) */
const entryRank = (f: { lastName: string }) => Number(f.lastName.slice(3));
const rankOf = (id: string) => entryRank(db.getFencer(id)!);

/**
 * Joue tous les matchs de poule du tour courant : le mieux placé gagne (`weakWins` : le moins
 * bien placé), au score max du match ; score du perdant varié (classement sans égalité)
 */
async function playPools(
  competitionId: string,
  weakWins = false,
  strict = true,
  /** Clé de force d'un tireur (rang d'entrée) : la plus petite gagne */
  key: (rank: number) => number = rank => rank
) {
  const pools = session(competitionId).pools as Pool[];
  for (const pool of pools) {
    for (const m of pool.matches) {
      const a = rankOf(m.fencerA!.id);
      const b = rankOf(m.fencerB!.id);
      const aWins = key(a) < key(b) !== weakWins;
      const loser = (7 * (aWins ? a : b) + 3 * (aWins ? b : a)) % m.maxScore;
      await call('recordScore', {
        competitionId,
        matchId: m.id,
        scoreA: aWins ? m.maxScore : loser,
        scoreB: aWins ? loser : m.maxScore,
      });
    }
  }
  // Classement sans égalité : l'ordre du tirage suivant ne dépend que des résultats
  const ranks = (session(competitionId).overallRanking as PoolRanking[]).map(r => r.rank);
  if (strict) expect(new Set(ranks).size).toBe(ranks.length);
}

const poolIds = (competitionId: string) =>
  (session(competitionId).pools as Pool[]).map(p => p.fencers.map(f => f.id).sort());
/** Serpentin de `ids` (déjà dans l'ordre des places) sur 2 poules */
const snake = (ids: string[]) => {
  const pools: string[][] = [[], []];
  ids.forEach((id, i) => {
    const row = Math.floor(i / 2);
    pools[row % 2 === 0 ? i % 2 : 1 - (i % 2)].push(id);
  });
  return pools.map(p => [...p].sort());
};

/** Tour 1 joué à l'envers (le moins bien classé gagne), clos : tour 2 à pointer */
async function closeFirstRound() {
  const comp = competition(twoRounds(), 12);
  await call('generatePools', { competitionId: comp.id, poolCount: 2 });
  await playPools(comp.id, true);
  const ranking = session(comp.id).overallRanking as PoolRanking[];
  const order = db.getFencersByCompetition(comp.id).map(f => f.id);
  // Places au tour 1 : rang, puis ordre de la liste (égalité parfaite)
  const places = [...ranking]
    .sort((a, b) => a.rank - b.rank || order.indexOf(a.fencer.id) - order.indexOf(b.fencer.id))
    .map(r => r.fencer.id);
  const report = await call('closePoolRound', { competitionId: comp.id });
  return { comp, places, report };
}

d('tour suivant tiré par le moteur (docs/adr/0042)', () => {
  it('tour 2 : tireurs pointés, serpentin sur la place au tour 1, réglages du tour 2', async () => {
    const { comp, places, report } = await closeFirstRound();
    expect(report).toMatchObject({ round: 1, nextRound: 2, qualified: 6, eliminated: 6 });
    const qualified = places.slice(0, 6);
    // Reclassés par le tour 1 : le moins bien placé à l'entrée gagnait, il passe en tête
    expect(rankOf(qualified[0])).toBeGreaterThan(rankOf(places[places.length - 1]));

    const res = await call('generatePools', { competitionId: comp.id });
    // Poules de 3 (formule, tour 2) : 2 poules, pas la poule de 6 des bornes par défaut
    expect(res).toMatchObject({ round: 2, fencerCount: 6, poolCount: 2 });
    expect(poolIds(comp.id).sort()).toEqual(snake(qualified).sort());
    const state = session(comp.id);
    expect(state.currentPoolRound).toBe(2);
    expect(state.poolHistory).toHaveLength(1);
    // Score max du tour 2 (formule, 8)
    for (const p of state.pools as Pool[]) {
      expect(p.matches.every(m => m.maxScore === 8)).toBe(true);
    }
    const generated = events(comp.id).filter(e => e.type === 'PoolsGenerated');
    expect(generated).toHaveLength(2);
    expect((generated[1].payload as any).round).toBe(2);
    // Éliminés du tour 1 : pas tirés
    const drawn = new Set(poolIds(comp.id).flat());
    for (const id of places.slice(6)) expect(drawn.has(id)).toBe(false);
  });

  it('tour 2 : réparti sur le classement du tour 1, pas sur le rang relu en base', async () => {
    const { comp, places } = await closeFirstRound();
    // Rang des tireurs brouillé (sans rapport avec les places) : le moteur reclasse, comme l'écran
    [4, 1, 5, 2, 6, 3].forEach((rank, i) => db.updateFencer(places[i], { ranking: rank }));
    await call('generatePools', { competitionId: comp.id });
    expect(poolIds(comp.id).sort()).toEqual(snake(places.slice(0, 6)).sort());
  });

  it('tour 2 : tireurs non pointés écartés, poules lancées, replace refusé sans lui', async () => {
    const { comp, places } = await closeFirstRound();
    // 6 qualifiés dont un absent à l'appel : 5 tireurs, tailles de la formule (3-3)
    db.updateFencer(places[5], { status: FencerStatus.NOT_CHECKED_IN });
    const res = await call('generatePools', { competitionId: comp.id });
    expect(res.fencerCount).toBe(5);
    await playPools(comp.id);
    await expect(call('generatePools', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'pools_have_scores',
    });
    // Tailles demandées : priment sur la formule
    const again = await call('generatePools', {
      competitionId: comp.id,
      replace: true,
      poolCount: 1,
    });
    expect(again).toMatchObject({ round: 2, poolCount: 1 });
    expect(session(comp.id).poolHistory).toHaveLength(1);
  });

  it('tableau après deux tours : les survivants du tour 2, sur son classement', async () => {
    const { comp, places } = await closeFirstRound();
    await call('generatePools', { competitionId: comp.id });
    await playPools(comp.id);
    const ranking = session(comp.id).overallRanking as PoolRanking[];
    const survivors = ranking.filter(r => r.fencer.status !== FencerStatus.ELIMINATED);
    expect(survivors.map(r => r.fencer.id).sort()).toEqual(places.slice(0, 6).sort());

    const sim = await call('generateTableau', { competitionId: comp.id, dryRun: true });
    expect(sim).toMatchObject({ size: 8, qualified: 6 });
    await call('generateTableau', { competitionId: comp.id });
    const tableau = session(comp.id).tableauMatches as TableauMatch[];
    const placed = tableau
      .filter(m => m.round === 8)
      .flatMap(m => [m.fencerA?.id, m.fencerB?.id])
      .filter(Boolean);
    expect([...placed].sort()).toEqual(places.slice(0, 6).sort());
    // Tête de série 1 : le premier du tour 2
    const best = [...survivors].sort((a, b) => a.rank - b.rank)[0].fencer.id;
    const seedOne = tableau.find(m => m.seedA === 1 || m.seedB === 1)!;
    expect((seedOne.seedA === 1 ? seedOne.fencerA : seedOne.fencerB)?.id).toBe(best);
    expect(events(comp.id).filter(e => e.type === 'TableauGenerated')).toHaveLength(1);
  });

  it('scission après deux tours : poules du tour 2 tirées par le moteur, puis scission', async () => {
    // Formule : tour 1 (6 qualifiés), tour 2, scission par rang (3 + le reste)
    const two = twoRounds();
    const f = applyOperationsV2(
      { ...fctx, settings: { ...base, formula: two } },
      [
        { op: 'removePhase', phase: 'tableau' },
        { op: 'insertPhase', brick: 'split', at: 2 },
      ],
      newId
    );
    const withTake: FormulaV2 = {
      ...f,
      phases: f.phases.map(p =>
        p.kind === 'split'
          ? {
              ...p,
              branches: p.branches.map((b, i) =>
                i === 0 ? { ...b, take: { mode: 'fixed_count', count: 3 } } : b
              ),
            }
          : p
      ),
    };
    const comp = competition(withTake, 12);
    await call('generatePools', { competitionId: comp.id, poolCount: 2 });
    await playPools(comp.id, true);
    await call('closePoolRound', { competitionId: comp.id });
    // Tour 2 tiré par le moteur, sans placement de l'écran
    await call('generatePools', { competitionId: comp.id });
    await playPools(comp.id, false, false);
    const out = await call('splitCompetition', { competitionId: comp.id });
    expect(out.branches.map((b: any) => b.fencers.length)).toEqual([3, 3]);
    expect(out.branches.every((b: any) => typeof b.competitionId === 'string')).toBe(true);
  });

  it('arbitres du tour courant : poules du tour 2', async () => {
    const { comp } = await closeFirstRound();
    await call('generatePools', { competitionId: comp.id });
    db.createReferee(comp.id, { name: 'Arbitre Z', club: 'Z', nationality: 'FRA' } as never);
    const r = db.getRefereesByCompetition(comp.id)[0];
    db.updateReferee(r.id, { status: 'available' } as never);
    const out = await call('assignReferees', { competitionId: comp.id });
    expect(out.assignments).toHaveLength(2);
    const pools = session(comp.id).pools as Pool[];
    expect(pools.every(p => p.referees?.[0]?.id === r.id)).toBe(true);
    // À la main, sur le tour courant
    await call('assignReferee', { competitionId: comp.id, poolNumber: 1, refereeId: null });
    expect((session(comp.id).pools as Pool[])[0].referees?.length ?? 0).toBe(0);
  });
});

/** Trois tours : 8 puis 6 qualifiés ; poules de 3 ; le 3e tour réparti selon `seeding` */
const threeRounds = (seeding: 'previous_round' | 'cumulative'): FormulaV2 => {
  const f = applyOperationsV2(
    fctx,
    [
      { op: 'insertPhase', brick: 'pool', at: 1 },
      { op: 'insertPhase', brick: 'pool', at: 2 },
    ],
    newId
  );
  let i = 0;
  return {
    ...f,
    phases: f.phases.map(p => {
      if (p.kind !== 'pool') return p;
      const k = i++;
      return k === 0
        ? { ...p, qualification: { mode: 'fixed_count', count: 8 } }
        : k === 1
          ? { ...p, sizeMin: 3, sizeMax: 4, qualification: { mode: 'fixed_count', count: 6 } }
          : { ...p, sizeMin: 3, sizeMax: 3, seeding };
    }),
  };
};

d('répartition du 3e tour : cumul des tours (Q4, ADR-0036, ADR-0042)', () => {
  /** Tour 1 à l'envers, tour 2 à l'endroit : le cumul diffère du tour 2 seul */
  async function toRound3(seeding: 'previous_round' | 'cumulative') {
    const comp = competition(threeRounds(seeding), 12);
    await call('generatePools', { competitionId: comp.id, poolCount: 2 });
    await playPools(comp.id, true);
    await call('closePoolRound', { competitionId: comp.id });
    await call('generatePools', { competitionId: comp.id, poolCount: 2 });
    await playPools(comp.id, false, false, rank => (rank % 3) * 20 + rank);
    const ranks = (session(comp.id).overallRanking as PoolRanking[])
      .filter(r => r.fencer.status !== FencerStatus.ELIMINATED)
      .map(r => r.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    await call('closePoolRound', { competitionId: comp.id });
    const history = session(comp.id).poolHistory as Pool[][];
    const order = db.getFencersByCompetition(comp.id).map(f => f.id);
    const ids = (rows: PoolRanking[]) =>
      rows
        .filter(r => db.getFencer(r.fencer.id)!.status === FencerStatus.CHECKED_IN)
        .sort((a, b) => a.rank - b.rank || order.indexOf(a.fencer.id) - order.indexOf(b.fencer.id))
        .map(r => r.fencer.id);
    const lastOnly = ids(computeOverallRankingFor(history[1], false));
    const cumulative = ids(cumulativeRanking(history.slice(0, -1), history[1], false));
    return { comp, lastOnly, cumulative };
  }

  it('3e tour « cumulative » : serpentin sur le classement cumulé, pas sur le tour 2 seul', async () => {
    const { comp, lastOnly, cumulative } = await toRound3('cumulative');
    expect(cumulative).toHaveLength(6);
    expect(cumulative).not.toEqual(lastOnly);
    expect(snake(cumulative).sort()).not.toEqual(snake(lastOnly).sort());
    const res = await call('generatePools', { competitionId: comp.id });
    expect(res).toMatchObject({ round: 3, fencerCount: 6, poolCount: 2 });
    expect(poolIds(comp.id).sort()).toEqual(snake(cumulative).sort());
  });

  it('3e tour « previous_round » (défaut) : serpentin sur le tour 2 seul', async () => {
    const { comp, lastOnly } = await toRound3('previous_round');
    await call('generatePools', { competitionId: comp.id });
    expect(poolIds(comp.id).sort()).toEqual(snake(lastOnly).sort());
  });
});

d('tableau arrêté puis tour de poules (docs/adr/0037, 0042)', () => {
  /** 16 tireurs, tableau de 16 joué à l'envers (les 8 moins bien classés passent) */
  async function stopped() {
    const comp = competition(stoppedAt8(), 16);
    await call('generatePools', { competitionId: comp.id });
    await playPools(comp.id);
    await call('generateTableau', { competitionId: comp.id });
    const tableau = session(comp.id).tableauMatches as TableauMatch[];
    for (const m of tableau.filter(x => x.round === 16)) {
      const aSeed = m.seedA ?? 0;
      const bSeed = m.seedB ?? 0;
      const aWins = aSeed > bSeed;
      await call('recordScore', {
        competitionId: comp.id,
        matchId: m.id,
        scoreA: aWins ? 15 : 10,
        scoreB: aWins ? 10 : 15,
      });
    }
    const closed = await call('closeTableauStage', { competitionId: comp.id });
    return { comp, tableau, closed };
  }

  it('tour suivant tiré par le moteur sur le rang d’entrée au tableau', async () => {
    const { comp, tableau, closed } = await stopped();
    expect(closed).toMatchObject({ stopAt: 8, qualified: 8, eliminated: 8 });
    const staged = (session(comp.id).stageHistory as any[])[0].matches as TableauMatch[];
    // Restants, dans l'ordre de leur rang d'entrée au tableau
    const entry = new Map<string, number>();
    for (const m of tableau.filter(x => x.round === 16)) {
      if (m.fencerA) entry.set(m.fencerA.id, m.seedA!);
      if (m.fencerB) entry.set(m.fencerB.id, m.seedB!);
    }
    expect(staged.length).toBeGreaterThan(0);
    const remaining = db
      .getFencersByCompetition(comp.id)
      .filter(f => f.status === FencerStatus.CHECKED_IN)
      .map(f => f.id)
      .sort((a, b) => entry.get(a)! - entry.get(b)!);
    expect(remaining).toHaveLength(8);

    // Poules de 4 (formule, 2e tour de poules) : 2 poules, serpentin sur ce classement
    const res = await call('generatePools', { competitionId: comp.id });
    expect(res).toMatchObject({ round: 2, fencerCount: 8, poolCount: 2 });
    expect(poolIds(comp.id).sort()).toEqual(snake(remaining).sort());
    expect(session(comp.id).poolHistory).toHaveLength(1);
    expect(session(comp.id).stageHistory).toHaveLength(1);
  });

  it('plus de tableau après le tableau arrêté : les tours de poules terminent l’épreuve', async () => {
    const { comp } = await stopped();
    await call('generatePools', { competitionId: comp.id });
    await playPools(comp.id, false, false);
    await expect(call('generateTableau', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'no_direct_elimination',
    });
    // Placement composé par l'écran : refusé aussi (un seul tableau, ADR-0042)
    const placed = (session(comp.id).pools as Pool[]).flatMap(p => p.fencers.map(f => f.id));
    await expect(
      call('generateTableau', {
        competitionId: comp.id,
        composition: [
          {
            matchId: '2-0',
            round: 2,
            position: 0,
            fencerAId: placed[0],
            fencerBId: placed[1],
            isBye: false,
          },
        ],
      })
    ).rejects.toMatchObject({ code: 'no_direct_elimination' });
    expect(events(comp.id).filter(e => e.type === 'TableauGenerated')).toHaveLength(1);
  });

  it('outil MCP close_tableau_stage : clôture du tableau arrêté ouverte à l’agent (ADR-0042)', () => {
    const tool = CONTRACT_MCP_TOOLS.write.find(t => t.name === 'close_tableau_stage');
    expect(tool).toBeDefined();
    expect(contract.closeTableauStage.mcp?.name).toBe('close_tableau_stage');
  });
});

d('formats toujours refusés (docs/adr/0042)', () => {
  it.each([
    ['équipes', { isTeamEvent: true }],
    ['rapières', { settings: { ...base, specialMode: 'rapieres' } }],
  ])('%s : tirage sans composition, tableau et arbitres refusés', async (_name, patch) => {
    const comp = competition(formulaOf(fctx), 8);
    db.updateCompetition(comp.id, patch as never);
    for (const [op, input] of [
      ['generatePools', {}],
      ['generateTableau', {}],
      ['assignReferees', {}],
      ['assignReferee', { poolNumber: 1, refereeId: null }],
    ] as const) {
      await expect(call(op, { competitionId: comp.id, ...input })).rejects.toMatchObject({
        code: 'unsupported_format',
      });
    }
    expect(events(comp.id)).toHaveLength(0);
  });
});
