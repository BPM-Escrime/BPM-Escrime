/**
 * BPM - Escrime - Cartons des épreuves par équipes par le moteur (docs/adr/0028, lot C1)
 * giveTeamCard (carton E, arène Sabre Laser), giveRelayCard (carton individuel d'un relais),
 * givePassivityCard (carton P, relais FIE, lot C4), cancelTeamCard / cancelRelayCard (Directoire
 * technique : écran, MCP), withdrawTeam (o.99.7.a).
 * Écritures de team_match_cards et team_bout_cards dans la transaction de la commande
 * (runCommand), identifiant et heure fournis ; journal TeamCardGiven, RelayCardGiven,
 * PassivityCardGiven, TeamCardCancelled, RelayCardCancelled, TeamWithdrawn. Aucun effet sur le
 * score (§ 3) ; le noir P décide la rencontre (TeamMatchDecided, t.124).
 * Noir individuel : tireur retiré (ADR-0016) ; armes olympiques, rencontre perdue et équipe
 * exclue (o.99.7.b) dans la même transaction. Règles : shared/domain/teams/teamCards.
 * Licensed under GPL-3.0
 */
import type { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Card, CardReason, Competition } from '../../../shared/types';
import type { teamCardOperations } from '../../../shared/api/contractTeamCards';
import type {
  TeamMatchCardRow,
  TeamMatchRow,
  TeamRow,
} from '../../../shared/domain/teams/team.types';
import { teamFormatOf } from '../../../shared/domain/teams/relay';
import { hasPassivityCards, passivityCardFor } from '../../../shared/domain/teams/passivityCards';
import { rankTeamsForTableau } from '../../../shared/domain/teams/teamTableau';
import { relayCardFor, teamCardFor } from '../../../shared/domain/teams/teamCards';
import {
  nextTeamMatchStarted,
  withoutWithdrawnTeams,
} from '../../../shared/domain/teams/teamWithdrawal';
import { getWeaponCardConfig } from '../../../shared/domain/penalties/cards';
import { CardType } from '../../../shared/domain/penalties/penalty.types';
import { planWithdrawal } from '../../../shared/domain/fencers/withdrawal';
import type { NewJournalEvent } from '../../../database/repos/eventLogRepo';
import { CommandError, type CommandContext } from './context';
import { EVENT, recordEvents } from './eventLog';
import { changed, relayCardDTO, teamCompetitionOrThrow, withdrawnTeams } from './teams';
import { decideTeamMatch, matchOrThrow, type MatchRow } from './teamRelays';
import { applyWithdrawal } from './withdrawal';

type Ops = typeof teamCardOperations;
type Handler<N extends keyof Ops> = (
  ctx: CommandContext,
  input: z.output<Ops[N]['input']>
) => z.output<Ops[N]['output']>;

/** Identifiant et heure injectés (ADR-0002) ; défaut : tirés ici */
export interface Given {
  now?: Date;
  newId?: () => string;
}

/** Rencontres de l'épreuve dans leur ordre : poules (calendrier), puis tableau par tour */
function orderedMatches(ctx: CommandContext, comp: Competition) {
  const pools = ctx.db.teams.getTeamMatchesByCompetition(comp.id) as TeamMatchRow[];
  const tableau = (ctx.db.teams.getTeamTableauMatches(comp.id, comp.id) as TeamMatchRow[])
    .slice()
    .sort((a, b) => (b.round ?? 0) - (a.round ?? 0));
  return [...pools, ...tableau];
}

function assertTeamActive(ctx: CommandContext, comp: Competition, teamId: string) {
  if (withdrawnTeams(ctx, comp.id).has(teamId)) {
    throw new CommandError('team_withdrawn', `Équipe retirée ou exclue : ${teamId}`);
  }
}

const sideOf = (m: MatchRow, teamId: string): 'A' | 'B' | null =>
  teamId === m.teamAId ? 'A' : teamId === m.teamBId ? 'B' : null;

/** Annulation : décision du Directoire technique, pas de la tablette ni de l'appareil (§ 1) */
function assertDirectorate(ctx: CommandContext) {
  const source = ctx.actor?.source;
  if (source === 'tablet' || source === 'cyrano' || source === 'opp2') {
    throw new CommandError(
      'permission_denied',
      'Annulation d’un carton : Directoire technique seulement (écran, MCP)'
    );
  }
}

type Refusal =
  | 'team_not_in_match'
  | 'relay_not_found'
  | 'match_finished'
  | 'relay_out_of_order'
  | 'invalid_input';

const REFUSAL: Record<Refusal, string> = {
  team_not_in_match: 'Équipe étrangère à cette rencontre',
  relay_not_found: 'Relais inconnu dans cette rencontre',
  match_finished: 'Rencontre terminée (rencontre suivante commencée, ou décidée) : carton refusé',
  relay_out_of_order: 'Relais ni en cours ni juste terminé : carton refusé',
  invalid_input: 'Motif hors du règlement de l’arme, ou type impossible',
};

function refuse(code: Refusal): never {
  throw new CommandError(code, REFUSAL[code]);
}

// ─── Carton E (arène Sabre Laser) ───────────────────────────────────────────

export function giveTeamCard(
  ctx: CommandContext,
  input: {
    competitionId: string;
    matchId: string;
    teamId: string;
    type?: 'white' | 'yellow' | 'red' | 'black';
    dryRun?: boolean;
  },
  { now = new Date(), newId = uuidv4 }: Given = {}
) {
  const comp = teamCompetitionOrThrow(ctx, input.competitionId);
  if (teamFormatOf(comp.settings) !== 'laser-arena') {
    throw new CommandError('unsupported_format', 'Carton E : arène Sabre Laser seulement');
  }
  const m = matchOrThrow(ctx, comp.id, input.matchId);
  if (!sideOf(m, input.teamId)) refuse('team_not_in_match');
  assertTeamActive(ctx, comp, input.teamId);
  if (
    m.status === 'finished' &&
    nextTeamMatchStarted(orderedMatches(ctx, comp), m.id, input.teamId)
  ) {
    refuse('match_finished');
  }
  const r = teamCardFor({
    id: newId(),
    at: now,
    match: { matchId: m.id, teamAId: m.teamAId, teamBId: m.teamBId },
    teamId: input.teamId,
    type: input.type,
    matchCards: ctx.db.teams.getTeamMatchCards(m.id) as TeamMatchCardRow[],
  });
  if (!r.ok) refuse(r.code);
  const { card } = r;
  const out = {
    matchId: m.id,
    card: { id: card.id, teamId: card.teamId, type: card.type, at: card.createdAt },
  };
  if (input.dryRun) return { dryRun: true, ...out };

  ctx.db.teams.createTeamMatchCard(m.id, card.teamId, card.type, card.reason, {
    id: card.id,
    at: card.createdAt,
  });
  recordEvents(ctx, comp.id, [
    {
      type: EVENT.teamCardGiven,
      payload: { matchId: m.id, teamId: card.teamId, cardId: card.id, type: card.type },
    },
  ]);
  changed(ctx, comp.id);
  return { dryRun: false, ...out };
}

// ─── Carton individuel d'un relais ──────────────────────────────────────────

/** Noir individuel (§ 4) : tireur retiré ; armes olympiques, rencontre perdue et équipe exclue */
function blackCardEffects(
  ctx: CommandContext,
  comp: Competition,
  m: MatchRow,
  side: 'A' | 'B',
  fencerId: string,
  now: Date,
  dryRun: boolean
): { events: NewJournalEvent[]; withdrawnTeamId: string | null } {
  const fencer = ctx.db.getFencersByCompetition(comp.id).find(f => f.id === fencerId);
  if (!fencer) throw new CommandError('fencer_not_found', `Tireur introuvable : ${fencerId}`);
  // Épreuve par équipes : aucun relais touché par le retrait (ADR-0024 § 3)
  const plan = planWithdrawal(
    { pools: [], tableau: [], consolation: [], isLaserSabre: false },
    { fencerId, currentStatus: fencer.status, reason: 'exclusion', blackCard: true, now }
  );
  if (!plan.ok) {
    throw new CommandError(
      plan.code === 'already_withdrawn' ? 'already_withdrawn' : 'internal',
      'Tireur déjà retiré : carton noir sans effet possible'
    );
  }
  // Sabre Laser : aucune règle d'équipe (Livret 2 XII « A venir ») ; tireur seul (VIII.7)
  const olympic = getWeaponCardConfig(comp.weapon).escalation === 'fie';
  const teamId = side === 'A' ? m.teamAId : m.teamBId;
  const winnerTeamId = side === 'A' ? m.teamBId : m.teamAId;
  if (dryRun) return { events: [], withdrawnTeamId: olympic ? teamId : null };

  const { events } = applyWithdrawal(
    ctx,
    comp,
    {},
    fencer,
    plan,
    { reason: 'exclusion', blackCard: true, matchId: m.id },
    { group: null, atRoot: true }
  );
  if (!olympic) return { events, withdrawnTeamId: null };
  // o.99.7.b : rencontre perdue, équipe exclue sans classement final ; pas de remplacement
  const decided = m.status === 'finished' ? null : decideTeamMatch(ctx, comp, m, winnerTeamId, now);
  return {
    events: [
      ...events,
      ...(decided?.events ?? []),
      { type: EVENT.teamWithdrawn, payload: { teamId, matchId: m.id, reason: 'exclusion' } },
    ],
    withdrawnTeamId: teamId,
  };
}

export function giveRelayCard(
  ctx: CommandContext,
  input: {
    competitionId: string;
    matchId: string;
    relayId: string;
    side: 'A' | 'B';
    reason?: CardReason;
    type?: 'WHITE' | 'YELLOW' | 'RED' | 'BLACK';
    dryRun?: boolean;
  },
  { now = new Date(), newId = uuidv4 }: Given = {}
) {
  if ((input.reason === undefined) === (input.type === undefined)) {
    throw new CommandError(
      'invalid_input',
      'Exactement un de « reason » (motif) ou « type » (appareil de piste)'
    );
  }
  const comp = teamCompetitionOrThrow(ctx, input.competitionId);
  const m = matchOrThrow(ctx, comp.id, input.matchId);
  if (!m.bouts.some(b => b.id === input.relayId)) refuse('relay_not_found');
  const teamId = input.side === 'A' ? m.teamAId : m.teamBId;
  assertTeamActive(ctx, comp, teamId);
  const prior = ctx.db.teams.getTeamBoutCards(m.id).map(c => c.card);
  const r = relayCardFor({
    id: newId(),
    at: now,
    meeting: {
      matchId: m.id,
      finished: m.status === 'finished',
      relays: m.bouts.map(b => ({
        relayId: b.id,
        order: b.boutOrder,
        fencerAId: b.fencerAId,
        fencerBId: b.fencerBId,
        finished: b.status === 'finished',
        started: b.status !== 'not_started' || b.scoreA > 0 || b.scoreB > 0,
      })),
      nextMatchStarted: nextTeamMatchStarted(orderedMatches(ctx, comp), m.id, teamId),
    },
    relayId: input.relayId,
    side: input.side,
    given: input.reason !== undefined ? { reason: input.reason } : { type: input.type as CardType },
    meetingCards: prior.map(c => ({ fencerId: c.fencerId, type: c.type, group: c.group })),
    weapon: comp.weapon,
  });
  if (!r.ok) refuse(r.code);
  const { card } = r;
  const black = card.type === CardType.BLACK;
  // Effets du noir vérifiés avant toute écriture (tireur déjà retiré : refus)
  const preview = black
    ? blackCardEffects(ctx, comp, m, input.side, card.fencerId, now, true)
    : { withdrawnTeamId: null };
  const out = {
    matchId: m.id,
    relayId: input.relayId,
    card: relayCardDTO(card as unknown as Card),
    fencerWithdrawn: black,
    withdrawnTeamId: preview.withdrawnTeamId,
  };
  if (input.dryRun) return { dryRun: true, ...out };

  ctx.db.teams.createTeamBoutCard(input.relayId, card as unknown as Card);
  const effects = black
    ? blackCardEffects(ctx, comp, m, input.side, card.fencerId, now, false).events
    : [];
  recordEvents(ctx, comp.id, [
    {
      type: EVENT.relayCardGiven,
      payload: {
        matchId: m.id,
        relayId: input.relayId,
        fencerId: card.fencerId,
        cardId: card.id,
        type: card.type as 'WHITE' | 'YELLOW' | 'RED' | 'BLACK',
        reason: card.reason,
      },
    },
    ...effects,
  ]);
  if (black) ctx.emitChange?.({ scope: 'fencers', competitionIds: [comp.id] });
  changed(ctx, comp.id);
  return { dryRun: false, ...out };
}

// ─── Carton P (non-combativité, t.124) ──────────────────────────────────────

/**
 * Classement des deux équipes pour le noir P à égalité de score (t.124.2.c) : celui qui place
 * les équipes au tableau, calculé sur les poules (équipes retirées exclues, o.99.8). Au
 * tableau, c'est le rang du tableau en cours (FFE dès M15) ; en poule, le logiciel n'a pas de
 * classement initial d'équipe (inscription par nom) : classement de poule du moment.
 */
function passivityRanks(ctx: CommandContext, comp: Competition, m: MatchRow) {
  const pools = ctx.db.teams.getTeamMatchesByCompetition(comp.id) as TeamMatchRow[];
  const { teams, matches } = withoutWithdrawnTeams(
    ctx.db.teams.getTeamsByCompetition(comp.id) as TeamRow[],
    pools,
    new Set(withdrawnTeams(ctx, comp.id).keys())
  );
  const ranked = rankTeamsForTableau(teams, matches, teamFormatOf(comp.settings));
  const rank = (id: string) => {
    const i = ranked.findIndex(t => t.id === id);
    return i < 0 ? null : i + 1;
  };
  return { rankA: rank(m.teamAId), rankB: rank(m.teamBId) };
}

const PASSIVITY_REFUSAL = {
  unsupported_format: 'Carton P : relais FIE des armes olympiques seulement',
  match_finished:
    'Rencontre terminée (noir P déjà donné, rencontre décidée ou suivante commencée, ou noir P contraire au résultat) : carton P refusé',
  draw_needs_winner: 'Noir P à égalité de score et de classement : à trancher par le DT',
} as const;

export function givePassivityCard(
  ctx: CommandContext,
  input: { competitionId: string; matchId: string; dryRun?: boolean },
  { now = new Date(), newId = uuidv4 }: Given = {}
) {
  const comp = teamCompetitionOrThrow(ctx, input.competitionId);
  // Sabre Laser (relais ou arène) et arme à la carte : pas de carton P (ADR-0028, 2 règlements)
  if (teamFormatOf(comp.settings) !== 'fie-relay' || !hasPassivityCards(comp.weapon)) {
    refuseP('unsupported_format');
  }
  const m = matchOrThrow(ctx, comp.id, input.matchId);
  assertTeamActive(ctx, comp, m.teamAId);
  assertTeamActive(ctx, comp, m.teamBId);
  const ordered = orderedMatches(ctx, comp);
  const r = passivityCardFor({
    id: newId(),
    at: now,
    meeting: {
      matchId: m.id,
      relays: m.bouts.map(b => ({
        order: b.boutOrder,
        scoreA: b.scoreA,
        scoreB: b.scoreB,
        finished: b.status === 'finished',
      })),
      finished: m.status === 'finished',
      winner: m.winnerId === m.teamAId ? 'A' : m.winnerId === m.teamBId ? 'B' : null,
      nextMatchStarted:
        nextTeamMatchStarted(ordered, m.id, m.teamAId) ||
        nextTeamMatchStarted(ordered, m.id, m.teamBId),
      ...passivityRanks(ctx, comp, m),
    },
    prior: ctx.db.teams.getPassivityCards(m.id),
    weapon: comp.weapon,
  });
  if (!r.ok) refuseP(r.code);
  const { card } = r;
  const winnerTeamId = r.winner ? (r.winner.side === 'A' ? m.teamAId : m.teamBId) : null;
  const decide = !!r.winner?.decide && winnerTeamId !== null;
  const preview = decide
    ? decideTeamMatch(ctx, comp, m, winnerTeamId, now, true)
    : { scheduledMatchIds: [] as string[] };
  const out = {
    matchId: m.id,
    card: { id: card.id, type: card.type, at: card.createdAt },
    winnerTeamId,
    scheduledMatchIds: preview.scheduledMatchIds,
  };
  if (input.dryRun) return { dryRun: true, ...out };

  ctx.db.teams.createPassivityCard(m.id, card.type, { id: card.id, at: card.createdAt });
  // Noir P : rencontre décidée (t.124), même commande donc même commandId
  const decided = decide ? decideTeamMatch(ctx, comp, m, winnerTeamId, now) : null;
  recordEvents(ctx, comp.id, [
    {
      type: EVENT.passivityCardGiven,
      payload: { matchId: m.id, cardId: card.id, type: card.type },
    },
    ...(decided?.events ?? []),
  ]);
  changed(ctx, comp.id);
  return { dryRun: false, ...out };
}

function refuseP(code: keyof typeof PASSIVITY_REFUSAL): never {
  throw new CommandError(code, PASSIVITY_REFUSAL[code]);
}

// ─── Annulation (Directoire technique) ──────────────────────────────────────

export function cancelTeamCard(
  ctx: CommandContext,
  input: { competitionId: string; matchId: string; cardId: string; dryRun?: boolean }
) {
  assertDirectorate(ctx);
  const comp = teamCompetitionOrThrow(ctx, input.competitionId);
  const m = matchOrThrow(ctx, comp.id, input.matchId);
  const passivity = ctx.db.teams.getPassivityCards(m.id).find(c => c.id === input.cardId);
  if (!passivity && !ctx.db.teams.getTeamMatchCards(m.id).some(c => c.id === input.cardId)) {
    throw new CommandError(
      'card_not_found',
      `Carton E ou P inconnu dans la rencontre : ${input.cardId}`
    );
  }
  // Le noir P a décidé la rencontre : il ne s'annule pas seul
  if (passivity?.type === 'black') {
    throw new CommandError(
      'match_finished',
      'Noir P : la rencontre est décidée ; le résultat se corrige d’abord (Directoire technique)'
    );
  }
  const out = { matchId: m.id, cardId: input.cardId };
  if (input.dryRun) return { dryRun: true, ...out };
  ctx.db.teams.deleteTeamMatchCard(input.cardId);
  recordEvents(ctx, comp.id, [{ type: EVENT.teamCardCancelled, payload: out }]);
  changed(ctx, comp.id);
  return { dryRun: false, ...out };
}

export function cancelRelayCard(
  ctx: CommandContext,
  input: { competitionId: string; matchId: string; cardId: string; dryRun?: boolean }
) {
  assertDirectorate(ctx);
  const comp = teamCompetitionOrThrow(ctx, input.competitionId);
  const m = matchOrThrow(ctx, comp.id, input.matchId);
  const found = ctx.db.teams.getTeamBoutCards(m.id).find(c => c.card.id === input.cardId);
  if (!found) {
    throw new CommandError('card_not_found', `Carton inconnu dans la rencontre : ${input.cardId}`);
  }
  // § 4 : le noir individuel s'annule par la réintégration du tireur, le carton reste au dossier
  if (found.card.type === CardType.BLACK) {
    throw new CommandError(
      'already_withdrawn',
      'Carton noir : le tireur est retiré ; annuler par la réintégration (reinstateFencer)'
    );
  }
  const out = { matchId: m.id, relayId: found.boutId, cardId: input.cardId };
  if (input.dryRun) return { dryRun: true, ...out };
  ctx.db.teams.deleteTeamBoutCard(input.cardId);
  recordEvents(ctx, comp.id, [{ type: EVENT.relayCardCancelled, payload: out }]);
  changed(ctx, comp.id);
  return { dryRun: false, ...out };
}

// ─── Retrait d'une équipe (o.99.7.a) ────────────────────────────────────────

export function withdrawTeam(
  ctx: CommandContext,
  input: {
    competitionId: string;
    matchId: string;
    teamId: string;
    reason: 'abandon';
    dryRun?: boolean;
  },
  { now = new Date() }: Given = {}
) {
  const comp = teamCompetitionOrThrow(ctx, input.competitionId);
  if (teamFormatOf(comp.settings) !== 'fie-relay') {
    throw new CommandError('unsupported_format', 'Retrait d’équipe : relais par équipes seulement');
  }
  const m = matchOrThrow(ctx, comp.id, input.matchId);
  const side = sideOf(m, input.teamId);
  if (!side) refuse('team_not_in_match');
  assertTeamActive(ctx, comp, input.teamId);
  if (m.status === 'finished') {
    throw new CommandError('match_finished', 'Rencontre terminée : retrait refusé');
  }
  const winnerTeamId = side === 'A' ? m.teamBId : m.teamAId;
  const preview = decideTeamMatch(ctx, comp, m, winnerTeamId, now, true);
  const out = {
    matchId: m.id,
    teamId: input.teamId,
    winnerTeamId,
    scheduledMatchIds: preview.scheduledMatchIds,
  };
  if (input.dryRun) return { dryRun: true, ...out };

  const decided = decideTeamMatch(ctx, comp, m, winnerTeamId, now);
  recordEvents(ctx, comp.id, [
    ...decided.events,
    {
      type: EVENT.teamWithdrawn,
      payload: { teamId: input.teamId, matchId: m.id, reason: input.reason },
    },
  ]);
  changed(ctx, comp.id);
  return { dryRun: false, ...out };
}

// ─── Branchement au contrat ─────────────────────────────────────────────────

export const teamCardHandlers: { [N in keyof Ops]: Handler<N> } = {
  giveTeamCard: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    giveTeamCard(ctx, input),
  giveRelayCard: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    giveRelayCard(ctx, input),
  givePassivityCard: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    givePassivityCard(ctx, input),
  cancelTeamCard: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    cancelTeamCard(ctx, input),
  cancelRelayCard: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    cancelRelayCard(ctx, input),
  withdrawTeam: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    withdrawTeam(ctx, input),
};
