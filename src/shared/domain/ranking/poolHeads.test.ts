/**
 * Tests : qualification « têtes de poule, puis suivants » (pool_heads, docs/adr/0043, F4b)
 * Licensed under GPL-3.0
 */
import { describe, expect, it } from 'vitest';
import { FencerStatus } from '../../types';
import type { Fencer, Pool, PoolRanking } from '../../types';
import { getAdvancementCount } from './advancement';
import { poolHeadsCut } from './poolHeads';

const team = (id: string, extra: Partial<Fencer> = {}): Fencer =>
  ({ id, lastName: id, firstName: '', ...extra }) as unknown as Fencer;

/** Poule dont le classement est fourni (ids dans l'ordre de rang de poule) */
const pool = (number: number, ids: string[]): Pool =>
  ({
    number,
    fencers: ids.map(id => team(id)),
    matches: [],
    ranking: ids.map((id, i) => ({ fencer: team(id), rank: i + 1 })) as unknown as PoolRanking[],
  }) as unknown as Pool;

/** Classement général : ids dans l'ordre ; `ranks` impose des rangs (ex aequo) */
const overall = (ids: string[], ranks?: number[]): PoolRanking[] =>
  ids.map((id, i) => ({
    fencer: team(id),
    rank: ranks?.[i] ?? i + 1,
  })) as unknown as PoolRanking[];

const ids = (r: PoolRanking[]) => r.map(x => x.fencer.id);

describe('poolHeadsCut : count 4', () => {
  it('1 poule : les 4 premiers', () => {
    const { ranking, tiedAtBar } = poolHeadsCut(
      [pool(1, ['x', 'y', 'z', 'w', 'v'])],
      overall(['x', 'y', 'z', 'w', 'v']),
      4
    );
    expect(ids(ranking)).toEqual(['x', 'y', 'z', 'w']);
    expect(ranking.map(r => r.rank)).toEqual([1, 2, 3, 4]);
    expect(tiedAtBar).toBeNull();
  });

  it('2 poules : A1, B1, A2, B2, donc au tableau A1–B2 et B1–A2', () => {
    const pools = [pool(1, ['a1', 'a2', 'a3']), pool(2, ['b1', 'b2', 'b3'])];
    const { ranking } = poolHeadsCut(pools, overall(['a1', 'b1', 'a2', 'b2', 'a3', 'b3']), 4);
    expect(ids(ranking)).toEqual(['a1', 'b1', 'a2', 'b2']);
    // Tête de série 1 contre 4, 2 contre 3
    const [s1, s2, s3, s4] = ids(ranking);
    expect([`${s1}-${s4}`, `${s2}-${s3}`]).toEqual(['a1-b2', 'b1-a2']);
  });

  it('2 poules : le croisement tient même si un 2e devance un 1er du général', () => {
    const pools = [pool(1, ['a1', 'a2']), pool(2, ['b1', 'b2'])];
    // b1 meilleur que a1 : l'ordre d'entrée reste A1, B1, A2, B2 (pas de rencontre A1–A2)
    const { ranking } = poolHeadsCut(pools, overall(['b1', 'a1', 'b2', 'a2']), 4);
    expect(ids(ranking)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('3 poules : les 3 premiers et le meilleur deuxième du général', () => {
    const pools = [pool(1, ['a1', 'a2']), pool(2, ['b1', 'b2']), pool(3, ['c1', 'c2'])];
    const { ranking } = poolHeadsCut(pools, overall(['a1', 'b1', 'c1', 'b2', 'a2', 'c2']), 4);
    expect(ids(ranking)).toEqual(['a1', 'b1', 'c1', 'b2']);
  });

  it('4 poules : les premiers, dans l’ordre du général', () => {
    const pools = [1, 2, 3, 4].map(n => pool(n, [`p${n}a`, `p${n}b`]));
    const { ranking } = poolHeadsCut(pools, overall(['p3a', 'p1a', 'p4a', 'p2a', 'p1b']), 4);
    expect(ids(ranking)).toEqual(['p3a', 'p1a', 'p4a', 'p2a']);
  });

  it('équipe retirée : écartée, rangs de poule renumérotés', () => {
    const retired = team('a1', { status: FencerStatus.ABANDONED });
    const withRetired = (ranking: PoolRanking[]) =>
      ranking.map(r => (r.fencer.id === 'a1' ? { ...r, fencer: retired } : r));
    const pools = [pool(1, ['a1', 'a2', 'a3']), pool(2, ['b1', 'b2', 'b3'])].map(p => ({
      ...p,
      ranking: withRetired(p.ranking),
    }));
    const { ranking } = poolHeadsCut(
      pools,
      withRetired(overall(['a1', 'b1', 'a2', 'b2', 'a3', 'b3'])),
      4
    );
    expect(ids(ranking)).toEqual(['a2', 'b1', 'a3', 'b2']);
  });
});

describe('poolHeadsCut : autres nombres et poules en surnombre', () => {
  it('count 6 sur 2 poules : trois rangs de poule complets, rang par rang', () => {
    const pools = [pool(1, ['a1', 'a2', 'a3']), pool(2, ['b1', 'b2', 'b3'])];
    const { ranking } = poolHeadsCut(pools, overall(['a1', 'b1', 'a2', 'b2', 'a3', 'b3']), 6);
    expect(ids(ranking)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
  });

  it('count 5 sur 2 poules : A1, B1, A2, B2 puis le meilleur 3e du général', () => {
    const pools = [pool(1, ['a1', 'a2', 'a3']), pool(2, ['b1', 'b2', 'b3'])];
    const { ranking } = poolHeadsCut(pools, overall(['a1', 'b1', 'a2', 'b2', 'b3', 'a3']), 5);
    expect(ids(ranking)).toEqual(['a1', 'b1', 'a2', 'b2', 'b3']);
  });

  it('plus de poules que de qualifiés : seuls les meilleurs premiers de poule passent', () => {
    const pools = [1, 2, 3, 4, 5].map(n => pool(n, [`p${n}a`, `p${n}b`]));
    const { ranking } = poolHeadsCut(pools, overall(['p5a', 'p2a', 'p1a', 'p3a', 'p4a', 'p1b']), 4);
    expect(ids(ranking)).toEqual(['p5a', 'p2a', 'p1a', 'p3a']);
  });

  it('getAdvancementCount : count', () => {
    expect(getAdvancementCount(30, { mode: 'pool_heads', count: 4 })).toBe(4);
    expect(getAdvancementCount(30, { mode: 'pool_heads' })).toBeUndefined();
  });
});

describe('poolHeadsCut : ex aequo à la barre (ADR-0040) sur le dernier rang de poule', () => {
  // 3 poules, count 4 : les premiers + 1 place pour les deuxièmes, a2 et b2 ex aequo (rang 4)
  const pools = [pool(1, ['a1', 'a2']), pool(2, ['b1', 'b2']), pool(3, ['c1', 'c2'])];
  const general = overall(['a1', 'b1', 'c1', 'a2', 'b2', 'c2'], [1, 2, 3, 4, 4, 6]);

  it("'all' (par défaut) : tous les ex aequo passent, le quota est dépassé", () => {
    const { ranking, tiedAtBar } = poolHeadsCut(pools, general, 4);
    expect(ids(ranking)).toEqual(['a1', 'b1', 'c1', 'a2', 'b2']);
    expect(tiedAtBar).toEqual({ rank: 4, fencerIds: ['a2', 'b2'], places: 1 });
  });

  it("'initial_ranking' : départagés par le rang d'entrée, le quota est tenu", () => {
    const entry = { a2: 7, b2: 3 };
    const { ranking, tiedAtBar } = poolHeadsCut(pools, general, 4, {
      ties: 'initial_ranking',
      entryRank: r => entry[r.fencer.id as 'a2' | 'b2'],
    });
    expect(ids(ranking)).toEqual(['a1', 'b1', 'c1', 'b2']);
    expect(tiedAtBar?.fencerIds).toEqual(['a2', 'b2']);
  });

  it("'draw' : tirage au sort avec le hasard injecté, le quota est tenu", () => {
    // random() = 0 → Fisher-Yates : le dernier prend la place du premier
    const { ranking } = poolHeadsCut(pools, general, 4, { ties: 'draw', random: () => 0 });
    expect(ranking).toHaveLength(4);
    expect(ids(ranking)).toContain('b2');
    expect(ids(ranking)).not.toContain('a2');
  });

  it('pas d’ex aequo à la barre : rien à proposer', () => {
    const { tiedAtBar } = poolHeadsCut(pools, overall(['a1', 'b1', 'c1', 'a2', 'b2', 'c2']), 4);
    expect(tiedAtBar).toBeNull();
  });
});
