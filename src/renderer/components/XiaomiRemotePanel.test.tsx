// @vitest-environment jsdom
/**
 * Tests de composant - XiaomiRemotePanel : liste des clients par push, sans polling (#1291, #1292)
 * BPM - Escrime
 */

import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act, waitFor, fireEvent, screen } from '@testing-library/react';

vi.mock('../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn((url: string) => Promise.resolve(`data:image/png;qr=${url}`)) },
}));
vi.mock('../hooks/useFocusTrap', () => ({ useFocusTrap: () => ({ current: null }) }));
import { XiaomiRemotePanel } from './XiaomiRemotePanel';
import { remoteElectron } from '../testUtils/remoteBridge';

let remote: Record<string, ReturnType<typeof vi.fn>>;
let electron: ReturnType<typeof remoteElectron>;

beforeEach(() => {
  remote = {
    getConnectedClients: vi.fn().mockResolvedValue({ success: true, clients: [] }),
  };
  electron = remoteElectron(remote);
  (window as any).electronAPI = electron;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as any).electronAPI;
});

describe('XiaomiRemotePanel', () => {
  it('charge la liste une fois puis ne réinterroge pas le processus principal', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, 'setInterval');
    const subscribe = vi.spyOn(electron.api, 'subscribe');
    render(
      <XiaomiRemotePanel
        competitionId="c1"
        serverUrl="http://h:8066"
        arenaCount={2}
        onClose={() => {}}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(remote.getConnectedClients).toHaveBeenCalledTimes(1);
    // Liste par avis du contrat (onRemoteClients) : un seul abonnement, pas de polling
    expect(subscribe.mock.calls.map(c => c[1])).toEqual(['onRemoteClients']);
    expect(spy).not.toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it('ignore la liste poussée par une autre compétition', async () => {
    const push = (clients: any[], competitionId: string | null) =>
      electron.emit('onRemoteClients', { competitionId, clients });
    const { container } = render(
      <XiaomiRemotePanel
        competitionId="c1"
        serverUrl="http://h:8066"
        arenaCount={2}
        onClose={() => {}}
      />
    );
    await waitFor(() => expect(remote.getConnectedClients).toHaveBeenCalled());
    const clientsFor = (label: string, id: string) => [
      {
        socketId: id.repeat(9),
        clientType: 'kiosk',
        label,
        lastSeen: new Date().toISOString(),
        ip: '1.1.1.1',
      },
    ];
    act(() => push(clientsFor('Etranger', 'b'), 'c2'));
    expect(container.textContent).not.toContain('Etranger');
    act(() => push(clientsFor('Propre', 'a'), 'c1'));
    expect(container.textContent).toContain('Propre');
  });

  it("affiche le QR code de l'URL du lobby au clic", async () => {
    render(
      <XiaomiRemotePanel
        competitionId="c1"
        serverUrl="http://h:8066/"
        arenaCount={2}
        onClose={() => {}}
      />
    );
    expect(screen.queryByAltText('rsm.qr_code')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'rsm.qr_code' }));
    const img = await screen.findByAltText('rsm.qr_code');
    expect(img).toHaveAttribute('src', 'data:image/png;qr=http://h:8066/lobby');
    fireEvent.click(screen.getByRole('button', { name: 'rsm.qr_code' }));
    expect(screen.queryByAltText('rsm.qr_code')).toBeNull();
  });
});
