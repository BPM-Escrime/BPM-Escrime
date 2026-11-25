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
  applyFormulaOperations,
  formulaView,
  type FormulaOperation,
} from '../../../shared/domain/formula/formulaOperations';
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
  const view = formulaView({
    weapon: comp.weapon,
    category: comp.category,
    settings: comp.settings,
  });
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
  return updateCompetitionSettings(ctx, {
    competitionId: comp.id,
    settings: templateToSettings(template, comp.weapon, comp.settings),
    dryRun: input.dryRun,
  });
}

export function updateCompetitionFormula(
  ctx: CommandContext,
  input: { competitionId: string; operations: FormulaOperation[]; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  let settings: Partial<CompetitionSettings>;
  try {
    settings = applyFormulaOperations(
      { weapon: comp.weapon, category: comp.category, settings: comp.settings },
      input.operations,
      newPhaseId
    );
  } catch (e) {
    if (e instanceof FormulaOperationError) throw new CommandError('invalid_settings', e.message);
    throw e;
  }
  return updateCompetitionSettings(ctx, {
    competitionId: comp.id,
    settings,
    dryRun: input.dryRun,
  });
}
