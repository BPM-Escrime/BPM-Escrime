import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REST_MS,
  planDay,
  splitPools,
  tableauRounds,
  type PlannerInput,
} from './dayPlanner';

const MIN = 60_000;
const H9 = 9 * 60 * MIN;
const strips = (n: number) => Array.from({ length: n }, (_, i) => ({ number: i + 1 }));

/** Journée type de #1958 : M15 H (40) et M17 D (12) à l'épée sur 4 pistes */
const day = (over: Partial<PlannerInput> = {}): PlannerInput => ({
  events: [
    { id: 'm15h', weapon: 'E', gender: 'M', fencers: 40, scratchAt: H9, order: 1 },
    { id: 'm17d', weapon: 'E', gender: 'F', fencers: 12, scratchAt: H9 + 80 * MIN, order: 2 },
  ],
  strips: strips(4),
  ...over,
});

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

describe('splitPools / tableauRounds', () => {
  it('répartit en poules équilibrées', () => {
    expect(splitPools(40)).toEqual([7, 7, 7, 7, 6, 6]);
    expect(splitPools(12)).toEqual([6, 6]);
    expect(splitPools(1)).toEqual([]);
  });

  it('ne compte pas les exempts', () => {
    expect(tableauRounds(12)).toEqual([
      { size: 16, matches: 4 },
      { size: 8, matches: 4 },
      { size: 4, matches: 2 },
      { size: 2, matches: 1 },
    ]);
    expect(tableauRounds(32)[0]).toEqual({ size: 32, matches: 16 });
  });
});

describe('planDay', () => {
  it('donne une fin estimée à chaque épreuve et occupe les 4 pistes', () => {
    const plan = planDay(day());
    expect(plan.events).toHaveLength(2);
    for (const e of plan.events) {
      expect(e.end).not.toBeNull();
      expect(e.finalAt).not.toBeNull();
      expect(e.finalAt!).toBeGreaterThanOrEqual(e.tableauStart!);
    }
    const used = new Set(plan.blocks.flatMap(b => b.strips));
    expect([...used].sort()).toEqual([1, 2, 3, 4]);
    // Poule de 7 à l'épée : 21 × (3 min 30 + 1 min)
    const p1 = plan.blocks.find(b => b.id === 'm15h:pool:1')!;
    expect(p1.start).toBe(H9);
    expect(p1.end - p1.start).toBe(21 * 4.5 * MIN);
    expect(plan.alerts).toEqual([]);
  });

  it('ne met jamais deux blocs sur la même piste en même temps', () => {
    const { blocks } = planDay(day());
    for (const a of blocks)
      for (const b of blocks)
        if (a !== b && a.strips.some(s => b.strips.includes(s))) expect(overlaps(a, b)).toBe(false);
  });

  it('sépare deux tours d’une même épreuve du temps de repos', () => {
    const plan = planDay(day({ restMs: 15 * MIN }));
    for (const id of ['m15h', 'm17d']) {
      const own = plan.blocks.filter(b => b.eventId === id);
      const pools = own.filter(b => b.kind === 'pool');
      const rounds = own.filter(b => b.kind === 'tableau').sort((a, b) => b.index - a.index);
      let prevEnd = Math.max(...pools.map(b => b.end));
      for (const r of rounds) {
        expect(r.start - prevEnd).toBeGreaterThanOrEqual(15 * MIN);
        prevEnd = r.end;
      }
    }
    expect(DEFAULT_REST_MS).toBe(10 * MIN);
  });

  it('ne commence pas une épreuve avant son scratch', () => {
    const plan = planDay(day());
    const m17 = plan.blocks.filter(b => b.eventId === 'm17d');
    expect(Math.min(...m17.map(b => b.start))).toBeGreaterThanOrEqual(H9 + 80 * MIN);
  });

  it('respecte les réservations de pistes (#1878)', () => {
    const plan = planDay(
      day({
        strips: [
          ...strips(3),
          { number: 4, rule: { competitions: null, pools: false, tableau: true, tableauMax: 4 } },
        ],
      })
    );
    for (const b of plan.blocks.filter(x => x.strips.includes(4))) {
      expect(b.kind).toBe('tableau');
      expect(b.index).toBeLessThanOrEqual(4);
    }
    expect(plan.blocks.some(b => b.strips.includes(4))).toBe(true);
  });

  it('alerte quand aucune piste n’autorise un bloc', () => {
    const plan = planDay(
      day({
        strips: strips(2).map(s => ({
          ...s,
          rule: { competitions: ['m15h'], pools: true, tableau: true, tableauMax: null },
        })),
      })
    );
    expect(plan.alerts.filter(a => a.type === 'no_strip').length).toBeGreaterThan(0);
    expect(plan.blocks.some(b => b.eventId === 'm17d')).toBe(false);
  });

  it('alerte et réduit les pistes quand les arbitres de l’arme manquent', () => {
    const plan = planDay(day({ referees: { E: 2 } }));
    expect(plan.alerts.some(a => a.type === 'referees_short' && a.weapon === 'E')).toBe(true);
    // Jamais plus de 2 pistes d'épée en même temps
    const pts = plan.blocks.flatMap(b => [b.start, b.end]);
    for (const t of pts) {
      const load = plan.blocks
        .filter(b => b.start <= t && t < b.end)
        .reduce((n, b) => n + b.strips.length, 0);
      expect(load).toBeLessThanOrEqual(2);
    }
    const free = planDay(day());
    expect(plan.events[0].end!).toBeGreaterThan(free.events[0].end!);
  });

  it('ignore les arbitres d’une autre arme', () => {
    expect(planDay(day({ referees: { S: 0 } }))).toEqual(planDay(day()));
  });

  it('recalage en direct : un retard sur les poules décale le tableau, sans toucher aux blocs commencés', () => {
    const before = planDay(day());
    const p1 = before.blocks.find(b => b.id === 'm15h:pool:1')!;
    const now = p1.start + 60 * MIN;
    const late = { ...p1, end: p1.end + 25 * MIN };
    const after = planDay(
      day({ now, fixed: [{ id: late.id, strips: late.strips, start: late.start, end: late.end }] })
    );
    const p1After = after.blocks.find(b => b.id === p1.id)!;
    expect(p1After).toMatchObject({ start: p1.start, end: late.end, fixed: true });
    const t = (plan: typeof before) => plan.events.find(e => e.eventId === 'm15h')!.tableauStart!;
    expect(t(after)).toBeGreaterThan(t(before));
    for (const b of after.blocks.filter(x => !x.fixed)) expect(b.start).toBeGreaterThanOrEqual(now);
  });

  it('les durées mesurées allongent l’estimation', () => {
    const slow = day();
    slow.events[0].measuredMs = { pool: Array(20).fill(6 * MIN) };
    const p = (plan: ReturnType<typeof planDay>) => plan.blocks.find(b => b.id === 'm15h:pool:1')!;
    const a = p(planDay(day()));
    const b = p(planDay(slow));
    expect(b.end - b.start).toBeGreaterThan(a.end - a.start);
  });

  it('épreuve en élimination directe seule, finale sur une piste', () => {
    const plan = planDay({
      events: [{ id: 'x', weapon: 'S', fencers: 16, scratchAt: H9, pools: false }],
      strips: strips(4),
    });
    expect(plan.blocks.map(b => b.id)).toEqual(['x:T16', 'x:T8', 'x:T4', 'x:T2']);
    expect(plan.blocks[plan.blocks.length - 1].strips).toHaveLength(1);
    expect(plan.blocks[0].strips).toHaveLength(4);
  });

  it('est déterministe', () => {
    expect(planDay(day())).toEqual(planDay(day()));
  });
});
