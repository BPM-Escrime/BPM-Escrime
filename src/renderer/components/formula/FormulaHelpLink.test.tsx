// @vitest-environment jsdom
/**
 * Lien « ? » de l'éditeur de formule (#2013 F5) : ouvre l'article du guide à la bonne ancre,
 * absent sans fournisseur (aucun canal du poste, ADR-0030).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, p?: Record<string, string>) => (p?.topic ? `${k}:${p.topic}` : k),
  }),
}));

import { FormulaHelpLink } from './FormulaHelpLink';
import { WikiHelpProvider } from '../../contexts/WikiHelpContext';

describe('FormulaHelpLink', () => {
  it("ouvre l'article du guide sur l'ancre de la brique", () => {
    const open = vi.fn();
    render(
      <WikiHelpProvider value={open}>
        <FormulaHelpLink topic="stopped-tableau" />
      </WikiHelpProvider>
    );
    const link = screen.getByTestId('formula-help-stopped-tableau');
    expect(link).toHaveAccessibleName('formulaHelp.open:formulaHelp.topic_stopped_tableau');
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith({ article: 'formula-bricks', anchor: 'stopped-tableau' });
  });

  it('rien sans fournisseur du wiki', () => {
    const { container } = render(<FormulaHelpLink topic="pools" />);
    expect(container).toBeEmptyDOMElement();
  });
});
