/**
 * BPM - Escrime - Épreuves par équipes par le moteur (docs/adr/0024, lot E1)
 * Inscription des équipes et composition (registerTeam, unregisterTeam, assignTeamFencer,
 * unassignTeamFencer) : sans journal, comme l'inscription des tireurs (docs/adr/0018).
 * generateTeamPools : poules d'équipes et rencontres avec leurs relais, identifiants
 * déterministes, journal TeamPoolsGenerated puis un TeamMatchScheduled par rencontre.
 * Les tables teams, team_fencers, team_matches, team_bouts sont la projection des équipes,
 * écrite ici dans la transaction de la commande (runCommand) ; getCompetitionState la rend
 * dans son bloc « teams ».
 * Licensed under GPL-3.0
 */
import type { z } from 'zod';
import type { Competition } from '../../../shared/types';
import type { teamOperations, TeamsStateDTO } from '../../../shared/api/contractTeams';
import type { TeamMatchRow, TeamRow } from '../../../shared/domain/teams/team.types';
import type { TeamStateView } from '../../../shared/domain/journal/compareWithState';
import {
  isTeamPoolsRefusal,
  planTeamPools,
  relayMaxScore,
  teamFormatOf,
  teamSizeOf,
} from '../../../shared/domain/teams/relay';
import { calculateTeamPoolRanking } from '../../../shared/domain/teams/teamCalculations';
import { calculateLaserArenaPoolRanking } from '../../../shared/domain/teams/laserArenaCalculations';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { EVENT, recordEvents } from './eventLog';

type Ops = typeof teamOperations;
export type TeamsHandler<N extends keyof Ops> = (
  ctx: CommandContext,
  input: z.output<Ops[N]['input']>
) => z.output<Ops[N]['output']>;

/** Épreuve par équipes, sinon refus */
function teamCompetitionOrThrow(ctx: CommandContext, competitionId: string): Competition {
  const comp = getCompetitionOrThrow(ctx, competitionId);
  if (!comp.isTeamEvent) {
    throw new CommandError(
      'unsupported_format',
      'Épreuve individuelle : les commandes d’équipe ne s’appliquent pas'
    );
  }
  return comp;
}

function teamOrThrow(ctx: CommandContext, competitionId: string, teamId: string) {
  const team = ctx.db.teams.getTeam(teamId);
  if (!team || team.competitionId !== competitionId) {
    throw new CommandError('team_not_found', `Équipe introuvable : ${teamId}`);
  }
  return team;
}

/** Composition figée après le tirage : seul le remplacement la change (docs/adr/0024) */
function assertBeforeDraw(ctx: CommandContext, competitionId: string): void {
  if (ctx.db.teams.countTeamMatches(competitionId) > 0) {
    throw new CommandError(
      'draw_done',
      'Rencontres d’équipes déjà créées : composition figée (remplacement seulement)'
    );
  }
}

/** L'écran relit l'état de l'épreuve, dont le bloc « teams » */
const changed = (ctx: CommandContext, competitionId: string) =>
  ctx.emitChange?.({ scope: 'session', competitionIds: [competitionId] });

// ─── Inscription (sans journal, docs/adr/0018) ──────────────────────────────

export function registerTeam(
  ctx: CommandContext,
  input: { competitionId: string; name: string; club?: string; dryRun?: boolean }
) {
  teamCompetitionOrThrow(ctx, input.competitionId);
  const name = input.name.trim();
  const club = input.club?.trim() || name;
  if (input.dryRun) return { dryRun: true, team: null };
  const { id } = ctx.db.teams.createTeam(input.competitionId, name, club);
  changed(ctx, input.competitionId);
  return { dryRun: false, team: { id, name, club } };
}

export function unregisterTeam(
  ctx: CommandContext,
  input: { competitionId: string; teamId: string; dryRun?: boolean }
) {
  teamCompetitionOrThrow(ctx, input.competitionId);
  teamOrThrow(ctx, input.competitionId, input.teamId);
  assertBeforeDraw(ctx, input.competitionId);
  if (!input.dryRun) {
    ctx.db.teams.deleteTeam(input.teamId);
    changed(ctx, input.competitionId);
  }
  return { dryRun: !!input.dryRun, teamId: input.teamId };
}

export function assignTeamFencer(
  ctx: CommandContext,
  input: {
    competitionId: string;
    teamId: string;
    fencerId: string;
    teamOrder: number;
    isReserve?: boolean;
    dryRun?: boolean;
  }
) {
  const { competitionId, teamId, fencerId } = input;
  teamCompetitionOrThrow(ctx, competitionId);
  teamOrThrow(ctx, competitionId, teamId);
  assertBeforeDraw(ctx, competitionId);
  if (!ctx.db.getFencersByCompetition(competitionId).some(f => f.id === fencerId)) {
    throw new CommandError('fencer_not_found', `Tireur absent de l’épreuve : ${fencerId}`);
  }
  const other = ctx.db.teams.teamOfFencer(competitionId, fencerId);
  if (other && other !== teamId) {
    throw new CommandError(
      'invalid_composition',
      `Tireur déjà dans une autre équipe (${other}) : le retirer d’abord`
    );
  }
  if (!input.dryRun) {
    ctx.db.teams.upsertTeamFencer(teamId, fencerId, input.teamOrder, !!input.isReserve);
    changed(ctx, competitionId);
  }
  return { dryRun: !!input.dryRun, teamId, fencerId };
}

export function unassignTeamFencer(
  ctx: CommandContext,
  input: { competitionId: string; teamId: string; fencerId: string; dryRun?: boolean }
) {
  const { competitionId, teamId, fencerId } = input;
  teamCompetitionOrThrow(ctx, competitionId);
  teamOrThrow(ctx, competitionId, teamId);
  assertBeforeDraw(ctx, competitionId);
  if (ctx.db.teams.teamOfFencer(competitionId, fencerId) !== teamId) {
    throw new CommandError('fencer_not_found', `Tireur absent de l’équipe : ${fencerId}`);
  }
  if (!input.dryRun) {
    ctx.db.teams.removeTeamFencer(teamId, fencerId);
    changed(ctx, competitionId);
  }
  return { dryRun: !!input.dryRun, teamId, fencerId };
}

// ─── Tirage des poules d'équipes (journalisé) ───────────────────────────────

export function generateTeamPools(
  ctx: CommandContext,
  input: { competitionId: string; replace?: boolean; dryRun?: boolean },
  /** Heure injectée : created_at des rencontres, qui fixe leur rang dans la poule */
  now: Date = new Date()
) {
  const comp = teamCompetitionOrThrow(ctx, input.competitionId);
  const teams = ctx.db.teams.getTeamsByCompetition(comp.id) as TeamRow[];
  const plan = planTeamPools(comp.id, teams, comp.weapon, comp.settings);
  if (isTeamPoolsRefusal(plan)) {
    if (plan.code === 'team_incomplete') {
      throw new CommandError(
        'team_incomplete',
        `Titulaires manquants (${teamSizeOf(comp.settings)} par équipe) : ${plan.teamIds.join(', ')}`
      );
    }
    throw new CommandError(
      'invalid_composition',
      plan.code === 'arena_team_count'
        ? `Arène Sabre Laser : calendrier figé pour 8 ou 12 équipes (${plan.count} inscrites)`
        : `Au moins 2 équipes (${plan.count} inscrite(s))`
    );
  }
  if (ctx.db.teams.countTeamMatches(comp.id) > ctx.db.teams.countTeamMatches(comp.id, true)) {
    throw new CommandError('bracket_exists', 'Tableau d’équipes déjà créé');
  }
  if (ctx.db.teams.countTeamMatches(comp.id, true) > 0) {
    if (!input.replace) {
      throw new CommandError(
        'draw_done',
        'Poules d’équipes déjà tirées (« replace » pour refaire)'
      );
    }
    if (ctx.db.teams.countPlayedPoolRelays(comp.id) > 0) {
      throw new CommandError('pools_have_scores', 'Relais de poule déjà joués');
    }
  }
  const relayCount = plan.matches.reduce((n, m) => n + m.relays.length, 0);
  const out = {
    pools: plan.pools,
    matchIds: plan.matches.map(m => m.matchId),
    relayCount,
  };
  if (input.dryRun) return { dryRun: true, ...out };

  ctx.db.teams.deleteTeamPoolMatches(comp.id);
  const maxScore = relayMaxScore(comp.weapon, comp.settings);
  plan.matches.forEach((m, k) => {
    // Une milliseconde par rencontre : ordre stable de la poule (getTeamMatchDetail)
    const createdAt = new Date(now.getTime() + k).toISOString();
    ctx.db.teams.insertTeamPoolMatch({
      id: m.matchId,
      competitionId: comp.id,
      poolNumber: m.pool,
      round: m.round,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      createdAt,
    });
    for (const r of m.relays) {
      ctx.db.teams.insertTeamBout({
        id: r.relayId,
        matchId: m.matchId,
        order: r.order,
        fencerAId: r.fencerAId,
        fencerBId: r.fencerBId,
        maxScore,
        createdAt,
      });
    }
  });
  recordEvents(ctx, comp.id, [
    { type: EVENT.teamPoolsGenerated, payload: { pools: plan.pools } },
    ...plan.matches.map(m => ({
      type: EVENT.teamMatchScheduled,
      payload: {
        matchId: m.matchId,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        pool: m.pool,
        round: m.round,
        position: null,
        relays: m.relays,
      },
    })),
  ]);
  changed(ctx, comp.id);
  return { dryRun: false, ...out };
}

// ─── Lecture : bloc « teams » et vue de comparaison ─────────────────────────

function matchDTO(m: TeamMatchRow & { position?: number | null }, pool: boolean) {
  return {
    id: m.id,
    poolNumber: pool ? (m.poolNumber ?? 1) : null,
    round: m.round ?? null,
    position: pool ? null : (m.position ?? null),
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    scoreBoutsA: m.scoreBoutsA,
    scoreBoutsB: m.scoreBoutsB,
    status: m.status,
    winnerId: m.winnerId,
    currentBoutIndex: m.currentBoutIndex,
    bouts: m.bouts.map(b => ({ ...b })),
  };
}

/** Relais gagnés et perdus par équipe, rencontres terminées */
function relayWins(matches: TeamMatchRow[]): Map<string, { won: number; lost: number }> {
  const out = new Map<string, { won: number; lost: number }>();
  const of = (id: string) => out.get(id) ?? out.set(id, { won: 0, lost: 0 }).get(id)!;
  for (const m of matches) {
    if (m.status !== 'finished') continue;
    for (const b of m.bouts) {
      if (b.status !== 'finished' || !b.winnerId) continue;
      if (b.winnerId !== b.fencerAId && b.winnerId !== b.fencerBId) continue;
      const [w, l] = b.winnerId === b.fencerAId ? [m.teamAId, m.teamBId] : [m.teamBId, m.teamAId];
      of(w).won++;
      of(l).lost++;
    }
  }
  return out;
}

/**
 * Bloc « teams » de getCompetitionState (docs/adr/0024) : équipes et composition, rencontres
 * de poule et de tableau avec leurs relais, classement de poule. null : épreuve individuelle.
 */
export function teamsState(ctx: CommandContext, comp: Competition): TeamsStateDTO | null {
  if (!comp.isTeamEvent) return null;
  const teams = ctx.db.teams.getTeamsByCompetition(comp.id) as TeamRow[];
  const pools = ctx.db.teams.getTeamMatchesByCompetition(comp.id) as TeamMatchRow[];
  const tableau = ctx.db.teams.getTeamTableauMatches(comp.id, comp.id) as TeamMatchRow[];
  const format = teamFormatOf(comp.settings);
  const wins = relayWins(pools);
  const ranking =
    format === 'laser-arena'
      ? calculateLaserArenaPoolRanking(teams, pools)
      : calculateTeamPoolRanking(teams, pools).map(r => ({ ...r, draws: 0, tied: false }));
  return {
    format,
    teamSize: teamSizeOf(comp.settings),
    teams: teams.map(t => ({ ...t, fencers: t.fencers.map(f => ({ ...f })) })),
    poolMatches: pools.map(m => matchDTO(m, true)),
    tableauMatches: tableau.map(m => matchDTO(m, false)),
    poolRanking: ranking.map((r, i) => ({
      teamId: r.team.id,
      rank: i + 1,
      victories: r.victories,
      defeats: r.defeats,
      draws: r.draws,
      relaysWon: wins.get(r.team.id)?.won ?? 0,
      relaysLost: wins.get(r.team.id)?.lost ?? 0,
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      tied: r.tied,
    })),
  };
}

/** Rencontres et relais des tables, comparés au journal rejoué (compareWithState) */
export function teamStateView(ctx: CommandContext, comp: Competition): TeamStateView {
  const state = teamsState(ctx, comp);
  const all = [...(state?.poolMatches ?? []), ...(state?.tableauMatches ?? [])];
  return {
    matches: all.map(m => ({
      id: m.id,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      pool: m.poolNumber,
      round: m.round,
      position: m.position,
      relays: m.bouts.map(b => ({
        id: b.id,
        order: b.boutOrder,
        fencerAId: b.fencerAId,
        fencerBId: b.fencerBId,
      })),
    })),
  };
}

// ─── Branchement au contrat ─────────────────────────────────────────────────

export const teamHandlers: { [N in keyof Ops]: TeamsHandler<N> } = {
  registerTeam: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    registerTeam(ctx, input),
  unregisterTeam: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    unregisterTeam(ctx, input),
  assignTeamFencer: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    assignTeamFencer(ctx, input),
  unassignTeamFencer: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    unassignTeamFencer(ctx, input),
  generateTeamPools: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    generateTeamPools(ctx, input),
};
