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
import {
  assertFormulaV2,
  assertFormulaWritable,
  assertProgressLock,
  compatibleTemplate,
} from './competitionFormula';
import { templateToSettings } from '../../../shared/domain/formula/formulaTemplate';
import {
  flatSettingsOf,
  formulaOf,
  withFlatSettings,
} from '../../../shared/domain/formula/formulaV2';
import {
  isArenaTeamEvent,
  isFieRelayTeamEvent,
  withoutTeamMatch,
  withTeamMatch,
} from '../../../shared/domain/teams/teamMatchRule';
import { teamFormatOf } from '../../../shared/domain/teams/relay';
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
 * Réglages plats de la formule, écrits sans `formula` (anciennes fenêtres, agent par
 * updateCompetitionSettings) : reportés dans la formule v2 enregistrée quand ils y ont leur place
 * (`withFlatSettings`) ; sinon ils la rendent périmée, et elle est retirée et reconstruite à la
 * lecture depuis ces réglages (ADR-0036 amendée).
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
  // Règle de rencontre générale des équipes (ADR-0044) : reportée dans `general.teamMatch`
  'minTeamSize',
  'teamReserveCount',
  'teamRelayStepSize',
]);

/** Réglages figés une fois les poules tirées (ou le tableau généré) : ils changent les règles */
const FROZEN_SETTINGS: ReadonlySet<string> = new Set(['specialMode', 'customFormula']);

/**
 * Le mode spécial (`specialMode`) n'est plus écrit (docs/adr/0043, F4e) : le Tournoi des rapières
 * est le modèle de formule « bpm/C/rapieres ». Une épreuve enregistrée avec lui garde sa valeur
 * (réécriture identique tolérée), une nouvelle valeur est refusée.
 */
function assertNoSpecialMode(
  patch: Partial<CompetitionSettings>,
  existing: Partial<CompetitionSettings> | undefined
): void {
  if (patch.specialMode !== undefined && patch.specialMode !== existing?.specialMode) {
    throw new CommandError(
      'invalid_settings',
      'Le mode spécial « rapières » n’existe plus : appliquer le modèle de formule « Tournoi des rapières » (bpm/C/rapieres)'
    );
  }
}

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
  assertNoSpecialMode(patch, undefined);
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
  // Modèle choisi : formule v2 enregistrée dès la création (ADR-0036). Épreuve par équipes en
  // relais FIE : formule d'équipe dès la création, avec sa règle de rencontre (docs/adr/0044)
  const team = { weapon: input.weapon, isTeamEvent: !!input.isTeamEvent, settings: merged };
  const teamFormula = !!input.isTeamEvent && teamFormatOf(merged) === 'fie-relay';
  const formula =
    merged.formula ??
    (input.templateId || teamFormula
      ? formulaOf({ weapon: input.weapon, category: input.category, settings: merged })
      : undefined);
  const settings: CompetitionSettings = formula
    ? { ...merged, formula: withTeamMatch(formula, team) }
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
  assertNoSpecialMode(patch, comp.settings);
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
  const next = {
    weapon: input.weapon ?? comp.weapon,
    isTeamEvent: input.isTeamEvent ?? !!comp.isTeamEvent,
    settings: { ...comp.settings, ...patch } as CompetitionSettings,
  };
  // Arène Sabre Laser : formule d'un modèle fixe, non modifiable (ADR-0044)
  if (
    'formula' in patch &&
    JSON.stringify(patch.formula ?? null) !== JSON.stringify(comp.settings?.formula ?? null)
  )
    assertFormulaWritable(next);
  // Formule écrite : même jugement que updateCompetitionFormula (bornes, S1 à S6, contrôles
  // d'équipe ; docs/adr/0041, ADR-0044), seulement quand `formula` est dans le patch. Par
  // équipes en relais FIE, la formule porte sa règle de rencontre ; ailleurs, `teamMatch` est
  // retiré (ADR-0044)
  const writtenFormula = patch.formula ? withTeamMatch(patch.formula, next) : undefined;
  if (writtenFormula) assertFormulaV2(ctx, comp, next, writtenFormula);
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
    update.settings = next.settings;
    if (writtenFormula) update.settings.formula = writtenFormula;
  }
  const flatKeys = Object.keys(patch).filter(k => FORMULA_FLAT_KEYS.has(k));
  const weaponChanged = input.weapon !== undefined && input.weapon !== comp.weapon;
  // Arène Sabre Laser : réglages plats sans report dans la formule figée (ADR-0044)
  if (
    comp.settings?.formula &&
    !isArenaTeamEvent(next) &&
    !('formula' in patch) &&
    (flatKeys.length || weaponChanged)
  ) {
    const base = (update.settings ?? comp.settings) as CompetitionSettings;
    // Réglage plat qui a sa place dans la formule : reporté dans la formule enregistrée, gardée
    // avec ses réglages dérivés (ADR-0036 amendée) ; sinon (structure, arme changée) : formule
    // périmée, retirée et relue depuis les réglages plats
    const stored = formulaOf({
      weapon: comp.weapon,
      category: comp.category,
      settings: comp.settings,
    });
    const merged = weaponChanged
      ? null
      : withFlatSettings(
          isFieRelayTeamEvent(next) ? stored : withoutTeamMatch(stored),
          Object.fromEntries(flatKeys.map(k => [k, (patch as Record<string, unknown>)[k]]))
        );
    if (merged) {
      update.settings = {
        ...base,
        ...flatSettingsOf(merged, comp.weapon),
        formula: merged,
      } as CompetitionSettings;
    } else {
      const { formula: _stale, ...rest } = base;
      update.settings = rest as CompetitionSettings;
    }
  }
  // Épreuve devenue individuelle ou arène : règle de rencontre retirée de la formule
  // enregistrée, ni lue ni écrite hors épreuve par équipes en relais FIE (ADR-0044)
  if ((input.isTeamEvent !== undefined || 'teamFormat' in patch) && !isFieRelayTeamEvent(next)) {
    const base = update.settings ?? comp.settings;
    const stripped = base?.formula ? withoutTeamMatch(base.formula) : undefined;
    if (base && stripped && stripped !== base.formula)
      update.settings = { ...base, formula: stripped };
  }
  // Verrou S6 (docs/adr/0041, ADR-0043 F4b) : réglages plats (ou formule retirée) écrits après le
  // début, jugés sur la formule qui en résulte ; formule écrite : déjà jugée (assertFormulaV2)
  if (!writtenFormula && ('formula' in patch || flatKeys.length)) {
    assertProgressLock(ctx, comp, (update.settings ?? comp.settings) as CompetitionSettings);
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
