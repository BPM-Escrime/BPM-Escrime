/**
 * BPM - Escrime - Réglage de l'espace « Vue DT » de la saisie distante (#1981 lot 3, ADR-0020)
 * Consultation de l'épreuve dans un navigateur du réseau de la salle, en lecture seule.
 * Passe par le contrat : getDtViewStatus, configureDtView (pas de canal IPC dédié).
 * Licensed under GPL-3.0
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { useBpmClient } from '../../api/BpmClientContext';
import { toError } from '../../../shared/services/logger';
import { useToast } from '../Toast';
import { UrlCopyRow } from './UrlCopyRow';

interface Props {
  competitionId: string;
  /** URL du serveur distant (http(s)://ip:port) */
  serverUrl: string;
  /** Saisie distante démarrée : relit l'état à chaque changement */
  isRemoteActive: boolean;
  copiedIndex: number | null;
  onCopy: (url: string, id: number) => void;
  onQr: (url: string, label: string) => void;
}

interface DtStatus {
  running: boolean;
  enabled: boolean;
  configured: boolean;
}

export const DtViewPanel: React.FC<Props> = ({
  competitionId,
  serverUrl,
  isRemoteActive,
  copiedIndex,
  onCopy,
  onQr,
}) => {
  const { t } = useTranslation();
  const client = useBpmClient();
  const { showToast } = useToast();
  const [status, setStatus] = useState<DtStatus | null>(null);
  const [password, setPassword] = useState('');
  const url = `${serverUrl}/dt/`;

  useEffect(() => {
    let alive = true;
    client
      .query('getDtViewStatus', { competitionId })
      .then(s => alive && setStatus(s))
      .catch(() => alive && setStatus(null));
    return () => {
      alive = false;
    };
  }, [client, competitionId, isRemoteActive]);

  const configure = useCallback(
    async (input: { enabled?: boolean; password?: string }) => {
      try {
        const r = await client.call('configureDtView', { competitionId, ...input });
        setStatus({ running: true, enabled: r.enabled, configured: r.configured });
        if (input.password !== undefined) setPassword('');
        const done =
          input.enabled === undefined
            ? 'rsm.dt_pwd_set'
            : r.enabled
              ? 'rsm.dt_opened'
              : 'rsm.dt_closed';
        showToast(t(done), 'success');
      } catch (err) {
        showToast(t('rsm.dt_failed', { message: toError(err).message }), 'error');
      }
    },
    [client, competitionId, showToast, t]
  );

  const enabled = !!status?.enabled;
  return (
    <div className="arena-url-card">
      <div className="arena-url-header">
        <strong>{t('rsm.dt_card')}</strong>
      </div>
      <UrlCopyRow
        url={url}
        id={994}
        copiedIndex={copiedIndex}
        onCopy={onCopy}
        onQr={() => onQr(url, t('rsm.dt_qr'))}
      />
      <div className="arena-url-row">
        <span className="arena-url-label">{t('rsm.pwd')}</span>
        <input
          type="password"
          className="arena-password-input"
          placeholder={t('rsm.dt_pwd_placeholder')}
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && password) void configure({ password });
          }}
        />
        <button
          className="btn-copy"
          title={t('rsm.set_pwd')}
          disabled={!password || !status?.running}
          onClick={() => void configure({ password })}
        >
          ✓
        </button>
      </div>
      <div className="arena-url-row">
        <label className="arena-url-label">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!status?.running || (!enabled && !status.configured)}
            onChange={e => void configure({ enabled: e.target.checked })}
          />{' '}
          {t('rsm.dt_open')}
        </label>
        <span>{t(enabled ? 'rsm.dt_status_open' : 'rsm.dt_status_closed')}</span>
      </div>
    </div>
  );
};
