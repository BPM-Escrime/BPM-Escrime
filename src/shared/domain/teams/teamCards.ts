/**
 * BPM - Escrime - Cartons des épreuves par équipes : règles pures (docs/adr/0028, lot D)
 * - `relayCardFor` : carton individuel d'un tireur dans un relais. Le tireur est celui du côté
 *   dans le relais (remplaçant compris) ; le type vient de l'escalade sur **toute la rencontre**
 *   (t.159) à partir du motif, ou est imposé par l'appareil de piste (sans motif ni groupe).
 * - `teamCardFor` : carton d'équipe « E » de l'arène Sabre Laser (désignation tardive).
 * - `newDeviceCards` : cartons montrés par l'appareil et pas encore enregistrés.
 * Ni heure ni hasard : identifiant et heure du carton viennent de l'appelant (ADR-0002).
 * Aucun effet sur le score ici (ADR-0028 § 3) ; les points restent ceux du barème de l'arme.
 * Licensed under GPL-3.0
 */

import type { ApiErrorCode } from '../../api/errors';
import { Card, CardGroup, CardReason, Weapon } from '../../types';
import {
  buildCard,
  getAvailableReasons,
  getWeaponCardConfig,
  type PriorCard,
} from '../penalties/cards';
import { CardType } from '../penalties/penalty.types';
import type { RelaySlot } from './relay';
import type { TeamMatchCardRow } from './team.types';
import { determineTeamCardEscalation } from './teamCardEscalation';

// ─── Carton d'équipe « E » (arène Sabre Laser) ──────────────────────────────

// Escalade E (blanc, puis jaune) : `teamCardEscalation.ts`, module feuille gardé pour l'écran
// (TeamPoolView n'embarque pas les règles du relais, budget du bundle)
export {
  TEAM_CARD_DESIGNATION_DELAY_SEC,
  determineTeamCardEscalation,
  countTeamYellowCards,
  type TeamCardEscalationType,
} from './teamCardEscalation';

/** Motif unique du carton E */
export const TEAM_CARD_REASON = 'late_designation';

export type TeamCardType = TeamMatchCardRow['type'];

export type CardRefusal<C extends ApiErrorCode> = { ok: false; code: C };

export interface TeamCardInput {
  /** Identifiant du carton, tiré par l'appelant */
  id: string;
  /** Heure du carton, lue par l'appelant */
  at: Date;
  match: { matchId: string; teamAId: string; teamBId: string };
  teamId: string;
  /** Type choisi par l'arbitre ; absent : escalade (blanc, puis jaune) */
  type?: TeamCardType;
  /** Cartons E de la rencontre (toutes équipes) */
  matchCards: readonly TeamMatchCardRow[];
}

/**
 * Carton E (convention du logiciel, Livret 2 XII « A venir ») d'une équipe de la rencontre :
 * type choisi, sinon escalade sur ses cartons E de la rencontre. Le noir est toujours accepté
 * (ADR-0028, question 4 : `blackCardEnabled` n'est qu'un réglage d'affichage de la tablette).
 */
export function teamCardFor(
  input: TeamCardInput
): { ok: true; card: TeamMatchCardRow } | CardRefusal<'team_not_in_match'> {
  const { id, at, match, teamId, type, matchCards } = input;
  if (teamId !== match.teamAId && teamId !== match.teamBId) {
    return { ok: false, code: 'team_not_in_match' };
  }
  const own = matchCards.filter(c => c.matchId === match.matchId && c.teamId === teamId);
  return {
    ok: true,
    card: {
      id,
      matchId: match.matchId,
      teamId,
      type: type ?? determineTeamCardEscalation(own),
      reason: TEAM_CARD_REASON,
      createdAt: at.toISOString(),
    },
  };
}

// ─── Carton individuel dans un relais ───────────────────────────────────────

/** Relais de la rencontre, vu par le carton ; `started` : relais commencé (score ou chrono) */
export interface RelayCardSlot extends RelaySlot {
  started?: boolean;
}

export interface RelayCardMeeting {
  matchId: string;
  /** Rencontre terminée ou décidée (tous relais tirés, noir P, exclusion…) */
  finished: boolean;
  relays: readonly RelayCardSlot[];
  /**
   * Rencontre suivante d'une des deux équipes déjà commencée (fourni par l'appelant) : le
   * dernier relais d'une rencontre terminée ne reçoit plus de carton
   */
  nextMatchStarted?: boolean;
}

/** Carton déjà enregistré dans la rencontre, tous tireurs et relais confondus */
export type MeetingCard = PriorCard & { fencerId: string };

/**
 * Carton individuel d'un relais : `Card` rattaché au relais. Motif et groupe nuls pour un
 * carton imposé par l'appareil de piste (« groupe à compléter », ADR-0028 question 6).
 */
export interface RelayCard extends Omit<Card, 'reason' | 'group'> {
  relayId: string;
  reason: CardReason | null;
  group: CardGroup | null;
}

/** Exactement un des deux : motif (écran, tablette, MCP) ou type (appareil de piste) */
export type RelayCardGiven = { reason: CardReason } | { type: CardType };

export interface RelayCardInput {
  /** Identifiant du carton, tiré par l'appelant */
  id: string;
  /** Heure du carton, lue par l'appelant */
  at: Date;
  meeting: RelayCardMeeting;
  relayId: string;
  side: 'A' | 'B';
  given: RelayCardGiven;
  /** Cartons individuels déjà enregistrés dans la rencontre (tous tireurs) */
  meetingCards: readonly MeetingCard[];
  weapon: Weapon;
}

export type RelayCardRefusal = CardRefusal<
  'relay_not_found' | 'match_finished' | 'relay_out_of_order' | 'invalid_input'
>;

/**
 * Relais qui peut recevoir un carton (ADR-0028 § 5) : le relais en cours (premier non terminé),
 * ou le dernier relais terminé tant que le suivant n'a pas commencé (carton signalé juste
 * après le END de l'appareil). Rencontre tirée jusqu'au bout : son dernier relais reçoit
 * encore un carton tant que la rencontre suivante de l'équipe n'a pas commencé (décision du
 * mainteneur, #2213 point 1).
 */
export function relayAcceptsCard(
  relays: readonly RelayCardSlot[],
  relayId: string,
  nextMatchStarted = false
): 'ok' | 'relay_not_found' | 'match_finished' | 'relay_out_of_order' {
  const target = relays.find(r => r.relayId === relayId);
  if (!target) return 'relay_not_found';
  const sorted = [...relays].sort((a, b) => a.order - b.order);
  const current = sorted.find(r => !r.finished);
  if (!current) {
    const last = sorted[sorted.length - 1];
    return last.relayId === target.relayId && !nextMatchStarted ? 'ok' : 'match_finished';
  }
  if (target.relayId === current.relayId) return 'ok';
  const lastFinished = sorted.filter(r => r.finished && r.order < current.order).pop();
  if (lastFinished?.relayId === target.relayId && !current.started) return 'ok';
  return 'relay_out_of_order';
}

/** Types qu'un appareil peut imposer : pas de blanc en escrime olympique (t.162) */
function typeAllowed(type: CardType, weapon: Weapon): boolean {
  if (!Object.values(CardType).includes(type)) return false;
  return type !== CardType.WHITE || getWeaponCardConfig(weapon).escalation !== 'fie';
}

/**
 * Carton d'un tireur dans un relais. Refus : relais inconnu (`relay_not_found`), rencontre
 * décidée avant son dernier relais, ou terminée et rencontre suivante commencée
 * (`match_finished`), relais ni en cours ni juste terminé (`relay_out_of_order`), motif
 * hors du règlement de l'arme ou type impossible (`invalid_input`).
 */
export function relayCardFor(
  input: RelayCardInput
): { ok: true; card: RelayCard } | RelayCardRefusal {
  const { id, at, meeting, relayId, side, given, meetingCards, weapon } = input;
  // Rencontre décidée avant son dernier relais (exclusion, abandon) : plus de carton
  if (meeting.finished && meeting.relays.some(r => !r.finished)) {
    return { ok: false, code: 'match_finished' };
  }
  const accepts = relayAcceptsCard(meeting.relays, relayId, meeting.nextMatchStarted);
  if (accepts !== 'ok') return { ok: false, code: accepts };
  const relay = meeting.relays.find(r => r.relayId === relayId)!;
  const fencerId = side === 'A' ? relay.fencerAId : relay.fencerBId;
  const base = { id, matchId: meeting.matchId, fencerId, relayId, timestamp: at };

  if ('reason' in given) {
    if (!getAvailableReasons(weapon).includes(given.reason)) {
      return { ok: false, code: 'invalid_input' };
    }
    const card = buildCard({
      id,
      at,
      matchId: meeting.matchId,
      fencerId,
      reason: given.reason,
      // t.159 : les sanctions valent pour la rencontre, tous relais confondus
      previousCards: meetingCards.filter(c => c.fencerId === fencerId),
      weapon,
    });
    return { ok: true, card: { ...card, relayId } };
  }

  if (!typeAllowed(given.type, weapon)) return { ok: false, code: 'invalid_input' };
  const impact = getWeaponCardConfig(weapon).scoreImpact;
  const key = given.type.toLowerCase() as keyof typeof impact;
  return {
    ok: true,
    card: {
      ...base,
      type: given.type,
      reason: null,
      group: null,
      pointsAwarded: impact[key],
      resultingExclusion: given.type === CardType.BLACK,
    },
  };
}

/**
 * Touches de pénalisation reçues par chaque équipe dans un relais : un carton rouge donne une
 * touche à l'adversaire (t.162.2). Elles autorisent le dépassement du palier (t.41.1).
 */
export function relayPenaltyTouches(
  relay: { fencerAId: string; fencerBId: string },
  cards: ReadonlyArray<{ fencerId: string; type: string }>
): { A: number; B: number } {
  const reds = (fencerId: string) =>
    cards.filter(c => c.fencerId === fencerId && c.type === CardType.RED).length;
  return { A: reds(relay.fencerBId), B: reds(relay.fencerAId) };
}

// ─── Cartons de l'appareil de piste ─────────────────────────────────────────

/** Cartons montrés par l'appareil (Cyrano 1.1 : jaune 0-1, rouge 0-9, cartons P) */
export type DeviceCardKind = 'yellow' | 'red' | 'p-yellow' | 'p-red' | 'p-black';
export type DeviceCardCounts = Partial<Record<DeviceCardKind, number>>;

const DEVICE_CARD_ORDER: readonly DeviceCardKind[] = [
  'yellow',
  'red',
  'p-yellow',
  'p-red',
  'p-black',
];

/** Compteurs d'une liste au format des arènes (`yellow`, `red`, `p-red`, `p-black`) */
export function deviceCardCounts(list: readonly string[]): DeviceCardCounts {
  const counts: DeviceCardCounts = {};
  for (const kind of DEVICE_CARD_ORDER) {
    const n = list.filter(c => c === kind).length;
    if (n > 0) counts[kind] = n;
  }
  return counts;
}

/** Compteurs des cartons individuels enregistrés (jaune, rouge) d'un tireur */
export function recordedCardCounts(cards: readonly Pick<PriorCard, 'type'>[]): DeviceCardCounts {
  return deviceCardCounts(cards.map(c => c.type.toLowerCase()));
}

/**
 * Cartons montrés par l'appareil et pas encore enregistrés, dans l'ordre d'attribution. Même
 * fusion que `fencerMeetingCards` (#1829) : par type, le plus grand des deux comptes fait foi,
 * donc seul l'excédent de l'appareil est nouveau (un carton déjà saisi à la tablette, repris
 * par l'appareil, n'est pas compté deux fois).
 */
export function newDeviceCards(
  recorded: DeviceCardCounts,
  shown: DeviceCardCounts
): DeviceCardKind[] {
  return DEVICE_CARD_ORDER.flatMap(kind =>
    Array<DeviceCardKind>(Math.max(0, (shown[kind] ?? 0) - (recorded[kind] ?? 0))).fill(kind)
  );
}
