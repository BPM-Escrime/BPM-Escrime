/**
 * BPM - Escrime - Appareils de piste de la saisie distante (#1720, #1960, docs/adr/0023)
 * Salle de l'épreuve, appareils déclarés sur la salle (lecture seule : ils se déclarent dans
 * Paramètres → Salles et pistes), état de liaison, piste passée en manuel pour l'épreuve
 * (`settings.manualStrips`), démarrage des pilotes Cyrano (UDP) et OPP2 (MQTT), secours, journal.
 * Licensed under GPL-3.0
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Wifi, WifiOff, AlertCircle, AlertTriangle, Circle } from 'lucide-react';
import { Icon } from '../common/Icon';
import { Button } from '../common/Button';
import { useTranslation } from '../../hooks/useTranslation';
import type { Venue } from '../../../shared/types/appSettings';
import type {
  CompetitionStripDevices,
  CyranoFrameLog,
  CyranoPisteStatus,
  EffectiveStripDevice,
  Opp2Status,
  StripDeviceAlert,
  StripDeviceLink,
} from '../../../shared/types/stripDevice';
import {
  errorText,
  formatCyranoLog,
  readAutoStart,
  readHost,
  readOpp2Port,
  readOptions,
  readPort,
  startCyranoFromSaved,
  startOpp2FromSaved,
  writeAutoStart,
  writeHost,
  writeOpp2Port,
  writeOptions,
  writePort,
  type CyranoOptions,
} from './cyranoSettings';
import { useRemoteApi } from '../../api/remoteApi';
import { useDevicesApi } from '../../api/devicesApi';

const POLL_MS = 5000;
const LOG_LINES = 200;
const ACTIONS = ['ack', 'next', 'prev', 'resync'] as const;

const STATUS_ICONS: Record<StripDeviceLink, React.ReactNode> = {
  online: <Wifi size={14} className="cyrano-st cyrano-st--online" />,
  stale: <AlertCircle size={14} className="cyrano-st cyrano-st--stale" />,
  offline: <WifiOff size={14} className="cyrano-st cyrano-st--offline" />,
  never: <Circle size={14} className="cyrano-st cyrano-st--never" />,
};

/** Adresse lisible de l'appareil : ip:port (Cyrano) ou identifiant MQTT (OPP2) */
const addressOf = (d: EffectiveStripDevice): string =>
  d.device.protocol === 'cyrano'
    ? `${d.device.ip}${d.device.port ? `:${d.device.port}` : ''}`
    : d.piste;

/** Saisie d'un port : entier 1…65535, sinon null */
const portInput = (raw: string): number | null => {
  const v = parseInt(raw, 10);
  return v >= 1 && v <= 65535 ? v : null;
};

export const CyranoPanel: React.FC<{ competitionId: string | null }> = ({ competitionId }) => {
  const { t } = useTranslation();
  const remote = useRemoteApi();
  const api = useDevicesApi();
  const [running, setRunning] = useState(false);
  const [statuses, setStatuses] = useState<CyranoPisteStatus[]>([]);
  const [opp2, setOpp2] = useState<Opp2Status | null>(null);
  const [routes, setRoutes] = useState<Record<string, string | null>>({});
  const [info, setInfo] = useState<CompetitionStripDevices | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [udpPort, setUdpPort] = useState<number>(readPort);
  const [opp2Port, setOpp2Port] = useState<number>(readOpp2Port);
  const [options, setOptionsState] = useState<CyranoOptions>(readOptions);
  const { nameLength, natSource, international } = options;
  const [host, setHost] = useState<string>(readHost);
  const [interfaces, setInterfaces] = useState<{ name: string; address: string }[]>([]);
  const [autoStart, setAutoStart] = useState<boolean>(readAutoStart);
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState<CyranoFrameLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showLogRef = useRef(showLog);
  useEffect(() => {
    showLogRef.current = showLog;
  }, [showLog]);

  /** Salle et appareils effectifs de l'épreuve */
  const refreshDevices = useCallback(async () => {
    if (!competitionId) return;
    try {
      setInfo(await api.getCompetitionDevices(competitionId));
    } catch {
      setInfo(null);
    }
  }, [api, competitionId]);

  /** Liaison des appareils (pilotes), épreuve suivie par piste, journal */
  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.cyrano.status();
      setRunning(s.running);
      setStatuses(s.pistes);
      setOpp2(await api.opp2.status());
      setRoutes(await api.routes());
      if (showLogRef.current) setLog(await api.cyrano.log(LOG_LINES));
    } catch {
      // Hors Electron (navigateur, tests sans pont) : pas de pilote
    }
  }, [api]);

  useEffect(() => {
    void refreshDevices();
    void refreshStatus();
    api
      .listVenues()
      .then(setVenues)
      .catch(() => {});
  }, [api, refreshDevices, refreshStatus]);

  // Interfaces réseau locales : choix de l'interface d'écoute (#1829)
  useEffect(() => {
    remote
      .getNetworkInterfaces()
      .then(res => {
        if (res?.success && res.interfaces) setInterfaces(res.interfaces);
      })
      .catch(() => {});
  }, []);

  const anyRunning = running || !!opp2?.running;
  useEffect(() => {
    if (!anyRunning) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(() => {
      void refreshStatus();
    }, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [anyRunning, refreshStatus]);

  /** Action sur les pilotes : erreur affichée, état relu */
  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      const res = (await action()) as { success?: boolean; error?: string } | undefined;
      if (res && res.success === false) setError(res.error ?? 'start_failed');
    } catch (e) {
      setError(errorText(e));
    }
    void refreshStatus();
  };

  const updateOptions = (patch: Partial<CyranoOptions>) => {
    const next = { ...options, ...patch };
    setOptionsState(next);
    writeOptions(next);
    if (anyRunning) void api.setOptions(patch).catch(() => {});
  };

  const changeVenue = async (venueId: string) => {
    if (!competitionId) return;
    try {
      setInfo(await api.setCompetitionVenue(competitionId, venueId || null));
    } catch (e) {
      setError(errorText(e));
    }
    void refreshStatus();
  };

  const toggleManual = async (strip: number, manual: boolean) => {
    if (!competitionId || !info) return;
    const current = new Set(info.manualStrips);
    if (manual) current.add(strip);
    else current.delete(strip);
    try {
      await api.setManualStrips(
        competitionId,
        [...current].sort((a, b) => a - b)
      );
    } catch (e) {
      setError(errorText(e));
    }
    void refreshDevices();
  };

  const toggleLog = async () => {
    const next = !showLog;
    setShowLog(next);
    if (next) setLog(await api.cyrano.log(LOG_LINES).catch(() => [] as CyranoFrameLog[]));
  };

  const exportLog = async () => {
    const entries = await api.cyrano.log().catch(() => log);
    const blob = new Blob([formatCyranoLog(entries) + '\n'], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cyrano-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Journal : toujours sur les dernières trames, sauf si l'utilisateur a remonté pour lire (#2001)
  const logRef = useRef<HTMLPreElement>(null);
  const logStickRef = useRef(true);
  useEffect(() => {
    const el = logRef.current;
    if (showLog && el && logStickRef.current) el.scrollTop = el.scrollHeight;
  }, [log, showLog]);

  /** Liaison et alerte d'un appareil, selon son protocole */
  const linkOf = (
    d: EffectiveStripDevice
  ): { status: StripDeviceLink; alert?: StripDeviceAlert | null; detail?: string } | null => {
    if (d.device.protocol === 'cyrano') {
      const st = statuses.find(s => s.piste === d.piste);
      return st ? { status: st.status, alert: st.alert, detail: st.detectedProtocol ?? '' } : null;
    }
    const st = opp2?.pistes.find(s => s.piste === d.piste);
    return st ? { status: st.status, alert: st.alert, detail: st.device ?? '' } : null;
  };
  const isOnline = (d: EffectiveStripDevice) =>
    d.device.protocol === 'cyrano' ? running : !!opp2?.running;

  const devices = info?.devices ?? [];
  const autoVenue = venues.find(v =>
    info?.source === 'day' || info?.source === 'default' ? v.id === info.venueId : v.isDefault
  );

  return (
    <div className="arena-url-card cyrano-panel">
      {/* ── En-tête ── */}
      <div className="arena-url-header u-row-between">
        <strong>{t('rsm.devices_card')}</strong>
        <div className="cyrano-inline">
          <button
            className="btn-copy"
            onClick={() => {
              void refreshDevices();
              void refreshStatus();
            }}
            title={t('rsm.cyrano_refresh')}
          >
            <Icon icon={RefreshCw} />
          </button>
        </div>
      </div>

      {/* ── Salle de l'épreuve (docs/adr/0019, 0023) ── */}
      <div className="cyrano-options">
        <label className="cyrano-option">
          {t('rsm.devices_venue')}
          <select
            className="form-input cyrano-input"
            value={info?.competitionVenueId ?? ''}
            disabled={!competitionId}
            onChange={e => {
              void changeVenue(e.target.value);
            }}
          >
            <option value="">
              {autoVenue
                ? t('rsm.devices_venue_auto', { name: autoVenue.name })
                : t('rsm.devices_venue_none')}
            </option>
            {venues.map(v => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="cyrano-muted cyrano-small">{t('rsm.devices_hint')}</p>

      {/* ── Pilote Cyrano : port, interface, démarrage ── */}
      <div className="arena-url-row cyrano-port-row">
        <span
          className={`rsm-status-dot rsm-status-dot--${running ? 'on' : 'off'}`}
          title={t(running ? 'rsm.cyrano_running' : 'rsm.cyrano_stopped')}
        />
        <strong className="cyrano-nowrap">{t('rsm.cyrano_card')}</strong>
        <label className="cyrano-muted cyrano-nowrap">{t('rsm.cyrano_port')}</label>
        <input
          type="number"
          className="form-input cyrano-input cyrano-w-port"
          min={1}
          max={65535}
          value={udpPort}
          disabled={running}
          onChange={e => {
            const v = portInput(e.target.value);
            if (v) {
              setUdpPort(v);
              writePort(v);
            }
          }}
        />
        {running ? (
          <Button size="sm" variant="danger" onClick={() => void act(() => api.cyrano.stop())}>
            {t('rsm.cyrano_stop')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void act(() => startCyranoFromSaved(competitionId, api))}
          >
            {t('rsm.cyrano_start')}
          </Button>
        )}
      </div>
      <div className="cyrano-options">
        <label className="cyrano-option">
          {t('rsm.cyrano_interface')}
          <select
            className="form-input cyrano-input"
            value={host}
            disabled={running}
            onChange={e => {
              setHost(e.target.value);
              writeHost(e.target.value);
            }}
          >
            <option value="">{t('rsm.cyrano_interface_all')}</option>
            {host && !interfaces.some(i => i.address === host) && (
              <option value={host}>{host}</option>
            )}
            {/* 0.0.0.0 = « Toutes les interfaces » (déjà proposé) ; le nom porte déjà l'adresse */}
            {interfaces
              .filter(i => i.address !== '0.0.0.0')
              .map(i => (
                <option key={`${i.name}-${i.address}`} value={i.address}>
                  {i.name}
                </option>
              ))}
          </select>
        </label>
        <label className="cyrano-option">
          <input
            type="checkbox"
            checked={autoStart}
            onChange={e => {
              setAutoStart(e.target.checked);
              writeAutoStart(e.target.checked);
            }}
          />
          {t('rsm.cyrano_autostart')}
        </label>
      </div>

      {/* ── Pilote OPP2 : broker MQTT intégré (#1960) ── */}
      <div className="arena-url-row cyrano-port-row">
        <span
          className={`rsm-status-dot rsm-status-dot--${opp2?.running ? 'on' : 'off'}`}
          title={t(opp2?.running ? 'rsm.cyrano_running' : 'rsm.cyrano_stopped')}
        />
        <strong className="cyrano-nowrap">{t('rsm.opp2_card')}</strong>
        <label className="cyrano-muted cyrano-nowrap">{t('rsm.opp2_port')}</label>
        <input
          type="number"
          className="form-input cyrano-input cyrano-w-port"
          min={1}
          max={65535}
          value={opp2Port}
          disabled={!!opp2?.running}
          onChange={e => {
            const v = portInput(e.target.value);
            if (v) {
              setOpp2Port(v);
              writeOpp2Port(v);
            }
          }}
        />
        {opp2?.running ? (
          <Button size="sm" variant="danger" onClick={() => void act(() => api.opp2.stop())}>
            {t('rsm.cyrano_stop')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void act(() => startOpp2FromSaved(competitionId, api))}
          >
            {t('rsm.cyrano_start')}
          </Button>
        )}
        {opp2?.running && (
          <span className="cyrano-muted cyrano-small">
            {t('rsm.opp2_clients', { n: opp2.clients })}
          </span>
        )}
      </div>
      {error && (
        <div className="cyrano-error" role="alert">
          <Icon icon={AlertCircle} /> {error}
        </div>
      )}

      {/* ── Appareils de la salle ── */}
      <div className="cyrano-table-wrap">
        <table className="cyrano-table">
          <thead>
            <tr>
              <th>{t('rsm.cyrano_piste_id')}</th>
              <th>{t('rsm.cyrano_protocol')}</th>
              <th>{t('rsm.devices_address')}</th>
              <th>{t('rsm.cyrano_arena')}</th>
              <th>{t('rsm.cyrano_mode')}</th>
              <th>{t('rsm.cyrano_status')}</th>
              <th>{t('rsm.devices_manual')}</th>
              <th>{t('rsm.cyrano_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 && (
              <tr>
                <td colSpan={8} className="cyrano-empty">
                  {t('rsm.devices_none')}
                </td>
              </tr>
            )}
            {devices.map(d => {
              const link = linkOf(d);
              const route = routes[d.piste];
              return (
                <tr key={`${d.device.protocol}-${d.strip}`}>
                  <td>
                    {d.strip}
                    {d.label ? ` · ${d.label}` : ''}
                  </td>
                  <td>
                    {d.device.protocol === 'cyrano'
                      ? `Cyrano ${d.device.version && d.device.version !== 'auto' ? d.device.version : ''}`.trim()
                      : 'OPP2'}
                  </td>
                  <td className="cyrano-small">{addressOf(d)}</td>
                  <td>{d.arena}</td>
                  <td>{t(`rsm.cyrano_mode_${d.device.mode ?? 'master'}`)}</td>
                  <td>
                    {link ? (
                      <span className="cyrano-status">
                        {STATUS_ICONS[link.status]}
                        <span className="cyrano-muted cyrano-small">{link.detail}</span>
                        {route && route !== competitionId && (
                          <span className="cyrano-muted cyrano-small">
                            {t('rsm.cyrano_other_event')}
                          </span>
                        )}
                        {link.alert?.kind === 'bad_match' && (
                          <span
                            className="cyrano-alert"
                            title={t('rsm.cyrano_bad_match_hint', { device: link.alert.device })}
                          >
                            <Icon icon={AlertTriangle} /> {t('rsm.cyrano_bad_match')}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="cyrano-dim cyrano-small">—</span>
                    )}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={d.manual}
                      disabled={!competitionId}
                      title={t('rsm.devices_manual_title')}
                      aria-label={t('rsm.devices_manual_strip', { number: d.strip })}
                      onChange={e => {
                        void toggleManual(d.strip, e.target.checked);
                      }}
                    />
                  </td>
                  <td>
                    {/* Actions de secours (#1829) : pilote démarré, piste chargée */}
                    {isOnline(d) && link && !d.manual && (
                      <span className="cyrano-inline">
                        {ACTIONS.map(action => (
                          <Button
                            key={action}
                            size="sm"
                            title={t(`rsm.cyrano_action_${action}_title`)}
                            onClick={() => {
                              void act(() => api.action(d.piste, action));
                            }}
                          >
                            {t(`rsm.cyrano_action_${action}`)}
                          </Button>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Options noms / nat ── */}
      <div className="cyrano-options">
        <label className="cyrano-option">
          {t('rsm.cyrano_name_length')}
          <select
            className="form-input cyrano-input"
            value={nameLength}
            onChange={e => {
              updateOptions({ nameLength: parseInt(e.target.value, 10) as 10 | 12 | 15 | 20 });
            }}
          >
            {([10, 12, 15, 20] as const).map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="cyrano-option">
          {t('rsm.cyrano_nat_source')}
          <select
            className="form-input cyrano-input"
            value={natSource}
            onChange={e => {
              updateOptions({ natSource: e.target.value as typeof natSource });
            }}
          >
            <option value="auto">{t('rsm.cyrano_auto')}</option>
            <option value="country">{t('rsm.cyrano_nat_country')}</option>
            <option value="club">{t('rsm.cyrano_nat_club')}</option>
            <option value="region">{t('rsm.cyrano_nat_region')}</option>
          </select>
        </label>
        <label className="cyrano-option">
          <input
            type="checkbox"
            checked={international}
            onChange={e => {
              updateOptions({ international: e.target.checked });
            }}
          />
          {t('rsm.cyrano_international')}
        </label>
      </div>

      {/* ── Journal des trames (#1829) ── */}
      <div className="cyrano-options">
        <Button
          size="sm"
          aria-expanded={showLog}
          onClick={() => {
            void toggleLog();
          }}
        >
          {t('rsm.cyrano_log')}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            void exportLog();
          }}
        >
          {t('rsm.cyrano_log_export')}
        </Button>
      </div>
      {showLog && (
        <pre
          ref={logRef}
          className="cyrano-log"
          aria-label={t('rsm.cyrano_log')}
          onScroll={e => {
            const el = e.currentTarget;
            logStickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {log.length === 0 ? t('rsm.cyrano_log_empty') : formatCyranoLog(log.slice(-LOG_LINES))}
        </pre>
      )}
    </div>
  );
};
