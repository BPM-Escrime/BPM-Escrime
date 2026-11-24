// @vitest-environment jsdom
/**
 * Paramètres → Système → Agent IA (MCP) (#1880) : jeton illisible, dossiers accessibles
 * à l'agent (défauts, choix par desktop.pickDirectory puis addAgentFolder, retrait ; ADR-0030).
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
vi.mock('../hooks/useTranslation', () => import('../testUtils/i18nMock'));
import McpSettingsSection, { mcpClientConfig } from './McpSettingsSection';
import type { McpStatus } from '../../shared/types/mcp';
import { stationElectron } from '../testUtils/stationBridge';
import { PlatformProvider } from '../platform/PlatformContext';
import { fakeDesktop, fakePlatform, type FakeDesktop } from '../../shared/platform/testing';

const status: McpStatus = {
  enabled: true,
  allowWrite: false,
  running: true,
  port: 8067,
  url: 'http://127.0.0.1:8067/mcp',
  token: 'jeton-secret',
};
const defaults = ['/home/dt/Documents'];

let mcp: Record<string, ReturnType<typeof vi.fn>>;
let settings: Record<string, ReturnType<typeof vi.fn>>;
let desktop: FakeDesktop;

beforeEach(() => {
  mcp = {
    getStatus: vi.fn(async () => status),
    setSettings: vi.fn(async () => status),
    regenerateToken: vi.fn(async () => status),
    getLog: vi.fn(async () => []),
  };
  settings = {
    getAgentFolders: vi.fn(async () => ({ folders: [], defaults })),
    addAgentFolder: vi.fn(async () => ({ folders: ['/media/usb'], defaults })),
    removeAgentFolder: vi.fn(async () => ({ folders: [], defaults })),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = stationElectron({ mcp, settings });
  desktop = fakeDesktop({ pickDirectory: vi.fn(async () => '/media/usb') });
});
afterEach(cleanup);

/** Rendu dans l'application de bureau (défaut) ou dans un navigateur (`bureau` faux) */
const renderSection = (bureau = true) =>
  render(
    <PlatformProvider platform={fakePlatform({ desktop: bureau ? desktop : false })}>
      <McpSettingsSection />
    </PlatformProvider>
  );

describe('McpSettingsSection', () => {
  it('configuration du client : URL locale et jeton porteur', () => {
    expect(JSON.parse(mcpClientConfig(status)).mcpServers['bpm-escrime']).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:8067/mcp',
      headers: { Authorization: 'Bearer jeton-secret' },
    });
  });

  it('jeton illisible : message dédié plutôt que l’erreur brute', async () => {
    mcp.getStatus.mockResolvedValue({
      ...status,
      running: false,
      url: null,
      token: '',
      error: 'token_unreadable',
    });
    render(<McpSettingsSection />);
    expect(await screen.findByRole('status')).toHaveTextContent(/Jeton illisible dans ce contexte/);
  });

  it('journal des appels : plus récent d’abord, erreurs signalées', async () => {
    mcp.getLog.mockResolvedValue([
      {
        at: '2026-12-06T09:00:00Z',
        method: 'tools/call',
        tool: 'list_competitions',
        ok: true,
        ms: 3,
      },
      { at: '2026-12-06T09:01:00Z', method: 'tools/call', tool: 'record_score', ok: false, ms: 5 },
    ]);
    render(<McpSettingsSection />);
    const tools = await screen.findAllByText(/list_competitions|record_score/);
    expect(tools.map(e => e.textContent)).toEqual(['record_score', 'list_competitions']);
    expect(screen.getByText('erreur')).toBeInTheDocument();
  });

  it('journal vide : message', async () => {
    render(<McpSettingsSection />);
    expect(await screen.findByText('Aucun appel pour le moment.')).toBeInTheDocument();
  });

  it('dossiers de l’agent : défauts, choix du dossier puis commande addAgentFolder, retrait', async () => {
    renderSection();
    expect(await screen.findByText('/home/dt/Documents')).toBeInTheDocument();
    expect(screen.getByText('par défaut')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ajouter un dossier'));
    expect(await screen.findByText('/media/usb')).toBeInTheDocument();
    expect(desktop.pickDirectory).toHaveBeenCalledTimes(1);
    expect(settings.addAgentFolder).toHaveBeenCalledWith('/media/usb');
    expect(screen.queryByText('/home/dt/Documents')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Retirer /media/usb'));
    await waitFor(() => expect(settings.removeAgentFolder).toHaveBeenCalledWith('/media/usb'));
    expect(await screen.findByText('/home/dt/Documents')).toBeInTheDocument();
  });

  it('choix annulé : rien n’est ajouté', async () => {
    desktop.pickDirectory.mockResolvedValueOnce(null);
    renderSection();
    fireEvent.click(await screen.findByText('Ajouter un dossier'));
    await waitFor(() => expect(desktop.pickDirectory).toHaveBeenCalled());
    expect(settings.addAgentFolder).not.toHaveBeenCalled();
    expect(screen.getByText('/home/dt/Documents')).toBeInTheDocument();
  });

  it('sans bureau (navigateur, vue DT) : bouton d’ajout absent, liste affichée', async () => {
    renderSection(false);
    expect(await screen.findByText('/home/dt/Documents')).toBeInTheDocument();
    expect(screen.queryByText('Ajouter un dossier')).not.toBeInTheDocument();
  });
});
