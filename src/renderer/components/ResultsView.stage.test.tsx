// @vitest-environment jsdom
/**
 * Résultats d'une épreuve à tableau arrêté (#2013 D2b, docs/adr/0037) : classement final
 * (rankAfterStages) et tableau clos repris par l'écran et par les exports CSV, XML, PDF du
 * classement et livret.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Competition, Fencer, PoolRanking } from '../../shared/types';
import { FencerStatus } from '../../shared/types';
import type { TableauMatch } from '../../shared/domain/tableau/tableauTypes';
import { rankAfterStages, type TableauStageRecord } from '../../shared/domain/tableau/tableauStage';

const { xml, rankingPdf, fullPdf } = vi.hoisted(() => ({
  xml: vi.fn((..._args: unknown[]) => '<xml/>'),
  rankingPdf: vi.fn(async (..._args: unknown[]) => undefined),
  fullPdf: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock('../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../api/BpmClientContext', () => ({ useBpmClient: () => ({ call: vi.fn() }) }));
vi.mock('./Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../features/pdfTemplates/hooks/usePdfTemplateStore', () => ({
  usePdfTemplateStore: (sel: (s: unknown) => unknown) => sel({ templates: {} }),
}));
vi.mock('../../shared/utils/multiFormatExport', () => ({ exportResultsXMLFFE: xml }));
vi.mock('../../shared/utils/pdfExport', () => ({
  exportResultsToPDF: rankingPdf,
  exportFullCompetitionPDF: fullPdf,
}));
vi.mock('./results/resultsExportData', () => ({
  loadExportFencers: async () => [],
  loadExportState: async () => ({ pools: [], tableauMatches: [] }),
  loadExportPoolSignatures: async () => ({}),
  loadExportTableauSignatures: async () => ({}),
}));

import ResultsView from './ResultsView';

const fencer = (id: string): Fencer =>
  ({ id, lastName: id, firstName: id, club: '', status: FencerStatus.CHECKED_IN }) as Fencer;
const [A, B, C, D] = ['A', 'B', 'C', 'D'].map(fencer);
const match = (a: Fencer, b: Fencer, winner: Fencer, seeds: [number, number]): TableauMatch => ({
  id: `${a.id}-${b.id}`,
  round: 4,
  position: 1,
  fencerA: a,
  fencerB: b,
  scoreA: 15,
  scoreB: 7,
  winner,
  isBye: false,
  seedA: seeds[0],
  seedB: seeds[1],
});
// Tableau de 4 arrêté à 2 : A et B restent, C et D éliminés au tableau de 4
const stage: TableauStageRecord = {
  kind: 'tableau',
  stopAt: 2,
  matches: [match(A, D, A, [1, 4]), match(B, C, B, [2, 3])],
  eliminated: [
    { fencerId: C.id, round: 4, seed: 3 },
    { fencerId: D.id, round: 4, seed: 4 },
  ],
};
// Classement des tours : poule finale (B devant A), puis tour d'avant le tableau
const merged = [B, A, D, C].map((f, i) => ({ fencer: f, rank: i + 1 }) as PoolRanking);
const staged = rankAfterStages(merged, [stage]);

const view = () =>
  render(
    <ResultsView
      competition={{ id: 'c', title: 'Arrêt' } as Competition}
      poolRanking={staged.ranking}
      stageEliminatedAt={staged.eliminatedAt}
      finalResults={[]}
      fencers={[A, B, C, D]}
      pools={[]}
      tableauMatches={stage.matches}
      consolationBrackets={[]}
      isLaserSabre={false}
    />
  );

const exportMenu = (item: string) => {
  fireEvent.click(screen.getByRole('button', { name: /menu\.export/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
};

describe('Résultats après un tableau arrêté (ADR-0037)', () => {
  it('écran : restants, puis éliminés du tableau « Tableau de 4 »', () => {
    view();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringMatching(/1.*B.*Poules/),
      expect.stringMatching(/2.*A.*Poules/),
      expect.stringMatching(/3.*C.*Tableau de 4/),
      expect.stringMatching(/4.*D.*Tableau de 4/),
    ]);
  });

  it('CSV : même classement et même libellé', async () => {
    let csv = '';
    const create = vi.fn((b: Blob) => {
      void b.text().then(t => (csv = t));
      return 'blob:x';
    });
    Object.assign(URL, { createObjectURL: create });
    view();
    exportMenu('results.export_csv');
    await waitFor(() => expect(csv).not.toBe(''));
    const lines = csv.split('\n').slice(1);
    expect(lines.map(l => l.split(';')[1])).toEqual(['B', 'A', 'C', 'D']);
    expect(lines[2]).toContain('Tableau de 4');
  });

  it('XML FFE : classement final et tableau clos', () => {
    Object.assign(URL, { createObjectURL: () => 'blob:x' });
    view();
    exportMenu('results.export_xml_ffe');
    const [, ranking, finals, , matches] = xml.mock.calls[0] as [
      unknown,
      PoolRanking[],
      Array<{ fencer: Fencer; eliminatedAt: string }>,
      unknown,
      TableauMatch[],
    ];
    expect(ranking).toBe(staged.ranking);
    expect(finals.map(r => [r.fencer.id, r.eliminatedAt])).toEqual([
      ['B', 'Poules'],
      ['A', 'Poules'],
      ['C', 'Tableau de 4'],
      ['D', 'Tableau de 4'],
    ]);
    expect(matches).toBe(stage.matches);
  });

  it('PDF du classement et livret : classement final, tableau clos', async () => {
    view();
    exportMenu('results.export_pdf_ranking');
    await waitFor(() => expect(rankingPdf).toHaveBeenCalled());
    const rows = rankingPdf.mock.calls[0][0] as Array<{ fencer: Fencer }>;
    expect(rows.map(r => r.fencer.id)).toEqual(['B', 'A', 'C', 'D']);

    exportMenu('results.export_pdf_full_signed');
    fireEvent.click(screen.getByRole('button', { name: 'results.book_generate' }));
    await waitFor(() => expect(fullPdf).toHaveBeenCalled());
    const book = fullPdf.mock.calls[0][0] as { tableauMatches: TableauMatch[] };
    expect(book.tableauMatches).toBe(stage.matches);
  });
});
