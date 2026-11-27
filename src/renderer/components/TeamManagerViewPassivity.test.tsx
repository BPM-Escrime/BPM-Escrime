// @vitest-environment jsdom
/**
 * Écran équipes (TeamManagerView) : cartons P (non-combativité, t.124 ; #2227). Bouton en
 * relais FIE des armes olympiques seulement, carton suivant demandé au moteur (essai à blanc),
 * noir P confirmé avant envoi, annulation du jaune ou du rouge P (cancelTeamCard), noir P
 * jamais annulable. Moteur simulé (useTeamCompetition).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../hooks/useTranslation', () => import('../testUtils/i18nMock'));
vi.mock('../contexts/TranslationContext', async () => {
  const m = await import('../testUtils/i18nMock');
  return { useTranslation: m.useTranslation, translateStatic: m.frT };
});
const run = vi.fn();
let passivityCards: Record<string, Array<{ id: string; type: string; at: string }>> = {};
vi.mock('../hooks/useTeamCompetition', () => ({
  useTeamCompetition: () => ({
    teams,
    poolMatches: [match],
    tableauMatches: [],
    poolRanking: [],
    relayCards: {},
    teamCards: {},
    passivityCards,
    withdrawn: {},
    finalRanking: { rows: [], provisional: true },
    loading: false,
    run,
  }),
}));
vi.mock('../api/remoteApi', () => ({ useRemoteApi: () => ({}) }));

import { TeamManagerView } from './TeamManagerView';
import { ConfirmProvider } from './ConfirmDialog';
import { ToastProvider } from './Toast';
import { frT } from '../testUtils/i18nMock';
import type { Competition } from '../../shared/types';

const teams = [
  { id: 'tA', name: 'Lyon', club: '', fencers: [] },
  { id: 'tB', name: 'Gand', club: '', fencers: [] },
];
const match = {
  id: 'm1',
  poolNumber: 1,
  teamAId: 'tA',
  teamBId: 'tB',
  scoreBoutsA: 5,
  scoreBoutsB: 3,
  status: 'in_progress',
  winnerId: null,
  currentBoutIndex: 1,
  bouts: [
    {
      id: 'b1',
      matchId: 'm1',
      boutOrder: 1,
      fencerAId: 'a1',
      fencerBId: 'b1',
      scoreA: 5,
      scoreB: 3,
      maxScore: 5,
      status: 'finished',
      winnerId: 'a1',
    },
    {
      id: 'b2',
      matchId: 'm1',
      boutOrder: 2,
      fencerAId: 'a2',
      fencerBId: 'b2',
      scoreA: 0,
      scoreB: 0,
      maxScore: 10,
      status: 'not_started',
      winnerId: null,
    },
  ],
};

const competition = (weapon: string, settings: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    title: 'Coupe',
    weapon,
    settings: { minTeamSize: 3, ...settings },
  }) as never as Competition;

const show = (weapon = 'S', settings: Record<string, unknown> = {}) => {
  render(
    <ToastProvider>
      <ConfirmProvider>
        <TeamManagerView competition={competition(weapon, settings)} fencers={[]} view="pool" />
      </ConfirmProvider>
    </ToastProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: frT('teams.score') }));
};
const giveButton = () =>
  screen.queryByRole('button', { name: frT('teams.givePassivityCardTooltip') });

/** Moteur simulé : carton suivant `next`, noir P gagné par l'équipe A */
const engine = (next: 'yellow' | 'red' | 'black') =>
  run.mockImplementation(async (name: string, input: Record<string, unknown>) => {
    if (name === 'givePassivityCard') {
      return {
        dryRun: !!input.dryRun,
        matchId: 'm1',
        card: { id: 'p', type: next, at: '2026-11-24T10:00:00.000Z' },
        winnerTeamId: next === 'black' ? 'tA' : null,
        scheduledMatchIds: [],
      };
    }
    return { dryRun: false };
  });

beforeEach(() => {
  run.mockReset();
  passivityCards = {};
});

describe('TeamManagerView — cartons P (#2227)', () => {
  it('relais FIE : jaune P envoyé sans confirmation (essai à blanc puis commande)', async () => {
    engine('yellow');
    show();
    fireEvent.click(giveButton()!);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls).toEqual([
      ['givePassivityCard', { competitionId: 'c1', matchId: 'm1', dryRun: true }],
      ['givePassivityCard', { competitionId: 'c1', matchId: 'm1' }],
    ]);
    expect(await screen.findByText(frT('teams.passivityCardGiven'))).toBeInTheDocument();
  });

  it('relais Sabre Laser : pas de bouton carton P', () => {
    show('L');
    expect(giveButton()).toBeNull();
  });

  it('arène Sabre Laser : pas de bouton carton P', () => {
    show('L', { teamFormat: 'laser-arena' });
    expect(giveButton()).toBeNull();
  });

  it('noir P : confirmation avec rappel du relais en cours ; refus = rien envoyé', async () => {
    engine('black');
    show();
    fireEvent.click(giveButton()!);
    const message = frT('teams.confirmPassivityBlack', { team: 'Lyon' });
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(message).toContain('relais en cours');
    fireEvent.click(screen.getByRole('button', { name: frT('actions.cancel') }));
    await waitFor(() => expect(screen.queryByText(message)).toBeNull());
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toMatchObject({ dryRun: true });
  });

  it('noir P confirmé : commande envoyée, rencontre décidée annoncée', async () => {
    engine('black');
    show();
    fireEvent.click(giveButton()!);
    fireEvent.click(
      await screen.findByRole('button', { name: frT('teams.passivityBlackConfirm') })
    );
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1]).toEqual([
      'givePassivityCard',
      { competitionId: 'c1', matchId: 'm1' },
    ]);
    expect(
      await screen.findByText(frT('teams.passivityMatchDecided', { team: 'Lyon' }))
    ).toBeInTheDocument();
  });

  it('cartons P listés ; jaune et rouge P annulables (cancelTeamCard), noir P non', async () => {
    run.mockResolvedValue({ dryRun: false, matchId: 'm1', cardId: 'p1' });
    passivityCards = {
      m1: [
        { id: 'p1', type: 'yellow', at: '' },
        { id: 'p2', type: 'red', at: '' },
        { id: 'p3', type: 'black', at: '' },
      ],
    };
    show();
    const block = screen.getByTestId('passivity-cards');
    expect(block).toHaveTextContent(frT('teams.passivityTitle'));
    expect(screen.getByLabelText(frT('teams.passivityYellow'))).toBeInTheDocument();
    expect(screen.getByLabelText(frT('teams.passivityBlack'))).toBeInTheDocument();
    // Noir P donné : rencontre décidée, plus de carton P
    expect(giveButton()).toBeDisabled();
    const cancels = screen.getAllByRole('button', { name: frT('teams.cancelCard') });
    expect(cancels).toHaveLength(2);
    fireEvent.click(cancels[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith('cancelTeamCard', {
        competitionId: 'c1',
        matchId: 'm1',
        cardId: 'p1',
      })
    );
  });
});
