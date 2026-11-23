/**
 * BPM - Escrime - Champs de la feuille de route
 * Chaque champ texte se signale au focus : les pastilles de variables insèrent
 * « {date} », « {debut} »… à la position du curseur du dernier champ actif ;
 * sans champ actif (ou clic droit), la pastille mène au champ qui lui donne sa valeur.
 * Licensed under GPL-3.0
 */

import React, { createContext, useCallback, useContext, useRef } from 'react';
import {
  ROADMAP_VARIABLES,
  type RoadmapInfo,
  type RoadmapVariable,
  type RoadmapVariables,
} from '@shared/domain/roadmap/roadmap';
import { useTranslation } from '../../hooks/useTranslation';
import { TimeInput } from '../common/TimeInput';

type FieldEl = HTMLInputElement | HTMLTextAreaElement;

interface ActiveField {
  el: FieldEl;
  set: (value: string) => void;
}

interface FieldFocusApi {
  register: (field: ActiveField) => void;
  /** Faux si aucun champ actif : rien n'est inséré */
  insert: (snippet: string) => boolean;
}

const FieldFocusContext = createContext<FieldFocusApi | null>(null);

export const FieldFocusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const active = useRef<ActiveField | null>(null);
  const register = useCallback((field: ActiveField) => {
    active.current = field;
  }, []);
  const insert = useCallback((snippet: string) => {
    const field = active.current;
    if (!field || !field.el.isConnected) return false;
    const { el } = field;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    field.set(el.value.slice(0, start) + snippet + el.value.slice(end));
    // Curseur après l'insertion, une fois la valeur rendue
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + snippet.length, start + snippet.length);
    });
    return true;
  }, []);
  return (
    <FieldFocusContext.Provider value={{ register, insert }}>{children}</FieldFocusContext.Provider>
  );
};

const useFieldFocus = () => useContext(FieldFocusContext);

/** Identifiant DOM d'un champ de l'essentiel (variable ou rubrique manquante → son champ) */
export const infoFieldId = (key: keyof RoadmapInfo) => `roadmap-info-${key}`;

interface TextFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  type?: 'text' | 'email' | 'date' | 'time';
  className?: string;
  /** Variables alimentées par ce champ (badges à côté du libellé) */
  variables?: RoadmapVariable[];
  /** Champ sans libellé visible (tableaux) */
  ariaLabel?: string;
  id?: string;
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
  id,
  variables,
}) => {
  const focus = useFieldFocus();
  const onFocus = (e: React.FocusEvent<FieldEl>) =>
    focus?.register({ el: e.currentTarget, set: onChange });
  const control =
    type === 'time' ? (
      <TimeInput id={id} className="roadmap-input" value={value} onChange={onChange} />
    ) : multiline ? (
      <textarea
        id={id}
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
        id={id}
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
      <FieldLabel label={label} variables={variables} />
      {control}
    </label>
  );
};

/** Libellé d'un champ de l'essentiel, suivi des variables qu'il alimente */
export const FieldLabel: React.FC<{ label: string; variables?: RoadmapVariable[] }> = ({
  label,
  variables,
}) => {
  const { t } = useTranslation();
  const names = variables?.map(v => `{${v}}`) ?? [];
  return (
    <span className="roadmap-field-label">
      {label}
      {names.length > 0 && (
        <span
          className="roadmap-field-vars"
          title={t('roadmap.field_feeds', { names: names.join(', ') })}
        >
          {names.map(n => (
            <code key={n}>{n}</code>
          ))}
        </span>
      )}
    </span>
  );
};

/**
 * Pastilles : clic → insertion dans le dernier champ actif, sinon champ source ;
 * clic droit → champ source ; survol → valeur
 */
export const VariableChips: React.FC<{
  vars: RoadmapVariables;
  onGoTo?: (name: RoadmapVariable) => void;
}> = ({ vars, onGoTo }) => {
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
            className={`roadmap-chip${vars[v] ? '' : ' is-missing'}`}
            title={`${t(`roadmap.var_${v}`)} : ${vars[v] || t('roadmap.variable_empty')}`}
            // Garde le focus dans le champ : l'insertion lit sa sélection
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              if (!focus?.insert(chip(v))) onGoTo?.(v);
            }}
            onContextMenu={e => {
              if (!onGoTo) return;
              e.preventDefault();
              onGoTo(v);
            }}
          >
            {chip(v)}
          </button>
        ))}
      </div>
    </div>
  );
};
