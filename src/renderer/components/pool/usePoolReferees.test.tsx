// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Referee } from '../../../shared/types';
import { usePoolReferees } from './usePoolReferees';

const ref = (id: string): Referee =>
  ({ id, firstName: 'F', lastName: id, status: 'checkedIn' }) as unknown as Referee;

describe('usePoolReferees', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      db: { updatePoolReferees: vi.fn(), getRefereesByCompetition: vi.fn() },
    };
  });

  it('bascule la sélection sans dépasser maxRefereesPerPool', () => {
    const { result } = renderHook(() =>
      usePoolReferees({
        poolId: 'p1',
        initialReferees: [],
        maxRefereesPerPool: 2,
      })
    );
    act(() => result.current.togglePendingReferee('a'));
    act(() => result.current.togglePendingReferee('b'));
    act(() => result.current.togglePendingReferee('c'));
    expect(result.current.pendingRefereeIds).toEqual(['a', 'b']);
    act(() => result.current.togglePendingReferee('a'));
    expect(result.current.pendingRefereeIds).toEqual(['b']);
  });

  it('notifie le parent, qui l’écrit par le moteur, sans écriture directe en base', () => {
    const onRefereeAssigned = vi.fn();
    const { result } = renderHook(() =>
      usePoolReferees({
        poolId: 'p1',
        initialReferees: [],
        maxRefereesPerPool: 1,
        onRefereeAssigned,
      })
    );
    act(() => result.current.handleAssignReferee(ref('x')));
    expect(window.electronAPI.db.updatePoolReferees).not.toHaveBeenCalled();
    expect(onRefereeAssigned).toHaveBeenCalledWith('p1', [ref('x')]);
    expect(result.current.assignedReferees).toEqual([ref('x')]);
    expect(result.current.showRefereeModal).toBe(false);
  });
});
