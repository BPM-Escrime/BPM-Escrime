/**
 * BPM - Escrime - Lancement de la scission (#2013 étapes E2b, E3 ; docs/adr/0039) : commande
 * splitCompetition en simulation (branches, tireurs par branche, tireurs sans valeur pour le
 * critère), confirmation, puis scission. Scission manuelle (E3) : classement d'entrée rendu par
 * la simulation, une branche par tireur (tri, « Tout dans… »), simulation relancée avec les
 * affectations à chaque changement ; confirmation tant qu'un tireur n'est pas affecté : non.
 * Ex aequo à une borne (docs/adr/0040) : listés, choix pour cette scission (« ties »).
 * L'écran n'écrit rien d'autre ; la répartition reste celle du moteur (planSplit).
 * Licensed under GPL-3.0
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SplitCriterion } from '../../../shared/domain/formula/formulaV2';
import type { Output } from '../../../shared/api/contract';
import { useBpmClient } from '../../api/BpmClientContext';
import { useTranslation } from '../../hooks/useTranslation';
import { useToast } from '../Toast';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { TiesAtBarSelect, tiesNotice, type TiesChoice } from '../ties/TiesAtBar';

type SplitResult = Output<'splitCompetition'>;
type Entrant = SplitResult['entrants'][number];
type SortKey = 'rank' | 'gender' | 'club' | 'birthDate';

interface SplitLaunchDialogProps {
  competitionId: string;
  criterion: SplitCriterion;
  onClose: () => void;
  /** Scission faite : compétitions filles créées */
  onDone: (result: SplitResult) => void;
}

const SORTS: SortKey[] = ['rank', 'gender', 'club', 'birthDate'];

/** Tri d'affichage du classement d'entrée ; à égalité, le rang */
function sortEntrants(list: readonly Entrant[], key: SortKey): Entrant[] {
  const value = (e: Entrant): string | number =>
    key === 'rank' ? e.rank : ((key === 'gender' ? e.gender : e[key]) ?? '￿');
  return [...list].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === y) return a.rank - b.rank;
    return typeof x === 'number' && typeof y === 'number'
      ? x - y
      : String(x).localeCompare(String(y));
  });
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
  const manual = criterion === 'manual';
  const [plan, setPlan] = useState<SplitResult | null>(null);
  const [busy, setBusy] = useState(false);
  /** Scission manuelle : branche (libellé) de chaque tireur */
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortKey>('rank');
  const [allTo, setAllTo] = useState('');
  /** Ex aequo à une borne (docs/adr/0040) : choix pour cette scission ; absent = formule */
  const [ties, setTies] = useState<TiesChoice | undefined>(undefined);
  const request = useRef(0);

  const assignments = useMemo(
    () => Object.entries(assigned).map(([fencerId, branch]) => ({ fencerId, branch })),
    [assigned]
  );

  // Simulation à l'ouverture, puis à chaque affectation (scission manuelle)
  useEffect(() => {
    let live = true;
    const n = ++request.current;
    client
      .call('splitCompetition', {
        competitionId,
        dryRun: true,
        ...(manual && assignments.length ? { assignments } : {}),
        ...(ties ? { ties } : {}),
      })
      .then(sim => live && n === request.current && setPlan(sim))
      .catch((e: unknown) => {
        if (!live) return;
        showToast((e as Error).message ?? String(e), 'error');
        onClose();
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- simulation : ouverture, affectations, ex aequo
  }, [competitionId, assignments, ties]);

  const run = async () => {
    setBusy(true);
    try {
      onDone(
        await client.call('splitCompetition', {
          competitionId,
          ...(manual ? { assignments } : {}),
          ...(ties ? { ties } : {}),
        })
      );
    } catch (e) {
      showToast((e as Error).message ?? String(e), 'error');
      setBusy(false);
    }
  };

  const labels = plan?.branches.map(b => b.label) ?? [];
  const nameOf = (id: string) => {
    const e = plan?.entrants.find(x => x.id === id);
    return e ? `${e.lastName} ${e.firstName}` : id;
  };
  const entrants = useMemo(() => sortEntrants(plan?.entrants ?? [], sort), [plan, sort]);
  const assign = (fencerId: string, branch: string) =>
    setAssigned(prev => {
      const next = { ...prev };
      if (branch) next[fencerId] = branch;
      else delete next[fencerId];
      return next;
    });
  const assignAll = () => {
    if (!allTo || !plan) return;
    setAssigned(Object.fromEntries(plan.entrants.map(e => [e.id, allTo])));
  };

  const blocked = !!plan && plan.missing.length > 0;
  return (
    <Modal
      title={t('splitLaunch.title')}
      onClose={onClose}
      size={manual ? 'lg' : 'md'}
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
          {(plan.tiedAtBar.length > 0 || ties) && (
            <div className="split-launch__ties" role="status" data-testid="split-launch-ties">
              {plan.tiedAtBar.map(tied => (
                <p key={`${tied.rank}-${tied.fencerIds.join()}`}>{tiesNotice(t, tied, nameOf)}</p>
              ))}
              <TiesAtBarSelect
                value={ties}
                allowKeep
                testId="split-launch-ties-select"
                onChange={setTies}
              />
            </div>
          )}
          {manual && (
            <div className="split-launch__manual" data-testid="split-launch-manual">
              <div className="split-launch__tools">
                <label className="u-row">
                  <span>{t('splitLaunch.sort')}</span>
                  <select
                    className="form-input form-select"
                    data-testid="split-launch-sort"
                    value={sort}
                    onChange={e => setSort(e.target.value as SortKey)}
                  >
                    {SORTS.map(k => (
                      <option key={k} value={k}>
                        {t(`splitLaunch.sort_${k}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="u-row">
                  <span>{t('splitLaunch.all_in')}</span>
                  <select
                    className="form-input form-select"
                    data-testid="split-launch-all-branch"
                    value={allTo}
                    onChange={e => setAllTo(e.target.value)}
                  >
                    <option value="">—</option>
                    {labels.map(l => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  data-testid="split-launch-all"
                  disabled={!allTo}
                  onClick={assignAll}
                >
                  {t('splitLaunch.all_apply')}
                </Button>
              </div>
              <table className="split-launch__table" data-testid="split-launch-entrants">
                <thead>
                  <tr>
                    <th>{t('splitLaunch.col_rank')}</th>
                    <th>{t('splitLaunch.col_fencer')}</th>
                    <th>{t('splitLaunch.sort_gender')}</th>
                    <th>{t('splitLaunch.sort_club')}</th>
                    <th>{t('splitLaunch.sort_birthDate')}</th>
                    <th>{t('splitLaunch.col_branch')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entrants.map(e => (
                    <tr key={e.id} data-testid={`split-launch-row-${e.id}`}>
                      <td>{e.rank}</td>
                      <td>
                        {e.lastName} {e.firstName}
                      </td>
                      <td>{e.gender ?? ''}</td>
                      <td>{e.club ?? ''}</td>
                      <td>{e.birthDate ? new Date(e.birthDate).toLocaleDateString() : ''}</td>
                      <td>
                        <select
                          className="form-input form-select"
                          aria-label={t('splitLaunch.col_branch')}
                          data-testid={`split-launch-branch-${e.id}`}
                          value={assigned[e.id] ?? ''}
                          onChange={ev => assign(e.id, ev.target.value)}
                        >
                          <option value="">—</option>
                          {labels.map(l => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {blocked && manual && (
            <p className="split-launch__missing" role="alert" data-testid="split-launch-missing">
              {t('splitLaunch.manual_missing', { n: plan.missing.length })}
            </p>
          )}
          {blocked && !manual && (
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
