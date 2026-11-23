// @vitest-environment jsdom
/**
 * Épreuve par équipes à l'écran par le moteur (docs/adr/0024, lots E1 et E3) : l'écran écrit
 * encore son bloc de session (persistLocally, jusqu'au lot N), mais ses équipes passent par le
 * contrat seulement : inscription, composition, tirage des poules, relais (fin, réouverture),
 * remplacement, tirage explicite du tableau. Aucune écriture d'équipe par le préload ; le
 * journal rejoué ne diverge pas des tables. Épreuve créée avant E1 (rencontres de l'écran, UUID)
 * reprise telle quelle. Moteur et base réels derrière le contrat (engineBridge).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import {
  render,
  screen,
  waitFor,
  cleanup,
  configure,
  fireEvent,
  within,
} from '@testing-library/react';
import CompetitionView from './CompetitionView';
import { ToastProvider } from './Toast';
import { ConfirmProvider } from './ConfirmDialog';
import { TranslationProvider } from '../contexts/TranslationContext';
import { DatabaseManager } from '../../database';
import { hasNodeSqlite } from '../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon, type Competition } from '../../shared/types';
import { buildDefaultCompetitionSettings } from '../../shared/utils/defaultCompetitionSettings';
import type { CommandContext } from '../../main/engine/commands/context';
import { invoke } from '../../main/engine/api/engine';
import { publishCompetitionEvent } from '../../main/engine/api/events';
import { emitChangeVia } from '../../main/mcp/mcpDomain';
import { teamStateView } from '../../main/engine/commands/teams';
import { projectCompetition } from '../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../shared/domain/journal/compareWithState';
import { engineBridge } from '../testUtils/engineBridge';
import { insertLegacyTeamMatch, writeLegacyRelay } from '../../database/testing/legacyTeamWrites';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;
configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 30_000 });

let db: DatabaseManager;
let ctx: CommandContext;
let bridge: ReturnType<typeof engineBridge>;
/** Écritures de l'écran par le préload, par nom */
let writes: Record<string, unknown[][]>;

type Session = Record<string, any>;
const session = (id: string) => db.getSessionState(id) as Session | null;
const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;

/** Écritures d'équipe du préload : plus aucune depuis l'écran (lot E3) */
const TEAM_WRITES = [
  'createTeam',
  'deleteTeam',
  'upsertTeamFencer',
  'removeTeamFencer',
  'createTeamMatch',
  'createTeamTableauMatch',
  'createTeamBout',
  'updateTeamBout',
];

/** Préload : contrat sur le moteur réel ; bloc de session et lectures des cartons sur la base */
function mockElectronAPI() {
  const direct = [
    'getFencersByCompetition',
    'getSessionState',
    'saveSessionState',
    'getTeamBoutCards',
    'getTeamMatchCards',
    ...TEAM_WRITES,
  ];
  const group = (): any =>
    new Proxy(
      {},
      {
        get: (_t, key) => {
          if (typeof key !== 'string' || key === 'then') return undefined;
          return (...args: any[]) => {
            if (!/^get/.test(key)) (writes[key] ??= []).push(args);
            if (direct.includes(key)) {
              return Promise.resolve((db as any)[key](...args));
            }
            return Promise.resolve(/^(get|list)/.test(key) ? [] : undefined);
          };
        },
      }
    );
  const groups = ['db', 'file', 'dialog', 'updater', 'crypto', 'remote', 'training', 'themes'];
  (window as any).electronAPI = {
    ...Object.fromEntries(groups.map(g => [g, group()])),
    api: bridge,
    initialLanguage: null,
    removeAllListeners: () => {},
    ...Object.fromEntries(
      [
        'onMenuCompetitionProperties',
        'onMenuImport',
        'onMenuExport',
        'onFileOpened',
        'onMenuAddFencer',
      ].map(k => [k, () => () => {}])
    ),
  };
}

const renderView = (comp: Competition) =>
  render(
    <TranslationProvider>
      <ToastProvider>
        <ConfirmProvider>
          <CompetitionView competition={comp} onUpdate={vi.fn()} />
        </ConfirmProvider>
      </ToastProvider>
    </TranslationProvider>
  );

function teamCompetition(): Competition {
  return db.createCompetition({
    title: 'Coupe par équipes',
    date: new Date('2026-12-06'),
    weapon: Weapon.EPEE,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    isTeamEvent: true,
    settings: {
      ...buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
      minTeamSize: 3,
    } as never,
  });
}

const addFencer = (competitionId: string, lastName: string) =>
  db.addFencer(competitionId, {
    lastName,
    firstName: 'P',
    gender: Gender.MALE,
    status: FencerStatus.CHECKED_IN,
  }).id;

/** Onglet ouvert à la réouverture : bloc de session tel que l'écran l'écrit */
const openAt = (competitionId: string, phase: number, tab: string) =>
  db.saveSessionState(competitionId, {
    currentPhase: phase,
    uiState: { currentPhase: tab },
  } as never);

/** Équipes inscrites et composées par le contrat : 3 titulaires et un remplaçant */
async function teamsByContract(competitionId: string, names: string[]) {
  const ids: string[] = [];
  for (const name of names) {
    const { team } = await call('registerTeam', { competitionId, name });
    ids.push(team.id);
    for (let k = 1; k <= 4; k++) {
      await call('assignTeamFencer', {
        competitionId,
        teamId: team.id,
        fencerId: addFencer(competitionId, `${name.toUpperCase()}${k}`),
        teamOrder: k,
        isReserve: k === 4,
      });
    }
  }
  return ids;
}

/** Composition, poule et un relais joué, écrits comme l'écran d'avant E1 (préload, UUID) */
function composedByOldScreen(competitionId: string) {
  const teamIds = ['Alpha', 'Bravo'].map(name => {
    const { id } = db.createTeam(competitionId, name, name);
    for (let k = 1; k <= 3; k++) {
      db.upsertTeamFencer(id, addFencer(competitionId, `${name.toUpperCase()}${k}`), k, false);
    }
    return id;
  });
  const teams = db.getTeamsByCompetition(competitionId);
  const [a, b] = teams.map(t => t.fencers.map(f => f.fencerId));
  const { id: matchId, boutIds } = insertLegacyTeamMatch(db, {
    competitionId,
    teamAId: teamIds[0],
    teamBId: teamIds[1],
    relays: [0, 1, 2].map(k => [a[k], b[k]]),
    maxScore: 5,
  });
  writeLegacyRelay(db, matchId, boutIds[0], {
    scoreA: 5,
    scoreB: 2,
    status: 'finished',
    winnerId: a[0],
  });
  return matchId;
}

/** Journal rejoué comparé aux tables des équipes */
function divergences(competitionId: string) {
  const comp = db.getCompetition(competitionId)!;
  const facts = projectCompetition(db.eventLog.getSince(competitionId));
  return compareWithState(
    facts,
    { ...stateView({}, comp.settings), teams: teamStateView(ctx, comp) },
    {}
  );
}

const poolMatch = (competitionId: string) => db.getTeamMatchesByCompetition(competitionId)[0];
const relay = (competitionId: string, order: number) =>
  poolMatch(competitionId).bouts.find(b => b.boutOrder === order)!;

/** Bouton « + » du relais en cours (A : premier, B : second) */
const plus = (side: 'A' | 'B') =>
  screen
    .getAllByRole('button', { name: 'Ajouter' })
    .filter(b => !(b as HTMLButtonElement).disabled)[side === 'A' ? 0 : 1];

d('épreuve par équipes à l’écran (docs/adr/0024, lots E1 et E3)', () => {
  beforeEach(async () => {
    localStorage.clear();
    db = new DatabaseManager(':memory:');
    await db.open(':memory:');
    // Signaux du moteur publiés sur le bus des abonnements, comme le main
    ctx = {
      db,
      emitChange: emitChangeVia((type, competitionId) =>
        publishCompetitionEvent({ type, competitionId })
      ),
    };
    bridge = engineBridge(ctx);
    writes = {};
    mockElectronAPI();
  });

  afterEach(() => {
    cleanup();
    bridge.close();
    db.close();
    vi.restoreAllMocks();
  });

  const noTeamWrite = () => {
    for (const name of TEAM_WRITES) expect(writes[name], name).toBeUndefined();
  };

  it('épreuve neuve : pas d’état du moteur avant l’ouverture ; l’écran écrit son bloc', async () => {
    const comp = teamCompetition();
    expect((await call('getCompetitionState', { competitionId: comp.id })).state).toBeNull();
    renderView(comp);
    await waitFor(() => expect(session(comp.id)).not.toBeNull());
    expect(session(comp.id)!.currentPhase).toBe(0);
    // Bloc écrit, le moteur rend l'état et son bloc « teams » (vide)
    const { state } = await call('getCompetitionState', { competitionId: comp.id });
    expect(state.teams).toMatchObject({ teams: [], poolMatches: [] });
    noTeamWrite();
  });

  it('épreuve d’avant E1 (rencontres de l’écran) : reprise telle quelle, rien réécrit ni tiré', async () => {
    const comp = teamCompetition();
    const matchId = composedByOldScreen(comp.id);
    openAt(comp.id, 11, 'teampool');
    const before = db.getTeamMatchesByCompetition(comp.id);

    renderView(comp);
    expect(await screen.findAllByText(/Alpha/)).not.toHaveLength(0);
    expect(screen.getAllByText(/Bravo/).length).toBeGreaterThan(0);
    expect(await screen.findByText('5 – 2')).toBeInTheDocument();
    // Sauvegarde différée de l'écran passée : phase gardée, aucun tirage refait, aucun tableau
    // créé à l'ouverture (lot E3)
    await waitFor(() => expect(writes.saveSessionState?.length ?? 0).toBeGreaterThan(0));
    expect(session(comp.id)!.currentPhase).toBe(11);
    noTeamWrite();
    expect(db.getTeamMatchesByCompetition(comp.id)).toEqual(before);
    expect(db.getTeamTableauMatches(comp.id, comp.id)).toEqual([]);
    expect(before[0]).toMatchObject({ id: matchId, scoreBoutsA: 5, scoreBoutsB: 2 });

    // Relais suivant saisi à l'écran sur la rencontre d'avant E1 : par le moteur
    fireEvent.click(screen.getByRole('button', { name: 'Scorer' }));
    fireEvent.click(screen.getByRole('button', { name: /Terminer le relais/ }));
    await waitFor(() => expect(relay(comp.id, 2).status).toBe('finished'));
    noTeamWrite();
    expect(db.eventLog.getSince(comp.id).map(e => e.type)).toEqual(['RelayScoreRecorded']);
  });

  it('composition et poules depuis l’écran : inscription, affectation, tirage par le contrat', async () => {
    const comp = teamCompetition();
    const names = ['ALPHA1', 'ALPHA2', 'ALPHA3', 'BRAVO1', 'BRAVO2', 'BRAVO3'];
    const ids = Object.fromEntries(names.map(n => [n, addFencer(comp.id, n)]));
    openAt(comp.id, 10, 'teams');
    renderView(comp);

    const nameInput = await screen.findByPlaceholderText('Ex : équipe A');
    for (const team of ['Alpha', 'Bravo']) {
      fireEvent.change(nameInput, { target: { value: team } });
      fireEvent.click(screen.getByRole('button', { name: '+ Créer' }));
      expect(await screen.findAllByText(team)).not.toHaveLength(0);
    }
    expect(db.getTeamsByCompetition(comp.id).map(t => t.name)).toEqual(['Alpha', 'Bravo']);

    // Affectation : trois titulaires par équipe, ordre 1 à 3
    for (const [k, team] of ['Alpha', 'Bravo'].entries()) {
      fireEvent.click(screen.getAllByRole('button', { name: 'Gérer' })[k]);
      for (let order = 1; order <= 3; order++) {
        const [fencerSelect, orderSelect] = screen.getAllByRole('combobox');
        fireEvent.change(fencerSelect, { target: { value: ids[`${team.toUpperCase()}${order}`] } });
        fireEvent.change(orderSelect, { target: { value: String(order) } });
        fireEvent.click(screen.getByRole('button', { name: 'Affecter' }));
        await waitFor(() =>
          expect(
            db.getTeamsByCompetition(comp.id).find(t => t.name === team)!.fencers
          ).toHaveLength(order)
        );
      }
      fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    }

    // Retrait annulable : par la commande, remis par la commande
    fireEvent.click(screen.getAllByRole('button', { name: 'Gérer' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Retirer' })[0]);
    await waitFor(() => expect(db.getTeamsByCompetition(comp.id)[0].fencers).toHaveLength(2));
    fireEvent.click(await screen.findByRole('button', { name: /annuler/i }));
    await waitFor(() => expect(db.getTeamsByCompetition(comp.id)[0].fencers).toHaveLength(3));

    fireEvent.click(screen.getByRole('button', { name: 'Générer la poule' }));
    // Rencontre tirée par le moteur, onglet Poule ouvert
    expect(await screen.findByRole('button', { name: 'Scorer' })).toBeInTheDocument();
    expect(db.getTeamMatchesByCompetition(comp.id)).toHaveLength(1);
    expect(db.eventLog.getSince(comp.id).map(e => e.type)).toEqual([
      'TeamPoolsGenerated',
      'TeamMatchScheduled',
    ]);
    noTeamWrite();
    expect(divergences(comp.id)).toEqual([]);
  });

  it('relais à l’écran : touches comptées localement, fin, réouverture, remplacement, refus traduit', async () => {
    const comp = teamCompetition();
    const [alpha] = await teamsByContract(comp.id, ['Alpha', 'Bravo']);
    await call('generateTeamPools', { competitionId: comp.id });
    openAt(comp.id, 11, 'teampool');
    renderView(comp);
    fireEvent.click(await screen.findByRole('button', { name: 'Scorer' }));

    // Touches : état de l'écran, rien d'écrit avant la fin du relais
    fireEvent.click(plus('A'));
    fireEvent.click(plus('B'));
    expect(await screen.findByText('Terminer le relais', { exact: false })).toBeInTheDocument();
    expect(relay(comp.id, 1)).toMatchObject({ scoreA: 0, scoreB: 0, status: 'not_started' });
    // Palier atteint (5) : fin du relais envoyée au moteur
    for (let k = 0; k < 4; k++) fireEvent.click(plus('A'));
    await waitFor(() =>
      expect(relay(comp.id, 1)).toMatchObject({ scoreA: 5, scoreB: 1, status: 'finished' })
    );

    // Réouverture : score repris, corrigé, relais terminé à la main
    fireEvent.click(screen.getByRole('button', { name: 'Rouvrir ce relais pour le corriger' }));
    await waitFor(() => expect(relay(comp.id, 1).status).toBe('in_progress'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Retirer une touche' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Terminer le relais/ }));
    await waitFor(() =>
      expect(relay(comp.id, 1)).toMatchObject({ scoreA: 4, scoreB: 1, status: 'finished' })
    );

    // Remplacement : le remplaçant d'Alpha prend la place d'ALPHA2 dans ses relais à tirer
    const reserve = db.getTeamsByCompetition(comp.id)[0].fencers.find(f => f.isReserve)!;
    const out = poolMatch(comp.id).bouts.find(b => b.status !== 'finished')!.fencerAId;
    const picker = screen.getByRole('combobox', { name: /sortant \(Alpha\)/ });
    fireEvent.change(picker, { target: { value: out } });
    fireEvent.click(within(picker.parentElement!).getByRole('button'));
    await waitFor(() =>
      expect(
        poolMatch(comp.id).bouts.filter(b => b.status !== 'finished' && b.fencerAId === out)
      ).toEqual([])
    );
    expect(poolMatch(comp.id).bouts.some(b => b.fencerAId === reserve.fencerId)).toBe(true);

    // Second remplacement refusé : code du catalogue traduit dans un toast
    fireEvent.change(picker, { target: { value: reserve.fencerId } });
    fireEvent.click(within(picker.parentElement!).getByRole('button'));
    expect(await screen.findByText('Remplaçant déjà entré dans la rencontre')).toBeInTheDocument();

    // Relais suivants joués ailleurs (tablette, MCP) : l'écran suit le moteur
    for (let order = 2; order <= 9; order++) {
      await call('recordRelayScore', {
        competitionId: comp.id,
        matchId: poolMatch(comp.id).id,
        relay: order,
        scoreA: 1,
        scoreB: 0,
      });
    }
    expect(await screen.findByText('Alpha gagne')).toBeInTheDocument();
    expect(poolMatch(comp.id)).toMatchObject({ status: 'finished', winnerId: alpha });
    noTeamWrite();
    expect(divergences(comp.id)).toEqual([]);
  });

  it('tableau : rien à l’ouverture, tiré par le bouton ; égalité au dernier relais tranchée', async () => {
    const comp = teamCompetition();
    const [alpha] = await teamsByContract(comp.id, ['Alpha', 'Bravo']);
    await call('generateTeamPools', { competitionId: comp.id });
    const pool = poolMatch(comp.id);
    for (let order = 1; order <= 9; order++) {
      await call('recordRelayScore', {
        competitionId: comp.id,
        matchId: pool.id,
        relay: order,
        scoreA: 1,
        scoreB: 0,
      });
    }
    openAt(comp.id, 12, 'teamtableau');
    renderView(comp);

    // Ouverture : aucun tableau créé
    const draw = await screen.findByRole('button', { name: 'Générer le tableau (2 équipes)' });
    expect(db.getTeamTableauMatches(comp.id, comp.id)).toEqual([]);
    fireEvent.click(draw);
    expect(await screen.findByRole('button', { name: 'Scorer' })).toBeInTheDocument();
    const final = db.getTeamTableauMatches(comp.id, comp.id);
    expect(final).toHaveLength(1);
    expect(final[0].id).toBe(`${comp.id}-t1-0`);

    // Huit relais nuls joués ailleurs, le dernier terminé à l'écran à égalité
    for (let order = 1; order <= 8; order++) {
      await call('recordRelayScore', {
        competitionId: comp.id,
        matchId: final[0].id,
        relay: order,
        scoreA: 0,
        scoreB: 0,
      });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Scorer' }));
    // Relais joués ailleurs relus (signal du moteur) : le neuvième est en cours
    await waitFor(() =>
      expect(screen.getByText(/· A9$/).parentElement).toHaveTextContent(/Terminer/)
    );
    fireEvent.click(screen.getByRole('button', { name: /Terminer le relais/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Vainqueur : Alpha' }));
    await waitFor(() =>
      expect(db.getTeamTableauMatches(comp.id, comp.id)[0]).toMatchObject({
        status: 'finished',
        winnerId: alpha,
      })
    );
    noTeamWrite();
    expect(divergences(comp.id)).toEqual([]);
  });
});
