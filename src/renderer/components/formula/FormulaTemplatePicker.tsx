/**
 * BPM - Escrime - Sélecteur de modèle de formule (#2013 étape B2, docs/adr/0033)
 * Recherche, modèles fournis (lecture seule) et personnels, état Standard / Adaptée / Libre
 * calculé, « Revenir au modèle », « Enregistrer comme modèle » (copie personnelle).
 * Licensed under GPL-3.0
 */

import React, { useId, useState } from 'react';
import { Search } from 'lucide-react';
import type {
  FormulaDeviation,
  FormulaState,
  FormulaTemplate,
} from '../../../shared/domain/formula/formulaTemplate';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../common/Button';

type Translate = (key: string, params?: { [key: string]: string | number }) => string;

/** Libellé d'un modèle : traduit pour un modèle fourni, saisi pour un modèle personnel */
export function templateLabel(t: FormulaTemplate, tr: Translate): string {
  return t.source === 'provided' && t.code ? tr(`formulaTemplates.name_${t.code}`) : t.name;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Props {
  templates: FormulaTemplate[];
  selectedId: string | null;
  onSelect: (template: FormulaTemplate) => void;
  state: FormulaState;
  deviations: FormulaDeviation[];
  onReset?: () => void;
  /** Enregistre la formule courante comme modèle personnel ; absent : hors poste */
  onSaveAs?: (name: string) => Promise<void>;
}

export const FormulaTemplatePicker: React.FC<Props> = ({
  templates,
  selectedId,
  onSelect,
  state,
  deviations,
  onReset,
  onSaveAs,
}) => {
  const { t } = useTranslation();
  const searchId = useId();
  const selectId = useId();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const shown = text.trim()
    ? templates.filter(tpl => fold(templateLabel(tpl, t)).includes(fold(text)))
    : templates;
  const selected = templates.find(tpl => tpl.id === selectedId);
  const options = selected && !shown.includes(selected) ? [selected, ...shown] : shown;
  const provided = options.filter(o => o.source === 'provided');
  const personal = options.filter(o => o.source === 'personal');

  const badge =
    state === 'standard'
      ? t('formulaEditor.state_standard')
      : state === 'adapted'
        ? t('formulaTemplates.state_adapted', { count: deviations.length })
        : t('formulaTemplates.state_free');

  const save = async () => {
    if (!onSaveAs || saving === null || !saving.trim()) return;
    try {
      await onSaveAs(saving.trim());
      setSaving(null);
      setMessage({ ok: true, text: t('formulaTemplates.saved') });
    } catch {
      setMessage({ ok: false, text: t('formulaTemplates.save_error') });
    }
  };

  return (
    <div className="formula-picker" data-testid="formula-picker">
      <div className="formula-picker__row">
        <label className="formula-picker__search" htmlFor={searchId}>
          <Search size={14} aria-hidden="true" />
          <input
            id={searchId}
            type="search"
            className="form-input"
            value={text}
            placeholder={t('formulaTemplates.search_ph')}
            aria-label={t('formulaTemplates.search_ph')}
            onChange={e => setText(e.target.value)}
          />
        </label>
        <select
          id={selectId}
          className="form-input form-select formula-picker__select"
          aria-label={t('formulaTemplates.template')}
          data-testid="formula-template-select"
          value={selectedId ?? ''}
          onChange={e => {
            const tpl = templates.find(x => x.id === e.target.value);
            if (tpl) onSelect(tpl);
          }}
        >
          {!selected && <option value="">{t('formulaTemplates.state_free')}</option>}
          {provided.length > 0 && (
            <optgroup label={t('formulaTemplates.provided')}>
              {provided.map(o => (
                <option key={o.id} value={o.id}>
                  {templateLabel(o, t)}
                </option>
              ))}
            </optgroup>
          )}
          {personal.length > 0 && (
            <optgroup label={t('formulaTemplates.personal')}>
              {personal.map(o => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <span
          className={`formula-collapsed__badge is-${state}`}
          data-testid="formula-state"
          title={deviations.map(d => d.field).join(', ')}
        >
          {badge}
        </span>
        {state === 'adapted' && onReset && (
          <Button type="button" variant="ghost" onClick={onReset}>
            {t('formulaTemplates.reset')}
          </Button>
        )}
      </div>
      {onSaveAs && (
        <div className="formula-picker__row">
          {saving === null ? (
            <Button
              type="button"
              variant="ghost"
              data-testid="formula-save-as"
              onClick={() => {
                setMessage(null);
                setSaving('');
              }}
            >
              {t('formulaTemplates.save_as')}
            </Button>
          ) : (
            <>
              <input
                type="text"
                className="form-input formula-picker__name"
                maxLength={80}
                autoFocus
                value={saving}
                placeholder={t('formulaTemplates.save_name_ph')}
                aria-label={t('formulaTemplates.save_name_ph')}
                data-testid="formula-save-name"
                onChange={e => setSaving(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void save();
                  }
                }}
              />
              <Button
                type="button"
                variant="primary"
                disabled={!saving.trim()}
                data-testid="formula-save-confirm"
                onClick={() => void save()}
              >
                {t('formulaTemplates.save')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSaving(null)}>
                {t('actions.cancel')}
              </Button>
            </>
          )}
          {message && (
            <span
              role="status"
              data-testid="formula-save-status"
              className={message.ok ? 'formula-picker__ok' : 'formula-picker__error'}
            >
              {message.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default FormulaTemplatePicker;
