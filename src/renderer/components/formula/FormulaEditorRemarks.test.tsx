// @vitest-environment jsdom
/**
 * Éditeur de formule : remarques en direct sur la phase fautive, Enregistrer grisé, mode expert
 * (#2013 F2, docs/adr/0041).
 */

import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../hooks/useFormulaPreview', () => ({ useFormulaPreview: () => true }));
// Préférence du poste : lue et écrite par le contrat (réglages du poste), jamais window.electronAPI
const station = vi.hoisted(() => ({ expert: false, saved: [] as boolean[] }));
vi.mock('../../hooks/useFormulaExpert', async () => {
  const { useState } = await import('react');
  return {
    useFormulaExpert: () => {
      const [expert, setLocal] = useState(station.expert);
      return {
        expert,
        setExpert: (v: boolean) => {
          station.saved.push(v);
          setLocal(v);
        },
      };
    },
  };
});

vi.mock('../../hooks/useFormulaTemplates', () => ({
  useFormulaTemplates: () => ({
    templates: [],
    all: [],
    available: false,
    save: vi.fn(),
    reload: vi.fn(),
  }),
}));
vi.mock('../../api/BpmClientContext', () => ({
  useBpmClient: () => ({ call: vi.fn(), query: vi.fn() }),
}));
vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import { FormulaEditor } from './FormulaEditor';
import { CompetitionFormulaModal } from './CompetitionFormulaModal';
import { Category, Competition, CompetitionSettings, Gender, Weapon } from '../../../shared/types';
import {
  formulaOf,
  type FormulaV2,
  type PoolRoundPhase,
  type TableauPhase,
} from '../../../shared/domain/formula/formulaV2';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';

const settings = (weapon: Weapon) =>
  buildDefaultCompetitionSettings({ weapon, category: Category.SENIOR }) as CompetitionSettings;
const base = (weapon = Weapon.EPEE): FormulaV2 =>
  formulaOf({ weapon, category: Category.SENIOR, settings: settings(weapon) });

let last: FormulaV2 | null = null;
const Harness: React.FC<{
  initial: FormulaV2;
  weapon?: Weapon;
  progress?: ('pool' | 'quest' | 'tableau' | 'split')[];
}> = ({ initial, weapon = Weapon.EPEE, progress }) => {
  const [formula, setFormula] = useState(initial);
  last = formula;
  return (
    <FormulaEditor
      weapon={weapon}
      category={Category.SENIOR}
      formula={formula}
      onChange={setFormula}
      progress={progress}
    />
  );
};

const withPools = (extra: Partial<PoolRoundPhase>[], tableau = true): FormulaV2 => {
  const f = base();
  const pool = f.phases[0] as PoolRoundPhase;
  const t = f.phases[1] as TableauPhase;
  return {
    ...f,
    phases: [...extra.map((e, i) => ({ ...pool, id: `p${i}`, ...e })), ...(tableau ? [t] : [])],
  };
};

beforeEach(() => {
  station.expert = false;
  station.saved = [];
});

describe('remarques en direct sur la carte de la phase (ADR-0041)', () => {
  it('formule valide : aucune remarque', () => {
    render(<Harness initial={base()} />);
    expect(screen.queryByTestId('formula-remark-pool-0')).toBeNull();
    expect(screen.queryByTestId('phase-remarks')).toBeNull();
    expect(screen.queryByTestId('formula-remarks')).toBeNull();
  });

  it('S3 : la remarque s’affiche sur la phase fautive, pas sur les autres', () => {
    const f = withPools([{ qualification: { mode: 'fixed_count', count: 3 } }, {}]);
    render(<Harness initial={f} />);
    expect(screen.getByTestId('formula-remark-pool-0')).toBeInTheDocument();
    expect(screen.queryByTestId('formula-remark-pool-1')).toBeNull();
    expect(screen.getByTestId('phase-remarks')).toHaveTextContent('tour 1 : 3 qualifié(s)');
    // Autre phase : sa carte n'a pas de remarque
    fireEvent.click(screen.getByTestId('formula-step-pool-1'));
    expect(screen.queryByTestId('phase-remarks')).toBeNull();
  });

  it('la remarque disparaît dès que l’erreur est corrigée', () => {
    const f = withPools([{ qualification: { mode: 'fixed_count', count: 3 } }, {}]);
    render(<Harness initial={f} />);
    expect(screen.getByTestId('formula-remark-pool-0')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('formula-remove-pool-1'));
    expect(screen.queryByTestId('formula-remark-pool-0')).toBeNull();
  });

  it('formule entière : remarque en tête (plus de 5 tours)', () => {
    render(<Harness initial={withPools([{}, {}, {}, {}, {}, {}])} />);
    expect(screen.getByTestId('formula-remarks')).toHaveTextContent('5 tours de poules au plus');
  });

  it('S6 : phase commencée retirée, remarque sur sa clé ou en tête', () => {
    render(<Harness initial={withPools([{}], true)} progress={['pool', 'pool']} />);
    expect(screen.getByTestId('formula-remarks')).toHaveTextContent('phase déjà commencée');
  });
});

describe('mode expert de l’éditeur (ADR-0041, Q17)', () => {
  it('niveau simple : ni Tour Quest ni scission au « ＋ », ni tableau arrêté, ni réglages avancés', () => {
    render(<Harness initial={base(Weapon.LASER)} weapon={Weapon.LASER} />);
    expect(screen.getByTestId('formula-expert-toggle')).not.toBeChecked();
    // Laser : le Tour Quest ne se propose pas
    fireEvent.click(screen.getByTestId('formula-plus-1'));
    expect(screen.queryByTestId('formula-add-quest-1')).toBeNull();
    expect(screen.getByTestId('formula-add-pool-1')).toBeInTheDocument();
    // Tour de poules : pas de réglages avancés (ordre des matchs, cumul)
    expect(document.getElementById('pool-0-order')).toBeNull();
    expect(screen.queryByTestId('pool-0-expert')).toBeNull();
    // Qualification : pas d'ex aequo à la barre
    expect(screen.queryByTestId('advancement-ties')).toBeNull();
    // Tableau complet : pas d'arrêt à N
    fireEvent.click(screen.getByTestId('formula-step-tableau'));
    expect(document.getElementById('tableau-stop-at')).toBeNull();
  });

  it('niveau simple : la fin de frise ne propose pas la scission', () => {
    render(<Harness initial={withPools([{}], false)} />);
    // Après les poules : tableau seulement (la scission est une brique expert)
    fireEvent.click(screen.getByTestId('formula-plus-1'));
    expect(screen.getByTestId('formula-add-tableau-1')).toBeInTheDocument();
    expect(screen.queryByTestId('formula-add-split-1')).toBeNull();
  });

  it('interrupteur : expert allumé propose scission, ex aequo, arrêt du tableau, ordre des matchs', () => {
    render(
      <Harness initial={withPools([{ qualification: { mode: 'fixed_count', count: 16 } }])} />
    );
    fireEvent.click(screen.getByTestId('formula-expert-toggle'));
    expect(screen.getByTestId('formula-expert-toggle')).toBeChecked();
    // Préférence du poste écrite par le contrat
    expect(station.saved).toEqual([true]);
    expect(screen.getByTestId('advancement-ties')).toBeInTheDocument();
    expect(document.getElementById('pool-0-order')).not.toBeNull();
    fireEvent.click(screen.getByTestId('formula-step-tableau'));
    expect(document.getElementById('tableau-stop-at')).not.toBeNull();
  });

  it('ordre des matchs en vagues : proposé en expert, poules de 2 à 10 (docs/adr/0043)', () => {
    render(<Harness initial={withPools([{}])} />);
    // Niveau simple : le sélecteur d'ordre est un réglage avancé
    expect(document.getElementById('pool-0-order')).toBeNull();
    fireEvent.click(screen.getByTestId('formula-expert-toggle'));
    const order = document.getElementById('pool-0-order') as HTMLSelectElement;
    expect([...order.options].map(o => o.value)).toEqual(['fie', 'free', 'waves', 'waves_classic']);
    // Bornes habituelles : 3 à 64
    expect(document.getElementById('pool-0-min')).toHaveAttribute('min', '3');
    expect(document.getElementById('pool-0-max')).toHaveAttribute('max', '64');
    fireEvent.change(order, { target: { value: 'waves' } });
    expect((last!.phases[0] as PoolRoundPhase).boutOrder).toBe('waves');
    // Tour en vagues : 2 à 10, tailles ramenées dans les bornes
    expect(document.getElementById('pool-0-min')).toHaveAttribute('min', '2');
    expect(document.getElementById('pool-0-max')).toHaveAttribute('max', '10');
    fireEvent.change(document.getElementById('pool-0-min')!, { target: { value: '2' } });
    expect((last!.phases[0] as PoolRoundPhase).sizeMin).toBe(2);
    fireEvent.change(document.getElementById('pool-0-max')!, { target: { value: '30' } });
    expect((last!.phases[0] as PoolRoundPhase).sizeMax).toBe(10);
    // Retour à l'ordre FIE : tailles ramenées à 3 au moins, remarque levée
    fireEvent.change(order, { target: { value: 'fie' } });
    expect((last!.phases[0] as PoolRoundPhase).sizeMin).toBe(3);
    expect(screen.queryByTestId('formula-remarks')).toBeNull();
  });

  it('vagues classiques : poules jusqu’à 15 (docs/adr/0043)', () => {
    render(<Harness initial={withPools([{}])} />);
    fireEvent.click(screen.getByTestId('formula-expert-toggle'));
    fireEvent.change(document.getElementById('pool-0-order')!, {
      target: { value: 'waves_classic' },
    });
    expect(document.getElementById('pool-0-max')).toHaveAttribute('max', '15');
    fireEvent.change(document.getElementById('pool-0-max')!, { target: { value: '30' } });
    expect((last!.phases[0] as PoolRoundPhase).sizeMax).toBe(15);
    expect(screen.queryByTestId('formula-remarks')).toBeNull();
  });

  it('formule en vagues : mode expert rallumé pour cette édition', () => {
    render(
      <Harness initial={withPools([{ boutOrder: 'waves_classic', sizeMin: 2, sizeMax: 10 }])} />
    );
    expect(screen.getByTestId('formula-expert-toggle')).toBeChecked();
    expect(screen.getByTestId('formula-expert-toggle')).toBeDisabled();
    expect(document.getElementById('pool-0-order')).toHaveValue('waves_classic');
  });

  it('préférence allumée : expert d’emblée', () => {
    station.expert = true;
    render(<Harness initial={base()} />);
    expect(screen.getByTestId('formula-expert-toggle')).toBeChecked();
    expect(screen.getByTestId('formula-expert-toggle')).not.toBeDisabled();
  });

  it('formule qui contient de l’expert : mode rallumé pour cette édition, préférence intacte', () => {
    const f = withPools([{ boutOrder: 'free' }]);
    render(<Harness initial={f} />);
    const toggle = screen.getByTestId('formula-expert-toggle');
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(station.saved).toEqual([]);
    expect(document.getElementById('pool-0-order')).not.toBeNull();
  });

  it('tableau arrêté déjà dans la formule : expert rallumé, tableau arrêté réglable', () => {
    const f = withPools([{}, {}]);
    const stopped: FormulaV2 = {
      ...f,
      phases: [f.phases[0], { ...(f.phases[2] as TableauPhase), stopAt: 8 }, f.phases[1]],
    };
    render(<Harness initial={stopped} />);
    expect(screen.getByTestId('formula-expert-toggle')).toBeChecked();
    fireEvent.click(screen.getByTestId('formula-step-tableau'));
    expect(document.getElementById('tableau-stop-at')).toHaveValue('8');
    // Brique retirée : l'expert reste allumé pour cette édition (ADR-0041), préférence éteinte
    fireEvent.change(document.getElementById('tableau-stop-at')!, { target: { value: '0' } });
    expect(last?.phases.every(p => !(p.kind === 'tableau' && p.stopAt))).toBe(true);
    expect(screen.getByTestId('formula-expert-toggle')).toBeChecked();
  });
});

describe('Organisation ▸ Formule : Enregistrer grisé tant qu’une remarque bloque', () => {
  const competition = (formula?: FormulaV2): Competition =>
    ({
      id: 'c1',
      title: 'Coupe',
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
      gender: Gender.MALE,
      fencerCount: 0,
      settings: { ...settings(Weapon.EPEE), ...(formula ? { formula } : {}) },
    }) as unknown as Competition;

  it('formule valide : Enregistrer actif', () => {
    render(
      <CompetitionFormulaModal competition={competition()} onApplied={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByTestId('formula-modal-save')).not.toBeDisabled();
  });

  it('remarque bloquante : Enregistrer grisé, remarque sur la phase', () => {
    const f = withPools([{ qualification: { mode: 'fixed_count', count: 3 } }, {}]);
    render(
      <CompetitionFormulaModal competition={competition(f)} onApplied={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByTestId('formula-modal-save')).toBeDisabled();
    expect(screen.getByTestId('formula-remark-pool-0')).toBeInTheDocument();
    // Correction : un tour de moins, l'erreur disparaît, Enregistrer se réactive
    fireEvent.click(screen.getByTestId('formula-remove-pool-1'));
    expect(screen.getByTestId('formula-modal-save')).not.toBeDisabled();
  });

  it('phase commencée : sa suppression grise Enregistrer (S6)', () => {
    const two = withPools([{}, {}]);
    render(
      <CompetitionFormulaModal
        competition={competition(two)}
        progress={['pool', 'pool']}
        onApplied={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('formula-modal-save')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('formula-remove-pool-1'));
    expect(screen.getByTestId('formula-modal-save')).toBeDisabled();
    expect(screen.getByTestId('formula-remarks')).toHaveTextContent('phase déjà commencée');
  });

  it('tableau tiré : changer la qualification du tour grise Enregistrer (S6, ADR-0041)', () => {
    const f = withPools([{ qualification: { mode: 'fixed_count', count: 16 } }]);
    render(
      <CompetitionFormulaModal
        competition={competition(f)}
        progress={['pool', 'tableau']}
        onApplied={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('formula-modal-save')).not.toBeDisabled();
    fireEvent.change(screen.getByTestId('advancement-count'), { target: { value: '8' } });
    expect(screen.getByTestId('formula-modal-save')).toBeDisabled();
    expect(screen.getByTestId('formula-remark-pool-0')).toBeInTheDocument();
    expect(screen.getByTestId('phase-remarks')).toHaveTextContent(
      'elle mène à une phase déjà commencée'
    );
    // Retour à la règle enregistrée : levée
    fireEvent.change(screen.getByTestId('advancement-count'), { target: { value: '16' } });
    expect(screen.getByTestId('formula-modal-save')).not.toBeDisabled();
  });
});

describe('avertissements dans l’aperçu (ADR-0041)', () => {
  it('poules de moins de 4 tireurs, moins de 4 qualifiés, plus de 3 tours', () => {
    const f = withPools(
      [{ sizeMin: 3, sizeMax: 3, qualification: { mode: 'fixed_count', count: 3 } }, {}, {}, {}],
      true
    );
    render(<Harness initial={f} />);
    const preview = screen.getByTestId('formula-simulation');
    expect(preview).toHaveTextContent('min recommandé : 4');
    expect(preview).toHaveTextContent('moins de 4 qualifiés');
    expect(preview).toHaveTextContent('4 tours de poules');
  });
});
