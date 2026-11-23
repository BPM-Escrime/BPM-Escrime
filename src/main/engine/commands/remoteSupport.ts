/**
 * BPM - Escrime - Briques communes des opérations du serveur distant (#1981 lot 2,
 * docs/adr/0022) : type des gestionnaires, accès au port, refus rendus sous un code du catalogue.
 * Licensed under GPL-3.0
 */
import type { z } from 'zod';
import type { remoteOperations } from '../../../shared/api/contractRemote';
import { logger, LogCategory, toError } from '../../../shared/services/logger';
import {
  CommandError,
  type CommandContext,
  type RemoteAdminPort,
  type RemoteServerHandle,
} from './context';
import { refusing, refusingAsync } from './refusal';

type Ops = typeof remoteOperations;

/** Gestionnaire d'une commande ou requête du serveur distant : types dérivés du contrat */
export type RemoteHandler<N extends keyof Ops> = (
  ctx: CommandContext,
  input: z.output<Ops[N]['input']>
) => z.output<Ops[N]['output']> | Promise<z.output<Ops[N]['output']>>;

/**
 * Le serveur refuse par une `Error` au message pour l'opérateur (« Arène 9 introuvable »,
 * « Mot de passe trop court… ») : le contrat la rend sous `remote_refused`, message gardé.
 * Une panne SQLite reste une erreur interne.
 */
export const refuse = <T>(fn: () => T): T => refusing('remote_refused', fn);
export const refuseAsync = <T>(fn: () => Promise<T>): Promise<T> =>
  refusingAsync('remote_refused', fn);

/** Comme `refuse`, avec la trace du journal des diagnostics qu'écrivaient les anciens canaux */
export function refuseLogged<T>(label: string, fn: () => T): T {
  try {
    return refuse(fn);
  } catch (e) {
    logger.error(LogCategory.NETWORK, label, toError(e));
    throw e;
  }
}

export async function refuseLoggedAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await refuseAsync(fn);
  } catch (e) {
    logger.error(LogCategory.NETWORK, label, toError(e));
    throw e;
  }
}

/** Port du serveur distant ; refus « unavailable » hors du poste Electron (tests, MCP) */
export function adminOf(ctx: CommandContext): RemoteAdminPort {
  const admin = ctx.remote?.admin;
  if (!admin) throw new CommandError('unavailable', 'Services du poste indisponibles');
  return admin;
}

/** Serveur de l'épreuve ; remote_not_running s'il n'est pas démarré */
export function serverOf(ctx: CommandContext, competitionId: string): RemoteServerHandle {
  const server = adminOf(ctx).server(competitionId);
  if (!server) {
    throw new CommandError('remote_not_running', 'Saisie distante de l’épreuve non démarrée');
  }
  return server;
}

/** Le mot de passe est refusé par le serveur : code `weak_password` */
export function passwordRefusal<T>(fn: () => T): T {
  try {
    return refuse(fn);
  } catch (e) {
    if (e instanceof CommandError && /^Mot de passe/.test(e.message)) {
      throw new CommandError('weak_password', e.message);
    }
    throw e;
  }
}
