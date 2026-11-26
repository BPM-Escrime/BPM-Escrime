/**
 * BPM - Escrime - Tour en vagues (docs/adr/0043, lot F4a ; ex-vagues des rapières, #1118, #1980)
 * launchPoolWave : vague lancée par le DT (0 = aucune) ; endPoolWaves : vagues arrêtées avant leur
 * terme (passage au classement), ou reprises. État dans la clé de session `waves` du tour
 * courant, journal PoolWaveLaunched / PoolWavesEnded. Un tour est « en vagues » quand son ordre
 * des matchs est « waves » ou « waves_classic » (formule), ou pour une épreuve du mode spécial
 * rapières (jusqu'à F4e).
 * Licensed under GPL-3.0
 */
import { isWavesRound } from '../../../shared/domain/formula/formulaV2';
import { poolWavesOf, waveMatchIds } from '../../../shared/domain/pools/waves';
import { computeOverallRankingAllRoundsFor } from '../../../shared/utils/poolOrchestration';
import type { Competition } from '../../../shared/types';
import { CommandError, type CommandContext } from './context';
import { pushActiveWave } from './wavesRemote';
import { getCompetitionOrThrow } from './competitions';
import { EVENT, recordEvents } from './eventLog';
import { readSession } from './sessionView';
import {
  emitSession,
  isLaser,
  sessionPoolHistory,
  sessionPools,
  sessionRound,
  writeSession,
} from './sport';

/** Vagues de la session : clé `waves`, sinon ancienne clé des rapières (alias, jusqu'à F4e) */
export const wavesOf = (session: Record<string, unknown>) =>
  poolWavesOf(session as Parameters<typeof poolWavesOf>[0]);

/** Épreuve dont le tour courant est en vagues ; sinon refus */
function wavesCompetition(
  ctx: CommandContext,
  competitionId: string,
  session: Record<string, unknown>
): Competition {
  const comp = getCompetitionOrThrow(ctx, competitionId);
  if (!isWavesRound(comp.settings, sessionRound(session))) {
    throw new CommandError('unsupported_format', 'Vagues : tour en vagues seulement');
  }
  return comp;
}

export function launchPoolWave(
  ctx: CommandContext,
  input: { competitionId: string; wave: number; dryRun?: boolean }
) {
  const session = readSession(ctx, input.competitionId);
  const comp = wavesCompetition(ctx, input.competitionId, session);
  const pools = sessionPools(session);
  const matchIds = input.wave > 0 ? [...waveMatchIds(pools, input.wave)] : [];
  if (input.wave > 0 && matchIds.length === 0) {
    throw new CommandError('invalid_wave', `Vague ${input.wave} : aucun match`);
  }
  const report = { dryRun: !!input.dryRun, wave: input.wave, matchIds };
  if (input.dryRun) return report;
  ctx.db.transaction(() => {
    const was = wavesOf(readSession(ctx, comp.id));
    writeSession(ctx, comp.id, { waves: { launched: input.wave, ended: was.ended } });
    recordEvents(ctx, comp.id, [
      { type: EVENT.poolWaveLaunched, payload: { wave: input.wave, matchIds } },
    ]);
  });
  emitSession(ctx, comp.id);
  // Tablettes : vague active poussée par le moteur, sans passer par l'écran (docs/adr/0043)
  pushActiveWave(ctx, comp.id, readSession(ctx, comp.id));
  return report;
}

export function endPoolWaves(
  ctx: CommandContext,
  input: { competitionId: string; ended: boolean; dryRun?: boolean }
) {
  const session = readSession(ctx, input.competitionId);
  const comp = wavesCompetition(ctx, input.competitionId, session);
  const report = { dryRun: !!input.dryRun, ended: input.ended };
  if (input.dryRun) return report;
  ctx.db.transaction(() => {
    const current = readSession(ctx, comp.id);
    writeSession(ctx, comp.id, {
      waves: { launched: wavesOf(current).launched, ended: input.ended },
      // Classement sur les matchs joués, comme à l'écran à l'arrêt des vagues
      ...(input.ended
        ? {
            overallRanking: computeOverallRankingAllRoundsFor(
              sessionPools(current),
              sessionPoolHistory(current),
              isLaser(comp)
            ),
          }
        : {}),
    });
    recordEvents(ctx, comp.id, [{ type: EVENT.poolWavesEnded, payload: { ended: input.ended } }]);
  });
  emitSession(ctx, comp.id);
  // Tablettes : vague active poussée par le moteur, sans passer par l'écran (docs/adr/0043)
  pushActiveWave(ctx, comp.id, readSession(ctx, comp.id));
  return report;
}
