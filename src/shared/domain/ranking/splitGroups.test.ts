import { describe, it, expect } from 'vitest';
import { Competition, Fencer, FencerStatus, Gender, PoolRanking } from '../../types';
import {
  defaultSplitCompetitionTitle,
  buildSplitCompetitionData,
  extractSplitGroupRanking,
  toSplitFencerData,
  remapRankingFencers,
  planSplitGroups,
  filterSplitGroup,
  groupMatchId,
  prefixBrackets,
  allTableauMatches,
  allConsolationBrackets,
  legacyTableauGroup,
  sessionGroupTableaux,
  splitOffRefusal,
  splitOffSessionState,
  importedRanking,
} from './splitGroups';
import type { ConsolationBracket, TableauMatch } from '../tableau/tableauTypes';
import { validateCompetitionData } from '../../../database/validation';

const fencer = (id: string, gender: Gender, status = FencerStatus.QUALIFIED): Fencer =>
  ({
    id,
    ref: 1,
    lastName: `Nom${id}`,
    firstName: `Prenom${id}`,
    gender,
    nationality: 'FRA',
    club: 'Club',
    status,
    poolStats: {
      victories: 2,
      defeats: 1,
      touchesScored: 10,
      touchesReceived: 6,
      index: 4,
      matchesPlayed: 3,
      victoryRatio: 0.67,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Fencer;

const rank = (f: Fencer, r: number): PoolRanking => ({
  fencer: f,
  rank: r,
  victories: 2,
  defeats: 1,
  matchesPlayed: 3,
  touchesScored: 10,
  touchesReceived: 6,
  index: 4,
  ratio: 0.67,
  questPoints: 0,
});

describe('splitCompetition', () => {
  it('propose un titre par défaut', () => {
    expect(defaultSplitCompetitionTitle('Open', Gender.FEMALE)).toBe('Open – Dames');
  });

  it('copie les paramètres sans le mode couplé et lie la compétition source', () => {
    const source = {
      id: 'c1',
      title: 'Open',
      date: new Date('2026-10-01'),
      weapon: 'E',
      gender: Gender.MIXED,
      category: 'SEN',
      color: '#fff',
      settings: {
        postPoolSplitCriteria: 'gender',
        poolWinnersOnly: true,
        splitOffCompetitionIds: { F: 'x' },
        defaultTableMaxScore: 15,
      },
    } as unknown as Competition;
    const data = buildSplitCompetitionData(
      source,
      '  Open Dames ',
      Gender.FEMALE,
      new Date('2026-10-01')
    );
    expect(data.title).toBe('Open Dames');
    expect(data.gender).toBe(Gender.FEMALE);
    expect(data.settings).toEqual({
      defaultPoolMaxScore: 5,
      defaultTableMaxScore: 15,
      poolRounds: 1,
      defaultRanking: 0,
      minTeamSize: 3,
      splitFromCompetitionId: 'c1',
    });
    expect(() => validateCompetitionData(data)).not.toThrow();
  });

  it('borne le score de poule et normalise une date sérialisée', () => {
    const source = {
      id: 'c2',
      title: 'Open',
      date: '2026-10-01T00:00:00.000Z',
      weapon: 'E',
      gender: Gender.MIXED,
      category: 'SEN',
      color: '#3B82F6',
      settings: { defaultPoolMaxScore: 21 },
    } as unknown as Competition;
    const data = buildSplitCompetitionData(
      source,
      'Open Dames',
      Gender.FEMALE,
      new Date('2026-10-01')
    );
    expect(data.date).toBeInstanceOf(Date);
    expect(data.settings?.defaultPoolMaxScore).toBe(15);
    expect(() => validateCompetitionData(data)).not.toThrow();
  });

  it('extrait et renumérote le classement du groupe', () => {
    const ranking = [
      rank(fencer('a', Gender.MALE), 1),
      rank(fencer('b', Gender.FEMALE), 2),
      rank(fencer('c', Gender.FEMALE), 3),
    ];
    const girls = extractSplitGroupRanking(ranking, Gender.FEMALE);
    expect(girls.map(r => [r.fencer.id, r.rank])).toEqual([
      ['b', 1],
      ['c', 2],
    ]);
    expect(extractSplitGroupRanking(ranking, Gender.MIXED)).toEqual([]);
  });

  it('prépare les données tireur avec le rang après poules et pointe les non-pointés', () => {
    const data = toSplitFencerData(
      rank(fencer('b', Gender.FEMALE, FencerStatus.NOT_CHECKED_IN), 4)
    );
    expect(data.ranking).toBe(4);
    expect(data.status).toBe(FencerStatus.CHECKED_IN);
    expect(
      toSplitFencerData(rank(fencer('d', Gender.FEMALE, FencerStatus.ABANDONED), 5)).status
    ).toBe(FencerStatus.ABANDONED);
  });

  it('remappe les tireurs en conservant les stats de poule', () => {
    const old = fencer('b', Gender.FEMALE);
    const created = { ...fencer('new-b', Gender.FEMALE), poolStats: undefined };
    const out = remapRankingFencers(
      [rank(old, 1), rank(fencer('z', Gender.FEMALE), 2)],
      new Map([['b', created]])
    );
    expect(out).toHaveLength(1);
    expect(out[0].fencer.id).toBe('new-b');
    expect(out[0].fencer.poolStats).toEqual(old.poolStats);
    expect(out[0].victories).toBe(2);
  });
});

const tm = (id: string, a: Fencer | null = null, b: Fencer | null = null): TableauMatch => ({
  id,
  round: 2,
  position: 0,
  fencerA: a,
  fencerB: b,
  scoreA: null,
  scoreB: null,
  winner: null,
  isBye: false,
});

describe('tableaux séparés (docs/adr/0024)', () => {
  const ranking = [
    rank(fencer('a', Gender.MALE), 1),
    rank(fencer('b', Gender.FEMALE), 2),
    rank(fencer('x', Gender.MIXED), 3),
    rank(fencer('c', Gender.FEMALE), 4),
  ];

  it('planSplitGroups : groupes triés, mixte et groupes extraits écartés, rangs renumérotés', () => {
    const plan = planSplitGroups(ranking, 'gender', undefined);
    expect(plan.map(p => p.group)).toEqual(['F', 'M']);
    expect(plan[0].ranking.map(r => [r.fencer.id, r.rank])).toEqual([
      ['b', 1],
      ['c', 2],
    ]);
    expect(planSplitGroups(ranking, 'gender', { F: 'c2' }).map(p => p.group)).toEqual(['M']);
    expect(planSplitGroups(ranking, undefined, undefined)).toEqual([]);
  });

  it('filterSplitGroup : groupe affiché, ou groupes extraits écartés', () => {
    expect(filterSplitGroup(ranking, 'gender', 'F', undefined).map(r => r.fencer.id)).toEqual([
      'b',
      'c',
    ]);
    expect(filterSplitGroup(ranking, 'gender', null, { F: 'c2' }).map(r => r.fencer.id)).toEqual([
      'a',
      'x',
    ]);
    expect(filterSplitGroup(ranking, undefined, 'F', undefined)).toBe(ranking);
  });

  it('identifiants préfixés par le groupe, sans double préfixe', () => {
    expect(groupMatchId('F', '32-0')).toBe('F:32-0');
    expect(groupMatchId('F', 'F:32-0')).toBe('F:32-0');
    const bracket: ConsolationBracket = {
      id: 'cons-16',
      name: 'Places 9–16',
      firstPlace: 9,
      matches: [tm('cons-16-8-0')],
      size: 8,
      isComplete: false,
      sourceRound: 16,
      parentBracketId: 'main',
    };
    const [p] = prefixBrackets(
      [bracket, { ...bracket, id: 'cons-16-8', parentBracketId: 'cons-16' }],
      'F'
    );
    expect(p).toMatchObject({ id: 'F:cons-16', parentBracketId: 'main' });
    expect(p.matches[0].id).toBe('F:cons-16-8-0');
    expect(prefixBrackets([bracket], 'F')[0]).toEqual(
      prefixBrackets(prefixBrackets([bracket], 'F'), 'F')[0]
    );
    expect(
      prefixBrackets([{ ...bracket, parentBracketId: 'cons-16' }], 'F')[0].parentBracketId
    ).toBe('F:cons-16');
  });

  it('lecture de tous les tableaux : racine et groupes', () => {
    const session = {
      tableauMatches: [tm('2-0')],
      consolationBrackets: [],
      groupTableaux: {
        F: { tableauMatches: [tm('F:2-0')], consolationBrackets: [], finalResults: [] },
        M: { tableauMatches: [tm('M:2-0')] },
        bad: null,
      },
    };
    expect(allTableauMatches(session).map(m => m.id)).toEqual(['2-0', 'F:2-0', 'M:2-0']);
    expect(allConsolationBrackets(session)).toEqual([]);
    expect(Object.keys(sessionGroupTableaux(session))).toEqual(['F', 'M']);
    expect(sessionGroupTableaux({ groupTableaux: [] })).toEqual({});
  });

  it('reprise : groupe d’un tableau tiré à la racine, d’après ses tireurs', () => {
    const f = fencer('b', Gender.FEMALE);
    expect(legacyTableauGroup([tm('2-0', null, f)], 'gender')).toBe('F');
    expect(legacyTableauGroup([tm('2-0', fencer('x', Gender.MIXED))], 'gender')).toBeNull();
    expect(legacyTableauGroup([tm('2-0', f)], undefined)).toBeNull();
  });
});

describe('extraction d’un groupe (docs/adr/0024, lot A3)', () => {
  const ranking = [
    rank(fencer('f1', Gender.FEMALE), 1),
    rank(fencer('m1', Gender.MALE), 2),
    rank(fencer('f2', Gender.FEMALE), 3),
  ];
  const split = { settings: { postPoolSplitCriteria: 'gender' } } as Pick<Competition, 'settings'>;

  it('refus : sans tableaux séparés, groupe extrait, tableau tiré, groupe absent', () => {
    expect(splitOffRefusal({ settings: {} } as never, ranking, 'F', 0)?.code).toBe('invalid_input');
    const extracted = {
      settings: { postPoolSplitCriteria: 'gender', splitOffCompetitionIds: { F: 'c2' } },
    } as never;
    expect(splitOffRefusal(extracted, ranking, 'F', 0)?.code).toBe('split_group_not_found');
    expect(splitOffRefusal(split, ranking, 'F', 4)?.code).toBe('bracket_exists');
    expect(splitOffRefusal(split, ranking, 'X', 0)?.code).toBe('split_group_not_found');
    expect(splitOffRefusal(split, [], 'F', 0)?.code).toBe('split_group_not_found');
    expect(splitOffRefusal(split, ranking, 'F', 0)).toBeNull();
  });

  it('projection de départ : phase Classement, sans poules ni tableau', () => {
    const s = splitOffSessionState(ranking);
    expect(s).toMatchObject({
      currentPhase: 3,
      pools: [],
      tableauMatches: [],
      skipPoolPhase: false,
    });
    expect(s.overallRanking).toBe(ranking);
  });

  it('classement importé : statistiques de l’épreuve d’origine, sinon rangs seuls', () => {
    const copies = new Map([
      ['n1', fencer('n1', Gender.FEMALE)],
      ['n2', fencer('n2', Gender.FEMALE)],
    ]);
    const entries = [
      { fencerId: 'n2', sourceFencerId: 'f2', rank: 2 },
      { fencerId: 'n1', sourceFencerId: 'f1', rank: 1 },
      { fencerId: 'gone', sourceFencerId: 'f9', rank: 3 },
    ];
    const withStats = importedRanking(entries, copies, ranking);
    expect(withStats.map(r => [r.fencer.id, r.rank, r.victories])).toEqual([
      ['n1', 1, 2],
      ['n2', 2, 2],
    ]);
    expect(withStats[0].fencer.poolStats?.victories).toBe(2);
    const ranksOnly = importedRanking(entries, copies, null);
    expect(ranksOnly.map(r => [r.fencer.id, r.rank, r.victories])).toEqual([
      ['n1', 1, 0],
      ['n2', 2, 0],
    ]);
  });
});
