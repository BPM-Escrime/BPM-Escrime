import type { Page } from '@playwright/test';
import { test, expect, createCompetition } from './app';

/**
 * Catégorie du tireur (#2013 E1, docs/adr/0039) : importée (contrat), calculée depuis la date
 * de naissance par « Calculer les catégories », corrigée à la main, relue par le contrat.
 */
const TITLE = 'E2E Catégories';

type Envelope = { ok: boolean; data?: unknown; error?: { message: string } };

async function api<T>(win: Page, name: string, input: Record<string, unknown>): Promise<T> {
  const env = (await win.evaluate(([n, i]) => window.electronAPI.api.invoke(n, i), [
    name,
    input,
  ] as const)) as Envelope;
  if (!env.ok) throw new Error(`${name} : ${env.error?.message}`);
  return env.data as T;
}

test('catégorie : importée, calculée, corrigée à la main', async ({ win }) => {
  await createCompetition(win, TITLE);
  const comps = await api<Array<{ id: string; title: string }>>(win, 'listCompetitions', {});
  const competitionId = comps.find(c => c.title === TITLE)!.id;
  await api(win, 'registerFencers', {
    competitionId,
    fencers: [
      // Catégorie importée : gardée telle quelle par le calcul
      { lastName: 'IMPORTE', firstName: 'A', birthDate: '1975-03-01', category: 'V1' },
      // Né en 1975 : vétéran 2 pour l'épreuve du jour (saison en cours)
      { lastName: 'CALCULE', firstName: 'B', birthDate: '1975-03-01' },
      { lastName: 'SANSDATE', firstName: 'C' },
    ],
  });
  await win.getByRole('button', { name: /revenir à la liste des comp/i }).click();
  await win.locator('.competition-card', { hasText: TITLE }).click();

  await win.getByTestId('compute-categories').click();
  await expect(
    win.getByText(/1 catégories calculées ; 1 tireurs sans date de naissance/)
  ).toBeVisible();

  const row = (name: string) => win.locator('tr', { hasText: name });
  await expect(row('IMPORTE')).toContainText('V1');
  await expect(row('CALCULE')).toContainText(/V[1-4]/);
  await expect(row('SANSDATE')).not.toContainText(/\b(M\d{2}|V\d|Sen)\b/);

  // Correction à la main dans la fiche du tireur
  await row('SANSDATE')
    .getByRole('button', { name: /modifier/i })
    .first()
    .click();
  await win.getByLabel('Catégorie', { exact: true }).selectOption('U17');
  await win.getByRole('button', { name: /enregistrer/i }).click();
  await expect(row('SANSDATE')).toContainText('M17');

  const fencers = await api<Array<{ lastName: string; category: string | null }>>(
    win,
    'listFencers',
    { competitionId }
  );
  expect(Object.fromEntries(fencers.map(f => [f.lastName, f.category]))).toMatchObject({
    IMPORTE: 'V1',
    SANSDATE: 'U17',
  });
  expect(fencers.find(f => f.lastName === 'CALCULE')?.category).toMatch(/^V[1-4]$/);
});
