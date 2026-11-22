/**
 * Création, réglages et suppression d'une épreuve (docs/adr/0018), base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;
let competitionId: string;
const changes: string[] = [];

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  changes.length = 0;
  ctx = { db, emitChange: c => changes.push(c.scope) };
  competitionId = db.createCompetition({
    title: 'Inscription',
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    }) as never,
  }).id;
});
afterEach(() => db.close());

const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, { competitionId, ...input } as never) as Promise<any>;

d('épreuves (docs/adr/0018)', () => {
  it('createCompetition : défauts du moteur, réglages choisis fusionnés, clé inconnue et valeur invalide refusées', async () => {
    const r = await invoke(
      ctx,
      'createCompetition' as never,
      {
        title: 'Open de Lyon',
        date: '2026-12-13',
        weapon: 'S',
        gender: 'F',
        category: 'U17',
        location: 'Lyon',
        settings: { thirdPlaceMatch: true },
      } as never
    );
    const id = (r as any).competitionId as string;
    const comp = db.getCompetition(id)!;
    expect(comp).toMatchObject({ title: 'Open de Lyon', weapon: 'S', category: 'U17' });
    expect(comp.settings.thirdPlaceMatch).toBe(true);
    expect(comp.settings.defaultPoolMaxScore).toBeGreaterThan(0);
    expect(changes).toContain('competitions');
    await expect(
      invoke(
        ctx,
        'createCompetition' as never,
        {
          title: 'X',
          date: '2026-12-13',
          weapon: 'E',
          gender: 'M',
          category: 'SEN',
          settings: { inconnu: 1 },
        } as never
      )
    ).rejects.toMatchObject({ code: 'invalid_input' });
    // Valeur invalide : refusée à l'entrée (schéma des réglages)
    await expect(
      call('updateCompetitionSettings', { settings: { defaultPoolMaxScore: 'cinq' } })
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('updateCompetitionDetails : titre, date, lieu ; entrée stricte', async () => {
    const r = await call('updateCompetitionDetails', {
      details: { title: 'Renommée', location: 'Nice', date: '2027-01-02' },
    });
    expect(r.changed.sort()).toEqual(['date', 'location', 'title']);
    const comp = db.getCompetition(competitionId)!;
    expect(comp).toMatchObject({ title: 'Renommée', location: 'Nice' });
    await expect(
      call('updateCompetitionDetails', { details: { weapon: 'S' } })
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('updateCompetitionSettings : fusion, serveur distant prévenu, arme figée après le tirage', async () => {
    const remote = { stop: vi.fn(), settingsChanged: vi.fn() };
    ctx.remote = remote;
    const r = await call('updateCompetitionSettings', {
      settings: { blackCardEnabled: true },
      gender: 'F',
    });
    expect(r.changed).toEqual(['gender', 'settings.blackCardEnabled']);
    const comp = db.getCompetition(competitionId)!;
    expect(comp.settings.blackCardEnabled).toBe(true);
    expect(comp.settings.defaultPoolMaxScore).toBeGreaterThan(0); // fusion, pas remplacement
    expect(remote.settingsChanged).toHaveBeenCalledWith(competitionId, { blackCardEnabled: true });

    // Avant le tirage : l'arme change
    await call('updateCompetitionSettings', { weapon: 'F' });
    expect(db.getCompetition(competitionId)!.weapon).toBe('F');

    for (let i = 0; i < 4; i++) {
      db.addFencer(competitionId, {
        lastName: `N${i}`,
        firstName: 'P',
        status: 'P' as never,
        ranking: i + 1,
      });
    }
    await call('generatePools', { poolCount: 1 });
    await expect(call('updateCompetitionSettings', { weapon: 'E' })).rejects.toMatchObject({
      code: 'draw_done',
    });
    // Réglage non figé : toujours admis (petite finale décidée au tableau)
    await call('updateCompetitionSettings', { settings: { thirdPlaceMatch: true } });
    expect(db.getCompetition(competitionId)!.settings.thirdPlaceMatch).toBe(true);
  });

  it('deleteCompetition : saisie distante arrêtée, épreuve supprimée', async () => {
    const remote = { stop: vi.fn(), settingsChanged: vi.fn() };
    ctx.remote = remote;
    await call('deleteCompetition', {});
    expect(remote.stop).toHaveBeenCalledWith(competitionId);
    expect(db.getCompetition(competitionId)).toBeNull();
  });

  it('getCompetition et listCompetitions : dates ISO, réglages, nombre de tireurs', async () => {
    db.addFencer(competitionId, { lastName: 'A', firstName: 'A' });
    const one = (await invoke(ctx, 'getCompetition' as never, { competitionId } as never)) as any;
    expect(one).toMatchObject({ id: competitionId, title: 'Inscription', weapon: 'E' });
    expect(one.date).toMatch(/^2026-12-06/);
    expect(one.settings.defaultPoolMaxScore).toBeGreaterThan(0);
    const all = (await invoke(ctx, 'listCompetitions' as never, {} as never)) as any[];
    expect(all).toEqual([expect.objectContaining({ id: competitionId, fencerCount: 1 })]);
    await expect(
      invoke(ctx, 'getCompetition' as never, { competitionId: 'inconnue' } as never)
    ).rejects.toMatchObject({ code: 'competition_not_found' });
  });

  it('formule validée à chaque écriture (docs/adr/0012) ; réglage ancien hors bornes toléré', async () => {
    await expect(
      invoke(
        ctx,
        'createCompetition' as never,
        {
          title: 'X',
          date: '2026-12-13',
          weapon: 'E',
          gender: 'M',
          category: 'SEN',
          settings: { poolRounds: 9 },
        } as never
      )
    ).rejects.toMatchObject({ code: 'invalid_settings' });
    await expect(
      call('updateCompetitionSettings', { settings: { poolSizeMin: 7, poolSizeMax: 5 } })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
    // Épreuve 2.0 : score de poule enregistré hors bornes, autre réglage modifiable
    const comp = db.getCompetition(competitionId)!;
    db.updateCompetition(competitionId, {
      settings: { ...comp.settings, defaultPoolMaxScore: 21 } as never,
    });
    await call('updateCompetitionSettings', { settings: { thirdPlaceMatch: true } });
    expect(db.getCompetition(competitionId)!.settings.thirdPlaceMatch).toBe(true);
  });
});
