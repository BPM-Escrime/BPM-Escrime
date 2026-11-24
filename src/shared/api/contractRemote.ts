/**
 * BPM - Escrime - Opérations du serveur distant (#1981 lot 2, docs/adr/0022)
 * Pilotage du serveur de saisie distante de l'épreuve : démarrage, session, pistes, mots de
 * passe, thèmes d'écrans, note d'organisation, clients connectés, webhook, logo, synthèse
 * vocale. Ce ne sont pas des faits de l'épreuve : aucun journal (docs/adr/0005). Droit
 * `remote:admin`, jamais servi sur le réseau (WS_READ_PERMISSIONS) et pas d'outil MCP : l'agent
 * a ses outils propres (start_remote_session…), qui n'exposent aucun mot de passe.
 *
 * Opérations « push… ToStrips » : l'écran est la source des poules et du tableau, et ces
 * opérations ne font que pousser son état aux tablettes (synchro d'affichage en mémoire du
 * serveur). Elles n'écrivent aucun fait : scores, statuts et composition passent par leurs
 * commandes (recordScore, clearScore…), qui journalisent.
 *
 * Sorties typées par les interfaces de shared/types (z.custom, sans contrôle à l'exécution).
 * Hors contrat : les canaux app:getLogo, app:getLogos, app:saveLogos et app:getTtsConfig
 * (fichiers du poste lus au démarrage de l'écran).
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { command, CompetitionId, Id, query, subscription } from './contractDef';
import { MAX_LOGO_CHARS } from '../types/appSettings';
import type { Fencer } from '../types';
import type {
  Arena,
  FirewallDiagnosis,
  RemoteActivity,
  RemoteClientsEvent,
  RemoteMatchPayload,
  RemoteSession,
} from '../types/remote';
import type { ConnectedClient, RemoteServerInfo } from '../types/preload';
import { ThemeSchema } from './contractStation';

const Nothing = z.void();

// ─── Identifiants et bornes ──────────────────────────────────────────────────

const ArenaId = Id.describe('Identifiant de l’arène (« arena1 », listRemoteArenas)');
const MatchId = Id.describe('Identifiant du match');
const SocketId = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe('Identifiant du client connecté (listRemoteClients)');
const Port = z.number().int().min(1).max(65_535);
const Host = z.string().trim().min(1).max(45);
const Password = z.string().max(200);
/** Éléments poussés par l'écran : jusqu'à 10 000 matchs (grandes épreuves en poules) */
const MAX_PUSHED = 10_000;
/** Image envoyée aux écrans (fond d'écran) : data URL */
const MAX_WALLPAPER_CHARS = 12 * 1024 * 1024;

const isPlainObject = (v: unknown): boolean =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 500;
const PushedItem = z.custom<RemoteMatchPayload>(isPlainObject, 'Élément invalide');
const PushedMatches = z.array(PushedItem).max(MAX_PUSHED);
const PushedFencer = z.custom<Fencer>(isPlainObject, 'Tireur invalide');
const PushedFencers = z.array(PushedFencer).max(2_000);

/** Vues affichées par le kiosque : indicateur par vue */
const KioskViewsSchema = z
  .record(z.string().max(30), z.boolean())
  .refine(r => Object.keys(r).length <= 20, 'Trop de vues');
/** Variables CSS du thème du kiosque */
const CssVariablesSchema = z
  .record(z.string().max(100), z.string().max(2_000))
  .refine(r => Object.keys(r).length <= 500, 'Trop de variables');

const DisplayThemeSchema = z.enum(['dark', 'light', 'neon', 'unicorn', 'custom']);
const ThemeTargetSchema = z.enum(['arena', 'kiosk', 'public', 'referee', 'pool']);

const OrgNoteSchema = z.strictObject({
  type: z.enum(['target_time', 'free']),
  message: z.string().max(2_000),
  targetTime: z.string().max(5).optional(),
  countdownPrefix: z.string().max(100).optional(),
  createdAt: z.string().max(40),
});

const SignatureRequestSchema = z.object({
  match: z.object({
    id: MatchId,
    fencerA: z.object({ id: Id, firstName: z.string().max(200), lastName: z.string().max(200) }),
    fencerB: z.object({ id: Id, firstName: z.string().max(200), lastName: z.string().max(200) }),
  }),
  scoreA: z.number(),
  scoreB: z.number(),
});

/** Commande envoyée à un écran (rafraîchir, naviguer, message, identification, kiosque) */
const ClientCommandSchema = z.strictObject({
  type: z.enum(['refresh', 'navigate', 'message', 'ping', 'identify', 'kiosk:config']),
  url: z.string().max(2_000).optional(),
  text: z.string().max(1_000).optional(),
  duration: z.number().min(0).max(3_600_000).optional(),
  kioskConfig: z
    .strictObject({
      poules: z.boolean(),
      classement: z.boolean(),
      final: z.boolean(),
      direct: z.boolean(),
      suivants: z.boolean(),
      tableau: z.boolean(),
      rotationSec: z.number().min(0).max(3_600),
      eta: z.boolean(),
    })
    .partial()
    .optional(),
  screenLabel: z.string().max(200).optional(),
});

const KioskModeSchema = z.strictObject({
  poules: z.boolean(),
  classement: z.boolean(),
  final: z.boolean(),
  direct: z.boolean(),
  suivants: z.boolean(),
  tableau: z.boolean(),
  rotationSec: z.number().min(0).max(3_600),
  eta: z.boolean().optional(),
});

const TtsConfigSchema = z.strictObject({
  voiceName: z.string().max(300).nullable(),
  rate: z.number().min(0.1).max(4),
  announce: z
    .record(z.string().max(30), z.boolean())
    .refine(r => Object.keys(r).length <= 30, 'Trop de paliers'),
});

/** Réglage réseau du serveur : absent = valeur courante (rechargement) ou par défaut (démarrage) */
export const NetworkOptions = {
  port: Port.optional(),
  host: Host.optional(),
  useHttps: z.boolean().optional(),
};

export const remoteOperations = {
  // ── Cycle de vie du serveur ──
  listNetworkInterfaces: query({
    description:
      'Interfaces réseau d’écoute proposées au serveur distant (« Toutes les interfaces » = 0.0.0.0, puis les IPv4 non locales).',
    input: z.object({}),
    output: z.custom<Array<{ name: string; address: string }>>(),
    permission: 'remote:admin',
  }),
  startRemoteServer: command({
    description:
      'Démarre le serveur distant de l’épreuve (tablettes, écrans) : prochain port libre à partir de `port` (8066 par défaut), interface 0.0.0.0 par défaut, HTTPS avec certificat auto-signé si demandé. Déjà démarré : remote_already_running.',
    input: z.object({ competitionId: CompetitionId, ...NetworkOptions }),
    output: z.custom<RemoteServerInfo>(),
    permission: 'remote:admin',
  }),
  stopRemoteServer: command({
    description: 'Arrête le serveur distant de l’épreuve et libère son port.',
    input: z.object({ competitionId: CompetitionId }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  reloadRemoteServer: command({
    description:
      'Recharge à chaud le serveur distant avec un autre port, une autre interface ou HTTPS, sans perdre la session ni les pistes. Port pris par un autre serveur : port_in_use.',
    input: z.object({ competitionId: CompetitionId, ...NetworkOptions }),
    output: z.custom<RemoteServerInfo>(),
    permission: 'remote:admin',
  }),
  getRemoteServerInfo: query({
    description:
      'Adresse du serveur distant de l’épreuve (URL, IP, port, HTTPS, empreinte du certificat). Non démarré : remote_not_running.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.custom<RemoteServerInfo>(),
    permission: 'remote:admin',
  }),
  getRemoteCertFingerprint: query({
    description: 'Empreinte SHA-256 du certificat TLS auto-signé du poste (généré au besoin).',
    input: z.object({}),
    output: z.string(),
    permission: 'remote:admin',
  }),
  getRemoteFirewallDiagnosis: query({
    description:
      'Diagnostic du pare-feu Windows pour le port du serveur distant (lecture seule ; « supported: false » hors Windows).',
    input: z.object({ port: Port }),
    output: z.custom<FirewallDiagnosis>(),
    permission: 'remote:admin',
  }),

  // ── Session et pistes ──
  startRemoteSession: command({
    description:
      'Démarre la session de saisie distante : nombre de pistes, répartition des matchs fournis (poules et tableau), photos, vues du kiosque, annonce des cartons. Serveur non démarré : remote_not_running.',
    input: z.object({
      competitionId: CompetitionId,
      strips: z.number().int().min(1).max(999),
      matches: PushedMatches.optional(),
      showPhotos: z.boolean().optional(),
      kioskViews: KioskViewsSchema.optional(),
      cardAnnounce: z.boolean().optional(),
    }),
    output: z.custom<RemoteSession>(),
    permission: 'remote:admin',
  }),
  stopRemoteSession: command({
    description:
      'Arrête la session de saisie distante (les tablettes sont déconnectées des pistes).',
    input: z.object({ competitionId: CompetitionId }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  launchRemoteCompetition: command({
    description:
      'Lance l’épreuve sur les tablettes : le premier match de chaque piste est proposé.',
    input: z.object({ competitionId: CompetitionId }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  getRemoteSession: query({
    description:
      'Session de saisie distante en cours ; null si le serveur tourne sans session. Serveur non démarré : remote_not_running.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.custom<RemoteSession | null>(),
    permission: 'remote:admin',
  }),
  listRemoteArenas: query({
    description:
      'Arènes (pistes) du serveur distant avec leur match en cours. Non démarré : remote_not_running.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.custom<Arena[]>(),
    permission: 'remote:admin',
  }),
  setRemoteStripCount: command({
    description:
      'Change le nombre de pistes de la session en cours ; renvoie la session. Les pistes en trop sont retirées si elles sont libres ; null si aucune session n’est en cours.',
    input: z.object({ competitionId: CompetitionId, count: z.number().int().min(1).max(999) }),
    output: z.custom<RemoteSession | null>(),
    permission: 'remote:admin',
  }),
  setRemoteShowPhotos: command({
    description: 'Affiche ou masque les photos des tireurs avant le combat sur les écrans.',
    input: z.object({ competitionId: CompetitionId, value: z.boolean() }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  setRemoteCardAnnounce: command({
    description: 'Active ou coupe l’annonce des cartons avec leur motif sur les écrans.',
    input: z.object({ competitionId: CompetitionId, value: z.boolean() }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  setActiveWave: command({
    description:
      'Tournoi des rapières : matchs de la vague active proposés aux tablettes (null : tous) ; `poolsClosed` : vagues terminées, plus aucun match de poule proposé. Mémorisé même serveur arrêté.',
    input: z.object({
      competitionId: CompetitionId,
      matchIds: z.array(MatchId).max(MAX_PUSHED).nullable(),
      poolsClosed: z.boolean().optional(),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  moveMatchToArena: command({
    description:
      'Déplace un match d’une piste à une autre dans les files du serveur distant (null : retiré des pistes). Ne change aucun score ni statut ; l’affectation des pistes de l’épreuve est celle d’assignMatches.',
    input: z.object({
      competitionId: CompetitionId,
      matchId: MatchId,
      fromArena: z.number().int().min(1).max(999).nullable(),
      toArena: z.number().int().min(1).max(999).nullable(),
      fencerA: PushedFencer.nullable().optional(),
      fencerB: PushedFencer.nullable().optional(),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  setTeamArenaMatch: command({
    description:
      'Place une rencontre d’équipe sur une piste pour la saisie en temps réel (tablette de l’arbitre et affichage de la piste). Rencontre absente : match_not_found.',
    input: z.object({
      competitionId: CompetitionId,
      arenaId: ArenaId,
      matchId: MatchId,
      isLaserPoints: z.boolean(),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  clearTeamArenaMatch: command({
    description: 'Retire la rencontre d’équipe d’une piste (fin de saisie en temps réel).',
    input: z.object({ competitionId: CompetitionId, arenaId: ArenaId }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  requestMatchSignature: command({
    description:
      'Envoie une demande de signature d’un match de tableau à la tablette d’une piste. Piste absente : strip_not_found.',
    input: z.object({
      competitionId: CompetitionId,
      arenaId: ArenaId,
      request: SignatureRequestSchema,
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  acknowledgeDtCall: command({
    description:
      'Acquitte l’appel du DT (carton noir, abandon) affiché sur la tablette de la piste.',
    input: z.object({ competitionId: CompetitionId, arenaId: ArenaId }),
    output: Nothing,
    permission: 'remote:admin',
  }),

  // ── Synchro d'affichage : l'écran pousse son état aux tablettes (aucun fait écrit) ──
  pushPoolFencersToStrips: command({
    description:
      'Pousse aux tablettes la composition des poules (tireurs) : cache du serveur et pistes qui affichent une poule modifiée. La composition elle-même s’écrit par ses commandes (generatePools, addPoolFencer).',
    input: z.object({
      competitionId: CompetitionId,
      pools: z.array(z.object({ poolId: Id, fencers: PushedFencers })).max(1_000),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  pushPoolMatchesToStrips: command({
    description:
      'Pousse aux tablettes les matchs de poule (statuts, scores, arbitres) tels que l’écran les connaît. Les scores s’écrivent par recordScore et clearScore.',
    input: z.object({
      competitionId: CompetitionId,
      pools: z.array(z.object({ poolId: Id, matches: PushedMatches })).max(1_000),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  pushPoolsToStrips: command({
    description:
      'Réassigne les poules aux pistes du serveur pendant une session (poules générées après le démarrage, piste modifiée) : un match en cours n’est jamais retiré, une poule envoyée sur une piste occupée est mise en file.',
    input: z.object({
      competitionId: CompetitionId,
      pools: z
        .array(
          z.object({
            poolId: Id,
            poolNumber: z.number().int().min(0).max(10_000).optional(),
            strip: z.number().int().min(0).max(999).nullable().optional(),
            fencers: PushedFencers.optional(),
            matches: PushedMatches,
          })
        )
        .max(1_000),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  pushTableauToStrips: command({
    description:
      'Pousse aux tablettes les matchs du tableau à jouer (liste vide : plus aucun) sans arrêter la session ; les matchs déjà sur une piste ne sont pas déplacés.',
    input: z.object({ competitionId: CompetitionId, matches: PushedMatches }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  pushMatchFinishToStrips: command({
    description:
      'Informe les tablettes qu’un match de poule saisi à l’écran est terminé (score, vainqueur, statut spécial) : la piste concernée passe à « terminé ». Le score est déjà écrit par recordScore.',
    input: z.object({
      competitionId: CompetitionId,
      matchId: MatchId,
      scoreA: z.number().int().min(0).max(10_000),
      scoreB: z.number().int().min(0).max(10_000),
      winner: z.enum(['A', 'B']).optional(),
      specialStatus: z.enum(['abandon', 'forfait', 'exclusion']).optional(),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  pushMatchResetToStrips: command({
    description:
      'Informe les tablettes qu’un match de poule est remis à zéro à l’écran. Le score est déjà annulé par clearScore.',
    input: z.object({ competitionId: CompetitionId, matchId: MatchId }),
    output: Nothing,
    permission: 'remote:admin',
  }),

  // ── Mots de passe, inscription, pointage, espace formateurs ──
  setArenaPassword: command({
    description:
      'Mot de passe de la tablette d’arbitrage d’une piste (stocké haché ; vide : retiré). Trop court : weak_password.',
    input: z.object({ competitionId: CompetitionId, arenaId: ArenaId, password: Password }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  configureRegistration: command({
    description:
      'Ouvre ou ferme l’inscription des tireurs depuis leur téléphone (page /inscription).',
    input: z.object({ competitionId: CompetitionId, enabled: z.boolean() }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  configureCheckin: command({
    description:
      'Ouvre ou ferme le pointage depuis une tablette (page /pointage) et/ou change son mot de passe (vide : retiré).',
    input: z.object({
      competitionId: CompetitionId,
      enabled: z.boolean().optional(),
      password: Password.optional(),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  configureTrainerSpace: command({
    description:
      'Ouvre ou ferme l’espace formateurs (commentaires d’arbitrage) et/ou change son mot de passe (vide : retiré).',
    input: z.object({
      competitionId: CompetitionId,
      enabled: z.boolean().optional(),
      password: Password.optional(),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),

  // ── Thèmes et affichages ──
  setRemoteTheme: command({
    description: 'Thème visuel des affichages distants de l’épreuve.',
    input: z.object({ competitionId: CompetitionId, theme: DisplayThemeSchema }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  setArenaTheme: command({
    description:
      'Thème d’une piste (« custom » : thème personnalisé joint) ; prime sur le thème de l’épreuve.',
    input: z.object({
      competitionId: CompetitionId,
      arenaId: ArenaId,
      theme: DisplayThemeSchema,
      customTheme: ThemeSchema.optional(),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  clearArenaThemeOverride: command({
    description: 'Retire le thème propre à une piste : elle reprend celui de l’épreuve.',
    input: z.object({ competitionId: CompetitionId, arenaId: ArenaId }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  setArenaScreenTheme: command({
    description:
      'Thème d’un type d’écran d’une piste (public, arbitre, poule…) ; sans thème joint : retiré.',
    input: z.object({
      competitionId: CompetitionId,
      arenaId: ArenaId,
      targetType: ThemeTargetSchema,
      customTheme: ThemeSchema.optional(),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  setKioskViews: command({
    description:
      'Vues affichées en rotation sur les kiosques (poules, classement, direct, suivants…).',
    input: z.object({ competitionId: CompetitionId, views: KioskViewsSchema }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  setKioskTheme: command({
    description: 'Variables CSS du thème du kiosque (ex. « --k-preset »).',
    input: z.object({ competitionId: CompetitionId, variables: CssVariablesSchema }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  setRemoteWallpaper: command({
    description:
      'Fond d’écran des affichages distants (image en data URL ; null : retiré). Serveur non démarré : remote_not_running.',
    input: z.object({
      competitionId: CompetitionId,
      wallpaper: z.string().max(MAX_WALLPAPER_CHARS).nullable(),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  setOrgNote: command({
    description: 'Affiche une note d’organisation sur les kiosques (message libre ou heure cible).',
    input: z.object({ competitionId: CompetitionId, note: OrgNoteSchema }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  clearOrgNote: command({
    description: 'Retire la note d’organisation des kiosques.',
    input: z.object({ competitionId: CompetitionId }),
    output: Nothing,
    permission: 'remote:admin',
  }),

  // ── Réglages valables pour tous les serveurs du poste ──
  setRemoteWebhook: command({
    description:
      'URL du webhook (Discord, Slack) prévenu des fins de match, pour tous les serveurs distants actifs (null : retiré).',
    input: z.object({ url: z.string().max(2_000).nullable() }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  testRemoteWebhook: command({
    description:
      'Envoie un message de test au webhook depuis le poste (la CSP de l’écran bloque les hôtes externes). URL refusée : invalid_url ; échec du service : remote_refused.',
    input: z.object({ url: z.string().max(2_000) }),
    output: z.object({ status: z.number().int().optional() }),
    permission: 'remote:admin',
  }),
  setRemoteLogo: command({
    description:
      'Logo des affichages distants et des impressions (data URL ; null : retiré) : enregistré sur le poste et poussé à tous les serveurs actifs.',
    input: z.object({ logo: z.string().max(MAX_LOGO_CHARS).nullable() }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  setTtsConfig: command({
    description:
      'Synthèse vocale du minuteur des tablettes d’arbitrage (voix, vitesse, paliers annoncés) : enregistrée sur le poste et poussée à tous les serveurs actifs.',
    input: z.object({ config: TtsConfigSchema }),
    output: Nothing,
    permission: 'remote:admin',
  }),

  // ── Clients connectés (écrans, tablettes) ──
  listRemoteClients: query({
    description:
      'Écrans et tablettes connectés au serveur distant de l’épreuve (vide si le serveur n’est pas démarré).',
    input: z.object({ competitionId: CompetitionId }),
    output: z.custom<ConnectedClient[]>(),
    permission: 'remote:admin',
  }),
  sendClientCommand: command({
    description: 'Envoie une commande à un écran connecté (rafraîchir, naviguer, message, ping).',
    input: z.object({
      competitionId: CompetitionId,
      socketId: SocketId,
      command: ClientCommandSchema,
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  broadcastClientCommand: command({
    description: 'Envoie une commande à tous les écrans connectés.',
    input: z.object({ competitionId: CompetitionId, command: ClientCommandSchema }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  renameRemoteClient: command({
    description:
      'Nomme un écran connecté (le nom survit aux reconnexions et s’affiche sur l’écran).',
    input: z.object({
      competitionId: CompetitionId,
      socketId: SocketId,
      label: z.string().max(200),
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  identifyRemoteClient: command({
    description: 'Fait afficher son nom un instant par un écran connecté, pour le repérer.',
    input: z.object({ competitionId: CompetitionId, socketId: SocketId }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  setClientKioskMode: command({
    description: 'Passe un écran connecté en kiosque avec la configuration de vues donnée.',
    input: z.object({
      competitionId: CompetitionId,
      socketId: SocketId,
      config: KioskModeSchema,
    }),
    output: Nothing,
    permission: 'remote:admin',
  }),

  // ── Avis du serveur distant ──
  onRemoteActivity: subscription({
    description:
      'Avis du serveur distant à l’écran, union typée par `kind` : arène mise à jour, match fini sur une tablette, tireur exclu ou réintégré, pointage, arbitre changé, signatures de poule et de tableau, conflit d’adresse de score, appel du DT et son annulation, note du kiosque, logo chargé. Porte des identifiants et l’état d’affichage ; sur un changement de données, l’écran relit. Sans `competitionId` : toutes les épreuves.',
    input: z.object({ competitionId: CompetitionId.optional() }),
    output: z.custom<RemoteActivity>(),
    permission: 'remote:admin',
  }),
  onRemoteClients: subscription({
    description:
      'Liste des clients connectés modifiée sur un serveur distant (connexion, déconnexion, nom, batterie). Sans `competitionId` : tous les serveurs.',
    input: z.object({ competitionId: CompetitionId.optional() }),
    output: z.custom<RemoteClientsEvent<ConnectedClient>>(),
    permission: 'remote:admin',
  }),
};
