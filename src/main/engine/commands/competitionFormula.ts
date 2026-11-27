/**
 * BPM - Escrime - Formule d'une épreuve par le contrat et le MCP (#2013 étape B2, docs/adr/0033)
 * getCompetitionFormula, applyFormulaTemplate, updateCompetitionFormula. Grammaire et
 * validation du domaine (formulaFrieze, formulaOperations, validateFormulaSettings) ; écriture
 * par updateCompetitionSettings (même gel après tirage, même avis aux tablettes), sans
 * événement du journal (réglages, docs/adr/0018).
 * Licensed under GPL-3.0
 */
import { drawDone } from './fencers';
import { randomUUID } from 'crypto';
import type { Category, CompetitionSettings, Weapon } from '../../../shared/types';
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
import { formulaProgress, remarksMessage } from '../../../shared/domain/formula/formulaRemarks';
import {
  formulaDeviations,
  templateMatches,
  templateToSettings,
  type FormulaTemplate,
} from '../../../shared/domain/formula/formulaTemplate';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { updateCompetitionSettings } from './competitionSetup';
import { progressIssues } from '../../../shared/domain/formula/formulaStructure';
import { readSession } from './sessionView';
import { PHASE } from './sport';
import { allFormulaTemplates } from './formulaTemplates';
import { isArenaTeamEvent, withTeamMatch } from '../../../shared/domain/teams/teamMatchRule';
import { teamFormatOf } from '../../../shared/domain/teams/relay';

/**
 * Épreuve en arène Sabre Laser : sa formule reste celle d'un modèle fixe, non modifiable
 * (ADR-0044) ; refus de toute écriture (updateCompetitionFormula, applyFormulaTemplate,
 * updateCompetitionSettings avec `settings.formula`)
 */
export function assertFormulaWritable(comp: {
  isTeamEvent?: boolean;
  settings?: Partial<CompetitionSettings> | null;
}): void {
  if (isArenaTeamEvent(comp))
    throw new CommandError(
      'unsupported_format',
      'Arène Sabre Laser : la formule est celle d’un modèle fixe, non modifiable'
    );
}

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
  assertFormulaWritable(comp);
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

/** Formule enregistrée et avancement de l'épreuve (S6, docs/adr/0041) */
function storedProgress(
  ctx: CommandContext,
  comp: { id: string; weapon: Weapon; category: Category; settings?: CompetitionSettings },
  stored: FormulaV2 = formulaOf({
    weapon: comp.weapon,
    category: comp.category,
    settings: comp.settings,
  })
) {
  const session = readSession(ctx, comp.id);
  const progress = formulaProgress(stored, {
    ...session,
    questStarted: session.currentPhase === PHASE.quest,
  });
  return { stored, progress };
}

/**
 * Verrou S6 de toute écriture des réglages de la formule (docs/adr/0041, ADR-0043 F4b) :
 * `updateCompetitionSettings` (écran, MCP) passe ici comme `updateCompetitionFormula`. Seules
 * les remarques d'avancement sont jugées : une épreuve 2.0 hors bornes reste modifiable.
 */
export function assertProgressLock(
  ctx: CommandContext,
  comp: { id: string; weapon: Weapon; category: Category; settings?: CompetitionSettings },
  next: CompetitionSettings
): void {
  const { stored, progress } = storedProgress(ctx, comp);
  if (progress.phases.length === 0) return;
  const issues = progressIssues(
    formulaOf({ weapon: comp.weapon, category: comp.category, settings: next }),
    progress,
    stored
  );
  if (issues.length) throw new CommandError('invalid_settings', remarksMessage(issues));
}

/**
 * Écrit la formule v2 avec ses réglages plats dérivés (ADR-0036), après le jugement de la
 * formule (bornes, S1 à S6 ; une remarque par ligne avec la clé de sa phase, ADR-0041) ; `extra` :
 * autres réglages écrits avec elle (origine, mode spécial). Phases commencées (S6) : lues dans
 * l'état de session, par rapport à la formule enregistrée.
 */
export function writeFormula(
  ctx: CommandContext,
  comp: {
    id: string;
    weapon: Weapon;
    category: Category;
    isTeamEvent?: boolean;
    settings?: CompetitionSettings;
  },
  written: FormulaV2,
  extra: Partial<CompetitionSettings>,
  dryRun?: boolean
) {
  // Arène Sabre Laser : formule d'un modèle fixe, non modifiable (ADR-0044)
  assertFormulaWritable(comp);
  const { stored, progress } = storedProgress(ctx, comp);
  // Épreuve par équipes en relais FIE : la formule écrite porte sa règle de rencontre et fait
  // foi pour les phases ; ailleurs, `teamMatch` est retiré (ADR-0044)
  const formula = withTeamMatch(written, comp);
  const issues = formulaV2Issues(
    formula,
    {
      weapon: comp.weapon,
      isTeamEvent: !!comp.isTeamEvent,
      fencerCount: ctx.db.getFencersByCompetition(comp.id).length,
      teamFormat: teamFormatOf(comp.settings),
      teamCount: comp.isTeamEvent ? ctx.db.teams.getTeamsByCompetition(comp.id).length : undefined,
    },
    progress,
    stored
  );
  if (issues.length) throw new CommandError('invalid_settings', remarksMessage(issues));
  // Épreuve enregistrée en mode spécial rapières : la formule écrite fait désormais foi, le mode
  // n'est plus lu (docs/adr/0043, F4e) ; après le tirage, la clé reste (figée), la formule gardant
  // ses briques par la lecture de compatibilité
  const clearSpecial =
    comp.settings?.specialMode && !drawDone(ctx, comp.id) ? { specialMode: undefined } : {};
  return updateCompetitionSettings(ctx, {
    competitionId: comp.id,
    settings: { ...extra, ...flatSettingsOf(formula, comp.weapon), formula, ...clearSpecial },
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
