import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (...args: any[]) => any>();
const send = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }] },
  ipcMain: {
    handle: (ch: string, fn: (...args: any[]) => any) => handlers.set(ch, fn),
    on: vi.fn(),
  },
}));

import { registerDbHandlers, emitCompetitionEvent } from './dbHandlers';

describe('bus d’événements db (#1298)', () => {
  const db = {
    updateMatch: vi.fn(),
    getMatch: vi.fn(() => ({ id: 'm1', poolId: 'p1', scoreA: { value: 5 }, scoreB: { value: 4 } })),
    logScoreChange: vi.fn(),
    createMatch: vi.fn(() => ({ id: 'm1' })),
    addFencer: vi.fn(() => ({ id: 'f1' })),
  };

  beforeEach(() => {
    handlers.clear();
    send.mockClear();
    registerDbHandlers({
      db: db as never,
      remoteServers: new Map(),
    });
  });

  it('emitCompetitionEvent diffuse aux fenêtres', () => {
    emitCompetitionEvent('matches:changed', 'c1');
    expect(send).toHaveBeenCalledWith('competition:event', {
      type: 'matches:changed',
      competitionId: 'c1',
    });
  });

  it('lot N (docs/adr/0024) : plus aucun canal d’écriture de l’épreuve par le préload', () => {
    for (const ch of [
      'db:saveSessionState',
      'db:updateFencer',
      'db:createMatch',
      'db:updateMatch',
      'db:upsertMultipleTableauMatches',
      'db:createPool',
      'db:clearPoolsForPhase',
      'db:addFencerToPool',
      'db:syncPoolSnapshot',
      'db:updatePool',
      'db:createPhase',
      'db:saveAbandonSnapshot',
      'db:getAbandonSnapshot',
      'db:deleteAbandonSnapshot',
      'db:createTeam',
      'db:upsertTeamFencer',
    ]) {
      expect(handlers.has(ch), ch).toBe(false);
    }
    expect(handlers.has('db:getSessionState')).toBe(true);
  });
});
