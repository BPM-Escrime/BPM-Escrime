import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ElectronApplication } from '@playwright/test';
import { test, expect, createCompetition, addFencers } from './app';

/**
 * Fichiers de données par le contrat (#1981, ADR-0021) : le contrat rend ou reçoit le contenu,
 * l'écran l'enregistre ou le choisit par la plateforme. Les dialogues natifs sont remplacés dans
 * le process principal par un chemin fixé par le test.
 */
async function nextDialogs(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as never;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as never;
  }, file);
}

test('archive de tireurs .bpf : export puis réimport dans une autre épreuve', async ({
  app,
  win,
}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2e-files-'));
  const bpf = path.join(dir, 'tireurs.bpf');
  await nextDialogs(app, bpf);

  await createCompetition(win, 'E2E Archive source');
  await addFencers(win, 3);
  await win.getByRole('button', { name: 'Exporter ▾' }).click();
  await win.getByRole('button', { name: 'Exporter tireurs + photos (.bpf)' }).click();
  await expect(win.getByText('3 tireurs exportés (.bpf)')).toBeVisible();
  expect(fs.readFileSync(bpf).subarray(0, 2).toString('ascii')).toBe('PK');

  await win.getByRole('button', { name: /revenir à la liste des comp/i }).click();
  await createCompetition(win, 'E2E Archive cible');
  await win.getByRole('button', { name: 'Importer ▾' }).click();
  await win.getByRole('button', { name: 'Importer tireurs + photos (.bpf)' }).click();
  await expect(win.getByText('3 ajouté(s), 0 mis à jour (.bpf)')).toBeVisible();
  for (const name of ['TIREUR0', 'TIREUR1', 'TIREUR2']) {
    await expect(win.getByText(name, { exact: true })).toBeVisible();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sauvegarde .bpm : export depuis l’accueil, suppression, réouverture', async ({
  app,
  win,
}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2e-files-'));
  const bpm = path.join(dir, 'epreuve.bpm');
  await nextDialogs(app, bpm);

  await createCompetition(win, 'E2E Sauvegarde');
  await addFencers(win, 2);
  await win.getByRole('button', { name: /revenir à la liste des comp/i }).click();
  const card = win.locator('.competition-card', { hasText: 'E2E Sauvegarde' }).first();
  await card.getByRole('button', { name: 'Exporter (.bpm)' }).click();
  await expect(win.getByText('Compétition exportée')).toBeVisible();
  expect(fs.readFileSync(bpm).subarray(0, 15).toString('ascii')).toBe('SQLite format 3');

  await card.getByRole('button', { name: 'Supprimer' }).click();
  await win.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(card).toHaveCount(0);

  await win.getByRole('button', { name: 'Ouvrir…' }).first().click();
  await expect(win.getByText('Compétition importée')).toBeVisible();
  await expect(win.getByText('TIREUR1', { exact: true })).toBeVisible();
  fs.rmSync(dir, { recursive: true, force: true });
});
