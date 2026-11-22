/**
 * Abonnement au bus d'événements de données main → renderer (#1298).
 * Remplace les polls : le callback est appelé après chaque écriture concernée.
 * Passe par le contrat (onCompetitionEvents, #1981) : même bus, quel que soit le transport.
 * Licensed under GPL-3.0
 */
import { useEffect, useRef } from 'react';
import type { CompetitionEventType } from '../../shared/types/preload';
import { useBpmClient } from '../api/BpmClientContext';

export type { CompetitionEventType };

export function useCompetitionEvent(
  type: CompetitionEventType,
  competitionId: string | undefined,
  callback: () => void
): void {
  const client = useBpmClient();
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    try {
      return client.subscribe('onCompetitionEvents', { competitionId }, event => {
        if (event.type !== type) return;
        if (competitionId && event.competitionId && event.competitionId !== competitionId) return;
        cbRef.current();
      });
    } catch {
      // API indisponible (hors Electron, tests sans client) : pas d'abonnement
      return undefined;
    }
  }, [client, type, competitionId]);
}
