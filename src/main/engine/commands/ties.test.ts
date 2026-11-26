/**
 * Ex aequo à la barre de qualification (docs/adr/0040, lot F1) : simulation (« tiedAtBar »),
 * réglage de la formule, champ « ties » de la commande qui prime, « barrage » refusé ;
 * closePoolRound et generateTableau. Coupe figée par les événements existants. Base SQLite
 * réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import {
  Category,
  CompetitionSettings,
  FencerStatus,
  Gender,
  Weapon,
  type TiesAtBar,
} from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import {
  flatSettingsOf,
  formulaOf,
  type FormulaV2,
} from '../../../shared/domain/formula/formulaV2';
import { applyOperationsV2 } from '../../../shared/domain/formula/formulaV2Operations';
import { CONTRACT_MCP_TOOLS } from '../api/mcpAdapter';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';
import { listMatches } from './sport';

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

/** Formule : `rounds` tours de poules (4 qualifiés au premier, `ties`), puis le tableau */
function formula(rounds: 1 | 2, ties?: TiesAtBar): FormulaV2 {
  const f =
    rounds === 2
      ? applyOperationsV2(fctx, [{ op: 'insertPhase', brick: 'pool', at: 1 }], newId)
      : formulaOf(fctx);
  let first = true;
  return {
    ...f,
    phases: f.phases.map(p => {
      if (p.kind !== 'pool' || !first) return p;
      first = false;
      return { ...p, qualification: { mode: 'fixed_count', count: 4, ...(ties ? { ties } : {}) } };
    }),
  };
}

/** Poules puis scission par rang : « Tableau A » prend 4 tireurs (`ties`), « Tableau B » le reste */
function rankSplit(ties?: TiesAtBar): FormulaV2 {
  const f = applyOperationsV2(
    fctx,
    [
      { op: 'removePhase', phase: 'tableau' },
      { op: 'insertPhase', brick: 'split', at: 1 },
    ],
    newId
  );
  return {
    ...f,
    phases: f.phases.map(p =>
      p.kind === 'split'
        ? {
            ...p,
            branches: p.branches.map((b, i) =>
              i === 0
                ? { ...b, take: { mode: 'fixed_count', count: 4, ...(ties ? { ties } : {}) } }
                : b
            ),
          }
        : p
    ),
  };
}

/** Épreuve de 6 tireurs pointés, rang d'entrée 1 à 6 */
function competition(f: FormulaV2) {
  const comp = db.createCompetition({
    title: 'Coupe',
    date: new Date('2026-12-06'),
    location: 'Gymnase',
    weapon,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    settings: { ...base, ...flatSettingsOf(f, weapon), formula: f } as never,
  });
  for (let i = 0; i < 6; i++) {
    db.addFencer(comp.id, {
      lastName: `NOM${i + 1}`,
      firstName: `P${i + 1}`,
      gender: Gender.MALE,
      club: `Club${i}`,
      ranking: i + 1,
      status: FencerStatus.CHECKED_IN,
    });
  }
  const byRank = db.getFencersByCompetition(comp.id).sort((a, b) => a.ranking! - b.ranking!);
  return { comp, ids: byRank.map(f => f.id) };
}

/**
 * Deux poules de 3 en cercle (a bat b, b bat c, c bat a, toujours 5-0) : les 6 tireurs sont
 * ex aequo à la 1re place (V/M, indice et touches égaux).
 */
async function playCircles(competitionId: string, round: number, groups: string[][]) {
  const composition = groups.map((g, p) => ({
    poolId: `${competitionId}-r${round}-p${p + 1}`,
    number: p + 1,
    fencerIds: g,
    matches: [
      [g[0], g[1]],
      [g[1], g[2]],
      [g[2], g[0]],
    ].map(([a, b], m) => ({
      matchId: `${competitionId}-r${round}-p${p + 1}-m${m}`,
      fencerAId: a,
      fencerBId: b,
    })),
  }));
  await call('generatePools', { competitionId, composition });
  for (const pool of composition) {
    for (const m of pool.matches) {
      await call('recordScore', { competitionId, matchId: m.matchId, scoreA: 5, scoreB: 0 });
    }
  }
}
/** Tour 1 : une poule, le tireur placé le premier bat tous les suivants (5-1) */
async function playOrdered(competitionId: string, order: string[]) {
  const matches = order.flatMap((a, i) =>
    order.slice(i + 1).map((b, j) => ({
      matchId: `${competitionId}-r1-m${i}-${j}`,
      fencerAId: a,
      fencerBId: b,
    }))
  );
  await call('generatePools', {
    competitionId,
    composition: [{ poolId: `${competitionId}-r1-p1`, number: 1, fencerIds: order, matches }],
  });
  for (const m of matches) {
    await call('recordScore', { competitionId, matchId: m.matchId, scoreA: 5, scoreB: 1 });
  }
}

// Poules mêlées : rang d'entrée sans lien avec la poule
const circles = (ids: string[]) => [
  [ids[5], ids[0], ids[3]],
  [ids[1], ids[4], ids[2]],
];

d('ex aequo à la barre (docs/adr/0040)', () => {
  it('tableau, réglage absent : tous les ex aequo passent ; la simulation les signale', async () => {
    const { comp, ids } = competition(formula(1));
    await playCircles(comp.id, 1, circles(ids));
    const sim = await call('generateTableau', { competitionId: comp.id, dryRun: true });
    expect(sim.qualified).toBe(6);
    expect(sim.tiedAtBar).toMatchObject({ rank: 1, places: 4 });
    expect([...sim.tiedAtBar.fencerIds].sort()).toEqual([...ids].sort());
  });

  it('tableau : « ties » de la commande prime ; départage au rang d’entrée, quota tenu', async () => {
    const { comp, ids } = competition(formula(1));
    await playCircles(comp.id, 1, circles(ids));
    const out = await call('generateTableau', { competitionId: comp.id, ties: 'initial_ranking' });
    expect(out.qualified).toBe(4);
    // Coupe figée par TableauGenerated : les 4 premiers au rang d'entrée
    const generated = events(comp.id).find(e => e.type === 'TableauGenerated');
    const placed = new Set(
      (generated!.payload as any).matches.flatMap((s: any) => [s.fencerAId, s.fencerBId])
    );
    expect(ids.slice(0, 4).every(id => placed.has(id))).toBe(true);
    expect(ids.slice(4).some(id => placed.has(id))).toBe(false);
  });

  it('tableau : réglage de la formule « initial_ranking » appliqué sans champ', async () => {
    const { comp } = competition(formula(1, 'initial_ranking'));
    const { ids } = { ids: db.getFencersByCompetition(comp.id).map(f => f.id) };
    await playCircles(comp.id, 1, circles(ids));
    const sim = await call('generateTableau', { competitionId: comp.id, dryRun: true });
    expect(sim.qualified).toBe(4);
    expect(sim.tiedAtBar).toMatchObject({ places: 4 });
    // « all » pour ce tableau seulement
    const all = await call('generateTableau', {
      competitionId: comp.id,
      dryRun: true,
      ties: 'all',
    });
    expect(all.qualified).toBe(6);
  });

  it('tour de poules : simulation, réglage de la formule, « ties » qui prime, PoolRoundClosed', async () => {
    const { comp, ids } = competition(formula(2, 'initial_ranking'));
    await playCircles(comp.id, 1, circles(ids));
    const sim = await call('closePoolRound', { competitionId: comp.id, dryRun: true });
    expect(sim).toMatchObject({ qualified: 4, eliminated: 2 });
    expect(sim.tiedAtBar).toMatchObject({ rank: 1, places: 4 });
    const all = await call('closePoolRound', { competitionId: comp.id, dryRun: true, ties: 'all' });
    expect(all).toMatchObject({ qualified: 6, eliminated: 0 });
    await call('closePoolRound', { competitionId: comp.id });
    const closed = events(comp.id).find(e => e.type === 'PoolRoundClosed')!.payload as any;
    expect(closed.qualifiedIds).toEqual(ids.slice(0, 4));
    expect([...closed.eliminatedIds].sort()).toEqual(ids.slice(4).sort());
  });

  it('« barrage » refusé jusqu’au lot F1b (invalid_settings), rien d’écrit', async () => {
    // Tableau : épreuve à un tour (le tableau après plusieurs tours : multiRound.test.ts)
    for (const [rounds, op] of [
      [2, 'closePoolRound'],
      [1, 'generateTableau'],
    ] as const) {
      const { comp, ids } = competition(formula(rounds));
      await playCircles(comp.id, 1, circles(ids));
      await expect(call(op, { competitionId: comp.id, ties: 'barrage' })).rejects.toMatchObject({
        code: 'invalid_settings',
      });
      expect(events(comp.id).some(e => /PoolRoundClosed|TableauGenerated/.test(e.type))).toBe(
        false
      );
    }
  });

  it('scission par rang : simulation, réglage de la branche, « ties » qui prime, GroupSplitOff', async () => {
    const { comp, ids } = competition(rankSplit('initial_ranking'));
    await playCircles(comp.id, 1, circles(ids));
    const sim = await call('splitCompetition', { competitionId: comp.id, dryRun: true });
    expect(sim.tiedAtBar).toHaveLength(1);
    expect(sim.tiedAtBar[0]).toMatchObject({ rank: 1, places: 4 });
    expect(sim.branches[0].fencers.map((f: any) => f.id)).toEqual(ids.slice(0, 4));
    // « all » pour cette scission : les 6 ex aequo dans « Tableau A »
    const all = await call('splitCompetition', {
      competitionId: comp.id,
      dryRun: true,
      ties: 'all',
    });
    expect(all.branches.map((b: any) => b.fencers.length)).toEqual([6, 0]);
    // Coupe figée par les événements existants de la scission
    const out = await call('splitCompetition', { competitionId: comp.id });
    const split = events(comp.id).filter(e => e.type === 'GroupSplitOff');
    expect(split.map(e => (e.payload as any).group)).toEqual(['Tableau A', 'Tableau B']);
    const a = out.branches[0].competitionId as string;
    const imported = events(a).find(e => e.type === 'SplitRankingImported')!.payload as any;
    expect(JSON.stringify(imported)).toContain(ids[0]);
    expect(
      db
        .getFencersByCompetition(a)
        .map(f => f.lastName)
        .sort()
    ).toEqual(['NOM1', 'NOM2', 'NOM3', 'NOM4']);
  });

  it('scission : « barrage » refusé (invalid_settings), aucune fille créée', async () => {
    const { comp, ids } = competition(rankSplit());
    await playCircles(comp.id, 1, circles(ids));
    const before = db.getAllCompetitions().length;
    await expect(
      call('splitCompetition', { competitionId: comp.id, ties: 'barrage' })
    ).rejects.toMatchObject({ code: 'invalid_settings' });
    expect(db.getAllCompetitions()).toHaveLength(before);
    expect(events(comp.id).some(e => e.type === 'GroupSplitOff')).toBe(false);
  });

  it('2e tour : rang d’entrée = place au tour précédent, pas le classement initial', async () => {
    // Trois tours : le 1er qualifie tout le monde, le 2e en garde 4 (« initial_ranking »)
    const f = applyOperationsV2(
      fctx,
      [
        { op: 'insertPhase', brick: 'pool', at: 1 },
        { op: 'insertPhase', brick: 'pool', at: 2 },
      ],
      newId
    );
    let round = 0;
    const phases = f.phases.map(p =>
      p.kind === 'pool' && round++ === 1
        ? {
            ...p,
            qualification: {
              mode: 'fixed_count' as const,
              count: 4,
              ties: 'initial_ranking' as const,
            },
          }
        : p
    );
    const { comp, ids } = competition({ ...f, phases });
    // Tour 1 : une poule de 6, ordre inverse du classement initial (ids[5] bat tout le monde)
    const order = [...ids].reverse();
    await playOrdered(comp.id, order);
    await call('closePoolRound', { competitionId: comp.id });
    // Tour 2 : tous ex aequo ; départage par la place au tour 1 (ids[5] … ids[2])
    await playCircles(comp.id, 2, circles(ids));
    const sim = await call('closePoolRound', { competitionId: comp.id, dryRun: true });
    expect(sim).toMatchObject({ qualified: 4, eliminated: 2 });
    await call('closePoolRound', { competitionId: comp.id });
    const closed = events(comp.id).filter(e => e.type === 'PoolRoundClosed')[1].payload as any;
    expect(closed.qualifiedIds).toEqual(order.slice(0, 4));
  });

  it('scission après deux tours : rang d’entrée = place au tour précédent', async () => {
    const f = applyOperationsV2(
      fctx,
      [
        { op: 'removePhase', phase: 'tableau' },
        { op: 'insertPhase', brick: 'pool', at: 1 },
        { op: 'insertPhase', brick: 'split', at: 2 },
      ],
      newId
    );
    const formula2: FormulaV2 = {
      ...f,
      phases: f.phases.map(p =>
        p.kind === 'split'
          ? {
              ...p,
              branches: p.branches.map((b, i) =>
                i === 0
                  ? { ...b, take: { mode: 'fixed_count', count: 4, ties: 'initial_ranking' } }
                  : b
              ),
            }
          : p
      ),
    };
    const { comp, ids } = competition(formula2);
    // Tour 1 : ordre inverse du classement initial
    await playOrdered(comp.id, [...ids].reverse());
    await call('closePoolRound', { competitionId: comp.id });
    // Tour 2 : tous ex aequo ; la branche A prend les 4 premiers du tour 1
    await playCircles(comp.id, 2, circles(ids));
    const sim = await call('splitCompetition', { competitionId: comp.id, dryRun: true });
    expect(sim.branches[0].fencers.map((x: any) => x.id)).toEqual([...ids].reverse().slice(0, 4));
  });

  it('classement final du tableau : coupe figée par le tableau tiré, pas par la formule', async () => {
    // Formule « tous les ex aequo » ; tableau tiré avec « initial_ranking » (4 sur 6)
    const { comp, ids } = competition(formula(1));
    await playCircles(comp.id, 1, circles(ids));
    await call('generateTableau', { competitionId: comp.id, ties: 'initial_ranking' });
    for (let guard = 0; guard < 10; guard++) {
      const ready = listMatches(ctx, comp.id, { state: 'ready' }).filter(m => m.kind === 'bracket');
      if (ready.length === 0) break;
      for (const m of ready) {
        await call('recordScore', {
          competitionId: comp.id,
          matchId: m.matchId,
          scoreA: 15,
          scoreB: 3,
        });
      }
    }
    const results = (db.getSessionState(comp.id) as any).finalResults as any[];
    expect(results).toHaveLength(4);
    expect(results.map(r => r.fencer.id).sort()).toEqual(ids.slice(0, 4).sort());
  });

  it('« draw » (F1c) : tirage au sort par le moteur au moment de la coupe, figé par l’événement', async () => {
    const { comp, ids } = competition(formula(2));
    await playCircles(comp.id, 1, circles(ids));
    // Hasard du moteur fixé pour le test
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const sim = await call('closePoolRound', {
        competitionId: comp.id,
        dryRun: true,
        ties: 'draw',
      });
      expect(sim).toMatchObject({ qualified: 4, eliminated: 2 });
      await call('closePoolRound', { competitionId: comp.id, ties: 'draw' });
    } finally {
      spy.mockRestore();
    }
    const closed = events(comp.id).find(e => e.type === 'PoolRoundClosed')!.payload as any;
    expect(closed.qualifiedIds).toHaveLength(4);
    // Rejeu : le tirage n'est pas refait, la coupe vient de l'événement
    const statuses = db.getFencersByCompetition(comp.id);
    expect(
      statuses
        .filter(f => f.status === FencerStatus.ELIMINATED)
        .map(f => f.id)
        .sort()
    ).toEqual([...closed.eliminatedIds].sort());
  });

  it('« draw » : tableau et scission tirés au sort par le moteur, quota tenu', async () => {
    const t = competition(formula(1));
    await playCircles(t.comp.id, 1, circles(t.ids));
    const tab = await call('generateTableau', {
      competitionId: t.comp.id,
      ties: 'draw',
      dryRun: true,
    });
    expect(tab.qualified).toBe(4);
    const sp = competition(rankSplit('draw'));
    await playCircles(sp.comp.id, 1, circles(sp.ids));
    const split = await call('splitCompetition', { competitionId: sp.comp.id, dryRun: true });
    expect(split.branches.map((b: any) => b.fencers.length)).toEqual([4, 2]);
  });

  it('MCP : même champ « ties » sur les outils de coupe (ADR-0008)', () => {
    for (const name of ['close_pool_round', 'build_bracket', 'split_competition']) {
      const tool = CONTRACT_MCP_TOOLS.write.find(t => t.name === name)!;
      expect(Object.keys((tool.inputSchema as any).properties)).toContain('ties');
    }
  });
});
