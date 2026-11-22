/**
 * Espace « Vue DT » (docs/adr/0020) : connexion par mot de passe, cookie, poignée de main de
 * /api, fermeture et changement de mot de passe ; commandes configureDtView / getDtViewStatus.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer, type Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { DatabaseManager } from '../../database';
import { hasNodeSqlite } from '../../database/testing/nodeSqliteDatabase';
import { Category, Gender, Weapon } from '../../shared/types';
import { buildDefaultCompetitionSettings } from '../../shared/utils/defaultCompetitionSettings';
import type { ApiEnvelope } from '../../shared/api/client';
import { invoke } from '../engine/api/engine';
import type { CommandContext } from '../engine/commands/context';
import { LoginGuard } from './auth';
import { DT_COOKIE, DtViewAccess } from './dtView';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;
const PASSWORD = 'motdepasse-dt';

let db: DatabaseManager;
let competitionId: string;
let dt: DtViewAccess;
let http: HttpServer;
let server: Server;
let base: string;
let sessionId: string | undefined;
const sockets: ClientSocket[] = [];

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  competitionId = db.createCompetition({
    title: 'Salle',
    date: new Date('2026-12-06'),
    weapon: Weapon.SABRE,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({
      weapon: Weapon.SABRE,
      category: Category.SENIOR,
    }) as never,
  }).id;
  sessionId = competitionId;
  dt = new DtViewAccess();
  const app = express();
  app.use(express.json());
  const guard = new LoginGuard();
  guard.failureDelayMs = 0;
  dt.registerRoutes(app, {
    loginGuard: guard,
    clientIp: () => '192.168.1.20',
    competitionId: () => sessionId,
  });
  http = createServer(app);
  server = new Server(http);
  dt.attach(server, { db, emitChange: () => undefined }, () => sessionId, {
    maxSocketsPerIp: 30,
    eventBurst: 40,
    eventsPerSec: 20,
  });
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await new Promise<void>(r => server.close(() => r()));
  db.close();
});

const login = (password: string) =>
  fetch(`${base}/api/dt/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });

/** Cookie de session renvoyé par une connexion réussie */
async function cookieOf(password = PASSWORD): Promise<string> {
  const res = await login(password);
  expect(res.status).toBe(200);
  const set = res.headers.get('set-cookie') ?? '';
  expect(set).toContain('HttpOnly');
  return set.split(';')[0];
}

function connect(cookie?: string): Promise<ClientSocket> {
  const s = io(`${base}/api`, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: cookie ? { cookie } : {},
  });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

d('espace Vue DT (docs/adr/0020)', () => {
  it('fermé par défaut : connexion refusée, statut', async () => {
    expect(dt.status()).toEqual({ enabled: false, configured: false });
    expect((await login(PASSWORD)).status).toBe(403);
    const status = await (await fetch(`${base}/api/dt/status`)).json();
    expect(status).toEqual({ enabled: false, configured: false, authenticated: false });
  });

  it('mot de passe faux refusé ; juste : cookie, puis /api servi', async () => {
    dt.setPassword(PASSWORD);
    dt.setEnabled(true);
    expect((await login('mauvais-mot')).status).toBe(401);
    await expect(connect()).rejects.toThrow('auth_required');
    const cookie = await cookieOf();
    expect(cookie.startsWith(`${DT_COOKIE}=`)).toBe(true);
    const s = await connect(cookie);
    const r = await new Promise<ApiEnvelope<any>>(res =>
      s.emit('api:invoke', 'getCompetition', { competitionId }, res)
    );
    expect(r).toMatchObject({ ok: true, data: { title: 'Salle' } });
  });

  it('débit limité par IP : 429 au-delà de 60 requêtes par minute', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 61; i++) codes.push((await fetch(`${base}/api/dt/status`)).status);
    expect(codes.slice(0, 60).every(c => c === 200)).toBe(true);
    expect(codes[60]).toBe(429);
  });

  it('page /dt/ : coquille en mémoire avec CSP ; épreuve donnée une fois connecté', async () => {
    const page = await fetch(`${base}/dt/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("script-src 'nonce-");
    const html = await page.text();
    expect(html).toContain('src="/dt/dt.js"');
    expect(html).toMatch(/<script nonce="[^"]+" src="\/dt\/dt\.js">/);

    dt.setPassword(PASSWORD);
    dt.setEnabled(true);
    const anon = await (await fetch(`${base}/api/dt/status`)).json();
    expect(anon).not.toHaveProperty('competitionId');
    const cookie = await cookieOf();
    const logged = await (await fetch(`${base}/api/dt/status`, { headers: { cookie } })).json();
    expect(logged).toMatchObject({ authenticated: true, competitionId });
  });

  it('session non démarrée : rien n’est servi', async () => {
    dt.setPassword(PASSWORD);
    dt.setEnabled(true);
    const s = await connect(await cookieOf());
    sessionId = undefined;
    const r = await new Promise<ApiEnvelope>(res =>
      s.emit('api:invoke', 'getCompetition', { competitionId }, res)
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
  });

  it('fermeture ou nouveau mot de passe : vues déconnectées, jeton invalidé', async () => {
    dt.setPassword(PASSWORD);
    dt.setEnabled(true);
    const cookie = await cookieOf();
    const s = await connect(cookie);
    const gone = new Promise<string>(r => s.once('disconnect', r));
    dt.setPassword('autre-mot-de-passe');
    await gone;
    expect(dt.isAuthorized(cookie)).toBe(false);
    await expect(connect(cookie)).rejects.toThrow('auth_required');

    const fresh = await cookieOf('autre-mot-de-passe');
    const s2 = await connect(fresh);
    const gone2 = new Promise<string>(r => s2.once('disconnect', r));
    dt.setEnabled(false);
    await gone2;
    expect(dt.isAuthorized(fresh)).toBe(false);
  });
});

d('configureDtView, getDtViewStatus (docs/adr/0020)', () => {
  const ctxWith = (port?: DtViewAccess): CommandContext => ({
    db,
    remote: { stop: () => undefined, settingsChanged: () => undefined, dtView: () => port },
  });
  const run = (ctx: CommandContext, op: string, input: Record<string, unknown>) =>
    invoke(ctx, op as never, { competitionId, ...input } as never) as Promise<any>;

  it('serveur arrêté : statut éteint, réglage refusé', async () => {
    const ctx = ctxWith(undefined);
    expect(await run(ctx, 'getDtViewStatus', {})).toEqual({
      running: false,
      enabled: false,
      configured: false,
    });
    await expect(run(ctx, 'configureDtView', { enabled: true })).rejects.toMatchObject({
      code: 'remote_not_running',
    });
  });

  it('ouvrir exige un mot de passe robuste ; dryRun sans effet', async () => {
    const port = new DtViewAccess();
    const ctx = ctxWith(port);
    await expect(run(ctx, 'configureDtView', { enabled: true })).rejects.toMatchObject({
      code: 'weak_password',
    });
    await expect(
      run(ctx, 'configureDtView', { enabled: true, password: 'court' })
    ).rejects.toMatchObject({ code: 'weak_password' });
    expect(
      await run(ctx, 'configureDtView', { enabled: true, password: PASSWORD, dryRun: true })
    ).toEqual({ dryRun: true, enabled: false, configured: false });
    expect(await run(ctx, 'configureDtView', { enabled: true, password: PASSWORD })).toEqual({
      dryRun: false,
      enabled: true,
      configured: true,
    });
    // Retirer le mot de passe d'un espace ouvert : refusé ; le fermer d'abord
    await expect(run(ctx, 'configureDtView', { password: '' })).rejects.toMatchObject({
      code: 'weak_password',
    });
    expect(await run(ctx, 'configureDtView', { enabled: false, password: '' })).toMatchObject({
      enabled: false,
      configured: false,
    });
    expect(await run(ctx, 'getDtViewStatus', {})).toEqual({
      running: true,
      enabled: false,
      configured: false,
    });
  });
});
