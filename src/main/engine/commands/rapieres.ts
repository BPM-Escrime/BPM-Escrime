/**
 * BPM - Escrime - Vagues du tournoi des rapières (#1118, #1980, docs/adr/0017)
 * launchRapieresWave : vague lancée par le DT (0 = aucune) ; endRapieresWaves : vagues
 * arrêtées avant leur terme (passage au classement), ou reprises. État des vagues dans
 * l'état de session (clé rapieres), journal RapieresWaveLaunched / RapieresWavesEnded.
 * Licensed under GPL-3.0
 */
import {
  createRapieresSession,
  type RapieresSession,
} from '../../../shared/domain/rapieres/rapieres.types';
import { waveMatchIds } from '../../../shared/domain/rapieres/rapieresCalculations';
import { computeOverallRankingAllRoundsFor } from '../../../shared/utils/poolOrchestration';
import type { Competition } from '../../../shared/types';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { EVENT, recordEvents } from './eventLog';
import { readSession } from './sessionView';
import { emitSession, isLaser, sessionPoolHistory, sessionPools, writeSession } from './sport';

function rapieresCompetition(ctx: CommandContext, competitionId: string): Competition {
  const comp = getCompetitionOrThrow(ctx, competitionId);
  if (comp.settings?.specialMode !== 'rapieres') {
    throw new CommandError('unsupported_format', 'Vagues : tournoi des rapières seulement');
  }
  return comp;
}

/** État des rapières de la session (ancien format : session neuve, composition gardée par l'écran) */
function rapieresState(session: Record<string, unknown>): RapieresSession {
  const r = session.rapieres as Partial<RapieresSession> | undefined;
  return r?.version === 2 ? (r as RapieresSession) : createRapieresSession();
}

export function launchRapieresWave(
  ctx: CommandContext,
  input: { competitionId: string; wave: number; dryRun?: boolean }
) {
  const comp = rapieresCompetition(ctx, input.competitionId);
  const session = readSession(ctx, comp.id);
  const pools = sessionPools(session);
  const matchIds = input.wave > 0 ? [...waveMatchIds(pools, input.wave)] : [];
  if (input.wave > 0 && matchIds.length === 0) {
    throw new CommandError('invalid_wave', `Vague ${input.wave} : aucun match`);
  }
  const report = { dryRun: !!input.dryRun, wave: input.wave, matchIds };
  if (input.dryRun) return report;
  ctx.db.transaction(() => {
    writeSession(ctx, comp.id, {
      rapieres: { ...rapieresState(session), launchedWave: input.wave },
    });
    recordEvents(ctx, comp.id, [
      { type: EVENT.rapieresWaveLaunched, payload: { wave: input.wave, matchIds } },
    ]);
  });
  emitSession(ctx, comp.id);
  return report;
}

export function endRapieresWaves(
  ctx: CommandContext,
  input: { competitionId: string; ended: boolean; dryRun?: boolean }
) {
  const comp = rapieresCompetition(ctx, input.competitionId);
  const session = readSession(ctx, comp.id);
  const report = { dryRun: !!input.dryRun, ended: input.ended };
  if (input.dryRun) return report;
  ctx.db.transaction(() => {
    writeSession(ctx, comp.id, {
      rapieres: { ...rapieresState(session), wavesEnded: input.ended },
      // Classement sur les matchs joués, comme à l'écran à l'arrêt des vagues
      ...(input.ended
        ? {
            overallRanking: computeOverallRankingAllRoundsFor(
              sessionPools(session),
              sessionPoolHistory(session),
              isLaser(comp)
            ),
          }
        : {}),
    });
    recordEvents(ctx, comp.id, [
      { type: EVENT.rapieresWavesEnded, payload: { ended: input.ended } },
    ]);
  });
  emitSession(ctx, comp.id);
  return report;
}

/**
 * Composition des équipes (binômes) : l'équipe est un tireur de l'épreuve, sa composition vit
 * dans l'état (clé rapieres.teams). Données personnelles (noms des deux tireurs) : l'événement
 * ne porte que les identifiants (RGPD), la composition n'est pas rejouable depuis le journal.
 */
export function setRapieresTeams(
  ctx: CommandContext,
  input: {
    competitionId: string;
    teams: Array<{ fencerId: string; info: RapieresSession['teams'][string] }>;
    dryRun?: boolean;
  }
) {
  const comp = rapieresCompetition(ctx, input.competitionId);
  const known = new Set(ctx.db.getFencersByCompetition(comp.id).map(f => f.id));
  for (const t of input.teams) {
    if (!known.has(t.fencerId)) {
      throw new CommandError('fencer_not_found', `Équipe introuvable : ${t.fencerId}`);
    }
  }
  const report = { dryRun: !!input.dryRun, teams: input.teams.length };
  if (input.dryRun) return report;
  ctx.db.transaction(() => {
    const session = readSession(ctx, comp.id);
    const state = rapieresState(session);
    const teams = { ...state.teams };
    for (const t of input.teams) teams[t.fencerId] = t.info;
    writeSession(ctx, comp.id, { rapieres: { ...state, teams } });
    recordEvents(ctx, comp.id, [
      {
        type: EVENT.rapieresTeamsUpdated,
        payload: { fencerIds: input.teams.map(t => t.fencerId) },
      },
    ]);
  });
  emitSession(ctx, comp.id);
  return report;
}
