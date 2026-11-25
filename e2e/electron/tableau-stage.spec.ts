import type { Page } from '@playwright/test';
import { test, expect, createCompetition } from './app';

/**
 * Tableau arrêté à N tireurs (#2013 D2b, docs/adr/0037) : poules, tableau de 8 arrêté à 4,
 * clôture par le bandeau, poule finale des 4 restants, classement final (Q5).
 * Formule, tireurs et scores par le contrat ; tirages, clôture et navigation à l'écran.
 */
const TITLE = 'E2E Tableau arrêté';
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

async function competitionId(win: Page): Promise<string> {
  const comps = await api<Array<{ id: string; title: string }>>(win, 'listCompetitions', {});
  return comps.find(c => c.title === TITLE)!.id;
}

/** Scores de tous les matchs de poule non joués : le premier nommé gagne 5-2 */
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

test('tableau arrêté à 4 : poule finale des restants et classement final', async ({ win }) => {
  test.setTimeout(180_000);
  await createCompetition(win, TITLE);
  const id = await competitionId(win);
  await api(win, 'updateCompetitionFormula', {
    competitionId: id,
    operations: [
      { op: 'setPhase', phase: 'tableau', settings: { stopAt: 4 } },
      { op: 'insertPhase', brick: 'pool', at: 2 },
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

  // Tour 1 : 2 poules de 4
  await win.getByRole('button', { name: /pr[eé]parer les poules/i }).click();
  await win.getByRole('button', { name: /lancer les poules/i }).click();
  await expect(win.getByLabel(/contre .*, saisir le score/).first()).toBeVisible();
  await playPools(win, id);
  await win
    .getByRole('button', { name: /^classement/i })
    .first()
    .click();
  await shot(win, '1-classement-tour1');

  // Tableau de 8 arrêté à 4 : bandeau, bouton inactif tant que les quarts ne sont pas joués
  await win
    .getByRole('button', { name: /passer au tableau/i })
    .first()
    .click();
  const banner = win.getByTestId('tableau-stage');
  await expect(banner).toContainText('Tableau arrêté à 4 tireurs');
  await expect(win.getByTestId('tableau-stage-close')).toBeDisabled();
  await shot(win, '2-tableau-arrete');

  const { state } = await api<{
    state: { tableauMatches: Array<{ id: string; round: number; isBye: boolean }> };
  }>(win, 'getCompetitionState', { competitionId: id });
  for (const m of state.tableauMatches.filter(x => x.round === 8 && !x.isBye)) {
    await api(win, 'recordScore', { competitionId: id, matchId: m.id, scoreA: 15, scoreB: 7 });
  }
  await expect(win.getByTestId('tableau-stage-close')).toBeEnabled();
  await shot(win, '3-quarts-joues');

  // Clôture : simulation, confirmation, appel des 4 restants
  await win.getByTestId('tableau-stage-close').click();
  const confirm = win.getByRole('dialog');
  await expect(confirm).toContainText('4 tireurs passent à la phase suivante, 4 sont éliminés');
  await confirm.getByRole('button').last().click();
  await expect(win.getByText(/Appel – Tour 2/)).toBeVisible();
  // Éliminés du tableau sortis de l'appel : 4 pointés sur 8
  await expect(win.getByText('4 pointés', { exact: false })).toBeVisible();
  await shot(win, '4-appel-restants');
  // Plus d'onglet tableau : la suite est la poule des restants
  await expect(win.locator('.phase-step', { hasText: 'Tableau' })).toHaveCount(0);

  // Tour 2 : poule finale des 4 restants
  await win.getByRole('button', { name: /pr[eé]parer les poules/i }).click();
  await win.getByRole('button', { name: /lancer les poules/i }).click();
  await expect(win.getByLabel(/contre .*, saisir le score/)).toHaveCount(12);
  await shot(win, '5-poule-finale');
  await playPools(win, id);
  await win
    .getByRole('button', { name: /^classement/i })
    .first()
    .click();
  await win
    .getByRole('button', { name: /voir les r[eé]sultats/i })
    .first()
    .click();
  await shot(win, '6-resultats');

  // Classement final : 4 restants, puis 4 éliminés « Tableau de 8 »
  const rows = win.locator('table tbody tr');
  await expect(rows).toHaveCount(8);
  for (let i = 4; i < 8; i++) await expect(rows.nth(i)).toContainText('Tableau de 8');
  for (let i = 0; i < 4; i++) await expect(rows.nth(i)).not.toContainText('Tableau de');

  const events = await api<{ events: Array<{ type: string }> }>(win, 'getCompetitionEvents', {
    competitionId: id,
    since: 0,
  });
  expect(events.events.map(e => e.type)).toContain('TableauStageClosed');
});
