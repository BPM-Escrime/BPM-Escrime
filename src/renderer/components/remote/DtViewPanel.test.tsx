// @vitest-environment jsdom
/**
 * Volet « Vue DT » de la saisie distante (docs/adr/0020) : état lu par getDtViewStatus,
 * réglage par configureDtView, refus du moteur affiché.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DtViewPanel } from './DtViewPanel';
import { fakeApiBridge } from '../../testUtils/apiBridge';

vi.mock('../../hooks/useTranslation', () => import('../../testUtils/i18nMock'));
const showToast = vi.fn();
vi.mock('../Toast', () => ({ useToast: () => ({ showToast }) }));

let status: { running: boolean; enabled: boolean; configured: boolean };
let configure: Mock<(input: any) => Promise<unknown>>;

beforeEach(() => {
  showToast.mockReset();
  status = { running: true, enabled: false, configured: false };
  configure = vi.fn(async (input: any) => {
    if (input.password !== undefined && input.password.length < 8) {
      throw new Error('Mot de passe trop court (8 caractères minimum)');
    }
    if (input.password !== undefined) status.configured = !!input.password;
    if (input.enabled !== undefined) status.enabled = input.enabled;
    return { dryRun: false, enabled: status.enabled, configured: status.configured };
  });
  (window as any).electronAPI = {
    api: fakeApiBridge({
      getDtViewStatus: async () => ({ ...status }),
      configureDtView: configure,
    }),
  };
});

afterEach(() => {
  delete (window as any).electronAPI;
});

const renderPanel = () =>
  render(
    <DtViewPanel
      competitionId="c1"
      serverUrl="https://192.168.1.10:8066"
      isRemoteActive
      copiedIndex={null}
      onCopy={vi.fn()}
      onQr={vi.fn()}
    />
  );

describe('DtViewPanel (docs/adr/0020)', () => {
  it('affiche l’URL /dt/ ; ouverture impossible sans mot de passe', async () => {
    renderPanel();
    expect(screen.getByTitle('https://192.168.1.10:8066/dt/')).toBeInTheDocument();
    await screen.findByText('Fermée');
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('mot de passe puis ouverture : commandes du contrat', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTitle('Définir le mot de passe')).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/Obligatoire pour ouvrir la vue DT/);
    fireEvent.change(input, { target: { value: 'motdepasse-dt' } });
    await waitFor(() => expect(screen.getByTitle('Définir le mot de passe')).toBeEnabled());
    fireEvent.click(screen.getByTitle('Définir le mot de passe'));
    await waitFor(() =>
      expect(configure).toHaveBeenCalledWith({ competitionId: 'c1', password: 'motdepasse-dt' })
    );
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Mot de passe de la vue DT défini', 'success')
    );
    const box = screen.getByRole('checkbox');
    await waitFor(() => expect(box).toBeEnabled());
    fireEvent.click(box);
    await waitFor(() => expect(screen.getByText('Ouverte')).toBeInTheDocument());
    expect(configure).toHaveBeenLastCalledWith({ competitionId: 'c1', enabled: true });
    expect(showToast).toHaveBeenLastCalledWith('Vue DT ouverte', 'success');
  });

  it('refus du moteur : message affiché', async () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText(/Obligatoire pour ouvrir la vue DT/), {
      target: { value: 'court' },
    });
    await waitFor(() => expect(screen.getByTitle('Définir le mot de passe')).toBeEnabled());
    fireEvent.click(screen.getByTitle('Définir le mot de passe'));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Réglage de la vue DT impossible : Mot de passe trop court (8 caractères minimum)',
        'error'
      )
    );
  });

  it('saisie distante arrêtée : réglage désactivé', async () => {
    status = { running: false, enabled: false, configured: false };
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText(/Obligatoire pour ouvrir la vue DT/), {
      target: { value: 'motdepasse-dt' },
    });
    await waitFor(() => expect(screen.getByTitle('Définir le mot de passe')).toBeDisabled());
  });
});
