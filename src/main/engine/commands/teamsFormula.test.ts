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
import { computeTeamFinalRanking } from '../../../shared/utils/pdfExport/teamPdf';

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

const tableauOf = (id: string) => db.getTeamTableauMatches(id, id);

/** Rang (ordre) d'un titulaire dans son équipe */
const orderOf = (competitionId: string, fencerId: string) =>
  db
    .getTeamsByCompetition(competitionId)
    .flatMap(t => t.fencers)
    .find(f => f.fencerId === fencerId)?.teamOrder;

d('Poules d’équipes lues dans la formule (docs/adr/0044, G0c)', () => {
  it('formule d’équipe : poules de la taille du tour, serpentin au rang d’entrée, journal, rejeu', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula() });
    // Rang d'entrée : 1 … 7 dans l'ordre inverse des noms
    const names = ['G', 'F', 'E', 'D', 'C', 'B', 'A'];
    const t = await teamsRegistered(
      comp.id,
      names.map((name, i) => ({ name, ranking: i + 1 }))
    );
    const out = await call('generateTeamPools', { competitionId: comp.id, commandId: 'tp' });
    // 7 équipes, poules de 3 à 4 : 2 poules ; serpentin 1-4-5 / 2-3-6-7
    expect(out.pools.map((p: { teamIds: string[] }) => [...p.teamIds].sort())).toEqual([
      [t[0], t[3], t[4]].sort(),
      [t[1], t[2], t[5], t[6]].sort(),
    ]);
    expect(out.matchIds).toHaveLength(3 + 6);
    expect(out.relayCount).toBe(9 * 9);
    expect(events(comp.id).map(e => e.type)).toEqual([
      'TeamPoolsGenerated',
      ...Array(9).fill('TeamMatchScheduled'),
    ]);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('formule « individuelle » enregistrée (sans general.teamMatch) : poule unique par nom, à l’identique', async () => {
    const individual = { ...teamFormula(), general: {} };
    const comp = competition(Weapon.EPEE, { formula: individual });
    const t = await teamsRegistered(comp.id, ['F', 'E', 'D', 'C', 'B', 'A']);
    const out = await call('generateTeamPools', { competitionId: comp.id });
    const byName = [...t].reverse();
    expect(out.pools).toEqual([{ number: 1, teamIds: byName }]);
    // Tous contre tous i < j, dans l'ordre des noms
    expect(match(`${comp.id}-p1-1`)).toMatchObject({ teamAId: byName[0], teamBId: byName[1] });
    expect(out.matchIds).toHaveLength(15);
  });

  it('poolCount : nombre de poules demandé (aussi sans formule) ; trop de poules refusé', async () => {
    const comp = competition(Weapon.FOIL);
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D']);
    await reject('generateTeamPools', { competitionId: comp.id, poolCount: 3 }).toMatchObject({
      code: 'invalid_pool_count',
    });
    const out = await call('generateTeamPools', { competitionId: comp.id, poolCount: 2 });
    expect(out.pools.map((p: { teamIds: string[] }) => p.teamIds.length)).toEqual([2, 2]);
    expect(out.matchIds).toEqual([`${comp.id}-p1-1`, `${comp.id}-p2-1`]);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('tableau seul : pas de poules (no_pools) ; tableau placé au rang d’entrée', async () => {
    const comp = competition(Weapon.SABRE, { formula: teamFormula({ pool: null }) });
    const [a, b, c, dd] = await teamsRegistered(comp.id, [
      { name: 'A', ranking: 4 },
      { name: 'B', ranking: 3 },
      { name: 'C', ranking: 2 },
      { name: 'D', ranking: 1 },
    ]);
    await reject('generateTeamPools', { competitionId: comp.id }).toMatchObject({
      code: 'no_pools',
    });
    const out = await call('generateTeamTableau', { competitionId: comp.id });
    // Têtes de série D, C, B, A : 1-4 (D-A), 3-2 (B-C)
    expect(out.slots).toEqual([
      { round: 2, position: 0, teamAId: dd, teamBId: a, isBye: false },
      { round: 2, position: 1, teamAId: b, teamBId: c, isBye: false },
    ]);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('qualification du tour vers le tableau : nombre, coupe à la barre (ADR-0040)', async () => {
    const comp = competition(Weapon.EPEE, {
      formula: teamFormula({ pool: { qualification: { mode: 'fixed_count', count: 2 } } }),
    });
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D']);
    await call('generateTeamPools', { competitionId: comp.id });
    await reject('generateTeamTableau', { competitionId: comp.id }).toMatchObject({
      code: 'pools_not_complete',
    });
    // L'équipe A de chaque rencontre gagne
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    const ranking = (await stateOf(comp.id)).teams.poolRanking as Array<{ teamId: string }>;
    const out = await call('generateTeamTableau', { competitionId: comp.id });
    expect(out.size).toBe(2);
    expect(out.slots).toEqual([
      {
        round: 1,
        position: 0,
        teamAId: ranking[0].teamId,
        teamBId: ranking[1].teamId,
        isBye: false,
      },
    ]);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('formule avec tour de poules : tableau refusé avant le tirage des poules', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula() });
    await teamsRegistered(comp.id, ['A', 'B', 'C']);
    await reject('generateTeamTableau', { competitionId: comp.id }).toMatchObject({
      code: 'pools_not_complete',
    });
  });
});

d('Règle de rencontre de la phase (docs/adr/0044, G0c)', () => {
  it('relais créés avec la règle de leur phase ; rencontre figée si la formule change', async () => {
    const formula = teamFormula({
      pool: { teamMatch: { relayOrder: 'rotation' } },
      tableau: { teamMatch: { relayStep: 3 } },
    });
    const comp = competition(Weapon.EPEE, { formula });
    await teamsRegistered(comp.id, ['A', 'B', 'C']);
    await call('generateTeamPools', { competitionId: comp.id });
    // Poule : rotation (1-1 d'abord), palier 5 de la règle générale
    const first = match(`${comp.id}-p1-1`);
    expect(first.bouts.every(r => r.maxScore === 5)).toBe(true);
    expect(orderOf(comp.id, first.bouts[0].fencerAId)).toBe(1);
    expect(orderOf(comp.id, first.bouts[0].fencerBId)).toBe(1);
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    await call('generateTeamTableau', { competitionId: comp.id });
    const [semi] = tableauOf(comp.id);
    const t = match(semi.id);
    // Tableau : palier 3, ordre FIE o.99.3 (3-6 d'abord)
    expect(t.bouts.every(r => r.maxScore === 3)).toBe(true);
    expect(orderOf(comp.id, t.bouts[0].fencerAId)).toBe(3);
    // La formule change : la rencontre créée garde son palier (cumul 4 au relais 1 refusé)
    const changed = teamFormula({ tableau: { teamMatch: { relayStep: 6 } } });
    db.updateCompetition(comp.id, {
      settings: { ...db.getCompetition(comp.id)!.settings, formula: changed },
    } as never);
    await reject('recordRelayScore', {
      competitionId: comp.id,
      matchId: semi.id,
      relay: 1,
      scoreA: 4,
      scoreB: 0,
    }).toMatchObject({ code: 'score_above_max' });
    await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: semi.id,
      relay: 1,
      scoreA: 3,
      scoreB: 1,
    });
    expect(divergences(comp.id)).toEqual([]);
  });

  it('remplaçants contrôlés par le moteur à l’inscription (assignTeamFencer)', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula({ rule: { reserves: 2 } }) });
    const [a] = await teamsRegistered(comp.id, ['A'], 3, 2);
    await reject('assignTeamFencer', {
      competitionId: comp.id,
      teamId: a,
      fencerId: fencer(comp.id, 'A6'),
      teamOrder: 6,
      isReserve: true,
    }).toMatchObject({ code: 'invalid_composition' });
    // Sans remplaçant dans la règle
    const none = competition(Weapon.EPEE, { formula: teamFormula({ rule: { reserves: 0 } }) });
    const [n] = await teamsRegistered(none.id, ['N'], 3, 0);
    await reject('assignTeamFencer', {
      competitionId: none.id,
      teamId: n,
      fencerId: fencer(none.id, 'N4'),
      teamOrder: 4,
      isReserve: true,
    }).toMatchObject({ code: 'invalid_composition' });
    // Épreuve sans formule : teamReserveCount (1 par défaut)
    const legacy = competition(Weapon.EPEE);
    const [l] = await teamsRegistered(legacy.id, ['L'], 3, 1);
    await reject('assignTeamFencer', {
      competitionId: legacy.id,
      teamId: l,
      fencerId: fencer(legacy.id, 'L5'),
      teamOrder: 5,
      isReserve: true,
    }).toMatchObject({ code: 'invalid_composition' });
  });

  it('remplaçants contrôlés au remplacement (substituteTeamFencer) : règle de la phase', async () => {
    const formula = teamFormula({ pool: { teamMatch: { reserves: 0 } } });
    const comp = competition(Weapon.EPEE, { formula });
    await teamsRegistered(comp.id, ['A', 'B', 'C']);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    const m = match(id);
    await reject('substituteTeamFencer', {
      competitionId: comp.id,
      matchId: id,
      teamId: m.teamAId,
      outFencerId: m.bouts[0].fencerAId,
    }).toMatchObject({ code: 'no_reserve' });
  });
});

d('Petite finale (docs/adr/0044, G0c)', () => {
  it('perdants des demi-finales en petite finale ; rouvrir une demi-finale la retire', async () => {
    const comp = competition(Weapon.FOIL, {
      formula: teamFormula({ pool: null, tableau: { thirdPlace: true } }),
    });
    await teamsRegistered(comp.id, [
      { name: 'A', ranking: 1 },
      { name: 'B', ranking: 2 },
      { name: 'C', ranking: 3 },
      { name: 'D', ranking: 4 },
    ]);
    await call('generateTeamTableau', { competitionId: comp.id });
    const [s1, s2] = tableauOf(comp.id);
    await playMatch(comp.id, s1.id, 'A');
    expect(tableauOf(comp.id)).toHaveLength(2);
    await playMatch(comp.id, s2.id, 'A');
    expect(tableauOf(comp.id).map(m => [m.round, m.position])).toEqual(
      expect.arrayContaining([
        [1, 0],
        [1, 1],
      ])
    );
    const third = match(`${comp.id}-t1-1`);
    expect([third.teamAId, third.teamBId]).toEqual([s1.teamBId, s2.teamBId]);
    expect(divergences(comp.id)).toEqual([]);

    // Rouvrir la 2e demi-finale : finale et petite finale non commencées retirées
    const reopened = await call('reopenRelay', { competitionId: comp.id, matchId: s2.id });
    expect([...reopened.removedMatchIds].sort()).toEqual(
      [`${comp.id}-t1-0`, `${comp.id}-t1-1`].sort()
    );
    expect(tableauOf(comp.id)).toHaveLength(2);
  });
});

d('Classement final dans getCompetitionState (docs/adr/0044, G0d)', () => {
  it('épreuve sans formule d’équipe : même résultat que l’écran (computeTeamFinalRanking)', async () => {
    const comp = competition(Weapon.EPEE);
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D']);
    await call('generateTeamPools', { competitionId: comp.id });
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    expect((await stateOf(comp.id)).teams.finalRanking.provisional).toBe(true);
    await call('generateTeamTableau', { competitionId: comp.id });
    for (const m of tableauOf(comp.id)) await playMatch(comp.id, m.id);
    for (const m of tableauOf(comp.id).filter(x => x.status !== 'finished'))
      await playMatch(comp.id, m.id);
    const teams = (await stateOf(comp.id)).teams;
    const byId = new Map(db.getTeamsByCompetition(comp.id).map(t => [t.id, t]));
    const screen = computeTeamFinalRanking(
      teams.poolRanking.map((r: { teamId: string }) => byId.get(r.teamId)!),
      db.getTeamTableauMatches(comp.id, comp.id)
    );
    expect(teams.finalRanking).toEqual({
      rows: screen.rows.map(r => ({ teamId: r.team.id, rank: r.rank })),
      provisional: false,
    });
    expect(teams.finalRanking.rows.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3, 3]);
  });

  it('formule d’équipe : petite finale, puis équipes éliminées à l’issue des poules', async () => {
    const comp = competition(Weapon.FOIL, {
      formula: teamFormula({
        pool: {
          sizeMin: 3,
          sizeMax: 6,
          // Ex aequo à la barre départagés au rang d'entrée : 4 qualifiés exactement
          qualification: { mode: 'fixed_count', count: 4, ties: 'initial_ranking' },
        },
        tableau: { thirdPlace: true },
      }),
    });
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D', 'E']);
    await call('generateTeamPools', { competitionId: comp.id });
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    const out = await call('generateTeamTableau', { competitionId: comp.id });
    expect(out.size).toBe(4);
    const inTableau = out.slots.flatMap((s: { teamAId: string; teamBId: string }) => [
      s.teamAId,
      s.teamBId,
    ]);
    const cut = db.getTeamsByCompetition(comp.id).find(t => !inTableau.includes(t.id))!;
    const [s1, s2] = tableauOf(comp.id);
    await playMatch(comp.id, s1.id, 'A');
    await playMatch(comp.id, s2.id, 'B');
    await playMatch(comp.id, `${comp.id}-t1-0`, 'A');
    await playMatch(comp.id, `${comp.id}-t1-1`, 'B');
    const final = match(`${comp.id}-t1-0`);
    const third = match(`${comp.id}-t1-1`);
    const { rows, provisional } = (await stateOf(comp.id)).teams.finalRanking;
    expect(provisional).toBe(false);
    expect(rows).toEqual([
      { teamId: final.teamAId, rank: 1 },
      { teamId: final.teamBId, rank: 2 },
      { teamId: third.teamBId, rank: 3 },
      { teamId: third.teamAId, rank: 4 },
      // Équipe coupée à l'issue des poules, hors tableau
      { teamId: cut.id, rank: 5 },
    ]);
    expect(divergences(comp.id)).toEqual([]);
  });
});

d('Formule d’une épreuve par équipes écrite par le moteur (docs/adr/0044, G0a)', () => {
  it('updateCompetitionFormula : règle de rencontre posée depuis les réglages, réglages plats écrits', async () => {
    const comp = competition(Weapon.EPEE, { teamReserveCount: 2, teamRelayStepSize: 4 });
    await call('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [{ op: 'setPhase', phase: 'tableau', settings: { thirdPlace: true } }],
    });
    const settings = db.getCompetition(comp.id)!.settings!;
    expect(settings.formula?.general.teamMatch).toEqual({
      starters: 3,
      reserves: 2,
      relayStep: 4,
      relayOrder: 'fie',
    });
    await call('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [
        {
          op: 'setGeneral',
          settings: { teamMatch: { ...RULE, starters: 4, relayOrder: 'rotation' } },
        },
      ],
    });
    expect(db.getCompetition(comp.id)!.settings).toMatchObject({
      minTeamSize: 4,
      teamReserveCount: 1,
      teamRelayStepSize: 5,
    });
  });

  it('refus : brique non admise (team_brick_unsupported), effectif d’équipes (S3)', async () => {
    const comp = competition(Weapon.EPEE);
    await reject('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [{ op: 'insertPhase', brick: 'pool', at: 1 }],
    }).toMatchObject({
      code: 'invalid_settings',
      message: expect.stringContaining('un seul tour de poules'),
    });
    await teamsRegistered(comp.id, ['A', 'B']);
    await reject('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [{ op: 'setPhase', phase: 'pool-0', settings: { sizeMin: 3, sizeMax: 6 } }],
    }).toMatchObject({ code: 'invalid_settings', message: expect.stringContaining('2 équipe(s)') });
    // Arène Sabre Laser : aucune règle d'équipe de la formule
    const arena = competition(Weapon.LASER, { teamFormat: 'laser-arena' });
    await call('updateCompetitionFormula', {
      competitionId: arena.id,
      operations: [{ op: 'setPhase', phase: 'tableau', settings: { thirdPlace: true } }],
    });
    expect(db.getCompetition(arena.id)!.settings!.formula?.general.teamMatch).toBeUndefined();
  });
});

d('Formule d’équipe posée à la création (docs/adr/0044, amendement « Formule d’équipe »)', () => {
  const create = (settings: Record<string, unknown> = {}, weapon = 'E') =>
    call('createCompetition', {
      title: 'Coupe par équipes',
      date: '2026-12-06',
      weapon,
      gender: 'M',
      category: 'SEN',
      isTeamEvent: true,
      settings: { minTeamSize: 3, ...settings },
    });

  it('relais FIE : formule enregistrée avec general.teamMatch, tirée par la formule', async () => {
    const { competitionId } = await create({ teamReserveCount: 2 });
    const settings = db.getCompetition(competitionId)!.settings!;
    expect(settings.formula?.general.teamMatch).toEqual({ ...RULE, reserves: 2 });
    expect(settings.formula?.phases.map(p => p.kind)).toEqual(['pool', 'tableau']);
    await teamsRegistered(competitionId, ['A', 'B', 'C']);
    expect((await call('generateTeamPools', { competitionId })).pools).toHaveLength(1);
  });

  it('arène Sabre Laser, épreuve individuelle : pas de règle de rencontre posée', async () => {
    const arena = await create({ teamFormat: 'laser-arena' }, 'L');
    expect(
      db.getCompetition(arena.competitionId)!.settings!.formula?.general.teamMatch
    ).toBeUndefined();
    const solo = await call('createCompetition', {
      title: 'Individuel',
      date: '2026-12-06',
      weapon: 'E',
      gender: 'M',
      category: 'SEN',
    });
    expect(db.getCompetition(solo.competitionId)!.settings!.formula).toBeUndefined();
  });
});

d('Remplaçant choisi (substituteTeamFencer, inFencerId ; docs/adr/0044 amendée)', () => {
  it('choix du 2e remplaçant ; non-remplaçant refusé ; un seul remplaçant par rencontre ; rejeu', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula({ rule: { reserves: 2 } }) });
    const [a, b] = await teamsRegistered(comp.id, ['A', 'B'], 3, 2);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    const m = match(id);
    const side = m.teamAId === a ? 'fencerAId' : 'fencerBId';
    const roster = db.getTeamsByCompetition(comp.id).find(t => t.id === a)!.fencers;
    const [r1, r2] = roster.filter(f => f.isReserve).map(f => f.fencerId);
    const out = m.bouts[0][side];
    const other = db.getTeamsByCompetition(comp.id).find(t => t.id === b)!.fencers[3].fencerId;
    const sub = (inFencerId?: string) =>
      call('substituteTeamFencer', {
        competitionId: comp.id,
        matchId: id,
        teamId: a,
        outFencerId: out,
        ...(inFencerId ? { inFencerId } : {}),
      });
    // Remplaçant de l'autre équipe, ou titulaire : refusés
    await expect(sub(other)).rejects.toMatchObject({ code: 'invalid_composition' });
    await expect(sub(roster[0].fencerId)).rejects.toMatchObject({ code: 'invalid_composition' });
    const done = await sub(r2);
    expect(done.inFencerId).toBe(r2);
    expect(
      match(id)
        .bouts.filter(r => r[side] === r2)
        .map(r => r.id)
    ).toEqual(done.relayIds);
    // Déjà entré (un seul remplaçant par équipe et par rencontre)
    await expect(sub(r1)).rejects.toMatchObject({ code: 'reserve_used' });
    expect(divergences(comp.id)).toEqual([]);
  });

  it('sans inFencerId : le premier remplaçant (comme avant)', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula({ rule: { reserves: 2 } }) });
    const [a] = await teamsRegistered(comp.id, ['A', 'B'], 3, 2);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    const m = match(id);
    const side = m.teamAId === a ? 'fencerAId' : 'fencerBId';
    const r1 = db
      .getTeamsByCompetition(comp.id)
      .find(t => t.id === a)!
      .fencers.filter(f => f.isReserve)[0].fencerId;
    const done = await call('substituteTeamFencer', {
      competitionId: comp.id,
      matchId: id,
      teamId: a,
      outFencerId: m.bouts[0][side],
    });
    expect(done.inFencerId).toBe(r1);
  });
});
