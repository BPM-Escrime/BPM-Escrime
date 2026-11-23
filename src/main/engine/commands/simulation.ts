/**
 * BPM - Escrime - Événements simulés du remplissage automatique (#1981)
 * replaceSimulatedMatchEvents : touches, cartons et durée d'essai d'un match, remplacés d'un
 * bloc (anciennes lignes simulées effacées). Pas un fait de l'épreuve : rien au journal.
 * Licensed under GPL-3.0
 */
import type { ParsedInput } from '../../../shared/api/contract';
import type { CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';

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
