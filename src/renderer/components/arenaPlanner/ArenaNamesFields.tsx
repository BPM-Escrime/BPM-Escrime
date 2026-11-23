/**
 * BPM - Escrime - Noms des arènes de la salle, affichés sur le plan (planificateur d'arène)
 * Nom vide : l'arène reste sans nom sur le plan. Bouton ↻ : rotation de l'arène
 * (lignes de mise en garde, arbitre, assesseurs), pas selon la discipline.
 * Licensed under GPL-3.0
 */

import React from 'react';
import { RotateCw } from 'lucide-react';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../common/Button';

export interface ArenaNamesFieldsProps {
  count: number;
  names: string[];
  onChange: (index: number, name: string) => void;
  /** Rotation des arènes, par rang, en degrés */
  rotations?: number[];
  onRotate?: (index: number) => void;
}

export const ArenaNamesFields: React.FC<ArenaNamesFieldsProps> = ({
  count,
  names,
  onChange,
  rotations,
  onRotate,
}) => {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <div className="arena-planner-field arena-planner-arena-names">
      <span className="form-label">{t('arenaPlanner.arena_names')}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="arena-planner-arena-name-row">
          <input
            className="form-input"
            type="text"
            maxLength={60}
            aria-label={t('arenaPlanner.arena_name', { n: i + 1 })}
            placeholder={t('arenaPlanner.arena_name', { n: i + 1 })}
            value={names[i] ?? ''}
            onChange={e => onChange(i, e.target.value)}
          />
          {onRotate ? (
            <Button
              size="sm"
              icon={<RotateCw size={14} aria-hidden="true" />}
              title={t('arenaPlanner.arena_rotate', { n: i + 1 })}
              aria-label={t('arenaPlanner.arena_rotate', { n: i + 1 })}
              onClick={() => onRotate(i)}
            >
              {`${Math.round(rotations?.[i] ?? 0)}°`}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
};
