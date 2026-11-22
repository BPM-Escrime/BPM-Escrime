/**
 * BellePoule Modern - Appareil de piste déclaré sur la piste d'une salle (docs/adr/0023)
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
  /** Arène BellePoule (`/arene{N}`) ; absente : numéro de la piste */
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
