// @vitest-environment jsdom
/**
 * Tableaux séparés après les poules à l'écran (docs/adr/0024, lot A2) : onglets lus dans
 * l'état du moteur, groupe affiché = préférence du poste. Deux groupes tirés et joués depuis
 * l'écran, changement d'onglet, rechargement : les deux tableaux sont là. Moteur et base
 * réels derrière le contrat (engineBridge).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
  configure,
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
import { listMatches } from '../../main/engine/commands/sport';
import { engineBridge } from '../testUtils/engineBridge';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;
// Moteur et base réels derrière l'écran : relectures plus lentes sous charge (suite complète)
configure({ asyncUtilTimeout: 8000 });

let db: DatabaseManager;
let ctx: CommandContext;
let bridge: ReturnType<typeof engineBridge>;

type Session = Record<string, any>;
const session = (id: string) => (db.getSessionState(id) ?? {}) as Session;
const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;

/** Épreuve mixte, tableaux séparés par sexe : poules communes tirées et jouées par le moteur */
async function poolsPlayed(): Promise<Competition> {
  const weapon = Weapon.EPEE;
  const comp = db.createCompetition({
    title: 'Coupe mixte',
    date: new Date('2026-12-06'),
    weapon,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    settings: {
      ...buildDefaultCompetitionSettings({ weapon, category: Category.SENIOR }),
      postPoolSplitCriteria: 'gender',
      thirdPlaceMatch: false,
    } as never,
  });
  for (let i = 0; i < 8; i++) {
    db.addFencer(comp.id, {
      lastName: `NOM${i}`,
      firstName: `P${i}`,
      gender: i % 2 === 0 ? Gender.FEMALE : Gender.MALE,
      club: ['Paris', 'Lyon', 'Nice', 'Lille'][i % 4],
      ranking: i + 1,
      status: FencerStatus.CHECKED_IN,
    });
  }
  await call('generatePools', { competitionId: comp.id, poolCount: 2 });
  for (const m of listMatches(ctx, comp.id, { state: 'ready' })) {
    await call('recordScore', { competitionId: comp.id, matchId: m.matchId, scoreA: 5, scoreB: 2 });
  }
  return db.getCompetition(comp.id)!;
}

/** Préload : contrat sur le moteur réel ; lectures directes de la base, le reste neutre */
function mockElectronAPI() {
  const reads: Record<string, (...args: any[]) => unknown> = {
    getFencersByCompetition: (id: string) => db.getFencersByCompetition(id),
    getSessionState: (id: string) => db.getSessionState(id),
    getPhasesByCompetition: () => [],
  };
  const group = (): any =>
    new Proxy(
      {},
      {
        get: (_t, key) => {
          if (typeof key !== 'string' || key === 'then') return undefined;
          return (...args: any[]) => {
            if (reads[key]) return Promise.resolve(reads[key](...args));
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

/** Matchs jouables du tableau affiché (cartes cliquables sans score) */
const playable = () =>
  screen
    .queryAllByRole('button', { name: /contre/ })
    .filter(
      el =>
        el.classList.contains('match-card') &&
        !/ : \d+-\d+$/.test(el.getAttribute('aria-label') ?? '')
    );

/** Score saisi à l'écran dans le premier match jouable du tableau affiché */
async function enterScore(): Promise<string> {
  const card = await waitFor(() => {
    const [first] = playable();
    expect(first).toBeTruthy();
    return first;
  });
  const label = card.getAttribute('aria-label')!;
  fireEvent.click(card);
  const dialog = await screen.findByRole('dialog');
  const inputs = dialog.querySelectorAll<HTMLInputElement>('input[type="number"]');
  fireEvent.change(inputs[0], { target: { value: '15' } });
  fireEvent.change(inputs[1], { target: { value: '4' } });
  fireEvent.click(within(dialog).getByText('Valider'));
  return label;
}

const groupTabs = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.split-group-tabs-1 button'));

d('tableaux séparés à l’écran (docs/adr/0024, lot A2)', () => {
  beforeEach(async () => {
    localStorage.clear();
    db = new DatabaseManager(':memory:');
    await db.open(':memory:');
    ctx = { db, emitChange: () => {} };
    bridge = engineBridge(ctx);
    mockElectronAPI();
  });

  afterEach(() => {
    cleanup();
    bridge.close();
    db.close();
    vi.restoreAllMocks();
  });

  it('deux groupes tirés et joués, changement d’onglet, rechargement : les deux tableaux restent', async () => {
    const comp = await poolsPlayed();
    const view = renderView(comp);
    await screen.findAllByText(/NOM0/);

    // Classement après poules → tableau des hommes, tiré par le moteur (groupe M)
    const steps = () => Array.from(document.querySelectorAll<HTMLElement>('.phase-step'));
    // État relu avant de quitter l'appel (étape Classement ouverte une fois l'épreuve chargée)
    const goMen = await waitFor(() => {
      fireEvent.click(steps()[3]);
      return screen.getByRole('button', { name: /Tableau ♂ Hommes/ });
    });
    fireEvent.click(goMen);
    await waitFor(() =>
      expect(session(comp.id).groupTableaux?.M?.tableauMatches.length).toBeGreaterThan(0)
    );
    expect(session(comp.id).tableauMatches ?? []).toEqual([]);

    await enterScore();
    await waitFor(() =>
      expect(
        session(comp.id).groupTableaux.M.tableauMatches.some((m: { winner?: unknown }) => m.winner)
      ).toBe(true)
    );
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: / : 15-4$| : 4-15$/ })).toHaveLength(1)
    );

    // Onglet des femmes : tableau du groupe F tiré à son tour, celui des hommes gardé
    await waitFor(() => expect(groupTabs()).toHaveLength(2));
    fireEvent.click(groupTabs()[0]);
    await waitFor(() =>
      expect(session(comp.id).groupTableaux?.F?.tableauMatches.length).toBeGreaterThan(0)
    );
    await enterScore();
    await waitFor(() =>
      expect(
        session(comp.id).groupTableaux.F.tableauMatches.some((m: { winner?: unknown }) => m.winner)
      ).toBe(true)
    );
    const s = session(comp.id);
    expect(
      s.groupTableaux.M.tableauMatches.filter(
        (m: { winner?: unknown; isBye?: boolean }) => m.winner && !m.isBye
      )
    ).toHaveLength(1);
    expect(
      s.groupTableaux.F.tableauMatches.every((m: { id: string }) => m.id.startsWith('F:'))
    ).toBe(true);
    expect(
      s.groupTableaux.M.tableauMatches.every((m: { id: string }) => m.id.startsWith('M:'))
    ).toBe(true);

    // Retour aux hommes : le score saisi est relu de l'état du moteur
    fireEvent.click(groupTabs()[1]);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: / : 15-4$| : 4-15$/ })).toHaveLength(1)
    );

    // Rechargement de l'écran : groupe affiché du poste (M), l'autre onglet garde son tableau
    view.unmount();
    renderView(db.getCompetition(comp.id)!);
    await waitFor(() => expect(groupTabs()).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: / : 15-4$| : 4-15$/ })).toHaveLength(1)
    );
    fireEvent.click(groupTabs()[0]);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: / : 15-4$| : 4-15$/ })).toHaveLength(1)
    );
    // Rien n'a été retiré ni retiré du journal : un tirage par groupe
    const generated = db.eventLog
      .getSince(comp.id)
      .filter(e => e.type === 'TableauGenerated')
      .map(e => (e.payload as { group?: string }).group);
    expect(generated.sort()).toEqual(['F', 'M']);
    expect(
      session(comp.id).groupTableaux.F.tableauMatches.some(
        (m: { winner?: unknown; isBye?: boolean }) => m.winner && !m.isBye
      )
    ).toBe(true);
  }, 60_000);

  it('groupe des femmes extrait en épreuve séparée par la commande (lot A3)', async () => {
    const comp = await poolsPlayed();
    const onOpenCompetition = vi.fn();
    const onUpdate = vi.fn();
    render(
      <TranslationProvider>
        <ToastProvider>
          <ConfirmProvider>
            <CompetitionView
              competition={comp}
              onUpdate={onUpdate}
              onOpenCompetition={onOpenCompetition}
            />
          </ConfirmProvider>
        </ToastProvider>
      </TranslationProvider>
    );
    await screen.findAllByText(/NOM0/);
    const steps = () => Array.from(document.querySelectorAll<HTMLElement>('.phase-step'));
    const create = await waitFor(() => {
      fireEvent.click(steps()[3]);
      return screen.getByRole('button', { name: /Créer la compétition ♀ Femmes/ });
    });
    fireEvent.click(create);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Créer la compétition$/ }));

    await waitFor(() => expect(onOpenCompetition).toHaveBeenCalledTimes(1));
    const targetId = onOpenCompetition.mock.calls[0][0] as string;
    // Écritures du moteur seulement : épreuve séparée, tireuses, classement, marque, journaux
    expect(db.getCompetition(comp.id)!.settings?.splitOffCompetitionIds).toEqual({ F: targetId });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ splitOffCompetitionIds: { F: targetId } }),
      })
    );
    const copies = db.getFencersByCompetition(targetId);
    expect(copies).toHaveLength(4);
    expect(copies.every(f => f.gender === Gender.FEMALE)).toBe(true);
    expect(session(targetId).overallRanking).toHaveLength(4);
    expect(db.eventLog.getSince(comp.id).some(e => e.type === 'GroupSplitOff')).toBe(true);
    expect(db.eventLog.getSince(targetId).map(e => e.type)).toEqual(['SplitRankingImported']);
  }, 60_000);
});
