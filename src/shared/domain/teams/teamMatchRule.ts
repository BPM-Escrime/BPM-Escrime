/**
 * BPM - Escrime - Règle de rencontre des épreuves par équipes dans la formule v2 (ADR-0044)
 * `general.teamMatch` pour la formule entière, surcharge champ par champ par un tour de poules ou
 * un tableau (`teamMatch`), repli sur les réglages d'épreuve (minTeamSize, teamReserveCount,
 * teamRelayStepSize, relayOrderFor) : une épreuve existante se rejoue à l'identique. Formule
 * d'équipe (`teamFormulaOf`) : formule enregistrée qui porte `general.teamMatch`, épreuve en relais
 * FIE. Briques admises et bornes : `teamFormulaIssues`. Domaine pur.
 * Licensed under GPL-3.0
 */
import { Weapon, type AdvancementRule, type CompetitionSettings } from '../../types';
import {
  phaseSettings,
  playedTableauOf,
  readableFormulaOf,
  type FormulaPhaseV2,
  type FormulaV2,
  type PhaseRef,
  type TeamMatchRule,
  type TeamRelayOrder,
} from '../formula/formulaV2';
import { remark, phaseKeys, type FormulaRemark } from '../formula/formulaRemarks';
import { isWavesOrder } from '../pools/waves';
import { FIE_RELAY_ORDER_3, generateRelayOrder } from './teamCalculations';
import { teamFormatOf, teamSizeOf, type TeamFormat } from './relay';

/** Bornes de la règle de rencontre (ADR-0044) */
export const TEAM_MATCH_LIMITS = {
  starters: { min: 2, max: 4 },
  reserves: { min: 0, max: 2 },
  /** Palier : entier ≥ 1, sans borne haute (comme teamRelayStepSize) */
  relayStep: { min: 1, max: Number.POSITIVE_INFINITY },
} as const;

const TEAM_RELAY_ORDERS: readonly TeamRelayOrder[] = ['fie', 'rotation'];
const FIE_WEAPONS: readonly Weapon[] = [Weapon.EPEE, Weapon.FOIL, Weapon.SABRE];

/** Ordre des relais par défaut (`relayOrderFor`) : FIE à 3 titulaires en épée, fleuret, sabre */
export const defaultRelayOrder = (starters: number, weapon: Weapon): TeamRelayOrder =>
  starters === 3 && FIE_WEAPONS.includes(weapon) ? 'fie' : 'rotation';

type TeamSettings = Pick<
  CompetitionSettings,
  'minTeamSize' | 'teamReserveCount' | 'teamRelayStepSize' | 'teamFormat'
>;

/** Champs renseignés d'une règle partielle (undefined et null ignorés) */
function defined(rule: Partial<TeamMatchRule> | undefined | null): Partial<TeamMatchRule> {
  if (!rule || typeof rule !== 'object') return {};
  return Object.fromEntries(
    Object.entries(rule).filter(([, v]) => v !== undefined && v !== null)
  ) as Partial<TeamMatchRule>;
}

/** Surcharge de la phase `ref` ; rien sans phase ou sans surcharge */
function phaseOverride(f: FormulaV2, ref: PhaseRef): Partial<TeamMatchRule> {
  const phase = ref.kind === 'tableau' ? playedTableauOf(f) : phaseSettings(f, ref);
  return defined(phase?.teamMatch);
}

/**
 * Règle de rencontre de la phase `ref` (undefined : règle générale) : réglages d'épreuve, puis
 * `general.teamMatch`, puis la surcharge de la phase, champ par champ. Ordre des relais non
 * réglé : celui de l'arme et des titulaires (`relayOrderFor`) ; 'fie' hors 3 titulaires (refusé
 * par les contrôles) : rotation.
 */
export function teamMatchRuleOf(
  formula: FormulaV2 | undefined,
  ref: PhaseRef | undefined,
  settings: Partial<TeamSettings> | null | undefined,
  weapon: Weapon
): TeamMatchRule {
  const general = defined(formula?.general.teamMatch);
  const phase = formula && ref ? phaseOverride(formula, ref) : {};
  const starters = phase.starters ?? general.starters ?? teamSizeOf(settings);
  const order = phase.relayOrder ?? general.relayOrder ?? defaultRelayOrder(starters, weapon);
  return {
    starters,
    reserves: phase.reserves ?? general.reserves ?? settings?.teamReserveCount ?? 1,
    relayStep: phase.relayStep ?? general.relayStep ?? settings?.teamRelayStepSize ?? 5,
    relayOrder: order === 'fie' && starters !== 3 ? 'rotation' : order,
  };
}

/** Paires des relais (indices des titulaires, dès 0) dans l'ordre de la règle */
export function relayPairsOf(
  rule: Pick<TeamMatchRule, 'starters' | 'relayOrder'>
): [number, number][] {
  if (rule.relayOrder === 'fie' && rule.starters === 3)
    return FIE_RELAY_ORDER_3.map(([a, b]) => [a, b] as [number, number]);
  return generateRelayOrder(rule.starters);
}

/**
 * Formule d'une épreuve par équipes en relais FIE qui fait foi pour ses phases (ADR-0044) :
 * formule enregistrée portant `general.teamMatch`. undefined : épreuve existante (sans formule ou
 * formule « individuelle » enregistrée), relue avec une poule unique et la règle des réglages.
 */
export function teamFormulaOf(comp: {
  isTeamEvent?: boolean;
  settings?: Partial<CompetitionSettings> | null;
}): FormulaV2 | undefined {
  if (!comp.isTeamEvent || teamFormatOf(comp.settings) !== 'fie-relay') return undefined;
  const f = readableFormulaOf(comp.settings ?? undefined);
  return f?.general.teamMatch ? f : undefined;
}

/** Épreuve par équipes en relais FIE : seule épreuve dont la formule lit `teamMatch` (ADR-0044) */
export const isFieRelayTeamEvent = (comp: {
  isTeamEvent?: boolean;
  settings?: Partial<CompetitionSettings> | null;
}): boolean => !!comp.isTeamEvent && teamFormatOf(comp.settings) === 'fie-relay';

/** Épreuve en arène Sabre Laser : formule d'un modèle fixe, non modifiable (ADR-0044) */
export const isArenaTeamEvent = (comp: {
  isTeamEvent?: boolean;
  settings?: Partial<CompetitionSettings> | null;
}): boolean => !!comp.isTeamEvent && teamFormatOf(comp.settings) === 'laser-arena';

/** Phases sans surcharge `teamMatch` (branches de scission comprises) ; même liste sinon */
function phasesWithoutTeamMatch(list: FormulaPhaseV2[]): FormulaPhaseV2[] {
  let changed = false;
  const out = list.map((p): FormulaPhaseV2 => {
    if (p.kind === 'split') {
      const branches = p.branches.map(b => {
        const phases = phasesWithoutTeamMatch(b.phases);
        return phases === b.phases ? b : { ...b, phases };
      });
      if (branches.every((b, i) => b === p.branches[i])) return p;
      changed = true;
      return { ...p, branches };
    }
    if ((p.kind === 'pool' || p.kind === 'tableau') && 'teamMatch' in p) {
      changed = true;
      const { teamMatch: _t, ...rest } = p;
      return rest as FormulaPhaseV2;
    }
    return p;
  });
  return changed ? out : list;
}

/**
 * Formule sans règle de rencontre (générale et de phase) : `teamMatch` n'est lu que si
 * l'épreuve est par équipes en relais FIE, et n'est pas écrit ailleurs (ADR-0044). Même objet
 * s'il n'y a rien à retirer.
 */
export function withoutTeamMatch(f: FormulaV2): FormulaV2 {
  const phases = phasesWithoutTeamMatch(f.phases);
  if (!('teamMatch' in f.general) && phases === f.phases) return f;
  const { teamMatch: _t, ...general } = f.general;
  return { ...f, phases, general };
}

/**
 * Formule écrite pour une épreuve : par équipes en relais FIE, `general.teamMatch` posée depuis
 * les réglages si elle manque, pour que la formule fasse foi (ADR-0044) ; autres épreuves
 * (individuelle, arène) : `teamMatch` retiré, ni lu ni écrit hors épreuve par équipes.
 */
export function withTeamMatch(
  f: FormulaV2,
  comp: { weapon: Weapon; isTeamEvent?: boolean; settings?: Partial<CompetitionSettings> | null }
): FormulaV2 {
  if (!isFieRelayTeamEvent(comp)) return withoutTeamMatch(f);
  if (f.general.teamMatch) return f;
  return {
    ...f,
    general: {
      ...f.general,
      teamMatch: teamMatchRuleOf(undefined, undefined, comp.settings, comp.weapon),
    },
  };
}

// ─── Contrôles (formulaV2Issues, ADR-0041) ──────────────────────────────────

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Bornes d'une règle (partielle) ; `starters` : titulaires effectifs pour l'ordre FIE */
function ruleIssues(
  rule: Partial<TeamMatchRule>,
  starters: number | undefined,
  where: string,
  phase: string | null
): FormulaRemark[] {
  const out: FormulaRemark[] = [];
  const add = (message: string) =>
    out.push(remark('invalid_team_match', phase, `${where} : ${message}`));
  for (const key of ['starters', 'reserves', 'relayStep'] as const) {
    const v = rule[key];
    if (v === undefined || v === null) continue;
    const { min, max } = TEAM_MATCH_LIMITS[key];
    if (!isInt(v) || v < min || v > max)
      add(Number.isFinite(max) ? `${key} entre ${min} et ${max}` : `${key} entier ≥ ${min}`);
  }
  const order = rule.relayOrder;
  if (order !== undefined && order !== null && !TEAM_RELAY_ORDERS.includes(order))
    add(`relayOrder attendu : ${TEAM_RELAY_ORDERS.join(', ')}`);
  if (order === 'fie' && starters !== undefined && starters !== 3)
    add('ordre FIE des relais (o.99.3) : 3 titulaires seulement');
  return out;
}

/** Qualifications admises vers le tableau d'équipes : tous, nombre, pourcentage (ADR-0044) */
const TEAM_QUALIFICATIONS: ReadonlyArray<AdvancementRule['mode']> = [
  'all',
  'fixed_count',
  'percentage',
];

/** `n` équipes se répartissent-elles en poules de `min` à `max` ? */
const poolable = (n: number, min: number, max: number) =>
  min >= 1 && max >= min && Math.ceil(n / max) <= Math.floor(n / min);

/**
 * Remarques propres à une épreuve par équipes en relais FIE (ADR-0044) : briques admises (un
 * tour de poules puis un tableau, ou un tableau seul : `team_brick_unsupported`), bornes de la
 * règle de rencontre (`invalid_team_match`), S3 et S4 sur l'effectif d'équipes `teamCount`.
 * Arène Sabre Laser et épreuve individuelle : aucune.
 */
export function teamFormulaIssues(
  f: FormulaV2,
  scope: { isTeamEvent?: boolean; teamFormat?: TeamFormat; teamCount?: number }
): FormulaRemark[] {
  if (!scope.isTeamEvent || teamFormatOf(scope) !== 'fie-relay') return [];
  const out: FormulaRemark[] = [];
  const keys = phaseKeys(f.phases);
  const brick = (phase: string | null, message: string) =>
    out.push(remark('team_brick_unsupported', phase, `épreuve par équipes : ${message}`));

  // Règle de rencontre : générale, puis surcharge de chaque phase
  const general = defined(f.general.teamMatch);
  out.push(...ruleIssues(general, general.starters, 'règle de rencontre', null));
  f.phases.forEach((p, i) => {
    if (p.kind !== 'pool' && p.kind !== 'tableau') return;
    if (!p.teamMatch) return;
    const own = defined(p.teamMatch);
    const starters = own.starters ?? general.starters;
    const order = own.relayOrder ?? general.relayOrder;
    out.push(
      ...ruleIssues(
        { ...own, relayOrder: order },
        starters,
        `${keys[i]} : règle de rencontre`,
        keys[i]
      )
    );
  });

  // Briques admises
  if (f.general.entry && f.general.entry.kind !== 'individual')
    brick(null, 'entrée en binômes refusée');
  if (f.general.postPoolSplitCriteria) brick(null, 'scission refusée');
  let pools = 0;
  f.phases.forEach((p, i) => {
    const key = keys[i];
    if (p.kind === 'quest') brick(key, 'Tour Quest refusé');
    else if (p.kind === 'split') brick(key, 'scission refusée');
    else if (p.kind === 'pool') {
      pools++;
      if (pools > 1) brick(key, 'un seul tour de poules');
      if (isWavesOrder(p.boutOrder)) brick(key, 'tour en vagues refusé');
      if (p.distribution === 'byLevel') brick(key, 'répartition par niveau refusée (serpentin)');
      if (p.qualification.mode === 'pool_heads') brick(key, 'têtes de poule refusées');
      else if (!TEAM_QUALIFICATIONS.includes(p.qualification.mode))
        brick(key, 'qualification : tous, nombre ou pourcentage');
    } else if (p.kind === 'tableau') {
      if (p.allPlaces) brick(key, 'toutes les places refusées (lot G2)');
      if (p.stopAt) brick(key, 'tableau arrêté refusé');
      if (i !== f.phases.length - 1) brick(key, 'le tableau termine la formule');
    }
  });
  if (!f.phases.some(p => p.kind === 'tableau'))
    brick(null, 'un tour de poules puis un tableau, ou un tableau seul');

  // S3, S4 sur l'effectif d'équipes : première phase
  const n = scope.teamCount;
  const first = f.phases[0];
  if (n && n > 0 && first) {
    if (first.kind === 'pool') {
      if (n < first.sizeMin)
        out.push(
          remark(
            'teams_below_pool_min',
            keys[0],
            `${n} équipe(s) pour des poules de ${first.sizeMin} au moins`
          )
        );
      else if (!poolable(n, first.sizeMin, first.sizeMax))
        out.push(
          remark(
            'teams_not_poolable',
            keys[0],
            `${n} équipes ne se répartissent pas en poules de ${first.sizeMin} à ${first.sizeMax}`
          )
        );
    } else if (first.kind === 'tableau' && n < 2) {
      out.push(remark('teams_below_tableau_min', keys[0], '2 équipes au moins pour le tableau'));
    }
  }
  return out;
}
