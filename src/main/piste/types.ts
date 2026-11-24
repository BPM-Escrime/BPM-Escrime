/**
 * BPM - Escrime - Modèle commun des appareils de piste (#1829)
 * Indépendant du protocole : chaque pilote (Cyrano, OPP2/MQTT (#1960) ; RS422-FPA, Favero
 * série ensuite) convertit ses trames en `PisteInput` et traduit les `PisteCommand` en
 * trames. Le PisteHub ne connaît que ce modèle.
 * Licensed under GPL-3.0
 */

import type { StripEcho, StripPanel } from '../../shared/types/stripDevice';
import type { StripEchoState } from '../../shared/domain/stripDevices/stripControl';

/** État de l'appareil : assaut, halte, pause (minute de repos), attente, fin en attente d'ACK. */
export type PisteFencingState = 'fencing' | 'halt' | 'pause' | 'waiting' | 'ending';

/** Statut d'un tireur sur l'appareil. */
export type PisteFencerStatus = 'normal' | 'victory' | 'defeat' | 'abandon' | 'exclusion';

/** Côté de l'appareil ; `none` = pas de priorité. */
export type PistePriority = 'none' | 'right' | 'left';

/** Type de rencontre : individuelle, ou par équipes (relais). */
export type PisteMatchType = 'individual' | 'team';

/** État d'un côté (droite / gauche) tel que l'appareil l'affiche. */
export interface PisteSideState {
  /** Identifiant du tireur tel que l'appareil le renvoie (éventuellement tronqué) */
  id?: string;
  name?: string;
  nat?: string;
  score?: number;
  status?: PisteFencerStatus;
  yellowCards?: number;
  redCards?: number;
  /** Cartons P (non-combativité) : jaune, rouges, noirs */
  pYellow?: number;
  pRed?: number;
  pBlack?: number;
  light?: boolean;
  whiteLight?: boolean;
  /** Interventions médicales */
  medical?: number;
  /** Demande d'entrée du remplaçant (équipes) */
  reserve?: boolean;
}

/** État normalisé d'un appareil de piste. */
export interface PisteState {
  state?: PisteFencingState;
  /** Chrono en secondes (centièmes possibles sous 10 s) */
  stopwatch?: number;
  priority?: PistePriority;
  type?: PisteMatchType;
  /** Période (individuel) ou n° de relais (équipes) */
  round?: number;
  right?: PisteSideState;
  left?: PisteSideState;
}

/** Origine d'une entrée : pilote et piste. */
export interface PisteSource {
  driver: string;
  piste: string;
}

interface PisteInputBase {
  source: PisteSource;
  /** Numéro de séquence strictement croissant par piste (fourni par le pilote) */
  seq: number;
}

/** Entrée d'un appareil : état complet, ou touche NEXT / PREV. */
export type PisteInput =
  | (PisteInputBase & { kind: 'state'; state: PisteState })
  | (PisteInputBase & { kind: 'next' })
  | (PisteInputBase & { kind: 'prev' });

/** Tireur à afficher (zone droite ou gauche). */
export interface PisteDisplaySide {
  /** Identifiant stable (jamais le nom) */
  id: string;
  lastName: string;
  firstName: string;
  /** Pays, club, ligue ou équipe : le pilote le réduit à sa longueur */
  nat?: string;
  score?: number;
  /** Cartons déjà donnés (match repris, appareil redémarré) */
  yellowCards?: number;
  redCards?: number;
  /** Cartons P déjà donnés : jaune P (0-1), rouges P, noirs P */
  pYellow?: number;
  pRed?: number;
  pBlack?: number;
  /** Statut repris d'un match rappelé qui s'était terminé par un abandon ou une exclusion */
  status?: 'abandon' | 'exclusion';
}

/** Match (ou relais) à afficher sur l'appareil. */
export interface PisteDisplay {
  type: PisteMatchType;
  /** Phase : 1er tour de poules = 1… ; tableau = dernier tour de poules + 1 (omis : relais) */
  phase?: number;
  /** N° de poule ou identifiant de tableau (`A32`) */
  poulTab?: string;
  match?: number;
  /** Période (individuel) ou n° de relais (équipes, 1 à 9) */
  round?: number;
  time?: string;
  /** Chrono à reprendre, en secondes (match rappelé) */
  stopwatch?: number;
  /** Arme BPM - Escrime ('E' | 'F' | 'S' | 'L' | 'C') */
  weapon: string;
  right: PisteDisplaySide;
  left: PisteDisplaySide;
  referee?: { id: string; name: string; nat?: string };
}

/** Tireur d'un créneau : identité seule */
export interface PisteRecordFencer {
  id: string;
  lastName: string;
  firstName: string;
  nat?: string;
}

/** Résultat confirmé d'un match du créneau (droite = A, gauche = B) */
export interface PisteRecordResult {
  right: { score: number; status: 'V' | 'D' | 'A' | 'E' };
  left: { score: number; status: 'V' | 'D' | 'A' | 'E' };
}

/** Match d'un créneau : n° tel qu'envoyé dans l'affichage (`PisteDisplay.match`) */
export interface PisteRecordBout {
  id: number;
  right: PisteRecordFencer;
  left: PisteRecordFencer;
  result: PisteRecordResult | null;
}

/**
 * Créneau d'une piste (#1960) : poule ou matchs de tableau confiés à l'arène, résultats
 * confirmés. `slotId` stable pour un même créneau, même après redémarrage.
 */
export interface PisteRecord {
  slotId: string;
  phaseType: 'pool' | 'DE';
  /** Libellé lisible (« Poule 3 », « Tableau de 32 ») */
  label?: string;
  /** Match en cours, seulement après NEXT / PREV de l'appareil (spéc. OPP2 § 17) */
  activeBout?: number;
  referee?: { id: string; name: string };
  /** Ordre de la poule (matrice) ; vide en tableau */
  participants: PisteRecordFencer[];
  bouts: PisteRecordBout[];
}

/** Commande envoyée à un appareil. */
export type PisteCommand =
  | {
      kind: 'display';
      display: PisteDisplay;
      /** épreuve (pistes partagées) */ competition?: string;
    }
  | { kind: 'clear' }
  /**
   * Créneau de la piste (poule ou matchs de tableau) pour les écrans et feuilles de match
   * (OPP2 `software/record`, #1960) ; ignoré par les pilotes sans équivalent (Cyrano).
   */
  | { kind: 'record'; record: PisteRecord }
  | { kind: 'ack' }
  | { kind: 'nak' }
  /**
   * Affichage libre hors compétition (pilotage de la salle, #2117) : arme, noms, nationalités ;
   * vide = remise à blanc. Pas un match : aucun identifiant de tireur, aucun fait d'épreuve.
   */
  | { kind: 'panel'; panel: StripPanel };

/**
 * Mode d'une piste :
 * - `master` : appareil maître (score, cartons, chrono viennent de l'appareil) ;
 * - `display` : afficheur (reçoit le match, ses commandes sont ignorées) ;
 * - `manual` : piste hors appareil.
 */
export type PisteMode = 'master' | 'display' | 'manual';

export type PisteLinkState = 'online' | 'stale' | 'offline' | 'never';

/** Liaison d'une piste, telle que le pilote la supervise. */
export interface PisteLink {
  piste: string;
  /** Arène BPM - Escrime rattachée (`/arene{N}`, `/equipe{N}`) */
  arena?: number;
  mode: PisteMode;
  status: PisteLinkState;
}

export type PisteNameLength = 10 | 12 | 15 | 20;

/** Ce que le protocole sait faire : le PisteHub n'exige rien au-delà. */
export interface PisteDriverCapabilities {
  /** L'appareil renvoie les noms des tireurs */
  names: boolean;
  /** Touches NEXT / PREV */
  remote: boolean;
  /** Acquittement de fin (ACK / NAK) */
  ack: boolean;
  chrono: boolean;
  pCards: boolean;
  teams: boolean;
}

export interface PisteDriverEvents {
  /** Entrée d'un appareil ; `link` = état de la piste à la réception */
  input: [input: PisteInput, link: PisteLink];
  /** Changement de statut de liaison */
  status: [link: PisteLink];
  /**
   * Ce que l'appareil affiche (noms, arme, combat en cours), lu dans sa trame : accusé de
   * réception d'un affichage libre (#2117). Champ absent : non renvoyé par cette trame.
   */
  echo: [piste: string, state: StripEchoState];
}

/** Pilote d'appareils de piste. */
export interface PisteDriver {
  readonly id: string;
  readonly capabilities: PisteDriverCapabilities;
  getStatuses(): PisteLink[];
  findPiste(piste: string): PisteLink | undefined;
  findAllByArena(arena: number): PisteLink[];
  /** Envoie une commande ; false si la piste est inconnue ou le pilote arrêté. */
  send(piste: string, command: PisteCommand): boolean;
  /** Le protocole publie le créneau de la piste (`record`, OPP2) : absent = jamais */
  wantsRecord?(piste: string): boolean;
  /**
   * Identifiant d'un tireur tel que l'appareil le renverra (troncature du protocole) ;
   * `piste` désigne le pilote quand plusieurs protocoles coexistent (#1960).
   */
  fencerId(id: string, piste?: string): string;
  /**
   * Ce que l'appareil doit renvoyer après un affichage libre (noms tronqués comme le pilote
   * les envoie) ; absent : pas d'accusé possible.
   */
  panelEcho?(piste: string, panel: StripPanel): StripEcho | null;
  /** Longueur des noms affichés, pour les pilotes qui transmettent les noms. */
  setNameLength?(length: PisteNameLength): void;
  on<K extends keyof PisteDriverEvents>(
    event: K,
    listener: (...args: PisteDriverEvents[K]) => void
  ): unknown;
  off<K extends keyof PisteDriverEvents>(
    event: K,
    listener: (...args: PisteDriverEvents[K]) => void
  ): unknown;
}

/**
 * Fait signalé au DT sans alerte persistante : abandon ou exclusion annoncé par l'appareil à
 * la fin d'un relais intermédiaire (fin toujours acquittée, spéc. Cyrano § 4).
 */
export interface PisteNotice {
  kind: 'team_out';
  /** Arène équipe de la piste */
  arena: string;
  relay: number;
  reason: 'abandon' | 'exclusion';
  /** Nom du tireur tel que l'appareil l'affiche */
  fencer: string;
}
