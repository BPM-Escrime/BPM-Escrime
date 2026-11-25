import { test, expect, type Page } from './app';

/**
 * Nouvelle interface de formule (aperçu, #2013 D13, docs/adr/0032) : les deux écrans
 * coexistent jusqu'à la 3.0, chacun est couvert ici.
 */

async function setFormulaPreview(win: Page, enabled: boolean): Promise<void> {
  const env = await win.evaluate(
    value => window.electronAPI.api.invoke('updateStationSettings', { formulaPreview: value }),
    enabled
  );
  expect(env).toMatchObject({ ok: true });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
}

async function openNewCompetition(win: Page): Promise<void> {
  await win
    .getByRole('button', { name: /nouvelle comp[eé]tition/i })
    .first()
    .click();
  await expect(win.getByLabel('Titre')).toBeVisible();
}

test.describe('Formule : interface actuelle et aperçu (application Electron)', () => {
  test('sans le réglage : interface actuelle inchangée', async ({ win }) => {
    await openNewCompetition(win);
    await expect(win.getByRole('option', { name: 'À la carte' })).toBeAttached();
    await expect(win.getByTestId('formula-collapsed')).toHaveCount(0);
  });

  test('avec le réglage : formule repliée, personnalisée, puis Organisation ▸ Formule', async ({
    win,
  }) => {
    await setFormulaPreview(win, true);
    await openNewCompetition(win);
    await expect(win.getByRole('option', { name: 'Autre' })).toBeAttached();
    await expect(win.getByTestId('formula-state')).toHaveText('Standard');

    // Personnaliser : un 2ᵉ tour de poules par le « ＋ » placé après le 1er tour
    await win.getByTestId('formula-personalize').click();
    await win.getByTestId('formula-plus-1').click();
    await win.getByTestId('formula-add-pool-1').click();
    await expect(win.getByTestId('formula-step-pool-1')).toBeVisible();
    await expect(win.getByTestId('formula-state')).toHaveText('Personnalisée');
    await expect(win.getByTestId('formula-summary')).toContainText('2 tours de poules');

    await win.getByLabel('Titre').fill('E2E Formule aperçu');
    await win.getByRole('button', { name: /cr[eé]er la comp[eé]tition/i }).click();
    await expect(win.getByRole('heading', { name: 'Appel' })).toBeVisible();

    // Organisation ▸ Formule : la formule enregistrée a bien 2 tours
    await win.getByRole('button', { name: 'Organisation' }).first().click();
    await win.getByTestId('organization-formula').click();
    await expect(win.getByTestId('formula-step-pool-1')).toBeVisible();
    await expect(win.getByTestId('formula-step-tableau')).toBeVisible();

    // Retirer le tableau puis enregistrer : la frise rouverte n'a plus de tableau
    await win.getByTestId('formula-remove-tableau').click();
    await win.getByTestId('formula-modal-save').click();
    await win.getByRole('button', { name: 'Organisation' }).first().click();
    await win.getByTestId('organization-formula').click();
    await expect(win.getByTestId('formula-step-tableau')).toHaveCount(0);
  });
});
