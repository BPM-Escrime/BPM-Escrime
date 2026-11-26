// @vitest-environment jsdom
/**
 * Résultats de l'épreuve d'origine après une scission (#2013 E2b, docs/adr/0039) : classement
 * des tireurs restés dans l'origine, bloc « Branches » qui renvoie aux compétitions filles,
 * sans champion ni podium quand toutes les branches sont parties ; mélange (une branche restée
 * avec son tableau) : champion et podium de la branche restée.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Competition, Fencer, PoolRanking } from '../../shared/types';
import { FencerStatus } from '../../shared/types';
import { originFinalRanking, type SplitHistoryEntry } from '../../shared/domain/formula/splitPlan';

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
  }),
}));
vi.mock('../api/BpmClientContext', () => ({ useBpmClient: () => ({ call: vi.fn() }) }));
vi.mock('./Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../features/pdfTemplates/hooks/usePdfTemplateStore', () => ({
  usePdfTemplateStore: (sel: (s: unknown) => unknown) => sel({ templates: {} }),
}));

import ResultsView from './ResultsView';

const fencer = (id: string): Fencer =>
  ({ id, lastName: id, firstName: id, club: '', status: FencerStatus.CHECKED_IN }) as Fencer;
const all = ['A', 'B', 'C', 'D', 'E'].map(fencer);
const ranking = all.map((f, i) => ({ fencer: f, rank: i + 1 }) as PoolRanking);
// A, B en « Tableau A » ; C, D en « Tableau B » ; E éliminé avant la scission
const history: SplitHistoryEntry[] = [
  { label: 'Tableau A', competitionId: 'fa', fencerIds: ['A', 'B'] },
  { label: 'Tableau B', competitionId: 'fb', fencerIds: ['C', 'D'] },
];

const view = (onOpen = vi.fn()) => {
  const staged = originFinalRanking(ranking, [], history);
  render(
    <ResultsView
      competition={{ id: 'c', title: 'Coupe' } as Competition}
      poolRanking={staged.ranking}
      finalResults={[]}
      fencers={all}
      isLaserSabre={false}
      splitBranches={history}
      onOpenCompetition={onOpen}
    />
  );
  return onOpen;
};

describe('Résultats de l’épreuve d’origine scindée (ADR-0039)', () => {
  it('bloc « Branches » : libellé, nombre de tireurs, bouton « Ouvrir »', async () => {
    view();
    const block = await screen.findByTestId('split-branches');
    expect(within(block).getByText('resultsView.branches_title')).toBeInTheDocument();
    const items = within(block).getAllByRole('listitem');
    expect(items.map(li => li.textContent)).toEqual([
      expect.stringMatching(/Tableau A.*"n":2.*resultsView\.open_branch/),
      expect.stringMatching(/Tableau B.*"n":2.*resultsView\.open_branch/),
    ]);
  });

  it('« Ouvrir » ouvre la compétition fille', async () => {
    const onOpen = view();
    fireEvent.click(await screen.findByTestId('split-branch-open-Tableau B'));
    expect(onOpen).toHaveBeenCalledWith('fb');
  });

  it('classement : seuls les tireurs restés dans l’origine, ni champion ni podium', () => {
    view();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('E');
    expect(screen.queryByText('resultsView.champion')).toBeNull();
    expect(screen.queryByText('resultsView.first')).toBeNull();
  });

  it('mélange : branche restée avec ses résultats finals, champion et podium affichés', async () => {
    // Hommes (A, B, C, D) restés en tableau séparé ; Dames (E, F) parties en fille
    const men = ['A', 'B', 'C', 'D'].map(fencer);
    const dames: SplitHistoryEntry[] = [
      { label: 'Dames', competitionId: 'fd', fencerIds: ['E', 'F'] },
    ];
    const pool = [...men, fencer('E'), fencer('F')].map(
      (f, i) => ({ fencer: f, rank: i + 1 }) as PoolRanking
    );
    const staged = originFinalRanking(pool, [], dames);
    render(
      <ResultsView
        competition={{ id: 'c', title: 'Coupe' } as Competition}
        poolRanking={staged.ranking}
        finalResults={[
          { rank: 1, fencer: men[1], eliminatedAt: '' },
          { rank: 2, fencer: men[0], eliminatedAt: 'Finale' },
          { rank: 3, fencer: men[2], eliminatedAt: '1/2' },
          { rank: 3, fencer: men[3], eliminatedAt: '1/2' },
        ]}
        fencers={[...men, fencer('E'), fencer('F')]}
        isLaserSabre={false}
        splitBranches={dames}
        onOpenCompetition={vi.fn()}
      />
    );
    expect(await screen.findByTestId('split-branches')).toBeInTheDocument();
    expect(screen.getByText('resultsView.champion')).toBeInTheDocument();
    expect(screen.getByText('resultsView.first')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringMatching(/^1.*B/),
      expect.stringMatching(/^2.*A/),
      expect.stringMatching(/^3.*C/),
      expect.stringMatching(/^3.*D/),
    ]);
  });

  it('épreuve non scindée : pas de bloc « Branches »', () => {
    render(
      <ResultsView
        competition={{ id: 'c', title: 'Coupe' } as Competition}
        poolRanking={ranking}
        finalResults={[]}
        fencers={all}
        isLaserSabre={false}
      />
    );
    expect(screen.queryByTestId('split-branches')).toBeNull();
    expect(screen.getByText('resultsView.champion')).toBeInTheDocument();
  });
});
