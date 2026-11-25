/**
 * BPM - Escrime - Appareils de piste : appels de l'écran au contrat d'API (#2117,
 * docs/adr/0023). Salle de l'épreuve, appareils effectifs, pistes passées en manuel
 * (`settings.manualStrips` par updateCompetitionSettings), pilotes Cyrano et OPP2. Remplace les
 * groupes `cyrano` et `opp2` de window.electronAPI. Un refus du contrat lève ApiError (code
 * traduisible par `errors.<code>`).
 * Licensed under GPL-3.0
 */
import { useMemo } from 'react';
import type { BpmClient } from '../../shared/api/client';
import type { Venue } from '../../shared/types/appSettings';
import type {
  StripControlChange,
  StripDevice,
  StripDeviceAction,
  StripDeviceDeclaration,
  StripDeviceOptions,
  StripPanelSide,
  StripPanelWeapon,
} from '../../shared/types/stripDevice';
import { useBpmClient } from './BpmClientContext';
import { defaultBpmClient } from './IpcClient';

/** Envoi du pilotage de la salle : champ absent = inchangé, chaîne vide = effacé */
export interface StripDisplayRequest {
  weapon?: StripPanelWeapon;
  left?: StripPanelSide;
  right?: StripPanelSide;
  clear?: boolean;
}

export function createDevicesApi(client: BpmClient) {
  const q = client.query.bind(client);
  const c = client.call.bind(client);
  return {
    listVenues: (): Promise<Venue[]> => q('listVenues', {}),
    getCompetitionDevices: (competitionId: string) =>
      q('getCompetitionStripDevices', { competitionId }),
    setCompetitionVenue: (competitionId: string, venueId: string | null) =>
      c('setCompetitionVenue', { competitionId, venueId }),
    /** Pistes dont l'appareil est ignoré pour cette épreuve (réglage, pas un fait du journal) */
    setManualStrips: (competitionId: string, manualStrips: number[]) =>
      c('updateCompetitionSettings', { competitionId, settings: { manualStrips } }),
    listStripDevices: (venueId: string) => q('listStripDevices', { venueId }),
    setStripDevice: (venueId: string, strip: number, device: StripDevice | null) =>
      c('setStripDevice', { venueId, strip, device }),
    cyrano: {
      start: (options: { port?: number; host?: string; competitionId?: string }) =>
        c('startCyranoServer', options),
      stop: () => c('stopCyranoServer', {}),
      status: () => q('getCyranoStatus', {}),
      log: (limit?: number) => q('listCyranoLog', limit ? { limit } : {}),
    },
    opp2: {
      start: (options: { port?: number; competitionId?: string }) => c('startOpp2Broker', options),
      stop: () => c('stopOpp2Broker', {}),
      status: () => q('getOpp2Status', {}),
    },
    routes: () => q('listStripDeviceRoutes', {}),
    setOptions: (options: StripDeviceOptions) => c('setStripDeviceOptions', options),
    action: async (piste: string, action: StripDeviceAction) =>
      (await c('runStripDeviceAction', { piste, action })).done,
    // ── Pilotage de la salle hors compétition (#2117) ──
    control: {
      list: (venueId: string) => q('listVenueStripControl', { venueId }),
      send: (venueId: string, strips: number[] | 'all', request: StripDisplayRequest) =>
        c('sendStripDisplay', { venueId, strips, ...request }),
      /** Accusés et liaisons qui changent ; renvoie la fonction de désabonnement */
      onChange: (cb: (event: StripControlChange) => void): (() => void) => {
        try {
          return client.subscribe('onStripControlChanged', {}, cb);
        } catch {
          // Hors Electron (pas de pont) : aucun avis
          return () => undefined;
        }
      },
    },
    // ── Déclaration en masse (#2117) ──
    setStripDevices: (venueId: string, devices: StripDeviceDeclaration[]) =>
      c('setStripDevices', { venueId, devices }),
    getStripDevicesFile: (venueId: string) => q('getStripDevicesFile', { venueId }),
    importStripDevices: (venueId: string, content: string, dryRun = false) =>
      c('importStripDevices', { venueId, content, dryRun }),
  };
}

export type DevicesApi = ReturnType<typeof createDevicesApi>;

/** API des appareils de l'écran, sur le client du contrat */
export function useDevicesApi(): DevicesApi {
  const client = useBpmClient();
  return useMemo(() => createDevicesApi(client), [client]);
}

/** API des appareils hors React : client par défaut */
export const devicesApi: DevicesApi = createDevicesApi(defaultBpmClient);
