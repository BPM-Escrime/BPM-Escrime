/**
 * BellePoule Modern - Client WebSocket du contrat d'API (#1981 lot 3, docs/adr/0020)
 * Transport navigateur : espace de noms Socket.IO `/api` du serveur distant (wsAdapter).
 * Même interface et mêmes erreurs qu'IpcClient. Un appel fait avant la connexion part à la
 * connexion ; coupure en cours d'appel ou délai dépassé → ApiError('unavailable').
 * Les abonnements sont rouverts à chaque reconnexion.
 * Importé seulement par la vue DT : le bundle de l'écran Electron n'embarque pas socket.io-client.
 * Licensed under GPL-3.0
 */
import { io, type Socket } from 'socket.io-client';
import {
  ApiError,
  unwrap,
  WS_API_EVENTS,
  WS_API_NAMESPACE,
  type ApiEnvelope,
  type BpmClient,
} from '../../shared/api/client';
import { logger, LogCategory } from '../../shared/services/logger';

/** Partie de Socket utilisée (tests : faux socket possible) */
export type WsSocket = Pick<Socket, 'emit' | 'on' | 'off' | 'connected' | 'disconnect'>;

export interface WsClientOptions {
  /** Délai de réponse d'un appel, en ms (10 s par défaut) */
  timeoutMs?: number;
}

interface Subscription {
  name: string;
  input: unknown;
  cb: (event: unknown) => void;
}

const unavailable = (why: string) => new ApiError('unavailable', `Serveur injoignable (${why})`);

let nextId = 0;

export class WsClient implements BpmClient {
  private readonly subs = new Map<string, Subscription>();
  private readonly pending = new Set<(e: ApiError) => void>();
  /** Appels en attente de connexion */
  private readonly queued = new Set<() => void>();
  private readonly timeoutMs: number;

  constructor(
    private readonly socket: WsSocket,
    opts: WsClientOptions = {}
  ) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    socket.on(WS_API_EVENTS.event, (id: string, event: unknown) => this.subs.get(id)?.cb(event));
    // Reconnexion : le serveur a libéré les abonnements du socket précédent
    socket.on('connect', () => {
      for (const [id, s] of this.subs) this.open(id, s);
      for (const emit of [...this.queued]) emit();
    });
    socket.on('disconnect', () => {
      for (const reject of [...this.pending]) reject(unavailable('connexion perdue'));
    });
  }

  private send(name: string, input: unknown): Promise<never> {
    return new Promise<never>((resolve, reject) => {
      const settle = (fn: () => void) => {
        clearTimeout(timer);
        this.pending.delete(fail);
        this.queued.delete(emit);
        fn();
      };
      const fail = (e: ApiError) => settle(() => reject(e));
      const emit = () => {
        this.queued.delete(emit);
        this.pending.add(fail);
        this.socket.emit(WS_API_EVENTS.invoke, name, input, (env: ApiEnvelope) =>
          settle(() => {
            try {
              resolve(unwrap(env) as never);
            } catch (e) {
              reject(e);
            }
          })
        );
      };
      // Pas encore (ou plus) connecté : envoi à la connexion, dans le même délai
      const timer = setTimeout(
        () => fail(unavailable(this.socket.connected ? 'délai dépassé' : 'non connecté')),
        this.timeoutMs
      );
      if (this.socket.connected) emit();
      else this.queued.add(emit);
    });
  }

  call: BpmClient['call'] = (name, input) => this.send(name, input);
  query: BpmClient['query'] = (name, input) => this.send(name, input);

  private open(id: string, s: Subscription) {
    this.socket.emit(WS_API_EVENTS.subscribe, id, s.name, s.input, (env: ApiEnvelope<null>) => {
      if (env && !env.ok && this.subs.get(id) === s) {
        this.subs.delete(id);
        logger.warn(LogCategory.UI, `[api] abonnement ${s.name} refusé : ${env.error.message}`);
      }
    });
  }

  subscribe: BpmClient['subscribe'] = (name, input, cb) => {
    const id = `w${++nextId}`;
    const s: Subscription = { name, input, cb: cb as (event: unknown) => void };
    this.subs.set(id, s);
    if (this.socket.connected) this.open(id, s);
    return () => {
      if (this.subs.get(id) !== s) return;
      this.subs.delete(id);
      if (this.socket.connected) this.socket.emit(WS_API_EVENTS.unsubscribe, id);
    };
  };

  close(): void {
    this.subs.clear();
    this.socket.disconnect();
  }
}

/**
 * Client relié au serveur distant de la page (même origine par défaut). Le jeton de l'espace
 * Vue DT voyage dans le cookie (withCredentials), comme les autres espaces protégés.
 */
export function createWsClient(origin = window.location.origin, opts: WsClientOptions = {}) {
  const socket = io(`${origin}${WS_API_NAMESPACE}`, {
    withCredentials: true,
    reconnectionDelayMax: 5000,
  });
  return new WsClient(socket, opts);
}
