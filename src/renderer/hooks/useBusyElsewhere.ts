/**
 * BPM - Escrime - Arbitres de l'épreuve occupés dans une autre épreuve
 * de la même journée (#1714). Clé = id d'arbitre de l'épreuve.
 * Licensed under GPL-3.0
 */
import { useEffect, useState } from 'react';
import type { DayRefereeAssignment } from '../../shared/types/eventDay';
import { stationAvailable, useStationApi } from '../api/stationApi';

const POLL_MS = 10_000;

export function useBusyElsewhere(competitionId: string): Record<string, DayRefereeAssignment[]> {
  const [busy, setBusy] = useState<Record<string, DayRefereeAssignment[]>>({});
  const api = useStationApi().eventDay;
  useEffect(() => {
    if (!stationAvailable()) return;
    let alive = true;
    const load = () =>
      api
        .getBusyElsewhere(competitionId)
        .then(r => {
          if (alive) setBusy(r ?? {});
        })
        .catch(() => {
          /* journée indisponible : rien à signaler */
        });
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api, competitionId]);
  return busy;
}
