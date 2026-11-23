/**
 * Extraction d'un groupe des tableaux séparés en épreuve séparée par le moteur (docs/adr/0024,
 * lot A3) : splitOffGroup en une transaction sur les deux épreuves, journaux GroupSplitOff et
 * SplitRankingImported (même commandId), rejeu sans écart, refus, retour arrière sur échec au
 * milieu, reconstruction. Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
import type { PoolRanking } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../../shared/domain/journal/compareWithState';
import { CONTRACT_MCP_TOOLS } from '../api/mcpAdapter';
import type { CommandContext } from './context';
import { listMatches } from './sport';
import { invoke } from '../api/engine';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db, emitChange: () => {} };
});
afterEach(() => db.close());

type Session = Record<string, any>;
const session = (id: string) => (db.getSessionState(id) ?? {}) as Session;
const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;
const events = (id: string) => db.eventLog.getSince(id);

/** Épreuve mixte, tableaux séparés par sexe : poules communes tirées et jouées par le moteur */
async function poolsPlayed(perGroup = 4, split = true) {
  const weapon = Weapon.EPEE;
  const comp = db.createCompetition({
    title: 'Coupe mixte',
    date: new Date('2026-12-06'),
    location: 'Gymnase',
    weapon,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    settings: {
      ...buildDefaultCompetitionSettings({ weapon, category: Category.SENIOR }),
      ...(split ? { postPoolSplitCriteria: 'gender' } : {}),
    } as never,
  });
  for (let i = 0; i < perGroup * 2; i++) {
    db.addFencer(comp.id, {
      lastName: `NOM${i}`,
      firstName: `P${i}`,
      gender: i % 2 === 0 ? Gender.FEMALE : Gender.MALE,
      club: ['Paris', 'Lyon', 'Nice', 'Lille'][i % 4],
      ranking: i + 1,
      status: FencerStatus.CHECKED_IN,
    });
  }
  await call('generatePools', { competitionId: comp.id, poolCount: 2 });
  for (const [i, m] of listMatches(ctx, comp.id, { state: 'ready' }).entries()) {
    await call('recordScore', {
      competitionId: comp.id,
      matchId: m.matchId,
      scoreA: 5,
      scoreB: i % 4,
    });
  }
  return comp;
}

/** Journal rejoué comparé à l'état (réglages compris : groupes extraits) */
function replay(competitionId: string) {
  const facts = projectCompetition(events(competitionId));
  const statuses = Object.fromEntries(
    db.getFencersByCompetition(competitionId).map(f => [f.id, f.status as string])
  );
  const settings = db.getCompetition(competitionId)!.settings;
  return {
    facts,
    divergences: compareWithState(facts, stateView(session(competitionId), settings), statuses),
  };
}

const women = (competitionId: string) =>
  (session(competitionId).overallRanking as PoolRanking[])
    .filter(r => r.fencer.gender === Gender.FEMALE)
    .map((r, i) => ({ ...r, rank: i + 1 }));

d('splitOffGroup : groupe extrait en épreuve séparée (docs/adr/0024, lot A3)', () => {
  it('crée l’épreuve séparée en une commande, journalise les deux faits, rejoue sans écart', async () => {
    const comp = await poolsPlayed();
    const before = women(comp.id);
    const out = await call('splitOffGroup', {
      competitionId: comp.id,
      group: 'F',
      title: '  Coupe – Dames ',
      commandId: 'cmd-split-1',
    });
    expect(out).toMatchObject({ dryRun: false, fencers: before.length });
    expect(out.revision).toBe(db.eventLog.getRevision(comp.id));
    const target = db.getCompetition(out.competitionId)!;

    // Épreuve séparée : réglages sans le mode couplé, groupe = sexe, origine notée
    expect(target.title).toBe('Coupe – Dames');
    expect(target.gender).toBe(Gender.FEMALE);
    expect(target.location).toBe('Gymnase');
    expect(target.settings?.postPoolSplitCriteria).toBeUndefined();
    expect(target.settings?.splitFromCompetitionId).toBe(comp.id);

    // Tireuses copiées, pointées, rang après poules
    const copies = db.getFencersByCompetition(target.id);
    expect(copies).toHaveLength(before.length);
    expect(copies.every(f => f.status === FencerStatus.CHECKED_IN)).toBe(true);
    const s = session(target.id);
    expect(s.currentPhase).toBe(3);
    expect(s.pools).toEqual([]);
    const ranking = s.overallRanking as PoolRanking[];
    expect(ranking.map(r => [r.fencer.lastName, r.rank, r.victories])).toEqual(
      before.map(r => [r.fencer.lastName, r.rank, r.victories])
    );
    expect(ranking.every(r => copies.some(f => f.id === r.fencer.id))).toBe(true);
    for (const r of ranking) {
      expect(copies.find(f => f.id === r.fencer.id)!.ranking).toBe(r.rank);
    }

    // Épreuve d'origine : groupe extrait, plus d'onglet pour lui
    expect(db.getCompetition(comp.id)!.settings?.splitOffCompetitionIds).toEqual({
      F: target.id,
    });

    // Journaux : un fait dans chaque épreuve, même commandId, identifiants seulement
    const [split] = events(comp.id).filter(e => e.type === 'GroupSplitOff');
    expect(split.payload).toEqual({
      group: 'F',
      targetCompetitionId: target.id,
      fencerIds: before.map(r => r.fencer.id),
    });
    const targetEvents = events(target.id);
    expect(targetEvents.map(e => e.type)).toEqual(['SplitRankingImported']);
    expect(targetEvents[0].commandId).toBe('cmd-split-1');
    expect(split.commandId).toBe('cmd-split-1');
    expect(targetEvents[0].payload).toEqual({
      sourceCompetitionId: comp.id,
      group: 'F',
      ranking: ranking.map((r, i) => ({
        fencerId: r.fencer.id,
        sourceFencerId: before[i].fencer.id,
        rank: r.rank,
      })),
    });

    // Rejeu des deux journaux : complets, sans écart
    const origin = replay(comp.id);
    expect(origin.facts.splitOffGroups.F.targetCompetitionId).toBe(target.id);
    expect(origin.divergences).toEqual([]);
    const separate = replay(target.id);
    expect(separate.facts.complete).toBe(true);
    expect(separate.facts.importedRanking?.group).toBe('F');
    expect(separate.divergences).toEqual([]);

    // Commande rejouée (même commandId) : rien de réécrit
    await expect(
      call('splitOffGroup', {
        competitionId: comp.id,
        group: 'F',
        title: 'Bis',
        commandId: 'cmd-split-1',
      })
    ).rejects.toMatchObject({ code: 'command_already_applied' });
    expect(db.getAllCompetitions()).toHaveLength(2);
  });

  it('après l’extraction : le groupe n’a plus de tableau ici, l’épreuve séparée tire le sien', async () => {
    const comp = await poolsPlayed();
    const { competitionId: targetId } = await call('splitOffGroup', {
      competitionId: comp.id,
      group: 'F',
      title: 'Dames',
    });
    await expect(
      call('generateTableau', { competitionId: comp.id, group: 'F' })
    ).rejects.toMatchObject({ code: 'split_group_not_found' });
    await call('generateTableau', { competitionId: comp.id, group: 'M' });
    expect(Object.keys(session(comp.id).groupTableaux)).toEqual(['M']);

    // Épreuve séparée : tableau tiré sans poules (classement importé), joué, rejoué
    await call('generateTableau', { competitionId: targetId });
    const first = listMatches(ctx, targetId, { state: 'ready' }).filter(m => m.kind === 'bracket');
    expect(first.length).toBeGreaterThan(0);
    await call('recordScore', {
      competitionId: targetId,
      matchId: first[0].matchId,
      scoreA: 15,
      scoreB: 3,
    });
    expect(replay(targetId).divergences).toEqual([]);
    expect(replay(comp.id).divergences).toEqual([]);
  });

  it('refus : sans tableaux séparés, groupe inconnu, déjà extrait, tableau tiré ; dryRun', async () => {
    const plain = await poolsPlayed(3, false);
    await expect(
      call('splitOffGroup', { competitionId: plain.id, group: 'F', title: 'X' })
    ).rejects.toMatchObject({ code: 'invalid_input' });

    const comp = await poolsPlayed();
    await expect(
      call('splitOffGroup', { competitionId: comp.id, group: 'X', title: 'X' })
    ).rejects.toMatchObject({ code: 'split_group_not_found' });

    const dry = await call('splitOffGroup', {
      competitionId: comp.id,
      group: 'F',
      title: 'X',
      dryRun: true,
    });
    expect(dry).toMatchObject({ dryRun: true, competitionId: null, fencers: 4 });
    expect(db.getAllCompetitions()).toHaveLength(2);

    await call('generateTableau', { competitionId: comp.id, group: 'M' });
    await expect(
      call('splitOffGroup', { competitionId: comp.id, group: 'M', title: 'X' })
    ).rejects.toMatchObject({ code: 'bracket_exists' });

    await call('splitOffGroup', { competitionId: comp.id, group: 'F', title: 'Dames' });
    await expect(
      call('splitOffGroup', { competitionId: comp.id, group: 'F', title: 'Encore' })
    ).rejects.toMatchObject({ code: 'split_group_not_found' });
    expect(db.getAllCompetitions()).toHaveLength(3);
  });

  it('échec au milieu : tout est annulé (ni épreuve, ni tireurs, ni marque, ni journal)', async () => {
    const comp = await poolsPlayed();
    const revision = db.eventLog.getRevision(comp.id);
    const competitions = db.getAllCompetitions().length;
    const fencers = db.getFencersByCompetition(comp.id).length;
    // Panne à la dernière écriture (marque sur l'épreuve d'origine)
    const spy = vi.spyOn(db, 'updateCompetition').mockImplementation(() => {
      throw new Error('disque plein');
    });
    await expect(
      call('splitOffGroup', { competitionId: comp.id, group: 'F', title: 'Dames' })
    ).rejects.toMatchObject({ code: 'internal' });
    spy.mockRestore();
    const all = db.getAllCompetitions();
    expect(all).toHaveLength(competitions);
    expect(all.flatMap(c => db.getFencersByCompetition(c.id))).toHaveLength(fencers);
    expect(db.getCompetition(comp.id)!.settings?.splitOffCompetitionIds).toBeUndefined();
    expect(db.eventLog.getRevision(comp.id)).toBe(revision);
    expect(events(comp.id).some(e => e.type === 'GroupSplitOff')).toBe(false);
    expect(replay(comp.id).divergences).toEqual([]);
  });

  it('rebuildCompetitionState : marque et classement importé rendus d’après le journal', async () => {
    const comp = await poolsPlayed();
    const { competitionId: targetId } = await call('splitOffGroup', {
      competitionId: comp.id,
      group: 'F',
      title: 'Dames',
    });
    const expected = session(targetId).overallRanking as PoolRanking[];

    // Marque perdue sur l'épreuve d'origine
    const settings = db.getCompetition(comp.id)!.settings!;
    db.updateCompetition(comp.id, { settings: { ...settings, splitOffCompetitionIds: {} } });
    const dry = await call('rebuildCompetitionState', { competitionId: comp.id, dryRun: true });
    expect(dry.divergences).toEqual([
      { kind: 'split_off', id: 'F', expected: targetId, actual: null },
    ]);
    const fixed = await call('rebuildCompetitionState', { competitionId: comp.id });
    expect(fixed.remaining).toEqual([]);
    expect(db.getCompetition(comp.id)!.settings?.splitOffCompetitionIds).toEqual({ F: targetId });

    // Classement de l'épreuve séparée perdu : relu, statistiques de l'épreuve d'origine
    db.saveSessionState(targetId, { ...session(targetId), overallRanking: [] });
    const repaired = await call('rebuildCompetitionState', { competitionId: targetId });
    expect(repaired.repaired).toEqual([{ kind: 'imported_ranking', id: 'F' }]);
    expect(repaired.remaining).toEqual([]);
    const rebuilt = session(targetId).overallRanking as PoolRanking[];
    expect(rebuilt.map(r => [r.fencer.id, r.rank, r.victories, r.touchesScored])).toEqual(
      expected.map(r => [r.fencer.id, r.rank, r.victories, r.touchesScored])
    );

    // Épreuve d'origine supprimée : rangs seuls
    db.deleteCompetition(comp.id);
    db.saveSessionState(targetId, { ...session(targetId), overallRanking: [] });
    await call('rebuildCompetitionState', { competitionId: targetId });
    const ranksOnly = session(targetId).overallRanking as PoolRanking[];
    expect(ranksOnly.map(r => [r.fencer.id, r.rank, r.victories])).toEqual(
      expected.map(r => [r.fencer.id, r.rank, 0])
    );
  });

  it('outil MCP split_off_group (écriture)', () => {
    const tool = CONTRACT_MCP_TOOLS.write.find(t => t.name === 'split_off_group');
    expect(tool?.inputSchema.required).toEqual(['competitionId', 'group', 'title']);
  });
});
