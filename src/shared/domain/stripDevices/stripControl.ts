/**
 * BPM - Escrime - Pilotage des appareils de la salle hors compétition (#2117, docs/adr/0023)
 * Règles pures :
 * - sélection des pistes (liste ou toutes les pistes déclarées) ;
 * - occupation : une piste est refusée si une épreuve en cours dans la salle l'utilise, sauf si
 *   cette épreuve l'a passée en manuel (`manualStrips`) ;
 * - verdict par piste (envoyée, occupée, hors ligne, non déclarée, indisponible) ;
 * - affichage libre fusionné avec le précédent (un envoi de l'arme seule garde les noms) ;
 * - accusé de réception : l'état suivant de l'appareil reflète-t-il l'affichage envoyé ?
 * Ce sont des ordres d'affichage : aucun fait d'épreuve, aucun journal. Heure injectée.
 * Licensed under GPL-3.0
 */
import type {
  EffectiveStripDevice,
  StripAckState,
  StripBusy,
  StripDeviceLink,
  StripEcho,
  StripPanel,
  StripPanelSide,
  StripSendOutcome,
} from '../../types/stripDevice';

/** Délai d'attente de l'accusé : au-delà, « sans réponse » (Cyrano : INFO toutes les 2 à 4 s) */
export const STRIP_ACK_TIMEOUT_MS = 8000;

/** Épreuve en cours (serveur distant actif) et ce qu'elle utilise */
export interface CompetitionStripUse {
  competitionId: string;
  title: string;
  /** Salle résolue de l'épreuve (la sienne, sa journée, la salle par défaut) */
  venueId: string | null;
  /** Arènes de sa séance de saisie distante */
  arenas: readonly number[];
  /** Pistes passées en manuel par l'épreuve : laissées au pilotage de la salle */
  manualStrips: readonly number[];
}

/**
 * Pistes visées : `all` = toutes les pistes de la salle qui déclarent un appareil ; une liste
 * est gardée telle quelle (sans doublon, triée), les pistes sans appareil seront « non déclarées ».
 */
export function selectStrips(
  devices: readonly Pick<EffectiveStripDevice, 'strip'>[],
  selection: readonly number[] | 'all'
): number[] {
  const list = selection === 'all' ? devices.map(d => d.strip) : selection;
  return [...new Set(list)].sort((a, b) => a - b);
}

/**
 * Épreuve qui occupe chaque piste de la salle : épreuve en cours de la même salle dont la séance
 * a l'arène de la piste, sauf si elle a passé la piste en manuel. La première l'emporte.
 */
export function stripOccupancy(
  venueId: string,
  devices: readonly Pick<EffectiveStripDevice, 'strip' | 'arena'>[],
  uses: readonly CompetitionStripUse[]
): Map<number, StripBusy> {
  const out = new Map<number, StripBusy>();
  for (const d of devices) {
    const use = uses.find(
      u => u.venueId === venueId && u.arenas.includes(d.arena) && !u.manualStrips.includes(d.strip)
    );
    if (use) out.set(d.strip, { competitionId: use.competitionId, title: use.title });
  }
  return out;
}

/** Ce qu'il faut savoir d'une piste pour décider de l'envoi */
export interface StripSendContext {
  /** Appareil déclaré sur la piste (absent : non déclarée) */
  device?: Pick<EffectiveStripDevice, 'device'>;
  busy?: StripBusy | null;
  /** Liaison vue par le pilote ; null : pilote arrêté ou appareil non chargé */
  link: StripDeviceLink | null;
}

/**
 * Verdict d'envoi d'une piste. Ordre : non déclarée, occupée, indisponible (pilote arrêté),
 * hors ligne. Un appareil « jamais vu » ou « incertain » reçoit l'envoi (UDP, MQTT : sans
 * danger) ; l'accusé dira s'il l'a pris.
 */
export function stripSendOutcome(ctx: StripSendContext): StripSendOutcome {
  if (!ctx.device) return 'not_declared';
  if (ctx.busy) return 'busy';
  if (ctx.link === null) return 'unavailable';
  if (ctx.link === 'offline') return 'offline';
  return 'sent';
}

/** Demande d'affichage telle que reçue (champ absent : inchangé ; chaîne vide : effacé) */
export interface StripPanelRequest {
  weapon?: StripPanel['weapon'];
  left?: StripPanelSide;
  right?: StripPanelSide;
  clear?: boolean;
}

const cleanText = (v: string | undefined): string | undefined => {
  if (v === undefined) return undefined;
  const t = v.replace(/\s+/g, ' ').trim();
  return t || undefined;
};

function mergeSide(
  previous: StripPanelSide | undefined,
  next: StripPanelSide | undefined
): StripPanelSide | undefined {
  const name = next?.name !== undefined ? cleanText(next.name) : previous?.name;
  const nat = next?.nat !== undefined ? cleanText(next.nat) : previous?.nat;
  if (!name && !nat) return undefined;
  return { ...(name ? { name } : {}), ...(nat ? { nat } : {}) };
}

/**
 * Affichage à envoyer : le précédent de la piste, complété par la demande. Une remise à blanc
 * (`clear`) repart de rien, puis applique les champs de la même demande.
 */
export function mergeStripPanel(
  previous: StripPanel | undefined,
  request: StripPanelRequest
): StripPanel {
  const base = request.clear ? {} : (previous ?? {});
  const weapon = request.weapon ?? base.weapon;
  const left = mergeSide(base.left, request.left);
  const right = mergeSide(base.right, request.right);
  return {
    ...(weapon ? { weapon } : {}),
    ...(left ? { left } : {}),
    ...(right ? { right } : {}),
  };
}

/** Affichage vide : appareil remis à blanc */
export const isBlankPanel = (panel: StripPanel): boolean =>
  !panel.weapon && !panel.left && !panel.right;

/** Une demande sans aucun champ ni remise à blanc n'envoie rien */
export const isEmptyRequest = (r: StripPanelRequest): boolean =>
  !r.clear &&
  r.weapon === undefined &&
  r.left?.name === undefined &&
  r.left?.nat === undefined &&
  r.right?.name === undefined &&
  r.right?.nat === undefined;

/**
 * État renvoyé par l'appareil, tel que le pilote le lit : champ absent = non renvoyé par ce
 * message (OPP2 publie par morceaux) ; chaîne vide = renvoyé vide.
 */
export interface StripEchoState {
  /** Combat en cours (F, H, P, E) : un appareil conforme ignore l'affichage (Cyrano § 4) */
  active?: boolean;
  weapon?: string;
  left?: string;
  right?: string;
}

const norm = (v: string): string => v.replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Accusé de réception d'un affichage libre : `acked` si l'appareil renvoie les noms (et l'arme
 * si le protocole la renvoie) envoyés ; `refused` s'il est en plein combat sans les afficher ;
 * null sinon (trame croisée, morceau sans nom : on attend la suivante, jusqu'au délai).
 */
export function stripAckVerdict(
  expected: StripEcho,
  state: StripEchoState
): Exclude<StripAckState, 'pending' | 'no_response'> | null {
  const checks: boolean[] = [];
  if (state.left !== undefined) checks.push(norm(state.left) === norm(expected.left));
  if (state.right !== undefined) checks.push(norm(state.right) === norm(expected.right));
  if (expected.weapon !== undefined && state.weapon !== undefined)
    checks.push(norm(state.weapon) === norm(expected.weapon));
  if (checks.length > 0 && checks.every(Boolean)) return 'acked';
  if (state.active) return 'refused';
  return null;
}

/** Accusé en attente dont le délai est dépassé */
export const ackExpired = (sentAt: number, now: number, timeoutMs = STRIP_ACK_TIMEOUT_MS) =>
  now - sentAt >= timeoutMs;
