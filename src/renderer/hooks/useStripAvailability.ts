/**
 * BPM - Escrime - Plan des pistes de l'épreuve vu par l'écran (#1501, docs/adr/0015)
 * Lecteur du contrat : getStripPlan, relu sur le signal `strips:changed` ; écritures par
 * setStripStart et setStripAvailability. Les consommateurs (cartes de matchs, boutons de piste,
 * répartition du tableau) lisent le store ; useStripPlan(épreuve) le charge.
 * Reprise unique des clés locales des versions précédentes (retirée après la 3.0).
 * Licensed under GPL-3.0
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import type { BpmClient } from '../../shared/api/client';
import { useBpmClient } from '../api/BpmClientContext';
import { logger, LogCategory } from '../../shared/services/logger';

interface StripPlanView {
  start: number;
  unavailable: number[];
}

interface StripAvailabilityState extends StripPlanView {
  competitionId: string | null;
  client: BpmClient | null;
  /** Plan de l'épreuve relu par le contrat */
  apply: (competitionId: string, plan: StripPlanView) => void;
  bind: (client: BpmClient, competitionId: string) => void;
  /** Bascule une piste (indisponible ↔ disponible) */
  toggle: (strip: number) => void;
  /** Piste de départ de l'épreuve */
  setStart: (start: number) => void;
}

const warn = (what: string) => (e: unknown) =>
  logger.warn(LogCategory.UI, `[plan des pistes] ${what}`, e instanceof Error ? e : undefined);

/** Relit le plan de l'épreuve ; épreuve changée entre-temps : ignoré */
async function reload(competitionId: string): Promise<void> {
  const { client, apply } = useStripAvailability.getState();
  if (!client) return;
  try {
    const plan = await client.query('getStripPlan', { competitionId });
    apply(competitionId, plan);
  } catch (e) {
    warn('lecture impossible')(e);
  }
}

export const useStripAvailability = create<StripAvailabilityState>((set, get) => ({
  competitionId: null,
  client: null,
  start: 1,
  unavailable: [],
  apply: (competitionId, plan) => {
    if (get().competitionId !== competitionId) return;
    set({ start: plan.start, unavailable: [...plan.unavailable] });
  },
  bind: (client, competitionId) => {
    if (get().competitionId === competitionId && get().client === client) return;
    set({ client, competitionId, start: 1, unavailable: [] });
  },
  toggle: strip => {
    const { competitionId, client, unavailable } = get();
    const available = unavailable.includes(strip);
    // Affichage immédiat, puis relecture du moteur (refus : état du moteur rétabli)
    set({
      unavailable: available
        ? unavailable.filter(n => n !== strip)
        : [...unavailable, strip].sort((a, b) => a - b),
    });
    if (!competitionId || !client) return;
    client
      .call('setStripAvailability', { competitionId, strip, available })
      .catch(warn('marquage refusé'))
      .finally(() => void reload(competitionId));
  },
  setStart: start => {
    const { competitionId, client } = get();
    set({ start });
    if (!competitionId || !client) return;
    client
      .call('setStripStart', { competitionId, start })
      .catch(warn('piste de départ refusée'))
      .finally(() => void reload(competitionId));
  },
}));

const LEGACY_UNAVAILABLE = (id: string) => `bellepoule-strips-unavailable-${id}`;
const LEGACY_START = (id: string) => `bellepoule-remote-strip-start-${id}`;
const POSTE_UI = (id: string) => `bellepoule-ui-${id}`;

/** Lecture tolérante d'une clé locale (stockage absent ou bloqué → null) */
function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* stockage indisponible : rien à effacer */
  }
}

/** Piste de départ gardée par ce poste (3.0 en développement), retirée de l'état du poste */
function takePosteStart(competitionId: string): number | null {
  const raw = readKey(POSTE_UI(competitionId));
  let value: number | null = null;
  try {
    const ui = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    if (ui && 'remoteStripStart' in ui) {
      if (Number.isInteger(ui.remoteStripStart)) value = ui.remoteStripStart as number;
      delete ui.remoteStripStart;
      localStorage.setItem(POSTE_UI(competitionId), JSON.stringify(ui));
    }
  } catch {
    /* état illisible ou stockage bloqué : rien à reprendre */
  }
  const legacy = Number.parseInt(readKey(LEGACY_START(competitionId)) ?? '', 10);
  removeKey(LEGACY_START(competitionId));
  return value ?? (Number.isInteger(legacy) ? legacy : null);
}

/**
 * Reprise unique (docs/adr/0015, amendement du 2026-11-24) : pistes indisponibles et piste de
 * départ gardées par ce poste, envoyées au moteur, puis clés effacées.
 */
export async function migrateLocalStripPlan(
  client: BpmClient,
  competitionId: string,
  plan: StripPlanView
): Promise<boolean> {
  let sent = false;
  const raw = readKey(LEGACY_UNAVAILABLE(competitionId));
  if (raw !== null) {
    let list: unknown = [];
    try {
      list = JSON.parse(raw);
    } catch {
      /* clé illisible : rien à reprendre */
    }
    const strips = Array.isArray(list)
      ? list.filter(n => Number.isInteger(n) && n > 0 && n <= 999 && !plan.unavailable.includes(n))
      : [];
    for (const strip of [...new Set(strips as number[])]) {
      await client.call('setStripAvailability', { competitionId, strip, available: false });
      sent = true;
    }
    removeKey(LEGACY_UNAVAILABLE(competitionId));
  }
  const start = takePosteStart(competitionId);
  if (start !== null && start > 1 && start <= 999 && plan.start === 1) {
    await client.call('setStripStart', { competitionId, start });
    sent = true;
  }
  return sent;
}

/**
 * Charge le plan des pistes de l'épreuve dans le store, le relit sur `strips:changed` et fait la
 * reprise des clés locales. Rend la piste de départ et son écriture.
 */
export function useStripPlan(competitionId: string): {
  start: number;
  setStart: (start: number) => void;
} {
  const client = useBpmClient();
  const start = useStripAvailability(s => (s.competitionId === competitionId ? s.start : 1));
  const setStart = useStripAvailability(s => s.setStart);
  useEffect(() => {
    useStripAvailability.getState().bind(client, competitionId);
    let cancelled = false;
    void (async () => {
      try {
        const plan = await client.query('getStripPlan', { competitionId });
        if (cancelled) return;
        useStripAvailability.getState().apply(competitionId, plan);
        if (await migrateLocalStripPlan(client, competitionId, plan)) await reload(competitionId);
      } catch (e) {
        warn('chargement impossible')(e);
      }
    })();
    let off: (() => void) | undefined;
    try {
      off = client.subscribe('onCompetitionEvents', { competitionId }, event => {
        if (event.type !== 'strips:changed') return;
        if (event.competitionId && event.competitionId !== competitionId) return;
        void reload(competitionId);
      });
    } catch {
      // API indisponible (hors Electron, tests sans client) : pas d'abonnement
    }
    return () => {
      cancelled = true;
      off?.();
    };
  }, [client, competitionId]);
  return { start, setStart };
}
