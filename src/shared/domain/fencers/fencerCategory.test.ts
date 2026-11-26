import { describe, expect, it } from 'vitest';
import { Category } from '../../types';
import {
  categoryFromBirthDate,
  categoryShortLabel,
  computeMissingCategories,
  splitDaughterCategory,
  normalizeFencerCategory,
} from './fencerCategory';

describe('catégorie du tireur (docs/adr/0039)', () => {
  it('codes reconnus : U17, M17, Senior, V3 ; inconnus rejetés', () => {
    expect(normalizeFencerCategory('M17')).toBe(Category.U17);
    expect(normalizeFencerCategory('u17')).toBe(Category.U17);
    expect(normalizeFencerCategory('Senior')).toBe(Category.SENIOR);
    expect(normalizeFencerCategory('V3')).toBe(Category.V3);
    expect(normalizeFencerCategory('M23')).toBeUndefined();
    expect(normalizeFencerCategory(undefined)).toBeUndefined();
  });

  it('date de naissance et saison de l’épreuve (1er septembre → 31 août)', () => {
    // Saison 2026-2027 : M17 = nés en 2010 ou 2011 ; vétéran 2 = 50 ans au 1er janvier 2026
    const dec2026 = new Date('2026-12-06');
    expect(categoryFromBirthDate(new Date('2010-05-02'), dec2026)).toBe(Category.U17);
    expect(categoryFromBirthDate(new Date('1975-03-01'), dec2026)).toBe(Category.V2);
    expect(categoryFromBirthDate(new Date('1995-03-01'), dec2026)).toBe(Category.SENIOR);
    // Saison 2025-2026 (août 2026) : M17 = nés en 2009 ou 2010
    expect(categoryFromBirthDate(new Date('2010-05-02'), new Date('2026-08-15'))).toBe(
      Category.U17
    );
    expect(categoryFromBirthDate(new Date('2009-05-02'), new Date('2026-08-15'))).toBe(
      Category.U17
    );
    expect(categoryFromBirthDate(undefined, dec2026)).toBeUndefined();
  });

  it('« Calculer les catégories » : seulement les tireurs sans catégorie', () => {
    const r = computeMissingCategories(
      [
        { id: 'a', birthDate: new Date('1975-03-01') },
        { id: 'b', birthDate: new Date('1975-03-01'), category: Category.V1 },
        { id: 'c' },
      ],
      new Date('2026-12-06')
    );
    expect(r.updates).toEqual([{ fencerId: 'a', category: Category.V2 }]);
    expect(r.withoutBirthDate).toEqual(['c']);
  });

  it('libellé court comme les feuilles FFE', () => {
    expect(categoryShortLabel(Category.U17)).toBe('M17');
    expect(categoryShortLabel(Category.SENIOR)).toBe('Sen');
    expect(categoryShortLabel(Category.V2)).toBe('V2');
    expect(categoryShortLabel(undefined)).toBe('');
  });

  it('catégorie de la fille de scission : la plus jeune de la branche, sinon l’origine', () => {
    expect(splitDaughterCategory([Category.V4, Category.V3], Category.SENIOR)).toBe(Category.V3);
    expect(splitDaughterCategory([Category.V1, Category.SENIOR], Category.V2)).toBe(
      Category.SENIOR
    );
    expect(splitDaughterCategory([Category.U17], Category.U20)).toBe(Category.U17);
    expect(splitDaughterCategory(undefined, Category.V2)).toBe(Category.V2);
    expect(splitDaughterCategory([], Category.V2)).toBe(Category.V2);
  });
});
