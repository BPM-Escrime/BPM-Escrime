/**
 * BellePoule Modern - Client abstrait du contrat d'API (#1981)
 * L'écran appelle un BpmClient ; IpcClient (Electron) aujourd'hui, WsClient (navigateur) au lot 3.
 * Même forme d'erreur quel que soit le transport : ApiError { code, message }.
 * Licensed under GPL-3.0
 */
import type { CommandName, Input, Output, QueryName, SubscriptionName } from './contract';
import { isApiErrorCode, type ApiErrorCode } from './errors';

export interface BpmClient {
  call<K extends CommandName>(name: K, input: Input<K>): Promise<Output<K>>;
  query<K extends QueryName>(name: K, input: Input<K>): Promise<Output<K>>;
  subscribe<K extends SubscriptionName>(
    name: K,
    input: Input<K>,
    cb: (event: Output<K>) => void
  ): () => void;
}

/** Catalogue des codes : ./errors (ADR-0009) */
export type { ApiErrorCode } from './errors';

export interface ApiErrorData {
  code: ApiErrorCode;
  message: string;
  /** Données de l'erreur (ex. revision_conflict : révision actuelle, événements manquants) */
  data?: unknown;
}

/** Réponse d'un transport : l'IPC Electron perd les classes d'erreur, d'où l'enveloppe */
export type ApiEnvelope<T = unknown> = { ok: true; data: T } | { ok: false; error: ApiErrorData };

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toJSON(): ApiErrorData {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }
}

/** Enveloppe → donnée, ou ApiError levée */
export function unwrap<T>(envelope: ApiEnvelope<T>): T {
  if (envelope && envelope.ok) return envelope.data;
  const error = envelope && !envelope.ok ? envelope.error : undefined;
  // Code inconnu du catalogue (serveur plus récent) : internal, message d'origine gardé
  const code = isApiErrorCode(error?.code) ? error.code : 'internal';
  throw new ApiError(code, error?.message ?? 'Réponse invalide', error?.data);
}

/** Transport IPC du contrat d'API (préload → IpcClient) */
export interface ApiBridge {
  invoke: (name: string, input: unknown) => Promise<ApiEnvelope>;
  subscribe: (id: string, name: string, input: unknown) => Promise<ApiEnvelope<null>>;
  unsubscribe: (id: string) => void;
  onEvent: (callback: (id: string, event: unknown) => void) => () => void;
}

/** Protocole WebSocket du contrat (docs/adr/0020) : espace de noms et messages, comme l'IPC */
export const WS_API_NAMESPACE = '/api';
export const WS_API_EVENTS = {
  invoke: 'api:invoke',
  subscribe: 'api:subscribe',
  unsubscribe: 'api:unsubscribe',
  event: 'api:event',
} as const;
