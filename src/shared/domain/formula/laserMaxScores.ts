/**
 * BPM - Escrime - Bornes du score maximum ; Sabre Laser : 25 par défaut, 15 à 50 (provisoire,
 * #2208, docs/adr/0028). Sans dépendance : lu par la base et l'écran.
 * Licensed under GPL-3.0
 */

import { CompetitionSettings, Weapon } from '../../types';

export const LASER_DEFAULT_MAX_SCORE = 25;
// = LASER_SCORE_LIMIT (fin de combat), égalité testée
export const LASER_MAX_SCORE_LIMITS = { min: 15, max: 50 } as const;
export const MAX_SCORE_LIMITS = {
  pool: { min: 1, max: 15 },
  table: { min: 1, max: 50 },
} as const;

export interface FormulaScope {
  weapon?: Weapon | string;
  isTeamEvent?: boolean;
}

/** Sabre Laser individuel : 15-50 ; autres armes et équipes : poule 1-15, tableau 1-50 */
export function maxScoreLimits(scope: FormulaScope = {}): {
  pool: { min: number; max: number };
  table: { min: number; max: number };
} {
  if (scope.weapon === Weapon.LASER && !scope.isTeamEvent)
    return { pool: LASER_MAX_SCORE_LIMITS, table: LASER_MAX_SCORE_LIMITS };
  return MAX_SCORE_LIMITS;
}

/**
 * Sabre Laser individuel créé avec l'ancien repli 5 / 21 (#2174 → #2205), sans migration :
 * poule sous 15 (refusée par la formule) → 25 ; tableau sous 15, ou 21 avec cette poule → 25.
 */
export function readLaserMaxScores<T extends Partial<CompetitionSettings>>(
  weapon: string | undefined,
  isTeamEvent: boolean,
  settings: T
): T {
  if (weapon !== Weapon.LASER || isTeamEvent || !settings) return settings;
  const { min } = LASER_MAX_SCORE_LIMITS;
  const below = (v: unknown) => typeof v === 'number' && v > 0 && v < min;
  const pool = below(settings.defaultPoolMaxScore);
  const table =
    below(settings.defaultTableMaxScore) || (pool && settings.defaultTableMaxScore === 21);
  if (!pool && !table) return settings;
  return {
    ...settings,
    ...(pool ? { defaultPoolMaxScore: LASER_DEFAULT_MAX_SCORE } : {}),
    ...(table ? { defaultTableMaxScore: LASER_DEFAULT_MAX_SCORE } : {}),
  };
}
