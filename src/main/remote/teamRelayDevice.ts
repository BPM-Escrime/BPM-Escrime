/**
 * BPM - Escrime - Relais FIE par équipes piloté par un appareil de piste (#1829)
 * Opérations de l'arène équipe (`/equipe{N}`, relais FIE en direct #1086) utilisées par le
 * PisteHub. L'appareil donne le score cumulé de l'équipe ; l'arène tient le score du relais
 * en cours (`liveScoreA/B`) : relais = cumul reçu − relais précédents terminés. Fin de relais,
 * rappel et remplaçant passent par les commandes du moteur (docs/adr/0024, lot E4).
 * Licensed under GPL-3.0
 */

import {
  FIE_RELAY_DURATION_SEC,
  relayCapFor,
  relayCumul,
} from '../../shared/domain/teams/teamRelayLive';
import { logger, LogCategory } from '../../shared/services/logger';
import {
  advanceTeamBout,
  broadcastTeamArena,
  checkTeamBout,
  reloadTeamArenaMatch,
  type TeamArenaContext,
  type TeamTieWinner,
} from './teamArena';
import { runTeamCommand, type TeamCommandOutcome, type TeamSource } from './teamCommand';
import type { TeamArenaBout, TeamArenaState } from './types';
import type { ArenaCyranoLink } from '../../shared/types/remote';

/** Relais en cours d'une arène équipe, vu par l'appareil. */
export interface TeamRelayView {
  state: TeamArenaState;
  /** Relais en cours ; null quand la rencontre est terminée */
  bout: TeamArenaBout | null;
  /** Relais précédent terminé (rappel PREV, END répété) */
  previous: TeamArenaBout | null;
  cumulA: number;
  cumulB: number;
  /** Dernier relais de la rencontre */
  isLast: boolean;
}

/** Relais FIE en direct sur l'arène équipe ; null hors relais FIE (format arène laser). */
export function teamRelayView(ctx: TeamArenaContext, arenaId: string): TeamRelayView | null {
  const state = ctx.teamArenaState.get(arenaId);
  if (!state || state.format !== 'fie-relay') return null;
  const bout = state.bouts[state.currentBoutIndex] ?? null;
  const { cumulA, cumulB } = relayCumul(state.bouts, bout, state.liveScoreA, state.liveScoreB);
  const finished = state.bouts.filter(
    b => b.status === 'finished' && (!bout || b.boutOrder < bout.boutOrder)
  );
  const maxOrder = Math.max(0, ...state.bouts.map(b => b.boutOrder));
  return {
    state,
    bout,
    previous: finished[finished.length - 1] ?? null,
    cumulA,
    cumulB,
    isLast: !!bout && bout.boutOrder === maxOrder,
  };
}

const CARD_ORDER = ['yellow', 'red', 'p-red', 'p-black'] as const;

/**
 * Cartons d'un tireur sur toute la rencontre (#1829) : ils se cumulent d'un relais à l'autre.
 * Appareil : cartons montrés au dernier relais tiré par ce tireur (l'appareil les reprend du
 * DISP et y ajoute les nouveaux) ; tablette : cartons individuels enregistrés. Par type, le
 * plus grand des deux comptes (un carton repris par l'appareil n'est pas compté deux fois).
 */
export function fencerMeetingCards(
  state: TeamArenaState,
  side: 'A' | 'B',
  fencerId: string
): string[] {
  const key = side === 'A' ? 'fencerAId' : 'fencerBId';
  const relays = state.bouts
    .filter(b => b[key] === fencerId && state.deviceCards?.[b.id])
    .sort((a, b) => b.boutOrder - a.boutOrder);
  const device = relays.length ? state.deviceCards![relays[0].id] : null;
  const fromDevice = (side === 'A' ? device?.cardsA : device?.cardsB) ?? [];
  const fromTablet = state.fencerCards.filter(c => c.fencerId === fencerId).map(c => c.type);
  const count = (list: readonly string[], type: string) => list.filter(c => c === type).length;
  return CARD_ORDER.flatMap(type =>
    Array<string>(Math.max(count(fromDevice, type), count(fromTablet, type))).fill(type)
  );
}

export interface RelayDeviceUpdate {
  /** Score cumulé de l'équipe A / B */
  cumulA: number;
  cumulB: number;
  /** Cartons montrés par l'appareil (relais en cours) */
  cardsA?: string[];
  cardsB?: string[];
  /** Chrono de l'appareil (secondes restantes) et état */
  stopwatch?: number;
  running?: boolean;
}

/**
 * État de l'appareil → relais en cours : score du relais, cartons, chrono. Refus (tracé) si le
 * cumul reçu est inférieur à celui des relais déjà terminés.
 */
export function applyRelayDeviceState(
  ctx: TeamArenaContext,
  arenaId: string,
  update: RelayDeviceUpdate
): { accepted: boolean; changed: boolean } {
  const view = teamRelayView(ctx, arenaId);
  if (!view?.bout) return { accepted: false, changed: false };
  const { state, bout } = view;
  const liveA = update.cumulA - (view.cumulA - state.liveScoreA);
  const liveB = update.cumulB - (view.cumulB - state.liveScoreB);
  if (liveA < 0 || liveB < 0) {
    logger.warn(
      LogCategory.NETWORK,
      `Équipes ${arenaId} : cumul de l'appareil ${update.cumulA}-${update.cumulB} inférieur aux ` +
        `relais terminés (${view.cumulA - state.liveScoreA}-${view.cumulB - state.liveScoreB}), ignoré`
    );
    return { accepted: false, changed: false };
  }
  // Mêmes bornes que la tablette : palier du relais (n × 5), plafonné à l'objectif (45)
  const cap = relayCapFor(bout.boutOrder, state.relayRule);
  if (update.cumulA > cap || update.cumulB > cap) {
    logger.warn(
      LogCategory.NETWORK,
      `Équipes ${arenaId} : cumul de l'appareil ${update.cumulA}-${update.cumulB} au-delà du ` +
        `palier du relais ${bout.boutOrder} (${cap}), ignoré`
    );
    return { accepted: false, changed: false };
  }
  let changed = liveA !== state.liveScoreA || liveB !== state.liveScoreB;
  state.liveScoreA = liveA;
  state.liveScoreB = liveB;
  if (update.cardsA && update.cardsB) {
    const cards = (state.deviceCards ??= {});
    const before = JSON.stringify(cards[bout.id] ?? null);
    cards[bout.id] = { cardsA: [...update.cardsA], cardsB: [...update.cardsB] };
    changed ||= before !== JSON.stringify(cards[bout.id]);
  }
  if (update.stopwatch !== undefined && update.stopwatch <= FIE_RELAY_DURATION_SEC) {
    // Chrono du relais : temps écoulé = durée réglementaire − temps restant de l'appareil
    const elapsed = FIE_RELAY_DURATION_SEC - update.stopwatch;
    const running = !!update.running;
    changed ||=
      running !== (state.timerStartedAt !== null) || elapsed !== state.elapsedAccumulatedSec;
    state.elapsedAccumulatedSec = elapsed;
    state.timerStartedAt = running ? Date.now() : null;
  }
  if (changed) broadcastTeamArena(ctx, arenaId);
  return { accepted: true, changed };
}

/** Appareil relié à l'arène équipe (mode, liaison) : verrou de la tablette ; diffusé s'il change. */
export function setTeamArenaDeviceLink(
  ctx: TeamArenaContext,
  arenaId: string,
  link: ArenaCyranoLink | null
): void {
  const state = ctx.teamArenaState.get(arenaId);
  if (!state || JSON.stringify(state.cyrano ?? null) === JSON.stringify(link)) return;
  state.cyrano = link;
  broadcastTeamArena(ctx, arenaId);
}

/**
 * Fin du relais en cours contrôlée par le moteur sans rien écrire (recordRelayScore en
 * simulation) : refus → NAK de l'appareil, avant tout ACK.
 */
export function checkRelayFinish(
  ctx: TeamArenaContext,
  arenaId: string,
  source: TeamSource,
  winner?: TeamTieWinner
): TeamCommandOutcome<'recordRelayScore'> {
  return checkTeamBout(ctx, arenaId, source, winner);
}

/**
 * Fin du relais en cours (END acquitté) : relais enregistré par recordRelayScore, passage au
 * suivant. `broadcast: false` : diffusion laissée à l'appelant (remplaçant à insérer d'abord).
 */
export function finishRelay(
  ctx: TeamArenaContext,
  arenaId: string,
  source: TeamSource,
  options: { broadcast?: boolean; winner?: TeamTieWinner } = {}
): TeamCommandOutcome<'recordRelayScore'> {
  return advanceTeamBout(ctx, arenaId, source, options);
}

/**
 * PREV : rappel du relais précédent pour correction, seulement si le relais en cours n'a pas
 * commencé (score nul, chrono à zéro et arrêté) ou si la rencontre est terminée. Le moteur
 * rouvre le dernier relais terminé (reopenRelay, score conservé) ; l'arène reprend ce score
 * comme score en direct, et un nouvel END le réenregistre. Refus du moteur (rencontre
 * suivante du tableau commencée…) : rien ne change.
 */
export function reopenPreviousRelay(
  ctx: TeamArenaContext,
  arenaId: string,
  source: TeamSource
): boolean {
  const view = teamRelayView(ctx, arenaId);
  if (!view?.previous) return false;
  const { state } = view;
  if (
    view.bout &&
    (state.liveScoreA !== 0 ||
      state.liveScoreB !== 0 ||
      state.elapsedAccumulatedSec !== 0 ||
      state.timerStartedAt !== null)
  )
    return false;
  const outcome = runTeamCommand(
    ctx.db,
    'reopenRelay',
    { competitionId: state.competitionId, matchId: state.matchId },
    source
  );
  if (!outcome.ok) return false;
  reloadTeamArenaMatch(ctx, state);
  const reopened = state.bouts.find(b => b.id === outcome.out.relayId);
  state.currentBoutIndex = reopened ? state.bouts.indexOf(reopened) : state.currentBoutIndex;
  state.liveScoreA = outcome.out.scoreA;
  state.liveScoreB = outcome.out.scoreB;
  state.elapsedAccumulatedSec = 0;
  state.timerStartedAt = null;
  broadcastTeamArena(ctx, arenaId);
  return true;
}

/**
 * Remplaçant (o.99.5 / o.99.6) par substituteTeamFencer : le remplaçant de l'équipe du côté
 * `side` prend la place du tireur `outFencerId` dans les relais non terminés. Appelé après
 * l'enregistrement du relais où la demande est faite (le relais tiré garde son tireur).
 * Refus du moteur (codes du catalogue) : pas de remplaçant (`no_reserve`), remplaçant déjà
 * entré (`reserve_used`), plus de relais pour ce tireur (`no_later_relay`)…
 */
export function substituteRelayFencer(
  ctx: TeamArenaContext,
  arenaId: string,
  side: 'A' | 'B',
  outFencerId: string,
  source: TeamSource,
  { broadcast = true }: { broadcast?: boolean } = {}
): { ok: true; reserveId: string; relays: number[] } | { ok: false; reason: string } {
  const state = ctx.teamArenaState.get(arenaId);
  if (!state) return { ok: false, reason: 'match_not_found' };
  const outcome = runTeamCommand(
    ctx.db,
    'substituteTeamFencer',
    {
      competitionId: state.competitionId,
      matchId: state.matchId,
      teamId: side === 'A' ? state.teamAId : state.teamBId,
      outFencerId,
    },
    source
  );
  if (!outcome.ok) return { ok: false, reason: outcome.code };
  reloadTeamArenaMatch(ctx, state);
  const ids = new Set(outcome.out.relayIds);
  const relays = state.bouts.filter(b => ids.has(b.id)).map(b => b.boutOrder);
  if (broadcast) broadcastTeamArena(ctx, arenaId);
  return { ok: true, reserveId: outcome.out.inFencerId, relays };
}
