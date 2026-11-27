// @vitest-environment jsdom
/**
 * Passage au tableau depuis le classement (#1996) : un tableau déjà tiré n'est jamais refait.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCompetitionNavigation } from './useCompetitionNavigation';
import type { TableauMatch } from '../../shared/domain/tableau/tableauTypes';
import React from 'react';
import { BpmClientProvider } from '../api/BpmClientContext';
import type { BpmClient } from '../../shared/api/client';
import { getTableauTies, setTableauTies } from './tableauTiesChoice';
import { FencerStatus, type PoolRanking } from '../../shared/types';

vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
const { confirmMock, chooseMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  chooseMock: vi.fn(),
}));
vi.mock('../components/ConfirmDialog', () => ({
  useConfirm: () => ({ confirm: confirmMock, choose: chooseMock }),
}));
const { planOverride } = vi.hoisted(() => ({ planOverride: { current: null as unknown } }));
vi.mock('../../shared/domain/pools/roundSeeding', async importOriginal => {
  const actual = await importOriginal<typeof import('../../shared/domain/pools/roundSeeding')>();
  return {
    ...actual,
    nextRoundPlan: (input: Parameters<typeof actual.nextRoundPlan>[0]) =>
      planOverride.current ?? actual.nextRoundPlan(input),
  };
});
vi.mock('./useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const setup = (
  tableauMatches: TableauMatch[],
  rankingChanged = false,
  thirdPlaceMatch = false,
  client?: BpmClient,
  extra: Record<string, unknown> = {}
) => {
  const fns = {
    setCurrentPhase: vi.fn(),
    setTableauMatches: vi.fn(),
    setConsolationBrackets: vi.fn(),
    setRankingChanged: vi.fn(),
  };
  const onUpdate = vi.fn();
  const params = {
    competition: { id: 'c', settings: {} },
    onUpdate,
    fencers: [
      { id: 'f1', lastName: 'ALPHA', firstName: 'A' },
      { id: 'f2', lastName: 'BRAVO', firstName: 'B' },
    ],
    updateFencers: vi.fn(),
    getCheckedInFencers: () => [],
    pools: [],
    setPools: vi.fn(),
    overallRanking: [],
    setOverallRanking: vi.fn(),
    computeOverallRanking: vi.fn(() => []),
    nextPoolRound: vi.fn(),
    currentPoolRound: 1,
    currentAppelFencers: [],
    poolRoundQualifiers: undefined,
    customFormula: undefined,
    hasDirectElimination: true,
    thirdPlaceMatch,
    playAllPositions: false,
    isRapieres: false,
    updateRapieres: vi.fn(),
    setShowRapieresTableauDialog: vi.fn(),
    setPoolsLaunched: vi.fn(),
    setViewedPoolRound: vi.fn(),
    setRankingValidated: vi.fn(),
    setSkipPoolPhase: vi.fn(),
    rankingChanged,
    tableauMatches,
    consolationBrackets: [],
    finalResults: [],
    setFinalResults: vi.fn(),
    activeSplitGroup: null,
    groupTableaux: {},
    showSplitGroup: vi.fn(),
    ...fns,
    ...extra,
  };
  const { result } = renderHook(
    () =>
      useCompetitionNavigation(params as unknown as Parameters<typeof useCompetitionNavigation>[0]),
    client
      ? {
          wrapper: ({ children }: { children: React.ReactNode }) => (
            <BpmClientProvider client={client}>{children}</BpmClientProvider>
          ),
        }
      : undefined
  );
  return {
    ...fns,
    params,
    onUpdate,
    go: result.current.handleGoToTableau,
    nextRound: result.current.handleNextPoolRound,
  };
};

describe('handleGoToTableau (#1996)', () => {
  it('tableau déjà tiré : retour au tableau, rien n’est effacé', () => {
    const s = setup([{ id: '16-0' } as TableauMatch], true);
    s.go();
    expect(s.setCurrentPhase).toHaveBeenCalledWith('tableau');
    expect(s.setTableauMatches).not.toHaveBeenCalled();
    expect(s.setConsolationBrackets).not.toHaveBeenCalled();
    expect(s.onUpdate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'pas encore de tableau : petite finale reprise de la formule, sans question (#2013) — %s',
    thirdPlace => {
      const s = setup([], false, thirdPlace);
      s.go();
      expect(s.onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ thirdPlaceMatch: thirdPlace }),
        })
      );
      expect(s.setCurrentPhase).toHaveBeenCalledWith('tableau');
    }
  );
});

describe('passage au tableau : ex aequo à la barre (ADR-0040)', () => {
  // Formule : un tour, 1 qualifié pour le tableau ; deux tireurs ex aequo à la 1re place
  const formula = {
    version: 2,
    general: {},
    phases: [
      { kind: 'pool', id: 'p', qualification: { mode: 'fixed_count', count: 1 } },
      { kind: 'tableau', id: 't' },
    ],
  };
  const row = (id: string): PoolRanking =>
    ({ fencer: { id, status: FencerStatus.QUALIFIED }, rank: 1 }) as PoolRanking;
  const extra = {
    competition: { id: 'c', settings: { formula } },
    overallRanking: [row('f1'), row('f2')],
  };

  it('ex aequo listés avant la génération ; le choix vaut pour ce tableau', async () => {
    setTableauTies('c', undefined);
    chooseMock.mockResolvedValueOnce('initial_ranking');
    const s = setup([], false, false, undefined, extra);
    s.go();
    await vi.waitFor(() => expect(s.setCurrentPhase).toHaveBeenCalledWith('tableau'));
    const asked = chooseMock.mock.calls[chooseMock.mock.calls.length - 1][0];
    expect(asked.message).toContain('tiesAtBar.notice');
    expect(getTableauTies('c')).toBe('initial_ranking');
  });

  it('choix annulé : rien n’est tiré', async () => {
    chooseMock.mockResolvedValueOnce(null);
    const s = setup([], false, false, undefined, extra);
    s.go();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.setCurrentPhase).not.toHaveBeenCalled();
    expect(s.onUpdate).not.toHaveBeenCalled();
  });

  it('sans ex aequo à la barre : pas de question, choix précédent oublié', () => {
    setTableauTies('c', 'all');
    chooseMock.mockClear();
    const s = setup([], false, false);
    s.go();
    expect(chooseMock).not.toHaveBeenCalled();
    expect(getTableauTies('c')).toBeUndefined();
    expect(s.setCurrentPhase).toHaveBeenCalledWith('tableau');
  });
});

describe('handleNextPoolRound par le moteur (docs/adr/0017)', () => {
  it('simulation pour la confirmation, puis closePoolRound ; écran vers l’appel', async () => {
    const call = vi.fn(async (_name: string, input: { dryRun?: boolean }) =>
      input.dryRun
        ? { dryRun: true, round: 1, nextRound: 2, qualified: 8, eliminated: 4 }
        : { dryRun: false, round: 1, nextRound: 2, qualified: 8, eliminated: 4 }
    );
    confirmMock.mockResolvedValueOnce(true);
    const s = setup([], false, false, { call } as unknown as BpmClient);
    await s.nextRound();
    expect(confirmMock).toHaveBeenCalledWith('pools.next_round_confirm');
    expect(call).toHaveBeenNthCalledWith(1, 'closePoolRound', { competitionId: 'c', dryRun: true });
    expect(call).toHaveBeenNthCalledWith(2, 'closePoolRound', { competitionId: 'c' });
    expect(s.setCurrentPhase).toHaveBeenCalledWith('checkin');
    // Rien d'écrit par l'écran : le moteur a éliminé et archivé le tour
    expect(s.params.updateFencers).not.toHaveBeenCalled();
    expect(s.params.nextPoolRound).not.toHaveBeenCalled();
  });

  it('confirmation refusée : aucune clôture', async () => {
    const call = vi.fn(async () => ({ nextRound: 2, qualified: 8, eliminated: 4 }));
    confirmMock.mockResolvedValueOnce(false);
    const s = setup([], false, false, { call } as unknown as BpmClient);
    await s.nextRound();
    expect(call).toHaveBeenCalledTimes(1);
    expect(s.setCurrentPhase).not.toHaveBeenCalled();
  });

  it('ex aequo à la barre (ADR-0040) : listés, choix pour cette coupe, closePoolRound avec « ties »', async () => {
    const tiedAtBar = { rank: 4, fencerIds: ['f1', 'f2'], places: 1 };
    const call = vi.fn(async (_name: string, input: { dryRun?: boolean; ties?: string }) => ({
      dryRun: !!input.dryRun,
      round: 1,
      nextRound: 2,
      qualified: input.ties === 'initial_ranking' ? 4 : 5,
      eliminated: 2,
      tiedAtBar,
    }));
    chooseMock.mockResolvedValueOnce('initial_ranking');
    confirmMock.mockResolvedValueOnce(true);
    const s = setup([], false, false, { call } as unknown as BpmClient);
    await s.nextRound();
    const asked = chooseMock.mock.calls[0][0];
    expect(asked.choices.map((c: { value: string }) => c.value)).toEqual([
      'all',
      'initial_ranking',
      'draw',
    ]);
    expect(asked.message).toContain('tiesAtBar.notice');
    expect(call).toHaveBeenNthCalledWith(2, 'closePoolRound', {
      competitionId: 'c',
      dryRun: true,
      ties: 'initial_ranking',
    });
    expect(call).toHaveBeenNthCalledWith(3, 'closePoolRound', {
      competitionId: 'c',
      ties: 'initial_ranking',
    });
  });

  it('ex aequo à la barre : choix annulé, aucune clôture', async () => {
    const call = vi.fn(async () => ({
      nextRound: 2,
      qualified: 5,
      eliminated: 2,
      tiedAtBar: { rank: 4, fencerIds: ['f1', 'f2'], places: 1 },
    }));
    chooseMock.mockResolvedValueOnce(null);
    const s = setup([], false, false, { call } as unknown as BpmClient);
    await s.nextRound();
    expect(call).toHaveBeenCalledTimes(1);
    expect(s.setCurrentPhase).not.toHaveBeenCalled();
  });

  it('moteur absent (repli local) : ex aequo listés et choisis, comme le moteur', async () => {
    const row = (id: string, rank: number, entry: number) =>
      ({
        fencer: {
          id,
          lastName: id,
          firstName: 'P',
          ranking: entry,
          status: FencerStatus.QUALIFIED,
        },
        rank,
      }) as unknown as PoolRanking;
    // 4 qualifiés ; c, d, e ex aequo à la 3e place : e (rang d'entrée 1) passe
    planOverride.current = {
      ranking: [row('a', 1, 5), row('b', 2, 6), row('c', 3, 7), row('d', 3, 8), row('e', 3, 1)],
      qualifierCount: 4,
      ties: undefined,
      seeding: 'previous_round',
    };
    const call = vi.fn(async () => {
      throw Object.assign(new Error('absent'), { code: 'unavailable' });
    });
    chooseMock.mockResolvedValueOnce('initial_ranking');
    confirmMock.mockResolvedValueOnce(true);
    const s = setup([], false, false, { call } as unknown as BpmClient);
    await s.nextRound();
    planOverride.current = null;
    expect(chooseMock).toHaveBeenCalled();
    // Qualifiés : a, b, puis e et c départagés au rang d'entrée (quota de 4 tenu)
    const updates = (s.params.updateFencers as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Object.keys(updates).sort()).toEqual(['a', 'b', 'c', 'e']);
  });
});
