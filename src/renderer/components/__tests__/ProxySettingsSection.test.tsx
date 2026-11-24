// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ProxySettingsSection from '../ProxySettingsSection';
import { fakeApiBridge } from '../../testUtils/apiBridge';

vi.mock('../../hooks/useTranslation', () => import('../../testUtils/i18nMock'));

describe('ProxySettingsSection', () => {
  type Handler = (input: Record<string, unknown>) => Promise<unknown>;
  let set: ReturnType<typeof vi.fn<Handler>>;
  let test: ReturnType<typeof vi.fn<Handler>>;

  beforeEach(() => {
    set = vi.fn<Handler>(async i => i);
    test = vi.fn<Handler>(async () => ({ ok: true, resolved: 'PROXY proxy:3128' }));
    // Opérations du poste getProxySettings, updateProxySettings, testProxy (docs/adr/0022)
    Object.assign(window, {
      electronAPI: {
        api: fakeApiBridge({
          getProxySettings: async () => ({ mode: 'system' }),
          updateProxySettings: set,
          testProxy: test,
        }),
      },
    });
  });

  const renderReady = async () => {
    await act(async () => {
      render(<ProxySettingsSection />);
    });
  };

  it('système / aucun : appliqué immédiatement', async () => {
    await renderReady();
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Aucun proxy/));
    });
    expect(set).toHaveBeenCalledWith({ mode: 'direct' });
    expect(screen.getByRole('status')).toHaveTextContent('Proxy appliqué');
  });

  it('manuel : serveur + exclusions envoyés au clic sur Appliquer', async () => {
    await renderReady();
    fireEvent.click(screen.getByLabelText(/Proxy manuel/));
    expect(set).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Serveur proxy'), { target: { value: 'proxy:3128' } });
    fireEvent.change(screen.getByLabelText(/Exclusions/), { target: { value: '*.club' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    });
    expect(set).toHaveBeenCalledWith({ mode: 'manual', server: 'proxy:3128', bypass: '*.club' });
  });

  it('sans poste : section masquée', async () => {
    Object.assign(window, { electronAPI: undefined });
    await renderReady();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('refus du poste → message d’adresse invalide', async () => {
    set.mockRejectedValue(new Error('Adresse de proxy invalide'));
    await renderReady();
    fireEvent.click(screen.getByLabelText(/Proxy manuel/));
    fireEvent.change(screen.getByLabelText('Serveur proxy'), { target: { value: 'nope' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Adresse de proxy invalide/);
  });

  it('test de connexion : route affichée', async () => {
    await renderReady();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Tester la connexion/ }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('PROXY proxy:3128');
  });
});
