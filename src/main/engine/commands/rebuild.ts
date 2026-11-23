/**
 * BPM - Escrime - Reconstruction de l'état d'une épreuve (#1980, docs/adr/0017, étape 5)
 * rebuildCompetitionState : commande de maintenance. Rejoue le journal (projectCompetition),
 * compare à la projection du moteur (compareWithState), puis aligne l'état sur le journal pour
 * les faits rejouables : statuts des tireurs, résultats des matchs de poule du tour courant,
 * décisions du tableau et des tableaux de classement, vagues des rapières. Les dérivés touchés
 * (classements, propagation, classement final) sont recalculés.
 * Pas d'événement : la commande ne crée aucun fait, elle remet l'état d'accord avec le journal.
 * Les écarts de structure (poules, tours, placement du tableau) sont rendus sans être corrigés.
 * Licensed under GPL-3.0
 */
import {
  MatchStatus,
  type Competition,
  type FencerStatus,
  type Pool,
  type PoolRanking,
} from '../../../shared/types';
import { importedRanking } from '../../../shared/domain/ranking/splitGroups';
import {
  applyScoreToPool,
  buildMatchScores,
  computeOverallRankingAllRoundsFor,
  computePoolRankingFor,
} from '../../../shared/utils/poolOrchestration';
import {
  isBracketComplete,
  propagateWinners,
  type ConsolationBracket,
  type TableauMatch,
} from '../../../shared/domain/tableau/tableauTypes';
import { isPoolComplete } from '../../../shared/domain/pools/poolCompletion';
import {
  projectCompetition,
  type CompetitionFacts,
  type MatchFact,
} from '../../../shared/domain/journal/projectCompetition';
import {
  compareWithState,
  stateView,
  type Divergence,
} from '../../../shared/domain/journal/compareWithState';
import type { StoredJournalEvent } from '../../../database/repos/eventLogRepo';
import type { CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { readSession } from './sessionView';
import {
  allTableauxDone,
  cloneSlot,
  slotPatch,
  tableauSlots,
  type TableauSlot,
} from './groupTableaux';
import {
  PHASE,
  assertScoreSupported,
  emitSession,
  isLaser,
  persistTableau,
  sessionPoolHistory,
  sessionPools,
  settleBracket,
  writeSession,
} from './sport';

const PAGE = 1000;

/** Journal complet de l'épreuve, par pages */
export function readJournal(ctx: CommandContext, competitionId: string): StoredJournalEvent[] {
  const all: StoredJournalEvent[] = [];
  for (;;) {
    const page = ctx.db.eventLog.getSince(competitionId, all[all.length - 1]?.revision ?? 0, PAGE);
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

function statusesOf(ctx: CommandContext, competitionId: string): Record<string, string> {
  return Object.fromEntries(
    ctx.db.getFencersByCompetition(competitionId).map(f => [f.id, f.status as string])
  );
}

/** Journal rejoué et écarts avec l'état */
function diagnose(ctx: CommandContext, competitionId: string) {
  const facts = projectCompetition(readJournal(ctx, competitionId));
  const session = readSession(ctx, competitionId);
  const settings = ctx.db.getCompetition(competitionId)?.settings ?? {};
  const divergences = compareWithState(
    facts,
    stateView(session, settings),
    statusesOf(ctx, competitionId)
  );
  return { facts, session, divergences };
}

interface PoolRepair {
  pools: Pool[];
  /** Matchs à réécrire dans la table matches */
  matchIds: Set<string>;
}

/** Résultat d'un match de poule réécrit d'après le journal ; false : pas assez d'information */
function repairPoolMatch(
  comp: Competition,
  repair: PoolRepair,
  matchId: string,
  fact: MatchFact | null
): boolean {
  const poolIndex = repair.pools.findIndex(p => p.matches.some(m => m.id === matchId));
  if (poolIndex < 0) return false;
  const pool = repair.pools[poolIndex];
  const matchIndex = pool.matches.findIndex(m => m.id === matchId);
  const match = pool.matches[matchIndex];
  let next: Pool;
  if (!fact) {
    next = {
      ...pool,
      matches: pool.matches.map((m, i) =>
        i === matchIndex ? { ...m, scoreA: null, scoreB: null, status: MatchStatus.NOT_STARTED } : m
      ),
    };
    next.ranking = computePoolRankingFor(next, isLaser(comp));
  } else {
    // Abandon, forfait, exclusion : le journal ne garde que le perdant, pas les touches
    if (fact.scoreA === undefined || fact.scoreB === undefined) return false;
    const winner =
      fact.winnerId == null
        ? undefined
        : fact.winnerId === match.fencerA?.id
          ? ('A' as const)
          : ('B' as const);
    // Vainqueur explicite seulement à égalité (priorité, victoire au tie-break)
    const scores = buildMatchScores(
      fact.scoreA,
      fact.scoreB,
      fact.scoreA === fact.scoreB ? winner : undefined
    );
    next = applyScoreToPool(pool, matchIndex, scores, isLaser(comp));
  }
  next = { ...next, isComplete: isPoolComplete(next) };
  repair.pools = repair.pools.map((p, i) => (i === poolIndex ? next : p));
  repair.matchIds.add(matchId);
  return true;
}

/** Décision du tableau réécrite d'après le journal ; false : match ou vainqueur inconnu */
function repairBracketMatch(
  main: TableauMatch[],
  brackets: ConsolationBracket[],
  matchId: string,
  fact: MatchFact
): 'main' | 'consolation' | null {
  const bracket = brackets.find(b => b.matches.some(m => m.id === matchId));
  const m = (bracket?.matches ?? main).find(x => x.id === matchId);
  if (!m?.fencerA || !m.fencerB) return null;
  const winnerId =
    fact.winnerId ??
    (fact.loserId ? (fact.loserId === m.fencerA.id ? m.fencerB.id : m.fencerA.id) : null);
  const winner = [m.fencerA, m.fencerB].find(f => f.id === winnerId);
  if (!winner) return null;
  Object.assign(m, {
    winner,
    ...(fact.scoreA !== undefined ? { scoreA: fact.scoreA } : {}),
    ...(fact.scoreB !== undefined ? { scoreB: fact.scoreB } : {}),
  });
  if (bracket) {
    propagateWinners(bracket.matches, bracket.size);
    bracket.isComplete = isBracketComplete(bracket.matches);
    return 'consolation';
  }
  return 'main';
}

const brief = (d: Divergence) => ({ kind: d.kind, id: d.id });

/**
 * Vérifie l'état d'une épreuve contre son journal et, hors dryRun, l'aligne sur le journal
 * pour les faits rejouables. Rend les écarts trouvés, corrigés et restants.
 */
export function rebuildCompetitionState(
  ctx: CommandContext,
  input: { competitionId: string; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  assertScoreSupported(comp);
  const { facts, session, divergences } = diagnose(ctx, comp.id);
  const report = (remaining: Divergence[], repaired: Divergence[], dryRun: boolean) => ({
    dryRun,
    complete: facts.complete,
    revision: facts.revision,
    divergences,
    repaired: repaired.map(brief),
    remaining,
  });
  if (input.dryRun || divergences.length === 0) return report(divergences, [], !!input.dryRun);

  const plan = planRepair(comp, session, facts, divergences);
  if (plan.repaired.length === 0) return report(divergences, [], false);

  ctx.db.transaction(() => {
    for (const [fencerId, status] of plan.statuses)
      ctx.db.updateFencer(fencerId, { status: status as FencerStatus });
    const patch: Record<string, unknown> = {};
    if (plan.pools) {
      const all = plan.pools.pools.flatMap(p => p.matches);
      for (const id of plan.pools.matchIds) {
        const m = all.find(x => x.id === id)!;
        ctx.db.updateMatch(id, { scoreA: m.scoreA, scoreB: m.scoreB, status: m.status });
      }
      for (const p of plan.pools.pools) {
        if (p.matches.some(m => plan.pools!.matchIds.has(m.id))) ctx.db.updatePool(p);
      }
      patch.pools = plan.pools.pools;
      patch.overallRanking = computeOverallRankingAllRoundsFor(
        plan.pools.pools,
        sessionPoolHistory(session),
        isLaser(comp)
      );
    }
    // Tableaux réparés : unique, ou ceux des groupes (docs/adr/0024)
    let done = false;
    for (const t of plan.tableaux) {
      persistTableau(ctx, comp, t.slot.matches);
      Object.assign(
        patch,
        slotPatch({ ...session, ...patch }, t.slot, {
          tableauMatches: t.slot.matches,
          consolationBrackets: t.brackets,
          finalResults: t.finalResults,
        })
      );
      done = allTableauxDone(comp, session, patch, t.done);
    }
    if (plan.tableaux.length > 0) {
      if (done) patch.currentPhase = PHASE.results;
      else if (session.currentPhase === PHASE.results) patch.currentPhase = PHASE.tableau;
    }
    if (plan.rapieres) {
      patch.rapieres = { ...(session.rapieres as object), ...plan.rapieres };
    }
    // Tableaux séparés (docs/adr/0024, lot A3) : groupes extraits, classement importé
    if (plan.splitOff) {
      const splitOffCompetitionIds = { ...comp.settings?.splitOffCompetitionIds, ...plan.splitOff };
      ctx.db.updateCompetition(comp.id, {
        settings: { ...comp.settings, splitOffCompetitionIds } as Competition['settings'],
      });
    }
    if (plan.importRanking && facts.importedRanking) {
      patch.overallRanking = rebuildImportedRanking(ctx, comp.id, facts.importedRanking);
    }
    if (Object.keys(patch).length > 0) writeSession(ctx, comp.id, patch);
  });
  emitSession(ctx, comp.id);
  if (plan.statuses.size > 0) ctx.emitChange?.({ scope: 'fencers', competitionIds: [comp.id] });
  if (plan.splitOff) ctx.emitChange?.({ scope: 'competitions', competitionIds: [comp.id] });
  return report(diagnose(ctx, comp.id).divergences, plan.repaired, false);
}

/**
 * Classement importé d'une épreuve séparée, d'après le journal : statistiques de poule relues
 * dans l'épreuve d'origine, rangs seuls si elle a été supprimée (docs/adr/0024)
 */
function rebuildImportedRanking(
  ctx: CommandContext,
  competitionId: string,
  imported: NonNullable<CompetitionFacts['importedRanking']>
) {
  const fencers = new Map(ctx.db.getFencersByCompetition(competitionId).map(f => [f.id, f]));
  const source = ctx.db.getCompetition(imported.sourceCompetitionId)
    ? readSession(ctx, imported.sourceCompetitionId).overallRanking
    : null;
  return importedRanking(
    imported.ranking,
    fencers,
    Array.isArray(source) ? (source as PoolRanking[]) : null
  );
}

/** Corrections applicables, sans écriture */
function planRepair(
  comp: Competition,
  session: Record<string, unknown>,
  facts: CompetitionFacts,
  divergences: Divergence[]
) {
  const repaired: Divergence[] = [];
  const statuses = new Map<string, string>();
  const current = facts.rounds.find(r => r.round === Number(session.currentPoolRound ?? 1));
  const poolFacts = new Map(
    (current?.pools ?? []).flatMap(p => p.matches.map(m => [m.matchId, m.result] as const))
  );
  let pools: PoolRepair | null = null;
  const slots = tableauSlots(comp, session).map(cloneSlot);
  const mainChanged = new Set<TableauSlot>();
  const bracketChanged = new Set<TableauSlot>();
  let rapieres: { launchedWave: number; wavesEnded: boolean } | null = null;
  let splitOff: Record<string, string> | null = null;
  let importRanking = false;

  for (const d of divergences) {
    switch (d.kind) {
      case 'fencer_status':
        statuses.set(d.id, String(d.expected));
        repaired.push(d);
        break;
      case 'pool_result': {
        if (!poolFacts.has(d.id)) break; // tour archivé : structure à reprendre à part
        pools ??= { pools: sessionPools(session), matchIds: new Set() };
        if (repairPoolMatch(comp, pools, d.id, poolFacts.get(d.id) ?? null)) repaired.push(d);
        break;
      }
      case 'bracket_result': {
        const slot = slots.find(
          s =>
            s.matches.some(m => m.id === d.id) ||
            s.brackets.some(b => b.matches.some(m => m.id === d.id))
        );
        if (!slot) break;
        const where = repairBracketMatch(
          slot.matches,
          slot.brackets,
          d.id,
          facts.bracketResults[d.id]
        );
        if (where === 'main') mainChanged.add(slot);
        if (where === 'consolation') bracketChanged.add(slot);
        if (where) repaired.push(d);
        break;
      }
      case 'rapieres':
        if (facts.rapieres) {
          rapieres = { launchedWave: facts.rapieres.wave, wavesEnded: facts.rapieres.ended };
          repaired.push(d);
        }
        break;
      case 'split_off':
        if (facts.splitOffGroups[d.id]) {
          splitOff ??= {};
          splitOff[d.id] = facts.splitOffGroups[d.id].targetCompetitionId;
          repaired.push(d);
        }
        break;
      case 'imported_ranking':
        importRanking = true;
        repaired.push(d);
        break;
      default:
        break;
    }
  }
  const tableaux = slots
    .filter(s => mainChanged.has(s) || bracketChanged.has(s))
    .map(slot => ({
      slot,
      ...settleBracket(comp, session, slot.matches, slot.brackets, mainChanged.has(slot), slot),
    }));
  return { repaired, statuses, pools, tableaux, rapieres, splitOff, importRanking };
}
