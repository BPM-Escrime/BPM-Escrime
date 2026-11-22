/**
 * BellePoule Modern - Planificateur de placement d'arène Sabre Laser (#2075)
 * Outil à côté du QR Wi-Fi et de la télécommande TV : saisie des dimensions de
 * la salle, nombre d'arènes, aperçu à l'échelle. La géométrie vient de
 * shared/domain/arena (pure). Export PDF : étape suivante du ticket.
 * Licensed under GPL-3.0
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import Modal from './common/Modal';
import {
  ARENA_SAFETY_RADIUS_M,
  ARENA_ZONE_RADIUS_M,
  computeArenaGeometry,
  planArenaGrid,
} from '@shared/domain/arena/arenaPlanner';

interface ArenaPlannerModalProps {
  onClose: () => void;
}

const parseNumber = (value: string): number | null => {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export const ArenaPlannerModal: React.FC<ArenaPlannerModalProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const [width, setWidth] = useState('20');
  const [length, setLength] = useState('20');
  const [arenas, setArenas] = useState('1');
  const [margin, setMargin] = useState('1');

  const parsed = useMemo(() => {
    const w = parseNumber(width);
    const l = parseNumber(length);
    const n = parseNumber(arenas);
    const m = parseNumber(margin);
    if (
      w === null ||
      l === null ||
      n === null ||
      m === null ||
      w <= 0 ||
      l <= 0 ||
      m < 0 ||
      n < 1
    ) {
      return null;
    }
    return { w, l, n: Math.floor(n), m };
  }, [width, length, arenas, margin]);

  const plan = useMemo(
    () =>
      parsed ? planArenaGrid({ widthM: parsed.w, lengthM: parsed.l }, parsed.n, parsed.m) : null,
    [parsed]
  );

  const svg = useMemo(() => {
    if (!parsed || !plan) return null;
    const pad = 1;
    const vbW = parsed.w + 2 * pad;
    const vbH = parsed.l + 2 * pad;
    const geos = plan.centers.map(c => computeArenaGeometry(c));
    return (
      <svg
        viewBox={`${-pad} ${-pad} ${vbW} ${vbH}`}
        role="img"
        aria-label={t('arenaPlanner.title')}
        style={{ width: '100%', maxHeight: '60vh', background: 'var(--color-surface, #fff)' }}
      >
        <rect
          x={0}
          y={0}
          width={parsed.w}
          height={parsed.l}
          fill="none"
          stroke="#555"
          strokeWidth={0.1}
        />
        {geos.map((g, i) => (
          <g key={i}>
            <circle
              cx={g.center.x}
              cy={g.center.y}
              r={ARENA_SAFETY_RADIUS_M}
              fill="none"
              stroke="#2e7d32"
              strokeWidth={0.08}
              strokeDasharray="0.4 0.2"
            />
            <circle
              cx={g.center.x}
              cy={g.center.y}
              r={ARENA_ZONE_RADIUS_M}
              fill="#fde047"
              fillOpacity={0.6}
              stroke="#dc2626"
              strokeWidth={0.08}
            />
            <line
              x1={g.center.x + g.guardLines.red}
              y1={g.center.y - 0.6}
              x2={g.center.x + g.guardLines.red}
              y2={g.center.y + 0.6}
              stroke="#dc2626"
              strokeWidth={0.12}
            />
            <line
              x1={g.center.x + g.guardLines.green}
              y1={g.center.y - 0.6}
              x2={g.center.x + g.guardLines.green}
              y2={g.center.y + 0.6}
              stroke="#2e7d32"
              strokeWidth={0.12}
            />
            {g.roles.map(r => (
              <g key={r.label}>
                <circle cx={r.position.x} cy={r.position.y} r={0.35} fill="#111" />
                <text
                  x={r.position.x}
                  y={r.position.y + 0.15}
                  fontSize={0.45}
                  fill="#fff"
                  textAnchor="middle"
                >
                  {r.label}
                </text>
              </g>
            ))}
          </g>
        ))}
      </svg>
    );
  }, [parsed, plan, t]);

  return (
    <Modal title={t('arenaPlanner.title')} onClose={onClose} size="lg" scroll>
      <p>{t('arenaPlanner.hint')}</p>
      <div className="form-group">
        <label className="form-label" htmlFor="arena-width">
          {t('arenaPlanner.width')}
        </label>
        <input
          id="arena-width"
          className="form-input"
          type="text"
          inputMode="decimal"
          value={width}
          onChange={e => setWidth(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="arena-length">
          {t('arenaPlanner.length')}
        </label>
        <input
          id="arena-length"
          className="form-input"
          type="text"
          inputMode="decimal"
          value={length}
          onChange={e => setLength(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="arena-count">
          {t('arenaPlanner.arenas')}
        </label>
        <input
          id="arena-count"
          className="form-input"
          type="text"
          inputMode="numeric"
          value={arenas}
          onChange={e => setArenas(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="arena-margin">
          {t('arenaPlanner.margin')}
        </label>
        <input
          id="arena-margin"
          className="form-input"
          type="text"
          inputMode="decimal"
          value={margin}
          onChange={e => setMargin(e.target.value)}
        />
      </div>

      {!parsed || !plan ? (
        <p role="alert">{t('arenaPlanner.invalid')}</p>
      ) : (
        <>
          <p role="status">
            {plan.fits ? t('arenaPlanner.fits') : t('arenaPlanner.nofit')}
            {' — '}
            {t('arenaPlanner.grid', { columns: plan.columns, rows: plan.rows })}
          </p>
          <p>
            {t('arenaPlanner.required', {
              width: plan.requiredWidthM,
              length: plan.requiredLengthM,
            })}
          </p>
          {svg}
          <ul>
            <li>{t('arenaPlanner.legend_zone')}</li>
            <li>{t('arenaPlanner.legend_safety')}</li>
            <li>{t('arenaPlanner.legend_guard')}</li>
            <li>{t('arenaPlanner.legend_roles')}</li>
          </ul>
          <p>{t('arenaPlanner.note')}</p>
        </>
      )}
    </Modal>
  );
};

export default ArenaPlannerModal;
