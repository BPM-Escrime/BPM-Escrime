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
import { Category, CompetitionSettings, Weapon } from '../../../shared/types';
import { formulaOf, phaseSettings, type FormulaV2 } from '../../../shared/domain/formula/formulaV2';
import { createDefaultCustomFormula } from '../../../shared/utils/tournamentTemplates';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';

let last: FormulaV2 | null = null;
const Harness: React.FC<{ weapon: Weapon }> = ({ weapon }) => {
  const [formula, setFormula] = useState<FormulaV2>(() =>
    formulaOf({
      weapon,
      category: Category.SENIOR,
      settings:
        weapon === Weapon.CUSTOM
          ? { customFormula: createDefaultCustomFormula() }
          : (buildDefaultCompetitionSettings({
              weapon,
              category: Category.SENIOR,
            }) as CompetitionSettings),
    })
  );
  last = formula;
  return (
    <FormulaEditor
      weapon={weapon}
      category={Category.SENIOR}
      formula={formula}
      onChange={setFormula}
    />
  );
};

describe('FormulaEditor (formule v2)', () => {
  it('frise : appel, poules, tableau, classement ; pas de « + Classement »', () => {
    render(<Harness weapon={Weapon.EPEE} />);
    expect(screen.getByTestId('formula-step-pool-0')).toBeInTheDocument();
    expect(screen.getByTestId('formula-step-tableau')).toBeInTheDocument();
    expect(screen.getByText('properties.phase_final_ranking')).toBeInTheDocument();
    expect(screen.queryByText('formulaBuilder.cls_btn')).toBeNull();
    expect(screen.queryByText('properties.add_pool_round')).toBeNull();
    // Rien après le tableau : pas de « ＋ » en fin de frise
    expect(screen.queryByTestId('formula-plus-2')).toBeNull();
  });

  it('simulation : effectif modifiable', () => {
    render(<Harness weapon={Weapon.EPEE} />);
    expect(screen.getByTestId('formula-simulation')).toHaveTextContent('formulaSim.title');
    fireEvent.change(screen.getByLabelText('formulaEditor.sim_fencers'), {
      target: { value: '48' },
    });
    expect(screen.getByLabelText('formulaEditor.sim_fencers')).toHaveValue(48);
  });

  it('« ＋ » insère un tour ; le tour 2 se règle seul (touches, répartition)', () => {
    render(<Harness weapon={Weapon.EPEE} />);
    fireEvent.click(screen.getByTestId('formula-plus-1'));
    expect(screen.queryByTestId('formula-add-tableau-1')).toBeNull();
    fireEvent.click(screen.getByTestId('formula-add-pool-1'));
    expect(screen.getByTestId('formula-step-pool-1')).toBeInTheDocument();
    fireEvent.change(document.getElementById('pool-1-score')!, { target: { value: '4' } });
    fireEvent.change(document.getElementById('pool-1-seeding')!, {
      target: { value: 'cumulative' },
    });
    expect(phaseSettings(last!, { kind: 'pool', round: 0 }).maxScore).toBe(5);
    expect(phaseSettings(last!, { kind: 'pool', round: 1 })).toMatchObject({
      maxScore: 4,
      seeding: 'cumulative',
    });
    // Le tour 1 n'a pas de réglage de répartition (rien avant lui)
    fireEvent.click(screen.getByTestId('formula-step-pool-0'));
    expect(document.getElementById('pool-0-seeding')).toBeNull();
  });

  it('retirer le tableau rend le « ＋ » de fin de frise', () => {
    render(<Harness weapon={Weapon.EPEE} />);
    fireEvent.click(screen.getByTestId('formula-remove-tableau'));
    expect(screen.queryByTestId('formula-step-tableau')).toBeNull();
    fireEvent.click(screen.getByTestId('formula-plus-1'));
    fireEvent.click(screen.getByTestId('formula-add-tableau-1'));
    expect(screen.getByTestId('formula-step-tableau')).toBeInTheDocument();
  });

  it('dernier tour avant le tableau (épée) : qualification complète (#2013 R1)', () => {
    render(<Harness weapon={Weapon.EPEE} />);
    expect(screen.getByText('formulaPhase.advancement')).toBeInTheDocument();
    expect(screen.getByText('advancement.mode_percentage')).toBeInTheDocument();
  });

  it('tableau arrêté à N : un tour de poules s’ajoute après le tableau (ADR-0037)', () => {
    render(<Harness weapon={Weapon.EPEE} />);
    fireEvent.click(screen.getByTestId('formula-step-tableau'));
    fireEvent.change(screen.getByLabelText('formulaEditor.stop_at'), { target: { value: '8' } });
    expect(last?.phases.map(p => p.kind)).toEqual(['pool', 'tableau', 'pool']);
    expect(screen.getByTestId('formula-step-pool-1')).toBeInTheDocument();
    // Jusqu'à la finale : le tour d'après disparaît
    fireEvent.change(screen.getByLabelText('formulaEditor.stop_at'), { target: { value: '0' } });
    expect(last?.phases.map(p => p.kind)).toEqual(['pool', 'tableau']);
  });

  it('arme « Autre » : règles, barème, qualification complète', () => {
    render(<Harness weapon={Weapon.CUSTOM} />);
    expect(screen.getByLabelText('formula.rule_set')).toBeInTheDocument();
    expect(screen.getByText('formulaPhase.advancement')).toBeInTheDocument();
    expect(screen.getAllByText('formulaPhase.scoring').length).toBeGreaterThan(0);
    expect(screen.getAllByText('properties.phase_final_ranking')).toHaveLength(1);
  });
});

describe('Organisation ▸ Formule : réglages affichés après enregistrement', () => {
  it('formule v2 et réglages plats du 1er tour', () => {
    const settings = buildDefaultCompetitionSettings({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    }) as CompetitionSettings;
    const f = formulaOf({ weapon: Weapon.EPEE, category: Category.SENIOR, settings });
    const out = formulaSettingsUpdate({ weapon: Weapon.EPEE, settings }, f);
    expect(out.formula).toBe(f);
    expect(out.poolRounds).toBe(1);
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

  it('sans personnaliser : mêmes réglages qu’aujourd’hui, plus l’origine standard', () => {
    const { onCreate, submit } = setup();
    expect(screen.getByTestId('formula-state')).toHaveTextContent('formulaEditor.state_standard');
    expect(screen.getByTestId('formula-template-select')).toHaveValue('bpm/E/SEN/ind/standard');
    submit();
    const expected = buildDefaultCompetitionSettings({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    });
    expect(onCreate.mock.calls[0][0].settings).toEqual({
      ...expected,
      formulaOrigin: { templateId: 'bpm/E/SEN/ind/standard' },
    });
  });

  it('changer de catégorie présélectionne le standard de la nouvelle catégorie', () => {
    setup();
    fireEvent.change(document.getElementById('new-competition-category')!, {
      target: { value: Category.U13 },
    });
    expect(screen.getByTestId('formula-template-select')).toHaveValue('bpm/E/U13/ind/standard');
    expect(screen.getByTestId('formula-summary')).toHaveTextContent('formulaEditor.summary_pools');
  });

  it('choisir un autre modèle fourni : appliqué et enregistré avec son origine', () => {
    const { onCreate, submit } = setup();
    fireEvent.change(screen.getByTestId('formula-template-select'), {
      target: { value: 'bpm/E/SEN/ind/two_rounds' },
    });
    expect(screen.getByTestId('formula-state')).toHaveTextContent('formulaEditor.state_standard');
    submit();
    const settings = onCreate.mock.calls[0][0].settings;
    expect(settings.poolRounds).toBe(2);
    expect(settings.formulaOrigin).toEqual({ templateId: 'bpm/E/SEN/ind/two_rounds' });
  });

  it('arme « Autre » : le modèle Tournoi des rapières active le mode spécial', () => {
    const { onCreate, submit } = setup();
    fireEvent.change(document.getElementById('new-competition-weapon')!, {
      target: { value: Weapon.CUSTOM },
    });
    fireEvent.change(screen.getByTestId('formula-template-select'), {
      target: { value: 'bpm/C/rapieres' },
    });
    submit();
    const settings = onCreate.mock.calls[0][0].settings;
    expect(settings.specialMode).toBe('rapieres');
    expect(settings.formulaOrigin).toEqual({ templateId: 'bpm/C/rapieres' });
  });

  it('personnalisée : le tour ajouté est enregistré', () => {
    const { onCreate, submit } = setup();
    fireEvent.click(screen.getByTestId('formula-plus-1'));
    fireEvent.click(screen.getByTestId('formula-add-pool-1'));
    expect(screen.getByTestId('formula-state')).toHaveTextContent('formulaTemplates.state_adapted');
    submit();
    const settings = onCreate.mock.calls[0][0].settings;
    expect(settings.poolRounds).toBe(2);
    expect(settings.hasDirectElimination).toBe(true);
  });

  it('« Revenir au modèle » annule la personnalisation', () => {
    const { onCreate, submit } = setup();
    fireEvent.click(screen.getByTestId('formula-plus-1'));
    fireEvent.click(screen.getByTestId('formula-add-pool-1'));
    fireEvent.click(screen.getByText('formulaTemplates.reset'));
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
