/**
 * BPM - Escrime - Lien « ? » de l'éditeur de formule (#2013 F5, docs/FORMULES.md)
 * Ouvre, dans le wiki intégré, la section du guide qui décrit la brique. Absent quand l'application
 * ne fournit pas l'ouverture du wiki.
 * Licensed under GPL-3.0
 */

import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { useWikiHelp } from '../../contexts/WikiHelpContext';
import { FORMULA_HELP_ARTICLE, helpTopicKey, type FormulaHelpTopic } from './formulaHelp';

interface Props {
  topic: FormulaHelpTopic;
}

export const FormulaHelpLink: React.FC<Props> = ({ topic }) => {
  const { t } = useTranslation();
  const openWikiAt = useWikiHelp();
  if (!openWikiAt) return null;
  const label = t('formulaHelp.open', { topic: t(helpTopicKey(topic)) });
  return (
    <button
      type="button"
      className="formula-help-link"
      data-testid={`formula-help-${topic}`}
      data-help-topic={topic}
      aria-label={label}
      title={label}
      onClick={() => openWikiAt({ article: FORMULA_HELP_ARTICLE, anchor: topic })}
    >
      ?
    </button>
  );
};

export default FormulaHelpLink;
