import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (...args: any[]) => any>();

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/bp-inexistant' },
  ipcMain: { handle: (ch: string, fn: (...args: any[]) => any) => handlers.set(ch, fn) },
}));

import { registerLogoTtsHandlers } from './logoTtsHandlers';

describe('registerLogoTtsHandlers (#1341)', () => {
  beforeEach(() => {
    handlers.clear();
    registerLogoTtsHandlers();
  });

  it('enregistre les canaux de lecture des logos et de la synthèse vocale', () => {
    for (const ch of ['app:getTtsConfig', 'app:getLogo', 'app:getLogos', 'app:saveLogos']) {
      expect(handlers.has(ch)).toBe(true);
    }
  });

  it('getLogos : fichier absent → liste vide', async () => {
    expect(await handlers.get('app:getLogos')!({})).toEqual([]);
  });

  it('saveLogos : entrée non tableau refusée', async () => {
    expect(await handlers.get('app:saveLogos')!({}, 'x')).toEqual({ success: false });
  });
});
