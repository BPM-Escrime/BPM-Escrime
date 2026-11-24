/**
 * BPM - Escrime - Paramètres → Sauvegarde → Dossier de sauvegarde
 * Licensed under GPL-3.0
 *
 * Dossier des sauvegardes automatiques et de « Enregistrer » (défaut : Documents/BPM - Escrime).
 * Choix : `usePlatform().desktop.pickDirectory`, puis commande setBackupDir (docs/adr/0030).
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import type { BackupDirDTO } from '../../shared/types/preload';
import { useStationApi } from '../api/stationApi';
import { usePlatform } from '../platform/PlatformContext';
import { HINT, BOLD, SMALL_BTN } from './settingsModal.styles';
import { Button } from './common/Button';

const BackupDirSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const station = useStationApi();
  const { desktop } = usePlatform();
  const [info, setInfo] = useState<BackupDirDTO | null>(null);

  useEffect(() => {
    // Contrat (#2134) ; hors Electron (tests, navigateur) : section masquée
    station.backup
      .getDir()
      .then(setInfo)
      .catch(() => undefined);
  }, [station]);

  if (!info) return null;

  // Le choix n'écrit rien : le chemin passe ensuite par la commande du contrat
  const choose = async () => {
    const dir = await desktop?.pickDirectory({ title: t('settings.backup_dir_choose') });
    if (dir) setInfo(await station.backup.setDir(dir));
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
        {desktop && (
          <Button style={SMALL_BTN} onClick={() => void choose().catch(() => undefined)}>
            {t('settings.backup_dir_choose')}
          </Button>
        )}
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
