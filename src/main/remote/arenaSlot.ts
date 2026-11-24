/**
 * BPM - Escrime - Créneau d'une arène : poule ou matchs de tableau confiés à la piste (#1960)
 * Lecture seule, pour OPP2 `software/record` (écrans, feuilles de match) : ordre des tireurs
 * de la poule, matchs dans l'ordre de passage, résultats confirmés.
 * Licensed under GPL-3.0
 */
import type { ArenaMatch } from '../../shared/types/remote';
import { MatchStatus, type Fencer, type Match } from '../../shared/types';
import type { ArenaQueueContext } from './arenaQueue';
import type { SessionMatch, SessionScore } from './types';

/** Résultat confirmé : scores, vainqueur, tireur sorti (abandon, exclusion) */
export interface ArenaSlotResult {
  scoreA: number;
  scoreB: number;
  winner: 'A' | 'B' | null;
  outA?: 'abandon' | 'exclusion';
  outB?: 'abandon' | 'exclusion';
}

export interface ArenaSlotBout {
  match: ArenaMatch;
  result: ArenaSlotResult | null;
}

export interface ArenaSlot {
  /** Poule de la piste ; absent : matchs de tableau */
  poolId?: string;
  participants: Fencer[];
  bouts: ArenaSlotBout[];
}

type SlotContext = Pick<
  ArenaQueueContext,
  | 'arenas'
  | 'session'
  | 'sessionMatches'
  | 'sessionMatchScores'
  | 'isInActiveWave'
  | 'applySmartMatchOrder'
  | 'poolFencersCache'
  | 'arenaMatchQueue'
  | 'arenaHomePoolId'
>;

const valueOf = (s: SessionScore): number =>
  typeof s === 'number' ? s : typeof s?.value === 'number' ? s.value : 0;

const outOf = (s: SessionScore): 'abandon' | 'exclusion' | undefined => {
  if (!s || typeof s !== 'object') return undefined;
  if (s.isExclusion) return 'exclusion';
  return s.isAbstention || s.isForfait ? 'abandon' : undefined;
};

/** Résultat d'un match de session terminé ; null sinon */
function sessionResult(
  m: SessionMatch,
  scores: { scoreA: SessionScore; scoreB: SessionScore; status: string } | undefined
): ArenaSlotResult | null {
  const status = scores?.status ?? m.status;
  if (status !== MatchStatus.FINISHED) return null;
  const a = scores?.scoreA ?? m.scoreA;
  const b = scores?.scoreB ?? m.scoreB;
  const scoreA = valueOf(a);
  const scoreB = valueOf(b);
  const vA = typeof a === 'object' && a?.isVictory === true;
  const vB = typeof b === 'object' && b?.isVictory === true;
  const winner =
    vA && !vB ? 'A' : vB && !vA ? 'B' : scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : null;
  const r: ArenaSlotResult = { scoreA, scoreB, winner };
  const oA = outOf(a);
  const oB = outOf(b);
  if (oA) r.outA = oA;
  if (oB) r.outB = oB;
  return r;
}

/** Match d'arène terminé (tablette ou appareil) ; null s'il ne l'est pas */
function arenaResult(match: ArenaMatch, arenaStatus: string): ArenaSlotResult | null {
  if (match.status !== 'finished' && arenaStatus !== 'finished') return null;
  const { scoreA, scoreB } = match;
  const forced = match.deviceEnd?.winner;
  const winner = forced ?? (scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : null);
  const r: ArenaSlotResult = { scoreA, scoreB, winner };
  const reason = match.deviceEnd?.reason;
  if (forced && (reason === 'abandon' || reason === 'exclusion')) {
    if (forced === 'A') r.outB = reason;
    else r.outA = reason;
  }
  return r;
}

function toArenaMatch(m: SessionMatch, poolId: string): ArenaMatch {
  return {
    id: m.id,
    poolId,
    fencerA: m.fencerA!,
    fencerB: m.fencerB!,
    scoreA: valueOf(m.scoreA),
    scoreB: valueOf(m.scoreB),
    status: 'pending',
    startTime: null,
    endTime: null,
    ...(m.number !== undefined ? { number: m.number } : {}),
  } as ArenaMatch;
}

/**
 * Créneau de l'arène : poule de la piste (tous ses matchs, vague active) ou, en tableau, match
 * courant et file d'attente. Null hors séance ou sans match.
 */
export function getArenaSlot(ctx: SlotContext, arenaId: string): ArenaSlot | null {
  const arena = ctx.arenas.get(arenaId);
  if (!arena || !ctx.session) return null;
  const homePoolId = ctx.arenaHomePoolId(arena);
  const current = arena.currentMatch;

  if (homePoolId) {
    const matches = ctx.sessionMatches.filter(m => {
      const id = m.poolId || m.pool?.id || `pool-${m.poolNumber || m.number}`;
      return id === homePoolId && m.fencerA && m.fencerB && ctx.isInActiveWave(m);
    });
    if (matches.length === 0) return null;
    const ordered = ctx.applySmartMatchOrder(
      matches as unknown as Match[]
    ) as unknown as SessionMatch[];
    const bouts = ordered.map(m => {
      const live = current?.id === m.id ? current : null;
      const result = live
        ? arenaResult(live, arena.status)
        : sessionResult(m, ctx.sessionMatchScores.get(m.id));
      return { match: live ?? toArenaMatch(m, homePoolId), result };
    });
    let participants = ctx.poolFencersCache.get(homePoolId) ?? [];
    if (participants.length === 0) {
      const seen = new Map<string, Fencer>();
      for (const m of matches)
        for (const f of [m.fencerA, m.fencerB]) if (f && !seen.has(f.id)) seen.set(f.id, f);
      participants = [...seen.values()];
    }
    return { poolId: homePoolId, participants, bouts };
  }

  const queue = ctx.arenaMatchQueue.get(arenaId) ?? [];
  const list = current?.isTableau || (current && !current.poolId) ? [current, ...queue] : queue;
  const bouts = list
    .filter((m, i) => list.findIndex(o => o.id === m.id) === i)
    .map(m => ({ match: m, result: m === current ? arenaResult(m, arena.status) : null }));
  return bouts.length ? { participants: [], bouts } : null;
}
