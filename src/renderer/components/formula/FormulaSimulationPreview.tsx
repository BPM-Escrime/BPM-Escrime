/**
 * BPM - Escrime - Aperçu temps réel de la simulation de formule
 */

import React, { memo } from 'react';
import { FormulaSimulation } from '../../../shared/types';
import { useTranslation } from '../../hooks/useTranslation';
import { TriangleAlert } from 'lucide-react';
import { Icon } from '../common/Icon';
import type { SplitSimulationBranch } from '../../../shared/domain/formula/splitPlan';

type TFn = ReturnType<typeof useTranslation>['t'];

interface Props {
  simulation: FormulaSimulation;
  fencerCount: number;
  /** Scission en fin de formule (ADR-0039) : effectif par branche, null si selon les tireurs */
  split?: SplitSimulationBranch[];
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function phaseLabel(t: TFn, type: string, index: number): string {
  if (type === 'pool_round') return t('formula.pool_round_n', { n: index + 1 });
  if (type === 'direct_elimination') return t('formulaSim.de');
  return t('formulaSim.final_ranking');
}

const FormulaSimulationPreview_: React.FC<Props> = ({ simulation, fencerCount, split }) => {
  const { t } = useTranslation();
  // Scission : avant le classement final (dernière phase de la formule de l'épreuve)
  const splitNode = split && split.length > 0 && (
    <React.Fragment key="split">
      <div className="sim-arrow">↓</div>
      <div className="sim-node sim-node-split" data-testid="sim-split">
        <div className="sim-phase-name">{t('formulaSim.split')}</div>
        {split.map(b => (
          <div key={b.label} className="sim-phase-detail">
            {b.fencers === null
              ? t('formulaSim.split_branch_unknown', { label: b.label })
              : t('formulaSim.split_branch', { label: b.label, n: b.fencers })}
          </div>
        ))}
      </div>
    </React.Fragment>
  );
  const lastIsRanking =
    simulation.phases.length > 0 &&
    simulation.phases[simulation.phases.length - 1].type === 'classification';
  return (
    <div className="formula-simulation-preview">
      <h4 className="simulation-title">{t('formulaSim.title', { n: fencerCount })}</h4>

      <div className="simulation-flowchart">
        <div className="sim-node sim-node-input">
          <span className="sim-fencer-count">{fencerCount}</span>
          <span className="sim-label">{t('formulaSim.fencers')}</span>
        </div>

        {simulation.phases.map((phase, i) => (
          <React.Fragment key={i}>
            {lastIsRanking && i === simulation.phases.length - 1 && splitNode}
            <div className="sim-arrow">↓</div>
            <div className={`sim-node sim-node-${phase.type}`}>
              <div className="sim-phase-name">{phaseLabel(t, phase.type, i)}</div>

              {phase.type === 'pool_round' && phase.poolCount !== undefined && (
                <div className="sim-phase-detail">
                  {t('formulaSim.pools', { count: phase.poolCount })}
                  {phase.poolSizes && phase.poolSizes.length > 0 && (
                    <span className="sim-pool-sizes">
                      {' '}
                      {t('formulaSim.pool_sizes', {
                        sizes: Array.from(new Set(phase.poolSizes))
                          .sort((a, b) => a - b)
                          .join('-'),
                      })}
                    </span>
                  )}
                </div>
              )}

              {phase.type === 'direct_elimination' && phase.bracketSize !== undefined && (
                <div className="sim-phase-detail">
                  {t('formulaPhase.bracket_of', { n: phase.bracketSize })}
                </div>
              )}

              {phase.matchCount !== undefined && (
                <div className="sim-match-count">
                  {t('formulaSim.matches', { n: phase.matchCount })}
                </div>
              )}

              {phase.advancingFencers !== undefined && phase.type !== 'classification' && (
                <div className="sim-advancing">
                  {t('formulaSim.advancing', { n: phase.advancingFencers })}
                </div>
              )}
            </div>
          </React.Fragment>
        ))}
        {!lastIsRanking && splitNode}
      </div>

      <div className="simulation-totals">
        <div className="sim-total-item">
          <span className="sim-total-label">{t('formulaSim.total_matches')}</span>
          <strong>{simulation.totalMatches}</strong>
        </div>
        <div className="sim-total-item">
          <span className="sim-total-label">{t('formulaSim.duration')}</span>
          <strong>{formatDuration(simulation.estimatedDurationMinutes)}</strong>
        </div>
      </div>

      {simulation.warnings.length > 0 && (
        <div className="simulation-warnings">
          {simulation.warnings.map((w, i) => (
            <div key={i} className="sim-warning">
              <Icon icon={TriangleAlert} /> {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const FormulaSimulationPreview = memo(FormulaSimulationPreview_);
