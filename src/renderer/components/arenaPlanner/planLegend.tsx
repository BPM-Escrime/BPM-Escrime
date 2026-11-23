/**
 * BPM - Escrime - Légende du plan de salle d'arène (#2075)
 * Symboles de l'arène (zone, sécurité, mises en garde, rôles) puis un repère
 * par couleur d'élément posé (type, zone ou couleur choisie). Même liste à
 * l'écran et dans l'export PDF (pastilles dessinées dans le canvas).
 * Licensed under GPL-3.0
 */

import React, { useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import type { RoomItem } from '@shared/domain/arena/arenaPlanner';
import type { ArenaDiscipline } from '@shared/domain/arena/arenaDisciplines';
import { defaultItemColor, KIND_LABEL_KEY } from './ArenaPlanCanvas';

/** Pastille : aplat (élément, zone), anneau pointillé (sécurité), traits (mise en garde), point (rôles) */
export type LegendSwatch =
  | { shape: 'fill'; fill: string; stroke?: string }
  | { shape: 'ring'; stroke: string }
  | { shape: 'lines'; stroke: string; stroke2: string }
  | { shape: 'dot'; fill: string };

export interface LegendEntry {
  key: string;
  label: string;
  swatch: LegendSwatch;
}

/** Couleurs de arena-planner-modal.css (l'export n'a pas accès à la feuille de style) */
const ROLES: LegendSwatch = { shape: 'dot', fill: '#111827' };
const GUARD: LegendSwatch = { shape: 'lines', stroke: '#dc2626', stroke2: '#2e7d32' };
const SAFETY_RECT: LegendSwatch = { shape: 'fill', fill: '#ffffff', stroke: '#2e7d32' };
const ARENA_ENTRIES: Record<ArenaDiscipline, { key: string; swatch: LegendSwatch }[]> = {
  laser: [
    { key: 'legend_zone', swatch: { shape: 'fill', fill: '#fde047', stroke: '#dc2626' } },
    { key: 'legend_safety', swatch: { shape: 'ring', stroke: '#2e7d32' } },
    { key: 'legend_guard', swatch: GUARD },
    { key: 'legend_roles', swatch: ROLES },
  ],
  fencing: [
    { key: 'legend_piste', swatch: { shape: 'fill', fill: '#bfdbfe', stroke: '#1e3a8a' } },
    { key: 'legend_runoff', swatch: { shape: 'fill', fill: '#e5e7eb', stroke: '#1e3a8a' } },
    { key: 'legend_piste_lines', swatch: GUARD },
    { key: 'legend_piste_safety', swatch: SAFETY_RECT },
    { key: 'legend_piste_roles', swatch: ROLES },
  ],
  artistic: [
    { key: 'legend_stage', swatch: { shape: 'fill', fill: '#fde68a', stroke: '#92400e' } },
    { key: 'legend_stage_safety', swatch: SAFETY_RECT },
    { key: 'legend_stage_roles', swatch: ROLES },
  ],
};

/** Libellé d'un élément dans la légende : zone, sinon texte (couleur libre), sinon type */
const itemLegendLabel = (item: RoomItem, t: (k: string) => string): string => {
  if (item.zone && !item.color) return t(`arenaPlanner.zone_${item.zone}`);
  const text = item.label.replace(/\n/g, ' ').trim();
  if (item.color && text) return text;
  return item.zone ? t(`arenaPlanner.zone_${item.zone}`) : t(KIND_LABEL_KEY[item.kind]);
};

/** Entrées de la légende : arène, puis une par couple (libellé, couleur) des éléments posés. */
export const buildLegendEntries = (
  items: RoomItem[],
  t: (k: string) => string,
  disciplines: ArenaDiscipline[] = ['laser']
): LegendEntry[] => {
  const entries: LegendEntry[] = [...new Set(disciplines)].flatMap(d =>
    ARENA_ENTRIES[d].map(e => ({
      key: `${d}:${e.key}`,
      label: t(`arenaPlanner.${e.key}`),
      swatch: e.swatch,
    }))
  );
  const seen = new Set<string>();
  for (const item of items) {
    const fill = item.color ?? defaultItemColor(item);
    const label = itemLegendLabel(item, t);
    const key = `${label}|${fill.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ key: `item:${key}`, label, swatch: { shape: 'fill', fill, stroke: '#374151' } });
  }
  return entries;
};

const SwatchSvg: React.FC<{ swatch: LegendSwatch }> = ({ swatch }) => (
  <svg
    className="arena-planner-legend-swatch"
    viewBox="0 0 20 20"
    width={20}
    height={20}
    aria-hidden="true"
  >
    {swatch.shape === 'fill' && (
      <rect
        x={2}
        y={2}
        width={16}
        height={16}
        rx={2}
        fill={swatch.fill}
        stroke={swatch.stroke ?? 'none'}
        strokeWidth={1.5}
      />
    )}
    {swatch.shape === 'ring' && (
      <circle
        cx={10}
        cy={10}
        r={7}
        fill="none"
        stroke={swatch.stroke}
        strokeWidth={1.5}
        strokeDasharray="3 2"
      />
    )}
    {swatch.shape === 'lines' && (
      <>
        <line x1={6} y1={3} x2={6} y2={17} stroke={swatch.stroke} strokeWidth={2.5} />
        <line x1={14} y1={3} x2={14} y2={17} stroke={swatch.stroke2} strokeWidth={2.5} />
      </>
    )}
    {swatch.shape === 'dot' && <circle cx={10} cy={10} r={5} fill={swatch.fill} />}
  </svg>
);

export const ArenaPlanLegend: React.FC<{ title: string; entries: LegendEntry[] }> = ({
  title,
  entries,
}) => (
  <section className="arena-planner-legend-box" aria-label={title}>
    <h3 className="arena-planner-legend-title">{title}</h3>
    <ul className="arena-planner-legend">
      {entries.map(e => (
        <li key={e.key}>
          <SwatchSvg swatch={e.swatch} />
          <span>{e.label}</span>
        </li>
      ))}
    </ul>
  </section>
);

/** Options de légende : affichée à l'écran, incluse dans l'export PDF (cochées par défaut) */
export const useLegendOptions = () => {
  const [show, onShow] = useState(true);
  const [inPdf, onInPdf] = useState(true);
  return { show, inPdf, onShow, onInPdf };
};

export interface ArenaPlanLegendControlsProps {
  entries: LegendEntry[];
  show: boolean;
  inPdf: boolean;
  onShow: (v: boolean) => void;
  onInPdf: (v: boolean) => void;
}

/** Légende (si affichée) et ses deux options : affichage, inclusion dans l'export PDF */
export const ArenaPlanLegendControls: React.FC<ArenaPlanLegendControlsProps> = ({
  entries,
  show,
  inPdf,
  onShow,
  onInPdf,
}) => {
  const { t } = useTranslation();
  return (
    <>
      {show && <ArenaPlanLegend title={t('arenaPlanner.legend_title')} entries={entries} />}
      <label className="arena-planner-check">
        <input type="checkbox" checked={show} onChange={e => onShow(e.target.checked)} />
        {t('arenaPlanner.legend_show')}
      </label>
      <label className="arena-planner-check">
        <input type="checkbox" checked={inPdf} onChange={e => onInPdf(e.target.checked)} />
        {t('arenaPlanner.legend_pdf')}
      </label>
    </>
  );
};
