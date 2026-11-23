// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  loadDECards,
  loadDESignatures,
  PDF_DIALOG_INIT,
  SCORE_EDIT_INIT,
} from './tableauDialogState';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';
import type { BpmClient } from '../../../shared/api/client';

const m = (id: string, a: string, b: string) =>
  ({ id, fencerA: { id: a }, fencerB: { id: b } }) as unknown as TableauMatch;

afterEach(() => {
  delete (window as any).electronAPI;
});

/** Client du contrat (#1981) : requête getCardsByMatchIds simulée */
const cardsClient = (getCardsByMatchIds: (ids: string[]) => Promise<unknown>) =>
  ({
    query: vi.fn((_name: string, input: { matchIds: string[] }) =>
      getCardsByMatchIds(input.matchIds)
    ),
    call: vi.fn(),
    subscribe: vi.fn(),
  }) as unknown as BpmClient;

describe('tableauDialogState', () => {
  it('états initiaux', () => {
    expect(SCORE_EDIT_INIT.showScoreModal).toBe(false);
    expect(PDF_DIALOG_INIT.pdfMode).toBe('pdf');
    expect(PDF_DIALOG_INIT.selectedRounds.size).toBe(0);
  });

  it('loadDESignatures associe signature au bon côté (getTableauSignatures)', async () => {
    const client = {
      query: vi.fn().mockResolvedValue([
        { matchId: 'm1', fencerId: 'b', signatureData: 'SB' },
        { matchId: 'm1', fencerId: 'zz', signatureData: 'X' },
        { matchId: 'nope', fencerId: 'a', signatureData: 'Y' },
      ]),
      call: vi.fn(),
      subscribe: vi.fn(),
    } as unknown as BpmClient;
    expect(await loadDESignatures([m('m1', 'a', 'b')], client)).toEqual({ m1: { B: 'SB' } });
    expect(client.query).toHaveBeenCalledWith('getTableauSignatures', { matchIds: ['m1'] });
  });

  it('loadDESignatures : identifiants envoyés par lots de 512 (borne du contrat)', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const client = { query, call: vi.fn(), subscribe: vi.fn() } as unknown as BpmClient;
    const many = Array.from({ length: 600 }, (_, i) => m(`m${i}`, 'a', 'b'));
    expect(await loadDESignatures(many, client)).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1].matchIds).toHaveLength(88);
  });

  it('loadDECards : id composite (saisie distante) ou id simple, rangés par côté (#1829)', async () => {
    const getCardsByMatchIds = vi.fn().mockResolvedValue([
      { matchId: 'comp-m1', fencerId: 'a', cardType: 'yellow' },
      { matchId: 'comp-m1', fencerId: 'a', cardType: 'p-red' },
      { matchId: 'm2', fencerId: 'd', cardType: 'red' },
      { matchId: 'm2', fencerId: 'zz', cardType: 'red' },
      { matchId: 'nope', fencerId: 'a', cardType: 'black' },
    ]);
    expect(
      await loadDECards(
        [m('m1', 'a', 'b'), m('m2', 'c', 'd')],
        'comp',
        cardsClient(getCardsByMatchIds)
      )
    ).toEqual({
      m1: { A: ['yellow', 'p-red'] },
      m2: { B: ['red'] },
    });
    expect(getCardsByMatchIds).toHaveBeenCalledWith(['m1', 'comp-m1', 'm2', 'comp-m2']);
  });

  it('loadDECards : match saisi à distance, lignes sous l’id simple ignorées (pas de doublon)', async () => {
    const getCardsByMatchIds = vi.fn().mockResolvedValue([
      { matchId: 'comp-m1', fencerId: 'a', cardType: 'yellow' },
      { matchId: 'm1', fencerId: 'a', cardType: 'yellow' },
    ]);
    expect(await loadDECards([m('m1', 'a', 'b')], 'comp', cardsClient(getCardsByMatchIds))).toEqual(
      {
        m1: { A: ['yellow'] },
      }
    );
  });

  it('loadDECards : undefined sans carton ou en cas d erreur', async () => {
    expect(await loadDECards([m('m1', 'a', 'b')], 'comp')).toBeUndefined();
    expect(
      await loadDECards(
        [m('m1', 'a', 'b')],
        'comp',
        cardsClient(vi.fn().mockRejectedValue(new Error('x')))
      )
    ).toBeUndefined();
  });

  it('retourne undefined sans lignes ou en cas d erreur', async () => {
    // Hors Electron : client par défaut indisponible
    expect(await loadDESignatures([m('m1', 'a', 'b')])).toBeUndefined();
    const failing = {
      query: vi.fn().mockRejectedValue(new Error('x')),
      call: vi.fn(),
      subscribe: vi.fn(),
    } as unknown as BpmClient;
    expect(await loadDESignatures([m('m1', 'a', 'b')], failing)).toBeUndefined();
  });
});
