// @vitest-environment jsdom
/**
 * Tests unitaires - AnalyticsService (agrégation via electronAPI mocké)
 * BPM - Escrime
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnalyticsService } from './analyticsService';
import { fakeApiBridge } from '../../../renderer/testUtils/apiBridge';

const svc = new AnalyticsService();

afterEach(() => {
  delete (window as any).electronAPI;
});

describe('getCompetitionStats', () => {
  it('retourne une structure vide sans electronAPI', async () => {
    expect(await svc.getCompetitionStats('c1')).toEqual({
      totalFencers: 0,
      totalMatches: 0,
      completedMatches: 0,
      averageMatchDuration: 0,
      topFencers: [],
    });
  });

  it('passe par la requête getCompetitionStats ; palmarès converti en tireurs', async () => {
    const query = vi.fn(async () => ({
      totalFencers: 1,
      totalMatches: 3,
      completedMatches: 2,
      averageMatchDuration: 90,
      topFencers: [
        {
          fencer: {
            id: 'f1',
            ref: 1,
            lastName: 'Dupont',
            firstName: 'Léa',
            birthDate: null,
            gender: 'F',
            nationality: 'FRA',
            region: null,
            department: null,
            club: 'Paris',
            license: null,
            ranking: null,
            handedness: null,
            status: 'P',
            exclusionReason: null,
            seedNumber: null,
            initialRanking: null,
            finalRanking: null,
            photo: null,
          },
          victories: 2,
          touchesScored: 10,
          touchesReceived: 4,
        },
      ],
    }));
    (window as any).electronAPI = { api: fakeApiBridge({ getCompetitionStats: query }) };
    const stats = await svc.getCompetitionStats('c1');
    expect(query).toHaveBeenCalledWith({ competitionId: 'c1' });
    expect(stats).toMatchObject({ totalMatches: 3, completedMatches: 2, averageMatchDuration: 90 });
    expect(stats.topFencers[0].fencer).toMatchObject({ lastName: 'Dupont', club: 'Paris' });
  });
});

describe('getCompetitionMetrics', () => {
  it('dérive totalFencers et completedMatches de getCompetitionStats', async () => {
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
    expect(await svc.getCompetitionMetrics('c1')).toEqual({
      totalFencers: 2,
      completedMatches: 1,
    });
  });
});

describe('getCompetitionFencerStats / getFencerCompetitionStats', () => {
  it('retournent des valeurs vides sans electronAPI', async () => {
    expect(await svc.getCompetitionFencerStats('c1')).toEqual([]);
    expect(await svc.getFencerCompetitionStats('f1')).toBeNull();
  });

  it('passent par le contrat d’API', async () => {
    const listFencerStats = vi.fn(async () => [{ fencerId: 'f1' }]);
    const getFencerStats = vi.fn(async () => ({ fencerId: 'f1' }));
    (window as any).electronAPI = { api: fakeApiBridge({ listFencerStats, getFencerStats }) };
    expect(await svc.getCompetitionFencerStats('c1')).toHaveLength(1);
    expect(await svc.getFencerCompetitionStats('f1')).toEqual({ fencerId: 'f1' });
    expect(listFencerStats).toHaveBeenCalledWith({ competitionId: 'c1' });
    expect(getFencerStats).toHaveBeenCalledWith({ fencerId: 'f1' });
  });
});
