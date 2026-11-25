/**
 * BPM - Escrime - Pilotes des appareils de piste, depuis la salle (#1720, #1960, docs/adr/0023)
 * Démarrage et arrêt des pilotes Cyrano (UDP) et OPP2 (MQTT), port, interface d'écoute, envoi
 * des HELLO (ADR-0038), démarrage avec la saisie distante, options d'affichage des noms,
 * journal des trames et son export. Réglages du poste : valables pour toutes les épreuves.
 * Licensed under GPL-3.0
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Icon } from './common/Icon';
import { Button } from './common/Button';
import { useTranslation } from '../hooks/useTranslation';
import {
  CYRANO_HELLO_MODES,
  type CyranoFrameLog,
  type CyranoHelloMode,
  type Opp2Status,
} from '../../shared/types/stripDevice';
import {
  errorText,
  formatCyranoLog,
  readAutoStart,
  readHelloMode,
  readHost,
  readOpp2Port,
  readOptions,
  readPort,
  startCyranoFromSaved,
  startOpp2FromSaved,
  writeAutoStart,
  writeHelloMode,
  writeHost,
  writeOpp2Port,
  writeOptions,
  writePort,
  type CyranoOptions,
} from './remote/cyranoSettings';
import { useRemoteApi } from '../api/remoteApi';
import { useDevicesApi } from '../api/devicesApi';

const POLL_MS = 5000;
const LOG_LINES = 200;

/** Saisie d'un port : entier 1…65535, sinon null */
const portInput = (raw: string): number | null => {
  const v = parseInt(raw, 10);
  return v >= 1 && v <= 65535 ? v : null;
};

export const StripDriversPanel: React.FC = () => {
  const { t } = useTranslation();
  const remote = useRemoteApi();
  const api = useDevicesApi();
  const [running, setRunning] = useState(false);
  const [runningHello, setRunningHello] = useState<CyranoHelloMode | null>(null);
  const [opp2, setOpp2] = useState<Opp2Status | null>(null);
  const [udpPort, setUdpPort] = useState<number>(readPort);
  const [opp2Port, setOpp2Port] = useState<number>(readOpp2Port);
  const [hello, setHello] = useState<CyranoHelloMode>(readHelloMode);
  const [options, setOptionsState] = useState<CyranoOptions>(readOptions);
  const { nameLength, natSource, international } = options;
  const [host, setHost] = useState<string>(readHost);
  const [interfaces, setInterfaces] = useState<{ name: string; address: string }[]>([]);
  const [autoStart, setAutoStart] = useState<boolean>(readAutoStart);
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState<CyranoFrameLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  const showLogRef = useRef(showLog);
  useEffect(() => {
    showLogRef.current = showLog;
  }, [showLog]);

  const refresh = useCallback(async () => {
    try {
      const s = await api.cyrano.status();
      setRunning(s.running);
      setRunningHello(s.running ? s.hello : null);
      setOpp2(await api.opp2.status());
      if (showLogRef.current) setLog(await api.cyrano.log(LOG_LINES));
    } catch {
      // Hors Electron (navigateur, tests sans pont) : pas de pilote
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Interfaces réseau locales : choix de l'interface d'écoute (#1829)
  useEffect(() => {
    remote
      .getNetworkInterfaces()
      .then(res => {
        if (res?.success && res.interfaces) setInterfaces(res.interfaces);
      })
      .catch(() => {});
  }, []);

  /** Action sur les pilotes : erreur affichée, état relu */
  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      const res = (await action()) as { success?: boolean; error?: string } | undefined;
      if (res && res.success === false) setError(res.error ?? 'start_failed');
    } catch (e) {
      setError(errorText(e));
    }
    void refresh();
  };

  const updateOptions = (patch: Partial<CyranoOptions>) => {
    const next = { ...options, ...patch };
    setOptionsState(next);
    writeOptions(next);
    if (running || opp2?.running) void api.setOptions(patch).catch(() => {});
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

  return (
    <section className="cyrano-panel strip-drivers" aria-label={t('stripControl.drivers_title')}>
      <h4 className="strip-control-title">{t('stripControl.drivers_title')}</h4>
      <p className="cyrano-muted cyrano-small">{t('stripControl.drivers_hint')}</p>

      {/* ── Pilote Cyrano : port, envoi des HELLO, interface, démarrage ── */}
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
          aria-label={t('rsm.cyrano_port')}
          onChange={e => {
            const v = portInput(e.target.value);
            if (v) {
              setUdpPort(v);
              writePort(v);
            }
          }}
        />
        <label className="cyrano-muted cyrano-nowrap" htmlFor="cyrano-hello">
          {t('rsm.cyrano_hello')}
        </label>
        <select
          id="cyrano-hello"
          className="form-input cyrano-input"
          value={running && runningHello ? runningHello : hello}
          disabled={running}
          title={t('rsm.cyrano_hello_title')}
          onChange={e => {
            const v = e.target.value as CyranoHelloMode;
            setHello(v);
            writeHelloMode(v);
          }}
        >
          {CYRANO_HELLO_MODES.map(m => (
            <option key={m} value={m}>
              {t(`rsm.cyrano_hello_${m}`)}
            </option>
          ))}
        </select>
        {running ? (
          <Button size="sm" variant="danger" onClick={() => void act(() => api.cyrano.stop())}>
            {t('rsm.cyrano_stop')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void act(() => startCyranoFromSaved(null, api))}
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
          aria-label={t('rsm.opp2_port')}
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
            onClick={() => void act(() => startOpp2FromSaved(null, api))}
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

      {/* ── Journal des trames (#1829) : celui du poste, toutes épreuves confondues ── */}
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
    </section>
  );
};

export default StripDriversPanel;
