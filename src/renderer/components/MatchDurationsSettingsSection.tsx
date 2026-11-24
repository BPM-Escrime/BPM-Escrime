/**
 * BPM - Escrime - Paramètres → Salles → Durées de match (#1965, lot 3)
 * Référence par arme, phase et score : réglage du DT > historique du poste > valeur par défaut.
 * Lue par l'heure de fin de phase, la simulation de formule et les indicateurs.
 * Licensed under GPL-3.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { Button } from './common/Button';
import { stationAvailable, useStationApi } from '../api/stationApi';
import type { DurationKey, DurationRow } from '../../shared/domain/durations/matchDurations';
import { HINT, BOLD, SMALL_BTN } from './settingsModal.styles';

interface View {
  changeoverMs: number;
  competitions: number;
  rows: DurationRow[];
}

const WEAPON_KEYS: Record<string, string> = {
  E: 'weapons.epee',
  F: 'weapons.foil',
  S: 'weapons.sabre',
  L: 'weapons.laser',
  C: 'weapons.custom',
};

/** m:ss (ou minutes seules) → ms ; null : vide ; NaN : illisible */
export function parseDuration(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  const m = /^(\d{1,3})(?::([0-5]\d))?$/.exec(s);
  return m ? (Number(m[1]) * 60 + Number(m[2] ?? 0)) * 1000 : NaN;
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const keyId = (k: DurationKey) =>
  `${k.weapon}-${k.phase}-${k.maxScore}-${k.gender ?? ''}-${k.category ?? ''}`;

const CELL: React.CSSProperties = { padding: '4px 8px', textAlign: 'left' };
const INPUT: React.CSSProperties = { width: 70 };
const TABLE: React.CSSProperties = { borderCollapse: 'collapse', width: '100%' };
const FOOTER: React.CSSProperties = { gap: 12, marginTop: 12, flexWrap: 'wrap' };

export const MatchDurationsSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const api = useStationApi().durations;
  const [view, setView] = useState<View | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback((v: View) => {
    setView(v);
    setDrafts({});
  }, []);

  useEffect(() => {
    if (!stationAvailable()) return;
    api
      .get()
      .then(load)
      .catch(() => undefined);
  }, [api, load]);

  if (!view) return null;

  const run = async (call: () => Promise<View>) => {
    try {
      load(await call());
    } catch {
      showToast(t('settings.durations_error'), 'error');
    }
  };

  const saveOverride = (row: DurationRow, text: string) => {
    const ms = parseDuration(text);
    const current = row.override?.medianMs ?? null;
    if (ms !== null && (Number.isNaN(ms) || ms < 30_000)) {
      showToast(t('settings.durations_error'), 'error');
      return;
    }
    if (ms === current) return;
    void run(() => api.setOverride(row.key, ms));
  };

  const saveChangeover = (text: string) => {
    const ms = parseDuration(text);
    if (ms === null || Number.isNaN(ms)) {
      showToast(t('settings.durations_error'), 'error');
      return;
    }
    if (ms !== view.changeoverMs) void run(() => api.setChangeover(ms));
  };

  const reset = async () => {
    if (await confirm(t('settings.durations_reset_confirm'))) void run(() => api.resetHistory());
  };

  const scope = (k: DurationKey) =>
    [k.gender, k.category].filter(Boolean).join(' · ') || t('settings.durations_all');

  return (
    <div className="form-group">
      <label style={BOLD}>{t('settings.durations_title')}</label>
      <p style={HINT}>{t('settings.durations_hint')}</p>
      <table style={TABLE}>
        <thead>
          <tr>
            <th style={CELL}>{t('settings.durations_weapon')}</th>
            <th style={CELL}>{t('settings.durations_phase')}</th>
            <th style={CELL}>{t('settings.durations_score')}</th>
            <th style={CELL}>{t('settings.durations_scope')}</th>
            <th style={CELL}>{t('settings.durations_reference')}</th>
            <th style={CELL}>{t('settings.durations_measured')}</th>
            <th style={CELL}>{t('settings.durations_setting')}</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map(row => {
            const id = keyId(row.key);
            const draft = drafts[id] ?? (row.override ? formatDuration(row.override.medianMs) : '');
            return (
              <tr key={id}>
                <td style={CELL}>{t(WEAPON_KEYS[row.key.weapon] ?? 'weapons.custom')}</td>
                <td style={CELL}>{t(`settings.durations_phase_${row.key.phase}`)}</td>
                <td style={CELL}>{row.key.maxScore}</td>
                <td style={CELL}>{scope(row.key)}</td>
                <td style={CELL}>
                  {formatDuration(row.reference.medianMs)}{' '}
                  <small>({t(`settings.durations_basis_${row.reference.basis}`)})</small>
                </td>
                <td style={CELL}>
                  {row.measured
                    ? `${formatDuration(row.measured.medianMs)} (${t('settings.durations_matches', {
                        count: row.measured.samples ?? 0,
                      })})`
                    : '—'}
                </td>
                <td style={CELL}>
                  <input
                    type="text"
                    inputMode="numeric"
                    style={INPUT}
                    aria-label={t('settings.durations_setting')}
                    value={draft}
                    onChange={e => setDrafts(d => ({ ...d, [id]: e.target.value }))}
                    onBlur={e => saveOverride(row, e.target.value)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="u-row" style={FOOTER}>
        <label>
          {t('settings.durations_changeover')}{' '}
          <input
            type="text"
            inputMode="numeric"
            style={INPUT}
            aria-label={t('settings.durations_changeover')}
            value={drafts.__changeover ?? formatDuration(view.changeoverMs)}
            onChange={e => setDrafts(d => ({ ...d, __changeover: e.target.value }))}
            onBlur={e => saveChangeover(e.target.value)}
          />
        </label>
        <span style={HINT}>
          {t('settings.durations_competitions', { count: view.competitions })}
        </span>
        <Button type="button" style={SMALL_BTN} onClick={() => void reset()}>
          {t('settings.durations_reset')}
        </Button>
      </div>
    </div>
  );
};

export default MatchDurationsSettingsSection;
