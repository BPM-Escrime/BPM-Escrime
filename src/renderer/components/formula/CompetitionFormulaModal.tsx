/**
 * BPM - Escrime - Organisation ▸ Formule (#2013 D11, docs/adr/0032)
 * Formule d'une épreuve existante dans l'interface unique. Enregistre les mêmes réglages que
 * l'onglet Formule des Propriétés (réglages plats, ou formule de l'arme « Autre »).
 * Licensed under GPL-3.0
 */

import React, { useState } from 'react';
import {
  Competition,
  CompetitionSettings,
  CustomFormulaConfig,
  Weapon,
} from '../../../shared/types';
import {
  FormulaDraft,
  draftFromSettings,
  draftToSettings,
} from '../../../shared/domain/formula/formulaDraft';
import { normalizeCustomFormula } from '../../../shared/domain/formula/formulaFrieze';
import {
  deriveSettingsFromFormula,
  isRapieresMode,
} from '../../../shared/utils/customFormulaSettings';
import { createDefaultCustomFormula } from '../../../shared/utils/tournamentTemplates';
import { useTranslation } from '../../hooks/useTranslation';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { FormulaEditor } from './FormulaEditor';

/** Réglages enregistrés après modification de la formule (fonction pure, testée) */
export function formulaSettingsUpdate(
  competition: Pick<Competition, 'weapon' | 'settings'>,
  draft: FormulaDraft,
  customFormula: CustomFormulaConfig
): CompetitionSettings {
  const settings = (competition.settings ?? {}) as CompetitionSettings;
  if (competition.weapon === Weapon.CUSTOM) {
    const norm = normalizeCustomFormula(customFormula);
    return { ...settings, customFormula: norm, ...deriveSettingsFromFormula(norm) };
  }
  return {
    ...settings,
    ...draftToSettings(draft, competition.weapon, settings.questConfig),
  };
}

interface Props {
  competition: Competition;
  onSave: (updates: Partial<Competition>) => void | Promise<void>;
  onClose: () => void;
}

export const CompetitionFormulaModal: React.FC<Props> = ({ competition, onSave, onClose }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<FormulaDraft>(() =>
    draftFromSettings(competition.weapon, competition.category, competition.settings)
  );
  const [customFormula, setCustomFormula] = useState<CustomFormulaConfig>(
    () => competition.settings?.customFormula ?? createDefaultCustomFormula()
  );
  const [saving, setSaving] = useState(false);
  const rapieres = isRapieresMode(competition.weapon, competition.settings);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ settings: formulaSettingsUpdate(competition, draft, customFormula) });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t('formulaEditor.modal_title')}
      onClose={onClose}
      size="xl"
      scroll
      closeOnOverlay={false}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving}
            data-testid="formula-modal-save"
            onClick={() => void save()}
          >
            {t('actions.save')}
          </Button>
        </>
      }
    >
      <FormulaEditor
        weapon={competition.weapon}
        category={competition.category}
        draft={draft}
        onDraftChange={patch => setDraft(prev => ({ ...prev, ...patch }))}
        customFormula={customFormula}
        onCustomChange={setCustomFormula}
        rapieres={rapieres}
      />
    </Modal>
  );
};

export default CompetitionFormulaModal;
