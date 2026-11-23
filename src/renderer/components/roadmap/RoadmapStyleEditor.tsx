/**
 * BPM - Escrime - Feuille de route : couleur des bandeaux et logos d'en-tête.
 * Les logos sont rastérisés en PNG (hauteur 240 px max) : même rendu dans
 * l'aperçu, le PDF et le DOCX, fichier léger.
 * Licensed under GPL-3.0
 */

import React, { useRef } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react';
import {
  ROADMAP_ACCENTS,
  moveItem,
  nextId,
  type RoadmapLogo,
} from '@shared/domain/roadmap/roadmap';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../common/Button';

const LOGO_MAX_H = 240;
const MAX_LOGOS = 6;

/** Fichier image → PNG (data URL) réduit ; rejette si illisible */
export const rasterizeLogo = (file: File): Promise<Omit<RoadmapLogo, 'id'>> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w0 = img.naturalWidth || 300;
      const h0 = img.naturalHeight || 150;
      const k = Math.min(1, LOGO_MAX_H / h0);
      const width = Math.max(1, Math.round(w0 * k));
      const height = Math.max(1, Math.round(h0 * k));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      URL.revokeObjectURL(url);
      if (!ctx) return reject(new Error('canvas'));
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width, height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    img.src = url;
  });

interface RoadmapStyleEditorProps {
  accent: string;
  logos: RoadmapLogo[];
  onAccent: (accent: string) => void;
  onLogos: (logos: RoadmapLogo[]) => void;
  onLogoError: (name: string) => void;
}

export const RoadmapStyleEditor: React.FC<RoadmapStyleEditorProps> = ({
  accent,
  logos,
  onAccent,
  onLogos,
  onLogoError,
}) => {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    let next = [...logos];
    for (const file of Array.from(files)) {
      if (next.length >= MAX_LOGOS) break;
      try {
        const logo = await rasterizeLogo(file);
        next = [
          ...next,
          {
            id: nextId(
              'logo',
              next.map(l => l.id)
            ),
            ...logo,
          },
        ];
      } catch {
        onLogoError(file.name);
      }
    }
    onLogos(next);
  };

  return (
    <div className="roadmap-form">
      <fieldset className="roadmap-fieldset">
        <legend>{t('roadmap.accent')}</legend>
        <div className="roadmap-inline">
          {ROADMAP_ACCENTS.map((c, i) => (
            <button
              key={c}
              type="button"
              className={`roadmap-swatch roadmap-swatch--${i}${accent === c ? ' is-active' : ''}`}
              aria-label={`${t('roadmap.accent')} ${c}`}
              aria-pressed={accent === c}
              onClick={() => onAccent(c)}
            />
          ))}
          <label className="roadmap-inline roadmap-muted">
            <input
              type="color"
              value={accent}
              aria-label={t('roadmap.accent_custom')}
              onChange={e => onAccent(e.target.value.toLowerCase())}
            />
            {t('roadmap.accent_custom')}
          </label>
        </div>
      </fieldset>

      <fieldset className="roadmap-fieldset">
        <legend>{t('roadmap.logos')}</legend>
        <p className="roadmap-muted">{t('roadmap.logos_hint')}</p>
        <div className="roadmap-logo-list">
          {logos.map((l, i) => (
            <div key={l.id} className="roadmap-logo-item">
              <img src={l.dataUrl} alt="" />
              <div className="roadmap-inline">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="roadmap-icon-btn"
                  aria-label={t('roadmap.move_left')}
                  title={t('roadmap.move_left')}
                  disabled={i === 0}
                  onClick={() => onLogos(moveItem(logos, l.id, -1))}
                >
                  <ArrowLeft size={13} />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="roadmap-icon-btn"
                  aria-label={t('roadmap.move_right')}
                  title={t('roadmap.move_right')}
                  disabled={i === logos.length - 1}
                  onClick={() => onLogos(moveItem(logos, l.id, 1))}
                >
                  <ArrowRight size={13} />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="roadmap-icon-btn"
                  aria-label={t('roadmap.remove_logo')}
                  title={t('roadmap.remove_logo')}
                  onClick={() => onLogos(logos.filter(x => x.id !== l.id))}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
          multiple
          hidden
          onChange={e => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={logos.length >= MAX_LOGOS}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus size={14} /> {t('roadmap.add_logo')}
        </Button>
      </fieldset>
    </div>
  );
};
