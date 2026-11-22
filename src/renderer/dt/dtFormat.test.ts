/**
 * Mise en forme de la vue DT (#1981 lot 3) : langue du navigateur, noms, feuille de poule, tours.
 */
import { describe, it, expect } from 'vitest';
import type { Pool } from '../../shared/types';
import type { TableauMatch } from '../../shared/domain/tableau/tableauTypes';
import { browserLanguage, fencerName, poolCell, tableauRounds } from './dtFormat';

const f = (id: string, lastName = id) => ({ id, lastName, firstName: 'Léa' }) as never;
const score = (value: number, isVictory: boolean, extra = {}) => ({
  value,
  isVictory,
  isAbstention: false,
  isExclusion: false,
  isForfait: false,
  ...extra,
});

describe('dtFormat', () => {
  it('browserLanguage : première langue prise en charge, zh → zh-HK, sinon fr', () => {
    expect(browserLanguage(['de-CH', 'fr'])).toBe('de');
    expect(browserLanguage(['zh-TW'])).toBe('zh-HK');
    expect(browserLanguage(['ja', 'nl'])).toBe('fr');
    expect(browserLanguage(undefined)).toBe('fr');
  });

  it('fencerName : NOM Prénom, tiret sans tireur', () => {
    expect(fencerName({ lastName: 'Dupont', firstName: 'Léa' })).toBe('DUPONT Léa');
    expect(fencerName(null)).toBe('—');
  });

  it('poolCell : score de la ligne contre la colonne, V au maximum, statuts', () => {
    const pool = {
      matches: [
        {
          fencerA: f('a'),
          fencerB: f('b'),
          scoreA: score(5, true),
          scoreB: score(2, false),
          maxScore: 5,
        },
        {
          fencerA: f('c'),
          fencerB: f('a'),
          scoreA: score(4, true),
          scoreB: score(3, false),
          maxScore: 5,
        },
        {
          fencerA: f('b'),
          fencerB: f('c'),
          scoreA: score(0, false, { isAbstention: true }),
          scoreB: null,
          maxScore: 5,
        },
      ],
    } as unknown as Pool;
    expect(poolCell(pool, 'a', 'b')).toBe('V');
    expect(poolCell(pool, 'b', 'a')).toBe('2');
    expect(poolCell(pool, 'c', 'a')).toBe('V4');
    expect(poolCell(pool, 'b', 'c')).toBe('A');
    expect(poolCell(pool, 'c', 'b')).toBe('');
    expect(poolCell(pool, 'a', 'a')).toBe('');
  });

  it('tableauRounds : du plus grand tour à la finale, exempts retirés, ordre des positions', () => {
    const m = (round: number, position: number, isBye = false) =>
      ({ id: `${round}-${position}`, round, position, isBye }) as TableauMatch;
    const rounds = tableauRounds([m(2, 1), m(8, 2), m(8, 1), m(8, 3, true), m(4, 1)]);
    expect(rounds.map(r => r.size)).toEqual([8, 4, 2]);
    expect(rounds[0].matches.map(x => x.position)).toEqual([1, 2]);
  });
});
