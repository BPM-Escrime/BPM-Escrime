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
import { useBpmClient } from '../../api/BpmClientContext';
import { ApiError } from '../../../shared/api/client';
import { useToast } from '../Toast';
import { formulaOperationsBetween } from '../../../shared/domain/formula/formulaOperations';
import { FormulaTemplatePicker } from './FormulaTemplatePicker';
import { useFormulaTemplates } from '../../hooks/useFormulaTemplates';
import {
  formulaDeviations,
  templateToSettings,
  type FormulaTemplate,
  type FormulaTemplateBody,
} from '../../../shared/domain/formula/formulaTemplate';

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
  /** Réglages écrits par le moteur : mise à jour de l'écran (aucune écriture ici) */
  onApplied: (settings: CompetitionSettings) => void;
  onClose: () => void;
}

export const CompetitionFormulaModal: React.FC<Props> = ({ competition, onApplied, onClose }) => {
  const { t } = useTranslation();
  const client = useBpmClient();
  const { showToast } = useToast();
  const [draft, setDraft] = useState<FormulaDraft>(() =>
    draftFromSettings(competition.weapon, competition.category, competition.settings)
  );
  const [customFormula, setCustomFormula] = useState<CustomFormulaConfig>(
    () => competition.settings?.customFormula ?? createDefaultCustomFormula()
  );
  const [saving, setSaving] = useState(false);
  const rapieres = isRapieresMode(competition.weapon, competition.settings);
  // Modèle d'origine (docs/adr/0033) : gardé tant qu'on n'en choisit pas un autre
  const [origin, setOrigin] = useState(competition.settings?.formulaOrigin);
  const [specialMode, setSpecialMode] = useState(competition.settings?.specialMode);
  const templates = useFormulaTemplates({
    weapon: competition.weapon,
    category: competition.category,
    isTeamEvent: !!competition.isTeamEvent,
  });

  const nextSettings = (): CompetitionSettings => ({
    ...formulaSettingsUpdate(competition, draft, customFormula),
    ...(competition.weapon === Weapon.CUSTOM ? { specialMode } : {}),
    formulaOrigin: origin,
  });
  const { state, deviations } = formulaDeviations(
    { weapon: competition.weapon, category: competition.category, settings: nextSettings() },
    templates.all
  );
  const selected = origin ? templates.all.find(x => x.id === origin.templateId) : undefined;

  const selectTemplate = (tpl: FormulaTemplate) => {
    setOrigin({ templateId: tpl.id, ...(tpl.season ? { season: tpl.season } : {}) });
    if (tpl.body.kind === 'draft') setDraft(tpl.body.draft);
    else {
      setCustomFormula(tpl.body.formula);
      setSpecialMode(tpl.body.specialMode);
    }
  };

  const saveAs = async (name: string) => {
    const body: FormulaTemplateBody =
      competition.weapon === Weapon.CUSTOM
        ? {
            kind: 'custom',
            formula: normalizeCustomFormula(customFormula),
            ...(specialMode ? { specialMode } : {}),
          }
        : { kind: 'draft', draft };
    const from = selected?.source === 'provided' ? origin : selected?.origin;
    const { template } = await templates.save({ name, body, ...(from ? { origin: from } : {}) });
    templates.reload();
    setOrigin({ templateId: template.id });
  };

  // Mêmes commandes que l'agent (docs/adr/0033, un fait, un chemin) : modèle choisi par
  // applyFormulaTemplate, puis modifications par updateCompetitionFormula
  const save = async () => {
    setSaving(true);
    const competitionId = competition.id;
    const target = nextSettings();
    try {
      let base = (competition.settings ?? {}) as CompetitionSettings;
      if (origin && origin.templateId !== competition.settings?.formulaOrigin?.templateId) {
        await client.call('applyFormulaTemplate', { competitionId, templateId: origin.templateId });
        const tpl = templates.all.find(x => x.id === origin.templateId);
        if (tpl) base = { ...base, ...templateToSettings(tpl, competition.weapon, base) };
      }
      const operations = formulaOperationsBetween(
        { weapon: competition.weapon, category: competition.category, settings: base },
        target
      );
      if (operations.length > 0) {
        await client.call('updateCompetitionFormula', { competitionId, operations });
      }
      onApplied(target);
      onClose();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t('formulaEditor.save_error'), 'error');
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
      <FormulaTemplatePicker
        templates={templates.templates}
        selectedId={selected?.id ?? null}
        onSelect={selectTemplate}
        state={state}
        deviations={deviations}
        onReset={selected ? () => selectTemplate(selected) : undefined}
        onSaveAs={templates.available ? saveAs : undefined}
      />
      <FormulaEditor
        weapon={competition.weapon}
        category={competition.category}
        draft={draft}
        onDraftChange={patch => setDraft(prev => ({ ...prev, ...patch }))}
        customFormula={customFormula}
        onCustomChange={setCustomFormula}
        rapieres={rapieres}
        fencerCount={competition.fencerCount || 32}
      />
    </Modal>
  );
};

export default CompetitionFormulaModal;
