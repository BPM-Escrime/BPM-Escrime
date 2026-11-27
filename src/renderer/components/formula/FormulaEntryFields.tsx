/**
 * BPM - Escrime - Éditeur de formule : entrée individuelle ou en équipes de 2 (binômes), libellés
 * des niveaux, du plus faible au plus fort (docs/adr/0043, F4c). Niveaux par défaut enregistrés en codes
 * (beginner…), affichés traduits ; un libellé saisi est enregistré tel quel.
 * Licensed under GPL-3.0
 */
import React, { useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { DEFAULT_TEAM_LEVELS, TEAM_SIZE } from '../../../shared/domain/fencers/teamEntry';
import type { FormulaEntry } from '../../../shared/domain/formula/formulaV2';

interface FormulaEntryFieldsProps {
  id: string;
  entry: FormulaEntry;
  onChange: (entry: FormulaEntry) => void;
}

const parseLevels = (text: string): string[] =>
  text
    .split(',')
    .map(l => l.trim())
    .filter(Boolean);

const FormulaEntryFields: React.FC<FormulaEntryFieldsProps> = ({ id, entry, onChange }) => {
  const { t } = useTranslation();
  const shown = (levels: readonly string[]) =>
    levels.map(l => (DEFAULT_TEAM_LEVELS.includes(l) ? t(`teamEntry.level_${l}`) : l));
  // Liste saisie → niveaux enregistrés : les libellés par défaut traduits redeviennent des codes
  const stored = (text: string): string[] => {
    const list = parseLevels(text);
    return list.join('|') === shown(DEFAULT_TEAM_LEVELS).join('|')
      ? [...DEFAULT_TEAM_LEVELS]
      : list;
  };
  const [levelsText, setLevelsText] = useState(() =>
    shown(entry.kind === 'team' ? entry.levels : DEFAULT_TEAM_LEVELS).join(', ')
  );
  return (
    <div className="form-group" data-testid={`${id}-entry`}>
      <label className="form-label" htmlFor={`${id}-entry-kind`}>
        {t('formulaEditor.entry')}
      </label>
      <select
        id={`${id}-entry-kind`}
        className="form-input form-select"
        value={entry.kind}
        onChange={e =>
          onChange(
            e.target.value === 'team'
              ? { kind: 'team', size: TEAM_SIZE, levels: stored(levelsText) }
              : { kind: 'individual' }
          )
        }
      >
        <option value="individual">{t('formulaEditor.entry_individual')}</option>
        <option value="team">{t('formulaEditor.entry_team')}</option>
      </select>
      {entry.kind === 'team' && (
        <>
          <label className="form-label" htmlFor={`${id}-entry-levels`}>
            {t('formulaEditor.entry_levels')}
          </label>
          <input
            id={`${id}-entry-levels`}
            type="text"
            className="form-input"
            value={levelsText}
            onChange={e => {
              setLevelsText(e.target.value);
              onChange({ kind: 'team', size: TEAM_SIZE, levels: stored(e.target.value) });
            }}
          />
          <small className="u-hint">{t('formulaEditor.entry_levels_hint')}</small>
        </>
      )}
    </div>
  );
};

export default FormulaEntryFields;
