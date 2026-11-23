import type { Page } from '@playwright/test';
import { test, expect, createCompetition } from './app';

/**
 * Tableaux séparés après les poules (docs/adr/0024, lots A2 et A3) : un tableau par groupe tenu par
 * le moteur. Poules communes jouées par le contrat, puis à l'écran : tableau des hommes et
 * des femmes, un score dans chacun, rechargement de la fenêtre : les deux tableaux restent.
 */
const TITLE = 'E2E Tableaux séparés';

type Envelope = { ok: boolean; data?: unknown; error?: { message: string } };

/** Épreuve mixte à tableaux séparés : tireurs inscrits, poules tirées et jouées (contrat) */
async function poolsPlayed(win: Page): Promise<void> {
  const error = await win.evaluate(async title => {
    const api = window.electronAPI.api;
    const call = async (name: string, input: Record<string, unknown>) => {
      const env = (await api.invoke(name, input)) as Envelope;
      if (!env.ok) throw new Error(`${name} : ${env.error?.message}`);
      return env.data as Record<string, unknown>;
    };
    try {
      const comps = await window.electronAPI.db.getAllCompetitions();
      const competitionId = comps.find(c => c.title === title)!.id;
      await call('updateCompetitionSettings', {
        competitionId,
        gender: 'X',
        settings: { postPoolSplitCriteria: 'gender', thirdPlaceMatch: false },
      });
      await call('registerFencers', {
        competitionId,
        fencers: Array.from({ length: 8 }, (_, i) => ({
          lastName: `${i % 2 === 0 ? 'TIREUSE' : 'TIREUR'}${i}`,
          firstName: `P${i}`,
          gender: i % 2 === 0 ? 'F' : 'M',
          club: `CLUB ${'ABCD'[i % 4]}`,
          ranking: i + 1,
          status: 'P',
        })),
      });
      await call('generatePools', { competitionId, poolCount: 2 });
      const read = await call('getCompetitionState', { competitionId });
      const pools = (read.state as { pools: Array<{ matches: Array<{ id: string }> }> }).pools;
      for (const m of pools.flatMap(p => p.matches)) {
        await call('recordScore', { competitionId, matchId: m.id, scoreA: 5, scoreB: 2 });
      }
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, TITLE);
  expect(error).toBeNull();
}

/** Score saisi à l'écran dans le premier match jouable du tableau affiché */
async function enterScore(win: Page): Promise<void> {
  const card = win
    .getByRole('button', { name: /^(?!.* : \d+-\d+$).+ contre .+$/ })
    .and(win.locator('.match-card'))
    .first();
  await card.click();
  const [a, b] = await win.getByRole('dialog').getByRole('spinbutton').all();
  await a.fill('15');
  await b.fill('4');
  await win
    .getByRole('dialog')
    .getByRole('button', { name: /^valider$/i })
    .click();
}

const scored = (win: Page) => win.getByRole('button', { name: / : (15-4|4-15)$/ });

/** Onglet de l'épreuve rouvert après rechargement, sinon ouverture depuis l'accueil */
async function reopen(win: Page): Promise<void> {
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  const tabs = win.locator('.split-group-tabs-1 button');
  if (
    !(await tabs
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false))
  ) {
    await win.locator('.competition-card', { hasText: TITLE }).click();
  }
}

test('tableaux séparés : deux tableaux joués, retrouvés après rechargement', async ({ win }) => {
  await createCompetition(win, TITLE);
  await poolsPlayed(win);
  // Réglages et tireurs posés par le contrat : épreuve rouverte depuis l'accueil
  await win.getByRole('button', { name: /revenir à la liste des comp/i }).click();
  await win.locator('.competition-card', { hasText: TITLE }).click();

  await win
    .getByRole('button', { name: /^classement/i })
    .first()
    .click();
  await win.getByRole('button', { name: /Tableau ♂ Hommes/ }).click();
  const tabs = win.locator('.split-group-tabs-1 button');
  await expect(tabs).toHaveCount(2);
  await enterScore(win);
  await expect(scored(win)).toHaveCount(1);

  // Onglet des femmes : tableau tiré à son tour, un score
  await tabs.filter({ hasText: /F[ée]minin/ }).click();
  await enterScore(win);
  await expect(scored(win)).toHaveCount(1);

  await reopen(win);
  await expect(tabs).toHaveCount(2);
  await expect(scored(win)).toHaveCount(1);
  await tabs.filter({ hasText: /Masculin/ }).click();
  await expect(scored(win)).toHaveCount(1);
  await tabs.filter({ hasText: /F[ée]minin/ }).click();
  await expect(scored(win)).toHaveCount(1);
});

/**
 * Lot A3 : groupe des femmes extrait en épreuve séparée par la commande splitOffGroup ;
 * l'épreuve séparée s'ouvre au classement, tireuses et classement présents.
 */
test('tableaux séparés : groupe extrait en épreuve séparée', async ({ win }) => {
  await createCompetition(win, TITLE);
  await poolsPlayed(win);
  await win.getByRole('button', { name: /revenir à la liste des comp/i }).click();
  await win.locator('.competition-card', { hasText: TITLE }).click();

  await win
    .getByRole('button', { name: /^classement/i })
    .first()
    .click();
  await win.getByRole('button', { name: /Créer la compétition ♀ Femmes/ }).click();
  const dialog = win.getByRole('dialog');
  await expect(dialog.locator('input')).toHaveValue(`${TITLE} – Dames`);
  await dialog.getByRole('button', { name: /^Créer la compétition$/ }).click();
  await expect(dialog).toBeHidden();

  // Épreuve séparée ouverte au classement : les quatre tireuses, aucun tireur
  await expect(win.getByText('TIREUSE0').first()).toBeVisible();
  for (const name of ['TIREUSE2', 'TIREUSE4', 'TIREUSE6']) {
    await expect(win.getByText(name).first()).toBeVisible();
  }
  await expect(win.getByText('TIREUR1')).toHaveCount(0);

  // Écritures du moteur : épreuve, tireuses pointées, classement importé, journaux
  const check = await win.evaluate(async title => {
    const api = window.electronAPI.api;
    const call = async (name: string, input: Record<string, unknown>) => {
      const env = (await api.invoke(name, input)) as Envelope;
      if (!env.ok) throw new Error(`${name} : ${env.error?.message}`);
      return env.data as Record<string, unknown>;
    };
    const comps = await window.electronAPI.db.getAllCompetitions();
    const source = comps.find(c => c.title === title)!;
    const target = comps.find(c => c.title === `${title} – Dames`)!;
    const state = (await call('getCompetitionState', { competitionId: target.id })).state as {
      overallRanking: unknown[];
    };
    const fencers = (await call('listFencers', { competitionId: target.id })) as unknown as Array<{
      status: string;
    }>;
    const events = (await call('getCompetitionEvents', { competitionId: target.id })) as {
      events: Array<{ type: string }>;
    };
    return {
      splitOff: source.settings?.splitOffCompetitionIds?.F === target.id,
      ranking: state.overallRanking.length,
      fencers: fencers.length,
      notCheckedIn: fencers.filter(f => f.status === 'N').length,
      events: events.events.map(e => e.type),
    };
  }, TITLE);
  expect(check).toEqual({
    splitOff: true,
    ranking: 4,
    fencers: 4,
    notCheckedIn: 0,
    events: ['SplitRankingImported'],
  });
});
