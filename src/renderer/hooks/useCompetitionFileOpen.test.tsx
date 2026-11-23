// @vitest-environment jsdom
/**
 * Ouverture d'une sauvegarde .bpm par l'écran (#1981, ADR-0021) : fichier par la plateforme,
 * fusion par le contrat ; archive chiffrée → invite du mot de passe (EncryptedBpmPrompt), mot de
 * passe faux signalé sans fermer l'invite.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
vi.mock('./useTranslation', () => import('../testUtils/i18nMock'));
import type { ApiBridge, ApiEnvelope } from '../../shared/api/client';
import type { PlatformServices } from '../../shared/platform/PlatformServices';
import { IpcClient } from '../api/IpcClient';
import { BpmClientProvider } from '../api/BpmClientContext';
import { PlatformProvider } from '../platform/PlatformContext';
import { useCompetitionFileOpen } from './useCompetitionFileOpen';
import EncryptedBpmPrompt from '../components/EncryptedBpmPrompt';

/** Contrat simulé : archive chiffrée tant que le bon mot de passe n'est pas fourni */
function setup() {
  const calls: Array<Record<string, unknown>> = [];
  const bridge: ApiBridge = {
    invoke: async (_name, raw): Promise<ApiEnvelope> => {
      const input = raw as Record<string, unknown>;
      calls.push(input);
      if (input.content !== 'QlBN') return { ok: true, data: { competitionIds: ['c1', 'c2'] } };
      if (!input.password) {
        return { ok: false, error: { code: 'password_required', message: 'requis' } };
      }
      if (input.password !== 'motdepasse') {
        return { ok: false, error: { code: 'wrong_password', message: 'faux' } };
      }
      return { ok: true, data: { competitionIds: ['c9'] } };
    },
    subscribe: async () => ({ ok: true, data: null }),
    unsubscribe: () => undefined,
    onEvent: () => () => undefined,
  };
  const openBinaryFile = vi.fn(async () => ({
    name: 'secret.bpm',
    bytes: new Uint8Array([66, 80, 77]),
  }));
  const platform = { openBinaryFile } as unknown as PlatformServices;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <BpmClientProvider client={new IpcClient(() => bridge)}>
      <PlatformProvider platform={platform}>{children}</PlatformProvider>
    </BpmClientProvider>
  );
  const onOpened = vi.fn();
  const hook = renderHook(() => useCompetitionFileOpen(onOpened), { wrapper });
  return { calls, openBinaryFile, onOpened, hook };
}

describe('useCompetitionFileOpen', () => {
  it('sauvegarde en clair : fusion directe, épreuves annoncées', async () => {
    const { hook, onOpened, calls } = setup();
    await act(() => hook.result.current.openContent('a.bpm', 'AAAA'));
    expect(calls).toEqual([{ content: 'AAAA' }]);
    expect(onOpened).toHaveBeenCalledWith(['c1', 'c2']);
    expect(hook.result.current.pending).toBeNull();
  });

  it('archive chiffrée : invite, mot de passe faux puis bon', async () => {
    const { hook, onOpened, openBinaryFile } = setup();
    await act(() => hook.result.current.openFile());
    expect(openBinaryFile).toHaveBeenCalledWith({
      filters: [{ name: 'BellePoule', extensions: ['bpm', 'db'] }],
    });
    expect(hook.result.current.pending).toEqual({ fileName: 'secret.bpm', content: 'QlBN' });
    expect(onOpened).not.toHaveBeenCalled();

    const { rerender } = render(
      <EncryptedBpmPrompt
        fileName="secret.bpm"
        onSubmit={hook.result.current.submitPassword}
        onCancel={hook.result.current.cancel}
      />
    );
    expect(screen.getByText(/secret\.bpm/)).toBeInTheDocument();
    const input = screen.getByLabelText(/secret\.bpm/);
    fireEvent.change(input, { target: { value: 'pas-le-bon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mot de passe incorrect.');
    expect(hook.result.current.pending).not.toBeNull();

    rerender(
      <EncryptedBpmPrompt
        fileName="secret.bpm"
        onSubmit={hook.result.current.submitPassword}
        onCancel={hook.result.current.cancel}
      />
    );
    fireEvent.change(input, { target: { value: 'motdepasse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith(['c9']));
    expect(hook.result.current.pending).toBeNull();
  });

  it('archive du menu : invite ouverte par requestPassword, annulation', () => {
    const { hook } = setup();
    act(() => hook.result.current.requestPassword('menu.bpm', 'QlBN'));
    expect(hook.result.current.pending?.fileName).toBe('menu.bpm');
    act(() => hook.result.current.cancel());
    expect(hook.result.current.pending).toBeNull();
  });
});
