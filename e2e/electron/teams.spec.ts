import type { Page } from '@playwright/test';
import { test, expect } from './app';

/**
 * Épreuve par équipes à l'écran par le moteur (docs/adr/0024, lot E3) : équipes composées par
 * le contrat, poule tirée et relais saisis à l'écran (touches comptées par l'écran, fin du
 * relais envoyée au moteur), tableau tiré par le bouton (rien à l'ouverture), finale jouée,
 * rechargement : tout est retrouvé, le journal rejoué ne diverge pas des tables.
 */
const TITLE = 'E2E Équipes';

type Envelope = { ok: boolean; data?: unknown; error?: { message: string } };
type TeamMatch = { status: string; scoreBoutsA: number; scoreBoutsB: number };
type TeamsRead = { state: { teams: { poolMatches: TeamMatch[]; tableauMatches: TeamMatch[] } } };

/** Appel du contrat depuis la fenêtre ; refus → message */
async function api<T = Record<string, unknown>>(
  win: Page,
  name: string,
  input: Record<string, unknown>
): Promise<T> {
  return win.evaluate(
    async ([n, i]) => {
      const env = (await window.electronAPI.api.invoke(n, i)) as Envelope;
      if (!env.ok) throw new Error(`${n} : ${env.error?.message}`);
      return env.data;
    },
    [name, input] as const
  ) as Promise<T>;
}

async function competitionId(win: Page): Promise<string> {
  return win.evaluate(async title => {
    const comps = await window.electronAPI.db.getAllCompetitions();
    return comps.find(c => c.title === title)!.id;
  }, TITLE);
}

/** Deux équipes de trois titulaires, composées par le contrat */
async function teamsComposed(win: Page, id: string): Promise<void> {
  await api(win, 'registerFencers', {
    competitionId: id,
    fencers: ['ALPHA', 'BRAVO'].flatMap(team =>
      [1, 2, 3].map(k => ({
        lastName: `${team}${k}`,
        firstName: 'P',
        gender: 'M',
        club: team,
        status: 'P',
      }))
    ),
  });
  const fencers = await api<Array<{ id: string; lastName: string }>>(win, 'listFencers', {
    competitionId: id,
  });
  for (const name of ['Alpha', 'Bravo']) {
    const { team } = await api<{ team: { id: string } }>(win, 'registerTeam', {
      competitionId: id,
      name,
    });
    const own = fencers
      .filter(f => f.lastName.startsWith(name.toUpperCase()))
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
    for (const [k, f] of own.entries()) {
      await api(win, 'assignTeamFencer', {
        competitionId: id,
        teamId: team.id,
        fencerId: f.id,
        teamOrder: k + 1,
      });
    }
  }
}

/** Relais de la rencontre affichée : premier au palier (A), les suivants terminés à la main */
async function playMatch(win: Page, lastTouchA = false): Promise<void> {
  await win.getByRole('button', { name: 'Scorer' }).first().click();
  const end = win.getByRole('button', { name: /Terminer le relais/ });
  for (let relay = 1; relay <= 9; relay++) {
    await expect(win.getByText(new RegExp(`· A${relay}$`))).toBeVisible();
    const row = win.getByText(new RegExp(`· A${relay}$`)).locator('..');
    await expect(row.getByRole('button', { name: /Terminer le relais/ })).toBeVisible();
    if (relay === 1 && !lastTouchA) {
      // Palier atteint : fin envoyée d'elle-même
      for (let k = 0; k < 5; k++) {
        await win
          .getByRole('button', { name: 'Ajouter', exact: true })
          .and(win.locator(':enabled'))
          .first()
          .click();
      }
    } else {
      if (relay === 9 && lastTouchA) {
        await win
          .getByRole('button', { name: 'Ajouter', exact: true })
          .and(win.locator(':enabled'))
          .first()
          .click();
      }
      await end.click();
    }
  }
}

test('équipes : poule et tableau joués à l’écran par le moteur, retrouvés au rechargement', async ({
  win,
}) => {
  await win
    .getByRole('button', { name: /nouvelle comp[eé]tition/i })
    .first()
    .click();
  await win.getByLabel('Titre').fill(TITLE);
  await win.getByText('Compétition par équipes').click();
  await win.getByRole('button', { name: /cr[eé]er la comp[eé]tition/i }).click();
  await expect(win.getByRole('heading', { name: 'Appel' })).toBeVisible();
  const id = await competitionId(win);
  await teamsComposed(win, id);

  await win.getByRole('button', { name: /Composer les équipes/ }).click();
  await expect(win.getByText('Alpha', { exact: true }).first()).toBeVisible();
  await expect(win.getByText('Bravo', { exact: true }).first()).toBeVisible();
  await win.getByRole('button', { name: 'Générer la poule' }).click();

  // Poule : Alpha gagne 5-0
  await playMatch(win);
  await expect(win.getByText('Alpha gagne')).toBeVisible();
  await expect(win.getByText('5 – 0')).toBeVisible();

  // Tableau : rien à l'ouverture, tiré par le bouton, finale gagnée par Alpha 1-0
  await win.locator('.phase-step', { hasText: 'Tableau équipes' }).click();
  const draw = win.getByRole('button', { name: 'Générer le tableau (2 équipes)' });
  await expect(draw).toBeVisible();
  const before = await api<TeamsRead>(win, 'getCompetitionState', { competitionId: id });
  expect(before.state.teams.tableauMatches).toEqual([]);
  await draw.click();
  await playMatch(win, true);
  await expect(win.getByText('Alpha gagne')).toBeVisible();

  // Rechargement : rencontres et scores retrouvés ; journal rejoué sans écart
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  if (
    !(await win
      .getByText('Alpha gagne')
      .isVisible({ timeout: 5000 })
      .catch(() => false))
  ) {
    await win.locator('.competition-card', { hasText: TITLE }).click();
    await win.locator('.phase-step', { hasText: 'Tableau équipes' }).click();
  }
  await expect(win.getByText('Alpha gagne')).toBeVisible();
  const after = await api<TeamsRead>(win, 'getCompetitionState', { competitionId: id });
  expect(after.state.teams.poolMatches[0]).toMatchObject({ scoreBoutsA: 5, scoreBoutsB: 0 });
  expect(after.state.teams.tableauMatches[0]).toMatchObject({
    status: 'finished',
    scoreBoutsA: 1,
    scoreBoutsB: 0,
  });
  const rebuild = await api<{ complete: boolean; divergences: unknown[] }>(
    win,
    'rebuildCompetitionState',
    { competitionId: id, dryRun: true }
  );
  expect(rebuild.complete).toBe(true);
  expect(rebuild.divergences).toEqual([]);
});
