/**
 * Tour en vagues (docs/adr/0043, lot F4a) : launchPoolWave, endPoolWaves sur une épreuve
 * ordinaire (anciennes commandes retirées à F4e), rejeu d'un journal qui
 * mêle anciens (Rapieres*) et nouveaux (PoolWave*) événements. Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../../shared/domain/journal/compareWithState';
import { waveMatchOrder } from '../../../shared/domain/pools/waves';
import type { CommandContext } from './context';
import { EVENT, recordEvents } from './eventLog';
import { listMatches } from './sport';
import { invoke } from '../api/engine';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

const setActiveWave = vi.fn();
let db: DatabaseManager;
let ctx: CommandContext;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  setActiveWave.mockClear();
  ctx = {
    db,
    emitChange: () => {},
    // Faux port distant : seul le filtre de vague des tablettes est observé
    remote: { stop: () => {}, settingsChanged: () => {}, admin: { setActiveWave } as never },
  };
});
afterEach(() => db.close());

function setup(fencerCount: number, settings: Record<string, unknown> = {}) {
  const weapon = Weapon.EPEE;
  const comp = db.createCompetition({
    title: 'Vagues',
    date: new Date('2026-12-06'),
    weapon,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: {
      ...buildDefaultCompetitionSettings({ weapon, category: Category.SENIOR }),
      ...settings,
    } as never,
  });
  for (let i = 0; i < fencerCount; i++) {
    db.addFencer(comp.id, {
      lastName: `NOM${i}`,
      firstName: `P${i}`,
      club: `Club${i}`,
      ranking: i + 1,
      status: FencerStatus.CHECKED_IN,
    });
  }
  return comp;
}

const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;
const session = (id: string) => db.getSessionState(id) as any;
const types = (id: string) => db.eventLog.getSince(id).map(e => e.type);

function replay(competitionId: string) {
  const facts = projectCompetition(db.eventLog.getSince(competitionId));
  const statuses = Object.fromEntries(
    db.getFencersByCompetition(competitionId).map(f => [f.id, f.status as string])
  );
  return compareWithState(facts, stateView(session(competitionId) ?? {}), statuses);
}

d('tour en vagues hors mode rapières (docs/adr/0043, F4a)', () => {
  it('le tirage suit l’ordre des vagues, launchPoolWave lance une vague, journal PoolWaveLaunched', async () => {
    const comp = setup(6, { poolBoutOrder: 'waves', poolSizeMin: 2, poolSizeMax: 10 });
    await call('generatePools', { competitionId: comp.id, poolCount: 1 });
    const [pool] = session(comp.id).pools;
    // Ordre des matchs du tirage = ordre des vagues, numéros de poule tels quels
    const order = pool.matches.map((m: any) => [
      pool.fencers.findIndex((f: any) => f.id === m.fencerA.id) + 1,
      pool.fencers.findIndex((f: any) => f.id === m.fencerB.id) + 1,
    ]);
    expect(order).toEqual(waveMatchOrder(pool.fencers));

    const res = await call('launchPoolWave', { competitionId: comp.id, wave: 1 });
    expect(res.matchIds).toHaveLength(3);
    expect(session(comp.id).waves).toEqual({ launched: 1, ended: false });
    expect(types(comp.id).slice(-1)).toEqual(['PoolWaveLaunched']);
    expect(db.eventLog.getSince(comp.id).slice(-1)[0].payload).toEqual({
      wave: 1,
      matchIds: res.matchIds,
    });
    await expect(
      call('launchPoolWave', { competitionId: comp.id, wave: 99 })
    ).rejects.toMatchObject({ code: 'invalid_wave' });
    expect(replay(comp.id)).toEqual([]);
  });

  it('épreuve sans tour en vagues : commandes refusées', async () => {
    const comp = setup(6);
    await call('generatePools', { competitionId: comp.id, poolCount: 1 });
    await expect(call('launchPoolWave', { competitionId: comp.id, wave: 1 })).rejects.toMatchObject(
      { code: 'unsupported_format' }
    );
    await expect(
      call('endPoolWaves', { competitionId: comp.id, ended: true })
    ).rejects.toMatchObject({ code: 'unsupported_format' });
  });

  it('vagues arrêtées : tour terminé sans les matchs non joués, puis reprises', async () => {
    const comp = setup(6, { poolBoutOrder: 'waves', poolSizeMin: 2, poolSizeMax: 10 });
    await call('generatePools', { competitionId: comp.id, poolCount: 1 });
    await call('launchPoolWave', { competitionId: comp.id, wave: 1 });
    // Tant que des matchs restent à jouer : le tableau est refusé
    await expect(call('generateTableau', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'pools_not_complete',
    });
    await call('endPoolWaves', { competitionId: comp.id, ended: true });
    expect(session(comp.id).waves).toEqual({ launched: 1, ended: true });
    expect(session(comp.id).overallRanking.length).toBeGreaterThan(0);
    // Vagues arrêtées = tour terminé : le refus « poules non terminées » tombe
    await call('generateTableau', { competitionId: comp.id, dryRun: true }).catch((e: any) => {
      expect(e.code).not.toBe('pools_not_complete');
    });
    await call('endPoolWaves', { competitionId: comp.id, ended: false });
    expect(session(comp.id).waves).toEqual({ launched: 1, ended: false });
    expect(types(comp.id).slice(-3)).toEqual([
      'PoolWaveLaunched',
      'PoolWavesEnded',
      'PoolWavesEnded',
    ]);
    expect(replay(comp.id)).toEqual([]);
  });

  it('reconstruction : l’état des vagues est réaligné sur le journal (clé waves)', async () => {
    const comp = setup(6, { poolBoutOrder: 'waves', poolSizeMin: 2, poolSizeMax: 10 });
    await call('generatePools', { competitionId: comp.id, poolCount: 1 });
    await call('launchPoolWave', { competitionId: comp.id, wave: 2 });
    db.saveSessionState(comp.id, { ...session(comp.id), waves: { launched: 0, ended: true } });
    const dry = await call('rebuildCompetitionState', { competitionId: comp.id, dryRun: true });
    expect(dry.divergences.map((x: { kind: string }) => x.kind)).toEqual(['waves']);
    const fixed = await call('rebuildCompetitionState', { competitionId: comp.id });
    expect(fixed.repaired.map((x: { kind: string }) => x.kind)).toEqual(['waves']);
    expect(session(comp.id).waves).toEqual({ launched: 2, ended: false });
    expect(replay(comp.id)).toEqual([]);
  });

  it('tablettes : le moteur pousse la vague active (lancée, arrêtée, reprise, tirage)', async () => {
    const comp = setup(6, { poolBoutOrder: 'waves', poolSizeMin: 2, poolSizeMax: 10 });
    await call('generatePools', { competitionId: comp.id, poolCount: 1 });
    // Tirage : vagues à zéro, aucun match proposé
    expect(setActiveWave).toHaveBeenLastCalledWith(comp.id, [], false);
    const { matchIds } = await call('launchPoolWave', { competitionId: comp.id, wave: 1 });
    expect(setActiveWave).toHaveBeenLastCalledWith(comp.id, matchIds, false);
    await call('endPoolWaves', { competitionId: comp.id, ended: true });
    expect(setActiveWave).toHaveBeenLastCalledWith(comp.id, null, true);
    await call('endPoolWaves', { competitionId: comp.id, ended: false });
    expect(setActiveWave).toHaveBeenLastCalledWith(comp.id, matchIds, false);
    // Simulation (dryRun) : rien poussé
    setActiveWave.mockClear();
    await call('launchPoolWave', { competitionId: comp.id, wave: 2, dryRun: true });
    expect(setActiveWave).not.toHaveBeenCalled();
    // Nouveau tirage hors tour en vagues : filtre levé
    db.updateCompetition(comp.id, {
      settings: { ...comp.settings, poolBoutOrder: 'fie', poolSizeMin: 3, poolSizeMax: 7 },
    } as never);
    await call('generatePools', { competitionId: comp.id, poolCount: 1, replace: true });
    expect(setActiveWave).toHaveBeenLastCalledWith(comp.id, null, false);
  });

  it('vagues classiques : poules de 11 à 15 tirées avec la table fixe', async () => {
    const comp = setup(12, { poolBoutOrder: 'waves_classic', poolSizeMin: 2, poolSizeMax: 15 });
    await call('generatePools', { competitionId: comp.id, poolCount: 1 });
    expect(session(comp.id).pools[0].fencers).toHaveLength(12);
    expect(session(comp.id).pools[0].matches).toHaveLength(66);
    const res = await call('launchPoolWave', { competitionId: comp.id, wave: 1 });
    // Première ligne de la table de 12 : six matchs
    expect(res.matchIds).toHaveLength(6);
  });

  it('un nouveau tirage remet les vagues à zéro', async () => {
    const comp = setup(6, { poolBoutOrder: 'waves', poolSizeMin: 2, poolSizeMax: 10 });
    await call('generatePools', { competitionId: comp.id, poolCount: 1 });
    await call('launchPoolWave', { competitionId: comp.id, wave: 2 });
    await call('generatePools', { competitionId: comp.id, poolCount: 2, replace: true });
    expect(session(comp.id).waves).toEqual({ launched: 0, ended: false });
    expect(replay(comp.id)).toEqual([]);
  });

  it('ordre « waves_classic » : table fixe des poules de 10, vagues lues sur les matchs', async () => {
    const comp = setup(10, { poolBoutOrder: 'waves_classic', poolSizeMin: 2, poolSizeMax: 10 });
    await call('generatePools', { competitionId: comp.id, poolCount: 1 });
    const matches = listMatches(ctx, comp.id, {});
    expect(matches).toHaveLength(45);
    const res = await call('launchPoolWave', { competitionId: comp.id, wave: 1 });
    // Première ligne de la table classique : 1-2 3-4 5-6 7-8 9-10
    expect(res.matchIds).toHaveLength(5);
  });

  it('poules de 2 : admises pour un tour en vagues, refusées sinon', async () => {
    const waves = setup(4, { poolBoutOrder: 'waves', poolSizeMin: 2, poolSizeMax: 2 });
    await call('generatePools', { competitionId: waves.id, poolCount: 2 });
    expect(session(waves.id).pools).toHaveLength(2);
    expect(session(waves.id).pools[0].fencers).toHaveLength(2);
  });
});

d('anciens journaux et ancienne clé de session d’avant F4a (docs/adr/0043, lus après F4e)', () => {
  it('ancienne clé rapieres.launchedWave lue comme alias de waves ; journal mêlant anciens et nouveaux événements, sans écart', async () => {
    const comp = setup(6, { poolBoutOrder: 'waves', poolSizeMin: 2, poolSizeMax: 10 });
    await call('generatePools', { competitionId: comp.id, poolCount: 1 });
    // État d'avant F4a : vague 2 lancée, écrite sous l'ancienne clé, événement Rapieres*
    const old = session(comp.id);
    delete old.waves;
    db.saveSessionState(comp.id, {
      ...old,
      rapieres: { version: 2, teams: {}, launchedWave: 2, wavesEnded: false },
    });
    recordEvents(ctx, comp.id, [
      { type: EVENT.rapieresWaveLaunched, payload: { wave: 2, matchIds: [] } },
    ]);
    expect(replay(comp.id)).toEqual([]);
    // Une nouvelle commande part de l'ancienne valeur (vague 2) et écrit la clé waves
    await call('endPoolWaves', { competitionId: comp.id, ended: true });
    expect(session(comp.id).waves).toEqual({ launched: 2, ended: true });
    await call('launchPoolWave', { competitionId: comp.id, wave: 3 });
    expect(session(comp.id).waves).toEqual({ launched: 3, ended: true });
    expect(types(comp.id).slice(-3)).toEqual([
      'RapieresWaveLaunched',
      'PoolWavesEnded',
      'PoolWaveLaunched',
    ]);
    expect(replay(comp.id)).toEqual([]);
  });
});
