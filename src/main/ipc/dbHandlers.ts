/**
 * BPM - Escrime - Événements de données de l'épreuve (ex-handlers IPC `db:*`, #1155).
 * Plus aucun canal `db:*` : l'écran lit l'épreuve par le contrat (getCompetitionState, #1981).
 * Licensed under GPL-3.0
 */
import type { CompetitionEventType } from '../../shared/types/preload';
import { publishCompetitionEvent } from '../engine/api/events';

/**
 * Publie un événement de données sur le bus du moteur ; l'écran le reçoit par l'abonnement
 * onCompetitionEvents du contrat (docs/adr/0010), plus par un canal IPC dédié.
 */
export function emitCompetitionEvent(type: CompetitionEventType, competitionId?: string): void {
  publishCompetitionEvent({ type, competitionId });
}
