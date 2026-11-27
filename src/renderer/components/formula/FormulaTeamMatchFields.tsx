/**
 * BPM - Escrime - Règle de rencontre d'une épreuve par équipes en relais FIE dans l'éditeur de
 * formule (ADR-0044) : titulaires, remplaçants, palier, ordre des relais. Règle générale
 * (`general.teamMatch`, complète) ou surcharge d'une phase (`teamMatch`, champ vide : règle
 * générale). Bornes : TEAM_MATCH_LIMITS du domaine, jugées aussi par le moteur.
 * Licensed under GPL-3.0
 */

import React from 'react';
import type { TeamMatchRule, TeamRelayOrder } from '../../../shared/domain/formula/formulaV2';
import { TEAM_MATCH_LIMITS } from '../../../shared/domain/teams/teamMatchRule';
import { useTranslation } from '../../hooks/useTranslation';

type NumberKey = 'starters' | 'reserves' | 'relayStep';

interface Props {
  id: string;
  /** Règle générale (complète) ou surcharge de la phase (partielle) */
  rule: Partial<TeamMatchRule>;
  /** Phase : règle générale héritée (valeurs affichées des champs vides) ; absent : générale */
  inherited?: TeamMatchRule;
  onChange: (rule: Partial<TeamMatchRule>) => void;
}

const LABELS: Record<NumberKey, string> = {
  starters: 'formulaEditor.team_starters',
  reserves: 'formulaEditor.team_reserves',
  relayStep: 'formulaEditor.team_relay_step',
};

const clamp = (key: NumberKey, n: number) => {
  const { min, max } = TEAM_MATCH_LIMITS[key];
  return Math.min(max, Math.max(min, n));
};

export const FormulaTeamMatchFields: React.FC<Props> = ({ id, rule, inherited, onChange }) => {
  const { t } = useTranslation();
  const isPhase = !!inherited;
  const starters = rule.starters ?? inherited?.starters;

  /** Champ réglé ; vide (phase seulement) : retiré, la règle générale s'applique */
  const set = <K extends keyof TeamMatchRule>(key: K, value: TeamMatchRule[K] | undefined) => {
    const { [key]: _old, ...rest } = rule;
    const next: Partial<TeamMatchRule> = value === undefined ? rest : { ...rest, [key]: value };
    // Ordre FIE : 3 titulaires seulement (o.99.3) ; autre nombre : rotation
    const nextStarters = next.starters ?? inherited?.starters;
    if (key === 'starters' && next.relayOrder === 'fie' && nextStarters !== 3)
      next.relayOrder = 'rotation';
    onChange(next);
  };

  const numberField = (key: NumberKey) => {
    const { min, max } = TEAM_MATCH_LIMITS[key];
    return (
      <div className="form-group" key={key}>
        <label htmlFor={`${id}-${key}`}>{t(LABELS[key])}</label>
        <input
          id={`${id}-${key}`}
          data-testid={`${id}-${key}`}
          type="number"
          className="form-input"
          min={min}
          max={Number.isFinite(max) ? max : undefined}
          value={rule[key] ?? ''}
          placeholder={inherited ? String(inherited[key]) : undefined}
          onChange={e => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isFinite(n)) {
              if (isPhase) set(key, undefined);
              return;
            }
            set(key, clamp(key, n));
          }}
        />
      </div>
    );
  };

  return (
    <fieldset className="properties-group" data-testid={id}>
      <legend>{t(isPhase ? 'formulaEditor.team_match_phase' : 'formulaEditor.team_match')}</legend>
      <div className="formula-editor__grid">
        {numberField('starters')}
        {numberField('reserves')}
        {numberField('relayStep')}
        <div className="form-group">
          <label htmlFor={`${id}-relayOrder`}>{t('formulaEditor.team_relay_order')}</label>
          <select
            id={`${id}-relayOrder`}
            data-testid={`${id}-relayOrder`}
            className="form-input form-select"
            value={rule.relayOrder ?? ''}
            onChange={e =>
              set('relayOrder', (e.target.value || undefined) as TeamRelayOrder | undefined)
            }
          >
            {isPhase && <option value="">{t('formulaEditor.team_relay_order_general')}</option>}
            <option value="fie" disabled={starters !== 3}>
              {t('formulaEditor.team_relay_order_fie')}
            </option>
            <option value="rotation">{t('formulaEditor.team_relay_order_rotation')}</option>
          </select>
        </div>
      </div>
      <small className="u-hint">
        {t(isPhase ? 'formulaEditor.team_match_phase_hint' : 'formulaEditor.team_match_hint')}
      </small>
    </fieldset>
  );
};

export default FormulaTeamMatchFields;
