/**
 * BPM - Escrime - Port des appareils de piste (#2117, docs/adr/0023)
 * Branche sur le CommandContext les pilotes Cyrano (serveur UDP) et OPP2 (broker MQTT intégré)
 * et le PisteHub. Remplace les canaux `cyrano:*` et `opp2:*` (ex-ipc/cyranoHandlers.ts,
 * ipc/opp2Handlers.ts). Les tables des pilotes ne viennent plus de l'écran : `reload` relit les
 * appareils déclarés sur les salles des épreuves suivies (épreuve du panneau, épreuves en
 * saisie distante), sinon ceux de la salle par défaut.
 * Licensed under GPL-3.0
 */
import type { DatabaseManager } from '../database';
import type { Venue } from '../shared/types/appSettings';
import {
  driverTables,
  effectiveStripDevices,
  normalizeManualStrips,
} from '../shared/domain/stripDevices/stripDevices';
import { CommandError, type CommandContext, type DevicesPort } from './engine/commands/context';
import { resolveCompetitionVenue } from './engine/commands/devices';
import type { CyranoServer } from './cyrano/server';
import type { MqttBroker } from './opp2/mqttBroker';
import type { Opp2PisteDriver } from './opp2/driver';
import type { PisteHub } from './piste/pisteHub';
import type { StripDeviceOptions } from '../shared/types/stripDevice';
import type { StripControl } from './piste/stripControl';

/** Port MQTT standard (spéc. OPP2 § 4.7) */
export const OPP2_DEFAULT_PORT = 1883;

export interface DevicesPortOptions {
  db: DatabaseManager;
  cyranoServer: CyranoServer;
  broker: MqttBroker;
  opp2Driver: Opp2PisteDriver;
  pisteHub: PisteHub;
  /** Épreuves en saisie distante (identifiants des serveurs distants, hors entraînement) */
  activeCompetitions: () => string[];
  /** Pilotage de la salle hors compétition (#2117) */
  stripControl: StripControl;
  /** Arènes de la séance de chaque épreuve en saisie distante (pistes occupées) */
  activeArenas: () => { competitionId: string; arenas: number[] }[];
}

/** Pistes passées en manuel d'une épreuve (`settings.manualStrips`), lues en base */
export function manualStripsOf(db: Pick<DatabaseManager, 'getCompetition'>, competitionId: string) {
  return normalizeManualStrips(db.getCompetition(competitionId)?.settings?.manualStrips);
}

export function createDevicesPort({
  db,
  cyranoServer,
  broker,
  opp2Driver,
  pisteHub,
  activeCompetitions,
  stripControl,
  activeArenas,
}: DevicesPortOptions): DevicesPort {
  /** Épreuve du panneau de l'écran (dernier démarrage d'un pilote, changement de salle) */
  let focus: string | null = null;
  /** Salle du pilotage hors compétition (#2117) : chargée après celles des épreuves suivies */
  let controlVenue: string | null = null;
  const ctx = { db } as CommandContext;

  /** Salles des épreuves suivies, sans doublon ; aucune : salle par défaut */
  const followedVenues = (): Venue[] => {
    const ids = [...new Set([...(focus ? [focus] : []), ...activeCompetitions()])].filter(
      id => db.getCompetition(id) !== null
    );
    const venues = new Map<string, Venue>();
    for (const id of ids) {
      const resolved = resolveCompetitionVenue(ctx, id);
      if (resolved && !venues.has(resolved.venue.id)) venues.set(resolved.venue.id, resolved.venue);
    }
    if (venues.size === 0) {
      const fallback = db.settings.getDefaultVenue();
      if (fallback) venues.set(fallback.id, fallback);
    }
    // Salle pilotée : les épreuves gardent la priorité sur une piste du pilote en commun
    const controlled = controlVenue ? db.settings.getVenue(controlVenue) : null;
    if (controlled && !venues.has(controlled.id)) venues.set(controlled.id, controlled);
    return [...venues.values()];
  };

  const reload = (next?: string): void => {
    if (next) focus = next;
    const tables = driverTables(followedVenues().flatMap(v => effectiveStripDevices(v.strips)));
    cyranoServer.setPistes(tables.cyrano);
    // Table modifiée serveur démarré : HELLO aussitôt (état de la liaison sans attendre 15 s)
    if (cyranoServer.running) cyranoServer.sendHelloAll();
    opp2Driver.setPistes(tables.opp2);
    pisteHub.setStripNumbers(tables.strips);
    // Pistes manuelles relues, changement de mode d'une piste : affichage renvoyé (#1829)
    pisteHub.refreshManualStrips();
  };

  return {
    reload,
    cyrano: {
      running: () => cyranoServer.running,
      start: async ({ port, host }) => {
        // Interface d'écoute choisie (#1829) ; vide = toutes les interfaces
        if (host !== undefined && !cyranoServer.setHost(host)) {
          throw new CommandError('device_refused', `Interface d’écoute invalide : ${host}`);
        }
        const bound = await cyranoServer.start(port);
        pisteHub.attach();
        return bound;
      },
      stop: async () => {
        // Pistes OPP2 en service (#1960) : le PisteHub reste branché
        if (!broker.running) pisteHub.detach();
        await cyranoServer.stop();
      },
      status: () => {
        const alerts = pisteHub.getAlerts();
        return {
          running: cyranoServer.running,
          port: cyranoServer.port,
          pistes: cyranoServer.getStatuses().map(p => ({ ...p, alert: alerts[p.piste] ?? null })),
        };
      },
      log: () => cyranoServer.getLog(),
    },
    opp2: {
      running: () => broker.running,
      start: async ({ port }) => {
        const bound = await broker.start(port ?? OPP2_DEFAULT_PORT);
        opp2Driver.start();
        pisteHub.attach();
        return bound;
      },
      stop: async () => {
        opp2Driver.stop();
        await broker.stop();
        if (!cyranoServer.running) pisteHub.detach();
      },
      status: () => {
        const alerts = pisteHub.getAlerts();
        return {
          running: broker.running,
          port: broker.port,
          clients: broker.getClients().length,
          unknownPistes: opp2Driver.getUnknownPistes(),
          pistes: opp2Driver.getStatuses().map(p => ({
            piste: p.piste,
            arena: p.arena,
            mode: p.mode,
            status: p.status,
            device: p.device,
            firmware: p.firmware,
            lastSeen: p.lastSeen,
            alert: alerts[p.piste] ?? null,
          })),
        };
      },
    },
    routes: () => pisteHub.getRoutes(),
    setOptions: (options: StripDeviceOptions) => {
      pisteHub.setOptions(options);
      if (options.international !== undefined || options.natSource !== undefined) {
        cyranoServer.getStatuses().forEach(p => pisteHub.clearDispCache(p.piste));
      }
    },
    action: (piste, action) => pisteHub.pisteAction(piste, action),
    control: {
      watchVenue: venueId => {
        if (controlVenue === venueId) return;
        controlVenue = venueId;
        reload();
      },
      activeArenas,
      link: device => {
        if (device.device.protocol === 'cyrano') {
          if (!cyranoServer.running) return null;
          const ip = device.device.ip;
          const status = cyranoServer
            .getStatuses()
            .find(p => p.piste === device.piste && p.ip === ip);
          return status?.status ?? null;
        }
        if (!broker.running) return null;
        return opp2Driver.findPiste(device.piste)?.status ?? null;
      },
      send: (target, panel) => stripControl.send(target, panel),
      last: (piste, match) => stripControl.lastFor(piste, match),
    },
  };
}
