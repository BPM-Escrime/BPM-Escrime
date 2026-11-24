import type { SqlRow } from './rowMappers';
import { Card } from '../../shared/types';
import type { SqlExecutor } from './sqlExecutor';
import {
  PASSIVITY_REASON,
  PASSIVITY_TYPE_PREFIX,
  passivityTypeOf,
  type PassivityCardType,
} from '../../shared/domain/teams/passivityCardTypes';

/** Carton P d'une rencontre (team_match_cards, team_id NULL, docs/adr/0028 § 5 bis) */
export interface PassivityCardRow {
  id: string;
  matchId: string;
  type: PassivityCardType;
  createdAt: string;
}

/** Lignes de team_match_cards : cartons E (équipe sanctionnée), puis cartons P (migration 49) */
// substr plutôt que LIKE : « _ » y est un joker
const P_TYPE = `substr(type, 1, ${PASSIVITY_TYPE_PREFIX.length}) = '${PASSIVITY_TYPE_PREFIX}'`;
const TEAM_CARD_ONLY = `team_id IS NOT NULL AND NOT ${P_TYPE}`;
const PASSIVITY_ONLY = `team_id IS NULL AND ${P_TYPE}`;

const passivityRow = (r: SqlRow): PassivityCardRow => ({
  id: r.id as string,
  matchId: r.match_id as string,
  type: passivityTypeOf(r.type as string) ?? 'yellow',
  createdAt: r.created_at as string,
});

/** Équipes, rencontres, assauts et cartons par équipe (#1242) */
export class TeamRepo {
  constructor(private readonly sql: SqlExecutor) {}

  // ─── Équipes (compétitions par équipes) ─────────────────────────────────────

  public createTeam(competitionId: string, name: string, club: string): { id: string } {
    if (!this.sql.db) throw new Error('Database not open');
    const { v4: gen } = require('uuid');
    const id = gen();
    const now = new Date().toISOString();
    this.sql.run(
      `INSERT INTO teams (id, competition_id, name, club, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, competitionId, name, club, now, now]
    );
    return { id };
  }

  public getTeamsByCompetition(competitionId: string): Array<{
    id: string;
    name: string;
    club: string;
    fencers: Array<{
      fencerId: string;
      fencerLastName: string;
      fencerFirstName: string;
      teamOrder: number;
      isReserve: boolean;
    }>;
  }> {
    if (!this.sql.db) return [];
    const teams = this.sql.queryAll<SqlRow>(
      'SELECT * FROM teams WHERE competition_id = ? ORDER BY name',
      [competitionId]
    );
    return teams.map(t => {
      const fencers = this.sql.queryAll<SqlRow>(
        `SELECT tf.fencer_id, tf.team_order, tf.is_reserve, f.last_name, f.first_name
         FROM team_fencers tf JOIN fencers f ON tf.fencer_id = f.id
         WHERE tf.team_id = ? ORDER BY tf.team_order`,
        [t.id]
      );
      return {
        id: t.id as string,
        name: t.name as string,
        club: t.club as string,
        fencers: fencers.map(f => ({
          fencerId: f.fencer_id as string,
          fencerLastName: f.last_name as string,
          fencerFirstName: f.first_name as string,
          teamOrder: Number(f.team_order),
          isReserve: f.is_reserve === 1,
        })),
      };
    });
  }

  public deleteTeam(teamId: string): void {
    if (!this.sql.db) return;
    this.sql.run('DELETE FROM teams WHERE id = ?', [teamId]);
  }

  public upsertTeamFencer(
    teamId: string,
    fencerId: string,
    teamOrder: number,
    isReserve: boolean
  ): void {
    if (!this.sql.db) throw new Error('Database not open');
    const { v4: gen } = require('uuid');
    this.sql.run(
      `INSERT INTO team_fencers (id, team_id, fencer_id, team_order, is_reserve)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(team_id, fencer_id) DO UPDATE SET team_order = excluded.team_order, is_reserve = excluded.is_reserve`,
      [gen(), teamId, fencerId, teamOrder, isReserve ? 1 : 0]
    );
  }

  public removeTeamFencer(teamId: string, fencerId: string): void {
    if (!this.sql.db) return;
    this.sql.run('DELETE FROM team_fencers WHERE team_id = ? AND fencer_id = ?', [
      teamId,
      fencerId,
    ]);
  }

  // ─── Écritures du moteur (docs/adr/0024) : identifiants et heure fournis ────

  /** Équipe et son épreuve ; null : inconnue */
  public getTeam(teamId: string): { id: string; competitionId: string; name: string } | null {
    if (!this.sql.db) return null;
    const row = this.sql.queryOne<SqlRow>(
      'SELECT id, competition_id, name FROM teams WHERE id = ?',
      [teamId]
    );
    return row
      ? {
          id: row.id as string,
          competitionId: row.competition_id as string,
          name: row.name as string,
        }
      : null;
  }

  /** Équipe de l'épreuve où figure déjà le tireur ; null : aucune */
  public teamOfFencer(competitionId: string, fencerId: string): string | null {
    if (!this.sql.db) return null;
    const row = this.sql.queryOne<SqlRow>(
      `SELECT t.id FROM team_fencers tf JOIN teams t ON tf.team_id = t.id
       WHERE t.competition_id = ? AND tf.fencer_id = ?`,
      [competitionId, fencerId]
    );
    return row ? (row.id as string) : null;
  }

  /** Rencontres de l'épreuve, poules et tableau (poolsOnly : poules seules) */
  public countTeamMatches(competitionId: string, poolsOnly = false): number {
    if (!this.sql.db) return 0;
    const pools = poolsOnly ? ' AND table_id IS NULL' : '';
    const row = this.sql.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM team_matches WHERE competition_id = ?${pools}`,
      [competitionId]
    );
    return Number(row?.n ?? 0);
  }

  /** Relais commencés ou terminés des rencontres de poule de l'épreuve */
  public countPlayedPoolRelays(competitionId: string): number {
    if (!this.sql.db) return 0;
    const row = this.sql.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM team_bouts b JOIN team_matches m ON b.match_id = m.id
       WHERE m.competition_id = ? AND m.table_id IS NULL
         AND (b.status <> 'not_started' OR b.score_a > 0 OR b.score_b > 0)`,
      [competitionId]
    );
    return Number(row?.n ?? 0);
  }

  /** Rencontres de poule retirées, avec leurs relais et cartons (nouveau tirage) */
  public deleteTeamPoolMatches(competitionId: string): void {
    if (!this.sql.db) return;
    const ids = 'SELECT id FROM team_matches WHERE competition_id = ? AND table_id IS NULL';
    this.sql.run(`DELETE FROM team_bout_cards WHERE match_id IN (${ids})`, [competitionId]);
    this.sql.run(`DELETE FROM team_match_cards WHERE match_id IN (${ids})`, [competitionId]);
    this.sql.run(`DELETE FROM team_bouts WHERE match_id IN (${ids})`, [competitionId]);
    this.sql.run('DELETE FROM team_matches WHERE competition_id = ? AND table_id IS NULL', [
      competitionId,
    ]);
  }

  /** Rencontre de poule à l'identifiant donné ; createdAt fixe son rang dans la poule */
  public insertTeamPoolMatch(m: {
    id: string;
    competitionId: string;
    poolNumber: number;
    round: number | null;
    teamAId: string;
    teamBId: string;
    createdAt: string;
  }): void {
    if (!this.sql.db) throw new Error('Database not open');
    this.sql.run(
      `INSERT INTO team_matches (id, competition_id, pool_number, round, team_a_id, team_b_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'not_started', ?, ?)`,
      [m.id, m.competitionId, m.poolNumber, m.round, m.teamAId, m.teamBId, m.createdAt, m.createdAt]
    );
  }

  /** Relais à l'identifiant donné */
  public insertTeamBout(b: {
    id: string;
    matchId: string;
    order: number;
    fencerAId: string;
    fencerBId: string;
    maxScore: number;
    createdAt: string;
  }): void {
    if (!this.sql.db) throw new Error('Database not open');
    this.sql.run(
      `INSERT INTO team_bouts (id, match_id, bout_order, fencer_a_id, fencer_b_id, max_score, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'not_started', ?, ?)`,
      [b.id, b.matchId, b.order, b.fencerAId, b.fencerBId, b.maxScore, b.createdAt, b.createdAt]
    );
  }

  /** Rencontre de tableau à l'identifiant donné (tableau unique : table_id = épreuve) */
  public insertTeamTableauMatch(m: {
    id: string;
    competitionId: string;
    round: number;
    position: number;
    teamAId: string;
    teamBId: string;
    createdAt: string;
  }): void {
    if (!this.sql.db) throw new Error('Database not open');
    this.sql.run(
      `INSERT INTO team_matches (id, competition_id, pool_number, team_a_id, team_b_id, status, table_id, round, position, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?, 'not_started', ?, ?, ?, ?, ?)`,
      [
        m.id,
        m.competitionId,
        m.teamAId,
        m.teamBId,
        m.competitionId,
        m.round,
        m.position,
        m.createdAt,
        m.createdAt,
      ]
    );
  }

  /** Rencontres retirées avec leurs relais et cartons : une rencontre, ou tout le tableau */
  public deleteTeamMatches(competitionId: string, matchId?: string): void {
    if (!this.sql.db) return;
    const [ids, args] = matchId
      ? [
          'SELECT id FROM team_matches WHERE competition_id = ? AND id = ?',
          [competitionId, matchId],
        ]
      : [
          'SELECT id FROM team_matches WHERE competition_id = ? AND table_id IS NOT NULL',
          [competitionId],
        ];
    this.sql.run(`DELETE FROM team_bout_cards WHERE match_id IN (${ids})`, args);
    this.sql.run(`DELETE FROM team_match_cards WHERE match_id IN (${ids})`, args);
    this.sql.run(`DELETE FROM team_bouts WHERE match_id IN (${ids})`, args);
    this.sql.run(`DELETE FROM team_matches WHERE id IN (${ids})`, args);
  }

  /** Rencontre et ses relais ; null : inconnue. tableId : null en poule */
  public getTeamMatch(matchId: string): {
    id: string;
    competitionId: string;
    tableId: string | null;
    round: number | null;
    position: number | null;
    teamAId: string;
    teamBId: string;
    status: string;
    winnerId: string | null;
    bouts: Array<{
      id: string;
      boutOrder: number;
      fencerAId: string;
      fencerBId: string;
      scoreA: number;
      scoreB: number;
      status: string;
    }>;
  } | null {
    if (!this.sql.db) return null;
    const m = this.sql.queryOne<SqlRow>('SELECT * FROM team_matches WHERE id = ?', [matchId]);
    if (!m) return null;
    const bouts = this.sql.queryAll<SqlRow>(
      'SELECT * FROM team_bouts WHERE match_id = ? ORDER BY bout_order',
      [matchId]
    );
    return {
      id: m.id as string,
      competitionId: m.competition_id as string,
      tableId: (m.table_id as string) ?? null,
      round: m.round == null ? null : Number(m.round),
      position: m.position == null ? null : Number(m.position),
      teamAId: m.team_a_id as string,
      teamBId: m.team_b_id as string,
      status: m.status as string,
      winnerId: (m.winner_id as string) ?? null,
      bouts: bouts.map(b => ({
        id: b.id as string,
        boutOrder: Number(b.bout_order),
        fencerAId: b.fencer_a_id as string,
        fencerBId: b.fencer_b_id as string,
        scoreA: Number(b.score_a),
        scoreB: Number(b.score_b),
        status: b.status as string,
      })),
    };
  }

  /** Résultat d'un relais posé par le moteur, sans recalcul de la rencontre */
  public setTeamBoutResult(
    boutId: string,
    r: { scoreA: number; scoreB: number; status: string; winnerId: string | null; at: string }
  ): void {
    if (!this.sql.db) throw new Error('Database not open');
    this.sql.run(
      'UPDATE team_bouts SET score_a = ?, score_b = ?, status = ?, winner_id = ?, updated_at = ? WHERE id = ?',
      [r.scoreA, r.scoreB, r.status, r.winnerId, r.at, boutId]
    );
  }

  /** Score de rencontre calculé par le moteur (cumul des relais terminés) */
  public setTeamMatchResult(
    matchId: string,
    r: {
      scoreA: number;
      scoreB: number;
      status: string;
      winnerId: string | null;
      currentBoutIndex: number;
      at: string;
    }
  ): void {
    if (!this.sql.db) throw new Error('Database not open');
    this.sql.run(
      `UPDATE team_matches SET score_bouts_a = ?, score_bouts_b = ?, status = ?, winner_id = ?, current_bout_index = ?, updated_at = ? WHERE id = ?`,
      [r.scoreA, r.scoreB, r.status, r.winnerId, r.currentBoutIndex, r.at, matchId]
    );
  }

  public getTeamTableauMatches(
    competitionId: string,
    tableId: string
  ): Array<{
    id: string;
    round: number;
    position: number;
    teamAId: string;
    teamBId: string;
    scoreBoutsA: number;
    scoreBoutsB: number;
    status: string;
    winnerId: string | null;
    currentBoutIndex: number;
    bouts: Array<{
      id: string;
      boutOrder: number;
      fencerAId: string;
      fencerBId: string;
      scoreA: number;
      scoreB: number;
      maxScore: number;
      status: string;
      winnerId: string | null;
    }>;
  }> {
    if (!this.sql.db) return [];
    const matches = this.sql.queryAll<SqlRow>(
      'SELECT * FROM team_matches WHERE competition_id = ? AND table_id = ? ORDER BY round DESC, position',
      [competitionId, tableId]
    );
    return matches.map(m => {
      const bouts = this.sql.queryAll<SqlRow>(
        'SELECT * FROM team_bouts WHERE match_id = ? ORDER BY bout_order',
        [m.id]
      );
      return {
        id: m.id as string,
        round: Number(m.round),
        position: Number(m.position),
        teamAId: m.team_a_id as string,
        teamBId: m.team_b_id as string,
        scoreBoutsA: Number(m.score_bouts_a),
        scoreBoutsB: Number(m.score_bouts_b),
        status: m.status as string,
        winnerId: (m.winner_id as string) ?? null,
        currentBoutIndex: Number(m.current_bout_index),
        bouts: bouts.map(b => ({
          id: b.id as string,
          boutOrder: Number(b.bout_order),
          fencerAId: b.fencer_a_id as string,
          fencerBId: b.fencer_b_id as string,
          scoreA: Number(b.score_a),
          scoreB: Number(b.score_b),
          maxScore: Number(b.max_score),
          status: b.status as string,
          winnerId: (b.winner_id as string) ?? null,
        })),
      };
    });
  }

  public getTeamMatchesByCompetition(competitionId: string): Array<{
    id: string;
    poolNumber: number;
    round: number | null;
    teamAId: string;
    teamBId: string;
    scoreBoutsA: number;
    scoreBoutsB: number;
    status: string;
    winnerId: string | null;
    currentBoutIndex: number;
    bouts: Array<{
      id: string;
      boutOrder: number;
      fencerAId: string;
      fencerBId: string;
      scoreA: number;
      scoreB: number;
      maxScore: number;
      status: string;
      winnerId: string | null;
    }>;
  }> {
    if (!this.sql.db) return [];
    const matches = this.sql.queryAll<SqlRow>(
      'SELECT * FROM team_matches WHERE competition_id = ? AND table_id IS NULL ORDER BY pool_number, created_at',
      [competitionId]
    );
    return matches.map(m => {
      const bouts = this.sql.queryAll<SqlRow>(
        'SELECT * FROM team_bouts WHERE match_id = ? ORDER BY bout_order',
        [m.id]
      );
      return {
        id: m.id as string,
        poolNumber: Number(m.pool_number),
        round: m.round != null ? Number(m.round) : null,
        teamAId: m.team_a_id as string,
        teamBId: m.team_b_id as string,
        scoreBoutsA: Number(m.score_bouts_a),
        scoreBoutsB: Number(m.score_bouts_b),
        status: m.status as string,
        winnerId: (m.winner_id as string) ?? null,
        currentBoutIndex: Number(m.current_bout_index),
        bouts: bouts.map(b => ({
          id: b.id as string,
          boutOrder: Number(b.bout_order),
          fencerAId: b.fencer_a_id as string,
          fencerBId: b.fencer_b_id as string,
          scoreA: Number(b.score_a),
          scoreB: Number(b.score_b),
          maxScore: Number(b.max_score),
          status: b.status as string,
          winnerId: (b.winner_id as string) ?? null,
        })),
      };
    });
  }

  /** Remplaçant (#1829) : tireur d'un côté d'un relais pas encore tiré. */
  public setTeamBoutFencer(
    boutId: string,
    side: 'A' | 'B',
    fencerId: string,
    /** Heure fournie par le moteur (docs/adr/0024) ; défaut : maintenant */
    at: string = new Date().toISOString()
  ): void {
    if (!this.sql.db) return;
    const column = side === 'A' ? 'fencer_a_id' : 'fencer_b_id';
    this.sql.run(`UPDATE team_bouts SET ${column} = ?, updated_at = ? WHERE id = ?`, [
      fencerId,
      at,
      boutId,
    ]);
  }

  // ── Cartons d'équipe "E" (format arène Sabre Laser) ─────────────────────────
  // Traçabilité uniquement : ces cartons n'affectent pas encore le score
  // (impact en points pas encore tranché par le règlement).

  public createTeamMatchCard(
    matchId: string,
    teamId: string,
    type: 'white' | 'yellow' | 'red' | 'black',
    reason: string,
    /** Identifiant et heure fournis par le moteur (docs/adr/0028) ; défaut : tirés ici */
    given?: { id: string; at: string }
  ): { id: string } {
    if (!this.sql.db) throw new Error('Database not open');
    const id: string = given?.id ?? require('uuid').v4();
    const now = given?.at ?? new Date().toISOString();
    this.sql.run(
      `INSERT INTO team_match_cards (id, match_id, team_id, type, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, matchId, teamId, type, reason, now]
    );
    return { id };
  }

  // ── Cartons individuels des relais par équipes (#1086) ─────────────────────

  public createTeamBoutCard(boutId: string, card: Card): { id: string } {
    if (!this.sql.db) throw new Error('Database not open');
    this.sql.run(
      `INSERT INTO team_bout_cards (id, match_id, bout_id, fencer_id, card_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        card.id,
        card.matchId,
        boutId,
        card.fencerId,
        JSON.stringify(card),
        new Date(card.timestamp).toISOString(),
      ]
    );
    return { id: card.id };
  }

  /** Cartons d'une rencontre, groupés par relais (ordre chronologique). */
  public getTeamBoutCards(matchId: string): Array<{ boutId: string; card: Card }> {
    if (!this.sql.db) return [];
    const rows = this.sql.queryAll<{ bout_id: string; card_json: string }>(
      'SELECT bout_id, card_json FROM team_bout_cards WHERE match_id = ? ORDER BY created_at, rowid',
      [matchId]
    );
    return rows.map(r => {
      const card = JSON.parse(r.card_json) as Card;
      return {
        boutId: r.bout_id,
        card: { ...card, timestamp: new Date(card.timestamp) },
      };
    });
  }

  public getTeamMatchCards(matchId: string): Array<{
    id: string;
    matchId: string;
    teamId: string;
    type: string;
    reason: string;
    createdAt: string;
  }> {
    if (!this.sql.db) return [];
    const rows = this.sql.queryAll<SqlRow>(
      `SELECT * FROM team_match_cards WHERE match_id = ? AND ${TEAM_CARD_ONLY}
       ORDER BY created_at, rowid`,
      [matchId]
    );
    return rows.map(r => ({
      id: r.id as string,
      matchId: r.match_id as string,
      teamId: r.team_id as string,
      type: r.type as string,
      reason: r.reason as string,
      createdAt: r.created_at as string,
    }));
  }

  // ── Cartons P (non-combativité) des relais par équipes (docs/adr/0028 § 5 bis) ──
  // Même table que les cartons E : team_id NULL (carton donné aux deux équipes, migration
  // 49), type préfixé `p_`. Les lectures des cartons E les écartent (TEAM_CARD_ONLY).

  public createPassivityCard(
    matchId: string,
    type: 'yellow' | 'red' | 'black',
    given: { id: string; at: string }
  ): { id: string } {
    if (!this.sql.db) throw new Error('Database not open');
    this.sql.run(
      `INSERT INTO team_match_cards (id, match_id, team_id, type, reason, created_at)
       VALUES (?, ?, NULL, ?, ?, ?)`,
      [given.id, matchId, `${PASSIVITY_TYPE_PREFIX}${type}`, PASSIVITY_REASON, given.at]
    );
    return { id: given.id };
  }

  /** Cartons P d'une rencontre, dans l'ordre d'attribution */
  public getPassivityCards(matchId: string): PassivityCardRow[] {
    if (!this.sql.db) return [];
    return this.sql
      .queryAll<SqlRow>(
        `SELECT * FROM team_match_cards WHERE match_id = ? AND ${PASSIVITY_ONLY}
         ORDER BY created_at, rowid`,
        [matchId]
      )
      .map(passivityRow);
  }

  /** Carton E retiré (annulation par le Directoire technique, docs/adr/0028) */
  public deleteTeamMatchCard(cardId: string): void {
    if (!this.sql.db) throw new Error('Database not open');
    this.sql.run('DELETE FROM team_match_cards WHERE id = ?', [cardId]);
  }

  /** Carton individuel d'un relais retiré (annulation, docs/adr/0028) */
  public deleteTeamBoutCard(cardId: string): void {
    if (!this.sql.db) throw new Error('Database not open');
    this.sql.run('DELETE FROM team_bout_cards WHERE id = ?', [cardId]);
  }

  /** Cartons E et cartons individuels des rencontres d'une épreuve (bloc « teams ») */
  public getTeamCardsByCompetition(competitionId: string): {
    matchCards: Array<{
      id: string;
      matchId: string;
      teamId: string;
      type: string;
      reason: string;
      createdAt: string;
    }>;
    boutCards: Array<{ boutId: string; card: Card }>;
    passivityCards: PassivityCardRow[];
  } {
    if (!this.sql.db) return { matchCards: [], boutCards: [], passivityCards: [] };
    const scope = 'match_id IN (SELECT id FROM team_matches WHERE competition_id = ?)';
    const matchCards = this.sql
      .queryAll<SqlRow>(
        `SELECT * FROM team_match_cards WHERE ${scope} AND ${TEAM_CARD_ONLY}
         ORDER BY created_at, rowid`,
        [competitionId]
      )
      .map(r => ({
        id: r.id as string,
        matchId: r.match_id as string,
        teamId: r.team_id as string,
        type: r.type as string,
        reason: r.reason as string,
        createdAt: r.created_at as string,
      }));
    const passivityCards = this.sql
      .queryAll<SqlRow>(
        `SELECT * FROM team_match_cards WHERE ${scope} AND ${PASSIVITY_ONLY}
         ORDER BY created_at, rowid`,
        [competitionId]
      )
      .map(passivityRow);
    const boutCards = this.sql
      .queryAll<{ bout_id: string; card_json: string }>(
        `SELECT bout_id, card_json FROM team_bout_cards WHERE ${scope} ORDER BY created_at, rowid`,
        [competitionId]
      )
      .map(r => {
        const card = JSON.parse(r.card_json) as Card;
        return { boutId: r.bout_id, card: { ...card, timestamp: new Date(card.timestamp) } };
      });
    return { matchCards, boutCards, passivityCards };
  }

  // ── Format arène Sabre Laser : saisie temps réel (tablette arbitre) ─────────
  // Résout un match d'équipe avec noms d'équipes/tireurs pour la diffusion en
  // direct, sans que le renderer ait à repousser ces données via IPC : le
  // serveur de score distant lit directement la DB (il en a déjà l'accès).

  public getTeamMatchDetail(matchId: string): {
    id: string;
    competitionId: string;
    teamAId: string;
    teamAName: string;
    teamBId: string;
    teamBName: string;
    status: string;
    currentBoutIndex: number;
    /** Poule de la rencontre, ou tour et position du tableau ; rang dans la poule (dès 1) */
    poolNumber: number;
    round: number | null;
    position: number | null;
    number: number;
    bouts: Array<{
      id: string;
      boutOrder: number;
      fencerAId: string;
      fencerAName: string;
      fencerBId: string;
      fencerBName: string;
      scoreA: number;
      scoreB: number;
      maxScore: number;
      status: string;
      winnerId: string | null;
    }>;
  } | null {
    if (!this.sql.db) return null;
    const m = this.sql.queryOne<SqlRow>('SELECT * FROM team_matches WHERE id = ?', [matchId]);
    if (!m) return null;
    const teamA = this.sql.queryOne<SqlRow>('SELECT name FROM teams WHERE id = ?', [m.team_a_id]);
    const teamB = this.sql.queryOne<SqlRow>('SELECT name FROM teams WHERE id = ?', [m.team_b_id]);
    const bouts = this.sql.queryAll<SqlRow>(
      `SELECT b.*, fa.last_name AS fa_last, fa.first_name AS fa_first, fb.last_name AS fb_last, fb.first_name AS fb_first
       FROM team_bouts b
       JOIN fencers fa ON b.fencer_a_id = fa.id
       JOIN fencers fb ON b.fencer_b_id = fb.id
       WHERE b.match_id = ? ORDER BY b.bout_order`,
      [matchId]
    );
    // Rang de la rencontre dans sa poule (ordre de création) : n° de match de l'affichage
    const before = this.sql.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM team_matches
       WHERE competition_id = ? AND pool_number = ? AND round IS NULL AND created_at < ?`,
      [m.competition_id, m.pool_number, m.created_at]
    );
    return {
      id: m.id as string,
      competitionId: m.competition_id as string,
      poolNumber: Number(m.pool_number) || 1,
      round: m.round == null ? null : Number(m.round),
      position: m.position == null ? null : Number(m.position),
      number: (before?.n ?? 0) + 1,
      teamAId: m.team_a_id as string,
      teamAName: (teamA?.name as string) ?? '—',
      teamBId: m.team_b_id as string,
      teamBName: (teamB?.name as string) ?? '—',
      status: m.status as string,
      currentBoutIndex: Number(m.current_bout_index),
      bouts: bouts.map(b => ({
        id: b.id as string,
        boutOrder: Number(b.bout_order),
        fencerAId: b.fencer_a_id as string,
        fencerAName: `${b.fa_last} ${b.fa_first ?? ''}`.trim(),
        fencerBId: b.fencer_b_id as string,
        fencerBName: `${b.fb_last} ${b.fb_first ?? ''}`.trim(),
        scoreA: Number(b.score_a),
        scoreB: Number(b.score_b),
        maxScore: Number(b.max_score),
        status: b.status as string,
        winnerId: (b.winner_id as string) ?? null,
      })),
    };
  }
}
