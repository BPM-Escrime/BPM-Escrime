/**
 * BPM - Escrime - Format arène Sabre Laser équipe : saisie temps réel (#1240)
 * Extrait de RemoteScoreServer : l'état reste dans le serveur, exposé par accesseurs (contexte).
 * Licensed under GPL-3.0
 */
import { Weapon } from '../../shared/types';
import { getTeamTargetRule } from '../../shared/domain/teams/teamCalculations';
import {
  getLaserArenaBoutCap,
  isLaserArenaBoutComplete,
} from '../../shared/domain/teams/laserArenaCalculations';
import {
  FIE_RELAY_DURATION_SEC,
  isRelayComplete,
  relayCapFor,
  relayCumul,
} from '../../shared/domain/teams/teamRelayLive';
import { getAvailableReasons } from '../../shared/domain/penalties/cards';
import type { TeamArenaCard, TeamArenaState } from './types';
import type { RemoteScoreServer } from '../remoteScoreServer';
import { runTeamCommand, type TeamCommandOutcome, type TeamSource } from './teamCommand';

type S = RemoteScoreServer;

/** État et services du serveur utilisés par ce module (accesseurs : valeurs toujours à jour). */
export interface TeamArenaContext {
  readonly db: S['db'];
  readonly io: S['io'];
  readonly teamArenaState: S['teamArenaState'];
  /** Appareil de piste relié à l'arène équipe (#1829) */
  readonly cyranoTeamHook: S['cyranoTeamHook'];
}

/** Diffuse l'état d'une arène équipe (tablettes, écrans) et prévient l'appareil de piste. */
export function broadcastTeamArena(ctx: TeamArenaContext, arenaId: string): void {
  ctx.io
    .to(`team-arena:${arenaId}`)
    .emit('team_arena_state', getPublicTeamArenaState(ctx, arenaId));
  ctx.cyranoTeamHook?.(arenaId);
}

/**
 * Rencontre relue dans les tables après une commande du moteur : relais (scores, statuts,
 * tireurs) et relais en cours. Le score en direct, le chrono et les cartons restent ceux de
 * l'arène. false : rencontre introuvable.
 */
export function reloadTeamArenaMatch(ctx: TeamArenaContext, state: TeamArenaState): boolean {
  const detail = ctx.db.getTeamMatchDetail(state.matchId);
  if (!detail) return false;
  state.bouts = detail.bouts;
  state.currentBoutIndex = detail.bouts.findIndex(b => b.status !== 'finished');
  return true;
}

/** Côté prioritaire désigné à égalité au dernier relais (minute supplémentaire, t.41.5) */
export type TeamTieWinner = 'A' | 'B';

/**
 * Relais en cours et score à enregistrer ; null : pas de relais à terminer. `winner` : côté
 * prioritaire, transmis au moteur qui le retient seulement à égalité en fin de rencontre.
 */
function currentRelayInput(state: TeamArenaState, winner?: TeamTieWinner) {
  const bout = state.bouts[state.currentBoutIndex];
  if (!bout || bout.status === 'finished') return null;
  return {
    competitionId: state.competitionId,
    matchId: state.matchId,
    relay: bout.boutOrder,
    scoreA: state.liveScoreA,
    scoreB: state.liveScoreB,
    ...(winner ? { winner } : {}),
  };
}

const NO_RELAY = { ok: false, code: 'match_not_ready', message: 'Aucun relais en cours' } as const;

/**
 * Contrôle de la fin du relais en cours par recordRelayScore, sans rien écrire : l'appareil
 * reçoit NAK si le moteur refuse, avant tout ACK (docs/adr/0024).
 */
export function checkTeamBout(
  ctx: TeamArenaContext,
  arenaId: string,
  source: TeamSource,
  winner?: TeamTieWinner
): TeamCommandOutcome<'recordRelayScore'> {
  const state = ctx.teamArenaState.get(arenaId);
  const input = state && currentRelayInput(state, winner);
  if (!input) return NO_RELAY;
  return runTeamCommand(ctx.db, 'recordRelayScore', input, source, true);
}

/**
 * Termine l'assaut (relais) en cours par recordRelayScore (docs/adr/0024, lot E4) : score du
 * relais enregistré par le moteur (vainqueur du relais, cumul, fin de rencontre et avancement
 * du tableau calculés par lui), puis rencontre relue et passage au relais suivant. Refus :
 * rien d'écrit, l'arène garde le relais et son score en direct.
 * `broadcast: false` : l'appelant diffuse lui-même (remplaçant enregistré entre-temps).
 * `winner` : côté prioritaire à égalité au dernier relais (#2191).
 */
export function advanceTeamBout(
  ctx: TeamArenaContext,
  arenaId: string,
  source: TeamSource = 'tablet',
  { broadcast = true, winner }: { broadcast?: boolean; winner?: TeamTieWinner } = {}
): TeamCommandOutcome<'recordRelayScore'> {
  const state = ctx.teamArenaState.get(arenaId);
  const input = state && currentRelayInput(state, winner);
  if (!state || !input) return NO_RELAY;
  const outcome = runTeamCommand(ctx.db, 'recordRelayScore', input, source);
  if (!outcome.ok) return outcome;
  reloadTeamArenaMatch(ctx, state);
  state.liveScoreA = 0;
  state.liveScoreB = 0;
  state.elapsedAccumulatedSec = 0;
  state.timerStartedAt = null;
  if (broadcast) broadcastTeamArena(ctx, arenaId);
  return outcome;
}

// ── Format arène Sabre Laser équipe : saisie temps réel ──────────────────────
// API publique appelée depuis les IPC handlers (renderer → main → ici), suivant
// le même modèle que les arènes individuelles mais sur un état séparé.

/** Assigne une rencontre d'équipe à une arène pour saisie temps réel. */
export function setTeamArenaMatch(
  ctx: TeamArenaContext,
  arenaId: string,
  matchId: string,
  isLaserPoints: boolean
): boolean {
  const detail = ctx.db.getTeamMatchDetail(matchId);
  if (!detail) return false;
  const competition = ctx.db.getCompetition(detail.competitionId);
  const settings = competition?.settings;
  const weapon = (competition?.weapon ?? Weapon.EPEE) as Weapon;
  const rule = getTeamTargetRule(
    weapon,
    settings?.minTeamSize ?? 3,
    settings?.laserTeamMode ?? 'touches',
    settings?.teamRelayStepSize ?? 5
  );
  const current = detail.bouts.findIndex(b => b.status !== 'finished');
  const reopened = detail.bouts[current]?.status === 'in_progress' ? detail.bouts[current] : null;
  ctx.teamArenaState.set(arenaId, {
    format: settings?.teamFormat === 'laser-arena' ? 'laser-arena' : 'fie-relay',
    weapon,
    relayRule: { stepSize: rule.stepSize, target: rule.target },
    fencerCards: ctx.db.getTeamBoutCards(matchId).map(({ boutId, card }) => ({
      id: card.id,
      boutId,
      fencerId: card.fencerId,
      type: card.type,
      reason: card.reason,
    })),
    matchId: detail.id,
    competitionId: detail.competitionId,
    coords: {
      poolNumber: detail.poolNumber ?? 1,
      round: detail.round ?? null,
      position: detail.position ?? null,
      number: detail.number ?? 1,
    },
    teamAId: detail.teamAId,
    teamAName: detail.teamAName,
    teamBId: detail.teamBId,
    teamBName: detail.teamBName,
    isLaserPoints,
    bouts: detail.bouts,
    currentBoutIndex: current,
    // Relais rouvert (reopenRelay) : son score repris comme score en direct
    liveScoreA: reopened ? reopened.scoreA : 0,
    liveScoreB: reopened ? reopened.scoreB : 0,
    elapsedAccumulatedSec: 0,
    timerStartedAt: null,
    cards: ctx.db.getTeamMatchCards(matchId) as TeamArenaCard[],
  });
  broadcastTeamArena(ctx, arenaId);
  return true;
}

/** Retire l'assignation d'une arène (fin de saisie temps réel pour cette arène). */
export function clearTeamArenaMatch(ctx: TeamArenaContext, arenaId: string): void {
  ctx.teamArenaState.delete(arenaId);
  ctx.io.to(`team-arena:${arenaId}`).emit('team_arena_state', null);
  ctx.cyranoTeamHook?.(arenaId);
}

export function teamArenaElapsedSec(state: TeamArenaState): number {
  const running = state.timerStartedAt ? (Date.now() - state.timerStartedAt) / 1000 : 0;
  return state.elapsedAccumulatedSec + running;
}

export function getPublicTeamArenaState(ctx: TeamArenaContext, arenaId: string): unknown {
  const state = ctx.teamArenaState.get(arenaId);
  if (!state) return null;
  const currentBout = state.bouts[state.currentBoutIndex] ?? null;
  const elapsedSec = teamArenaElapsedSec(state);
  const relay = state.format === 'fie-relay';
  const { cumulA, cumulB } = relayCumul(
    state.bouts,
    currentBout,
    state.liveScoreA,
    state.liveScoreB
  );
  const relayCap = currentBout ? relayCapFor(currentBout.boutOrder, state.relayRule) : 0;
  const cap = relay
    ? { maxTouches: relayCap, maxDurationSec: FIE_RELAY_DURATION_SEC }
    : getLaserArenaBoutCap();
  const boutComplete = !currentBout
    ? false
    : relay
      ? isRelayComplete(cumulA, cumulB, relayCap, elapsedSec)
      : isLaserArenaBoutComplete(state.liveScoreA, state.liveScoreB, elapsedSec, cap);
  // Dernier relais à égalité d'une rencontre de tableau : vainqueur exigé par le moteur,
  // désigné par la priorité tirée avant la minute supplémentaire (t.41.5, #2191)
  const tableau = !!state.coords && state.coords.round !== null && state.coords.position !== null;
  const lastRelay =
    !!currentBout && state.bouts.every(b => b === currentBout || b.status === 'finished');
  const tieNeedsWinner = relay && tableau && lastRelay && cumulA === cumulB;
  return {
    format: state.format,
    cumulA,
    cumulB,
    tieNeedsWinner,
    target: state.relayRule.target,
    fencerCards: state.fencerCards,
    cardReasons: relay ? getAvailableReasons(state.weapon) : [],
    matchId: state.matchId,
    teamAId: state.teamAId,
    teamAName: state.teamAName,
    teamBId: state.teamBId,
    teamBName: state.teamBName,
    isLaserPoints: state.isLaserPoints,
    bouts: state.bouts,
    currentBoutIndex: state.currentBoutIndex,
    currentBout,
    liveScoreA: state.liveScoreA,
    liveScoreB: state.liveScoreB,
    elapsedSec,
    timerRunning: state.timerStartedAt !== null,
    cap,
    boutComplete,
    matchComplete: !currentBout,
    cards: state.cards,
    deviceCards: state.deviceCards ?? {},
    cyrano: state.cyrano ?? null,
    blackCardEnabled:
      ctx.db.getCompetition(state.competitionId)?.settings?.blackCardEnabled === true,
  };
}

/** Champs et méthodes du serveur exposés à ce contexte via liveContext (#1896) */
export const TEAM_ARENA_CONTEXT_KEYS = {
  state: ['cyranoTeamHook', 'db', 'io', 'teamArenaState'],
  methods: [],
} as const;
