/**
 * Relais et tableau d'équipes par le moteur (docs/adr/0024, lot E2) : rencontre FIE complète
 * jouée par les commandes, réouverture, remplaçant, tableau d'équipes jusqu'à la finale, rejeu
 * sans écart, idempotence du commandId, refus, outils MCP, et non-régression des écritures de
 * l'écran et de l'arène (délégations de la base). Base SQLite réelle.
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
import { writeLegacyRelay } from '../../../database/testing/legacyTeamWrites';

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
const types = (id: string) => events(id).map(e => e.type);

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

const fencer = (competitionId: string, name: string) =>
  db.addFencer(competitionId, {
    lastName: name,
    firstName: 'P',
    gender: Gender.MALE,
    status: FencerStatus.CHECKED_IN,
  }).id;

/** Équipes inscrites par les commandes : titulaires (et un remplaçant si demandé) */
async function teamsRegistered(
  competitionId: string,
  names: string[],
  titulars = 3,
  reserve = true
) {
  const ids: string[] = [];
  for (const name of names) {
    const { team } = await call('registerTeam', { competitionId, name });
    ids.push(team.id);
    for (let k = 1; k <= titulars + (reserve ? 1 : 0); k++) {
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

/** Journal rejoué comparé aux tables des équipes */
function divergences(competitionId: string) {
  const facts = projectCompetition(events(competitionId));
  const comp = db.getCompetition(competitionId)!;
  const state = {
    ...stateView({}, comp.settings),
    teams: teamStateView(ctx, comp),
  };
  return compareWithState(facts, state, {});
}

const match = (id: string) => db.teams.getTeamMatch(id)!;

/** Rencontre jouée par relais : l'équipe `side` marque 5 par relais, l'autre `other` */
async function play(competitionId: string, matchId: string, side: 'A' | 'B', other = 0) {
  const n = match(matchId).bouts.length;
  for (let relay = 1; relay <= n; relay++) {
    await call('recordRelayScore', {
      competitionId,
      matchId,
      relay,
      scoreA: side === 'A' ? 5 : other,
      scoreB: side === 'B' ? 5 : other,
    });
  }
}

d('recordRelayScore : rencontre FIE complète par les commandes (docs/adr/0024, lot E2)', () => {
  it('9 relais : score de chaque relais, cumul calculé, vainqueur, journal, rejeu sans écart', async () => {
    const comp = competition(Weapon.EPEE);
    const [a, b] = await teamsRegistered(comp.id, ['Alpha', 'Bravo']);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;

    // Simulation : rien d'écrit
    const dry = await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: id,
      relay: 1,
      scoreA: 5,
      scoreB: 3,
      dryRun: true,
    });
    expect(dry).toMatchObject({ dryRun: true, scoreA: 5, scoreB: 3, matchFinished: false });
    expect(match(id).bouts[0].status).toBe('not_started');

    const first = await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: id,
      relay: 1,
      scoreA: 5,
      scoreB: 3,
      commandId: 'cmd-r1',
    });
    expect(first).toMatchObject({ dryRun: false, relayId: `${id}-r1`, matchFinished: false });
    // Idempotence : même commandId, rien de réécrit
    await reject('recordRelayScore', {
      competitionId: comp.id,
      matchId: id,
      relay: 1,
      scoreA: 5,
      scoreB: 3,
      commandId: 'cmd-r1',
    }).toMatchObject({ code: 'command_already_applied' });

    for (let relay = 2; relay <= 9; relay++) {
      // Score du relais (le fait) : A 5, B 3 à chaque relais, cumul 5 × ordre au palier
      const out = await call('recordRelayScore', {
        competitionId: comp.id,
        matchId: id,
        relay,
        scoreA: 5,
        scoreB: 3,
      });
      expect(out).toMatchObject({ scoreA: 5 * relay, scoreB: 3 * relay });
    }
    const m = match(id);
    expect(m).toMatchObject({ status: 'finished', winnerId: a });
    expect(m.bouts.every(x => x.status === 'finished' && x.scoreA === 5)).toBe(true);
    const row = db.getTeamMatchesByCompetition(comp.id)[0];
    expect(row).toMatchObject({ scoreBoutsA: 45, scoreBoutsB: 27, currentBoutIndex: 9 });
    // Vainqueur du relais : tireur de l'équipe en tête au cumul (comme l'arène)
    expect(row.bouts.every(x => x.winnerId === x.fencerAId)).toBe(true);

    const log = events(comp.id).filter(e => e.type !== 'TeamMatchScheduled');
    expect(log.slice(-2).map(e => e.type)).toEqual(['RelayScoreRecorded', 'TeamMatchDecided']);
    expect(log[log.length - 1].payload).toEqual({ matchId: id, winnerTeamId: a });
    expect(log.find(e => e.commandId === 'cmd-r1')?.payload).toEqual({
      matchId: id,
      relayId: `${id}-r1`,
      scoreA: 5,
      scoreB: 3,
    });
    expect(divergences(comp.id)).toEqual([]);
    const rebuild = await call('rebuildCompetitionState', { competitionId: comp.id, dryRun: true });
    expect(rebuild.divergences).toEqual([]);
    // Bloc « teams » : relais et cumul relus
    db.saveSessionState(comp.id, { currentPhase: 10 } as never);
    const state = (await call('getCompetitionState', { competitionId: comp.id })).state;
    expect(state.teams.poolMatches[0]).toMatchObject({ scoreBoutsA: 45, status: 'finished' });
    expect(state.teams.poolRanking[0]).toMatchObject({ teamId: a, victories: 1, relaysWon: 9 });
    expect(b).toBeTruthy();
  });

  it('refus : ordre des relais, relais terminé, palier, rencontre inconnue ; égalité en poule admise', async () => {
    const comp = competition(Weapon.FOIL);
    await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    const rec = (relay: number, scoreA: number, scoreB: number, extra = {}) => ({
      competitionId: comp.id,
      matchId: id,
      relay,
      scoreA,
      scoreB,
      ...extra,
    });
    await reject('recordRelayScore', rec(2, 1, 1)).toMatchObject({ code: 'relay_out_of_order' });
    await reject('recordRelayScore', rec(1, 7, 0)).toMatchObject({ code: 'score_above_max' });
    // t.41.1 : au-delà du palier seulement avec un carton rouge dans le relais
    await reject('recordRelayScore', rec(1, 6, 6)).toMatchObject({ code: 'score_above_max' });
    await call('recordRelayScore', rec(1, 5, 2));
    await reject('recordRelayScore', rec(1, 5, 2)).toMatchObject({ code: 'relay_out_of_order' });
    // Palier du relais 2 : 10 au cumul
    await reject('recordRelayScore', rec(2, 7, 0)).toMatchObject({ code: 'score_above_max' });
    await reject('recordRelayScore', rec(10, 0, 0)).toMatchObject({ code: 'match_not_found' });
    await reject('recordRelayScore', { ...rec(2, 0, 0), matchId: 'x' }).toMatchObject({
      code: 'match_not_found',
    });
    await reject('recordRelayScore', rec(-1, 0, 0)).toMatchObject({ code: 'invalid_input' });
    // Égalité au dernier relais d'une rencontre de poule : sans vainqueur
    for (let relay = 2; relay <= 8; relay++) await call('recordRelayScore', rec(relay, 0, 0));
    await reject('recordRelayScore', rec(9, 0, 4, { winner: 'A' })).toMatchObject({
      code: 'winner_contradicts_score',
    });
    const out = await call('recordRelayScore', rec(9, 0, 3));
    expect(out).toMatchObject({ matchFinished: true, scoreA: 5, scoreB: 5, winnerTeamId: null });
    expect(match(id)).toMatchObject({ status: 'finished', winnerId: null });
    expect(events(comp.id).pop()?.payload).toEqual({ matchId: id, winnerTeamId: null });
    expect(divergences(comp.id)).toEqual([]);
  });

  it('épreuve individuelle refusée ; recordScore et generateTableau nomment la commande d’équipe', async () => {
    const comp = competition(Weapon.EPEE);
    await reject('recordScore', {
      competitionId: comp.id,
      matchId: 'm',
      scoreA: 5,
      scoreB: 3,
    }).toMatchObject({
      code: 'unsupported_format',
      message: expect.stringContaining('recordRelayScore'),
    });
    await reject('generateTableau', { competitionId: comp.id }).toMatchObject({
      code: 'unsupported_format',
      message: expect.stringContaining('generateTeamTableau'),
    });
    const solo = db.createCompetition({
      title: 'Individuelle',
      date: new Date('2026-12-06'),
      location: 'Gymnase',
      weapon: Weapon.EPEE,
      gender: Gender.MIXED,
      category: Category.SENIOR,
    });
    for (const op of ['recordRelayScore', 'reopenRelay', 'substituteTeamFencer']) {
      await reject(op, {
        competitionId: solo.id,
        matchId: 'm',
        relay: 1,
        scoreA: 0,
        scoreB: 0,
        teamId: 't',
        outFencerId: 'f',
      }).toMatchObject({ code: 'unsupported_format' });
    }
    await reject('generateTeamTableau', { competitionId: solo.id }).toMatchObject({
      code: 'unsupported_format',
    });
  });
});

d('reopenRelay et substituteTeamFencer (docs/adr/0024, lot E2)', () => {
  it('réouverture du dernier relais : score gardé, rencontre en cours, nouvel enregistrement', async () => {
    const comp = competition(Weapon.EPEE);
    const [a, b] = await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    await reject('reopenRelay', { competitionId: comp.id, matchId: id }).toMatchObject({
      code: 'relay_out_of_order',
    });
    await play(comp.id, id, 'A', 2);
    expect(match(id).winnerId).toBe(a);

    const out = await call('reopenRelay', { competitionId: comp.id, matchId: id, commandId: 'ro' });
    expect(out).toMatchObject({ relayId: `${id}-r9`, relay: 9, scoreA: 5, scoreB: 2 });
    const m = match(id);
    expect(m).toMatchObject({ status: 'in_progress', winnerId: null });
    expect(m.bouts[8]).toMatchObject({ status: 'in_progress', scoreA: 5, scoreB: 2 });
    expect(db.getTeamMatchesByCompetition(comp.id)[0]).toMatchObject({
      scoreBoutsA: 40,
      scoreBoutsB: 16,
      currentBoutIndex: 8,
      winnerId: null,
    });
    expect(events(comp.id).pop()).toMatchObject({
      type: 'RelayReopened',
      payload: { matchId: id, relayId: `${id}-r9` },
    });
    expect(divergences(comp.id)).toEqual([]);

    // Correction : B l'emporte au dernier relais (palier 45)
    await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: id,
      relay: 9,
      scoreA: 0,
      scoreB: 29,
    });
    expect(match(id)).toMatchObject({ status: 'finished', winnerId: b });
    expect(divergences(comp.id)).toEqual([]);
  });

  it('remplaçant : relais non terminés du tireur sortant ; un seul par équipe et par rencontre', async () => {
    const comp = competition(Weapon.SABRE);
    const [a, b] = await teamsRegistered(comp.id, ['A', 'B']);
    const [c] = await teamsRegistered(comp.id, ['C'], 3, false);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`; // A contre B
    await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: id,
      relay: 1,
      scoreA: 5,
      scoreB: 1,
    });
    const teamA = db.getTeamsByCompetition(comp.id).find(t => t.id === a)!;
    const [a1, , a3, reserve] = teamA.fencers.map(f => f.fencerId);
    // Ordre FIE : A3 tire le relais 1 (terminé), puis 5 et 9
    const sub = { competitionId: comp.id, matchId: id, teamId: a, outFencerId: a3 };
    const dry = await call('substituteTeamFencer', { ...sub, dryRun: true });
    expect(dry).toMatchObject({
      dryRun: true,
      inFencerId: reserve,
      relayIds: [`${id}-r5`, `${id}-r9`],
    });
    expect(match(id).bouts[4].fencerAId).toBe(a3);

    const out = await call('substituteTeamFencer', sub);
    expect(out).toMatchObject({ inFencerId: reserve, relayIds: [`${id}-r5`, `${id}-r9`] });
    const bouts = match(id).bouts;
    expect(bouts[0].fencerAId).toBe(a3);
    expect([bouts[4].fencerAId, bouts[8].fencerAId]).toEqual([reserve, reserve]);
    expect(events(comp.id).pop()).toMatchObject({
      type: 'TeamFencerSubstituted',
      payload: { matchId: id, teamId: a, outFencerId: a3, inFencerId: reserve },
    });
    expect(divergences(comp.id)).toEqual([]);

    await reject('substituteTeamFencer', { ...sub, outFencerId: a1 }).toMatchObject({
      code: 'reserve_used',
    });
    await reject('substituteTeamFencer', { ...sub, teamId: c }).toMatchObject({
      code: 'team_not_found',
    });
    await reject('substituteTeamFencer', { ...sub, teamId: b, outFencerId: a1 }).toMatchObject({
      code: 'fencer_not_found',
    });
    // Équipe sans remplaçant (rencontre A contre C)
    const ac = `${comp.id}-p1-2`;
    const teamC = db.getTeamsByCompetition(comp.id).find(t => t.id === c)!;
    await reject('substituteTeamFencer', {
      competitionId: comp.id,
      matchId: ac,
      teamId: c,
      outFencerId: teamC.fencers[0].fencerId,
    }).toMatchObject({ code: 'no_reserve' });
    // Plus aucun relais à tirer : rencontre terminée
    await play(comp.id, ac, 'A');
    await reject('substituteTeamFencer', {
      competitionId: comp.id,
      matchId: ac,
      teamId: a,
      outFencerId: a1,
    }).toMatchObject({ code: 'no_later_relay' });
  });
});

d('generateTeamTableau : tableau d’équipes jusqu’à la finale (docs/adr/0024, lot E2)', () => {
  /** 4 équipes de 2 titulaires (4 relais) ; poule jouée : A > B > C > D */
  async function poolsPlayed() {
    const comp = competition(Weapon.EPEE, { minTeamSize: 2 });
    const ids = await teamsRegistered(comp.id, ['A', 'B', 'C', 'D'], 2);
    await call('generateTeamPools', { competitionId: comp.id });
    await reject('generateTeamTableau', { competitionId: comp.id }).toMatchObject({
      code: 'pools_not_complete',
    });
    // Rencontres dans l'ordre des noms : l'équipe A de chaque rencontre l'emporte
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await play(comp.id, m.id, 'A', 1);
    return { comp, ids };
  }

  it('placement, demi-finales, finale créée après les deux demi-finales, rejeu sans écart', async () => {
    const { comp, ids } = await poolsPlayed();
    const [a, b, c, dd] = ids;
    const t = (round: number, position: number) => `${comp.id}-t${round}-${position}`;

    const dry = await call('generateTeamTableau', { competitionId: comp.id, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, size: 4, matchIds: [t(2, 0), t(2, 1)] });
    expect(db.getTeamTableauMatches(comp.id, comp.id)).toEqual([]);

    const out = await call('generateTeamTableau', { competitionId: comp.id, commandId: 'tab' });
    expect(out.slots).toEqual([
      { round: 2, position: 0, teamAId: a, teamBId: dd, isBye: false },
      { round: 2, position: 1, teamAId: c, teamBId: b, isBye: false },
    ]);
    const tab = events(comp.id).filter(e => e.commandId === 'tab');
    expect(tab.map(e => e.type)).toEqual([
      'TeamTableauGenerated',
      'TeamMatchScheduled',
      'TeamMatchScheduled',
    ]);
    expect(tab[1].payload).toMatchObject({ pool: null, round: 2, position: 0, teamAId: a });
    const semi = db.getTeamTableauMatches(comp.id, comp.id);
    expect(semi.map(m => [m.id, m.round, m.position, m.bouts.length])).toEqual([
      [t(2, 0), 2, 0, 4],
      [t(2, 1), 2, 1, 4],
    ]);
    expect(divergences(comp.id)).toEqual([]);

    // Refus : tableau déjà créé, nouveau tirage des poules
    await reject('generateTeamTableau', { competitionId: comp.id }).toMatchObject({
      code: 'bracket_exists',
    });
    await reject('generateTeamPools', { competitionId: comp.id, replace: true }).toMatchObject({
      code: 'bracket_exists',
    });

    await play(comp.id, t(2, 0), 'A');
    expect(db.getTeamTableauMatches(comp.id, comp.id)).toHaveLength(2);
    // Demi-finale 2 : égalité au dernier relais → vainqueur requis
    for (let relay = 1; relay <= 3; relay++) {
      await call('recordRelayScore', {
        competitionId: comp.id,
        matchId: t(2, 1),
        relay,
        scoreA: 0,
        scoreB: 0,
      });
    }
    const last = { competitionId: comp.id, matchId: t(2, 1), relay: 4, scoreA: 4, scoreB: 4 };
    await reject('recordRelayScore', last).toMatchObject({ code: 'draw_needs_winner' });
    await reject('generateTeamTableau', { competitionId: comp.id, replace: true }).toMatchObject({
      code: 'bracket_has_scores',
    });
    const decided = await call('recordRelayScore', { ...last, winner: 'B' });
    expect(decided).toMatchObject({
      matchFinished: true,
      winnerTeamId: b,
      scheduledMatchIds: [t(1, 0)],
    });
    const final = match(t(1, 0));
    expect(final).toMatchObject({ teamAId: a, teamBId: b, round: 1, position: 0 });
    expect(
      events(comp.id)
        .slice(-3)
        .map(e => e.type)
    ).toEqual(['RelayScoreRecorded', 'TeamMatchDecided', 'TeamMatchScheduled']);
    expect(divergences(comp.id)).toEqual([]);

    // Réouverture d'une demi-finale : la finale, pas encore commencée, est retirée
    const reopened = await call('reopenRelay', { competitionId: comp.id, matchId: t(2, 1) });
    expect(reopened.removedMatchIds).toEqual([t(1, 0)]);
    expect(db.teams.getTeamMatch(t(1, 0))).toBeNull();
    expect(divergences(comp.id)).toEqual([]);
    await call('recordRelayScore', { ...last, winner: 'B' });
    expect(match(t(1, 0))).toMatchObject({ teamAId: a, teamBId: b });

    // Finale commencée : la demi-finale ne se rouvre plus
    await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: t(1, 0),
      relay: 1,
      scoreA: 5,
      scoreB: 0,
    });
    await reject('reopenRelay', { competitionId: comp.id, matchId: t(2, 1) }).toMatchObject({
      code: 'next_match_played',
    });
    for (let relay = 2; relay <= 4; relay++) {
      await call('recordRelayScore', {
        competitionId: comp.id,
        matchId: t(1, 0),
        relay,
        scoreA: 5,
        scoreB: 0,
      });
    }
    expect(match(t(1, 0))).toMatchObject({ status: 'finished', winnerId: a });

    // Rejeu sans écart, journal complet ; rebuild ne relève rien
    const facts = projectCompetition(events(comp.id));
    expect(facts.complete).toBe(true);
    expect(facts.teams?.decisions[t(1, 0)]).toBe(a);
    expect(divergences(comp.id)).toEqual([]);
    const rebuild = await call('rebuildCompetitionState', { competitionId: comp.id, dryRun: true });
    expect(rebuild.divergences).toEqual([]);
    // Bloc « teams » : tableau lu
    db.saveSessionState(comp.id, { currentPhase: 10 } as never);
    const state = (await call('getCompetitionState', { competitionId: comp.id })).state;
    expect(state.teams.tableauMatches.map((m: { id: string }) => m.id)).toEqual([
      t(2, 0),
      t(2, 1),
      t(1, 0),
    ]);
  });

  it('remplacement du tableau tant qu’aucun relais n’est joué ; refus : titulaires manquants', async () => {
    const { comp } = await poolsPlayed();
    await call('generateTeamTableau', { competitionId: comp.id });
    const again = await call('generateTeamTableau', { competitionId: comp.id, replace: true });
    expect(again.matchIds).toHaveLength(2);
    expect(db.getTeamTableauMatches(comp.id, comp.id)).toHaveLength(2);
    expect(types(comp.id).filter(x => x === 'TeamTableauGenerated')).toHaveLength(2);
    expect(divergences(comp.id)).toEqual([]);

    const lone = competition(Weapon.EPEE);
    await teamsRegistered(lone.id, ['X']);
    await reject('generateTeamTableau', { competitionId: lone.id }).toMatchObject({
      code: 'invalid_composition',
    });
    await teamsRegistered(lone.id, ['Y'], 2);
    await reject('generateTeamTableau', { competitionId: lone.id }).toMatchObject({
      code: 'team_incomplete',
    });
  });

  it('5 équipes sans poules : exemptés, rencontre du 2e tour formée d’emblée', async () => {
    const comp = competition(Weapon.FOIL, { minTeamSize: 1 });
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D', 'E'], 1, false);
    const out = await call('generateTeamTableau', { competitionId: comp.id });
    expect(out.size).toBe(8);
    expect(out.slots.filter((s: { isBye: boolean }) => s.isBye)).toHaveLength(3);
    expect(out.matchIds).toEqual([`${comp.id}-t4-1`, `${comp.id}-t2-1`]);
    expect(projectCompetition(events(comp.id)).complete).toBe(true);
    expect(divergences(comp.id)).toEqual([]);
  });
});

d('Écarts et non-régression (docs/adr/0024, lot E2)', () => {
  it('relais écrit hors moteur (version antérieure) sur une rencontre du journal : écart rendu', async () => {
    const comp = competition(Weapon.EPEE);
    await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    // Touches en cours (ancien écran) : pas un fait, pas d'écart
    writeLegacyRelay(db, id, `${id}-r1`, { scoreA: 2, scoreB: 1, status: 'in_progress' });
    expect(divergences(comp.id)).toEqual([]);
    // Fin de relais par la base (ancien chemin de l'écran et de l'arène, avant E3 et E4)
    writeLegacyRelay(db, id, `${id}-r1`, { scoreA: 5, scoreB: 1, status: 'finished' });
    expect(divergences(comp.id)).toEqual([
      {
        kind: 'team_relay',
        id: `${id}-r1`,
        expected: { finished: false },
        actual: { finished: true, scoreA: 5, scoreB: 1 },
      },
    ]);
    expect(db.getTeamMatchesByCompetition(comp.id)[0]).toMatchObject({
      scoreBoutsA: 5,
      scoreBoutsB: 1,
      status: 'in_progress',
    });
    const rebuild = await call('rebuildCompetitionState', { competitionId: comp.id });
    expect(rebuild.remaining).toHaveLength(1);
  });

  it('outils MCP des relais et du tableau d’équipes (écriture sportive)', () => {
    const names = CONTRACT_MCP_TOOLS.write.map(t => t.name);
    for (const name of [
      'generate_team_tableau',
      'record_relay_score',
      'reopen_relay',
      'substitute_team_fencer',
    ]) {
      expect(names).toContain(name);
    }
    const tool = CONTRACT_MCP_TOOLS.write.find(t => t.name === 'record_relay_score');
    expect(tool?.inputSchema.required).toEqual([
      'competitionId',
      'matchId',
      'relay',
      'scoreA',
      'scoreB',
    ]);
  });
});
