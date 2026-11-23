/**
 * BellePoule Modern - Déclaration en masse des appareils d'une salle (#2117, docs/adr/0023) :
 * profils constructeur, ajout en lot (plage de pistes, IP de départ incrémentée), fichier
 * d'export / d'import. Reprend les outils de l'ancien panneau Cyrano (#1829), désormais sur la
 * salle. Règles pures : le fichier circule par contenu (jamais un chemin), la validation de
 * chaque ligne par le schéma du contrat est faite par le handler (importStripDevices).
 * Licensed under GPL-3.0
 */
import type {
  CyranoVersion,
  StripDevice,
  StripDeviceDeclaration,
  StripDeviceMode,
  StripDeviceProtocol,
} from '../../types/stripDevice';

export const STRIP_DEVICES_FORMAT = 'bellepoule-strip-devices';
/** Ancien export du panneau Cyrano (#1829), toujours lu */
export const LEGACY_CYRANO_FORMAT = 'bellepoule-cyrano-pistes';
export const MAX_STRIP_NUMBER = 100;

/** Profils constructeur : port d'écoute, version, IP imposée par le numéro de piste */
export interface StripDeviceProfile {
  id: 'standard' | 'efp11' | 'saintgeorge';
  port: number;
  version: CyranoVersion;
  /** IP déduite du numéro de piste quand le constructeur l'impose */
  ipOf?: (strip: number) => string;
}

export const STRIP_DEVICE_PROFILES: readonly StripDeviceProfile[] = [
  { id: 'standard', port: 50100, version: 'auto' },
  { id: 'efp11', port: 50101, version: 'EFP1.1' },
  // Saint-George SG31 / SG32 : IP fixe 192.168.1.(100 + piste), écoute sur 50101
  {
    id: 'saintgeorge',
    port: 50101,
    version: 'auto',
    ipOf: n => (n >= 1 && n <= 154 ? `192.168.1.${100 + n}` : ''),
  },
];

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** Adresse IPv4 décalée de `offset` (dernier octet puis retenue) ; null hors plage */
export function incrementIpv4(ip: string, offset: number): string | null {
  const v = ip.trim();
  if (!IPV4.test(v)) return null;
  const n = v.split('.').reduce((acc, p) => acc * 256 + Number(p), 0) + offset;
  if (n < 0 || n > 0xffffffff) return null;
  return [24, 16, 8, 0].map(s => Math.floor(n / 2 ** s) % 256).join('.');
}

/** Ajout en lot : plage de pistes et réglages communs */
export interface StripDeviceBatch {
  from: number;
  count: number;
  protocol: StripDeviceProtocol;
  /** Cyrano : IP de la première piste, incrémentée d'une piste à l'autre (sinon : profil) */
  startIp?: string;
  port?: number;
  version?: CyranoVersion;
  profile?: StripDeviceProfile['id'];
  mode?: StripDeviceMode;
}

/**
 * Déclarations d'un ajout en lot : pistes `from` … `from + count − 1` (bornées à 100). Cyrano :
 * IP de départ incrémentée, sinon IP du profil ; une piste sans IP est écartée. OPP2 :
 * identifiant MQTT = numéro de piste.
 */
export function buildStripDeviceBatch(batch: StripDeviceBatch): StripDeviceDeclaration[] {
  const profile = STRIP_DEVICE_PROFILES.find(p => p.id === batch.profile);
  const out: StripDeviceDeclaration[] = [];
  const count = Math.max(0, Math.min(batch.count, MAX_STRIP_NUMBER));
  for (let i = 0; i < count; i++) {
    const strip = batch.from + i;
    if (!Number.isInteger(strip) || strip < 1 || strip > MAX_STRIP_NUMBER) continue;
    const mode = batch.mode ? { mode: batch.mode } : {};
    if (batch.protocol === 'opp2') {
      out.push({ strip, device: { protocol: 'opp2', ...mode } });
      continue;
    }
    const ip = batch.startIp?.trim()
      ? incrementIpv4(batch.startIp, i)
      : (profile?.ipOf?.(strip) ?? null);
    if (!ip) continue;
    const port = batch.port ?? profile?.port;
    const version = batch.version ?? profile?.version;
    out.push({
      strip,
      device: {
        protocol: 'cyrano',
        ip,
        ...(port ? { port } : {}),
        ...(version ? { version } : {}),
        ...mode,
      },
    });
  }
  return out;
}

/** Fichier d'export des appareils d'une salle (format versionné) */
export function exportStripDevicesFile(
  venueName: string,
  strips: readonly StripDeviceDeclaration[]
): string {
  return JSON.stringify(
    {
      format: STRIP_DEVICES_FORMAT,
      version: 1,
      venue: venueName,
      strips: strips.map(s => ({
        strip: s.strip,
        ...(s.label ? { label: s.label } : {}),
        device: s.device,
      })),
    },
    null,
    2
  );
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Ligne de l'ancien export Cyrano (`piste`, `ip`, `port`, `arena`, `protocol`, `mode`) */
function fromLegacy(row: Record<string, unknown>): unknown {
  const strip = typeof row.piste === 'string' ? Number(row.piste.trim()) : row.piste;
  const device: Record<string, unknown> = { protocol: 'cyrano', ip: row.ip };
  if (row.port !== undefined) device.port = row.port;
  if (row.protocol !== undefined) device.version = row.protocol;
  if (row.mode !== undefined) device.mode = row.mode;
  if (row.arena !== undefined && row.arena !== strip && row.arena !== 0) device.arena = row.arena;
  return { strip, device };
}

export type StripDevicesFileRead =
  | { ok: true; rows: { line: number; raw: unknown }[] }
  | { ok: false; error: 'invalid_json' | 'invalid_format' | 'empty' };

/**
 * Lecture d'un fichier d'appareils : format courant, ancien export Cyrano, ou tableau nu.
 * Rend chaque ligne brute avec son numéro (1, 2…) ; la validation se fait ensuite, ligne par
 * ligne, par le schéma du contrat.
 */
export function readStripDevicesFile(text: string): StripDevicesFileRead {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  let list: unknown[] | null = null;
  let legacy = false;
  if (Array.isArray(data)) list = data;
  else if (isObject(data) && Array.isArray(data.strips)) list = data.strips;
  else if (isObject(data) && Array.isArray(data.pistes)) {
    list = data.pistes;
    legacy = true;
  }
  if (!list) return { ok: false, error: 'invalid_format' };
  if (list.length === 0) return { ok: false, error: 'empty' };
  return {
    ok: true,
    rows: list.map((raw, i) => ({
      line: i + 1,
      raw:
        (legacy || (isObject(raw) && 'piste' in raw && !('strip' in raw))) && isObject(raw)
          ? fromLegacy(raw)
          : raw,
    })),
  };
}

/** Lignes qui redéclarent une piste déjà citée plus haut dans le fichier */
export function duplicateStripLines(
  rows: readonly { line: number; strip: number }[]
): { line: number; strip: number }[] {
  const seen = new Set<number>();
  const out: { line: number; strip: number }[] = [];
  for (const r of rows) {
    if (seen.has(r.strip)) out.push(r);
    seen.add(r.strip);
  }
  return out;
}

/** Déclarations d'une salle telles qu'enregistrées (pistes sans appareil comprises) */
export function venueDeclarations(
  strips: readonly { number: number; label?: string; deviceConfig?: unknown }[],
  toDevice: (raw: unknown) => StripDevice | null
): StripDeviceDeclaration[] {
  return [...strips]
    .sort((a, b) => a.number - b.number)
    .map(s => ({
      strip: s.number,
      ...(s.label ? { label: s.label } : {}),
      device: toDevice(s.deviceConfig),
    }));
}
