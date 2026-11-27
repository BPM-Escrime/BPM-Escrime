// @vitest-environment jsdom
/**
 * Classement des rapières : filtres génériques du domaine (docs/adr/0043, F4d). Sans réglage de la
 * formule, les filtres actuels des rapières (catégorie, sexe, niveau, HANDI) ; sinon ceux de la
 * formule.
 */
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Fencer, FencerStatus, Gender } from '../../shared/types';
import type { RapieresTeamInfo } from '../../shared/domain/rapieres/rapieres.types';
import RapieresRankingPanel from './RapieresRankingPanel';

const { pdf } = vi.hoisted(() => ({ pdf: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock('../../renderer/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, p?: Record<string, string>) => (p ? `${k}:${Object.values(p).join(',')}` : k),
  }),
}));
vi.mock('../../renderer/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('./rapieresPdf', () => ({
  exportRapieresRankingToPDF: pdf,
  printRapieresRanking: vi.fn(async () => undefined),
}));

const fencer = (id: string): Fencer =>
  ({
    id,
    lastName: `Équipe ${id}`,
    firstName: '',
    gender: Gender.MIXED,
    status: FencerStatus.CHECKED_IN,
  }) as Fencer;

const info = (
  level: RapieresTeamInfo['level'],
  categories: [string, string],
  handi = false
): RapieresTeamInfo => ({
  level,
  fencers: [
    {
      firstName: 'A',
      lastName: 'a',
      category: (handi ? 'HANDI' : categories[0]) as never,
      gender: 'F',
    },
    { firstName: 'B', lastName: 'b', category: categories[1] as never, gender: 'F' },
  ],
});
const teams: Record<string, RapieresTeamInfo> = {
  x: info('expert', ['V1', 'V1']),
  y: info('beginner', ['SENIOR', 'SENIOR'], true),
  z: info('beginner', ['SENIOR', 'SENIOR']),
};
const ranked = [
  { teamId: 'x', rank: 1 },
  { teamId: 'y', rank: 2 },
  { teamId: 'z', rank: 3 },
];
const stats = new Map(
  ['x', 'y', 'z'].map(id => [id, { victories: 1, matches: 2, index: 0, touchesGiven: 5 }])
);

const panel = (filterKeys?: React.ComponentProps<typeof RapieresRankingPanel>['filterKeys']) =>
  render(
    <RapieresRankingPanel
      competitionTitle="Rapières"
      final
      wave={0}
      ranked={ranked}
      fencers={['x', 'y', 'z'].map(fencer)}
      teams={teams}
      stats={stats}
      filterKeys={filterKeys}
    />
  );
/** Rang et nom d'équipe de chaque ligne */
const lines = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map(r => {
      const cells = within(r).getAllByRole('cell');
      return `${cells[0].textContent} ${cells[1].textContent}`;
    });

beforeEach(() => vi.clearAllMocks());

describe('RapieresRankingPanel : filtres', () => {
  it('sans réglage de la formule : catégorie, sexe, niveau et HANDI (épreuve inchangée)', () => {
    panel();
    const bar = screen.getByTestId('ranking-filters');
    for (const key of ['category', 'gender', 'level'])
      expect(within(bar).getByLabelText(`rankingFilters.${key}`)).toBeInTheDocument();
    expect(within(bar).getByLabelText('rankingFilters.handicap_only')).toBeInTheDocument();
    // HANDI n'est plus une catégorie : filtre à part
    const categories = within(screen.getByLabelText('rankingFilters.category'))
      .getAllByRole('option')
      .map(o => o.getAttribute('value'));
    expect(categories).toEqual(['', 'M20', 'SENIOR', 'V1', 'V2', 'V3', 'V4']);
    expect(lines()).toHaveLength(3);
  });

  it('niveau : équipes seules, rangs depuis 1 ; HANDI cumulable', () => {
    panel();
    expect(lines()).toEqual(['1 Équipe x', '2 Équipe y', '3 Équipe z']);
    fireEvent.change(screen.getByLabelText('rankingFilters.level'), {
      target: { value: 'beginner' },
    });
    expect(lines()).toEqual(['1 Équipe y', '2 Équipe z']);
    fireEvent.click(screen.getByLabelText('rankingFilters.handicap_only'));
    expect(lines()).toEqual(['1 Équipe y']);
  });

  it('PDF : classement filtré, critères dans le sous-titre', () => {
    panel();
    fireEvent.click(screen.getByLabelText('rankingFilters.handicap_only'));
    fireEvent.click(screen.getByText('rapieres.export_pdf'));
    const table = pdf.mock.calls[0][0] as { subtitle: string; rows: unknown[][] };
    expect(table.rows).toHaveLength(1);
    expect(table.subtitle).toContain('rankingFilters.handicap');
  });

  it('filtres de la formule : seuls ceux-là sont proposés', () => {
    panel(['level']);
    const bar = screen.getByTestId('ranking-filters');
    expect(within(bar).getByLabelText('rankingFilters.level')).toBeInTheDocument();
    expect(within(bar).queryByLabelText('rankingFilters.category')).toBeNull();
    expect(within(bar).queryByLabelText('rankingFilters.handicap_only')).toBeNull();
  });
});
