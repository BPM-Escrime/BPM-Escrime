/**
 * BPM - Escrime - Formule v2 : arbre de phases pour toutes les armes (#2013 étape C, ADR-0036)
 * Clé `CompetitionSettings.formula`. Sans migration de schéma : une épreuve qui n'a pas encore de
 * formule v2 la reçoit à la lecture (`formulaOf`), construite depuis ses réglages plats (épée…
 * Sabre Laser) ou depuis `customFormula` v1 (arme « Autre »). Les réglages plats restent écrits
 * par dérivation (`flatSettingsOf`) tant que des lecteurs plats existent. Domaine pur.
 * Licensed under GPL-3.0
 */

import {
  AdvancementRule,
  Category,
  CompetitionSettings,
  CustomDEConfig,
  CustomFormulaConfig,
  CustomPoolRoundConfig,
  CustomScoringConfig,
  FormulaPhaseNode,
  Gender,
  PoolBoutOrder,
  PostPoolSplitCriteria,
  QuestPhaseConfig,
  Weapon,
} from '../../types';
import { deriveSettingsFromFormula } from '../../utils/customFormulaSettings';
import { createDefaultCustomFormula } from '../../utils/tournamentTemplates';
import { draftFromSettings, effectivePoolRounds } from './formulaDraft';
import { normalizeCustomFormula } from './formulaFrieze';
import { isWavesOrder } from '../pools/waves';
import { normalizeRankingFilterKeys, type RankingFilterKey } from '../ranking/rankingFilters';

/** Réglages v1 non exécutés, gardés pour l'aller-retour avec `customFormula` (retirés à la 3.0) */
export type LegacyPoolSettings = Pick<
  CustomPoolRoundConfig,
  'balanced' | 'seeding' | 'separation' | 'rankingCriteria'
>;
export type LegacyTableauSettings = Pick<
  CustomDEConfig,
  'placesToFence' | 'bracketSizeOverride' | 'fifthPlaceMatch'
>;

/** Répartition d'un tour de poules : serpentin (défaut) ou par niveau (équipes, docs/adr/0043) */
export type PoolDistribution = 'serpentine' | 'byLevel';

/** Entrée (ADR-0043) : individuelle ou en binômes ; `levels` : du plus faible (niveau 1) au plus fort */
export type FormulaEntry = { kind: 'individual' } | { kind: 'team'; size: 2; levels: string[] };

export interface PoolRoundPhase {
  kind: 'pool';
  id: string;
  label?: string;
  sizeMin: number;
  sizeMax: number;
  maxScore: number;
  timerSeconds: number;
  /** Barème à zones (arme « Autre ») */
  scoring?: CustomScoringConfig;
  /** Vers la phase suivante */
  qualification: AdvancementRule;
  /** Répartition du tour (Q4) : classement du tour précédent (défaut) ou cumul des tours */
  seeding: 'previous_round' | 'cumulative';
  /** Ordre des matchs : FIE, libre, ou en vagues (réglage avancé, docs/adr/0043) */
  boutOrder: PoolBoutOrder;
  /** Répartition (réglage expert, ADR-0043) : serpentin (défaut, absent) ou par niveau */
  distribution?: PoolDistribution;
  legacy?: LegacyPoolSettings;
}

export interface QuestPhase {
  kind: 'quest';
  id: string;
  config: QuestPhaseConfig;
}

export interface TableauPhase {
  kind: 'tableau';
  id: string;
  label?: string;
  maxScore: number;
  timerSeconds: number;
  thirdPlace: boolean;
  allPlaces: boolean;
  scoring?: CustomScoringConfig;
  /** Étape D : tableau arrêté quand il reste N tireurs (tableau intercalé) */
  stopAt?: number;
  legacy?: LegacyTableauSettings;
}

/** Critère de répartition d'une scission (ADR-0039) */
export type SplitCriterion = 'gender' | 'category' | 'rank' | 'manual';

/** Branche d'une scission : devient une compétition fille (ADR-0039) */
export interface SplitBranch {
  /** « Tableau A », « N1 », « Dames », « V1 »… : titre de la fille, libellé GREG */
  label: string;
  /** Formule de la branche : poules et / ou tableau (sans scission ni Tour Quest) */
  phases: FormulaPhaseV2[];
  /** Critère gender */
  gender?: Gender;
  /** Critère category : une ou plusieurs */
  categories?: Category[];
  /** Critère rank : fixed_count ou percentage ; absent = le reste */
  take?: AdvancementRule;
  /**
   * Branche réduite à un tableau restée dans l'épreuve (étape E3) : critère sexe seulement, et
   * toutes les branches ou aucune (compétition couplée) ; tableaux séparés (`groupTableaux`,
   * ADR-0024)
   */
  stayInCompetition?: boolean;
}

/** Étape E : scission, toujours en dernière phase ; chaque branche est une suite de phases */
export interface SplitPhase {
  kind: 'split';
  id: string;
  criterion: SplitCriterion;
  branches: SplitBranch[];
}

export type FormulaPhaseV2 = PoolRoundPhase | QuestPhase | TableauPhase | SplitPhase;

export interface FormulaV2 {
  version: 2;
  /** Dans l'ordre ; l'appel et le classement final sont implicites */
  phases: FormulaPhaseV2[];
  general: {
    /** Repos entre périodes (armes modernes) ; absent : défaut de 60 s */
    restTimeSeconds?: number;
    /** Arme « Autre » : règles des armes modernes ou du Sabre Laser */
    ruleSet?: 'modern' | 'laser';
    /**
     * Ancienne forme de la compétition couplée, relue comme une scission par sexe dont les
     * branches restent dans l'épreuve (`coupledFormula`, ADR-0039 étape E3) ; gardée seulement
     * quand cette scission n'a pas sa place (Tour Quest, pas de tour de poules avant le tableau)
     */
    postPoolSplitCriteria?: PostPoolSplitCriteria;
    /** Entrée (réglage expert, ADR-0043) ; absente : individuelle */
    entry?: FormulaEntry;
    /**
     * Filtres du classement final affiché (réglage expert, ADR-0043, F4d) : critères proposés à
     * l'écran, aux PDF et au CSV ; absents : aucun filtre. Un affichage, pas une compétition fille.
     */
    rankingFilters?: RankingFilterKey[];
  };
  name?: string;
  notes?: string;
}

export interface FormulaSource {
  weapon: Weapon;
  category: Category;
  settings?: Partial<CompetitionSettings>;
}

const pools = (f: FormulaV2) => f.phases.filter((p): p is PoolRoundPhase => p.kind === 'pool');
const questOf = (f: FormulaV2) => f.phases.find((p): p is QuestPhase => p.kind === 'quest');
/** Scission de la formule (dernière phase, ADR-0039) ; undefined : aucune */
export const splitOf = (f: FormulaV2): SplitPhase | undefined =>
  f.phases.find((p): p is SplitPhase => p.kind === 'split');

// ── Branches restées dans l'épreuve (ADR-0039, étape E3) ──────────────────

/**
 * Compétition couplée : scission par sexe dont toutes les branches restent dans l'épreuve (la
 * grammaire refuse qu'une partie seulement reste). Rien à créer : le déroulé est celui des
 * tableaux séparés (ADR-0024).
 */
export const isCoupledSplit = (split: SplitPhase | undefined): boolean =>
  !!split &&
  split.criterion === 'gender' &&
  split.branches.length > 0 &&
  split.branches.every(b => !!b.stayInCompetition);

/** Scission à lancer (`splitCompetition`) : toutes les branches deviennent des compétitions filles */
export function pendingSplitOf(f: FormulaV2): SplitPhase | undefined {
  const split = splitOf(f);
  return split && !isCoupledSplit(split) ? split : undefined;
}

/** Tableau des branches restées de la compétition couplée ; undefined : pas de couplée */
const coupledTableauOf = (f: FormulaV2) => {
  const split = splitOf(f);
  return split && isCoupledSplit(split) ? split.branches[0].phases[0] : undefined;
};

/** Tableau joué dans l'épreuve : le tableau de la formule, sinon celui des branches restées */
export function playedTableauOf(f: FormulaV2): TableauPhase | undefined {
  const own = f.phases.find((p): p is TableauPhase => p.kind === 'tableau');
  if (own) return own;
  const phase = coupledTableauOf(f);
  return phase?.kind === 'tableau' ? phase : undefined;
}

/** Libellés des branches de la compétition couplée (titre d'une fille, libellé GREG) */
const COUPLED_LABELS: Record<Gender.MALE | Gender.FEMALE, string> = {
  [Gender.MALE]: 'Hommes',
  [Gender.FEMALE]: 'Dames',
};

/** Scission par sexe de la compétition couplée : Hommes, Dames, chacun un tableau resté */
export function coupledSplit(tableau: TableauPhase, id = 'split'): SplitPhase {
  return {
    kind: 'split',
    id,
    criterion: 'gender',
    branches: [Gender.MALE, Gender.FEMALE].map(g => ({
      label: COUPLED_LABELS[g as Gender.MALE | Gender.FEMALE],
      gender: g,
      phases: [{ ...tableau }],
      stayInCompetition: true,
    })),
  };
}

/**
 * Compétition couplée (`postPoolSplitCriteria = 'gender'`) relue dans la formule (ADR-0039,
 * étape E3) : le tableau final, après un tour de poules, devient une scission par sexe dont les
 * deux branches sont ce tableau, restées dans l'épreuve. Sans cette place (Tour Quest, tableau
 * arrêté, pas de tour avant), l'ancienne forme est gardée.
 */
export function coupledFormula(f: FormulaV2): FormulaV2 {
  if (f.general.postPoolSplitCriteria !== 'gender' || splitOf(f)) return f;
  const last = f.phases[f.phases.length - 1];
  const prev = f.phases[f.phases.length - 2];
  if (last?.kind !== 'tableau' || last.stopAt || prev?.kind !== 'pool') return f;
  if (f.phases.some(p => p.kind === 'quest')) return f;
  const { postPoolSplitCriteria: _coupled, ...general } = f.general;
  return { ...f, phases: [...f.phases.slice(0, -1), coupledSplit(last)], general };
}

/** Compétition couplée défaite : la scission redevient le tableau de ses branches */
export function uncoupledFormula(f: FormulaV2): FormulaV2 {
  const split = splitOf(f);
  const tableau = playedTableauOf(f);
  if (!isCoupledSplit(split) || !tableau) return f;
  return { ...f, phases: f.phases.map(p => (p === split ? tableau : p)) };
}

// ── Réglages plats → v2 (épée, fleuret, sabre, Sabre Laser) ───────────────

function fromFlat(src: FormulaSource): FormulaV2 {
  const settings = src.settings as CompetitionSettings | undefined;
  const d = draftFromSettings(src.weapon, src.category, settings);
  const rounds = effectivePoolRounds(d, src.weapon);
  const phases: FormulaPhaseV2[] = [];
  for (let r = 0; r < rounds; r++) {
    const last = r === rounds - 1;
    const q = d.poolRoundQualifiers[r] ?? 0;
    phases.push({
      kind: 'pool',
      id: `pool-${r + 1}`,
      sizeMin: d.poolSizeMin,
      sizeMax: d.poolSizeMax,
      maxScore: d.poolMaxScore,
      timerSeconds: d.poolTimerSeconds,
      qualification: last
        ? d.poolWinnersOnly
          ? { mode: 'pool_winner' }
          : { mode: 'all' }
        : q > 0
          ? { mode: 'fixed_count', count: q }
          : { mode: 'all' },
      seeding: 'previous_round',
      boutOrder: d.poolBoutOrder,
    });
  }
  if (src.weapon === Weapon.LASER && d.questEnabled) {
    phases.push({
      kind: 'quest',
      id: 'quest',
      config: settings?.questConfig ?? {
        enabled: true,
        hasPreliminaryPools: d.questHasPools,
        qualifiersCount: d.questHasPools ? d.questQualifiers : undefined,
        opponentConstraint: 'none',
      },
    });
  }
  if (d.hasDirectElimination) {
    phases.push({
      kind: 'tableau',
      id: 'tableau',
      maxScore: d.tableMaxScore,
      timerSeconds: d.tableTimerSeconds,
      thirdPlace: d.thirdPlaceMatch,
      allPlaces: d.playAllPositions,
    });
  }
  return coupledFormula({
    version: 2,
    phases,
    general: {
      restTimeSeconds: d.restTimeSeconds,
      ...(d.postPoolSplitCriteria ? { postPoolSplitCriteria: d.postPoolSplitCriteria } : {}),
    },
  });
}

// ── customFormula v1 ↔ v2 (arme « Autre ») ────────────────────────────────

/** Formule v1 → v2, sans perte (réglages non exécutés gardés dans `legacy`) */
export function formulaFromCustom(custom: CustomFormulaConfig): FormulaV2 {
  const f = normalizeCustomFormula(custom);
  const phases: FormulaPhaseV2[] = f.phases.map(node => {
    if (node.type === 'pool_round') {
      const c = node.config as CustomPoolRoundConfig;
      return {
        kind: 'pool',
        id: node.id,
        ...(node.label !== undefined ? { label: node.label } : {}),
        sizeMin: c.minPoolSize,
        sizeMax: c.maxPoolSize,
        maxScore: c.maxScore,
        timerSeconds: c.timerSeconds,
        scoring: c.scoring,
        qualification: c.advancementRule,
        seeding: 'previous_round',
        boutOrder: 'fie',
        legacy: {
          balanced: c.balanced,
          seeding: c.seeding,
          separation: c.separation,
          rankingCriteria: c.rankingCriteria,
        },
      } satisfies PoolRoundPhase;
    }
    const c = node.config as CustomDEConfig;
    return {
      kind: 'tableau',
      id: node.id,
      ...(node.label !== undefined ? { label: node.label } : {}),
      maxScore: c.maxScore,
      timerSeconds: c.timerSeconds,
      thirdPlace: !!c.thirdPlaceMatch,
      allPlaces: false,
      scoring: c.scoring,
      legacy: {
        placesToFence: c.placesToFence,
        ...(c.bracketSizeOverride !== undefined
          ? { bracketSizeOverride: c.bracketSizeOverride }
          : {}),
        ...(c.fifthPlaceMatch !== undefined ? { fifthPlaceMatch: c.fifthPlaceMatch } : {}),
      },
    } satisfies TableauPhase;
  });
  return {
    version: 2,
    phases,
    general: {
      ...(f.restTimeSeconds !== undefined ? { restTimeSeconds: f.restTimeSeconds } : {}),
      ...(f.ruleSet ? { ruleSet: f.ruleSet } : {}),
    },
    ...(f.formulaName !== undefined ? { name: f.formulaName } : {}),
    ...(f.notes !== undefined ? { notes: f.notes } : {}),
  };
}

/**
 * Formule v2 → v1, lue par les lecteurs de `customFormula` (barème des tablettes, qualifiés par
 * tour) tant qu'ils ne passent pas par `phaseSettings`.
 */
export function customFormulaOf(f: FormulaV2): CustomFormulaConfig {
  const defaults = createDefaultCustomFormula();
  const dPool = defaults.phases[0].config as CustomPoolRoundConfig;
  let round = 0;
  const phases: FormulaPhaseNode[] = [];
  // Branches restées dans l'épreuve : leur tableau se joue dans l'épreuve (ADR-0039, E3)
  const kept = coupledTableauOf(f);
  const played = f.phases.map(p =>
    p.kind === 'split' && kept?.kind === 'tableau' && !f.phases.some(x => x.kind === 'tableau')
      ? kept
      : p
  );
  for (const p of played) {
    if (p.kind === 'pool') {
      const legacy = p.legacy ?? {
        balanced: dPool.balanced,
        seeding: dPool.seeding,
        separation: dPool.separation,
        rankingCriteria: dPool.rankingCriteria,
      };
      phases.push({
        id: p.id,
        type: 'pool_round',
        ...(p.label !== undefined ? { label: p.label } : {}),
        config: {
          roundIndex: round++,
          minPoolSize: p.sizeMin,
          maxPoolSize: p.sizeMax,
          ...legacy,
          maxScore: p.maxScore,
          timerSeconds: p.timerSeconds,
          scoring: p.scoring ?? { type: 'standard', maxScore: p.maxScore },
          advancementRule: p.qualification,
        },
      });
    } else if (p.kind === 'tableau') {
      phases.push({
        id: p.id,
        type: 'direct_elimination',
        ...(p.label !== undefined ? { label: p.label } : {}),
        config: {
          maxScore: p.maxScore,
          timerSeconds: p.timerSeconds,
          thirdPlaceMatch: p.thirdPlace,
          placesToFence: p.legacy?.placesToFence ?? [],
          ...(p.legacy?.bracketSizeOverride !== undefined
            ? { bracketSizeOverride: p.legacy.bracketSizeOverride }
            : {}),
          ...(p.legacy?.fifthPlaceMatch !== undefined
            ? { fifthPlaceMatch: p.legacy.fifthPlaceMatch }
            : {}),
          scoring: p.scoring ?? { type: 'standard', maxScore: p.maxScore },
        },
      });
    }
  }
  return {
    version: 1,
    phases,
    ...(f.name !== undefined ? { formulaName: f.name } : {}),
    ...(f.notes !== undefined ? { notes: f.notes } : {}),
    ...(f.general.ruleSet ? { ruleSet: f.general.ruleSet } : {}),
    ...(f.general.restTimeSeconds !== undefined
      ? { restTimeSeconds: f.general.restTimeSeconds }
      : {}),
  };
}

// ── Lecture ───────────────────────────────────────────────────────────────

/** Formule v2 de l'épreuve : enregistrée, sinon construite depuis ses réglages (sans écriture) */
export function formulaOf(src: FormulaSource): FormulaV2 {
  const stored = src.settings?.formula;
  // Formule enregistrée avant l'étape E3 avec l'ancienne compétition couplée : relue (ADR-0039)
  if (stored && stored.version === 2) return coupledFormula(stored);
  if (src.weapon === Weapon.CUSTOM)
    return formulaFromCustom(src.settings?.customFormula ?? createDefaultCustomFormula());
  return fromFlat(src);
}

export type PhaseRef = { kind: 'pool'; round: number } | { kind: 'tableau' };

/** Réglages d'une phase : tour de poules `round` (0 = 1er) ou tableau */
export function phaseSettings<R extends PhaseRef>(
  f: FormulaV2,
  ref: R
): R extends { kind: 'pool' } ? PoolRoundPhase : TableauPhase | undefined {
  type Out = R extends { kind: 'pool' } ? PoolRoundPhase : TableauPhase | undefined;
  if (ref.kind === 'tableau') return playedTableauOf(f) as Out;
  const list = pools(f);
  // Tour au-delà de la formule (épreuve en cours plus longue) : réglages du dernier tour
  const round = (ref as { round: number }).round;
  return list[Math.min(Math.max(0, round), list.length - 1)] as Out;
}

/**
 * Ordre des matchs du tour `round` (1 = 1er) : réglage du tour dans la formule, sinon le
 * réglage plat (ADR-0036, ADR-0042 : écran et moteur tirent le tour avec ses réglages).
 */
export function poolBoutOrderOfRound(
  settings: Partial<CompetitionSettings> | undefined,
  round: number
): PoolBoutOrder | undefined {
  const f = settings?.formula;
  if (f && pools(f).length > 0)
    return phaseSettings(f, { kind: 'pool', round: round - 1 }).boutOrder;
  return settings?.poolBoutOrder;
}

/**
 * Le tour `round` (1 = 1er) est-il un tour en vagues ? Ordre « waves » ou « waves_classic » de
 * la formule ; une épreuve du mode spécial rapières en est un aussi, jusqu'à F4e (docs/adr/0043).
 */
export function isWavesRound(
  settings: Partial<CompetitionSettings> | undefined,
  round: number
): boolean {
  return (
    settings?.specialMode === 'rapieres' || isWavesOrder(poolBoutOrderOfRound(settings, round))
  );
}

/** Filtres du classement final de l'épreuve : ceux de la formule, aucun par défaut (docs/adr/0043, F4d) */
export function rankingFiltersOf(f: FormulaV2 | undefined): RankingFilterKey[] {
  return normalizeRankingFilterKeys(f?.general.rankingFilters);
}

/** Entrée de l'épreuve : celle de la formule, individuelle par défaut (docs/adr/0043) */
export function entryOf(f: FormulaV2 | undefined): FormulaEntry {
  return f?.general.entry ?? { kind: 'individual' };
}

/** Répartition du tour `round` (1 = 1er) : serpentin par défaut (docs/adr/0043) */
export function poolDistributionOfRound(
  settings: Partial<CompetitionSettings> | undefined,
  round: number
): PoolDistribution {
  const f = settings?.formula;
  if (!f || pools(f).length === 0) return 'serpentine';
  return phaseSettings(f, { kind: 'pool', round: round - 1 }).distribution ?? 'serpentine';
}

/**
 * Qualification vers le tableau : règle du tour de poules qui précède le tableau (scission
 * ignorée). Aucune (undefined) sans tableau, sans tour de poules juste avant (Tour Quest), ou si
 * tous passent. Exécutée pour toutes les armes (#2013 R1, ADR-0036 : levée du bridage P2).
 */
export function tableauQualificationOf(f: FormulaV2): AdvancementRule | undefined {
  const own = f.phases.findIndex(p => p.kind === 'tableau');
  // Tableau d'une branche restée dans l'épreuve : à la place de la scission (ADR-0039, E3)
  const at = own >= 0 ? own : playedTableauOf(f) ? f.phases.findIndex(p => p.kind === 'split') : -1;
  if (at <= 0) return undefined;
  const before = f.phases.slice(0, at).filter(p => p.kind !== 'split');
  const prev = before[before.length - 1];
  if (prev?.kind !== 'pool' || prev.qualification.mode === 'all') return undefined;
  return prev.qualification;
}

// ── Écriture : réglages plats dérivés ─────────────────────────────────────

/**
 * Réglages plats écrits avec `formula` tant que des lecteurs plats existent (ADR-0036) :
 * valeurs du premier tour et du tableau. Arme « Autre » : mêmes réglages que
 * deriveSettingsFromFormula, plus `customFormula` v1 équivalente.
 */
export function flatSettingsOf(f: FormulaV2, weapon: Weapon): Partial<CompetitionSettings> {
  // Tableaux séparés par sexe (ADR-0024) : scission par sexe dont toutes les branches restent
  // dans l'épreuve (ADR-0039, E3) ; ancienne forme gardée telle quelle
  const postPoolSplitCriteria: PostPoolSplitCriteria | undefined = isCoupledSplit(splitOf(f))
    ? 'gender'
    : f.general.postPoolSplitCriteria;
  if (weapon === Weapon.CUSTOM) {
    const customFormula = customFormulaOf(f);
    const firstPool = pools(f)[0];
    return {
      customFormula,
      ...deriveSettingsFromFormula(customFormula),
      // Tour en vagues au 1er tour : l'ordre suit les tailles de poule (2 à 10, docs/adr/0043)
      ...(firstPool && isWavesOrder(firstPool.boutOrder)
        ? { poolBoutOrder: firstPool.boutOrder }
        : {}),
      ...(postPoolSplitCriteria ? { postPoolSplitCriteria } : {}),
    };
  }
  const list = pools(f);
  const first = list[0];
  const last = list[list.length - 1];
  const tableau = playedTableauOf(f);
  // Tableau d'une branche restée : à la place de la scission, en dernier
  const tableauAt = tableau ? f.phases.indexOf(tableau) : -1;
  const beforeTableau = tableau
    ? f.phases
        .slice(0, tableauAt >= 0 ? tableauAt : f.phases.length)
        .filter((p): p is PoolRoundPhase => p.kind === 'pool')
        .pop()
    : undefined;
  const quest = questOf(f);
  const out: Partial<CompetitionSettings> = {
    poolRounds: list.length > 0 ? list.length : quest ? 0 : 1,
    poolRoundQualifiers: list
      .slice(0, -1)
      .map(p => (p.qualification.mode === 'fixed_count' ? (p.qualification.count ?? 0) : 0)),
    hasDirectElimination: !!tableau,
    // Vainqueurs de poule : tour qui précède le tableau (tableau arrêté suivi de tours, ADR-0037)
    poolWinnersOnly: (beforeTableau ?? last)?.qualification.mode === 'pool_winner',
    restTimeSeconds: f.general.restTimeSeconds ?? 60,
    postPoolSplitCriteria,
  };
  if (first) {
    out.defaultPoolMaxScore = first.maxScore;
    out.defaultPoolTimerSeconds = first.timerSeconds;
    out.poolSizeMin = first.sizeMin;
    out.poolSizeMax = first.sizeMax;
    out.poolBoutOrder = first.boutOrder;
  }
  if (tableau) {
    out.defaultTableMaxScore = tableau.maxScore;
    out.defaultTableTimerSeconds = tableau.timerSeconds;
    out.thirdPlaceMatch = tableau.thirdPlace;
    out.playAllPositions = tableau.allPlaces;
  }
  if (weapon === Weapon.LASER) {
    out.questConfig = quest
      ? { ...quest.config, enabled: true }
      : { enabled: false, hasPreliminaryPools: false, opponentConstraint: 'none' };
  }
  return out;
}
