/**
 * BPM - Escrime - Fiche du tireur en entrée par équipes : membres, niveau, HANDI (docs/adr/0043,
 * F4c). Chargé à la demande (entrée « équipe » seulement).
 * Licensed under GPL-3.0
 */
import React from 'react';
import { useTranslation } from '../contexts/TranslationContext';
import { levelLabel } from '../../shared/domain/fencers/teamEntry';
import type { TeamEntryDraft } from './teamEntryDraft';

interface TeamEntryFieldsProps {
  idPrefix: string;
  draft: TeamEntryDraft;
  onChange: (draft: TeamEntryDraft) => void;
  levels: readonly string[];
}

const TeamEntryFields: React.FC<TeamEntryFieldsProps> = ({ idPrefix, draft, onChange, levels }) => {
  const { t } = useTranslation();
  const setMember = (i: number, patch: Partial<TeamEntryDraft['members'][number]>) =>
    onChange({
      ...draft,
      members: draft.members.map((m, j) => (j === i ? { ...m, ...patch } : m)),
    });
  return (
    <div data-testid="team-entry-fields">
      {draft.members.map((m, i) => (
        <fieldset key={i} className="form-group" data-testid={`team-member-${i + 1}`}>
          <legend className="form-label">{t('teamEntry.member_n', { n: i + 1 })}</legend>
          <div className="u-grid-2">
            <div className="form-group">
              <label className="form-label" htmlFor={`${idPrefix}-m${i}-last`}>
                {t('fencer.last_name')}
              </label>
              <input
                id={`${idPrefix}-m${i}-last`}
                type="text"
                className="form-input"
                value={m.lastName}
                onChange={e => setMember(i, { lastName: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor={`${idPrefix}-m${i}-first`}>
                {t('fencer.first_name')}
              </label>
              <input
                id={`${idPrefix}-m${i}-first`}
                type="text"
                className="form-input"
                value={m.firstName}
                onChange={e => setMember(i, { firstName: e.target.value })}
              />
            </div>
          </div>
          <div className="u-grid-2">
            <div className="form-group">
              <label className="form-label" htmlFor={`${idPrefix}-m${i}-sex`}>
                {t('editFencer.sex')}
              </label>
              <select
                id={`${idPrefix}-m${i}-sex`}
                className="form-input form-select"
                value={m.gender}
                onChange={e => setMember(i, { gender: e.target.value as '' | 'M' | 'F' })}
              >
                <option value="">{t('teamEntry.unknown')}</option>
                <option value="M">{t('editFencer.male')}</option>
                <option value="F">{t('editFencer.female')}</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor={`${idPrefix}-m${i}-birth`}>
                {t('fencer.birth_date')}
              </label>
              <input
                id={`${idPrefix}-m${i}-birth`}
                type="date"
                className="form-input"
                value={m.birthDate}
                onChange={e => setMember(i, { birthDate: e.target.value })}
              />
            </div>
          </div>
        </fieldset>
      ))}
      <div className="u-grid-2">
        <div className="form-group">
          <label className="form-label" htmlFor={`${idPrefix}-level`}>
            {t('fencerList.col_level')}
          </label>
          <select
            id={`${idPrefix}-level`}
            className="form-input form-select"
            value={draft.level}
            onChange={e => onChange({ ...draft, level: e.target.value })}
          >
            <option value="">{t('teamEntry.level_unknown')}</option>
            {levels.map((label, i) => (
              <option key={i} value={String(i + 1)}>
                {levelLabel(i + 1, levels, c => t(`teamEntry.level_${c}`))}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={draft.handicap}
              onChange={e => onChange({ ...draft, handicap: e.target.checked })}
            />{' '}
            {t('teamEntry.handicap')}
          </label>
          <small className="u-hint">{t('teamEntry.handicap_hint')}</small>
        </div>
      </div>
      <small className="u-hint">{t('teamEntry.auto_hint')}</small>
    </div>
  );
};

export default TeamEntryFields;
