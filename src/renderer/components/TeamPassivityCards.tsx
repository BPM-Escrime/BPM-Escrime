/**
 * BPM - Escrime - Cartons P d'une rencontre par équipes (non-combativité, t.124 ; #2227)
 * Relais FIE des armes olympiques seulement : le parent ne rend ce bloc ni en Sabre Laser ni
 * pour l'arme à la carte. Composant présentationnel : escalade (jaune P, rouge P, noir P) et
 * vainqueur du noir P décidés par le moteur (givePassivityCard) ; annulation du jaune ou du
 * rouge P par le Directoire technique (cancelTeamCard), le noir P ne s'annule pas ainsi.
 * Licensed under GPL-3.0
 */

import React from 'react';
import { X } from 'lucide-react';
import type { PassivityCardDTO } from '../hooks/useTeamCompetition';
import { useTranslation } from '../contexts/TranslationContext';
import { TipButton } from './Tooltip';
import { Icon } from './common/Icon';
import { CardIcon } from './common/CardIcon';

const LABEL_KEYS: Record<PassivityCardDTO['type'], string> = {
  yellow: 'teams.passivityYellow',
  red: 'teams.passivityRed',
  black: 'teams.passivityBlack',
};

interface Props {
  matchId: string;
  cards: PassivityCardDTO[];
  /** Carton P suivant de l'escalade (le parent fait confirmer le noir P) */
  onGive: (matchId: string) => void;
  /** Annulation du jaune ou du rouge P (Directoire technique) */
  onCancel?: (matchId: string, cardId: string, kind: 'team') => void;
}

const TeamPassivityCards: React.FC<Props> = ({ matchId, cards, onGive, onCancel }) => {
  const { t } = useTranslation();
  const decided = cards.some(c => c.type === 'black');
  return (
    <div className="mt-2 pt-2 border-t border-gray-200 text-xs" data-testid="passivity-cards">
      <div className="text-gray-500 mb-1">{t('teams.passivityTitle')}</div>
      <div className="flex items-center gap-1 flex-wrap">
        <TipButton
          onClick={() => onGive(matchId)}
          disabled={decided}
          tip={t('teams.givePassivityCardTooltip')}
          className="px-2 py-1 rounded border border-blue-400 text-blue-700 hover:bg-blue-50 disabled:opacity-40"
        >
          {t('teams.givePassivityCard')}
        </TipButton>
        {cards.length === 0 && <span className="text-gray-400">{t('teams.passivityNone')}</span>}
        {cards.map(c => (
          <span key={c.id} className="inline-flex items-center gap-0.5">
            <CardIcon type={c.type} label={t(LABEL_KEYS[c.type])} />
            <span className="font-semibold">P</span>
            {onCancel && c.type !== 'black' && (
              <TipButton
                onClick={() => onCancel(matchId, c.id, 'team')}
                tip={t('teams.cancelCard')}
                className="text-gray-400 hover:text-red-600"
              >
                <Icon icon={X} />
              </TipButton>
            )}
          </span>
        ))}
      </div>
    </div>
  );
};

export default TeamPassivityCards;
