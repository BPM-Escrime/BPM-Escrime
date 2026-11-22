import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const { stopSpy, updateThemeSpy, openDemoSpy, closeDemoSpy, setTtsSpy, startSpy } = vi.hoisted(
  () => ({
    stopSpy: vi.fn(),
    updateThemeSpy: vi.fn(),
    openDemoSpy: vi.fn(() => 3),
    closeDemoSpy: vi.fn(),
    setTtsSpy: vi.fn(),
    startSpy: vi.fn(),
  })
);

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('./remoteScoreServer', () => ({
  RemoteScoreServer: class {
    start = startSpy;
    stop = stopSpy;
    setTtsConfig = setTtsSpy;
    getServerUrl = () => 'http://127.0.0.1:8066';
    getLocalIPAddress = () => '127.0.0.1';
  },
}));
vi.mock('./remote/trainingTheme', () => ({
  applyTrainingTheme: (_server: unknown, theme: string) => updateThemeSpy(theme),
}));
vi.mock('./certManager', () => ({ ensureCert: vi.fn() }));
vi.mock('./mainWindowRef', () => ({ setSharedMainWindow: vi.fn() }));
vi.mock('./demoScreens', () => ({ openDemoScreens: openDemoSpy, closeDemoScreens: closeDemoSpy }));

import { createTrainingPort } from './trainingPort';
import { remoteServers, usedPorts } from './remoteRegistry';
import { TRAINING_ID } from './trainingServer';
import type { TrainingPort } from './engine/commands/context';

/** Fenêtre principale factice : événements de fenêtre et de webContents */
function fakeWindow() {
  const win = new EventEmitter() as EventEmitter & {
    webContents: EventEmitter;
    isDestroyed(): boolean;
  };
  win.webContents = new EventEmitter();
  win.isDestroyed = () => false;
  return win;
}

let win: ReturnType<typeof fakeWindow>;
let port: TrainingPort;

beforeEach(async () => {
  remoteServers.clear();
  usedPorts.clear();
  for (const spy of [stopSpy, updateThemeSpy, openDemoSpy, closeDemoSpy, setTtsSpy]) {
    spy.mockClear();
  }
  startSpy.mockReset().mockResolvedValue(undefined);
  win = fakeWindow();
  port = createTrainingPort({
    db: {} as never,
    getMainWindow: () => win as never,
    userDataDir: () => '/nonexistent-user-data',
  });
  const info = await port.start({ port: 8066, host: '127.0.0.1' });
  expect(info).toMatchObject({ url: 'http://127.0.0.1:8066', port: 8066, useHttps: false });
});

describe('createTrainingPort : démarrage', () => {
  it('enregistre le serveur sous l’identifiant d’entraînement et réserve son port', () => {
    expect(remoteServers.has(TRAINING_ID)).toBe(true);
    expect(usedPorts.has(8066)).toBe(true);
    expect(port.info()).toMatchObject({ port: 8066, ip: '127.0.0.1' });
  });

  it('refuse un second démarrage (training_already_started)', async () => {
    await expect(port.start({})).rejects.toMatchObject({ code: 'training_already_started' });
  });

  it('port indisponible : refus remote_refused, rien n’est enregistré', async () => {
    port.stop();
    startSpy.mockRejectedValueOnce(new Error('EADDRINUSE'));
    await expect(port.start({ port: 8066 })).rejects.toMatchObject({
      code: 'remote_refused',
      message: 'EADDRINUSE',
    });
    expect(remoteServers.has(TRAINING_ID)).toBe(false);
  });

  it('config vocale absente : ignorée (optionnelle)', () => {
    expect(setTtsSpy).not.toHaveBeenCalled();
  });
});

describe('createTrainingPort : thème et démo', () => {
  it('applique le thème au serveur d’entraînement', () => {
    port.applyTheme('neon');
    expect(updateThemeSpy).toHaveBeenCalledWith('neon');
  });

  it('ouvre les écrans de démo et les ferme avec la fenêtre principale', () => {
    expect(port.openDemoScreens(2)).toBe(3);
    expect(openDemoSpy).toHaveBeenCalledWith('http://127.0.0.1:8066', 2);
    win.emit('closed');
    expect(closeDemoSpy).toHaveBeenCalled();
  });
});

describe('createTrainingPort : arrêt du serveur d’entraînement / démo', () => {
  it('stop libère le port et arrête le serveur', () => {
    expect(port.stop()).toBe(true);
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(remoteServers.has(TRAINING_ID)).toBe(false);
    expect(usedPorts.has(8066)).toBe(false);
    // Écouteurs de la fenêtre détachés : pas de second arrêt
    win.emit('closed');
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('stop sans serveur : false', () => {
    port.stop();
    expect(port.stop()).toBe(false);
  });

  it('fenêtre principale fermée (macOS, app dans le Dock) → serveur arrêté', () => {
    win.emit('closed');
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(remoteServers.has(TRAINING_ID)).toBe(false);
  });

  it('fenêtre principale rechargée (bouton « Arrêter » perdu) → serveur arrêté', () => {
    win.webContents.emit('did-navigate');
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(usedPorts.has(8066)).toBe(false);
  });
});
