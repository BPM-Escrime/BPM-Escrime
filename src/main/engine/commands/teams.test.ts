/**
 * Épreuves par équipes par le moteur (docs/adr/0024, lot E1) : inscription des équipes et
 * composition sans journal, tirage des poules d'équipes journalisé (TeamPoolsGenerated,
 * TeamMatchScheduled), bloc « teams » de getCompetitionState, rejeu sans écart, refus, et
 * non-régression des écritures de l'écran (délégations de la base). Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../../shared/domain/journal/compareWithState';
import { CONTRACT_MCP_TOOLS } from '../api/mcpAdapter';
import type { CommandContext } from './context';
import { teamStateView } from './teams';
import { invoke } from '../api/engine';
import {
  insertLegacyTeamMatch,
  writeLegacyRelay,
} from '../../../database/testing/legacyTeamWrites';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db, emitChange: () => {} };
});
afterEach(() => db.close());

const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;
const events = (id: string) => db.eventLog.getSince(id);
const revision = (id: string) => db.eventLog.getRevision(id);
/** État de l'épreuve : l'écran n'écrit plus rien, le bloc « teams » vient des tables (lot N) */
const stateOf = async (id: string) =>
  (await call('getCompetitionState', { competitionId: id })).state;

function competition(weapon: Weapon, team = true, settings: Record<string, unknown> = {}) {
  return db.createCompetition({
    title: 'Coupe par équipes',
    date: new Date('2026-12-06'),
    location: 'Gymnase',
    weapon,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    isTeamEvent: team,
    settings: {
      // Réglages de base d'une épreuve d'épée : la formule n'entre pas en jeu ici
      ...buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
      minTeamSize: 3,
      ...settings,
    } as never,
  });
}

const fencer = (competitionId: string, name: string) =>
  db.addFencer(competitionId, {
    lastName: name,
    firstName: 'P',
    gender: Gender.MALE,
    status: FencerStatus.CHECKED_IN,
  }).id;

/** Équipes inscrites par les commandes : 3 titulaires et un remplaçant chacune */
async function teamsRegistered(competitionId: string, names: string[], titulars = 3) {
  const ids: string[] = [];
  for (const name of names) {
    const { team } = await call('registerTeam', { competitionId, name });
    ids.push(team.id);
    for (let k = 1; k <= titulars + 1; k++) {
      await call('assignTeamFencer', {
        competitionId,
        teamId: team.id,
        fencerId: fencer(competitionId, `${name}${k}`),
        teamOrder: k,
        isReserve: k > titulars,
      });
    }
  }
  return ids;
}

/** Journal rejoué comparé à l'état et aux tables des équipes */
function replay(competitionId: string) {
  const facts = projectCompetition(events(competitionId));
  const comp = db.getCompetition(competitionId)!;
  const statuses = Object.fromEntries(
    db.getFencersByCompetition(competitionId).map(f => [f.id, f.status as string])
  );
  const state = {
    ...stateView(
      (db.getSessionState(competitionId) ?? {}) as Record<string, unknown>,
      comp.settings
    ),
    teams: teamStateView(ctx, comp),
  };
  return { facts, divergences: compareWithState(facts, state, statuses) };
}

d('Inscription des équipes et composition (docs/adr/0024, lot E1)', () => {
  it('inscrit, compose et supprime sans journal', async () => {
    const comp = competition(Weapon.EPEE);
    const [a] = await teamsRegistered(comp.id, ['Paris']);
    const teams = db.getTeamsByCompetition(comp.id);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ name: 'Paris', club: 'Paris' });
    expect(teams[0].fencers.map(f => [f.teamOrder, f.isReserve])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, true],
    ]);
    // Déplacement dans la même équipe : admis
    const f1 = teams[0].fencers[0].fencerId;
    await call('assignTeamFencer', {
      competitionId: comp.id,
      teamId: a,
      fencerId: f1,
      teamOrder: 5,
    });
    await call('unassignTeamFencer', { competitionId: comp.id, teamId: a, fencerId: f1 });
    expect(db.getTeamsByCompetition(comp.id)[0].fencers).toHaveLength(3);
    const dry = await call('unregisterTeam', { competitionId: comp.id, teamId: a, dryRun: true });
    expect(dry).toEqual({ dryRun: true, teamId: a });
    expect(db.getTeamsByCompetition(comp.id)).toHaveLength(1);
    await call('unregisterTeam', { competitionId: comp.id, teamId: a });
    expect(db.getTeamsByCompetition(comp.id)).toEqual([]);
    expect(revision(comp.id)).toBe(0);
  });

  it('refus : épreuve individuelle, équipe inconnue, tireur d’une autre épreuve ou d’une autre équipe', async () => {
    const solo = competition(Weapon.EPEE, false);
    await expect(call('registerTeam', { competitionId: solo.id, name: 'X' })).rejects.toMatchObject(
      { code: 'unsupported_format' }
    );
    const comp = competition(Weapon.EPEE);
    const [a, b] = await teamsRegistered(comp.id, ['A', 'B']);
    const other = competition(Weapon.EPEE);
    const [c] = await teamsRegistered(other.id, ['C']);
    const inA = db.getTeamsByCompetition(comp.id).find(t => t.id === a)!.fencers[0].fencerId;
    const reject = (op: string, input: Record<string, unknown>) =>
      expect(call(op, { competitionId: comp.id, ...input })).rejects;
    await reject('unregisterTeam', { teamId: c }).toMatchObject({ code: 'team_not_found' });
    await reject('assignTeamFencer', {
      teamId: a,
      fencerId: fencer(other.id, 'Z'),
      teamOrder: 1,
    }).toMatchObject({ code: 'fencer_not_found' });
    await reject('assignTeamFencer', { teamId: b, fencerId: inA, teamOrder: 1 }).toMatchObject({
      code: 'invalid_composition',
    });
    await reject('unassignTeamFencer', { teamId: b, fencerId: inA }).toMatchObject({
      code: 'fencer_not_found',
    });
    await reject('registerTeam', { name: '  ' }).toMatchObject({ code: 'invalid_input' });
  });
});

d('generateTeamPools : poules d’équipes tirées par le moteur (docs/adr/0024, lot E1)', () => {
  it('relais FIE : poule unique, rencontres et relais déterministes, journal, rejeu sans écart', async () => {
    const comp = competition(Weapon.EPEE);
    const [a, b, c] = await teamsRegistered(comp.id, ['Alpha', 'Bravo', 'Charlie']);

    const dry = await call('generateTeamPools', { competitionId: comp.id, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, relayCount: 27 });
    expect(db.getTeamMatchesByCompetition(comp.id)).toEqual([]);
    expect(revision(comp.id)).toBe(0);

    const out = await call('generateTeamPools', { competitionId: comp.id, commandId: 'cmd-tp' });
    expect(out).toMatchObject({
      dryRun: false,
      pools: [{ number: 1, teamIds: [a, b, c] }],
      matchIds: [`${comp.id}-p1-1`, `${comp.id}-p1-2`, `${comp.id}-p1-3`],
      relayCount: 27,
      revision: 4,
    });

    // Tables : rencontres et relais aux identifiants déterministes, ordre FIE, palier 5
    const matches = db.getTeamMatchesByCompetition(comp.id);
    expect(matches.map(m => [m.id, m.teamAId, m.teamBId, m.poolNumber])).toEqual([
      [`${comp.id}-p1-1`, a, b, 1],
      [`${comp.id}-p1-2`, a, c, 1],
      [`${comp.id}-p1-3`, b, c, 1],
    ]);
    const teams = db.getTeamsByCompetition(comp.id);
    const tit = (id: string) => teams.find(t => t.id === id)!.fencers.map(f => f.fencerId);
    const first = matches[0].bouts;
    expect(first).toHaveLength(9);
    expect(first[0]).toMatchObject({
      id: `${comp.id}-p1-1-r1`,
      boutOrder: 1,
      fencerAId: tit(a)[2],
      fencerBId: tit(b)[2],
      maxScore: 5,
      status: 'not_started',
    });
    expect(first.every(r => !tit(a).slice(3).includes(r.fencerAId))).toBe(true);
    // Rang de la rencontre dans sa poule (affichage des arènes)
    expect(db.getTeamMatchDetail(matches[2].id)?.number).toBe(3);

    // Journal : un tirage, puis une rencontre par événement, même commandId
    const log = events(comp.id);
    expect(log.map(e => e.type)).toEqual([
      'TeamPoolsGenerated',
      'TeamMatchScheduled',
      'TeamMatchScheduled',
      'TeamMatchScheduled',
    ]);
    expect(new Set(log.map(e => e.commandId))).toEqual(new Set(['cmd-tp']));
    expect(log[1].payload).toMatchObject({
      matchId: `${comp.id}-p1-1`,
      teamAId: a,
      teamBId: b,
      pool: 1,
      round: null,
      position: null,
    });

    const { facts, divergences } = replay(comp.id);
    expect(facts.complete).toBe(true);
    expect(facts.teams?.matches).toHaveLength(3);
    expect(divergences).toEqual([]);
    const rebuild = await call('rebuildCompetitionState', { competitionId: comp.id, dryRun: true });
    expect(rebuild.divergences).toEqual([]);

    // Bloc « teams » de getCompetitionState, sans écriture de l'écran (lot N) ; phase déduite
    // des tables : poules d'équipes tirées
    expect(db.getSessionState(comp.id)).toBeNull();
    const state = await stateOf(comp.id);
    expect(state.currentPhase).toBe(11);
    expect(state.teams).toMatchObject({ format: 'fie-relay', teamSize: 3 });
    expect(state.teams.teams.map((t: { id: string }) => t.id)).toEqual([a, b, c]);
    expect(state.teams.poolMatches).toHaveLength(3);
    expect(state.teams.poolMatches[0]).toMatchObject({ poolNumber: 1, position: null });
    expect(state.teams.poolMatches[0].bouts).toHaveLength(9);
    expect(state.teams.tableauMatches).toEqual([]);
    expect(state.teams.poolRanking.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3]);
  });

  it('composition figée après le tirage ; nouveau tirage par « replace » tant qu’aucun relais n’est joué', async () => {
    const comp = competition(Weapon.FOIL);
    const [a, b] = await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    const f = db.getTeamsByCompetition(comp.id)[0].fencers[0].fencerId;
    const reject = (op: string, input: Record<string, unknown>) =>
      expect(call(op, { competitionId: comp.id, ...input })).rejects;
    await reject('unregisterTeam', { teamId: a }).toMatchObject({ code: 'draw_done' });
    await reject('assignTeamFencer', { teamId: b, fencerId: f, teamOrder: 1 }).toMatchObject({
      code: 'draw_done',
    });
    await reject('unassignTeamFencer', { teamId: a, fencerId: f }).toMatchObject({
      code: 'draw_done',
    });
    await reject('generateTeamPools', {}).toMatchObject({ code: 'draw_done' });

    // Une équipe inscrite après le tirage entre au nouveau tirage
    const { team } = await call('registerTeam', { competitionId: comp.id, name: 'C' });
    for (const [k, name] of ['C1', 'C2', 'C3'].entries()) {
      db.upsertTeamFencer(team.id, fencer(comp.id, name), k + 1, false);
    }
    const again = await call('generateTeamPools', { competitionId: comp.id, replace: true });
    expect(again.matchIds).toHaveLength(3);
    expect(db.getTeamMatchesByCompetition(comp.id)).toHaveLength(3);
    expect(replay(comp.id).divergences).toEqual([]);

    // Relais joué : plus de nouveau tirage
    const played = db.getTeamMatchesByCompetition(comp.id)[0];
    await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: played.id,
      relay: 1,
      scoreA: 5,
      scoreB: 2,
    });
    await reject('generateTeamPools', { replace: true }).toMatchObject({
      code: 'pools_have_scores',
    });
  });

  it('arène Sabre Laser : calendrier figé de 8 équipes, plafond 5 ; refus hors 8 ou 12', async () => {
    const comp = competition(Weapon.LASER, true, {
      teamFormat: 'laser-arena',
    });
    const names = ['A', 'B', 'C'];
    await teamsRegistered(comp.id, names);
    await expect(call('generateTeamPools', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'invalid_composition',
    });
    await teamsRegistered(comp.id, ['D', 'E', 'F', 'G', 'H']);
    const out = await call('generateTeamPools', { competitionId: comp.id });
    expect(out.pools.map((p: { number: number }) => p.number)).toEqual([1, 2]);
    expect(out.matchIds).toHaveLength(12);
    const matches = db.getTeamMatchesByCompetition(comp.id);
    expect(matches[0]).toMatchObject({ poolNumber: 1, round: 1 });
    expect(matches.every(m => m.bouts.every(r => r.maxScore === 5))).toBe(true);
    expect(replay(comp.id).divergences).toEqual([]);
    const state = await stateOf(comp.id);
    expect(state.teams.format).toBe('laser-arena');
    expect(state.teams.poolRanking).toHaveLength(8);
  });

  it('refus : titulaires manquants, moins de 2 équipes, épreuve individuelle ; generatePools nomme la commande d’équipe', async () => {
    const comp = competition(Weapon.SABRE);
    await teamsRegistered(comp.id, ['A']);
    await expect(call('generateTeamPools', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'invalid_composition',
    });
    const [b] = await teamsRegistered(comp.id, ['B'], 2);
    await expect(call('generateTeamPools', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'team_incomplete',
      message: expect.stringContaining(b),
    });
    await expect(call('generatePools', { competitionId: comp.id })).rejects.toMatchObject({
      code: 'unsupported_format',
      message: expect.stringContaining('generateTeamPools'),
    });
    const solo = competition(Weapon.SABRE, false);
    await expect(call('generateTeamPools', { competitionId: solo.id })).rejects.toMatchObject({
      code: 'unsupported_format',
    });
    expect(revision(comp.id)).toBe(0);
  });

  it('écarts : relais retiré ou rencontre hors journal signalés', async () => {
    const comp = competition(Weapon.EPEE);
    const [a, b] = await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    const [m] = db.getTeamMatchesByCompetition(comp.id);
    // Écriture hors moteur (version antérieure) : rencontre sans journal
    insertLegacyTeamMatch(db, { competitionId: comp.id, teamAId: b, teamBId: a, relays: [] });
    const { divergences } = replay(comp.id);
    expect(divergences).toEqual([expect.objectContaining({ kind: 'team_match_unexpected' })]);
    db.teams.deleteTeamPoolMatches(comp.id);
    expect(replay(comp.id).divergences).toEqual([
      { kind: 'team_pool', id: '1', expected: [a, b], actual: [] },
      { kind: 'team_match_missing', id: m.id },
    ]);
  });

  it('outil MCP generate_team_pools (écriture sportive)', () => {
    const tool = CONTRACT_MCP_TOOLS.write.find(t => t.name === 'generate_team_pools');
    expect(tool?.inputSchema.required).toEqual(['competitionId']);
  });
});

d('Reprise : rencontres écrites par une version antérieure (UUID, sans journal)', () => {
  it('rencontres de l’ancien écran (UUID) lues dans le bloc « teams », journal incomplet sans écart', async () => {
    const comp = competition(Weapon.EPEE);
    const [a, b] = await teamsRegistered(comp.id, ['A', 'B']);
    // Ancien chemin de TeamManagerView (avant E3) : rencontre, relais, puis score par la base
    const teams = db.getTeamsByCompetition(comp.id);
    const { id, boutIds } = insertLegacyTeamMatch(db, {
      competitionId: comp.id,
      teamAId: a,
      teamBId: b,
      relays: [[teams[0].fencers[0].fencerId, teams[1].fencers[0].fencerId]],
      maxScore: 5,
    });
    writeLegacyRelay(db, id, boutIds[0], { scoreA: 5, scoreB: 3, status: 'finished' });
    const state = await stateOf(comp.id);
    expect(state.teams.poolMatches).toEqual([
      expect.objectContaining({ id, scoreBoutsA: 5, scoreBoutsB: 3, status: 'finished' }),
    ]);
    const { facts, divergences } = replay(comp.id);
    expect(facts.complete).toBe(false);
    expect(divergences).toEqual([]);
    // Épreuve individuelle : bloc nul
    const solo = competition(Weapon.EPEE, false);
    db.saveSessionState(solo.id, { currentPhase: 0 } as never);
    const soloState = await call('getCompetitionState', { competitionId: solo.id });
    expect(soloState.state.teams).toBeNull();
  });
});
