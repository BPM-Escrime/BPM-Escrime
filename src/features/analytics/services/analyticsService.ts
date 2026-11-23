/**
 * BPM - Escrime - Analytics Service
 * Business logic for analytics and statistics
 * Licensed under GPL-3.0
 */

import { Fencer, FencerCompetitionStats } from '../../../shared/types';
import { defaultBpmClient } from '../../../renderer/api/IpcClient';
import { fencerFromDTO } from '../../../renderer/api/fencerMapping';
import { ApiError } from '../../../shared/api/client';

/** Contrat indisponible (hors Electron, tests) : valeur neutre au lieu d'une erreur (#2134) */
async function orIfUnavailable<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'unavailable') return fallback;
    throw e;
  }
}

export interface CompetitionStats {
  totalFencers: number;
  totalMatches: number;
  completedMatches: number;
  averageMatchDuration: number;
  topFencers: Array<{
    fencer: Fencer;
    victories: number;
    touchesScored: number;
    touchesReceived: number;
  }>;
}

export class AnalyticsService {
  /**
   * Chiffres de l'épreuve, calculés par le moteur (requête getCompetitionStats, #1981)
   */
  async getCompetitionStats(competitionId: string): Promise<CompetitionStats> {
    const empty: CompetitionStats = {
      totalFencers: 0,
      totalMatches: 0,
      completedMatches: 0,
      averageMatchDuration: 0,
      topFencers: [],
    };
    return orIfUnavailable(empty, async () => {
      const stats = await defaultBpmClient.query('getCompetitionStats', { competitionId });
      return {
        ...stats,
        topFencers: stats.topFencers.map(f => ({ ...f, fencer: fencerFromDTO(f.fencer) })),
      };
    });
  }

  /**
   * Statistiques détaillées par combattant (touches, cartons, sorties, durée)
   */
  async getCompetitionFencerStats(competitionId: string): Promise<FencerCompetitionStats[]> {
    return orIfUnavailable([], () => defaultBpmClient.query('listFencerStats', { competitionId }));
  }

  // Alias utilisé par useAnalyticsStore
  async getFencerStats(competitionId: string): Promise<FencerCompetitionStats[]> {
    return this.getCompetitionFencerStats(competitionId);
  }

  async getFencerCompetitionStats(fencerId: string): Promise<FencerCompetitionStats | null> {
    return orIfUnavailable(null, () => defaultBpmClient.query('getFencerStats', { fencerId }));
  }

  // Stub minimal pour getCompetitionMetrics (appelé par le store)
  async getCompetitionMetrics(
    competitionId: string
  ): Promise<{ totalFencers: number; completedMatches: number }> {
    const stats = await this.getCompetitionStats(competitionId);
    return { totalFencers: stats.totalFencers, completedMatches: stats.completedMatches };
  }

  /**
   * Export analytics data
   */
  async exportAnalytics(competitionId: string, format: 'json' | 'csv' | 'pdf'): Promise<Blob> {
    const stats = await this.getCompetitionStats(competitionId);

    if (format === 'csv') {
      const headers = ['Nom', 'Prénom', 'Club', 'Victoires', 'Touches marquées', 'Touches reçues'];
      const rows = stats.topFencers.map(f => [
        f.fencer.lastName,
        f.fencer.firstName ?? '',
        f.fencer.club ?? '',
        f.victories,
        f.touchesScored,
        f.touchesReceived,
      ]);
      const csv = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      return new Blob([csv], { type: 'text/csv;charset=utf-8' });
    }

    const content = format === 'json' ? JSON.stringify(stats, null, 2) : '';
    return new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' });
  }
}
