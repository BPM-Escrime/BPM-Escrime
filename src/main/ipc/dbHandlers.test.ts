import { describe, it, expect, vi } from 'vitest';

const send = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }] },
}));

import { emitCompetitionEvent } from './dbHandlers';
import { onCompetitionEvent } from '../engine/api/events';

// Plus aucun canal db:* (#1981 lot 4) : l'écran lit l'épreuve par le contrat (docs/adr/0017)
describe('bus d’événements db (#1298)', () => {
  it('emitCompetitionEvent publie sur le bus du contrat, plus sur un canal IPC (ADR-0010)', () => {
    const seen: unknown[] = [];
    const off = onCompetitionEvent(e => seen.push(e));
    emitCompetitionEvent('matches:changed', 'c1');
    off();
    expect(seen).toEqual([{ type: 'matches:changed', competitionId: 'c1' }]);
    expect(send).not.toHaveBeenCalled();
  });
});
