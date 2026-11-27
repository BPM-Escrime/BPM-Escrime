/**
 * Fin du mode spécial (docs/adr/0043, lot F4e) : le Tournoi des rapières, modèle de formule en
 * briques, est piloté par le moteur comme toute formule (tirage sans composition, vagues, tableau) ;
 * une épreuve enregistrée en mode spécial est tirée de même (niveau lu dans l'ancienne clé de
 * session) ; `specialMode` n'est plus écrit. Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { FencerStatus, Gender } from '../../../shared/types';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';
import { readSession } from './sessionView';
import { writeSession } from './sport';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = {
    db,
    emitChange: () => {},
    remote: {
      stop: () => {},
      settingsChanged: () => {},
      admin: { setActiveWave: () => {} } as never,
    },
  };
});
afterEach(() => db.close());

const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;

/** Huit équipes de niveaux 1 à 3 (membres sur le tireur) */
function addTeams(competitionId: string, withFields = true) {
  const levels = [3, 3, 2, 2, 2, 1, 1, 1];
  return levels.map((level, i) =>
    db.addFencer(competitionId, {
      lastName: `EQ${i + 1}`,
      firstName: `A${i} / B${i}`,
      gender: Gender.MIXED,
      club: `Club${i}`,
      ranking: i + 1,
      status: FencerStatus.CHECKED_IN,
      ...(withFields
        ? {
            level,
            members: [
              { lastName: `A${i}`, firstName: 'a' },
              { lastName: `B${i}`, firstName: 'b' },
            ],
          }
        : {}),
    } as never)
  );
}

d('Tournoi des rapières en briques : piloté par le moteur', () => {
  it('modèle bpm/C/rapieres : tirage sans composition par niveau, vagues, tableau', async () => {
    const created = await call('createCompetition', {
      title: 'Rapières',
      date: '2026-12-13',
      weapon: 'C',
      gender: 'X',
      category: 'SEN',
      templateId: 'bpm/C/rapieres',
    });
    const id = created.competitionId as string;
    expect(db.getCompetition(id)!.settings?.specialMode).toBeUndefined();
    const teams = addTeams(id);
    const drawn = await call('generatePools', { competitionId: id, poolCount: 2 });
    expect(drawn.round).toBe(1);
    const session = readSession(ctx, id) as any;
    expect(session.pools).toHaveLength(2);
    // Tour en vagues : état `waves` écrit, jamais l'ancienne clé
    expect(session.waves).toEqual({ launched: 0, ended: false });
    expect(session.rapieres).toBeUndefined();
    // Répartition par niveau : les équipes de même niveau sont regroupées (niveau 3 ensemble)
    const poolOf = (name: string) =>
      session.pools.findIndex((p: any) => p.fencers.some((f: any) => f.lastName === name));
    expect(poolOf('EQ1')).toBe(poolOf('EQ2'));
    const wave = await call('launchPoolWave', { competitionId: id, wave: 1 });
    expect(wave.matchIds.length).toBeGreaterThan(0);
    await call('endPoolWaves', { competitionId: id, ended: true });
    expect((readSession(ctx, id) as any).waves).toEqual({ launched: 1, ended: true });
    // Vagues arrêtées : le tableau se tire sur les matchs joués, tous qualifiés
    const bracket = await call('generateTableau', { competitionId: id });
    expect(bracket.qualified).toBe(teams.length);
  });

  it('mode spécial plus écrit : création et modification refusées', async () => {
    await expect(
      call('createCompetition', {
        title: 'X',
        date: '2026-12-13',
        weapon: 'C',
        gender: 'X',
        category: 'SEN',
        settings: { specialMode: 'rapieres' },
      })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
  });

  it('épreuve enregistrée en mode spécial : pilotée par le moteur, niveau lu dans la session', async () => {
    const comp = db.createCompetition({
      title: 'Ancienne',
      date: new Date('2026-12-06'),
      weapon: 'C' as never,
      gender: Gender.MIXED,
      category: 'SEN' as never,
      settings: {
        defaultPoolTimerSeconds: 180,
        defaultTableTimerSeconds: 180,
        poolRounds: 1,
        hasDirectElimination: true,
        manualRanking: false,
        defaultRanking: 9999,
        randomScore: false,
        defaultPoolMaxScore: 5,
        defaultTableMaxScore: 15,
        thirdPlaceMatch: true,
        minTeamSize: 3,
        specialMode: 'rapieres',
      } as never,
    });
    const teams = addTeams(comp.id, false);
    // Composition seulement dans l'ancienne clé de session (avant la migration 54)
    const levelCode = [
      'expert',
      'expert',
      'intermediate',
      'intermediate',
      'intermediate',
      'beginner',
      'beginner',
      'beginner',
    ];
    writeSession(ctx, comp.id, {
      rapieres: {
        version: 2,
        teams: Object.fromEntries(
          teams.map((t, i) => [
            t.id,
            {
              level: levelCode[i],
              fencers: [
                { lastName: `A${i}`, firstName: 'a', category: 'SENIOR' },
                { lastName: `B${i}`, firstName: 'b', category: 'SENIOR' },
              ],
            },
          ])
        ),
      },
    });
    await call('generatePools', { competitionId: comp.id, poolCount: 2 });
    const session = readSession(ctx, comp.id) as any;
    const poolOf = (name: string) =>
      session.pools.findIndex((p: any) => p.fencers.some((f: any) => f.lastName === name));
    expect(poolOf('EQ1')).toBe(poolOf('EQ2'));
    expect(session.waves).toEqual({ launched: 0, ended: false });
    await expect(
      call('launchPoolWave', { competitionId: comp.id, wave: 1 })
    ).resolves.toBeDefined();
  });

  it('formule modifiée avant le tirage : le mode spécial est effacé, les briques gardées', async () => {
    const comp = db.createCompetition({
      title: 'Ancienne',
      date: new Date('2026-12-06'),
      weapon: 'C' as never,
      gender: Gender.MIXED,
      category: 'SEN' as never,
      settings: {
        poolRounds: 1,
        hasDirectElimination: true,
        manualRanking: false,
        defaultRanking: 9999,
        randomScore: false,
        defaultPoolMaxScore: 5,
        defaultTableMaxScore: 15,
        defaultPoolTimerSeconds: 180,
        defaultTableTimerSeconds: 180,
        thirdPlaceMatch: true,
        minTeamSize: 3,
        specialMode: 'rapieres',
      } as never,
    });
    await call('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [{ op: 'setPhase', phase: 'pool-0', settings: { maxScore: 7 } }],
    });
    const settings = db.getCompetition(comp.id)!.settings as any;
    expect(settings.specialMode).toBeUndefined();
    expect(settings.formula.phases[0]).toMatchObject({
      maxScore: 7,
      boutOrder: 'waves',
      distribution: 'byLevel',
    });
    expect(settings.formula.general.entry).toMatchObject({ kind: 'team' });
  });
});
