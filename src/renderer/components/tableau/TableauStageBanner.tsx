/**
 * BPM - Escrime - Tableau arrêté à N tireurs (#2013 étape D2b, docs/adr/0037)
 * Bandeau au-dessus du tableau : tours à jouer, puis passage à la phase suivante par la
 * commande closeTableauStage (simulation pour la confirmation, puis clôture).
 * Licensed under GPL-3.0
 */
import React from 'react';
import { Info } from 'lucide-react';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';
import { isStageDone } from '../../../shared/domain/tableau/tableauStage';
import { useBpmClient } from '../../api/BpmClientContext';
import { useTranslation } from '../../hooks/useTranslation';
import { useConfirm } from '../ConfirmDialog';
import { useToast } from '../Toast';
import { Icon } from '../common/Icon';
import { Button } from '../common/Button';

interface TableauStageBannerProps {
  competitionId: string;
  stopAt: number;
  matches: TableauMatch[];
  /** Après la clôture : appel des restants pour la phase suivante */
  onClosed: () => void;
}

export const TableauStageBanner: React.FC<TableauStageBannerProps> = ({
  competitionId,
  stopAt,
  matches,
  onClosed,
}) => {
  const { t } = useTranslation();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const client = useBpmClient();
  const done = isStageDone(matches, stopAt);

  const close = async () => {
    try {
      const sim = await client.call('closeTableauStage', { competitionId, dryRun: true });
      const ok = await confirm(
        t('tableauStage.confirm', { qualified: sim.qualified, eliminated: sim.eliminated })
      );
      if (!ok) return;
      await client.call('closeTableauStage', { competitionId });
      showToast(t('tableauStage.closed', { n: sim.qualified }), 'success');
      onClosed();
    } catch (e) {
      showToast((e as Error).message ?? String(e), 'error');
    }
  };

  return (
    <div className="alert alert--info tableau-drift" role="status" data-testid="tableau-stage">
      <p>
        <Icon icon={Info} /> <strong>{t('tableauStage.title', { n: stopAt })}</strong>
      </p>
      <p className="tableau-drift-actions">
        <span>{t('tableauStage.hint', { n: stopAt })}</span>
        <Button
          variant="primary"
          onClick={() => void close()}
          disabled={!done}
          data-testid="tableau-stage-close"
        >
          {t('tableauStage.close')}
        </Button>
      </p>
    </div>
  );
};
