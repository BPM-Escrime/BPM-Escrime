/**
 * Tests : entrée en équipes (binômes) : catégorie, sexe, niveau (docs/adr/0043, F4c)
 */
import { describe, it, expect } from 'vitest';
import { Category, Gender } from '../../types';
import {
  DEFAULT_TEAM_LEVELS,
  levelLabel,
  levelRankOf,
  memberBirthYear,
  teamCategory,
  teamGender,
  teamMembersLabel,
} from './teamEntry';

// Saison 2026-2027 (refDate après le 1er septembre 2026)
const REF = new Date(2026, 10, 5);
const born = (...dates: Array<string | undefined>) => dates.map(birthDate => ({ birthDate }));

describe('catégorie d’équipe', () => {
  it('lit l’année de naissance depuis AAAA-MM-JJ', () => {
    expect(memberBirthYear({ birthDate: '1989-01-06' })).toBe(1989);
    expect(memberBirthYear({})).toBeUndefined();
  });

  it('moyenne des années de naissance, saison au 1er septembre', () => {
    // (1989 + 1961) / 2 = 1975 → 51 ans → V2
    expect(teamCategory(born('1989-06-01', '1961-08-27'), REF)).toBe(Category.V2);
    // (2008 + 1980) / 2 = 1994 → 32 ans → SEN
    expect(teamCategory(born('2008-06-14', '1980-03-01'), REF)).toBe(Category.SENIOR);
    // Né en 1976 : 49 ans avant le 1er septembre 2026 (V1), 50 ans après (V2)
    expect(teamCategory(born('1976-01-01', '1976-01-01'), new Date(2026, 7, 31))).toBe(Category.V1);
    expect(teamCategory(born('1976-01-01', '1976-01-01'), new Date(2026, 8, 1))).toBe(Category.V2);
  });

  it('âge moyen décimal arrondi au-dessus (39,5 ans → 40 → V1)', () => {
    // 1977 (49 ans) + 1996 (30 ans) → 39,5 ans → 40 → V1
    expect(teamCategory(born('1977-12-31', '1996-01-01'), REF)).toBe(Category.V1);
    // 1987,5 → 38,5 → 39 → SEN
    expect(teamCategory(born('1987-01-01', '1988-01-01'), REF)).toBe(Category.SENIOR);
  });

  it('catégories jeunes d’après l’âge de fin de saison', () => {
    expect(teamCategory(born('2016-01-01', '2016-06-01'), REF)).toBe(Category.U11);
    expect(teamCategory(born('2008-01-01', '2008-06-01'), REF)).toBe(Category.U20);
  });

  it('une seule date connue : elle sert ; aucune : undefined (catégorie saisie)', () => {
    expect(teamCategory(born('1980-03-01', undefined), REF)).toBe(Category.V1);
    expect(teamCategory(born(undefined, undefined), REF)).toBeUndefined();
    expect(teamCategory([], REF)).toBeUndefined();
  });

  it('la date de saison est injectée (pas d’horloge)', () => {
    const team = born('1977-06-01', '1977-06-01');
    expect(teamCategory(team, new Date(2026, 10, 5))).toBe(Category.V1); // 49 ans
    expect(teamCategory(team, new Date(2027, 10, 5))).toBe(Category.V2); // 50 ans
  });
});

describe('sexe d’équipe', () => {
  it('commun : celui des membres ; différent : mixte', () => {
    expect(teamGender([{ gender: 'M' }, { gender: 'M' }])).toBe(Gender.MALE);
    expect(teamGender([{ gender: 'F' }, { gender: 'F' }])).toBe(Gender.FEMALE);
    expect(teamGender([{ gender: 'F' }, { gender: 'M' }])).toBe(Gender.MIXED);
  });

  it('indéterminé (undefined) si un sexe manque', () => {
    expect(teamGender([{ gender: 'F' }, {}])).toBeUndefined();
    expect(teamGender([])).toBeUndefined();
  });
});

describe('niveau et libellés', () => {
  it('libellés par défaut du plus fort au plus faible, niveau 1 = le plus fort', () => {
    expect(DEFAULT_TEAM_LEVELS).toEqual(['Expert', 'Intermédiaire', 'Débutant']);
    expect(levelLabel(1, DEFAULT_TEAM_LEVELS)).toBe('Expert');
    expect(levelLabel(3, DEFAULT_TEAM_LEVELS)).toBe('Débutant');
    expect(levelLabel(4, DEFAULT_TEAM_LEVELS)).toBe('');
    expect(levelLabel(undefined, DEFAULT_TEAM_LEVELS)).toBe('');
  });

  it('rang de regroupement : du plus faible au plus fort, sans niveau en dernier', () => {
    const ranks = [{ level: 1 }, { level: 3 }, {}, { level: 2 }].map(levelRankOf);
    const order = [...ranks.keys()].sort((a, b) => ranks[a] - ranks[b]);
    expect(order).toEqual([1, 3, 0, 2]);
  });

  it('noms des membres en majuscules, séparés par « / »', () => {
    expect(teamMembersLabel([{ lastName: 'Dupont' }, { lastName: ' martin ' }])).toBe(
      'DUPONT / MARTIN'
    );
    expect(teamMembersLabel([{ lastName: 'Dupont' }, { lastName: '' }])).toBe('DUPONT');
  });
});
