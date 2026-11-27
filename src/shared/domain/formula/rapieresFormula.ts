/**
 * BPM - Escrime - Tournoi des rapières en briques de la formule (docs/adr/0043, lot F4e)
 * Le modèle fourni « Tournoi des rapières » est une formule v2 ordinaire : arme « Autre », règles
 * modernes, un tour en vagues par niveau, entrée en binômes, tableau, filtres du classement,
 * départage par la victoire. Le mode spécial (`settings.specialMode`) n'est plus écrit ; une
 * épreuve enregistrée avec lui est LUE comme cette formule (lecture de compatibilité, sans
 * réécriture en base). Domaine pur : seul endroit, avec les types et le schéma, qui connaît
 * encore `specialMode`.
 * Licensed under GPL-3.0
 */

import { Weapon } from '../../types';
import type { AdvancementRule, CompetitionSettings } from '../../types';
import { DEFAULT_TEAM_LEVELS } from '../fencers/teamEntry';
import { isWavesOrder } from '../pools/waves';
import type { RapieresTableauMode } from '../rapieres/tableauQualifiers';
import type { FormulaV2, PoolRoundPhase, TableauPhase } from './formulaV2';

/** Poules du tour en vagues : 2 à 10 tireurs (docs/adr/0043, F4a) */
const POOL_SIZE = { min: 2, max: 10 } as const;

/** Valeurs de la formule qui varient d'une épreuve à l'autre (réglages enregistrés) */
export interface RapieresFormulaOptions {
  poolMaxScore?: number;
  poolTimerSeconds?: number;
  tableMaxScore?: number;
  tableTimerSeconds?: number;
  thirdPlace?: boolean;
  allPlaces?: boolean;
  /** Qualification vers le tableau : tous les équipes par défaut */
  qualification?: AdvancementRule;
  ruleSet?: 'modern' | 'laser';
  restTimeSeconds?: number;
}

/**
 * Formule du Tournoi des rapières : modèle fourni (`bpm/C/rapieres`) et lecture des épreuves du
 * mode spécial. Défauts de la création d'une épreuve « Autre » : poules à 5, tableau à 15, 180 s,
 * match pour la 3ᵉ place, tous qualifiés.
 */
export function rapieresFormula(options: RapieresFormulaOptions = {}): FormulaV2 {
  const pool: PoolRoundPhase = {
    kind: 'pool',
    id: 'bpm-phase-1',
    sizeMin: POOL_SIZE.min,
    sizeMax: POOL_SIZE.max,
    maxScore: options.poolMaxScore ?? 5,
    timerSeconds: options.poolTimerSeconds ?? 180,
    qualification: options.qualification ?? { mode: 'all' },
    seeding: 'previous_round',
    boutOrder: 'waves',
    distribution: 'byLevel',
  };
  const tableau: TableauPhase = {
    kind: 'tableau',
    id: 'bpm-phase-2',
    maxScore: options.tableMaxScore ?? 15,
    timerSeconds: options.tableTimerSeconds ?? 180,
    thirdPlace: options.thirdPlace ?? true,
    allPlaces: options.allPlaces ?? false,
  };
  return {
    version: 2,
    name: 'Tournoi des rapières',
    phases: [pool, tableau],
    general: {
      ruleSet: options.ruleSet ?? 'modern',
      ...(options.restTimeSeconds !== undefined
        ? { restTimeSeconds: options.restTimeSeconds }
        : {}),
      entry: { kind: 'team', size: 2, levels: [...DEFAULT_TEAM_LEVELS] },
      rankingFilters: ['category', 'gender', 'level', 'handicap'],
      tieBreakByVictory: true,
    },
  };
}

/** Épreuve enregistrée en mode spécial rapières (clé `specialMode`, plus écrite depuis F4e) */
export const hasLegacySpecialMode = (
  settings: Partial<CompetitionSettings> | undefined | null
): boolean => settings?.specialMode === 'rapieres';

/**
 * Épreuve enregistrée en mode spécial rapières, lue comme la formule des rapières. Une formule
 * enregistrée depuis (tour en vagues au premier tour) prime : l'éditeur l'a écrite avec les briques.
 */
export function isLegacyRapieres(
  weapon: Weapon | string | undefined | null,
  settings: Partial<CompetitionSettings> | undefined | null
): boolean {
  if (weapon !== undefined && weapon !== null && weapon !== Weapon.CUSTOM) return false;
  if (!hasLegacySpecialMode(settings)) return false;
  const stored = settings?.formula;
  const first = stored?.phases.find(p => p.kind === 'pool');
  return !(first?.kind === 'pool' && isWavesOrder(first.boutOrder));
}

/**
 * Formule lue d'une épreuve du mode spécial (docs/adr/0043, F4e) : réglages plats enregistrés
 * (scores, durées, match pour la 3ᵉ place, toutes les places, règles de la formule « Autre »),
 * qualification « têtes de poule » de la formule enregistrée, sinon « demi-finales » du mode de
 * tableau hérité (`rapieres.tableauMode`, lu dans l'état de session), sinon tous qualifiés. La
 * qualification de la formule v1 (pourcentage…) n'a jamais été exécutée en mode spécial : ignorée.
 */
export function legacyRapieresFormula(
  settings: Partial<CompetitionSettings> | undefined | null,
  tableauMode?: RapieresTableauMode
): FormulaV2 {
  const stored = settings?.formula;
  const storedPool = stored?.phases.find(p => p.kind === 'pool');
  const heads =
    storedPool?.kind === 'pool' && storedPool.qualification.mode === 'pool_heads'
      ? storedPool.qualification
      : undefined;
  const custom = settings?.customFormula;
  const qualification: AdvancementRule | undefined =
    heads ??
    (tableauMode === 'semis'
      ? { mode: 'pool_heads', count: 4, ties: 'initial_ranking' }
      : undefined);
  const rest = settings?.restTimeSeconds ?? custom?.restTimeSeconds;
  return rapieresFormula({
    ...(settings?.defaultPoolMaxScore ? { poolMaxScore: settings.defaultPoolMaxScore } : {}),
    ...(settings?.defaultPoolTimerSeconds
      ? { poolTimerSeconds: settings.defaultPoolTimerSeconds }
      : {}),
    ...(settings?.defaultTableMaxScore ? { tableMaxScore: settings.defaultTableMaxScore } : {}),
    ...(settings?.defaultTableTimerSeconds
      ? { tableTimerSeconds: settings.defaultTableTimerSeconds }
      : {}),
    thirdPlace: settings?.thirdPlaceMatch ?? (tableauMode ? tableauMode !== 'normal' : true),
    allPlaces: settings?.playAllPositions ?? tableauMode === 'all',
    ...(qualification ? { qualification } : {}),
    ruleSet: custom?.ruleSet === 'laser' ? 'laser' : 'modern',
    ...(typeof rest === 'number' ? { restTimeSeconds: rest } : {}),
  });
}

/**
 * Lecture hors formule d'une épreuve du mode spécial (qualifiés du tableau) : mode de tableau
 * hérité de l'état de session ; undefined pour toute autre épreuve.
 */
export function legacyRapieresRead(
  settings: Partial<CompetitionSettings> | undefined | null,
  session: { rapieres?: { tableauMode?: RapieresTableauMode } | null } | undefined
): { mode: RapieresTableauMode | undefined } | undefined {
  return isLegacyRapieres(undefined, settings)
    ? { mode: session?.rapieres?.tableauMode }
    : undefined;
}

/**
 * Formule d'un modèle personnel enregistré avec le mode spécial rapières (`body.specialMode`,
 * avant F4e) : les briques des rapières, avec les scores, durées, match pour la 3ᵉ place, toutes
 * les places, « têtes de poule » et règles de la formule du modèle (lecture, sans réécriture).
 */
export function rapieresFormulaFrom(formula: FormulaV2): FormulaV2 {
  const pool = formula.phases.find(p => p.kind === 'pool');
  const tableau = formula.phases.find(p => p.kind === 'tableau');
  const heads = pool?.kind === 'pool' && pool.qualification.mode === 'pool_heads';
  return rapieresFormula({
    ...(pool?.kind === 'pool'
      ? { poolMaxScore: pool.maxScore, poolTimerSeconds: pool.timerSeconds }
      : {}),
    ...(tableau?.kind === 'tableau'
      ? {
          tableMaxScore: tableau.maxScore,
          tableTimerSeconds: tableau.timerSeconds,
          thirdPlace: tableau.thirdPlace,
          allPlaces: tableau.allPlaces,
        }
      : {}),
    ...(heads && pool?.kind === 'pool' ? { qualification: pool.qualification } : {}),
    ruleSet: formula.general.ruleSet === 'laser' ? 'laser' : 'modern',
    ...(formula.general.restTimeSeconds !== undefined
      ? { restTimeSeconds: formula.general.restTimeSeconds }
      : {}),
  });
}
