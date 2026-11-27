// @vitest-environment jsdom
/**
 * Ex aequo à la barre à l'écran (#2013 F1, docs/adr/0040) : réglage dans l'éditeur de formule
 * (règle de qualification du tour, nombre d'une branche de scission), choix « choose » de la
 * fenêtre de confirmation.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
  }),
}));

import { Category, Weapon } from '../../../shared/types';
import type { SplitPhase } from '../../../shared/domain/formula/formulaV2';
import { AdvancementRuleEditor } from '../formula/AdvancementRuleEditor';
import { SplitPhaseEditor } from '../formula/SplitPhaseEditor';
import { ConfirmProvider, useConfirm } from '../ConfirmDialog';

describe('éditeur de formule : ex aequo à la barre (ADR-0040)', () => {
  it('règle à nombre fixé : réglage proposé, gardé quand le mode change', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AdvancementRuleEditor rule={{ mode: 'fixed_count', count: 16 }} onChange={onChange} expert />
    );
    fireEvent.change(screen.getByTestId('advancement-ties'), {
      target: { value: 'initial_ranking' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'fixed_count',
      count: 16,
      ties: 'initial_ranking',
    });
    rerender(
      <AdvancementRuleEditor
        rule={{ mode: 'fixed_count', count: 16, ties: 'initial_ranking' }}
        onChange={onChange}
        expert
      />
    );
    expect(screen.getByTestId('advancement-ties')).toHaveValue('initial_ranking');
    fireEvent.change(screen.getByRole('combobox', { name: '' }), {
      target: { value: 'percentage' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'percentage',
      percentage: 80,
      ties: 'initial_ranking',
    });
  });

  it('tous qualifiés : pas de réglage (aucune barre)', () => {
    render(<AdvancementRuleEditor rule={{ mode: 'all' }} onChange={vi.fn()} expert />);
    expect(screen.queryByTestId('advancement-ties')).toBeNull();
  });

  it('niveau simple : réglage réservé au mode expert (ADR-0041)', () => {
    render(<AdvancementRuleEditor rule={{ mode: 'fixed_count', count: 16 }} onChange={vi.fn()} />);
    expect(screen.queryByTestId('advancement-ties')).toBeNull();
  });

  it('scission par rang : réglage sur le nombre de la branche', () => {
    const split: SplitPhase = {
      kind: 'split',
      id: 's',
      criterion: 'rank',
      branches: [
        { label: 'A', phases: [], take: { mode: 'fixed_count', count: 8 } },
        { label: 'B', phases: [] },
      ],
    };
    const onChange = vi.fn();
    render(
      <SplitPhaseEditor
        split={split}
        weapon={Weapon.EPEE}
        category={Category.SENIOR}
        onChange={onChange}
        newId={() => 'x'}
      />
    );
    fireEvent.change(screen.getByTestId('split-take-ties-0'), {
      target: { value: 'initial_ranking' },
    });
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0].branches[0].take).toEqual({
      mode: 'fixed_count',
      count: 8,
      ties: 'initial_ranking',
    });
  });
});

describe('fenêtre de confirmation : choose', () => {
  it('un bouton par choix ; la valeur cliquée est rendue', async () => {
    let result: Promise<string | null> | undefined;
    const Ask = () => {
      const { choose } = useConfirm();
      return (
        <button
          onClick={() => {
            result = choose({
              message: 'Quoi ?',
              choices: [
                { value: 'all', label: 'Tous' },
                { value: 'initial_ranking', label: 'Départager' },
              ],
            });
          }}
        >
          ask
        </button>
      );
    };
    render(
      <ConfirmProvider>
        <Ask />
      </ConfirmProvider>
    );
    fireEvent.click(screen.getByText('ask'));
    fireEvent.click(await screen.findByTestId('confirm-choice-initial_ranking'));
    await expect(result).resolves.toBe('initial_ranking');
  });
});
