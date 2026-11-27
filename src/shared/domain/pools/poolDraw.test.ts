import { describe, expect, it } from 'vitest';
import { Gender, FencerStatus, type Fencer } from '../../types';
import {
  DEFAULT_POOL_SEPARATION,
  drawPools,
  separationOfDistribution,
  splitSeparation,
} from './poolDraw';
import { levelRankOf } from '../fencers/teamEntry';
import { buildPools } from '../../utils/poolOrchestration';

const fencer = (i: number, club: string, nationality = 'FRA'): Fencer =>
  ({
    id: `f${i}`,
    ref: i,
    lastName: `N${i}`,
    firstName: 'P',
    club,
    nationality,
    gender: Gender.MALE,
    ranking: i,
    status: FencerStatus.CHECKED_IN,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }) as Fencer;

let n = 0;
const ids = () => `id${++n}`;
const fixed = () => new Date(0);
/** Tirage des positions reproductible */
const seeded = () => {
  let x = 0;
  return () => (x = (x * 9301 + 49297) % 233280) / 233280;
};

describe('tirage des poules : fonction unique (#1979, lot 4)', () => {
  const fencers = Array.from({ length: 14 }, (_, i) => fencer(i + 1, ['A', 'B', 'C'][i % 3]));

  it('défaut : classement puis club et région dans le chapeau', () => {
    expect(splitSeparation(DEFAULT_POOL_SEPARATION)).toEqual({
      above: [],
      below: ['byClub', 'byRegion'],
    });
  });

  it('buildPools (MCP) et drawPools (écran) donnent le même tirage par défaut', () => {
    n = 0;
    const screen = drawPools(fencers, {
      poolCount: 2,
      poolMaxScore: 5,
      newId: ids,
      now: fixed,
      random: seeded(),
    });
    n = 0;
    const engine = buildPools(fencers, {
      poolCount: 2,
      poolMaxScore: 5,
      newId: ids,
      now: fixed,
      random: seeded(),
    });
    expect(engine).toEqual(screen);
  });

  it('critères de l’écran transmis au MCP : même résultat', () => {
    const separation = [
      { key: 'byNation' as const, enabled: true },
      { key: 'byRanking' as const, enabled: true },
      { key: 'byClub' as const, enabled: false },
    ];
    n = 0;
    const screen = drawPools(fencers, {
      poolCount: 3,
      poolMaxScore: 5,
      separation,
      newId: ids,
      now: fixed,
      random: seeded(),
    });
    n = 0;
    const engine = buildPools(fencers, {
      poolCount: 3,
      poolMaxScore: 5,
      separation,
      newId: ids,
      now: fixed,
      random: seeded(),
    });
    expect(engine).toEqual(screen);
    expect(splitSeparation(separation)).toEqual({ above: ['byNation'], below: [] });
  });

  it('ni tireur ni poule : aucun tirage', () => {
    expect(
      drawPools([], { poolCount: 2, poolMaxScore: 5, newId: ids, now: fixed, random: seeded() })
    ).toEqual([]);
  });
});

describe('répartition par niveau (docs/adr/0043, F4c)', () => {
  /** Dix équipes : niveau 1 (le plus fort) à 3, une sans niveau ; deux clubs */
  const teams = Array.from({ length: 10 }, (_, i) => ({
    ...fencer(i + 1, i % 2 ? 'A' : 'B'),
    level: i < 9 ? (i % 3) + 1 : undefined,
  })) as Fencer[];
  const levelsOf = (pools: ReturnType<typeof drawPools>) =>
    pools.map(p => p.fencers.map(f => f.level ?? 0));

  it('séparation : « par niveau » ajoutée et activée, serpentin inchangé', () => {
    expect(separationOfDistribution('serpentine')).toEqual([...DEFAULT_POOL_SEPARATION]);
    expect(separationOfDistribution(undefined)).toEqual([...DEFAULT_POOL_SEPARATION]);
    const byLevel = separationOfDistribution('byLevel');
    expect(byLevel.slice(0, -1)).toEqual([...DEFAULT_POOL_SEPARATION]);
    expect(byLevel[byLevel.length - 1]).toEqual({ key: 'byLevel', enabled: true });
    // Pas de doublon si le critère existe déjà
    expect(
      separationOfDistribution('byLevel', byLevel).filter(c => c.key === 'byLevel')
    ).toHaveLength(1);
  });

  it('rang : du plus faible (niveau le plus grand) au plus fort, sans niveau en dernier', () => {
    const order = [...teams].sort((a, b) => levelRankOf(a) - levelRankOf(b)).map(f => f.level ?? 0);
    expect(order).toEqual([3, 3, 3, 2, 2, 2, 1, 1, 1, 0]);
  });

  it('équipes de même niveau regroupées, poule après poule, tailles équilibrées', () => {
    const pools = drawPools(teams, {
      poolCount: 2,
      poolMaxScore: 5,
      separation: separationOfDistribution('byLevel'),
      newId: ids,
      now: fixed,
      random: seeded(),
    });
    expect(pools.map(p => p.fencers.length)).toEqual([5, 5]);
    // Poule 1 : les plus faibles d'abord (niveaux 3 puis 2) ; poule 2 : le reste, sans niveau en dernier
    expect(levelsOf(pools).map(l => [...l].sort())).toEqual([
      [2, 2, 3, 3, 3],
      [0, 1, 1, 1, 2],
    ]);
  });

  it('écran (critères + rang) et moteur (distribution) : même tirage', () => {
    n = 0;
    const screen = drawPools(teams, {
      poolCount: 2,
      poolMaxScore: 5,
      separation: separationOfDistribution('byLevel'),
      levelRankOf,
      newId: ids,
      now: fixed,
      random: seeded(),
    });
    n = 0;
    const engine = buildPools(teams, {
      poolCount: 2,
      poolMaxScore: 5,
      distribution: 'byLevel',
      newId: ids,
      now: fixed,
      random: seeded(),
    });
    expect(engine).toEqual(screen);
  });

  it('serpentin : distribution absente ou « serpentine » = tirage par défaut', () => {
    n = 0;
    const base = buildPools(teams, {
      poolCount: 2,
      poolMaxScore: 5,
      newId: ids,
      now: fixed,
      random: seeded(),
    });
    n = 0;
    const explicit = buildPools(teams, {
      poolCount: 2,
      poolMaxScore: 5,
      distribution: 'serpentine',
      newId: ids,
      now: fixed,
      random: seeded(),
    });
    expect(explicit).toEqual(base);
  });
});
