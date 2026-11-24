/**
 * BPM - Escrime - Synchronisation des scores et pistes distants (extrait de CompetitionView, #1599)
 * Licensed under GPL-3.0
 */
import { useCallback, useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { FencerStatus } from '../../shared/types';
import type { Pool } from '../../shared/types';
import type { Arena } from '../../shared/types/remote';
import { logger, LogCategory } from '@shared/services/logger';
import { NotificationService } from '../../shared/services/notificationService';
import type { useFencerManagement } from './useFencerManagement';
import { checkInStatusUpdate } from '../../shared/utils/forfeit';
import { DT_CONFIRM_ABANDON_EVENT } from '../services/dtCallEvents';
import type { DtConfirmAbandonDetail } from '../services/dtCallEvents';
import type { usePoolManagement } from './usePoolManagement';
import { useRemoteApi } from '../api/remoteApi';

interface UseRemoteScoreSyncParams {
  competitionId: string;
  competitionTitle: string;
  isRemoteActive: boolean;
  poolsRef: MutableRefObject<Pool[]>;
  handleFencerForfeitRef: MutableRefObject<
    ReturnType<typeof usePoolManagement>['handleFencerForfeit']
  >;
  setArenaStates: Dispatch<SetStateAction<Arena[]>>;
  updateFencer: ReturnType<typeof useFencerManagement>['updateFencer'];
  /** Retrait par withdrawFencer (docs/adr/0016) : abandon signalé par l'appareil, confirmé par le DT */
  withdraw?: (input: {
    fencerId: string;
    reason: 'abandon' | 'forfait' | 'exclusion';
    matchId?: string;
  }) => Promise<'recorded' | 'local' | 'refused'>;
}

/** Suit les pistes et les fins de match remontées par le serveur distant (le moteur écrit, ADR-0005). */
export function useRemoteScoreSync({
  competitionId,
  competitionTitle,
  isRemoteActive,
  poolsRef,
  handleFencerForfeitRef,
  setArenaStates,
  updateFencer,
  withdraw,
}: UseRemoteScoreSyncParams) {
  const remote = useRemoteApi();

  // Charger les arènes quand le serveur distant devient actif et s'abonner aux updates
  useEffect(() => {
    if (!isRemoteActive || !competitionId) return;
    remote
      .getArenas(competitionId)
      .then(res => {
        if (res?.success && res.arenas) setArenaStates(res.arenas);
      })
      .catch(() => {});
    const unlisten = remote.onActivity('arena_updated', competitionId, data => {
      setArenaStates(prev => {
        const idx = prev.findIndex((a: Arena) => a.id === data.arenaId);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          currentMatch: data.update?.match ?? updated[idx].currentMatch,
          status: data.update?.status ?? updated[idx].status,
        };
        return updated;
      });

      // NB : on ne propage PAS le score touche-par-touche vers les données du
      // match (poule/tableau). Le score n'est appliqué que lorsque l'arbitre
      // valide « match terminé » (avis match_finished). Ici on ne met à jour
      // que l'affichage live de la piste (arenaStates, ci-dessus).
    });
    return () => unlisten();
  }, [isRemoteActive, competitionId]);

  const fireWebhookNotif = useCallback((title: string, body: string) => {
    try {
      const webhookUrl = localStorage.getItem('bellepoule-webhook-url');
      if (!webhookUrl) return;
      const svc = new NotificationService({
        browser: false,
        webhook: { url: webhookUrl },
        events: {
          matchCompleted: true,
          matchStarting: false,
          competitionStarted: false,
          competitionEnded: false,
          fencerLate: false,
        },
      });
      svc.notify({ title, body }).catch(() => {});
    } catch {
      /* non bloquant */
    }
  }, []);

  // Écouter les mises à jour des matches distants
  // Note: pas de garde sur currentPhase car la phase 'remote' affiche le panel de saisie distante
  // mais les mises à jour doivent quand même être appliquées aux pools
  useEffect(() => {
    const handleMatchFinished = (data: {
      matchId: string;
      scoreA: number;
      scoreB: number;
      isTableau?: boolean;
    }) => {
      const { matchId, scoreA, scoreB, isTableau } = data;
      logger.warn(
        LogCategory.UI,
        `[CompetitionView] match:finished REÇU matchId=${matchId} score=${scoreA}-${scoreB} tableau=${!!isTableau}`
      );
      // Score écrit par le moteur (recordScore, #1980) : la session est relue (session:changed),
      // l'écran n'applique rien (ADR-0005)
      fireWebhookNotif(
        `Match terminé — ${competitionTitle}`,
        `Score : ${scoreA} – ${scoreB}${isTableau ? ' (tableau)' : ''}`
      );
    };

    const offMatchFinished = remote.onActivity(
      'match_finished',
      competitionId,
      handleMatchFinished
    );

    return () => {
      offMatchFinished();
    };
  }, [competitionId, fireWebhookNotif, competitionTitle]);

  // Abandon signalé par l'appareil de piste, confirmé par le DT depuis l'appel (#2000) :
  // même traitement qu'un statut posé à l'appel (DNS #1256, matchs restants annulés)
  useEffect(() => {
    const onConfirm = (e: Event) => {
      const detail = (e as CustomEvent<DtConfirmAbandonDetail>).detail;
      if (!detail || (detail.competitionId && detail.competitionId !== competitionId)) return;
      detail.handled = true;
      const local = () => {
        const update = checkInStatusUpdate(
          poolsRef.current,
          detail.fencerId,
          FencerStatus.ABANDONED
        );
        void handleFencerForfeitRef.current(detail.fencerId, 'abandon');
        updateFencer(detail.fencerId, update);
      };
      // Retrait par le moteur (docs/adr/0016) ; repli local hors moteur
      if (!withdraw) return local();
      void withdraw({ fencerId: detail.fencerId, reason: 'abandon' }).then(outcome => {
        if (outcome === 'local') local();
      });
    };
    window.addEventListener(DT_CONFIRM_ABANDON_EVENT, onConfirm);
    return () => window.removeEventListener(DT_CONFIRM_ABANDON_EVENT, onConfirm);
  }, [competitionId, poolsRef, handleFencerForfeitRef, updateFencer, withdraw]);

  return { fireWebhookNotif };
}
