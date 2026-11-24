/**
 * BPM - Escrime - Éditeur de thème : état, aperçu, enregistrement, import / export
 * Extrait de ThemeEditor.tsx (#2200) : le composant ne garde que le rendu.
 * Licensed under GPL-3.0
 */
import React, { useState, useEffect, useRef } from 'react';
import type { CustomTheme, ThemeTargetType } from '../../../shared/types/remote';
import { useTranslation } from '../../hooks/useTranslation';
import { usePlatform } from '../../platform/PlatformContext';
import { useStationApi } from '../../api/stationApi';
import { getEditorBuiltinThemes, isBuiltinThemeId } from '../remote/builtinThemes';
import {
  DARK_DEFAULTS,
  KIOSK_DEFAULTS,
  KIOSK_OVERLAY_PRESET,
  OVERLAY_PRESET,
  VIRTUAL_W,
  themeTargetConfig,
} from './themeEditorDefaults';

export interface ThemeEditorOptions {
  targetArenaId: string;
  targetType?: ThemeTargetType;
  initialTheme?: CustomTheme;
  onApply: (arenaId: string, theme: CustomTheme) => void;
}

export function useThemeEditor({
  targetArenaId,
  targetType = 'arena',
  initialTheme,
  onApply,
}: ThemeEditorOptions) {
  const { t } = useTranslation();
  const platform = usePlatform();
  const effectiveType = (targetType ?? 'arena') as ThemeTargetType;
  const isKiosk = effectiveType === 'kiosk';
  const {
    defaults: activeDefaults,
    groups: activeVarGroups,
    defaultName,
  } = themeTargetConfig(effectiveType);

  const [themeName, setThemeName] = useState(initialTheme?.name ?? defaultName);
  const [vars, setVars] = useState<Record<string, string>>(() => ({
    ...activeDefaults,
    ...(initialTheme?.variables ?? {}),
  }));
  const themesApi = useStationApi().themes;
  const [savedThemes, setSavedThemes] = useState<CustomTheme[]>([]);
  const [activeGroup, setActiveGroup] = useState(0);
  // Thème en cours d'édition (null = nouveau) ; un thème prédéfini est en lecture seule
  const [editingId, setEditingId] = useState<string | null>(initialTheme?.id ?? null);
  const readOnly = editingId !== null && isBuiltinThemeId(editingId);
  const builtinThemes = React.useMemo(
    () => getEditorBuiltinThemes(effectiveType, t),
    [effectiveType, t]
  );

  // Charger les thèmes depuis l'app (filtrés par type)
  useEffect(() => {
    themesApi
      .list()
      .then(all => {
        setSavedThemes(all.filter(t => (t.targetType ?? 'arena') === effectiveType));
      })
      .catch(() => {});
  }, [themesApi, effectiveType]);
  const [importError, setImportError] = useState('');
  const [overlayMode, setOverlayMode] = useState(initialTheme?.overlayMode ?? false);

  // Canvas virtuel scalé pour le preview
  const previewOuterRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(0.3);

  // Variables du thème posées par CSSOM sur le canevas d'aperçu : aucune balise <style>
  // injectée (CSP sans 'unsafe-inline', #1157)
  const previewScopeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = previewScopeRef.current;
    if (el) for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  }, [vars]);

  useEffect(() => {
    const el = previewOuterRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setPreviewScale(entry.contentRect.width / VIRTUAL_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setVar = (key: string, value: string) => {
    if (readOnly) return;
    setVars(prev => ({ ...prev, [key]: value }));
  };

  const handleOverlayToggle = (enabled: boolean) => {
    if (readOnly) return;
    setOverlayMode(enabled);
    if (isKiosk) {
      if (enabled) {
        setVars(prev => ({ ...prev, ...KIOSK_OVERLAY_PRESET }));
      } else {
        setVars(prev => ({
          ...prev,
          '--k-card-bg': KIOSK_DEFAULTS['--k-card-bg'],
          '--k-border': KIOSK_DEFAULTS['--k-border'],
        }));
      }
    } else {
      if (enabled) {
        setVars(prev => ({ ...prev, ...OVERLAY_PRESET }));
      } else {
        setVars(prev => ({
          ...prev,
          '--match-bg': DARK_DEFAULTS['--match-bg'],
          '--score-bg': DARK_DEFAULTS['--score-bg'],
          '--timer-bg': DARK_DEFAULTS['--timer-bg'],
          '--green-side-bg': DARK_DEFAULTS['--green-side-bg'],
          '--red-side-bg': DARK_DEFAULTS['--red-side-bg'],
          '--fencer-name-color': DARK_DEFAULTS['--fencer-name-color'],
          '--fencer-club-color': DARK_DEFAULTS['--fencer-club-color'],
        }));
      }
    }
  };

  const bgVar = isKiosk ? '--k-bg' : '--bg';

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1600;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        setVar(bgVar, `url("${dataUrl}") center / cover no-repeat`);
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ── Sauvegarde dans l'app ──
  const handleSave = () => {
    if (readOnly) return;
    const id = editingId ?? `custom-${Date.now()}`;
    const theme: CustomTheme = {
      id,
      name: themeName.trim() || 'Sans nom',
      targetType: effectiveType,
      variables: vars,
      overlayMode,
    };
    themesApi
      .save(theme)
      .then(() => {
        setEditingId(id);
        setSavedThemes(prev => {
          const idx = prev.findIndex(t => t.id === id);
          return idx >= 0 ? prev.map((t, i) => (i === idx ? theme : t)) : [...prev, theme];
        });
      })
      .catch(() => {});
  };

  const handleDeleteSaved = (id: string) => {
    themesApi
      .delete(id)
      .then(() => {
        setSavedThemes(prev => prev.filter(t => t.id !== id));
        if (editingId === id) setEditingId(null);
      })
      .catch(() => {});
  };

  const handleLoadSaved = (theme: CustomTheme) => {
    setEditingId(theme.id);
    setThemeName(theme.name);
    setVars({ ...activeDefaults, ...theme.variables });
    setOverlayMode(theme.overlayMode ?? false);
  };

  /** Copie modifiable du thème affiché (base d'un nouveau thème) */
  const handleDuplicate = (theme?: CustomTheme) => {
    if (theme) {
      setVars({ ...activeDefaults, ...theme.variables });
      setOverlayMode(theme.overlayMode ?? false);
    }
    const name = theme?.name ?? themeName;
    setThemeName(t('themeEditor.copy_of', { name: name.trim() || defaultName }));
    setEditingId(null);
  };

  // ── Import / Export (IPC Electron natif) ──
  const handleExport = async () => {
    const theme: CustomTheme = {
      id: editingId && !readOnly ? editingId : `custom-${Date.now()}`,
      name: themeName.trim() || 'Mon thème',
      targetType: effectiveType,
      variables: vars,
    };
    const json = JSON.stringify(theme, null, 2);
    const safeName = theme.name.replace(/[^a-z0-9_-]/gi, '-');
    await platform.saveFile({
      suggestedName: `theme-${safeName}.json`,
      filters: [{ name: 'Thème JSON', extensions: ['json'] }],
      content: json,
      mimeType: 'application/json',
    });
  };

  const handleImport = async () => {
    const result = await platform.openFile({
      filters: [{ name: 'Thème JSON', extensions: ['json'] }],
    });
    if (!result || !result.content) return;
    try {
      const parsed: CustomTheme = JSON.parse(result.content);
      if (!parsed.variables || typeof parsed.variables !== 'object') {
        setImportError('Fichier invalide : propriété "variables" manquante');
        return;
      }
      setEditingId(null);
      setThemeName(parsed.name ?? 'Thème importé');
      setVars({ ...activeDefaults, ...parsed.variables });
      setOverlayMode(parsed.overlayMode ?? false);
      setImportError('');
    } catch {
      setImportError('Fichier JSON invalide');
    }
  };

  // ── Application ──
  const handleApply = () => {
    const theme: CustomTheme = {
      id: editingId ?? `custom-${Date.now()}`,
      name: themeName.trim() || 'Mon thème',
      targetType: effectiveType,
      variables: vars,
      overlayMode,
    };
    onApply(targetArenaId, theme);
  };

  const arenaLabel =
    effectiveType !== 'arena'
      ? t(`themeEditor.l_${effectiveType}`)
      : targetArenaId === 'all'
        ? t('themeEditor.l_all')
        : t('themeEditor.l_strip', { n: targetArenaId.replace('arena', '') });

  return {
    t,
    isKiosk,
    activeDefaults,
    activeVarGroups,
    themeName,
    setThemeName,
    vars,
    savedThemes,
    activeGroup,
    setActiveGroup,
    editingId,
    readOnly,
    builtinThemes,
    importError,
    overlayMode,
    previewOuterRef,
    previewScale,
    previewScopeRef,
    setVar,
    handleOverlayToggle,
    bgVar,
    handleImageUpload,
    handleSave,
    handleDeleteSaved,
    handleLoadSaved,
    handleDuplicate,
    handleExport,
    handleImport,
    handleApply,
    arenaLabel,
  };
}
