/**
 * Épreuves par équipes dans la formule v2 par le moteur (docs/adr/0044, étape G0) : rang
 * d'entrée (registerTeam, updateTeam, carton noir P), poules d'équipes et tableau lus dans la
 * formule, règle de rencontre par phase, contrôle des remplaçants, classement final dans
 * getCompetitionState. Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../../shared/domain/journal/compareWithState';
import type { FormulaV2, TeamMatchRule } from '../../../shared/domain/formula/formulaV2';
import { CONTRACT_MCP_TOOLS } from '../api/mcpAdapter';
import type { CommandContext } from './context';
import { teamStateView } from './teams';
import { invoke } from '../api/engine';

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
const reject = (op: string, input: Record<string, unknown>) => expect(call(op, input)).rejects;
const events = (id: string) => db.eventLog.getSince(id);
const revision = (id: string) => db.eventLog.getRevision(id);
const stateOf = async (id: string) =>
  (await call('getCompetitionState', { competitionId: id })).state;
const match = (id: string) => db.teams.getTeamMatch(id)!;

const RULE: TeamMatchRule = { starters: 3, reserves: 1, relayStep: 5, relayOrder: 'fie' };

function competition(weapon = Weapon.EPEE, settings: Record<string, unknown> = {}) {
  return db.createCompetition({
    title: 'Coupe par équipes',
    date: new Date('2026-12-06'),
    location: 'Gymnase',
    weapon,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    isTeamEvent: true,
    settings: {
      ...buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
      minTeamSize: 3,
      ...settings,
    } as never,
  });
}

/** Formule d'équipe : un tour de poules (facultatif) puis un tableau */
function teamFormula(
  opts: {
    pool?: Record<string, unknown> | null;
    tableau?: Record<string, unknown>;
    rule?: Partial<TeamMatchRule>;
  } = {}
): FormulaV2 {
  const phases: FormulaV2['phases'] = [];
  if (opts.pool !== null)
    phases.push({
      kind: 'pool',
      id: 'pool-1',
      sizeMin: 3,
      sizeMax: 4,
      maxScore: 45,
      timerSeconds: 180,
      qualification: { mode: 'all' },
      seeding: 'previous_round',
      boutOrder: 'fie',
      ...(opts.pool ?? {}),
    } as never);
  phases.push({
    kind: 'tableau',
    id: 'tableau',
    maxScore: 45,
    timerSeconds: 180,
    thirdPlace: false,
    allPlaces: false,
    ...(opts.tableau ?? {}),
  } as never);
  return { version: 2, phases, general: { teamMatch: { ...RULE, ...opts.rule } } };
}

let fencerSeq = 0;
const fencer = (competitionId: string, name: string, ranking?: number) =>
  db.addFencer(competitionId, {
    lastName: name,
    firstName: `P${fencerSeq++}`,
    gender: Gender.MALE,
    status: FencerStatus.CHECKED_IN,
    ...(ranking !== undefined ? { ranking } : {}),
  } as never).id;

/** Équipes inscrites : `titulars` titulaires et `reserves` remplaçant(s) chacune */
async function teamsRegistered(
  competitionId: string,
  teams: Array<string | { name: string; ranking?: number; club?: string; fencerRanks?: number[] }>,
  titulars = 3,
  reserves = 1
) {
  const ids: string[] = [];
  for (const t of teams) {
    const spec = typeof t === 'string' ? { name: t } : t;
    const { team } = await call('registerTeam', {
      competitionId,
      name: spec.name,
      ...(spec.club ? { club: spec.club } : {}),
      ...(spec.ranking ? { ranking: spec.ranking } : {}),
    });
    ids.push(team.id);
    for (let k = 1; k <= titulars + reserves; k++) {
      await call('assignTeamFencer', {
        competitionId,
        teamId: team.id,
        fencerId: fencer(competitionId, `${spec.name}${k}`, spec.fencerRanks?.[k - 1]),
        teamOrder: k,
        isReserve: k > titulars,
      });
    }
  }
  return ids;
}

/** Journal rejoué comparé aux tables des équipes */
function divergences(competitionId: string) {
  const facts = projectCompetition(events(competitionId));
  const comp = db.getCompetition(competitionId)!;
  const statuses = Object.fromEntries(
    db.getFencersByCompetition(competitionId).map(f => [f.id, f.status as string])
  );
  return compareWithState(
    facts,
    { ...stateView({}, comp.settings), teams: teamStateView(ctx, comp) },
    statuses
  );
}

/** Rencontre jouée en entier : l'équipe A gagne chaque relais de `marginA` touches */
async function playMatch(competitionId: string, matchId: string, winner: 'A' | 'B' = 'A') {
  const n = match(matchId).bouts.length;
  for (let relay = 1; relay <= n; relay++)
    await call('recordRelayScore', {
      competitionId,
      matchId,
      relay,
      scoreA: winner === 'A' && relay === 1 ? 5 : 0,
      scoreB: winner === 'B' && relay === 1 ? 5 : 0,
    });
}

d('Rang d’entrée d’une équipe (docs/adr/0044, G0b)', () => {
  it('registerTeam : rang facultatif, rendu par la commande et le bloc « teams »', async () => {
    const comp = competition();
    const a = await call('registerTeam', { competitionId: comp.id, name: 'Alpha', ranking: 4 });
    const b = await call('registerTeam', { competitionId: comp.id, name: 'Bravo' });
    expect(a.team).toMatchObject({ name: 'Alpha', ranking: 4 });
    expect(b.team.ranking).toBeNull();
    const teams = (await stateOf(comp.id)).teams.teams;
    expect(teams.map((t: { ranking: number | null }) => t.ranking)).toEqual([4, null]);
    await reject('registerTeam', { competitionId: comp.id, name: 'X', ranking: 0 }).toMatchObject({
      code: 'invalid_input',
    });
  });

  it('updateTeam : nom, club, rang (null le retire), sans journal ; refus après le tirage', async () => {
    const comp = competition();
    const [a, b] = await teamsRegistered(comp.id, ['Alpha', 'Bravo']);
    const dry = await call('updateTeam', {
      competitionId: comp.id,
      teamId: a,
      ranking: 2,
      dryRun: true,
    });
    expect(dry).toEqual({ dryRun: true, team: null });
    expect(db.getTeamsByCompetition(comp.id)[0].ranking).toBeNull();

    const out = await call('updateTeam', {
      competitionId: comp.id,
      teamId: a,
      name: 'Alpha 1',
      club: 'CE Paris',
      ranking: 2,
    });
    expect(out.team).toEqual({ id: a, name: 'Alpha 1', club: 'CE Paris', ranking: 2 });
    await call('updateTeam', { competitionId: comp.id, teamId: a, ranking: null });
    expect(db.getTeamsByCompetition(comp.id).find(t => t.id === a)).toMatchObject({
      name: 'Alpha 1',
      club: 'CE Paris',
      ranking: null,
    });
    expect(revision(comp.id)).toBe(0);

    const other = competition();
    const [c] = await teamsRegistered(other.id, ['C']);
    await reject('updateTeam', { competitionId: comp.id, teamId: c, name: 'Z' }).toMatchObject({
      code: 'team_not_found',
    });
    await call('generateTeamPools', { competitionId: comp.id });
    await reject('updateTeam', { competitionId: comp.id, teamId: b, ranking: 1 }).toMatchObject({
      code: 'draw_done',
    });
  });

  it('outil MCP update_team (inscription)', () => {
    const tool = CONTRACT_MCP_TOOLS.write.find(t => t.name === 'update_team');
    expect(tool?.inputSchema.required).toEqual(['competitionId', 'teamId']);
  });

  it('noir P à égalité de score en poule : rang d’entrée (rang saisi), pas le nom', async () => {
    const comp = competition(Weapon.EPEE);
    // Alpha passe devant au nom ; Bravo a le meilleur rang d'entrée
    const [a, b] = await teamsRegistered(comp.id, [
      { name: 'Alpha', ranking: 2 },
      { name: 'Bravo', ranking: 1 },
    ]);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    expect(match(id)).toMatchObject({ teamAId: a, teamBId: b });
    await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: id,
      relay: 1,
      scoreA: 3,
      scoreB: 3,
    });
    for (let k = 0; k < 2; k++)
      await call('givePassivityCard', { competitionId: comp.id, matchId: id });
    const black = await call('givePassivityCard', { competitionId: comp.id, matchId: id });
    expect(black.winnerTeamId).toBe(b);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('noir P en poule sans rang saisi : somme des classements des titulaires', async () => {
    const comp = competition(Weapon.SABRE);
    const [a, b] = await teamsRegistered(comp.id, [
      { name: 'Alpha', fencerRanks: [10, 11, 12] },
      { name: 'Bravo', fencerRanks: [1, 2, 3] },
    ]);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    expect(match(id)).toMatchObject({ teamAId: a, teamBId: b });
    await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: id,
      relay: 1,
      scoreA: 2,
      scoreB: 2,
    });
    for (let k = 0; k < 3; k++)
      await call('givePassivityCard', { competitionId: comp.id, matchId: id });
    expect(match(id)).toMatchObject({ status: 'finished', winnerId: b });
  });
});
