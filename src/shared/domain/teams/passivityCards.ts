/**
 * BPM - Escrime - Cartons P (non-combativité) d'une rencontre par équipes : règles pures
 * (docs/adr/0028 § 5 bis, lot C4 ; FIE t.124).
 * - Relais FIE des armes olympiques seulement : le Sabre Laser n'a pas de carton P (Livrets
 *   2026-2027 : l'anti-jeu y est une faute du 1er groupe) ; l'arme à la carte non plus.
 * - Carton donné **aux deux équipes**, valable pour la rencontre (9 relais) : jaune P, puis
 *   rouge P, puis noir P. Le rouge P n'écrit pas de touche (§ 3 : elle est dans le score saisi).
 * - Noir P : la rencontre est gagnée par l'équipe au score supérieur, à égalité par l'équipe au
 *   meilleur classement (t.124.2.c ; FFE dès M15 : classement du tableau en cours). Le
 *   classement vient de l'appelant.
 * Ni heure ni hasard : identifiant et heure du carton viennent de l'appelant (ADR-0002).
 * Licensed under GPL-3.0
 */

import type { ApiErrorCode } from '../../api/errors';
import { Weapon } from '../../types';
import { passivityCardAllowed, passivityWinner } from '../match/matchEndValidation';
import { getWeaponCardConfig } from '../penalties/cards';
import { relayCumulative, teamMatchOutcome, type RelayScore } from './relay';
import { PASSIVITY_STEPS, type PassivityCardType } from './passivityCardTypes';

export {
  PASSIVITY_REASON,
  PASSIVITY_STEPS,
  PASSIVITY_TYPE_PREFIX,
  passivityTypeOf,
  type PassivityCardType,
} from './passivityCardTypes';

/** Arme avec cartons P : escrime olympique (règlement FIE) */
export const hasPassivityCards = (weapon: Weapon): boolean =>
  getWeaponCardConfig(weapon).escalation === 'fie';

export interface PassivityMeeting {
  matchId: string;
  /** Relais de la rencontre (score de chaque relais, terminé ou non) */
  relays: readonly RelayScore[];
  /** Rencontre terminée ou décidée */
  finished: boolean;
  /** Vainqueur enregistré (rencontre terminée) : A, B, ou null (égalité de poule) */
  winner: 'A' | 'B' | null;
  /** Rencontre suivante d'une des deux équipes déjà commencée */
  nextMatchStarted?: boolean;
  /** Classement des deux équipes (1 = meilleur) ; null : inconnu */
  rankA: number | null;
  rankB: number | null;
  /** Cible finale de la rencontre (45 par défaut) : pas de carton P à cible − 1 partout */
  target?: number | null;
  /** Score cumulé affiché, relais en cours compris ; absent : cumul des relais terminés */
  liveScore?: { scoreA: number; scoreB: number } | null;
}

export interface PassivityCardInput {
  /** Identifiant du carton, tiré par l'appelant */
  id: string;
  /** Heure du carton, lue par l'appelant */
  at: Date;
  meeting: PassivityMeeting;
  /** Cartons P déjà donnés dans la rencontre */
  prior: ReadonlyArray<{ type: PassivityCardType }>;
  weapon: Weapon;
}

export interface PassivityCard {
  id: string;
  matchId: string;
  type: PassivityCardType;
  createdAt: string;
}

export type PassivityRefusal = {
  ok: false;
  code: Extract<
    ApiErrorCode,
    'unsupported_format' | 'match_finished' | 'passivity_at_last_touch' | 'draw_needs_winner'
  >;
};

export type PassivityResult =
  | {
      ok: true;
      card: PassivityCard;
      /**
       * Noir P : côté vainqueur ; `decide` : la rencontre est à décider (pas encore terminée,
       * ou terminée à égalité de poule), sinon le résultat enregistré est déjà celui de t.124
       */
      winner: { side: 'A' | 'B'; decide: boolean } | null;
    }
  | PassivityRefusal;

/** Score cumulé de la rencontre : relais terminés, plus le relais en cours tel qu'enregistré */
function meetingScore(relays: readonly RelayScore[]): { scoreA: number; scoreB: number } {
  const done = relayCumulative(relays);
  const live = relays.filter(r => !r.finished);
  return {
    scoreA: done.scoreA + live.reduce((n, r) => n + r.scoreA, 0),
    scoreB: done.scoreB + live.reduce((n, r) => n + r.scoreB, 0),
  };
}

/** Vainqueur du noir P : score cumulé des relais terminés, puis classement (t.124.2.c) */
export function passivityMeetingWinner(meeting: PassivityMeeting): 'A' | 'B' | null {
  const { scoreA, scoreB } = teamMatchOutcome(meeting.relays);
  const out = passivityWinner({
    scoreA,
    scoreB,
    fencerA: { initialRanking: meeting.rankA },
    fencerB: { initialRanking: meeting.rankB },
  });
  return out.action === 'finish' ? out.winner : null;
}

/**
 * Carton P suivant de la rencontre. Refus : arme sans carton P (`unsupported_format`), noir P
 * déjà donné, rencontre décidée avant son dernier relais ou terminée et rencontre suivante
 * commencée, noir P contraire au résultat enregistré (`match_finished`), score à une touche de
 * la cible finale des deux côtés, 44:44 (`passivity_at_last_touch`, t.124.3), égalité de score
 * et de classement (`draw_needs_winner`, à trancher par le Directoire technique).
 */
export function passivityCardFor(input: PassivityCardInput): PassivityResult {
  const { id, at, meeting, prior, weapon } = input;
  if (!hasPassivityCards(weapon)) return { ok: false, code: 'unsupported_format' };
  const step = prior.length;
  if (step >= PASSIVITY_STEPS.length || prior.some(c => c.type === 'black')) {
    return { ok: false, code: 'match_finished' };
  }
  const allRelaysDone = meeting.relays.length > 0 && meeting.relays.every(r => r.finished);
  if (meeting.finished && (!allRelaysDone || meeting.nextMatchStarted)) {
    return { ok: false, code: 'match_finished' };
  }
  const score = meeting.liveScore ?? meetingScore(meeting.relays);
  if (!passivityCardAllowed({ ...score, scoreLimit: meeting.target })) {
    return { ok: false, code: 'passivity_at_last_touch' };
  }
  const type = PASSIVITY_STEPS[step];
  const card = { id, matchId: meeting.matchId, type, createdAt: at.toISOString() };
  if (type !== 'black') return { ok: true, card, winner: null };

  const side = passivityMeetingWinner(meeting);
  if (!side) return { ok: false, code: 'draw_needs_winner' };
  if (!meeting.finished || meeting.winner === null) {
    return { ok: true, card, winner: { side, decide: true } };
  }
  // Rencontre tirée jusqu'au bout : le noir P n'en change pas le résultat
  if (meeting.winner !== side) return { ok: false, code: 'match_finished' };
  return { ok: true, card, winner: { side, decide: false } };
}

/**
 * Cartons P montrés par l'appareil (Cyrano 1.1, champ P-card ; OPP2 `p_card`) → rang dans
 * l'escalade : 1 jaune P, 2 rouge P, 3 noir P. L'appareil donne un niveau, pas un cumul ; un
 * rouge P montré d'emblée vaut donc jaune P puis rouge P dans l'escalade de la rencontre.
 */
export function devicePassivityStep(counts: {
  pYellow?: number;
  pRed?: number;
  pBlack?: number;
}): number {
  if ((counts.pBlack ?? 0) > 0) return 3;
  if ((counts.pRed ?? 0) > 0) return 2;
  if ((counts.pYellow ?? 0) > 0) return 1;
  return 0;
}

/** Cartons P à donner pour rattraper l'appareil, sans dépasser `upTo` (noir P : 3) */
export function newDevicePassivityCards(recorded: number, shownStep: number, upTo = 3): number {
  return Math.max(0, Math.min(shownStep, upTo) - recorded);
}
