/**
 * BPM - Escrime - Noms des arènes de la salle, affichés sur le plan (planificateur d'arène)
 * Nom vide : l'arène reste sans nom sur le plan.
 * Licensed under GPL-3.0
 */

import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';

export interface ArenaNamesFieldsProps {
  count: number;
  names: string[];
  onChange: (index: number, name: string) => void;
}

export const ArenaNamesFields: React.FC<ArenaNamesFieldsProps> = ({ count, names, onChange }) => {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <div className="arena-planner-field arena-planner-arena-names">
      <span className="form-label">{t('arenaPlanner.arena_names')}</span>
      {Array.from({ length: count }, (_, i) => (
        <input
          key={i}
          className="form-input"
          type="text"
          maxLength={60}
          aria-label={t('arenaPlanner.arena_name', { n: i + 1 })}
          placeholder={t('arenaPlanner.arena_name', { n: i + 1 })}
          value={names[i] ?? ''}
          onChange={e => onChange(i, e.target.value)}
        />
      ))}
    </div>
  );
};
