// @vitest-environment jsdom
/**
 * Phase Poules : barre des vagues d'un tour en vagues (docs/adr/0043, lot F4a), y compris hors
 * du mode spécial rapières ; absente d'un tour ordinaire.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Weapon } from '../../../shared/types';
import type { Pool } from '../../../shared/types';
import { waveMatchOrder } from '../../../shared/domain/pools/waves';

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${Object.values(o).join(',')}` : k),
  }),
}));

import PoolsPhase from './PoolsPhase';

const fencers = ['a', 'b', 'c', 'd'].map(id => ({ id, lastName: id, status: 'checked_in' }));
const pool = {
  id: 'p1',
  number: 1,
  fencers,
  matches: waveMatchOrder(fencers as never).map(([a, b], i) => ({
    id: `m${i}`,
    number: i + 1,
    fencerA: fencers[a - 1],
    fencerB: fencers[b - 1],
    status: 'not_started',
  })),
} as unknown as Pool;

const props = (over: Record<string, unknown> = {}) =>
  ({
    poolRoundSelector: null,
    historyPools: null,
    pools: [pool],
    weapon: Weapon.EPEE,
    competitionId: 'c1',
    competitionTitle: 'Vagues',
    tieBreakByVictory: false,
    poolMaxScore: 5,
    isLaserSabre: false,
    onBackToCheckin: vi.fn(),
    renderPoolCard: () => <div data-testid="pool-card" />,
    isTeamEntry: false,
    isWaves: true,
    launchedWave: 0,
    wavesEnded: false,
    onLaunchWave: vi.fn(),
    onEndWaves: vi.fn(),
    onResumeWaves: vi.fn(),
    onPrintWaveSheets: vi.fn(),
    onPrintWaveRange: vi.fn(),
    poolCardSize: 'Normal',
    onPoolCardSizeChange: vi.fn(),
    poolsViewMode: 'grid',
    onPoolsViewModeChange: vi.fn(),
    singlePoolIndex: 0,
    setSinglePoolIndex: vi.fn(),
    onPrintAll: vi.fn(),
    onExportAll: vi.fn(),
    ...over,
  }) as React.ComponentProps<typeof PoolsPhase>;

describe('barre des vagues d’un tour en vagues (docs/adr/0043)', () => {
  it('tour en vagues hors mode rapières : barre affichée, vague lancée au clic', () => {
    const onLaunchWave = vi.fn();
    render(<PoolsPhase {...props({ onLaunchWave })} />);
    expect(screen.getByRole('region', { name: 'poolWaves.waves' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('poolWaves.launch_wave:1'));
    expect(onLaunchWave).toHaveBeenCalledWith(1);
  });

  it('vague lancée : suivante bloquée tant que la vague n’est pas saisie ; arrêt proposé', () => {
    const onEndWaves = vi.fn();
    render(<PoolsPhase {...props({ launchedWave: 1, onEndWaves })} />);
    expect(screen.getByText('poolWaves.launch_wave:2')).toBeDisabled();
    fireEvent.click(screen.getByText('poolWaves.end_waves'));
    expect(onEndWaves).toHaveBeenCalled();
  });

  it('vagues arrêtées : reprise proposée', () => {
    const onResumeWaves = vi.fn();
    render(<PoolsPhase {...props({ launchedWave: 1, wavesEnded: true, onResumeWaves })} />);
    expect(screen.getByText('poolWaves.waves_ended')).toBeInTheDocument();
    fireEvent.click(screen.getByText('poolWaves.resume_waves'));
    expect(onResumeWaves).toHaveBeenCalled();
  });

  it('tour ordinaire : pas de barre des vagues', () => {
    render(<PoolsPhase {...props({ isWaves: false })} />);
    expect(screen.queryByRole('region', { name: 'poolWaves.waves' })).toBeNull();
  });
});
