// @vitest-environment jsdom
/**
 * Classement des équipes : filtres génériques du domaine (docs/adr/0043, F4d, F4e) sur les champs
 * du tireur-équipe ; seuls les critères de la formule sont proposés.
 */
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Category, Fencer, FencerStatus, Gender } from '../../shared/types';
import type { RankingFilterKey } from '../../shared/domain/ranking/rankingFilters';
import TeamRankingPanel from './TeamRankingPanel';

const { pdf } = vi.hoisted(() => ({ pdf: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock('../../renderer/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, p?: Record<string, string>) => (p ? `${k}:${Object.values(p).join(',')}` : k),
  }),
}));
vi.mock('../../renderer/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('./teamRankingPdf', () => ({
  exportTeamRankingToPDF: pdf,
  printTeamRanking: vi.fn(async () => undefined),
}));

const team = (id: string, level: number, category: Category, handicap = false): Fencer =>
  ({
    id,
    lastName: `Équipe ${id}`,
    firstName: '',
    gender: Gender.FEMALE,
    status: FencerStatus.CHECKED_IN,
    members: [
      { lastName: 'a', firstName: 'A', gender: 'F' },
      { lastName: 'b', firstName: 'B', gender: 'F' },
    ],
    level,
    category,
    handicap,
  }) as Fencer;
const fencers = [
  team('x', 3, Category.V1),
  team('y', 1, Category.SENIOR, true),
  team('z', 1, Category.SENIOR),
];
const ranked = [
  { teamId: 'x', rank: 1 },
  { teamId: 'y', rank: 2 },
  { teamId: 'z', rank: 3 },
];
const stats = new Map(
  ['x', 'y', 'z'].map(id => [id, { victories: 1, matches: 2, index: 0, touchesGiven: 5 }])
);
const ALL: RankingFilterKey[] = ['category', 'gender', 'level', 'handicap'];

const panel = (filterKeys: RankingFilterKey[] = ALL) =>
  render(
    <TeamRankingPanel
      competitionTitle="Rapières"
      final
      wave={0}
      ranked={ranked}
      fencers={fencers}
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

describe('TeamRankingPanel : filtres', () => {
  it('filtres de la formule des rapières : catégorie, sexe, niveau et HANDI', () => {
    panel();
    const bar = screen.getByTestId('ranking-filters');
    for (const key of ['category', 'gender', 'level'])
      expect(within(bar).getByLabelText(`rankingFilters.${key}`)).toBeInTheDocument();
    expect(within(bar).getByLabelText('rankingFilters.handicap_only')).toBeInTheDocument();
    // HANDI n'est plus une catégorie : filtre à part
    const categories = within(screen.getByLabelText('rankingFilters.category'))
      .getAllByRole('option')
      .map(o => o.getAttribute('value'));
    expect(categories).toEqual(['', 'SEN', 'V1']);
    expect(lines()).toHaveLength(3);
  });

  it('niveau : équipes seules, rangs depuis 1 ; HANDI cumulable', () => {
    panel();
    expect(lines()).toEqual(['1 Équipe x', '2 Équipe y', '3 Équipe z']);
    fireEvent.change(screen.getByLabelText('rankingFilters.level'), {
      target: { value: '1' },
    });
    expect(lines()).toEqual(['1 Équipe y', '2 Équipe z']);
    fireEvent.click(screen.getByLabelText('rankingFilters.handicap_only'));
    expect(lines()).toEqual(['1 Équipe y']);
  });

  it('PDF : classement filtré, critères dans le sous-titre', () => {
    panel();
    fireEvent.click(screen.getByLabelText('rankingFilters.handicap_only'));
    fireEvent.click(screen.getByText('teamEntry.export_pdf'));
    const table = pdf.mock.calls[0][0] as { subtitle: string; rows: unknown[][] };
    expect(table.rows).toHaveLength(1);
    expect(table.subtitle).toContain('teamEntry.handicap');
  });

  it('filtres de la formule : seuls ceux-là sont proposés', () => {
    panel(['level']);
    const bar = screen.getByTestId('ranking-filters');
    expect(within(bar).getByLabelText('rankingFilters.level')).toBeInTheDocument();
    expect(within(bar).queryByLabelText('rankingFilters.category')).toBeNull();
    expect(within(bar).queryByLabelText('rankingFilters.handicap_only')).toBeNull();
  });
});
