/**
 * BPM - Escrime - Plan des pistes vu par le serveur distant (#1501, docs/adr/0015)
 * Le plan est une donnée du moteur (competition_strip_plans) : envoyé au serveur de l'épreuve à
 * son démarrage et à chaque signal `strips:changed` (setStripStart, setStripAvailability), d'où
 * qu'il vienne (écran, MCP). Les arènes hors intervalle sont masquées des écrans (kiosque,
 * tableau de bord). Règles : shared/domain/planning.
 * Licensed under GPL-3.0
 */
import type { Arena } from '../../shared/types/remote';
import type { DatabaseManager } from '../../database';
import { onCompetitionEvent } from '../engine/api/events';
import type { StripPlan } from '../../shared/domain/planning/stripPlan';

export {
  DEFAULT_STRIP_PLAN,
  normalizeStripPlan,
  type StripPlan,
} from '../../shared/domain/planning/stripPlan';

/** Arènes visibles : celles dont le numéro est dans l'intervalle (≥ piste de départ). */
export function visibleArenas<T extends Pick<Arena, 'number'>>(arenas: T[], plan: StripPlan): T[] {
  return arenas.filter(a => a.number >= plan.start);
}

/** Ce que l'envoi du plan appelle sur un serveur distant */
export interface StripPlanTarget {
  setStripPlan(plan: StripPlan): void;
}

/** Plan de l'épreuve relu en base, envoyé à son serveur distant */
export function pushStripPlan(
  db: Pick<DatabaseManager, 'stripPlans'>,
  competitionId: string,
  server: StripPlanTarget
): void {
  const { start, unavailable } = db.stripPlans.getStripPlan(competitionId);
  server.setStripPlan({ start, unavailable });
}

/**
 * Suit les signaux `strips:changed` du bus : le plan relu en base part au serveur de l'épreuve
 * s'il tourne. Relu après la transaction de la commande (microtâche). Rend le désabonnement.
 */
export function watchStripPlans(
  db: Pick<DatabaseManager, 'stripPlans'>,
  serverOf: (competitionId: string) => StripPlanTarget | undefined
): () => void {
  return onCompetitionEvent(event => {
    if (event.type !== 'strips:changed' || !event.competitionId) return;
    const competitionId = event.competitionId;
    queueMicrotask(() => {
      const server = serverOf(competitionId);
      if (server) pushStripPlan(db, competitionId, server);
    });
  });
}
