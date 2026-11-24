/**
 * BPM - Escrime - Types internes du serveur distant
 * (extraits de remoteScoreServer.ts, #1065).
 * Licensed under GPL-3.0
 */

import type { ArenaCyranoLink } from '../../shared/types/remote';
import {
  CardReason,
  FencerStatus,
  Weapon,
  type Fencer,
  type Referee,
  type Score,
} from '../../shared/types';

/** Match transmis par le renderer (poules ou tableau) ; champs optionnels selon l'origine. */
export interface SessionMatch {
  id: string;
  status: string;
  poolId?: string;
  pool?: { id: string };
  isTableau?: boolean;
  number?: number;
  fencerA?: Fencer | null;
  fencerB?: Fencer | null;
  scoreA?: SessionScore;
  scoreB?: SessionScore;
  maxScore?: number;
  round?: number;
  position?: number;
  tableId?: string;
  strip?: number;
  /** Arbitre : `{ id, name }` depuis le renderer, `Referee` depuis la base */
  referee?: Referee | { id: string; name: string };
  refereeId?: string;
  /** Mode expert : plusieurs arbitres (lus par refereeResolver) */
  referees?: unknown[];
  poolNumber?: number | null;
  /** Arène affectée par le renderer (tableau) */
  arena?: number;
  updatedAt?: Date | string;
  /** Marqueur `__poolFencers` : ordre des tireurs de la poule, porté par `fencers` */
  __poolFencers?: boolean;
  fencers?: Fencer[];
}

/** Arbitre d'un match de session ramené à la forme `{ id, name }` de l'arène */
export function toArenaReferee(referee: NonNullable<SessionMatch['referee']>): {
  id: string;
  name: string;
} {
  if ('name' in referee) return { id: referee.id, name: referee.name };
  return { id: referee.id, name: [referee.lastName, referee.firstName].filter(Boolean).join(' ') };
}

/** Élément de liste envoyé par le renderer : match (poule ou tableau) ou marqueur `__poolFencers` */
export type RendererMatch = Partial<SessionMatch>;

/** Score d'un tireur conservé en mémoire : objet Score (base) ou simple valeur (tablette) */
export type SessionScore = Score | number | null | undefined;

/** Carton noir distribué depuis une tablette (annulable depuis la sélection des matchs) */
export interface BlackCardRecord {
  fencerId: string;
  matchId: string;
  arenaId: string | null;
  poolId: string | null;
  previousStatus: FencerStatus;
  fencerName: string;
  opponentName: string;
  timestamp: number;
}

// Format arène Sabre Laser équipe : état de saisie temps réel pour une
// rencontre assignée à une arène. Distinct de `Arena`/`ArenaMatch`
// (scoring individuel) — aucun champ ni logique partagée.
export interface TeamArenaBout {
  id: string;
  boutOrder: number;
  fencerAId: string;
  fencerAName: string;
  fencerBId: string;
  fencerBName: string;
  scoreA: number;
  scoreB: number;
  maxScore: number;
  status: string;
  winnerId: string | null;
}

export interface TeamArenaCard {
  id: string;
  teamId: string;
  type: 'white' | 'yellow' | 'red' | 'black';
  createdAt: string;
}

/**
 * Carton individuel d'un tireur pendant un relais (giveRelayCard, docs/adr/0028) : copie de
 * la table relue après chaque commande. Motif nul : carton imposé par l'appareil de piste.
 */
export interface TeamArenaFencerCard {
  id: string;
  boutId: string;
  fencerId: string;
  type: string; // WHITE | YELLOW | RED | BLACK (CardType)
  reason: CardReason | null;
}

export interface TeamArenaState {
  /** Format arène Sabre Laser (assauts indépendants) ou relais FIE (cible progressive) */
  format: 'laser-arena' | 'fie-relay';
  weapon: Weapon;
  /** Relais FIE : palier par relais et cible finale (5 / 45 par défaut) */
  relayRule: { stepSize: number; target: number };
  fencerCards: TeamArenaFencerCard[];
  matchId: string;
  competitionId: string;
  /** Poule (ou tour et position du tableau) et rang de la rencontre : champs de l'appareil de piste */
  coords?: { poolNumber: number; round: number | null; position: number | null; number: number };
  teamAId: string;
  teamAName: string;
  teamBId: string;
  teamBName: string;
  isLaserPoints: boolean; // saisie par zones A/B/C (1/3/5) ou touche simple
  bouts: TeamArenaBout[];
  currentBoutIndex: number; // index dans `bouts`
  liveScoreA: number; // score de l'assaut en cours, pas encore persisté
  liveScoreB: number;
  elapsedAccumulatedSec: number; // temps déjà écoulé (assaut en pause)
  timerStartedAt: number | null; // epoch ms, null = chrono à l'arrêt
  cards: TeamArenaCard[];
  /** Cartons P de la rencontre (aux deux équipes, t.124), copie de la table (docs/adr/0028 C4) */
  passivityCards?: Array<{ id: string; type: 'yellow' | 'red' | 'black' }>;
  /** Équipes de la rencontre retirées ou exclues (TeamWithdrawn du journal, docs/adr/0028) */
  withdrawnTeams?: Array<{ teamId: string; reason: 'exclusion' | 'abandon' }>;
  /**
   * Cartons montrés par l'appareil de piste, par relais (id de l'assaut) — #1829. Affichage
   * (DISP) seulement : chaque nouveau carton est enregistré par giveRelayCard (docs/adr/0028).
   */
  deviceCards?: Record<string, { cardsA: string[]; cardsB: string[] }>;
  /** Appareil de piste relié à l'arène équipe : maître et en ligne → tablette verrouillée */
  cyrano?: ArenaCyranoLink | null;
}
