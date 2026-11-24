/**
 * Plan des pistes par le moteur (docs/adr/0015, #2033) sur une base SQLite réelle :
 * setStripStart, setStripAvailability (épreuve, journée dans une transaction), getStripPlan,
 * journal StripStartChanged / StripAvailabilityChanged, rejeu sans écart, signal `strips`,
 * outils MCP, purge et archive par competition_id, envoi du plan au serveur distant.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { keepOnlyCompetition } from '../../../database/competitionArchive';
import { Category, Gender, Weapon } from '../../../shared/types';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../../shared/domain/journal/compareWithState';
import { CONTRACT_MCP_TOOLS } from '../api/mcpAdapter';
import { invoke } from '../api/engine';
import { emitChangeVia } from '../../mcp/mcpDomain';
import { onCompetitionEvent, publishCompetitionEvent } from '../api/events';
import { watchStripPlans } from '../../remote/stripPlan';
import type { CommandContext, DomainChange } from './context';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;
let changes: DomainChange[];

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  changes = [];
  ctx = { db, emitChange: c => changes.push(c) };
});
afterEach(() => db.close());

const call = (op: string, input: Record<string, unknown>, c: CommandContext = ctx) =>
  invoke(c, op as never, input as never) as Promise<any>;
const events = (id: string) => db.eventLog.getSince(id);

const competition = (title = 'Épée seniors') =>
  db.createCompetition({
    title,
    date: new Date('2026-12-06'),
    location: 'Gymnase',
    weapon: Weapon.EPEE,
    gender: Gender.MIXED,
    category: Category.SENIOR,
  }).id;

/** Journal rejoué comparé au plan en base */
function divergences(competitionId: string) {
  const facts = projectCompetition(events(competitionId));
  return compareWithState(
    facts,
    { ...stateView({}, {}), strips: db.stripPlans.getStripPlan(competitionId) },
    {}
  );
}

d('plan des pistes par le moteur (ADR-0015)', () => {
  it('plan par défaut sans ligne ; épreuve inconnue refusée', async () => {
    const c1 = competition();
    expect(await call('getStripPlan', { competitionId: c1 })).toEqual({
      competitionId: c1,
      start: 1,
      unavailable: [],
      updatedAt: null,
    });
    await expect(call('getStripPlan', { competitionId: 'nope' })).rejects.toMatchObject({
      code: 'competition_not_found',
    });
  });

  it('setStripStart : écrit, journalise, signale ; même valeur : rien', async () => {
    const c1 = competition();
    const r = await call('setStripStart', { competitionId: c1, start: 5 });
    expect(r).toMatchObject({ dryRun: false, changed: true, plan: { start: 5 }, revision: 1 });
    expect(r.plan.updatedAt).toEqual(expect.any(String));
    expect(events(c1).map(e => [e.type, e.payload])).toEqual([['StripStartChanged', { start: 5 }]]);
    expect(changes).toEqual([{ scope: 'strips', competitionIds: [c1] }]);

    const again = await call('setStripStart', { competitionId: c1, start: 5 });
    expect(again.changed).toBe(false);
    expect(events(c1)).toHaveLength(1);

    const dry = await call('setStripStart', { competitionId: c1, start: 8, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, changed: true, plan: { start: 8 } });
    expect(db.stripPlans.getStripPlan(c1).start).toBe(5);
    expect(events(c1)).toHaveLength(1);
  });

  it('setStripAvailability : panne puis remise en service, journal et rejeu sans écart', async () => {
    const c1 = competition();
    await call('setStripStart', { competitionId: c1, start: 2 });
    await call('setStripAvailability', { competitionId: c1, strip: 4, available: false });
    await call('setStripAvailability', { competitionId: c1, strip: 3, available: false });
    const r = await call('setStripAvailability', { competitionId: c1, strip: 4, available: true });
    expect(r).toMatchObject({
      dryRun: false,
      changedCompetitionIds: [c1],
      plans: [{ competitionId: c1, start: 2, unavailable: [3] }],
    });
    // Déjà dans l'état demandé : aucun événement
    const same = await call('setStripAvailability', {
      competitionId: c1,
      strip: 3,
      available: false,
    });
    expect(same.changedCompetitionIds).toEqual([]);
    expect(events(c1).map(e => e.type)).toEqual([
      'StripStartChanged',
      'StripAvailabilityChanged',
      'StripAvailabilityChanged',
      'StripAvailabilityChanged',
    ]);
    expect(divergences(c1)).toEqual([]);
    // Les événements de plan ne rendent pas le journal incomplet
    expect(projectCompetition(events(c1)).strips).toEqual({
      start: 2,
      available: { 3: false, 4: true },
    });
  });

  it('rejeu : un plan changé hors commande est un écart', async () => {
    const c1 = competition();
    await call('setStripAvailability', { competitionId: c1, strip: 4, available: false });
    db.stripPlans.saveStripPlan(c1, { start: 3, unavailable: [] }, 'x');
    expect(divergences(c1)).toEqual([
      { kind: 'strip_plan', id: '4', expected: false, actual: true },
    ]);
  });

  it('eventDayId : la panne vaut pour toutes les épreuves de la journée, un commandId', async () => {
    const c1 = competition('Épée H');
    const c2 = competition('Épée D');
    const c3 = competition('Hors journée');
    const day = db.eventDays.createDay({ name: 'Samedi', date: '2026-12-06', stripCount: 8 });
    db.eventDays.setCompetitionDay(c1, day.id);
    db.eventDays.setCompetitionDay(c2, day.id);
    await call('setStripAvailability', { competitionId: c2, strip: 5, available: false });

    const dry = await call('setStripAvailability', {
      eventDayId: day.id,
      strip: 5,
      available: false,
      dryRun: true,
    });
    expect(dry.changedCompetitionIds).toEqual([c1]);
    expect(db.stripPlans.getStripPlan(c1).unavailable).toEqual([]);

    changes = [];
    const r = await call('setStripAvailability', {
      eventDayId: day.id,
      strip: 5,
      available: false,
    });
    expect(r.changedCompetitionIds).toEqual([c1]);
    expect(r.plans.map((p: { competitionId: string }) => p.competitionId).sort()).toEqual(
      [c1, c2].sort()
    );
    for (const id of [c1, c2]) expect(db.stripPlans.getStripPlan(id).unavailable).toEqual([5]);
    expect(db.stripPlans.getStripPlan(c3).unavailable).toEqual([]);
    expect(changes).toEqual([{ scope: 'strips', competitionIds: [c1] }]);

    const back = await call('setStripAvailability', {
      eventDayId: day.id,
      strip: 5,
      available: true,
    });
    expect(back.changedCompetitionIds.sort()).toEqual([c1, c2].sort());
    const last = (id: string) => events(id)[events(id).length - 1];
    expect(last(c1).commandId).toBe(last(c2).commandId);
    expect(last(c1).payload).toEqual({ strip: 5, available: true });
    for (const id of [c1, c2]) expect(divergences(id)).toEqual([]);
  });

  /** Journée de trois épreuves */
  function day3() {
    const ids = ['Épée H', 'Épée D', 'Fleuret'].map(competition);
    const day = db.eventDays.createDay({ name: 'Dimanche', date: '2026-12-07', stripCount: 8 });
    for (const id of ids) db.eventDays.setCompetitionDay(id, day.id);
    return { ids, dayId: day.id };
  }

  it('journée : une runCommand par épreuve, journal:appended pour chacune, commandId repris', async () => {
    const { ids, dayId } = day3();
    const seen: Array<{ competitionId?: string; revision?: number }> = [];
    const off = onCompetitionEvent(e => {
      if (e.type === 'journal:appended')
        seen.push({ competitionId: e.competitionId, revision: e.revision });
    });
    try {
      await call('setStripAvailability', {
        eventDayId: dayId,
        strip: 3,
        available: false,
        commandId: 'cmd-day-1',
      });
    } finally {
      off();
    }
    expect(seen.map(s => s.competitionId).sort()).toEqual([...ids].sort());
    expect(seen.every(s => s.revision === 1)).toBe(true);
    for (const id of ids) {
      expect(events(id).map(e => [e.type, e.commandId])).toEqual([
        ['StripAvailabilityChanged', 'cmd-day-1'],
      ]);
    }
  });

  it('journée : rejouer le même commandId ne réécrit rien (command_already_applied)', async () => {
    const { ids, dayId } = day3();
    const input = { eventDayId: dayId, strip: 3, available: false, commandId: 'cmd-day-2' };
    await call('setStripAvailability', input);
    // Entre-temps, une épreuve remet la piste en service : le rejeu ne la remarque pas
    await call('setStripAvailability', { competitionId: ids[1], strip: 3, available: true });
    await expect(call('setStripAvailability', input)).rejects.toMatchObject({
      code: 'command_already_applied',
    });
    expect(db.stripPlans.getStripPlan(ids[1]).unavailable).toEqual([]);
    expect(events(ids[0])).toHaveLength(1);
    expect(events(ids[1])).toHaveLength(2);
  });

  it('journée : une épreuve en échec au milieu → aucune écriture, aucun événement', async () => {
    const { ids, dayId } = day3();
    const save = db.stripPlans.saveStripPlan.bind(db.stripPlans);
    const spy = vi.spyOn(db.stripPlans, 'saveStripPlan').mockImplementation((id, plan, at) => {
      if (id === ids[1]) throw new Error('disque plein');
      save(id, plan, at);
    });
    await expect(
      call('setStripAvailability', { eventDayId: dayId, strip: 4, available: false })
    ).rejects.toMatchObject({ code: 'internal' });
    spy.mockRestore();
    for (const id of ids) {
      expect(db.stripPlans.getStripPlan(id)).toMatchObject({ unavailable: [], updatedAt: null });
      expect(events(id)).toEqual([]);
    }
  });

  it('journée : expectedRevision refusé (une révision par épreuve)', async () => {
    const { dayId } = day3();
    await expect(
      call('setStripAvailability', {
        eventDayId: dayId,
        strip: 2,
        available: false,
        expectedRevision: 0,
      })
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refus : journée inconnue, ni ou les deux identifiants, piste hors bornes', async () => {
    const c1 = competition();
    await expect(
      call('setStripAvailability', { eventDayId: 'nope', strip: 2, available: false })
    ).rejects.toMatchObject({ code: 'event_day_not_found' });
    await expect(
      call('setStripAvailability', { strip: 2, available: false })
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      call('setStripAvailability', {
        competitionId: c1,
        eventDayId: 'x',
        strip: 2,
        available: false,
      })
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('setStripStart', { competitionId: c1, start: 0 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('outils MCP : lecture du plan, écriture par la même commande', async () => {
    const c1 = competition();
    const read = CONTRACT_MCP_TOOLS.read.find(t => t.name === 'get_strip_plan')!;
    const write = CONTRACT_MCP_TOOLS.write.find(t => t.name === 'set_strip_availability')!;
    expect(CONTRACT_MCP_TOOLS.write.map(t => t.name)).toContain('set_strip_start');
    const deps = { db, notify: vi.fn() } as never;
    await write.run(deps, { competitionId: c1, strip: 7, available: false });
    expect(await read.run(deps, { competitionId: c1 })).toMatchObject({ unavailable: [7] });
    expect(events(c1)[0]).toMatchObject({ source: 'mcp', type: 'StripAvailabilityChanged' });
  });

  it('serveur distant : reçoit le plan relu après la commande (écran ou MCP)', async () => {
    const c1 = competition();
    const setStripPlan = vi.fn();
    const off = watchStripPlans(db, id => (id === c1 ? { setStripPlan } : undefined));
    const screen: CommandContext = {
      db,
      emitChange: emitChangeVia((type, id) => publishCompetitionEvent({ type, competitionId: id })),
    };
    try {
      await call('setStripStart', { competitionId: c1, start: 3 }, screen);
      await call('setStripAvailability', { competitionId: c1, strip: 4, available: false }, screen);
      await Promise.resolve();
      expect(setStripPlan).toHaveBeenLastCalledWith({ start: 3, unavailable: [4] });
    } finally {
      off();
    }
  });

  it('suppression de l’épreuve et archive .bpm : parcours générique de competition_id', async () => {
    const c1 = competition();
    const c2 = competition('Autre');
    await call('setStripStart', { competitionId: c1, start: 4 });
    await call('setStripStart', { competitionId: c2, start: 6 });
    keepOnlyCompetition((db as unknown as { db: never }).db, c1);
    expect(db.stripPlans.getStripPlan(c1).start).toBe(4);
    expect(db.stripPlans.getStripPlan(c2).updatedAt).toBeNull();
    db.deleteCompetition(c1);
    expect(db.stripPlans.getStripPlan(c1).updatedAt).toBeNull();
  });
});
