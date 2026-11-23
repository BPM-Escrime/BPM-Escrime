/**
 * BPM - Escrime - Classement de saison (#1981, docs/adr/0018)
 * includeInSeason, excludeFromSeason, resetSeason ; requête getSeasonRanking. Le moteur calcule
 * lui-même le classement Quest de l'épreuve versée (poules du tour courant), au lieu de le
 * recevoir de l'écran. Pas de journal.
 * Licensed under GPL-3.0
 */
import { calculateOverallRankingQuest } from '../../../shared/utils/poolCalculations';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { readSession } from './sessionView';
import { sessionPools } from './sport';

/** Verse (ou reverse) une épreuve au classement de saison : remplace ses lignes précédentes */
export function includeInSeason(
  ctx: CommandContext,
  input: { competitionId: string; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const pools = sessionPools(readSession(ctx, comp.id));
  if (pools.length === 0) {
    throw new CommandError('no_pools', 'Aucune poule disponible pour cette épreuve');
  }
  const ranking = calculateOverallRankingQuest(pools);
  if (!input.dryRun) {
    ctx.db.addCompetitionToSeason({
      competitionId: comp.id,
      competitionTitle: comp.title,
      competitionDate: new Date(comp.date ?? Date.now()).toISOString(),
      entries: ranking.map((r, i) => ({
        fencerId: r.fencer.id,
        fencerLastName: r.fencer.lastName,
        fencerFirstName: r.fencer.firstName ?? '',
        fencerClub: r.fencer.club ?? undefined,
        victories: r.victories,
        matchesPlayed: r.matchesPlayed,
        questPoints: r.questPoints ?? 0,
        questV4: r.questVictories4 ?? 0,
        questV3: r.questVictories3 ?? 0,
        questV2: r.questVictories2 ?? 0,
        questV1: r.questVictories1 ?? 0,
        touchesScored: r.touchesScored,
        touchesReceived: r.touchesReceived,
        redCards: 0,
        compRank: i + 1,
      })),
    });
  }
  return { dryRun: !!input.dryRun, competitionId: comp.id, fencers: ranking.length };
}

/** Retire une épreuve du classement de saison (elle peut avoir été supprimée depuis) */
export function excludeFromSeason(
  ctx: CommandContext,
  input: { competitionId: string; dryRun?: boolean }
) {
  const listed = ctx.db.getSeasonCompetitions().some(c => c.competitionId === input.competitionId);
  if (!listed) {
    throw new CommandError(
      'not_in_season',
      `Épreuve absente de la saison : ${input.competitionId}`
    );
  }
  if (!input.dryRun) ctx.db.removeCompetitionFromSeason(input.competitionId);
  return { dryRun: !!input.dryRun, competitionId: input.competitionId };
}

/** Vide le classement de saison */
export function resetSeason(ctx: CommandContext, input: { dryRun?: boolean }) {
  const competitions = ctx.db.getSeasonCompetitions().length;
  if (!input.dryRun) ctx.db.resetSeason();
  return { dryRun: !!input.dryRun, competitions };
}
