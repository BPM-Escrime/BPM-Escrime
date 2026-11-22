/**
 * BellePoule Modern - Adaptateur WebSocket du contrat d'API (#1981 lot 3, docs/adr/0020)
 * Espace de noms Socket.IO `/api` du serveur distant : mêmes messages que l'IPC (api:invoke,
 * api:subscribe / api:unsubscribe, événements sur api:event), même enveloppe ApiEnvelope.
 * Lecture seule jusqu'aux comptes et rôles de #1982, limitée à l'épreuve du serveur.
 * Les données personnelles sont filtrées par l'analyseur Socket.IO du serveur (publicDto).
 * Licensed under GPL-3.0
 */
import type { Namespace, Socket } from 'socket.io';
import { contract, type Permission } from '../../../shared/api/contract';
import {
  ApiError,
  WS_API_EVENTS,
  WS_API_NAMESPACE,
  type ApiEnvelope,
} from '../../../shared/api/client';
import type { CommandContext } from '../commands/context';
import { invokeEnvelope } from './ipcAdapter';
import { isOperation, subscribe, toApiError } from './engine';

export { WS_API_EVENTS, WS_API_NAMESPACE };

/** Droits servis sur le réseau tant que #1982 n'est pas livré (docs/adr/0020) */
export const WS_READ_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'competition:read',
  'cards:read',
]);

/** Abonnements simultanés par socket (borne mémoire) */
export const WS_MAX_SUBSCRIPTIONS = 20;

export interface WsApiOptions {
  /** Épreuve du serveur distant : seule épreuve servie */
  competitionId: string;
  /** Poignée de main acceptée (jeton de l'espace Vue DT, docs/adr/0020) */
  authorize: (handshake: Socket['handshake']) => boolean;
}

/**
 * Refus avant toute validation de l'entrée : commande, droit non servi, autre épreuve.
 * Une opération absente du contrat est laissée au moteur (unknown_operation, comme l'IPC).
 */
export function wsRefusal(name: unknown, input: unknown, competitionId: string): ApiError | null {
  if (!isOperation(name)) return null;
  const def = contract[name];
  if (def.kind === 'command' || !WS_READ_PERMISSIONS.has(def.permission)) {
    return new ApiError('permission_denied', `« ${name} » n'est pas servi sur le réseau`);
  }
  // L'opération doit porter l'épreuve dans son schéma : sinon (ex. getMatchCards par matchId),
  // un competitionId ajouté à l'entrée ne prouverait rien
  const shape = (def.input as { shape?: Record<string, unknown> }).shape;
  const target =
    input && typeof input === 'object' ? (input as { competitionId?: unknown }).competitionId : '';
  if (!shape || !('competitionId' in shape) || target !== competitionId) {
    return new ApiError('permission_denied', 'Épreuve non servie par ce serveur');
  }
  return null;
}

const fail = (e: unknown): ApiEnvelope<never> => ({ ok: false, error: toApiError(e).toJSON() });

/** Accusé de réception Socket.IO, s'il est fourni par le client */
type Ack = (envelope: ApiEnvelope) => void;
const ackOf = (v: unknown): Ack => (typeof v === 'function' ? (v as Ack) : () => undefined);

export function registerWsApi(nsp: Namespace, ctx: CommandContext, opts: WsApiOptions): void {
  nsp.use((socket, next) => {
    if (opts.authorize(socket.handshake)) next();
    else next(new Error('auth_required'));
  });

  nsp.on('connection', socket => {
    const subs = new Map<string, () => void>();
    const release = (id?: string) => {
      for (const [key, off] of subs) {
        if (id !== undefined && key !== id) continue;
        off();
        subs.delete(key);
      }
    };
    socket.on('disconnect', () => release());

    socket.on(WS_API_EVENTS.invoke, async (name: unknown, input: unknown, ack: unknown) => {
      const reply = ackOf(ack);
      const refusal = wsRefusal(name, input, opts.competitionId);
      if (refusal) return reply(fail(refusal));
      try {
        reply(await invokeEnvelope(ctx, name, input));
      } catch (e) {
        reply(fail(e));
      }
    });

    socket.on(
      WS_API_EVENTS.subscribe,
      (id: unknown, name: unknown, input: unknown, ack: unknown) => {
        const reply = ackOf(ack);
        try {
          if (typeof id !== 'string' || !id || id.length > 100) {
            throw new ApiError('invalid_input', 'Identifiant d’abonnement invalide');
          }
          const refusal = wsRefusal(name, input, opts.competitionId);
          if (refusal) throw refusal;
          if (!subs.has(id) && subs.size >= WS_MAX_SUBSCRIPTIONS) {
            throw new ApiError('invalid_input', 'Trop d’abonnements sur cette connexion');
          }
          const off = subscribe(ctx, name, input, event => {
            socket.emit(WS_API_EVENTS.event, id, event);
          });
          subs.get(id)?.();
          subs.set(id, off);
          reply({ ok: true, data: null });
        } catch (e) {
          reply(fail(e));
        }
      }
    );

    socket.on(WS_API_EVENTS.unsubscribe, (id: unknown) => {
      if (typeof id === 'string') release(id);
    });
  });
}
