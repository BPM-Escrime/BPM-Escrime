/**
 * Entrée en équipes (docs/adr/0043, F4c) : réglage `entry` de la formule, répartition par
 * niveau du tirage (moteur), sur une base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import {
  entryOf,
  poolDistributionOfRound,
  rankingFiltersOf,
} from '../../../shared/domain/formula/formulaV2';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;
let competitionId: string;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db, emitChange: () => undefined };
  competitionId = db.createCompetition({
    title: 'Équipes',
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    }) as never,
  }).id;
});
afterEach(() => db.close());

const call = (name: string, input: Record<string, unknown> = {}) =>
  invoke(ctx, name as never, { competitionId, ...input } as never) as Promise<any>;
const settings = () => db.getCompetition(competitionId)!.settings;

/** Douze équipes pointées, niveaux 1 (faible) à 3 (fort), clubs distincts */
function seedTeams() {
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const f = db.addFencer(competitionId, {
      lastName: `EQUIPE${i}`,
      firstName: `M${i}`,
      club: `Club${i}`,
      ranking: i + 1,
      level: (i % 3) + 1,
      members: [{ lastName: `M${i}`, firstName: 'a' }],
      status: FencerStatus.CHECKED_IN,
    });
    ids.push(f.id);
  }
  return ids;
}

d('entrée en équipes : réglage de la formule (docs/adr/0043)', () => {
  it('individuelle par défaut ; équipes de 2 avec libellés ; retour à l’individuelle', async () => {
    expect(entryOf(settings().formula)).toEqual({ kind: 'individual' });
    const levels = ['beginner', 'intermediate', 'expert'];
    await call('updateCompetitionFormula', {
      operations: [{ op: 'setGeneral', settings: { entry: { kind: 'team', size: 2, levels } } }],
    });
    expect(entryOf(settings().formula)).toEqual({ kind: 'team', size: 2, levels });
    await call('updateCompetitionFormula', {
      operations: [{ op: 'setGeneral', settings: { entry: null } }],
    });
    expect(entryOf(settings().formula)).toEqual({ kind: 'individual' });
    expect(settings().formula?.general.entry).toBeUndefined();
  });

  it.each([
    [{ kind: 'team', size: 3, levels: ['A'] }, 'binômes'],
    [{ kind: 'team', size: 2, levels: [] }, 'libellé'],
    [{ kind: 'team', size: 2, levels: ['A', 'a'] }, 'distincts'],
    [{ kind: 'team', size: 2, levels: ['A', ' '] }, 'libellé'],
    [{ kind: 'group' }, 'individual ou team'],
  ])('entrée %j refusée', async (entry, message) => {
    await expect(
      call('updateCompetitionFormula', {
        operations: [{ op: 'setGeneral', settings: { entry } }],
      })
    ).rejects.toThrow(message);
    expect(settings().formula?.general.entry).toBeUndefined();
  });

  it('répartition du tour : serpentin par défaut, « par niveau » réglable, valeur inconnue refusée', async () => {
    expect(poolDistributionOfRound(settings(), 1)).toBe('serpentine');
    await call('updateCompetitionFormula', {
      operations: [{ op: 'setPhase', phase: 'pool-0', settings: { distribution: 'byLevel' } }],
    });
    expect(poolDistributionOfRound(settings(), 1)).toBe('byLevel');
    await expect(
      call('updateCompetitionFormula', {
        operations: [{ op: 'setPhase', phase: 'pool-0', settings: { distribution: 'random' } }],
      })
    ).rejects.toThrow('distribution');
    await call('updateCompetitionFormula', {
      operations: [{ op: 'setPhase', phase: 'pool-0', settings: { distribution: null } }],
    });
    expect(poolDistributionOfRound(settings(), 1)).toBe('serpentine');
  });
});

d('filtres du classement final : réglage de la formule (docs/adr/0043, F4d)', () => {
  it('aucun par défaut ; critères réglables, vides ou null : retirés', async () => {
    expect(rankingFiltersOf(settings().formula)).toEqual([]);
    await call('updateCompetitionFormula', {
      operations: [
        { op: 'setGeneral', settings: { rankingFilters: ['handicap', 'category', 'level'] } },
      ],
    });
    expect(rankingFiltersOf(settings().formula)).toEqual(['category', 'level', 'handicap']);
    await call('updateCompetitionFormula', {
      operations: [{ op: 'setGeneral', settings: { rankingFilters: [] } }],
    });
    expect(settings().formula?.general.rankingFilters).toBeUndefined();
    await call('updateCompetitionFormula', {
      operations: [{ op: 'setGeneral', settings: { rankingFilters: ['gender'] } }],
    });
    await call('updateCompetitionFormula', {
      operations: [{ op: 'setGeneral', settings: { rankingFilters: null } }],
    });
    expect(settings().formula?.general.rankingFilters).toBeUndefined();
  });

  it.each([
    [['club'], 'rankingFilters'],
    [['level', 'level'], 'distincts'],
    ['category', 'liste'],
  ])('critères %j refusés', async (rankingFilters, message) => {
    await expect(
      call('updateCompetitionFormula', {
        operations: [{ op: 'setGeneral', settings: { rankingFilters } }],
      })
    ).rejects.toThrow(message);
    expect(settings().formula?.general.rankingFilters).toBeUndefined();
  });
});

d('tirage par niveau (moteur, docs/adr/0043)', () => {
  const levelsByPool = () =>
    (db.getSessionState(competitionId) as any).pools.map((p: any) =>
      p.fencers.map((f: any) => db.getFencer(f.id)!.level)
    );

  it('« par niveau » : équipes de même niveau regroupées, les plus faibles dans la 1re poule', async () => {
    seedTeams();
    await call('updateCompetitionFormula', {
      operations: [{ op: 'setPhase', phase: 'pool-0', settings: { distribution: 'byLevel' } }],
    });
    await call('generatePools', { poolCount: 3 });
    expect(levelsByPool().map((l: number[]) => [...l].sort())).toEqual([
      [1, 1, 1, 1],
      [2, 2, 2, 2],
      [3, 3, 3, 3],
    ]);
  });

  it('serpentin (défaut) : niveaux mélangés, tirage inchangé', async () => {
    seedTeams();
    await call('generatePools', { poolCount: 3 });
    const mixed = levelsByPool().some((l: number[]) => new Set(l).size > 1);
    expect(mixed).toBe(true);
  });
});
