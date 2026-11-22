/**
 * BellePoule Modern - Édition des pistes d'une salle (#1880, docs/adr/0023) : libellé et
 * appareil de piste déclaré sur la salle (Cyrano : adresse IPv4, port, version ; OPP2 :
 * identifiant MQTT ; mode). Fonctions pures, utilisées par VenueStripsEditor.
 * Licensed under GPL-3.0
 */
import type { VenueStrip } from '../../shared/types/appSettings';
import {
  CYRANO_VERSIONS,
  STRIP_DEVICE_MODES,
  type CyranoVersion,
  type StripDevice,
  type StripDeviceMode,
} from '../../shared/types/stripDevice';

export type StripMode = StripDeviceMode;
export const STRIP_MODES = STRIP_DEVICE_MODES;
export { CYRANO_VERSIONS };

/** Protocole saisi : `none` = pas d'appareil (saisie sur la tablette) */
export type StripProtocol = 'none' | 'cyrano' | 'opp2';
export const STRIP_PROTOCOLS: readonly StripProtocol[] = ['cyrano', 'opp2', 'none'];

/** Même plafond que l'enregistrement côté main (libellé de piste) */
export const MAX_STRIP_LABEL = 40;
export const MAX_OPP2_ID = 64;

/** Saisie d'une piste : champs texte tels que tapés */
export interface StripEdit {
  label: string;
  protocol: StripProtocol;
  ip: string;
  port: string;
  mode: StripMode;
  version: CyranoVersion;
  opp2Id: string;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export const isIpv4 = (value: string): boolean => IPV4.test(value.trim());

/** Port facultatif : vide ou entier 1…65535 */
export const isValidPort = (value: string): boolean => {
  const v = value.trim();
  if (!v) return true;
  const n = Number(v);
  return /^\d+$/.test(v) && n >= 1 && n <= 65535;
};

/** Saisie initiale d'une piste existante ; sans appareil : Cyrano sans adresse */
export function stripToEdit(strip: VenueStrip): StripEdit {
  const cfg = strip.deviceConfig ?? null;
  const cyrano = cfg?.protocol === 'cyrano' ? cfg : null;
  const opp2 = cfg?.protocol === 'opp2' ? cfg : null;
  return {
    label: strip.label ?? '',
    protocol: cfg?.protocol ?? 'cyrano',
    ip: cyrano?.ip ?? '',
    port: cyrano?.port ? String(cyrano.port) : '',
    mode: cfg?.mode ?? 'master',
    version: cyrano?.version ?? 'auto',
    opp2Id: opp2?.opp2Id ?? '',
  };
}

/** Cyrano : une adresse est facultative (pas d'appareil) ; si elle est saisie, IPv4 obligatoire */
export function stripEditError(edit: StripEdit): boolean {
  if (edit.protocol === 'cyrano') {
    return (edit.ip.trim() !== '' && !isIpv4(edit.ip)) || !isValidPort(edit.port);
  }
  return edit.protocol === 'opp2' && edit.opp2Id.trim().length > MAX_OPP2_ID;
}

/** Appareil saisi ; null : aucun (protocole « aucun », ou Cyrano sans adresse IP) */
export function editToDevice(edit: StripEdit, previous?: StripDevice | null): StripDevice | null {
  // Arène reliée : gardée d'une déclaration à l'autre (non éditée ici)
  const arena = previous?.arena !== undefined ? { arena: previous.arena } : {};
  if (edit.protocol === 'opp2') {
    const opp2Id = edit.opp2Id.trim();
    return { protocol: 'opp2', ...(opp2Id ? { opp2Id } : {}), mode: edit.mode, ...arena };
  }
  const ip = edit.ip.trim();
  if (edit.protocol === 'none' || !ip) return null;
  const port = edit.port.trim();
  return {
    protocol: 'cyrano',
    ip,
    ...(port ? { port: Number(port) } : {}),
    version: edit.version,
    mode: edit.mode,
    ...arena,
  };
}

/**
 * Applique les saisies aux pistes : seules les pistes modifiées changent (appareil compris,
 * arène gardée) ; un appareil retiré est envoyé à null (sinon le poste le garderait).
 */
export function applyStripEdits(
  strips: VenueStrip[],
  edits: Record<number, StripEdit>
): VenueStrip[] {
  return strips.map(strip => {
    const edit = edits[strip.number];
    if (!edit) return strip;
    const { label: _label, deviceConfig: previous, ...rest } = strip;
    const label = edit.label.trim().slice(0, MAX_STRIP_LABEL);
    return {
      ...rest,
      ...(label ? { label } : {}),
      deviceConfig: editToDevice(edit, previous),
    };
  });
}
