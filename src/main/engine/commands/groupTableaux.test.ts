/**
 * Tableaux séparés après les poules par le moteur (docs/adr/0024, lots A1 et A2) : un tableau
 * par groupe, joué par les commandes et rejoué sans écart ; reprise d'une épreuve en cours
 * (tableau de la racine déplacé dans son groupe) ; lecteurs de l'affichage ; épreuves sans
 * groupes inchangées. Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { planTableau } from '../../../shared/domain/tableau/tableauCalculations';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../../shared/domain/journal/compareWithState';
import {
  allTableauMatches,
  splitRankingByGender,
} from '../../../shared/domain/ranking/splitGroups';
import { publicFinalResults, publicTableauRounds } from '../../remote/routes/resultsRoutes';
import { getBracket } from './sessionView';
import { MCP_TOOLS } from '../../mcp/mcpTools';
import type { PoolRanking } from '../../../shared/types';
import type { CommandContext } from './context';
import { listMatches, resultsData } from './sport';
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

/** Épreuve mixte : n tireuses (F) et n tireurs (M), poules communes */
function setup(perGroup: number, split = true) {
  const weapon = Weapon.EPEE;
  const comp = db.createCompetition({
    title: 'Tableaux séparés',
    date: new Date('2026-12-06'),
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
  return comp;
}

async function playAll(competitionId: string, kind: 'pool' | 'bracket', only?: string) {
  for (let guard = 0; guard < 200; guard++) {
    const ready = listMatches(ctx, competitionId, { state: 'ready' }).filter(
      m => m.kind === kind && (!only || m.matchId.startsWith(`${only}:`))
    );
    if (ready.length === 0) return;
    for (const [i, m] of ready.entries()) {
      await call('recordScore', {
        competitionId,
        matchId: m.matchId,
        scoreA: kind === 'pool' ? 5 : 15,
        scoreB: i % 4,
      });
    }
  }
}

async function poolsPlayed(perGroup: number, split = true) {
  const comp = setup(perGroup, split);
  await call('generatePools', { competitionId: comp.id, poolCount: 2 });
  await playAll(comp.id, 'pool');
  return comp;
}

function replay(competitionId: string) {
  const facts = projectCompetition(db.eventLog.getSince(competitionId));
  const statuses = Object.fromEntries(
    db.getFencersByCompetition(competitionId).map(f => [f.id, f.status as string])
  );
  return {
    facts,
    divergences: compareWithState(facts, stateView(session(competitionId)), statuses),
  };
}

const lastEvent = (id: string) => db.eventLog.getSince(id).slice(-1)[0];

d('tableaux séparés après les poules (docs/adr/0024, lot A1)', () => {
  it('groupe exigé avec le réglage, refusé sans ; groupe inconnu', async () => {
    const comp = await poolsPlayed(5);
    await expect(call('generateTableau', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(
      call('generateTableau', { competitionId: comp.id, group: 'X' })
    ).rejects.toMatchObject({ code: 'split_group_not_found' });
    await expect(call('clearTableau', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    const plain = await poolsPlayed(3, false);
    await expect(
      call('generateTableau', { competitionId: plain.id, group: 'F' })
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('épreuve à deux groupes jouée par les commandes, rejouée sans écart', async () => {
    const comp = await poolsPlayed(6);
    await call('generateTableau', { competitionId: comp.id, group: 'F' });
    let s = session(comp.id);
    expect(s.tableauMatches).toEqual([]);
    expect(Object.keys(s.groupTableaux)).toEqual(['F']);
    const fIds = s.groupTableaux.F.tableauMatches.map((m: { id: string }) => m.id);
    expect(fIds.every((id: string) => id.startsWith('F:'))).toBe(true);
    // Tireuses seulement, rangs du groupe
    const fencers = new Map(db.getFencersByCompetition(comp.id).map(f => [f.id, f]));
    for (const m of s.groupTableaux.F.tableauMatches) {
      for (const f of [m.fencerA, m.fencerB].filter(Boolean)) {
        expect(fencers.get(f.id)?.gender).toBe(Gender.FEMALE);
      }
    }
    expect(lastEvent(comp.id)).toMatchObject({ type: 'TableauGenerated', payload: { group: 'F' } });
    // Identifiants uniques dans la table matches
    expect(db.getMatch(`${comp.id}-${fIds[0]}`)).toBeTruthy();

    await call('generateTableau', { competitionId: comp.id, group: 'M' });
    expect(replay(comp.id).divergences).toEqual([]);

    // Retrait au tableau des garçons : tableau du groupe du tireur
    const mMatch = listMatches(ctx, comp.id, { state: 'ready' }).find(m =>
      m.matchId.startsWith('M:')
    )!;
    const withdrawn = await call('withdrawFencer', {
      competitionId: comp.id,
      fencerId: mMatch.fencerB!.id,
      reason: 'abandon',
      matchId: mMatch.matchId,
    });
    expect(withdrawn.forfeitedMatchIds).toEqual([mMatch.matchId]);
    expect(replay(comp.id).divergences).toEqual([]);

    // Score puis annulation dans le tableau des filles
    const fMatch = listMatches(ctx, comp.id, { state: 'ready' }).find(m =>
      m.matchId.startsWith('F:')
    )!;
    await call('recordScore', {
      competitionId: comp.id,
      matchId: fMatch.matchId,
      scoreA: 15,
      scoreB: 9,
    });
    await call('clearScore', { competitionId: comp.id, matchId: fMatch.matchId });
    expect(replay(comp.id).divergences).toEqual([]);

    // Groupe F terminé : phase inchangée tant que M n'est pas fini
    await playAll(comp.id, 'bracket', 'F');
    s = session(comp.id);
    expect(s.groupTableaux.F.finalResults).toHaveLength(6);
    expect(s.currentPhase).toBe(5);
    expect(lastEvent(comp.id)).toMatchObject({
      type: 'TableauCompleted',
      payload: { group: 'F' },
    });
    await playAll(comp.id, 'bracket', 'M');
    s = session(comp.id);
    expect(s.groupTableaux.M.finalResults).toHaveLength(6);
    expect(s.currentPhase).toBe(6);

    const { facts, divergences } = replay(comp.id);
    expect(Object.keys(facts.groupTableaux).sort()).toEqual(['F', 'M']);
    expect(facts.tableau).toBeNull();
    expect(divergences).toEqual([]);
    const rebuilt = await call('rebuildCompetitionState', { competitionId: comp.id, dryRun: true });
    expect(rebuilt).toMatchObject({ complete: true, divergences: [] });
  });

  it('retirer le tableau d’un groupe laisse l’autre ; rejeu et reconstruction', async () => {
    const comp = await poolsPlayed(5);
    await call('generateTableau', { competitionId: comp.id, group: 'F' });
    await call('generateTableau', { competitionId: comp.id, group: 'M' });
    await playAll(comp.id, 'bracket', 'F');
    const res = await call('clearTableau', { competitionId: comp.id, group: 'M' });
    expect(res.cleared).toBeGreaterThan(0);
    const s = session(comp.id);
    expect(s.groupTableaux.M.tableauMatches).toEqual([]);
    expect(s.groupTableaux.F.finalResults).toHaveLength(5);
    expect(lastEvent(comp.id)).toMatchObject({ type: 'TableauCleared', payload: { group: 'M' } });
    const { facts, divergences } = replay(comp.id);
    expect(Object.keys(facts.groupTableaux)).toEqual(['F']);
    expect(divergences).toEqual([]);

    // Décision du groupe F effacée de l'état : la reconstruction la remet d'après le journal
    const broken = session(comp.id);
    const final = broken.groupTableaux.F.tableauMatches.find(
      (m: { round: number }) => m.round === 2
    );
    final.winner = null;
    db.saveSessionState(comp.id, broken);
    const fixed = await call('rebuildCompetitionState', { competitionId: comp.id });
    expect(fixed.repaired).toContainEqual({ kind: 'bracket_result', id: final.id });
    expect(fixed.remaining).toEqual([]);
  });

  it('placement de l’écran admis pour un groupe, identifiants préfixés', async () => {
    const comp = await poolsPlayed(4);
    const ranking = splitRankingByGender(session(comp.id).overallRanking as PoolRanking[]).get(
      'F'
    )!;
    const { matches } = planTableau(ranking, { playAllPositions: false, thirdPlaceMatch: false });
    await call('generateTableau', {
      competitionId: comp.id,
      group: 'F',
      composition: matches.map(m => ({
        matchId: m.id,
        round: m.round,
        position: m.position,
        fencerAId: m.fencerA?.id ?? null,
        fencerBId: m.fencerB?.id ?? null,
        isBye: m.isBye,
      })),
    });
    const ids = session(comp.id).groupTableaux.F.tableauMatches.map((m: { id: string }) => m.id);
    expect(ids).toEqual(matches.map(m => `F:${m.id}`));
    expect(replay(comp.id).divergences).toEqual([]);
  });

  it('« toutes les places » par groupe : tableaux de classement préfixés, rejeu sans écart', async () => {
    const comp = await poolsPlayed(10);
    db.updateCompetition(comp.id, {
      settings: { ...comp.settings, postPoolSplitCriteria: 'gender', playAllPositions: true },
    } as never);
    for (const group of ['F', 'M']) {
      const ranking = splitRankingByGender(session(comp.id).overallRanking as PoolRanking[]).get(
        group
      )!;
      const { matches } = planTableau(ranking, { playAllPositions: true, thirdPlaceMatch: true });
      await call('generateTableau', {
        competitionId: comp.id,
        group,
        thirdPlaceMatch: true,
        composition: matches.map(m => ({
          matchId: m.id,
          round: m.round,
          position: m.position,
          fencerAId: m.fencerA?.id ?? null,
          fencerBId: m.fencerB?.id ?? null,
          isBye: m.isBye,
        })),
      });
    }
    await playAll(comp.id, 'bracket');
    const s = session(comp.id);
    for (const group of ['F', 'M']) {
      const t = s.groupTableaux[group];
      expect(t.consolationBrackets.length).toBeGreaterThan(0);
      for (const b of t.consolationBrackets) {
        expect(b.id.startsWith(`${group}:`)).toBe(true);
        expect(b.matches.every((m: { id: string }) => m.id.startsWith(`${group}:`))).toBe(true);
      }
      expect(t.finalResults).toHaveLength(10);
    }
    expect(s.currentPhase).toBe(6);
    expect(replay(comp.id).divergences).toEqual([]);
  });

  it('reprise : tableau tiré à la racine avant les groupes, déplacé dans le groupe de ses tireurs', async () => {
    const comp = await poolsPlayed(4);
    // Tableau des filles tiré par l'écran avant le lot A1 : à la racine, sans préfixe
    const s = session(comp.id);
    const ranking = splitRankingByGender(s.overallRanking as PoolRanking[]).get('F')!;
    const { matches } = planTableau(ranking, { playAllPositions: false, thirdPlaceMatch: false });
    db.saveSessionState(comp.id, { ...s, tableauMatches: matches, currentPhase: 5 });

    // Lu par l'écran comme le tableau du groupe F, avant toute écriture
    const read = await call('getCompetitionState', { competitionId: comp.id });
    expect(read.state.tableauMatches).toEqual([]);
    expect(Object.keys(read.state.groupTableaux)).toEqual(['F']);
    expect(read.state.groupTableaux.F.tableauMatches.map((m: { id: string }) => m.id)).toEqual(
      matches.map(m => m.id)
    );

    const ready = listMatches(ctx, comp.id, { state: 'ready' }).filter(m => m.kind === 'bracket');
    expect(ready.length).toBeGreaterThan(0);
    expect(ready.every(m => !m.matchId.includes(':'))).toBe(true);
    await call('recordScore', {
      competitionId: comp.id,
      matchId: ready[0].matchId,
      scoreA: 15,
      scoreB: 3,
    });
    // Première réécriture (lot A2) : tableau déplacé dans son groupe, identifiants inchangés
    let after = session(comp.id);
    expect(after.tableauMatches).toEqual([]);
    expect(Object.keys(after.groupTableaux)).toEqual(['F']);
    expect(after.groupTableaux.F.tableauMatches.map((m: { id: string }) => m.id)).toEqual(
      matches.map(m => m.id)
    );
    expect(
      after.groupTableaux.F.tableauMatches.find((m: { id: string }) => m.id === ready[0].matchId)
        .winner
    ).toBeTruthy();
    // Le groupe F est tiré ; le tableau des garçons se tire à côté
    await call('generateTableau', { competitionId: comp.id, group: 'M' });
    after = session(comp.id);
    expect(Object.keys(after.groupTableaux).sort()).toEqual(['F', 'M']);
    expect(after.groupTableaux.F.tableauMatches).toHaveLength(matches.length);
    // Le reste du tableau repris se joue par les commandes, groupe par groupe
    await playAll(comp.id, 'bracket', 'M');
    await playAll(comp.id, 'bracket');
    after = session(comp.id);
    expect(after.groupTableaux.F.finalResults).toHaveLength(4);
    expect(after.groupTableaux.M.finalResults).toHaveLength(4);
    expect(after.currentPhase).toBe(6);
  });

  it('affichage : état de l’écran, résultats, vue du tableau et page publique lisent tous les tableaux', async () => {
    const comp = await poolsPlayed(4);
    await call('generateTableau', { competitionId: comp.id, group: 'F' });
    await call('generateTableau', { competitionId: comp.id, group: 'M' });
    await playAll(comp.id, 'bracket');

    const read = await call('getCompetitionState', { competitionId: comp.id });
    expect(Object.keys(read.state.groupTableaux).sort()).toEqual(['F', 'M']);
    expect(read.state.tableauMatches).toEqual([]);

    const data = resultsData(ctx, comp.id);
    const all = session(comp.id).groupTableaux;
    expect(data.tableauMatches).toHaveLength(
      all.F.tableauMatches.length + all.M.tableauMatches.length
    );
    expect(data.finalResults).toHaveLength(8);
    expect(data.finalResults.filter(r => r.rank === 1)).toHaveLength(2);

    const bracket = getBracket(ctx, comp.id);
    expect(bracket.matches).toHaveLength(data.tableauMatches.length);
    expect(bracket.finalResults).toHaveLength(8);
    const onlyF = getBracket(ctx, comp.id, undefined, 'F');
    expect(onlyF.matches.every(m => m.id.startsWith('F:'))).toBe(true);
    expect(onlyF.finalResults).toHaveLength(4);

    const rounds = publicTableauRounds(allTableauMatches(session(comp.id)) as never);
    expect(new Set(rounds.map(r => r.group))).toEqual(new Set(['F', 'M']));
    expect(rounds.filter(r => r.round === 2)).toHaveLength(2);
    // Outil MCP get_bracket : groupe de chaque match, filtre « group »
    const tool = MCP_TOOLS.find(t => t.name === 'get_bracket')!;
    const deps = { db } as never;
    const mcpAll = tool.run(deps, { competitionId: comp.id }) as Array<{ group: string | null }>;
    expect(new Set(mcpAll.map(m => m.group))).toEqual(new Set(['F', 'M']));
    const mcpM = tool.run(deps, { competitionId: comp.id, group: 'M' }) as Array<{ id: string }>;
    expect(mcpM).toHaveLength(all.M.tableauMatches.length);
    expect(mcpM.every(m => m.id.startsWith(`${comp.id}-M:`))).toBe(true);

    const podium = publicFinalResults(session(comp.id) as never);
    expect(podium).toHaveLength(8);
    expect(podium.map(r => r.group)).toEqual(['F', 'F', 'F', 'F', 'M', 'M', 'M', 'M']);
  });

  it('nouveau tirage des poules : tableaux des groupes retirés', async () => {
    const comp = await poolsPlayed(3);
    await call('generateTableau', { competitionId: comp.id, group: 'F' });
    await call('generatePools', { competitionId: comp.id, poolCount: 2, replace: true });
    expect(session(comp.id).groupTableaux).toEqual({});
    expect(replay(comp.id).divergences).toEqual([]);
  });
});
