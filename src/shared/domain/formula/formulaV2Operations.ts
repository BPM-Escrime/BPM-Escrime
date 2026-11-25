/**
 * BPM - Escrime - Opérations de frise sur la formule v2 (#2013 étape C, ADR-0034)
 * Même grammaire que la frise de l'écran (ADR-0032) et même forme d'opérations
 * qu'updateCompetitionFormula (ADR-0033), sur un seul modèle pour toutes les armes. `setPhase`
 * règle **chaque tour** séparément. Les anciens noms de réglages (poolMaxScore, tableMaxScore,
 * qualifiers, advancementRule…) restent acceptés. Domaine pur : identifiants injectés.
 * Licensed under GPL-3.0
 */

import {
  AdvancementRule,
  Category,
  CompetitionSettings,
  CustomScoringConfig,
  QuestPhaseConfig,
  Weapon,
} from '../../types';
import { getCoherenceIssues, CoherenceIssue } from '../../utils/formulaCoherence';
import { MAX_POOL_ROUNDS } from './formulaDraft';
import type { FriezeBrick, FriezePhase } from './formulaFrieze';
import { FormulaOperation, FormulaOperationError } from './formulaOperations';
import {
  flatSettingsOf,
  formulaOf,
  type FormulaPhaseV2,
  type FormulaV2,
  type PoolRoundPhase,
  type QuestPhase,
  type TableauPhase,
} from './formulaV2';
import { validateFormulaSettings } from './validateFormulaSettings';

const isPool = (p: FormulaPhaseV2): p is PoolRoundPhase => p.kind === 'pool';
const isQuest = (p: FormulaPhaseV2): p is QuestPhase => p.kind === 'quest';
const isTableau = (p: FormulaPhaseV2): p is TableauPhase => p.kind === 'tableau';

/** Phases de la frise (clés stables : pool-0, pool-1…, quest, tableau) */
export function friezeOfV2(f: FormulaV2): FriezePhase[] {
  let round = 0;
  return f.phases.flatMap((p): FriezePhase[] =>
    isPool(p)
      ? [{ kind: 'pool', round, key: `pool-${round++}` }]
      : isQuest(p)
        ? [{ kind: 'quest', key: 'quest' }]
        : isTableau(p)
          ? [{ kind: 'tableau', key: 'tableau' }]
          : []
  );
}

/**
 * Briques autorisées au « ＋ » d'indice `at` (0 = après l'appel) : tours de poules avant le Tour
 * Quest et le tableau, Tour Quest (Sabre Laser) après les poules, un tableau toujours en dernier.
 */
export function insertOptionsV2(f: FormulaV2, weapon: Weapon, at: number): FriezeBrick[] {
  const rounds = f.phases.filter(isPool).length;
  const quest = f.phases.some(isQuest);
  const tableau = f.phases.some(isTableau);
  const total = friezeOfV2(f).length;
  const out: FriezeBrick[] = [];
  // Tour Quest : au plus un tour de poules préliminaire
  const maxRounds = quest ? 1 : MAX_POOL_ROUNDS;
  if (at <= rounds && rounds < maxRounds) out.push('pool');
  if (weapon === Weapon.LASER && !quest && at === rounds && rounds <= 1) out.push('quest');
  if (!tableau && at === total) out.push('tableau');
  return out;
}

export function canRemoveV2(f: FormulaV2, phase: FriezePhase): boolean {
  if (friezeOfV2(f).length <= 1) return false;
  if (phase.kind === 'tableau') return f.phases.some(isPool) || f.phases.some(isQuest);
  return true;
}

/** Réglages d'un tour neuf : ceux du tour voisin, tous qualifiés */
function newPool(f: FormulaV2, at: number, id: string): PoolRoundPhase {
  const list = f.phases.filter(isPool);
  const neighbour = list[at - 1] ?? list[at];
  const base: PoolRoundPhase = neighbour ?? {
    kind: 'pool',
    id,
    sizeMin: 5,
    sizeMax: 7,
    maxScore: 5,
    timerSeconds: 180,
    qualification: { mode: 'all' },
    seeding: 'previous_round',
    boutOrder: 'fie',
  };
  const { label: _label, ...rest } = base;
  return { ...rest, id, qualification: { mode: 'all' } };
}

/** Tableau neuf : réglages du tableau enregistrés sur l'épreuve, sinon défauts de l'arme */
function newTableau(ctx: FormulaV2Context, id: string): TableauPhase {
  const s = ctx.settings ?? {};
  const flat = flatSettingsOf(
    formulaOf({ weapon: ctx.weapon, category: ctx.category }),
    ctx.weapon
  );
  return {
    kind: 'tableau',
    id,
    maxScore: s.defaultTableMaxScore ?? flat.defaultTableMaxScore ?? 15,
    timerSeconds: s.defaultTableTimerSeconds ?? flat.defaultTableTimerSeconds ?? 180,
    thirdPlace: s.thirdPlaceMatch ?? false,
    allPlaces: s.playAllPositions ?? false,
  };
}

function insertV2(
  f: FormulaV2,
  ctx: FormulaV2Context,
  brick: FriezeBrick,
  at: number,
  newId: () => string
): FormulaV2 {
  const phases = [...f.phases];
  if (brick === 'tableau') {
    phases.push(newTableau(ctx, newId()));
  } else if (brick === 'quest') {
    const rounds = phases.filter(isPool).length;
    const config: QuestPhaseConfig = {
      enabled: true,
      hasPreliminaryPools: rounds > 0,
      qualifiersCount: rounds > 0 ? 8 : undefined,
      opponentConstraint: 'none',
    };
    phases.splice(rounds, 0, { kind: 'quest', id: newId(), config });
  } else {
    // Le tour neuf se place avant le `at`-ième tour (les poules sont en tête de frise)
    phases.splice(at, 0, newPool(f, at, newId()));
  }
  return withQuestPools({ ...f, phases });
}

function removeV2(f: FormulaV2, phase: FriezePhase): FormulaV2 {
  if (phase.kind === 'tableau') return { ...f, phases: f.phases.filter(p => !isTableau(p)) };
  if (phase.kind === 'quest') return { ...f, phases: f.phases.filter(p => !isQuest(p)) };
  let round = -1;
  return withQuestPools({
    ...f,
    phases: f.phases.filter(p => !(isPool(p) && ++round === phase.round)),
  });
}

/** Tour Quest : « poules préliminaires » suit la présence d'un tour de poules */
function withQuestPools(f: FormulaV2): FormulaV2 {
  const hasPools = f.phases.some(isPool);
  return {
    ...f,
    phases: f.phases.map(p =>
      isQuest(p) && p.config.hasPreliminaryPools !== hasPools
        ? { ...p, config: { ...p.config, hasPreliminaryPools: hasPools } }
        : p
    ),
  };
}

// ── Réglages d'une phase ──────────────────────────────────────────────────

const POOL_FIELDS = [
  'label',
  'sizeMin',
  'sizeMax',
  'maxScore',
  'timerSeconds',
  'scoring',
  'qualification',
  'seeding',
  'boutOrder',
] as const;
const TABLEAU_FIELDS = [
  'label',
  'maxScore',
  'timerSeconds',
  'thirdPlace',
  'allPlaces',
  'scoring',
] as const;
const QUEST_FIELDS = [
  'qualifiersCount',
  'fightsPerFencer',
  'availableTimeMinutes',
  'numberOfArenas',
  'opponentConstraint',
] as const;
const GENERAL_FIELDS = ['restTimeSeconds', 'ruleSet', 'postPoolSplitCriteria'] as const;

/**
 * Anciens noms (ADR-0033). Ceux de l'épée… Sabre Laser (poolMaxScore…) gardent leur sens : un
 * réglage commun à **tous** les tours ; les noms v2 (maxScore…) ne règlent que le tour visé.
 */
const SHARED_POOL_ALIASES: Record<string, string> = {
  poolMaxScore: 'maxScore',
  poolTimerSeconds: 'timerSeconds',
  poolSizeMin: 'sizeMin',
  poolSizeMax: 'sizeMax',
  poolBoutOrder: 'boutOrder',
};
const POOL_ALIASES: Record<string, string> = { advancementRule: 'qualification' };
const TABLEAU_ALIASES: Record<string, string> = {
  tableMaxScore: 'maxScore',
  tableTimerSeconds: 'timerSeconds',
  thirdPlaceMatch: 'thirdPlace',
  playAllPositions: 'allPlaces',
};
const QUEST_ALIASES: Record<string, string> = { questQualifiers: 'qualifiersCount' };

function renamed(settings: Record<string, unknown>, aliases: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) out[aliases[k] ?? k] = v;
  return out;
}

function checkFields(settings: Record<string, unknown>, allowed: readonly string[], where: string) {
  const unknown = Object.keys(settings).filter(k => !allowed.includes(k));
  if (unknown.length)
    throw new FormulaOperationError(
      `${where} : réglage(s) non modifiable(s) ici (${unknown.join(', ')}) ; autorisés : ${allowed.join(', ')}`
    );
}

const isRule = (v: unknown): v is AdvancementRule =>
  typeof v === 'object' && v !== null && typeof (v as { mode?: unknown }).mode === 'string';

function setPool(
  p: PoolRoundPhase,
  raw: Record<string, unknown>,
  where: string,
  isLastRound: boolean
): PoolRoundPhase {
  const { qualifiers, poolWinnersOnly, ...rest } = renamed(raw, POOL_ALIASES);
  checkFields(rest, POOL_FIELDS, where);
  let next = { ...p, ...(rest as Partial<PoolRoundPhase>) };
  if (rest.qualification !== undefined && !isRule(rest.qualification))
    throw new FormulaOperationError(`${where} : « qualification » attend { mode, … }`);
  if (qualifiers !== undefined) {
    if (isLastRound)
      throw new FormulaOperationError(
        `${where} : « qualifiers » ne vaut que pour un tour suivi d'un autre tour`
      );
    const n = Number(qualifiers);
    next = { ...next, qualification: n > 0 ? { mode: 'fixed_count', count: n } : { mode: 'all' } };
  }
  if (poolWinnersOnly !== undefined)
    next = {
      ...next,
      qualification: poolWinnersOnly === true ? { mode: 'pool_winner' } : { mode: 'all' },
    };
  if (rest.maxScore !== undefined && next.scoring && next.scoring.type === 'standard')
    next = {
      ...next,
      scoring: { ...next.scoring, maxScore: next.maxScore } as CustomScoringConfig,
    };
  return next;
}

function setTableau(p: TableauPhase, raw: Record<string, unknown>, where: string): TableauPhase {
  const s = renamed(raw, TABLEAU_ALIASES);
  checkFields(s, TABLEAU_FIELDS, where);
  const next = { ...p, ...(s as Partial<TableauPhase>) };
  return s.maxScore !== undefined && next.scoring?.type === 'standard'
    ? { ...next, scoring: { ...next.scoring, maxScore: next.maxScore } }
    : next;
}

function setQuest(p: QuestPhase, raw: Record<string, unknown>, where: string): QuestPhase {
  const s = renamed(raw, QUEST_ALIASES);
  checkFields(s, QUEST_FIELDS, where);
  return { ...p, config: { ...p.config, ...(s as Partial<QuestPhaseConfig>) } };
}

export interface FormulaV2Context {
  weapon: Weapon;
  category: Category;
  settings?: Partial<CompetitionSettings>;
}

const findPhase = (phases: FriezePhase[], key: string) => {
  const p = phases.find(x => x.key === key);
  if (!p)
    throw new FormulaOperationError(
      `phase « ${key} » inconnue ; phases : ${phases.map(x => x.key).join(', ') || 'aucune'}`
    );
  return p;
};

/** Index dans `f.phases` d'une phase de la frise */
function indexOf(f: FormulaV2, phase: FriezePhase): number {
  let round = -1;
  return f.phases.findIndex(p =>
    phase.kind === 'pool'
      ? isPool(p) && ++round === phase.round
      : phase.kind === 'quest'
        ? isQuest(p)
        : isTableau(p)
  );
}

/** Applique les opérations dans l'ordre (tout ou rien) ; rend la nouvelle formule */
export function applyOperationsV2(
  ctx: FormulaV2Context,
  operations: FormulaOperation[],
  newId: () => string
): FormulaV2 {
  if (operations.length === 0) throw new FormulaOperationError('aucune opération');
  let f = formulaOf(ctx);
  operations.forEach((o, i) => {
    const where = `opération ${i + 1} (${o.op})`;
    if (o.op === 'insertPhase') {
      const allowed = insertOptionsV2(f, ctx.weapon, o.at);
      if (!allowed.includes(o.brick))
        throw new FormulaOperationError(
          `${where} : « ${o.brick} » interdit en position ${o.at} ; autorisé : ${allowed.join(', ') || 'rien'}`
        );
      f = insertV2(f, ctx, o.brick, o.at, newId);
    } else if (o.op === 'removePhase') {
      const p = findPhase(friezeOfV2(f), o.phase);
      if (!canRemoveV2(f, p))
        throw new FormulaOperationError(
          `${where} : la phase « ${o.phase} » ne peut pas être retirée`
        );
      f = removeV2(f, p);
    } else if (o.op === 'setPhase') {
      const frieze = friezeOfV2(f);
      const p = findPhase(frieze, o.phase);
      const index = indexOf(f, p);
      const phases = [...f.phases];
      const current = phases[index];
      const rounds = frieze.filter(x => x.kind === 'pool').length;
      if (isPool(current) && p.kind === 'pool') {
        const shared: Record<string, unknown> = {};
        const own: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(o.settings)) {
          if (k in SHARED_POOL_ALIASES) shared[SHARED_POOL_ALIASES[k]] = v;
          else if (k === 'poolWinnersOnly') shared[k] = v;
          else own[k] = v;
        }
        const { poolWinnersOnly, ...common } = shared;
        let round = -1;
        for (let k = 0; k < phases.length; k++) {
          const q = phases[k];
          if (!isPool(q)) continue;
          round++;
          if (Object.keys(common).length)
            phases[k] = setPool(q, common, where, round >= rounds - 1);
        }
        // « Vainqueurs de poule seulement » : qualification du dernier tour
        if (poolWinnersOnly !== undefined) {
          const last = phases
            .map((x, k) => (isPool(x) ? k : -1))
            .filter(k => k >= 0)
            .pop();
          if (last !== undefined)
            phases[last] = setPool(
              phases[last] as PoolRoundPhase,
              { poolWinnersOnly },
              where,
              true
            );
        }
        if (Object.keys(own).length)
          phases[index] = setPool(
            phases[index] as PoolRoundPhase,
            own,
            where,
            p.round >= rounds - 1
          );
      } else if (isTableau(current)) phases[index] = setTableau(current, o.settings, where);
      else if (isQuest(current)) phases[index] = setQuest(current, o.settings, where);
      f = { ...f, phases };
    } else {
      checkFields(o.settings, GENERAL_FIELDS, where);
      f = { ...f, general: { ...f.general, ...(o.settings as Partial<FormulaV2['general']>) } };
    }
  });
  return f;
}

/** Écarts de bornes de la formule (moteur, à chaque écriture, ADR-0012) */
export function formulaV2Issues(
  f: FormulaV2,
  scope: { weapon: Weapon; isTeamEvent?: boolean }
): string[] {
  const out: string[] = [];
  const pools = f.phases.filter(isPool);
  // Chaque tour jugé comme s'il était le premier (mêmes bornes que les réglages plats)
  pools.forEach((p, r) => {
    const issues = validateFormulaSettings(
      {
        defaultPoolMaxScore: p.maxScore,
        defaultPoolTimerSeconds: p.timerSeconds,
        poolSizeMin: p.sizeMin,
        poolSizeMax: p.sizeMax,
      },
      undefined,
      scope
    );
    out.push(...issues.map(i => `tour ${r + 1} : ${i.field} (${i.message})`));
  });
  const tableau = f.phases.find(isTableau);
  if (tableau) {
    const issues = validateFormulaSettings(
      { defaultTableMaxScore: tableau.maxScore, defaultTableTimerSeconds: tableau.timerSeconds },
      undefined,
      scope
    );
    out.push(...issues.map(i => `tableau : ${i.field} (${i.message})`));
  }
  if (pools.length > MAX_POOL_ROUNDS) out.push(`${MAX_POOL_ROUNDS} tours de poules au plus`);
  return out;
}

/** Vue de la formule v2 pour l'agent et l'écran (getCompetitionFormula) */
export function formulaViewV2(ctx: FormulaV2Context): {
  formula: FormulaV2;
  phases: FriezePhase[];
  insertOptions: FriezeBrick[][];
  coherence: CoherenceIssue[];
} {
  const formula = formulaOf(ctx);
  const phases = friezeOfV2(formula);
  const pools = formula.phases.filter(isPool);
  const tableau = formula.phases.find(isTableau);
  return {
    formula,
    phases,
    insertOptions: Array.from({ length: phases.length + 1 }, (_, i) =>
      insertOptionsV2(formula, ctx.weapon, i)
    ),
    coherence:
      ctx.weapon === Weapon.CUSTOM
        ? []
        : getCoherenceIssues(ctx.weapon, ctx.category, {
            poolMaxScore: pools[0]?.maxScore ?? 0,
            tableMaxScore: tableau?.maxScore ?? 0,
            hasPools: pools.length > 0,
            hasDirectElimination: !!tableau,
          }),
  };
}
