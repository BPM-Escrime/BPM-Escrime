// @vitest-environment jsdom
/**
 * Épreuve par équipes à l'écran par le moteur (docs/adr/0024, lots E1, E3 et N) : l'écran
 * n'écrit rien lui-même, ni bloc de session ni équipes. Tout passe par le contrat :
 * inscription, composition, tirage des poules, relais (fin, réouverture), remplacement, tirage
 * explicite du tableau. L'onglet rouvert est celui du poste (posteUiState). Le journal rejoué ne
 * diverge pas des tables. Épreuve créée avant E1 (rencontres et bloc de l'écran, UUID) reprise
 * telle quelle. Moteur et base réels derrière le contrat (engineBridge).
 * Cartons et retrait d'une équipe (docs/adr/0028, lot C2) : lus dans le bloc « teams », écrits
 * par les commandes ; aucune lecture ni écriture de carton par le préload.
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
import {
  CardReason,
  Category,
  FencerStatus,
  Gender,
  Weapon,
  type Competition,
} from '../../shared/types';
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
/** Lectures de l'écran par le préload, par nom */
let reads: Record<string, unknown[][]>;

type Session = Record<string, any>;
const session = (id: string) => db.getSessionState(id) as Session | null;
const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;

/** Écritures du préload : plus aucune depuis l'écran (lots E3 et N) */
const TEAM_WRITES = [
  'saveSessionState',
  'saveSessionStateSync',
  'createTeam',
  'deleteTeam',
  'upsertTeamFencer',
  'removeTeamFencer',
  'createTeamMatch',
  'createTeamTableauMatch',
  'createTeamBout',
  'updateTeamBout',
  'createTeamMatchCard',
  'createTeamBoutCard',
];

/** Lectures des cartons par le préload : plus aucune depuis l'écran (docs/adr/0028, lot C2) */
const CARD_READS = ['getTeamBoutCards', 'getTeamMatchCards'];

/** Préload : contrat sur le moteur réel ; bloc de session sur la base */
function mockElectronAPI() {
  const direct = ['getFencersByCompetition', 'getSessionState', ...CARD_READS, ...TEAM_WRITES];
  const group = (): any =>
    new Proxy(
      {},
      {
        get: (_t, key) => {
          if (typeof key !== 'string' || key === 'then') return undefined;
          return (...args: any[]) => {
            ((/^get/.test(key) ? reads : writes)[key] ??= []).push(args);
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

function teamCompetition(weapon = Weapon.EPEE, settings: Record<string, unknown> = {}) {
  return db.createCompetition({
    title: 'Coupe par équipes',
    date: new Date('2026-12-06'),
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

const addFencer = (competitionId: string, lastName: string) =>
  db.addFencer(competitionId, {
    lastName,
    firstName: 'P',
    gender: Gender.MALE,
    status: FencerStatus.CHECKED_IN,
  }).id;

/** Onglet ouvert à la réouverture : préférence du poste (posteUiState, docs/adr/0017) */
const openAt = (competitionId: string, tab: string) =>
  localStorage.setItem(`bellepoule-ui-${competitionId}`, JSON.stringify({ tab }));

/** Bloc de session tel que l'écran d'avant le lot N l'écrivait (bases existantes) */
const oldScreenSession = (competitionId: string, phase: number, tab: string) =>
  db.saveSessionState(competitionId, {
    currentPhase: phase,
    pools: [],
    tableauMatches: [],
    uiState: { currentPhase: tab, currentPoolRound: 1, pools: 0 },
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

/** Journal rejoué comparé aux tables des équipes et aux statuts des tireurs */
function divergences(competitionId: string) {
  const comp = db.getCompetition(competitionId)!;
  const facts = projectCompetition(db.eventLog.getSince(competitionId));
  const statuses = Object.fromEntries(
    db.getFencersByCompetition(competitionId).map(f => [f.id, f.status as string])
  );
  return compareWithState(
    facts,
    { ...stateView({}, comp.settings), teams: teamStateView(ctx, comp) },
    statuses
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

d('épreuve par équipes à l’écran (docs/adr/0024, lots E1, E3 et N)', () => {
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
    reads = {};
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
    for (const name of CARD_READS) expect(reads[name], name).toBeUndefined();
  };

  it('épreuve neuve : état et bloc « teams » dès la création, sans écriture de l’écran', async () => {
    const comp = teamCompetition();
    // Le moteur rend l'état d'emblée (lot N : plus de bloc écrit par l'écran, plus de délai)
    const { state } = await call('getCompetitionState', { competitionId: comp.id });
    expect(state).toMatchObject({ currentPhase: 0, teams: { teams: [], poolMatches: [] } });
    const fencers = ['ALPHA1', 'ALPHA2', 'ALPHA3'].map(n => addFencer(comp.id, n));
    const { team } = await call('registerTeam', { competitionId: comp.id, name: 'Alpha' });
    for (const [k, fencerId] of fencers.entries()) {
      await call('assignTeamFencer', {
        competitionId: comp.id,
        teamId: team.id,
        fencerId,
        teamOrder: k + 1,
      });
    }
    // Phase déduite des tables : équipes inscrites
    expect((await call('getCompetitionState', { competitionId: comp.id })).state.currentPhase).toBe(
      10
    );

    // Premier affichage de l'onglet Équipes : l'équipe est lue d'emblée (plus de relecture
    // différée de 700 ms en attendant un bloc écrit par l'écran)
    openAt(comp.id, 'teams');
    renderView(comp);
    expect(await screen.findAllByText(/Alpha/)).not.toHaveLength(0);
    await new Promise(r => setTimeout(r, 650));
    expect(session(comp.id)).toBeNull();
    noTeamWrite();
  });

  it('épreuve d’avant E1 (rencontres de l’écran) : reprise telle quelle, rien réécrit ni tiré', async () => {
    const comp = teamCompetition();
    const matchId = composedByOldScreen(comp.id);
    oldScreenSession(comp.id, 11, 'teampool');
    const kept = session(comp.id);
    const before = db.getTeamMatchesByCompetition(comp.id);

    renderView(comp);
    expect(await screen.findAllByText(/Alpha/)).not.toHaveLength(0);
    expect(screen.getAllByText(/Bravo/).length).toBeGreaterThan(0);
    expect(await screen.findByText('5 – 2')).toBeInTheDocument();
    // Phase de l'ancien bloc reprise (onglet Poule) ; bloc laissé tel quel, aucun tirage
    // refait, aucun tableau créé à l'ouverture (lots E3 et N)
    await new Promise(r => setTimeout(r, 650));
    expect(session(comp.id)).toEqual(kept);
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
    openAt(comp.id, 'teams');
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
    openAt(comp.id, 'teampool');
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
    openAt(comp.id, 'teamtableau');
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

  // ── Cartons et retrait d'une équipe (docs/adr/0028, lot C2) ──────────────────

  /** Carton donné à l'écran au tireur visé : drapeau, motif, « Ajouter » du panneau */
  async function giveCardOnScreen(flagIndex: number, reason: CardReason) {
    fireEvent.click(screen.getAllByRole('button', { name: 'Ajouter un carton' })[flagIndex]);
    const select = await screen.findByRole('combobox', { name: '-- motif --' });
    fireEvent.change(select, { target: { value: reason } });
    fireEvent.click(within(select.parentElement!).getByRole('button', { name: 'Ajouter' }));
  }

  const types = (competitionId: string) => db.eventLog.getSince(competitionId).map(e => e.type);
  const boutCards = (matchId: string) => db.teams.getTeamBoutCards(matchId);
  const confirmOk = async () => fireEvent.click(await screen.findByRole('button', { name: 'OK' }));

  it('carton de relais : donné et annulé par le moteur, affiché après sa réponse, refus traduit', async () => {
    const comp = teamCompetition();
    await teamsByContract(comp.id, ['Alpha', 'Bravo']);
    await call('generateTeamPools', { competitionId: comp.id });
    const matchId = poolMatch(comp.id).id;
    openAt(comp.id, 'teampool');
    renderView(comp);
    fireEvent.click(await screen.findByRole('button', { name: 'Scorer' }));

    // Jaune (groupe 1, FIE) : type et points rendus par le moteur
    await giveCardOnScreen(0, CardReason.FIE_BODY_CONTACT);
    expect(await screen.findByText('Carton enregistré')).toBeInTheDocument();
    expect(boutCards(matchId)).toHaveLength(1);
    expect(boutCards(matchId)[0]).toMatchObject({
      boutId: relay(comp.id, 1).id,
      card: { type: 'YELLOW', fencerId: relay(comp.id, 1).fencerAId },
    });
    expect(
      await screen.findByRole('img', { name: 'Corps à corps pour éviter une touche' })
    ).toBeInTheDocument();
    // Second carton du même tireur sur la rencontre : rouge, une touche à l'adversaire (t.162.2)
    await giveCardOnScreen(0, CardReason.FIE_BODY_CONTACT);
    expect(
      await screen.findByRole('img', {
        name: "Corps à corps pour éviter une touche · 1 touche(s) à l'adversaire",
      })
    ).toBeInTheDocument();
    expect(boutCards(matchId).map(c => c.card.type)).toEqual(['YELLOW', 'RED']);

    // Annulation du rouge : Directoire technique, après confirmation
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Annuler ce carton (Directoire technique)' })[1]
    );
    await confirmOk();
    expect(await screen.findByText('Carton annulé')).toBeInTheDocument();
    expect(boutCards(matchId).map(c => c.card.type)).toEqual(['YELLOW']);
    expect(types(comp.id)).toEqual([
      'TeamPoolsGenerated',
      'TeamMatchScheduled',
      'RelayCardGiven',
      'RelayCardGiven',
      'RelayCardCancelled',
    ]);

    // Relais pas encore commencé : refus du moteur traduit, rien d'écrit
    const thirdFlag = screen.getAllByRole('button', { name: 'Ajouter un carton' })[4];
    fireEvent.click(thirdFlag);
    const select = await screen.findByRole('combobox', { name: '-- motif --' });
    fireEvent.change(select, { target: { value: CardReason.FIE_BODY_CONTACT } });
    fireEvent.click(within(select.parentElement!).getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByText(/^Relais hors ordre/)).toBeInTheDocument();
    expect(boutCards(matchId)).toHaveLength(1);
    noTeamWrite();
    expect(divergences(comp.id)).toEqual([]);

    // Carton retiré entre-temps sans signal (autre poste) : card_not_found traduit
    db.teams.deleteTeamBoutCard(boutCards(matchId)[0].card.id);
    fireEvent.click(
      screen.getByRole('button', { name: 'Annuler ce carton (Directoire technique)' })
    );
    await confirmOk();
    expect(await screen.findByText('Carton inconnu dans cette rencontre')).toBeInTheDocument();
  });

  it('noir individuel en FIE : tireur et équipe exclus (o.99.7.b), « Exclue », rencontres refusées', async () => {
    const comp = teamCompetition();
    await teamsByContract(comp.id, ['Alpha', 'Bravo', 'Charlie']);
    await call('generateTeamPools', { competitionId: comp.id });
    const [first] = db.getTeamMatchesByCompetition(comp.id);
    const excluded = first.teamAId;
    const excludedName = db.getTeamsByCompetition(comp.id).find(t => t.id === excluded)!.name;
    openAt(comp.id, 'teampool');
    renderView(comp);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Scorer' }))[0]);

    await giveCardOnScreen(0, CardReason.FIE_REFUSAL_TO_FENCE);
    expect(
      await screen.findByText(`${excludedName} est exclue de l’épreuve (carton noir)`)
    ).toBeInTheDocument();
    const log = db.eventLog.getSince(comp.id).slice(-4);
    expect(log.map(e => e.type)).toEqual([
      'RelayCardGiven',
      'FencerWithdrawn',
      'TeamMatchDecided',
      'TeamWithdrawn',
    ]);
    expect(new Set(log.map(e => e.commandId)).size).toBe(1);
    expect(log[3].payload).toMatchObject({ teamId: excluded, reason: 'exclusion' });

    // Équipe exclue affichée ; ses rencontres de poule annulées, les autres non saisissables
    expect((await screen.findAllByText('Exclue')).length).toBeGreaterThan(0);
    const involved = db
      .getTeamMatchesByCompetition(comp.id)
      .filter(m => m.teamAId === excluded || m.teamBId === excluded);
    expect(screen.getAllByText('Rencontre annulée : équipe retirée')).toHaveLength(involved.length);
    const scorers = screen.getAllByRole('button', { name: /Scorer|Fermer/ });
    expect(scorers.filter(b => (b as HTMLButtonElement).disabled)).toHaveLength(
      involved.filter(m => m.status !== 'finished').length
    );
    // Noir individuel : pas d'annulation par le carton (réintégration du tireur)
    expect(
      screen.queryAllByRole('button', { name: 'Annuler ce carton (Directoire technique)' })
    ).toEqual([]);
    noTeamWrite();
    expect(divergences(comp.id)).toEqual([]);
  });

  it('abandon sans remplaçant : withdrawTeam (o.99.7.a), « N’a pas terminé »', async () => {
    const comp = teamCompetition();
    await teamsByContract(comp.id, ['Alpha', 'Bravo', 'Charlie']);
    await call('generateTeamPools', { competitionId: comp.id });
    const [first] = db.getTeamMatchesByCompetition(comp.id);
    const name = db.getTeamsByCompetition(comp.id).find(t => t.id === first.teamAId)!.name;
    openAt(comp.id, 'teampool');
    renderView(comp);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Scorer' }))[0]);

    const withdraw = /Équipe incomplète sans remplaçant/;
    fireEvent.click(screen.getAllByRole('button', { name: withdraw })[0]);
    await confirmOk();
    expect(await screen.findByText(`${name} s’est retirée`)).toBeInTheDocument();
    expect(types(comp.id).slice(-2)).toEqual(['TeamMatchDecided', 'TeamWithdrawn']);
    expect(db.eventLog.getSince(comp.id).pop()!.payload).toMatchObject({
      teamId: first.teamAId,
      matchId: first.id,
      reason: 'abandon',
    });
    expect((await screen.findAllByText("N'a pas terminé")).length).toBe(
      db
        .getTeamMatchesByCompetition(comp.id)
        .filter(m => m.teamAId === first.teamAId || m.teamBId === first.teamAId).length
    );
    noTeamWrite();
    expect(divergences(comp.id)).toEqual([]);
  });

  it('carton E (arène Sabre Laser) : escalade du moteur, annulation', async () => {
    const comp = teamCompetition(Weapon.LASER, { teamFormat: 'laser-arena' });
    await teamsByContract(comp.id, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    await call('generateTeamPools', { competitionId: comp.id });
    const m = poolMatch(comp.id);
    const teamCards = () => db.teams.getTeamMatchCards(m.id).filter(c => c.teamId === m.teamAId);
    openAt(comp.id, 'teampool');
    renderView(comp);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Scorer' }))[0]);

    const escalate = /Carton E selon l’escalade|Carton E selon l'escalade/;
    fireEvent.click(screen.getAllByRole('button', { name: escalate })[0]);
    await waitFor(() => expect(teamCards().map(c => c.type)).toEqual(['white']));
    fireEvent.click(screen.getAllByRole('button', { name: escalate })[0]);
    await waitFor(() => expect(teamCards().map(c => c.type)).toEqual(['white', 'yellow']));
    expect(await screen.findAllByRole('img', { name: 'Carton yellow E' })).not.toHaveLength(0);

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Annuler ce carton (Directoire technique)' })[1]
    );
    await confirmOk();
    await waitFor(() => expect(teamCards().map(c => c.type)).toEqual(['white']));
    expect(types(comp.id).slice(-3)).toEqual([
      'TeamCardGiven',
      'TeamCardGiven',
      'TeamCardCancelled',
    ]);
    noTeamWrite();
    expect(divergences(comp.id)).toEqual([]);
  });
});
