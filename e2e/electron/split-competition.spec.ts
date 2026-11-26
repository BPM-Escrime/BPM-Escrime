import type { Page } from '@playwright/test';
import { test, expect, createCompetition } from './app';

/**
 * Scission en compétitions filles (#2013 E2b, docs/adr/0039) : formule poules → scission par
 * rang (« Tableau A » = 4 premiers, « Tableau B » = le reste), 8 tireurs, poules jouées, puis
 * à l'écran : Classement → « Scinder l'épreuve » → confirmation → deux compétitions filles,
 * résultats de l'origine avec le bloc « Branches », ouverture d'une fille.
 * Formule, tireurs et scores par le contrat ; tirage, scission et navigation à l'écran.
 */
const TITLE = 'E2E Scission';
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

test('scission par rang : deux compétitions filles, branches aux résultats', async ({ win }) => {
  test.setTimeout(180_000);
  await createCompetition(win, TITLE);
  const id = (await competitions(win)).find(c => c.title === TITLE)!.id;

  // Formule : poules puis scission ; « Tableau A » prend les 4 premiers, « Tableau B » le reste
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
          criterion: 'rank',
          branches: [
            { ...branches[0], take: { mode: 'fixed_count', count: 4 } },
            { ...branches[1] },
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
      club: `CLUB ${'ABCD'[i % 4]}`,
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

  // Classement : « Scinder l'épreuve » au lieu de « Voir les résultats »
  await expect(win.getByRole('button', { name: /voir les r[eé]sultats/i })).toHaveCount(0);
  await win.getByTestId('split-launch').click();
  const dialog = win.getByRole('dialog');
  await expect(dialog.getByTestId('split-launch-plan')).toBeVisible();
  const rows = dialog.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Tableau A');
  await expect(rows.nth(0)).toContainText('4');
  await expect(rows.nth(1)).toContainText('Tableau B');
  await expect(rows.nth(1)).toContainText('4');
  await expect(dialog.getByTestId('split-launch-missing')).toHaveCount(0);
  await shot(win, '1-confirmation');
  await dialog.getByTestId('split-launch-confirm').click();
  await expect(dialog).toBeHidden();

  // Deux compétitions filles, 4 tireurs chacune
  await expect
    .poll(async () => (await competitions(win)).filter(c => c.title.startsWith(`${TITLE} – `)))
    .toHaveLength(2);
  const all = await competitions(win);
  const childA = all.find(c => c.title === `${TITLE} – Tableau A`)!;
  const childB = all.find(c => c.title === `${TITLE} – Tableau B`)!;
  for (const child of [childA, childB]) {
    const list = await api<unknown[]>(win, 'listFencers', { competitionId: child.id });
    expect(list).toHaveLength(4);
  }

  // Résultats de l'origine : bloc « Branches », plus de scission proposée
  const block = win.getByTestId('split-branches');
  await expect(block).toBeVisible();
  await expect(block.getByRole('listitem')).toHaveCount(2);
  await expect(block.getByRole('listitem').nth(0)).toContainText('Tableau A');
  await expect(block.getByRole('listitem').nth(0)).toContainText('4');
  await shot(win, '2-resultats-origine');
  await win
    .getByRole('button', { name: /^classement/i })
    .first()
    .click();
  await expect(win.getByTestId('split-launch')).toHaveCount(0);
  await expect(win.getByRole('button', { name: /passer au tableau/i })).toHaveCount(0);
  await win
    .getByRole('button', { name: /voir les r[eé]sultats/i })
    .first()
    .click();

  // « Ouvrir » : la compétition fille « Tableau B » s'ouvre
  await win.getByTestId('split-branch-open-Tableau B').click();
  await expect(win.getByText(`${TITLE} – Tableau B`).first()).toBeVisible();
  const inB = await api<Array<{ lastName: string }>>(win, 'listFencers', {
    competitionId: childB.id,
  });
  await expect(win.getByText(inB[0].lastName, { exact: true }).first()).toBeVisible();
  await shot(win, '3-fille-ouverte');
});
