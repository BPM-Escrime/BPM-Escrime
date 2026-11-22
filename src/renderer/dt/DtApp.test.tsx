// @vitest-environment jsdom
/**
 * Vue DT (#1981 lot 3, docs/adr/0020) : espace fermé, connexion, puis épreuve en lecture seule
 * relue sur signal. Aucun appel à window.electronAPI.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { BpmClient } from '../../shared/api/client';
import { BpmClientProvider } from '../api/BpmClientContext';
import { DtApp } from './DtApp';
import { DtCompetition } from './DtCompetition';

vi.mock('../contexts/TranslationContext', () => import('../testUtils/i18nMock'));
vi.mock('../api/WsClient', () => ({
  createWsClient: () => ({
    query: vi.fn(() => new Promise(() => undefined)),
    call: vi.fn(),
    subscribe: () => () => undefined,
    close: vi.fn(),
  }),
}));

const json = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('DtApp : accès', () => {
  it('espace fermé : message', async () => {
    fetchMock.mockReturnValue(json({ enabled: false, configured: false, authenticated: false }));
    render(<DtApp />);
    expect(await screen.findByText(/Vue DT fermée/)).toBeInTheDocument();
  });

  it('mot de passe faux puis juste : connexion par cookie, épreuve chargée', async () => {
    let logged = false;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/dt/login') {
        const ok = JSON.parse(String(init?.body)).password === 'motdepasse-dt';
        logged = ok;
        return json(ok ? { success: true } : { error: 'wrong_password' }, ok ? 200 : 401);
      }
      return json({
        enabled: true,
        configured: true,
        authenticated: logged,
        ...(logged ? { competitionId: 'c1' } : {}),
      });
    });
    render(<DtApp />);
    const input = await screen.findByLabelText('Mot de passe');
    fireEvent.change(input, { target: { value: 'faux-mot-de-passe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mot de passe incorrect.');
    fireEvent.change(input, { target: { value: 'motdepasse-dt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('Chargement…')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dt/login',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('DtCompetition : lecture seule', () => {
  const fencer = (id: string, lastName: string) => ({
    id,
    lastName,
    firstName: 'Léa',
    club: 'Paris',
  });
  const state = (scoreA: number) => ({
    revision: 3,
    sessionRevision: 1,
    state: {
      currentPhase: 1,
      pools: [
        {
          id: 'p1',
          number: 1,
          strip: 2,
          fencers: [fencer('a', 'Dupont'), fencer('b', 'Martin')],
          matches: [
            {
              fencerA: fencer('a', 'Dupont'),
              fencerB: fencer('b', 'Martin'),
              scoreA: {
                value: scoreA,
                isVictory: scoreA === 5,
                isAbstention: false,
                isExclusion: false,
                isForfait: false,
              },
              scoreB: {
                value: 1,
                isVictory: false,
                isAbstention: false,
                isExclusion: false,
                isForfait: false,
              },
              maxScore: 5,
            },
          ],
        },
      ],
      poolHistory: [],
      appelHistory: [],
      overallRanking: [],
      tableauMatches: [],
      finalResults: [],
      consolationBrackets: [],
      currentPoolRound: 1,
      skipPoolPhase: false,
    },
  });

  it('feuille de poule affichée, relue au signal', async () => {
    let emit: (e: unknown) => void = () => undefined;
    let score = 3;
    const client = {
      query: vi.fn(async (name: string) =>
        name === 'getCompetition' ? { id: 'c1', title: 'Open de Paris' } : state(score)
      ),
      call: vi.fn(),
      subscribe: vi.fn((_n: string, _i: unknown, cb: (e: unknown) => void) => {
        emit = cb;
        return () => undefined;
      }),
    } as unknown as BpmClient;
    render(
      <BpmClientProvider client={client}>
        <DtCompetition competitionId="c1" />
      </BpmClientProvider>
    );
    expect(await screen.findByText('Open de Paris')).toBeInTheDocument();
    expect(screen.getByText('Lecture seule')).toBeInTheDocument();
    expect(screen.getByText('Poule 1 · Piste 2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    score = 5;
    act(() => emit({ type: 'matches:changed', competitionId: 'c1' }));
    await waitFor(() => expect(screen.getByText('V')).toBeInTheDocument());
    expect(client.call).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tableau' }));
    expect(screen.getByText('Pas encore de données.')).toBeInTheDocument();
  });
});
