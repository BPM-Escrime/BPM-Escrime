/**
 * Cartons des épreuves par équipes par le moteur (docs/adr/0028, lot C1) : carton individuel
 * d'un relais FIE (jaune, rouge, palier + rouges), noir individuel (tireur exclu, rencontre
 * perdue, équipe exclue), retrait d'équipe, carton après le END du dernier relais, cartons E de
 * l'arène Sabre Laser, noir individuel au Sabre Laser, annulation, outils MCP, rejeu sans écart
 * et épreuve antérieure sans événement de carton. Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { CardReason, Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
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

/** Journal rejoué comparé aux tables des équipes et aux statuts des tireurs */
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

async function play(competitionId: string, matchId: string) {
  const n = match(matchId).bouts.length;
  for (let relay = 1; relay <= n; relay++) await relayScore(competitionId, matchId, relay, 5, 0);
}

d('giveRelayCard : relais FIE (docs/adr/0028, lot C1)', () => {
  it('jaune puis rouge (t.165), palier + 1 seulement avec le rouge (t.41.1), état, rejeu', async () => {
    const comp = competition(Weapon.EPEE);
    await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    const r1 = `${id}-r1`;
    const give = (extra: Record<string, unknown> = {}) =>
      call('giveRelayCard', {
        competitionId: comp.id,
        matchId: id,
        relayId: r1,
        side: 'A',
        reason: CardReason.FIE_BODY_CONTACT,
        ...extra,
      });

    // Simulation : rien d'écrit
    const dry = await give({ dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, card: { type: 'YELLOW' }, fencerWithdrawn: false });
    expect(db.teams.getTeamBoutCards(id)).toEqual([]);

    const yellow = await give({ commandId: 'c-yellow' });
    expect(yellow.card).toMatchObject({
      type: 'YELLOW',
      reason: CardReason.FIE_BODY_CONTACT,
      group: 1,
      pointsAwarded: 0,
      excludes: false,
      fencerId: match(id).bouts[0].fencerAId,
    });
    // Sans rouge, pas de dépassement du palier
    await expect(relayScore(comp.id, id, 1, 2, 6)).rejects.toMatchObject({
      code: 'score_above_max',
    });
    const red = await give();
    expect(red.card).toMatchObject({ type: 'RED', pointsAwarded: 1 });
    // Rouge de A : touche à B, B seul peut dépasser le palier d'une touche
    await expect(relayScore(comp.id, id, 1, 6, 2)).rejects.toMatchObject({
      code: 'score_above_max',
    });
    await expect(relayScore(comp.id, id, 1, 2, 7)).rejects.toMatchObject({
      code: 'score_above_max',
    });
    await relayScore(comp.id, id, 1, 2, 6);

    // Dernier relais terminé, suivant pas commencé : carton accepté ; ensuite refusé
    await give({ side: 'B', reason: CardReason.FIE_LEAVING_PISTE });
    await relayScore(comp.id, id, 2, 5, 4);
    await reject('giveRelayCard', {
      competitionId: comp.id,
      matchId: id,
      relayId: r1,
      side: 'A',
      reason: CardReason.FIE_BODY_CONTACT,
    }).toMatchObject({ code: 'relay_out_of_order' });

    const log = events(comp.id).filter(e => e.type === 'RelayCardGiven');
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({
      commandId: 'c-yellow',
      payload: { matchId: id, relayId: r1, type: 'YELLOW', reason: CardReason.FIE_BODY_CONTACT },
    });
    const teams = await teamsOf(comp.id);
    expect(teams.poolMatches[0].bouts[0].cards.map((c: { type: string }) => c.type)).toEqual([
      'YELLOW',
      'RED',
      'YELLOW',
    ]);
    expect(teams.withdrawn).toEqual([]);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('entrée : exactement un de reason/type ; motif hors arme, relais inconnu, type d’appareil', async () => {
    const comp = competition(Weapon.FOIL);
    await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    const base = { competitionId: comp.id, matchId: `${comp.id}-p1-1`, side: 'A' };
    const r1 = `${comp.id}-p1-1-r1`;
    await reject('giveRelayCard', { ...base, relayId: r1 }).toMatchObject({
      code: 'invalid_input',
    });
    await reject('giveRelayCard', {
      ...base,
      relayId: r1,
      type: 'RED',
      reason: CardReason.FIE_BODY_CONTACT,
    }).toMatchObject({ code: 'invalid_input' });
    await reject('giveRelayCard', { ...base, relayId: r1, reason: CardReason.ESTOC }).toMatchObject(
      { code: 'invalid_input' }
    );
    await reject('giveRelayCard', { ...base, relayId: r1, type: 'WHITE' }).toMatchObject({
      code: 'invalid_input',
    });
    await reject('giveRelayCard', { ...base, relayId: 'x', type: 'RED' }).toMatchObject({
      code: 'relay_not_found',
    });
    await reject('giveRelayCard', {
      ...base,
      matchId: 'x',
      relayId: r1,
      type: 'RED',
    }).toMatchObject({ code: 'match_not_found' });
    // Appareil de piste : type imposé, sans motif ni groupe
    const device = await call(
      'giveRelayCard',
      { ...base, relayId: r1, type: 'RED' },
      {
        ...ctx,
        actor: { source: 'cyrano' },
      }
    );
    expect(device.card).toMatchObject({ type: 'RED', reason: null, group: null });
    expect(events(comp.id).pop()).toMatchObject({ source: 'cyrano', type: 'RelayCardGiven' });
    expect(divergences(comp.id)).toEqual([]);
  });

  it('carton après le END du dernier relais : accepté tant que la rencontre suivante n’a pas commencé', async () => {
    const comp = competition(Weapon.SABRE, { minTeamSize: 2 });
    const [a] = await teamsRegistered(comp.id, ['A', 'B', 'C'], 2);
    await call('generateTeamPools', { competitionId: comp.id });
    const all = db.getTeamMatchesByCompetition(comp.id);
    const first = all.find(m => m.teamAId === a || m.teamBId === a)!;
    const next = all.find(m => m.id !== first.id && (m.teamAId === a || m.teamBId === a))!;
    await play(comp.id, first.id);
    expect(match(first.id).status).toBe('finished');
    const last = first.bouts[first.bouts.length - 1].id;
    const side = first.teamAId === a ? 'A' : 'B';
    const card = { competitionId: comp.id, matchId: first.id, relayId: last, side };
    const ok = await call('giveRelayCard', { ...card, reason: CardReason.FIE_LEAVING_PISTE });
    expect(ok.card.type).toBe('YELLOW');
    // Relais précédent : refusé (rencontre terminée)
    await reject('giveRelayCard', {
      ...card,
      relayId: first.bouts[0].id,
      reason: CardReason.FIE_LEAVING_PISTE,
    }).toMatchObject({ code: 'match_finished' });
    // Rencontre suivante de l'équipe commencée : refusé
    await relayScore(comp.id, next.id, 1, 1, 1);
    await reject('giveRelayCard', { ...card, reason: CardReason.FIE_LEAVING_PISTE }).toMatchObject({
      code: 'match_finished',
    });
    expect(divergences(comp.id)).toEqual([]);
  });
});

d('carton noir individuel et retrait d’équipe (docs/adr/0028 § 4)', () => {
  it('armes olympiques : tireur exclu, rencontre perdue, équipe exclue sous le même commandId', async () => {
    const comp = competition(Weapon.EPEE, { minTeamSize: 2 });
    const [a, b, c] = await teamsRegistered(comp.id, ['A', 'B', 'C'], 2);
    await call('generateTeamPools', { competitionId: comp.id });
    const all = db.getTeamMatchesByCompetition(comp.id);
    const ab = all.find(m => [m.teamAId, m.teamBId].sort().join() === [a, b].sort().join())!;
    const side = ab.teamAId === a ? 'A' : 'B';
    await relayScore(comp.id, ab.id, 1, 3, 2);
    const fencerId = side === 'A' ? ab.bouts[1].fencerAId : ab.bouts[1].fencerBId;

    const dry = await call('giveRelayCard', {
      competitionId: comp.id,
      matchId: ab.id,
      relayId: ab.bouts[1].id,
      side,
      reason: CardReason.FIE_VIOLENCE,
      dryRun: true,
    });
    expect(dry).toMatchObject({
      card: { type: 'BLACK' },
      fencerWithdrawn: true,
      withdrawnTeamId: a,
    });
    expect(db.getFencersByCompetition(comp.id).find(f => f.id === fencerId)!.status).toBe(
      FencerStatus.CHECKED_IN
    );

    const out = await call('giveRelayCard', {
      competitionId: comp.id,
      matchId: ab.id,
      relayId: ab.bouts[1].id,
      side,
      reason: CardReason.FIE_VIOLENCE,
      commandId: 'noir',
    });
    expect(out).toMatchObject({ card: { type: 'BLACK', excludes: true }, withdrawnTeamId: a });
    const cmd = events(comp.id).filter(e => e.commandId === 'noir');
    expect(cmd.map(e => e.type)).toEqual([
      'RelayCardGiven',
      'FencerWithdrawn',
      'TeamMatchDecided',
      'TeamWithdrawn',
    ]);
    const winner = side === 'A' ? ab.teamBId : ab.teamAId;
    expect(cmd[1].payload).toMatchObject({
      fencerId,
      reason: 'exclusion',
      blackCard: true,
      matchId: ab.id,
      forfeitedMatchIds: [],
    });
    expect(cmd[2].payload).toEqual({ matchId: ab.id, winnerTeamId: winner });
    expect(cmd[3].payload).toEqual({ teamId: a, matchId: ab.id, reason: 'exclusion' });
    expect(db.getFencersByCompetition(comp.id).find(f => f.id === fencerId)).toMatchObject({
      status: FencerStatus.EXCLUDED,
      exclusionReason: 'black_card',
    });
    expect(match(ab.id)).toMatchObject({ status: 'finished', winnerId: winner });

    // Équipe exclue : hors classement, ses rencontres annulées (o.99.8), plus de relais ni carton
    const teams = await teamsOf(comp.id);
    expect(teams.withdrawn).toEqual([{ teamId: a, matchId: ab.id, reason: 'exclusion' }]);
    expect(teams.poolRanking.map((r: { teamId: string }) => r.teamId).sort()).toEqual(
      [b, c].sort()
    );
    const other = all.find(m => m.id !== ab.id && (m.teamAId === a || m.teamBId === a))!;
    await expect(relayScore(comp.id, other.id, 1, 1, 1)).rejects.toMatchObject({
      code: 'team_withdrawn',
    });
    await reject('reopenRelay', { competitionId: comp.id, matchId: ab.id }).toMatchObject({
      code: 'team_withdrawn',
    });
    await reject('giveRelayCard', {
      competitionId: comp.id,
      matchId: other.id,
      relayId: other.bouts[0].id,
      side: other.teamAId === a ? 'A' : 'B',
      type: 'YELLOW',
    }).toMatchObject({ code: 'team_withdrawn' });
    // Le noir ne s'annule pas par cancelRelayCard
    await reject('cancelRelayCard', {
      competitionId: comp.id,
      matchId: ab.id,
      cardId: out.card.id,
    }).toMatchObject({ code: 'already_withdrawn' });
    expect(divergences(comp.id)).toEqual([]);

    // Tableau : les rencontres restantes de l'équipe exclue ne bloquent pas, elle n'y entre pas
    const bc = all.find(m => m.teamAId !== a && m.teamBId !== a)!;
    await play(comp.id, bc.id);
    const tableau = await call('generateTeamTableau', { competitionId: comp.id });
    expect(tableau.slots.flatMap((s: any) => [s.teamAId, s.teamBId])).not.toContain(a);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('Sabre Laser : noir individuel, tireur retiré seulement (Livret 2 VIII.7, XII « A venir »)', async () => {
    const comp = competition(Weapon.LASER);
    const [a] = await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    const side = match(id).teamAId === a ? 'A' : 'B';
    const out = await call('giveRelayCard', {
      competitionId: comp.id,
      matchId: id,
      relayId: `${id}-r1`,
      side,
      reason: CardReason.REFUSAL,
      commandId: 'noir-laser',
    });
    expect(out).toMatchObject({
      card: { type: 'BLACK' },
      fencerWithdrawn: true,
      withdrawnTeamId: null,
    });
    expect(
      events(comp.id)
        .filter(e => e.commandId === 'noir-laser')
        .map(e => e.type)
    ).toEqual(['RelayCardGiven', 'FencerWithdrawn']);
    expect(match(id).status).not.toBe('finished');
    expect((await teamsOf(comp.id)).withdrawn).toEqual([]);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('withdrawTeam (o.99.7.a) : rencontre perdue, équipe retirée ; tableau : rencontre suivante créée', async () => {
    const comp = competition(Weapon.FOIL, { minTeamSize: 2 });
    const [a, b] = await teamsRegistered(comp.id, ['A', 'B', 'C', 'D'], 2);
    await call('generateTeamPools', { competitionId: comp.id });
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await play(comp.id, m.id);
    await call('generateTeamTableau', { competitionId: comp.id });
    const semi = db.getTeamTableauMatches(comp.id, comp.id);
    await play(comp.id, semi[0].id);
    const target = semi[1];
    const input = {
      competitionId: comp.id,
      matchId: target.id,
      teamId: target.teamAId,
      reason: 'abandon',
    };
    const dry = await call('withdrawTeam', { ...input, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, winnerTeamId: target.teamBId });
    expect(dry.scheduledMatchIds).toHaveLength(1);
    expect(match(target.id).status).not.toBe('finished');

    const out = await call('withdrawTeam', { ...input, commandId: 'abandon' });
    expect(
      events(comp.id)
        .filter(e => e.commandId === 'abandon')
        .map(e => e.type)
    ).toEqual(['TeamMatchDecided', 'TeamMatchScheduled', 'TeamWithdrawn']);
    expect(match(out.scheduledMatchIds[0])).toMatchObject({ teamBId: target.teamBId });
    expect((await teamsOf(comp.id)).withdrawn).toEqual([
      { teamId: target.teamAId, matchId: target.id, reason: 'abandon' },
    ]);
    await reject('withdrawTeam', input).toMatchObject({ code: 'team_withdrawn' });
    await reject('withdrawTeam', { ...input, teamId: 'x' }).toMatchObject({
      code: 'team_not_in_match',
    });
    expect(divergences(comp.id)).toEqual([]);
    expect([a, b]).toHaveLength(2);
  });
});

d('giveTeamCard : arène Sabre Laser (docs/adr/0028, lot C1)', () => {
  it('escalade E, noir accepté, équipe hors rencontre, annulation, rejeu', async () => {
    const comp = competition(Weapon.LASER, { teamFormat: 'laser-arena' });
    const ids = await teamsRegistered(comp.id, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    await call('generateTeamPools', { competitionId: comp.id });
    const m = db.getTeamMatchesByCompetition(comp.id)[0];
    const give = (extra: Record<string, unknown> = {}) =>
      call('giveTeamCard', { competitionId: comp.id, matchId: m.id, teamId: m.teamAId, ...extra });
    expect((await give()).card.type).toBe('white');
    expect((await give()).card.type).toBe('yellow');
    const black = await give({ type: 'black', commandId: 'e-noir' });
    expect(black.card).toMatchObject({ type: 'black', teamId: m.teamAId });
    expect(events(comp.id).find(e => e.commandId === 'e-noir')).toMatchObject({
      type: 'TeamCardGiven',
      payload: { matchId: m.id, teamId: m.teamAId, cardId: black.card.id, type: 'black' },
    });
    const stranger = ids.find(t => t !== m.teamAId && t !== m.teamBId)!;
    await reject('giveTeamCard', {
      competitionId: comp.id,
      matchId: m.id,
      teamId: stranger,
    }).toMatchObject({ code: 'team_not_in_match' });
    const teams = await teamsOf(comp.id);
    expect(teams.poolMatches[0].teamCards.map((c: { type: string }) => c.type)).toEqual([
      'white',
      'yellow',
      'black',
    ]);
    expect(divergences(comp.id)).toEqual([]);

    // Annulation : Directoire technique (écran, MCP), jamais la tablette ni l'appareil
    const cancel = { competitionId: comp.id, matchId: m.id, cardId: black.card.id };
    for (const source of ['tablet', 'cyrano', 'opp2'] as const) {
      await reject('cancelTeamCard', cancel, { ...ctx, actor: { source } }).toMatchObject({
        code: 'permission_denied',
      });
    }
    await call('cancelTeamCard', cancel, { ...ctx, actor: { source: 'mcp' } });
    await reject('cancelTeamCard', cancel).toMatchObject({ code: 'card_not_found' });
    expect(events(comp.id).pop()).toMatchObject({
      type: 'TeamCardCancelled',
      payload: { matchId: m.id, cardId: black.card.id },
    });
    expect((await teamsOf(comp.id)).poolMatches[0].teamCards).toHaveLength(2);
    // Escalade recalculée sur les cartons restants
    expect((await give()).card.type).toBe('yellow');
    expect(divergences(comp.id)).toEqual([]);
  });

  it('carton E hors arène refusé ; withdrawTeam en arène refusé', async () => {
    const comp = competition(Weapon.EPEE);
    const [a] = await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    await reject('giveTeamCard', {
      competitionId: comp.id,
      matchId: `${comp.id}-p1-1`,
      teamId: a,
    }).toMatchObject({ code: 'unsupported_format' });
    const arena = competition(Weapon.LASER, { teamFormat: 'laser-arena' });
    const ids = await teamsRegistered(arena.id, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    await call('generateTeamPools', { competitionId: arena.id });
    const m = db.getTeamMatchesByCompetition(arena.id)[0];
    await reject('withdrawTeam', {
      competitionId: arena.id,
      matchId: m.id,
      teamId: m.teamAId,
      reason: 'abandon',
    }).toMatchObject({ code: 'unsupported_format' });
    expect(ids).toHaveLength(8);
  });
});

d('cancelRelayCard et épreuves antérieures (docs/adr/0028 §§ 1, 10)', () => {
  it('annulation d’un rouge : escalade recalculée, palier de nouveau strict', async () => {
    const comp = competition(Weapon.SABRE);
    await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    const card = {
      competitionId: comp.id,
      matchId: id,
      relayId: `${id}-r1`,
      side: 'B',
      reason: CardReason.FIE_UNARMED_ARM,
    };
    const red = await call('giveRelayCard', card);
    expect(red.card.type).toBe('RED');
    await reject(
      'cancelRelayCard',
      { competitionId: comp.id, matchId: id, cardId: red.card.id },
      { ...ctx, actor: { source: 'tablet' } }
    ).toMatchObject({ code: 'permission_denied' });
    const out = await call('cancelRelayCard', {
      competitionId: comp.id,
      matchId: id,
      cardId: red.card.id,
    });
    expect(out).toMatchObject({ relayId: `${id}-r1`, cardId: red.card.id });
    await expect(relayScore(comp.id, id, 1, 6, 0)).rejects.toMatchObject({
      code: 'score_above_max',
    });
    expect(divergences(comp.id)).toEqual([]);
  });

  it('épreuve antérieure : cartons en table sans événement, pas de faux écart', async () => {
    const comp = competition(Weapon.EPEE);
    await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    const m = match(`${comp.id}-p1-1`);
    // Écritures d'avant le lot C1 (écran, tablette) : tables seules
    db.teams.createTeamBoutCard(m.bouts[0].id, {
      id: 'legacy',
      matchId: m.id,
      fencerId: m.bouts[0].fencerAId,
      type: 'YELLOW',
      reason: CardReason.FIE_BODY_CONTACT,
      group: 1,
      timestamp: new Date('2026-11-01'),
      pointsAwarded: 0,
      resultingExclusion: false,
    } as never);
    expect(divergences(comp.id)).toEqual([]);
    // Le carton repris compte pour l'escalade de la rencontre
    const next = await call('giveRelayCard', {
      competitionId: comp.id,
      matchId: m.id,
      relayId: m.bouts[0].id,
      side: 'A',
      reason: CardReason.FIE_BODY_CONTACT,
    });
    expect(next.card.type).toBe('RED');
    // Rencontre portant désormais un carton au journal : le carton hors journal est un écart
    expect(divergences(comp.id).map(x => x.kind)).toEqual(['team_cards']);
  });
});

d('outils MCP des cartons d’équipe', () => {
  it('give_team_card, give_relay_card, cancel_*, withdraw_team (écriture sportive)', () => {
    const names = CONTRACT_MCP_TOOLS.write.map(t => t.name);
    for (const name of [
      'give_team_card',
      'give_relay_card',
      'cancel_team_card',
      'cancel_relay_card',
      'withdraw_team',
    ]) {
      expect(names).toContain(name);
    }
    const tool = CONTRACT_MCP_TOOLS.write.find(t => t.name === 'give_relay_card');
    expect(tool?.inputSchema.required).toEqual(['competitionId', 'matchId', 'relayId', 'side']);
  });
});
