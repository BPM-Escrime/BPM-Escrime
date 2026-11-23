/**
 * BPM - Escrime - Données de secours des exports complets des résultats (#1981)
 * Tireurs, poules, matchs de tableau et signatures relus par le contrat quand la vue ne les a
 * pas en mémoire (listFencers, getCompetitionState, getPoolSignatures, getTableauSignatures).
 * Chaque lecture est isolée : un échec ne vide pas tout l'export.
 * Licensed under GPL-3.0
 */
import type { BpmClient } from '../../../shared/api/client';
import type { Fencer, Pool } from '../../../shared/types';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';
import { logger, LogCategory } from '@shared/services/logger';
import { fencerFromDTO } from '../../api/fencerMapping';
import { loadDESignatures, type DESignatures } from '../tableau/tableauDialogState';

export async function safeLoad<T>(fn: () => Promise<T>, label: string, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    logger.warn(
      LogCategory.DATABASE,
      `export des résultats — ${label} échoué`,
      e instanceof Error ? e : undefined
    );
    return fallback;
  }
}

export const loadExportFencers = (client: BpmClient, competitionId: string): Promise<Fencer[]> =>
  safeLoad(
    async () => (await client.query('listFencers', { competitionId })).map(fencerFromDTO),
    'tireurs',
    []
  );

/** Poules et tableau de l'état de l'épreuve tenu par le moteur (docs/adr/0017) */
export const loadExportState = (
  client: BpmClient,
  competitionId: string
): Promise<{ pools: Pool[]; tableauMatches: TableauMatch[] }> =>
  safeLoad(
    async () => {
      const { state } = await client.query('getCompetitionState', { competitionId });
      return { pools: state?.pools ?? [], tableauMatches: state?.tableauMatches ?? [] };
    },
    'poules et tableau',
    { pools: [], tableauMatches: [] }
  );

/** Signatures des poules : poolId → (fencerId → data URL) */
export const loadExportPoolSignatures = (client: BpmClient, pools: Pool[]) =>
  safeLoad(
    async () => {
      const entries = await Promise.all(
        pools.map(async p => {
          const sigs = await client.query('getPoolSignatures', { poolId: p.id });
          return [p.id, Object.fromEntries(sigs.map(s => [s.fencerId, s.signatureData]))] as const;
        })
      );
      return Object.fromEntries(entries) as Record<string, Record<string, string>>;
    },
    'signatures poules',
    {} as Record<string, Record<string, string>>
  );

/** Signatures des matchs de tableau : matchId → { A, B } */
export const loadExportTableauSignatures = async (
  client: BpmClient,
  matches: Array<Pick<TableauMatch, 'id' | 'fencerA' | 'fencerB'>>
): Promise<DESignatures> => (await loadDESignatures(matches, client)) ?? {};
