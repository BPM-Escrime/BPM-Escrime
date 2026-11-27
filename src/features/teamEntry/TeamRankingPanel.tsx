/**
 * BPM - Escrime - Entrée en équipes : classement des équipes, filtres et PDF (#1118, docs/adr/0043)
 * Filtres de la formule (`rankingFilters` : catégorie, sexe, niveau, HANDI) sur les champs du
 * tireur-équipe, colonnes Équipe / Tireurs / Niveau / V / M / Ind. / TD, export PDF et impression.
 * Utilisé après les poules (classement intermédiaire) ; le classement final a les mêmes filtres
 * dans la page des résultats (F4d).
 * Licensed under GPL-3.0
 */

import React, { useState } from 'react';
import { Funnel } from 'lucide-react';
import type { Fencer } from '../../shared/types';
import { useTranslation } from '../../renderer/hooks/useTranslation';
import { useToast } from '../../renderer/components/Toast';
import {
  filterRanking,
  restrictRankingFilter,
  subjectOfFencer,
  type RankingFilter,
  type RankingFilterKey,
} from '../../shared/domain/ranking/rankingFilters';
import { DEFAULT_TEAM_LEVELS, levelLabel } from '../../shared/domain/fencers/teamEntry';
import RankingFilterBar from '../../renderer/components/results/RankingFilterBar';
import {
  rankingFilterLabels,
  rankingFilterOptions,
} from '../../renderer/components/results/rankingFilterOptions';
import { exportTeamRankingToPDF, printTeamRanking, TeamRankingColumnKind } from './teamRankingPdf';
import { Button } from '../../renderer/components/common/Button';

const HIDDEN_KEY = 'bpm_escrime_team_ranking_hidden_columns';

/** Colonnes du classement d'équipes (#1441 : une ligne par équipe, colonne « Poule » optionnelle) */
const COLUMNS: { id: string; kind: TeamRankingColumnKind }[] = [
  { id: 'rank', kind: 'rank' },
  { id: 'team', kind: 'text' },
  { id: 'fencers', kind: 'text' },
  { id: 'pool', kind: 'num' },
  { id: 'level', kind: 'text' },
  { id: 'victories', kind: 'num' },
  { id: 'matches', kind: 'num' },
  { id: 'index', kind: 'index' },
  { id: 'touches', kind: 'num' },
];

const loadHidden = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export interface RankedTeam {
  teamId: string;
  /** null : exclue, au bas sans classement (« - », docs/adr/0043, F4d) */
  rank: number | null;
}

export interface TeamRankingStats {
  victories: number;
  matches: number;
  index: number;
  touchesGiven: number;
}

interface TeamRankingPanelProps {
  competitionTitle: string;
  /** Classement final (sinon intermédiaire, titré avec la vague en cours) */
  final?: boolean;
  wave: number;
  ranked: RankedTeam[];
  /** Équipes : tireurs de l'épreuve, membres, niveau, HANDI, catégorie et sexe portés par le tireur */
  fencers: Fencer[];
  stats: Map<string, TeamRankingStats>;
  /** Numéro de poule par équipe : ajoute la colonne « Poule » (classement après poules) */
  poolOf?: Record<string, number>;
  /** Filtres proposés : ceux de la formule (`rankingFilters`, docs/adr/0043, F4d) */
  filterKeys: readonly RankingFilterKey[];
  /** Libellés des niveaux de la formule (`entry.levels`, du plus faible au plus fort) */
  levels?: readonly string[];
}

const membersLabel = (f: Fencer) =>
  f.members?.length
    ? f.members.map(m => `${m.lastName.toUpperCase()} ${m.firstName}`.trim()).join(' · ')
    : f.firstName;

const TeamRankingPanel: React.FC<TeamRankingPanelProps> = ({
  competitionTitle,
  final = false,
  wave,
  ranked,
  fencers,
  stats,
  poolOf,
  filterKeys,
  levels = DEFAULT_TEAM_LEVELS,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const title = final
    ? t('teamEntry.ranking_final')
    : wave > 0
      ? t('teamEntry.ranking_intermediate_wave', { n: wave })
      : t('teamEntry.ranking_intermediate');
  // Filtres cumulables sur les équipes (vide = non pris en compte), domaine générique
  const [filterValues, setFilterValues] = useState<RankingFilter>({});
  const [hidden, setHidden] = useState<string[]>(loadHidden);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleColumn = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter(c => c !== id) : [...hidden, id];
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    } catch {
      /* stockage indisponible : réglage non persisté */
    }
  };

  const byId = new Map(fencers.map(f => [f.id, f]));
  const subjectOf = (r: RankedTeam) => {
    const f = byId.get(r.teamId);
    return f ? subjectOfFencer(f) : undefined;
  };
  const filter = restrictRankingFilter(filterValues, filterKeys);
  const filterOptions = rankingFilterOptions(ranked.map(subjectOf), levels, t);
  const filterText = rankingFilterLabels(filter, levels, t).join(' · ');
  const filterLabel = filterText || t('teamEntry.ranking_teams');
  const rows = filterRanking(ranked, subjectOf, filter);
  const showPool = !!poolOf;

  const allHeaders: Record<string, string> = {
    rank: t('teamEntry.rank'),
    team: t('teamEntry.team'),
    fencers: t('teamEntry.fencers'),
    pool: t('teamEntry.pool'),
    level: t('teamEntry.level'),
    victories: t('teamEntry.victories'),
    matches: t('teamEntry.matches'),
    index: t('teamEntry.indice'),
    touches: t('teamEntry.touches_given'),
  };
  const shown = COLUMNS.filter(c => (c.id !== 'pool' || showPool) && !hidden.includes(c.id));
  const headers = shown.map(c => allHeaders[c.id]);
  const kinds = shown.map(c => c.kind);
  const tableRows = rows.map(r => {
    const team = byId.get(r.teamId);
    const s = stats.get(r.teamId) ?? { victories: 0, matches: 0, index: 0, touchesGiven: 0 };
    const cells: Record<string, string | number> = {
      rank: r.rank ?? '-',
      team: team?.lastName ?? '?',
      fencers: team ? membersLabel(team) : '',
      pool: poolOf?.[r.teamId] ?? '',
      level: team ? levelLabel(team.level, levels, c => t(`teamEntry.level_${c}`)) : '',
      victories: s.victories,
      matches: s.matches,
      index: s.index > 0 ? `+${s.index}` : String(s.index),
      touches: s.touchesGiven,
    };
    return shown.map(c => cells[c.id]);
  });

  const pdfTable = () => ({
    title: competitionTitle,
    subtitle: `${title} — ${filterLabel}`,
    headers,
    rows: tableRows,
    kinds,
  });

  const exportPdf = async () => {
    try {
      await exportTeamRankingToPDF(
        pdfTable(),
        `classement-${title.replace(/\W+/g, '-').toLowerCase()}.pdf`
      );
    } catch {
      showToast(t('teamEntry.pdf_error'), 'error');
    }
  };

  // Boîte d'impression intégrée avec aperçu (#1214)
  const print = async () => {
    try {
      await printTeamRanking(pdfTable());
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  return (
    <div className="card team-ranking-panel-1">
      <div className="team-ranking-panel-2">
        <h3 className="team-ranking-panel-3">{title}</h3>
        <RankingFilterBar
          keys={filterKeys}
          value={filter}
          onChange={setFilterValues}
          options={filterOptions}
          className="team-ranking-panel-2"
        />
        <div className="ranking-col-wrap">
          <Button
            type="button"
            className={`ranking-col-btn${hidden.length > 0 ? ' ranking-col-btn-active' : ''}`}
            title={t('poolRanking.columns_title')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(o => !o)}
          >
            <Funnel size={15} /> {t('poolRanking.columns')}
          </Button>
          {menuOpen && (
            <div className="ranking-col-menu">
              <div className="ranking-col-menu-title">{t('poolRanking.columns_shown')}</div>
              {COLUMNS.filter(c => c.id !== 'pool' || showPool).map(c => (
                <label key={c.id} className="ranking-col-menu-item">
                  <input
                    type="checkbox"
                    checked={!hidden.includes(c.id)}
                    onChange={() => toggleColumn(c.id)}
                  />
                  {allHeaders[c.id]}
                </label>
              ))}
            </div>
          )}
        </div>
        <Button
          type="button"

          disabled={rows.length === 0}
          onClick={exportPdf}
        >
          {t('teamEntry.export_pdf')}
        </Button>
        <Button
          type="button"

          disabled={rows.length === 0}
          onClick={print}
        >
          {t('teamEntry.print')}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted">{t('teamEntry.no_ranking')}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              {headers.map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r, i) => (
              <tr key={rows[i].teamId}>
                {r.map((c, j) => (
                  <td key={j} style={j === 0 ? { fontWeight: 700 } : undefined}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default TeamRankingPanel;
