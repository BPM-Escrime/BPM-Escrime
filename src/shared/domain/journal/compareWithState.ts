/**
 * BellePoule Modern - Écarts entre le journal rejoué et l'état de l'épreuve (#1980, docs/adr/0017)
 * Compare les faits de projectCompetition à la projection tenue par le moteur (session_state)
 * et aux statuts des tables. Écarts en identifiants et nombres seulement (RGPD).
 * Licensed under GPL-3.0
 */
import { MatchStatus, type Match, type Pool } from '../../types';
import type { ConsolationBracket, TableauMatch } from '../tableau/tableauTypes';
import type { CompetitionFacts, MatchFact, PoolFact } from './projectCompetition';

export type DivergenceKind =
  | 'fencer_status'
  | 'pool_round'
  | 'pool_missing'
  | 'pool_fencers'
  | 'pool_matches'
  | 'pool_result'
  | 'pools_skipped'
  | 'tableau_missing'
  | 'tableau_unexpected'
  | 'tableau_slot'
  | 'bracket_result'
  | 'bracket_result_unknown'
  | 'rapieres';

export interface Divergence {
  kind: DivergenceKind;
  /** Tireur, poule, match ou tour concerné */
  id: string;
  expected?: unknown;
  actual?: unknown;
}

/** Projection du moteur utile à la comparaison (session_state) */
export interface CompetitionStateView {
  pools: Pool[];
  poolHistory: Pool[][];
  currentPoolRound: number;
  skipPoolPhase?: boolean;
  tableauMatches: TableauMatch[];
  consolationBrackets: ConsolationBracket[];
  rapieres?: { launchedWave?: number; wavesEnded?: boolean };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Écart entre un résultat du journal et un match de poule ; null : conforme */
function poolResultGap(
  fact: MatchFact | null,
  m: Match
): { expected: unknown; actual: unknown } | null {
  const played = m.status === MatchStatus.FINISHED;
  const actual = played
    ? {
        scoreA: m.scoreA?.value ?? null,
        scoreB: m.scoreB?.value ?? null,
        winnerId: (m.scoreA?.isVictory ? m.fencerA : m.fencerB)?.id ?? null,
      }
    : null;
  if (!fact) return played ? { expected: null, actual } : null;
  if (!played) return { expected: fact, actual: null };
  if (fact.scoreA !== undefined && fact.scoreA !== actual!.scoreA)
    return { expected: fact, actual };
  if (fact.scoreB !== undefined && fact.scoreB !== actual!.scoreB)
    return { expected: fact, actual };
  if (fact.winnerId !== undefined && fact.winnerId !== actual!.winnerId) {
    return { expected: fact, actual };
  }
  if (fact.loserId) {
    const lost = m.fencerA?.id === fact.loserId ? !m.scoreA?.isVictory : !m.scoreB?.isVictory;
    if (!lost) return { expected: fact, actual };
  }
  return null;
}

function comparePool(fact: PoolFact, pool: Pool | undefined, out: Divergence[]): void {
  if (!pool) {
    out.push({ kind: 'pool_missing', id: fact.poolId });
    return;
  }
  const fencerIds = pool.fencers.map(f => f.id);
  if (!same([...fact.fencerIds].sort(), [...fencerIds].sort())) {
    out.push({
      kind: 'pool_fencers',
      id: fact.poolId,
      expected: fact.fencerIds,
      actual: fencerIds,
    });
  }
  const pairs = (pool.matches ?? []).map(m => [m.id, m.fencerA?.id, m.fencerB?.id]);
  const expectedPairs = fact.matches.map(m => [m.matchId, m.fencerAId, m.fencerBId]);
  if (!same(expectedPairs, pairs)) {
    out.push({ kind: 'pool_matches', id: fact.poolId, expected: expectedPairs, actual: pairs });
  }
  for (const mf of fact.matches) {
    const m = pool.matches?.find(x => x.id === mf.matchId);
    if (!m) continue;
    const gap = poolResultGap(mf.result, m);
    if (gap) out.push({ kind: 'pool_result', id: mf.matchId, ...gap });
  }
}

function bracketResultGap(fact: MatchFact, m: TableauMatch): boolean {
  if (!m.winner) return true;
  if (fact.winnerId !== undefined && fact.winnerId !== m.winner.id) return true;
  if (fact.loserId && m.winner.id === fact.loserId) return true;
  if (fact.scoreA !== undefined && fact.scoreA !== m.scoreA) return true;
  if (fact.scoreB !== undefined && fact.scoreB !== m.scoreB) return true;
  return false;
}

/**
 * Écarts entre les faits du journal et l'état de l'épreuve. Seuls les faits rejouables sont
 * comparés ; un journal incomplet (épreuve antérieure) ne couvre que ce qu'il contient.
 */
export function compareWithState(
  facts: CompetitionFacts,
  state: CompetitionStateView,
  fencerStatus: Record<string, string | undefined>
): Divergence[] {
  const out: Divergence[] = [];

  for (const [fencerId, expected] of Object.entries(facts.fencerStatus)) {
    if (fencerStatus[fencerId] !== expected) {
      out.push({ kind: 'fencer_status', id: fencerId, expected, actual: fencerStatus[fencerId] });
    }
  }

  const last = facts.rounds[facts.rounds.length - 1];
  if (last) {
    const expectedRound = last.closed ? last.round + 1 : last.round;
    if (state.currentPoolRound !== expectedRound) {
      out.push({
        kind: 'pool_round',
        id: String(last.round),
        expected: expectedRound,
        actual: state.currentPoolRound,
      });
    }
  }
  for (const round of facts.rounds) {
    const pools =
      round.round === state.currentPoolRound ? state.pools : state.poolHistory[round.round - 1];
    for (const pf of round.pools) {
      comparePool(
        pf,
        (pools ?? []).find(p => p.id === pf.poolId),
        out
      );
    }
  }

  if (facts.skippedPoolsFencerIds && !state.skipPoolPhase) {
    out.push({ kind: 'pools_skipped', id: 'pools', expected: true, actual: false });
  }

  const brackets = state.consolationBrackets.flatMap(b => b.matches);
  const allBracket = [...state.tableauMatches, ...brackets];
  if (!facts.tableau) {
    if (facts.complete && state.tableauMatches.length > 0) {
      out.push({ kind: 'tableau_unexpected', id: 'tableau', actual: state.tableauMatches.length });
    }
  } else if (state.tableauMatches.length === 0) {
    out.push({ kind: 'tableau_missing', id: 'tableau', expected: facts.tableau.size });
  } else {
    for (const slot of facts.tableau.slots) {
      const m = state.tableauMatches.find(x => x.id === slot.matchId);
      const gap =
        !m ||
        m.round !== slot.round ||
        m.position !== slot.position ||
        !!m.isBye !== slot.isBye ||
        (slot.fencerAId !== null && m.fencerA?.id !== slot.fencerAId) ||
        (slot.fencerBId !== null && m.fencerB?.id !== slot.fencerBId);
      if (gap) {
        out.push({
          kind: 'tableau_slot',
          id: slot.matchId,
          expected: slot,
          actual: m
            ? {
                round: m.round,
                position: m.position,
                isBye: !!m.isBye,
                fencerAId: m.fencerA?.id ?? null,
                fencerBId: m.fencerB?.id ?? null,
              }
            : null,
        });
      }
    }
  }

  for (const [matchId, fact] of Object.entries(facts.bracketResults)) {
    const m = allBracket.find(x => x.id === matchId);
    if (!m || bracketResultGap(fact, m)) {
      out.push({
        kind: 'bracket_result',
        id: matchId,
        expected: fact,
        actual: m ? { scoreA: m.scoreA, scoreB: m.scoreB, winnerId: m.winner?.id ?? null } : null,
      });
    }
  }
  // Décision de l'état absente du journal (exemptions mises à part : elles se déduisent)
  if (facts.tableau) {
    for (const m of allBracket) {
      if (m.winner && !m.isBye && m.fencerA && m.fencerB && !(m.id in facts.bracketResults)) {
        out.push({ kind: 'bracket_result_unknown', id: m.id, actual: m.winner.id });
      }
    }
  }

  if (facts.rapieres) {
    const actual = {
      wave: state.rapieres?.launchedWave ?? 0,
      ended: !!state.rapieres?.wavesEnded,
    };
    if (!same(facts.rapieres, actual)) {
      out.push({ kind: 'rapieres', id: 'rapieres', expected: facts.rapieres, actual });
    }
  }
  return out;
}

/** Vue de comparaison lue dans l'état de session du moteur */
export function stateView(session: Record<string, unknown>): CompetitionStateView {
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    pools: list<Pool>(session.pools),
    poolHistory: list<Pool[]>(session.poolHistory),
    currentPoolRound: Number(session.currentPoolRound ?? 1),
    skipPoolPhase: session.skipPoolPhase === true,
    tableauMatches: list<TableauMatch>(session.tableauMatches),
    consolationBrackets: list<ConsolationBracket>(session.consolationBrackets),
    rapieres: session.rapieres as CompetitionStateView['rapieres'],
  };
}
