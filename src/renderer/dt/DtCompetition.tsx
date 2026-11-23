/**
 * BPM - Escrime - Vue DT d'une épreuve, en lecture seule (#1981 lot 3, docs/adr/0020)
 * getCompetition + getCompetitionState ; relecture sur signal (onCompetitionEvents, ADR-0010).
 * Licensed under GPL-3.0
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../contexts/TranslationContext';
import { useBpmClient } from '../api/BpmClientContext';
import type { CompetitionStateDTO, Output } from '../../shared/api/contract';
import { fencerName, poolCell, tableauRounds } from './dtFormat';

type Competition = Output<'getCompetition'>;
type Tab = 'pools' | 'ranking' | 'tableau' | 'results';

const EMPTY_STATE: CompetitionStateDTO = {
  currentPhase: 0,
  pools: [],
  poolHistory: [],
  appelHistory: [],
  overallRanking: [],
  tableauMatches: [],
  finalResults: [],
  consolationBrackets: [],
  currentPoolRound: 1,
  skipPoolPhase: false,
};

/** Délai de regroupement des signaux avant relecture */
const RELOAD_DELAY_MS = 400;
/** Délai entre deux essais quand le serveur ne répond pas */
const RETRY_DELAY_MS = 3000;

export const DtCompetition: React.FC<{ competitionId: string }> = ({ competitionId }) => {
  const { t } = useTranslation();
  const client = useBpmClient();
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [state, setState] = useState<CompetitionStateDTO | null>(null);
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState<Tab>('pools');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        client.query('getCompetition', { competitionId }),
        client.query('getCompetitionState', { competitionId }),
      ]);
      setCompetition(c);
      // Épreuve pas encore lancée : aucun état (appel, inscriptions)
      setState(s.state ?? EMPTY_STATE);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [client, competitionId]);

  useEffect(() => {
    void load();
    const off = client.subscribe('onCompetitionEvents', { competitionId }, () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), RELOAD_DELAY_MS);
    });
    return () => {
      off();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [client, competitionId, load]);

  // Serveur injoignable : nouvel essai régulier (le client se reconnecte de lui-même)
  useEffect(() => {
    if (!offline) return;
    const retry = setTimeout(() => void load(), RETRY_DELAY_MS);
    return () => clearTimeout(retry);
  }, [offline, load]);

  if (!competition || !state) {
    return <p className="dt-message">{t(offline ? 'dtView.unreachable' : 'dtView.loading')}</p>;
  }

  const tabs: Tab[] = ['pools', 'ranking', 'tableau'];
  if (state.finalResults.length > 0) tabs.push('results');

  return (
    <div className="dt-page">
      <header className="dt-header">
        <h1>{competition.title}</h1>
        <span className="dt-badge">{t('dtView.read_only')}</span>
        {offline && (
          <span className="dt-badge dt-badge-warn" role="status">
            {t('dtView.reconnecting')}
          </span>
        )}
      </header>
      <nav className="dt-tabs" aria-label={t('dtView.title')}>
        {tabs.map(id => (
          <button
            key={id}
            type="button"
            className={id === tab ? 'dt-tab dt-tab-active' : 'dt-tab'}
            aria-pressed={id === tab}
            onClick={() => setTab(id)}
          >
            {t(`dtView.tab_${id}`)}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'pools' && <DtPools state={state} />}
        {tab === 'ranking' && <DtRanking state={state} />}
        {tab === 'tableau' && <DtTableau state={state} />}
        {tab === 'results' && <DtResults state={state} />}
      </main>
    </div>
  );
};

const Empty: React.FC = () => {
  const { t } = useTranslation();
  return <p className="dt-message">{t('dtView.no_data')}</p>;
};

const DtPools: React.FC<{ state: CompetitionStateDTO }> = ({ state }) => {
  const { t } = useTranslation();
  if (state.pools.length === 0) return <Empty />;
  return (
    <div className="dt-grid">
      {state.pools.map(pool => (
        <section key={pool.id} className="dt-card">
          <h2>
            {t('dtView.pool', { n: pool.number })}
            {pool.strip ? ` · ${t('dtView.strip', { n: pool.strip })}` : ''}
          </h2>
          <table className="dt-table dt-pool">
            <thead>
              <tr>
                <th scope="col">{t('dtView.fencer')}</th>
                {pool.fencers.map((_, i) => (
                  <th key={i} scope="col">
                    {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pool.fencers.map((row, i) => (
                <tr key={row.id}>
                  <th scope="row">
                    {i + 1}. {fencerName(row)}
                  </th>
                  {pool.fencers.map(col => (
                    <td key={col.id} className={col.id === row.id ? 'dt-diag' : undefined}>
                      {poolCell(pool, row.id, col.id)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
};

const DtRanking: React.FC<{ state: CompetitionStateDTO }> = ({ state }) => {
  const { t } = useTranslation();
  if (state.overallRanking.length === 0) return <Empty />;
  return (
    <table className="dt-table">
      <thead>
        <tr>
          <th scope="col">{t('dtView.rank')}</th>
          <th scope="col">{t('dtView.fencer')}</th>
          <th scope="col">{t('dtView.club')}</th>
          <th scope="col">{t('dtView.ratio')}</th>
          <th scope="col">{t('dtView.index')}</th>
          <th scope="col">{t('dtView.touches')}</th>
        </tr>
      </thead>
      <tbody>
        {state.overallRanking.map(r => (
          <tr key={r.fencer.id}>
            <td>{r.rank}</td>
            <td>{fencerName(r.fencer)}</td>
            <td>{r.fencer.club ?? ''}</td>
            <td>
              {r.victories}/{r.matchesPlayed}
            </td>
            <td>{r.index > 0 ? `+${r.index}` : r.index}</td>
            <td>{r.touchesScored}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const DtTableau: React.FC<{ state: CompetitionStateDTO }> = ({ state }) => {
  const { t } = useTranslation();
  const rounds = tableauRounds(state.tableauMatches);
  if (rounds.length === 0) return <Empty />;
  const label = (size: number) =>
    size === 2
      ? t('dtView.final')
      : size === 4
        ? t('dtView.semi_finals')
        : t('dtView.round_of', { n: size });
  return (
    <div className="dt-grid">
      {rounds.map(round => (
        <section key={round.size} className="dt-card">
          <h2>{label(round.size)}</h2>
          <ul className="dt-matches">
            {round.matches.map(m => (
              <li key={m.id}>
                <span className={m.winner && m.winner.id === m.fencerA?.id ? 'dt-winner' : ''}>
                  {fencerName(m.fencerA)}
                </span>
                <span className="dt-score">
                  {m.scoreA ?? '–'} : {m.scoreB ?? '–'}
                </span>
                <span className={m.winner && m.winner.id === m.fencerB?.id ? 'dt-winner' : ''}>
                  {fencerName(m.fencerB)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

const DtResults: React.FC<{ state: CompetitionStateDTO }> = ({ state }) => {
  const { t } = useTranslation();
  return (
    <table className="dt-table">
      <thead>
        <tr>
          <th scope="col">{t('dtView.rank')}</th>
          <th scope="col">{t('dtView.fencer')}</th>
          <th scope="col">{t('dtView.club')}</th>
        </tr>
      </thead>
      <tbody>
        {state.finalResults.map(r => (
          <tr key={r.fencer.id}>
            <td>{r.rank}</td>
            <td>{fencerName(r.fencer)}</td>
            <td>{r.fencer.club ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
