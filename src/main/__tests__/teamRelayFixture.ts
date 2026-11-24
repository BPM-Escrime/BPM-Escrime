/**
 * Rencontre par équipes sur base réelle pour les tests de l'arène équipe et des appareils de
 * piste (docs/adr/0024, lot E4) : épreuve, deux équipes inscrites par les commandes, poule
 * tirée par le moteur (generateTeamPools, relais dans l'ordre FIE), relais joués par
 * recordRelayScore. Le fichier de test déclare le mock de better-sqlite3 (NodeSqliteDatabase).
 */
import { DatabaseManager } from '../../database';
import { Category, FencerStatus, Gender, type Weapon } from '../../shared/types';
import { buildDefaultCompetitionSettings } from '../../shared/utils/defaultCompetitionSettings';
import { projectCompetition } from '../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../shared/domain/journal/compareWithState';
import { invokeCommandSync } from '../engine/api/engine';
import { teamStateView } from '../engine/commands/teams';
import type { CommandContext } from '../engine/commands/context';

export interface TeamFencerSpec {
  lastName: string;
  firstName: string;
  nationality?: string;
}

export interface TeamRelayFixture {
  db: DatabaseManager;
  ctx: CommandContext;
  competitionId: string;
  matchId: string;
  teamAId: string;
  teamBId: string;
  /** Tireurs de l'équipe A de la rencontre : titulaires dans l'ordre, puis remplaçant */
  A: string[];
  B: string[];
  /** Tireurs du relais n (dès 1) : [équipe A, équipe B] */
  relay(n: number): [string, string];
  /** Identifiant d'un relais (dès 1) */
  boutId(n: number): string;
  /** Relais joués par recordRelayScore (score de chaque relais) */
  play(scores: Array<[number, number]>): void;
  /** Journal rejoué comparé aux tables des équipes */
  divergences(): unknown[];
}

const DEFAULT_TEAMS: Array<{ name: string; fencers: TeamFencerSpec[]; reserve?: TeamFencerSpec }> =
  [
    {
      name: 'Paris',
      fencers: [
        { lastName: 'Martin', firstName: 'Paul', nationality: 'FRA' },
        { lastName: 'Bernard', firstName: 'Luc', nationality: 'FRA' },
        { lastName: 'Thomas', firstName: 'Eric', nationality: 'FRA' },
      ],
      reserve: { lastName: 'Petit', firstName: 'Hugo', nationality: 'FRA' },
    },
    {
      name: 'Roma',
      fencers: [
        { lastName: 'Rossi', firstName: 'Marco', nationality: 'ITA' },
        { lastName: 'Bianchi', firstName: 'Luca', nationality: 'ITA' },
        { lastName: 'Romano', firstName: 'Gino', nationality: 'ITA' },
      ],
    },
  ];

export async function teamRelayFixture(
  options: {
    weapon?: Weapon;
    settings?: Record<string, unknown>;
    teams?: typeof DEFAULT_TEAMS;
  } = {}
): Promise<TeamRelayFixture> {
  const db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  const ctx: CommandContext = { db, emitChange: () => {} };
  const weapon = options.weapon ?? ('S' as Weapon);
  const comp = db.createCompetition({
    title: 'Coupe par équipes',
    date: new Date('2026-12-06'),
    location: 'Gymnase',
    weapon,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    isTeamEvent: true,
    settings: {
      // Réglages de base de l'épée (le laser n'a pas de score de poule par défaut)
      ...buildDefaultCompetitionSettings({ weapon: 'E' as Weapon, category: Category.SENIOR }),
      minTeamSize: 3,
      teamRelayStepSize: 5,
      ...options.settings,
    } as never,
  });
  const cmd = (name: string, input: Record<string, unknown>) =>
    invokeCommandSync(ctx, name as never, input as never) as never as Record<string, any>;
  const members = new Map<string, string[]>();
  for (const team of options.teams ?? DEFAULT_TEAMS) {
    const { team: t } = cmd('registerTeam', { competitionId: comp.id, name: team.name });
    const list = [...team.fencers, ...(team.reserve ? [team.reserve] : [])];
    const ids = list.map((f, k) => {
      const id = db.addFencer(comp.id, { ...f, status: FencerStatus.CHECKED_IN }).id;
      cmd('assignTeamFencer', {
        competitionId: comp.id,
        teamId: t.id,
        fencerId: id,
        teamOrder: k + 1,
        isReserve: k >= team.fencers.length,
      });
      return id;
    });
    members.set(t.id, ids);
  }
  cmd('generateTeamPools', { competitionId: comp.id });
  const [match] = db.getTeamMatchesByCompetition(comp.id);
  const bout = (n: number) => db.teams.getTeamMatch(match.id)!.bouts[n - 1];
  return {
    db,
    ctx,
    competitionId: comp.id,
    matchId: match.id,
    teamAId: match.teamAId,
    teamBId: match.teamBId,
    A: members.get(match.teamAId)!,
    B: members.get(match.teamBId)!,
    relay: n => [bout(n).fencerAId, bout(n).fencerBId],
    boutId: n => bout(n).id,
    play: scores => {
      for (const [scoreA, scoreB] of scores) {
        const done = db.teams.getTeamMatch(match.id)!.bouts.filter(b => b.status === 'finished');
        cmd('recordRelayScore', {
          competitionId: comp.id,
          matchId: match.id,
          relay: done.length + 1,
          scoreA,
          scoreB,
        });
      }
    },
    divergences: () => {
      const c = db.getCompetition(comp.id)!;
      return compareWithState(
        projectCompetition(db.eventLog.getSince(comp.id)),
        { ...stateView({}, c.settings), teams: teamStateView(ctx, c) },
        // Statuts des tireurs : retrait par un carton noir (docs/adr/0028)
        Object.fromEntries(db.getFencersByCompetition(comp.id).map(f => [f.id, f.status]))
      );
    },
  };
}
