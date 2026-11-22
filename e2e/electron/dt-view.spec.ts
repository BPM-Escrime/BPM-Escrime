import { chromium, type Page } from '@playwright/test';
import { test, expect, createCompetition, addFencers } from './app';

/**
 * Vue DT dans un navigateur (#1981 lot 3, docs/adr/0020) : l'application réelle ouvre l'espace
 * « Vue DT » (configureDtView), un navigateur s'y connecte par mot de passe et suit l'épreuve
 * en lecture seule. Un score saisi au poste (recordScore) apparaît dans la page sans recharger.
 */
const TITLE = 'E2E Vue DT';
const PASSWORD = 'motdepasse-dt';

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/** Opération du contrat appelée comme le fait l'écran (préload, api:invoke) */
async function api<T>(win: Page, name: string, input: Record<string, unknown>): Promise<T> {
  const env = (await win.evaluate(({ name, input }) => window.electronAPI.api.invoke(name, input), {
    name,
    input,
  })) as Envelope<T>;
  if (!env.ok) throw new Error(`${name} : ${env.error.code} ${env.error.message}`);
  return env.data;
}

test('vue DT : connexion par mot de passe, épreuve suivie en lecture seule', async ({
  win,
}, testInfo) => {
  test.setTimeout(120_000);
  // Port propre au processus de test (le serveur de dev occupe 8066)
  const remotePort = 19000 + (testInfo.workerIndex % 50) * 20;

  await createCompetition(win, TITLE);
  await addFencers(win, 10);
  await win.getByRole('button', { name: /tout pointer/i }).click();
  await win.getByRole('button', { name: /pr[eé]parer les poules/i }).click();
  await win.getByRole('button', { name: /lancer les poules/i }).click();
  await expect(win.getByLabel(/contre .*, saisir le score/)).toHaveCount(40);

  const comps = await api<Array<{ id: string; title: string }>>(win, 'listCompetitions', {});
  const id = comps.find(c => c.title === TITLE)!.id;
  await win.evaluate(
    ({ cid, port }) => localStorage.setItem(`bellepoule-remote-port-${cid}`, String(port)),
    { cid: id, port: remotePort }
  );
  await win
    .getByRole('button', { name: /saisie distante/i })
    .first()
    .click();
  await win.getByLabel(/activer https/i).uncheck();
  await win.getByRole('button', { name: /d[eé]marrer la saisie distante/i }).click();
  await expect(win.getByRole('button', { name: /arr[eê]ter la saisie distante/i })).toBeVisible();

  const opened = await api<{ enabled: boolean }>(win, 'configureDtView', {
    competitionId: id,
    enabled: true,
    password: PASSWORD,
  });
  expect(opened.enabled).toBe(true);

  const browser = await chromium.launch();
  try {
    // Langue du navigateur : la page suit navigator.languages
    const page = await browser.newPage({ locale: 'fr-FR' });
    await page.goto(`http://127.0.0.1:${remotePort}/dt/`);
    await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('alert')).toHaveText('Mot de passe incorrect.');
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();

    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
    await expect(page.getByText('Lecture seule')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Poule 1/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Poule 2/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'V', exact: true })).toHaveCount(0);

    // Score saisi au poste : la page le reçoit par signal, puis relit l'état
    const state = await api<{ state: { pools: Array<{ matches: Array<{ id: string }> }> } }>(
      win,
      'getCompetitionState',
      { competitionId: id }
    );
    await api(win, 'recordScore', {
      competitionId: id,
      matchId: state.state.pools[0].matches[0].id,
      scoreA: 5,
      scoreB: 2,
    });
    await expect(page.getByRole('cell', { name: 'V', exact: true })).toHaveCount(1);
    await expect(page.getByRole('cell', { name: '2', exact: true })).toHaveCount(1);

    // Fermeture de l'espace au poste : la page perd l'accès
    await api(win, 'configureDtView', { competitionId: id, enabled: false });
    await page.reload();
    await expect(page.getByText(/Vue DT fermée/)).toBeVisible();
  } finally {
    await browser.close();
  }
});
