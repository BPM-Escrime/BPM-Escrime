/**
 * BPM - Escrime - Paramètres → Sauvegarde → Dossier de sauvegarde
 * Licensed under GPL-3.0
 *
 * Dossier des sauvegardes automatiques et de « Enregistrer » (défaut : Documents/BPM - Escrime).
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import type { BackupDirDTO } from '../../shared/types/preload';
import { useStationApi } from '../api/stationApi';
import { HINT, BOLD, SMALL_BTN } from './settingsModal.styles';
import { Button } from './common/Button';

const BackupDirSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const station = useStationApi();
  const [info, setInfo] = useState<BackupDirDTO | null>(null);

  useEffect(() => {
    // Contrat (#2134) ; hors Electron (tests, navigateur) : section masquée
    station.backup
      .getDir()
      .then(setInfo)
      .catch(() => undefined);
  }, [station]);

  if (!info) return null;

  // Sélecteur natif de dossier : reste un canal du préload (chemin du poste, comme
  // settings.addAgentFolder)
  const choose = () => {
    void window.electronAPI.backup.chooseDir().then(setInfo);
  };
  const reset = () => {
    void station.backup.resetDir().then(setInfo);
  };

  return (
    <div className="form-group">
      <label style={BOLD}>{t('settings.backup_dir_title')}</label>
      <p style={HINT}>{t('settings.backup_dir_hint')}</p>
      <p style={HINT} data-testid="backup-dir-path">
        <code>{info.dir}</code>
        {info.isDefault && ` (${t('settings.backup_dir_default')})`}
      </p>
      <div className="u-row">
        <Button style={SMALL_BTN} onClick={choose}>
          {t('settings.backup_dir_choose')}
        </Button>
        {!info.isDefault && (
          <Button style={SMALL_BTN} onClick={reset}>
            {t('settings.backup_dir_reset')}
          </Button>
        )}
      </div>
    </div>
  );
};

export default BackupDirSettingsSection;
