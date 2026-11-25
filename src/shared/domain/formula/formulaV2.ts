/**
 * BPM - Escrime - Formule v2 : arbre de phases pour toutes les armes (#2013 étape C, ADR-0036)
 * Clé `CompetitionSettings.formula`. Sans migration de schéma : une épreuve qui n'a pas encore de
 * formule v2 la reçoit à la lecture (`formulaOf`), construite depuis ses réglages plats (épée…
 * Sabre Laser) ou depuis `customFormula` v1 (arme « Autre »). Les réglages plats restent écrits
 * par dérivation (`flatSettingsOf`) tant que des lecteurs plats existent. Domaine pur.
 * Licensed under GPL-3.0
 */

import {
  AdvancementRule,
  Category,
  CompetitionSettings,
  CustomDEConfig,
  CustomFormulaConfig,
  CustomPoolRoundConfig,
  CustomScoringConfig,
  FormulaPhaseNode,
  PostPoolSplitCriteria,
  QuestPhaseConfig,
  Weapon,
} from '../../types';
import { deriveSettingsFromFormula } from '../../utils/customFormulaSettings';
import { createDefaultCustomFormula } from '../../utils/tournamentTemplates';
import { draftFromSettings, effectivePoolRounds } from './formulaDraft';
import { normalizeCustomFormula } from './formulaFrieze';

/** Réglages v1 non exécutés, gardés pour l'aller-retour avec `customFormula` (retirés à la 3.0) */
export type LegacyPoolSettings = Pick<
  CustomPoolRoundConfig,
  'balanced' | 'seeding' | 'separation' | 'rankingCriteria'
>;
export type LegacyTableauSettings = Pick<
  CustomDEConfig,
  'placesToFence' | 'bracketSizeOverride' | 'fifthPlaceMatch'
>;

export interface PoolRoundPhase {
  kind: 'pool';
  id: string;
  label?: string;
  sizeMin: number;
  sizeMax: number;
  maxScore: number;
  timerSeconds: number;
  /** Barème à zones (arme « Autre ») */
  scoring?: CustomScoringConfig;
  /** Vers la phase suivante */
  qualification: AdvancementRule;
  /** Répartition du tour (Q4) : classement du tour précédent (défaut) ou cumul des tours */
  seeding: 'previous_round' | 'cumulative';
  boutOrder: 'fie' | 'free';
  legacy?: LegacyPoolSettings;
}

export interface QuestPhase {
  kind: 'quest';
  id: string;
  config: QuestPhaseConfig;
}

export interface TableauPhase {
  kind: 'tableau';
  id: string;
  label?: string;
  maxScore: number;
  timerSeconds: number;
  thirdPlace: boolean;
  allPlaces: boolean;
  scoring?: CustomScoringConfig;
  /** Étape D : tableau arrêté quand il reste N tireurs (tableau intercalé) */
  stopAt?: number;
  legacy?: LegacyTableauSettings;
}

/** Étape E : scission, chaque branche est une suite de phases */
export interface SplitPhase {
  kind: 'split';
  id: string;
  criterion: 'gender' | 'category' | 'rank' | 'manual';
  branches: { label: string; phases: FormulaPhaseV2[] }[];
}

export type FormulaPhaseV2 = PoolRoundPhase | QuestPhase | TableauPhase | SplitPhase;

export interface FormulaV2 {
  version: 2;
  /** Dans l'ordre ; l'appel et le classement final sont implicites */
  phases: FormulaPhaseV2[];
  general: {
    /** Repos entre périodes (armes modernes) ; absent : défaut de 60 s */
    restTimeSeconds?: number;
    /** Arme « Autre » : règles des armes modernes ou du Sabre Laser */
    ruleSet?: 'modern' | 'laser';
    /** Compétition couplée (tableaux séparés par sexe) : brique Scission à l'étape E */
    postPoolSplitCriteria?: PostPoolSplitCriteria;
  };
  name?: string;
  notes?: string;
}

export interface FormulaSource {
  weapon: Weapon;
  category: Category;
  settings?: Partial<CompetitionSettings>;
}

const pools = (f: FormulaV2) => f.phases.filter((p): p is PoolRoundPhase => p.kind === 'pool');
const tableauOf = (f: FormulaV2) => f.phases.find((p): p is TableauPhase => p.kind === 'tableau');
const questOf = (f: FormulaV2) => f.phases.find((p): p is QuestPhase => p.kind === 'quest');

// ── Réglages plats → v2 (épée, fleuret, sabre, Sabre Laser) ───────────────

function fromFlat(src: FormulaSource): FormulaV2 {
  const settings = src.settings as CompetitionSettings | undefined;
  const d = draftFromSettings(src.weapon, src.category, settings);
  const rounds = effectivePoolRounds(d, src.weapon);
  const phases: FormulaPhaseV2[] = [];
  for (let r = 0; r < rounds; r++) {
    const last = r === rounds - 1;
    const q = d.poolRoundQualifiers[r] ?? 0;
    phases.push({
      kind: 'pool',
      id: `pool-${r + 1}`,
      sizeMin: d.poolSizeMin,
      sizeMax: d.poolSizeMax,
      maxScore: d.poolMaxScore,
      timerSeconds: d.poolTimerSeconds,
      qualification: last
        ? d.poolWinnersOnly
          ? { mode: 'pool_winner' }
          : { mode: 'all' }
        : q > 0
          ? { mode: 'fixed_count', count: q }
          : { mode: 'all' },
      seeding: 'previous_round',
      boutOrder: d.poolBoutOrder,
    });
  }
  if (src.weapon === Weapon.LASER && d.questEnabled) {
    phases.push({
      kind: 'quest',
      id: 'quest',
      config: settings?.questConfig ?? {
        enabled: true,
        hasPreliminaryPools: d.questHasPools,
        qualifiersCount: d.questHasPools ? d.questQualifiers : undefined,
        opponentConstraint: 'none',
      },
    });
  }
  if (d.hasDirectElimination) {
    phases.push({
      kind: 'tableau',
      id: 'tableau',
      maxScore: d.tableMaxScore,
      timerSeconds: d.tableTimerSeconds,
      thirdPlace: d.thirdPlaceMatch,
      allPlaces: d.playAllPositions,
    });
  }
  return {
    version: 2,
    phases,
    general: {
      restTimeSeconds: d.restTimeSeconds,
      ...(d.postPoolSplitCriteria ? { postPoolSplitCriteria: d.postPoolSplitCriteria } : {}),
    },
  };
}

// ── customFormula v1 ↔ v2 (arme « Autre ») ────────────────────────────────

/** Formule v1 → v2, sans perte (réglages non exécutés gardés dans `legacy`) */
export function formulaFromCustom(custom: CustomFormulaConfig): FormulaV2 {
  const f = normalizeCustomFormula(custom);
  const phases: FormulaPhaseV2[] = f.phases.map(node => {
    if (node.type === 'pool_round') {
      const c = node.config as CustomPoolRoundConfig;
      return {
        kind: 'pool',
        id: node.id,
        ...(node.label !== undefined ? { label: node.label } : {}),
        sizeMin: c.minPoolSize,
        sizeMax: c.maxPoolSize,
        maxScore: c.maxScore,
        timerSeconds: c.timerSeconds,
        scoring: c.scoring,
        qualification: c.advancementRule,
        seeding: 'previous_round',
        boutOrder: 'fie',
        legacy: {
          balanced: c.balanced,
          seeding: c.seeding,
          separation: c.separation,
          rankingCriteria: c.rankingCriteria,
        },
      } satisfies PoolRoundPhase;
    }
    const c = node.config as CustomDEConfig;
    return {
      kind: 'tableau',
      id: node.id,
      ...(node.label !== undefined ? { label: node.label } : {}),
      maxScore: c.maxScore,
      timerSeconds: c.timerSeconds,
      thirdPlace: !!c.thirdPlaceMatch,
      allPlaces: false,
      scoring: c.scoring,
      legacy: {
        placesToFence: c.placesToFence,
        ...(c.bracketSizeOverride !== undefined
          ? { bracketSizeOverride: c.bracketSizeOverride }
          : {}),
        ...(c.fifthPlaceMatch !== undefined ? { fifthPlaceMatch: c.fifthPlaceMatch } : {}),
      },
    } satisfies TableauPhase;
  });
  return {
    version: 2,
    phases,
    general: {
      ...(f.restTimeSeconds !== undefined ? { restTimeSeconds: f.restTimeSeconds } : {}),
      ...(f.ruleSet ? { ruleSet: f.ruleSet } : {}),
    },
    ...(f.formulaName !== undefined ? { name: f.formulaName } : {}),
    ...(f.notes !== undefined ? { notes: f.notes } : {}),
  };
}

/**
 * Formule v2 → v1, lue par les lecteurs de `customFormula` (barème des tablettes, qualifiés par
 * tour) tant qu'ils ne passent pas par `phaseSettings`.
 */
export function customFormulaOf(f: FormulaV2): CustomFormulaConfig {
  const defaults = createDefaultCustomFormula();
  const dPool = defaults.phases[0].config as CustomPoolRoundConfig;
  let round = 0;
  const phases: FormulaPhaseNode[] = [];
  for (const p of f.phases) {
    if (p.kind === 'pool') {
      const legacy = p.legacy ?? {
        balanced: dPool.balanced,
        seeding: dPool.seeding,
        separation: dPool.separation,
        rankingCriteria: dPool.rankingCriteria,
      };
      phases.push({
        id: p.id,
        type: 'pool_round',
        ...(p.label !== undefined ? { label: p.label } : {}),
        config: {
          roundIndex: round++,
          minPoolSize: p.sizeMin,
          maxPoolSize: p.sizeMax,
          ...legacy,
          maxScore: p.maxScore,
          timerSeconds: p.timerSeconds,
          scoring: p.scoring ?? { type: 'standard', maxScore: p.maxScore },
          advancementRule: p.qualification,
        },
      });
    } else if (p.kind === 'tableau') {
      phases.push({
        id: p.id,
        type: 'direct_elimination',
        ...(p.label !== undefined ? { label: p.label } : {}),
        config: {
          maxScore: p.maxScore,
          timerSeconds: p.timerSeconds,
          thirdPlaceMatch: p.thirdPlace,
          placesToFence: p.legacy?.placesToFence ?? [],
          ...(p.legacy?.bracketSizeOverride !== undefined
            ? { bracketSizeOverride: p.legacy.bracketSizeOverride }
            : {}),
          ...(p.legacy?.fifthPlaceMatch !== undefined
            ? { fifthPlaceMatch: p.legacy.fifthPlaceMatch }
            : {}),
          scoring: p.scoring ?? { type: 'standard', maxScore: p.maxScore },
        },
      });
    }
  }
  return {
    version: 1,
    phases,
    ...(f.name !== undefined ? { formulaName: f.name } : {}),
    ...(f.notes !== undefined ? { notes: f.notes } : {}),
    ...(f.general.ruleSet ? { ruleSet: f.general.ruleSet } : {}),
    ...(f.general.restTimeSeconds !== undefined
      ? { restTimeSeconds: f.general.restTimeSeconds }
      : {}),
  };
}

// ── Lecture ───────────────────────────────────────────────────────────────

/** Formule v2 de l'épreuve : enregistrée, sinon construite depuis ses réglages (sans écriture) */
export function formulaOf(src: FormulaSource): FormulaV2 {
  const stored = src.settings?.formula;
  if (stored && stored.version === 2) return stored;
  if (src.weapon === Weapon.CUSTOM)
    return formulaFromCustom(src.settings?.customFormula ?? createDefaultCustomFormula());
  return fromFlat(src);
}

export type PhaseRef = { kind: 'pool'; round: number } | { kind: 'tableau' };

/** Réglages d'une phase : tour de poules `round` (0 = 1er) ou tableau */
export function phaseSettings<R extends PhaseRef>(
  f: FormulaV2,
  ref: R
): R extends { kind: 'pool' } ? PoolRoundPhase : TableauPhase | undefined {
  type Out = R extends { kind: 'pool' } ? PoolRoundPhase : TableauPhase | undefined;
  if (ref.kind === 'tableau') return tableauOf(f) as Out;
  const list = pools(f);
  // Tour au-delà de la formule (épreuve en cours plus longue) : réglages du dernier tour
  const round = (ref as { round: number }).round;
  return list[Math.min(Math.max(0, round), list.length - 1)] as Out;
}

// ── Écriture : réglages plats dérivés ─────────────────────────────────────

/**
 * Réglages plats écrits avec `formula` tant que des lecteurs plats existent (ADR-0036) :
 * valeurs du premier tour et du tableau. Arme « Autre » : mêmes réglages que
 * deriveSettingsFromFormula, plus `customFormula` v1 équivalente.
 */
export function flatSettingsOf(f: FormulaV2, weapon: Weapon): Partial<CompetitionSettings> {
  if (weapon === Weapon.CUSTOM) {
    const customFormula = customFormulaOf(f);
    return { customFormula, ...deriveSettingsFromFormula(customFormula) };
  }
  const list = pools(f);
  const first = list[0];
  const last = list[list.length - 1];
  const tableau = tableauOf(f);
  const quest = questOf(f);
  const out: Partial<CompetitionSettings> = {
    poolRounds: list.length > 0 ? list.length : quest ? 0 : 1,
    poolRoundQualifiers: list
      .slice(0, -1)
      .map(p => (p.qualification.mode === 'fixed_count' ? (p.qualification.count ?? 0) : 0)),
    hasDirectElimination: !!tableau,
    poolWinnersOnly: last?.qualification.mode === 'pool_winner',
    restTimeSeconds: f.general.restTimeSeconds ?? 60,
    postPoolSplitCriteria: f.general.postPoolSplitCriteria,
  };
  if (first) {
    out.defaultPoolMaxScore = first.maxScore;
    out.defaultPoolTimerSeconds = first.timerSeconds;
    out.poolSizeMin = first.sizeMin;
    out.poolSizeMax = first.sizeMax;
    out.poolBoutOrder = first.boutOrder;
  }
  if (tableau) {
    out.defaultTableMaxScore = tableau.maxScore;
    out.defaultTableTimerSeconds = tableau.timerSeconds;
    out.thirdPlaceMatch = tableau.thirdPlace;
    out.playAllPositions = tableau.allPlaces;
  }
  if (weapon === Weapon.LASER) {
    out.questConfig = quest
      ? { ...quest.config, enabled: true }
      : { enabled: false, hasPreliminaryPools: false, opponentConstraint: 'none' };
  }
  return out;
}
