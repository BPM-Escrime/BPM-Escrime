// @vitest-environment jsdom
/**
 * Gestion des arbitres (docs/adr/0018) : chaque geste de l'écran passe par une commande du
 * contrat (registerReferees, updateRefereeDetails, setRefereeAvailability, unregisterReferee)
 * et l'historique par listRefereeMatches. Aucune écriture directe en base.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RefereeManagerComponent } from '../RefereeManager';
import { fakeApiBridge } from '../../testUtils/apiBridge';
import { Gender, type Competition, type Referee } from '../../../shared/types';

vi.mock('../../hooks/useTranslation', () => import('../../testUtils/i18nMock'));
const showToast = vi.fn();
vi.mock('../Toast', () => ({ useToast: () => ({ showToast }) }));

const referee = (id: string, firstName: string, lastName: string, status: Referee['status']) =>
  ({
    id,
    ref: Number(id.slice(1)),
    firstName,
    lastName,
    gender: Gender.MALE,
    nationality: 'FRA',
    club: 'Paris',
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Referee;

const dto = (r: Partial<Referee> & { id: string; lastName: string }) => ({
  ref: 9,
  firstName: '',
  gender: 'M',
  club: null,
  license: null,
  nationality: 'FRA',
  region: null,
  category: null,
  status: 'unavailable',
  ...r,
});

const competition = { id: 'c1', title: 'Open', settings: {} } as unknown as Competition;

type Fn = Mock<(...args: any[]) => any>;
let api: Record<string, Fn>;
let db: Record<string, Fn>;
let onRefereesChange: Fn;

beforeEach(() => {
  showToast.mockReset();
  onRefereesChange = vi.fn();
  api = {
    registerReferees: vi.fn(async (input: any) => ({
      dryRun: false,
      referees: input.referees.map((r: any, i: number) => dto({ id: `n${i}`, ...r })),
      duplicates: [],
    })),
    updateRefereeDetails: vi.fn(async (input: any) => ({
      dryRun: false,
      referee: dto({ id: input.refereeId, lastName: 'x' }),
    })),
    setRefereeAvailability: vi.fn(async () => ({
      dryRun: false,
      status: 'available',
      updated: 1,
      unknown: [],
    })),
    unregisterReferee: vi.fn(async (input: any) => ({ dryRun: false, refereeId: input.refereeId })),
    listRefereeMatches: vi.fn(async () => [
      {
        matchId: 'm1',
        matchNumber: 3,
        poolName: 'Poule 1',
        fencerAName: 'DUPONT Ana',
        fencerBName: 'MARTIN Léo',
        scoreA: 5,
        scoreB: 2,
        status: 'finished',
        refereeId: 'r1',
        refereeName: 'Jean Arbitre',
      },
    ]),
  };
  // Écritures de table : ne doivent plus être appelées par l'écran
  db = {
    createReferee: vi.fn(),
    updateReferee: vi.fn(),
    deleteReferee: vi.fn(),
    getMatchesWithReferees: vi.fn(),
  };
  (window as any).electronAPI = { db, api: fakeApiBridge(api) };
});

afterEach(() => {
  delete (window as any).electronAPI;
  for (const fn of Object.values(db)) expect(fn).not.toHaveBeenCalled();
});

const renderManager = (referees: Referee[]) =>
  render(
    <RefereeManagerComponent
      competition={competition}
      referees={referees}
      pools={[]}
      matches={[]}
      onRefereesChange={onRefereesChange}
      onAssignmentsChange={vi.fn()}
    />
  );

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

describe('Gestion des arbitres par les commandes du contrat (docs/adr/0018)', () => {
  it('ajout par la touche Entrée : prénom et nom séparés, arbitre ajouté à la liste', async () => {
    renderManager([]);
    fireEvent.change(screen.getByPlaceholderText('Prénom Nom *'), {
      target: { value: 'Ana Maria Dupont' },
    });
    fireEvent.change(screen.getByPlaceholderText('Club'), { target: { value: 'Lyon' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Club'), { key: 'Enter' });
    await waitFor(() => expect(api.registerReferees).toHaveBeenCalledTimes(1));
    expect(api.registerReferees.mock.calls[0][0]).toEqual({
      competitionId: 'c1',
      referees: [
        expect.objectContaining({
          firstName: 'Ana Maria',
          lastName: 'Dupont',
          club: 'Lyon',
          nationality: 'FRA',
        }),
      ],
    });
    await waitFor(() => expect(onRefereesChange).toHaveBeenCalled());
    expect(onRefereesChange.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: 'n0', lastName: 'Dupont', club: 'Lyon' }),
    ]);
  });

  it('nom vide : message, aucune commande', async () => {
    renderManager([]);
    fireEvent.click(screen.getByRole('button', { name: '+ Ajouter' }));
    expect(await screen.findByText('Le nom est obligatoire')).toBeInTheDocument();
    expect(api.registerReferees).not.toHaveBeenCalled();
  });

  it('modification : identité envoyée à updateRefereeDetails', async () => {
    renderManager([referee('r1', 'Jean', 'Arbitre', 'available')]);
    fireEvent.click(within(rowOf('Jean Arbitre')).getByRole('button', { name: 'Modifier' }));
    fireEvent.change(screen.getByPlaceholderText('Prénom Nom *'), {
      target: { value: 'Jean Durand' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateRefereeDetails).toHaveBeenCalledTimes(1));
    expect(api.updateRefereeDetails.mock.calls[0][0]).toEqual({
      competitionId: 'c1',
      refereeId: 'r1',
      details: expect.objectContaining({ firstName: 'Jean', lastName: 'Durand', club: 'Paris' }),
    });
    await waitFor(() =>
      expect(onRefereesChange.mock.calls[0][0][0]).toMatchObject({ lastName: 'Durand' })
    );
  });

  it('pointage d’un arbitre : setRefereeAvailability', async () => {
    renderManager([referee('r1', 'Jean', 'Arbitre', 'unavailable')]);
    fireEvent.click(within(rowOf('Jean Arbitre')).getByRole('button', { name: 'Pointer' }));
    await waitFor(() =>
      expect(api.setRefereeAvailability).toHaveBeenCalledWith({
        competitionId: 'c1',
        refereeIds: ['r1'],
        available: true,
      })
    );
    await waitFor(() =>
      expect(onRefereesChange.mock.calls[0][0][0]).toMatchObject({ status: 'available' })
    );
  });

  it('« Tout pointer » : une seule commande pour tous les non pointés', async () => {
    renderManager([
      referee('r1', 'Jean', 'Arbitre', 'unavailable'),
      referee('r2', 'Paul', 'Juge', 'available'),
      referee('r3', 'Lise', 'Pointe', 'unavailable'),
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Tout pointer/ }));
    await waitFor(() => expect(api.setRefereeAvailability).toHaveBeenCalledTimes(1));
    expect(api.setRefereeAvailability.mock.calls[0][0]).toEqual({
      competitionId: 'c1',
      refereeIds: ['r1', 'r3'],
      available: true,
    });
    await waitFor(() =>
      expect(onRefereesChange.mock.calls[0][0].map((r: Referee) => r.status)).toEqual([
        'available',
        'available',
        'available',
      ])
    );
  });

  it('suppression : unregisterReferee, arbitre retiré de la liste', async () => {
    renderManager([referee('r1', 'Jean', 'Arbitre', 'available')]);
    fireEvent.click(within(rowOf('Jean Arbitre')).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() =>
      expect(api.unregisterReferee).toHaveBeenCalledWith({ competitionId: 'c1', refereeId: 'r1' })
    );
    await waitFor(() => expect(onRefereesChange).toHaveBeenCalledWith([]));
  });

  it('suppression refusée par le moteur (match en cours) : message, liste inchangée', async () => {
    api.unregisterReferee.mockRejectedValueOnce(
      new Error('Arbitre d’un match en cours : désinscription refusée')
    );
    renderManager([referee('r1', 'Jean', 'Arbitre', 'available')]);
    fireEvent.click(within(rowOf('Jean Arbitre')).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Arbitre d’un match en cours : désinscription refusée',
        'error'
      )
    );
    expect(onRefereesChange).not.toHaveBeenCalled();
  });

  it('historique : lu par listRefereeMatches', async () => {
    renderManager([referee('r1', 'Jean', 'Arbitre', 'available')]);
    fireEvent.click(screen.getByRole('button', { name: 'Historique' }));
    await waitFor(() =>
      expect(api.listRefereeMatches).toHaveBeenCalledWith({ competitionId: 'c1' })
    );
    expect(await screen.findByText('DUPONT Ana')).toBeInTheDocument();
    expect(screen.getByText('5 – 2')).toBeInTheDocument();
  });
});
