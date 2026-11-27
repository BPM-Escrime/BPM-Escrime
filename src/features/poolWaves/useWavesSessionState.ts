/**
 * BPM - Escrime - État de session des tours en vagues et ancienne clé `rapieres` (#1241)
 * Vagues du tour courant (clé de session `waves`, docs/adr/0043) et, pour une épreuve enregistrée
 * en mode spécial rapières, l'ancienne clé `rapieres` (lue en alias : vagues, composition des
 * équipes, mode de tableau), sortis de CompetitionView.
 * Licensed under GPL-3.0
 */
import { useCallback } from 'react';
import { useStateGroup } from '../../renderer/hooks/useStateGroup';
import type {
  RapieresLegacyState,
  RapieresSession,
} from '../../shared/domain/rapieres/rapieres.types';
import { poolWavesOf, type PoolWavesState } from '../../shared/domain/pools/waves';

export function useWavesSessionState() {
  const { rapieresState, setRapieresState, wavesState, setWavesState } = useStateGroup({
    // Ancienne clé de session des rapières (lecture seule : plus écrite depuis F4e)
    rapieresState: undefined as RapieresSession | RapieresLegacyState | undefined,
    // Vagues du tour courant ; undefined : jamais écrites, ancienne clé des rapières lue
    wavesState: undefined as PoolWavesState | undefined,
  });
  const waves: PoolWavesState = poolWavesOf({
    waves: wavesState,
    rapieres: rapieresState?.version === 2 ? rapieresState : undefined,
  });
  /** Repli local (moteur absent) : vagues du tour courant */
  const updateWaves = useCallback(
    (patch: Partial<PoolWavesState>) =>
      setWavesState(prev => ({ ...poolWavesOf({ waves: prev }), ...patch })),
    [setWavesState]
  );
  return {
    rapieresState,
    setRapieresState,
    /** Composition des équipes de l'ancienne clé de session (épreuve enregistrée en mode spécial) */
    legacyTeams: rapieresState?.version === 2 ? rapieresState.teams : undefined,
    waves,
    setWavesState,
    updateWaves,
  };
}
