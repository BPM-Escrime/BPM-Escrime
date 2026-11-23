/**
 * BPM - Escrime - Événements simulés du remplissage automatique (#1981)
 * replaceSimulatedMatchEvents : touches, cartons et durée d'essai d'un match, remplacés d'un
 * bloc (anciennes lignes simulées effacées). Pas un fait de l'épreuve : rien au journal.
 * Licensed under GPL-3.0
 */
import type { ParsedInput } from '../../../shared/api/contract';
import type { CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';

/**
 * Événements d'un combat relevés par l'arène (#2175) : cartons, touches, sorties remplacés
 * d'un bloc, chrono s'il est fourni, dans une transaction. Rien au journal.
 */
export function recordMatchEvents(
  ctx: CommandContext,
  input: ParsedInput<'recordMatchEvents'>
): { found: boolean } {
  getCompetitionOrThrow(ctx, input.competitionId);
  const { matchId } = input;
  if (!ctx.db.getMatch(matchId)) return { found: false };
  ctx.db.transaction(() => {
    ctx.db.clearArenaEvents(matchId);
    for (const c of input.cards) ctx.db.saveCard({ ...c, matchId });
    for (const t of input.touches) ctx.db.saveTouch({ ...t, matchId });
    for (const x of input.exits) ctx.db.saveArenaExit({ ...x, matchId });
    if (input.timing) {
      const { startTime, endTime, duration } = input.timing;
      ctx.db.updateMatchTiming(matchId, startTime, endTime, duration);
    }
  });
  return { found: true };
}

export function replaceSimulatedMatchEvents(
  ctx: CommandContext,
  input: ParsedInput<'replaceSimulatedMatchEvents'>
): { found: boolean } {
  getCompetitionOrThrow(ctx, input.competitionId);
  const { matchId, events } = input;
  const found = ctx.db.replaceSimulatedMatchEvents(
    matchId,
    events && {
      timing: events.timing,
      touches: events.touches.map(t => ({ ...t, matchId })),
      cards: events.cards.map(c => ({ ...c, matchId })),
    }
  );
  return { found };
}
