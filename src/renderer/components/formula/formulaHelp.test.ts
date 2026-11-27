/**
 * Aide intégrée de l'éditeur de formule (#2013 F5) : une ancre du guide par type de brique, et
 * chaque ancre existe dans l'article du wiki (7 langues) et dans les traductions de l'interface.
 */
import { describe, it, expect } from 'vitest';
import { Category, Weapon } from '../../../shared/types';
import type { FriezePhase } from '../../../shared/domain/formula/formulaFrieze';
import {
  formulaOf,
  type FormulaV2,
  type PoolRoundPhase,
} from '../../../shared/domain/formula/formulaV2';
import { rapieresFormula } from '../../../shared/domain/formula/rapieresFormula';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import type { CompetitionSettings } from '../../../shared/types';
import { ARTICLES, VALID_LANGS } from '../wiki/wikiData';
import fr from '../../locales/fr.json';
import {
  FORMULA_HELP_ARTICLE,
  FORMULA_HELP_TOPICS,
  helpTopicKey,
  helpTopicOfPhase,
} from './formulaHelp';

const standard = (): FormulaV2 =>
  formulaOf({
    weapon: Weapon.EPEE,
    category: Category.SENIOR,
    settings: buildDefaultCompetitionSettings({
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
    }) as CompetitionSettings,
  });

const pool0: FriezePhase = { kind: 'pool', round: 0, key: 'pool-0' };
const tableau: FriezePhase = { kind: 'tableau', key: 'tableau' };

describe('helpTopicOfPhase : ancre par type de brique', () => {
  it('tour de poules → pools, tableau → tableau', () => {
    const f = standard();
    expect(helpTopicOfPhase(pool0, f)).toBe('pools');
    expect(helpTopicOfPhase(tableau, f)).toBe('tableau');
  });

  it('Tour Quest → quest, scission → split', () => {
    const f = standard();
    expect(helpTopicOfPhase({ kind: 'quest', key: 'quest' }, f)).toBe('quest');
    expect(helpTopicOfPhase({ kind: 'split', key: 'split' }, f)).toBe('split');
  });

  it('tableau arrêté à N → stopped-tableau', () => {
    const f = standard();
    const stopped: FormulaV2 = {
      ...f,
      phases: f.phases.map(p => (p.kind === 'tableau' ? { ...p, stopAt: 8 } : p)),
    };
    expect(helpTopicOfPhase(tableau, stopped)).toBe('stopped-tableau');
  });

  it('tour en vagues → waves (le tour voisin reste pools)', () => {
    const f = rapieresFormula();
    expect(helpTopicOfPhase(pool0, f)).toBe('waves');
    const two: FormulaV2 = {
      ...f,
      phases: [
        f.phases[0],
        { ...(f.phases[0] as PoolRoundPhase), id: 'p2', boutOrder: 'fie' },
        f.phases[1],
      ],
    };
    expect(helpTopicOfPhase({ kind: 'pool', round: 1, key: 'pool-1' }, two)).toBe('pools');
  });
});

describe('sujets du guide', () => {
  const article = ARTICLES.find(a => a.id === FORMULA_HELP_ARTICLE);

  it("l'article du wiki existe", () => {
    expect(article).toBeDefined();
  });

  it.each(VALID_LANGS)('chaque ancre est un titre h2 de l’article en %s', lang => {
    const anchors = (article?.content[lang] ?? []).filter(s => s.type === 'h2').map(s => s.anchor);
    expect(anchors).toEqual([...FORMULA_HELP_TOPICS]);
  });

  it('chaque sujet a son libellé traduit', () => {
    const help = (fr as unknown as { formulaHelp: Record<string, string> }).formulaHelp;
    for (const topic of FORMULA_HELP_TOPICS) {
      expect(help[helpTopicKey(topic).replace('formulaHelp.', '')], topic).toBeTruthy();
    }
  });
});
