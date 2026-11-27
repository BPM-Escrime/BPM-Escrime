/**
 * BPM - Escrime - Add Fencer Modal
 * Licensed under GPL-3.0
 */

import React, { Suspense, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Fencer, Gender, FencerStatus } from '../../shared/types';
import { useToast } from './Toast';
import FencerPhoto from './FencerPhoto';
import NationalityPicker from './common/NationalityPicker';
import DepartmentPicker from './common/DepartmentPicker';
import { useTranslation } from '../contexts/TranslationContext';
import { Button } from './common/Button';
import {
  emptyTeamEntryDraft,
  teamEntryComplete,
  teamEntryUpdates,
  type TeamEntryDraft,
} from './teamEntryDraft';

// Fiche d'équipe (ADR-0043), à la demande
const TeamEntryFields = React.lazy(() => import('./TeamEntryFields'));

interface AddFencerModalProps {
  onClose: () => void;
  onAdd: (fencer: Partial<Fencer>) => void;
  competitionGender?: Gender;
  /** Entrée en équipes : libellés des niveaux (ADR-0043) */
  teamLevels?: readonly string[];
}

const AddFencerModalComponent: React.FC<AddFencerModalProps> = ({
  onClose,
  onAdd,
  competitionGender,
  teamLevels,
}) => {
  const modalRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [club, setClub] = useState('');
  const [region, setRegion] = useState('');
  const [department, setDepartment] = useState('');
  const [license, setLicense] = useState('');
  const [ranking, setRanking] = useState('');
  const lockedGender =
    competitionGender === Gender.MALE || competitionGender === Gender.FEMALE
      ? competitionGender
      : null;
  const [gender, setGender] = useState<Gender>(lockedGender ?? Gender.MALE);
  const [nationality, setNationality] = useState('FRA');
  const [handedness, setHandedness] = useState<'R' | 'L'>('R');
  const [photo, setPhoto] = useState<string | undefined>();
  const [genderTouched, setGenderTouched] = useState(false);
  const [team, setTeam] = useState<TeamEntryDraft>(emptyTeamEntryDraft);

  const buildFencer = (): Partial<Fencer> => ({
    lastName: lastName.trim().toUpperCase(),
    firstName: firstName.trim(),
    club: club.trim() || undefined,
    region: region.trim() || undefined,
    department: department || undefined,
    license: license.trim() || undefined,
    ranking: ranking ? parseInt(ranking, 10) : undefined,
    gender,
    nationality,
    handedness,
    status: FencerStatus.NOT_CHECKED_IN,
    photo,
    ...(teamLevels
      ? teamEntryUpdates({
          draft: team,
          gender: { value: gender, touched: genderTouched || !!lockedGender },
        })
      : {}),
  });

  const incomplete = () =>
    teamLevels
      ? !lastName.trim() || !teamEntryComplete(team)
      : !lastName.trim() || !firstName.trim();

  // Efface les champs saisis (Annuler / Ajouter) ; le sexe imposé par la compétition est conservé
  const resetForm = () => {
    setLastName('');
    setFirstName('');
    setClub('');
    setRegion('');
    setDepartment('');
    setLicense('');
    setRanking('');
    setGender(lockedGender ?? Gender.MALE);
    setNationality('FRA');
    setHandedness('R');
    setPhoto(undefined);
    setGenderTouched(false);
    setTeam(emptyTeamEntryDraft());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (incomplete()) {
      showToast(
        teamLevels ? t('teamEntry.members_required') : t('messages.name_required'),
        'warning'
      );
      return;
    }
    onAdd(buildFencer());
    onClose();
  };

  const handleSaveAndAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    if (incomplete()) {
      showToast(
        teamLevels ? t('teamEntry.members_required') : t('messages.name_required'),
        'warning'
      );
      return;
    }
    onAdd(buildFencer());
    resetForm();
  };

  // Fenêtre de saisie : pas de fermeture par un clic à côté (croix, Annuler ou Échap)
  return (
    <div className="modal-overlay">
      <div
        ref={modalRef}
        className="modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fencer.add')}</h2>
          <button className="btn-close" onClick={onClose} aria-label={t('actions.close')}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="add-fencer-modal-1">
              <FencerPhoto
                photo={photo}
                firstName={firstName}
                lastName={lastName}
                onPhotoChange={setPhoto}
                editable
                size="medium"
              />
            </div>
            <p className="privacy-note privacy-note--center">{t('privacy.photo_consent')}</p>

            <div className="u-grid-2">
              <div className="form-group">
                <label className="form-label">
                  {teamLevels ? t('teamEntry.team_name') : t('fencer.last_name')} *
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={teamLevels ? undefined : t('addFencer.last_name_ph')}
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              {!teamLevels && (
                <div className="form-group">
                  <label className="form-label">{t('fencer.first_name')} *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={t('addFencer.first_name_ph')}
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    required
                  />
                </div>
              )}
            </div>

            {teamLevels && (
              <Suspense fallback={null}>
                <TeamEntryFields
                  idPrefix="add-fencer"
                  draft={team}
                  onChange={setTeam}
                  levels={teamLevels}
                />
              </Suspense>
            )}

            <div className="u-grid-2">
              <div className="form-group">
                <label className="form-label">{t('fencer.gender')}</label>
                {lockedGender ? (
                  <input
                    type="text"
                    className="form-input add-fencer-modal-2"
                    value={lockedGender === Gender.MALE ? t('genders.male') : t('genders.female')}
                    readOnly
                  />
                ) : (
                  <select
                    className="form-input form-select"
                    value={gender}
                    onChange={e => {
                      setGender(e.target.value as Gender);
                      setGenderTouched(true);
                    }}
                  >
                    <option value={Gender.MALE}>{t('genders.male')}</option>
                    <option value={Gender.FEMALE}>{t('genders.female')}</option>
                    {teamLevels && <option value={Gender.MIXED}>{t('genders.mixed')}</option>}
                  </select>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">{t('fencer.nationality')}</label>
                <NationalityPicker value={nationality} onChange={setNationality} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">{t('fencer.club')}</label>
              <input
                type="text"
                className="form-input"
                placeholder={t('addFencer.club_ph')}
                value={club}
                onChange={e => setClub(e.target.value)}
              />
            </div>

            <div className="u-grid-2">
              <div className="form-group">
                <label className="form-label">{t('fencer.league')}</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={t('addFencer.region_ph')}
                  value={region}
                  onChange={e => setRegion(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="add-fencer-department">
                  {t('fencer.department')}
                </label>
                <DepartmentPicker
                  id="add-fencer-department"
                  value={department}
                  onChange={setDepartment}
                />
              </div>
            </div>

            <div className="u-grid-2">
              <div className="form-group">
                <label className="form-label">{t('fencer.ranking')}</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="1000"
                  value={ranking}
                  onChange={e => setRanking(e.target.value)}
                  min="1"
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t('fencer.license')}</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="123456789"
                  value={license}
                  onChange={e => setLicense(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" id="add-fencer-handedness">
                {t('addFencer.handedness')}
              </label>
              <div className="u-row" role="radiogroup" aria-labelledby="add-fencer-handedness">
                <label>
                  <input
                    type="radio"
                    name="handedness"
                    value="R"
                    checked={handedness === 'R'}
                    onChange={() => setHandedness('R')}
                  />{' '}
                  {t('addFencer.right')}
                </label>
                <label>
                  <input
                    type="radio"
                    name="handedness"
                    value="L"
                    checked={handedness === 'L'}
                    onChange={() => setHandedness('L')}
                  />{' '}
                  {t('addFencer.left')}
                </label>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <Button type="button" onClick={resetForm}>
              {t('actions.cancel')}
            </Button>
            <Button type="button" onClick={handleSaveAndAdd}>
              {t('addFencer.add')}
            </Button>
            <Button type="submit" variant="primary">
              {t('addFencer.add_and_close')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

const AddFencerModal = React.memo(AddFencerModalComponent);
export default AddFencerModal;
