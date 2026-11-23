/**
 * BPM - Escrime - Choix de la discipline d'une salle du planificateur (#2075)
 * Sabre Laser (arène Ø 12 m), escrime (piste FIE) ou escrime artistique (espace scénique).
 * Licensed under GPL-3.0
 */

import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { ARENA_DISCIPLINES, type ArenaDiscipline } from '@shared/domain/arena/arenaDisciplines';

/** Suffixe des clés i18n propres à la discipline (hint, note, nombre d'arènes) : '' pour le laser */
export const disciplineKey = (base: string, d: ArenaDiscipline): string =>
  d === 'laser' ? `arenaPlanner.${base}` : `arenaPlanner.${base}_${d}`;

export const DisciplineField: React.FC<{
  value: ArenaDiscipline;
  onChange: (d: ArenaDiscipline) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="arena-planner-field">
      <label className="form-label" htmlFor="arena-discipline">
        {t('arenaPlanner.discipline')}
      </label>
      <select
        id="arena-discipline"
        className="form-input"
        value={value}
        onChange={e => onChange(e.target.value as ArenaDiscipline)}
      >
        {ARENA_DISCIPLINES.map(d => (
          <option key={d} value={d}>
            {t(`arenaPlanner.discipline_${d}`)}
          </option>
        ))}
      </select>
      <p className="arena-planner-hint">{t('arenaPlanner.hint_discipline')}</p>
    </div>
  );
};
