/**
 * BPM - Escrime - Scission de la formule en compétitions filles (#2013 étape E2, docs/adr/0039)
 * splitCompetition : quand la phase qui précède la scission est close (tour de poules terminé,
 * tableau arrêté clos), son classement est réparti entre les branches (planSplit) ; chaque
 * branche devient une compétition fille avec sa formule, ses tireurs copiés et leur rang dans
 * la branche. L'épreuve d'origine garde les autres tireurs et note la scission
 * (`splitOffCompetitionIds`, `splitHistory`).
 *
 * Transaction : runCommand (docs/adr/0006) ouvre UNE transaction SQLite qui couvre toutes les
 * épreuves ; un refus ou une erreur au milieu annule tout. Journal, sans nouvel événement :
 * SplitRankingImported (premier fait de chaque fille), GroupSplitOff (épreuve d'origine,
 * `group` = libellé de la branche), même commandId (docs/adr/0007).
 *
 * Compétition couplée (scission par sexe dont toutes les branches restent dans l'épreuve, étape
 * E3) : rien à créer, refus ; elle se joue en tableaux séparés (ADR-0024). Sinon, toutes les
 * branches partent en compétitions filles (amendement du 2026-11-26 : pas de mélange).
 * Licensed under GPL-3.0
 */
import {
  FencerStatus,
  type Competition,
  type CompetitionSettings,
  type Fencer,
  type PoolRanking,
  type TiesAtBar,
} from '../../../shared/types';
import {
  coupledFormula,
  flatSettingsOf,
  isCoupledSplit,
  type FormulaV2,
  type SplitBranch,
  type SplitPhase,
} from '../../../shared/domain/formula/formulaV2';
import { formulaV2Issues } from '../../../shared/domain/formula/formulaV2Operations';
import { remarksMessage } from '../../../shared/domain/formula/formulaRemarks';
import {
  planSplit,
  splitHistoryOf,
  type SplitAssignment,
  type SplitHistoryEntry,
} from '../../../shared/domain/formula/splitPlan';
import {
  allTableauMatches,
  buildSplitCompetitionData,
  remapRankingFencers,
  splitOffSessionState,
  toSplitFencerData,
} from '../../../shared/domain/ranking/splitGroups';
import { computeEffectiveTableauRanking } from '../../../shared/domain/ranking/tableauRanking';
import { rankingAfterStage, tableauStagesOf } from '../../../shared/domain/tableau/tableauStage';
import { isPoolRoundFinished, isWavesOrder, poolWavesOf } from '../../../shared/domain/pools/waves';
import { isTableauEligible } from '../../../shared/domain/fencers/fencerStatus';
import { splitDaughterCategory } from '../../../shared/domain/fencers/fencerCategory';
import { computeOverallRankingAllRoundsFor } from '../../../shared/utils/poolOrchestration';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { assertTies } from './ties';
import { EVENT, recordEvents } from './eventLog';
import { readSession } from './sessionView';
import {
  PHASE,
  assertScoreSupported,
  isLaser,
  sessionPoolHistory,
  sessionPools,
  writeSession,
} from './sport';

export interface SplitCompetitionInput {
  competitionId: string;
  assignments?: SplitAssignment[];
  /** Ex aequo à une borne pour cette scission (docs/adr/0040), prime sur la formule */
  ties?: TiesAtBar;
  dryRun?: boolean;
}

const fencerRef = (f: Pick<Fencer, 'id' | 'lastName' | 'firstName'>) => ({
  id: f.id,
  lastName: f.lastName,
  firstName: f.firstName,
});

/** Scission en dernière phase de la formule enregistrée ; refus sinon */
function storedSplit(comp: Competition): { formula: FormulaV2; split: SplitPhase } {
  const stored = comp.settings?.formula;
  // Formule enregistrée avant E3 (ancienne compétition couplée) relue comme la scission
  const formula = stored ? coupledFormula(stored) : undefined;
  const split = formula?.phases[formula.phases.length - 1];
  const coupled =
    split?.kind === 'split' ? isCoupledSplit(split) : !!comp.settings?.postPoolSplitCriteria;
  if (coupled) {
    throw new CommandError(
      'invalid_settings',
      'Toutes les branches restent dans l’épreuve : tableaux séparés, aucune compétition fille à créer'
    );
  }
  if (!formula || split?.kind !== 'split') {
    throw new CommandError('invalid_settings', 'Formule sans scission en dernière phase');
  }
  const issues = formulaV2Issues(formula, { weapon: comp.weapon, isTeamEvent: !!comp.isTeamEvent });
  if (issues.length) {
    throw new CommandError('invalid_settings', remarksMessage(issues));
  }
  return { formula, split };
}

/**
 * Classement de la phase qui précède la scission (ADR-0039) : tour de poules terminé,
 * qualification du tour appliquée ; ou restants du tableau arrêté clos, par rang d'entrée
 * (Q5, ADR-0037). Seuls les tireurs actifs, relus en base (sexe, catégorie à jour).
 */
function entryRanking(
  ctx: CommandContext,
  comp: Competition,
  formula: FormulaV2,
  session: Record<string, unknown>
): PoolRanking[] {
  const prev = formula.phases[formula.phases.length - 2];
  const history = sessionPoolHistory(session);
  const drawn = allTableauMatches(session);
  let ranking: PoolRanking[];
  if (prev.kind === 'pool') {
    const pools = sessionPools(session);
    const rounds = formula.phases.filter(p => p.kind === 'pool').length;
    if (
      !isPoolRoundFinished(
        pools,
        poolWavesOf(session as Parameters<typeof poolWavesOf>[0]),
        isWavesOrder(prev.boutOrder)
      ) ||
      history.length + 1 < rounds ||
      drawn.length > 0
    ) {
      throw new CommandError(
        'pools_not_complete',
        'Toutes les poules du dernier tour doivent être terminées avant la scission'
      );
    }
    // Classement du tour (tous tours, comme l'écran), qualification du tour appliquée
    const overall = computeOverallRankingAllRoundsFor(pools, history, isLaser(comp));
    const q = prev.qualification;
    ranking = computeEffectiveTableauRanking(overall, pools, {
      poolWinnersOnly: q.mode === 'pool_winner',
      customFormula: undefined,
      tableauQualification: q.mode === 'pool_winner' || q.mode === 'all' ? undefined : q,
      postPoolSplitCriteria: undefined,
      activeSplitGroup: null,
      splitOffCompetitionIds: undefined,
    });
  } else {
    const stage = tableauStagesOf(session.stageHistory).pop();
    if (!stage) {
      throw new CommandError(
        'tableau_stage_not_complete',
        'Le tableau arrêté doit être clos (closeTableauStage) avant la scission'
      );
    }
    // Lignes : tours joués, dernier tour resté courant (closeTableauStage, ADR-0039)
    const lines = computeOverallRankingAllRoundsFor(sessionPools(session), history, isLaser(comp));
    ranking = rankingAfterStage(lines, stage);
  }
  const fencers = new Map(ctx.db.getFencersByCompetition(comp.id).map(f => [f.id, f]));
  return ranking
    .filter(r => {
      const f = fencers.get(r.fencer.id);
      return !!f && isTableauEligible({ status: f.status });
    })
    .map(r => ({ ...r, fencer: { ...fencers.get(r.fencer.id)!, poolStats: r.fencer.poolStats } }));
}

/** Affectations manuelles : branche connue, tireur du classement d'entrée */
function checkAssignments(
  split: SplitPhase,
  ranking: PoolRanking[],
  assignments: SplitAssignment[] | undefined
): void {
  if (!assignments?.length) return;
  const labels = new Set(split.branches.map(b => b.label));
  const ids = new Set(ranking.map(r => r.fencer.id));
  for (const a of assignments) {
    if (!labels.has(a.branch)) {
      throw new CommandError(
        'invalid_input',
        `Branche inconnue : ${a.branch} (branches : ${[...labels].join(', ')})`
      );
    }
    if (!ids.has(a.fencerId)) {
      throw new CommandError(
        'fencer_not_found',
        `Tireur absent du classement d’entrée de la scission : ${a.fencerId}`
      );
    }
  }
}

/** Formule d'une fille : phases de la branche, réglages généraux de l'origine */
function branchFormula(formula: FormulaV2, branch: SplitBranch): FormulaV2 {
  const { postPoolSplitCriteria: _split, ...general } = formula.general;
  return { version: 2, phases: branch.phases, general };
}

/** État de départ d'une fille, d'après la première phase de sa branche */
function daughterSession(branch: SplitBranch, ranking: PoolRanking[]): Record<string, unknown> {
  // Tableau d'abord : classement d'entrée importé, phase Classement (comme splitOffGroup)
  if (branch.phases[0]?.kind === 'tableau') return splitOffSessionState(ranking);
  // Poules d'abord : appel, tireurs pointés, classement d'entrée = rang dans la branche
  return {
    currentPhase: PHASE.checkin,
    overallRanking: ranking,
    pools: [],
    poolHistory: [],
    tableauMatches: [],
    finalResults: [],
    consolationBrackets: [],
    currentPoolRound: 1,
    skipPoolPhase: false,
    poolsLaunched: false,
  };
}

export function splitCompetition(
  ctx: CommandContext,
  input: SplitCompetitionInput,
  /** Heure injectée (date de repli des filles, docs/adr/0002) */
  now: Date = new Date()
) {
  const source = getCompetitionOrThrow(ctx, input.competitionId);
  assertScoreSupported(source);
  const { formula, split } = storedSplit(source);
  const session = readSession(ctx, source.id);
  const done = source.settings?.splitOffCompetitionIds ?? {};
  if (splitHistoryOf(session.splitHistory).length > 0 || split.branches.some(b => done[b.label])) {
    throw new CommandError('split_group_not_found', 'Épreuve déjà scindée en compétitions filles');
  }
  const ranking = entryRanking(ctx, source, formula, session);
  checkAssignments(split, ranking, input.assignments);
  // Tirage au sort des ex aequo (ADR-0040) : hasard de la coupe, figé par GroupSplitOff
  const plan = planSplit(ranking, split, input.assignments, assertTies(input.ties), Math.random);
  const byId = new Map(ranking.map(r => [r.fencer.id, r.fencer]));
  const missing = plan.missing.map(id => fencerRef(byId.get(id)!));
  const report = (ids: Array<string | null>) => ({
    dryRun: !!input.dryRun,
    branches: plan.branches.map((b, i) => ({
      label: b.label,
      competitionId: ids[i],
      fencers: b.rows.map(r => ({ ...fencerRef(r.fencer), rank: r.rank })),
      // Toutes les branches partent : la compétition couplée est refusée plus haut
      stayInCompetition: false,
    })),
    missing,
    tiedAtBar: plan.tiedAtBar,
    // Classement d'entrée, dans l'ordre (répartition manuelle à l'écran, étape E3)
    entrants: [...ranking]
      .sort((a, b) => a.rank - b.rank)
      .map(r => ({
        ...fencerRef(r.fencer),
        rank: r.rank,
        gender: r.fencer.gender ?? null,
        club: r.fencer.club ?? null,
        birthDate: r.fencer.birthDate ? new Date(r.fencer.birthDate).toISOString() : null,
        category: r.fencer.category ?? null,
      })),
  });
  if (input.dryRun) return report(plan.branches.map(() => null));

  if (missing.length > 0) {
    const names = missing
      .slice(0, 10)
      .map(f => `${f.lastName} ${f.firstName}`)
      .join(', ');
    throw new CommandError(
      'split_value_missing',
      `${missing.length} tireur(s) sans valeur pour le critère « ${split.criterion} » : ${names}${missing.length > 10 ? '…' : ''}`
    );
  }
  const empty = plan.branches.find(b => b.rows.length === 0);
  if (empty) {
    throw new CommandError('not_enough_fencers', `Branche « ${empty.label} » sans tireur`);
  }

  // Filles : épreuve, tireurs copiés, état de départ, classement importé (transaction de runCommand)
  const history: SplitHistoryEntry[] = [];
  const created: string[] = [];
  const ids: Array<string | null> = plan.branches.map(() => null);
  plan.branches.forEach((planned, i) => {
    const branch = split.branches[i];
    const bf = branchFormula(formula, branch);
    const data = buildSplitCompetitionData(
      source,
      `${source.title} – ${branch.label}`,
      branch.gender ?? source.gender,
      now
    );
    const daughter = ctx.db.createCompetition({
      ...data,
      category: splitDaughterCategory(branch.categories, source.category),
      settings: {
        ...data.settings,
        ...flatSettingsOf(bf, source.weapon),
        formula: bf,
        splitFromCompetitionId: source.id,
      } as CompetitionSettings,
    } as Competition);
    const poolsFirst = branch.phases[0]?.kind === 'pool';
    const copies = new Map<string, Fencer>();
    for (const r of planned.rows) {
      const copy = toSplitFencerData(r);
      // Poules d'abord : tireurs pointés pour le tirage (generatePools)
      if (poolsFirst) copy.status = FencerStatus.CHECKED_IN;
      copies.set(r.fencer.id, ctx.db.addFencer(daughter.id, copy));
    }
    writeSession(
      ctx,
      daughter.id,
      daughterSession(branch, remapRankingFencers(planned.rows, copies))
    );
    recordEvents(ctx, daughter.id, [
      {
        type: EVENT.splitRankingImported,
        payload: {
          sourceCompetitionId: source.id,
          group: branch.label,
          ranking: planned.rows.map(r => ({
            fencerId: copies.get(r.fencer.id)!.id,
            sourceFencerId: r.fencer.id,
            rank: r.rank,
          })),
        },
      },
    ]);
    history.push({
      label: branch.label,
      competitionId: daughter.id,
      fencerIds: planned.rows.map(r => r.fencer.id),
    });
    created.push(daughter.id);
    ids[i] = daughter.id;
  });

  // Épreuve d'origine : filles notées, historique de la scission, un GroupSplitOff par branche
  const splitOffCompetitionIds = {
    ...source.settings?.splitOffCompetitionIds,
    ...Object.fromEntries(history.map(h => [h.label, h.competitionId])),
  };
  ctx.db.updateCompetition(source.id, {
    settings: { ...source.settings, splitOffCompetitionIds } as CompetitionSettings,
  });
  writeSession(ctx, source.id, { splitHistory: history });
  recordEvents(
    ctx,
    source.id,
    history.map(h => ({
      type: EVENT.groupSplitOff,
      payload: { group: h.label, targetCompetitionId: h.competitionId, fencerIds: h.fencerIds },
    }))
  );

  ctx.emitChange?.({ scope: 'competitions', competitionIds: [source.id, ...created] });
  ctx.emitChange?.({ scope: 'fencers', competitionIds: created });
  ctx.emitChange?.({ scope: 'session', competitionIds: [source.id, ...created] });
  ctx.remote?.settingsChanged(source.id, { splitOffCompetitionIds });
  return report(ids);
}
