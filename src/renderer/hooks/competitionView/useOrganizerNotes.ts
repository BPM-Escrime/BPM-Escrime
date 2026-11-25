/**
 * BPM - Escrime - Organisation ▸ Notes & retours : lecture des notes de l'épreuve, nombre de
 * points ouverts et écriture par updateCompetitionSettings (`settings.organizerNotes`, ADR-0018).
 * Licensed under GPL-3.0
 */

import { useCallback } from 'react';
import { useBpmClient } from '../../api/BpmClientContext';
import { openOrganizerItems } from '../../../shared/domain/organizerNotes/organizerNotes';
import type { Competition, OrganizerNote } from '../../../shared/types';

export function useOrganizerNotes(
  competition: Competition,
  onUpdate: (competition: Competition) => void
) {
  const client = useBpmClient();
  const notes = competition.settings?.organizerNotes ?? [];
  const save = useCallback(
    async (organizerNotes: OrganizerNote[]) => {
      await client.call('updateCompetitionSettings', {
        competitionId: competition.id,
        settings: { organizerNotes },
      });
      onUpdate({ ...competition, settings: { ...competition.settings, organizerNotes } });
    },
    [client, competition, onUpdate]
  );
  return { notes, openCount: openOrganizerItems(notes), save };
}
