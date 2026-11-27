/**
 * Mode de tableau hérité du Tournoi des rapières (#1441) : qualifiés d'une épreuve enregistrée en
 * mode spécial, lus comme avant (docs/adr/0043, F4e)
 */
import { describe, it, expect } from 'vitest';
import { Fencer, FencerStatus, Gender, Match, MatchStatus, Pool } from '../../types';
import { rapieresTableauQualifiers, rapieresTableauSettings } from './tableauQualifiers';
import { waveMatchOrder } from '../pools/waves';
import { calculateOverallRanking } from '../../utils/poolCalculations';

const fencer = (id: string, status = FencerStatus.CHECKED_IN): Fencer =>
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

/** Poule générée comme en préparation : ordre des matchs suivant les vagues */
const makePool = (fencers: Fencer[], number = 1): Pool => {
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

/** Le plus petit numéro gagne toujours */
const play = (pool: Pool, filter: (m: Match) => boolean = () => true) => {
  for (const m of pool.matches.filter(filter)) {
    const aWins = Number(m.fencerA!.id.slice(1)) < Number(m.fencerB!.id.slice(1));
    m.scoreA = { value: aWins ? 5 : 1, isVictory: aWins } as Match['scoreA'];
    m.scoreB = { value: aWins ? 1 : 5, isVictory: !aWins } as Match['scoreB'];
    m.status = MatchStatus.FINISHED;
  }
};

describe('qualification (mode de tableau hérité)', () => {
  const threePools = () => {
    const pools = [0, 1, 2].map(p =>
      makePool(
        [1, 2, 3, 4].map(i => fencer(`t${p * 4 + i}`)),
        p + 1
      )
    );
    pools.forEach(p => play(p));
    return pools;
  };

  it.each(['normal', 'third', 'all'] as const)('mode %s : toutes les équipes au tableau', mode => {
    const pools = threePools();
    const qualified = rapieresTableauQualifiers(pools, calculateOverallRanking(pools), mode);
    expect(qualified).toHaveLength(12);
    expect(qualified.map(r => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('mode semis : 4 équipes', () => {
    const pools = threePools();
    expect(rapieresTableauQualifiers(pools, calculateOverallRanking(pools), 'semis')).toHaveLength(
      4
    );
  });

  it('équipe retirée exclue', () => {
    const pools = threePools();
    pools[0].fencers[0].status = FencerStatus.FORFAIT;
    const overall = calculateOverallRanking(pools).map(r =>
      r.fencer.id === pools[0].fencers[0].id ? { ...r, fencer: pools[0].fencers[0] } : r
    );
    expect(rapieresTableauQualifiers(pools, overall, 'normal')).toHaveLength(11);
  });

  it('réglages : petite finale sauf en normal, toutes places en « all »', () => {
    expect(rapieresTableauSettings('normal')).toEqual({
      thirdPlaceMatch: false,
      playAllPositions: false,
    });
    expect(rapieresTableauSettings('third')).toEqual({
      thirdPlaceMatch: true,
      playAllPositions: false,
    });
    expect(rapieresTableauSettings('all')).toEqual({
      thirdPlaceMatch: true,
      playAllPositions: true,
    });
    expect(rapieresTableauSettings('semis')).toEqual({
      thirdPlaceMatch: true,
      playAllPositions: false,
    });
  });
});
