/**
 * Pistes d'une journée (#1878) : contrôle des entrées, réservation, affectation en un clic
 * et automatique sur des serveurs d'épreuve simulés.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDayStripService } from './dayStripService';
import type { WaitingWork } from './stripHandover';
import type { StripRule } from '../../shared/types/eventDay';

function setup() {
  const rules: Record<number, StripRule> = {};
  let auto = false;
  const occupied = new Set<number>([1]);
  let waiting: WaitingWork[] = [{ kind: 'pool', poolId: 'p2', poolNumber: 2, fromArena: null }];
  const server = {
    hasSession: () => true,
    hasArenaAssignment: (id: string) => occupied.has(Number(id.replace('arena', ''))),
    canHostStrip: (n: number) => n <= 3,
    getWaitingWork: () => waiting,
    moveWorkToArena: vi.fn((w: WaitingWork, n: number) => {
      occupied.add(n);
      waiting = waiting.filter(x => x !== w);
      return true;
    }),
  };
  const db = {
    eventDays: {
      getDay: (id: string) =>
        id === 'd1' ? ({ id, stripCount: 3, competitionIds: ['c1'] } as never) : null,
    },
    stripRules: {
      getStripRules: () => rules,
      setStripRule: (_d: string, n: number, r: StripRule | null) => {
        if (r) rules[n] = r;
        else delete rules[n];
      },
      getAutoAssign: () => auto,
      setAutoAssign: (_d: string, on: boolean) => void (auto = on),
      listAutoAssignDays: () => (auto ? ['d1'] : []),
    },
    getCompetition: () => ({ title: 'M15 Fleuret' }),
    getMatch: () => null,
    getCompetitionPools: () => [],
  };
  const service = createDayStripService({
    db: db as never,
    getServer: id => (id === 'c1' ? (server as never) : undefined),
    autoAssignIntervalMs: 20,
  });
  const dispose = () => service.dispose();
  /** Les anciens canaux eventDay:* nomment les opérations du service */
  const calls: Record<string, (...args: unknown[]) => unknown> = {
    'eventDay:getStripBoard': service.board,
    'eventDay:assignStrip': service.assign,
    'eventDay:setStripRule': service.setRule,
    'eventDay:setAutoAssign': service.setAutoAssign,
  };
  const call = (channel: string, ...args: unknown[]) => calls[channel](...args);
  return { call, server, dispose, rules };
}

describe('dayStripService (#1878)', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => ctx.dispose());

  it('tableau des pistes : occupée, libre avec proposition', () => {
    const board = ctx.call('eventDay:getStripBoard', 'd1') as {
      strips: { competitionId: string | null; candidates: { key: string }[] }[];
    };
    expect(board.strips.map(s => s.competitionId)).toEqual(['c1', null, null]);
    expect(board.strips[1].candidates.map(c => c.key)).toEqual(['c1|pool:p2']);
    expect(ctx.call('eventDay:getStripBoard', 'inconnue')).toBeNull();
  });

  it('affectation : piste hors salle ou réservée refusée, piste libre acceptée', () => {
    expect(ctx.call('eventDay:assignStrip', 'd1', 9, 'c1|pool:p2')).toBe(false);
    expect(
      ctx.call('eventDay:setStripRule', 'd1', 2, {
        competitions: null,
        pools: false,
        tableau: true,
        tableauMax: null,
      })
    ).toBe(true);
    expect(ctx.call('eventDay:assignStrip', 'd1', 2, 'c1|pool:p2')).toBe(false);
    expect(ctx.call('eventDay:assignStrip', 'd1', 3, 'c1|pool:p2')).toBe(true);
    expect(ctx.server.moveWorkToArena).toHaveBeenCalledWith(expect.anything(), 3);
  });

  it('réservation : entrées invalides refusées, null retire la réservation', () => {
    expect(ctx.call('eventDay:setStripRule', 'd1', 0, {})).toBe(false);
    expect(ctx.call('eventDay:setStripRule', 'd1', 4, {})).toBe(false);
    ctx.call('eventDay:setStripRule', 'd1', 2, { pools: false });
    expect(ctx.rules[2]).toMatchObject({ pools: false });
    ctx.call('eventDay:setStripRule', 'd1', 2, null);
    expect(ctx.rules[2]).toBeUndefined();
  });

  it('affectation automatique : la piste libre est prise sans clic', async () => {
    expect(ctx.call('eventDay:setAutoAssign', 'd1', true)).toBe(true);
    await vi.waitFor(() => expect(ctx.server.moveWorkToArena).toHaveBeenCalledTimes(1), {
      timeout: 1000,
    });
    expect(ctx.server.moveWorkToArena).toHaveBeenCalledWith(
      expect.objectContaining({ poolId: 'p2' }),
      2
    );
  });
});
