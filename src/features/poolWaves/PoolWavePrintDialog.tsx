/**
 * BPM - Escrime - Tournoi des rapières : choix de la plage de vagues à imprimer (#1441)
 * Impression anticipée des feuilles de match d'un intervalle de vagues (vague de départ → fin).
 * Licensed under GPL-3.0
 */

import React, { useState } from 'react';
import { useFocusTrap } from '../../renderer/hooks/useFocusTrap';
import { useTranslation } from '../../renderer/hooks/useTranslation';
import { Button } from '../../renderer/components/common/Button';

interface PoolWavePrintDialogProps {
  total: number;
  /** Vague par défaut : la vague en cours (ou la première) */
  defaultFrom: number;
  onConfirm: (from: number, to: number) => void;
  onClose: () => void;
}

const PoolWavePrintDialog: React.FC<PoolWavePrintDialogProps> = ({
  total,
  defaultFrom,
  onConfirm,
  onClose,
}) => {
  const { t } = useTranslation();
  const modalRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const [from, setFrom] = useState(Math.min(Math.max(defaultFrom, 1), total));
  const [to, setTo] = useState(total);
  const waves = Array.from({ length: total }, (_, i) => i + 1);
  const valid = from >= 1 && to >= from && to <= total;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('poolWaves.print_wave_range_title')}</h2>
        </div>
        <div className="modal-body pool-wave-print-dialog-1">
          <div className="form-group">
            <label className="form-label" htmlFor="pool-wave-print-from">
              {t('poolWaves.print_wave_from')}
            </label>
            <select
              id="pool-wave-print-from"
              className="form-input"
              value={from}
              onChange={e => {
                const v = Number(e.target.value);
                setFrom(v);
                if (to < v) setTo(v);
              }}
            >
              {waves.map(w => (
                <option key={w} value={w}>
                  {t('poolWaves.wave_n', { n: String(w) })}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="pool-wave-print-to">
              {t('poolWaves.print_wave_to')}
            </label>
            <select
              id="pool-wave-print-to"
              className="form-input"
              value={to}
              onChange={e => setTo(Number(e.target.value))}
            >
              {waves
                .filter(w => w >= from)
                .map(w => (
                  <option key={w} value={w}>
                    {t('poolWaves.wave_n', { n: String(w) })}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!valid}
            onClick={() => onConfirm(from, to)}
          >
            {t('teamEntry.print')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PoolWavePrintDialog;
