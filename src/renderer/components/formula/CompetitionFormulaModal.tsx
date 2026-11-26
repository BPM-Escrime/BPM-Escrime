/**
 * BPM - Escrime - Organisation ▸ Formule (#2013 D11 ; docs/adr/0032, 0033, 0034)
 * Formule v2 d'une épreuve existante dans l'interface unique, réglages de chaque tour compris.
 * Écrite par les mêmes commandes que l'agent : applyFormulaTemplate (autre modèle), puis
 * updateCompetitionFormula (opérations calculées par le domaine).
 * Licensed under GPL-3.0
 */

import React, { useState } from 'react';
import { Competition, CompetitionSettings, Weapon } from '../../../shared/types';
import { ApiError } from '../../../shared/api/client';
import { isRapieresMode } from '../../../shared/utils/customFormulaSettings';
import {
  flatSettingsOf,
  formulaOf,
  type FormulaV2,
} from '../../../shared/domain/formula/formulaV2';
import {
  formulaV2Issues,
  operationsBetweenV2,
} from '../../../shared/domain/formula/formulaV2Operations';
import type { FormulaProgress } from '../../../shared/domain/formula/formulaRemarks';
import {
  formulaDeviations,
  templateToSettings,
  type FormulaTemplate,
  type FormulaTemplateBody,
} from '../../../shared/domain/formula/formulaTemplate';
import { useTranslation } from '../../hooks/useTranslation';
import { useFormulaTemplates } from '../../hooks/useFormulaTemplates';
import { useBpmClient } from '../../api/BpmClientContext';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useToast } from '../Toast';
import { FormulaEditor } from './FormulaEditor';
import { FormulaTemplatePicker } from './FormulaTemplatePicker';

/** Réglages de l'épreuve après modification de la formule (affichage immédiat, fonction pure) */
export function formulaSettingsUpdate(
  competition: Pick<Competition, 'weapon' | 'settings'>,
  formula: FormulaV2
): CompetitionSettings {
  return {
    ...((competition.settings ?? {}) as CompetitionSettings),
    ...flatSettingsOf(formula, competition.weapon),
    formula,
  };
}

interface Props {
  competition: Competition;
  /** Phases déjà commencées de l'épreuve (S6, ADR-0041) ; absent : rien de commencé */
  progress?: FormulaProgress;
  /** Réglages écrits par le moteur : mise à jour de l'écran (aucune écriture ici) */
  onApplied: (settings: CompetitionSettings) => void;
  onClose: () => void;
}

export const CompetitionFormulaModal: React.FC<Props> = ({
  competition,
  progress,
  onApplied,
  onClose,
}) => {
  const { t } = useTranslation();
  const client = useBpmClient();
  const { showToast } = useToast();
  const { weapon, category } = competition;
  const [formula, setFormula] = useState<FormulaV2>(() => formulaOf(competition));
  const [saving, setSaving] = useState(false);
  const rapieres = isRapieresMode(weapon, competition.settings);
  // Modèle d'origine (docs/adr/0033) : gardé tant qu'on n'en choisit pas un autre
  const [origin, setOrigin] = useState(competition.settings?.formulaOrigin);
  const [specialMode, setSpecialMode] = useState(competition.settings?.specialMode);
  const templates = useFormulaTemplates({
    weapon,
    category,
    isTeamEvent: !!competition.isTeamEvent,
  });

  // Jugement en direct (ADR-0041) : mêmes fonctions que le moteur, qui reste le dernier rempart
  const knownFencerCount = competition.fencerCount || undefined;
  const remarks = formulaV2Issues(
    formula,
    { weapon, isTeamEvent: !!competition.isTeamEvent, fencerCount: knownFencerCount },
    progress
  );

  const nextSettings = (): CompetitionSettings => ({
    ...formulaSettingsUpdate(competition, formula),
    ...(weapon === Weapon.CUSTOM ? { specialMode } : {}),
    formulaOrigin: origin,
  });
  const { state, deviations } = formulaDeviations(
    { weapon, category, settings: nextSettings() },
    templates.all
  );
  const selected = origin ? templates.all.find(x => x.id === origin.templateId) : undefined;

  /** Formule v2 d'un modèle appliqué aux réglages actuels de l'épreuve */
  const formulaOfTemplate = (tpl: FormulaTemplate) =>
    formulaOf({
      weapon,
      category,
      settings: {
        ...competition.settings,
        formula: undefined,
        ...templateToSettings(tpl, weapon, competition.settings),
      },
    });

  const selectTemplate = (tpl: FormulaTemplate) => {
    setOrigin({ templateId: tpl.id, ...(tpl.season ? { season: tpl.season } : {}) });
    setFormula(formulaOfTemplate(tpl));
    if (tpl.body.kind !== 'draft') setSpecialMode(tpl.body.specialMode);
  };

  const saveAs = async (name: string) => {
    const body: FormulaTemplateBody = {
      kind: 'formula',
      formula,
      ...(weapon === Weapon.CUSTOM ? { other: true } : {}),
      ...(weapon === Weapon.CUSTOM && specialMode ? { specialMode } : {}),
    };
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
    try {
      let base = formulaOf(competition);
      if (origin && origin.templateId !== competition.settings?.formulaOrigin?.templateId) {
        await client.call('applyFormulaTemplate', { competitionId, templateId: origin.templateId });
        const tpl = templates.all.find(x => x.id === origin.templateId);
        if (tpl) base = formulaOfTemplate(tpl);
      }
      const operations = operationsBetweenV2(base, formula);
      if (operations.length > 0) {
        await client.call('updateCompetitionFormula', { competitionId, operations });
      }
      onApplied(nextSettings());
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
            disabled={saving || remarks.length > 0}
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
        weapon={weapon}
        category={category}
        formula={formula}
        onChange={setFormula}
        rapieres={rapieres}
        fencerCount={competition.fencerCount || 32}
        isTeamEvent={!!competition.isTeamEvent}
        knownFencerCount={knownFencerCount}
        progress={progress}
        remarks={remarks}
      />
    </Modal>
  );
};

export default CompetitionFormulaModal;
