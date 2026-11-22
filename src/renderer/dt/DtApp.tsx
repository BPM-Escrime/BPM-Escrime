/**
 * BellePoule Modern - Vue DT : accès (espace fermé, connexion), puis épreuve en lecture seule
 * (#1981 lot 3, docs/adr/0020). Le jeton voyage dans le cookie HttpOnly bp_dt_token.
 * Licensed under GPL-3.0
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../contexts/TranslationContext';
import { BpmClientProvider } from '../api/BpmClientContext';
import { createWsClient } from '../api/WsClient';
import { DtCompetition } from './DtCompetition';

export interface DtAccessStatus {
  enabled: boolean;
  configured: boolean;
  authenticated: boolean;
  /** Épreuve servie (connecté seulement) */
  competitionId?: string;
}

export async function fetchDtStatus(): Promise<DtAccessStatus> {
  const res = await fetch('/api/dt/status', { credentials: 'same-origin' });
  return (await res.json()) as DtAccessStatus;
}

export const DtApp: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DtAccessStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    fetchDtStatus()
      .then(s => {
        setStatus(s);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    document.title = `${t('dtView.title')} – BellePoule`;
  }, [t]);

  if (failed) return <p className="dt-message">{t('dtView.unreachable')}</p>;
  if (!status) return <p className="dt-message">{t('dtView.loading')}</p>;
  if (!status.enabled || !status.configured) {
    return <p className="dt-message">{t('dtView.closed')}</p>;
  }
  if (!status.authenticated) return <DtLogin onLogged={refresh} />;
  if (!status.competitionId) return <p className="dt-message">{t('dtView.no_session')}</p>;
  return <DtConnected competitionId={status.competitionId} />;
};

const DtConnected: React.FC<{ competitionId: string }> = ({ competitionId }) => {
  const client = useMemo(() => createWsClient(), []);
  useEffect(() => () => client.close(), [client]);
  return (
    <BpmClientProvider client={client}>
      <DtCompetition competitionId={competitionId} />
    </BpmClientProvider>
  );
};

const DtLogin: React.FC<{ onLogged: () => void }> = ({ onLogged }) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/dt/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) return onLogged();
      setError(t(res.status === 429 ? 'dtView.too_many_attempts' : 'dtView.wrong_password'));
    } catch {
      setError(t('dtView.unreachable'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="dt-login" onSubmit={submit}>
      <h1>{t('dtView.title')}</h1>
      <label>
        {t('dtView.password')}
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoFocus
        />
      </label>
      {error && (
        <p className="dt-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={!password || busy}>
        {t('dtView.login')}
      </button>
    </form>
  );
};
