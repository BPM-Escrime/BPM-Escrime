/**
 * Serveur distant (#1981 lot 2, docs/adr/0022) : chaque appel de l'écran donne une entrée que le
 * schéma zod de l'opération du contrat accepte ; un refus du contrat revient sous l'ancienne
 * enveloppe `{ success: false, error }` ; les avis sont filtrés par genre.
 */
import { describe, expect, it } from 'vitest';
import { contract, type OperationName } from '../../shared/api/contract';
import { trainingOperations } from '../../shared/api/contractTraining';
import { devicesOperations } from '../../shared/api/contractDevices';
import { ApiError, type ApiBridge } from '../../shared/api/client';
import type { Fencer } from '../../shared/types';
import { IpcClient } from './IpcClient';
import { createRemoteApi } from './remoteApi';
import { eventfulBridge } from '../testUtils/stationBridge';

const seen: Array<{ name: string; input: unknown }> = [];
/** Réponse du pont par opération ; absente : succès sans valeur */
let replies: Record<string, () => unknown> = {};
const bridge: ApiBridge = {
  invoke: async (name, input) => {
    seen.push({ name, input });
    const def = contract[name as OperationName];
    if (!def) return { ok: false, error: { code: 'unknown_operation', message: name } };
    const parsed = def.input.safeParse(input ?? {});
    if (!parsed.success) {
      return { ok: false, error: { code: 'invalid_input', message: parsed.error.message } };
    }
    try {
      return { ok: true, data: replies[name]?.() ?? null };
    } catch (e) {
      if (e instanceof ApiError) return { ok: false, error: e.toJSON() };
      throw e;
    }
  },
  subscribe: async () => ({ ok: true, data: null }),
  unsubscribe: () => undefined,
  onEvent: () => () => undefined,
};
const api = createRemoteApi(new IpcClient(() => bridge));

const theme = {
  id: 'custom-1',
  name: 'Nuit',
  targetType: 'arena' as const,
  variables: { '--bg': '#000' },
};
const fencer = { id: 'f1', lastName: 'DUPONT', firstName: 'Alice' } as unknown as Fencer;
const note = { type: 'free' as const, message: 'Pause', createdAt: '2026-11-22T10:00:00Z' };
const kiosk = {
  poules: true,
  classement: true,
  final: false,
  direct: true,
  suivants: true,
  tableau: true,
  rotationSec: 15,
};

const CALLS: Array<[string, () => Promise<unknown>]> = [
  ['getNetworkInterfaces', () => api.getNetworkInterfaces()],
  ['startServer', () => api.startServer('c1', 8066, '0.0.0.0', true)],
  ['startServer (défauts)', () => api.startServer('c1')],
  ['stopServer', () => api.stopServer('c1')],
  ['reloadServer', () => api.reloadServer('c1', { port: 9000, host: '10.0.0.1', useHttps: false })],
  ['reloadServer (sans options)', () => api.reloadServer('c1')],
  ['getServerInfo', () => api.getServerInfo('c1')],
  ['getCertFingerprint', () => api.getCertFingerprint()],
  ['firewallCheck', () => api.firewallCheck(8066)],
  [
    'startSession',
    () => api.startSession('c1', 4, [{ id: 'm1' }], true, { poules: true, direct: false }, false),
  ],
  ['stopSession', () => api.stopSession('c1')],
  ['launchCompetition', () => api.launchCompetition('c1')],
  ['getSession', () => api.getSession('c1')],
  ['getArenas', () => api.getArenas('c1')],
  ['updateStripCount', () => api.updateStripCount('c1', 6)],
  ['updateShowPhotos', () => api.updateShowPhotos('c1', true)],
  ['updateCardAnnounce', () => api.updateCardAnnounce('c1', false)],
  ['setActiveWave', () => api.setActiveWave('c1', ['m1', 'm2'], true)],
  ['setActiveWave (toutes)', () => api.setActiveWave('c1', null)],
  ['updateMatchArena', () => api.updateMatchArena('c1', 'm1', null, 3, fencer, null)],
  ['setTeamArenaMatch', () => api.setTeamArenaMatch('c1', 'arena1', 'tm1', false)],
  ['clearTeamArenaMatch', () => api.clearTeamArenaMatch('c1', 'arena1')],
  [
    'requestMatchSignature',
    () =>
      api.requestMatchSignature('c1', 'arena1', {
        match: {
          id: 'm1',
          fencerA: { id: 'a', firstName: 'A', lastName: 'A' },
          fencerB: { id: 'b', firstName: 'B', lastName: 'B' },
        },
        scoreA: 15,
        scoreB: 9,
      }),
  ],
  ['acknowledgeDTCall', () => api.acknowledgeDTCall('c1', 'arena1')],
  ['updatePoolFencers', () => api.updatePoolFencers('c1', [{ poolId: 'p1', fencers: [fencer] }])],
  ['syncPoolMatches', () => api.syncPoolMatches('c1', [{ poolId: 'p1', matches: [{ id: 'm1' }] }])],
  [
    'assignPools',
    () =>
      api.assignPools('c1', [
        { poolId: 'p1', poolNumber: 1, strip: null, fencers: [fencer], matches: [{ id: 'm1' }] },
      ]),
  ],
  ['refreshDeMatches', () => api.refreshDeMatches('c1', [])],
  ['finishPoolMatch', () => api.finishPoolMatch('c1', 'm1', 5, 3, 'A', 'abandon')],
  ['resetPoolMatch', () => api.resetPoolMatch('c1', 'm1')],
  ['setArenaPassword', () => api.setArenaPassword('c1', 'arena1', 'motdepasse')],
  ['setRegistrationEnabled', () => api.setRegistrationEnabled('c1', true)],
  ['setCheckinEnabled', () => api.setCheckinEnabled('c1', true)],
  ['setCheckinPassword', () => api.setCheckinPassword('c1', '')],
  ['setTrainerEnabled', () => api.setTrainerEnabled('c1', false)],
  ['setTrainerPassword', () => api.setTrainerPassword('c1', 'formateurs')],
  ['updateTheme', () => api.updateTheme('c1', 'neon')],
  ['updateArenaTheme', () => api.updateArenaTheme('c1', 'arena1', 'custom', theme)],
  ['clearArenaThemeOverride', () => api.clearArenaThemeOverride('c1', 'arena1')],
  ['updateArenaScreenTheme', () => api.updateArenaScreenTheme('c1', 'arena1', 'public', theme)],
  ['updateKioskViews', () => api.updateKioskViews('c1', { poules: true, final: false })],
  ['updateKioskTheme', () => api.updateKioskTheme('c1', { '--k-preset': 'neon' })],
  ['setWallpaper', () => api.setWallpaper('c1', 'data:image/png;base64,AAA')],
  ['setWallpaper (retirer)', () => api.setWallpaper('c1', null)],
  ['setOrgNote', () => api.setOrgNote('c1', note)],
  [
    'setOrgNote (heure cible)',
    () =>
      api.setOrgNote('c1', {
        ...note,
        type: 'target_time',
        targetTime: '14:30',
        countdownPrefix: 'Reprise',
      }),
  ],
  ['clearOrgNote', () => api.clearOrgNote('c1')],
  ['setWebhookUrl', () => api.setWebhookUrl('https://discord.example/hook')],
  ['setWebhookUrl (retirer)', () => api.setWebhookUrl(null)],
  ['testWebhook', () => api.testWebhook('https://discord.example/hook')],
  ['updateLogo', () => api.updateLogo('data:image/png;base64,AAA')],
  [
    'setTtsConfig',
    () => api.setTtsConfig({ voiceName: null, rate: 1.2, announce: { '30': true, '0': true } }),
  ],
  ['getConnectedClients', () => api.getConnectedClients('c1')],
  [
    'sendClientCommand',
    () => api.sendClientCommand('c1', 's1', { type: 'navigate', url: '/kiosk' }),
  ],
  [
    'broadcastCommand',
    () => api.broadcastCommand('c1', { type: 'message', text: 'Pause', duration: 5000 }),
  ],
  ['renameClient', () => api.renameClient('c1', 's1', 'Entrée')],
  ['identifyClient', () => api.identifyClient('c1', 's1')],
  ['setClientKioskMode', () => api.setClientKioskMode('c1', 's1', kiosk)],
  [
    'setClientKioskMode (aperçu complet)',
    () => api.setClientKioskMode('c1', 's1', { ...kiosk, eta: true }),
  ],
];

describe('remoteApi : entrées du contrat', () => {
  it.each(CALLS)('%s', async (_label, call) => {
    seen.length = 0;
    replies = {};
    const res = await call();
    expect(seen).toHaveLength(1);
    // L'entrée a passé le schéma zod de l'opération (sinon : invalid_input)
    const failure = (res ?? {}) as { success?: boolean; error?: string };
    expect(failure.error ?? '').not.toMatch(/Entrée invalide|invalid_input/);
  });

  it('chaque opération du contrat est atteignable par un appel de l’écran', async () => {
    const called = new Set<string>();
    for (const [, call] of CALLS) {
      seen.length = 0;
      replies = {};
      await call();
      called.add(seen[0].name);
    }
    // Entraînement et appareils de piste (même droit) ont leur couche : trainingApi.test.ts,
    // devicesApi.test.ts
    const ops = (Object.keys(contract) as OperationName[]).filter(
      n =>
        contract[n].permission.startsWith('remote:') &&
        !(n in trainingOperations) &&
        !(n in devicesOperations)
    );
    // Les abonnements ont leurs propres tests ; les autres opérations sont toutes appelées
    const missing = ops.filter(n => contract[n].kind !== 'subscription' && !called.has(n));
    expect(missing).toEqual([]);
  });
});

describe('remoteApi : enveloppe historique', () => {
  it('une réponse est rangée dans son champ', async () => {
    replies = {
      getRemoteServerInfo: () => ({ url: 'https://10.0.0.4:8066', ip: '10.0.0.4', port: 8066 }),
      listRemoteClients: () => [{ socketId: 's1' }],
      getRemoteSession: () => null,
    };
    expect(await api.getServerInfo('c1')).toMatchObject({
      success: true,
      serverInfo: { port: 8066 },
    });
    expect(await api.getConnectedClients('c1')).toMatchObject({
      success: true,
      clients: [{ socketId: 's1' }],
    });
    // Serveur sans session : succès, pas de session
    expect(await api.getSession('c1')).toEqual({ success: true });
  });

  it('un refus du contrat devient success: false, avec le code traduisible', async () => {
    replies = {
      stopRemoteServer: () => {
        throw new ApiError('remote_not_running', 'Saisie distante de l’épreuve non démarrée');
      },
      startRemoteServer: () => {
        throw new ApiError('remote_already_running', 'déjà');
      },
      reloadRemoteServer: () => {
        throw new ApiError('port_in_use', 'Port pris', { port: 9000 });
      },
      setArenaPassword: () => {
        throw new ApiError('weak_password', 'Mot de passe trop court (8 caractères minimum)');
      },
    };
    expect(await api.stopServer('c1')).toEqual({ success: false, error: 'remote_not_started' });
    expect(await api.startServer('c1')).toEqual({
      success: false,
      error: 'remote_already_started',
    });
    expect(await api.reloadServer('c1', { port: 9000 })).toEqual({
      success: false,
      error: 'port_in_use',
      port: 9000,
    });
    expect(await api.setArenaPassword('c1', 'arena1', 'abc')).toEqual({
      success: false,
      error: 'Mot de passe trop court (8 caractères minimum)',
    });
  });

  it('une entrée refusée par le schéma revient avec son message', async () => {
    replies = {};
    const res = await api.reloadServer('c1', { port: 70000 });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/reloadRemoteServer|port|too_big/i);
  });

  it('hors Electron (pas de pont) : success: false, jamais de rejet', async () => {
    const offline = createRemoteApi(new IpcClient(() => undefined));
    expect(await offline.getArenas('c1')).toMatchObject({ success: false });
    expect((await offline.getConnectedClients('c1')).clients).toEqual([]);
    expect(await offline.firewallCheck(8066)).toMatchObject({
      findings: [{ level: 'error', code: 'unreadable' }],
    });
    // Abonnement sans pont : rien à désinscrire
    expect(() => offline.onActivity('match_finished', 'c1', () => undefined)()).not.toThrow();
  });
});

describe('remoteApi : avis', () => {
  it('onActivity ne livre que le genre demandé', () => {
    const events = eventfulBridge({});
    const live = createRemoteApi(new IpcClient(() => events.api));
    const finished: number[] = [];
    const off = live.onActivity('match_finished', 'c1', e => finished.push(e.scoreA));
    events.emit('onRemoteActivity', {
      kind: 'match_finished',
      competitionId: 'c1',
      matchId: 'm1',
      scoreA: 5,
      scoreB: 3,
    });
    events.emit('onRemoteActivity', {
      kind: 'dt_call_cancelled',
      competitionId: 'c1',
      arenaId: 'a',
    });
    events.emit('onRemoteActivity', {
      kind: 'match_finished',
      competitionId: 'c1',
      matchId: 'm2',
      scoreA: 15,
      scoreB: 12,
    });
    off();
    events.emit('onRemoteActivity', {
      kind: 'match_finished',
      competitionId: 'c1',
      matchId: 'm3',
      scoreA: 1,
      scoreB: 0,
    });
    expect(finished).toEqual([5, 15]);
  });

  it('onClientListUpdate livre la liste et l’épreuve du serveur émetteur', () => {
    const events = eventfulBridge({});
    const live = createRemoteApi(new IpcClient(() => events.api));
    const lists: Array<[number, string | null]> = [];
    const off = live.onClientListUpdate((clients, id) => lists.push([clients.length, id]));
    events.emit('onRemoteClients', { competitionId: 'c2', clients: [{}, {}] });
    events.emit('onRemoteClients', { competitionId: null, clients: [] });
    off();
    expect(lists).toEqual([
      [2, 'c2'],
      [0, null],
    ]);
  });
});
