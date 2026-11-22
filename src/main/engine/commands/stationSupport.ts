/**
 * BellePoule Modern - Briques communes des opérations du poste (#1981 lot 2, docs/adr/0022)
 * Type des gestionnaires, refus des dépôts, port du poste.
 * Licensed under GPL-3.0
 */
import type { z } from 'zod';
import type { stationOperations } from '../../../shared/api/contractStation';
import { CommandError, type CommandContext, type StationPort } from './context';
import { refusing, refusingAsync } from './refusal';

type Ops = typeof stationOperations;

/** Gestionnaire d'une opération du poste : types dérivés de son entrée et de sa sortie */
export type StationHandler<N extends keyof Ops> = (
  ctx: CommandContext,
  input: z.output<Ops[N]['input']>
) => z.output<Ops[N]['output']> | Promise<z.output<Ops[N]['output']>>;

/**
 * Les dépôts refusent par une `Error` au message pour l'opérateur (« Salle introuvable »,
 * « Paramètre language invalide »…) : le contrat la rend sous le code `station_refused`,
 * message gardé ; une panne SQLite reste une erreur interne.
 */
export const refuse = <T>(fn: () => T): T => refusing('station_refused', fn);
export const refuseAsync = <T>(fn: () => Promise<T>): Promise<T> =>
  refusingAsync('station_refused', fn);

/** Port du poste ; refus « unavailable » hors du poste Electron (tests, MCP) */
export function portOf(ctx: CommandContext): StationPort {
  if (!ctx.station) throw new CommandError('unavailable', 'Services du poste indisponibles');
  return ctx.station;
}
