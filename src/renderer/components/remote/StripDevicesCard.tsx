/**
 * BPM - Escrime - Appareils des pistes de l'épreuve (#1720, #1960, docs/adr/0023)
 * Bloc « Pistes » de la saisie distante, affiché quand un pilote (Cyrano ou OPP2) tourne :
 * salle de l'épreuve, appareils des seules pistes de l'épreuve (`start` … `end`), liaison,
 * piste passée en manuel pour l'épreuve (`settings.manualStrips`), actions de secours.
 * Les pilotes se démarrent et le journal se lit dans Paramètres → Salles et pistes.
 * Licensed under GPL-3.0
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Wifi, WifiOff, AlertCircle, AlertTriangle, Circle } from 'lucide-react';
import { Icon } from '../common/Icon';
import { Button } from '../common/Button';
import { useTranslation } from '../../hooks/useTranslation';
import type { Venue } from '../../../shared/types/appSettings';
import type {
  CompetitionStripDevices,
  CyranoPisteStatus,
  EffectiveStripDevice,
  Opp2Status,
  StripDeviceAlert,
  StripDeviceLink,
} from '../../../shared/types/stripDevice';
import { errorText } from './cyranoSettings';
import { useDevicesApi } from '../../api/devicesApi';

const POLL_MS = 5000;
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

/** Appareils des pistes de l'épreuve : arène dans la plage `start` … `end` */
export function devicesInRange(
  devices: readonly EffectiveStripDevice[],
  start: number,
  end: number
): EffectiveStripDevice[] {
  return devices.filter(d => d.arena >= start && d.arena <= end);
}

interface Props {
  competitionId: string;
  /** Première et dernière piste de l'épreuve (arènes `/arene{N}`) */
  start: number;
  end: number;
}

export const StripDevicesCard: React.FC<Props> = ({ competitionId, start, end }) => {
  const { t } = useTranslation();
  const api = useDevicesApi();
  const [running, setRunning] = useState(false);
  const [statuses, setStatuses] = useState<CyranoPisteStatus[]>([]);
  const [opp2, setOpp2] = useState<Opp2Status | null>(null);
  const [routes, setRoutes] = useState<Record<string, string | null>>({});
  const [info, setInfo] = useState<CompetitionStripDevices | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** Salle et appareils effectifs de l'épreuve */
  const refreshDevices = useCallback(async () => {
    try {
      setInfo(await api.getCompetitionDevices(competitionId));
    } catch {
      setInfo(null);
    }
  }, [api, competitionId]);

  /** Liaison des appareils (pilotes), épreuve suivie par piste */
  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.cyrano.status();
      setRunning(s.running);
      setStatuses(s.pistes);
      setOpp2(await api.opp2.status());
      setRoutes(await api.routes());
    } catch {
      // Hors Electron (navigateur, tests sans pont) : pas de pilote
    }
  }, [api]);

  const anyRunning = running || !!opp2?.running;

  // État des pilotes relu en continu : le bloc apparaît dès qu'un pilote démarre
  useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), POLL_MS);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    if (!anyRunning) return;
    void refreshDevices();
    api
      .listVenues()
      .then(setVenues)
      .catch(() => {});
  }, [anyRunning, api, refreshDevices]);

  if (!anyRunning) return null;

  /** Action sur une piste : erreur affichée, état relu */
  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    }
    void refreshStatus();
  };

  const changeVenue = async (venueId: string) => {
    try {
      setInfo(await api.setCompetitionVenue(competitionId, venueId || null));
    } catch (e) {
      setError(errorText(e));
    }
    void refreshStatus();
  };

  const toggleManual = async (strip: number, manual: boolean) => {
    if (!info) return;
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

  const devices = devicesInRange(info?.devices ?? [], start, end);
  const autoVenue = venues.find(v =>
    info?.source === 'day' || info?.source === 'default' ? v.id === info.venueId : v.isDefault
  );

  return (
    <div className="cyrano-panel strip-devices-card">
      <div className="u-row-between">
        <strong>{t('rsm.devices_card')}</strong>
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

      {/* ── Salle de l'épreuve (docs/adr/0019, 0023) ── */}
      <div className="cyrano-options">
        <label className="cyrano-option">
          {t('rsm.devices_venue')}
          <select
            className="form-input cyrano-input"
            value={info?.competitionVenueId ?? ''}
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
      {error && (
        <div className="cyrano-error" role="alert">
          <Icon icon={AlertCircle} /> {error}
        </div>
      )}

      {/* ── Appareils des pistes de l'épreuve ── */}
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
      <p className="cyrano-muted cyrano-small">{t('rsm.devices_hint')}</p>
    </div>
  );
};
