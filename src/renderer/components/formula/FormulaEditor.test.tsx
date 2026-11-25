// @vitest-environment jsdom
/**
 * Interface unique de la formule (#2013 étape B1, docs/adr/0032) : frise, « ＋ », création
 * repliée, Organisation ▸ Formule.
 */

import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../hooks/useFormulaPreview', () => ({ useFormulaPreview: () => true }));

import { FormulaEditor } from './FormulaEditor';
import { formulaSettingsUpdate } from './CompetitionFormulaModal';
import NewCompetitionModal from '../NewCompetitionModal';
import { Category, CompetitionSettings, CustomFormulaConfig, Weapon } from '../../../shared/types';
import { FormulaDraft, draftFromSettings } from '../../../shared/domain/formula/formulaDraft';
import { createDefaultCustomFormula } from '../../../shared/utils/tournamentTemplates';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';

const Harness: React.FC<{ weapon: Weapon }> = ({ weapon }) => {
  const [draft, setDraft] = useState<FormulaDraft>(() =>
    draftFromSettings(weapon, Category.SENIOR, undefined)
  );
  const [custom, setCustom] = useState<CustomFormulaConfig>(createDefaultCustomFormula);
  return (
    <FormulaEditor
      weapon={weapon}
      category={Category.SENIOR}
      draft={draft}
      onDraftChange={p => setDraft(d => ({ ...d, ...p }))}
      customFormula={custom}
      onCustomChange={setCustom}
    />
  );
};

describe('FormulaEditor', () => {
  it('frise : appel, poules, tableau, classement ; pas de « + Classement »', () => {
    render(<Harness weapon={Weapon.EPEE} />);
    expect(screen.getByTestId('formula-step-pool-0')).toBeInTheDocument();
    expect(screen.getByTestId('formula-step-tableau')).toBeInTheDocument();
    expect(screen.getByText('properties.phase_final_ranking')).toBeInTheDocument();
    expect(screen.queryByText('formulaBuilder.cls_btn')).toBeNull();
    // Rien après le tableau : pas de « ＋ » en fin de frise
    expect(screen.queryByTestId('formula-plus-2')).toBeNull();
  });

  it('« ＋ » propose les briques autorisées et insère un tour', () => {
    render(<Harness weapon={Weapon.EPEE} />);
    fireEvent.click(screen.getByTestId('formula-plus-1'));
    expect(screen.queryByTestId('formula-add-tableau-1')).toBeNull();
    fireEvent.click(screen.getByTestId('formula-add-pool-1'));
    expect(screen.getByTestId('formula-step-pool-1')).toBeInTheDocument();
  });

  it('retirer le tableau rend le « ＋ » de fin de frise', () => {
    render(<Harness weapon={Weapon.EPEE} />);
    fireEvent.click(screen.getByTestId('formula-remove-tableau'));
    expect(screen.queryByTestId('formula-step-tableau')).toBeNull();
    fireEvent.click(screen.getByTestId('formula-plus-1'));
    fireEvent.click(screen.getByTestId('formula-add-tableau-1'));
    expect(screen.getByTestId('formula-step-tableau')).toBeInTheDocument();
  });

  it('arme « Autre » : même frise, « Classement final » implicite', () => {
    render(<Harness weapon={Weapon.CUSTOM} />);
    expect(screen.getByTestId('formula-step-pool-0')).toBeInTheDocument();
    expect(screen.getByTestId('formula-step-tableau')).toBeInTheDocument();
    expect(screen.getAllByText('properties.phase_final_ranking')).toHaveLength(1);
    expect(screen.getByLabelText('formula.rule_set')).toBeInTheDocument();
  });
});

describe('Organisation ▸ Formule : réglages enregistrés', () => {
  it('épée : réglages plats, comme l’onglet Formule des Propriétés', () => {
    const settings = buildDefaultCompetitionSettings({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    }) as CompetitionSettings;
    const draft = { ...draftFromSettings(Weapon.EPEE, Category.SENIOR, settings), poolRounds: 2 };
    const out = formulaSettingsUpdate(
      { weapon: Weapon.EPEE, settings },
      draft,
      createDefaultCustomFormula()
    );
    expect(out.poolRounds).toBe(2);
    expect(out.poolRoundQualifiers).toEqual([0]);
    expect(out.customFormula).toBeUndefined();
  });

  it('arme « Autre » : formule normalisée et réglages dérivés', () => {
    const custom = createDefaultCustomFormula();
    const out = formulaSettingsUpdate(
      { weapon: Weapon.CUSTOM, settings: { customFormula: custom } as CompetitionSettings },
      draftFromSettings(Weapon.CUSTOM, Category.SENIOR, undefined),
      custom
    );
    expect(out.customFormula?.phases.map(p => p.type)).toEqual([
      'pool_round',
      'direct_elimination',
    ]);
    expect(out.hasDirectElimination).toBe(true);
    expect(out.defaultTableMaxScore).toBe(15);
  });
});

describe('Création : formule repliée (aperçu)', () => {
  const setup = () => {
    const onCreate = vi.fn();
    const { container } = render(<NewCompetitionModal onCreate={onCreate} onClose={vi.fn()} />);
    return { onCreate, submit: () => fireEvent.submit(container.querySelector('form')!) };
  };

  it('« À la carte » devient « Autre »', () => {
    setup();
    expect(screen.getByRole('option', { name: 'weapons.other' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'newCompetition.custom' })).toBeNull();
  });

  it('sans personnaliser : mêmes réglages qu’aujourd’hui, aucun clic de plus', () => {
    const { onCreate, submit } = setup();
    expect(screen.getByTestId('formula-state')).toHaveTextContent('formulaEditor.state_standard');
    submit();
    const expected = buildDefaultCompetitionSettings({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    });
    expect(onCreate.mock.calls[0][0].settings).toEqual(expected);
  });

  it('personnalisée : le tour ajouté est enregistré', () => {
    const { onCreate, submit } = setup();
    fireEvent.click(screen.getByTestId('formula-plus-1'));
    fireEvent.click(screen.getByTestId('formula-add-pool-1'));
    expect(screen.getByTestId('formula-state')).toHaveTextContent('formulaEditor.state_custom');
    submit();
    const settings = onCreate.mock.calls[0][0].settings;
    expect(settings.poolRounds).toBe(2);
    expect(settings.hasDirectElimination).toBe(true);
  });

  it('« Revenir au standard » annule la personnalisation', () => {
    const { onCreate, submit } = setup();
    fireEvent.click(screen.getByTestId('formula-plus-1'));
    fireEvent.click(screen.getByTestId('formula-add-pool-1'));
    fireEvent.click(screen.getByText('formulaEditor.reset_standard'));
    submit();
    expect(onCreate.mock.calls[0][0].settings.poolRounds).toBe(1);
  });

  it('arme « Autre » : formule enregistrée sans « Classement final »', () => {
    const { onCreate, submit } = setup();
    fireEvent.change(document.getElementById('new-competition-weapon')!, {
      target: { value: Weapon.CUSTOM },
    });
    submit();
    const settings = onCreate.mock.calls[0][0].settings;
    expect(settings.customFormula.phases.map((p: { type: string }) => p.type)).toEqual([
      'pool_round',
      'direct_elimination',
    ]);
  });
});
