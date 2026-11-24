/**
 * BPM - Escrime - Préférences de l'application : affichage, voix, mises à jour, webhook (état et effets)
 * Licensed under GPL-3.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from '../useTranslation';
import { useFocusTrap } from '../useFocusTrap';
import type { Language } from '../../contexts/TranslationContext';
import { isConfettiDisabled } from '../../components/Confetti';
import { loadUiScale, type UiScale } from '../../services/uiScale';
import { loadUiDensity, type UiDensity } from '../../services/uiDensity';
import {
  type LogoEntry,
  loadLogoLibrary,
  saveLogoLibraryLocal,
  sanitizeLogoLibrary,
  ensureActiveInLibrary,
} from '../../services/logoLibrary';
import {
  loadTtsConfig,
  readInputModes,
  TtsConfig,
  type SettingsModalProps,
} from '../../components/settingsModal.helpers';
import { useRemoteApi } from '../../api/remoteApi';
import { stationAvailable, useStationApi } from '../../api/stationApi';
import { getPref, setPref, safeStorage } from '../../services/preferences';
import { usePlatform } from '../../platform/PlatformContext';

type Ctx = SettingsModalProps;

/** Préférences de l'application : affichage, voix, mises à jour, webhook (état et effets) (extrait de SettingsModal, #1599) */
export function useSettingsPreferences(ctx: Ctx) {
  const remote = useRemoteApi();
  const station = useStationApi();
  const desktop = usePlatform().desktop;
  const { onClose, onSave } = ctx;

  const modalRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const { t, language, theme, changeLanguage, changeTheme, pseudoLocale, setPseudoLocale } =
    useTranslation();
  const [showPdfEditor, setShowPdfEditor] = useState(false);
  const [settings, setSettings] = useState({
    language: language,
    theme: theme,
  });
  const [logo, setLogo] = useState<string | null>(() => getPref('logo'));
  const [logos, setLogos] = useState<LogoEntry[]>(() =>
    ensureActiveInLibrary(loadLogoLibrary(), getPref('logo'))
  );
  const [isDragging, setIsDragging] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Activé par défaut (journal désactivable explicitement, pas activable par défaut négatif)
  const [auditLogEnabled, setAuditLogEnabled] = useState<boolean>(() => getPref('auditLog'));

  const [quickMouseScoring, setQuickMouseScoring] = useState<boolean>(() =>
    getPref('quickMouseScoring')
  );

  const [simplifiedInputMode, setSimplifiedInputMode] = useState<boolean>(
    () => readInputModes(safeStorage).simplified
  );

  const [chainedInputMode, setChainedInputMode] = useState<boolean>(
    () => readInputModes(safeStorage).chained
  );

  const [uiScale, setUiScale] = useState<UiScale>(() => loadUiScale());
  const [uiDensity, setUiDensity] = useState<UiDensity>(() => loadUiDensity());
  const [confettiDisabled, setConfettiDisabled] = useState<boolean>(() => isConfettiDisabled());
  // Vérification auto des mises à jour : préférence stockée côté main (lue avant le 1er check)
  const [updateAutoCheck, setUpdateAutoCheck] = useState<boolean>(true);
  const [updateDir, setUpdateDir] = useState<{ dir: string; isDefault: boolean } | null>(null);
  const [updateChannel, setUpdateChannel] = useState<'stable' | 'dev' | null>(null);
  // Écran de démarrage : préférence stockée côté main (lue avant la création des fenêtres)
  const [splashEnabled, setSplashEnabledState] = useState<boolean>(true);
  useEffect(() => {
    desktop
      ?.getSplashEnabled()
      .then(setSplashEnabledState)
      .catch(() => {
        // indisponible (dev / tests)
      });
  }, [desktop]);
  useEffect(() => {
    const updater = desktop?.updater;
    updater
      ?.getDownloadDir()
      .then(r => setUpdateDir({ dir: r.dir, isDefault: r.isDefault }))
      .catch(() => {
        // updater indisponible (dev / tests)
      });
    updater
      ?.getAutoCheck()
      .then(r => setUpdateAutoCheck(r.enabled))
      .catch(() => {
        // updater indisponible (dev / tests)
      });
    updater
      ?.getChannel()
      .then(r => setUpdateChannel(r.channel))
      .catch(() => {
        // updater indisponible (dev / tests)
      });
  }, [desktop]);
  const [webhookUrl, setWebhookUrl] = useState<string>(() => getPref('webhookUrl'));
  const [webhookTestStatus, setWebhookTestStatus] = useState<
    'idle' | 'testing' | 'success' | 'error'
  >('idle');
  const [webhookTestMessage, setWebhookTestMessage] = useState<string>('');

  // Paramètres minuteur vocal (TTS) des tablettes d'arbitrage
  const [ttsConfig, setTtsConfig] = useState<TtsConfig>(() => loadTtsConfig());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    setSettings(prev => ({ ...prev, language, theme }));
  }, [language, theme]);

  // Logo actif du poste (paramètre `logo`, en base) si l'écran n'en a pas, et bibliothèque
  // du poste fusionnée avec la copie locale (getLogoLibrary, docs/adr/0022)
  useEffect(() => {
    if (!stationAvailable()) return;
    if (!logo) {
      station.settings
        .get()
        .then(({ logo: persisted }) => {
          if (persisted) {
            setLogo(persisted);
            setPref('logo', persisted);
          }
        })
        .catch(() => {
          /* logo optionnel */
        });
    }
    station.logos
      .list()
      .then(raw => {
        const disk = sanitizeLogoLibrary(raw);
        if (disk.length === 0) return;
        setLogos(prev => {
          const ids = new Set(disk.map(l => l.id));
          const merged = sanitizeLogoLibrary([...disk, ...prev.filter(l => !ids.has(l.id))]);
          const withActive = ensureActiveInLibrary(merged, getPref('logo'));
          saveLogoLibraryLocal(withActive);
          return withActive;
        });
      })
      .catch(() => {
        /* bibliothèque optionnelle */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargement du logo et de la bibliothèque au montage seulement
  }, []);

  // Liste des voix disponibles (peut arriver de façon asynchrone)
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.onvoiceschanged = refresh;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Pousse la config TTS : persistance locale + serveurs distants actifs
  const persistTtsConfig = useCallback(
    (next: TtsConfig) => {
      setTtsConfig(next);
      setPref('ttsConfig', JSON.stringify(next));
      void remote.setTtsConfig(next);
    },
    [remote]
  );

  const handleTtsVoiceChange = (voiceName: string) => {
    persistTtsConfig({ ...ttsConfig, voiceName: voiceName || null });
  };

  const handleTtsRateChange = (rate: number) => {
    persistTtsConfig({ ...ttsConfig, rate });
  };

  const handleTtsThresholdToggle = (key: string, enabled: boolean) => {
    persistTtsConfig({ ...ttsConfig, announce: { ...ttsConfig.announce, [key]: enabled } });
  };

  const handleTtsTestVoice = () => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance('30 secondes');
    const v = voices.find(x => x.name === ttsConfig.voiceName);
    if (v) {
      utt.voice = v;
      utt.lang = v.lang;
    }
    utt.rate = ttsConfig.rate;
    window.speechSynthesis.speak(utt);
  };

  const handleLanguageChange = (newLanguage: Language) => {
    setSettings(prev => ({ ...prev, language: newLanguage }));
  };

  const handleThemeChange = (newTheme: 'default' | 'light' | 'dark') => {
    setSettings(prev => ({ ...prev, theme: newTheme }));
  };

  return {
    onClose,
    onSave,
    modalRef,
    t,
    language,
    theme,
    changeLanguage,
    changeTheme,
    pseudoLocale,
    setPseudoLocale,
    showPdfEditor,
    setShowPdfEditor,
    settings,
    setSettings,
    logo,
    setLogo,
    logos,
    setLogos,
    isDragging,
    setIsDragging,
    logoError,
    setLogoError,
    fileInputRef,
    auditLogEnabled,
    setAuditLogEnabled,
    quickMouseScoring,
    setQuickMouseScoring,
    simplifiedInputMode,
    setSimplifiedInputMode,
    chainedInputMode,
    setChainedInputMode,
    uiScale,
    setUiScale,
    uiDensity,
    setUiDensity,
    confettiDisabled,
    setConfettiDisabled,
    updateAutoCheck,
    setUpdateAutoCheck,
    updateDir,
    setUpdateDir,
    updateChannel,
    setUpdateChannel,
    splashEnabled,
    setSplashEnabledState,
    webhookUrl,
    setWebhookUrl,
    webhookTestStatus,
    setWebhookTestStatus,
    webhookTestMessage,
    setWebhookTestMessage,
    ttsConfig,
    voices,
    persistTtsConfig,
    handleTtsVoiceChange,
    handleTtsRateChange,
    handleTtsThresholdToggle,
    handleTtsTestVoice,
    handleLanguageChange,
    handleThemeChange,
  };
}
