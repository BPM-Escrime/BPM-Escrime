// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Fencer } from '../../shared/types';
import { useTeamImport } from './useTeamImport';

vi.mock('../../renderer/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const CSV = [
  ';;;Nom participant',
  ...['Alpha', 'Beta'].map(
    team => `;;;${team}1;Ana;;;;;;;;;;;;01/01/1990;F;;${team}2;Bob;01/01/1980;H;;${team}`
  ),
].join('\n');

describe('useTeamImport : import des équipes (#1211)', () => {
  it('ouvre la fenêtre de sélection puis ajoute toutes les équipes en un lot', async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      dialog: { openFile: vi.fn(async () => ({ filePath: '/tmp/export.csv', content: CSV })) },
    };
    const bulkAddFencers = vi.fn(async (list: unknown[]) =>
      list.map((_, i) => ({ id: `f${i}` }) as Fencer)
    );
    const notify = vi.fn();
    const { result } = renderHook(() =>
      useTeamImport({
        competitionDate: '2026-10-26',
        bulkAddFencers,
        notify,
      })
    );
    await act(() => result.current.handleImportTeams());
    const pending = result.current.teamImportModal;
    expect(pending?.filename).toBe('export.csv');
    expect(pending?.teams.map(t => t.name)).toEqual(['Alpha', 'Beta']);
    expect(bulkAddFencers).not.toHaveBeenCalled();

    await act(() => pending!.onImport(pending!.teams));
    expect(bulkAddFencers).toHaveBeenCalledTimes(1);
    expect(bulkAddFencers.mock.calls[0][0].map((f: Fencer) => f.lastName)).toEqual([
      'Alpha',
      'Beta',
    ]);
    // Notification injectée par l'écran (lot 5 de #1979)
    expect(notify).toHaveBeenCalledWith('teamEntry.import_done', 'success');
    // F4c (docs/adr/0043) : l'import écrit membres, niveau et sexe d'équipe avec l'inscription
    const first = bulkAddFencers.mock.calls[0][0][0] as Fencer;
    expect(first.members?.map(m => m.lastName)).toEqual(
      pending!.teams[0].info.fencers.map(f => f.lastName).filter(Boolean)
    );
    expect(first.level).toBe(
      { beginner: 1, intermediate: 2, expert: 3 }[pending!.teams[0].info.level]
    );
    expect(first.handicap).toBe(false);
  });
});
