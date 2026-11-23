/**
 * Journée multi-épreuves (#1714) : arbitres partagés, vue d'ensemble, occupés ailleurs,
 * sur un dépôt simulé (le chemin SQLite réel est dans station.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Weapon } from '../../../shared/types';
import type { DatabaseManager } from '../../../database';
import type { OperationName } from '../../../shared/api/contract';
import { invoke } from '../api/engine';

const assignment = (competitionId: string, refereeId: string) => ({
  dayRefereeId: 'dr1',
  competitionId,
  competitionTitle: competitionId,
  refereeId,
  kind: 'pool' as const,
  number: 1,
  strip: 2,
});

describe('opérations de la journée (#1714)', () => {
  const repo = {
    getDay: vi.fn(() => ({ competitionIds: ['c1', 'c2'] })),
    syncCompetition: vi.fn(() => ({ added: 1, updated: 2 })),
    importCompetitionReferees: vi.fn(() => ({ added: 0, updated: 1, imported: 3 })),
    setCompetitionDay: vi.fn(),
    listReferees: vi.fn(() => [{ id: 'dr1', weapons: [Weapon.EPEE] }]),
    getAssignments: vi.fn(() => [assignment('c1', 'r1'), assignment('c2', 'r2')]),
    getCompetitionWeapons: vi.fn(() => ({ c1: Weapon.FOIL, c2: Weapon.FOIL })),
    getCompetitionDayId: vi.fn(() => 'd1' as string | null),
    getLinks: vi.fn(() => ({ r1: 'dr1' })),
  };

  const ctx = { db: { eventDays: repo } as unknown as DatabaseManager };
  beforeEach(() => vi.clearAllMocks());

  const call = (op: OperationName, input: Record<string, unknown>) => invoke(ctx, op, input);

  it('importe les arbitres des épreuves puis synchronise toutes les épreuves (#1872)', async () => {
    expect(await call('syncEventDayReferees', { dayId: 'd1' })).toEqual({
      added: 2,
      updated: 5,
      imported: 3,
    });
    expect(repo.importCompetitionReferees).toHaveBeenCalledWith('d1');
    expect(repo.syncCompetition).toHaveBeenCalledTimes(2);
  });

  it('rattacher importe et synchronise la journée, détacher non', async () => {
    expect(await call('assignCompetitionToDay', { competitionId: 'c1', dayId: 'd1' })).toEqual({
      added: 2,
      updated: 5,
      imported: 3,
    });
    expect(await call('assignCompetitionToDay', { competitionId: 'c1', dayId: null })).toEqual({
      added: 0,
      updated: 0,
    });
    expect(repo.setCompetitionDay).toHaveBeenLastCalledWith('c1', null);
    expect(repo.importCompetitionReferees).toHaveBeenCalledTimes(1);
    expect(repo.syncCompetition).toHaveBeenCalledTimes(2);
  });

  it('vue d’ensemble : statut commun et conflits', async () => {
    const o = (await call('getEventDayOverview', { dayId: 'd1' })) as {
      statuses: { state: string }[];
      conflicts: { kind: string }[];
    };
    expect(o.statuses[0].state).toBe('busy');
    expect(o.conflicts.map(c => c.kind)).toEqual(['multi_competition', 'weapon']);
  });

  it('occupé ailleurs : vide hors journée, sinon autres épreuves seulement', async () => {
    expect(await call('listBusyElsewhere', { competitionId: 'c1' })).toEqual({
      r1: [assignment('c2', 'r2')],
    });
    repo.getCompetitionDayId.mockReturnValueOnce(null);
    expect(await call('listBusyElsewhere', { competitionId: 'c1' })).toEqual({});
  });

  it('réservation et affectation automatique : écrites par la commande (#2134)', async () => {
    const rules: Record<number, unknown> = {};
    let auto = false;
    const db = {
      eventDays: {
        getDay: (id: string) => (id === 'd1' ? { id, stripCount: 3, competitionIds: [] } : null),
      },
      stripRules: {
        setStripRule: (_d: string, n: number, r: unknown) => {
          if (r) rules[n] = r;
          else delete rules[n];
        },
        setAutoAssign: (_d: string, on: boolean) => void (auto = on),
      },
    } as unknown as DatabaseManager;
    const run = (op: OperationName, input: Record<string, unknown>) => invoke({ db }, op, input);
    // Sans port du poste : la commande écrit elle-même
    expect(await run('setDayStripRule', { dayId: 'd1', strip: 4, rule: {} })).toBe(false);
    expect(await run('setDayStripRule', { dayId: 'inconnue', strip: 1, rule: {} })).toBe(false);
    expect(await run('setDayStripRule', { dayId: 'd1', strip: 2, rule: { pools: false } })).toBe(
      true
    );
    expect(rules[2]).toMatchObject({ pools: false });
    await run('setDayStripRule', { dayId: 'd1', strip: 2, rule: null });
    expect(rules[2]).toBeUndefined();
    expect(await run('setDayAutoAssign', { dayId: 'd1', on: true })).toBe(true);
    expect(auto).toBe(true);
    expect(await run('setDayAutoAssign', { dayId: 'inconnue', on: true })).toBe(false);
  });
});
