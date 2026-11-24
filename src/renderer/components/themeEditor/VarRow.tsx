/**
 * BPM - Escrime - Éditeur de thème : ligne d'une variable (couleur, texte, taille, police)
 * Extrait de ThemeEditor.tsx (#2200).
 * Licensed under GPL-3.0
 */
import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { FONT_OPTIONS, SIZE_PRESETS } from './themeEditorDefaults';

// ──────────────────────────────────────────────────────────────────────────────
// Ligne de variable
// ──────────────────────────────────────────────────────────────────────────────
interface VarRowProps {
  varKey: string;
  label: string;
  type: 'color' | 'text' | 'size' | 'font';
  value: string;
  onChange: (v: string) => void;
}

export const VarRow: React.FC<VarRowProps> = ({ varKey, label, type, value, onChange }) => {
  const { t } = useTranslation();
  const isSimpleColor = (v: string) => /^#[0-9a-fA-F]{3,8}$/.test(v.trim());

  if (type === 'size') {
    const presets = SIZE_PRESETS[varKey] ?? {};
    const entries = Object.entries(presets);
    const currentIdx = entries.findIndex(([, v]) => v === value);
    const sliderIdx = currentIdx >= 0 ? currentIdx : 1;

    return (
      <div className="var-row">
        <label className="var-label">{label}</label>
        <div className="var-control theme-editor-1">
          <div className="u-row">
            <span className="theme-editor-2">A</span>
            <input
              type="range"
              min={0}
              max={entries.length - 1}
              step={1}
              value={sliderIdx}
              onChange={e => onChange(entries[Number(e.target.value)][1])}
              className="theme-editor-3"
            />
            <span className="theme-editor-4">A</span>
          </div>
          <div className="theme-editor-5">
            {entries.map(([name], i) => (
              <span
                key={name}
                onClick={() => onChange(entries[i][1])}
                style={{
                  fontSize: '0.62rem',
                  color: i === sliderIdx ? '#60a5fa' : '#64748b',
                  cursor: 'pointer',
                }}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (type === 'font') {
    return (
      <div className="var-row">
        <label className="var-label">{label}</label>
        <div className="var-control">
          <select
            value={value}
            onChange={e => onChange(e.target.value)}
            style={{
              flex: 1,
              padding: '0.35rem 0.5rem',
              borderRadius: '0.3rem',
              border: '1px solid #475569',
              background: '#0f172a',
              color: '#e2e8f0',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontFamily: value,
            }}
          >
            {FONT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value} style={{ fontFamily: opt.value }}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  if (type === 'color' || (type === 'text' && isSimpleColor(value))) {
    return (
      <div className="var-row">
        <label className="var-label">{label}</label>
        <div className="var-control">
          <input
            type="color"
            value={isSimpleColor(value) ? value : '#000000'}
            onChange={e => onChange(e.target.value)}
            className="theme-editor-6"
          />
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="var-text-input"
          />
        </div>
      </div>
    );
  }

  // text libre (gradients, rgba, etc.)
  return (
    <div className="var-row">
      <label className="var-label">{label}</label>
      <div className="var-control">
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '0.25rem',
            border: '1px solid #475569',
            flexShrink: 0,
            background: value,
            backgroundSize: 'cover',
          }}
        />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="var-text-input"
          placeholder={t('themeEditor.gradient_ph')}
        />
      </div>
    </div>
  );
};
