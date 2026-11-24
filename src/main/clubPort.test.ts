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

  it('zones de la tablette gardées en Sabre Laser seulement (docs/adr/0031)', () => {
    const bouts: Record<string, { id: string; status: string; weapon?: string }> = {
      laser: { id: 'laser', status: 'in_progress', weapon: 'L' },
      epee: { id: 'epee', status: 'in_progress', weapon: 'E' },
    };
    const club = { getBout: vi.fn((id: string) => bouts[id] ?? null), finishBout: vi.fn() };
    const db = { club } as unknown as DatabaseManager;
    const rec = { arenaId: 'arena1', arenaNumber: 1, weapon: '', finishedAt: '', durationSec: 60 };
    const touches = { touches: { touchesA: ['A', 'C'], touchesB: ['B'] } };
    onClubRemoteFinish(db, { ...rec, ...touches, id: 'club:laser', scoreA: 6, scoreB: 3 });
    onClubRemoteFinish(db, { ...rec, ...touches, id: 'club:epee', scoreA: 2, scoreB: 1 });
    expect(club.finishBout).toHaveBeenNthCalledWith(1, 'laser', {
      scoreA: 6,
      scoreB: 3,
      entryMode: 'referee',
      duration: 60,
      zonesA: ['A', 'C'],
      zonesB: ['B'],
    });
    expect(club.finishBout.mock.calls[1][1]).not.toHaveProperty('zonesA');
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
