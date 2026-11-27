import { describe, it, expect } from 'vitest';
import { Fencer, FencerStatus, Gender, Match, MatchStatus, Pool } from '../../types';
import {
  rapieresPoolNumbers,
  rapieresRankingSubject,
  rapieresTableauQualifiers,
  rapieresTableauSettings,
  mergeFinalRanking,
  teamMembersLabel,
  waveMatchOrder,
} from './rapieresCalculations';
import { calculateOverallRanking } from '../../utils/poolCalculations';
import { RapieresTeamInfo } from './rapieres.types';
import { filterRanking as filterByCriteria, type RankingFilter } from '../ranking/rankingFilters';

/** Filtres génériques (docs/adr/0043, F4d) appliqués aux valeurs de l'équipe des rapières */
const filterRanking = (
  ranked: { teamId: string; rank: number }[],
  teams: Record<string, RapieresTeamInfo>,
  filter: RankingFilter,
  refDate: Date
) =>
  filterByCriteria(
    ranked,
    r => (teams[r.teamId] ? rapieresRankingSubject(teams[r.teamId], refDate) : undefined),
    filter
  );

/** Date de référence fixe des catégories d'âge (domaine pur : date injectée) */
const REF = new Date('2026-11-20');

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

describe('Tournoi des rapières (#1118)', () => {
  it('libellé des tireurs de l’équipe', () => {
    expect(
      teamMembersLabel([
        { lastName: 'Dupont', firstName: 'A', category: 'M20' },
        { lastName: 'Martin', firstName: 'B', category: 'V1' },
      ])
    ).toBe('DUPONT / MARTIN');
  });

  describe('qualification', () => {
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

    it.each(['normal', 'third', 'all'] as const)(
      'mode %s : toutes les équipes au tableau',
      mode => {
        const pools = threePools();
        const qualified = rapieresTableauQualifiers(pools, calculateOverallRanking(pools), mode);
        expect(qualified).toHaveLength(12);
        expect(qualified.map(r => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      }
    );

    it('mode semis : 4 équipes', () => {
      const pools = threePools();
      expect(
        rapieresTableauQualifiers(pools, calculateOverallRanking(pools), 'semis')
      ).toHaveLength(4);
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

  describe('classements', () => {
    const teams: Record<string, RapieresTeamInfo> = {
      x: {
        level: 'expert',
        fencers: [
          { firstName: 'A', lastName: 'x1', category: 'M20' },
          { firstName: 'B', lastName: 'x2', category: 'V1' },
        ],
      },
      y: {
        level: 'beginner',
        fencers: [
          { firstName: 'A', lastName: 'y1', category: 'M20' },
          { firstName: 'B', lastName: 'y2', category: 'M20' },
        ],
      },
    };
    const ranked = [
      { teamId: 'x', rank: 1 },
      { teamId: 'y', rank: 2 },
    ];

    it('filtre par niveau : équipes seules, rangs conservés (#1441)', () => {
      expect(filterRanking(ranked, teams, { level: 'beginner' }, REF)).toEqual([
        { teamId: 'y', rank: 1 },
      ]);
      expect(filterRanking(ranked, teams, {}, REF)).toEqual([
        { teamId: 'x', rank: 1 },
        { teamId: 'y', rank: 2 },
      ]);
    });

    it('filtre par catégorie d’équipe (moyenne des années de naissance, #1441)', () => {
      // Années relatives à l'année courante : âges moyens ≈ 33 ans (x) et ≈ 17 ans (y)
      const Y = REF.getFullYear();
      const withDates: Record<string, RapieresTeamInfo> = {
        x: {
          level: 'beginner',
          fencers: [
            { firstName: 'A', lastName: 'x1', category: 'M20', birthDate: `${Y - 30}-03-01` },
            { firstName: 'B', lastName: 'x2', category: 'V1', birthDate: `${Y - 36}-03-01` },
          ],
        },
        y: {
          level: 'beginner',
          fencers: [
            { firstName: 'A', lastName: 'y1', category: 'M20', birthDate: `${Y - 18}-03-01` },
            { firstName: 'B', lastName: 'y2', category: 'M20', birthDate: `${Y - 17}-03-01` },
          ],
        },
      };
      // x : moyenne Y-33 → Seniors ; y : moyenne Y-17.5 → M20
      expect(filterRanking(ranked, withDates, { category: 'SENIOR' }, REF)).toEqual([
        { teamId: 'x', rank: 1 },
      ]);
      expect(filterRanking(ranked, withDates, { category: 'M20' }, REF)).toEqual([
        { teamId: 'y', rank: 1 },
      ]);
    });

    it('filtre par sexe d’équipe : M, F, mixte ; sexe incomplet exclu (#1441)', () => {
      const g: Record<string, RapieresTeamInfo> = {
        x: {
          level: 'expert',
          fencers: [
            { firstName: 'A', lastName: 'x1', category: 'M20', gender: 'F' },
            { firstName: 'B', lastName: 'x2', category: 'V1', gender: 'M' },
          ],
        },
        y: {
          level: 'beginner',
          fencers: [
            { firstName: 'A', lastName: 'y1', category: 'M20', gender: 'F' },
            { firstName: 'B', lastName: 'y2', category: 'M20' },
          ],
        },
      };
      expect(filterRanking(ranked, g, { gender: 'MIXED' }, REF)).toEqual([
        { teamId: 'x', rank: 1 },
      ]);
      expect(filterRanking(ranked, g, { gender: 'F' }, REF)).toEqual([]);
      expect(filterRanking(ranked, g, { gender: 'M' }, REF)).toEqual([]);
    });

    it('filtres cumulables (niveau + sexe)', () => {
      const g: Record<string, RapieresTeamInfo> = {
        x: {
          level: 'expert',
          fencers: [
            { firstName: 'A', lastName: 'x1', category: 'M20', gender: 'M' },
            { firstName: 'B', lastName: 'x2', category: 'V1', gender: 'M' },
          ],
        },
        y: {
          level: 'expert',
          fencers: [
            { firstName: 'A', lastName: 'y1', category: 'M20', gender: 'M' },
            { firstName: 'B', lastName: 'y2', category: 'M20', gender: 'M' },
          ],
        },
      };
      expect(filterRanking(ranked, g, { level: 'expert', gender: 'M' }, REF)).toEqual([
        { teamId: 'x', rank: 1 },
        { teamId: 'y', rank: 2 },
      ]);
      expect(filterRanking(ranked, g, { level: 'beginner', gender: 'M' }, REF)).toEqual([]);
    });

    it('filtres génériques : HANDI est un critère à part, pas une catégorie (docs/adr/0043, F4d)', () => {
      const handi: RapieresTeamInfo = {
        level: 'expert',
        fencers: [
          { firstName: 'A', lastName: 'h1', category: 'HANDI', gender: 'F' },
          { firstName: 'B', lastName: 'h2', category: 'SENIOR', gender: 'F' },
        ],
      };
      const subject = rapieresRankingSubject(handi, REF);
      expect(subject).toEqual({ gender: 'F', level: 'expert', handicap: true });
      expect(rapieresRankingSubject(teams.y, REF).handicap).toBe(false);
      const both = { x: teams.x, h: handi };
      const rk = [
        { teamId: 'x', rank: 1 },
        { teamId: 'h', rank: 2 },
      ];
      expect(filterRanking(rk, both, { handicap: true }, REF)).toEqual([{ teamId: 'h', rank: 1 }]);
      // Sans date de naissance ni catégorie propre, la catégorie HANDI n'est pas une valeur de filtre
      expect(filterRanking(rk, both, { category: 'HANDI' }, REF)).toEqual([]);
    });

    it('rapieresPoolNumbers : numéro de poule par équipe', () => {
      const pool = (number: number, ids: string[]) =>
        ({ number, fencers: ids.map(id => ({ id })) }) as never;
      expect(rapieresPoolNumbers([pool(1, ['x']), pool(2, ['y'])])).toEqual({ x: 1, y: 2 });
    });

    it('final : tableau, puis non qualifiées, exclues en dernier', () => {
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(id => fencer(id));
      d.status = FencerStatus.EXCLUDED;
      const overall = [a, b, c, d].map((f, i) => ({ fencer: f, rank: i + 1 }) as never);
      expect(
        mergeFinalRanking(
          [
            { fencer: b, rank: 1 },
            { fencer: d, rank: 2 },
            { fencer: a, rank: 3 },
          ],
          overall
        )
      ).toEqual([
        { teamId: 'b', rank: 1 },
        { teamId: 'a', rank: 2 },
        { teamId: 'c', rank: 3 },
        { teamId: 'd', rank: 4 },
      ]);
    });
  });
});
