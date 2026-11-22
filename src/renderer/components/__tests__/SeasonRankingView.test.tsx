// @vitest-environment jsdom
/**
 * Classement de saison (docs/adr/0018) : lecture par getSeasonRanking, versement, retrait et
 * remise à zéro par les commandes du contrat. Aucune écriture directe en base.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SeasonRankingView } from '../SeasonRankingView';
import { fakeApiBridge } from '../../testUtils/apiBridge';
import type { Competition, Pool } from '../../../shared/types';

vi.mock('../../hooks/useTranslation', () => import('../../testUtils/i18nMock'));
vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

type Fn = Mock<(...args: any[]) => any>;
let api: Record<string, Fn>;
let db: Record<string, Fn>;

const inSeason = {
  ranking: [
    {
      fencerId: 'f1',
      fencerLastName: 'DUPONT',
      fencerFirstName: 'Ana',
      fencerClub: 'Lyon',
      totalVictories: 3,
      totalMatchesPlayed: 3,
      totalQuestPoints: 12,
      totalQuestV4: 1,
      totalQuestV3: 1,
      totalQuestV2: 1,
      totalQuestV1: 0,
      totalTouchesScored: 15,
      totalTouchesReceived: 4,
      totalRedCards: 0,
      competitionCount: 1,
      ratio: 1,
    },
  ],
  competitions: [
    {
      competitionId: 'old',
      competitionTitle: 'Quest d’automne',
      competitionDate: '2026-10-01T00:00:00.000Z',
      fencerCount: 8,
      addedAt: '2026-10-02T00:00:00.000Z',
    },
  ],
};

beforeEach(() => {
  api = {
    getSeasonRanking: vi.fn(async () => inSeason),
    includeInSeason: vi.fn(async () => ({ dryRun: false, competitionId: 'c1', fencers: 4 })),
    excludeFromSeason: vi.fn(async () => ({ dryRun: false, competitionId: 'old' })),
    resetSeason: vi.fn(async () => ({ dryRun: false, competitions: 1 })),
  };
  db = {
    getSeasonRanking: vi.fn(),
    getSeasonCompetitions: vi.fn(),
    addCompetitionToSeason: vi.fn(),
    removeCompetitionFromSeason: vi.fn(),
    resetSeason: vi.fn(),
  };
  (window as any).electronAPI = { db, api: fakeApiBridge(api) };
});

afterEach(() => {
  delete (window as any).electronAPI;
  for (const fn of Object.values(db)) expect(fn).not.toHaveBeenCalled();
});

const laser = {
  id: 'c1',
  title: 'Quest d’hiver',
  date: new Date('2026-12-06'),
  weapon: 'L',
} as unknown as Competition;

const renderView = () =>
  render(
    <SeasonRankingView
      onClose={vi.fn()}
      availableCompetitions={[laser]}
      availablePoolsByComp={{ c1: [{ id: 'p1' } as Pool] }}
    />
  );

describe('Classement de saison par le contrat (docs/adr/0018)', () => {
  it('lit le classement et les épreuves versées par getSeasonRanking', async () => {
    renderView();
    expect(await screen.findByText('DUPONT Ana')).toBeInTheDocument();
    expect(api.getSeasonRanking).toHaveBeenCalledWith({});
  });

  it('verse une épreuve : includeInSeason, puis relecture', async () => {
    renderView();
    await screen.findByText('DUPONT Ana');
    fireEvent.click(screen.getByRole('button', { name: 'Compétitions' }));
    fireEvent.click(await screen.findByRole('button', { name: '+ Ajouter' }));
    await waitFor(() => expect(api.includeInSeason).toHaveBeenCalledWith({ competitionId: 'c1' }));
    await waitFor(() => expect(api.getSeasonRanking).toHaveBeenCalledTimes(2));
  });

  it('retire une épreuve : excludeFromSeason', async () => {
    renderView();
    await screen.findByText('DUPONT Ana');
    fireEvent.click(screen.getByRole('button', { name: 'Compétitions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer' }));
    await waitFor(() =>
      expect(api.excludeFromSeason).toHaveBeenCalledWith({ competitionId: 'old' })
    );
  });

  it('remise à zéro après confirmation : resetSeason', async () => {
    renderView();
    await screen.findByText('DUPONT Ana');
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser saison' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Réinitialiser' }));
    await waitFor(() => expect(api.resetSeason).toHaveBeenCalledWith({}));
  });
});
