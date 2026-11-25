// @vitest-environment jsdom
/** Tableau arrêté à N tireurs : passage à la phase suivante (#2013 D2b, docs/adr/0037) */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Fencer } from '../../../shared/types';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';

const call = vi.fn(async (_name: string, input: { dryRun?: boolean }) => ({
  dryRun: !!input.dryRun,
  stopAt: 2,
  qualified: 2,
  eliminated: 2,
}));
vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../api/BpmClientContext', () => ({ useBpmClient: () => ({ call }) }));
vi.mock('../ConfirmDialog', () => ({ useConfirm: () => ({ confirm: async () => true }) }));
vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import { TableauStageBanner } from './TableauStageBanner';

const f = (id: string) => ({ id }) as Fencer;
const m = (round: number, a: string, b: string, winner: string | null): TableauMatch => ({
  id: `${round}-${a}`,
  round,
  position: 1,
  fencerA: f(a),
  fencerB: f(b),
  scoreA: null,
  scoreB: null,
  winner: winner ? f(winner) : null,
  isBye: false,
});

describe('TableauStageBanner', () => {
  it('bouton actif une fois les tours avant l’arrêt joués, puis clôture par le moteur', async () => {
    const onClosed = vi.fn();
    const pending = [m(4, 'A', 'D', 'A'), m(4, 'B', 'C', null)];
    const { rerender } = render(
      <TableauStageBanner competitionId="c" stopAt={2} matches={pending} onClosed={onClosed} />
    );
    expect(screen.getByTestId('tableau-stage-close')).toBeDisabled();
    rerender(
      <TableauStageBanner
        competitionId="c"
        stopAt={2}
        matches={[pending[0], m(4, 'B', 'C', 'B')]}
        onClosed={onClosed}
      />
    );
    fireEvent.click(screen.getByTestId('tableau-stage-close'));
    await waitFor(() => expect(onClosed).toHaveBeenCalled());
    expect(call).toHaveBeenNthCalledWith(1, 'closeTableauStage', {
      competitionId: 'c',
      dryRun: true,
    });
    expect(call).toHaveBeenNthCalledWith(2, 'closeTableauStage', { competitionId: 'c' });
  });
});
