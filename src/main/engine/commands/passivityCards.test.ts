/**
 * Cartons P (non-combativité, t.124) par le moteur (docs/adr/0028 § 5 bis, lot C4) : escalade
 * jaune P, rouge P, noir P donnés aux deux équipes, noir P qui décide la rencontre (score, puis
 * classement), rencontre terminée, refus Sabre Laser, annulation par le Directoire technique,
 * cartons E non confondus, outil MCP, rejeu sans écart. Base SQLite réelle.
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

const call = (op: string, input: Record<string, unknown>, c: CommandContext = ctx) =>
  invoke(c, op as never, input as never) as Promise<any>;
const reject = (op: string, input: Record<string, unknown>, c?: CommandContext) =>
  expect(call(op, input, c)).rejects;
const events = (id: string) => db.eventLog.getSince(id);
const commandTypes = (competitionId: string, commandId: string) =>
  events(competitionId)
    .filter(e => e.commandId === commandId)
    .map(e => e.type);

function competition(weapon: Weapon, settings: Record<string, unknown> = {}) {
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

async function teamsRegistered(competitionId: string, names: string[], titulars = 3) {
  const ids: string[] = [];
  for (const name of names) {
    const { team } = await call('registerTeam', { competitionId, name });
    ids.push(team.id);
    for (let k = 1; k <= titulars; k++) {
      const fencerId = db.addFencer(competitionId, {
        lastName: `${name}${k}`,
        firstName: 'P',
        gender: Gender.MALE,
        status: FencerStatus.CHECKED_IN,
      }).id;
      await call('assignTeamFencer', { competitionId, teamId: team.id, fencerId, teamOrder: k });
    }
  }
  return ids;
}

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

const match = (id: string) => db.teams.getTeamMatch(id)!;
const teamsOf = async (competitionId: string) =>
  (await call('getCompetitionState', { competitionId })).state.teams;
const relayScore = (competitionId: string, matchId: string, relay: number, a: number, b: number) =>
  call('recordRelayScore', { competitionId, matchId, relay, scoreA: a, scoreB: b });
const giveP = (competitionId: string, matchId: string, extra: Record<string, unknown> = {}) =>
  call('givePassivityCard', { competitionId, matchId, ...extra });

d('givePassivityCard : relais FIE (docs/adr/0028, lot C4)', () => {
  it('jaune P, rouge P (sans touche), noir P : rencontre décidée au score, même commandId, rejeu', async () => {
    const comp = competition(Weapon.EPEE);
    await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    await relayScore(comp.id, id, 1, 2, 4);

    const dry = await giveP(comp.id, id, { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, card: { type: 'yellow' }, winnerTeamId: null });
    expect(db.teams.getPassivityCards(id)).toEqual([]);

    expect((await giveP(comp.id, id)).card.type).toBe('yellow');
    const red = await giveP(comp.id, id);
    expect(red).toMatchObject({ card: { type: 'red' }, winnerTeamId: null });
    // Rouge P : aucun effet automatique sur le score (§ 3)
    expect(match(id)).toMatchObject({ status: 'in_progress', winnerId: null });
    expect(match(id).bouts[0]).toMatchObject({ scoreA: 2, scoreB: 4 });
    expect(match(id).bouts[1]).toMatchObject({ scoreA: 0, scoreB: 0, status: 'not_started' });

    const black = await giveP(comp.id, id, { commandId: 'noir-p' });
    expect(black).toMatchObject({ card: { type: 'black' }, winnerTeamId: match(id).teamBId });
    expect(commandTypes(comp.id, 'noir-p')).toEqual(['PassivityCardGiven', 'TeamMatchDecided']);
    expect(
      events(comp.id).find(e => e.type === 'PassivityCardGiven' && e.commandId === 'noir-p')
        ?.payload
    ).toEqual({ matchId: id, cardId: black.card.id, type: 'black' });
    expect(match(id)).toMatchObject({ status: 'finished', winnerId: match(id).teamBId });

    // Bloc « teams » : cartons P à part des cartons E, dans l'ordre d'attribution
    const m = (await teamsOf(comp.id)).poolMatches.find((x: any) => x.id === id);
    expect(m.passivityCards.map((c: any) => c.type)).toEqual(['yellow', 'red', 'black']);
    expect(m.teamCards).toEqual([]);
    expect(db.teams.getTeamMatchCards(id)).toEqual([]);

    // Après le noir P : plus de carton P
    await reject('givePassivityCard', { competitionId: comp.id, matchId: id }).toMatchObject({
      code: 'match_finished',
    });
    expect(divergences(comp.id)).toEqual([]);
  });

  it('noir P à égalité de score : meilleur classement (rang du tableau), rencontre suivante formée', async () => {
    const comp = competition(Weapon.FOIL, { minTeamSize: 2 });
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D'], 2);
    await call('generateTeamPools', { competitionId: comp.id });
    // Poules : l'équipe A de chaque rencontre gagne, d'autant plus largement que la rencontre
    // vient tôt (classement de poule sans égalité)
    const pools = db.getTeamMatchesByCompetition(comp.id);
    for (const [k, m] of pools.entries()) {
      const n = match(m.id).bouts.length;
      for (let relay = 1; relay <= n; relay++)
        await relayScore(comp.id, m.id, relay, relay === 1 ? 5 : 0, relay === 1 ? k % 5 : 0);
    }
    await call('generateTeamTableau', { competitionId: comp.id });
    const ranking = (await teamsOf(comp.id)).poolRanking as Array<{ teamId: string; rank: number }>;
    const rankOf = (teamId: string) => ranking.find(r => r.teamId === teamId)!.rank;
    const semi = db.getTeamTableauMatches(comp.id, comp.id)[0];
    await relayScore(comp.id, semi.id, 1, 3, 3);
    await giveP(comp.id, semi.id);
    await giveP(comp.id, semi.id);
    const better = rankOf(semi.teamAId) < rankOf(semi.teamBId) ? semi.teamAId : semi.teamBId;
    const black = await giveP(comp.id, semi.id, { commandId: 'noir-egalite' });
    expect(black.winnerTeamId).toBe(better);
    expect(match(semi.id)).toMatchObject({ status: 'finished', winnerId: better });
    expect(commandTypes(comp.id, 'noir-egalite').slice(0, 2)).toEqual([
      'PassivityCardGiven',
      'TeamMatchDecided',
    ]);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('rencontre tirée jusqu’au bout : noir P accepté sans changer le résultat, ou qui décide l’égalité de poule', async () => {
    const comp = competition(Weapon.SABRE);
    await teamsRegistered(comp.id, ['A', 'B', 'C']);
    await call('generateTeamPools', { competitionId: comp.id });
    const [m1, m2] = db.getTeamMatchesByCompetition(comp.id);
    const n = match(m1.id).bouts.length;
    // m1 : A en tête de bout en bout
    for (let relay = 1; relay <= n; relay++) await relayScore(comp.id, m1.id, relay, 5, 0);
    for (let k = 0; k < 2; k++) await giveP(comp.id, m1.id);
    const late = await giveP(comp.id, m1.id, { commandId: 'noir-fin' });
    expect(late.winnerTeamId).toBe(match(m1.id).teamAId);
    expect(commandTypes(comp.id, 'noir-fin')).toEqual(['PassivityCardGiven']);

    // m2 : égalité de poule (vainqueur nul) → le noir P décide
    for (let relay = 1; relay <= n; relay++) await relayScore(comp.id, m2.id, relay, 0, 0);
    expect(match(m2.id)).toMatchObject({ status: 'finished', winnerId: null });
    for (let k = 0; k < 2; k++) await giveP(comp.id, m2.id);
    const tie = await giveP(comp.id, m2.id, { commandId: 'noir-nul' });
    expect(tie.winnerTeamId).not.toBeNull();
    expect(match(m2.id).winnerId).toBe(tie.winnerTeamId);
    expect(commandTypes(comp.id, 'noir-nul')).toEqual(['PassivityCardGiven', 'TeamMatchDecided']);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('Sabre Laser (relais ou arène) : unsupported_format, rien d’écrit', async () => {
    for (const settings of [{}, { teamFormat: 'laser-arena' }]) {
      const comp = competition(Weapon.LASER, settings);
      await teamsRegistered(comp.id, ['A', 'B']);
      const ids =
        settings.teamFormat === 'laser-arena'
          ? null
          : (await call('generateTeamPools', { competitionId: comp.id })).matchIds;
      const matchId = ids?.[0] ?? 'absente';
      await reject('givePassivityCard', { competitionId: comp.id, matchId }).toMatchObject({
        code: 'unsupported_format',
      });
      expect(events(comp.id).some(e => e.type === 'PassivityCardGiven')).toBe(false);
    }
  });

  it('annulation : Directoire technique seulement, jaune ou rouge P ; noir P refusé ; rejeu', async () => {
    const comp = competition(Weapon.EPEE);
    await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    const yellow = await giveP(comp.id, id);
    const cancel = { competitionId: comp.id, matchId: id, cardId: yellow.card.id };
    for (const source of ['tablet', 'cyrano', 'opp2'] as const) {
      await reject('cancelTeamCard', cancel, { ...ctx, actor: { source } }).toMatchObject({
        code: 'permission_denied',
      });
    }
    await call('cancelTeamCard', cancel, { ...ctx, actor: { source: 'mcp' } });
    expect(db.teams.getPassivityCards(id)).toEqual([]);
    expect(divergences(comp.id)).toEqual([]);

    // L'escalade repart du nombre de cartons restants
    expect((await giveP(comp.id, id)).card.type).toBe('yellow');
    await relayScore(comp.id, id, 1, 1, 0);
    await giveP(comp.id, id);
    const black = await giveP(comp.id, id);
    await reject('cancelTeamCard', { ...cancel, cardId: black.card.id }).toMatchObject({
      code: 'match_finished',
    });
    expect(divergences(comp.id)).toEqual([]);
  });

  it('dépôt : cartons E et cartons P de la même table lus séparément (même milliseconde)', async () => {
    const comp = competition(Weapon.EPEE);
    const [a] = await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    const at = '2026-12-06T10:00:00.000Z';
    db.teams.createPassivityCard(id, 'red', { id: 'p2', at });
    db.teams.createTeamMatchCard(id, a, 'white', 'late_designation', { id: 'e1', at });
    db.teams.createPassivityCard(id, 'yellow', { id: 'p1', at });
    expect(db.teams.getTeamMatchCards(id).map(c => c.id)).toEqual(['e1']);
    expect(db.teams.getPassivityCards(id).map(c => [c.id, c.type])).toEqual([
      ['p2', 'red'],
      ['p1', 'yellow'],
    ]);
    const all = db.teams.getTeamCardsByCompetition(comp.id);
    expect(all.matchCards.map(c => c.id)).toEqual(['e1']);
    expect(all.passivityCards.map(c => c.id)).toEqual(['p2', 'p1']);
  });

  it('outil MCP give_passivity_card (écriture sportive)', () => {
    const tool = CONTRACT_MCP_TOOLS.write.find(t => t.name === 'give_passivity_card');
    expect(tool).toBeDefined();
  });
});
