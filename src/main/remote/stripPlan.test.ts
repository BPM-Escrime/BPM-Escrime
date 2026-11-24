import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_STRIP_PLAN, pushStripPlan, visibleArenas, watchStripPlans } from './stripPlan';
import { publishCompetitionEvent } from '../engine/api/events';

describe('visibleArenas', () => {
  const arenas = [1, 2, 3, 4, 5, 6].map(number => ({ number }));
  it('masque les arènes avant la piste de départ', () => {
    expect(visibleArenas(arenas, { start: 5, unavailable: [] }).map(a => a.number)).toEqual([5, 6]);
  });
  it('tout visible par défaut', () => {
    expect(visibleArenas(arenas, DEFAULT_STRIP_PLAN)).toHaveLength(6);
  });
});

describe('envoi du plan au serveur distant (docs/adr/0015)', () => {
  const db = {
    stripPlans: {
      getStripPlan: (id: string) => ({
        start: id === 'c1' ? 3 : 1,
        unavailable: [4],
        updatedAt: 'x',
      }),
    },
  } as unknown as Parameters<typeof pushStripPlan>[0];

  it('pushStripPlan : plan relu en base, sans date', () => {
    const setStripPlan = vi.fn();
    pushStripPlan(db, 'c1', { setStripPlan });
    expect(setStripPlan).toHaveBeenCalledWith({ start: 3, unavailable: [4] });
  });

  it('watchStripPlans : strips:changed → serveur de l’épreuve ; autres signaux ignorés', async () => {
    const setStripPlan = vi.fn();
    const off = watchStripPlans(db, id => (id === 'c1' ? { setStripPlan } : undefined));
    publishCompetitionEvent({ type: 'session:changed', competitionId: 'c1' });
    publishCompetitionEvent({ type: 'strips:changed', competitionId: 'c2' });
    publishCompetitionEvent({ type: 'strips:changed', competitionId: 'c1' });
    await Promise.resolve();
    expect(setStripPlan).toHaveBeenCalledTimes(1);
    expect(setStripPlan).toHaveBeenCalledWith({ start: 3, unavailable: [4] });
    off();
    publishCompetitionEvent({ type: 'strips:changed', competitionId: 'c1' });
    await Promise.resolve();
    expect(setStripPlan).toHaveBeenCalledTimes(1);
  });
});
