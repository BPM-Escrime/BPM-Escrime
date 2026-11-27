/**
 * BPM - Escrime - Ex aequo à la barre de qualification (#2013 étape F1, docs/adr/0040)
 * Réglage de la règle de qualification (éditeur de formule) et proposition à l'exécution :
 * ex aequo listés, choix pour cette coupe seulement (champ « ties » de la commande).
 * Licensed under GPL-3.0
 */
import React from 'react';
import type { TiesAtBar } from '../../../shared/types';
import type { TiedAtBar } from '../../../shared/domain/ranking/advancement';
import { useTranslation } from '../../hooks/useTranslation';

/** Choix offerts (F1, F1c) ; « barrage » reporté (docs/adr/0040) */
export const TIES_CHOICES = ['all', 'initial_ranking', 'draw'] as const;
export type TiesChoice = (typeof TIES_CHOICES)[number];

type T = (key: string, params?: Record<string, string | number>) => string;

/** « 4 tireurs ex aequo à la 12e place pour 2 places : A, B, C, D » */
export function tiesNotice(t: T, tied: TiedAtBar, nameOf: (id: string) => string): string {
  return t('tiesAtBar.notice', {
    n: tied.fencerIds.length,
    rank: tied.rank,
    places: tied.places,
    names: tied.fencerIds.map(nameOf).join(', '),
  });
}

interface SelectProps {
  value: TiesAtBar | undefined;
  /** Choix ; undefined : réglage de la formule (proposition à l'exécution, `allowKeep`) */
  onChange: (ties: TiesChoice | undefined) => void;
  /** Proposition à l'exécution : premier choix « Selon la formule » (valeur absente) */
  allowKeep?: boolean;
  testId?: string;
  disabled?: boolean;
}

/** Liste « Tous qualifiés » / « Départagés au classement d'entrée » (/ « Selon la formule ») */
export const TiesAtBarSelect: React.FC<SelectProps> = ({
  value,
  onChange,
  allowKeep,
  testId,
  disabled,
}) => {
  const { t } = useTranslation();
  const current = value === 'barrage' ? 'all' : (value ?? (allowKeep ? '' : 'all'));
  return (
    <label className="ties-at-bar">
      <span>{t('tiesAtBar.label')}</span>
      <select
        className="form-input form-select"
        data-testid={testId ?? 'ties-at-bar'}
        value={current}
        disabled={disabled}
        onChange={e => onChange((e.target.value || undefined) as TiesChoice | undefined)}
      >
        {allowKeep && <option value="">{t('tiesAtBar.keep')}</option>}
        {TIES_CHOICES.map(c => (
          <option key={c} value={c}>
            {t(`tiesAtBar.${c}`)}
          </option>
        ))}
      </select>
    </label>
  );
};
