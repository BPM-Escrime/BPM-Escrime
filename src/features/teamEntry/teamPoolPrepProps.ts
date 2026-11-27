/**
 * BPM - Escrime - Entrée en équipes : props de la préparation des poules (#1441, docs/adr/0043)
 * Séparation par club puis regroupement par niveau (réglage `distribution` de la formule), nom
 * d'équipe et bulle de niveau, numéro de couleur = numéro d'appel (#1816).
 * Licensed under GPL-3.0
 */
import type { Fencer } from '../../shared/types';
import {
  DEFAULT_TEAM_LEVELS,
  levelLabel,
  levelRankOf,
} from '../../shared/domain/fencers/teamEntry';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function teamPoolPrepProps(levels: readonly string[] | undefined, t: Translate) {
  const labels = levels ?? DEFAULT_TEAM_LEVELS;
  return {
    /** Niveau du tireur-équipe, du plus faible au plus fort (regroupement « par niveau ») */
    levelRankOf,
    /** Critères proposés : club + niveau réordonnables, niveau actif = regroupement */
    separationKeys: ['byClub', 'byLevel'] as Array<'byClub' | 'byLevel'>,
    fencerDisplay: (f: Fencer) => {
      const level = levelLabel(f.level, labels, c => t(`teamEntry.level_${c}`)) || undefined;
      return {
        label: f.lastName,
        pill: level,
        pillTitle: [level, f.club].filter(Boolean).join(' — '),
      };
    },
    /** Numéro de couleur = numéro de l'équipe dans la liste d'appel (#1816) */
    positionOf: (f: Fencer) => f.ref,
  };
}
