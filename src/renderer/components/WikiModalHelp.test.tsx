// @vitest-environment jsdom
/**
 * Wiki intégré ouvert depuis l'aide de la formule (#2013 F5) : article demandé affiché, titre de
 * la section ancré et amené en vue.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

vi.mock('../contexts/TranslationContext', () => ({
  useTranslation: () => ({ language: 'fr', t: (k: string) => k }),
}));

import WikiModal from './WikiModal';

describe('WikiModal : ouverture sur une section', () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  it("affiche l'article demandé et amène l'ancre en vue", () => {
    render(<WikiModal onClose={vi.fn()} initialArticleId="formula-bricks" initialAnchor="split" />);
    expect(screen.getByRole('heading', { level: 1, name: /Formules : les briques/ })).toBeVisible();
    const title = document.getElementById('wiki-split');
    expect(title).toHaveTextContent('Scission en compétitions filles');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(title);
  });

  it('sans cible : démarrage rapide, aucun défilement', () => {
    render(<WikiModal onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1, name: /Démarrage rapide/ })).toBeVisible();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
