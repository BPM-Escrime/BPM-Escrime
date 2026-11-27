import { describe, expect, it, vi } from 'vitest';
import { Category, CompetitionSettings, FencerStatus, Weapon } from '../../types';
import type { Fencer, Pool, PoolRanking } from '../../types';

/** Classement de chaque tour fourni par le test (pool.id → classement du tour) */
const rankings = new Map<string, PoolRanking[]>();
vi.mock('../../utils/poolOrchestration', () => ({
  computeOverallRankingFor: (pools: Pool[]) => rankings.get(pools[0]?.id ?? '') ?? [],
}));

import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import { applyOperationsV2 } from '../formula/formulaV2Operations';
import type { FormulaV2 } from '../formula/formulaV2';
import type { TableauMatch } from './tableauTypes';
import {
  closeStage,
  isStageDone,
  rankAfterStages,
  rankingAfterStage,
  resultsTableauMatches,
  seedRankingForNextRound,
  stageMatches,
  type TableauStageRecord,
} from './tableauStage';

const f = (id: string) => ({ id, lastName: id, firstName: id }) as Fencer;
let n = 0;
const m = (
  round: number,
  a: Fencer | null,
  b: Fencer | null,
  winner: Fencer | null,
  seeds: [number | null, number | null] = [null, null]
): TableauMatch => ({
  id: `m${++n}`,
  round,
  position: n,
  fencerA: a,
  fencerB: b,
  scoreA: null,
  scoreB: null,
  winner,
  isBye: !a || !b,
  seedA: seeds[0],
  seedB: seeds[1],
});

// Tableau de 8 arrêté à 2 : quarts (8) et demies (4) se jouent, la finale (2) non
const [s1, s2, s3, s4, s5, s6, s7, s8] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(f);
const quarters = [
  m(8, s1, s8, s1, [1, 8]),
  m(8, s4, s5, s5, [4, 5]),
  m(8, s3, s6, s6, [3, 6]),
  m(8, s2, s7, s2, [2, 7]),
];
const semis = [m(4, s1, s5, s5), m(4, s6, s2, s2)];
const final = m(2, s5, s2, null);

describe('tableau arrêté à N (ADR-0037)', () => {
  it('seuls les tours où il reste plus de N tireurs se jouent', () => {
    expect(stageMatches([...quarters, ...semis, final], 2)).toHaveLength(6);
    expect(isStageDone([...quarters, ...semis, final], 2)).toBe(true);
    expect(isStageDone([...quarters, { ...semis[0], winner: null }, semis[1]], 2)).toBe(false);
  });

  it('restants par rang d’entrée ; éliminés par tour atteint puis rang d’entrée (Q5)', () => {
    const out = closeStage([...quarters, ...semis, final], 2)!;
    // E (5) et B (2) restent : B entre en premier
    expect(out.qualified.map(x => x.id)).toEqual(['B', 'E']);
    // Demi-finalistes battus d'abord (A rang 1, F rang 6), puis quarts (C 3, D 4, G 7, H 8)
    expect(out.eliminated.map(e => [e.fencer.id, e.round])).toEqual([
      ['A', 4],
      ['F', 4],
      ['C', 8],
      ['D', 8],
      ['G', 8],
      ['H', 8],
    ]);
  });

  it('étape non terminée : pas de clôture', () => {
    expect(closeStage([...quarters, { ...semis[0], winner: null }, semis[1]], 2)).toBeNull();
  });
});

describe('classement final après un tableau arrêté (Q5)', () => {
  const out = closeStage([...quarters, ...semis, final], 2)!;
  const stage: TableauStageRecord = {
    kind: 'tableau',
    stopAt: 2,
    matches: [...quarters, ...semis, final],
    eliminated: out.eliminated.map(e => ({ fencerId: e.fencer.id, round: e.round, seed: e.seed })),
  };
  const row = (id: string, rank: number) => ({ fencer: f(id), rank }) as PoolRanking;
  // Classement des tours : poule finale (E 1, B 2), puis tour d'avant le tableau (I, J éliminés)
  const merged = ['E', 'B', 'A', 'C', 'D', 'F', 'G', 'H', 'I', 'J'].map((id, i) => row(id, i + 1));

  it('restants, puis éliminés du tableau (tour, rang d’entrée), puis éliminés des poules', () => {
    const r = rankAfterStages(merged, [stage]);
    expect(r.ranking.map(x => [x.fencer.id, x.rank])).toEqual([
      ['E', 1],
      ['B', 2],
      ['A', 3],
      ['F', 4],
      ['C', 5],
      ['D', 6],
      ['G', 7],
      ['H', 8],
      ['I', 9],
      ['J', 10],
    ]);
    expect(r.eliminatedAt.get('F')).toBe('Tableau de 4');
    expect(r.eliminatedAt.get('H')).toBe('Tableau de 8');
    expect(r.eliminatedAt.has('I')).toBe(false);
  });

  it('même tour et même rang d’entrée : ex aequo', () => {
    const tied = { ...stage, eliminated: stage.eliminated.map(e => ({ ...e, seed: 1 })) };
    const r = rankAfterStages(merged, [tied]);
    expect(r.ranking.slice(2, 8).map(x => [x.fencer.id, x.rank])).toEqual([
      ['A', 3],
      ['F', 3],
      ['C', 5],
      ['D', 5],
      ['G', 5],
      ['H', 5],
    ]);
  });

  it('sans étape close : classement inchangé', () => {
    expect(rankAfterStages(merged, []).ranking).toBe(merged);
  });
});

describe('répartition du tour après un tableau arrêté (Q5)', () => {
  it('restants seuls, dans l’ordre de leur rang d’entrée', () => {
    const out = closeStage([...quarters, ...semis, final], 2)!;
    const stage: TableauStageRecord = {
      kind: 'tableau',
      stopAt: 2,
      matches: [...quarters, ...semis, final],
      eliminated: out.eliminated.map(e => ({
        fencerId: e.fencer.id,
        round: e.round,
        seed: e.seed,
      })),
    };
    // Classement du tour d'avant : E devant B ; au tableau, B est entré 2ᵉ, E 5ᵉ
    const before = ['E', 'B', 'A', 'C'].map(
      (id, i) => ({ fencer: f(id), rank: i + 1 }) as PoolRanking
    );
    expect(rankingAfterStage(before, stage).map(r => [r.fencer.id, r.rank])).toEqual([
      ['B', 2],
      ['E', 5],
    ]);
  });
});

describe('tableau des résultats et des exports (ADR-0037)', () => {
  it('tableau clos repris quand aucun tableau n’est en cours', () => {
    const closed: TableauStageRecord = {
      kind: 'tableau',
      stopAt: 2,
      matches: quarters,
      eliminated: [],
    };
    expect(resultsTableauMatches([], closed)).toBe(quarters);
    expect(resultsTableauMatches(semis, closed)).toBe(semis);
    expect(resultsTableauMatches([], undefined)).toEqual([]);
  });
});

describe('répartition du tour à tirer, écran (Q5, ADR-0037)', () => {
  const settings = buildDefaultCompetitionSettings({
    weapon: Weapon.EPEE,
    category: Category.SENIOR,
  }) as CompetitionSettings;
  const formula = applyOperationsV2(
    { weapon: Weapon.EPEE, category: Category.SENIOR, settings },
    [
      { op: 'setPhase', phase: 'tableau', settings: { stopAt: 2 } },
      { op: 'insertPhase', brick: 'pool', at: 2 },
    ],
    () => 'x'
  );
  const out = closeStage([...quarters, ...semis, final], 2)!;
  const stage: TableauStageRecord = {
    kind: 'tableau',
    stopAt: 2,
    matches: [...quarters, ...semis, final],
    eliminated: out.eliminated.map(e => ({ fencerId: e.fencer.id, round: e.round, seed: e.seed })),
  };
  const rows = ['E', 'B', 'A', 'C'].map((id, i) => ({ fencer: f(id), rank: i + 1 }) as PoolRanking);
  const round = (id: string, ranking: PoolRanking[]): Pool[] => {
    rankings.set(id, ranking);
    return [{ id } as Pool];
  };
  const last = round('after-stage', rows);
  const seed = (history: Pool[][], stages: TableauStageRecord[], fm = formula) =>
    seedRankingForNextRound({ formula: fm, history, stages, isLaserSabre: false });

  it('premier tour après le tableau clos : restants par rang d’entrée', () => {
    expect(seed([last], [stage]).map(x => x.fencer.id)).toEqual(['B', 'E']);
  });

  it('autres tours, ou sans étape close : classement du dernier tour', () => {
    expect(seed([last, last], [stage])).toEqual(rows);
    expect(seed([last], [])).toEqual(rows);
  });
});

describe('répartition du tour à tirer : cumul des tours (Q4, ADR-0036)', () => {
  const row = (id: string, rank: number, v: number, m: number, td: number, tr: number) =>
    ({
      fencer: { id, lastName: id, firstName: id, status: FencerStatus.CHECKED_IN },
      rank,
      victories: v,
      defeats: m - v,
      matchesPlayed: m,
      touchesScored: td,
      touchesReceived: tr,
      index: td - tr,
      ratio: v / m,
    }) as PoolRanking;
  // Tour 1 : A domine ; tour 2 : B gagne tout, A perd tout
  const r1: Pool[] = [{ id: 'c1' } as Pool];
  const r2: Pool[] = [{ id: 'c2' } as Pool];
  rankings.set('c1', [
    row('A', 1, 4, 4, 20, 5),
    row('B', 2, 2, 4, 14, 12),
    row('C', 3, 0, 4, 5, 20),
  ]);
  rankings.set('c2', [row('B', 1, 2, 2, 10, 4), row('C', 2, 1, 2, 7, 8), row('A', 3, 0, 2, 4, 10)]);

  const settings = buildDefaultCompetitionSettings({
    weapon: Weapon.EPEE,
    category: Category.SENIOR,
  }) as CompetitionSettings;
  /** Trois tours de poules ; le 3e est réparti selon `seeding` */
  const threeRounds = (seeding: 'previous_round' | 'cumulative') =>
    applyOperationsV2(
      { weapon: Weapon.EPEE, category: Category.SENIOR, settings },
      [
        { op: 'insertPhase', brick: 'pool', at: 1 },
        { op: 'insertPhase', brick: 'pool', at: 2 },
        { op: 'setPhase', phase: 'pool-2', settings: { seeding } },
      ],
      () => 'x'
    );
  const seed = (formula: FormulaV2 | undefined, history: Pool[][]) =>
    seedRankingForNextRound({ formula, history, stages: [], isLaserSabre: false }).map(
      x => x.fencer.id
    );

  it('tour à tirer « cumulative » : classement cumulé de tous les tours joués', () => {
    expect(seed(threeRounds('cumulative'), [r1, r2])).toEqual(['A', 'B', 'C']);
  });

  it('« previous_round » (défaut), ou sans formule : classement du dernier tour seul', () => {
    expect(seed(threeRounds('previous_round'), [r1, r2])).toEqual(['B', 'C', 'A']);
    expect(seed(undefined, [r1, r2])).toEqual(['B', 'C', 'A']);
  });

  it('le réglage lu est celui du tour à tirer, pas celui du tour terminé', () => {
    // 3e tour « cumulative » : le tirage du 2e tour (un seul tour joué) n'est pas concerné
    expect(seed(threeRounds('cumulative'), [r2])).toEqual(['B', 'C', 'A']);
  });
});

describe('classement final avant le tour suivant (restants renumérotés)', () => {
  it('restants rangés depuis 1 même si le classement reçu est celui d’avant le tableau', () => {
    const out = closeStage([...quarters, ...semis, final], 2)!;
    const stage: TableauStageRecord = {
      kind: 'tableau',
      stopAt: 2,
      matches: [...quarters, ...semis, final],
      eliminated: out.eliminated.map(e => ({
        fencerId: e.fencer.id,
        round: e.round,
        seed: e.seed,
      })),
    };
    // Classement d'avant le tableau : B 2e, E 5e (restants), I et J éliminés des poules
    const before = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map(
      (id, i) => ({ fencer: f(id), rank: i + 1 }) as PoolRanking
    );
    const r = rankAfterStages(before, [stage]).ranking;
    expect(r.map(x => [x.fencer.id, x.rank])).toEqual([
      ['B', 1],
      ['E', 2],
      ['A', 3],
      ['F', 4],
      ['C', 5],
      ['D', 6],
      ['G', 7],
      ['H', 8],
      ['I', 9],
      ['J', 10],
    ]);
  });
});
