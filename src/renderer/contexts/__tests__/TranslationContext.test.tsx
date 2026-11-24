// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { TranslationProvider, useTranslation, type Language } from '../TranslationContext';
import { getActiveLocale } from '@shared/utils/localeFormat';
import { eventfulBridge } from '../../testUtils/stationBridge';
import { PlatformProvider } from '../../platform/PlatformContext';
import { fakeDesktop, fakePlatform } from '../../../shared/platform/testing';

let api: ReturnType<typeof useTranslation>;
function Probe() {
  api = useTranslation();
  return (
    <>
      <span data-testid="lang">{api.language}</span>
      <span data-testid="locale">{getActiveLocale()}</span>
    </>
  );
}

async function mount(lang: Language) {
  localStorage.setItem('bellepoule-language', lang);
  render(
    <TranslationProvider>
      <Probe />
    </TranslationProvider>
  );
  await screen.findByText(lang);
}

describe('TranslationContext : langue active (#1160)', () => {
  beforeEach(() => localStorage.clear());

  it('attribut lang du document et formats Intl suivent la langue', async () => {
    await mount('de');
    expect(document.documentElement.lang).toBe('de');
    expect(getActiveLocale()).toBe('de-DE');
    await act(() => api.changeLanguage('zh-HK'));
    expect(document.documentElement.lang).toBe('zh-HK');
    expect(getActiveLocale()).toBe('zh-HK');
  });

  it('enfants rendus avec la nouvelle langue (date des cartes, #1213)', async () => {
    await mount('fr');
    expect(screen.getByTestId('locale').textContent).toBe('fr-FR');
    await act(() => api.changeLanguage('en'));
    expect(screen.getByTestId('locale').textContent).toBe('en-GB');
  });

  it('paramètre 0 interpolé (plus remplacé par le gabarit)', async () => {
    await mount('fr');
    (api.translations as Record<string, unknown>).test = { count: '{{count}} tireurs' };
    expect(api.t('test.count', { count: 0 })).toBe('0 tireurs');
  });

  it('pluriel : clés _one / _other selon Intl.PluralRules', async () => {
    await mount('en');
    (api.translations as Record<string, unknown>).test = {
      fencers_one: '{{count}} fencer',
      fencers_other: '{{count}} fencers',
    };
    expect(api.t('test.fencers', { count: 0 })).toBe('0 fencers');
    expect(api.t('test.fencers', { count: 1 })).toBe('1 fencer');
    expect(api.t('test.fencers', { count: 2 })).toBe('2 fencers');
    expect(api.t('test.missing', { count: 2 })).toBe('test.missing');
  });
});

describe('TranslationContext : réglages changés par l’agent (#1880)', () => {
  let emit: (name: string, event: unknown) => void;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let get: Mock<() => Promise<{ language: string; theme: string }>>;

  beforeEach(() => {
    localStorage.clear();
    get = vi.fn(async () => ({ language: 'en', theme: 'dark' }));
    const bridge = eventfulBridge({ getStationSettings: () => get() });
    emit = bridge.emit;
    unsubscribe = vi.fn(bridge.api.unsubscribe);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      api: { ...bridge.api, unsubscribe },
    };
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('applique la langue et le thème de la base sur onStationSettingsChanged', async () => {
    await mount('fr');
    await act(async () => {
      emit('onStationSettingsChanged', {});
    });
    await waitFor(() => expect(screen.getByTestId('lang').textContent).toBe('en'));
    expect(api.theme).toBe('dark');
    expect(document.body.classList.contains('theme-dark')).toBe(true);
    expect(localStorage.getItem('bellepoule-language')).toBe('en');
    expect(localStorage.getItem('bellepoule-theme')).toBe('dark');
  });

  it('ignore les valeurs identiques et inconnues', async () => {
    await mount('fr');
    expect(get).not.toHaveBeenCalled();
    get.mockResolvedValue({ language: 'fr', theme: 'default' });
    await act(async () => {
      emit('onStationSettingsChanged', {});
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('bellepoule-theme')).toBeNull();
    get.mockResolvedValue({ language: 'xx', theme: 'neon' });
    await act(async () => {
      emit('onStationSettingsChanged', {});
    });
    expect(screen.getByTestId('lang').textContent).toBe('fr');
    expect(api.theme).toBe('default');
  });

  it('se désabonne au démontage', async () => {
    const { unmount } = render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>
    );
    await screen.findByText('fr');
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe('TranslationContext : langue du bureau (ADR-0030)', () => {
  beforeEach(() => localStorage.clear());

  it('langue initiale du bureau, menu natif prévenu au changement', async () => {
    localStorage.setItem('bellepoule-language', 'fr');
    const desktop = fakeDesktop({ initialLanguage: 'de' });
    render(
      <PlatformProvider platform={fakePlatform({ desktop })}>
        <TranslationProvider>
          <Probe />
        </TranslationProvider>
      </PlatformProvider>
    );
    await screen.findByText('de');
    expect(localStorage.getItem('bellepoule-language')).toBe('de');
    await act(() => api.changeLanguage('en'));
    expect(desktop.notifyLanguageChanged).toHaveBeenCalledWith('en');
  });

  it('sans bureau (navigateur, vue DT) : langue du localStorage, aucune erreur', async () => {
    localStorage.setItem('bellepoule-language', 'es');
    render(
      <PlatformProvider platform={fakePlatform()}>
        <TranslationProvider>
          <Probe />
        </TranslationProvider>
      </PlatformProvider>
    );
    await screen.findByText('es');
    await act(() => api.changeLanguage('it'));
    expect(screen.getByTestId('lang').textContent).toBe('it');
  });
});
