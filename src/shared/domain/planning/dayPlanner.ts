/**
 * BPM - Escrime - Planning prévisionnel de la journée (#1958, lot 1) : moteur pur.
 * Licensed under GPL-3.0
 *
 * 1. Découpe chaque épreuve en blocs (une poule, ou un tour de tableau).
 * 2. Estime la durée de chaque bloc (durées de référence ajustées, #1965).
 * 3. Place les blocs sur les pistes par ordonnancement par liste : réservations (#1878),
 *    repos des tireurs entre deux tours, arbitres libres de l'arme.
 * 4. Lève les alertes (arbitres insuffisants, bloc sans piste autorisée).
 *
 * Pur : heures en millisecondes fournies par l'appelant (`now`, `scratchAt`), aucune horloge.
 * Recalage en direct : blocs commencés passés dans `fixed` (figés), durées mesurées dans
 * `measuredMs` ; seuls les blocs à venir bougent, jamais avant `now`.
 */
import type { StripRule } from '../../types/eventDay';
import {
  adjustedDuration,
  referenceDuration,
  weaponCode,
  type DurationPhase,
  type DurationSources,
} from '../../utils/matchDurations';
import { DEFAULT_STRIP_RULE, stripAllows } from '../../utils/stripRules';

const MIN = 60_000;
/** Repos minimal entre deux tours d'une même épreuve */
export const DEFAULT_REST_MS = 10 * MIN;
export const DEFAULT_POOL_SIZE = 7;

export interface PlannerEvent {
  id: string;
  title?: string;
  /** Code arme : E, F, S, L, C (libellé libre accepté) */
  weapon: string;
  gender?: string;
  category?: string;
  /** Effectif estimé (inscrits, puis pointés) */
  fencers: number;
  /** Heure de scratch (ms) : aucun bloc ne commence avant */
  scratchAt: number;
  /** Ordre de l'épreuve dans la journée (départage) */
  order?: number;
  /** false : pas de tour de poules */
  pools?: boolean;
  /** Tailles des poules ; sinon réparties depuis `poolSize` */
  poolSizes?: number[];
  poolSize?: number;
  poolMaxScore?: number;
  /** false : pas de tableau */
  tableau?: boolean;
  /** Qualifiés pour le tableau ; défaut : tout l'effectif */
  qualifiers?: number;
  tableauMaxScore?: number;
  /** Pistes au plus par tour de tableau */
  tableauMaxStrips?: number;
  /** Durées réelles déjà mesurées (ms), les plus récentes en dernier */
  measuredMs?: Partial<Record<'pool' | 'tableau', number[]>>;
}

export interface PlannerStrip {
  number: number;
  rule?: StripRule;
}

/** Bloc commencé ou terminé : figé à ses pistes et ses heures (fin estimée s'il est en cours). */
export interface FixedBlock {
  id: string;
  strips: number[];
  start: number;
  end: number;
}

export interface PlannerInput {
  events: PlannerEvent[];
  strips: PlannerStrip[];
  /** Arbitres de la journée par code arme ; arme absente = pas de limite */
  referees?: Record<string, number>;
  restMs?: number;
  durations?: DurationSources;
  fixed?: FixedBlock[];
  /** Heure courante (ms) : aucun bloc à venir n'est placé avant */
  now?: number;
}

export type BlockKind = 'pool' | 'tableau';

export interface PlannedBlock {
  /** `<épreuve>:pool:<n>` ou `<épreuve>:T<taille>` */
  id: string;
  eventId: string;
  kind: BlockKind;
  /** Numéro de poule (1…) ou taille du tour de tableau (32, 16… 2 = finale) */
  index: number;
  /** Matchs réels (exempts exclus) */
  matches: number;
  strips: number[];
  start: number;
  end: number;
  fixed: boolean;
}

export interface PlannedEvent {
  eventId: string;
  start: number | null;
  poolsEnd: number | null;
  tableauStart: number | null;
  /** Début de la finale */
  finalAt: number | null;
  end: number | null;
}

export type PlannerAlert =
  | {
      type: 'referees_short';
      weapon: string;
      blockId: string;
      /** Pistes voulues / arbitres libres de l'arme */
      needed: number;
      available: number;
      from: number;
      to: number;
    }
  | { type: 'no_strip'; blockId: string };

export interface DayPlan {
  blocks: PlannedBlock[];
  events: PlannedEvent[];
  alerts: PlannerAlert[];
}

interface Round {
  kind: BlockKind;
  /** Poules : une entrée par poule ; tableau : une seule entrée */
  parts: Array<{ id: string; index: number; matches: number }>;
  tableauSize: number | null;
}

/** Poules équilibrées : écart d'au plus un tireur. */
export function splitPools(fencers: number, poolSize = DEFAULT_POOL_SIZE): number[] {
  if (fencers < 2) return [];
  const count = Math.ceil(fencers / Math.max(2, poolSize));
  const base = Math.floor(fencers / count);
  const extra = fencers % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Tours du tableau : taille et matchs réels (les exempts ne jouent pas le premier tour). */
export function tableauRounds(qualifiers: number): Array<{ size: number; matches: number }> {
  if (qualifiers < 2) return [];
  let size = 2;
  while (size < qualifiers) size *= 2;
  const rounds: Array<{ size: number; matches: number }> = [];
  rounds.push({ size, matches: qualifiers - size / 2 });
  for (let s = size / 2; s >= 2; s /= 2) rounds.push({ size: s, matches: s / 2 });
  return rounds;
}

function roundsOf(e: PlannerEvent): Round[] {
  const rounds: Round[] = [];
  if (e.pools !== false) {
    const sizes = e.poolSizes?.length ? e.poolSizes : splitPools(e.fencers, e.poolSize);
    if (sizes.length > 0) {
      rounds.push({
        kind: 'pool',
        tableauSize: null,
        parts: sizes.map((s, i) => ({
          id: `${e.id}:pool:${i + 1}`,
          index: i + 1,
          matches: (s * (s - 1)) / 2,
        })),
      });
    }
  }
  if (e.tableau !== false) {
    for (const r of tableauRounds(e.qualifiers ?? e.fencers)) {
      rounds.push({
        kind: 'tableau',
        tableauSize: r.size,
        parts: [{ id: `${e.id}:T${r.size}`, index: r.size, matches: r.matches }],
      });
    }
  }
  return rounds;
}

/** Durée d'un match plus le changement de piste (ms). */
function unitMs(e: PlannerEvent, kind: BlockKind, sources?: DurationSources): number {
  const phase: DurationPhase = kind === 'pool' ? 'pool' : 'tableau';
  const ref = referenceDuration(
    {
      weapon: weaponCode(e.weapon),
      gender: e.gender,
      category: e.category,
      phase,
      maxScore:
        (kind === 'pool' ? e.poolMaxScore : e.tableauMaxScore) ?? (kind === 'pool' ? 5 : 15),
    },
    sources
  );
  const est = adjustedDuration(ref, e.measuredMs?.[kind] ?? []);
  return est.medianMs + est.changeoverMs;
}

interface Busy {
  weapon: string;
  start: number;
  end: number;
  count: number;
}

/** Arbitres de l'arme occupés au plus fort sur [from, to). */
function peakLoad(busy: Busy[], weapon: string, from: number, to: number): number {
  const points: Array<[number, number]> = [];
  for (const b of busy) {
    if (b.weapon !== weapon || b.end <= from || b.start >= to) continue;
    points.push([Math.max(b.start, from), b.count], [b.end, -b.count]);
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let load = 0;
  let peak = 0;
  for (const [, d] of points) {
    load += d;
    peak = Math.max(peak, load);
  }
  return peak;
}

/** Premier début ≥ start où `need` arbitres de l'arme restent libres pendant `duration`. */
function refereeStart(
  busy: Busy[],
  weapon: string,
  cap: number | undefined,
  start: number,
  duration: number,
  need: number
): number {
  if (cap === undefined || need > cap) return start;
  let t = start;
  for (;;) {
    if (peakLoad(busy, weapon, t, t + duration) + need <= cap) return t;
    const next = busy
      .filter(b => b.weapon === weapon && b.end > t && b.start < t + duration)
      .reduce((m, b) => Math.min(m, b.end), Infinity);
    if (!Number.isFinite(next)) return t;
    t = next;
  }
}

/** Planning de la journée : fonction pure, déterministe. */
export function planDay(input: PlannerInput): DayPlan {
  const rest = input.restMs ?? DEFAULT_REST_MS;
  const now = input.now ?? -Infinity;
  const fixedById = new Map((input.fixed ?? []).map(f => [f.id, f]));
  const stripFree = new Map<number, number>(input.strips.map(s => [s.number, -Infinity]));
  const ruleOf = new Map(input.strips.map(s => [s.number, s.rule ?? DEFAULT_STRIP_RULE]));
  const busy: Busy[] = [];
  const blocks: PlannedBlock[] = [];
  const alerts: PlannerAlert[] = [];

  const events = [...input.events].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.scratchAt - b.scratchAt
  );
  const state = events.map(e => ({
    e,
    weapon: weaponCode(e.weapon),
    rounds: roundsOf(e),
    next: 0,
    readyAt: e.scratchAt,
  }));

  // Blocs figés d'abord : ils occupent leurs pistes et leurs arbitres.
  for (const st of state) {
    for (const r of st.rounds) {
      for (const p of r.parts) {
        const f = fixedById.get(p.id);
        if (!f) continue;
        for (const s of f.strips) stripFree.set(s, Math.max(stripFree.get(s) ?? -Infinity, f.end));
        busy.push({ weapon: st.weapon, start: f.start, end: f.end, count: f.strips.length });
      }
    }
  }

  const push = (
    st: (typeof state)[number],
    p: Round['parts'][number],
    kind: BlockKind,
    b: Omit<PlannedBlock, 'id' | 'eventId' | 'kind' | 'index' | 'matches'>
  ) => {
    blocks.push({ id: p.id, eventId: st.e.id, kind, index: p.index, matches: p.matches, ...b });
    if (!b.fixed)
      busy.push({ weapon: st.weapon, start: b.start, end: b.end, count: b.strips.length });
  };

  for (;;) {
    // Épreuve dont le prochain tour peut commencer le plus tôt (ordonnancement par liste).
    const ready = state
      .filter(st => st.next < st.rounds.length)
      .sort((a, b) => a.readyAt - b.readyAt || (a.e.order ?? 0) - (b.e.order ?? 0));
    const st = ready[0];
    if (!st) break;
    const round = st.rounds[st.next++];
    const cap = input.referees?.[st.weapon];
    const unit = unitMs(st.e, round.kind, input.durations);
    const earliest = Math.max(st.readyAt, now);
    const eligible = [...stripFree.keys()].filter(n =>
      stripAllows(ruleOf.get(n) ?? DEFAULT_STRIP_RULE, {
        competitionId: st.e.id,
        kind: round.kind === 'pool' ? 'pool' : 'match',
        tableauSize: round.tableauSize,
      })
    );
    let roundEnd = -Infinity;

    for (const p of round.parts) {
      const f = fixedById.get(p.id);
      if (f) {
        push(st, p, round.kind, { strips: [...f.strips], start: f.start, end: f.end, fixed: true });
        roundEnd = Math.max(roundEnd, f.end);
        continue;
      }
      if (eligible.length === 0) {
        alerts.push({ type: 'no_strip', blockId: p.id });
        continue;
      }
      const byFree = [...eligible].sort(
        (a, b) => (stripFree.get(a) ?? 0) - (stripFree.get(b) ?? 0) || a - b
      );
      // Poule : une piste. Tableau : de 1 à N pistes, celui qui finit le plus tôt.
      const maxStrips =
        round.kind === 'pool'
          ? 1
          : Math.max(1, Math.min(p.matches, byFree.length, st.e.tableauMaxStrips ?? Infinity));
      let best: { n: number; start: number; end: number } | null = null;
      let bestFree: { n: number; end: number } | null = null;
      for (let n = 1; n <= maxStrips; n++) {
        const base = Math.max(earliest, stripFree.get(byFree[n - 1]) ?? -Infinity);
        const duration = Math.ceil(p.matches / n) * unit;
        if (!bestFree || base + duration < bestFree.end) bestFree = { n, end: base + duration };
        if (cap !== undefined && n > Math.max(1, cap)) continue;
        const start = refereeStart(busy, st.weapon, cap, base, duration, n);
        if (!best || start + duration < best.end) best = { n, start, end: start + duration };
      }
      if (!best || !bestFree) continue;
      if (cap !== undefined && best.end > bestFree.end) {
        alerts.push({
          type: 'referees_short',
          weapon: st.weapon,
          blockId: p.id,
          needed: bestFree.n,
          available: Math.max(0, cap - peakLoad(busy, st.weapon, best.start, best.end)),
          from: Math.max(earliest, stripFree.get(byFree[bestFree.n - 1]) ?? -Infinity),
          to: best.end,
        });
      }
      const used = byFree.slice(0, best.n);
      for (const s of used) stripFree.set(s, best.end);
      push(st, p, round.kind, { strips: used, start: best.start, end: best.end, fixed: false });
      roundEnd = Math.max(roundEnd, best.end);
    }

    if (Number.isFinite(roundEnd)) st.readyAt = roundEnd + rest;
  }

  return { blocks, events: events.map(e => summarize(e.id, blocks)), alerts };
}

function summarize(eventId: string, all: PlannedBlock[]): PlannedEvent {
  const own = all.filter(b => b.eventId === eventId);
  const pools = own.filter(b => b.kind === 'pool');
  const tableau = own.filter(b => b.kind === 'tableau');
  const min = (l: PlannedBlock[]) => (l.length ? Math.min(...l.map(b => b.start)) : null);
  const max = (l: PlannedBlock[]) => (l.length ? Math.max(...l.map(b => b.end)) : null);
  return {
    eventId,
    start: min(own),
    poolsEnd: max(pools),
    tableauStart: min(tableau),
    finalAt: tableau.find(b => b.index === 2)?.start ?? null,
    end: max(own),
  };
}
