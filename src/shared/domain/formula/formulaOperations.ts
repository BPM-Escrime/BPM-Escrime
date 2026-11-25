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
const CUSTOM_POOL_FIELDS = ['maxScore', 'timerSeconds', 'scoring', 'advancementRule'];
const CUSTOM_DE_FIELDS = ['maxScore', 'timerSeconds', 'thirdPlaceMatch', 'scoring'];
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
        phases[found.index] = {
          ...found.node,
          config: { ...found.node.config, ...o.settings } as CustomPoolRoundConfig | CustomDEConfig,
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
