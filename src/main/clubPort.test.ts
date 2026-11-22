import { describe, it, expect, vi } from 'vitest';
import type { DatabaseManager } from '../database';

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));

import { onClubRemoteFinish } from './clubPort';

describe('clubPort (#1872, docs/adr/0022)', () => {
  it('score de la tablette → combat club terminé (saisie arbitre), autres matchs ignorés', () => {
    const club = {
      getBout: vi.fn((id: string) => (id === 'b1' ? { id, status: 'in_progress' } : null)),
      finishBout: vi.fn(),
    };
    const db = { club } as unknown as DatabaseManager;
    const rec = { arenaId: 'arena1', arenaNumber: 1, weapon: 'E', finishedAt: '' };
    onClubRemoteFinish(db, { ...rec, id: 'club:b1', scoreA: 5, scoreB: 2, durationSec: 90 });
    onClubRemoteFinish(db, { ...rec, id: 'training-x', scoreA: 1, scoreB: 0, durationSec: 1 });
    expect(club.finishBout).toHaveBeenCalledTimes(1);
    expect(club.finishBout).toHaveBeenCalledWith('b1', {
      scoreA: 5,
      scoreB: 2,
      entryMode: 'referee',
      duration: 90,
    });
  });

  it('combat annulé : score ignoré', () => {
    const club = {
      getBout: vi.fn(() => ({ id: 'b2', status: 'cancelled' })),
      finishBout: vi.fn(),
    };
    onClubRemoteFinish(
      { club } as unknown as DatabaseManager,
      {
        id: 'club:b2',
        arenaId: 'arena1',
        arenaNumber: 1,
        weapon: 'E',
        finishedAt: '',
        scoreA: 5,
        scoreB: 0,
        durationSec: 10,
      } as never
    );
    expect(club.finishBout).not.toHaveBeenCalled();
  });
});
