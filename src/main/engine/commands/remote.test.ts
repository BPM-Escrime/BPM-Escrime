/**
 * Serveur distant par le contrat (#1981 lot 2, docs/adr/0022) : démarrage et arrêt simulés par
 * le port, mots de passe, thèmes, note d'organisation, clients, synchro d'affichage, refus quand
 * le serveur n'est pas démarré, abonnements qui relaient les avis. Sans base : ces opérations
 * n'écrivent aucun fait de l'épreuve (pas de journal).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiError } from '../../../shared/api/client';
import { CommandError, type CommandContext, type RemoteAdminPort } from './context';
import type { RemoteActivity } from '../../../shared/types/remote';
import type { RemoteServerInfo } from '../../../shared/types/preload';
import { invoke, subscribe } from '../api/engine';
import { publishRemoteActivity, publishRemoteClients } from '../api/events';

const INFO: RemoteServerInfo = {
  url: 'https://10.0.0.4:8066',
  ip: '10.0.0.4',
  port: 8066,
  useHttps: true,
};

/** Serveur d'épreuve simulé : chaque méthode est un espion */
function fakeServer() {
  const calls = vi.fn();
  const spy =
    (name: string, result?: unknown) =>
    (...args: unknown[]) => {
      calls(name, ...args);
      return result;
    };
  const clients = [{ socketId: 's1', clientType: 'arena', ip: '10.0.0.9' }];
  return {
    calls,
    server: {
      startSession: spy('startSession', { competitionId: 'c1', strips: [] }),
      stopSession: spy('stopSession'),
      launchCompetition: spy('launchCompetition'),
      getSession: vi.fn(() => ({ competitionId: 'c1', strips: [] })),
      getAllArenas: spy('getAllArenas', [{ id: 'arena1', number: 1 }]),
      updateStripCount: spy('updateStripCount', { competitionId: 'c1', strips: [1, 2] }),
      updateShowPhotos: spy('updateShowPhotos'),
      updateCardAnnounce: spy('updateCardAnnounce'),
      updateTheme: spy('updateTheme'),
      updateArenaTheme: spy('updateArenaTheme'),
      clearArenaThemeOverride: spy('clearArenaThemeOverride'),
      updateKioskViews: spy('updateKioskViews'),
      updateKioskTheme: spy('updateKioskTheme'),
      updateArenaScreenTheme: spy('updateArenaScreenTheme'),
      setArenaPassword: vi.fn((arenaId: string, password: string) => {
        calls('setArenaPassword', arenaId, password);
        if (password && password.length < 8) {
          throw new Error('Mot de passe trop court (8 caractères minimum)');
        }
        if (arenaId === 'arena9') throw new Error('Arène arena9 introuvable');
      }),
      setOrgNote: spy('setOrgNote'),
      clearOrgNote: spy('clearOrgNote'),
      acknowledgeDTCall: spy('acknowledgeDTCall'),
      requestMatchSignature: vi.fn((arenaId: string) => arenaId === 'arena1'),
      updateMatchArena: spy('updateMatchArena'),
      updatePoolFencers: spy('updatePoolFencers'),
      syncPoolMatches: spy('syncPoolMatches'),
      assignPools: spy('assignPools'),
      refreshDeMatches: spy('refreshDeMatches'),
      resetPoolMatch: spy('resetPoolMatch'),
      finishPoolMatch: spy('finishPoolMatch'),
      setTeamArenaMatch: vi.fn((_a: string, matchId: string) => matchId === 'tm1'),
      clearTeamArenaMatch: spy('clearTeamArenaMatch'),
      setWallpaper: spy('setWallpaper'),
      setRegistrationEnabled: spy('setRegistrationEnabled'),
      setCheckinEnabled: spy('setCheckinEnabled'),
      setCheckinPassword: spy('setCheckinPassword'),
      setTrainerEnabled: spy('setTrainerEnabled'),
      setTrainerPassword: spy('setTrainerPassword'),
      clients: {
        list: () => clients,
        send: spy('clients.send'),
        broadcast: spy('clients.broadcast'),
        rename: spy('clients.rename'),
        identify: spy('clients.identify'),
        setKioskMode: spy('clients.setKioskMode'),
      },
    },
  };
}

let fake: ReturnType<typeof fakeServer>;
let running: Set<string>;
let stopped: string[];
let shared: Array<{ setWebhookUrl: ReturnType<typeof vi.fn> }>;
let webhookResult: { success: boolean; status?: number; error?: string };
let waves: unknown[][];
let ctx: CommandContext;

function adminPort(): RemoteAdminPort {
  return {
    networkInterfaces: () => [{ name: 'Toutes les interfaces', address: '0.0.0.0' }],
    start: async (competitionId, options) => {
      if (running.has(competitionId)) {
        throw new CommandError('remote_already_running', 'Saisie distante déjà démarrée');
      }
      if (options.port === 80) throw new ApiError('port_in_use', 'Port pris', { port: 80 });
      running.add(competitionId);
      return { ...INFO, port: options.port ?? INFO.port };
    },
    reload: async (competitionId, options) => {
      if (!running.has(competitionId)) {
        throw new CommandError('remote_not_running', 'Saisie distante de l’épreuve non démarrée');
      }
      return { ...INFO, port: options.port ?? INFO.port };
    },
    info: id => (running.has(id) ? INFO : undefined),
    certFingerprint: async () => 'AA:BB',
    firewallCheck: async port => ({ supported: false, port, networkCategories: [], findings: [] }),
    server: id => (running.has(id) ? (fake.server as never) : undefined),
    servers: () => shared as never,
    setLogo: async () => undefined,
    setTtsConfig: async () => undefined,
    setActiveWave: (competitionId, matchIds, poolsClosed) => {
      waves.push([competitionId, matchIds, poolsClosed]);
    },
    testWebhook: async () => webhookResult,
  };
}

beforeEach(() => {
  fake = fakeServer();
  running = new Set();
  stopped = [];
  shared = [{ setWebhookUrl: vi.fn() }, { setWebhookUrl: vi.fn() }];
  webhookResult = { success: true, status: 204 };
  waves = [];
  ctx = {
    // Journal présent mais jamais touché : une commande du serveur distant n'écrit aucun fait
    db: {
      eventLog: {
        getRevision: () => {
          throw new Error('journal touché');
        },
      },
    } as never,
    remote: {
      stop: id => {
        stopped.push(id);
        running.delete(id);
      },
      settingsChanged: () => undefined,
      admin: adminPort(),
    },
  };
});

const refusal = async (name: string, input: unknown) => {
  try {
    await invoke(ctx, name, input);
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return (e as ApiError).code;
  }
  throw new Error(`« ${name} » devait être refusée`);
};

describe('cycle de vie du serveur', () => {
  it('démarre, rend l’adresse, puis arrête (commandes asynchrones, sans journal)', async () => {
    expect(await invoke(ctx, 'listNetworkInterfaces', {})).toEqual([
      { name: 'Toutes les interfaces', address: '0.0.0.0' },
    ]);
    expect(await invoke(ctx, 'startRemoteServer', { competitionId: 'c1', port: 9000 })).toEqual({
      ...INFO,
      port: 9000,
    });
    expect(await invoke(ctx, 'getRemoteServerInfo', { competitionId: 'c1' })).toEqual(INFO);
    await invoke(ctx, 'stopRemoteServer', { competitionId: 'c1' });
    expect(stopped).toEqual(['c1']);
    expect(await refusal('getRemoteServerInfo', { competitionId: 'c1' })).toBe(
      'remote_not_running'
    );
  });

  it('refuse un double démarrage et un port pris, avec le port en donnée', async () => {
    await invoke(ctx, 'startRemoteServer', { competitionId: 'c1' });
    expect(await refusal('startRemoteServer', { competitionId: 'c1' })).toBe(
      'remote_already_running'
    );
    await expect(
      invoke(ctx, 'startRemoteServer', { competitionId: 'c2', port: 80 })
    ).rejects.toMatchObject({ code: 'port_in_use', data: { port: 80 } });
  });

  it('arrêt d’un serveur absent : remote_not_running', async () => {
    expect(await refusal('stopRemoteServer', { competitionId: 'inconnu' })).toBe(
      'remote_not_running'
    );
  });

  it('rechargement : serveur absent refusé, port hors bornes refusé par le schéma', async () => {
    expect(await refusal('reloadRemoteServer', { competitionId: 'c1', port: 9000 })).toBe(
      'remote_not_running'
    );
    running.add('c1');
    expect(await refusal('reloadRemoteServer', { competitionId: 'c1', port: 70000 })).toBe(
      'invalid_input'
    );
    expect(await invoke(ctx, 'reloadRemoteServer', { competitionId: 'c1', port: 9001 })).toEqual({
      ...INFO,
      port: 9001,
    });
  });

  it('empreinte du certificat et diagnostic du pare-feu', async () => {
    expect(await invoke(ctx, 'getRemoteCertFingerprint', {})).toBe('AA:BB');
    expect(await invoke(ctx, 'getRemoteFirewallDiagnosis', { port: 8066 })).toMatchObject({
      supported: false,
      port: 8066,
    });
    expect(await refusal('getRemoteFirewallDiagnosis', { port: 0 })).toBe('invalid_input');
  });

  it('sans port du poste (MCP, tests) : unavailable', async () => {
    ctx = { ...ctx, remote: { stop: () => undefined, settingsChanged: () => undefined } };
    expect(await refusal('listNetworkInterfaces', {})).toBe('unavailable');
    expect(await refusal('setOrgNote', { competitionId: 'c1', note: orgNote })).toBe('unavailable');
  });
});

describe('session et pistes', () => {
  beforeEach(() => running.add('c1'));

  it('session : démarrage, lecture, nombre de pistes, arrêt', async () => {
    await invoke(ctx, 'startRemoteSession', {
      competitionId: 'c1',
      strips: 4,
      matches: [{ id: 'm1' }, { __poolFencers: true, poolId: 'p1' }],
      showPhotos: true,
      kioskViews: { poules: true, direct: false },
      cardAnnounce: true,
    });
    expect(fake.calls).toHaveBeenCalledWith(
      'startSession',
      'c1',
      4,
      [{ id: 'm1' }, { __poolFencers: true, poolId: 'p1' }],
      true,
      { poules: true, direct: false },
      true
    );
    expect(await invoke(ctx, 'getRemoteSession', { competitionId: 'c1' })).toMatchObject({
      competitionId: 'c1',
    });
    expect(await invoke(ctx, 'setRemoteStripCount', { competitionId: 'c1', count: 2 })).toEqual({
      competitionId: 'c1',
      strips: [1, 2],
    });
    await invoke(ctx, 'stopRemoteSession', { competitionId: 'c1' });
    expect(fake.calls).toHaveBeenCalledWith('stopSession');
  });

  it('serveur sans session : getRemoteSession rend null', async () => {
    fake.server.getSession.mockReturnValueOnce(undefined as never);
    expect(await invoke(ctx, 'getRemoteSession', { competitionId: 'c1' })).toBeNull();
  });

  it('pistes et rencontres d’équipe', async () => {
    expect(await invoke(ctx, 'listRemoteArenas', { competitionId: 'c1' })).toHaveLength(1);
    await invoke(ctx, 'setTeamArenaMatch', {
      competitionId: 'c1',
      arenaId: 'arena1',
      matchId: 'tm1',
      isLaserPoints: false,
    });
    expect(
      await refusal('setTeamArenaMatch', {
        competitionId: 'c1',
        arenaId: 'arena1',
        matchId: 'inconnu',
        isLaserPoints: false,
      })
    ).toBe('match_not_found');
    await invoke(ctx, 'moveMatchToArena', {
      competitionId: 'c1',
      matchId: 'm1',
      fromArena: null,
      toArena: 3,
      fencerA: null,
    });
    expect(fake.calls).toHaveBeenCalledWith(
      'updateMatchArena',
      'm1',
      null,
      3,
      undefined,
      undefined
    );
  });

  it('signature d’un match : piste absente refusée', async () => {
    const request = {
      match: {
        id: 'm1',
        fencerA: { id: 'a', firstName: 'A', lastName: 'A' },
        fencerB: { id: 'b', firstName: 'B', lastName: 'B' },
      },
      scoreA: 15,
      scoreB: 12,
    };
    await invoke(ctx, 'requestMatchSignature', { competitionId: 'c1', arenaId: 'arena1', request });
    expect(
      await refusal('requestMatchSignature', { competitionId: 'c1', arenaId: 'arena7', request })
    ).toBe('strip_not_found');
  });

  it('vague active : mémorisée par le port, même serveur arrêté', async () => {
    await invoke(ctx, 'setActiveWave', { competitionId: 'c2', matchIds: ['m1'] });
    await invoke(ctx, 'setActiveWave', { competitionId: 'c2', matchIds: null, poolsClosed: true });
    expect(waves).toEqual([
      ['c2', ['m1'], false],
      ['c2', null, true],
    ]);
  });
});

describe('synchro d’affichage : l’écran pousse son état, aucun fait écrit', () => {
  beforeEach(() => running.add('c1'));

  it('chaque poussée appelle la méthode du serveur, sans toucher au journal', async () => {
    await invoke(ctx, 'pushPoolFencersToStrips', {
      competitionId: 'c1',
      pools: [{ poolId: 'p1', fencers: [{ id: 'f1' }] }],
    });
    await invoke(ctx, 'pushPoolMatchesToStrips', {
      competitionId: 'c1',
      pools: [{ poolId: 'p1', matches: [{ id: 'm1' }] }],
    });
    await invoke(ctx, 'pushPoolsToStrips', {
      competitionId: 'c1',
      pools: [{ poolId: 'p1', poolNumber: 1, strip: null, matches: [] }],
    });
    await invoke(ctx, 'pushTableauToStrips', { competitionId: 'c1', matches: [] });
    await invoke(ctx, 'pushMatchFinishToStrips', {
      competitionId: 'c1',
      matchId: 'm1',
      scoreA: 5,
      scoreB: 3,
      winner: 'A',
    });
    await invoke(ctx, 'pushMatchResetToStrips', { competitionId: 'c1', matchId: 'm1' });
    const names = fake.calls.mock.calls.map(c => c[0]);
    expect(names).toEqual([
      'updatePoolFencers',
      'syncPoolMatches',
      'assignPools',
      'refreshDeMatches',
      'finishPoolMatch',
      'resetPoolMatch',
    ]);
    expect(fake.calls).toHaveBeenCalledWith('finishPoolMatch', 'm1', 5, 3, 'A', undefined);
  });

  it('fin ou remise à zéro d’un match, serveur absent : rien à prévenir', async () => {
    running.clear();
    await invoke(ctx, 'pushMatchFinishToStrips', {
      competitionId: 'c1',
      matchId: 'm1',
      scoreA: 5,
      scoreB: 3,
    });
    await invoke(ctx, 'pushMatchResetToStrips', { competitionId: 'c1', matchId: 'm1' });
    await invoke(ctx, 'clearTeamArenaMatch', { competitionId: 'c1', arenaId: 'arena1' });
    expect(fake.calls).not.toHaveBeenCalled();
  });

  it('un score hors bornes est refusé par le schéma', async () => {
    expect(
      await refusal('pushMatchFinishToStrips', {
        competitionId: 'c1',
        matchId: 'm1',
        scoreA: -1,
        scoreB: 0,
      })
    ).toBe('invalid_input');
  });
});

describe('mots de passe, inscription, pointage, espace formateurs', () => {
  beforeEach(() => running.add('c1'));

  it('mot de passe de piste : trop court → weak_password, piste inconnue → remote_refused', async () => {
    await invoke(ctx, 'setArenaPassword', {
      competitionId: 'c1',
      arenaId: 'arena1',
      password: 'longmotdepasse',
    });
    expect(
      await refusal('setArenaPassword', { competitionId: 'c1', arenaId: 'arena1', password: 'abc' })
    ).toBe('weak_password');
    await expect(
      invoke(ctx, 'setArenaPassword', { competitionId: 'c1', arenaId: 'arena9', password: '' })
    ).rejects.toMatchObject({ code: 'remote_refused', message: 'Arène arena9 introuvable' });
  });

  it('configureCheckin et configureTrainerSpace : ouverture et mot de passe, ensemble ou séparés', async () => {
    await invoke(ctx, 'configureCheckin', { competitionId: 'c1', enabled: true });
    await invoke(ctx, 'configureCheckin', { competitionId: 'c1', password: 'appel1234' });
    await invoke(ctx, 'configureTrainerSpace', {
      competitionId: 'c1',
      enabled: false,
      password: '',
    });
    await invoke(ctx, 'configureRegistration', { competitionId: 'c1', enabled: true });
    expect(fake.calls.mock.calls).toEqual([
      ['setCheckinEnabled', true],
      ['setCheckinPassword', 'appel1234'],
      ['setTrainerEnabled', false],
      ['setTrainerPassword', ''],
      ['setRegistrationEnabled', true],
    ]);
  });

  it('serveur absent : toutes ces opérations refusent par remote_not_running', async () => {
    running.clear();
    const input = { competitionId: 'c1' };
    const cases: Array<[string, Record<string, unknown>]> = [
      ['setArenaPassword', { ...input, arenaId: 'arena1', password: '' }],
      ['configureCheckin', { ...input, enabled: true }],
      ['configureTrainerSpace', { ...input, enabled: true }],
      ['configureRegistration', { ...input, enabled: true }],
      ['setRemoteTheme', { ...input, theme: 'dark' }],
      ['setKioskViews', { ...input, views: { poules: true } }],
      ['setKioskTheme', { ...input, variables: { '--k-preset': 'neon' } }],
      ['setRemoteWallpaper', { ...input, wallpaper: null }],
      ['clearOrgNote', input],
      ['startRemoteSession', { ...input, strips: 2 }],
      ['stopRemoteSession', input],
      ['launchRemoteCompetition', input],
      ['getRemoteSession', input],
      ['listRemoteArenas', input],
      ['setRemoteStripCount', { ...input, count: 2 }],
      ['pushPoolsToStrips', { ...input, pools: [] }],
      ['sendClientCommand', { ...input, socketId: 's1', command: { type: 'ping' } }],
      ['acknowledgeDtCall', { ...input, arenaId: 'arena1' }],
    ];
    for (const [name, payload] of cases) {
      expect(await refusal(name, payload), name).toBe('remote_not_running');
    }
  });
});

describe('thèmes, kiosque, fond d’écran', () => {
  beforeEach(() => running.add('c1'));
  const theme = {
    id: 'custom-1',
    name: 'Nuit',
    targetType: 'arena' as const,
    variables: { '--bg': '#000' },
  };

  it('thème de l’épreuve, d’une piste et d’un type d’écran', async () => {
    await invoke(ctx, 'setRemoteTheme', { competitionId: 'c1', theme: 'neon' });
    await invoke(ctx, 'setArenaTheme', {
      competitionId: 'c1',
      arenaId: 'arena2',
      theme: 'custom',
      customTheme: theme,
    });
    await invoke(ctx, 'clearArenaThemeOverride', { competitionId: 'c1', arenaId: 'arena2' });
    await invoke(ctx, 'setArenaScreenTheme', {
      competitionId: 'c1',
      arenaId: 'arena2',
      targetType: 'public',
      customTheme: theme,
    });
    expect(fake.calls.mock.calls).toEqual([
      ['updateTheme', 'neon'],
      ['updateArenaTheme', 'arena2', 'custom', theme],
      ['clearArenaThemeOverride', 'arena2'],
      ['updateArenaScreenTheme', 'arena2', 'public', theme],
    ]);
  });

  it('un thème invalide est refusé par le schéma', async () => {
    expect(
      await refusal('setArenaTheme', {
        competitionId: 'c1',
        arenaId: 'arena1',
        theme: 'custom',
        customTheme: { id: 'x' },
      })
    ).toBe('invalid_input');
    expect(await refusal('setRemoteTheme', { competitionId: 'c1', theme: 'rose' })).toBe(
      'invalid_input'
    );
  });

  it('kiosque et fond d’écran', async () => {
    await invoke(ctx, 'setKioskViews', { competitionId: 'c1', views: { poules: true } });
    await invoke(ctx, 'setKioskTheme', {
      competitionId: 'c1',
      variables: { '--k-preset': 'neon' },
    });
    await invoke(ctx, 'setRemoteWallpaper', { competitionId: 'c1', wallpaper: 'data:image/png;x' });
    expect(fake.calls.mock.calls).toEqual([
      ['updateKioskViews', { poules: true }],
      ['updateKioskTheme', { '--k-preset': 'neon' }],
      ['setWallpaper', 'data:image/png;x'],
    ]);
  });
});

const orgNote = {
  type: 'free' as const,
  message: 'Reprise à 14 h',
  createdAt: '2026-11-22T13:00:00.000Z',
};

describe('note d’organisation et avis', () => {
  beforeEach(() => running.add('c1'));

  it('setOrgNote et clearOrgNote : serveur prévenu, avis publié à l’écran', async () => {
    const seen: RemoteActivity[] = [];
    const off = subscribe(ctx, 'onRemoteActivity', { competitionId: 'c1' }, e =>
      seen.push(e as RemoteActivity)
    );
    await invoke(ctx, 'setOrgNote', { competitionId: 'c1', note: orgNote });
    await invoke(ctx, 'clearOrgNote', { competitionId: 'c1' });
    off();
    expect(fake.calls.mock.calls).toEqual([['setOrgNote', orgNote], ['clearOrgNote']]);
    expect(seen).toEqual([
      { kind: 'org_note_changed', competitionId: 'c1', note: orgNote },
      { kind: 'org_note_changed', competitionId: 'c1', note: null },
    ]);
  });

  it('une note aux champs inconnus est refusée', async () => {
    expect(
      await refusal('setOrgNote', { competitionId: 'c1', note: { ...orgNote, html: '<b>' } })
    ).toBe('invalid_input');
  });

  it('onRemoteActivity : filtre par épreuve, livre les avis sans épreuve à tous', () => {
    const forC1: RemoteActivity[] = [];
    const forAll: RemoteActivity[] = [];
    const offC1 = subscribe(ctx, 'onRemoteActivity', { competitionId: 'c1' }, e =>
      forC1.push(e as RemoteActivity)
    );
    const offAll = subscribe(ctx, 'onRemoteActivity', {}, e => forAll.push(e as RemoteActivity));
    const finished = (competitionId: string | null): RemoteActivity => ({
      kind: 'match_finished',
      competitionId,
      matchId: 'm1',
      scoreA: 5,
      scoreB: 3,
    });
    publishRemoteActivity(finished('c1'));
    publishRemoteActivity(finished('c2'));
    publishRemoteActivity(finished(null));
    offC1();
    publishRemoteActivity(finished('c1'));
    offAll();
    expect(forC1.map(e => `${e.kind}:${e.competitionId}`)).toEqual([
      'match_finished:c1',
      'match_finished:null',
    ]);
    expect(forAll).toHaveLength(4);
  });

  it('onRemoteClients relaie la liste des clients du serveur émetteur', () => {
    const seen: unknown[] = [];
    const off = subscribe(ctx, 'onRemoteClients', { competitionId: 'c1' }, e => seen.push(e));
    const clients = [
      {
        socketId: 's1',
        clientType: 'arena' as const,
        ip: '10.0.0.9',
        userAgent: '',
        connectedAt: '',
        lastSeen: '',
      },
    ];
    publishRemoteClients({ competitionId: 'c2', clients: [] });
    publishRemoteClients({ competitionId: 'c1', clients });
    off();
    expect(seen).toEqual([{ competitionId: 'c1', clients }]);
  });
});

describe('clients connectés', () => {
  it('serveur arrêté : aucun client', async () => {
    expect(await invoke(ctx, 'listRemoteClients', { competitionId: 'c1' })).toEqual([]);
  });

  it('liste, commandes, nom, identification, mode kiosque', async () => {
    running.add('c1');
    expect(await invoke(ctx, 'listRemoteClients', { competitionId: 'c1' })).toHaveLength(1);
    await invoke(ctx, 'sendClientCommand', {
      competitionId: 'c1',
      socketId: 's1',
      command: { type: 'navigate', url: '/kiosk' },
    });
    await invoke(ctx, 'broadcastClientCommand', {
      competitionId: 'c1',
      command: { type: 'message', text: 'Pause', duration: 5000 },
    });
    await invoke(ctx, 'renameRemoteClient', {
      competitionId: 'c1',
      socketId: 's1',
      label: 'Entrée',
    });
    await invoke(ctx, 'identifyRemoteClient', { competitionId: 'c1', socketId: 's1' });
    const config = {
      poules: true,
      classement: true,
      final: false,
      direct: true,
      suivants: true,
      tableau: true,
      rotationSec: 15,
    };
    await invoke(ctx, 'setClientKioskMode', { competitionId: 'c1', socketId: 's1', config });
    expect(fake.calls.mock.calls).toEqual([
      ['clients.send', 's1', { type: 'navigate', url: '/kiosk' }],
      ['clients.broadcast', { type: 'message', text: 'Pause', duration: 5000 }],
      ['clients.rename', 's1', 'Entrée'],
      ['clients.identify', 's1'],
      ['clients.setKioskMode', 's1', config],
    ]);
  });

  it('une commande inconnue est refusée par le schéma', async () => {
    running.add('c1');
    expect(
      await refusal('sendClientCommand', {
        competitionId: 'c1',
        socketId: 's1',
        command: { type: 'eval', text: 'x' },
      })
    ).toBe('invalid_input');
  });

  it('commande sur un serveur arrêté : remote_not_running', async () => {
    expect(
      await refusal('renameRemoteClient', { competitionId: 'c1', socketId: 's1', label: 'x' })
    ).toBe('remote_not_running');
  });
});

describe('réglages valables pour tous les serveurs', () => {
  it('webhook poussé à chaque serveur actif', async () => {
    await invoke(ctx, 'setRemoteWebhook', { url: 'https://discord.example/hook' });
    await invoke(ctx, 'setRemoteWebhook', { url: null });
    expect(shared[0].setWebhookUrl.mock.calls).toEqual([['https://discord.example/hook'], [null]]);
    expect(shared[1].setWebhookUrl).toHaveBeenCalledTimes(2);
  });

  it('test du webhook : succès, URL refusée, échec du service', async () => {
    expect(await invoke(ctx, 'testRemoteWebhook', { url: 'https://x.example/h' })).toEqual({
      status: 204,
    });
    webhookResult = { success: false, error: 'invalid_url' };
    expect(await refusal('testRemoteWebhook', { url: 'http://x' })).toBe('invalid_url');
    webhookResult = { success: false, status: 404, error: 'http_404' };
    await expect(
      invoke(ctx, 'testRemoteWebhook', { url: 'https://x.example/h' })
    ).rejects.toMatchObject({ code: 'remote_refused', message: 'http_404' });
  });

  it('logo et synthèse vocale : validés puis confiés au port', async () => {
    // Logo actif : paramètre du poste en base (seule source), puis serveurs actifs
    const updateSettings = vi.fn();
    ctx = { ...ctx, db: { ...(ctx.db as object), settings: { updateSettings } } as never };
    const logo = vi.spyOn(ctx.remote!.admin!, 'setLogo');
    const tts = vi.spyOn(ctx.remote!.admin!, 'setTtsConfig');
    await invoke(ctx, 'setRemoteLogo', { logo: 'data:image/png;base64,AAA' });
    await invoke(ctx, 'setRemoteLogo', { logo: null });
    const config = { voiceName: null, rate: 1, announce: { '30': true, '0': false } };
    await invoke(ctx, 'setTtsConfig', { config });
    expect(logo.mock.calls).toEqual([['data:image/png;base64,AAA'], [null]]);
    expect(updateSettings.mock.calls).toEqual([
      [{ logo: 'data:image/png;base64,AAA' }],
      [{ logo: null }],
    ]);
    expect(tts).toHaveBeenCalledWith(config);
    expect(await refusal('setTtsConfig', { config: { ...config, rate: 12 } })).toBe(
      'invalid_input'
    );
  });
});
