/**
 * BPM - Escrime - Score maximum saisi au Sabre Laser (provisoire, #2208)
 * Combat en 15 points (`LASER_SCORE_LIMIT`), mais le score saisi peut dépasser 15 : touche
 * finale en cible C (19, Livret 2 VIII.1, IX.1), sortie d'arène (+3) et cartons (jaune +3,
 * rouge +5, docs/ARBITRAGE.md § 3.4). Défaut 25 en poule et au tableau, réglable par l'épreuve.
 * Licensed under GPL-3.0
 */

import { CompetitionSettings, Weapon } from '../../types';
import { LASER_SCORE_LIMIT } from '../match/matchEndValidation';

/** Score maximum par défaut du Sabre Laser individuel, poule et tableau */
export const LASER_DEFAULT_MAX_SCORE = 25;

/** Bornes du réglage au Sabre Laser : jamais sous la fin de combat (15) */
export const LASER_MAX_SCORE_LIMITS = { min: LASER_SCORE_LIMIT, max: 50 } as const;

/** Tableau de l'ancien repli 5 / 21 (#2174 → #2205) */
const LEGACY_TABLE_FALLBACK = 21;

const isLaser = (weapon: string | undefined) => weapon === Weapon.LASER;

/**
 * Lecture des réglages d'une épreuve Sabre Laser individuelle créée avec l'ancien repli 5 / 21
 * (fenêtre #2174 → #2205), sans migration. Un score de poule sous 15 est impossible au Sabre
 * Laser (combat en 15 points) et refusé par la validation de la formule : il ne peut venir que
 * de ce repli et se lit 25. Le tableau à 21 de la même paire se lit 25 ; un tableau sous 15 se
 * lit 25. 0 (sans limite) inchangé. Épreuves par équipes et autres armes : réglages tels quels.
 */
export function readLaserMaxScores<T extends Partial<CompetitionSettings>>(
  weapon: string | undefined,
  isTeamEvent: boolean,
  settings: T
): T {
  if (!isLaser(weapon) || isTeamEvent || !settings) return settings;
  const pool = settings.defaultPoolMaxScore;
  const table = settings.defaultTableMaxScore;
  const below = (v: unknown): v is number =>
    typeof v === 'number' && v > 0 && v < LASER_SCORE_LIMIT;
  const legacyPool = below(pool);
  const legacyTable = below(table) || (legacyPool && table === LEGACY_TABLE_FALLBACK);
  if (!legacyPool && !legacyTable) return settings;
  return {
    ...settings,
    ...(legacyPool ? { defaultPoolMaxScore: LASER_DEFAULT_MAX_SCORE } : {}),
    ...(legacyTable ? { defaultTableMaxScore: LASER_DEFAULT_MAX_SCORE } : {}),
  };
}
