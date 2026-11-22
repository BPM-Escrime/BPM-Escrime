/**
 * BellePoule Modern - Opérations du poste (#1981 lot 2, docs/adr/0022)
 * Réglages du poste et salles, thèmes d'écrans, journée multi-épreuves (arbitres partagés,
 * pistes en temps réel), RGPD (droits des personnes, conservation) et agent MCP.
 * Ce ne sont pas des faits de l'épreuve : aucun journal. Droit `station:admin`, jamais servi
 * sur le réseau (WS_READ_PERMISSIONS) et pas d'outil MCP : l'agent a ses outils d'administration
 * propres, qui n'exposent ni jeton ni réglage du serveur MCP (docs/adr/0022).
 * Sorties typées par les interfaces de shared/types (z.custom, sans contrôle à l'exécution).
 * Hors contrat, car ils ouvrent un dialogue natif ou portent un chemin de fichier (ADR-0021) :
 * settings.addAgentFolder, privacy.exportPerson, exportEncryptedBpm, openEncryptedBpm,
 * cancelEncryptedBpm.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { command, CompetitionId, Id, query, subscription } from './contractDef';
import { Weapon } from '../types';
import { MAX_LOGO_CHARS, MAX_VENUE_STRIPS } from '../types/appSettings';
import type { AppSettings, Venue } from '../types/appSettings';
import type { AgentFolders } from '../types/settingsApi';
import type { CustomTheme } from '../types/remote';
import type {
  DayReferee,
  DayRefereeAssignment,
  DayStripBoard,
  DayStripStatus,
  DaySyncResult,
  EventDay,
  EventDayOverview,
} from '../types/eventDay';
import type {
  PersonalDataExport,
  PrivacyPerson,
  PrivacySettings,
  RetentionCandidates,
  RetentionPurgeResult,
} from '../types/privacy';
import type { McpLogEntry, McpStatus } from '../types/mcp';

const Short = z.string().max(200);
const Nothing = z.void();

// ─── Identifiants ────────────────────────────────────────────────────────────

const VenueId = Id.describe('Identifiant de la salle (listVenues)');
const ThemeId = Id.describe('Identifiant du thème d’écran (listScreenThemes)');
const DayId = Id.describe('Identifiant de la journée (listEventDays)');
const DayRefereeId = Id.describe('Identifiant de l’arbitre de la journée (listEventDayReferees)');

// ─── Réglages du poste et salles ─────────────────────────────────────────────

/** Paramètres du poste modifiables ; `agentFolders` passe par removeAgentFolder et le dialogue natif */
const SettingsPatchSchema = z
  .strictObject({
    language: z.string().max(10),
    theme: z.string().max(64),
    logo: z.string().max(MAX_LOGO_CHARS).nullable(),
    remoteHttps: z.boolean(),
    remoteInterface: z.string().max(45),
    inkSaving: z.boolean(),
  })
  .partial();

/** Paramètre lisible : ceux du poste, plus le nombre de pistes résolu (épreuve → journée → salle) */
const ResolvableKeySchema = z.enum([
  'language',
  'theme',
  'logo',
  'remoteHttps',
  'remoteInterface',
  'agentFolders',
  'inkSaving',
  'stripCount',
]);

const VenueStripSchema = z.object({
  number: z.number().int().min(1).max(MAX_VENUE_STRIPS),
  label: Short.optional(),
  /** Configuration d'un appareil Cyrano (opaque) */
  cyranoConfig: z.record(z.string(), z.unknown()).nullable().optional(),
});

const VenueInputSchema = z.object({
  /** Absent : création */
  id: VenueId.optional(),
  name: Short,
  /** Nombre de pistes (numérotées 1…n) si `strips` est absent */
  stripCount: z.number().int().min(0).max(MAX_VENUE_STRIPS).optional(),
  strips: z.array(VenueStripSchema).max(MAX_VENUE_STRIPS).optional(),
  isDefault: z.boolean().optional(),
});

/** Valeurs de localStorage (clé historique → texte, null : effacée) */
const LegacyValuesSchema = z.record(z.string().max(100), z.string().max(MAX_LOGO_CHARS).nullable());

// ─── Thèmes d'écrans ─────────────────────────────────────────────────────────

const isTheme = (v: unknown): v is CustomTheme => {
  if (!v || typeof v !== 'object') return false;
  const t = v as Partial<Record<keyof CustomTheme, unknown>>;
  return (
    typeof t.id === 'string' &&
    t.id.length > 0 &&
    t.id.length <= 200 &&
    typeof t.name === 'string' &&
    t.name.length <= 500 &&
    !!t.variables &&
    typeof t.variables === 'object' &&
    JSON.stringify(v).length <= 10_000_000
  );
};
const ThemeSchema = z.custom<CustomTheme>(isTheme, 'Thème d’écran invalide');

// ─── Journée multi-épreuves ──────────────────────────────────────────────────

const DayFields = {
  name: Short,
  /** AAAA-MM-JJ */
  date: z.string().max(10),
  stripCount: z.number().int().min(0).max(999).optional(),
};

const DayRefereeFields = {
  firstName: Short.optional(),
  lastName: Short.optional(),
  club: Short.optional(),
  license: Short.optional(),
  category: Short.optional(),
  /** Armes d'arbitrage ; vide : toutes armes */
  weapons: z.array(z.enum(Weapon)).max(10).optional(),
};

/** Réservation d'une piste : champs absents = valeur par défaut (tout autorisé) */
const StripRuleSchema = z.object({
  competitions: z.array(Id).max(500).nullable().optional(),
  pools: z.boolean().optional(),
  tableau: z.boolean().optional(),
  tableauMax: z.number().int().min(2).nullable().optional(),
});

// ─── RGPD ────────────────────────────────────────────────────────────────────

/** Fiches visées : tireurs et membres du club (les identifiants sont revalidés en base) */
const PersonRefFields = {
  fencerIds: z.array(Id).max(1000).optional(),
  memberIds: z.array(Id).max(1000).optional(),
};

const PrivacyPatchSchema = z
  .strictObject({
    nameMasking: z.enum(['full', 'initial', 'initials']),
    competitionRetentionMonths: z.number().int().min(0).max(600),
    memberRetentionMonths: z.number().int().min(0).max(600),
    retentionAction: z.enum(['anonymize', 'delete']),
    autoPurge: z.boolean(),
  })
  .partial();

// ─── Agent MCP ───────────────────────────────────────────────────────────────

const McpPatchSchema = z
  .strictObject({
    enabled: z.boolean(),
    allowWrite: z.boolean(),
    port: z.number().int().min(0).max(65_535),
  })
  .partial();

export const stationOperations = {
  // ── Réglages du poste ──
  getStationSettings: query({
    description:
      'Paramètres du poste enregistrés : langue, thème, logo, serveur distant, économie d’encre.',
    input: z.object({}),
    output: z.custom<AppSettings>(),
    permission: 'station:admin',
  }),
  updateStationSettings: command({
    description:
      'Modifie des paramètres du poste (tout ou rien) ; renvoie les paramètres effectifs. Valeur refusée : station_refused.',
    input: SettingsPatchSchema,
    output: z.custom<AppSettings>(),
    permission: 'station:admin',
  }),
  getResolvedSetting: query({
    description:
      'Valeur effective d’un paramètre pour une épreuve ou une journée (stripCount : journée, sinon salle, sinon salle par défaut).',
    input: z.object({
      key: ResolvableKeySchema,
      competitionId: CompetitionId.optional(),
      eventDayId: DayId.optional(),
    }),
    output: z.unknown(),
    permission: 'station:admin',
  }),
  importLegacySettings: command({
    description:
      'Reprend les réglages de localStorage (clés historiques) : « missing » seulement les clés absentes de la base, « write » écriture courante. Renvoie les clés écrites.',
    input: z.object({ values: LegacyValuesSchema, mode: z.enum(['missing', 'write']) }),
    output: z.array(z.string()),
    permission: 'station:admin',
  }),
  listAgentFolders: query({
    description:
      'Dossiers où l’agent lit des fichiers d’import et écrit des exports ; vide : les dossiers par défaut.',
    input: z.object({}),
    output: z.custom<AgentFolders>(),
    permission: 'station:admin',
  }),
  removeAgentFolder: command({
    description:
      'Retire un dossier de la liste de l’agent. L’ajout passe par le dialogue natif du poste (canal settings:addAgentFolder).',
    input: z.object({ folder: z.string().max(1024) }),
    output: z.custom<AgentFolders>(),
    permission: 'station:admin',
  }),
  onStationSettingsChanged: subscription({
    description:
      'Paramètres du poste modifiés hors de l’écran (agent) : langue et thème sont à relire (getStationSettings).',
    input: z.object({}),
    output: z.object({}),
    permission: 'station:admin',
  }),

  // ── Salles ──
  listVenues: query({
    description: 'Salles déclarées, avec leurs pistes.',
    input: z.object({}),
    output: z.custom<Venue[]>(),
    permission: 'station:admin',
  }),
  saveVenue: command({
    description:
      'Crée une salle (sans id) ou remplace une salle et ses pistes ; la première salle devient celle par défaut.',
    input: VenueInputSchema,
    output: z.custom<Venue>(),
    permission: 'station:admin',
  }),
  deleteVenue: command({
    description: 'Supprime une salle ; les journées et séances qui l’utilisaient n’en ont plus.',
    input: z.object({ venueId: VenueId }),
    output: Nothing,
    permission: 'station:admin',
  }),
  setDefaultVenue: command({
    description: 'Désigne la salle par défaut.',
    input: z.object({ venueId: VenueId }),
    output: Nothing,
    permission: 'station:admin',
  }),

  // ── Thèmes d'écrans ──
  listScreenThemes: query({
    description: 'Thèmes d’écrans enregistrés (arène, kiosque, public, arbitre, poule).',
    input: z.object({}),
    output: z.custom<CustomTheme[]>(),
    permission: 'station:admin',
  }),
  saveScreenTheme: command({
    description: 'Enregistre un thème d’écran : remplace celui de même id, sinon l’ajoute.',
    input: z.object({ theme: ThemeSchema }),
    output: Nothing,
    permission: 'station:admin',
  }),
  deleteScreenTheme: command({
    description: 'Supprime un thème d’écran.',
    input: z.object({ themeId: ThemeId }),
    output: Nothing,
    permission: 'station:admin',
  }),

  // ── Journée multi-épreuves ──
  listEventDays: query({
    description: 'Journées multi-épreuves, avec leurs épreuves rattachées.',
    input: z.object({}),
    output: z.custom<EventDay[]>(),
    permission: 'station:admin',
  }),
  createEventDay: command({
    description:
      'Crée une journée (nom, date, nombre de pistes ; sans pistes, celles de la salle ou de la salle par défaut).',
    input: z.object({ ...DayFields, venueId: VenueId.nullable().optional() }),
    output: z.custom<EventDay>(),
    permission: 'station:admin',
  }),
  updateEventDayDetails: command({
    description:
      'Modifie le nom, la date ou le nombre de pistes d’une journée ; null si elle n’existe pas.',
    input: z.object({ dayId: DayId, details: z.object(DayFields).partial() }),
    output: z.custom<EventDay | null>(),
    permission: 'station:admin',
  }),
  deleteEventDay: command({
    description:
      'Supprime une journée : ses épreuves sont détachées, son groupe d’arbitres est effacé.',
    input: z.object({ dayId: DayId }),
    output: Nothing,
    permission: 'station:admin',
  }),
  assignCompetitionToDay: command({
    description:
      'Rattache une épreuve à une journée (dayId null : la détache). Rattachement : arbitres de l’épreuve importés dans la journée puis reportés dans chaque épreuve.',
    input: z.object({ competitionId: CompetitionId, dayId: DayId.nullable() }),
    output: z.custom<DaySyncResult>(),
    permission: 'station:admin',
  }),
  getEventDayOverview: query({
    description: 'Statut commun des arbitres de la journée (libre, occupé) et conflits.',
    input: z.object({ dayId: DayId }),
    output: z.custom<EventDayOverview>(),
    permission: 'station:admin',
  }),
  listEventDayReferees: query({
    description: 'Arbitres du groupe de la journée, avec leurs armes d’arbitrage.',
    input: z.object({ dayId: DayId }),
    output: z.custom<DayReferee[]>(),
    permission: 'station:admin',
  }),
  registerEventDayReferee: command({
    description: 'Ajoute un arbitre au groupe de la journée.',
    input: z.object({ dayId: DayId, details: z.object(DayRefereeFields) }),
    output: z.custom<DayReferee>(),
    permission: 'station:admin',
  }),
  updateEventDayRefereeDetails: command({
    description: 'Modifie un arbitre du groupe de la journée.',
    input: z.object({ refereeId: DayRefereeId, details: z.object(DayRefereeFields) }),
    output: Nothing,
    permission: 'station:admin',
  }),
  removeEventDayReferee: command({
    description: 'Retire un arbitre du groupe de la journée.',
    input: z.object({ refereeId: DayRefereeId }),
    output: Nothing,
    permission: 'station:admin',
  }),
  syncEventDayReferees: command({
    description:
      'Importe les arbitres des épreuves dans la journée puis reporte le groupe dans chaque épreuve selon son arme.',
    input: z.object({ dayId: DayId }),
    output: z.custom<DaySyncResult>(),
    permission: 'station:admin',
  }),
  listBusyElsewhere: query({
    description:
      'Arbitres de l’épreuve occupés dans une autre épreuve de la même journée, par identifiant d’arbitre de l’épreuve.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.custom<Record<string, DayRefereeAssignment[]>>(),
    permission: 'station:admin',
  }),
  getDayStripBoard: query({
    description:
      'Pistes de la journée en temps réel : occupation par les serveurs distants, réservation, propositions de travail ; null si la journée n’existe pas.',
    input: z.object({ dayId: DayId }),
    output: z.custom<DayStripBoard | null>(),
    permission: 'station:admin',
  }),
  getDayStripOccupation: query({
    description:
      'Occupation des pistes de la salle sur la journée, lue en base (poule ou match en cours).',
    input: z.object({ dayId: DayId }),
    output: z.custom<DayStripStatus[]>(),
    permission: 'station:admin',
  }),
  assignDayStrip: command({
    description:
      'Place sur une piste libre le travail proposé (clé de getDayStripBoard) ; false si refusé (piste occupée, réservée à d’autres).',
    input: z.object({
      dayId: DayId,
      strip: z.number().int().min(1).max(999),
      key: z.string().max(300),
    }),
    output: z.boolean(),
    permission: 'station:admin',
  }),
  setDayStripRule: command({
    description:
      'Réserve une piste (épreuves, poules, tableaux autorisés) ; null : réservation levée. false si la piste n’existe pas.',
    input: z.object({
      dayId: DayId,
      strip: z.number().int().min(1).max(999),
      rule: StripRuleSchema.nullable(),
    }),
    output: z.boolean(),
    permission: 'station:admin',
  }),
  setDayAutoAssign: command({
    description: 'Active ou coupe l’affectation automatique des pistes libres de la journée.',
    input: z.object({ dayId: DayId, on: z.boolean() }),
    output: z.boolean(),
    permission: 'station:admin',
  }),

  // ── RGPD ──
  listPrivacyPersons: query({
    description:
      'Personnes retrouvées par nom, prénom ou licence : leurs fiches tireur et membre du club.',
    input: z.object({ query: z.string().max(1000) }),
    output: z.custom<PrivacyPerson[]>(),
    permission: 'station:admin',
  }),
  getPersonData: query({
    description:
      'Données d’une personne (droit d’accès et de portabilité) : lignes brutes par table.',
    input: z.object(PersonRefFields),
    output: z.custom<PersonalDataExport>(),
    permission: 'station:admin',
  }),
  anonymizePerson: command({
    description:
      'Anonymise une personne dans toutes les épreuves et le club. Refusé par competition_open si une de ses épreuves est ouverte.',
    input: z.object(PersonRefFields),
    output: z.object({ fencers: z.number(), members: z.number(), pseudonym: z.string() }),
    permission: 'station:admin',
  }),
  erasePerson: command({
    description:
      'Efface définitivement une personne (droit à l’effacement). Refusé par competition_open si une de ses épreuves est ouverte.',
    input: z.object(PersonRefFields),
    output: z.object({ fencers: z.number(), members: z.number() }),
    permission: 'station:admin',
  }),
  getPrivacySettings: query({
    description:
      'Réglages RGPD : noms sur le réseau, durées de conservation, action, purge automatique.',
    input: z.object({}),
    output: z.custom<PrivacySettings>(),
    permission: 'station:admin',
  }),
  updatePrivacySettings: command({
    description:
      'Modifie les réglages RGPD ; l’affichage des noms sur le réseau est appliqué à chaud. Renvoie les réglages effectifs.',
    input: PrivacyPatchSchema,
    output: z.custom<PrivacySettings>(),
    permission: 'station:admin',
  }),
  listRetentionCandidates: query({
    description: 'Épreuves et membres inactifs dont la durée de conservation est dépassée.',
    input: z.object({}),
    output: z.custom<RetentionCandidates>(),
    permission: 'station:admin',
  }),
  applyRetention: command({
    description:
      'Applique l’action de conservation (anonymiser ou supprimer) aux seuls identifiants listés (listRetentionCandidates) ; une épreuve ouverte est ignorée.',
    input: z.object({
      competitionIds: z.array(Id).max(5000).optional(),
      memberIds: z.array(Id).max(5000).optional(),
    }),
    output: z.custom<RetentionPurgeResult>(),
    permission: 'station:admin',
  }),

  // ── Agent MCP ──
  getMcpStatus: query({
    description:
      'État du serveur MCP intégré : activation, port, adresse, jeton, erreur de démarrage.',
    input: z.object({}),
    output: z.custom<McpStatus>(),
    permission: 'station:admin',
  }),
  updateMcpSettings: command({
    description:
      'Active ou règle le serveur MCP (port, écriture) puis le démarre, le redémarre ou l’arrête.',
    input: McpPatchSchema,
    output: z.custom<McpStatus>(),
    permission: 'station:admin',
  }),
  regenerateMcpToken: command({
    description: 'Nouveau jeton du serveur MCP : l’ancien est refusé, le serveur redémarre.',
    input: z.object({}),
    output: z.custom<McpStatus>(),
    permission: 'station:admin',
  }),
  listMcpLog: query({
    description: 'Derniers appels reçus par le serveur MCP (200 au plus).',
    input: z.object({}),
    output: z.custom<McpLogEntry[]>(),
    permission: 'station:admin',
  }),
} as const;
