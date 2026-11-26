/**
 * BPM - Escrime - Tour en vagues, côté écran (docs/adr/0043, lot F4a ; ex-useRapieresCompetition)
 * Matchs de la vague en cours (surbrillance), vague active des tablettes arbitre, impression
 * des feuilles de match d'un intervalle de vagues. Valable pour tout tour en vagues, mode
 * spécial rapières compris.
 * Licensed under GPL-3.0
 */
import { useCallback, useEffect, useMemo } from 'react';
import { MatchStatus } from '../../shared/types';
import type { Pool } from '../../shared/types';
import {
  waveMatchIds,
  waveSheetMatches,
  type PoolWavesState,
} from '../../shared/domain/pools/waves';
import { usePdfTemplateStore } from '../../features/pdfTemplates/hooks/usePdfTemplateStore';
import { useRemoteApi } from '../api/remoteApi';
import { useTranslation } from './useTranslation';

interface UsePoolWavesViewParams {
  competitionId: string;
  competitionTitle: string;
  /** Le tour courant est en vagues (ordre « waves » / « waves_classic », ou mode rapières) */
  isWaves: boolean;
  isRemoteActive: boolean;
  pools: Pool[];
  waves: PoolWavesState;
  updateWaves: (patch: Partial<PoolWavesState>) => void;
  /** Notification de l'écran (toast) */
  notify: (message: string, type: 'error') => void;
}

export function usePoolWavesView({
  competitionId,
  competitionTitle,
  isWaves,
  isRemoteActive,
  pools,
  waves,
  updateWaves,
  notify,
}: UsePoolWavesViewParams) {
  const remote = useRemoteApi();
  const { t } = useTranslation();

  /** Nouvelles poules : aucune vague lancée tant qu'aucun match n'est joué */
  const resetPoolWaves = (newPools: Pool[]) => {
    if (!isWaves) return;
    const played = newPools.some(p => p.matches.some(m => m.status !== MatchStatus.NOT_STARTED));
    if (!played) updateWaves({ launched: 0, ended: false });
  };

  // Matchs de la vague en cours (surbrillance violette)
  const currentWaveMatchIds = useMemo(
    () => (isWaves && !waves.ended ? waveMatchIds(pools, waves.launched) : undefined),
    [isWaves, pools, waves.launched, waves.ended]
  );

  // Tablettes arbitre : matchs de la vague active seulement (#1118), mémorisé par le main
  useEffect(() => {
    if (!isWaves || !competitionId) return;
    const ids = currentWaveMatchIds ? [...currentWaveMatchIds] : null;
    void remote.setActiveWave(competitionId, ids, waves.ended);
  }, [isWaves, isRemoteActive, competitionId, currentWaveMatchIds, waves.ended, remote]);

  // Impression des feuilles de match d'un intervalle de vagues (#1118, plage #1441).
  // Flux continu : une feuille qui ne tient pas sur la page bascule sur la suivante.
  const printWaves = useCallback(
    async (from: number, to: number) => {
      const sheets = [];
      for (let wave = from; wave <= to; wave++) sheets.push(...waveSheetMatches(pools, wave));
      if (sheets.length === 0) {
        notify(t('rapieres.print_wave_sheets_empty'), 'error');
        return;
      }
      const label = from === to ? `Vague ${from}` : `Vagues ${from} à ${to}`;
      try {
        const logo = localStorage.getItem('bellepoule-logo') ?? undefined;
        const { printTableauHTML } = await import('../../shared/utils/pdfExport');
        await printTableauHTML(
          sheets,
          3,
          `${competitionTitle} — ${label}`,
          logo,
          usePdfTemplateStore.getState().templates.tableau,
          undefined,
          {
            subtitle: `Feuilles d'arbitrage — ${label}`,
            badge: 'V' + from,
            continuous: true,
            sheetsOnly: true, // sans bandeau titre ni pied de page (#1441)
          }
        );
      } catch (e) {
        notify((e as Error).message, 'error');
      }
    },
    [pools, competitionTitle, notify, t]
  );

  // Impression des feuilles de match de la vague active (même rendu que les feuilles du tableau) (#1118)
  const handlePrintWaveSheets = useCallback(
    () => printWaves(waves.launched, waves.launched),
    [printWaves, waves.launched]
  );

  return { resetPoolWaves, currentWaveMatchIds, printWaves, handlePrintWaveSheets };
}
