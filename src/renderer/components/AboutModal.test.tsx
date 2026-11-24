// @vitest-environment jsdom
/**
 * Tests de composant - AboutModal
 * BPM - Escrime
 */

import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../hooks/useTranslation', () => import('../testUtils/i18nMock'));
import AboutModal from './AboutModal';
import { fakeApiBridge } from '../testUtils/apiBridge';
import { PlatformProvider } from '../platform/PlatformContext';
import type { PlatformServices } from '../../shared/platform/PlatformServices';
import { fakeDesktop, fakePlatform } from '../../shared/platform/testing';

afterEach(() => {
  delete (window as any).electronAPI;
});

describe('AboutModal', () => {
  it('affiche le titre et la licence', () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByText('BPM - Escrime')).toBeInTheDocument();
    expect(screen.getByText(/GPL-3\.0/)).toBeInTheDocument();
  });

  it('bouton fermer déclenche onClose', () => {
    const onClose = vi.fn();
    render(<AboutModal onClose={onClose} />);
    fireEvent.click(screen.getByTitle('Fermer'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('affiche un placeholder de version sans electronAPI', () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByText('v…')).toBeInTheDocument();
  });

  it('sans bureau (navigateur, vue DT) : pas de lecture de version, pas d’erreur', () => {
    render(
      <PlatformProvider platform={fakePlatform()}>
        <AboutModal onClose={vi.fn()} />
      </PlatformProvider>
    );
    expect(screen.getByText('v…')).toBeInTheDocument();
  });

  it('affiche la version récupérée par le bureau', async () => {
    const desktop = fakeDesktop({
      getVersionInfo: vi.fn(async () => ({ version: '1.2.3', build: 42, date: '2026-01-01' })),
    });
    render(
      <PlatformProvider platform={fakePlatform({ desktop })}>
        <AboutModal onClose={vi.fn()} />
      </PlatformProvider>
    );
    await waitFor(() => expect(screen.getByText('v1.2.3')).toBeInTheDocument());
    expect(screen.getByText('#42')).toBeInTheDocument();
  });

  it('affiche le suffixe -dev.N pour un build du canal dev', async () => {
    const desktop = fakeDesktop({
      getVersionInfo: vi.fn(async () => ({
        version: '1.2.3',
        build: 42,
        date: '2026-01-01',
        channel: 'dev' as const,
      })),
    });
    render(
      <PlatformProvider platform={fakePlatform({ desktop })}>
        <AboutModal onClose={vi.fn()} />
      </PlatformProvider>
    );
    await waitFor(() => expect(screen.getByText('v1.2.3-dev.42')).toBeInTheDocument());
  });

  it('sans poste : pas de bouton de diagnostic', () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /diagnostic/i })).toBeNull();
  });

  it('rapport de diagnostic : contenu du poste enregistré par la plateforme', async () => {
    const report = '{"schemaVersion":1}\n';
    (window as any).electronAPI = {
      api: fakeApiBridge({
        getDiagnosticReport: async () => ({
          fileName: 'bpm-escrime-diagnostic-20261124T100000.json',
          content: Buffer.from(report).toString('base64'),
        }),
      }),
    };
    const saveFile = vi.fn(async () => true);
    render(
      <PlatformProvider platform={{ saveFile } as unknown as PlatformServices}>
        <AboutModal onClose={vi.fn()} />
      </PlatformProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /diagnostic/i }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    const [request] = saveFile.mock.calls[0] as unknown as [
      { suggestedName: string; content: Uint8Array },
    ];
    expect(request.suggestedName).toBe('bpm-escrime-diagnostic-20261124T100000.json');
    expect(new TextDecoder().decode(request.content)).toBe(report);
  });
});
