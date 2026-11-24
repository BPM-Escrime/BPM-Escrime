/**
 * BPM - Escrime - Plan des pistes d'une épreuve (docs/adr/0015, #1501) : piste de départ et
 * pistes indisponibles. Règles pures partagées par le moteur (commandes, serveur distant, pistes
 * de la journée) et l'écran (répartition des pistes du tableau).
 * Licensed under GPL-3.0
 */
import { stripAtIndex } from '../../utils/stripRange';

export interface StripPlan {
  /** Première piste exposée (les arènes inférieures sont masquées). */
  start: number;
  /** Pistes marquées indisponibles, entiers > 0, triés, sans doublon. */
  unavailable: number[];
}

/** Plus grand numéro de piste du plan */
export const MAX_PLAN_STRIP = 999;

export const DEFAULT_STRIP_PLAN: StripPlan = { start: 1, unavailable: [] };

const isStrip = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) > 0 && (n as number) <= MAX_PLAN_STRIP;

/** Valide une entrée quelconque : entiers de 1 à 999, sans doublon, triés ; défaut sinon. */
export function normalizeStripPlan(input: unknown): StripPlan {
  const raw = (input ?? {}) as Partial<StripPlan>;
  const start = isStrip(raw.start) ? raw.start : 1;
  const list: unknown[] = Array.isArray(raw.unavailable) ? raw.unavailable : [];
  const unavailable = [...new Set(list.filter(isStrip))].sort((a, b) => a - b);
  return { start, unavailable };
}

/** Plan avec la piste marquée disponible ou non ; null : rien ne change. */
export function withStripAvailability(
  plan: StripPlan,
  strip: number,
  available: boolean
): StripPlan | null {
  const marked = plan.unavailable.includes(strip);
  if (marked === !available) return null;
  const unavailable = available
    ? plan.unavailable.filter(n => n !== strip)
    : [...plan.unavailable, strip].sort((a, b) => a - b);
  return { ...plan, unavailable };
}

/**
 * Première piste libre de l'épreuve pour une poule sans piste : dans son intervalle (≥ piste de
 * départ, ≤ `max`), hors pistes indisponibles et déjà prises. null : la poule attend une piste
 * (jamais placée sur une piste masquée, qui peut être celle d'une autre épreuve de la journée).
 */
export function nextFreeStrip(
  plan: StripPlan,
  used: ReadonlySet<number>,
  max: number
): number | null {
  for (let n = plan.start; n <= max; n++) {
    if (!used.has(n) && !plan.unavailable.includes(n)) return n;
  }
  return null;
}

/** Match du tableau à placer sur une piste */
interface ArenaSlot {
  fencerA?: unknown;
  fencerB?: unknown;
  isBye?: boolean;
  winner?: unknown;
  arena?: number | null;
}

/**
 * Répartition des pistes du tableau (tour par tour) : chaque match jouable (deux tireurs, pas
 * d'exemption, pas de vainqueur) retenu par `only` reçoit la piste suivante parmi les pistes
 * disponibles de l'intervalle [plan.start, lastStrip], en rotation.
 */
export function distributeArenasRoundRobin<M extends ArenaSlot>(
  matches: M[],
  plan: StripPlan,
  lastStrip: number,
  only?: (m: M) => boolean
): M[] {
  if (lastStrip <= 0) return matches;
  let index = 0;
  return matches.map(m => {
    if (!m.fencerA || !m.fencerB || m.isBye || m.winner || (only && !only(m))) return m;
    const arena = stripAtIndex(plan.start, lastStrip, index, plan.unavailable);
    index++;
    return { ...m, arena };
  });
}
