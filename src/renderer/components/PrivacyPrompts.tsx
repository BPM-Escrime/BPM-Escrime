/**
 * BellePoule Modern - Invite RGPD globale (#1882) : rappel au démarrage des données dépassant
 * la durée de conservation. Le mot de passe d'une archive chiffrée : EncryptedBpmPrompt.
 * Licensed under GPL-3.0
 */

import React, { useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from './Toast';
import { stationAvailable, useStationApi } from '../api/stationApi';

const PrivacyPrompts: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const privacyApi = useStationApi().privacy;

  // Rappel unique au démarrage : purge assistée (sans purge automatique)
  useEffect(() => {
    if (!stationAvailable()) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await privacyApi.getSettings();
        if (s.autoPurge || (!s.competitionRetentionMonths && !s.memberRetentionMonths)) return;
        const c = await privacyApi.retentionCandidates();
        if (cancelled || (c.competitions.length === 0 && c.members.length === 0)) return;
        showToast(
          t('privacy.retention_reminder', {
            competitions: c.competitions.length,
            members: c.members.length,
          }),
          'warning',
          { duration: 10000 }
        );
      } catch {
        // hors Electron ou base fermée
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
};

export default PrivacyPrompts;
