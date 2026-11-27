// @vitest-environment jsdom
/**
 * Éditeur de formule d'une épreuve par équipes (docs/adr/0044, Conséquences « éditeur : règle de
 * rencontre, briques admises ») : règle générale et surcharge par phase, briques non admises
 * masquées (relais FIE), effectif d'équipes jugé (S3), arène Sabre Laser en consultation seule.
 */

import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../hooks/useFormulaPreview', () => ({ useFormulaPreview: () => true }));
vi.mock('../../hooks/useFormulaExpert', async () => {
  const { useState } = await import('react');
  return { useFormulaExpert: () => ({ expert: useState(true)[0], setExpert: vi.fn() }) };
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
const client = vi.hoisted(() => ({
  call: vi.fn(),
  query: vi.fn(async () => ({ state: { teams: { teams: [{ id: 'a' }, { id: 'b' }] } } })),
}));
vi.mock('../../api/BpmClientContext', () => ({ useBpmClient: () => client }));
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
import type { TeamFormat } from '../../../shared/domain/teams/relay';

const RULE = { starters: 3, reserves: 1, relayStep: 5, relayOrder: 'fie' as const };
const settings = buildDefaultCompetitionSettings({
  weapon: Weapon.EPEE,
  category: Category.SENIOR,
}) as CompetitionSettings;
const teamFormula = (): FormulaV2 => {
  const f = formulaOf({ weapon: Weapon.EPEE, category: Category.SENIOR, settings });
  return { ...f, general: { ...f.general, teamMatch: RULE } };
};

let last: FormulaV2 | null = null;
const Harness: React.FC<{
  isTeamEvent?: boolean;
  teamFormat?: TeamFormat;
  teamCount?: number;
  readOnly?: boolean;
  initial?: FormulaV2;
}> = ({ isTeamEvent = true, teamFormat = 'fie-relay', teamCount, readOnly, initial }) => {
  const [formula, setFormula] = useState<FormulaV2>(() => initial ?? teamFormula());
  last = formula;
  return (
    <FormulaEditor
      weapon={Weapon.EPEE}
      category={Category.SENIOR}
      formula={formula}
      onChange={setFormula}
      isTeamEvent={isTeamEvent}
      teamFormat={isTeamEvent ? teamFormat : undefined}
      teamCount={teamCount}
      readOnly={readOnly}
    />
  );
};

const pool = () => last!.phases.find((p): p is PoolRoundPhase => p.kind === 'pool')!;
const tableau = () => last!.phases.find((p): p is TableauPhase => p.kind === 'tableau')!;

describe('Éditeur de formule, épreuve par équipes en relais FIE (docs/adr/0044)', () => {
  it('règle générale : titulaires, remplaçants, palier, ordre ; ordre FIE à 3 titulaires seulement', () => {
    render(<Harness />);
    expect(screen.getByTestId('formula-team-match-relayOrder')).toHaveValue('fie');
    fireEvent.change(screen.getByTestId('formula-team-match-starters'), {
      target: { value: '4' },
    });
    expect(last!.general.teamMatch).toEqual({ ...RULE, starters: 4, relayOrder: 'rotation' });
    // Option FIE grisée hors 3 titulaires
    expect(
      screen.getByTestId('formula-team-match-relayOrder').querySelector('option[value="fie"]')
    ).toBeDisabled();
    fireEvent.change(screen.getByTestId('formula-team-match-reserves'), { target: { value: '9' } });
    fireEvent.change(screen.getByTestId('formula-team-match-relayStep'), {
      target: { value: '4' },
    });
    // Bornes : remplaçants 0 à 2
    expect(last!.general.teamMatch).toMatchObject({ reserves: 2, relayStep: 4 });
  });

  it('surcharge par phase, champ par champ ; champ vidé : règle générale', () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId('pool-0-team-match-relayStep'), {
      target: { value: '3' },
    });
    expect(pool().teamMatch).toEqual({ relayStep: 3 });
    fireEvent.change(screen.getByTestId('pool-0-team-match-relayOrder'), {
      target: { value: 'rotation' },
    });
    expect(pool().teamMatch).toEqual({ relayStep: 3, relayOrder: 'rotation' });
    fireEvent.change(screen.getByTestId('pool-0-team-match-relayStep'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('pool-0-team-match-relayOrder'), { target: { value: '' } });
    expect(pool().teamMatch).toBeUndefined();
    // Tableau
    fireEvent.click(screen.getByTestId('formula-step-tableau'));
    fireEvent.change(screen.getByTestId('tableau-team-match-reserves'), {
      target: { value: '0' },
    });
    expect(tableau().teamMatch).toEqual({ reserves: 0 });
    expect(last!.general.teamMatch).toEqual(RULE);
  });

  it('briques non admises masquées : pas de 2e tour, de Tour Quest, de scission, de vagues ni de binômes', () => {
    render(<Harness />);
    // Un tour de poules déjà là, tableau en fin : aucun « ＋ »
    expect(screen.queryByTestId('formula-plus-0')).toBeNull();
    expect(screen.queryByTestId('formula-plus-1')).toBeNull();
    expect(screen.queryByTestId('formula-plus-2')).toBeNull();
    // Tour de poules : ni vagues, ni répartition par niveau, ni têtes de poule
    expect(screen.queryByRole('option', { name: 'properties.bout_order_waves' })).toBeNull();
    expect(screen.queryByLabelText('formulaEditor.distribution')).toBeNull();
    expect(screen.queryByRole('option', { name: 'advancement.mode_pool_heads' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'advancement.mode_pool_winner' })).toBeNull();
    // Formule : ni entrée en binômes, ni compétition couplée
    expect(screen.queryByLabelText('formulaEditor.entry')).toBeNull();
    expect(screen.queryByLabelText('properties.coupled')).toBeNull();
    // Tableau : ni toutes les places, ni tableau arrêté
    fireEvent.click(screen.getByTestId('formula-step-tableau'));
    expect(screen.queryByText('properties.all_places')).toBeNull();
    expect(screen.queryByLabelText('formulaEditor.stop_at')).toBeNull();
  });

  it('tableau seul : le « ＋ » propose le tour de poules, rien d’autre', () => {
    const f = teamFormula();
    render(<Harness initial={{ ...f, phases: f.phases.filter(p => p.kind === 'tableau') }} />);
    fireEvent.click(screen.getByTestId('formula-plus-0'));
    expect(screen.getAllByRole('menuitem').map(b => b.getAttribute('data-testid'))).toEqual([
      'formula-add-pool-0',
    ]);
  });

  it('effectif d’équipes (S3) : remarque bloquante sur le tour de poules', () => {
    render(<Harness teamCount={2} />);
    expect(screen.getByTestId('formula-remark-pool-0')).toBeInTheDocument();
    expect(screen.getByTestId('phase-remarks')).toHaveTextContent('2 équipe(s)');
  });

  it('épreuve individuelle : ni règle de rencontre ni filtre des briques', () => {
    render(<Harness isTeamEvent={false} initial={teamFormula()} />);
    expect(screen.queryByTestId('formula-team-match')).toBeNull();
    expect(screen.queryByTestId('pool-0-team-match')).toBeNull();
    expect(screen.getByTestId('formula-plus-0')).toBeInTheDocument();
  });

  it('arène Sabre Laser : éditeur en consultation seule', () => {
    render(<Harness teamFormat="laser-arena" readOnly />);
    expect(screen.getByTestId('formula-read-only')).toHaveTextContent(
      'formulaEditor.arena_read_only'
    );
    expect(screen.queryByTestId('formula-team-match')).toBeNull();
    expect(screen.queryByTestId('formula-remove-tableau')).toBeNull();
    expect(screen.getByLabelText('properties.pool_size_min')).toBeDisabled();
  });
});

describe('Organisation ▸ Formule d’une épreuve par équipes (docs/adr/0044)', () => {
  const competition = (teamFormat?: TeamFormat): Competition =>
    ({
      id: 'c1',
      title: 'Coupe par équipes',
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
      gender: Gender.MALE,
      fencerCount: 0,
      isTeamEvent: true,
      settings: { ...settings, minTeamSize: 3, ...(teamFormat ? { teamFormat } : {}) },
    }) as unknown as Competition;

  it('relais FIE : règle de rencontre posée depuis les réglages, effectif d’équipes lu dans l’état', async () => {
    render(
      <CompetitionFormulaModal competition={competition()} onApplied={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByTestId('formula-team-match-starters')).toHaveValue(3);
    expect(client.query).toHaveBeenCalledWith('getCompetitionState', { competitionId: 'c1' });
    // 2 équipes pour des poules de 5 au moins (S3) : Enregistrer grisé
    await waitFor(() => expect(screen.getByTestId('formula-modal-save')).toBeDisabled());
  });

  it('arène Sabre Laser : consultation, Enregistrer grisé, aucun modèle proposé', () => {
    render(
      <CompetitionFormulaModal
        competition={competition('laser-arena')}
        onApplied={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('formula-read-only')).toBeInTheDocument();
    expect(screen.getByTestId('formula-modal-save')).toBeDisabled();
  });
});

describe('Organisation ▸ Formule d’une épreuve par équipes commencée (S6, ADR-0041, ADR-0044)', () => {
  const competition = (): Competition =>
    ({
      id: 'c1',
      title: 'Coupe par équipes',
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
      gender: Gender.MALE,
      fencerCount: 0,
      isTeamEvent: true,
      settings: { ...settings, minTeamSize: 3, formula: teamFormula() },
    }) as unknown as Competition;
  const teams = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}` }));
  const state = (poolMatches: unknown[], tableauMatches: unknown[]) => ({
    state: { teams: { teams, poolMatches, tableauMatches } },
  });
  const open = async (poolMatches: unknown[], tableauMatches: unknown[]) => {
    client.query.mockResolvedValueOnce(state(poolMatches, tableauMatches) as never);
    render(
      <CompetitionFormulaModal competition={competition()} onApplied={vi.fn()} onClose={vi.fn()} />
    );
    await waitFor(() => expect(client.query).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('formula-modal-save')).not.toBeDisabled());
  };

  it('tableau d’équipes tiré : la petite finale ne change plus, remarque sur la carte du tableau', async () => {
    await open([{ status: 'finished' }], [{ id: 'm' }]);
    fireEvent.click(screen.getByTestId('formula-step-tableau'));
    fireEvent.click(screen.getByLabelText('competition.third_place_match_label'));
    expect(screen.getByTestId('formula-modal-save')).toBeDisabled();
    expect(screen.getByTestId('formula-remark-tableau')).toBeInTheDocument();
    expect(screen.getByTestId('phase-remarks')).toHaveTextContent('tableau déjà tiré');
  });

  it('poules d’équipes tirées : le tour ne se retire plus', async () => {
    await open([{ status: 'not_started' }], []);
    fireEvent.click(screen.getByTestId('formula-remove-pool-0'));
    expect(screen.getByTestId('formula-modal-save')).toBeDisabled();
    expect(screen.getByTestId('formula-remarks')).toHaveTextContent('phase déjà commencée');
  });

  it('rien de tiré : la petite finale reste modifiable', async () => {
    await open([], []);
    fireEvent.click(screen.getByTestId('formula-step-tableau'));
    fireEvent.click(screen.getByLabelText('competition.third_place_match_label'));
    expect(screen.getByTestId('formula-modal-save')).not.toBeDisabled();
  });
});
