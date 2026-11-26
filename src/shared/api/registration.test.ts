import { describe, expect, it } from 'vitest';
import { Category } from '../types';
import { detailsInput, registerInput } from './registration';

describe('tireur saisi ou importé → commandes d’inscription : catégorie (docs/adr/0039)', () => {
  it('catégorie reconnue transmise, vide ou inconnue effacée', () => {
    expect(detailsInput({ category: Category.V1 })).toEqual({ category: 'V1' });
    expect(detailsInput({ category: undefined })).toEqual({ category: null });
    expect(detailsInput({ club: 'X' })).toEqual({ club: 'X' });
  });

  it('inscription : catégorie importée gardée', () => {
    expect(registerInput({ lastName: 'A', firstName: 'B', category: Category.U17 })).toMatchObject({
      category: 'U17',
    });
  });
});
