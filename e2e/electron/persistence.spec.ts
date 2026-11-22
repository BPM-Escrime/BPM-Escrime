import { test, expect, createCompetition, addFencers } from './app';

/**
 * Étape 4c de l'ADR-0017 : l'écran n'écrit plus l'état de l'épreuve, le moteur seul. Après
 * rechargement de la fenêtre, poules lancées et score saisi sont relus depuis l'état du moteur.
 */
test('poules lancées et score saisi retrouvés après rechargement de la fenêtre', async ({
  win,
}) => {
  await createCompetition(win, 'E2E Persistance');
  await addFencers(win, 5);
  await win.getByRole('button', { name: /tout pointer/i }).click();
  await win.getByRole('button', { name: /pr[eé]parer les poules/i }).click();
  await win.getByRole('button', { name: /lancer les poules/i }).click();
  const toPlay = win.getByLabel(/contre .*, saisir le score/);
  await expect(toPlay).toHaveCount(20);

  const cell = toPlay.first();
  const match = (await cell.getAttribute('aria-label'))!.split(',')[0];
  await cell.click();
  const [a, b] = await win.getByRole('spinbutton').all();
  await a.fill('5');
  await b.fill('2');
  await win.getByRole('button', { name: /^valider$/i }).click();
  await expect(win.getByLabel(`${match} : victoire 5`)).toBeVisible();

  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  // Onglet de l'épreuve rouvert, sinon ouverture depuis l'accueil
  const opened = win.getByLabel(`${match} : victoire 5`);
  if (!(await opened.isVisible().catch(() => false))) {
    await win.getByText('E2E Persistance').first().click();
    await win
      .getByRole('button', { name: /^poules/i })
      .first()
      .click();
  }
  await expect(win.getByLabel(`${match} : victoire 5`)).toBeVisible();
  await expect(win.getByLabel(/contre .*, saisir le score/)).toHaveCount(18);
});
