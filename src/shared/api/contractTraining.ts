/**
 * BellePoule Modern - Opérations du serveur d'entraînement (#1981 lot 2, docs/adr/0022)
 * Serveur distant sans épreuve (entraînement, démo autonome, tablettes du Mode Club) : démarrage,
 * session, thème des écrans, historique, écrans de démo. Ce ne sont pas des faits de l'épreuve :
 * aucun journal (docs/adr/0005). Droit `remote:admin` (c'est un serveur distant), jamais servi sur
 * le réseau (WS_READ_PERMISSIONS) et pas d'outil MCP.
 * Sorties typées par les interfaces de shared/types (z.custom, sans contrôle à l'exécution).
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { command, query, subscription } from './contractDef';
import { NetworkOptions } from './contractRemote';
import { Weapon } from '../types';
import type { Arena, RemoteSession } from '../types/remote';
import type { TrainingActivity, TrainingMatchRecord, TrainingServerInfo } from '../types/training';

const Nothing = z.void();

/** Pistes du serveur d'entraînement (le serveur en ouvre 20 au plus) */
const Strips = z.number().int().min(1).max(999);

/** Règles libres du mode entraînement (Sabre Laser personnalisé) et démo autonome */
const CustomRulesSchema = z.strictObject({
  matchDurationSeconds: z.number().min(1).max(86_400),
  allowedZones: z.array(z.string().trim().min(1).max(30)).max(20),
  disableSuddenDeath: z.boolean(),
  demo: z.boolean().optional(),
});

/** Thème intégré uniquement : le moteur le contrôle (isTrainingTheme) et refuse par invalid_theme */
const TrainingThemeSchema = z.string().trim().min(1).max(30);

export const trainingOperations = {
  // ── Serveur ──
  startTrainingServer: command({
    description:
      'Démarre le serveur d’entraînement (tablettes, écrans, sans épreuve) : prochain port libre à partir de `port` (8066 par défaut), interface 0.0.0.0 par défaut, HTTPS avec certificat auto-signé si demandé. Arrêté automatiquement quand la fenêtre principale se ferme ou se recharge. Déjà démarré : training_already_started.',
    input: z.strictObject(NetworkOptions),
    output: z.custom<TrainingServerInfo>(),
    permission: 'remote:admin',
  }),
  stopTrainingServer: command({
    description:
      'Arrête le serveur d’entraînement (démo et écrans de démo compris) et libère son port. Non démarré : training_not_started.',
    input: z.strictObject({}),
    output: Nothing,
    permission: 'remote:admin',
  }),
  getTrainingServerInfo: query({
    description:
      'Adresse du serveur d’entraînement (URL, IP, port, HTTPS, empreinte du certificat). Non démarré : training_not_started.',
    input: z.strictObject({}),
    output: z.custom<TrainingServerInfo>(),
    permission: 'remote:admin',
  }),

  // ── Session ──
  startTrainingSession: command({
    description:
      'Démarre la session d’entraînement : nombre de pistes, arme, règles libres facultatives (durée, zones, mort subite) ou démo (arbitre virtuel). Serveur non démarré : training_not_started.',
    input: z.strictObject({
      strips: Strips,
      weapon: z.enum(Weapon),
      customRules: CustomRulesSchema.optional(),
    }),
    output: z.custom<RemoteSession>(),
    permission: 'remote:admin',
  }),
  stopTrainingSession: command({
    description:
      'Arrête la session d’entraînement (les tablettes sont déconnectées des pistes). Serveur non démarré : training_not_started.',
    input: z.strictObject({}),
    output: Nothing,
    permission: 'remote:admin',
  }),
  getTrainingSession: query({
    description:
      'Session d’entraînement en cours ; null si le serveur tourne sans session ou s’il est arrêté.',
    input: z.strictObject({}),
    output: z.custom<RemoteSession | null>(),
    permission: 'remote:admin',
  }),
  listTrainingArenas: query({
    description:
      'Arènes (pistes) du serveur d’entraînement avec leur match en cours ; liste vide si le serveur est arrêté.',
    input: z.strictObject({}),
    output: z.custom<Arena[]>(),
    permission: 'remote:admin',
  }),
  listTrainingHistory: query({
    description:
      'Historique des matchs terminés de la session d’entraînement ; liste vide si le serveur est arrêté.',
    input: z.strictObject({}),
    output: z.custom<TrainingMatchRecord[]>(),
    permission: 'remote:admin',
  }),
  setTrainingTheme: command({
    description:
      'Thème visuel de tous les écrans d’entraînement (piste, kiosque, tablette d’arbitre, lobby) : dark, light, neon, unicorn ou musketeers. Autre thème : invalid_theme. Serveur non démarré : training_not_started.',
    input: z.strictObject({ theme: TrainingThemeSchema }),
    output: Nothing,
    permission: 'remote:admin',
  }),
  openDemoScreens: command({
    description:
      'Démo autonome : ouvre les écrans arène, tablette d’arbitre et kiosque du serveur d’entraînement dans des fenêtres du poste ; renvoie le nombre de fenêtres ouvertes. Serveur non démarré : training_not_started.',
    input: z.strictObject({ strips: Strips }),
    output: z.custom<{ count: number }>(),
    permission: 'remote:admin',
  }),

  // ── Avis ──
  onTrainingActivity: subscription({
    description:
      'Avis du serveur d’entraînement à l’écran, union typée par `kind` : match fini sur une tablette (dernière ligne de l’historique). Sur un changement de données, l’écran relit.',
    input: z.strictObject({}),
    output: z.custom<TrainingActivity>(),
    permission: 'remote:admin',
  }),
};
