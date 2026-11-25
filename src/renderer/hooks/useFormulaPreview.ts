/**
 * BPM - Escrime - Nouvelle interface de formule (aperçu, #2013 D13, docs/adr/0032)
 * Réglage du poste `formulaPreview`, lu par l'écran seulement : le moteur et le MCP l'ignorent.
 * Hors poste (navigateur, tests sans pont) : désactivé.
 * Licensed under GPL-3.0
 */

import { useEffect, useState } from 'react';
import { stationAvailable, useStationApi } from '../api/stationApi';

/** Événement de fenêtre émis par Paramètres ▸ Système quand le réglage change */
export const FORMULA_PREVIEW_EVENT = 'bpm:formula-preview';

export function notifyFormulaPreviewChanged(enabled: boolean): void {
  window.dispatchEvent(new CustomEvent<boolean>(FORMULA_PREVIEW_EVENT, { detail: enabled }));
}

export function useFormulaPreview(): boolean {
  const api = useStationApi().settings;
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!stationAvailable()) return;
    let alive = true;
    void api
      .get()
      .then(s => {
        if (alive) setEnabled(s.formulaPreview === true);
      })
      .catch(() => undefined);
    const onChange = (e: Event) => setEnabled((e as CustomEvent<boolean>).detail === true);
    window.addEventListener(FORMULA_PREVIEW_EVENT, onChange);
    return () => {
      alive = false;
      window.removeEventListener(FORMULA_PREVIEW_EVENT, onChange);
    };
  }, [api]);

  return enabled;
}
