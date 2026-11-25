// @vitest-environment jsdom
/**
 * Pilotage de la salle (#2117) : grille (liaison, occupation, accusé), sélection et envoi en
 * masse par le contrat (sendStripDisplay), résultats par piste, remise à blanc ; déclaration en
 * masse (setStripDevices), export par contenu. Pilotes : StripDriversPanel.test.tsx.
 */
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import VenueStripControlPanel, { buildRequest } from './VenueStripControlPanel';
import VenueStripBulkTools from './VenueStripBulkTools';
import { fakeApiBridge } from '../testUtils/apiBridge';
import { PlatformProvider } from '../platform/PlatformContext';
import type { PlatformServices } from '../../shared/platform/PlatformServices';

vi.mock('../hooks/useTranslation', () => import('../testUtils/i18nMock'));

const grid = (opp2Running = false) => ({
  venueId: 'v1',
  venueName: 'Halle',
  cyranoRunning: true,
  opp2Running,
  strips: [
    {
      strip: 1,
      label: 'Podium',
      protocol: 'cyrano',
      piste: '1',
      link: 'online',
      alert: null,
      busy: null,
      last: { at: 0, ack: 'acked', clear: false, panel: {} },
    },
    {
      strip: 2,
      protocol: 'cyrano',
      piste: '2',
      link: 'online',
      alert: { kind: 'bad_match', since: 0, arena: 'arena2', device: 'DUVAL J – MOREL L' },
      busy: { competitionId: 'c1', title: 'Open Sabre' },
      last: null,
    },
    { strip: 3, protocol: 'opp2', piste: 'b', link: null, alert: null, busy: null, last: null },
    { strip: 4, protocol: null, piste: null, link: null, alert: null, busy: null, last: null },
  ],
});

let calls: Record<string, Record<string, unknown>[]>;

function install(extra: Record<string, (i: Record<string, unknown>) => unknown> = {}) {
  calls = {};
  const record =
    (name: string, out: (i: Record<string, unknown>) => unknown) =>
    (i: Record<string, unknown>) => {
      (calls[name] ??= []).push(i);
      return out(i);
    };
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    api: fakeApiBridge({
      listVenueStripControl: record('listVenueStripControl', () => grid()),
      sendStripDisplay: record('sendStripDisplay', () => [
        { strip: 1, outcome: 'sent' },
        { strip: 2, outcome: 'busy', competitionId: 'c1' },
      ]),
      startOpp2Broker: record('startOpp2Broker', () => ({ port: 1883 })),
      runStripDeviceAction: record('runStripDeviceAction', () => ({ done: true })),
      setStripDevices: record('setStripDevices', () => ({})),
      getStripDevicesFile: record('getStripDevicesFile', () => ({
        content: '{"strips":[]}',
        fileName: 'appareils-halle.json',
      })),
      ...extra,
    }),
  };
}

describe('buildRequest', () => {
  it('seuls les champs saisis partent', () => {
    expect(
      buildRequest({ weapon: '', leftName: ' ', leftNat: '', rightName: '', rightNat: '' })
    ).toEqual({});
    expect(
      buildRequest({ weapon: 'S', leftName: 'Dupont', leftNat: '', rightName: '', rightNat: 'ITA' })
    ).toEqual({ weapon: 'S', left: { name: 'Dupont' }, right: { nat: 'ITA' } });
  });
});

describe('VenueStripControlPanel', () => {
  beforeEach(() => install());

  it('grille : liaison, piste occupée, accusé reçu', async () => {
    render(<VenueStripControlPanel venueId="v1" />);
    expect(await screen.findByText('Occupée : Open Sabre')).toBeInTheDocument();
    expect(screen.getByText('Reçu')).toBeInTheDocument();
    expect(screen.getAllByText('En ligne')).toHaveLength(2);
    expect(screen.getByLabelText('Sélectionner la piste 4')).toBeDisabled();
    expect(calls.listVenueStripControl[0]).toEqual({ venueId: 'v1' });
  });

  it('BAD MATCH signalé ; secours ACK et Resynchroniser sur les pistes chargées', async () => {
    render(<VenueStripControlPanel venueId="v1" />);
    const badge = await screen.findByText('BAD MATCH');
    expect(badge.closest('.cyrano-alert')).toHaveAttribute(
      'title',
      expect.stringContaining('DUVAL J – MOREL L')
    );
    // Piste 3 (pilote OPP2 arrêté) et 4 (sans appareil) : aucun secours
    expect(screen.queryByRole('button', { name: 'ACK 3' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ACK 4' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ACK 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resynchroniser 1' }));
    await waitFor(() =>
      expect(calls.runStripDeviceAction).toEqual([
        { piste: '2', action: 'ack' },
        { piste: '1', action: 'resync' },
      ])
    );
  });

  it('envoi en masse : arme, noms, nations ; résultat par piste ; toutes ; remise à blanc', async () => {
    render(<VenueStripControlPanel venueId="v1" />);
    await screen.findByText('Occupée : Open Sabre');
    fireEvent.click(screen.getByLabelText('Sélectionner la piste 1'));
    fireEvent.click(screen.getByLabelText('Sélectionner la piste 2'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'S' } });
    fireEvent.change(screen.getByLabelText('Nom à gauche'), { target: { value: 'Dupont L' } });
    fireEvent.change(screen.getByLabelText('Nation ou club à gauche'), {
      target: { value: 'FRA' },
    });
    fireEvent.change(screen.getByLabelText('Nom à droite'), { target: { value: 'Rossi G' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer à la sélection (2)' }));
    await waitFor(() => expect(calls.sendStripDisplay).toHaveLength(1));
    expect(calls.sendStripDisplay[0]).toEqual({
      venueId: 'v1',
      strips: [1, 2],
      weapon: 'S',
      left: { name: 'Dupont L', nat: 'FRA' },
      right: { name: 'Rossi G' },
    });
    const rows = screen.getAllByRole('row');
    expect(await within(rows[1]).findByText('Envoyé')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Refusé : piste occupée')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Sélectionner toutes les pistes'));
    fireEvent.click(screen.getByRole('button', { name: 'Remettre à blanc' }));
    await waitFor(() => expect(calls.sendStripDisplay).toHaveLength(2));
    expect(calls.sendStripDisplay[1]).toEqual({ venueId: 'v1', strips: 'all', clear: true });
  });

  it('sans sélection ni champ : rien n’est envoyé', async () => {
    render(<VenueStripControlPanel venueId="v1" />);
    await screen.findByText('Occupée : Open Sabre');
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer à la sélection (0)' }));
    fireEvent.click(screen.getByLabelText('Sélectionner la piste 1'));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer à la sélection (1)' }));
    await new Promise(r => setTimeout(r, 0));
    expect(calls.sendStripDisplay).toBeUndefined();
  });
});

describe('VenueStripBulkTools', () => {
  beforeEach(() => install());

  it('ajout en lot (IP incrémentée) puis export par contenu', async () => {
    const saveFile = vi.fn(async () => true);
    const platform = { saveFile, openFile: vi.fn() } as unknown as PlatformServices;
    const onChanged = vi.fn();
    render(
      <PlatformProvider platform={platform}>
        <VenueStripBulkTools venueId="v1" onChanged={onChanged} />
      </PlatformProvider>
    );
    fireEvent.change(screen.getByLabelText('Nombre de pistes'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('IP de la première piste'), {
      target: { value: '10.0.0.10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter en lot' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.setStripDevices[0]).toEqual({
      venueId: 'v1',
      devices: [
        { strip: 1, device: { protocol: 'cyrano', ip: '10.0.0.10' } },
        { strip: 2, device: { protocol: 'cyrano', ip: '10.0.0.11' } },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Exporter les appareils' }));
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect(saveFile.mock.calls[0]).toEqual([
      expect.objectContaining({ suggestedName: 'appareils-halle.json', content: '{"strips":[]}' }),
    ]);
  });

  it('import : erreurs du contrôle affichées ligne par ligne, rien d’écrit', async () => {
    install({
      importStripDevices: i => ({
        applied: false,
        strips: 1,
        errors: i.dryRun ? [{ line: 2, message: 'device.ip : requis' }] : [],
      }),
    });
    const platform = {
      saveFile: vi.fn(),
      openFile: vi.fn(async () => ({ name: 'a.json', content: '[]' })),
    } as unknown as PlatformServices;
    render(
      <PlatformProvider platform={platform}>
        <VenueStripBulkTools venueId="v1" onChanged={vi.fn()} />
      </PlatformProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Importer des appareils' }));
    expect(await screen.findByText('Ligne 2 : device.ip : requis')).toBeInTheDocument();
  });
});
