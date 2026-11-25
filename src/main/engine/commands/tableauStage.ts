/**
 * BPM - Escrime - Clôture d'un tableau arrêté à N tireurs (#2013 étape D2, docs/adr/0035)
 * Formule enregistrée dont le tableau porte `stopAt` et qu'une phase suit : quand tous les
 * matchs avant l'arrêt sont décidés, les N restants passent à la phase suivante (classement =
 * rang d'entrée), les éliminés sortent (classés par tour atteint puis rang d'entrée, Q5).
 * Écritures dans la transaction de runCommand : tireurs, état de session, TableauStageClosed.
 * Licensed under GPL-3.0
 */
import { FencerStatus } from '../../../shared/types';
import { closeStage } from '../../../shared/domain/tableau/tableauStage';
import type { TableauPhase } from '../../../shared/domain/formula/formulaV2';
import { isTableauEligible } from '../../../shared/domain/fencers/fencerStatus';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { EVENT, recordEvents } from './eventLog';
import { readSession } from './sessionView';
import {
  PHASE,
  emitSession,
  sessionPoolHistory,
  sessionPools,
  sessionTableau,
  writeSession,
} from './sport';

/** Tableau arrêté de la formule enregistrée, suivi d'une autre phase ; sinon refus */
function stoppedTableau(phases: Array<{ kind: string }>): TableauPhase | null {
  const index = phases.findIndex(p => p.kind === 'tableau');
  const tableau = phases[index] as TableauPhase | undefined;
  return tableau?.stopAt && index < phases.length - 1 ? tableau : null;
}

export function closeTableauStage(
  ctx: CommandContext,
  input: { competitionId: string; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const tableau = stoppedTableau(comp.settings?.formula?.phases ?? []);
  if (!tableau?.stopAt) {
    throw new CommandError(
      'invalid_settings',
      'Formule sans tableau arrêté à N tireurs suivi d’une autre phase'
    );
  }
  const stopAt = tableau.stopAt;
  const session = readSession(ctx, comp.id);
  const matches = sessionTableau(session);
  const outcome = closeStage(matches, stopAt);
  if (!outcome) {
    throw new CommandError(
      'tableau_stage_not_complete',
      `Tous les matchs du tableau avant l’arrêt à ${stopAt} tireurs doivent être joués`
    );
  }
  const fencers = ctx.db.getFencersByCompetition(comp.id);
  const byId = new Map(fencers.map(f => [f.id, f]));
  // Retirés (abandon, forfait, exclusion) : statut conservé, seuls les actifs sont éliminés
  const toEliminate = outcome.eliminated.filter(e => {
    const status = byId.get(e.fencer.id)?.status;
    return status !== undefined && isTableauEligible({ status });
  });
  const report = {
    dryRun: !!input.dryRun,
    stopAt,
    qualified: outcome.qualified.length,
    eliminated: toEliminate.length,
  };
  if (input.dryRun) return report;

  // Poules du dernier tour joué : archivées avec les tours précédents (consultation, PDF)
  const pools = sessionPools(session);
  const poolHistory =
    pools.length > 0 ? [...sessionPoolHistory(session), pools] : sessionPoolHistory(session);
  const stageHistory = Array.isArray(session.stageHistory) ? [...session.stageHistory] : [];
  stageHistory.push({
    kind: 'tableau',
    stopAt,
    matches,
    eliminated: outcome.eliminated.map(e => ({
      fencerId: e.fencer.id,
      round: e.round,
      seed: e.seed,
    })),
  });
  ctx.db.transaction(() => {
    for (const e of toEliminate)
      ctx.db.updateFencer(e.fencer.id, { status: FencerStatus.ELIMINATED });
    // Restants : classement = rang d'entrée (ordre d'entrée dans la phase suivante)
    outcome.qualified.forEach((f, i) => {
      if (byId.get(f.id)?.ranking !== i + 1) ctx.db.updateFencer(f.id, { ranking: i + 1 });
    });
    writeSession(ctx, comp.id, {
      currentPhase: PHASE.checkin,
      // Phase suivante : nouveau tour de poules, après ceux déjà joués
      currentPoolRound: poolHistory.length + 1,
      poolHistory,
      stageHistory,
      tableauMatches: [],
      consolationBrackets: [],
      finalResults: [],
      pools: [],
      poolsLaunched: false,
    });
    recordEvents(ctx, comp.id, [
      {
        type: EVENT.tableauStageClosed,
        payload: {
          stopAt,
          qualifiedIds: outcome.qualified.map(f => f.id),
          eliminatedIds: toEliminate.map(e => e.fencer.id),
        },
      },
    ]);
  });
  emitSession(ctx, comp.id);
  return report;
}
