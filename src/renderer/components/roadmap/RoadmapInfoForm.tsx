/**
 * BPM - Escrime - Feuille de route : « L'essentiel »
 * Les réponses alimentent les variables reprises dans toutes les sections.
 * Licensed under GPL-3.0
 */

import React from 'react';
import { CalendarClock, Download, Wand2 } from 'lucide-react';
import { deadlineOf, suggestSchedule, type RoadmapInfo } from '@shared/domain/roadmap/roadmap';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../common/Button';
import { TextField, infoFieldId } from './roadmapFields';

interface RoadmapInfoFormProps {
  info: RoadmapInfo;
  onChange: (patch: Partial<RoadmapInfo>) => void;
  formatDate: (iso: string) => string;
  /** Reprend titre, date, lieu, organisateur et horaires de la compétition affichée */
  onFromCompetition?: () => void;
}

export const RoadmapInfoForm: React.FC<RoadmapInfoFormProps> = ({
  info,
  onChange,
  formatDate,
  onFromCompetition,
}) => {
  const { t } = useTranslation();
  const set =
    <K extends keyof RoadmapInfo>(key: K) =>
    (value: RoadmapInfo[K]) =>
      onChange({ [key]: value } as Partial<RoadmapInfo>);
  const schedule = suggestSchedule(info.startTime);
  const deadline = deadlineOf(info.date, info.deadlineDays);

  return (
    <div className="roadmap-form">
      {onFromCompetition && (
        <Button type="button" size="sm" variant="secondary" onClick={onFromCompetition}>
          <Download size={14} /> {t('roadmap.from_competition')}
        </Button>
      )}
      <TextField
        label={t('roadmap.field_title')}
        value={info.title}
        id={infoFieldId('title')}
        onChange={set('title')}
      />
      <div className="roadmap-grid-2">
        <TextField
          label={t('roadmap.field_edition')}
          value={info.edition}
          placeholder={t('roadmap.field_edition_ph')}
          id={infoFieldId('edition')}
          onChange={set('edition')}
        />
        <TextField
          label={t('roadmap.field_date')}
          type="date"
          value={info.date}
          id={infoFieldId('date')}
          onChange={set('date')}
        />
      </div>
      <TextField
        label={t('roadmap.field_venue')}
        value={info.venue}
        id={infoFieldId('venue')}
        onChange={set('venue')}
      />
      <TextField
        label={t('roadmap.field_address')}
        value={info.address}
        multiline
        rows={1}
        id={infoFieldId('address')}
        onChange={set('address')}
      />

      <fieldset className="roadmap-fieldset">
        <legend>
          <CalendarClock size={14} /> {t('roadmap.schedule')}
        </legend>
        <div className="roadmap-grid-3">
          <TextField
            label={t('roadmap.field_open')}
            type="time"
            value={info.openTime}
            id={infoFieldId('openTime')}
            onChange={set('openTime')}
          />
          <TextField
            label={t('roadmap.field_scratch')}
            type="time"
            value={info.scratchTime}
            id={infoFieldId('scratchTime')}
            onChange={set('scratchTime')}
          />
          <TextField
            label={t('roadmap.field_start')}
            type="time"
            value={info.startTime}
            id={infoFieldId('startTime')}
            onChange={set('startTime')}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!schedule}
          title={t('roadmap.suggest_times_hint')}
          onClick={() => schedule && onChange(schedule)}
        >
          <Wand2 size={14} /> {t('roadmap.suggest_times')}
        </Button>
      </fieldset>

      <TextField
        label={t('roadmap.field_fees')}
        value={info.fees}
        multiline
        id={infoFieldId('fees')}
        onChange={set('fees')}
      />
      <label className="roadmap-field">
        <span className="roadmap-field-label">{t('roadmap.field_deadline')}</span>
        <div className="roadmap-inline">
          <input
            id={infoFieldId('deadlineDays')}
            className="roadmap-input roadmap-input-num"
            type="number"
            min={0}
            max={365}
            value={info.deadlineDays}
            onChange={e =>
              set('deadlineDays')(Math.max(0, Math.min(365, Number(e.target.value) || 0)))
            }
          />
          {deadline && (
            <span className="roadmap-muted">
              {t('roadmap.deadline_hint', { date: formatDate(deadline) })}
            </span>
          )}
        </div>
      </label>
      <TextField
        label={t('roadmap.field_organizer')}
        value={info.organizer}
        id={infoFieldId('organizer')}
        onChange={set('organizer')}
      />

      <fieldset className="roadmap-fieldset">
        <legend>{t('roadmap.field_contact')}</legend>
        <div className="roadmap-grid-2">
          <TextField
            label={t('roadmap.field_name')}
            value={info.contactName}
            id={infoFieldId('contactName')}
            onChange={set('contactName')}
          />
          <TextField
            label={t('roadmap.field_email')}
            type="email"
            value={info.contactEmail}
            id={infoFieldId('contactEmail')}
            onChange={set('contactEmail')}
          />
        </div>
      </fieldset>
      <fieldset className="roadmap-fieldset">
        <legend>{t('roadmap.field_contact2')}</legend>
        <div className="roadmap-grid-2">
          <TextField
            label={t('roadmap.field_name')}
            value={info.contact2Name}
            id={infoFieldId('contact2Name')}
            onChange={set('contact2Name')}
          />
          <TextField
            label={t('roadmap.field_email')}
            type="email"
            value={info.contact2Email}
            id={infoFieldId('contact2Email')}
            onChange={set('contact2Email')}
          />
        </div>
      </fieldset>
    </div>
  );
};
