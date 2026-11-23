/**
 * BPM - Escrime - Thème du kiosque (prédéfini ou personnalisé) (#1241)
 * Extrait de RemoteScoreManager. Le préréglage est mémorisé par compétition (localStorage).
 * Licensed under GPL-3.0
 */
import { useCallback, useState } from 'react';
import type { CustomTheme } from '../../shared/types/remote';
import { useRemoteApi } from '../api/remoteApi';

export type KioskPreset = 'default' | 'neon' | 'light';
type IpcResult = { success?: boolean; error?: string } | undefined;

export function useKioskTheme(competitionId: string) {
  const remote = useRemoteApi();
  const presetKey = `bellepoule-kiosk-preset-${competitionId}`;
  const [kioskTheme, setKioskTheme] = useState<CustomTheme | undefined>(undefined);
  const [kioskThemeEditorOpen, setKioskThemeEditorOpen] = useState(false);
  // Thème prédéfini du kiosk (néon / clair, basés sur l'affichage des pistes) (#1036)
  const [kioskPreset, setKioskPreset] = useState<KioskPreset>(() => {
    try {
      const v = localStorage.getItem(presetKey);
      return v === 'neon' || v === 'light' ? v : 'default';
    } catch {
      return 'default';
    }
  });

  /** Applique un préréglage ; envoi au serveur seulement si une session est active */
  const applyKioskPreset = useCallback(
    async (preset: KioskPreset, sessionActive: boolean): Promise<IpcResult> => {
      setKioskPreset(preset);
      setKioskTheme(undefined);
      try {
        localStorage.setItem(presetKey, preset);
      } catch {
        /* stockage indisponible */
      }
      if (!sessionActive) return { success: true };
      return remote.updateKioskTheme(competitionId, { '--k-preset': preset });
    },
    [competitionId, presetKey, remote]
  );

  /** Applique un thème personnalisé (remplace le préréglage) */
  const applyKioskCustomTheme = useCallback(
    async (theme: CustomTheme): Promise<IpcResult> => {
      setKioskTheme(theme);
      return remote.updateKioskTheme(competitionId, {
        '--k-preset': 'default',
        ...theme.variables,
      });
    },
    [competitionId, remote]
  );

  return {
    kioskTheme,
    kioskPreset,
    kioskThemeEditorOpen,
    setKioskThemeEditorOpen,
    applyKioskPreset,
    applyKioskCustomTheme,
  };
}
