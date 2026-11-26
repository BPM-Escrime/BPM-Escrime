/**
 * BPM - Escrime - Lancement de la scission (#2013 étape E2b, docs/adr/0039) : commande
 * splitCompetition en simulation (branches, tireurs par branche, tireurs sans valeur pour le
 * critère), confirmation, puis scission. L'écran n'écrit rien d'autre.
 * Licensed under GPL-3.0
 */
import React, { useEffect, useState } from 'react';
import type { SplitCriterion } from '../../../shared/domain/formula/formulaV2';
import type { Output } from '../../../shared/api/contract';
import { useBpmClient } from '../../api/BpmClientContext';
import { useTranslation } from '../../hooks/useTranslation';
import { useToast } from '../Toast';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

type SplitResult = Output<'splitCompetition'>;

interface SplitLaunchDialogProps {
  competitionId: string;
  criterion: SplitCriterion;
  onClose: () => void;
  /** Scission faite : compétitions filles créées */
  onDone: (result: SplitResult) => void;
}

export const SplitLaunchDialog: React.FC<SplitLaunchDialogProps> = ({
  competitionId,
  criterion,
  onClose,
  onDone,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const client = useBpmClient();
  const [plan, setPlan] = useState<SplitResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    client
      .call('splitCompetition', { competitionId, dryRun: true })
      .then(sim => live && setPlan(sim))
      .catch((e: unknown) => {
        if (!live) return;
        showToast((e as Error).message ?? String(e), 'error');
        onClose();
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- simulation une fois à l'ouverture
  }, [competitionId]);

  const run = async () => {
    setBusy(true);
    try {
      onDone(await client.call('splitCompetition', { competitionId }));
    } catch (e) {
      showToast((e as Error).message ?? String(e), 'error');
      setBusy(false);
    }
  };

  const blocked = !!plan && plan.missing.length > 0;
  return (
    <Modal
      title={t('splitLaunch.title')}
      onClose={onClose}
      size="md"
      scroll
      closeOnOverlay={false}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            data-testid="split-launch-confirm"
            disabled={!plan || blocked || busy}
            onClick={() => void run()}
          >
            {t('splitLaunch.confirm')}
          </Button>
        </>
      }
    >
      {!plan ? (
        <p>{t('splitLaunch.loading')}</p>
      ) : (
        <div data-testid="split-launch-plan">
          <p>{t('splitLaunch.intro')}</p>
          <table className="split-launch__table">
            <thead>
              <tr>
                <th>{t('splitLaunch.col_branch')}</th>
                <th>{t('splitLaunch.col_fencers')}</th>
              </tr>
            </thead>
            <tbody>
              {plan.branches.map(b => (
                <tr key={b.label}>
                  <td>{b.label}</td>
                  <td>{b.fencers.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {blocked && (
            <div className="split-launch__missing" role="alert" data-testid="split-launch-missing">
              <strong>{t('splitLaunch.missing_title', { n: plan.missing.length })}</strong>
              <ul>
                {plan.missing.map(f => (
                  <li key={f.id}>
                    {f.lastName} {f.firstName}
                  </li>
                ))}
              </ul>
              <p>
                {t(
                  criterion === 'category'
                    ? 'splitLaunch.missing_fix_category'
                    : 'splitLaunch.missing_fix_gender'
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default SplitLaunchDialog;
