/**
 * Épreuve réelle par équipes (docs/adr/0044, Conséquences : « Un test sur une épreuve réelle le
 * prouve ») : extrait du fichier de l'extranet FFE anonymisé EH_M17-équipe (épée hommes M17,
 * 8 équipes), importé par le parseur et l'import fédéral de l'écran (registerFencers,
 * registerTeam, assignTeamFencer). Sans formule d'équipe : poule unique, ordre des noms, comme
 * avant G0 ; avec formule d'équipe : poules au rang d'entrée (classements des titulaires du
 * fichier). Rejeu du journal sans divergence. Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, Gender, Weapon } from '../../../shared/types';
import type { BpmClient } from '../../../shared/api/client';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { parseXMLFile } from '../../../shared/utils/fileParser/xmlParser';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../../shared/domain/journal/compareWithState';
import { teamEntryRanking } from '../../../shared/domain/teams/teamEntryRanking';
import type { FormulaV2 } from '../../../shared/domain/formula/formulaV2';
import { applyFederalImport } from '../../../renderer/services/federalCreation';
import type { CommandContext } from './context';
import { teamStateView } from './teams';
import { invoke } from '../api/engine';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

const XML = readFileSync(join(__dirname, '__fixtures__', 'EH_M17-equipe-extrait.xml'), 'utf8');

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
const client = { call, query: call, subscribe: vi.fn() } as unknown as BpmClient;

/** Formule d'équipe : poules de 4, puis tableau */
const TEAM_FORMULA: FormulaV2 = {
  version: 2,
  phases: [
    {
      kind: 'pool',
      id: 'pool-1',
      sizeMin: 4,
      sizeMax: 4,
      maxScore: 45,
      timerSeconds: 180,
      qualification: { mode: 'all' },
      seeding: 'previous_round',
      boutOrder: 'fie',
    },
    {
      kind: 'tableau',
      id: 'tableau',
      maxScore: 45,
      timerSeconds: 180,
      thirdPlace: false,
      allPlaces: false,
    },
  ],
  general: { teamMatch: { starters: 3, reserves: 1, relayStep: 5, relayOrder: 'fie' } },
};

/** Épreuve du fichier (épée, M17), créée comme avant G0 ; `formula` : formule enregistrée */
async function importedCompetition(formula?: FormulaV2) {
  const comp = db.createCompetition({
    title: 'Demi-finale des championnats de France par équipe',
    date: new Date('2026-03-07'),
    location: 'Gymnase',
    weapon: Weapon.EPEE,
    gender: Gender.MALE,
    category: Category.U17,
    isTeamEvent: true,
    settings: {
      ...buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.U17 }),
      minTeamSize: 3,
      ...(formula ? { formula } : {}),
    } as never,
  });
  const parsed = parseXMLFile(XML);
  expect(parsed.teams).toHaveLength(8);
  const counts = await applyFederalImport(
    client,
    comp.id,
    { fencers: parsed.fencers, teams: parsed.teams ?? [], referees: [] },
    3
  );
  expect(counts).toEqual({ fencers: 29, teams: 8, referees: 0 });
  const byName = new Map(db.getTeamsByCompetition(comp.id).map(t => [t.name, t.id]));
  return { comp, id: (name: string) => byName.get(name)! };
}

function divergences(competitionId: string) {
  const facts = projectCompetition(db.eventLog.getSince(competitionId));
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

async function playAll(competitionId: string) {
  const all = [
    ...db.getTeamMatchesByCompetition(competitionId),
    ...db
      .getTeamTableauMatches(competitionId, competitionId)
      .map(m => db.teams.getTeamMatch(m.id)!),
  ];
  for (const m of all.filter(x => x.status !== 'finished' && x.teamAId && x.teamBId))
    for (let relay = 1; relay <= m.bouts.length; relay++)
      await call('recordRelayScore', {
        competitionId,
        matchId: m.id,
        relay,
        scoreA: relay === 1 ? 5 : 0,
        scoreB: 0,
      });
}

/** Ordre des noms, sans le rang d'entrée (poule unique d'avant G0) */
const ALPHABETICAL = [
  'AMIENS CEAM 1',
  'AUVERGNE RHONE ALPES 1',
  'BOURGOGNE FRANCHE COMTE 1',
  'DIJON ASPTT 1',
  'NEVERS CE 1',
  'NORMANDIE 1',
  'NORMANDIE 2',
  'SARLAT CE 1',
];

d('Épreuve réelle EH M17 par équipes (extranet FFE anonymisé, docs/adr/0044)', () => {
  it('rang d’entrée : somme des classements des titulaires du fichier ; équipe incomplète au nom', async () => {
    const { comp } = await importedCompetition();
    const teams = db.getTeamsByCompetition(comp.id);
    // Le fichier ne porte pas de Classement d'équipe (<Equipes/> vide) : aucun rang saisi
    expect(teams.every(t => t.ranking == null)).toBe(true);
    const fencers = db.getFencersByCompetition(comp.id);
    const rank = new Map(fencers.map(f => [f.id, f.ranking]));
    const order = teamEntryRanking(teams, 3, id => rank.get(id)).map(t => t.name);
    expect(order).toEqual([
      'NEVERS CE 1', // 1030 + 1070 + 1060 = 3160
      'NORMANDIE 2', // 3171
      'AUVERGNE RHONE ALPES 1', // 3302 (remplaçant sans classement)
      'SARLAT CE 1', // 3343
      'DIJON ASPTT 1', // 3378
      'NORMANDIE 1', // 3410
      'BOURGOGNE FRANCHE COMTE 1', // 3665
      'AMIENS CEAM 1', // 1er titulaire sans classement : au nom, après les rangs
    ]);
  });

  it('sans formule d’équipe : poule unique tous contre tous dans l’ordre des noms, rejeu identique', async () => {
    const { comp, id } = await importedCompetition();
    const out = await call('generateTeamPools', { competitionId: comp.id });
    expect(out.pools).toEqual([{ number: 1, teamIds: ALPHABETICAL.map(id) }]);
    expect(out.matchIds).toHaveLength(28);
    const first = db.teams.getTeamMatch(`${comp.id}-p1-1`)!;
    expect([first.teamAId, first.teamBId]).toEqual([id(ALPHABETICAL[0]), id(ALPHABETICAL[1])]);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('formule « individuelle » enregistrée (sans general.teamMatch) : même poule unique', async () => {
    const { comp, id } = await importedCompetition({ ...TEAM_FORMULA, general: {} });
    const out = await call('generateTeamPools', { competitionId: comp.id });
    expect(out.pools).toEqual([{ number: 1, teamIds: ALPHABETICAL.map(id) }]);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('formule d’équipe : 2 poules de 4 en serpentin au rang d’entrée importé, tableau, rejeu', async () => {
    const { comp, id } = await importedCompetition(TEAM_FORMULA);
    const out = await call('generateTeamPools', { competitionId: comp.id });
    // Serpentin : rangs 1-4-5-8 / 2-3-6-7
    const sorted = (names: string[]) => names.map(id).sort();
    expect(out.pools.map((p: { teamIds: string[] }) => [...p.teamIds].sort())).toEqual([
      sorted(['NEVERS CE 1', 'SARLAT CE 1', 'DIJON ASPTT 1', 'AMIENS CEAM 1']),
      sorted(['NORMANDIE 2', 'AUVERGNE RHONE ALPES 1', 'NORMANDIE 1', 'BOURGOGNE FRANCHE COMTE 1']),
    ]);
    expect(out.matchIds).toHaveLength(12);
    await playAll(comp.id);
    const tableau = await call('generateTeamTableau', { competitionId: comp.id });
    expect(tableau.size).toBe(8);
    await playAll(comp.id);
    await playAll(comp.id);
    await playAll(comp.id);
    const { finalRanking } = (await call('getCompetitionState', { competitionId: comp.id })).state
      .teams;
    expect(finalRanking.provisional).toBe(false);
    expect(finalRanking.rows).toHaveLength(8);
    expect(divergences(comp.id)).toEqual([]);
  });
});
