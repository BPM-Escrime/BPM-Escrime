import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STRIP_PLAN,
  distributeArenasRoundRobin,
  nextFreeStrip,
  normalizeStripPlan,
  withStripAvailability,
} from './stripPlan';

describe('normalizeStripPlan', () => {
  it('valeurs par défaut pour une entrée invalide', () => {
    expect(normalizeStripPlan(null)).toEqual(DEFAULT_STRIP_PLAN);
    expect(normalizeStripPlan({ start: 0, unavailable: 'x' })).toEqual(DEFAULT_STRIP_PLAN);
    expect(normalizeStripPlan({ start: 1000 })).toEqual(DEFAULT_STRIP_PLAN);
  });
  it('trie, déduplique et filtre les pistes indisponibles', () => {
    expect(normalizeStripPlan({ start: 5, unavailable: [7, 6, 7, -1, 1.5, 'a', 1000] })).toEqual({
      start: 5,
      unavailable: [6, 7],
    });
  });
});

describe('withStripAvailability', () => {
  const plan = { start: 1, unavailable: [3] };
  it('marque et remet en service, liste triée', () => {
    expect(withStripAvailability(plan, 2, false)).toEqual({ start: 1, unavailable: [2, 3] });
    expect(withStripAvailability(plan, 3, true)).toEqual({ start: 1, unavailable: [] });
  });
  it('rien ne change : null', () => {
    expect(withStripAvailability(plan, 3, false)).toBeNull();
    expect(withStripAvailability(plan, 2, true)).toBeNull();
  });
});

describe('nextFreeStrip (#1878)', () => {
  it('première piste libre dans l’intervalle, hors pistes prises ou indisponibles', () => {
    expect(nextFreeStrip(DEFAULT_STRIP_PLAN, new Set([1]), 4)).toBe(2);
    expect(nextFreeStrip({ start: 3, unavailable: [] }, new Set(), 4)).toBe(3);
    expect(nextFreeStrip({ start: 3, unavailable: [3] }, new Set(), 4)).toBe(4);
  });
  it('aucune piste libre dans l’intervalle : null (la poule attend)', () => {
    expect(nextFreeStrip({ start: 3, unavailable: [] }, new Set([3, 4]), 4)).toBeNull();
    expect(nextFreeStrip({ start: 5, unavailable: [] }, new Set(), 4)).toBeNull();
  });
});

describe('distributeArenasRoundRobin', () => {
  type M = { id: string; fencerA?: unknown; fencerB?: unknown; arena?: number };
  const m = (id: string, extra: Record<string, unknown> = {}): M => ({
    id,
    fencerA: { id: `${id}a` },
    fencerB: { id: `${id}b` },
    ...extra,
  });
  it('tourne sur les pistes disponibles de l’intervalle', () => {
    const out = distributeArenasRoundRobin(
      [m('1'), m('2'), m('3'), m('4')],
      { start: 5, unavailable: [6] },
      7
    );
    expect(out.map(x => x.arena)).toEqual([5, 7, 5, 7]);
  });
  it('saute exemptions, matchs joués, matchs incomplets et ceux que le filtre écarte', () => {
    const out = distributeArenasRoundRobin(
      [
        m('1', { isBye: true }),
        m('2', { winner: { id: '2a' } }),
        { id: '3', fencerA: { id: 'x' } } as M,
        m('4', { arena: 9 }),
        m('5'),
      ],
      DEFAULT_STRIP_PLAN,
      2,
      x => x.arena === undefined
    );
    expect(out.map(x => x.arena)).toEqual([undefined, undefined, undefined, 9, 1]);
  });
  it('aucune piste : rien ne change', () => {
    const list = [m('1')];
    expect(distributeArenasRoundRobin(list, DEFAULT_STRIP_PLAN, 0)).toBe(list);
  });
});
