/**
 * Classement final du moteur (docs/adr/0043 amendée, F4d) : une seule règle avec l'écran
 * (`finalRanking`) pour resultsData, les exports (FFF, HTML) et le XML (GREG) : le tableau, puis
 * les non-qualifiés dans l'ordre des poules ; un exclu, même après son entrée au tableau, au bas
 * sans rang, les autres renumérotés (FIE o.74).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon, type Fencer } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import type { CommandContext } from './context';
import { exportResults, resultsXml } from './exportResults';
import { resultsData } from './sport';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;
let competitionId: string;
let fencers: Fencer[];
let dir: string;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db, emitChange: () => undefined };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpm-final-'));
  competitionId = db.createCompetition({
    title: 'Final',
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    }) as never,
  }).id;
  // A à F dans l'ordre des poules ; tableau de 4 : A, B, C, D ; E, F non qualifiés ; C exclu
  // après son entrée au tableau, F exclu
  fencers = ['A', 'B', 'C', 'D', 'E', 'F'].map(id =>
    db.addFencer(competitionId, {
      lastName: id,
      firstName: id,
      status: ['C', 'F'].includes(id) ? FencerStatus.EXCLUDED : FencerStatus.QUALIFIED,
    })
  );
  const [a, b, c, dd] = fencers;
  db.saveSessionState(competitionId, {
    overallRanking: fencers.map((x, i) => ({ fencer: x, rank: i + 1 })),
    tableauMatches: [],
    finalResults: [
      { rank: 1, fencer: b, eliminatedAt: 'Vainqueur' },
      { rank: 2, fencer: a, eliminatedAt: 'Finale' },
      { rank: 3, fencer: c, eliminatedAt: 'Demi-finales' },
      { rank: 3, fencer: dd, eliminatedAt: 'Demi-finales' },
    ],
  });
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const rows = () =>
  resultsData(ctx, competitionId).finalRanking.map(r => `${r.fencer.lastName}:${r.rank}`);

d('classement final du moteur (docs/adr/0043, F4d)', () => {
  it('resultsData : tableau, non-qualifiés dans l’ordre des poules, exclus au bas sans rang', () => {
    expect(rows()).toEqual(['B:1', 'A:2', 'D:3', 'E:4', 'C:null', 'F:null']);
    // Résultats du tableau et classement des poules restent ceux de l’épreuve
    expect(resultsData(ctx, competitionId).finalResults).toHaveLength(4);
    expect(resultsData(ctx, competitionId).overallRanking).toHaveLength(6);
  });

  it('exports FFF et HTML : même classement, exclus absents du FFF', async () => {
    const fff = await exportResults(ctx, competitionId, {
      format: 'fff',
      outputPath: path.join(dir, 'r.fff'),
    });
    const lines = fs.readFileSync(fff.path, 'latin1').split('\n');
    const names = lines.filter(l => /^[A-Z],/.test(l)).map(l => l.slice(0, 1));
    expect(names).toEqual(['B', 'A', 'D', 'E']);
    const html = await exportResults(ctx, competitionId, {
      format: 'html',
      outputPath: path.join(dir, 'r.html'),
    });
    const text = fs.readFileSync(html.path, 'utf8');
    expect(text).toContain('Final');
  });

  it('XML (GREG) : mêmes rangs, exclus sans classement', () => {
    const xml = resultsXml(resultsData(ctx, competitionId));
    const rankOf = (name: string) =>
      new RegExp(`<Tireur [^>]*Classement="([^"]*)"[^>]*Nom="${name}"`).exec(xml)?.[1];
    expect(['A', 'B', 'C', 'D', 'E', 'F'].map(rankOf)).toEqual(['2', '1', '', '3', '4', '']);
  });
});
