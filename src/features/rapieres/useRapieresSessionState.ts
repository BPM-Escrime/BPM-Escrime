/**
 * BPM - Escrime - État de session du tournoi des rapières (#1241)
 * Composition des équipes, fenêtre d'équipe, et vagues du tour courant (clé de session `waves`,
 * docs/adr/0043 ; lecture de l'ancienne clé `rapieres.launchedWave` comme alias), sortis de
 * CompetitionView.
 * Licensed under GPL-3.0
 */
import { useCallback } from 'react';
import { useStateGroup } from '../../renderer/hooks/useStateGroup';
import type { Fencer } from '../../shared/types';
import {
  createRapieresSession,
  RapieresLegacyState,
  RapieresSession,
  RapieresTeamInfo,
} from '../../shared/domain/rapieres/rapieres.types';
import { poolWavesOf, type PoolWavesState } from '../../shared/domain/pools/waves';

export function useRapieresSessionState() {
  // Tournoi des rapières : composition des équipes (état de session)
  // Fenêtre d'équipe : null = fermée, {} = ajout, { fencer } = modification
  const {
    rapieresState,
    setRapieresState,
    rapieresTeamModal,
    setRapieresTeamModal,
    wavesState,
    setWavesState,
  } = useStateGroup({
    rapieresState: undefined as RapieresSession | RapieresLegacyState | undefined,
    rapieresTeamModal: null as { fencer?: Fencer } | null,
    // Vagues du tour courant ; undefined : jamais écrites, ancienne clé des rapières lue
    wavesState: undefined as PoolWavesState | undefined,
  });
  const rapieres: RapieresSession =
    rapieresState?.version === 2 ? rapieresState : createRapieresSession();
  const waves: PoolWavesState = poolWavesOf({
    waves: wavesState,
    rapieres: rapieresState?.version === 2 ? rapieresState : undefined,
  });
  const updateRapieres = useCallback(
    (patch: Partial<RapieresSession>) =>
      setRapieresState(prev => ({
        ...(prev?.version === 2 ? prev : createRapieresSession()),
        ...patch,
      })),
    [setRapieresState]
  );
  /** Repli local (moteur absent) : vagues du tour courant */
  const updateWaves = useCallback(
    (patch: Partial<PoolWavesState>) =>
      setWavesState(prev => ({ ...poolWavesOf({ waves: prev }), ...patch })),
    [setWavesState]
  );
  const setRapieresTeam = useCallback(
    (id: string, info: RapieresTeamInfo) =>
      setRapieresState(prev => {
        const base = prev?.version === 2 ? prev : createRapieresSession();
        return { ...base, teams: { ...base.teams, [id]: info } };
      }),
    [setRapieresState]
  );
  return {
    rapieresState,
    setRapieresState,
    rapieresTeamModal,
    setRapieresTeamModal,
    rapieres,
    updateRapieres,
    setRapieresTeam,
    waves,
    setWavesState,
    updateWaves,
  };
}
