// @vitest-environment jsdom
/**
 * Tests unitaires - useAnalyticsStore
 * BPM - Escrime
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAnalyticsStore } from './useAnalyticsStore';
import { fakeApiBridge } from '../../../renderer/testUtils/apiBridge';

const get = () => useAnalyticsStore.getState();

beforeEach(() => {
  useAnalyticsStore.setState({
    fencerStats: [],
    competitionMetrics: null,
    isLoading: false,
    error: null,
  } as any);
});
afterEach(() => {
  delete (window as any).electronAPI;
});

describe('loadFencerStats', () => {
  it('charge les stats via le service', async () => {
    (window as any).electronAPI = {
      api: fakeApiBridge({ listFencerStats: vi.fn(async () => [{ fencerId: 'f1' }]) }),
    };
    await get().loadFencerStats('c1');
    expect(get().fencerStats).toHaveLength(1);
    expect(get().isLoading).toBe(false);
  });

  it('retourne une liste vide sans API (pas d’erreur)', async () => {
    await get().loadFencerStats('c1');
    expect(get().fencerStats).toEqual([]);
    expect(get().error).toBeNull();
  });
});

describe('loadCompetitionMetrics', () => {
  it('charge les métriques agrégées', async () => {
    // Chiffres calculés par le moteur (getCompetitionStats)
    (window as any).electronAPI = {
      api: fakeApiBridge({
        getCompetitionStats: async () => ({
          totalFencers: 2,
          totalMatches: 2,
          completedMatches: 1,
          averageMatchDuration: 0,
          topFencers: [],
        }),
      }),
    };
    await get().loadCompetitionMetrics('c1');
    expect(get().competitionMetrics).toEqual({ totalFencers: 2, completedMatches: 1 });
  });
});

describe('clearError', () => {
  it('efface l’erreur', () => {
    useAnalyticsStore.setState({ error: 'boom' } as any);
    get().clearError();
    expect(get().error).toBeNull();
  });
});
