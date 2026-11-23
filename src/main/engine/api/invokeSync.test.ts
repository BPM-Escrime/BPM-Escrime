/**
 * invokeSync (#2134) : commande du contrat appelée de façon synchrone par un outil MCP
 * composé ; même validation et même handler qu'invoke, utilisable dans une transaction
 * englobante (tout ou rien). Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { ApiError } from '../../../shared/api/client';
import type { CommandContext } from '../commands/context';
import { invokeSync } from './engine';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db };
});

afterEach(() => db.close());

const newCompetition = (title = 'Open') =>
  invokeSync(ctx, 'createCompetition', {
    title,
    date: '2026-12-06',
    weapon: 'E',
    gender: 'M',
    category: 'SEN',
  });

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ApiError ? e.code : 'autre';
  }
  return null;
};

d('invokeSync (#2134)', () => {
  it('commande d’épreuve : réglages par défaut du moteur, puis inscription journalisée', () => {
    const { competitionId } = newCompetition();
    expect(db.getCompetition(competitionId!)?.settings).toBeDefined();
    const r = invokeSync(ctx, 'registerFencers', {
      competitionId: competitionId!,
      fencers: [{ lastName: 'DUPONT', firstName: 'Léa' }],
    });
    expect(r.fencers).toHaveLength(1);
    expect(db.getFencersByCompetition(competitionId!)).toHaveLength(1);
  });

  it('fonction du poste (journée) : exécutée sans journal', () => {
    const day = invokeSync(ctx, 'createEventDay', { name: 'Journée', date: '2026-12-06' });
    expect(db.eventDays.getDay(day.id)?.name).toBe('Journée');
  });

  it('entrée invalide ou requête : refus du contrat, rien d’écrit', () => {
    expect(codeOf(() => invokeSync(ctx, 'createCompetition', { title: '' } as never))).toBe(
      'invalid_input'
    );
    expect(codeOf(() => invokeSync(ctx, 'listCompetitions' as never, {}))).toBe(
      'unknown_operation'
    );
    expect(db.getAllCompetitions()).toHaveLength(0);
  });

  it('transaction englobante : un échec annule les commandes déjà passées', () => {
    expect(() =>
      db.transaction(() => {
        newCompetition('Annulée');
        throw new Error('fichier illisible');
      })
    ).toThrow('fichier illisible');
    expect(db.getAllCompetitions()).toHaveLength(0);
  });
});
