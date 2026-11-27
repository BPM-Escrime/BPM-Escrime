/**
 * Tests : classement final des rapières (`mergeFinalRanking`) comparé au classement final
 * générique (`finalRanking`, celui de l'écran des résultats) sur des épreuves représentatives
 * (docs/adr/0043, F4d : « vérifié identique au classement générique avant le retrait »).
 * Licensed under GPL-3.0
 */
import { describe, it, expect } from 'vitest';
import { FencerStatus, Gender, MatchStatus } from '../../types';
import type { AdvancementRule, Fencer, Match, Pool, PoolRanking } from '../../types';
import { calculateOverallRanking } from '../../utils/poolCalculations';
import { waveMatchOrder } from '../pools/waves';
import {
  autoFillAllPositions,
  autoFillTableauScores,
  buildCombinedResults,
  calculateFinalResults,
  planTableau,
} from '../tableau/tableauCalculations';
import type { FinalResult } from '../tableau/tableauTypes';
import { tableauCut } from '../ranking/tableauRanking';
import { finalRanking } from '../ranking/finalRanking';
import { mergeFinalRanking, rapieresTableauSettings } from './rapieresCalculations';

const team = (id: string, status = FencerStatus.CHECKED_IN): Fencer =>
  ({
    id,
    ref: 0,
    lastName: `Équipe ${id}`,
    firstName: '',
    gender: Gender.MIXED,
    nationality: 'FRA',
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Fencer;

const makePool = (fencers: Fencer[], number: number): Pool => {
  const poolId = `p${number}`;
  const matches: Match[] = waveMatchOrder(fencers).map(([a, b], i) => ({
    id: `${poolId}-m${i + 1}`,
    number: i + 1,
    fencerA: fencers[a - 1],
    fencerB: fencers[b - 1],
    scoreA: null,
    scoreB: null,
    maxScore: 5,
    status: MatchStatus.NOT_STARTED,
    poolId,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  return {
    id: poolId,
    number,
    phaseId: 'phase-pools',
    fencers,
    matches,
    referees: [],
    isComplete: false,
    hasError: false,
    ranking: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Pool;
};

/**
 * Le plus petit numéro d'équipe gagne toujours ; le perdant marque plus de touches dans les poules
 * suivantes (indices différents d'une poule à l'autre : pas d'ex aequo au classement général)
 */
const play = (pool: Pool) => {
  const lost = Math.min(4, pool.number);
  for (const m of pool.matches) {
    const num = (f: Fencer | null) => Number(f!.id.slice(1));
    const aWins = num(m.fencerA) < num(m.fencerB);
    m.scoreA = { value: aWins ? 5 : lost, isVictory: aWins } as Match['scoreA'];
    m.scoreB = { value: aWins ? lost : 5, isVictory: !aWins } as Match['scoreB'];
    m.status = MatchStatus.FINISHED;
  }
};

/** Hasard déterministe (graine fixe) */
const seeded = () => {
  let s = 12345;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
};

type Mode = 'normal' | 'third' | 'all' | 'semis' | 'semisNoThird';

interface Scenario {
  pools: number;
  size: number;
  mode: Mode;
  /** Équipes retirées avant le tableau (statut) */
  before?: Record<string, FencerStatus>;
  /** Équipes retirées après le tableau (statut du classement final) */
  after?: Record<string, FencerStatus>;
  /** Équipes exclues sur carton noir après le tableau */
  blackCard?: string[];
}

/** Épreuve complète : poules, qualification (formule), tableau joué, résultats finals */
function play_(sc: Scenario) {
  const pools = Array.from({ length: sc.pools }, (_, p) =>
    makePool(
      Array.from({ length: sc.size }, (_, i) => {
        const id = `t${p * sc.size + i + 1}`;
        return team(id, sc.before?.[id] ?? FencerStatus.CHECKED_IN);
      }),
      p + 1
    )
  );
  pools.forEach(play);
  const overall = calculateOverallRanking(pools);
  const settings =
    sc.mode === 'semisNoThird'
      ? { thirdPlaceMatch: false, playAllPositions: false }
      : rapieresTableauSettings(sc.mode);
  // Formule en briques : « semis » = têtes de poule (4) ; les autres modes, tous qualifiés
  const rule: AdvancementRule | undefined =
    sc.mode === 'semis' || sc.mode === 'semisNoThird'
      ? { mode: 'pool_heads', count: 4 }
      : { mode: 'all' };
  const cut = tableauCut(overall, pools, {
    isRapieres: false,
    rapieresTableauMode: undefined,
    poolWinnersOnly: false,
    customFormula: undefined,
    tableauQualification: rule,
    postPoolSplitCriteria: undefined,
    activeSplitGroup: null,
    splitOffCompetitionIds: undefined,
  });
  const plan = planTableau(cut.ranking, settings);
  const random = seeded();
  let finalResults: FinalResult[];
  if (settings.playAllPositions) {
    const filled = autoFillAllPositions(plan.matches, [], 5, plan.size, cut.ranking, { random });
    finalResults = buildCombinedResults(filled.updatedMatches, filled.updatedBrackets, cut.ranking);
  } else {
    const { updatedMatches } = autoFillTableauScores(plan.matches, 5, plan.size, random);
    finalResults = calculateFinalResults(updatedMatches, cut.ranking, plan.size);
  }
  const withStatus = <T extends { fencer: Fencer }>(rows: T[]): T[] =>
    rows.map(r => {
      if (sc.blackCard?.includes(r.fencer.id))
        return {
          ...r,
          fencer: { ...r.fencer, status: FencerStatus.EXCLUDED, exclusionReason: 'black_card' },
        };
      const status = sc.after?.[r.fencer.id];
      return status ? { ...r, fencer: { ...r.fencer, status } } : r;
    });
  return {
    overall: withStatus(overall) as PoolRanking[],
    cutRanking: withStatus(cut.ranking) as PoolRanking[],
    finalResults: withStatus(finalResults),
  };
}

const ids = (rows: { teamId: string; rank: number | null }[]) =>
  rows.map(r => `${r.teamId}:${r.rank}`);
const generic = (finalResults: FinalResult[], poolRanking: PoolRanking[]) =>
  finalRanking({ finalResults, poolRanking }).map(r => ({ teamId: r.fencer.id, rank: r.rank }));

describe('classement final : rapières (mergeFinalRanking) et générique (finalRanking)', () => {
  // Épreuves de la formule « un tour, puis tableau » : tous qualifiés, demi-finales (têtes de
  // poule), toutes les places, équipes retirées avant le tableau (forfait, exclusion)
  const identical: Array<[string, Scenario]> = [
    ['1 poule de 5, demi-finales', { pools: 1, size: 5, mode: 'semis' }],
    ['2 poules de 4, demi-finales', { pools: 2, size: 4, mode: 'semis' }],
    ['3 poules de 4, demi-finales', { pools: 3, size: 4, mode: 'semis' }],
    ['4 poules de 3, demi-finales', { pools: 4, size: 3, mode: 'semis' }],
    ['1 poule de 6, tous qualifiés (3es ex aequo)', { pools: 1, size: 6, mode: 'normal' }],
    ['2 poules de 4, tous qualifiés, petite finale', { pools: 2, size: 4, mode: 'third' }],
    ['3 poules de 4, tous qualifiés (tableau de 16)', { pools: 3, size: 4, mode: 'normal' }],
    ['4 poules de 3, toutes les places', { pools: 4, size: 3, mode: 'all' }],
    ['3 poules de 4, toutes les places', { pools: 3, size: 4, mode: 'all' }],
    [
      '3 poules de 4, demi-finales sans petite finale (3es ex aequo)',
      { pools: 3, size: 4, mode: 'semisNoThird' },
    ],
    [
      '3 poules de 4, tous qualifiés, une équipe forfait avant le tableau',
      { pools: 3, size: 4, mode: 'normal', before: { t6: FencerStatus.FORFAIT } },
    ],
    [
      '3 poules de 4, demi-finales, une équipe forfait avant le tableau',
      { pools: 3, size: 4, mode: 'semis', before: { t6: FencerStatus.FORFAIT } },
    ],
    [
      '2 poules de 4, tous qualifiés, une équipe exclue avant le tableau',
      { pools: 2, size: 4, mode: 'normal', before: { t2: FencerStatus.EXCLUDED } },
    ],
    [
      '2 poules de 4, demi-finales, une équipe exclue avant le tableau',
      { pools: 2, size: 4, mode: 'semis', before: { t2: FencerStatus.EXCLUDED } },
    ],
    [
      '3 poules de 4, demi-finales, une équipe non qualifiée exclue avant le tableau',
      { pools: 3, size: 4, mode: 'semis', before: { t12: FencerStatus.EXCLUDED } },
    ],
  ];

  it.each(identical)('%s : même classement', (_name, sc) => {
    const { overall, finalResults } = play_(sc);
    expect(ids(generic(finalResults, overall))).toEqual(
      ids(mergeFinalRanking(finalResults, overall))
    );
  });

  // Écarts constatés, à trancher par le mainteneur avant le retrait (F4e) : `it.fails` garde
  // l'égalité attendue par l'ADR-0043 sans changer le comportement, et signale (échec) le jour où
  // l'écart disparaît. Ces trois tests sont à retirer une fois la règle tranchée.
  describe('écarts à trancher avant F4e', () => {
    it.fails(
      'équipe exclue après son entrée au tableau : le générique la laisse à son rang, mergeFinalRanking la renvoie en dernier et renumérote',
      () => {
        const sc: Scenario = {
          pools: 2,
          size: 4,
          mode: 'normal',
          after: { t3: FencerStatus.EXCLUDED },
        };
        const { overall, finalResults } = play_(sc);
        // générique : t6:1 t3:2 t1:3 t8:3 t5:5 t2:6 t7:7 t4:8 ; rapières : t6:1 t1:2 t8:2 t5:4 …
        expect(ids(generic(finalResults, overall))).toEqual(
          ids(mergeFinalRanking(finalResults, overall))
        );
      }
    );

    it.fails(
      'équipe exclue sur carton noir : le générique lui retire le rang (« - », en dernier), mergeFinalRanking lui donne le dernier numéro',
      () => {
        const { overall, finalResults } = play_({
          pools: 2,
          size: 4,
          mode: 'normal',
          blackCard: ['t3'],
        });
        expect(ids(generic(finalResults, overall))).toEqual(
          ids(mergeFinalRanking(finalResults, overall))
        );
      }
    );

    it.fails(
      'écran des résultats : le classement des poules reçu est celui des qualifiés (tableauCut), les équipes non qualifiées ne sont pas listées (mergeFinalRanking les liste toutes, d’après le classement complet)',
      () => {
        const { overall, cutRanking, finalResults } = play_({ pools: 2, size: 4, mode: 'semis' });
        // écran générique : 4 lignes (qualifiés) ; rapières : 8 lignes
        expect(ids(generic(finalResults, cutRanking))).toEqual(
          ids(mergeFinalRanking(finalResults, overall))
        );
      }
    );
  });
});
