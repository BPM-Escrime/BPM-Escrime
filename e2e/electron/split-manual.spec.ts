import type { Page } from '@playwright/test';
import { test, expect, createCompetition } from './app';

/**
 * Scission manuelle (#2013 E3, docs/adr/0039) : formule poules → scission manuelle (« N1 »,
 * « N2 »), 8 tireurs, poules jouées, puis à l'écran : Classement → « Scinder l'épreuve » →
 * classement d'entrée avec une branche par tireur ; confirmation bloquée tant qu'un tireur
 * n'est pas affecté ; « Tout dans… » N2, trois tireurs en N1, tri par club ; confirmation →
 * deux compétitions filles (3 et 5 tireurs), branches aux résultats de l'origine.
 * Formule, tireurs et scores par le contrat ; tirage, affectation et scission à l'écran.
 */
const TITLE = 'E2E Scission manuelle';
const SHOTS = process.env.E2E_SHOTS;

type Envelope = { ok: boolean; data?: unknown; error?: { message: string } };

async function shot(win: Page, name: string): Promise<void> {
  if (SHOTS) await win.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** Appel du contrat depuis la fenêtre ; erreur levée avec le message du moteur */
async function api<T = Record<string, unknown>>(
  win: Page,
  name: string,
  input: Record<string, unknown>
): Promise<T> {
  const env = (await win.evaluate(([n, i]) => window.electronAPI.api.invoke(n, i), [
    name,
    input,
  ] as const)) as Envelope;
  if (!env.ok) throw new Error(`${name} : ${env.error?.message}`);
  return env.data as T;
}

type Comp = { id: string; title: string };

async function competitions(win: Page): Promise<Comp[]> {
  return api<Comp[]>(win, 'listCompetitions', {});
}

/** Scores de tous les matchs de poule : le premier nommé gagne 5-2 */
async function playPools(win: Page, id: string): Promise<void> {
  const { state } = await api<{ state: { pools: Array<{ matches: Array<{ id: string }> }> } }>(
    win,
    'getCompetitionState',
    { competitionId: id }
  );
  for (const m of state.pools.flatMap(p => p.matches)) {
    await api(win, 'recordScore', { competitionId: id, matchId: m.id, scoreA: 5, scoreB: 2 });
  }
}

test('scission manuelle : affectation tireur par tireur, deux compétitions filles', async ({
  win,
}) => {
  test.setTimeout(180_000);
  await createCompetition(win, TITLE);
  const id = (await competitions(win)).find(c => c.title === TITLE)!.id;

  // Formule : poules puis scission manuelle « N1 », « N2 »
  await api(win, 'updateCompetitionFormula', {
    competitionId: id,
    operations: [
      { op: 'removePhase', phase: 'tableau' },
      { op: 'insertPhase', brick: 'split', at: 1 },
    ],
  });
  const { formula } = await api<{
    formula: { phases: Array<{ kind: string; branches?: Array<Record<string, unknown>> }> };
  }>(win, 'getCompetitionFormula', { competitionId: id });
  const branches = formula.phases.find(p => p.kind === 'split')!.branches!;
  await api(win, 'updateCompetitionFormula', {
    competitionId: id,
    operations: [
      {
        op: 'setPhase',
        phase: 'split',
        settings: {
          criterion: 'manual',
          branches: [
            { label: 'N1', phases: branches[0].phases },
            { label: 'N2', phases: branches[1].phases },
          ],
        },
      },
    ],
  });
  await api(win, 'registerFencers', {
    competitionId: id,
    fencers: Array.from({ length: 8 }, (_, i) => ({
      lastName: `TIREUR${i + 1}`,
      firstName: `P${i + 1}`,
      club: `CLUB ${'DCBA'[i % 4]}`,
      ranking: i + 1,
      status: 'P',
    })),
  });
  await win.getByRole('button', { name: /revenir à la liste des comp/i }).click();
  await win.locator('.competition-card', { hasText: TITLE }).click();

  // Poules : tirées à l'écran, jouées par le contrat
  await win.getByRole('button', { name: /pr[eé]parer les poules/i }).click();
  await win.getByRole('button', { name: /lancer les poules/i }).click();
  await expect(win.getByLabel(/contre .*, saisir le score/).first()).toBeVisible();
  await playPools(win, id);
  await win
    .getByRole('button', { name: /^classement/i })
    .first()
    .click();

  // Fenêtre de lancement : classement d'entrée, une branche par tireur
  await win.getByTestId('split-launch').click();
  const dialog = win.getByRole('dialog');
  const entrants = dialog.getByTestId('split-launch-entrants');
  await expect(entrants.locator('tbody tr')).toHaveCount(8);
  await expect(dialog.getByTestId('split-launch-missing')).toBeVisible();
  await expect(dialog.getByTestId('split-launch-confirm')).toBeDisabled();
  await shot(win, '1-repartition-vide');

  // « Tout dans… » N2, puis les trois premiers du classement en N1
  await dialog.getByTestId('split-launch-all-branch').selectOption('N2');
  await dialog.getByTestId('split-launch-all').click();
  const selects = entrants.locator('select');
  for (let i = 0; i < 3; i++) await selects.nth(i).selectOption('N1');
  await expect(dialog.getByTestId('split-launch-missing')).toHaveCount(0);
  const counts = dialog.getByTestId('split-launch-plan').locator('> table tbody tr');
  await expect(counts.nth(0)).toContainText('N1');
  await expect(counts.nth(0)).toContainText('3');
  await expect(counts.nth(1)).toContainText('5');

  // Tri par club : les affectations suivent les tireurs
  await dialog.getByTestId('split-launch-sort').selectOption('club');
  await expect(entrants.locator('tbody tr').first()).toContainText('CLUB A');
  await expect(counts.nth(0)).toContainText('3');
  await shot(win, '2-repartition-faite');
  await expect(dialog.getByTestId('split-launch-confirm')).toBeEnabled();
  await dialog.getByTestId('split-launch-confirm').click();
  await expect(dialog).toBeHidden();

  // Deux compétitions filles : 3 et 5 tireurs
  await expect
    .poll(async () => (await competitions(win)).filter(c => c.title.startsWith(`${TITLE} – `)))
    .toHaveLength(2);
  const all = await competitions(win);
  const n1 = all.find(c => c.title === `${TITLE} – N1`)!;
  const n2 = all.find(c => c.title === `${TITLE} – N2`)!;
  expect(await api<unknown[]>(win, 'listFencers', { competitionId: n1.id })).toHaveLength(3);
  expect(await api<unknown[]>(win, 'listFencers', { competitionId: n2.id })).toHaveLength(5);

  // Résultats de l'origine : bloc « Branches »
  const block = win.getByTestId('split-branches');
  await expect(block).toBeVisible();
  await expect(block.getByRole('listitem')).toHaveCount(2);
  await expect(block.getByRole('listitem').nth(0)).toContainText('N1');
  await shot(win, '3-resultats-origine');
});
