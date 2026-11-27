/**
 * BPM - Escrime - New Competition Modal
 * Licensed under GPL-3.0
 */

import React, { useEffect, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Competition, CustomFormulaConfig, Weapon, Gender, Category } from '../../shared/types';
import { useTranslation } from '../hooks/useTranslation';
import { createDefaultCustomFormula } from '../../shared/utils/tournamentTemplates';
import { FormulaBuilder } from './formula/FormulaBuilder';
import { getActiveLocale } from '../../shared/utils/localeFormat';
import { Button } from './common/Button';
import { buildDefaultCompetitionSettings } from '../../shared/utils/defaultCompetitionSettings';
import CompetitionPropertiesModal from './CompetitionPropertiesModal';
import { Settings } from 'lucide-react';
import FederalImportPanel from './FederalImportPanel';
import { useFederalImport, type FederalCreationPayload } from '../hooks/useFederalImport';
import type { FederalNotice } from '../../shared/utils/fileParser/federalImport';
import { TimeInput } from './common/TimeInput';
import { PlaceSearchField } from './common/PlaceSearchField';
import { useFormulaPreview } from '../hooks/useFormulaPreview';
import { FormulaCreationSection } from './formula/FormulaCreationSection';
import { formulaOf, flatSettingsOf, type FormulaV2 } from '../../shared/domain/formula/formulaV2';
import { normalizeCustomFormula } from '../../shared/domain/formula/formulaFrieze';
import {
  formulaDeviations,
  templateMatches,
  templateToSettings,
  type FormulaTemplate,
  type FormulaTemplateBody,
} from '../../shared/domain/formula/formulaTemplate';
import { useFormulaTemplates } from '../hooks/useFormulaTemplates';

interface NewCompetitionModalProps {
  onClose: () => void;
  /** imported : tireurs, équipes et arbitres lus dans les fichiers de l'extranet (#1938) */
  onCreate: (data: Partial<Competition>, imported?: FederalCreationPayload) => void;
}

const NewCompetitionModal: React.FC<NewCompetitionModalProps> = ({ onClose, onCreate }) => {
  // Fermeture par la croix (ou « Annuler ») seulement : ni clic à côté, ni Échap, qui
  // perdraient une saisie en cours
  const modalRef = useFocusTrap<HTMLDivElement>(true);
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [weapon, setWeapon] = useState<Weapon>(Weapon.EPEE);
  const [gender, setGender] = useState<Gender>(Gender.MALE);
  const [category, setCategory] = useState<Category>(Category.SENIOR);
  const [location, setLocation] = useState('');
  // Horaires appel / scratch / début (HH:MM), lus dans le fichier ou saisis (#1938)
  const [checkInTime, setCheckInTime] = useState('');
  const [scratchTime, setScratchTime] = useState('');
  const [startTime, setStartTime] = useState('');
  const federalImport = useFederalImport();
  const [unlocked, setUnlocked] = useState(false);
  const header = federalImport.result?.header ?? null;
  const [customFormula, setCustomFormula] = useState<CustomFormulaConfig>(
    createDefaultCustomFormula()
  );
  // Nouvelle interface de formule (aperçu, docs/adr/0032) : formule repliée pour toutes les
  // armes ; standard de l'arme et de la catégorie tant qu'elle n'est pas personnalisée (Q21)
  const formulaPreview = useFormulaPreview();
  // Formule v2 personnalisée (ADR-0036) ; null : celle du modèle choisi ou standard
  const [personalFormula, setPersonalFormula] = useState<FormulaV2 | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [isTeamEvent, setIsTeamEvent] = useState(false);
  const [teamSize, setTeamSize] = useState(3);
  const [teamReserveCount, setTeamReserveCount] = useState(1);
  const [laserTeamMode, setLaserTeamMode] = useState<'touches' | 'points'>('touches');
  // Sabre Laser équipe uniquement : relais FIE classique (cible cumulée
  // progressive) ou format arène (assauts indépendants 5 touches/3min, score
  // = total de points, règlement épreuve par équipe Sabre Laser).
  const [teamFormat, setTeamFormat] = useState<'fie-relay' | 'laser-arena'>('fie-relay');
  // Propriétés saisies dans la modale « Propriétés » : brouillon local à cette création,
  // appliqué uniquement à la compétition créée (rien n'est écrit en base avant « Ajouter »)
  const [showProperties, setShowProperties] = useState(false);
  const [propsDraft, setPropsDraft] = useState<{
    organizer?: string;
    settings?: Competition['settings'];
  } | null>(null);

  // Fichiers de l'extranet lus : pré-remplissage du formulaire (#1938)
  useEffect(() => {
    const imp = federalImport.result;
    if (!imp) return;
    const fields = imp.header?.fields;
    const guess = imp.fileNameGuess;
    if (fields?.title) setTitle(fields.title);
    if (fields?.date) setDate(fields.date);
    const w = fields?.weapon ?? guess.weapon;
    if (w) setWeapon(w);
    const g = fields?.gender ?? guess.gender;
    if (g) setGender(g);
    const c = fields?.category ?? guess.category;
    if (c) setCategory(c);
    if (fields?.location) setLocation(fields.location);
    setCheckInTime(fields?.checkInTime ?? '');
    setScratchTime(fields?.scratchTime ?? '');
    setStartTime(fields?.startTime ?? '');
    if (fields) setIsTeamEvent(fields.isTeamEvent);
    if (fields?.isTeamEvent && imp.teams.length > 0) {
      // Relais FIE : 3 titulaires, les membres en plus sont réservistes
      const largest = Math.max(...imp.teams.map(t => t.members.length));
      setTeamSize(Math.min(3, largest));
      setTeamReserveCount(Math.max(0, largest - 3));
    }
    setUnlocked(false);
  }, [federalImport.result]);

  // Champs fédéraux verrouillés : présents dans l'en-tête XML, non déverrouillés
  const isLocked = (present: unknown) => !!header && !unlocked && !!present;
  const locks = {
    date: isLocked(header?.fields.date),
    weapon: isLocked(header?.fields.weapon),
    gender: isLocked(header?.fields.gender),
    category: isLocked(header?.fields.category),
    location: isLocked(header?.fields.location),
    team: isLocked(header),
  };
  const today = new Date().toISOString().split('T')[0];
  const extraNotices: FederalNotice[] =
    federalImport.result && date < today ? [{ code: 'pastDate' }] : [];

  const handleWeaponChange = (w: Weapon) => {
    // Passage de « Autre » à une autre arme (ou l'inverse) : modèles de formule différents
    if ((w === Weapon.CUSTOM) !== (weapon === Weapon.CUSTOM)) setPersonalFormula(null);
    setWeapon(w);
    if (w === Weapon.LASER) setGender(Gender.MIXED);
  };

  const buildSettings = () =>
    buildDefaultCompetitionSettings({
      weapon,
      category,
      isTeamEvent,
      teamSize,
      teamReserveCount,
      laserTeamMode,
      teamFormat,
      customFormula: formulaPreview ? normalizeCustomFormula(customFormula) : customFormula,
    });

  // Modèle de départ (docs/adr/0033) : standard de l'arme × catégorie × type tant que rien
  // n'est choisi ni personnalisé ; changer de contexte revient au standard du nouveau (Q21)
  const templates = useFormulaTemplates({ weapon, category, isTeamEvent });
  const personalized = personalFormula !== null;
  const chosen = templateId ? templates.all.find(x => x.id === templateId) : undefined;
  useEffect(() => {
    if (personalized || !chosen) return;
    if (templateMatches(chosen, { weapon, category, isTeamEvent })) return;
    // Modèle choisi hors du nouveau contexte : retour au standard
    setTemplateId(null);
    setCustomFormula(createDefaultCustomFormula());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- réagit au seul changement de contexte ; chosen et personalized sont lus à ce moment-là
  }, [weapon, category, isTeamEvent]);
  const isOtherWeapon = weapon === Weapon.CUSTOM;
  const activeTemplate = chosen ?? templates.standard;

  const originOf = (tpl: FormulaTemplate | undefined) =>
    tpl ? { templateId: tpl.id, ...(tpl.season ? { season: tpl.season } : {}) } : undefined;
  /** Formule du modèle choisi (ou standard), en v2 */
  const baseFormula = (): FormulaV2 => {
    const built = buildSettings();
    return formulaOf({
      weapon,
      category,
      settings: {
        ...built,
        formula: undefined,
        ...(activeTemplate ? templateToSettings(activeTemplate, weapon, built) : {}),
      },
    });
  };
  const currentFormula = () => personalFormula ?? baseFormula();

  // Réglages de la formule de la nouvelle interface, appliqués par-dessus les réglages de base
  // (et par-dessus un brouillon de Propriétés plus ancien). Standard non personnalisé : seule
  // l'origine s'ajoute, les réglages restent ceux d'aujourd'hui. Sinon : formule v2 et réglages
  // plats dérivés (ADR-0036).
  const formulaSettings = (): Partial<Competition['settings']> => {
    if (!formulaPreview) return {};
    const formulaOrigin = originOf(activeTemplate);
    const origin = formulaOrigin ? { formulaOrigin } : {};
    if (!personalFormula && activeTemplate && activeTemplate.id === templates.standard?.id)
      return origin;
    const formula = currentFormula();
    return { ...flatSettingsOf(formula, weapon), formula, ...origin };
  };

  const selectTemplate = (tpl: FormulaTemplate) => {
    setTemplateId(tpl.id);
    setPersonalFormula(null);
  };

  const formulaState = () =>
    formulaDeviations(
      { weapon, category, settings: { ...buildSettings(), ...formulaSettings() } },
      templates.all
    );

  const saveAsTemplate = async (name: string) => {
    const body: FormulaTemplateBody = {
      kind: 'formula',
      formula: currentFormula(),
      ...(isOtherWeapon ? { other: true } : {}),
    };
    const origin =
      activeTemplate?.source === 'provided' ? originOf(activeTemplate) : activeTemplate?.origin;
    const { template } = await templates.save({ name, body, ...(origin ? { origin } : {}) });
    templates.reload();
    setTemplateId(template.id);
    setPersonalFormula(null);
  };

  // Réglages initiaux : défauts du formulaire + niveau GREG proposé à l'import (fichier
  // BPM - Escrime ou Domaine fédéral), visible et modifiable dans Propriétés (#1328)
  const initialSettings = () => {
    const built = buildSettings();
    const base = built && { ...built, ...formulaSettings() };
    const gregLevel = header?.fields.gregLevel;
    return base && gregLevel ? { ...base, gregLevel } : base;
  };

  // Objet transmis à la modale Propriétés : champs du formulaire + brouillon éventuel
  const draftCompetition = {
    id: '',
    title,
    date: new Date(date),
    weapon,
    gender,
    category,
    location,
    organizer: propsDraft?.organizer ?? '',
    settings: propsDraft?.settings ?? initialSettings(),
  } as Competition;

  const handlePropertiesSave = (updates: Partial<Competition>) => {
    if (updates.title !== undefined) setTitle(updates.title);
    if (updates.date) setDate(new Date(updates.date).toISOString().split('T')[0]);
    if (updates.location !== undefined) setLocation(updates.location);
    if (updates.weapon) setWeapon(updates.weapon);
    if (updates.gender !== undefined) setGender(updates.gender);
    if (updates.category) setCategory(updates.category);
    setPropsDraft({ organizer: updates.organizer, settings: updates.settings });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const payload = federalImport.payload ?? undefined;
    const baseSettings = propsDraft?.settings ?? initialSettings();
    const schedule = {
      ...(checkInTime ? { checkIn: checkInTime } : {}),
      ...(scratchTime ? { scratch: scratchTime } : {}),
      ...(startTime ? { start: startTime } : {}),
    };
    const settings = baseSettings && {
      ...baseSettings,
      ...formulaSettings(),
      ...(header
        ? { federal: { ...header.federal, ...(unlocked ? { unlocked: true } : {}) } }
        : {}),
      ...(Object.keys(schedule).length > 0 ? { schedule } : {}),
      // Arbitres importés : gestion des arbitres activée d'office (#1504)
      ...(payload && payload.referees.length > 0 ? { refereeFeatureEnabled: true } : {}),
    };
    const organizer = propsDraft?.organizer || header?.fields.organizer;

    onCreate(
      {
        title: title || `Compétition du ${new Date(date).toLocaleDateString(getActiveLocale())}`,
        date: new Date(date),
        weapon,
        gender,
        category,
        location,
        ...(organizer ? { organizer } : {}),
        color: getRandomColor(),
        isTeamEvent,
        ...(settings ? { settings } : {}),
      },
      payload
    );
  };

  const getRandomColor = () => {
    const colors = [
      '#3B82F6',
      '#10B981',
      '#F59E0B',
      '#EF4444',
      '#8B5CF6',
      '#EC4899',
      '#06B6D4',
      '#84CC16',
      '#F97316',
      '#6366F1',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  const isCustom = weapon === Weapon.CUSTOM;

  return (
    <>
      <div className="modal-overlay">
        <div
          ref={modalRef}
          className="modal"
          style={isCustom || formulaPreview ? { maxWidth: '94vw', width: '1200px' } : undefined}
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-header">
            <h2 className="modal-title">{t('competition.new')}</h2>
            <button className="btn-close" onClick={onClose} aria-label={t('actions.close')}>
              ×
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              <FederalImportPanel
                state={federalImport}
                extraNotices={extraNotices}
                locked={!unlocked}
                onUnlock={() => setUnlocked(true)}
              />

              <div className="form-group">
                <label className="form-label" htmlFor="new-competition-title">
                  {t('competition.title')}
                </label>
                <input
                  id="new-competition-title"
                  type="text"
                  className="form-input"
                  placeholder={t('newCompetition.title_ph')}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="new-competition-date">
                  {t('competition.date')}
                </label>
                <input
                  id="new-competition-date"
                  type="date"
                  className="form-input"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  disabled={locks.date}
                  required
                />
              </div>

              <div className="new-competition-modal-1">
                {(
                  [
                    ['check_in', checkInTime, setCheckInTime],
                    ['scratch', scratchTime, setScratchTime],
                    ['start', startTime, setStartTime],
                  ] as const
                ).map(([key, value, setValue]) => (
                  <div className="form-group" key={key}>
                    <label className="form-label" htmlFor={`new-competition-${key}`}>
                      {t(`federalImport.${key}`)}
                    </label>
                    <TimeInput id={`new-competition-${key}`} value={value} onChange={setValue} />
                  </div>
                ))}
              </div>

              <div className="new-competition-modal-1">
                <div className="form-group">
                  <label className="form-label" htmlFor="new-competition-weapon">
                    {t('competition.weapon')}
                  </label>
                  <select
                    id="new-competition-weapon"
                    className="form-input form-select"
                    value={weapon}
                    onChange={e => handleWeaponChange(e.target.value as Weapon)}
                    disabled={locks.weapon}
                  >
                    <option value={Weapon.EPEE}>{t('weapons.epee')}</option>
                    <option value={Weapon.FOIL}>{t('weapons.foil')}</option>
                    <option value={Weapon.SABRE}>{t('weapons.sabre')}</option>
                    <option value={Weapon.LASER}>{t('weapons.laser')}</option>
                    <option value={Weapon.CUSTOM}>
                      {formulaPreview ? t('weapons.other') : t('newCompetition.custom')}
                    </option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="new-competition-gender">
                    {t('competition.gender')}
                  </label>
                  <select
                    id="new-competition-gender"
                    className="form-input form-select"
                    value={gender}
                    onChange={e => setGender(e.target.value as Gender)}
                    disabled={weapon === Weapon.LASER || locks.gender}
                  >
                    <option value={Gender.MALE}>{t('genders.male')}</option>
                    <option value={Gender.FEMALE}>{t('genders.female')}</option>
                    <option value={Gender.MIXED}>{t('genders.mixed')}</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="new-competition-category">
                    {t('competition.category')}
                  </label>
                  <select
                    id="new-competition-category"
                    className="form-input form-select"
                    value={category}
                    onChange={e => setCategory(e.target.value as Category)}
                    disabled={locks.category}
                  >
                    <option value={Category.U9}>{t('categories.U9')}</option>
                    <option value={Category.U11}>{t('categories.U11')}</option>
                    <option value={Category.U13}>{t('categories.U13')}</option>
                    <option value={Category.U15}>{t('categories.U15')}</option>
                    <option value={Category.U17}>{t('categories.U17')}</option>
                    <option value={Category.U20}>{t('categories.U20')}</option>
                    <option value={Category.SENIOR}>{t('categories.senior')}</option>
                    <option value={Category.V1}>{t('categories.V1')} (40-49)</option>
                    <option value={Category.V2}>{t('categories.V2')} (50-59)</option>
                    <option value={Category.V3}>{t('categories.V3')} (60-69)</option>
                    <option value={Category.V4}>{t('categories.V4')} (70+)</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="u-row cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isTeamEvent}
                    onChange={e => setIsTeamEvent(e.target.checked)}
                    disabled={locks.team}
                  />
                  <span className="form-label new-competition-modal-2">
                    {t('newCompetition.team')}
                  </span>
                </label>
              </div>

              {isTeamEvent && (
                <div
                  className="form-group team-settings-panel"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: weapon === Weapon.LASER ? '1fr 1fr 1fr 1fr' : '1fr 1fr',
                    gap: '1rem',
                    padding: '0.75rem',
                    borderRadius: '0.5rem',
                  }}
                >
                  <div className="form-group">
                    <label className="form-label" htmlFor="new-competition-starters">
                      {t('newCompetition.starters')}
                    </label>
                    <input
                      id="new-competition-starters"
                      type="number"
                      className="form-input"
                      min={1}
                      max={10}
                      value={teamSize}
                      onChange={e => setTeamSize(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="new-competition-reserves">
                      {t('newCompetition.reserves')}
                    </label>
                    <input
                      id="new-competition-reserves"
                      type="number"
                      className="form-input"
                      min={0}
                      max={5}
                      value={teamReserveCount}
                      onChange={e => setTeamReserveCount(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                  {weapon === Weapon.LASER && (
                    <div className="form-group">
                      <label className="form-label" htmlFor="new-competition-laser-target">
                        {t('newCompetition.laser_target')}
                      </label>
                      <select
                        id="new-competition-laser-target"
                        className="form-input form-select"
                        value={laserTeamMode}
                        onChange={e => setLaserTeamMode(e.target.value as 'touches' | 'points')}
                      >
                        <option value="touches">{t('newCompetition.touches')}</option>
                        <option value="points">{t('newCompetition.points')}</option>
                      </select>
                    </div>
                  )}
                  {weapon === Weapon.LASER && (
                    <div className="form-group">
                      <label className="form-label" htmlFor="new-competition-format">
                        {t('newCompetition.format')}
                      </label>
                      <select
                        id="new-competition-format"
                        className="form-input form-select"
                        value={teamFormat}
                        onChange={e => setTeamFormat(e.target.value as 'fie-relay' | 'laser-arena')}
                      >
                        <option value="fie-relay">{t('newCompetition.fie_relay')}</option>
                        <option value="laser-arena">{t('newCompetition.laser_arena')}</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="new-competition-location">
                  {t('competition.location')} ({t('actions.optional')})
                </label>
                <PlaceSearchField
                  id="new-competition-location"
                  className="form-input"
                  placeholder={t('newCompetition.location_ph')}
                  value={location}
                  onChange={setLocation}
                  disabled={locks.location}
                />
              </div>

              {/* Nouvelle interface : formule repliée pour toutes les armes (#2013 D3) */}
              {formulaPreview && (
                <FormulaCreationSection
                  weapon={weapon}
                  category={category}
                  formula={currentFormula()}
                  onChange={setPersonalFormula}
                  picker={{
                    templates: templates.templates,
                    selectedId: activeTemplate?.id ?? null,
                    onSelect: selectTemplate,
                    ...(() => {
                      const { state, deviations } = formulaState();
                      return { state, deviations };
                    })(),
                    onReset: activeTemplate ? () => selectTemplate(activeTemplate) : undefined,
                    onSaveAs: templates.available ? saveAsTemplate : undefined,
                  }}
                />
              )}

              {/* Constructeur de formule — visible uniquement pour arme CUSTOM */}
              {isCustom && !formulaPreview && (
                <div className="form-group custom-formula-section">
                  <label className="form-label new-competition-modal-3">
                    {t('newCompetition.formula_builder')}
                  </label>
                  <FormulaBuilder
                    formula={customFormula}
                    fencerCount={32}
                    onChange={setCustomFormula}
                  />
                </div>
              )}
            </div>

            <div className="modal-footer">
              <Button type="button" onClick={() => setShowProperties(true)}>
                <Settings size={14} /> {t('competitionHeader.properties')}
              </Button>
              <Button type="button" onClick={onClose}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" variant="primary">
                {t('newCompetition.submit')}
              </Button>
            </div>
          </form>
        </div>
      </div>
      {/* Frère (et non enfant) de l'overlay : les clics et Échap ne remontent pas à la création */}
      {showProperties && (
        <CompetitionPropertiesModal
          competition={draftCompetition}
          onSave={handlePropertiesSave}
          onClose={() => setShowProperties(false)}
        />
      )}
    </>
  );
};

export default React.memo(NewCompetitionModal);
