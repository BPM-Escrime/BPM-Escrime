/**
 * BPM - Escrime - Retrait et réintégration d'un tireur à l'écran (#1980, docs/adr/0016)
 * Appel, poule, tableau : withdrawFencer / reinstateFencer, règle appliquée par le moteur
 * (matchs perdus, instantané, journal). L'écran relit tireurs et session après la réponse ;
 * succès affiché seulement alors. Tous les formats, équipes comprises (docs/adr/0024, §3).
 * Licensed under GPL-3.0
 */
import { useCallback } from 'react';
import { useBpmClient } from '../api/BpmClientContext';
import { useToast } from '../components/Toast';
import { useTranslation } from './useTranslation';
import type { RecordScoreOutcome } from '../components/tableau/tableauViewShared';

/** Pas de moteur (hors Electron) : statut tenu en mémoire seulement */
const LOCAL_CODES = new Set(['unavailable']);

export type WithdrawalReason = 'abandon' | 'forfait' | 'exclusion';

export interface WithdrawInput {
  fencerId: string;
  reason: WithdrawalReason;
  blackCard?: boolean;
  matchId?: string;
}

export function useFencerWithdrawal(competitionId: string | undefined) {
  const client = useBpmClient();
  const { showToast } = useToast();
  const { t } = useTranslation();

  const fail = useCallback(
    (e: unknown, key: string): RecordScoreOutcome => {
      const code = (e as { code?: string }).code ?? 'internal';
      if (LOCAL_CODES.has(code)) return 'local';
      showToast(t(key, { message: (e as Error).message ?? code }), 'error');
      return 'refused';
    },
    [showToast, t]
  );

  const withdraw = useCallback(
    async (input: WithdrawInput): Promise<RecordScoreOutcome> => {
      if (!competitionId) return 'local';
      try {
        const res = await client.call('withdrawFencer', { competitionId, ...input });
        if (res.forfeitedMatchIds.length > 0) {
          showToast(
            t('plural.matches_not_played', {
              count: res.forfeitedMatchIds.length,
              status: input.reason,
            }),
            'success'
          );
        }
        return 'recorded';
      } catch (e) {
        return fail(e, 'fencerList.withdraw_failed');
      }
    },
    [client, competitionId, showToast, t, fail]
  );

  const reinstate = useCallback(
    async (fencerId: string): Promise<RecordScoreOutcome> => {
      if (!competitionId) return 'local';
      try {
        await client.call('reinstateFencer', { competitionId, fencerId });
        return 'recorded';
      } catch (e) {
        return fail(e, 'fencerList.reinstate_failed');
      }
    },
    [client, competitionId, fail]
  );

  return { withdraw, reinstate };
}
