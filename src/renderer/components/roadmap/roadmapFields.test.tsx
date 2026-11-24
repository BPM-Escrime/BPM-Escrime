// @vitest-environment jsdom
/**
 * Pastilles de variables : insertion dans le champ actif, sinon champ source ;
 * clic droit → champ source ; badges des variables à côté du libellé
 */
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { emptyInfo, roadmapVariables } from '@shared/domain/roadmap/roadmap';
import { FieldFocusProvider, TextField, VariableChips } from './roadmapFields';

vi.mock('../../hooks/useTranslation', () => import('../../testUtils/i18nMock'));

const vars = roadmapVariables(emptyInfo(), iso => iso);

const Field: React.FC = () => {
  const [value, setValue] = useState('');
  return <TextField label="Texte" value={value} onChange={setValue} />;
};

describe('VariableChips', () => {
  it('sans champ actif : clic → champ source', () => {
    const onGoTo = vi.fn();
    const { getByText } = render(
      <FieldFocusProvider>
        <VariableChips vars={vars} onGoTo={onGoTo} />
      </FieldFocusProvider>
    );
    fireEvent.click(getByText('{lieu}'));
    expect(onGoTo).toHaveBeenCalledWith('lieu');
  });

  it('champ actif : clic → insertion ; clic droit → champ source', () => {
    const onGoTo = vi.fn();
    const { getByText, getByRole } = render(
      <FieldFocusProvider>
        <VariableChips vars={vars} onGoTo={onGoTo} />
        <Field />
      </FieldFocusProvider>
    );
    const input = getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.click(getByText('{date}'));
    expect(input.value).toBe('{date}');
    expect(onGoTo).not.toHaveBeenCalled();
    fireEvent.contextMenu(getByText('{tarifs}'));
    expect(onGoTo).toHaveBeenCalledWith('tarifs');
  });
});

describe('TextField', () => {
  it('affiche les variables alimentées à côté du libellé', () => {
    const { container } = render(
      <TextField label="Lieu" value="" onChange={() => {}} variables={['lieu']} />
    );
    expect(container.querySelector('.roadmap-field-vars code')?.textContent).toBe('{lieu}');
  });
});
