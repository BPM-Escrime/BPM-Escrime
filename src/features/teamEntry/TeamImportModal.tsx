/**
 * BPM - Escrime - Entrée en équipes : sélection des équipes à importer (#1211)
 * Même principe que l'import de tireurs : liste du fichier, cases à cocher, import groupé.
 * Licensed under GPL-3.0
 */

import React, { useState } from 'react';
import Modal from '../../renderer/components/common/Modal';
import { useTranslation } from '../../renderer/hooks/useTranslation';
import {
  TD,
  TD_CENTER,
  TD_LEFT,
  TABLE,
  STICKY_HEAD,
} from '../../renderer/components/importModal.styles';
import { RapieresFencer } from '../../shared/domain/rapieres/rapieres.types';
import type { TeamImportDraft } from './teamImport';
import { DEFAULT_TEAM_LEVELS, levelLabel } from '../../shared/domain/fencers/teamEntry';
import { Button } from '../../renderer/components/common/Button';

interface TeamImportModalProps {
  filename: string;
  teams: TeamImportDraft[];
  /** Lignes ignorées (incomplètes) du fichier */
  skipped: number[];
  onImport: (teams: TeamImportDraft[]) => void | Promise<void>;
  onClose: () => void;
  /** Libellés des niveaux de la formule (`entry.levels`) */
  levels?: readonly string[];
}

const TeamImportModal: React.FC<TeamImportModalProps> = ({
  filename,
  teams,
  skipped,
  onImport,
  onClose,
  levels = DEFAULT_TEAM_LEVELS,
}) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<number>>(() => new Set(teams.map((_, i) => i)));
  const [busy, setBusy] = useState(false);

  const toggle = (index: number) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const allSelected = selected.size === teams.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(teams.map((_, i) => i)));

  const handleImport = async () => {
    setBusy(true);
    try {
      await onImport(teams.filter((_, i) => selected.has(i)));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const fencerCell = (f: RapieresFencer) => (
    <>
      {[f.lastName.toUpperCase(), f.firstName].filter(Boolean).join(' ')}
      <br />
      <small className="team-import-meta">
        {t(`teamEntry.cat_${f.category}`)}
        {f.gender ? ` · ${t(f.gender === 'M' ? 'genders.male' : 'genders.female')}` : ''}
      </small>
    </>
  );

  return (
    <Modal
      title={t('teamEntry.import_teams')}
      onClose={onClose}
      size="lg"
      scroll
      footer={
        <>
          <Button onClick={onClose}>{t('actions.cancel')}</Button>
          <Button variant="primary" onClick={handleImport} disabled={busy || selected.size === 0}>
            {t('teamEntry.import_n', { n: String(selected.size) })}
          </Button>
        </>
      }
    >
      <div className="team-import-info">
        <strong>{t('importModal.file')}</strong> {filename}
      </div>

      {skipped.length > 0 && (
        <div className="team-import-warning">
          {t('teamEntry.import_skipped', { lines: skipped.join(', ') })}
        </div>
      )}

      <div className="team-import-toolbar">
        <span>{t('teamEntry.import_found', { n: String(teams.length) })}</span>
        <Button size="sm" onClick={toggleAll}>
          {allSelected ? t('importModal.deselect_all') : t('importModal.select_all')}
        </Button>
      </div>

      <div className="team-import-table">
        <table style={TABLE}>
          <thead style={STICKY_HEAD}>
            <tr>
              <th className="team-import-check">✓</th>
              <th style={TD_LEFT}>{t('teamEntry.team')}</th>
              <th style={TD_LEFT}>{t('teamEntry.fencer')} 1</th>
              <th style={TD_LEFT}>{t('teamEntry.fencer')} 2</th>
              <th style={TD_CENTER}>{t('teamEntry.level')}</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team, index) => {
              const on = selected.has(index);
              return (
                <tr
                  key={index}
                  onClick={() => toggle(index)}
                  className={`team-import-row${on ? ' is-selected' : ''}`}
                >
                  <td style={TD_CENTER}>
                    <input
                      type="checkbox"
                      aria-label={team.name}
                      checked={on}
                      onClick={e => e.stopPropagation()}
                      onChange={() => toggle(index)}
                    />
                  </td>
                  <td style={TD}>{team.name}</td>
                  <td style={TD}>{fencerCell(team.info.fencers[0])}</td>
                  <td style={TD}>{fencerCell(team.info.fencers[1])}</td>
                  <td style={TD_CENTER}>
                    {levelLabel(team.level, levels, code => t(`teamEntry.level_${code}`))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
};

export default TeamImportModal;
