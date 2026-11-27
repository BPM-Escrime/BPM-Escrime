// @vitest-environment jsdom
/**
 * Tour en vagues côté écran (docs/adr/0043, F4a) : matchs de la vague en cours, vague active des
 * tablettes (canal setActiveWave inchangé), remise à zéro à un nouveau tirage ; hors mode rapières.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MatchStatus } from '../../shared/types';
import type { Pool } from '../../shared/types';
import { waveMatchIds, waveMatchOrder } from '../../shared/domain/pools/waves';

const { setActiveWave } = vi.hoisted(() => ({ setActiveWave: vi.fn() }));
vi.mock('../api/remoteApi', () => ({ useRemoteApi: () => ({ setActiveWave }) }));
vi.mock('./useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { usePoolWavesView } from './usePoolWavesView';

const fencers = ['a', 'b', 'c', 'd'].map(id => ({ id, lastName: id }));
const pool = {
  id: 'p1',
  number: 1,
  fencers,
  matches: waveMatchOrder(fencers as never).map(([a, b], i) => ({
    id: `m${i}`,
    number: i + 1,
    fencerA: fencers[a - 1],
    fencerB: fencers[b - 1],
    status: MatchStatus.NOT_STARTED,
  })),
} as unknown as Pool;

const params = (over: Record<string, unknown> = {}) => ({
  competitionId: 'c1',
  competitionTitle: 'Vagues',
  isWaves: true,
  isRemoteActive: true,
  pools: [pool],
  waves: { launched: 1, ended: false },
  updateWaves: vi.fn(),
  notify: vi.fn(),
  ...over,
});

beforeEach(() => setActiveWave.mockClear());

describe('usePoolWavesView', () => {
  it('tour en vagues : matchs de la vague en cours, tablettes suivent la vague active', () => {
    const { result } = renderHook(() => usePoolWavesView(params()));
    const expected = waveMatchIds([pool], 1);
    expect(expected.size).toBeGreaterThan(0);
    expect(result.current.currentWaveMatchIds).toEqual(expected);
    expect(setActiveWave).toHaveBeenCalledWith('c1', [...expected], false);
  });

  it('vagues arrêtées : plus de surbrillance, tablettes sans match de poule', () => {
    const { result } = renderHook(() =>
      usePoolWavesView(params({ waves: { launched: 1, ended: true } }))
    );
    expect(result.current.currentWaveMatchIds).toBeUndefined();
    expect(setActiveWave).toHaveBeenCalledWith('c1', null, true);
  });

  it('tour ordinaire : aucune vague, tablettes non filtrées', () => {
    const { result } = renderHook(() => usePoolWavesView(params({ isWaves: false })));
    expect(result.current.currentWaveMatchIds).toBeUndefined();
    expect(setActiveWave).not.toHaveBeenCalled();
  });

  it('nouvelles poules sans match joué : vagues remises à zéro', () => {
    const updateWaves = vi.fn();
    const { result } = renderHook(() => usePoolWavesView(params({ updateWaves })));
    result.current.resetPoolWaves([pool]);
    expect(updateWaves).toHaveBeenCalledWith({ launched: 0, ended: false });
    updateWaves.mockClear();
    const played = {
      ...pool,
      matches: [{ ...pool.matches[0], status: MatchStatus.FINISHED }, ...pool.matches.slice(1)],
    } as Pool;
    result.current.resetPoolWaves([played]);
    expect(updateWaves).not.toHaveBeenCalled();
  });
});
