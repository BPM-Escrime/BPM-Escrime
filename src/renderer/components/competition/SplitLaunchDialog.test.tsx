// @vitest-environment jsdom
/**
 * Lancement de la scission (#2013 E2b, docs/adr/0039) : simulation par splitCompetition
 * (dryRun), confirmation avec les branches et leurs effectifs, puis commande ; tireurs sans
 * valeur pour le critère : pas de confirmation, moyen de corriger.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { call, showToast } = vi.hoisted(() => ({ call: vi.fn(), showToast: vi.fn() }));
vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
  }),
}));
vi.mock('../../api/BpmClientContext', () => ({ useBpmClient: () => ({ call }) }));
vi.mock('../Toast', () => ({ useToast: () => ({ showToast }) }));

import { SplitLaunchDialog } from './SplitLaunchDialog';

const fencers = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    lastName: `${prefix}NOM${i}`,
    firstName: 'P',
    rank: i + 1,
  }));
const plan = (missing = 0) => ({
  dryRun: true,
  branches: [
    { label: 'Tableau A', competitionId: null, fencers: fencers(4, 'a'), stayInCompetition: false },
    { label: 'Tableau B', competitionId: null, fencers: fencers(3, 'b'), stayInCompetition: false },
  ],
  missing: fencers(missing, 'm').map(({ rank: _r, ...f }) => f),
  entrants: [],
});

/** Classement d'entrée : 3 tireurs (clubs, sexes, dates de naissance) */
const ENTRANTS = [
  {
    id: 'e1',
    lastName: 'ALPHA',
    firstName: 'A',
    rank: 1,
    gender: 'M',
    club: 'Nice',
    birthDate: '2001-05-01T00:00:00.000Z',
    category: null,
  },
  {
    id: 'e2',
    lastName: 'BRAVO',
    firstName: 'B',
    rank: 2,
    gender: 'F',
    club: 'Lyon',
    birthDate: '1999-01-01T00:00:00.000Z',
    category: null,
  },
  {
    id: 'e3',
    lastName: 'CHARLIE',
    firstName: 'C',
    rank: 3,
    gender: 'M',
    club: 'Arras',
    birthDate: null,
    category: null,
  },
];
/** Simulation manuelle : répartition selon les affectations reçues */
const manualSim = (input: { assignments?: { fencerId: string; branch: string }[] }) => {
  const a = new Map((input.assignments ?? []).map(x => [x.fencerId, x.branch]));
  const pick = (label: string) =>
    ENTRANTS.filter(e => a.get(e.id) === label).map(({ id, lastName, firstName, rank }) => ({
      id,
      lastName,
      firstName,
      rank,
    }));
  return Promise.resolve({
    dryRun: true,
    branches: ['N1', 'N2'].map(label => ({
      label,
      competitionId: null,
      fencers: pick(label),
      stayInCompetition: false,
    })),
    missing: ENTRANTS.filter(e => !a.has(e.id)).map(({ id, lastName, firstName }) => ({
      id,
      lastName,
      firstName,
    })),
    entrants: ENTRANTS,
  });
};

beforeEach(() => {
  call.mockReset();
  showToast.mockReset();
});

describe('SplitLaunchDialog (ADR-0039)', () => {
  it('simulation, confirmation, puis commande', async () => {
    call.mockResolvedValueOnce(plan()).mockResolvedValueOnce({ ...plan(), dryRun: false });
    const onDone = vi.fn();
    render(
      <SplitLaunchDialog competitionId="c" criterion="rank" onClose={vi.fn()} onDone={onDone} />
    );
    expect(call).toHaveBeenCalledWith('splitCompetition', { competitionId: 'c', dryRun: true });
    const rows = await screen.findAllByRole('row');
    expect(rows.slice(1).map(r => r.textContent)).toEqual(['Tableau A4', 'Tableau B3']);
    fireEvent.click(screen.getByTestId('split-launch-confirm'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(call).toHaveBeenLastCalledWith('splitCompetition', { competitionId: 'c' });
  });

  it('tireurs sans valeur : liste, moyen de corriger, pas de confirmation', async () => {
    call.mockResolvedValueOnce(plan(2));
    render(
      <SplitLaunchDialog
        competitionId="c"
        criterion="category"
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );
    const missing = await screen.findByTestId('split-launch-missing');
    expect(missing).toHaveTextContent('mNOM0');
    expect(missing).toHaveTextContent('mNOM1');
    expect(missing).toHaveTextContent('splitLaunch.missing_fix_category');
    expect(screen.getByTestId('split-launch-confirm')).toBeDisabled();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('refus du moteur à la simulation : message, fenêtre fermée', async () => {
    call.mockRejectedValueOnce(new Error('Poules non terminées'));
    const onClose = vi.fn();
    render(
      <SplitLaunchDialog competitionId="c" criterion="gender" onClose={onClose} onDone={vi.fn()} />
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith('Poules non terminées', 'error');
  });

  it('manuelle : une branche par tireur, tri, « Tout dans… », confirmation après affectation', async () => {
    call.mockImplementation((_op: string, input: Record<string, unknown>) =>
      input.dryRun ? manualSim(input) : Promise.resolve({ dryRun: false })
    );
    const onDone = vi.fn();
    render(
      <SplitLaunchDialog competitionId="c" criterion="manual" onClose={vi.fn()} onDone={onDone} />
    );
    await screen.findByTestId('split-launch-entrants');
    const names = () =>
      [...screen.getByTestId('split-launch-entrants').querySelectorAll('tbody tr')].map(
        r => r.children[1].textContent
      );
    expect(names()).toEqual(['ALPHA A', 'BRAVO B', 'CHARLIE C']);
    // Personne d'affecté : confirmation bloquée
    expect(screen.getByTestId('split-launch-missing')).toHaveTextContent(
      'splitLaunch.manual_missing {"n":3}'
    );
    expect(screen.getByTestId('split-launch-confirm')).toBeDisabled();
    // Tris : club, date de naissance (sans date en dernier), sexe
    fireEvent.change(screen.getByTestId('split-launch-sort'), { target: { value: 'club' } });
    expect(names()).toEqual(['CHARLIE C', 'BRAVO B', 'ALPHA A']);
    fireEvent.change(screen.getByTestId('split-launch-sort'), { target: { value: 'birthDate' } });
    expect(names()).toEqual(['BRAVO B', 'ALPHA A', 'CHARLIE C']);
    fireEvent.change(screen.getByTestId('split-launch-sort'), { target: { value: 'gender' } });
    expect(names()).toEqual(['BRAVO B', 'ALPHA A', 'CHARLIE C']);
    // « Tout dans N2 », puis ALPHA en N1 : simulation relancée avec les affectations
    fireEvent.change(screen.getByTestId('split-launch-all-branch'), { target: { value: 'N2' } });
    fireEvent.click(screen.getByTestId('split-launch-all'));
    fireEvent.change(screen.getByTestId('split-launch-branch-e1'), { target: { value: 'N1' } });
    await waitFor(() => expect(screen.queryByTestId('split-launch-missing')).toBeNull());
    expect(call).toHaveBeenLastCalledWith('splitCompetition', {
      competitionId: 'c',
      dryRun: true,
      assignments: [
        { fencerId: 'e1', branch: 'N1' },
        { fencerId: 'e2', branch: 'N2' },
        { fencerId: 'e3', branch: 'N2' },
      ],
    });
    const rows = screen.getAllByRole('row').map(r => r.textContent);
    expect(rows).toContain('N11');
    expect(rows).toContain('N22');
    // Un tireur désaffecté : de nouveau bloqué
    fireEvent.change(screen.getByTestId('split-launch-branch-e3'), { target: { value: '' } });
    await screen.findByTestId('split-launch-missing');
    expect(screen.getByTestId('split-launch-confirm')).toBeDisabled();
    fireEvent.change(screen.getByTestId('split-launch-branch-e3'), { target: { value: 'N1' } });
    await waitFor(() => expect(screen.getByTestId('split-launch-confirm')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('split-launch-confirm'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(call).toHaveBeenLastCalledWith('splitCompetition', {
      competitionId: 'c',
      assignments: [
        { fencerId: 'e1', branch: 'N1' },
        { fencerId: 'e2', branch: 'N2' },
        { fencerId: 'e3', branch: 'N1' },
      ],
    });
  });

  it('branche restée dans l’épreuve : signalée dans la répartition', async () => {
    const p = plan();
    call.mockResolvedValueOnce({
      ...p,
      branches: [{ ...p.branches[0], stayInCompetition: true }, p.branches[1]],
    });
    render(
      <SplitLaunchDialog competitionId="c" criterion="gender" onClose={vi.fn()} onDone={vi.fn()} />
    );
    await screen.findByTestId('split-launch-plan');
    expect(screen.getByText(/splitLaunch\.stays/)).toBeInTheDocument();
    expect(screen.queryByTestId('split-launch-entrants')).toBeNull();
  });
});
