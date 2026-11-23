// @vitest-environment jsdom
/**
 * Tests unitaires - useFencerManagement
 * BPM - Escrime
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFencerManagement } from './useFencerManagement';
import { BpmClientProvider } from '../api/BpmClientContext';
import type { BpmClient } from '../../shared/api/client';
import { fakeApiBridge } from '../testUtils/apiBridge';
import { Competition, Fencer, Gender, FencerStatus } from '../../shared/types';

const showToast = vi.fn();
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('./useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const fencer = (id: string): Fencer => ({
  id,
  ref: Number(id),
  lastName: 'L' + id,
  firstName: 'F',
  gender: Gender.MALE,
  nationality: 'FRA',
  status: FencerStatus.NOT_CHECKED_IN,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const competition = { id: 'c1', title: 'Open', fencers: [fencer('1')] } as unknown as Competition;

let onUpdate: ReturnType<typeof vi.fn>;
let db: Record<string, any>;
let api: Record<string, any>;

beforeEach(() => {
  onUpdate = vi.fn();
  db = {
    addFencer: vi.fn(async (_cid: string, data: any) => ({ ...fencer('2'), ...data, id: '2' })),
    updateFencer: vi.fn(async () => {}),
    deleteFencer: vi.fn(async () => {}),
    deleteAllFencers: vi.fn(async () => {}),
  };
  // Inscription par les commandes du contrat (docs/adr/0018)
  api = {
    registerFencers: vi.fn(async (input: any) => ({
      dryRun: false,
      fencers: input.fencers.map((f: any) => ({ ...fencer('2'), ...f, birthDate: null })),
      duplicates: [],
    })),
    updateFencerDetails: vi.fn(async () => ({ dryRun: false, fencer: fencer('1') })),
    setFencerRankings: vi.fn(async () => ({ dryRun: false, updated: 1, unknown: [] })),
    unregisterFencers: vi.fn(async () => ({ dryRun: false, removed: [], unknown: [] })),
    listFencers: vi.fn(async () => [fencer('1'), fencer('2')]),
  };
  (window as any).electronAPI = { db, api: fakeApiBridge(api) };
});

afterEach(() => {
  delete (window as any).electronAPI;
});

const setup = () =>
  renderHook(() =>
    useFencerManagement({ competition, onUpdate: onUpdate as unknown as (c: Competition) => void })
  ).result;

describe('addFencer', () => {
  it('ajoute le tireur et notifie le parent', async () => {
    const r = setup();
    let created: any;
    await act(async () => {
      created = await r.current.addFencer({ lastName: 'X' } as any);
    });
    expect(api.registerFencers).toHaveBeenCalledWith({
      competitionId: 'c1',
      fencers: [expect.objectContaining({ lastName: 'X', status: 'N' })],
    });
    expect(created.id).toBe('2');
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].fencers).toHaveLength(2);
  });

  it('lève une erreur si l’API est absente', async () => {
    delete (window as any).electronAPI;
    const r = setup();
    await expect(r.current.addFencer({ lastName: 'X' } as any)).rejects.toThrow('API indisponible');
  });
});

describe('updateFencer', () => {
  it('met à jour le tireur et notifie', async () => {
    const r = setup();
    await act(async () => {
      await r.current.updateFencer('1', { lastName: 'Neuf' });
    });
    expect(api.updateFencerDetails).toHaveBeenCalledWith({
      competitionId: 'c1',
      fencerId: '1',
      details: { lastName: 'Neuf' },
    });
    expect(db.updateFencer).not.toHaveBeenCalled();
    expect(onUpdate.mock.calls[0][0].fencers[0].lastName).toBe('Neuf');
  });

  it('classement par setFencerRankings, statut écrit directement (formats hors moteur)', async () => {
    const r = setup();
    await act(async () => {
      await r.current.updateFencer('1', { ranking: 4, status: FencerStatus.ELIMINATED });
    });
    expect(api.setFencerRankings).toHaveBeenCalledWith({
      competitionId: 'c1',
      rankings: [{ fencerId: '1', ranking: 4 }],
    });
    expect(db.updateFencer).toHaveBeenCalledWith('1', { status: FencerStatus.ELIMINATED });
  });
});

describe('setFencersStatus', () => {
  it('met à jour plusieurs tireurs en un seul état (#1051)', async () => {
    const comp = { ...competition, fencers: [fencer('1'), fencer('2'), fencer('3')] };
    const r = renderHook(() =>
      useFencerManagement({
        competition: comp,
        onUpdate: onUpdate as unknown as (c: Competition) => void,
      })
    ).result;
    await act(async () => {
      await r.current.setFencersStatus(['1', '3'], FencerStatus.ELIMINATED);
    });
    expect(db.updateFencer).toHaveBeenCalledTimes(2);
    expect(r.current.fencers.map(f => f.status)).toEqual([
      FencerStatus.ELIMINATED,
      FencerStatus.NOT_CHECKED_IN,
      FencerStatus.ELIMINATED,
    ]);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('updateFencers', () => {
  it('applique des MAJ différentes par tireur en un seul état (#1051)', async () => {
    const comp = { ...competition, fencers: [fencer('1'), fencer('2')] };
    const r = renderHook(() =>
      useFencerManagement({
        competition: comp,
        onUpdate: onUpdate as unknown as (c: Competition) => void,
      })
    ).result;
    await act(async () => {
      await r.current.updateFencers({
        '1': { status: FencerStatus.ELIMINATED },
        '2': { ranking: 1 },
      });
    });
    expect(db.updateFencer).toHaveBeenCalledWith('1', { status: FencerStatus.ELIMINATED });
    expect(db.updateFencer).toHaveBeenCalledWith('2', { ranking: 1 });
    expect(r.current.fencers[0].status).toBe(FencerStatus.ELIMINATED);
    expect(r.current.fencers[1].ranking).toBe(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('deleteFencer', () => {
  it('supprime le tireur et notifie', async () => {
    const r = setup();
    await act(async () => {
      await r.current.deleteFencer('1');
    });
    expect(api.unregisterFencers).toHaveBeenCalledWith({ competitionId: 'c1', fencerIds: ['1'] });
    expect(onUpdate.mock.calls[0][0].fencers).toHaveLength(0);
  });

  it('propose d’annuler : le tireur est ré-ajouté sans identifiant (#1535)', async () => {
    const r = setup();
    await act(async () => {
      await r.current.deleteFencer('1');
    });
    const options = showToast.mock.calls[showToast.mock.calls.length - 1][2];
    expect(options.action.label).toBe('fencerList.undo');
    expect(options.undo).toBe(true); // Ctrl+Z
    await act(async () => {
      options.action.onClick();
    });
    const data = api.registerFencers.mock.calls[0][0].fencers[0];
    expect(data.lastName).toBe('L1');
    expect(data.id).toBeUndefined();
  });
});

describe('deleteAllFencers', () => {
  it('vide la liste et notifie', async () => {
    const r = setup();
    await act(async () => {
      await r.current.deleteAllFencers();
    });
    expect(api.unregisterFencers).toHaveBeenCalledWith({ competitionId: 'c1', all: true });
    expect(onUpdate.mock.calls[0][0].fencers).toHaveLength(0);
  });
});

describe('bus fencers:changed (#1298)', () => {
  it('recharge les tireurs une seule fois pour une rafale, et se désabonne', async () => {
    vi.useFakeTimers();
    let handler: (e: any) => void = () => {};
    const unsubscribe = vi.fn();
    (window as any).electronAPI = { db };
    // Bus et lecture par le contrat (onCompetitionEvents, listFencers, #1981)
    const query = vi.fn(async () => [fencer('1'), fencer('2')]);
    const client = {
      call: vi.fn(),
      query,
      subscribe: vi.fn((_name: string, _input: unknown, cb: (e: any) => void) => {
        handler = cb;
        return unsubscribe;
      }),
    } as unknown as BpmClient;
    const { result, unmount } = renderHook(
      () =>
        useFencerManagement({
          competition,
          onUpdate: onUpdate as unknown as (c: Competition) => void,
        }),
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <BpmClientProvider client={client}>{children}</BpmClientProvider>
        ),
      }
    );
    act(() => {
      handler({ type: 'fencers:changed', competitionId: 'c1' });
      handler({ type: 'fencers:changed', competitionId: 'c1' });
      handler({ type: 'fencers:changed', competitionId: 'other' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(query).toHaveBeenCalledWith('listFencers', { competitionId: 'c1' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.current.fencers).toHaveLength(2);
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('pointage : un seul chemin, la commande checkIn (#1980, ADR-0005)', () => {
  const withApi = (invoke: (name: string, input: unknown) => Promise<unknown>) => {
    (window as any).electronAPI = {
      db,
      api: { invoke, subscribe: vi.fn(), unsubscribe: vi.fn(), onEvent: () => () => {} },
    };
  };
  const ok = (data: unknown) => Promise.resolve({ ok: true, data });
  const setupWith = (fencers: Fencer[]) =>
    renderHook(() =>
      useFencerManagement({
        competition: { ...competition, fencers } as Competition,
        onUpdate: onUpdate as unknown as (c: Competition) => void,
      })
    ).result;

  beforeEach(() => showToast.mockClear());

  it('pointer un tireur : commande checkIn, puis état local ; jamais updateFencer', async () => {
    const invoke = vi.fn(() => ok({ updated: 1 }));
    withApi(invoke);
    const r = setupWith([fencer('1')]);
    await act(async () => {
      await r.current.toggleCheckIn('1');
    });
    expect(invoke).toHaveBeenCalledWith('checkIn', {
      competitionId: 'c1',
      fencers: ['1'],
      present: true,
    });
    expect(db.updateFencer).not.toHaveBeenCalled();
    expect(r.current.fencers[0].status).toBe(FencerStatus.CHECKED_IN);
  });

  it('échec de la commande : pas de changement local, erreur affichée', async () => {
    withApi(() =>
      Promise.resolve({ ok: false, error: { code: 'internal', message: 'base verrouillée' } })
    );
    const r = setupWith([fencer('1')]);
    await act(async () => {
      await r.current.toggleCheckIn('1');
    });
    expect(r.current.fencers[0].status).toBe(FencerStatus.NOT_CHECKED_IN);
    expect(showToast).toHaveBeenCalledWith('fencerList.checkin_failed', 'error');
  });

  it('tireur en abandon : pas de commande, invité à le restaurer', async () => {
    const invoke = vi.fn(() => ok({ updated: 0 }));
    withApi(invoke);
    const r = setupWith([{ ...fencer('1'), status: FencerStatus.ABANDONED }]);
    await act(async () => {
      await r.current.toggleCheckIn('1');
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('fencerList.checkin_special_status', 'warning');
    expect(r.current.fencers[0].status).toBe(FencerStatus.ABANDONED);
  });

  it('tout pointer : succès affiché seulement après la commande', async () => {
    withApi(() => Promise.resolve({ ok: false, error: { code: 'internal', message: 'panne' } }));
    const r = setupWith([fencer('1'), fencer('2')]);
    await act(async () => {
      await r.current.checkInAll();
    });
    expect(showToast).not.toHaveBeenCalledWith('plural.fencers_checked_in', 'success');
    expect(r.current.fencers.every(f => f.status === FencerStatus.NOT_CHECKED_IN)).toBe(true);
  });
});
