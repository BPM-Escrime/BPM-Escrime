/**
 * BPM - Escrime - Ex aequo à la barre de qualification du tableau (#2013 étape F1,
 * docs/adr/0040) : ex aequo listés au-dessus du tableau tant qu'aucun match n'est joué ;
 * choix pour ce tableau seulement (« Selon la formule », tous qualifiés, départagés au
 * classement d'entrée). Le tableau se régénère avec le classement retenu ; la coupe est figée
 * par TableauGenerated.
 * Licensed under GPL-3.0
 */
import React from 'react';
import { Info } from 'lucide-react';
import type { TiedAtBar } from '../../../shared/domain/ranking/advancement';
import { useTranslation } from '../../hooks/useTranslation';
import { Icon } from '../common/Icon';
import { TiesAtBarSelect, tiesNotice, type TiesChoice } from '../ties/TiesAtBar';

export interface TableauTiesProps {
  tiedAtBar: TiedAtBar | null;
  value: TiesChoice | undefined;
  onChange: (ties: TiesChoice | undefined) => void;
  nameOf: (id: string) => string;
}

export const TableauTiesBanner: React.FC<TableauTiesProps> = ({
  tiedAtBar,
  value,
  onChange,
  nameOf,
}) => {
  const { t } = useTranslation();
  if (!tiedAtBar) return null;
  return (
    <div className="tableau-stage tableau-drift" role="status" data-testid="tableau-ties">
      <p>
        <Icon icon={Info} /> <strong>{tiesNotice(t, tiedAtBar, nameOf)}</strong>
      </p>
      <p className="tableau-drift-actions">
        <span>{t('tiesAtBar.choose')}</span>
        <TiesAtBarSelect value={value} allowKeep testId="tableau-ties-select" onChange={onChange} />
      </p>
    </div>
  );
};
