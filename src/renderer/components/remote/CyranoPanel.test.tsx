// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CyranoPanel } from './CyranoPanel';
import { remoteElectron } from '../../testUtils/remoteBridge';
import type { ApiHandlers } from '../../testUtils/apiBridge';

vi.mock('../../hooks/useTranslation', () => import('../../testUtils/i18nMock'));

/** Appareils de la salle de l'épreuve (docs/adr/0023) : Cyrano piste 1, OPP2 piste 2 */
const devices = (manualStrips: number[] = []) => ({
  venueId: 'v1',
  venueName: 'Gymnase',
  source: 'default',
  competitionVenueId: null,
  manualStrips,
  devices: [
    {
      strip: 1,
      device: { protocol: 'cyrano', ip: '127.0.0.1', port: 50101 },
      arena: 1,
      piste: '1',
      manual: manualStrips.includes(1),
    },
    {
      strip: 2,
      label: 'Bleue',
      device: { protocol: 'opp2', opp2Id: 'bleue' },
      arena: 2,
      piste: 'bleue',
      manual: manualStrips.includes(2),
    },
  ],
});

const cyranoStatus = (alert: unknown = null) => ({
  running: true,
  port: 50100,
  pistes: [
    {
      piste: '1',
      ip: '127.0.0.1',
      port: 50101,
      arena: 1,
      mode: 'master',
      status: 'online',
      lastSeen: Date.now(),
      detectedProtocol: 'EFP1.1',
      alert,
    },
  ],
});

let api: Record<string, ReturnType<typeof vi.fn>>;

function mount(alert: unknown = null) {
  api = {
    getCompetitionStripDevices: vi.fn().mockResolvedValue(devices()),
    listVenues: vi.fn().mockResolvedValue([
      { id: 'v1', name: 'Gymnase', isDefault: true, strips: [] },
      { id: 'v2', name: 'Halle', isDefault: false, strips: [] },
    ]),
    getCyranoStatus: vi.fn().mockResolvedValue(cyranoStatus(alert)),
    getOpp2Status: vi.fn().mockResolvedValue({
      running: false,
      port: 1883,
      clients: 0,
      unknownPistes: [],
      pistes: [],
    }),
    listStripDeviceRoutes: vi.fn().mockResolvedValue({}),
    listCyranoLog: vi
      .fn()
      .mockResolvedValue([
        { ts: 0, dir: 'in', ip: '127.0.0.1', port: 50101, piste: '1', raw: '|EFP1.1|INFO|1|' },
      ]),
    runStripDeviceAction: vi.fn().mockResolvedValue({ done: true }),
    updateCompetitionSettings: vi.fn().mockResolvedValue({ changed: ['settings.manualStrips'] }),
    setCompetitionVenue: vi.fn().mockResolvedValue({ ...devices(), competitionVenueId: 'v2' }),
    startOpp2Broker: vi.fn().mockResolvedValue({ port: 1883 }),
    setStripDeviceOptions: vi.fn().mockResolvedValue(undefined),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = remoteElectron(
    {
      // Format de listNetworkInterfaces : le nom porte déjà l'adresse
      getNetworkInterfaces: vi.fn().mockResolvedValue({
        success: true,
        interfaces: [
          { name: 'Toutes les interfaces', address: '0.0.0.0' },
          { name: 'eth0 (10.1.1.1)', address: '10.1.1.1' },
        ],
      }),
    },
    { api: api as unknown as ApiHandlers }
  );
  return render(<CyranoPanel competitionId="c1" />);
}

describe('CyranoPanel — appareils de la salle (docs/adr/0023)', () => {
  beforeEach(() => localStorage.clear());

  it('affiche les appareils de la salle sans édition d’adresse', async () => {
    mount();
    expect(await screen.findByText('127.0.0.1:50101')).toBeInTheDocument();
    expect(screen.getByText('bleue')).toBeInTheDocument();
    expect(screen.getByText('2 · Bleue')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('192.168.1.100')).toBeNull();
    expect(api.getCompetitionStripDevices).toHaveBeenCalledWith({ competitionId: 'c1' });
  });

  it('case « manuel » : écrit manualStrips de l’épreuve', async () => {
    mount();
    fireEvent.click(await screen.findByLabelText('Piste 2 en manuel'));
    await waitFor(() =>
      expect(api.updateCompetitionSettings).toHaveBeenCalledWith({
        competitionId: 'c1',
        settings: { manualStrips: [2] },
      })
    );
  });

  it('salle de l’épreuve choisie par setCompetitionVenue', async () => {
    mount();
    const select = await screen.findByLabelText("Salle de l'épreuve");
    await screen.findByRole('option', { name: 'Halle' });
    fireEvent.change(select, { target: { value: 'v2' } });
    await waitFor(() =>
      expect(api.setCompetitionVenue).toHaveBeenCalledWith({ competitionId: 'c1', venueId: 'v2' })
    );
  });

  it('démarre le broker OPP2 pour l’épreuve', async () => {
    mount();
    await screen.findByText('bleue');
    const buttons = screen.getAllByRole('button', { name: 'Démarrer' });
    fireEvent.click(buttons[0]);
    await waitFor(() =>
      expect(api.startOpp2Broker).toHaveBeenCalledWith({ port: 1883, competitionId: 'c1' })
    );
  });
});

describe('CyranoPanel — alerte, secours et journal (#1720, #1829)', () => {
  beforeEach(() => localStorage.clear());

  it('signale la piste dont l’appareil affiche un autre match', async () => {
    mount({ kind: 'bad_match', since: Date.now(), arena: 'arena1', device: 'DUVAL J – MOREL L' });
    const badge = await screen.findByText('BAD MATCH');
    expect(badge.closest('.cyrano-alert')).toHaveAttribute(
      'title',
      expect.stringContaining('DUVAL J – MOREL L')
    );
  });

  it('actions de secours envoyées pour la piste', async () => {
    mount();
    fireEvent.click(await screen.findByText('ACK'));
    await waitFor(() =>
      expect(api.runStripDeviceAction).toHaveBeenCalledWith({ piste: '1', action: 'ack' })
    );
  });

  it('journal affiché à la demande ; interfaces proposées', async () => {
    mount();
    fireEvent.click(await screen.findByText('Journal des trames'));
    expect(await screen.findByText(/\|EFP1\.1\|INFO\|1\|/)).toBeInTheDocument();
    expect(await screen.findByText('eth0 (10.1.1.1)')).toBeInTheDocument();
    // « Toutes les interfaces » proposé une seule fois (0.0.0.0 non répété)
    expect(screen.getAllByRole('option', { name: /Toutes les interfaces/ })).toHaveLength(1);
  });

  it('journal : défile jusqu’aux dernières trames, dans son cadre (#2001)', async () => {
    const proto = HTMLElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => 480 });
    try {
      mount();
      fireEvent.click(await screen.findByText('Journal des trames'));
      const pre = await screen.findByLabelText('Journal des trames', { selector: 'pre' });
      await screen.findByText(/\|EFP1\.1\|INFO\|1\|/);
      expect(pre).toHaveClass('cyrano-log');
      expect(pre.scrollTop).toBe(480);
    } finally {
      if (original) Object.defineProperty(proto, 'scrollHeight', original);
      else delete (proto as unknown as Record<string, unknown>).scrollHeight;
    }
  });
});
