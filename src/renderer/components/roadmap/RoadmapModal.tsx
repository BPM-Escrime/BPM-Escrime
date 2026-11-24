/**
 * BPM - Escrime - Outil « Feuille de route » (menu Outils)
 * Rédaction guidée de la feuille de route d'une compétition : modèles préremplis
 * (sabre laser ASL-FFE, escrime FFE, vierge), essentiel saisi une fois et reporté
 * partout par variables, horaires suggérés, bibliothèque de lignes et de sections,
 * logos, aperçu A4 cliquable, jauge de complétude, brouillon gardé sur le poste,
 * export PDF (aperçu = PDF) et Word (.docx), fichier .json pour la partager.
 * Licensed under GPL-3.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  FileDown,
  FileText,
  FolderOpen,
  Printer,
  RotateCcw,
  Save,
} from 'lucide-react';
import type { Competition } from '@shared/types';
import { Weapon } from '@shared/types';
import {
  completeness,
  normalizeRoadmap,
  roadmapVariables,
  VARIABLE_SOURCE,
  type RoadmapDoc,
  type RoadmapInfo,
  type RoadmapPresetId,
  type RoadmapVariable,
} from '@shared/domain/roadmap/roadmap';
import { createRoadmap } from '@shared/domain/roadmap/presets';
import { formatDate } from '@shared/utils/localeFormat';
import { logger, LogCategory } from '@shared/services/logger';
import { useTranslation } from '../../hooks/useTranslation';
import { usePlatform } from '../../platform/PlatformContext';
import { useConfirm } from '../ConfirmDialog';
import { useToast } from '../Toast';
import Modal from '../common/Modal';
import { Button } from '../common/Button';
import { FieldFocusProvider, VariableChips, infoFieldId } from './roadmapFields';
import { RoadmapInfoForm } from './RoadmapInfoForm';
import { RoadmapPreview } from './RoadmapPreview';
import { RoadmapSectionsEditor } from './RoadmapSectionsEditor';
import { RoadmapStyleEditor } from './RoadmapStyleEditor';

const DRAFT_KEY = 'bpm.roadmap.draft.v1';
const PRESETS: RoadmapPresetId[] = ['laser', 'fencing', 'blank'];
type Tab = 'essentials' | 'sections' | 'style';

interface RoadmapModalProps {
  onClose: () => void;
  /** Compétition affichée : préremplit l'essentiel */
  competition?: Competition | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toDate = (v: unknown): Date | null => {
  if (v === undefined || v === null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Essentiel connu par la compétition (champs vides ignorés) */
export function infoFromCompetition(c: Competition): Partial<RoadmapInfo> {
  const out: Partial<RoadmapInfo> = {};
  if (c.title) out.title = c.title;
  const date = toDate(c.date);
  if (date) out.date = isoDay(date);
  if (c.location) out.venue = c.location;
  if (c.organizer) out.organizer = c.organizer;
  const open = toDate(c.checkInTime);
  const scratch = toDate(c.scratchTime);
  const start = toDate(c.startTime);
  if (open) out.openTime = hhmm(open);
  if (scratch) out.scratchTime = hhmm(scratch);
  if (start) out.startTime = hhmm(start);
  return out;
}

const presetFor = (c?: Competition | null): RoadmapPresetId =>
  c?.weapon === Weapon.LASER ? 'laser' : c ? 'fencing' : 'laser';

const readDraft = (): RoadmapDoc | null => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? normalizeRoadmap(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const longDate = (iso: string) =>
  formatDate(`${iso}T12:00:00Z`, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const RoadmapModal: React.FC<RoadmapModalProps> = ({ onClose, competition }) => {
  const { t } = useTranslation();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const platform = usePlatform();
  const [doc, setDoc] = useState<RoadmapDoc>(
    () =>
      readDraft() ??
      createRoadmap(presetFor(competition), competition ? infoFromCompetition(competition) : {})
  );
  const [tab, setTab] = useState<Tab>('essentials');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Brouillon du poste : la feuille survit à la fermeture de l'outil
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(doc));
    } catch {
      // Stockage plein ou indisponible : la feuille reste en mémoire
    }
  }, [doc]);

  const vars = useMemo(() => roadmapVariables(doc.info, longDate), [doc.info]);
  const progress = useMemo(() => completeness(doc, vars), [doc, vars]);
  const fileBase = `feuille-de-route${doc.info.title ? `-${slug(doc.info.title)}` : ''}`;

  const setInfo = (patch: Partial<RoadmapInfo>) =>
    setDoc(d => ({ ...d, info: { ...d.info, ...patch } }));

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pickSection = (id: string) => {
    setTab('sections');
    setExpanded(prev => new Set(prev).add(id));
    setFocusId(null);
    requestAnimationFrame(() => setFocusId(id));
  };

  // Valeur à saisir : onglet « L'essentiel », champ source mis en évidence
  const goToInfo = (key: keyof RoadmapInfo) => {
    setTab('essentials');
    requestAnimationFrame(() => {
      const el = document.getElementById(infoFieldId(key));
      el?.scrollIntoView({ block: 'center' });
      el?.focus();
    });
  };
  const goToVariable = (name: RoadmapVariable) => goToInfo(VARIABLE_SOURCE[name]);

  const applyPreset = async (preset: RoadmapPresetId) => {
    const ok = await confirm({
      message: t('roadmap.replace_confirm', { name: t(`roadmap.preset_${preset}`) }),
      confirmLabel: t('roadmap.apply'),
    });
    if (!ok) return;
    const fresh = createRoadmap(preset);
    // L'essentiel, les logos et la couleur sont gardés ; tarifs du modèle si vides
    setDoc(d => ({
      ...fresh,
      accent: d.accent,
      logos: d.logos,
      info: { ...d.info, fees: d.info.fees || fresh.info.fees },
    }));
    setExpanded(new Set());
  };

  const reset = async () => {
    const ok = await confirm({
      message: t('roadmap.reset_confirm'),
      confirmLabel: t('roadmap.reset'),
    });
    if (!ok) return;
    setDoc(
      createRoadmap(presetFor(competition), competition ? infoFromCompetition(competition) : {})
    );
    setExpanded(new Set());
    setTab('essentials');
  };

  const run = async (label: string, action: () => Promise<boolean | void>) => {
    setBusy(true);
    try {
      const done = await action();
      if (done !== false) showToast(label, 'success');
    } catch (error) {
      logger.error(LogCategory.BUSINESS, 'Feuille de route : action impossible', error as Error);
      showToast(t('roadmap.export_error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportPdf = () =>
    run(t('roadmap.exported'), async () => {
      if (!previewRef.current) return false;
      const { roadmapHtml } = await import('./roadmapPdf');
      const html = roadmapHtml(previewRef.current, doc.info.title || t('roadmap.title'));
      if (platform.capabilities.printToPdf && platform.exportPdf) {
        return platform.exportPdf(html, {
          suggestedName: `${fileBase}.pdf`,
          title: t('roadmap.export_pdf'),
        });
      }
      await platform.print(html);
      return false;
    });

  const exportDocx = () =>
    run(t('roadmap.exported'), async () => {
      const { buildRoadmapDocx } = await import('./roadmapDocx');
      const bytes = await buildRoadmapDocx(doc, vars);
      return platform.saveFile({
        suggestedName: `${fileBase}.docx`,
        filters: [{ name: 'Word', extensions: ['docx'] }],
        content: bytes,
        title: t('roadmap.export_docx'),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    });

  const saveJson = () =>
    run(t('roadmap.saved'), () =>
      platform.saveFile({
        suggestedName: `${fileBase}.json`,
        filters: [{ name: t('roadmap.file_filter'), extensions: ['json'] }],
        content: JSON.stringify(doc, null, 2),
        title: t('roadmap.save'),
        mimeType: 'application/json',
      })
    );

  const openJson = async () => {
    try {
      const file = await platform.openFile({
        filters: [{ name: t('roadmap.file_filter'), extensions: ['json'] }],
        title: t('roadmap.open'),
      });
      if (!file) return;
      const loaded = normalizeRoadmap(JSON.parse(file.content));
      if (!loaded) throw new Error('format');
      setDoc(loaded);
      setExpanded(new Set());
    } catch {
      showToast(t('roadmap.open_error'), 'error');
    }
  };

  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 100;
  const missingCount =
    progress.missingInfo.length + progress.emptyRows.length + progress.missingVariables.length;

  const footer = (
    <div className="roadmap-footer">
      <div className="roadmap-inline">
        <Button type="button" variant="ghost" size="sm" onClick={() => void reset()}>
          <RotateCcw size={14} /> {t('roadmap.reset')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => void openJson()}>
          <FolderOpen size={14} /> {t('roadmap.open')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void saveJson()}
        >
          <Save size={14} /> {t('roadmap.save')}
        </Button>
      </div>
      <div className="roadmap-inline">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void exportDocx()}>
          <FileText size={15} /> {t('roadmap.export_docx')}
        </Button>
        <Button type="button" variant="primary" disabled={busy} onClick={() => void exportPdf()}>
          {platform.capabilities.printToPdf ? <FileDown size={15} /> : <Printer size={15} />}{' '}
          {platform.capabilities.printToPdf ? t('roadmap.export_pdf') : t('roadmap.print')}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      title={t('roadmap.title')}
      onClose={onClose}
      size="xl"
      scroll
      closeOnOverlay={false}
      className="roadmap-modal"
      footer={footer}
    >
      <FieldFocusProvider>
        <div className="roadmap-topbar">
          <div className="roadmap-inline" role="group" aria-label={t('roadmap.template')}>
            <span className="roadmap-field-label">{t('roadmap.template')}</span>
            {PRESETS.map(p => (
              <Button
                key={p}
                type="button"
                size="sm"
                variant={doc.preset === p ? 'primary' : 'secondary'}
                aria-pressed={doc.preset === p}
                onClick={() => void applyPreset(p)}
              >
                {t(`roadmap.preset_${p}`)}
              </Button>
            ))}
          </div>
          <details className="roadmap-progress">
            <summary>
              {missingCount === 0 ? (
                <span className="roadmap-progress-done">
                  <CheckCircle2 size={15} /> {t('roadmap.progress_done')}
                </span>
              ) : (
                <span>{t('roadmap.progress', { done: progress.done, total: progress.total })}</span>
              )}
              <progress max={100} value={percent} aria-label={t('roadmap.missing_title')} />
            </summary>
            {missingCount > 0 && (
              <ul className="roadmap-missing-list">
                {progress.missingInfo.map(k => (
                  <li key={k}>
                    <button type="button" className="roadmap-link" onClick={() => goToInfo(k)}>
                      {t(`roadmap.info_${k}`)}
                    </button>
                  </li>
                ))}
                {progress.emptyRows.map((r, i) => (
                  <li key={`r${i}`}>
                    {t('roadmap.missing_row', { section: r.section, label: r.label || '…' })}
                  </li>
                ))}
                {progress.missingVariables.map(v => (
                  <li key={v}>
                    <button type="button" className="roadmap-link" onClick={() => goToVariable(v)}>
                      {t('roadmap.missing_variable', { name: `{${v}}` })}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
        <p className="roadmap-muted roadmap-lead">{t('roadmap.lead')}</p>

        <div className="roadmap-layout">
          <div className="roadmap-editor">
            <div className="roadmap-tabs" role="tablist">
              {(['essentials', 'sections', 'style'] as const).map(id => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={tab === id ? 'is-active' : ''}
                  onClick={() => setTab(id)}
                >
                  {t(`roadmap.tab_${id}`)}
                </button>
              ))}
            </div>
            {tab !== 'style' && <VariableChips vars={vars} onGoTo={goToVariable} />}
            {tab === 'essentials' && (
              <RoadmapInfoForm
                info={doc.info}
                onChange={setInfo}
                formatDate={longDate}
                onFromCompetition={
                  competition
                    ? () => {
                        setInfo(infoFromCompetition(competition));
                        showToast(t('roadmap.from_competition_done'), 'success');
                      }
                    : undefined
                }
              />
            )}
            {tab === 'sections' && (
              <RoadmapSectionsEditor
                sections={doc.sections}
                onChange={sections => setDoc(d => ({ ...d, sections }))}
                expanded={expanded}
                onToggle={toggle}
                focusId={focusId}
              />
            )}
            {tab === 'style' && (
              <RoadmapStyleEditor
                accent={doc.accent}
                logos={doc.logos}
                onAccent={accent => setDoc(d => ({ ...d, accent }))}
                onLogos={logos => setDoc(d => ({ ...d, logos }))}
                onLogoError={name => showToast(t('roadmap.logo_error', { name }), 'error')}
              />
            )}
            <p className="roadmap-muted roadmap-note">{t('roadmap.content_note')}</p>
          </div>
          <div className="roadmap-preview-pane">
            <div className="roadmap-preview-head roadmap-muted">{t('roadmap.preview_hint')}</div>
            <div className="roadmap-paper">
              <RoadmapPreview
                ref={previewRef}
                doc={doc}
                vars={vars}
                onPickSection={pickSection}
                onPickVariable={goToVariable}
              />
            </div>
          </div>
        </div>
      </FieldFocusProvider>
    </Modal>
  );
};

export default RoadmapModal;
