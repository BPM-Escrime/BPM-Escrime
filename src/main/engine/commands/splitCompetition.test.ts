/**
 * Scission de la formule en compétitions filles (docs/adr/0039) : splitCompetition en une
 * transaction, filles créées avec la formule de leur branche, tireurs copiés avec leur rang et
 * leur catégorie, journaux GroupSplitOff / SplitRankingImported, `splitHistory` rejoué par la
 * projection ; après les poules et après un tableau arrêté clos ; refus, simulation, retour
 * arrière sur échec au milieu. Base SQLite réelle.
 */
import { resultsXml } from './exportResults';
import { originFinalRanking, splitHistoryOf } from '../../../shared/domain/formula/splitPlan';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import {
  Category,
  CompetitionSettings,
  FencerStatus,
  Gender,
  Weapon,
  type PoolRanking,
} from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import {
  flatSettingsOf,
  formulaOf,
  type FormulaV2,
  type SplitPhase,
} from '../../../shared/domain/formula/formulaV2';
import {
  applyOperationsV2,
  branchPhases,
} from '../../../shared/domain/formula/formulaV2Operations';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../../shared/domain/journal/compareWithState';
import { CONTRACT_MCP_TOOLS } from '../api/mcpAdapter';
import type { CommandContext } from './context';
import { listMatches, resultsData } from './sport';
import { invoke } from '../api/engine';
import { contract } from '../../../shared/api/contract';

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

const weapon = Weapon.EPEE;
const base = buildDefaultCompetitionSettings({
  weapon,
  category: Category.SENIOR,
}) as CompetitionSettings;
const fctx = { weapon, category: Category.SENIOR, settings: base };
let n = 0;
const newId = () => `ph-${++n}`;

/** Poules puis scission par rang : « Tableau A » (take), « Tableau B » (le reste) */
const rankSplit = (take = 4): FormulaV2 => {
  const f = applyOperationsV2(
    fctx,
    [
      { op: 'removePhase', phase: 'tableau' },
      { op: 'insertPhase', brick: 'split', at: 1 },
    ],
    newId
  );
  return withBranches(f, 'rank', [
    {
      label: 'Tableau A',
      phases: branchPhases('tableau', fctx, newId),
      take: { mode: 'fixed_count', count: take },
    },
    { label: 'Tableau B', phases: branchPhases('tableau', fctx, newId) },
  ]);
};
const withBranches = (
  f: FormulaV2,
  criterion: SplitPhase['criterion'],
  branches: SplitPhase['branches']
): FormulaV2 => ({
  ...f,
  phases: f.phases.map(p => (p.kind === 'split' ? { ...p, criterion, branches } : p)),
});

/** Épreuve à la formule donnée : 8 tireurs pointés, sexes et catégories alternés */
function competition(
  formula: FormulaV2,
  category = (i: number) => (i % 2 ? Category.V2 : Category.V1)
) {
  const comp = db.createCompetition({
    title: 'Coupe',
    date: new Date('2026-12-06'),
    location: 'Gymnase',
    weapon,
    gender: Gender.MIXED,
    category: Category.V1,
    settings: { ...base, ...flatSettingsOf(formula, weapon), formula } as never,
  });
  for (let i = 0; i < 8; i++) {
    db.addFencer(comp.id, {
      lastName: `NOM${i}`,
      firstName: `P${i}`,
      gender: i % 2 === 0 ? Gender.FEMALE : Gender.MALE,
      category: category(i),
      club: ['Paris', 'Lyon', 'Nice', 'Lille'][i % 4],
      ranking: i + 1,
      status: FencerStatus.CHECKED_IN,
    });
  }
  return comp;
}

/** Poules tirées et jouées par le moteur */
async function playPools(competitionId: string) {
  await call('generatePools', { competitionId, poolCount: 2 });
  for (const [i, m] of listMatches(ctx, competitionId, { state: 'ready' }).entries()) {
    await call('recordScore', { competitionId, matchId: m.matchId, scoreA: 5, scoreB: i % 5 });
  }
}

/** Journal rejoué comparé à l'état (réglages compris : filles notées) */
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

/** Classement d'entrée attendu : classement après poules, dans l'ordre */
const poolRanking = (id: string) => session(id).overallRanking as PoolRanking[];

d('splitCompetition après un tour de poules (docs/adr/0039)', () => {
  it('outil MCP split_competition, droit competition:write', () => {
    expect(CONTRACT_MCP_TOOLS.write.some(t => t.name === 'split_competition')).toBe(true);
    expect(contract.splitCompetition.permission).toBe('competition:write');
  });

  it('qualification du tour appliquée : les non-qualifiés restent classés dans l’origine', async () => {
    // 6 qualifiés sur 8 : 3 en Tableau A, 3 en Tableau B, 2 restent dans l'épreuve d'origine
    const f = rankSplit(3);
    const formula = {
      ...f,
      phases: f.phases.map(p =>
        p.kind === 'pool' ? { ...p, qualification: { mode: 'fixed_count' as const, count: 6 } } : p
      ),
    };
    const comp = competition(formula);
    await playPools(comp.id);
    const entry = poolRanking(comp.id);
    const out = await call('splitCompetition', { competitionId: comp.id });
    const gone = (session(comp.id).splitHistory as Array<{ fencerIds: string[] }>).flatMap(
      h => h.fencerIds
    );
    expect(gone).toHaveLength(6);
    expect(out.branches.map((b: { fencers: unknown[] }) => b.fencers.length)).toEqual([3, 3]);
    // Classement de l'origine : les deux derniers seulement, numérotés depuis 1
    const origin = originFinalRanking(entry, [], splitHistoryOf(session(comp.id).splitHistory));
    expect(origin.ranking.map(r => r.fencer.id)).toEqual(entry.slice(6).map(r => r.fencer.id));
    expect(origin.ranking[0].rank).toBe(1);
    // Exports et publication du moteur (XML, GREG, FTP, MCP) : même classement de l'origine
    const exported = resultsData(ctx, comp.id).overallRanking;
    expect(exported.map(r => r.fencer.id)).toEqual(entry.slice(6).map(r => r.fencer.id));
    expect(exported[0].rank).toBe(1);
  });

  it('par rang : une fille par branche, tireurs copiés, journaux, historique, rejeu', async () => {
    const formula = rankSplit(3);
    const comp = competition(formula);
    await playPools(comp.id);
    const entry = poolRanking(comp.id);
    const out = await call('splitCompetition', { competitionId: comp.id, commandId: 'cmd-s1' });
    expect(out.dryRun).toBe(false);
    expect(out.missing).toEqual([]);
    expect(out.branches.map((b: any) => [b.label, b.fencers.length])).toEqual([
      ['Tableau A', 3],
      ['Tableau B', 5],
    ]);
    expect(out.revision).toBe(db.eventLog.getRevision(comp.id));
    const [a, b] = out.branches.map((x: any) => db.getCompetition(x.competitionId)!);

    // Filles : titre, formule de la branche, origine notée
    expect(a.title).toBe('Coupe – Tableau A');
    expect(b.title).toBe('Coupe – Tableau B');
    // Publication à part (GREG, FTP, PDF) : chaque fille porte le libellé de sa branche
    expect(resultsXml(resultsData(ctx, a.id))).toContain('Coupe – Tableau A');
    expect(resultsXml(resultsData(ctx, b.id))).toContain('Coupe – Tableau B');
    const split = formula.phases[1] as SplitPhase;
    expect(a.settings?.formula?.phases).toEqual(split.branches[0].phases);
    expect(a.settings?.splitFromCompetitionId).toBe(comp.id);
    expect(a.settings?.hasDirectElimination).toBe(true);
    expect(a.settings?.splitOffCompetitionIds).toBeUndefined();

    // Tireurs copiés : rang dans la branche, catégorie copiée
    const copiesA = db.getFencersByCompetition(a.id);
    const expectedA = entry.slice(0, 3);
    expect(copiesA.map(f => f.lastName).sort()).toEqual(
      expectedA.map(r => r.fencer.lastName).sort()
    );
    for (const [i, r] of expectedA.entries()) {
      const copy = copiesA.find(f => f.lastName === r.fencer.lastName)!;
      expect(copy.ranking).toBe(i + 1);
      expect(copy.category).toBe(db.getFencer(r.fencer.id)!.category);
    }
    expect(
      db
        .getFencersByCompetition(b.id)
        .map(f => f.ranking)
        .sort()
    ).toEqual([1, 2, 3, 4, 5]);

    // État de départ : tableau d'abord, classement importé
    expect(session(a.id).currentPhase).toBe(3);
    expect((session(a.id).overallRanking as PoolRanking[]).map(r => r.rank)).toEqual([1, 2, 3]);

    // Origine : filles notées, historique, un GroupSplitOff par branche, même commandId
    const origin = db.getCompetition(comp.id)!;
    expect(origin.settings?.splitOffCompetitionIds).toEqual({
      'Tableau A': a.id,
      'Tableau B': b.id,
    });
    const history = session(comp.id).splitHistory;
    expect(history).toEqual([
      { label: 'Tableau A', competitionId: a.id, fencerIds: expectedA.map(r => r.fencer.id) },
      {
        label: 'Tableau B',
        competitionId: b.id,
        fencerIds: entry.slice(3).map(r => r.fencer.id),
      },
    ]);
    const splitOff = events(comp.id).filter(e => e.type === 'GroupSplitOff');
    expect(splitOff.map(e => e.payload)).toEqual(
      history.map((h: any) => ({
        group: h.label,
        targetCompetitionId: h.competitionId,
        fencerIds: h.fencerIds,
      }))
    );
    expect(splitOff.every(e => e.commandId === 'cmd-s1')).toBe(true);
    const imported = events(a.id);
    expect(imported.map(e => e.type)).toEqual(['SplitRankingImported']);
    expect(imported[0].commandId).toBe('cmd-s1');
    expect(imported[0].payload).toMatchObject({ sourceCompetitionId: comp.id, group: 'Tableau A' });

    // getCompetitionState expose l'historique
    const state = await call('getCompetitionState', { competitionId: comp.id });
    expect(state.state.splitHistory).toEqual(history);

    // Projection : historique rejoué depuis GroupSplitOff, sans écart
    const r = replay(comp.id);
    expect(r.facts.splitHistory).toEqual(history);
    expect(r.divergences).toEqual([]);
    expect(replay(a.id).divergences).toEqual([]);

    // La fille tire son tableau depuis le classement importé
    await call('generateTableau', { competitionId: b.id });
    expect(listMatches(ctx, b.id, { state: 'ready' }).some(m => m.kind === 'bracket')).toBe(true);

    // Déjà scindée : refus ; même commandId : rien de réécrit
    await expect(call('splitCompetition', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'split_group_not_found',
    });
    await expect(
      call('splitCompetition', { competitionId: comp.id, commandId: 'cmd-s1' })
    ).rejects.toMatchObject({ code: 'command_already_applied' });
    expect(db.getAllCompetitions()).toHaveLength(3);
  });

  it('écart d’historique réparé par la reconstruction (projection du journal)', async () => {
    const comp = competition(rankSplit());
    await playPools(comp.id);
    await call('splitCompetition', { competitionId: comp.id });
    const history = session(comp.id).splitHistory;
    db.saveSessionState(comp.id, { ...session(comp.id), splitHistory: [] });
    expect(replay(comp.id).divergences.map(x => x.kind)).toEqual(['split_history']);
    await call('rebuildCompetitionState', { competitionId: comp.id });
    expect(session(comp.id).splitHistory).toEqual(history);
    expect(replay(comp.id).divergences).toEqual([]);
  });

  it('par sexe, branche « poules puis tableau » : appel, tireurs pointés, rang d’entrée', async () => {
    const f = withBranches(rankSplit(), 'gender', [
      { label: 'Dames', phases: branchPhases('pools_tableau', fctx, newId), gender: Gender.FEMALE },
      { label: 'Hommes', phases: branchPhases('tableau', fctx, newId), gender: Gender.MALE },
    ]);
    const comp = competition(f);
    await playPools(comp.id);
    const out = await call('splitCompetition', { competitionId: comp.id });
    const dames = db.getCompetition(out.branches[0].competitionId)!;
    expect(dames.gender).toBe(Gender.FEMALE);
    const copies = db.getFencersByCompetition(dames.id);
    expect(copies).toHaveLength(4);
    expect(copies.every(c => c.gender === Gender.FEMALE)).toBe(true);
    expect(copies.every(c => c.status === FencerStatus.CHECKED_IN)).toBe(true);
    expect(copies.map(c => c.ranking).sort()).toEqual([1, 2, 3, 4]);
    expect(session(dames.id)).toMatchObject({ currentPhase: 0, currentPoolRound: 1, pools: [] });
    expect(dames.settings?.formula?.phases.map(p => p.kind)).toEqual(['pool', 'tableau']);
    expect(replay(dames.id).divergences).toEqual([]);
    // La fille tire ses poules avec le moteur actuel
    await call('generatePools', { competitionId: dames.id, poolCount: 1 });
    expect(session(dames.id).pools).toHaveLength(1);
  });

  it('par catégorie : catégorie de la fille quand la branche n’en a qu’une', async () => {
    const f = withBranches(rankSplit(), 'category', [
      { label: 'V1', phases: branchPhases('tableau', fctx, newId), categories: [Category.V1] },
      { label: 'V2', phases: branchPhases('tableau', fctx, newId), categories: [Category.V2] },
    ]);
    const comp = competition(f);
    await playPools(comp.id);
    const out = await call('splitCompetition', { competitionId: comp.id });
    const v2 = db.getCompetition(out.branches[1].competitionId)!;
    expect(v2.category).toBe(Category.V2);
    expect(db.getFencersByCompetition(v2.id).every(c => c.category === Category.V2)).toBe(true);
  });

  it('split_value_missing : tireur sans catégorie ; la simulation le liste sans refuser', async () => {
    const f = withBranches(rankSplit(), 'category', [
      { label: 'V1', phases: branchPhases('tableau', fctx, newId), categories: [Category.V1] },
      { label: 'V2', phases: branchPhases('tableau', fctx, newId), categories: [Category.V2] },
    ]);
    const comp = competition(f, i => (i === 5 ? (undefined as never) : Category.V1));
    await playPools(comp.id);
    const dry = await call('splitCompetition', { competitionId: comp.id, dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.branches.map((b: any) => [b.competitionId, b.fencers.length])).toEqual([
      [null, 7],
      [null, 0],
    ]);
    expect(dry.missing.map((m: any) => m.lastName)).toEqual(['NOM5']);
    const revision = db.eventLog.getRevision(comp.id);
    await expect(call('splitCompetition', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'split_value_missing',
    });
    expect(db.getAllCompetitions()).toHaveLength(1);
    expect(db.eventLog.getRevision(comp.id)).toBe(revision);
    expect(session(comp.id).splitHistory).toBeUndefined();
  });

  it('refus : sans scission, poules non terminées, branche manuelle inconnue', async () => {
    const plain = competition(formulaOf(fctx));
    await expect(call('splitCompetition', { competitionId: plain.id })).rejects.toMatchObject({
      code: 'invalid_settings',
    });
    const comp = competition(rankSplit());
    await call('generatePools', { competitionId: comp.id, poolCount: 2 });
    await expect(call('splitCompetition', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'pools_not_complete',
    });
    const manual = competition(
      withBranches(rankSplit(), 'manual', [
        { label: 'N1', phases: branchPhases('tableau', fctx, newId) },
        { label: 'N2', phases: branchPhases('tableau', fctx, newId) },
      ])
    );
    await playPools(manual.id);
    const [first] = db.getFencersByCompetition(manual.id);
    await expect(
      call('splitCompetition', {
        competitionId: manual.id,
        assignments: [{ fencerId: first.id, branch: 'N3' }],
      })
    ).rejects.toMatchObject({ code: 'invalid_input' });
    // Manuelle : tireurs non affectés manquants
    await expect(
      call('splitCompetition', {
        competitionId: manual.id,
        assignments: [{ fencerId: first.id, branch: 'N1' }],
      })
    ).rejects.toMatchObject({ code: 'split_value_missing' });
  });

  it('échec au milieu : tout est annulé (ni fille, ni tireurs, ni marque, ni journal)', async () => {
    const comp = competition(rankSplit());
    await playPools(comp.id);
    const revision = db.eventLog.getRevision(comp.id);
    const fencers = db.getAllCompetitions().flatMap(c => db.getFencersByCompetition(c.id)).length;
    const spy = vi.spyOn(db, 'updateCompetition').mockImplementation(() => {
      throw new Error('disque plein');
    });
    await expect(call('splitCompetition', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'internal',
    });
    spy.mockRestore();
    expect(db.getAllCompetitions()).toHaveLength(1);
    expect(db.getAllCompetitions().flatMap(c => db.getFencersByCompetition(c.id))).toHaveLength(
      fencers
    );
    expect(db.getCompetition(comp.id)!.settings?.splitOffCompetitionIds).toBeUndefined();
    expect(session(comp.id).splitHistory).toBeUndefined();
    expect(db.eventLog.getRevision(comp.id)).toBe(revision);
    expect(replay(comp.id).divergences).toEqual([]);
  });
});

d('splitCompetition après un tableau arrêté clos (docs/adr/0039, ADR-0037 amendée)', () => {
  /** Poules, tableau arrêté à 4, scission par rang (2 + le reste) */
  const stoppedThenSplit = (): FormulaV2 => {
    const f = applyOperationsV2(
      fctx,
      [
        { op: 'setPhase', phase: 'tableau', settings: { stopAt: 4 } },
        { op: 'insertPhase', brick: 'split', at: 2 },
      ],
      newId
    );
    return withBranches(f, 'rank', [
      {
        label: 'Finale A',
        phases: branchPhases('tableau', fctx, newId),
        take: { mode: 'fixed_count', count: 2 },
      },
      { label: 'Finale B', phases: branchPhases('pools', fctx, newId) },
    ]);
  };

  it('clôture sans nouveau tour, puis restants répartis par rang d’entrée au tableau', async () => {
    const comp = competition(stoppedThenSplit());
    await playPools(comp.id);
    await call('generateTableau', { competitionId: comp.id });
    // Tableau de 8 : seul le tour de 8 se joue (arrêt à 4)
    await expect(call('splitCompetition', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'tableau_stage_not_complete',
    });
    const first = listMatches(ctx, comp.id, { state: 'ready' }).filter(
      m => m.kind === 'bracket' && (m.round ?? 0) > 4
    );
    expect(first).toHaveLength(4);
    for (const m of first) {
      await call('recordScore', {
        competitionId: comp.id,
        matchId: m.matchId,
        scoreA: 15,
        scoreB: 3,
      });
    }
    const closed = await call('closeTableauStage', { competitionId: comp.id });
    expect(closed).toMatchObject({ stopAt: 4, qualified: 4, eliminated: 4 });
    // Pas de tour de poules préparé : le classement attend la scission
    const s = session(comp.id);
    expect(s).toMatchObject({ currentPhase: 3, currentPoolRound: 1, tableauMatches: [] });
    expect(s.stageHistory).toHaveLength(1);
    expect(s.pools).toHaveLength(2);
    expect(replay(comp.id).divergences).toEqual([]);

    const qualified = db
      .getFencersByCompetition(comp.id)
      .filter(f => f.status !== FencerStatus.ELIMINATED)
      .sort((x, y) => (x.ranking ?? 0) - (y.ranking ?? 0));
    expect(qualified).toHaveLength(4);
    const out = await call('splitCompetition', { competitionId: comp.id });
    expect(out.branches.map((b: any) => b.fencers.map((f: any) => f.id))).toEqual([
      qualified.slice(0, 2).map(f => f.id),
      qualified.slice(2).map(f => f.id),
    ]);
    // Branche « poules » : fille à l'appel
    const b = db.getCompetition(out.branches[1].competitionId)!;
    expect(session(b.id).currentPhase).toBe(0);
    expect(replay(comp.id).divergences).toEqual([]);
  });
});

d('splitCompetition, étape E3 : manuelle, branches restées (docs/adr/0039)', () => {
  /** Compétition couplée : scission par sexe, Hommes et Dames restés dans l'épreuve */
  const coupled = () =>
    formulaOf({ ...fctx, settings: { ...base, postPoolSplitCriteria: 'gender' as const } });

  it('manuelle : affectations de l’écran, classement d’entrée dans la simulation', async () => {
    const comp = competition(
      withBranches(rankSplit(), 'manual', [
        { label: 'N1', phases: branchPhases('tableau', fctx, newId) },
        { label: 'N2', phases: branchPhases('pools_tableau', fctx, newId) },
      ])
    );
    await playPools(comp.id);
    const dry = await call('splitCompetition', { competitionId: comp.id, dryRun: true });
    const entry = poolRanking(comp.id);
    expect(dry.entrants.map((e: any) => e.id)).toEqual(entry.map(r => r.fencer.id));
    expect(dry.entrants[0]).toMatchObject({ rank: 1, club: expect.any(String) });
    expect(dry.missing).toHaveLength(8);
    expect(dry.branches.every((b: any) => b.stayInCompetition === false)).toBe(true);
    // Trois premiers en N1, le reste en N2
    const assignments = entry.map((r, i) => ({
      fencerId: r.fencer.id,
      branch: i < 3 ? 'N1' : 'N2',
    }));
    const sim = await call('splitCompetition', {
      competitionId: comp.id,
      dryRun: true,
      assignments,
    });
    expect(sim.missing).toEqual([]);
    expect(sim.branches.map((b: any) => b.fencers.length)).toEqual([3, 5]);
    const out = await call('splitCompetition', { competitionId: comp.id, assignments });
    const [n1, n2] = out.branches.map((b: any) => db.getCompetition(b.competitionId)!);
    expect(n1.title).toBe('Coupe – N1');
    expect(db.getFencersByCompetition(n1.id).map(f => f.ranking)).toEqual([1, 2, 3]);
    expect(session(n2.id).currentPhase).toBe(0);
    expect(replay(comp.id).divergences).toEqual([]);
  });

  it('compétition couplée (toutes les branches restent) : refus, tableaux séparés', async () => {
    const comp = competition(coupled());
    expect(comp.settings?.postPoolSplitCriteria).toBe('gender');
    await playPools(comp.id);
    await expect(
      call('splitCompetition', { competitionId: comp.id, dryRun: true })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
    // Déroulé des tableaux séparés (ADR-0024) inchangé
    await call('generateTableau', { competitionId: comp.id, group: 'F' });
    await call('generateTableau', { competitionId: comp.id, group: 'M' });
    expect(Object.keys(session(comp.id).groupTableaux).sort()).toEqual(['F', 'M']);
  });

  it('ancienne compétition couplée (réglage seul, sans formule) : refus', async () => {
    const comp = db.createCompetition({
      title: 'Couplée',
      date: new Date('2026-12-06'),
      location: 'Gymnase',
      weapon,
      gender: Gender.MIXED,
      category: Category.SENIOR,
      settings: { ...base, postPoolSplitCriteria: 'gender' } as never,
    });
    await expect(
      call('splitCompetition', { competitionId: comp.id, dryRun: true })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
  });

  it('une branche restée, l’autre partie : formule refusée (pas de mélange)', async () => {
    const f = coupled();
    const split = f.phases[f.phases.length - 1] as SplitPhase;
    const comp = competition(
      withBranches(f, 'gender', [
        split.branches[0],
        { ...split.branches[1], stayInCompetition: false },
      ])
    );
    // Pas une compétition couplée : pas de tableaux séparés par sexe
    expect(comp.settings?.postPoolSplitCriteria).toBeUndefined();
    await playPools(comp.id);
    await expect(
      call('splitCompetition', { competitionId: comp.id, dryRun: true })
    ).rejects.toMatchObject({
      code: 'invalid_settings',
      message: expect.stringContaining('toutes les branches ou aucune'),
    });
  });

  it('par sexe, toutes les branches partent : deux filles, aucun groupe extrait par sexe', async () => {
    const f = coupled();
    const split = f.phases[f.phases.length - 1] as SplitPhase;
    const comp = competition(
      withBranches(
        f,
        'gender',
        split.branches.map(({ stayInCompetition: _stay, ...b }) => b)
      )
    );
    expect(comp.settings?.postPoolSplitCriteria).toBeUndefined();
    await playPools(comp.id);
    const out = await call('splitCompetition', { competitionId: comp.id });
    expect(out.branches.map((b: any) => [b.label, b.stayInCompetition, !!b.competitionId])).toEqual(
      [
        ['Hommes', false, true],
        ['Dames', false, true],
      ]
    );
    const [hommes, dames] = out.branches.map((b: any) => b.competitionId as string);
    // Origine : filles notées par libellé seulement, pas de clé de sexe (M, F)
    const origin = db.getCompetition(comp.id)!;
    expect(origin.settings?.splitOffCompetitionIds).toEqual({ Hommes: hommes, Dames: dames });
    expect(splitHistoryOf(session(comp.id).splitHistory).map(h => h.label)).toEqual([
      'Hommes',
      'Dames',
    ]);
    expect(replay(comp.id).divergences).toEqual([]);
  });
});
