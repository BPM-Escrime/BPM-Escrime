/**
 * BPM - Escrime - Éditeur de thème arène
 * Permet de créer, sauvegarder, importer et exporter des thèmes visuels personnalisés.
 * État et actions : themeEditor/useThemeEditor ; variables : themeEditor/themeEditorDefaults (#2200).
 * Licensed under GPL-3.0
 */

import React from 'react';
import { CustomTheme, ThemeTargetType } from '../../shared/types/remote';
import { Copy } from 'lucide-react';
import { RankMedal } from './common/RankMedal';
import { useThemeEditor } from './themeEditor/useThemeEditor';
import { VarRow } from './themeEditor/VarRow';
import {
  DARK_DEFAULTS,
  KIOSK_DEFAULTS,
  POOL_DEFAULTS,
  PUBLIC_DEFAULTS,
  REFEREE_DEFAULTS,
  VIRTUAL_H,
  VIRTUAL_W,
  loadSavedThemes,
  saveSavedThemes,
  STORAGE_KEY,
} from './themeEditor/themeEditorDefaults';

// ──────────────────────────────────────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────────────────────────────────────
interface ThemeEditorProps {
  /** Arène cible (ex: 'arena1') ou 'all' pour toutes les arènes */
  targetArenaId: string;
  /** Section cible : 'arena' (défaut), 'kiosk', 'public', 'referee', 'pool' */
  targetType?: ThemeTargetType;
  /** Thème initial à éditer (undefined = nouveau thème depuis dark) */
  initialTheme?: CustomTheme;
  /** Callback quand l'utilisateur applique le thème */
  onApply: (arenaId: string, theme: CustomTheme) => void;
  onClose: () => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Composant
// ──────────────────────────────────────────────────────────────────────────────
const ThemeEditor: React.FC<ThemeEditorProps> = ({
  targetArenaId,
  targetType = 'arena',
  initialTheme,
  onApply,
  onClose,
}) => {
  const {
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
  } = useThemeEditor({ targetArenaId, targetType, initialTheme, onApply });

  return (
    <div className="theme-editor-overlay" onClick={onClose}>
      <div className="theme-editor-modal" onClick={e => e.stopPropagation()}>
        {/* ── En-tête ── */}
        <div className="theme-editor-header">
          <div>
            <h3 className="is-ff227d">{t('themeEditor.title')}</h3>
            <div className="is-de2aa7">
              {t('themeEditor.target')} <strong className="is-4017f8">{arenaLabel}</strong>
            </div>
          </div>
          <div className="u-row">
            <button
              className="theme-editor-btn secondary"
              onClick={() => {
                void handleImport();
              }}
              title={t('themeEditor.import_title')}
            >
              {t('themeEditor.import')}
            </button>
            <button
              className="theme-editor-btn secondary"
              onClick={() => {
                void handleExport();
              }}
              title={t('themeEditor.export_title')}
            >
              {t('themeEditor.export')}
            </button>
            <button
              className="theme-editor-btn close"
              aria-label={t('actions.close')}
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {importError && <div className="is-b265d1">{importError}</div>}

        <div className="theme-editor-body">
          {/* ── Panneau gauche : éditeur ── */}
          <div className="theme-editor-left">
            {/* Nom du thème */}
            <div className="is-b57afc">
              <label className="is-15dcdc">{t('themeEditor.name')}</label>
              <input
                type="text"
                value={themeName}
                readOnly={readOnly}
                onChange={e => setThemeName(e.target.value)}
                className="is-ec082d"
              />
            </div>

            {readOnly && (
              <div className="theme-editor-readonly" role="status">
                <span>{t('themeEditor.readonly_hint')}</span>
                <button className="theme-editor-btn primary" onClick={() => handleDuplicate()}>
                  {t('themeEditor.duplicate')}
                </button>
              </div>
            )}

            {/* Onglets de groupes */}
            <div className="theme-editor-tabs">
              {activeVarGroups.map((g, i) => (
                <button
                  key={g.label}
                  className={`theme-editor-tab ${activeGroup === i ? 'active' : ''}`}
                  onClick={() => setActiveGroup(i)}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {/* Variables du groupe actif */}
            <fieldset className="theme-editor-vars" disabled={readOnly}>
              {/* Contrôles image + overlay — Arrière-plans arène et kiosque */}
              {activeGroup === 0 && (
                <div className="is-e23749">
                  <div className="var-row">
                    <label className="var-label">{t('themeEditor.bg_image')}</label>
                    <div className="var-control is-e1bd73">
                      <label className="is-6de70b">
                        {t('themeEditor.choose_image')}
                        <input
                          type="file"
                          accept="image/*"
                          className="is-f2892a"
                          onChange={handleImageUpload}
                        />
                      </label>
                      {vars[bgVar]?.includes('url(') && (
                        <button
                          onClick={() => setVar(bgVar, activeDefaults[bgVar] ?? '')}
                          className="is-29b2b2"
                        >
                          {t('themeEditor.remove')}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="var-row">
                    <label className="var-label">{t('themeEditor.overlay_mode')}</label>
                    <div className="var-control">
                      <label className="u-row cursor-pointer">
                        <input
                          type="checkbox"
                          checked={overlayMode}
                          onChange={e => handleOverlayToggle(e.target.checked)}
                          className="is-11cbaa"
                        />
                        <span
                          style={{ fontSize: '0.8rem', color: overlayMode ? '#60a5fa' : '#94a3b8' }}
                        >
                          {t('themeEditor.overlay_hint')}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
              {activeVarGroups[activeGroup]?.vars.map(({ key, label, type }) => (
                <VarRow
                  key={key}
                  varKey={key}
                  label={label}
                  type={type}
                  value={vars[key] ?? activeDefaults[key] ?? ''}
                  onChange={val => setVar(key, val)}
                />
              ))}
            </fieldset>

            {/* Thèmes prédéfinis : lecture seule, duplicables */}
            <div className="mt-4">
              <div className="is-e8cb78">{t('themeEditor.builtin')}</div>
              <div className="is-9400dc">
                {builtinThemes.map(theme => (
                  <div
                    key={theme.id}
                    className={`is-56f1de${editingId === theme.id ? ' theme-editor-item-active' : ''}`}
                  >
                    <span
                      className="is-a4e5ce"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleLoadSaved(theme)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleLoadSaved(theme);
                      }}
                    >
                      {theme.name}
                    </span>
                    <button
                      onClick={() => handleDuplicate(theme)}
                      className="theme-editor-dup-btn"
                      title={t('themeEditor.duplicate')}
                    >
                      <Copy size={14} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Thèmes sauvegardés */}
            {savedThemes.length > 0 && (
              <div className="mt-4">
                <div className="is-e8cb78">{t('themeEditor.saved')}</div>
                <div className="is-9400dc">
                  {savedThemes.map(theme => (
                    <div
                      key={theme.id}
                      className={`is-56f1de${editingId === theme.id ? ' theme-editor-item-active' : ''}`}
                    >
                      <span className="is-a4e5ce" onClick={() => handleLoadSaved(theme)}>
                        {theme.name}
                      </span>
                      <button
                        onClick={() => handleDuplicate(theme)}
                        className="theme-editor-dup-btn"
                        title={t('themeEditor.duplicate')}
                      >
                        <Copy size={14} aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => handleDeleteSaved(theme.id)}
                        className="is-811a2b"
                        title={t('actions.delete')}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Panneau droit : preview ── */}
          <div className="theme-editor-right">
            <div className="is-ebb691">{t('themeEditor.live_preview')}</div>
            {/* Conteneur externe : clips + ratio 16:9 fixe */}
            <div
              ref={previewOuterRef}
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: `${VIRTUAL_W} / ${VIRTUAL_H}`,
                overflow: 'hidden',
                borderRadius: '0.5rem',
                background: '#000',
                flexShrink: 0,
              }}
            >
              {/* Canvas virtuel 1280×720 */}
              <div
                ref={previewScopeRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: `${VIRTUAL_W}px`,
                  height: `${VIRTUAL_H}px`,
                  transformOrigin: 'top left',
                  transform: `scale(${previewScale})`,
                  background: isKiosk ? 'var(--k-bg)' : 'var(--bg)',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '20px',
                  gap: '14px',
                  boxSizing: 'border-box',
                }}
              >
                {isKiosk ? (
                  // ── Aperçu Kiosk ──
                  <>
                    {/* Barre de progression */}
                    <div className="is-d2f910" />
                    {/* En-tête kiosk */}
                    <div className="is-9630d8">
                      <span className="is-d2b277">{t('themeEditor.provisional')}</span>
                      <span className="is-79253d">{t('themeEditor.sample_fencers')}</span>
                    </div>
                    {/* Lignes de classement */}
                    {[
                      {
                        rank: 1,
                        name: 'DUPONT A.',
                        club: 'Escrime Paris',
                        v: '5',
                        ind: '+12',
                        gold: true,
                      },
                      {
                        rank: 2,
                        name: 'MARTIN B.',
                        club: 'CE Orléans',
                        v: '4',
                        ind: '+8',
                        gold: false,
                      },
                      {
                        rank: 3,
                        name: 'LEROY C.',
                        club: 'EC Lyon',
                        v: '4',
                        ind: '+5',
                        gold: false,
                      },
                      {
                        rank: 4,
                        name: 'BERNARD D.',
                        club: 'Fleuret Club',
                        v: '3',
                        ind: '+1',
                        gold: false,
                      },
                    ].map((row, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 20,
                          padding: '12px 18px',
                          background: i === 0 ? 'rgba(251,191,36,0.06)' : 'var(--k-card-bg)',
                          border: `1px solid var(--k-border)`,
                          borderRadius: 10,
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: '1.625rem',
                            width: 40,
                            textAlign: 'center',
                            color: row.gold ? 'var(--k-accent)' : '#94a3b8',
                            fontWeight: 700,
                          }}
                        >
                          {row.rank <= 3 ? <RankMedal rank={row.rank} size={24} /> : row.rank}
                        </span>
                        <span className="is-fc5e01">
                          {row.name} <span className="is-cd4091">· {row.club}</span>
                        </span>
                        <span className="is-bdc612">{row.v}V</span>
                        <span className="is-2d6f20">{row.ind}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  // ── Aperçu Arène ──
                  <>
                    {/* En-tête arène */}
                    <div className="is-887608">
                      <span className="is-42acb6">{t('themeEditor.arena_1')}</span>
                      <span className="is-f59432">{t('themeEditor.in_progress')}</span>
                    </div>

                    {/* Corps du match */}
                    <div className="is-2f0e56">
                      {/* Grille combattants */}
                      <div className="is-32e44d">
                        {/* Côté rouge */}
                        <div className="is-7f769a">
                          <div className="is-ec8469" />
                          <div className="is-d8677c">{t('themeEditor.sample_a')}</div>
                          <div className="is-488bab">{t('themeEditor.sample_club_a')}</div>
                          <div className="is-91fdba">5</div>
                        </div>

                        {/* VS */}
                        <div className="is-e5ddc2">VS</div>

                        {/* Côté vert */}
                        <div className="is-85d495">
                          <div className="is-265fb3" />
                          <div className="is-d8677c">{t('themeEditor.sample_b')}</div>
                          <div className="is-488bab">{t('themeEditor.sample_club_b')}</div>
                          <div className="is-72a37b">3</div>
                        </div>
                      </div>

                      {/* Chronomètre */}
                      <div className="is-969781">02:30</div>
                    </div>

                    {/* Écran attente */}
                    <div className="is-efa7ff">
                      <span className="is-2483be">2</span> {t('themeEditor.waiting')}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Pied de page ── */}
        <div className="theme-editor-footer">
          <button className="theme-editor-btn secondary" onClick={handleSave} disabled={readOnly}>
            {t('themeEditor.save')}
          </button>
          <div className="flex-1" />
          <button className="theme-editor-btn secondary" onClick={onClose}>
            {t('actions.cancel')}
          </button>
          <button className="theme-editor-btn primary" onClick={handleApply}>
            {t('themeEditor.apply_to', { target: arenaLabel })}
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ThemeEditor);
export {
  DARK_DEFAULTS,
  KIOSK_DEFAULTS,
  POOL_DEFAULTS,
  PUBLIC_DEFAULTS,
  REFEREE_DEFAULTS,
  loadSavedThemes,
  saveSavedThemes,
  STORAGE_KEY,
};
export type { CustomTheme };
