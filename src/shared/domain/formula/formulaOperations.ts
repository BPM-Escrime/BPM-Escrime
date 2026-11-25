/**
 * BPM - Escrime - Opérations sur la formule d'une épreuve (#2013 étape B2, docs/adr/0033)
 * `updateCompetitionFormula` : liste d'opérations de frise appliquées dans l'ordre, tout ou
 * rien, avec la grammaire de l'écran (formulaFrieze.ts). Résultat : réglages à écrire, jugés
 * ensuite par validateFormulaSettings dans le moteur. Domaine pur : identifiants injectés.
 * Licensed under GPL-3.0
 */

import {
  Category,
  CompetitionSettings,
  CustomDEConfig,
  CustomFormulaConfig,
  CustomPoolRoundConfig,
  Weapon,
} from '../../types';
import { deriveSettingsFromFormula } from '../../utils/customFormulaSettings';
import { createDefaultCustomFormula } from '../../utils/tournamentTemplates';
import { getCoherenceIssues, CoherenceIssue } from '../../utils/formulaCoherence';
import {
  FormulaDraft,
  draftFromSettings,
  draftToSettings,
  effectivePoolRounds,
} from './formulaDraft';
import {
  FriezeBrick,
  FriezePhase,
  customCanRemove,
  customFrieze,
  customInsert,
  customInsertOptions,
  customPhaseNode,
  customRemove,
  draftCanRemove,
  draftFrieze,
  draftInsert,
  draftInsertOptions,
  draftRemove,
  normalizeCustomFormula,
} from './formulaFrieze';

export type FormulaOperation =
  | { op: 'insertPhase'; brick: FriezeBrick; at: number }
  | { op: 'removePhase'; phase: string }
  | { op: 'setPhase'; phase: string; settings: Record<string, unknown> }
  | { op: 'setGeneral'; settings: Record<string, unknown> };

/** Refus d'une opération : le moteur le traduit en `invalid_settings` */
export class FormulaOperationError extends Error {}

/** Réglages modifiables par phase et réglages généraux : ce que le moteur exécute (P2) */
const DRAFT_PHASE_FIELDS: Record<FriezePhase['kind'], Array<keyof FormulaDraft | 'qualifiers'>> = {
  pool: [
    'poolMaxScore',
    'poolTimerSeconds',
    'poolSizeMin',
    'poolSizeMax',
    'poolWinnersOnly',
    'poolBoutOrder',
    'qualifiers',
  ],
  quest: ['questQualifiers'],
  tableau: ['tableMaxScore', 'tableTimerSeconds', 'thirdPlaceMatch', 'playAllPositions'],
};
const DRAFT_GENERAL_FIELDS: Array<keyof FormulaDraft> = [
  'restTimeSeconds',
  'postPoolSplitCriteria',
];
const CUSTOM_POOL_FIELDS = ['label', 'maxScore', 'timerSeconds', 'scoring', 'advancementRule'];
const CUSTOM_DE_FIELDS = ['label', 'maxScore', 'timerSeconds', 'thirdPlaceMatch', 'scoring'];
const CUSTOM_GENERAL_FIELDS = ['ruleSet', 'restTimeSeconds'];

function checkFields(settings: Record<string, unknown>, allowed: readonly string[], where: string) {
  const unknown = Object.keys(settings).filter(k => !allowed.includes(k));
  if (unknown.length)
    throw new FormulaOperationError(
      `${where} : réglage(s) non modifiable(s) ici (${unknown.join(', ')}) ; autorisés : ${allowed.join(', ')}`
    );
}

export interface FormulaContext {
  weapon: Weapon;
  category: Category;
  settings?: Partial<CompetitionSettings>;
}

function customDefaults() {
  const f = createDefaultCustomFormula();
  return {
    pool: f.phases[0].config as CustomPoolRoundConfig,
    tableau: f.phases[1].config as CustomDEConfig,
  };
}

const findPhase = (phases: FriezePhase[], key: string) => {
  const p = phases.find(x => x.key === key);
  if (!p)
    throw new FormulaOperationError(
      `phase « ${key} » inconnue ; phases : ${phases.map(x => x.key).join(', ') || 'aucune'}`
    );
  return p;
};

/**
 * Applique les opérations dans l'ordre ; lève FormulaOperationError à la première refusée.
 * Rend les réglages à fusionner dans ceux de l'épreuve.
 */
export function applyFormulaOperations(
  ctx: FormulaContext,
  operations: FormulaOperation[],
  newId: () => string
): Partial<CompetitionSettings> {
  if (operations.length === 0) throw new FormulaOperationError('aucune opération');
  if (ctx.weapon === Weapon.CUSTOM) {
    let f: CustomFormulaConfig = normalizeCustomFormula(
      ctx.settings?.customFormula ?? createDefaultCustomFormula()
    );
    operations.forEach((o, i) => {
      const where = `opération ${i + 1} (${o.op})`;
      if (o.op === 'insertPhase') {
        if (!customInsertOptions(f, o.at).includes(o.brick))
          throw new FormulaOperationError(
            `${where} : « ${o.brick} » interdit en position ${o.at} ; autorisé : ${customInsertOptions(f, o.at).join(', ') || 'rien'}`
          );
        f = customInsert(f, o.brick, o.at, newId, customDefaults());
      } else if (o.op === 'removePhase') {
        const p = findPhase(customFrieze(f), o.phase);
        if (!customCanRemove(f, p))
          throw new FormulaOperationError(
            `${where} : la phase « ${o.phase} » ne peut pas être retirée`
          );
        f = customRemove(f, p);
      } else if (o.op === 'setPhase') {
        const p = findPhase(customFrieze(f), o.phase);
        const found = customPhaseNode(f, p);
        if (!found) throw new FormulaOperationError(`${where} : phase introuvable`);
        checkFields(o.settings, p.kind === 'pool' ? CUSTOM_POOL_FIELDS : CUSTOM_DE_FIELDS, where);
        const phases = [...f.phases];
        const { label, ...config } = o.settings;
        phases[found.index] = {
          ...found.node,
          ...(typeof label === 'string' ? { label: label.slice(0, 80) } : {}),
          config: { ...found.node.config, ...config } as CustomPoolRoundConfig | CustomDEConfig,
        };
        f = { ...f, phases };
      } else {
        checkFields(o.settings, CUSTOM_GENERAL_FIELDS, where);
        f = { ...f, ...(o.settings as Partial<CustomFormulaConfig>) };
      }
    });
    return { customFormula: f, ...deriveSettingsFromFormula(f) };
  }

  let d = draftFromSettings(ctx.weapon, ctx.category, ctx.settings as CompetitionSettings);
  operations.forEach((o, i) => {
    const where = `opération ${i + 1} (${o.op})`;
    if (o.op === 'insertPhase') {
      const allowed = draftInsertOptions(d, ctx.weapon, o.at);
      if (!allowed.includes(o.brick))
        throw new FormulaOperationError(
          `${where} : « ${o.brick} » interdit en position ${o.at} ; autorisé : ${allowed.join(', ') || 'rien'}`
        );
      d = { ...d, ...draftInsert(d, ctx.weapon, o.brick, o.at) };
    } else if (o.op === 'removePhase') {
      const p = findPhase(draftFrieze(d, ctx.weapon), o.phase);
      if (!draftCanRemove(d, ctx.weapon, p))
        throw new FormulaOperationError(
          `${where} : la phase « ${o.phase} » ne peut pas être retirée`
        );
      d = { ...d, ...draftRemove(d, ctx.weapon, p) };
    } else if (o.op === 'setPhase') {
      const p = findPhase(draftFrieze(d, ctx.weapon), o.phase);
      checkFields(o.settings, DRAFT_PHASE_FIELDS[p.kind], where);
      const { qualifiers, ...rest } = o.settings;
      d = { ...d, ...(rest as Partial<FormulaDraft>) };
      if (qualifiers !== undefined) {
        if (p.kind !== 'pool' || p.round >= effectivePoolRounds(d, ctx.weapon) - 1)
          throw new FormulaOperationError(
            `${where} : « qualifiers » ne vaut que pour un tour suivi d'un autre tour`
          );
        const q = [...d.poolRoundQualifiers];
        q[p.round] = qualifiers as number;
        d = { ...d, poolRoundQualifiers: q };
      }
    } else {
      checkFields(o.settings, DRAFT_GENERAL_FIELDS, where);
      d = { ...d, ...(o.settings as Partial<FormulaDraft>) };
    }
  });
  return draftToSettings(d, ctx.weapon, ctx.settings?.questConfig);
}

// ── Opérations qui mènent d'une formule à une autre (écran, « un fait, un chemin ») ──

const differs = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);

function pickChanged<T extends object>(from: T, to: T, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const a = (from as Record<string, unknown>)[k];
    const b = (to as Record<string, unknown>)[k];
    if (differs(a, b)) out[k] = b;
  }
  return out;
}

function draftOperationsBetween(
  weapon: Weapon,
  from: FormulaDraft,
  to: FormulaDraft
): FormulaOperation[] {
  const ops: FormulaOperation[] = [];
  let cur = from;
  const push = (o: FormulaOperation) => {
    ops.push(o);
    if (o.op === 'insertPhase') cur = { ...cur, ...draftInsert(cur, weapon, o.brick, o.at) };
    else if (o.op === 'removePhase') {
      const p = draftFrieze(cur, weapon).find(x => x.key === o.phase);
      if (p) cur = { ...cur, ...draftRemove(cur, weapon, p) };
    }
  };
  if (cur.hasDirectElimination && !to.hasDirectElimination)
    push({ op: 'removePhase', phase: 'tableau' });
  if (weapon === Weapon.LASER && cur.questEnabled !== to.questEnabled) {
    if (to.questEnabled)
      push({ op: 'insertPhase', brick: 'quest', at: effectivePoolRounds(cur, weapon) });
    else push({ op: 'removePhase', phase: 'quest' });
  }
  for (let guard = 0; guard < 10; guard++) {
    const have = effectivePoolRounds(cur, weapon);
    const want = effectivePoolRounds(to, weapon);
    if (have < want) push({ op: 'insertPhase', brick: 'pool', at: have });
    else if (have > want && have > 0) push({ op: 'removePhase', phase: `pool-${have - 1}` });
    else break;
  }
  if (!cur.hasDirectElimination && to.hasDirectElimination)
    push({ op: 'insertPhase', brick: 'tableau', at: draftFrieze(cur, weapon).length });

  const rounds = effectivePoolRounds(to, weapon);
  const pool = pickChanged(
    cur,
    to,
    DRAFT_PHASE_FIELDS.pool.filter(k => k !== 'qualifiers')
  );
  if (rounds > 0 && Object.keys(pool).length)
    ops.push({ op: 'setPhase', phase: 'pool-0', settings: pool });
  for (let r = 0; r < rounds - 1; r++) {
    const a = cur.poolRoundQualifiers[r] ?? 0;
    const b = to.poolRoundQualifiers[r] ?? 0;
    if (a !== b) ops.push({ op: 'setPhase', phase: `pool-${r}`, settings: { qualifiers: b } });
  }
  const quest = pickChanged(cur, to, DRAFT_PHASE_FIELDS.quest);
  if (weapon === Weapon.LASER && to.questEnabled && Object.keys(quest).length)
    ops.push({ op: 'setPhase', phase: 'quest', settings: quest });
  const tableau = pickChanged(cur, to, DRAFT_PHASE_FIELDS.tableau);
  if (to.hasDirectElimination && Object.keys(tableau).length)
    ops.push({ op: 'setPhase', phase: 'tableau', settings: tableau });
  const general = pickChanged(cur, to, DRAFT_GENERAL_FIELDS);
  if (Object.keys(general).length) ops.push({ op: 'setGeneral', settings: general });
  return ops;
}

function customOperationsBetween(
  from: CustomFormulaConfig,
  to: CustomFormulaConfig
): FormulaOperation[] {
  const ops: FormulaOperation[] = [];
  const pools = (f: CustomFormulaConfig) => f.phases.filter(p => p.type === 'pool_round');
  const tableauOf = (f: CustomFormulaConfig) => f.phases.find(p => p.type === 'direct_elimination');
  const have = pools(from).length;
  const want = pools(to).length;
  if (tableauOf(from) && !tableauOf(to)) ops.push({ op: 'removePhase', phase: 'tableau' });
  for (let n = have; n < want; n++) ops.push({ op: 'insertPhase', brick: 'pool', at: n });
  for (let n = have; n > want; n--) ops.push({ op: 'removePhase', phase: `pool-${n - 1}` });
  if (!tableauOf(from) && tableauOf(to))
    ops.push({ op: 'insertPhase', brick: 'tableau', at: want });

  const nodeFields = (n: { label?: string; config: object } | undefined) =>
    n ? { label: n.label, ...(n.config as Record<string, unknown>) } : {};
  pools(to).forEach((node, r) => {
    const before = r < have ? nodeFields(pools(from)[r]) : nodeFields(pools(to)[r - 1] ?? node);
    const changed = pickChanged(before, nodeFields(node), CUSTOM_POOL_FIELDS);
    // Tour inséré : réglages du voisin, qualification « tous » (customInsert)
    if (r >= have) changed.advancementRule = (node.config as CustomPoolRoundConfig).advancementRule;
    if (Object.keys(changed).length)
      ops.push({ op: 'setPhase', phase: `pool-${r}`, settings: changed });
  });
  const tTo = tableauOf(to);
  if (tTo) {
    const changed = pickChanged(nodeFields(tableauOf(from)), nodeFields(tTo), CUSTOM_DE_FIELDS);
    if (!tableauOf(from))
      Object.assign(changed, pickChanged({}, nodeFields(tTo), CUSTOM_DE_FIELDS));
    if (Object.keys(changed).length)
      ops.push({ op: 'setPhase', phase: 'tableau', settings: changed });
  }
  const general = pickChanged(from, to, CUSTOM_GENERAL_FIELDS);
  if (Object.keys(general).length) ops.push({ op: 'setGeneral', settings: general });
  return ops;
}

/**
 * Opérations qui mènent la formule de l'épreuve (`ctx`) à celle de `target` : l'écran envoie
 * ses modifications par updateCompetitionFormula, comme l'agent (docs/adr/0033). Liste vide :
 * rien à écrire.
 */
export function formulaOperationsBetween(
  ctx: FormulaContext,
  target: Partial<CompetitionSettings>
): FormulaOperation[] {
  if (ctx.weapon === Weapon.CUSTOM) {
    const from = normalizeCustomFormula(
      ctx.settings?.customFormula ?? createDefaultCustomFormula()
    );
    const to = normalizeCustomFormula(target.customFormula ?? from);
    return customOperationsBetween(from, to);
  }
  const from = draftFromSettings(ctx.weapon, ctx.category, ctx.settings as CompetitionSettings);
  const to = draftFromSettings(ctx.weapon, ctx.category, {
    ...ctx.settings,
    ...target,
  } as CompetitionSettings);
  return draftOperationsBetween(ctx.weapon, from, to);
}

/** Vue de la formule pour l'agent et l'écran (getCompetitionFormula) */
export function formulaView(ctx: FormulaContext): {
  model: 'draft' | 'custom';
  phases: FriezePhase[];
  insertOptions: FriezeBrick[][];
  draft?: FormulaDraft;
  customFormula?: CustomFormulaConfig;
  coherence: CoherenceIssue[];
} {
  if (ctx.weapon === Weapon.CUSTOM) {
    const f = normalizeCustomFormula(ctx.settings?.customFormula ?? createDefaultCustomFormula());
    const phases = customFrieze(f);
    return {
      model: 'custom',
      phases,
      insertOptions: phases
        .map((_, i) => customInsertOptions(f, i))
        .concat([customInsertOptions(f, phases.length)]),
      customFormula: f,
      coherence: [],
    };
  }
  const d = draftFromSettings(ctx.weapon, ctx.category, ctx.settings as CompetitionSettings);
  const phases = draftFrieze(d, ctx.weapon);
  return {
    model: 'draft',
    phases,
    insertOptions: phases
      .map((_, i) => draftInsertOptions(d, ctx.weapon, i))
      .concat([draftInsertOptions(d, ctx.weapon, phases.length)]),
    draft: d,
    coherence: getCoherenceIssues(ctx.weapon, ctx.category, {
      poolMaxScore: d.poolMaxScore,
      tableMaxScore: d.tableMaxScore,
      hasPools: effectivePoolRounds(d, ctx.weapon) > 0,
      hasDirectElimination: d.hasDirectElimination,
    }),
  };
}
