/**
 * BPM - Escrime - Modèle de relais des épreuves par équipes (docs/adr/0024, lot E1)
 * Règles pures du moteur : identifiants déterministes, titulaires, ordre des relais fixé à la
 * création de la rencontre, tirage des poules d'équipes, cumul et vainqueur calculés à partir
 * du score de chaque relais (le fait), ordre de saisie, remplaçant unique par équipe et par
 * rencontre. Ni heure ni hasard : l'appelant fournit tout.
 * Licensed under GPL-3.0
 */
import { Weapon, type CompetitionSettings, type Fencer, type PoolBoutOrder } from '../../types';
import { distributePools, planPoolMatches, type PoolSeparation } from '../pools/poolDraw';
import type { TeamRow } from './team.types';
import { getTeamTargetRule, relayOrderFor } from './teamCalculations';
import { getLaserArenaBoutCap } from './laserArenaCalculations';
import { getLaserArenaPoolSchedule, resolveLaserArenaSchedule } from './laserArenaPoolSchedules';
import { relayCapFor } from './teamRelayLive';

// ─── Identifiants déterministes ─────────────────────────────────────────────

/** Rencontre de poule créée par le moteur : poule, rang dans la poule (dès 1) */
export const teamPoolMatchId = (competitionId: string, pool: number, index: number) =>
  `${competitionId}-p${pool}-${index}`;
/** Rencontre de tableau créée par le moteur : tour (taille), position */
export const teamTableauMatchId = (competitionId: string, round: number, position: number) =>
  `${competitionId}-t${round}-${position}`;
/** Relais d'une rencontre : ordre dès 1 */
export const relayId = (matchId: string, order: number) => `${matchId}-r${order}`;

// ─── Format, cible, titulaires ──────────────────────────────────────────────

export type TeamFormat = 'fie-relay' | 'laser-arena';

type TeamSettings = Pick<
  CompetitionSettings,
  'minTeamSize' | 'teamFormat' | 'laserTeamMode' | 'teamRelayStepSize'
>;

export const teamFormatOf = (settings?: Partial<TeamSettings> | null): TeamFormat =>
  settings?.teamFormat === 'laser-arena' ? 'laser-arena' : 'fie-relay';

/** Titulaires par équipe (réglage de l'épreuve, 3 par défaut) */
export const teamSizeOf = (settings?: Partial<TeamSettings> | null): number =>
  settings?.minTeamSize && settings.minTeamSize > 0 ? settings.minTeamSize : 3;

/**
 * Score maximal porté par chaque relais, comme l'écran : palier du relais FIE (5 par défaut),
 * plafond d'un assaut en arène Sabre Laser (5 touches)
 */
export function relayMaxScore(weapon: Weapon, settings?: Partial<TeamSettings> | null): number {
  if (teamFormatOf(settings) === 'laser-arena') return getLaserArenaBoutCap().maxTouches;
  return relayRuleOf(weapon, settings).stepSize;
}

/** Pas et cible cumulée du relais FIE (réglages de l'épreuve), comme l'arène équipe */
/** Règle de relais : pas du palier, cible, et touches ou points (Sabre Laser, zones 1/3/5) */
export interface RelayRule {
  stepSize: number;
  target: number;
  mode?: 'touches' | 'points';
  /** Relais FIE des armes olympiques (épée, fleuret, sabre) : règlement FIE (t.41) */
  fie?: boolean;
}

const FIE_WEAPONS: readonly Weapon[] = [Weapon.EPEE, Weapon.FOIL, Weapon.SABRE];

/** Valeur maximale d'une touche en mode points (Sabre Laser, cible C) */
const MAX_TOUCH_POINTS = 5;

/**
 * Dépassement du palier admis pour l'équipe qui termine le relais (ADR-0028, « Deux
 * règlements, deux barèmes ») :
 * - relais FIE (armes olympiques) : une touche par rouge adverse du relais (t.41.1,
 *   `relayScoreAboveMax`) ;
 * - Sabre Laser en points : la dernière touche peut valoir jusqu'à 5 points depuis palier − 1
 *   (Livret 2 FFE VIII.1 : « 14 + touche finale sur une cible vitale à 5 points » = 19) ;
 * - Sabre Laser en touches, arme à la carte : aucun (t.41.1 est une règle FIE ; à arbitrer
 *   pour le Sabre Laser, #2208).
 */
export function relayOvershoot(rule: RelayRule): number {
  return rule.mode === 'points' ? MAX_TOUCH_POINTS - 1 : 0;
}

export function relayRuleOf(weapon: Weapon, settings?: Partial<TeamSettings> | null): RelayRule {
  const rule = getTeamTargetRule(
    weapon,
    teamSizeOf(settings),
    settings?.laserTeamMode ?? 'touches',
    settings?.teamRelayStepSize ?? 5
  );
  return {
    stepSize: rule.stepSize,
    target: rule.target,
    mode: rule.mode,
    fie: FIE_WEAPONS.includes(weapon),
  };
}

/** Titulaires d'une équipe, par ordre (`teamOrder`), limités à la taille d'équipe */
export function titulars(team: TeamRow, teamSize: number): string[] {
  return team.fencers
    .filter(f => !f.isReserve)
    .sort((a, b) => a.teamOrder - b.teamOrder)
    .slice(0, teamSize)
    .map(f => f.fencerId);
}

/** Remplaçants d'une équipe, par ordre */
export function reserves(team: TeamRow): string[] {
  return team.fencers
    .filter(f => f.isReserve)
    .sort((a, b) => a.teamOrder - b.teamOrder)
    .map(f => f.fencerId);
}

// ─── Rencontre : ordre des relais ───────────────────────────────────────────

export interface RelayPlan {
  relayId: string;
  /** Ordre du relais, dès 1 */
  order: number;
  fencerAId: string;
  fencerBId: string;
}

/**
 * Relais d'une rencontre, fixés à sa création : `N²` relais dans l'ordre de l'arme
 * (`relayOrderFor` : ordre FIE à 3 titulaires en épée, fleuret, sabre), ou dans l'ordre de la
 * règle de rencontre de la phase (`pairs`, docs/adr/0044). null : titulaires manquants d'un côté.
 */
export function planRelays(
  matchId: string,
  teamA: TeamRow,
  teamB: TeamRow,
  teamSize: number,
  weapon: Weapon,
  pairs: ReadonlyArray<readonly [number, number]> = relayOrderFor(teamSize, weapon)
): RelayPlan[] | null {
  const a = titulars(teamA, teamSize);
  const b = titulars(teamB, teamSize);
  if (a.length < teamSize || b.length < teamSize) return null;
  return pairs.map(([i, j], k) => ({
    relayId: relayId(matchId, k + 1),
    order: k + 1,
    fencerAId: a[i],
    fencerBId: b[j],
  }));
}

// ─── Tirage des poules d'équipes ────────────────────────────────────────────

/** Numéro de poule des lettres du calendrier figé de l'arène Sabre Laser */
const ARENA_POOL_NUMBER: Record<string, number> = { A: 1, B: 2, C: 3 };

export interface TeamPoolMatchPlan {
  matchId: string;
  pool: number;
  /** Créneau du calendrier figé de l'arène Sabre Laser ; null en relais FIE */
  round: number | null;
  teamAId: string;
  teamBId: string;
  relays: RelayPlan[];
}

export interface TeamPoolsPlan {
  pools: Array<{ number: number; teamIds: string[] }>;
  matches: TeamPoolMatchPlan[];
}

export type TeamPoolsRefusal =
  | { code: 'not_enough_teams'; count: number }
  | { code: 'arena_team_count'; count: number }
  | { code: 'team_incomplete'; teamIds: string[]; teamSize: number };

/**
 * Tirage des poules d'équipes d'une formule (docs/adr/0044) : comme le tour individuel,
 * serpentin au rang d'entrée (ordre des équipes fourni), séparation par club, ordre des
 * rencontres de la table officielle pour la taille de poule ; relais dans l'ordre de la règle
 * de rencontre de la phase. Positions dans la poule tirées au sort (FIE §3, hasard injecté).
 */
export interface TeamPoolsDraw {
  poolCount: number;
  boutOrder: PoolBoutOrder;
  /** Titulaires de la règle de rencontre du tour */
  starters: number;
  /** Paires des relais de la règle de rencontre du tour (`relayPairsOf`) */
  pairs: ReadonlyArray<readonly [number, number]>;
  random: () => number;
}

/** Serpentin au rang d'entrée, puis clubs séparés dans le chapeau (défaut du tour individuel) */
const TEAM_POOL_SEPARATION: readonly PoolSeparation[] = [
  { key: 'byRanking', enabled: true },
  { key: 'byClub', enabled: true },
];

/** Équipe vue comme un tireur du tirage : rang d'entrée (position), club, nom */
const asEntrant = (team: TeamRow, entryRank: number): Fencer =>
  ({
    id: team.id,
    lastName: team.name,
    firstName: '',
    club: team.club,
    ranking: entryRank,
  }) as unknown as Fencer;

/**
 * Poules d'équipes, dans l'ordre des équipes fourni (sans formule : celui de l'écran, par nom ;
 * avec `draw` : l'ordre d'entrée effectif, teamEntryRanking).
 * Relais FIE sans `draw` : poule unique, tous contre tous (i < j), épreuve existante rejouée à
 * l'identique. Relais FIE avec `draw` : poules de la formule (docs/adr/0044), la poule unique en
 * est le cas particulier. Arène Sabre Laser : calendrier figé du règlement, 8 ou 12 équipes
 * seulement. Chaque rencontre porte ses relais.
 */
export function planTeamPools(
  competitionId: string,
  teams: TeamRow[],
  weapon: Weapon,
  settings?: Partial<TeamSettings> | null,
  draw?: TeamPoolsDraw
): TeamPoolsPlan | TeamPoolsRefusal {
  if (teams.length < 2) return { code: 'not_enough_teams', count: teams.length };
  const arena = teamFormatOf(settings) === 'laser-arena';
  const teamSize = !arena && draw ? draw.starters : teamSizeOf(settings);
  const pairsOf = !arena && draw ? draw.pairs : undefined;
  const incomplete = teams.filter(t => titulars(t, teamSize).length < teamSize).map(t => t.id);
  if (incomplete.length > 0) return { code: 'team_incomplete', teamIds: incomplete, teamSize };

  const pairs: Array<{ pool: number; round: number | null; a: TeamRow; b: TeamRow }> = [];
  let pools: TeamPoolsPlan['pools'];
  if (arena) {
    const schedule = getLaserArenaPoolSchedule(teams.length);
    if (!schedule) return { code: 'arena_team_count', count: teams.length };
    const byPool = new Map<number, string[]>();
    for (const m of resolveLaserArenaSchedule(teams, schedule)) {
      const pool = ARENA_POOL_NUMBER[m.pool] ?? 1;
      pairs.push({ pool, round: m.round, a: m.teamA, b: m.teamB });
      const ids = byPool.get(pool) ?? [];
      for (const id of [m.teamA.id, m.teamB.id]) if (!ids.includes(id)) ids.push(id);
      byPool.set(pool, ids);
    }
    pools = [...byPool.entries()]
      .sort(([x], [y]) => x - y)
      .map(([number, ids]) => ({
        number,
        teamIds: teams.map(t => t.id).filter(id => ids.includes(id)),
      }));
  } else if (draw) {
    const byId = new Map(teams.map(t => [t.id, t]));
    const drawn = distributePools(
      teams.map((t, i) => asEntrant(t, i + 1)),
      { poolCount: draw.poolCount, separation: TEAM_POOL_SEPARATION, random: draw.random }
    );
    pools = drawn.map((entrants, index) => {
      const plan = planPoolMatches(entrants, {
        separation: TEAM_POOL_SEPARATION,
        boutOrder: draw.boutOrder,
      });
      const placed = plan.positions.map(e => byId.get(e.id)!);
      for (const [x, y] of plan.bouts)
        pairs.push({ pool: index + 1, round: null, a: placed[x - 1], b: placed[y - 1] });
      return { number: index + 1, teamIds: placed.map(t => t.id) };
    });
  } else {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        pairs.push({ pool: 1, round: null, a: teams[i], b: teams[j] });
      }
    }
    pools = [{ number: 1, teamIds: teams.map(t => t.id) }];
  }

  const rank = new Map<number, number>();
  const matches = pairs.map(p => {
    const index = (rank.get(p.pool) ?? 0) + 1;
    rank.set(p.pool, index);
    const matchId = teamPoolMatchId(competitionId, p.pool, index);
    return {
      matchId,
      pool: p.pool,
      round: p.round,
      teamAId: p.a.id,
      teamBId: p.b.id,
      relays: planRelays(matchId, p.a, p.b, teamSize, weapon, pairsOf)!,
    };
  });
  return { pools, matches };
}

export const isTeamPoolsRefusal = (
  plan: TeamPoolsPlan | TeamPoolsRefusal
): plan is TeamPoolsRefusal => 'code' in plan;

// ─── Relais : le fait est le score du relais ────────────────────────────────

export interface RelayScore {
  order: number;
  scoreA: number;
  scoreB: number;
  /** Relais terminé (score du relais enregistré) */
  finished: boolean;
}

/** Cumul des relais terminés, jusqu'au relais `upTo` compris (tous par défaut) */
export function relayCumulative(
  relays: readonly RelayScore[],
  upTo = Number.POSITIVE_INFINITY
): { scoreA: number; scoreB: number } {
  return relays
    .filter(r => r.finished && r.order <= upTo)
    .reduce((s, r) => ({ scoreA: s.scoreA + r.scoreA, scoreB: s.scoreB + r.scoreB }), {
      scoreA: 0,
      scoreB: 0,
    });
}

/**
 * Palier cumulé du relais `order` : `min(ordre × pas, cible)` en relais FIE ; en arène Sabre
 * Laser, plafond de l'assaut (pas de cible cumulée).
 */
export function relayCap(
  order: number,
  format: TeamFormat,
  rule: { stepSize: number; target: number }
): number {
  return format === 'laser-arena' ? getLaserArenaBoutCap().maxTouches : relayCapFor(order, rule);
}

/** Vainqueur d'un relais : équipe en tête au cumul à la fin du relais (FIE) ; null : égalité */
export function relayLeader(relays: readonly RelayScore[], order: number): 'A' | 'B' | null {
  const { scoreA, scoreB } = relayCumulative(relays, order);
  return scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : null;
}

/**
 * Vainqueur d'un relais terminé : équipe en tête au cumul en relais FIE (comme l'arène),
 * meilleur score de l'assaut en arène Sabre Laser ; null : égalité
 */
export function relayWinner(
  relays: readonly RelayScore[],
  order: number,
  format: TeamFormat
): 'A' | 'B' | null {
  if (format === 'fie-relay') return relayLeader(relays, order);
  const r = relays.find(x => x.order === order);
  if (!r) return null;
  return r.scoreA > r.scoreB ? 'A' : r.scoreB > r.scoreA ? 'B' : null;
}

/**
 * Score d'un relais au-delà de ce qu'il peut porter (#2188) :
 * - relais FIE : cumul au-delà du palier (`min(ordre × pas, cible)`), sauf pour **une** équipe
 *   qui le dépasse d'au plus `relayOvershoot` (FIE : `penalties`, rouges adverses) ;
 * - arène Sabre Laser : score de l'assaut au-delà du plafond de touches (en points : plafond
 *   × 5, chaque touche pouvant valoir 5 points).
 */
export function relayScoreAboveMax(
  relays: readonly RelayScore[],
  order: number,
  scoreA: number,
  scoreB: number,
  format: TeamFormat,
  rule: RelayRule,
  penalties = { A: 0, B: 0 }
): boolean {
  const cap = relayCap(order, format, rule);
  if (format === 'laser-arena') {
    const max = rule.mode === 'points' ? cap * MAX_TOUCH_POINTS : cap;
    return scoreA > max || scoreB > max;
  }
  const before = relayCumulative(relays, order - 1);
  const overA = before.scoreA + scoreA - cap;
  const overB = before.scoreB + scoreB - cap;
  if (rule.fie) return overA > penalties.A || overB > penalties.B;
  if (overA > 0 && overB > 0) return true;
  return Math.max(overA, overB) > relayOvershoot(rule);
}

/** Le relais `order` peut s'enregistrer : tous les précédents sont terminés */
export function canRecordRelay(relays: readonly RelayScore[], order: number): boolean {
  return relays.filter(r => r.order < order).every(r => r.finished);
}

/**
 * Issue de la rencontre : terminée quand tous les relais le sont. Score = cumul des touches.
 * Égalité à la fin : le vainqueur est donné par l'appelant (minute avec priorité).
 */
export function teamMatchOutcome(
  relays: readonly RelayScore[],
  tieWinner?: 'A' | 'B'
): { finished: boolean; scoreA: number; scoreB: number; winner: 'A' | 'B' | null } {
  const { scoreA, scoreB } = relayCumulative(relays);
  const finished = relays.length > 0 && relays.every(r => r.finished);
  const winner = !finished
    ? null
    : scoreA > scoreB
      ? 'A'
      : scoreB > scoreA
        ? 'B'
        : (tieWinner ?? null);
  return { finished, scoreA, scoreB, winner };
}

// ─── Remplaçant (o.99.5, o.99.6) ────────────────────────────────────────────

export interface RelaySlot {
  relayId: string;
  order: number;
  fencerAId: string;
  fencerBId: string;
  finished: boolean;
}

export type SubstitutionResult =
  | { ok: true; side: 'A' | 'B'; relayIds: string[] }
  | { ok: false; reason: 'no_reserve' | 'reserve_used' | 'no_later_relay' | 'not_in_match' };

/**
 * Remplacement du tireur `outFencerId` par le remplaçant `inFencerId` de son équipe : il prend
 * sa place dans les relais non tirés. Un seul remplaçant par équipe et par rencontre
 * (`reserveUsed` : un relais de cette équipe porte déjà un remplaçant).
 */
export function planSubstitution(
  relays: readonly RelaySlot[],
  side: 'A' | 'B',
  outFencerId: string,
  inFencerId: string | null,
  reserveUsed: boolean
): SubstitutionResult {
  if (!inFencerId) return { ok: false, reason: 'no_reserve' };
  if (reserveUsed) return { ok: false, reason: 'reserve_used' };
  const of = (r: RelaySlot) => (side === 'A' ? r.fencerAId : r.fencerBId);
  if (!relays.some(r => of(r) === outFencerId)) return { ok: false, reason: 'not_in_match' };
  const later = relays.filter(r => !r.finished && of(r) === outFencerId);
  if (later.length === 0) return { ok: false, reason: 'no_later_relay' };
  return { ok: true, side, relayIds: later.map(r => r.relayId) };
}
