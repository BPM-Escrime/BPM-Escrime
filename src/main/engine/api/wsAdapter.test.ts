/**
 * Adaptateur WebSocket du contrat (docs/adr/0020) : vrai serveur Socket.IO, analyseur RGPD du
 * serveur distant, base SQLite réelle. Lecture seule, épreuve du serveur seulement.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { Server } from 'socket.io';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import type { ApiEnvelope } from '../../../shared/api/client';
import { createPublicParser, setNameMasking } from '../../remote/publicDto';
import type { CommandContext } from '../commands/context';
import { invokeEnvelope } from './ipcAdapter';
import { publishCompetitionEvent } from './events';
import { registerWsApi, wsRefusal, WS_API_EVENTS, WS_API_NAMESPACE } from './wsAdapter';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

// Client Socket.IO livré avec le serveur (même version), utilisable sous Node
const requireCjs = createRequire(__filename);
const io = requireCjs(
  join(dirname(requireCjs.resolve('socket.io')), '..', 'client-dist', 'socket.io.js')
) as (url: string, opts: Record<string, unknown>) => any;

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;
let competitionId: string;
let other: string;
let http: HttpServer;
let server: Server;
let url: string;
const clients: any[] = [];

const newCompetition = (title: string) =>
  db.createCompetition({
    title,
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    }) as never,
  }).id;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db, emitChange: () => undefined };
  competitionId = newCompetition('Servie');
  other = newCompetition('Autre');
  db.addFencer(competitionId, {
    firstName: 'Léa',
    lastName: 'Dupont',
    license: 'L123',
    birthDate: new Date('2000-01-02'),
  } as never);
  http = createServer();
  server = new Server(http, { parser: createPublicParser(() => false) });
  registerWsApi(server.of(WS_API_NAMESPACE), ctx, {
    competitionId,
    authorize: hs => hs.auth?.token === 'ok',
  });
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(http.address() as { port: number }).port}${WS_API_NAMESPACE}`;
});

afterEach(async () => {
  setNameMasking('full');
  for (const c of clients.splice(0)) c.close();
  await new Promise<void>(r => server.close(() => r()));
  db.close();
});

/** Client connecté (ou refusé : message de connect_error) */
function connect(token = 'ok'): Promise<any> {
  const c = io(url, { transports: ['websocket'], auth: { token }, reconnection: false });
  clients.push(c);
  return new Promise((resolve, reject) => {
    c.once('connect', () => resolve(c));
    c.once('connect_error', (e: Error) => reject(e));
  });
}

const call = (c: any, name: string, input: unknown) =>
  new Promise<ApiEnvelope<any>>(r => c.emit(WS_API_EVENTS.invoke, name, input, r));

d('adaptateur WebSocket du contrat (docs/adr/0020)', () => {
  it('refuse une poignée de main sans jeton valide', async () => {
    await expect(connect('mauvais')).rejects.toThrow('auth_required');
  });

  it('sert une requête de lecture de l’épreuve du serveur', async () => {
    const c = await connect();
    const r = await call(c, 'getCompetition', { competitionId });
    expect(r).toMatchObject({ ok: true, data: { id: competitionId, title: 'Servie' } });
  });

  it('refuse commandes, autres épreuves et entrées sans épreuve (permission_denied)', async () => {
    const c = await connect();
    for (const [name, input] of [
      ['registerFencers', { competitionId, fencers: [{ lastName: 'X' }] }],
      ['getCompetition', { competitionId: other }],
      ['listCompetitions', {}],
    ] as const) {
      const r = await call(c, name, input);
      expect(r).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    }
    expect(db.getFencersByCompetition(competitionId)).toHaveLength(1);
  });

  it('même erreur que l’IPC : opération inconnue, entrée invalide', async () => {
    const c = await connect();
    for (const [name, input] of [
      ['nimporteQuoi', { competitionId }],
      ['getMatchHistory', { competitionId }],
    ] as const) {
      expect(await call(c, name, input)).toEqual(await invokeEnvelope(ctx, name, input));
    }
    expect((await call(c, 'getMatchHistory', { competitionId })).ok).toBe(false);
  });

  it('retire licence et date de naissance, masque les noms selon le réglage RGPD', async () => {
    setNameMasking('initials');
    const c = await connect();
    const r = await call(c, 'listFencers', { competitionId });
    expect(r.ok).toBe(true);
    const [f] = r.ok ? r.data : [];
    expect(f).not.toHaveProperty('license');
    expect(f).not.toHaveProperty('birthDate');
    expect(f.lastName).not.toBe('Dupont');
    // L'IPC garde les données complètes
    const ipc = await invokeEnvelope(ctx, 'listFencers', { competitionId });
    expect(ipc.ok && (ipc.data as any[])[0]).toMatchObject({ lastName: 'Dupont', license: 'L123' });
  });

  it('abonnement : événements de l’épreuve, désabonnement, libération à la déconnexion', async () => {
    const c = await connect();
    const events: unknown[] = [];
    c.on(WS_API_EVENTS.event, (id: string, e: unknown) => events.push([id, e]));
    const ok = await new Promise<ApiEnvelope>(r =>
      c.emit(WS_API_EVENTS.subscribe, 's1', 'onCompetitionEvents', { competitionId }, r)
    );
    expect(ok).toEqual({ ok: true, data: null });
    const denied = await new Promise<ApiEnvelope>(r =>
      c.emit(WS_API_EVENTS.subscribe, 's2', 'onCompetitionEvents', {}, r)
    );
    expect(denied).toMatchObject({ ok: false, error: { code: 'permission_denied' } });

    publishCompetitionEvent({ type: 'fencers:changed', competitionId });
    publishCompetitionEvent({ type: 'fencers:changed', competitionId: other });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual(['s1', { type: 'fencers:changed', competitionId }]);

    c.emit(WS_API_EVENTS.unsubscribe, 's1');
    await call(c, 'getCompetition', { competitionId }); // ordre garanti : désabonnement traité
    publishCompetitionEvent({ type: 'fencers:changed', competitionId });
    await call(c, 'getCompetition', { competitionId });
    expect(events).toHaveLength(1);
  });

  it('wsRefusal : seuls les droits de lecture passent', () => {
    expect(wsRefusal('getCompetitionState', { competitionId }, competitionId)).toBeNull();
    expect(wsRefusal('getCompetitionTimeline', { competitionId }, competitionId)).toBeNull();
    // Requête sans épreuve dans son schéma : refusée, même avec un competitionId ajouté
    expect(wsRefusal('getMatchCards', { competitionId, matchId: 'm1' }, competitionId)?.code).toBe(
      'permission_denied'
    );
    expect(wsRefusal('getCardsByMatchIds', { matchIds: [] }, competitionId)?.code).toBe(
      'permission_denied'
    );
    expect(wsRefusal('recordScore', { competitionId }, competitionId)?.code).toBe(
      'permission_denied'
    );
    expect(wsRefusal('inconnue', {}, competitionId)).toBeNull();
  });
});
