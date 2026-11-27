/**
 * BPM - Escrime - Modèles de formule (#2013 étape B2, docs/adr/0033)
 * Modèles fournis (catalogue en lecture seule, presets/) et modèles personnels du poste
 * (app_settings, clé formulaTemplates). Compatibilité avec une épreuve, modèle standard,
 * réglages appliqués, état Standard / Adaptée / Libre. Domaine pur.
 * Licensed under GPL-3.0
 */

import {
  Category,
  CompetitionSettings,
  CompetitionSpecialMode,
  CustomFormulaConfig,
  Weapon,
} from '../../types';
import { deriveSettingsFromFormula } from '../../utils/customFormulaSettings';
import { FormulaDraft, draftFromSettings, draftToSettings } from './formulaDraft';
import { normalizeCustomFormula } from './formulaFrieze';
import { flatSettingsOf, formulaFromCustom, formulaOf, type FormulaV2 } from './formulaV2';
import { rapieresFormulaFrom } from './rapieresFormula';
import { formulaV2Issues, operationsBetweenV2 } from './formulaV2Operations';
import { validateFormulaSettings } from './validateFormulaSettings';

export type FormulaTemplateBody =
  | { kind: 'draft'; draft: FormulaDraft }
  /** `specialMode` : modèle personnel enregistré avant F4e, lu comme la formule des rapières */
  | { kind: 'custom'; formula: CustomFormulaConfig; specialMode?: CompetitionSpecialMode }
  /** Formule v2 (ADR-0036) ; `other` : modèle de l'arme « Autre » */
  | { kind: 'formula'; formula: FormulaV2; other?: boolean; specialMode?: CompetitionSpecialMode };

/** Le modèle est-il un modèle de l'arme « Autre » ? */
const isOtherBody = (b: FormulaTemplateBody) =>
  b.kind === 'custom' || (b.kind === 'formula' && b.other === true);

export interface FormulaTemplateApplies {
  weapons?: Weapon[];
  categories?: Category[];
  /** true : épreuves par équipes seulement ; false : individuelles seulement ; absent : les deux */
  team?: boolean;
}

export interface FormulaTemplate {
  id: string;
  source: 'provided' | 'personal';
  name: string;
  /** Modèle fourni : code du libellé traduit par l'écran (standard, two_rounds…) */
  code?: string;
  applies?: FormulaTemplateApplies;
  /** Saison du règlement (modèle fourni) */
  season?: string;
  /** Article ou lien du règlement (modèle fourni) */
  reference?: string;
  /** Modèle personnel issu d'un modèle fourni */
  origin?: { templateId: string; season?: string };
  body: FormulaTemplateBody;
  savedAt?: string;
}

/** Plafond de la bibliothèque personnelle du poste */
export const MAX_PERSONAL_TEMPLATES = 100;
export const MAX_TEMPLATE_NAME = 80;

export interface TemplateContext {
  weapon: Weapon;
  category?: Category;
  isTeamEvent?: boolean;
}

/** Le modèle s'applique-t-il à cette épreuve ? (« Autre » : formule de l'arme 'C' seulement) */
export function templateMatches(t: FormulaTemplate, ctx: TemplateContext): boolean {
  const isOther = ctx.weapon === Weapon.CUSTOM;
  if (isOtherBody(t.body) !== isOther) return false;
  const a = t.applies ?? {};
  if (a.weapons && !a.weapons.includes(ctx.weapon)) return false;
  if (a.categories && ctx.category && !a.categories.includes(ctx.category)) return false;
  if (a.team !== undefined && a.team !== !!ctx.isTeamEvent) return false;
  return true;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface TemplateFilter extends Partial<TemplateContext> {
  text?: string;
}

/** Fournis puis personnels ; filtre de contexte seulement si l'arme est donnée */
export function filterTemplates(
  templates: FormulaTemplate[],
  filter: TemplateFilter
): FormulaTemplate[] {
  const text = filter.text?.trim() ? fold(filter.text) : '';
  return templates
    .filter(t => (filter.weapon ? templateMatches(t, filter as TemplateContext) : true))
    .filter(t => !text || fold(`${t.name} ${t.season ?? ''} ${t.reference ?? ''}`).includes(text))
    .sort((a, b) => (a.source === b.source ? 0 : a.source === 'provided' ? -1 : 1));
}

/** Modèle standard du contexte : premier modèle fourni « standard » compatible */
export function standardTemplate(
  templates: FormulaTemplate[],
  ctx: TemplateContext
): FormulaTemplate | undefined {
  return templates.find(
    t => t.source === 'provided' && t.code === 'standard' && templateMatches(t, ctx)
  );
}

/**
 * Réglages écrits sur l'épreuve quand le modèle est appliqué (formulaOrigin compris).
 * `base` : réglages actuels (Tour Quest conservé).
 */
export function templateToSettings(
  t: FormulaTemplate,
  weapon: Weapon,
  base: Partial<CompetitionSettings> | undefined
): Partial<CompetitionSettings> {
  const formulaOrigin = { templateId: t.id, ...(t.season ? { season: t.season } : {}) };
  // Le mode spécial n'est plus écrit (docs/adr/0043, F4e) : appliquer un modèle l'efface (clé
  // retirée à l'enregistrement) ; un modèle personnel qui en portait un devient la formule des rapières
  if (t.body.kind === 'formula') {
    const formula =
      t.body.specialMode === 'rapieres' ? rapieresFormulaFrom(t.body.formula) : t.body.formula;
    return {
      ...flatSettingsOf(formula, weapon),
      formula,
      ...(weapon === Weapon.CUSTOM ? { specialMode: undefined } : {}),
      formulaOrigin,
    };
  }
  if (t.body.kind === 'custom') {
    const custom = normalizeCustomFormula(t.body.formula);
    if (t.body.specialMode === 'rapieres') {
      const formula = rapieresFormulaFrom(formulaFromCustom(custom));
      return {
        ...flatSettingsOf(formula, weapon),
        formula,
        specialMode: undefined,
        formulaOrigin,
      };
    }
    return {
      customFormula: custom,
      ...deriveSettingsFromFormula(custom),
      specialMode: undefined,
      formulaOrigin,
    };
  }
  return { ...draftToSettings(t.body.draft, weapon, base?.questConfig), formulaOrigin };
}

// ── Validation d'un modèle personnel ──────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Réglages du brouillon : nombres et booléens attendus (le reste est jugé par la formule) */
const DRAFT_NUMBERS: Array<keyof FormulaDraft> = [
  'poolRounds',
  'poolMaxScore',
  'tableMaxScore',
  'poolTimerSeconds',
  'tableTimerSeconds',
  'restTimeSeconds',
  'poolSizeMin',
  'poolSizeMax',
  'questQualifiers',
];
const DRAFT_BOOLEANS: Array<keyof FormulaDraft> = [
  'hasDirectElimination',
  'thirdPlaceMatch',
  'playAllPositions',
  'poolWinnersOnly',
  'questEnabled',
  'questHasPools',
];

/** Écarts d'un modèle ; liste vide = valide */
export function templateIssues(t: unknown): string[] {
  if (!isObj(t)) return ['modèle attendu'];
  const out: string[] = [];
  if (typeof t.id !== 'string' || !t.id || t.id.length > 200) out.push('id');
  if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > MAX_TEMPLATE_NAME)
    out.push('name');
  const body = t.body;
  if (!isObj(body)) return [...out, 'body'];
  if (body.kind === 'draft') {
    const d = body.draft;
    if (!isObj(d)) return [...out, 'body.draft'];
    for (const k of DRAFT_NUMBERS)
      if (typeof d[k] !== 'number' || !Number.isFinite(d[k] as number)) out.push(`body.draft.${k}`);
    for (const k of DRAFT_BOOLEANS) if (typeof d[k] !== 'boolean') out.push(`body.draft.${k}`);
    if (!Array.isArray(d.poolRoundQualifiers)) out.push('body.draft.poolRoundQualifiers');
    if (out.length === 0) {
      // Bornes de l'arme visée ; sans arme : valable pour au moins une (Sabre Laser à part)
      const applies = isObj(t.applies) ? (t.applies as FormulaTemplateApplies) : {};
      const scopes = applies.weapons?.length
        ? [{ weapon: applies.weapons[0], isTeamEvent: applies.team === true }]
        : [{ weapon: Weapon.EPEE }, { weapon: Weapon.LASER }];
      const results = scopes.map(scope =>
        validateFormulaSettings(
          draftToSettings(d as unknown as FormulaDraft, scope.weapon, undefined),
          undefined,
          scope
        )
      );
      const issues = results.find(r => r.length === 0) ?? results[0];
      out.push(...issues.map(i => `body.draft (${i.field} : ${i.message})`));
    }
  } else if (body.kind === 'formula') {
    const f = body.formula as FormulaV2 | undefined;
    if (!isObj(f) || f.version !== 2 || !Array.isArray(f.phases) || !isObj(f.general))
      return [...out, 'body.formula (formule v2 attendue)'];
    if (body.specialMode !== undefined && body.specialMode !== 'rapieres')
      out.push('body.specialMode');
    const applies = isObj(t.applies) ? (t.applies as FormulaTemplateApplies) : {};
    const scopes = body.other
      ? [{ weapon: Weapon.CUSTOM }]
      : applies.weapons?.length
        ? [{ weapon: applies.weapons[0], isTeamEvent: applies.team === true }]
        : [{ weapon: Weapon.EPEE }, { weapon: Weapon.LASER }];
    const results = scopes.map(scope => formulaV2Issues(f, scope));
    out.push(
      ...(results.find(r => r.length === 0) ?? results[0]).map(i => `body.formula (${i.message})`)
    );
  } else if (body.kind === 'custom') {
    if (body.specialMode !== undefined && body.specialMode !== 'rapieres')
      out.push('body.specialMode');
    const issues = validateFormulaSettings({ customFormula: body.formula as CustomFormulaConfig });
    out.push(...issues.map(i => `body.formula (${i.field} : ${i.message})`));
  } else {
    out.push('body.kind');
  }
  return out;
}

/** Bibliothèque personnelle enregistrée : liste de modèles personnels valides */
export function validatePersonalTemplates(value: unknown): FormulaTemplate[] {
  if (!Array.isArray(value)) throw new Error('liste de modèles attendue');
  if (value.length > MAX_PERSONAL_TEMPLATES)
    throw new Error(`${MAX_PERSONAL_TEMPLATES} modèles au plus`);
  return value.map((t, i) => {
    const issues = templateIssues(t);
    if (issues.length) throw new Error(`modèle ${i + 1} : ${issues.join(', ')}`);
    return { ...(t as FormulaTemplate), source: 'personal' as const };
  });
}

// ── État Standard / Adaptée / Libre ───────────────────────────────────────

export type FormulaState = 'standard' | 'adapted' | 'free';

export interface FormulaDeviation {
  field: string;
  expected: unknown;
  actual: unknown;
}

/** Réglages comparés : structure et réglages contraints (taille de poule libre, Q9) */
const COMPARED: Array<keyof FormulaDraft> = [
  'poolRounds',
  'poolRoundQualifiers',
  'hasDirectElimination',
  'poolMaxScore',
  'tableMaxScore',
  'poolTimerSeconds',
  'tableTimerSeconds',
  'thirdPlaceMatch',
  'playAllPositions',
  'poolWinnersOnly',
  'questEnabled',
  'questHasPools',
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Écarts entre la formule de l'épreuve et son modèle d'origine. Sans origine connue : libre.
 * Jamais stocké (docs/adr/0033).
 */
export function formulaDeviations(
  competition: { weapon: Weapon; category: Category; settings?: Partial<CompetitionSettings> },
  templates: FormulaTemplate[]
): { state: FormulaState; template?: FormulaTemplate; deviations: FormulaDeviation[] } {
  const originId = competition.settings?.formulaOrigin?.templateId;
  const template = originId ? templates.find(t => t.id === originId) : undefined;
  if (!template) return { state: 'free', deviations: [] };
  const deviations: FormulaDeviation[] = [];
  // Formule v2 enregistrée ou modèle v2 : comparaison phase par phase (ADR-0036)
  if (competition.settings?.formula || template.body.kind === 'formula') {
    const expected =
      template.body.kind === 'formula'
        ? template.body.formula
        : formulaOf({
            weapon: competition.weapon,
            category: competition.category,
            settings: {
              ...competition.settings,
              formula: undefined,
              ...templateToSettings(template, competition.weapon, competition.settings),
            },
          });
    const actual = formulaOf(competition);
    for (const o of operationsBetweenV2(expected, actual)) {
      if (o.op === 'setPhase') {
        for (const [k, v] of Object.entries(o.settings)) {
          // Taille de poule : réglage libre du modèle (Q9)
          if (k === 'sizeMin' || k === 'sizeMax' || k === 'label') continue;
          deviations.push({ field: `${o.phase}.${k}`, expected: undefined, actual: v });
        }
      } else if (o.op === 'setGeneral') {
        for (const [k, v] of Object.entries(o.settings))
          deviations.push({ field: k, expected: undefined, actual: v });
      } else {
        deviations.push({
          field: o.op === 'insertPhase' ? `+${o.brick}` : `-${o.phase}`,
          expected: undefined,
          actual: undefined,
        });
      }
    }
    return { state: deviations.length ? 'adapted' : 'standard', template, deviations };
  }
  if (template.body.kind === 'custom') {
    const actual = competition.settings?.customFormula;
    const expected = template.body.formula;
    const run = (f?: CustomFormulaConfig) =>
      f ? deriveSettingsFromFormula(normalizeCustomFormula(f)) : {};
    const a = run(actual) as Record<string, unknown>;
    const e = run(expected) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(a), ...Object.keys(e)]))
      if (!same(a[k], e[k])) deviations.push({ field: k, expected: e[k], actual: a[k] });
    if ((competition.settings?.specialMode ?? null) !== (template.body.specialMode ?? null))
      deviations.push({
        field: 'specialMode',
        expected: template.body.specialMode,
        actual: competition.settings?.specialMode,
      });
  } else {
    const actual = draftFromSettings(
      competition.weapon,
      competition.category,
      competition.settings as CompetitionSettings
    );
    const expected = template.body.draft;
    for (const k of COMPARED)
      if (!same(actual[k], expected[k]))
        deviations.push({ field: k, expected: expected[k], actual: actual[k] });
  }
  return { state: deviations.length ? 'adapted' : 'standard', template, deviations };
}
