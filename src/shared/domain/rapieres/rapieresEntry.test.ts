/**
 * Tests : pont rapières ↔ entrée en équipes (docs/adr/0043, F4c) : composition écrite sur le
 * tireur, lue de préférence sur lui, sinon dans l'ancienne clé `rapieres.teams` (compatibilité, F4e)
 */
import { describe, it, expect } from 'vitest';
import { Category, Gender, FencerStatus, type Fencer } from '../../types';
import {
  rapieresLevelNumber,
  rapieresLevelOfNumber,
  rapieresTeamEntry,
  withLegacyTeams,
} from './rapieresEntry';
import type { RapieresTeamInfo } from './rapieres.types';

const REF = new Date(2026, 10, 5);

const info = (over: Partial<RapieresTeamInfo> = {}): RapieresTeamInfo => ({
  level: 'intermediate',
  fencers: [
    {
      firstName: 'Ann',
      lastName: 'DUPONT',
      category: 'SENIOR',
      gender: 'F',
      birthDate: '1989-6-1',
    },
    { firstName: 'Bob', lastName: 'MARTIN', category: 'V2', gender: 'M', birthDate: '1961-08-27' },
  ],
  club: 'Paris',
  ...over,
});

const fencer = (over: Partial<Fencer> = {}): Fencer => ({
  id: 'f1',
  ref: 1,
  lastName: 'Les Lames',
  firstName: '',
  gender: Gender.MIXED,
  nationality: 'FRA',
  status: FencerStatus.CHECKED_IN,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

describe('niveaux des rapières comme niveaux de la formule', () => {
  it('1 = débutant, 2 = intermédiaire, 3 = expert (le plus grand est le plus fort), et retour', () => {
    expect(
      ['beginner', 'intermediate', 'expert'].map(l => rapieresLevelNumber(l as never))
    ).toEqual([1, 2, 3]);
    expect([1, 2, 3, 4].map(rapieresLevelOfNumber)).toEqual([
      'beginner',
      'intermediate',
      'expert',
      'expert',
    ]);
  });
});

describe('rapieresTeamEntry : composition → champs du tireur', () => {
  it('membres, niveau, catégorie (moyenne des naissances) et sexe mixte', () => {
    const e = rapieresTeamEntry(info(), REF);
    expect(e.level).toBe(2);
    expect(e.handicap).toBe(false);
    // (1989 + 1961) / 2 = 1975 → 51 ans → V2 ; date « 1989-6-1 » normalisée
    expect(e.category).toBe(Category.V2);
    expect(e.gender).toBe(Gender.MIXED);
    expect(e.members[0]).toEqual({
      lastName: 'DUPONT',
      firstName: 'Ann',
      gender: 'F',
      birthDate: '1989-06-01',
    });
  });

  it('HANDI devient le marqueur handicap, plus une catégorie', () => {
    const e = rapieresTeamEntry(
      info({
        fencers: [
          { firstName: 'A', lastName: 'a', category: 'HANDI' },
          { firstName: 'B', lastName: 'b', category: 'V1' },
        ],
      }),
      REF
    );
    expect(e.handicap).toBe(true);
    expect(e.category).toBe(Category.V1);
  });

  it('sans date de naissance : catégorie saisie des membres', () => {
    const e = rapieresTeamEntry(
      info({
        fencers: [
          { firstName: 'A', lastName: 'a', category: 'V3' },
          { firstName: 'B', lastName: 'b', category: 'M20' },
        ],
      }),
      REF
    );
    expect(e.category).toBe(Category.V3);
    expect(e.gender).toBeUndefined();
  });

  it('membre sans nom : non écrit', () => {
    const e = rapieresTeamEntry(
      info({
        fencers: [
          { firstName: 'A', lastName: 'a', category: 'SENIOR' },
          { firstName: '', lastName: '', category: 'SENIOR' },
        ],
      }),
      REF
    );
    expect(e.members).toHaveLength(1);
  });
});

describe('withLegacyTeams : champs du tireur de préférence, sinon l’ancienne clé de session', () => {
  it('le tireur porte la composition : elle prime sur la session', () => {
    const session = info({ level: 'beginner', club: 'Lyon' });
    const f = fencer({
      id: 'a',
      level: 3,
      members: [{ lastName: 'X', firstName: 'x' }],
      club: 'Nantes',
      handicap: true,
    });
    expect(withLegacyTeams([f], { a: session }, REF)[0]).toBe(f);
  });

  it('tireur sans composition : la session (alias de compatibilité) ; sans rien : inchangé', () => {
    const session = info();
    const [read] = withLegacyTeams([fencer({ id: 'a', club: '' })], { a: session }, REF);
    expect(read.level).toBe(2);
    expect(read.members?.map(m => m.lastName)).toEqual(['DUPONT', 'MARTIN']);
    expect(read.category).toBe(Category.V2);
    expect(read.gender).toBe(Gender.MIXED);
    expect(read.club).toBe('Paris');
    const alone = fencer({ id: 'b' });
    expect(withLegacyTeams([alone], { a: session }, REF)[0]).toBe(alone);
    expect(withLegacyTeams([alone], undefined, REF)[0]).toBe(alone);
  });

  it('la catégorie et le club du tireur priment ; aucune écriture (copie)', () => {
    const f = fencer({ id: 'a', category: Category.U20, club: 'Nantes' });
    const [read] = withLegacyTeams([f], { a: info() }, REF);
    expect(read.category).toBe(Category.U20);
    expect(read.club).toBe('Nantes');
    expect(read).not.toBe(f);
    expect(f.level).toBeUndefined();
  });
});
