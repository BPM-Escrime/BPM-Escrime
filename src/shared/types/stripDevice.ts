/**
 * BPM - Escrime - Appareil de piste déclaré sur la piste d'une salle (docs/adr/0023)
 * Colonne `venue_strips.device_config` : protocole, adresse, port, mode, version, identifiant
 * OPP2. Une épreuve retrouve les appareils de sa salle et peut seulement passer une piste en
 * manuel (`settings.manualStrips`).
 * Licensed under GPL-3.0
 */

/** Mode de la piste : appareil maître, afficheur, ou manuel pour toutes les épreuves */
export type StripDeviceMode = 'master' | 'display' | 'manual';
export const STRIP_DEVICE_MODES: readonly StripDeviceMode[] = ['master', 'display', 'manual'];

/** Version du protocole Cyrano : imposée, ou `auto` (celle de la dernière trame reçue) */
export type CyranoVersion = 'EFP1' | 'EFP1.1' | 'auto';
export const CYRANO_VERSIONS: readonly CyranoVersion[] = ['auto', 'EFP1', 'EFP1.1'];

export type StripDeviceProtocol = 'cyrano' | 'opp2';
export const STRIP_DEVICE_PROTOCOLS: readonly StripDeviceProtocol[] = ['cyrano', 'opp2'];

interface StripDeviceBase {
  /** Mode de la piste ; `master` par défaut */
  mode?: StripDeviceMode;
  /** Arène BPM - Escrime (`/arene{N}`) ; absente : numéro de la piste */
  arena?: number;
}

/** Appareil Cyrano EFP1 / EFP1.1 (UDP) */
export interface CyranoStripDevice extends StripDeviceBase {
  protocol: 'cyrano';
  /** Adresse IP fixe de l'appareil */
  ip: string;
  /** Port UDP de l'appareil (50100 par défaut) */
  port?: number;
  version?: CyranoVersion;
  /** false : aucun HELLO (Saint-George SG31 / SG32, ADR-0038) ; absent : HELLO toutes les 15 s */
  hello?: boolean;
}

/** Appareil OPP2 (JSON sur MQTT, broker intégré) */
export interface Opp2StripDevice extends StripDeviceBase {
  protocol: 'opp2';
  /** Identifiant de piste des sujets MQTT (`openpiste/{id}/…`) ; absent : numéro de la piste */
  opp2Id?: string;
}

export type StripDevice = CyranoStripDevice | Opp2StripDevice;

/** D'où vient la salle d'une épreuve (docs/adr/0023) */
export type VenueSource = 'competition' | 'day' | 'default';

/** Appareil effectif d'une épreuve : piste de la salle résolue, passée en manuel ou non */
export interface EffectiveStripDevice {
  strip: number;
  label?: string;
  device: StripDevice;
  /** Arène reliée (celle de l'appareil, sinon le numéro de piste) */
  arena: number;
  /** Identifiant de piste du pilote (Cyrano : numéro ; OPP2 : identifiant MQTT) */
  piste: string;
  /** Piste passée en manuel par l'épreuve (`settings.manualStrips`) */
  manual: boolean;
}

/** Appareils d'une épreuve (getCompetitionStripDevices) */
export interface CompetitionStripDevices {
  /** Salle résolue ; null : aucune salle déclarée */
  venueId: string | null;
  venueName: string | null;
  source: VenueSource | null;
  /** Salle choisie pour l'épreuve (setCompetitionVenue) ; null : celle de la journée ou par défaut */
  competitionVenueId: string | null;
  devices: EffectiveStripDevice[];
  manualStrips: number[];
}

/** Piste d'une salle et son appareil (listStripDevices) */
export interface StripDeviceEntry {
  strip: number;
  label?: string;
  device: StripDevice | null;
}

// ─── Pilotes (Cyrano, OPP2) : état et journal ─────────────────────────────────

/** Liaison d'un appareil */
export type StripDeviceLink = 'online' | 'stale' | 'offline' | 'never';

/** BAD MATCH : l'appareil affiche d'autres tireurs que le match de l'arène (#1720) */
export interface StripDeviceAlert {
  kind: 'bad_match';
  since: number;
  arena: string;
  device: string;
}

/** Piste du pilote Cyrano et sa liaison */
export interface CyranoPisteStatus {
  piste: string;
  ip: string;
  port?: number;
  arena?: number;
  protocol?: CyranoVersion;
  mode: StripDeviceMode;
  status: StripDeviceLink;
  lastSeen: number | null;
  detectedProtocol: 'EFP1' | 'EFP1.1' | null;
  alert?: StripDeviceAlert | null;
}

/** État du serveur Cyrano (getCyranoStatus) */
export interface CyranoStatus {
  running: boolean;
  port: number;
  pistes: CyranoPisteStatus[];
}

/** Trame du journal Cyrano (#1829) */
export type CyranoFrameLog = { ts: number; dir: 'in' | 'out'; ip: string; port: number } & {
  piste: string | null;
  raw: string;
  rejected?: 'unknown_ip' | 'malformed';
};

/** Piste du pilote OPP2 et sa liaison */
export interface Opp2PisteStatus {
  piste: string;
  arena?: number;
  mode: StripDeviceMode;
  status: StripDeviceLink;
  device?: string;
  firmware?: string;
  lastSeen: number | null;
  alert?: StripDeviceAlert | null;
}

/** État du broker OPP2 intégré (getOpp2Status) */
export interface Opp2Status {
  running: boolean;
  port: number;
  /** Clients MQTT connectés au broker intégré */
  clients: number;
  /** Pistes vues sur le broker sans être déclarées */
  unknownPistes: string[];
  pistes: Opp2PisteStatus[];
}

/** Options d'affichage des appareils (longueur des noms, nationalité, mode international) */
export interface StripDeviceOptions {
  nameLength?: 10 | 12 | 15 | 20;
  natSource?: 'auto' | 'country' | 'club' | 'region';
  international?: boolean;
}

/** Actions de secours par piste (#1829) */
export type StripDeviceAction = 'ack' | 'next' | 'prev' | 'resync';

// ─── Pilotage de la salle hors compétition (#2117, docs/adr/0023) ─────────────

/** Armes transmissibles aux appareils (Cyrano, OPP2) : épée, fleuret, sabre */
export type StripPanelWeapon = 'E' | 'F' | 'S';
export const STRIP_PANEL_WEAPONS: readonly StripPanelWeapon[] = ['E', 'F', 'S'];

/** Côté de l'appareil piloté : nom et nationalité (ou club) affichés */
export interface StripPanelSide {
  name?: string;
  nat?: string;
}

/**
 * Affichage libre d'un appareil hors compétition : arme, noms et nationalités. Ce n'est pas un
 * match : aucun identifiant de tireur, aucun fait d'épreuve. Vide : appareil remis à blanc.
 */
export interface StripPanel {
  weapon?: StripPanelWeapon;
  left?: StripPanelSide;
  right?: StripPanelSide;
}

/**
 * Ce que l'appareil doit renvoyer pour confirmer un affichage libre (accusé de réception) :
 * noms tels que le pilote les a envoyés (troncature du protocole), arme si le protocole la
 * renvoie. `clear` : appareil remis à blanc.
 */
export interface StripEcho {
  weapon?: string;
  left: string;
  right: string;
  clear: boolean;
}

/**
 * Accusé d'un affichage libre : en attente, reçu (l'appareil affiche ce qui a été envoyé),
 * refusé (appareil en plein combat : il ignore l'affichage), affichage différent (l'appareil
 * répond, mais n'affiche pas ce qui a été envoyé, jusqu'au délai), sans réponse (rien reçu
 * dans le délai).
 */
export type StripAckState = 'pending' | 'acked' | 'refused' | 'mismatch' | 'no_response';

/** Champ renvoyé par l'appareil qui diffère de l'affichage envoyé */
export type StripEchoField = 'weapon' | 'left' | 'right';

/**
 * Résultat d'un envoi, par piste : envoyé, refusé car occupé par une épreuve en cours, hors
 * ligne, piste sans appareil déclaré, pilote arrêté (ou appareil non chargé).
 */
export type StripSendOutcome = 'sent' | 'busy' | 'offline' | 'not_declared' | 'unavailable';

export interface StripSendResult {
  strip: number;
  outcome: StripSendOutcome;
  /** Épreuve qui occupe la piste (`busy`) */
  competitionId?: string;
}

/** Dernier affichage libre envoyé à une piste et son accusé */
export interface StripLastSend {
  at: number;
  ack: StripAckState;
  /** Heure de l'accusé (reçu, refusé ou délai dépassé) */
  ackAt?: number;
  /** Affichage différent : champs que l'appareil renvoie autrement (dernière trame reçue) */
  diff?: StripEchoField[];
  clear: boolean;
  panel: StripPanel;
}

/** Épreuve en cours qui occupe une piste de la salle */
export interface StripBusy {
  competitionId: string;
  title: string;
}

/** Ligne de la grille du pilotage de la salle */
export interface StripControlRow {
  strip: number;
  label?: string;
  protocol: StripDeviceProtocol | null;
  /** Identifiant de piste du pilote ; null sans appareil */
  piste: string | null;
  /** Liaison ; null : pilote arrêté ou appareil non chargé */
  link: StripDeviceLink | null;
  busy: StripBusy | null;
  last: StripLastSend | null;
}

/** Grille du pilotage de la salle (listVenueStripControl) */
export interface VenueStripControl {
  venueId: string;
  venueName: string;
  cyranoRunning: boolean;
  opp2Running: boolean;
  strips: StripControlRow[];
}

/** Avis du pilotage de la salle (onStripControlChanged) : l'écran relit la grille */
export interface StripControlChange {
  kind: 'ack' | 'link';
  piste: string;
  venueId?: string;
  strip?: number;
  ack?: StripAckState;
}

/** Déclaration d'une piste dans un envoi en masse ou un fichier d'import */
export interface StripDeviceDeclaration {
  strip: number;
  label?: string;
  device: StripDevice | null;
}

/** Rapport d'un import d'appareils (importStripDevices) */
export interface StripDevicesImportReport {
  /** Écrit en base (false : essai à blanc, ou erreurs : rien n'est écrit) */
  applied: boolean;
  /** Pistes valides lues dans le fichier */
  strips: number;
  errors: { line: number; message: string }[];
}
