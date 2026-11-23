/**
 * BPM - Escrime - Plan de salle enregistré sur l'épreuve (docs/adr/0025)
 * Chargement à l'ouverture (getArenaPlan), enregistrement temporisé à chaque modification
 * et à la fermeture (saveArenaPlan). Sans épreuve : rien, le plan reste en mémoire.
 * Licensed under GPL-3.0
 */
import { useCallback, useEffect, useRef } from 'react';
import { useBpmClient } from '../../api/BpmClientContext';
import { logger, LogCategory } from '@shared/services/logger';
import type { ArenaPlan } from '@shared/api/arenaPlanSchema';
import type { RoomPlan } from './roomPlans';

const SAVE_DELAY_MS = 800;

/** Plus grand suffixe numérique des identifiants « prefix-N » (compteurs des nouveaux ids) */
export const maxIdSuffix = (ids: string[], prefix: string): number =>
  ids.reduce((max, id) => {
    const tail = id.startsWith(`${prefix}-`) ? id.slice(prefix.length + 1) : '';
    return /^\d+$/.test(tail) ? Math.max(max, Number(tail)) : max;
  }, 0);

export function useArenaPlanPersistence(opts: {
  competitionId?: string | null;
  rooms: RoomPlan[];
  activeId: string;
  onLoad: (plan: ArenaPlan) => void;
}): void {
  const { competitionId, rooms, activeId } = opts;
  const client = useBpmClient();
  const onLoadRef = useRef(opts.onLoad);
  useEffect(() => {
    onLoadRef.current = opts.onLoad;
  });
  /** Plan lu : avant, l'état par défaut ne doit pas écraser le plan enregistré */
  const loadedRef = useRef(false);
  const pendingRef = useRef<{ competitionId: string; plan: ArenaPlan } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    client.call('saveArenaPlan', pending).catch(err => {
      logger.warn(LogCategory.BUSINESS, 'Plan de salle non enregistré', err);
    });
  }, [client]);

  useEffect(() => {
    loadedRef.current = false;
    if (!competitionId) return;
    let cancelled = false;
    client
      .query('getArenaPlan', { competitionId })
      .then(plan => {
        if (cancelled) return;
        if (plan) onLoadRef.current(plan);
        loadedRef.current = true;
      })
      .catch(err => {
        // Lecture impossible : pas d'enregistrement, pour ne pas écraser un plan existant
        logger.warn(LogCategory.BUSINESS, 'Plan de salle illisible', err);
      });
    return () => {
      cancelled = true;
    };
  }, [client, competitionId]);

  useEffect(() => {
    if (!competitionId || !loadedRef.current) return;
    pendingRef.current = { competitionId, plan: { version: 1, rooms, activeRoomId: activeId } };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [competitionId, rooms, activeId, flush]);

  // Fermeture ou changement d'épreuve : dernière modification enregistrée sans attendre
  useEffect(() => flush, [flush, competitionId]);
}
