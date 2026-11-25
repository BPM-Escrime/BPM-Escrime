/**
 * BPM - Escrime - Paramètres → Système → Nouvelle interface de formule (aperçu)
 * Réglage du poste (#2013 D13, docs/adr/0032) : n'agit que sur l'écran.
 * Licensed under GPL-3.0
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from './Toast';
import { stationAvailable, useStationApi } from '../api/stationApi';
import { notifyFormulaPreviewChanged } from '../hooks/useFormulaPreview';
import { HINT, BOLD, TOGGLE_LABEL } from './settingsModal.styles';

export const FormulaPreviewSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const api = useStationApi().settings;
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .get()
      .then(s => {
        if (alive) setEnabled(s.formulaPreview === true);
      })
      .catch(() => {
        if (alive) setEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, [api]);

  if (!stationAvailable()) return null;

  const handleChange = async (checked: boolean) => {
    setEnabled(checked);
    try {
      const s = await api.update({ formulaPreview: checked });
      const value = s.formulaPreview === true;
      setEnabled(value);
      notifyFormulaPreviewChanged(value);
    } catch {
      setEnabled(!checked);
      showToast(t('settings.formula_preview_error'), 'error');
    }
  };

  return (
    <div className="form-group">
      <label style={BOLD}>{t('settings.formula_preview_title')}</label>
      <p style={HINT}>{t('settings.formula_preview_hint')}</p>
      <label className="u-row cursor-pointer">
        <input
          type="checkbox"
          data-testid="formula-preview-toggle"
          checked={enabled === true}
          disabled={enabled === null}
          onChange={e => void handleChange(e.target.checked)}
        />
        <span style={TOGGLE_LABEL}>{t('settings.formula_preview_enable')}</span>
      </label>
    </div>
  );
};

export default FormulaPreviewSettingsSection;
