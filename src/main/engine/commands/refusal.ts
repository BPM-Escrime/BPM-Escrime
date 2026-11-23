/**
 * BPM - Escrime - Refus des dépôts rendus sous un code du catalogue (docs/adr/0009)
 * Les dépôts refusent par une `Error` au message pour l'opérateur (« Séance fermée »,
 * « Salle introuvable »…) : sans cela l'écran n'afficherait que « Erreur interne ». Une panne
 * de la base (SQLite) reste une erreur interne, journalisée, jamais son texte brut à l'écran.
 * Licensed under GPL-3.0
 */
import { ApiError } from '../../../shared/api/client';
import type { ApiErrorCode } from '../../../shared/api/errors';
import { CommandError } from './context';

export function asRefusal(code: ApiErrorCode, e: unknown): unknown {
  if (e instanceof CommandError || e instanceof ApiError) return e;
  const sqlite = (e as { code?: unknown })?.code;
  if (
    (typeof sqlite === 'string' && sqlite.startsWith('SQLITE')) ||
    (e as Error)?.name === 'SqliteError'
  ) {
    return e;
  }
  return new CommandError(code, e instanceof Error ? e.message : String(e));
}

/** Exécute `fn` en rendant ses refus sous `code` */
export function refusing<T>(code: ApiErrorCode, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw asRefusal(code, e);
  }
}

export async function refusingAsync<T>(code: ApiErrorCode, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw asRefusal(code, e);
  }
}
