/**
 * BPM - Escrime - Mode expert de l'éditeur de formule (#2013 F2, docs/adr/0041)
 * Préférence du poste `formulaExpert`, lue et écrite par le contrat (réglages du poste,
 * `updateStationSettings`). Éteinte par défaut ; hors poste (navigateur, tests sans pont), elle
 * vaut pour l'édition en cours seulement. Ne change que ce que l'éditeur propose.
 * Licensed under GPL-3.0
 */

import { useCallback, useEffect, useState } from 'react';
import { stationAvailable, useStationApi } from '../api/stationApi';

export function useFormulaExpert(): { expert: boolean; setExpert: (value: boolean) => void } {
  const api = useStationApi().settings;
  const [expert, setLocal] = useState(false);

  useEffect(() => {
    if (!stationAvailable()) return;
    let alive = true;
    void api
      .get()
      .then(s => {
        if (alive) setLocal(s.formulaExpert === true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api]);

  const setExpert = useCallback(
    (value: boolean) => {
      setLocal(value);
      if (!stationAvailable()) return;
      void api
        .update({ formulaExpert: value })
        .then(s => setLocal(s.formulaExpert === true))
        .catch(() => setLocal(!value));
    },
    [api]
  );

  return { expert, setExpert };
}
