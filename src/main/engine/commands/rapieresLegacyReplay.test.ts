/**
 * Non-régression de la fin du mode spécial (docs/adr/0043, lot F4e) : une épreuve du Tournoi des
 * rapières ENREGISTRÉE (réglages `specialMode: 'rapieres'`, état de session `rapieres` v1 et v2,
 * journal avec les anciens événements Rapieres*) se relit comme avant : même formule effective,
 * mêmes vagues, mêmes qualifiés du tableau, même classement final, même rejeu du journal.
 * Les données de référence (`rapieresLegacyReference.json`) ont été calculées AVANT le retrait du
 * mode spécial, sur le commit de départ du lot F4e ; ce test vérifie qu'elles n'ont pas bougé.
 * Régénération volontaire : `UPDATE_RAPIERES_REFERENCE=1 npx vitest run <ce fichier>`.
 * Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
import type { CompetitionSettings, Fencer } from '../../../shared/types';
import { formulaFromCustom } from '../../../shared/domain/formula/formulaV2';
import { createDefaultCustomFormula } from '../../../shared/utils/tournamentTemplates';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../../shared/domain/journal/compareWithState';
import { finalRanking } from '../../../shared/domain/ranking/finalRanking';
import {
  canLaunchNextWave,
  poolMatchWaves,
  poolWavesOf,
  waveCount,
} from '../../../shared/domain/pools/waves';
import type { CommandContext } from './context';
import { invoke } from '../api/engine';
import { competitionState } from './competitionState';
import { getCompetitionOrThrow } from './competitions';
import { EVENT, recordEvents } from './eventLog';
import { readSession } from './sessionView';
import { tableauRanking, writeSession } from './sport';
import { isWavesRound, tieBreakByVictoryOf } from '../../../shared/domain/formula/formulaV2';
import {
  resolveCompetitionSettings,
  usesModernRules,
} from '../../../shared/utils/customFormulaSettings';
import { withLegacyTeams } from '../../../shared/domain/rapieres/rapieresEntry';
import { DEFAULT_TEAM_LEVELS } from '../../../shared/domain/fencers/teamEntry';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;
const REFERENCE = join(__dirname, 'rapieresLegacyReference.json');

let db: DatabaseManager;
let ctx: CommandContext;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db, emitChange: () => {} };
});
afterEach(() => db.close());

// ── Adaptateur : lecture des faits par les briques de la formule (F4e) ────────────────────────
const adapter = {
  effectiveFacts(comp: import('../../../shared/types').Competition) {
    const eff = resolveCompetitionSettings(comp.weapon, comp.settings) as CompetitionSettings;
    return {
      poolRounds: eff.poolRounds,
      hasDirectElimination: eff.hasDirectElimination,
      poolWinnersOnly: !!eff.poolWinnersOnly,
      thirdPlaceMatch: eff.thirdPlaceMatch,
      poolMaxScore: eff.defaultPoolMaxScore,
      tableMaxScore: eff.defaultTableMaxScore,
      modernRules: usesModernRules(comp.weapon, comp.settings),
      wavesRound: isWavesRound(comp.settings, 1),
      victoryTieBreak: tieBreakByVictoryOf(comp.weapon, comp.settings),
    };
  },
  teamFacts(fencers: Fencer[], session: Record<string, unknown>) {
    const r = session.rapieres as { version?: number; teams?: Record<string, never> } | undefined;
    const ref = new Date('2026-12-06');
    const teams = withLegacyTeams(fencers, r?.version === 2 ? r.teams : undefined, ref);
    // Représentation du mode spécial : catégorie M20 / SENIOR / V1…, sexe M / F / MIXED, niveau en code
    const category = (c?: string) =>
      c === 'SEN' || c === 'SENIOR' ? 'SENIOR' : c?.startsWith('U') ? 'M20' : (c ?? null);
    const gender = (g?: string) => (g === Gender.MIXED ? 'MIXED' : (g ?? null));
    return Object.fromEntries(
      teams
        .filter(f => f.level !== undefined)
        .map(f => [
          f.lastName,
          {
            level: DEFAULT_TEAM_LEVELS[(f.level ?? 1) - 1],
            category: category(f.category),
            gender: gender(f.gender),
            club: f.club || null,
          },
        ])
    );
  },
};

const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;

// ── Épreuve enregistrée (réglages tels que l'écran les écrivait en mode spécial) ──────────────

const LEGACY_SETTINGS = {
  defaultPoolTimerSeconds: 180,
  defaultTableTimerSeconds: 180,
  poolRounds: 1,
  hasDirectElimination: true,
  manualRanking: false,
  defaultRanking: 9999,
  randomScore: false,
  defaultPoolMaxScore: 5,
  defaultTableMaxScore: 15,
  thirdPlaceMatch: true,
  minTeamSize: 3,
  teamReserveCount: 1,
  customFormula: { ...createDefaultCustomFormula(), ruleSet: 'modern' },
  specialMode: 'rapieres',
} as unknown as CompetitionSettings;

type Level = 'beginner' | 'intermediate' | 'expert';
// Huit équipes : nom, niveau, naissances des deux tireurs, sexes
const TEAMS: Array<{
  name: string;
  level: Level;
  births: [string, string];
  sexes: ['M' | 'F', 'M' | 'F'];
}> = [
  { name: 'EQ1', level: 'expert', births: ['1990-03-01', '1992-05-02'], sexes: ['M', 'M'] },
  { name: 'EQ2', level: 'expert', births: ['1975-03-01', '1981-05-02'], sexes: ['M', 'F'] },
  { name: 'EQ3', level: 'intermediate', births: ['1985-03-01', '1987-05-02'], sexes: ['F', 'F'] },
  { name: 'EQ4', level: 'intermediate', births: ['2008-03-01', '2009-05-02'], sexes: ['M', 'M'] },
  { name: 'EQ5', level: 'intermediate', births: ['1960-03-01', '1962-05-02'], sexes: ['M', 'F'] },
  { name: 'EQ6', level: 'beginner', births: ['1995-03-01', '1996-05-02'], sexes: ['F', 'F'] },
  { name: 'EQ7', level: 'beginner', births: ['1970-03-01', '1972-05-02'], sexes: ['M', 'M'] },
  { name: 'EQ8', level: 'beginner', births: ['1999-03-01', '2001-05-02'], sexes: ['M', 'F'] },
];

interface Variant {
  /** Format de l'état de session : v2 (composition par tireur) ou v1 (vue dédiée, migrée) */
  session: 'v1' | 'v2';
  /** Mode de tableau enregistré (clé `rapieres.tableauMode`) */
  mode?: 'normal' | 'third' | 'all' | 'semis';
  /** Formule v2 enregistrée à la création d'après un modèle (`percentage` hérité de la formule v1) */
  stored?: 'percentage' | 'pool_heads';
  /** Vagues lancées (ancienne clé `rapieres.launchedWave`) et arrêt */
  launchedWave: number;
  wavesEnded?: boolean;
  /** Équipe exclue après le tableau */
  excluded?: string;
}

const VARIANTS: Record<string, Variant> = {
  v2_no_mode: { session: 'v2', launchedWave: 2 },
  v2_normal: { session: 'v2', mode: 'normal', launchedWave: 3 },
  v2_third: { session: 'v2', mode: 'third', launchedWave: 3, wavesEnded: true },
  v2_all: { session: 'v2', mode: 'all', launchedWave: 3 },
  // Équipe retirée au milieu du classement : écartée des qualifiés, rangs renumérotés
  v2_normal_excluded: { session: 'v2', mode: 'normal', launchedWave: 3, excluded: 'EQ3' },
  v2_stored_percentage_excluded: {
    session: 'v2',
    stored: 'percentage',
    launchedWave: 3,
    excluded: 'EQ2',
  },
  v2_semis: { session: 'v2', mode: 'semis', launchedWave: 3, excluded: 'EQ8' },
  v2_stored_percentage: { session: 'v2', mode: 'semis', stored: 'percentage', launchedWave: 1 },
  v2_stored_pool_heads: { session: 'v2', mode: 'third', stored: 'pool_heads', launchedWave: 1 },
  v1: { session: 'v1', launchedWave: 0 },
};

/** Score déterministe d'un match de poule : le mieux classé à l'entrée gagne, écart variable */
const scoreOf = (a: number, b: number): [number, number] => {
  const gap = (a + b) % 3;
  return a < b ? [5, gap] : [gap, 5];
};

async function build(variant: Variant) {
  const settings: Record<string, unknown> = { ...LEGACY_SETTINGS };
  if (variant.stored) {
    const f = formulaFromCustom(settings.customFormula as never);
    settings.formula = {
      ...f,
      phases: f.phases.map(p =>
        p.kind === 'pool' && variant.stored === 'pool_heads'
          ? { ...p, qualification: { mode: 'pool_heads', count: 4 } }
          : p
      ),
    };
  }
  const comp = db.createCompetition({
    title: 'Rapières',
    date: new Date('2026-12-06'),
    weapon: Weapon.CUSTOM,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    settings: settings as never,
  });
  const ids: string[] = [];
  for (const [i, tm] of TEAMS.entries()) {
    const f = db.addFencer(comp.id, {
      lastName: tm.name,
      firstName: `A${i} / B${i}`,
      gender: Gender.MIXED,
      club: `Club${i % 3}`,
      ranking: i + 1,
      status: FencerStatus.CHECKED_IN,
    } as never);
    ids.push(f.id);
  }
  // Deux poules de quatre en vagues (composition de l'écran) ; poules tirées par le moteur
  const groups = [
    [ids[0], ids[2], ids[4], ids[6]],
    [ids[1], ids[3], ids[5], ids[7]],
  ];
  const composition = groups.map((g, p) => ({
    poolId: `${comp.id}-p${p + 1}`,
    number: p + 1,
    fencerIds: g,
    matches: [
      [0, 1],
      [2, 3],
      [0, 2],
      [1, 3],
      [0, 3],
      [1, 2],
    ].map(([a, b], m) => ({
      matchId: `${comp.id}-p${p + 1}-m${m}`,
      fencerAId: g[a],
      fencerBId: g[b],
    })),
  }));
  await call('generatePools', { competitionId: comp.id, composition });
  for (const pool of composition) {
    for (const m of pool.matches) {
      const a = ids.indexOf(m.fencerAId);
      const b = ids.indexOf(m.fencerBId);
      const [scoreA, scoreB] = scoreOf(a, b);
      await call('recordScore', { competitionId: comp.id, matchId: m.matchId, scoreA, scoreB });
    }
  }
  // Composition des équipes et vagues dans l'état de session, comme l'écran les écrivait
  const info = (i: number) => ({
    level: TEAMS[i].level,
    fencers: [0, 1].map(k => ({
      lastName: `${TEAMS[i].name}${k ? 'B' : 'A'}`,
      firstName: `P${k}`,
      category: 'SENIOR',
      gender: TEAMS[i].sexes[k],
      birthDate: TEAMS[i].births[k],
    })),
    club: `Club${i % 3}`,
  });
  const rapieres =
    variant.session === 'v2'
      ? {
          version: 2,
          teams: Object.fromEntries(ids.map((id, i) => [id, info(i)])),
          launchedWave: variant.launchedWave,
          wavesEnded: !!variant.wavesEnded,
          ...(variant.mode ? { tableauMode: variant.mode } : {}),
        }
      : {
          version: 1,
          teams: ids.map((id, i) => ({
            id,
            name: TEAMS[i].name,
            level: TEAMS[i].level,
            fencers: info(i).fencers,
            status: 'checked_in',
          })),
        };
  // Épreuve enregistrée avant F4a : jamais de clé `waves`, seulement l'ancienne clé `rapieres`
  const stored = { ...readSession(ctx, comp.id), rapieres };
  delete (stored as Record<string, unknown>).waves;
  db.saveSessionState(comp.id, stored);
  // Anciens événements des vagues (jamais réécrits : lus au rejeu)
  const waveEvents = Array.from({ length: variant.launchedWave }, (_, k) => ({
    type: EVENT.rapieresWaveLaunched,
    payload: { wave: k + 1, matchIds: [] as string[] },
  }));
  if (variant.wavesEnded) {
    waveEvents.push({
      type: EVENT.rapieresWavesEnded,
      payload: { ended: true } as never,
    } as never);
  }
  if (waveEvents.length > 0) recordEvents(ctx, comp.id, waveEvents as never);
  if (variant.session === 'v2') {
    recordEvents(ctx, comp.id, [
      { type: EVENT.rapieresTeamsUpdated, payload: { fencerIds: ids } },
    ] as never);
  }
  // Tableau tiré : résultats de sortie dans l'ordre des qualifiés, comme l'écran
  if (variant.session === 'v2') {
    const qualified = tableauRanking(
      getCompetitionOrThrow(ctx, comp.id),
      readSession(ctx, comp.id)
    );
    const finalResults = qualified.map((r, i) => ({
      fencer: r.fencer,
      rank: i + 1,
      eliminatedAt: i < 2 ? 'Finale' : 'Demi-finale',
    }));
    writeSession(ctx, comp.id, { finalResults });
  }
  if (variant.excluded) {
    const f = db.getFencersByCompetition(comp.id).find(x => x.lastName === variant.excluded)!;
    db.updateFencer(f.id, { status: FencerStatus.EXCLUDED } as never);
    // L'état de session garde des copies du tireur : le retrait y est écrit aussi (comme le moteur)
    const session = readSession(ctx, comp.id) as Record<string, any>;
    const mark = (x: { fencer?: { id: string; status?: string } }) => {
      if (x?.fencer?.id === f.id) x.fencer.status = FencerStatus.EXCLUDED;
    };
    (session.overallRanking ?? []).forEach(mark);
    (session.finalResults ?? []).forEach(mark);
    for (const pool of session.pools ?? []) {
      pool.fencers.forEach((x: { id: string; status?: string }) => {
        if (x.id === f.id) x.status = FencerStatus.EXCLUDED;
      });
      (pool.ranking ?? []).forEach(mark);
    }
    db.saveSessionState(comp.id, session);
  }
  return comp.id;
}

/** Ce que l'écran et le moteur montrent d'une épreuve enregistrée (adaptateur ci-dessus) */
function facts(competitionId: string) {
  const comp = getCompetitionOrThrow(ctx, competitionId);
  const session = readSession(ctx, competitionId);
  const fencers: Fencer[] = db.getFencersByCompetition(competitionId);
  const nameOf = new Map(fencers.map(f => [f.id, f.lastName]));
  const names = (rows: Array<{ fencer: { id: string } }>) => rows.map(r => nameOf.get(r.fencer.id));
  const pools = (session.pools ?? []) as import('../../../shared/types').Pool[];
  const state = competitionState(session, comp);
  const waves = poolWavesOf(session as never);

  const statuses = Object.fromEntries(fencers.map(f => [f.id, f.status as string]));
  const replay = compareWithState(
    projectCompetition(db.eventLog.getSince(competitionId)),
    stateView(session),
    statuses
  );
  const qualified = tableauRanking(comp, session);
  const overall = (session.overallRanking ?? []) as import('../../../shared/types').PoolRanking[];
  const final = finalRanking({
    finalResults: ((session.finalResults ?? []) as Array<{ fencer: Fencer; rank: number }>).map(
      r => ({ ...r, fencer: fencers.find(f => f.id === r.fencer.id) ?? r.fencer })
    ),
    poolRanking: overall.map(r => ({
      ...r,
      fencer: fencers.find(f => f.id === r.fencer.id) ?? r.fencer,
    })),
  });
  return {
    effective: adapter.effectiveFacts(comp),
    state: {
      currentPhase: state?.currentPhase,
      pools: state?.pools.map(p => ({ number: p.number, fencers: p.fencers.map(f => f.lastName) })),
      currentPoolRound: state?.currentPoolRound,
    },
    waves: {
      launched: waves.launched,
      ended: waves.ended,
      count: waveCount(pools),
      canLaunchNext: canLaunchNextWave(pools, waves.launched),
      perPool: pools.map(p =>
        [...poolMatchWaves(p)].map(([id, w]) => {
          const m = p.matches.find(x => x.id === id)!;
          return [m.fencerA?.lastName, m.fencerB?.lastName, w];
        })
      ),
    },
    ranking: names(overall),
    qualified: names(qualified).map((n, i) => [n, qualified[i].rank]),
    final: final.map(r => [r.fencer.lastName, r.rank]),
    teams: adapter.teamFacts(fencers, session),
    replay: replay.map(x => ({ kind: x.kind, id: x.id })),
  };
}

d('épreuve rapières enregistrée : relue comme avant le retrait du mode spécial (F4e)', () => {
  const reference: Record<string, unknown> = {};
  const update = process.env.UPDATE_RAPIERES_REFERENCE === '1';

  for (const [name, variant] of Object.entries(VARIANTS)) {
    it(name, async () => {
      const id = await build(variant);
      const got = JSON.parse(JSON.stringify(facts(id)));
      if (update) {
        reference[name] = got;
        writeFileSync(
          REFERENCE,
          JSON.stringify(
            { ...JSON.parse(readFileSync(REFERENCE, 'utf8')), ...reference },
            null,
            2
          ) + '\n'
        );
        return;
      }
      const expected = JSON.parse(readFileSync(REFERENCE, 'utf8'))[name];
      expect(got).toEqual(expected);
    });
  }
});
