/**
 * BellePoule Modern - Appareils de piste (#2117, docs/adr/0023 ; groupe « appareils » de
 * docs/adr/0022) : déclaration sur la piste de la salle, salle d'une épreuve, appareils
 * effectifs, pilotage des pilotes Cyrano (UDP) et OPP2 (broker MQTT intégré).
 * Ce ne sont pas des faits de l'épreuve : aucun journal. Droit `remote:admin`, jamais servi sur
 * le réseau (WS_READ_PERMISSIONS) et pas d'outil MCP. Le réglage `manualStrips` d'une épreuve
 * passe par updateCompetitionSettings.
 * Sorties typées par les interfaces de shared/types (z.custom, sans contrôle à l'exécution).
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { command, CompetitionId, Id, query, subscription } from './contractDef';
import { MAX_VENUE_STRIPS, type Venue } from '../types/appSettings';
import type {
  CompetitionStripDevices,
  CyranoFrameLog,
  CyranoStatus,
  Opp2Status,
  StripControlChange,
  StripDeviceEntry,
  StripDevicesImportReport,
  StripSendResult,
  VenueStripControl,
} from '../types/stripDevice';

const Nothing = z.void();
const VenueId = Id.describe('Identifiant de la salle (listVenues)');
const Strip = z.number().int().min(1).max(MAX_VENUE_STRIPS).describe('Numéro de piste de la salle');
const Port = z.number().int().min(1).max(65_535);
const Arena = z.number().int().min(1).max(999).optional();
const Mode = z.enum(['master', 'display', 'manual']).optional();

/** Appareil d'une piste de salle : Cyrano (adresse obligatoire) ou OPP2 */
export const StripDeviceSchema = z.discriminatedUnion('protocol', [
  z.object({
    protocol: z.literal('cyrano'),
    ip: z.string().trim().min(1).max(64),
    port: Port.optional(),
    version: z.enum(['auto', 'EFP1', 'EFP1.1']).optional(),
    mode: Mode,
    arena: Arena,
  }),
  z.object({
    protocol: z.literal('opp2'),
    opp2Id: z.string().trim().min(1).max(64).optional(),
    mode: Mode,
    arena: Arena,
  }),
]);

const StartedPort = z.custom<{ port: number }>();

/** Côté d'un affichage libre : champ absent = inchangé, chaîne vide = effacé */
const PanelSide = z.strictObject({
  name: z.string().max(40).optional(),
  nat: z.string().max(20).optional(),
});

/** Déclaration d'une piste dans un envoi en masse ou un fichier d'import */
export const StripDeclarationSchema = z.strictObject({
  strip: Strip,
  label: z.string().max(40).optional(),
  device: StripDeviceSchema.nullable(),
});

export const devicesOperations = {
  // ── Déclaration sur la salle ──
  setStripDevice: command({
    description:
      'Déclare l’appareil de piste (Cyrano : adresse, port, version ; OPP2 : identifiant MQTT ; mode, arène) d’une piste de la salle, ou le retire (`device: null`). Piste absente : créée. Toutes les épreuves et journées de la salle le reprennent. Salle inconnue : venue_not_found.',
    input: z.strictObject({ venueId: VenueId, strip: Strip, device: StripDeviceSchema.nullable() }),
    output: z.custom<Venue>(),
    permission: 'remote:admin',
  }),
  listStripDevices: query({
    description:
      'Pistes de la salle et leur appareil (null : saisie manuelle). Salle inconnue : venue_not_found.',
    input: z.strictObject({ venueId: VenueId }),
    output: z.custom<StripDeviceEntry[]>(),
    permission: 'remote:admin',
  }),
  getCompetitionStripDevices: query({
    description:
      'Appareils effectifs d’une épreuve : salle résolue (la sienne, sinon celle de sa journée, sinon la salle par défaut), appareils de ses pistes, pistes passées en manuel par l’épreuve (`settings.manualStrips`).',
    input: z.strictObject({ competitionId: CompetitionId }),
    output: z.custom<CompetitionStripDevices>(),
    permission: 'remote:admin',
  }),
  setCompetitionVenue: command({
    description:
      'Choisit la salle d’une épreuve (docs/adr/0019, décision 2) ; null : celle de sa journée, sinon la salle par défaut. Les pilotes rechargent les appareils. Renvoie les appareils effectifs.',
    input: z.strictObject({ competitionId: CompetitionId, venueId: VenueId.nullable() }),
    output: z.custom<CompetitionStripDevices>(),
    permission: 'remote:admin',
  }),

  // ── Pilote Cyrano (UDP) ──
  startCyranoServer: command({
    description:
      'Démarre le serveur Cyrano (UDP, 50100 par défaut) sur l’interface `host` (vide : toutes) ; charge les appareils Cyrano des salles des épreuves suivies (`competitionId` et épreuves en saisie distante). Déjà démarré : renvoie son port. Refus (port pris, interface invalide) : device_refused.',
    input: z.strictObject({
      port: Port.optional(),
      host: z.string().trim().max(64).optional(),
      competitionId: CompetitionId.optional(),
    }),
    output: StartedPort,
    permission: 'remote:admin',
  }),
  stopCyranoServer: command({
    description: 'Arrête le serveur Cyrano (sans effet s’il est arrêté).',
    input: z.strictObject({}),
    output: Nothing,
    permission: 'remote:admin',
  }),
  getCyranoStatus: query({
    description:
      'Serveur Cyrano : en marche, port, pistes chargées avec leur liaison, protocole détecté et alerte BAD MATCH.',
    input: z.strictObject({}),
    output: z.custom<CyranoStatus>(),
    permission: 'remote:admin',
  }),
  listCyranoLog: query({
    description: 'Journal des trames Cyrano reçues et envoyées (les plus récentes en dernier).',
    input: z.strictObject({}),
    output: z.custom<CyranoFrameLog[]>(),
    permission: 'remote:admin',
  }),

  // ── Pilote OPP2 (broker MQTT intégré) ──
  startOpp2Broker: command({
    description:
      'Démarre le broker MQTT intégré et le pilote OPP2 (port 1883 par défaut) ; charge les appareils OPP2 des salles des épreuves suivies. Déjà démarré : renvoie son port. Refus : device_refused.',
    input: z.strictObject({ port: Port.optional(), competitionId: CompetitionId.optional() }),
    output: StartedPort,
    permission: 'remote:admin',
  }),
  stopOpp2Broker: command({
    description: 'Arrête le pilote OPP2 et le broker MQTT intégré (sans effet s’il est arrêté).',
    input: z.strictObject({}),
    output: Nothing,
    permission: 'remote:admin',
  }),
  getOpp2Status: query({
    description:
      'Broker OPP2 : en marche, port, clients MQTT, pistes vues mais non déclarées, pistes chargées et leur liaison.',
    input: z.strictObject({}),
    output: z.custom<Opp2Status>(),
    permission: 'remote:admin',
  }),

  // ── Commun aux pilotes ──
  listStripDeviceRoutes: query({
    description:
      'Épreuve suivie par chaque piste du pilote (identifiant de compétition, null : aucune) : celle dont la tablette occupe l’arène.',
    input: z.strictObject({}),
    output: z.custom<Record<string, string | null>>(),
    permission: 'remote:admin',
  }),
  setStripDeviceOptions: command({
    description:
      'Options d’affichage des appareils : longueur des noms (10, 12, 15 ou 20), source de la nationalité (auto, pays, club, région), mode international.',
    input: z.strictObject({
      nameLength: z.union([z.literal(10), z.literal(12), z.literal(15), z.literal(20)]).optional(),
      natSource: z.enum(['auto', 'country', 'club', 'region']).optional(),
      international: z.boolean().optional(),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  runStripDeviceAction: command({
    description:
      'Action de secours sur une piste du pilote : ACK forcé, NEXT, PREV (appareil maître) ou renvoi de l’affichage. Renvoie `done: false` si l’action ne s’applique pas.',
    input: z.strictObject({
      piste: z.string().trim().min(1).max(64),
      action: z.enum(['ack', 'next', 'prev', 'resync']),
    }),
    output: z.custom<{ done: boolean }>(),
    permission: 'remote:admin',
  }),

  // ── Pilotage de la salle hors compétition (#2117) ──
  listVenueStripControl: query({
    description:
      'Grille du pilotage de la salle : pour chaque piste, protocole, liaison (null : pilote arrêté), épreuve en cours qui l’occupe, dernier affichage libre envoyé et son accusé (pending, acked, refused, no_response). Charge les appareils de la salle dans les pilotes. Salle inconnue : venue_not_found.',
    input: z.strictObject({ venueId: VenueId }),
    output: z.custom<VenueStripControl>(),
    permission: 'remote:admin',
  }),
  sendStripDisplay: command({
    description:
      'Affichage libre hors compétition sur plusieurs pistes (`all` : toutes les pistes déclarées) : arme, noms et nationalités (ou clubs) gauche / droite, remise à blanc (`clear`). Champ absent : inchangé ; fusionné avec le dernier envoi. Résultat par piste : sent, busy (épreuve en cours, sauf piste passée en manuel par elle), offline, not_declared, unavailable (pilote arrêté). Ordre d’affichage seulement : aucun fait d’épreuve, aucun journal. Rien à envoyer : invalid_input.',
    input: z.strictObject({
      venueId: VenueId,
      strips: z.union([z.array(Strip).min(1).max(MAX_VENUE_STRIPS), z.literal('all')]),
      weapon: z.enum(['E', 'F', 'S']).optional(),
      left: PanelSide.optional(),
      right: PanelSide.optional(),
      clear: z.boolean().optional(),
    }),
    output: z.custom<StripSendResult[]>(),
    permission: 'remote:admin',
  }),
  onStripControlChanged: subscription({
    description:
      'Avis du pilotage de la salle : accusé d’un affichage libre ou liaison d’un appareil changés (identifiants seulement). L’écran relit listVenueStripControl.',
    input: z.strictObject({}),
    output: z.custom<StripControlChange>(),
    permission: 'remote:admin',
  }),
  setStripDevices: command({
    description:
      'Déclaration en masse des appareils d’une salle (ajout en lot) : chaque piste citée reçoit son appareil (null : retiré) et son libellé s’il est donné ; pistes non citées inchangées, pistes absentes créées. Une seule transaction. Salle inconnue : venue_not_found.',
    input: z.strictObject({
      venueId: VenueId,
      devices: z.array(StripDeclarationSchema).min(1).max(MAX_VENUE_STRIPS),
    }),
    output: z.custom<Venue>(),
    permission: 'remote:admin',
  }),
  // Commande (verbe + objet, docs/adr/0008) bien qu'elle n'écrive rien : une requête commence
  // par get / list, le nom exportStripDevices est celui du ticket
  exportStripDevices: command({
    description:
      'Fichier JSON des appareils de la salle (format bellepoule-strip-devices, version 1), à enregistrer par l’écran ; n’écrit rien. Salle inconnue : venue_not_found.',
    input: z.strictObject({ venueId: VenueId }),
    output: z.custom<{ content: string; fileName: string }>(),
    permission: 'remote:admin',
  }),
  importStripDevices: command({
    description:
      'Import du contenu d’un fichier d’appareils (format courant ou ancien export du panneau Cyrano) : chaque ligne validée par le schéma, erreurs rendues ligne par ligne. Une erreur : rien n’est écrit. `dryRun` : contrôle sans écrire. Fichier illisible : device_refused.',
    input: z.strictObject({
      venueId: VenueId,
      content: z.string().min(1).max(512_000),
      dryRun: z.boolean().optional(),
    }),
    output: z.custom<StripDevicesImportReport>(),
    permission: 'remote:admin',
  }),
};
