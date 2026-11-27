// @vitest-environment jsdom
/**
 * Résultats : filtres du classement final de la formule (docs/adr/0043, F4d). Proposés seulement
 * s'ils sont réglés ; classement filtré renuméroté depuis 1 pour l'écran, le CSV, le PDF et la
 * copie ; XML fédéral et FFF gardent le classement complet.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Competition, Fencer, PoolRanking } from '../../shared/types';
import { Category, FencerStatus, Gender } from '../../shared/types';
import type { RankingFilterKey } from '../../shared/domain/ranking/rankingFilters';

const { xml, fff, rankingPdf, printPdf } = vi.hoisted(() => ({
  xml: vi.fn((..._args: unknown[]) => '<xml/>'),
  fff: vi.fn((..._args: unknown[]) => 'fff'),
  rankingPdf: vi.fn(async (..._args: unknown[]) => undefined),
  printPdf: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock('../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../api/BpmClientContext', () => ({ useBpmClient: () => ({ call: vi.fn() }) }));
vi.mock('./Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../features/pdfTemplates/hooks/usePdfTemplateStore', () => ({
  usePdfTemplateStore: (sel: (s: unknown) => unknown) => sel({ templates: {} }),
}));
vi.mock('../../shared/utils/multiFormatExport', () => ({ exportResultsXMLFFE: xml }));
vi.mock('../../shared/utils/fencerExport', () => ({
  exportResultsToFFF: fff,
  encodeFFFWin1252: () => new Uint8Array(),
}));
vi.mock('../../shared/utils/pdfExport', () => ({
  exportResultsToPDF: rankingPdf,
  printResultsHTML: printPdf,
  exportFullCompetitionPDF: vi.fn(),
}));
vi.mock('./results/resultsExportData', () => ({
  loadExportFencers: async () => [],
  loadExportState: async () => ({ pools: [], tableauMatches: [] }),
  loadExportPoolSignatures: async () => ({}),
  loadExportTableauSignatures: async () => ({}),
}));

import ResultsView from './ResultsView';

const fencer = (id: string, extra: Partial<Fencer>): Fencer =>
  ({
    id,
    lastName: id,
    firstName: id,
    club: '',
    status: FencerStatus.CHECKED_IN,
    ...extra,
  }) as Fencer;
const A = fencer('A', { category: Category.SENIOR, gender: Gender.MALE, level: 3 });
const B = fencer('B', { category: Category.V1, gender: Gender.FEMALE, level: 2, handicap: true });
const C = fencer('C', {
  category: Category.SENIOR,
  gender: Gender.FEMALE,
  level: 3,
  handicap: true,
});
const D = fencer('D', { category: Category.U20, gender: Gender.MIXED, level: 1 });
const all = [A, B, C, D];
const results = [
  { rank: 1, fencer: A, eliminatedAt: 'Vainqueur' },
  { rank: 2, fencer: B, eliminatedAt: 'Finale' },
  { rank: 3, fencer: C, eliminatedAt: 'Demi-finales' },
  { rank: 3, fencer: D, eliminatedAt: 'Demi-finales' },
];
const pool = all.map((f, i) => ({ fencer: f, rank: i + 1 }) as PoolRanking);

const view = (filters?: RankingFilterKey[], entryLevels?: string[]) => {
  const formula = (
    filters || entryLevels
      ? {
          version: 2,
          phases: [],
          general: {
            ...(filters ? { rankingFilters: filters } : {}),
            ...(entryLevels ? { entry: { kind: 'team', size: 2, levels: entryLevels } } : {}),
          },
        }
      : undefined
  ) as never;
  return render(
    <ResultsView
      competition={{ id: 'c', title: 'Épreuve', settings: { formula } } as unknown as Competition}
      poolRanking={pool}
      finalResults={results}
      fencers={all}
      pools={[]}
      tableauMatches={[]}
      consolationBrackets={[]}
      isLaserSabre={false}
    />
  );
};

const rows = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map(r => r.textContent);
const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const exportMenu = (item: string) => {
  fireEvent.click(screen.getByRole('button', { name: /menu\.export/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
};

beforeEach(() => vi.clearAllMocks());

describe('Résultats : filtres du classement final', () => {
  it('aucun filtre réglé : rien n’est proposé, classement complet inchangé', () => {
    view();
    expect(screen.queryByTestId('ranking-filters')).toBeNull();
    expect(rows()).toHaveLength(4);
    expect(rows()[0]).toMatch(/1.*A/);
  });

  it('formule sans filtres : rien n’est proposé non plus', () => {
    view(undefined, ['beginner', 'intermediate', 'expert']);
    expect(screen.queryByTestId('ranking-filters')).toBeNull();
  });

  it('seuls les critères réglés sont proposés, avec les valeurs présentes', () => {
    view(['gender', 'handicap']);
    const bar = screen.getByTestId('ranking-filters');
    expect(within(bar).getByLabelText('rankingFilters.gender')).toBeInTheDocument();
    expect(within(bar).getByLabelText('rankingFilters.handicap_only')).toBeInTheDocument();
    expect(within(bar).queryByLabelText('rankingFilters.category')).toBeNull();
    expect(within(bar).queryByLabelText('rankingFilters.level')).toBeNull();
    const genders = within(screen.getByLabelText('rankingFilters.gender'))
      .getAllByRole('option')
      .map(o => o.getAttribute('value'));
    expect(genders).toEqual(['', 'M', 'F', 'X']);
  });

  it('filtre : lignes gardées, rangs depuis 1, ex aequo conservés', () => {
    view(['category', 'gender', 'level', 'handicap']);
    choose('rankingFilters.level', '3');
    expect(rows().map(r => r!.replace(/\s+/g, ' '))).toEqual([
      expect.stringMatching(/^1 ?A/),
      expect.stringMatching(/^2 ?C/),
    ]);
    // Ex aequo d'origine (3es) : C et D ; sans A ni B, ils restent ex aequo au 1er rang
    choose('rankingFilters.level', '');
    choose('rankingFilters.category', 'U20');
    expect(rows()).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('rankingFilters.handicap_only'));
    expect(screen.queryAllByRole('row').slice(1)).toHaveLength(0);
    choose('rankingFilters.category', '');
    expect(rows().map(r => r!.replace(/\s+/g, ' '))).toEqual([
      expect.stringMatching(/^1 ?B/),
      expect.stringMatching(/^2 ?C/),
    ]);
  });

  it('niveaux de la formule : libellés saisis tels quels', () => {
    view(['level'], ['Loisir', 'Compétition', 'Élite']);
    const labels = within(screen.getByLabelText('rankingFilters.level'))
      .getAllByRole('option')
      .map(o => o.textContent);
    expect(labels).toEqual(['rankingFilters.all_levels', 'Loisir', 'Compétition', 'Élite']);
  });

  it('CSV : classement filtré', async () => {
    let csv = '';
    Object.assign(URL, {
      createObjectURL: (b: Blob) => {
        void b.text().then(t => (csv = t));
        return 'blob:x';
      },
    });
    view(['handicap']);
    fireEvent.click(screen.getByLabelText('rankingFilters.handicap_only'));
    exportMenu('results.export_csv');
    await waitFor(() => expect(csv).not.toBe(''));
    const lines = csv.split('\n').slice(1);
    expect(lines.map(l => l.split(';').slice(0, 2))).toEqual([
      ['1', 'B'],
      ['2', 'C'],
    ]);
  });

  it('PDF du classement et impression : classement filtré, critères dans le titre', async () => {
    view(['gender', 'handicap']);
    choose('rankingFilters.gender', 'F');
    fireEvent.click(screen.getByLabelText('rankingFilters.handicap_only'));
    exportMenu('results.export_pdf_ranking');
    await waitFor(() => expect(rankingPdf).toHaveBeenCalled());
    const [pdfRows, title] = rankingPdf.mock.calls[0] as [
      Array<{ rank: number; fencer: Fencer }>,
      string,
    ];
    expect(pdfRows.map(r => [r.rank, r.fencer.id])).toEqual([
      [1, 'B'],
      [2, 'C'],
    ]);
    expect(title).toBe('Résultats — Épreuve — genders.female · teamEntry.handicap');
    fireEvent.click(screen.getByRole('button', { name: 'resultsView.print' }));
    await waitFor(() => expect(printPdf).toHaveBeenCalled());
    expect((printPdf.mock.calls[0][0] as unknown[]).length).toBe(2);
  });

  it('XML fédéral et FFF : classement complet, jamais filtré', () => {
    Object.assign(URL, { createObjectURL: () => 'blob:x' });
    view(['handicap']);
    fireEvent.click(screen.getByLabelText('rankingFilters.handicap_only'));
    exportMenu('results.export_xml_ffe');
    const finals = xml.mock.calls[0][2] as Array<{ fencer: Fencer }>;
    expect(finals.map(r => r.fencer.id)).toEqual(['A', 'B', 'C', 'D']);
    exportMenu('results.export_fff');
    expect((fff.mock.calls[0][1] as unknown[]).length).toBe(4);
  });

  it('champion et podium : toujours ceux du classement complet', () => {
    view(['handicap']);
    fireEvent.click(screen.getByLabelText('rankingFilters.handicap_only'));
    expect(screen.getByText('A A')).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
  });
});
