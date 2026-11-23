/**
 * BPM - Escrime - Réglages des pilotes d'appareils mémorisés sur le poste (#1720, #1829,
 * #1960) : port et interface d'écoute Cyrano, port du broker OPP2, options d'affichage,
 * démarrage automatique ; démarrage des pilotes par le contrat (panneau ou séance de saisie
 * distante). Les appareils eux-mêmes sont déclarés sur la salle (docs/adr/0023).
 * Licensed under GPL-3.0
 */
import { ApiError } from '../../../shared/api/client';
import type { CyranoFrameLog } from '../../../shared/types/stripDevice';
import { devicesApi, type DevicesApi } from '../../api/devicesApi';

export const PORT_KEY = 'bellepoule-cyrano-port';
export const HOST_KEY = 'bellepoule-cyrano-host';
export const OPTIONS_KEY = 'bellepoule-cyrano-options';
export const AUTOSTART_KEY = 'bellepoule-cyrano-autostart';
export const OPP2_PORT_KEY = 'bellepoule-opp2-port';
export const DEFAULT_PORT = 50100;
export const OPP2_DEFAULT_PORT = 1883;

export interface CyranoOptions {
  nameLength: 10 | 12 | 15 | 20;
  natSource: 'auto' | 'country' | 'club' | 'region';
  international: boolean;
}

export const DEFAULT_OPTIONS: CyranoOptions = {
  nameLength: 10,
  natSource: 'auto',
  international: false,
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible */
  }
}

export const readPort = (): number => parseInt(read(PORT_KEY) ?? '', 10) || DEFAULT_PORT;
export const writePort = (p: number) => write(PORT_KEY, String(p));

export const readOpp2Port = (): number =>
  parseInt(read(OPP2_PORT_KEY) ?? '', 10) || OPP2_DEFAULT_PORT;
export const writeOpp2Port = (p: number) => write(OPP2_PORT_KEY, String(p));

/** Interface d'écoute : adresse IP locale, vide = toutes les interfaces */
export const readHost = (): string => read(HOST_KEY) ?? '';
export const writeHost = (h: string) => write(HOST_KEY, h);

export function readOptions(): CyranoOptions {
  try {
    return { ...DEFAULT_OPTIONS, ...(JSON.parse(read(OPTIONS_KEY) ?? '{}') as object) };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}
export const writeOptions = (o: CyranoOptions) => write(OPTIONS_KEY, JSON.stringify(o));

/** Démarrage automatique avec la séance de saisie distante */
export const readAutoStart = (): boolean => read(AUTOSTART_KEY) === 'true';
export const writeAutoStart = (v: boolean) => write(AUTOSTART_KEY, String(v));

/** Refus du contrat → message pour l'écran (code du catalogue ou texte) */
export const errorText = (e: unknown): string =>
  e instanceof ApiError ? e.message || e.code : e instanceof Error ? e.message : String(e);

/**
 * Démarre le serveur Cyrano avec les réglages mémorisés (port, interface, options) ; le moteur
 * charge les appareils Cyrano de la salle de l'épreuve. Déjà démarré : options renvoyées.
 */
export async function startCyranoFromSaved(
  competitionId: string | null,
  api: DevicesApi = devicesApi
): Promise<{ success: boolean; error?: string }> {
  try {
    await api.cyrano.start({
      port: readPort(),
      host: readHost(),
      ...(competitionId ? { competitionId } : {}),
    });
    await api.setOptions(readOptions());
    return { success: true };
  } catch (e) {
    return { success: false, error: errorText(e) };
  }
}

/** Démarre le broker OPP2 sur le port mémorisé ; appareils OPP2 de la salle chargés */
export async function startOpp2FromSaved(
  competitionId: string | null,
  api: DevicesApi = devicesApi
): Promise<{ success: boolean; error?: string }> {
  try {
    await api.opp2.start({ port: readOpp2Port(), ...(competitionId ? { competitionId } : {}) });
    await api.setOptions(readOptions());
    return { success: true };
  } catch (e) {
    return { success: false, error: errorText(e) };
  }
}

/**
 * Démarrage automatique avec la séance (#1829) : seulement si activé ; chaque pilote démarre
 * si la salle de l'épreuve déclare au moins un appareil de son protocole.
 */
export async function autoStartCyrano(
  competitionId: string | null,
  api: DevicesApi = devicesApi
): Promise<boolean> {
  if (!readAutoStart() || !competitionId) return false;
  try {
    const { devices } = await api.getCompetitionDevices(competitionId);
    const has = (protocol: string) => devices.some(d => d.device.protocol === protocol);
    let started = false;
    if (has('cyrano')) started = (await startCyranoFromSaved(competitionId, api)).success;
    if (has('opp2')) started = (await startOpp2FromSaved(competitionId, api)).success || started;
    return started;
  } catch {
    return false;
  }
}

/**
 * Journal des trames en texte : une trame par ligne,
 * `horodatage ISO <TAB> sens <TAB> ip:port <TAB> piste <TAB> trame [<TAB> rejet]`.
 * La trame brute reste en dernière colonne utile, pour être rejouée.
 */
export function formatCyranoLog(entries: CyranoFrameLog[]): string {
  return entries
    .map(e =>
      [
        new Date(e.ts).toISOString(),
        e.dir === 'in' ? 'IN' : 'OUT',
        `${e.ip}:${e.port}`,
        e.piste ?? '-',
        e.raw.replace(/[\r\n]+/g, ''),
        ...(e.rejected ? [e.rejected] : []),
      ].join('\t')
    )
    .join('\n');
}
