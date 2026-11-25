/**
 * BPM - Escrime - Formule d'une épreuve par le contrat et le MCP (#2013 étape B2, docs/adr/0033)
 * getCompetitionFormula, applyFormulaTemplate, updateCompetitionFormula. Grammaire et
 * validation du domaine (formulaFrieze, formulaOperations, validateFormulaSettings) ; écriture
 * par updateCompetitionSettings (même gel après tirage, même avis aux tablettes), sans
 * événement du journal (réglages, docs/adr/0018).
 * Licensed under GPL-3.0
 */
import { randomUUID } from 'crypto';
import type { CompetitionSettings, Weapon } from '../../../shared/types';
import {
  FormulaOperationError,
  formulaView,
  type FormulaOperation,
} from '../../../shared/domain/formula/formulaOperations';
import {
  applyOperationsV2,
  formulaV2Issues,
  formulaViewV2,
} from '../../../shared/domain/formula/formulaV2Operations';
import {
  flatSettingsOf,
  formulaOf,
  type FormulaV2,
} from '../../../shared/domain/formula/formulaV2';
import {
  formulaDeviations,
  templateMatches,
  templateToSettings,
  type FormulaTemplate,
} from '../../../shared/domain/formula/formulaTemplate';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { updateCompetitionSettings } from './competitionSetup';
import { allFormulaTemplates } from './formulaTemplates';

const newPhaseId = () => `phase_${randomUUID()}`;

/** Modèle compatible avec l'arme, la catégorie et le type de l'épreuve, sinon refus */
export function compatibleTemplate(
  ctx: CommandContext,
  templateId: string,
  target: { weapon: Weapon; category?: string; isTeamEvent?: boolean }
): FormulaTemplate {
  const template = allFormulaTemplates(ctx).find(t => t.id === templateId);
  if (!template)
    throw new CommandError(
      'formula_template_not_found',
      `Modèle de formule inconnu : ${templateId}`
    );
  if (
    !templateMatches(template, {
      weapon: target.weapon,
      category: target.category as never,
      isTeamEvent: target.isTeamEvent,
    })
  ) {
    throw new CommandError(
      'invalid_settings',
      `Modèle « ${template.name} » incompatible avec l’arme, la catégorie ou le type de l’épreuve`
    );
  }
  return template;
}

export function getCompetitionFormula(ctx: CommandContext, input: { competitionId: string }) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const src = { weapon: comp.weapon, category: comp.category, settings: comp.settings };
  // Frise et cohérence sur la formule v2 (ADR-0036) ; draft / customFormula gardés pour l'agent
  const legacy = formulaView(src);
  const v2 = formulaViewV2(src);
  const view = { ...legacy, ...v2 };
  const { state, template, deviations } = formulaDeviations(
    { weapon: comp.weapon, category: comp.category, settings: comp.settings },
    allFormulaTemplates(ctx)
  );
  return {
    competitionId: comp.id,
    weapon: comp.weapon,
    category: comp.category,
    isTeamEvent: !!comp.isTeamEvent,
    specialMode: comp.settings?.specialMode ?? null,
    ...view,
    origin: comp.settings?.formulaOrigin ?? null,
    originName: template?.name ?? null,
    state,
    deviations,
  };
}

export function applyFormulaTemplate(
  ctx: CommandContext,
  input: { competitionId: string; templateId: string; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const template = compatibleTemplate(ctx, input.templateId, {
    weapon: comp.weapon,
    category: comp.category,
    isTeamEvent: !!comp.isTeamEvent,
  });
  const patch = templateToSettings(template, comp.weapon, comp.settings);
  const formula = formulaOf({
    weapon: comp.weapon,
    category: comp.category,
    settings: { ...comp.settings, ...patch, formula: undefined },
  });
  return writeFormula(ctx, comp, formula, patch, input.dryRun);
}

/**
 * Écrit la formule v2 avec ses réglages plats dérivés (ADR-0036), après le contrôle des bornes
 * de chaque tour ; `extra` : autres réglages écrits avec elle (origine, mode spécial).
 */
export function writeFormula(
  ctx: CommandContext,
  comp: { id: string; weapon: Weapon; isTeamEvent?: boolean },
  formula: FormulaV2,
  extra: Partial<CompetitionSettings>,
  dryRun?: boolean
) {
  const issues = formulaV2Issues(formula, { weapon: comp.weapon, isTeamEvent: !!comp.isTeamEvent });
  if (issues.length)
    throw new CommandError('invalid_settings', `Formule refusée : ${issues.join(' ; ')}`);
  return updateCompetitionSettings(ctx, {
    competitionId: comp.id,
    settings: { ...extra, ...flatSettingsOf(formula, comp.weapon), formula },
    dryRun,
  });
}

export function updateCompetitionFormula(
  ctx: CommandContext,
  input: { competitionId: string; operations: FormulaOperation[]; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  let formula: FormulaV2;
  try {
    formula = applyOperationsV2(
      { weapon: comp.weapon, category: comp.category, settings: comp.settings },
      input.operations,
      newPhaseId
    );
  } catch (e) {
    if (e instanceof FormulaOperationError) throw new CommandError('invalid_settings', e.message);
    throw e;
  }
  return writeFormula(ctx, comp, formula, {}, input.dryRun);
}
