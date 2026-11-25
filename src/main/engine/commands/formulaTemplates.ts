/**
 * BPM - Escrime - Modèles de formule (#2013 étape B2, docs/adr/0033)
 * Fournis : catalogue du domaine, lecture seule. Personnels : app_settings (clé
 * formulaTemplates), sans journal (fonction du poste, ADR-0022). Règles : shared/domain/formula.
 * Licensed under GPL-3.0
 */
import { randomUUID } from 'crypto';
import {
  filterTemplates,
  standardTemplate,
  type FormulaTemplate,
} from '../../../shared/domain/formula/formulaTemplate';
import { providedTemplates } from '../../../shared/domain/formula/presets/bpmTemplates';
import { CommandError, type CommandContext } from './context';
import { refuse, type StationHandler } from './stationSupport';

const personalOf = (ctx: CommandContext): FormulaTemplate[] =>
  ctx.db.settings.getSetting('formulaTemplates') ?? [];

/** Tous les modèles : fournis puis personnels */
export function allFormulaTemplates(ctx: CommandContext): FormulaTemplate[] {
  return [...providedTemplates(), ...personalOf(ctx)];
}

const isProvided = (id: string) => providedTemplates().some(t => t.id === id);

type TemplateOps = 'listFormulaTemplates' | 'saveFormulaTemplate' | 'deleteFormulaTemplate';

export const formulaTemplateHandlers: { [N in TemplateOps]: StationHandler<N> } = {
  listFormulaTemplates: (ctx, { weapon, category, isTeamEvent, text }) =>
    refuse(() => {
      const all = allFormulaTemplates(ctx);
      const templates = filterTemplates(all, { weapon, category, isTeamEvent, text });
      const standard = weapon
        ? standardTemplate(all, { weapon, category, isTeamEvent })
        : undefined;
      return { templates, standardId: standard?.id ?? null };
    }),
  saveFormulaTemplate: (ctx, input) => {
    if (input.id && isProvided(input.id)) {
      throw new CommandError(
        'station_refused',
        'Modèle fourni par l’application : enregistrez une copie (sans « id »)'
      );
    }
    return refuse(() => {
      const personal = personalOf(ctx);
      const template: FormulaTemplate = {
        id: input.id ?? `perso/${randomUUID()}`,
        source: 'personal',
        name: input.name.trim(),
        ...(input.applies ? { applies: input.applies } : {}),
        ...(input.origin ? { origin: input.origin } : {}),
        body: input.body,
        savedAt: new Date().toISOString(),
      };
      const index = personal.findIndex(t => t.id === template.id);
      const next =
        index >= 0 ? personal.map((t, i) => (i === index ? template : t)) : [...personal, template];
      ctx.db.settings.updateSettings({ formulaTemplates: next });
      ctx.emitChange?.({ scope: 'settings', competitionIds: [] });
      return { template };
    });
  },
  deleteFormulaTemplate: (ctx, { id }) => {
    if (isProvided(id)) {
      throw new CommandError(
        'station_refused',
        'Modèle fourni par l’application : non supprimable'
      );
    }
    const personal = personalOf(ctx);
    if (!personal.some(t => t.id === id)) {
      throw new CommandError('formula_template_not_found', `Modèle de formule inconnu : ${id}`);
    }
    return refuse(() => {
      ctx.db.settings.updateSettings({ formulaTemplates: personal.filter(t => t.id !== id) });
      ctx.emitChange?.({ scope: 'settings', competitionIds: [] });
    });
  },
};
