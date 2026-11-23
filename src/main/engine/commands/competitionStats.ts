/**
 * BPM - Escrime - Chiffres d'une épreuve (#1981 lot 2) : requête getCompetitionStats
 * Calcul repris de l'ancien analyticsService de l'écran (lecture des poules en base).
 * Licensed under GPL-3.0
 */
import { MatchStatus } from '../../../shared/types';
import { calculateFencerPoolStats } from '../../../shared/utils/poolCalculations';
import type { CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { fencerDTO } from './fencers';

/** Nombre de tireurs retenus dans le palmarès */
const TOP = 10;

export function competitionStats(ctx: CommandContext, input: { competitionId: string }) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const fencers = ctx.db.getFencersByCompetition(comp.id);
  const matches = ctx.db
    .getPhasesByCompetition(comp.id)
    .flatMap(phase => ctx.db.getPoolsByPhase(phase.id))
    .flatMap(pool => ctx.db.getMatchesByPool(pool.id));
  const completed = matches.filter(m => m.status === MatchStatus.FINISHED);
  const totalDuration = completed.reduce((sum, m) => sum + (m.duration ?? 0), 0);
  const topFencers = fencers
    .map(fencer => {
      const s = calculateFencerPoolStats(fencer, matches);
      return {
        fencer: fencerDTO(fencer),
        victories: s.victories,
        touchesScored: s.touchesScored,
        touchesReceived: s.touchesReceived,
      };
    })
    .filter(f => f.victories > 0 || f.touchesScored > 0)
    .sort((a, b) => b.victories - a.victories || b.touchesScored - a.touchesScored)
    .slice(0, TOP);
  return {
    totalFencers: fencers.length,
    totalMatches: matches.length,
    completedMatches: completed.length,
    averageMatchDuration: completed.length > 0 ? totalDuration / completed.length : 0,
    topFencers,
  };
}
