/**
 * BPM - Escrime - Sources des durées de match du poste (#1965)
 * Réglages du DT et historique (paramètre matchDurations), pour la simulation de formule et les
 * indicateurs : même référence que l'heure de fin du dashboard. Hors poste : valeurs par défaut.
 * Licensed under GPL-3.0
 */
import { useEffect, useState } from 'react';
import {
  durationSources,
  type DurationSources,
} from '../../shared/domain/durations/matchDurations';
import { stationAvailable, useStationApi } from '../api/stationApi';

export function useDurationSources(): DurationSources | undefined {
  const api = useStationApi().settings;
  const [sources, setSources] = useState<DurationSources>();
  useEffect(() => {
    if (!stationAvailable()) return;
    let alive = true;
    void api
      .get()
      .then(s => {
        if (alive && s.matchDurations) setSources(durationSources(s.matchDurations));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api]);
  return sources;
}
