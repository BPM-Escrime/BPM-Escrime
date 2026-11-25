/**
 * BPM - Escrime - Modèles fournis par l'application (docs/adr/0033), lecture seule
 * Source « bpm » : les réglages par défaut de l'application, sans prétention réglementaire
 * (les modèles FFE / FIE versionnés par saison viendront avec #1948, lot 5).
 * - standard : réglages de la fenêtre « Nouvelle compétition » pour l'arme, la catégorie et
 *   le type d'épreuve (buildDefaultCompetitionSettings) : aucun changement de comportement ;
 * - two_rounds : 2 tours de poules (tous qualifiés) puis le tableau ;
 * - pools_only : poules seules, classement aux poules ;
 * - other : formule par défaut de l'arme « Autre » ;
 * - rapieres : Tournoi des rapières (#2013 D8, temps 1), arme « Autre » et mode spécial.
 * Licensed under GPL-3.0
 */

import { Category, CompetitionSettings, Weapon } from '../../../types';
import { buildDefaultCompetitionSettings } from '../../../utils/defaultCompetitionSettings';
import { createDefaultCustomFormula } from '../../../utils/tournamentTemplates';
import { draftFromSettings } from '../formulaDraft';
import { normalizeCustomFormula } from '../formulaFrieze';
import type { FormulaTemplate } from '../formulaTemplate';

const WEAPON_NAMES: Record<string, string> = {
  [Weapon.EPEE]: 'Épée',
  [Weapon.FOIL]: 'Fleuret',
  [Weapon.SABRE]: 'Sabre',
  [Weapon.LASER]: 'Sabre Laser',
};

const CATEGORY_NAMES: Record<Category, string> = {
  [Category.U9]: 'M9',
  [Category.U11]: 'M11',
  [Category.U13]: 'M13',
  [Category.U15]: 'M15',
  [Category.U17]: 'M17',
  [Category.U20]: 'M20',
  [Category.SENIOR]: 'Seniors',
  [Category.V1]: 'V1',
  [Category.V2]: 'V2',
  [Category.V3]: 'V3',
  [Category.V4]: 'V4',
};

const CODE_NAMES: Record<string, string> = {
  standard: 'Standard',
  two_rounds: '2 tours de poules + tableau',
  pools_only: 'Poules seules',
};

function draftTemplates(): FormulaTemplate[] {
  const out: FormulaTemplate[] = [];
  for (const weapon of [Weapon.EPEE, Weapon.FOIL, Weapon.SABRE, Weapon.LASER]) {
    for (const team of [false, true]) {
      for (const category of Object.values(Category)) {
        const settings = buildDefaultCompetitionSettings({
          weapon,
          category,
          isTeamEvent: team,
        }) as CompetitionSettings;
        const standard = draftFromSettings(weapon, category, settings);
        const variants = {
          standard,
          two_rounds: { ...standard, poolRounds: 2, poolRoundQualifiers: [0] },
          pools_only: { ...standard, hasDirectElimination: false },
        };
        for (const [code, draft] of Object.entries(variants)) {
          out.push({
            id: `bpm/${weapon}/${category}/${team ? 'team' : 'ind'}/${code}`,
            source: 'provided',
            code,
            name: `${CODE_NAMES[code]} · ${WEAPON_NAMES[weapon]} · ${CATEGORY_NAMES[category]}${
              team ? ' · équipes' : ''
            }`,
            applies: { weapons: [weapon], categories: [category], team },
            body: { kind: 'draft', draft },
          });
        }
      }
    }
  }
  return out;
}

function otherTemplates(): FormulaTemplate[] {
  const formula = normalizeCustomFormula(createDefaultCustomFormula());
  // Identifiants de phase stables : le catalogue est identique d'un chargement à l'autre
  const stable = {
    ...formula,
    phases: formula.phases.map((p, i) => ({ ...p, id: `bpm-phase-${i + 1}` })),
  };
  return [
    {
      id: 'bpm/C/standard',
      source: 'provided',
      code: 'standard',
      name: 'Standard · Autre',
      applies: { weapons: [Weapon.CUSTOM] },
      body: { kind: 'custom', formula: stable },
    },
    {
      id: 'bpm/C/rapieres',
      source: 'provided',
      code: 'rapieres',
      name: 'Tournoi des rapières',
      applies: { weapons: [Weapon.CUSTOM] },
      body: {
        kind: 'custom',
        // Même formule que la création actuelle en mode spécial (règles modernes par défaut)
        formula: stable,
        specialMode: 'rapieres',
      },
    },
  ];
}

let catalogue: FormulaTemplate[] | null = null;

/** Modèles fournis, calculés une fois (lecture seule) */
export function providedTemplates(): FormulaTemplate[] {
  catalogue ??= Object.freeze([...draftTemplates(), ...otherTemplates()]) as FormulaTemplate[];
  return catalogue;
}
