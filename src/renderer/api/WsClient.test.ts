// @vitest-environment node
/**
 * WsClient (docs/adr/0020) contre le vrai adaptateur /api : mêmes résultats et erreurs
 * qu'IpcClient, abonnements rouverts à la reconnexion, coupure → unavailable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { io } from 'socket.io-client';
import { DatabaseManager } from '../../database';
import { hasNodeSqlite } from '../../database/testing/nodeSqliteDatabase';
import { Category, Gender, Weapon } from '../../shared/types';
import { buildDefaultCompetitionSettings } from '../../shared/utils/defaultCompetitionSettings';
import { ApiError, WS_API_EVENTS, WS_API_NAMESPACE } from '../../shared/api/client';
import { registerWsApi } from '../../main/engine/api/wsAdapter';
import { publishCompetitionEvent } from '../../main/engine/api/events';
import { WsClient, type WsSocket } from './WsClient';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let competitionId: string;
let http: HttpServer;
let server: Server;
let url: string;
const clients: WsClient[] = [];

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  competitionId = db.createCompetition({
    title: 'Vue DT',
    date: new Date('2026-12-06'),
    weapon: Weapon.FOIL,
    gender: Gender.FEMALE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({
      weapon: Weapon.FOIL,
      category: Category.SENIOR,
    }) as never,
  }).id;
  http = createServer();
  server = new Server(http);
  registerWsApi(
    server.of(WS_API_NAMESPACE),
    { db, emitChange: () => undefined },
    {
      competitionId,
      authorize: () => true,
    }
  );
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(http.address() as { port: number }).port}${WS_API_NAMESPACE}`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await new Promise<void>(r => server.close(() => r()));
  db.close();
});

async function connect(timeoutMs?: number) {
  const socket = io(url, { transports: ['websocket'], reconnectionDelay: 20 });
  const client = new WsClient(socket, { timeoutMs });
  clients.push(client);
  await new Promise<void>(r => socket.once('connect', () => r()));
  return { socket, client };
}

d('WsClient (docs/adr/0020)', () => {
  it('requête servie, erreur du moteur levée en ApiError', async () => {
    const { client } = await connect();
    await expect(client.query('getCompetition', { competitionId })).resolves.toMatchObject({
      id: competitionId,
      title: 'Vue DT',
    });
    const err = await client
      .call('registerFencers', { competitionId, fencers: [{ firstName: 'Y', lastName: 'X' }] })
      .catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('permission_denied');
  });

  it('abonnement : événements reçus, rouvert après reconnexion, puis fermé', async () => {
    const { socket, client } = await connect();
    const got: unknown[] = [];
    const off = client.subscribe('onCompetitionEvents', { competitionId }, e => got.push(e));
    await client.query('getCompetition', { competitionId }); // abonnement traité avant
    publishCompetitionEvent({ type: 'fencers:changed', competitionId });
    await vi.waitFor(() => expect(got).toHaveLength(1));

    // Coupure du transport : reconnexion automatique, abonnement rouvert
    socket.io.engine.close();
    await new Promise<void>(r => socket.once('connect', () => r()));
    await client.query('getCompetition', { competitionId });
    publishCompetitionEvent({ type: 'matches:changed', competitionId });
    await vi.waitFor(() => expect(got).toHaveLength(2));

    off();
    await client.query('getCompetition', { competitionId });
    publishCompetitionEvent({ type: 'fencers:changed', competitionId });
    await client.query('getCompetition', { competitionId });
    expect(got).toHaveLength(2);
  });

  it('abonnement refusé : écouteur retiré', async () => {
    const { client } = await connect();
    const got: unknown[] = [];
    client.subscribe('onCompetitionEvents', {}, e => got.push(e));
    await client.query('getCompetition', { competitionId });
    publishCompetitionEvent({ type: 'fencers:changed', competitionId });
    await client.query('getCompetition', { competitionId });
    expect(got).toHaveLength(0);
  });
});

describe('WsClient : coupures', () => {
  /** Faux socket : connecté ou non, réponses jamais rendues */
  function fakeSocket(connected: boolean) {
    const handlers = new Map<string, (...a: unknown[]) => void>();
    const socket = {
      connected,
      emit: vi.fn(),
      on: (ev: string, h: (...a: unknown[]) => void) => handlers.set(ev, h),
      off: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as WsSocket;
    return { socket, fire: (ev: string, ...a: unknown[]) => handlers.get(ev)?.(...a) };
  }

  it('non connecté : unavailable sans rien envoyer', async () => {
    const { socket } = fakeSocket(false);
    const client = new WsClient(socket);
    await expect(client.query('getCompetition', { competitionId: 'c' })).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('coupure pendant l’appel, ou délai dépassé : unavailable', async () => {
    const { socket, fire } = fakeSocket(true);
    const client = new WsClient(socket, { timeoutMs: 30 });
    const cut = client.query('getCompetition', { competitionId: 'c' });
    fire('disconnect');
    await expect(cut).rejects.toMatchObject({ code: 'unavailable' });
    await expect(client.query('getCompetition', { competitionId: 'c' })).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(socket.emit).toHaveBeenCalledWith(
      WS_API_EVENTS.invoke,
      'getCompetition',
      { competitionId: 'c' },
      expect.any(Function)
    );
  });
});
