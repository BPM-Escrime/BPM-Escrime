import { test, expect, addFencers, type Page } from './app';

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
    await expect(win.getByTestId('formula-state')).toContainText('Adaptée');
    await expect(win.getByTestId('formula-summary')).toContainText('2 tours de poules');

    await win.getByLabel('Titre').fill('E2E Formule aperçu');
    await win.getByRole('button', { name: /cr[eé]er la comp[eé]tition/i }).click();
    await expect(win.getByRole('heading', { name: 'Appel' })).toBeVisible();

    // Organisation ▸ Formule : la formule enregistrée a bien 2 tours
    await win.getByRole('button', { name: 'Organisation' }).first().click();
    await win.getByTestId('organization-formula').click();
    await expect(win.getByTestId('formula-step-pool-1')).toBeVisible();
    await expect(win.getByTestId('formula-step-tableau')).toBeVisible();

    // Modèle d'origine gardé : formule adaptée (2 tours au lieu d'un)
    await expect(win.getByTestId('formula-state')).toContainText('Adaptée');

    // Enregistrer comme modèle personnel, puis le retrouver dans la liste
    await win.getByTestId('formula-save-as').click();
    await win.getByTestId('formula-save-name').fill('E2E Mon modèle');
    await win.getByTestId('formula-save-confirm').click();
    await expect(win.getByTestId('formula-save-status')).toHaveText('Modèle enregistré');
    await expect(win.getByTestId('formula-template-select')).toContainText('E2E Mon modèle');
    await expect(win.getByTestId('formula-state')).toHaveText('Standard');

    // Retirer le tableau puis enregistrer : la frise rouverte n'a plus de tableau
    await win.getByTestId('formula-remove-tableau').click();
    await win.getByTestId('formula-modal-save').click();
    await win.getByRole('button', { name: 'Organisation' }).first().click();
    await win.getByTestId('organization-formula').click();
    await expect(win.getByTestId('formula-step-tableau')).toHaveCount(0);

    // Écrit en base par les commandes de formule (docs/adr/0033) : relu par le contrat
    const formula = await win.evaluate(async () => {
      const list = (await window.electronAPI.api.invoke('listCompetitions', {})) as {
        data: Array<{ id: string; title: string }>;
      };
      const comp = list.data.find(c => c.title === 'E2E Formule aperçu')!;
      return window.electronAPI.api.invoke('getCompetitionFormula', { competitionId: comp.id });
    });
    expect(formula).toMatchObject({
      ok: true,
      data: { phases: [{ key: 'pool-0' }, { key: 'pool-1' }], state: 'adapted' },
    });
  });

  test('0 tour de poules : l’appel mène au classement d’entrée puis au tableau (ADR-0037)', async ({
    win,
  }) => {
    await setFormulaPreview(win, true);
    await openNewCompetition(win);
    await win.getByTestId('formula-personalize').click();
    await win.getByTestId('formula-remove-pool-0').click();
    await expect(win.getByTestId('formula-step-pool-0')).toHaveCount(0);
    await win.getByLabel('Titre').fill('E2E Sans poule');
    await win.getByRole('button', { name: /cr[eé]er la comp[eé]tition/i }).click();
    await expect(win.getByRole('heading', { name: 'Appel' })).toBeVisible();
    // Ni préparation ni poules dans la navigation
    await expect(win.locator('.phase-step', { hasText: 'Préparation' })).toHaveCount(0);
    await expect(win.locator('.phase-step', { hasText: 'Classement' })).toHaveCount(1);
    await addFencers(win, 6);
    await win.getByRole('button', { name: /tout pointer/i }).click();
    await win.getByRole('button', { name: /classement d.entr[eé]e/i }).click();
    const events = await win.evaluate(async () => {
      const listed = await window.electronAPI.api.invoke('listCompetitions', {});
      const comps = (listed.ok ? listed.data : []) as Array<{ id: string; title: string }>;
      const id = comps.find(c => c.title === 'E2E Sans poule')!.id;
      const env = await window.electronAPI.api.invoke('getCompetitionEvents', {
        competitionId: id,
        since: 0,
      });
      return (env as { data: { events: Array<{ type: string }> } }).data.events.map(e => e.type);
    });
    expect(events).toContain('PoolsSkipped');
  });
});
