// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Fencer, FencerStatus, Gender, Match, MatchStatus, Pool } from '../../shared/types';
import PoolWaveBar from '../poolWaves/PoolWaveBar';
import TeamImportModal from './TeamImportModal';
import { waveMatchOrder } from '../../shared/domain/pools/waves';
import { RapieresFencer } from '../../shared/domain/rapieres/rapieres.types';

vi.mock('../../renderer/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, p?: Record<string, string>) => (p ? `${k}:${Object.values(p).join(',')}` : k),
  }),
}));

const fencer = (id: string): Fencer =>
  ({
    id,
    ref: 0,
    lastName: id,
    firstName: '',
    gender: Gender.MIXED,
    nationality: 'FRA',
    status: FencerStatus.CHECKED_IN,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Fencer;

const pool = (): Pool => {
  const fencers = ['a', 'b', 'c', 'd'].map(fencer);
  return {
    id: 'p',
    number: 1,
    phaseId: 'ph',
    fencers,
    matches: waveMatchOrder(fencers).map(
      ([x, y], i) =>
        ({
          id: `m${i}`,
          number: i + 1,
          fencerA: fencers[x - 1],
          fencerB: fencers[y - 1],
          scoreA: null,
          scoreB: null,
          maxScore: 5,
          status: MatchStatus.NOT_STARTED,
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as Match
    ),
    referees: [],
    isComplete: false,
    hasError: false,
    ranking: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Pool;
};

describe('Tour en vagues et entrée en équipes : composants (#1118, ADR-0043)', () => {
  it('barre des vagues : lancement, vague incomplète, fin anticipée', () => {
    const onLaunchWave = vi.fn();
    const onEndWaves = vi.fn();
    const props = {
      pools: [pool()],
      wavesEnded: false,
      onLaunchWave,
      onEndWaves,
      onResumeWaves: vi.fn(),
    };
    const { rerender } = render(<PoolWaveBar {...props} launchedWave={0} />);
    fireEvent.click(screen.getByText('poolWaves.launch_wave:1'));
    expect(onLaunchWave).toHaveBeenCalledWith(1);
    rerender(<PoolWaveBar {...props} launchedWave={1} />);
    expect(screen.getByText('poolWaves.launch_wave:2')).toBeDisabled();
    expect(screen.getByText('poolWaves.wave_incomplete')).toBeInTheDocument();
    fireEvent.click(screen.getByText('poolWaves.end_waves'));
    expect(onEndWaves).toHaveBeenCalled();
  });

  it("fenêtre d'import : équipes cochées par défaut, sélection transmise (#1211)", async () => {
    const team = (name: string) => ({
      name,
      info: {
        level: 'beginner' as const,
        fencers: [
          {
            firstName: 'A',
            lastName: `${name}1`,
            category: 'SENIOR' as const,
            gender: 'M' as const,
          },
          { firstName: 'B', lastName: `${name}2`, category: 'V1' as const },
        ] as [RapieresFencer, RapieresFencer],
      },
    });
    const teams = [team('Alpha'), team('Beta'), team('Gamma')];
    const onImport = vi.fn();
    const onClose = vi.fn();
    render(
      <TeamImportModal
        filename="export.csv"
        teams={teams}
        skipped={[4]}
        onImport={onImport}
        onClose={onClose}
      />
    );
    expect(screen.getByText('teamEntry.import_found:3')).toBeInTheDocument();
    expect(screen.getByText('teamEntry.import_skipped:4')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Beta'));
    fireEvent.click(screen.getByText('teamEntry.import_n:2'));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onImport).toHaveBeenCalledWith([teams[0], teams[2]]);
  });
});
