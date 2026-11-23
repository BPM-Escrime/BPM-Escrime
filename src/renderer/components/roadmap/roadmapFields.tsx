/**
 * BPM - Escrime - Champs de la feuille de route
 * Chaque champ texte se signale au focus : les pastilles de variables insèrent
 * « {date} », « {debut} »… à la position du curseur du dernier champ actif.
 * Licensed under GPL-3.0
 */

import React, { createContext, useCallback, useContext, useRef } from 'react';
import { ROADMAP_VARIABLES, type RoadmapVariable } from '@shared/domain/roadmap/roadmap';
import { useTranslation } from '../../hooks/useTranslation';
import { TimeInput24 } from '../common/TimeInput24';

type FieldEl = HTMLInputElement | HTMLTextAreaElement;

interface ActiveField {
  el: FieldEl;
  set: (value: string) => void;
}

interface FieldFocusApi {
  register: (field: ActiveField) => void;
  insert: (snippet: string) => void;
}

const FieldFocusContext = createContext<FieldFocusApi | null>(null);

export const FieldFocusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const active = useRef<ActiveField | null>(null);
  const register = useCallback((field: ActiveField) => {
    active.current = field;
  }, []);
  const insert = useCallback((snippet: string) => {
    const field = active.current;
    if (!field || !field.el.isConnected) return;
    const { el } = field;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    field.set(el.value.slice(0, start) + snippet + el.value.slice(end));
    // Curseur après l'insertion, une fois la valeur rendue
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }, []);
  return (
    <FieldFocusContext.Provider value={{ register, insert }}>{children}</FieldFocusContext.Provider>
  );
};

const useFieldFocus = () => useContext(FieldFocusContext);

interface TextFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  type?: 'text' | 'email' | 'date' | 'time';
  className?: string;
  /** Champ sans libellé visible (tableaux) */
  ariaLabel?: string;
}

/** Hauteur de la zone de texte : nombre de lignes du contenu, bornée */
const autoRows = (value: string, min: number) =>
  Math.min(14, Math.max(min, value.split('\n').length + 1));

export const TextField: React.FC<TextFieldProps> = ({
  label,
  value,
  onChange,
  multiline,
  rows = 2,
  placeholder,
  type = 'text',
  className,
  ariaLabel,
}) => {
  const focus = useFieldFocus();
  const onFocus = (e: React.FocusEvent<FieldEl>) =>
    focus?.register({ el: e.currentTarget, set: onChange });
  const control =
    type === 'time' ? (
      <TimeInput24 className="roadmap-input" value={value} onChange={onChange} />
    ) : multiline ? (
      <textarea
        className="roadmap-input"
        value={value}
        rows={autoRows(value, rows)}
        placeholder={placeholder}
        aria-label={label ? undefined : ariaLabel}
        onFocus={onFocus}
        onChange={e => onChange(e.target.value)}
      />
    ) : (
      <input
        className="roadmap-input"
        type={type}
        value={value}
        placeholder={placeholder}
        aria-label={label ? undefined : ariaLabel}
        onFocus={type === 'text' || type === 'email' ? onFocus : undefined}
        onChange={e => onChange(e.target.value)}
      />
    );
  if (!label) return control;
  return (
    <label className={`roadmap-field ${className ?? ''}`}>
      <span className="roadmap-field-label">{label}</span>
      {control}
    </label>
  );
};

/** Pastilles cliquables : insèrent la variable dans le dernier champ actif */
export const VariableChips: React.FC = () => {
  const { t } = useTranslation();
  const focus = useFieldFocus();
  const chip = (name: RoadmapVariable) => `{${name}}`;
  return (
    <div className="roadmap-vars">
      <div className="roadmap-vars-head">
        <strong>{t('roadmap.variables')}</strong>
        <span className="roadmap-muted">{t('roadmap.variables_hint')}</span>
      </div>
      <div className="roadmap-vars-list">
        {ROADMAP_VARIABLES.map(v => (
          <button
            key={v}
            type="button"
            className="roadmap-chip"
            title={t(`roadmap.var_${v}`)}
            // Garde le focus dans le champ : l'insertion lit sa sélection
            onMouseDown={e => e.preventDefault()}
            onClick={() => focus?.insert(chip(v))}
          >
            {chip(v)}
          </button>
        ))}
      </div>
    </div>
  );
};
