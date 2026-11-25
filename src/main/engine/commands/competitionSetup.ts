/**
 * BPM - Escrime - Création, réglages et suppression d'une épreuve (#1981, docs/adr/0018)
 * createCompetition, updateCompetitionDetails, updateCompetitionSettings, deleteCompetition :
 * commandes d'intention à la place de db.createCompetition / updateCompetition /
 * deleteCompetition. Pas de journal (docs/adr/0018).
 * Licensed under GPL-3.0
 */
import {
  type Category,
  type Gender,
  type Weapon,
  type Competition,
  type CompetitionSettings,
} from '../../../shared/types';
import {
  buildDefaultCompetitionSettings,
  getFallbackCompetitionSettings,
} from '../../../shared/utils/defaultCompetitionSettings';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { drawDone } from './fencers';
import { compatibleTemplate } from './competitionFormula';
import { templateToSettings } from '../../../shared/domain/formula/formulaTemplate';
import { formulaOf } from '../../../shared/domain/formula/formulaV2';
import {
  validateFormulaSettings,
  type FormulaIssue,
} from '../../../shared/domain/formula/validateFormulaSettings';

/** Formule hors bornes ou incohérente : refus avec le détail (docs/adr/0012) */
function assertFormula(issues: FormulaIssue[]): void {
  if (issues.length === 0) return;
  throw new CommandError(
    'invalid_settings',
    `Réglages refusés : ${issues.map(i => `${i.field} (${i.message})`).join(' ; ')}`
  );
}

/**
 * Réglages plats de la formule : écrits sans `formula` (anciennes fenêtres, agent par
 * updateCompetitionSettings), ils rendent la formule v2 enregistrée périmée. Elle est alors
 * retirée et reconstruite à la lecture depuis ces réglages (ADR-0036).
 */
const FORMULA_FLAT_KEYS: ReadonlySet<string> = new Set([
  'poolRounds',
  'poolRoundQualifiers',
  'hasDirectElimination',
  'defaultPoolMaxScore',
  'defaultTableMaxScore',
  'defaultPoolTimerSeconds',
  'defaultTableTimerSeconds',
  'restTimeSeconds',
  'thirdPlaceMatch',
  'playAllPositions',
  'poolWinnersOnly',
  'postPoolSplitCriteria',
  'poolBoutOrder',
  'poolSizeMin',
  'poolSizeMax',
  'questConfig',
  'customFormula',
]);

/** Réglages figés une fois les poules tirées (ou le tableau généré) : ils changent les règles */
const FROZEN_SETTINGS: ReadonlySet<string> = new Set(['specialMode', 'customFormula']);

/** Épreuve exposée par le contrat (getCompetition, listCompetitions) : dates en ISO 8601 */
export function competitionDTO(c: Competition) {
  const iso = (d: unknown) => new Date((d as Date | string | undefined) ?? 0).toISOString();
  return {
    id: c.id,
    title: c.title,
    shortTitle: c.shortTitle ?? null,
    date: iso(c.date),
    location: c.location || null,
    organizer: c.organizer || null,
    weapon: c.weapon,
    gender: c.gender,
    category: c.category,
    championship: c.championship ?? null,
    color: c.color ?? null,
    isTeamEvent: !!c.isTeamEvent,
    status: c.status ?? null,
    fencerCount: c.fencerCount ?? null,
    settings: c.settings ?? {},
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  };
}

export interface CreateCompetitionInput {
  title: string;
  date: string;
  weapon: Weapon;
  gender: Gender;
  category: Category;
  location?: string;
  color?: string;
  isTeamEvent?: boolean;
  /** Modèle de formule de départ (docs/adr/0033), appliqué avant `settings` */
  templateId?: string;
  /** Réglages choisis à la création, fusionnés sur les défauts du moteur */
  settings?: Partial<CompetitionSettings>;
  dryRun?: boolean;
}

export function createCompetition(ctx: CommandContext, input: CreateCompetitionInput) {
  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) throw new CommandError('invalid_date', 'Date invalide');
  const patch = input.settings ?? {};
  // Arme sans défaut de création (undefined) : réglages de repli, la base exige les touches
  const defaults =
    buildDefaultCompetitionSettings({
      weapon: input.weapon,
      category: input.category,
      isTeamEvent: !!input.isTeamEvent,
    }) ?? getFallbackCompetitionSettings(input.weapon, input.category);
  const fromTemplate = input.templateId
    ? templateToSettings(
        compatibleTemplate(ctx, input.templateId, {
          weapon: input.weapon,
          category: input.category,
          isTeamEvent: !!input.isTeamEvent,
        }),
        input.weapon,
        defaults
      )
    : {};
  const merged = {
    ...defaults,
    ...fromTemplate,
    ...patch,
  } as CompetitionSettings;
  // Modèle choisi : formule v2 enregistrée dès la création (ADR-0036)
  const settings: CompetitionSettings =
    input.templateId && !merged.formula
      ? {
          ...merged,
          formula: formulaOf({ weapon: input.weapon, category: input.category, settings: merged }),
        }
      : merged;
  assertFormula(
    validateFormulaSettings(settings, undefined, {
      weapon: input.weapon,
      isTeamEvent: !!input.isTeamEvent,
    })
  );
  if (input.dryRun) return { dryRun: true, competitionId: null };
  const created = ctx.db.createCompetition({
    title: input.title.trim(),
    date,
    weapon: input.weapon,
    gender: input.gender,
    category: input.category,
    ...(input.location ? { location: input.location } : {}),
    ...(input.color ? { color: input.color } : {}),
    isTeamEvent: !!input.isTeamEvent,
    settings,
  });
  ctx.emitChange?.({ scope: 'competitions', competitionIds: [created.id] });
  return { dryRun: false, competitionId: created.id };
}

export interface CompetitionDetailsInput {
  title?: string;
  date?: string;
  location?: string | null;
  organizer?: string | null;
}

/** Titre, date, lieu, organisateur : données sans règle */
export function updateCompetitionDetails(
  ctx: CommandContext,
  input: { competitionId: string; details: CompetitionDetailsInput; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const d = input.details;
  const patch: Partial<Competition> = {};
  if (d.title !== undefined) {
    if (!d.title.trim()) throw new CommandError('invalid_title', 'Le titre est obligatoire');
    patch.title = d.title.trim();
  }
  if (d.date !== undefined) {
    const date = new Date(d.date);
    if (Number.isNaN(date.getTime())) throw new CommandError('invalid_date', 'Date invalide');
    patch.date = date;
  }
  if (d.location !== undefined) patch.location = d.location ?? '';
  if (d.organizer !== undefined) patch.organizer = d.organizer ?? '';
  const changed = Object.keys(patch);
  if (!input.dryRun && changed.length) {
    ctx.db.updateCompetition(comp.id, patch);
    ctx.emitChange?.({ scope: 'competitions', competitionIds: [comp.id] });
  }
  return { dryRun: !!input.dryRun, competitionId: comp.id, changed };
}

/**
 * Arme, sexe, catégorie, épreuve par équipes et réglages (fusion de premier niveau). Arme,
 * format par équipes et mode spécial figés après le tirage. Tablettes prévenues.
 */
export function updateCompetitionSettings(
  ctx: CommandContext,
  input: {
    competitionId: string;
    weapon?: Weapon;
    gender?: Gender;
    category?: Category;
    isTeamEvent?: boolean;
    settings?: Partial<CompetitionSettings>;
    dryRun?: boolean;
  }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const patch = input.settings ?? {};
  const frozen = [
    ...(input.weapon !== undefined && input.weapon !== comp.weapon ? ['weapon'] : []),
    ...(input.isTeamEvent !== undefined && input.isTeamEvent !== !!comp.isTeamEvent
      ? ['isTeamEvent']
      : []),
    ...Object.keys(patch).filter(
      k =>
        FROZEN_SETTINGS.has(k) &&
        JSON.stringify((patch as Record<string, unknown>)[k]) !==
          JSON.stringify((comp.settings as unknown as Record<string, unknown>)?.[k])
    ),
  ];
  if (frozen.length && drawDone(ctx, comp.id)) {
    throw new CommandError(
      'draw_done',
      `Poules tirées ou tableau généré : réglage figé (${frozen.join(', ')})`
    );
  }
  // Seuls les réglages modifiés sont jugés : une épreuve 2.0 hors bornes reste modifiable
  if (Object.keys(patch).length) {
    assertFormula(
      validateFormulaSettings(
        { ...comp.settings, ...patch },
        Object.keys(patch) as Array<keyof CompetitionSettings>,
        {
          weapon: input.weapon ?? comp.weapon,
          isTeamEvent: input.isTeamEvent ?? !!comp.isTeamEvent,
        }
      )
    );
  }
  const update: Partial<Competition> = {};
  if (input.weapon !== undefined) update.weapon = input.weapon;
  if (input.gender !== undefined) update.gender = input.gender;
  if (input.category !== undefined) update.category = input.category;
  if (input.isTeamEvent !== undefined) update.isTeamEvent = input.isTeamEvent;
  if (Object.keys(patch).length) {
    update.settings = { ...comp.settings, ...patch } as CompetitionSettings;
  }
  // Formule v2 périmée : réglages plats écrits sans elle, ou arme changée (autre modèle)
  const staleFormula =
    comp.settings?.formula &&
    !('formula' in patch) &&
    (Object.keys(patch).some(k => FORMULA_FLAT_KEYS.has(k)) ||
      (input.weapon !== undefined && input.weapon !== comp.weapon));
  if (staleFormula) {
    const { formula: _stale, ...rest } = (update.settings ?? comp.settings) as CompetitionSettings;
    update.settings = rest as CompetitionSettings;
  }
  const changed = [
    ...Object.keys(update).filter(k => k !== 'settings'),
    ...Object.keys(patch).map(k => `settings.${k}`),
  ];
  if (!input.dryRun && changed.length) {
    ctx.db.updateCompetition(comp.id, update);
    ctx.emitChange?.({ scope: 'competitions', competitionIds: [comp.id] });
    if (Object.keys(patch).length) {
      ctx.remote?.settingsChanged(comp.id, patch as Partial<CompetitionSettings>);
    }
  }
  return { dryRun: !!input.dryRun, competitionId: comp.id, changed };
}

/** Supprime l'épreuve et ses lignes (RGPD) ; saisie distante arrêtée avant (#1009) */
export function deleteCompetition(
  ctx: CommandContext,
  input: { competitionId: string; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  if (!input.dryRun) {
    ctx.remote?.stop(comp.id);
    ctx.db.deleteCompetition(comp.id);
    ctx.emitChange?.({ scope: 'competitions', competitionIds: [comp.id] });
  }
  return { dryRun: !!input.dryRun, competitionId: comp.id };
}
