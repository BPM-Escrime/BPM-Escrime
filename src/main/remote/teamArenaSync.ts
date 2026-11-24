/**
 * BPM - Escrime - Arène équipe suivie sur le journal de l'épreuve (#2267, docs/adr/0010, 0028)
 * Une commande d'équipe passée ailleurs que par l'arène (écran, MCP, autre arène) fait avancer
 * le journal : au signal `journal:appended`, chaque arène équipe de l'épreuve relit les
 * événements postérieurs à sa révision ; si l'un porte sur sa rencontre (identifiants seulement,
 * ADR-0007), elle relit la rencontre en base et diffuse son état (`team_arena_state`, appareil
 * de piste compris), comme le plan des pistes (`watchStripPlans`, #2234).
 * Pas de double diffusion : la commande venue de l'arène elle-même (tablette, appareil) relit
 * la rencontre dans le même tour, ce qui avance sa révision ; le signal, traité après la
 * transaction (microtâche), la trouve déjà à jour et ne diffuse rien.
 * Licensed under GPL-3.0
 */
import type { TeamArenaState } from './types';
import { onCompetitionEvent } from '../engine/api/events';
import { broadcastTeamArena, reloadTeamArenaMatch, type TeamArenaContext } from './teamArena';

/** Plafond de lecture du journal : au-delà, la rencontre est relue sans chercher plus loin */
const SCAN_LIMIT = 1000;

/** Un événement postérieur à la révision de l'arène porte-t-il sur sa rencontre ? */
function concernsArena(ctx: TeamArenaContext, state: TeamArenaState): boolean {
  const events = ctx.db.eventLog?.getSince(state.competitionId, state.revision ?? 0, SCAN_LIMIT);
  if (!events) return false;
  if (events.length >= SCAN_LIMIT) return true;
  return events.some(e => (e.payload as { matchId?: unknown }).matchId === state.matchId);
}

/**
 * Relais en cours changé par la commande (relais enregistré ou rappelé ailleurs) : score en
 * direct et chrono repris du relais, comme à l'envoi de la rencontre (setTeamArenaMatch).
 */
function followCurrentRelay(state: TeamArenaState, previousIndex: number): void {
  if (state.currentBoutIndex === previousIndex) return;
  const current = state.bouts[state.currentBoutIndex];
  const reopened = current?.status === 'in_progress' ? current : null;
  state.liveScoreA = reopened ? reopened.scoreA : 0;
  state.liveScoreB = reopened ? reopened.scoreB : 0;
  state.elapsedAccumulatedSec = 0;
  state.timerStartedAt = null;
}

/**
 * Arènes équipe de l'épreuve rafraîchies jusqu'à `revision` : celles dont la rencontre est
 * touchée sont relues et diffusées, les autres avancent leur révision sans rien diffuser.
 * Rend les arènes diffusées.
 */
export function refreshTeamArenas(
  ctx: TeamArenaContext,
  competitionId: string,
  revision: number
): string[] {
  const broadcast: string[] = [];
  for (const [arenaId, state] of ctx.teamArenaState) {
    if (state.competitionId !== competitionId || (state.revision ?? 0) >= revision) continue;
    if (!concernsArena(ctx, state)) {
      state.revision = revision;
      continue;
    }
    const previousIndex = state.currentBoutIndex;
    // Rencontre disparue (nouveau tirage) : l'arène garde son état, renvoi par l'écran
    if (!reloadTeamArenaMatch(ctx, state)) {
      state.revision = revision;
      continue;
    }
    followCurrentRelay(state, previousIndex);
    broadcastTeamArena(ctx, arenaId);
    broadcast.push(arenaId);
  }
  return broadcast;
}

/**
 * Suit les signaux `journal:appended` du bus : arènes équipe du serveur de l'épreuve
 * rafraîchies s'il tourne. Relu après la transaction de la commande et après la relecture
 * faite par l'arène émettrice (microtâche). Rend le désabonnement.
 */
export function watchTeamArenas(
  serverOf: (competitionId: string) => TeamArenaContext | undefined
): () => void {
  return onCompetitionEvent(event => {
    if (event.type !== 'journal:appended' || !event.competitionId) return;
    const { competitionId, revision } = event;
    if (typeof revision !== 'number') return;
    queueMicrotask(() => {
      const ctx = serverOf(competitionId);
      if (ctx) refreshTeamArenas(ctx, competitionId, revision);
    });
  });
}
