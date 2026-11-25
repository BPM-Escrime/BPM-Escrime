// @vitest-environment jsdom
/**
 * Pilotes des appareils depuis la salle : démarrage et arrêt Cyrano / OPP2 (boutons toujours
 * présents), envoi des HELLO choisi au démarrage (ADR-0038), journal des trames et export.
 */
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StripDriversPanel } from './StripDriversPanel';
import { remoteElectron } from '../testUtils/remoteBridge';
import type { ApiHandlers } from '../testUtils/apiBridge';

vi.mock('../hooks/useTranslation', () => import('../testUtils/i18nMock'));

let api: Record<string, ReturnType<typeof vi.fn>>;
let cyranoRunning: boolean;

function mount() {
  cyranoRunning = false;
  api = {
    getCyranoStatus: vi.fn(async () => ({
      running: cyranoRunning,
      port: 50100,
      hello: 'never',
      pistes: [],
    })),
    getOpp2Status: vi.fn().mockResolvedValue({
      running: false,
      port: 1883,
      clients: 0,
      unknownPistes: [],
      pistes: [],
    }),
    startCyranoServer: vi.fn(async () => {
      cyranoRunning = true;
      return { port: 50100 };
    }),
    stopCyranoServer: vi.fn(async () => {
      cyranoRunning = false;
    }),
    startOpp2Broker: vi.fn().mockResolvedValue({ port: 1883 }),
    setStripDeviceOptions: vi.fn().mockResolvedValue(undefined),
    listCyranoLog: vi.fn().mockResolvedValue([
      {
        ts: 0,
        dir: 'out',
        ip: '192.168.1.101',
        port: 50101,
        piste: '1',
        raw: '|EFP1.1|HELLO|1||%|',
      },
    ]),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = remoteElectron(
    {
      getNetworkInterfaces: vi.fn().mockResolvedValue({
        success: true,
        interfaces: [
          { name: 'Toutes les interfaces', address: '0.0.0.0' },
          { name: 'eth0 (192.168.1.5)', address: '192.168.1.5' },
        ],
      }),
    },
    { api: api as unknown as ApiHandlers }
  );
  return render(<StripDriversPanel />);
}

describe('StripDriversPanel', () => {
  beforeEach(() => localStorage.clear());

  it('démarre Cyrano avec l’envoi des HELLO choisi, puis propose l’arrêt', async () => {
    mount();
    const select = await screen.findByLabelText('HELLO');
    fireEvent.change(select, { target: { value: 'never' } });
    expect(localStorage.getItem('bellepoule-cyrano-hello')).toBe('never');
    const [startCyrano] = screen.getAllByRole('button', { name: 'Démarrer' });
    fireEvent.click(startCyrano);
    await waitFor(() =>
      expect(api.startCyranoServer).toHaveBeenCalledWith({
        port: 50100,
        host: '',
        hello: 'never',
      })
    );
    // Pilote démarré : le bouton reste, il devient « Arrêter » ; réglage figé
    const stop = await screen.findByRole('button', { name: 'Arrêter' });
    expect(screen.getByLabelText('HELLO')).toBeDisabled();
    fireEvent.click(stop);
    await waitFor(() => expect(api.stopCyranoServer).toHaveBeenCalled());
    expect(await screen.findAllByRole('button', { name: 'Démarrer' })).toHaveLength(2);
  });

  it('démarre le broker OPP2 sans épreuve', async () => {
    mount();
    await screen.findByLabelText('HELLO');
    fireEvent.click(screen.getAllByRole('button', { name: 'Démarrer' })[1]);
    await waitFor(() => expect(api.startOpp2Broker).toHaveBeenCalledWith({ port: 1883 }));
  });

  it('journal des trames affiché à la demande ; interfaces proposées', async () => {
    mount();
    fireEvent.click(await screen.findByText('Journal des trames'));
    expect(await screen.findByText(/\|EFP1\.1\|HELLO\|1\|/)).toBeInTheDocument();
    expect(await screen.findByText('eth0 (192.168.1.5)')).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: /Toutes les interfaces/ })).toHaveLength(1);
  });
});
