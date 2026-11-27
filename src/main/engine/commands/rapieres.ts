/**
 * BPM - Escrime - Tournoi des rapières : composition des équipes (#1118, #1980, docs/adr/0017)
 * et alias des anciennes commandes de vagues (launchRapieresWave, endRapieresWaves), qui
 * délèguent à launchPoolWave / endPoolWaves (docs/adr/0043, jusqu'à F4e).
 * Licensed under GPL-3.0
 */
import {
  createRapieresSession,
  type RapieresSession,
} from '../../../shared/domain/rapieres/rapieres.types';
import { rapieresTeamEntry } from '../../../shared/domain/rapieres/rapieresEntry';
import type { Competition } from '../../../shared/types';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { EVENT, recordEvents } from './eventLog';
import { readSession } from './sessionView';
import { launchPoolWave, endPoolWaves } from './poolWaves';
import { emitSession, writeSession } from './sport';

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

/**
 * Anciennes commandes des vagues, gardées comme alias jusqu'à F4e (docs/adr/0043) : mêmes
 * garde-fous (épreuve du mode spécial), puis lancent les vagues du tour (PoolWaveLaunched).
 */
export function launchRapieresWave(
  ctx: CommandContext,
  input: { competitionId: string; wave: number; dryRun?: boolean }
) {
  rapieresCompetition(ctx, input.competitionId);
  return launchPoolWave(ctx, input);
}

export function endRapieresWaves(
  ctx: CommandContext,
  input: { competitionId: string; ended: boolean; dryRun?: boolean }
) {
  rapieresCompetition(ctx, input.competitionId);
  return endPoolWaves(ctx, input);
}

/**
 * Composition des équipes (binômes) : l'équipe est un tireur de l'épreuve. Alias jusqu'à F4e
 * (docs/adr/0043) : la composition est écrite sur le tireur (membres, niveau, HANDI, catégorie
 * et sexe d'équipe, comme les commandes d'inscription) et, tant que le mode spécial existe,
 * dans l'état (clé rapieres.teams, lue en repli). Données personnelles (noms des deux tireurs) :
 * l'événement ne porte que les identifiants (RGPD), la composition n'est pas rejouable depuis le
 * journal.
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
    for (const t of input.teams) {
      teams[t.fencerId] = t.info;
      ctx.db.updateFencer(
        t.fencerId,
        rapieresTeamEntry(t.info, comp.date ? new Date(comp.date) : new Date())
      );
    }
    writeSession(ctx, comp.id, { rapieres: { ...state, teams } });
    recordEvents(ctx, comp.id, [
      {
        type: EVENT.rapieresTeamsUpdated,
        payload: { fencerIds: input.teams.map(t => t.fencerId) },
      },
    ]);
  });
  emitSession(ctx, comp.id);
  ctx.emitChange?.({ scope: 'fencers', competitionIds: [comp.id] });
  return report;
}
