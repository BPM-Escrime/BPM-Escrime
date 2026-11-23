/**
 * BPM - Escrime - Aide du planificateur d'arène (#2075)
 * Mode d'emploi court, raccourcis et règles du livret, repliable.
 * Licensed under GPL-3.0
 */

import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';

export const ArenaPlanHelp: React.FC = () => {
  const { t } = useTranslation();
  return (
    <details className="arena-planner-help">
      <summary>{t('arenaPlanner.help_title')}</summary>
      <ol>
        <li>{t('arenaPlanner.help_1')}</li>
        <li>{t('arenaPlanner.help_2')}</li>
        <li>{t('arenaPlanner.help_3')}</li>
        <li>{t('arenaPlanner.help_4')}</li>
        <li>{t('arenaPlanner.help_5')}</li>
      </ol>
      <ul>
        <li>{t('arenaPlanner.help_keys')}</li>
        <li>{t('arenaPlanner.help_exit')}</li>
        <li>{t('arenaPlanner.help_blocked')}</li>
        <li>{t('arenaPlanner.help_rules')}</li>
      </ul>
    </details>
  );
};

export default ArenaPlanHelp;
