/**
 * BPM - Escrime - Appareils de piste de la salle (docs/adr/0023) : règles pures
 * - lecture tolérante d'une déclaration (`venue_strips.device_config`, anciennes configurations
 *   Cyrano comprises : `protocol` EFP1 / EFP1.1 / auto devient `version`) ;
 * - salle d'une épreuve : la sienne, sinon celle de sa journée, sinon la salle par défaut ;
 * - appareils effectifs : appareils de la salle, pistes passées en manuel par l'épreuve marquées ;
 * - tables des pilotes Cyrano et OPP2.
 * Ni base ni Electron : la lecture en base est dans src/main/engine/commands/devices.ts.
 * Licensed under GPL-3.0
 */
import {
  CYRANO_VERSIONS,
  STRIP_DEVICE_MODES,
  type CyranoVersion,
  type EffectiveStripDevice,
  type StripDevice,
  type StripDeviceMode,
  type VenueSource,
} from '../../types/stripDevice';

const MAX_ARENA = 999;
const MAX_STRIP = 100;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t && t.length <= max ? t : undefined;
};

const int = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;

const modeOf = (v: unknown): StripDeviceMode | undefined =>
  STRIP_DEVICE_MODES.includes(v as StripDeviceMode) ? (v as StripDeviceMode) : undefined;

const versionOf = (v: unknown): CyranoVersion | undefined =>
  CYRANO_VERSIONS.includes(v as CyranoVersion) ? (v as CyranoVersion) : undefined;

/** Champs facultatifs présents seulement s'ils sont définis */
const defined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/**
 * Déclaration lue telle qu'enregistrée : objet du protocole `cyrano` ou `opp2`, ou ancienne
 * configuration Cyrano (sans protocole, ou `protocol` = version). Invalide : null (une
 * adresse IP est obligatoire en Cyrano).
 */
export function toStripDevice(raw: unknown): StripDevice | null {
  if (!isObject(raw)) return null;
  const mode = modeOf(raw.mode);
  const arena = int(raw.arena, 1, MAX_ARENA);
  if (raw.protocol === 'opp2') {
    return defined({ protocol: 'opp2' as const, opp2Id: text(raw.opp2Id, 64), mode, arena });
  }
  const legacy = raw.protocol !== 'cyrano';
  const ip = text(raw.ip, 64);
  if (!ip) return null;
  return defined({
    protocol: 'cyrano' as const,
    ip,
    port: int(raw.port, 1, 65535),
    version: versionOf(legacy ? raw.protocol : raw.version),
    // Seul `false` est gardé : HELLO par défaut (ADR-0038)
    hello: raw.hello === false ? false : undefined,
    mode,
    arena,
  });
}

/** Pistes passées en manuel : entiers 1…100, sans doublon, triés */
export function normalizeManualStrips(list: unknown): number[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<number>();
  for (const n of list) if (int(n, 1, MAX_STRIP) !== undefined) out.add(n as number);
  return [...out].sort((a, b) => a - b);
}

/** Éléments de résolution de la salle d'une épreuve */
export interface VenueCandidates {
  /** Salle propre de l'épreuve (`competitions.venue_id`, ADR-0019 décision 2) */
  competitionVenueId?: string | null;
  /** Salle de la journée multi-épreuves de l'épreuve (`event_days.venue_id`) */
  dayVenueId?: string | null;
  /** Salle par défaut du poste */
  defaultVenueId?: string | null;
}

/**
 * Salle d'une épreuve (docs/adr/0023) : la sienne, sinon celle de sa journée, sinon la salle
 * par défaut. Une salle disparue est sautée. Aucune : null.
 */
export function resolveVenue(
  candidates: VenueCandidates,
  exists: (venueId: string) => boolean
): { venueId: string; source: VenueSource } | null {
  const order: [string | null | undefined, VenueSource][] = [
    [candidates.competitionVenueId, 'competition'],
    [candidates.dayVenueId, 'day'],
    [candidates.defaultVenueId, 'default'],
  ];
  for (const [venueId, source] of order) {
    if (venueId && exists(venueId)) return { venueId, source };
  }
  return null;
}

/** Piste de salle telle que lue en base */
export interface VenueStripLike {
  number: number;
  label?: string;
  deviceConfig?: unknown;
}

/** Identifiant de piste du pilote : numéro (Cyrano), identifiant MQTT sinon numéro (OPP2) */
const pisteOf = (strip: number, device: StripDevice): string =>
  device.protocol === 'opp2' && device.opp2Id ? device.opp2Id : String(strip);

/**
 * Appareils effectifs d'une épreuve : pistes de la salle qui déclarent un appareil valide,
 * dans l'ordre des numéros ; une piste de `manualStrips` est marquée `manual` (le pilote ne lui
 * envoie plus de match et ignore ses scores pour cette épreuve).
 */
export function effectiveStripDevices(
  strips: readonly VenueStripLike[],
  manualStrips: readonly number[] = []
): EffectiveStripDevice[] {
  const manual = new Set(manualStrips);
  return [...strips]
    .sort((a, b) => a.number - b.number)
    .flatMap(strip => {
      const device = toStripDevice(strip.deviceConfig);
      if (!device) return [];
      return [
        defined({
          strip: strip.number,
          label: strip.label,
          device,
          arena: device.arena ?? strip.number,
          piste: pisteOf(strip.number, device),
          manual: manual.has(strip.number),
        }),
      ];
    });
}

/** Table du pilote Cyrano (forme de CyranoPisteConfig) */
export interface CyranoDriverPiste {
  piste: string;
  ip: string;
  port?: number;
  arena: number;
  protocol?: CyranoVersion;
  /** false : aucun HELLO (ADR-0038) */
  hello?: false;
  mode?: StripDeviceMode;
}

/** Table du pilote OPP2 (forme d'Opp2PisteConfig) */
export interface Opp2DriverPiste {
  piste: string;
  arena: number;
  mode?: StripDeviceMode;
}

/**
 * Tables des pilotes à partir des appareils de plusieurs salles (épreuves suivies) : une piste
 * du pilote n'est déclarée qu'une fois, la première rencontrée l'emporte. `strips` associe
 * chaque piste du pilote à son numéro de piste de salle (réglage `manualStrips`).
 */
export function driverTables(devices: readonly EffectiveStripDevice[]): {
  cyrano: CyranoDriverPiste[];
  opp2: Opp2DriverPiste[];
  strips: Record<string, number>;
} {
  const cyrano: CyranoDriverPiste[] = [];
  const opp2: Opp2DriverPiste[] = [];
  const strips: Record<string, number> = {};
  const seen = new Set<string>();
  for (const d of devices) {
    const key = `${d.device.protocol}:${d.piste}`;
    if (seen.has(key)) continue;
    seen.add(key);
    strips[d.piste] ??= d.strip;
    if (d.device.protocol === 'cyrano') {
      cyrano.push(
        defined({
          piste: d.piste,
          ip: d.device.ip,
          port: d.device.port,
          arena: d.arena,
          protocol: d.device.version,
          hello: d.device.hello === false ? (false as const) : undefined,
          mode: d.device.mode,
        })
      );
    } else {
      opp2.push(defined({ piste: d.piste, arena: d.arena, mode: d.device.mode }));
    }
  }
  return { cyrano, opp2, strips };
}
