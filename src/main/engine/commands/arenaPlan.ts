/**
 * BPM - Escrime - Plan de salle du planificateur d'arène enregistré sur l'épreuve (docs/adr/0025)
 * Donnée de mise en page sans règle : ni journal, ni effet sur le classement.
 * Licensed under GPL-3.0
 */
import type { ArenaPlan } from '../../../shared/api/arenaPlanSchema';
import type { CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';

export function saveArenaPlan(
  ctx: CommandContext,
  input: { competitionId: string; plan: ArenaPlan | null; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  if (!input.dryRun) ctx.db.saveArenaPlan(comp.id, input.plan);
  return { dryRun: !!input.dryRun, competitionId: comp.id };
}

export function getArenaPlan(ctx: CommandContext, competitionId: string): ArenaPlan | null {
  getCompetitionOrThrow(ctx, competitionId);
  return (ctx.db.getArenaPlan(competitionId) as ArenaPlan | null) ?? null;
}
