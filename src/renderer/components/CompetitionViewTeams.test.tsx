// @vitest-environment jsdom
/**
 * Épreuve par équipes à l'écran pendant le passage au moteur (docs/adr/0024, lot E1) :
 * l'écran écrit encore son bloc (persistLocally) et ses équipes par le préload. Ouverture d'une
 * épreuve neuve, puis rechargement après composition, poule et score saisis par l'écran :
 * l'écran retrouve tout, sans réécrire la phase, sans nouveau tirage. Moteur et base réels
 * derrière le contrat (engineBridge).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, configure } from '@testing-library/react';
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
import { engineBridge } from '../testUtils/engineBridge';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;
configure({ asyncUtilTimeout: 8000 });

let db: DatabaseManager;
let ctx: CommandContext;
let bridge: ReturnType<typeof engineBridge>;
/** Écritures de l'écran par le préload, par nom */
let writes: Record<string, unknown[][]>;

type Session = Record<string, any>;
const session = (id: string) => db.getSessionState(id) as Session | null;
const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;

/** Préload : contrat sur le moteur réel ; équipes et bloc de session sur la base, comme dev */
function mockElectronAPI() {
  const direct = [
    'getFencersByCompetition',
    'getSessionState',
    'saveSessionState',
    'getTeamsByCompetition',
    'getTeamMatchesByCompetition',
    'getTeamTableauMatches',
    'getTeamBoutCards',
    'getTeamMatchCards',
    'createTeam',
    'upsertTeamFencer',
    'createTeamMatch',
    'createTeamTableauMatch',
    'createTeamBout',
    'updateTeamBout',
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

/** Composition, poule et un relais joué, écrits comme l'écran actuel (préload) */
function composedByScreen(competitionId: string) {
  const teamIds = ['Alpha', 'Bravo'].map(name => {
    const { id } = db.createTeam(competitionId, name, name);
    for (let k = 1; k <= 3; k++) {
      const f = db.addFencer(competitionId, {
        lastName: `${name.toUpperCase()}${k}`,
        firstName: 'P',
        gender: Gender.MALE,
        status: FencerStatus.CHECKED_IN,
      });
      db.upsertTeamFencer(id, f.id, k, false);
    }
    return id;
  });
  const teams = db.getTeamsByCompetition(competitionId);
  const { id: matchId } = db.createTeamMatch(competitionId, 1, teamIds[0], teamIds[1]);
  const [a, b] = teams.map(t => t.fencers.map(f => f.fencerId));
  for (let k = 0; k < 3; k++) db.createTeamBout(matchId, k + 1, a[k], b[k], 5);
  const first = db.getTeamMatchesByCompetition(competitionId)[0].bouts[0];
  db.updateTeamBout(first.id, 5, 2, 'finished', first.fencerAId);
  return matchId;
}

d('épreuve par équipes à l’écran (docs/adr/0024, lot E1)', () => {
  beforeEach(async () => {
    localStorage.clear();
    db = new DatabaseManager(':memory:');
    await db.open(':memory:');
    ctx = { db, emitChange: () => {} };
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

  it('épreuve neuve : pas d’état du moteur avant l’ouverture ; l’écran écrit son bloc', async () => {
    const comp = teamCompetition();
    expect((await call('getCompetitionState', { competitionId: comp.id })).state).toBeNull();
    renderView(comp);
    await waitFor(() => expect(session(comp.id)).not.toBeNull());
    expect(session(comp.id)!.currentPhase).toBe(0);
    // Bloc écrit, le moteur rend l'état et son bloc « teams » (vide)
    const { state } = await call('getCompetitionState', { competitionId: comp.id });
    expect(state.teams).toMatchObject({ teams: [], poolMatches: [] });
    expect(writes.createTeamMatch).toBeUndefined();
  });

  it('rechargement après composition et poule de l’écran : tout est retrouvé, rien n’est réécrit', async () => {
    const comp = teamCompetition();
    const matchId = composedByScreen(comp.id);
    // Bloc tel que l'écran l'a écrit, onglet Poule des équipes (11)
    db.saveSessionState(comp.id, {
      currentPhase: 11,
      uiState: { currentPhase: 'teampool' },
    } as never);
    const before = db.getTeamMatchesByCompetition(comp.id);

    renderView(comp);
    expect(await screen.findAllByText(/Alpha/)).not.toHaveLength(0);
    expect(screen.getAllByText(/Bravo/).length).toBeGreaterThan(0);
    // Sauvegarde différée de l'écran passée : phase gardée, aucun tirage de poule refait (le
    // tableau d'équipes que l'écran crée de lui-même, comme sur dev, n'est pas en cause)
    await waitFor(() => expect(writes.saveSessionState?.length ?? 0).toBeGreaterThan(0));
    expect(session(comp.id)!.currentPhase).toBe(11);
    expect(writes.createTeamMatch).toBeUndefined();
    expect((writes.createTeamBout ?? []).filter(([id]) => id === matchId)).toEqual([]);
    expect(writes.updateTeamBout).toBeUndefined();
    expect(db.getTeamMatchesByCompetition(comp.id)).toEqual(before);
    expect(before[0]).toMatchObject({ id: matchId, scoreBoutsA: 5, scoreBoutsB: 2 });

    // L'état du moteur porte les mêmes équipes, rencontres et scores
    const { state } = await call('getCompetitionState', { competitionId: comp.id });
    expect(state.currentPhase).toBe(11);
    expect(state.teams.teams.map((t: { name: string }) => t.name)).toEqual(['Alpha', 'Bravo']);
    expect(state.teams.poolMatches).toEqual([
      expect.objectContaining({ id: matchId, scoreBoutsA: 5, scoreBoutsB: 2 }),
    ]);
  });
});
