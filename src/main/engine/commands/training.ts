/**
 * BellePoule Modern - Serveur d'entraînement : cycle de vie, session, thème, historique, écrans
 * de démo et avis à l'écran (#1981 lot 2, docs/adr/0022). Reprise des anciens canaux IPC
 * training:* (ipc/trainingHandlers.ts). Le serveur lui-même (registre, ports, certificat, fenêtre
 * principale) passe par le port `ctx.training` branché par main.ts ; pas de journal.
 * Licensed under GPL-3.0
 */
import type { z } from 'zod';
import type { trainingOperations } from '../../../shared/api/contractTraining';
import { isTrainingTheme } from '../../../shared/utils/trainingThemes';
import { onTrainingActivityEvent } from '../api/events';
import { CommandError, type CommandContext, type TrainingPort } from './context';
import { refusing, refusingAsync } from './refusal';

type Ops = typeof trainingOperations;
type TrainingOps = Exclude<keyof Ops, 'onTrainingActivity'>;

type TrainingHandler<N extends TrainingOps> = (
  ctx: CommandContext,
  input: z.output<Ops[N]['input']>
) => z.output<Ops[N]['output']> | Promise<z.output<Ops[N]['output']>>;

/** Port d'entraînement ; refus « unavailable » hors du poste Electron (tests, MCP) */
function portOf(ctx: CommandContext): TrainingPort {
  if (!ctx.training) throw new CommandError('unavailable', 'Services du poste indisponibles');
  return ctx.training;
}

const notStarted = () =>
  new CommandError('training_not_started', 'Serveur d’entraînement non démarré');

/** Serveur d'entraînement ; training_not_started s'il n'est pas démarré */
function serverOf(ctx: CommandContext) {
  const server = portOf(ctx).server();
  if (!server) throw notStarted();
  return server;
}

/**
 * Le serveur refuse par une `Error` au message pour l'opérateur (« Session déjà active ») : le
 * contrat la rend sous `remote_refused`, message gardé. Une panne SQLite reste interne.
 */
export const trainingHandlers: { [N in TrainingOps]: TrainingHandler<N> } = {
  startTrainingServer: (ctx, options) => {
    const port = portOf(ctx);
    if (port.server()) {
      throw new CommandError('training_already_started', 'Serveur d’entraînement déjà démarré');
    }
    return refusingAsync('remote_refused', () => port.start(options));
  },
  stopTrainingServer: ctx => {
    if (!portOf(ctx).stop()) throw notStarted();
  },
  getTrainingServerInfo: ctx => {
    const info = portOf(ctx).info();
    if (!info) throw notStarted();
    return info;
  },
  startTrainingSession: (ctx, { strips, weapon, customRules }) =>
    refusingAsync('remote_refused', () =>
      serverOf(ctx).startTrainingSession(strips, weapon, customRules)
    ),
  stopTrainingSession: ctx => refusing('remote_refused', () => serverOf(ctx).stopTrainingSession()),
  // Serveur arrêté : pas de session, ni d'arènes, ni d'historique (comme l'ancien canal)
  getTrainingSession: ctx => portOf(ctx).server()?.getSession() ?? null,
  listTrainingArenas: ctx => portOf(ctx).server()?.getAllArenas() ?? [],
  listTrainingHistory: ctx => portOf(ctx).server()?.getTrainingHistory() ?? [],
  // Thèmes intégrés uniquement ; le thème est contrôlé avant l'état du serveur
  setTrainingTheme: (ctx, { theme }) => {
    if (!isTrainingTheme(theme)) {
      throw new CommandError('invalid_theme', 'Thème d’entraînement inconnu ou personnalisé');
    }
    const port = portOf(ctx);
    if (!port.server()) throw notStarted();
    refusing('remote_refused', () => port.applyTheme(theme));
  },
  openDemoScreens: (ctx, { strips }) => {
    const port = portOf(ctx);
    if (!port.server()) throw notStarted();
    return { count: refusing('remote_refused', () => port.openDemoScreens(strips)) };
  },
};

/** Abonnement onTrainingActivity : avis du serveur d'entraînement */
export const onTrainingActivity = (
  _ctx: CommandContext,
  _input: Record<string, never>,
  emit: (event: Parameters<Parameters<typeof onTrainingActivityEvent>[0]>[0]) => void
): (() => void) => onTrainingActivityEvent(emit);
