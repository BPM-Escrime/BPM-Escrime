/**
 * BPM - Escrime - Pilotage de la salle hors compétition (#2117, docs/adr/0023)
 * Grille des pistes de la salle (protocole, liaison, épreuve en cours, dernier envoi et son
 * accusé), sélection de plusieurs pistes ou de toutes, envoi en une fois de l'arme, des noms
 * et des nationalités (ou clubs), remise à blanc. Pilotes Cyrano / OPP2 : StripDriversPanel.
 * Tout passe par le contrat (useDevicesApi) : ordres d'affichage, aucun fait d'épreuve.
 * Licensed under GPL-3.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Circle, Eraser, Send, Wifi, WifiOff } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from './Toast';
import { Button } from './common/Button';
import { Icon } from './common/Icon';
import { useDevicesApi, type StripDisplayRequest } from '../api/devicesApi';
import { formatTime } from '../../shared/utils/localeFormat';
import {
  STRIP_PANEL_WEAPONS,
  type StripControlRow,
  type StripDeviceLink,
  type StripPanelWeapon,
  type StripSendOutcome,
  type VenueStripControl,
} from '../../shared/types/stripDevice';

const LINK_ICON: Record<StripDeviceLink, React.ReactNode> = {
  online: <Icon icon={Wifi} className="cyrano-st cyrano-st--online" />,
  stale: <Icon icon={AlertCircle} className="cyrano-st cyrano-st--stale" />,
  offline: <Icon icon={WifiOff} className="cyrano-st cyrano-st--offline" />,
  never: <Icon icon={Circle} className="cyrano-st cyrano-st--never" />,
};

const ACK_BADGE: Record<string, string> = {
  pending: 'badge badge-info',
  acked: 'badge badge-success',
  refused: 'badge badge-danger',
  mismatch: 'badge badge-warning',
  no_response: 'badge badge-warning',
};

const OUTCOME_BADGE: Record<StripSendOutcome, string> = {
  sent: 'badge badge-success',
  busy: 'badge badge-danger',
  offline: 'badge badge-warning',
  not_declared: 'badge',
  unavailable: 'badge badge-warning',
};

/** Rafraîchissement de la liaison tant que la grille est ouverte */
const POLL_MS = 4000;

interface Props {
  venueId: string;
}

/** Demande d'envoi : seuls les champs saisis partent (champ vide = inchangé) */
export function buildRequest(form: {
  weapon: StripPanelWeapon | '';
  leftName: string;
  leftNat: string;
  rightName: string;
  rightNat: string;
}): StripDisplayRequest {
  const side = (name: string, nat: string) => {
    const s = {
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(nat.trim() ? { nat: nat.trim() } : {}),
    };
    return Object.keys(s).length ? s : undefined;
  };
  const left = side(form.leftName, form.leftNat);
  const right = side(form.rightName, form.rightNat);
  return {
    ...(form.weapon ? { weapon: form.weapon } : {}),
    ...(left ? { left } : {}),
    ...(right ? { right } : {}),
  };
}

const VenueStripControlPanel: React.FC<Props> = ({ venueId }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const api = useDevicesApi();
  const [grid, setGrid] = useState<VenueStripControl | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [form, setForm] = useState({
    weapon: '' as StripPanelWeapon | '',
    leftName: '',
    leftNat: '',
    rightName: '',
    rightNat: '',
  });
  const [results, setResults] = useState<Map<number, StripSendOutcome>>(new Map());
  const [sending, setSending] = useState(false);

  const reload = useCallback(async () => {
    try {
      setGrid(await api.control.list(venueId));
    } catch {
      // hors Electron (tests, navigateur)
    }
  }, [api, venueId]);

  useEffect(() => {
    void reload();
    const off = api.control.onChange(() => void reload());
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [api, reload]);

  const declared = useMemo(() => grid?.strips.filter(s => s.protocol) ?? [], [grid]);
  const allSelected = declared.length > 0 && declared.every(s => selected.has(s.strip));

  const toggle = (strip: number) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(strip)) next.delete(strip);
      else next.add(strip);
      return next;
    });

  const send = async (clear: boolean) => {
    if (selected.size === 0) {
      showToast(t('stripControl.no_selection'), 'error');
      return;
    }
    const request = clear ? { clear: true } : buildRequest(form);
    if (Object.keys(request).length === 0) {
      showToast(t('stripControl.nothing'), 'error');
      return;
    }
    setSending(true);
    try {
      const strips = allSelected ? ('all' as const) : [...selected].sort((a, b) => a - b);
      const out = await api.control.send(venueId, strips, request);
      setResults(new Map(out.map(r => [r.strip, r.outcome])));
      const ok = out.filter(r => r.outcome === 'sent').length;
      showToast(
        t('stripControl.sent_summary', { sent: ok, refused: out.length - ok }),
        ok === out.length ? 'success' : 'warning'
      );
      await reload();
    } catch {
      showToast(t('stripControl.failed'), 'error');
    } finally {
      setSending(false);
    }
  };

  if (!grid) return null;

  const lastCell = (row: StripControlRow) => {
    if (!row.last) return null;
    return (
      <span className="strip-control-last">
        <span className="cyrano-muted">{formatTime(row.last.at)}</span>
        {row.last.clear && <span className="cyrano-muted">{t('stripControl.last_clear')}</span>}
        <span className={ACK_BADGE[row.last.ack]}>{t(`stripControl.ack_${row.last.ack}`)}</span>
        {row.last.ack === 'mismatch' && row.last.diff && row.last.diff.length > 0 && (
          <span className="cyrano-muted">
            {row.last.diff.map(f => t(`stripControl.${f}`)).join(', ')}
          </span>
        )}
      </span>
    );
  };

  return (
    <section className="strip-control" aria-label={t('stripControl.title')}>
      <h4 className="strip-control-title">{t('stripControl.title')}</h4>
      <p className="cyrano-muted cyrano-small">{t('stripControl.hint')}</p>

      {declared.length === 0 ? (
        <p className="cyrano-muted">{t('stripControl.no_devices')}</p>
      ) : (
        <>
          <div className="cyrano-table-wrap">
            <table className="cyrano-table strip-control-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      aria-label={t('stripControl.select_all')}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(declared.map(s => s.strip)))
                      }
                    />
                  </th>
                  <th>{t('stripControl.col_strip')}</th>
                  <th>{t('stripControl.col_protocol')}</th>
                  <th>{t('stripControl.col_link')}</th>
                  <th>{t('stripControl.col_use')}</th>
                  <th>{t('stripControl.col_last')}</th>
                  <th>{t('stripControl.col_result')}</th>
                </tr>
              </thead>
              <tbody>
                {grid.strips.map(row => {
                  const outcome = results.get(row.strip);
                  return (
                    <tr key={row.strip} className={row.busy ? 'strip-control-busy' : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          disabled={!row.protocol}
                          checked={selected.has(row.strip)}
                          aria-label={t('stripControl.select_strip', { number: row.strip })}
                          onChange={() => toggle(row.strip)}
                        />
                      </td>
                      <td>
                        <strong>{row.strip}</strong>
                        {row.label && <span className="cyrano-muted"> {row.label}</span>}
                      </td>
                      <td>{row.protocol ? t(`venues.protocol_${row.protocol}`) : '—'}</td>
                      <td>
                        {row.protocol &&
                          (row.link ? (
                            <span className="strip-control-link">
                              {LINK_ICON[row.link]} {t(`stripControl.link_${row.link}`)}
                            </span>
                          ) : (
                            <span className="cyrano-muted">{t('stripControl.link_none')}</span>
                          ))}
                      </td>
                      <td>
                        {row.protocol &&
                          (row.busy ? (
                            <span className="badge badge-danger">
                              {t('stripControl.busy', { title: row.busy.title })}
                            </span>
                          ) : (
                            <span className="cyrano-muted">{t('stripControl.free')}</span>
                          ))}
                      </td>
                      <td>{lastCell(row)}</td>
                      <td>
                        {outcome && (
                          <span className={OUTCOME_BADGE[outcome]}>
                            {t(`stripControl.outcome_${outcome}`)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="strip-control-form">
            <label className="cyrano-option">
              {t('stripControl.weapon')}
              <select
                className="form-select"
                value={form.weapon}
                onChange={e =>
                  setForm({ ...form, weapon: e.target.value as StripPanelWeapon | '' })
                }
              >
                <option value="">{t('stripControl.weapon_keep')}</option>
                {STRIP_PANEL_WEAPONS.map(w => (
                  <option key={w} value={w}>
                    {t(`stripControl.weapon_${w}`)}
                  </option>
                ))}
              </select>
            </label>
            {(['left', 'right'] as const).map(side => (
              <fieldset key={side} className="strip-control-side">
                <legend>{t(`stripControl.${side}`)}</legend>
                <input
                  type="text"
                  className="form-input"
                  maxLength={40}
                  value={form[`${side}Name`]}
                  placeholder={t('stripControl.name')}
                  aria-label={t(`stripControl.${side}_name`)}
                  onChange={e => setForm({ ...form, [`${side}Name`]: e.target.value })}
                />
                <input
                  type="text"
                  className="form-input strip-control-nat"
                  maxLength={20}
                  value={form[`${side}Nat`]}
                  placeholder={t('stripControl.nat')}
                  aria-label={t(`stripControl.${side}_nat`)}
                  onChange={e => setForm({ ...form, [`${side}Nat`]: e.target.value })}
                />
              </fieldset>
            ))}
          </div>
          <p className="cyrano-muted cyrano-small">{t('stripControl.fields_hint')}</p>
          <div className="u-row">
            <Button
              variant="primary"
              size="sm"
              icon={<Icon icon={Send} />}
              disabled={sending}
              onClick={() => void send(false)}
            >
              {t('stripControl.send', { count: selected.size })}
            </Button>
            <Button
              size="sm"
              icon={<Icon icon={Eraser} />}
              disabled={sending}
              onClick={() => void send(true)}
            >
              {t('stripControl.clear')}
            </Button>
          </div>
          <p className="cyrano-muted cyrano-small">{t('stripControl.ack_hint')}</p>
        </>
      )}
    </section>
  );
};

export default VenueStripControlPanel;
