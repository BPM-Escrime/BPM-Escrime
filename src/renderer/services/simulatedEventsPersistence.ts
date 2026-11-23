/**
 * BellePoule Modern - Persistance des événements simulés du remplissage automatique
 * (durée, touches par zone, cartons) pour alimenter l'analytique.
 * Écriture par le contrat (replaceSimulatedMatchEvents, #1981), sans journal.
 * Licensed under GPL-3.0
 */

import { logger, LogCategory } from '@shared/services/logger';
import type { BpmClient } from '../../shared/api/client';
import type { SimulatedMatchEvents } from '../../shared/types/preload';

export interface SimulatedEventsEntry {
  /** Id DB du match */
  matchId: string;
  /** null = effacer les événements simulés (annulation) */
  events: SimulatedMatchEvents | null;
}

const RETRY_DELAY_MS = 400;
const MAX_ATTEMPTS = 6;

/**
 * Écrit les événements en base. Un match absent (ligne de tableau pas encore écrite) est
 * réessayé quelques fois. Hors moteur (« unavailable ») : rien à écrire.
 */
export async function persistSimulatedEvents(
  client: BpmClient,
  competitionId: string | undefined,
  entries: SimulatedEventsEntry[]
): Promise<void> {
  if (!competitionId || entries.length === 0) return;
  let pending = entries;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && pending.length > 0; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    const missing: SimulatedEventsEntry[] = [];
    for (const entry of pending) {
      try {
        const { found } = await client.call('replaceSimulatedMatchEvents', {
          competitionId,
          matchId: entry.matchId,
          events: entry.events,
        });
        if (!found) missing.push(entry);
      } catch (e) {
        if ((e as { code?: string }).code === 'unavailable') return;
        logger.warn(
          LogCategory.DATABASE,
          'replaceSimulatedMatchEvents failed',
          e instanceof Error ? e : undefined
        );
      }
    }
    pending = missing;
  }
}
