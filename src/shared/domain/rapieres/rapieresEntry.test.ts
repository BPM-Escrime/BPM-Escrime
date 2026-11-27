/**
 * Tests : pont rapières ↔ entrée en équipes (docs/adr/0043, F4c) : composition écrite sur le
 * tireur, lue de préférence sur lui, sinon dans `rapieres.teams` (compatibilité)
 */
import { describe, it, expect } from 'vitest';
import { Category, Gender, FencerStatus, type Fencer } from '../../types';
import {
  rapieresInfoOf,
  rapieresLevelNumber,
  rapieresLevelOfNumber,
  rapieresTeamEntry,
  rapieresTeamsOf,
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

describe('rapieresInfoOf : champs du tireur de préférence, sinon la session', () => {
  it('le tireur porte la composition : elle prime sur la session', () => {
    const session = info({ level: 'beginner', club: 'Lyon' });
    const f = fencer({
      level: 3,
      members: [{ lastName: 'X', firstName: 'x' }],
      club: 'Nantes',
      handicap: true,
    });
    const r = rapieresInfoOf(f, session)!;
    expect(r.level).toBe('expert');
    expect(r.club).toBe('Nantes');
    expect(r.fencers[0]).toMatchObject({ lastName: 'X', category: 'HANDI' });
    expect(r.fencers[1].lastName).toBe('');
  });

  it('tireur sans composition : la session (alias de compatibilité) ; sans rien : undefined', () => {
    const session = info();
    expect(rapieresInfoOf(fencer(), session)).toBe(session);
    expect(rapieresInfoOf(fencer(), undefined)).toBeUndefined();
  });

  it('écriture puis lecture : composition conservée', () => {
    const original = info();
    const e = rapieresTeamEntry(original, REF);
    const back = rapieresInfoOf(fencer({ ...e, club: original.club }), original)!;
    expect(back.level).toBe(original.level);
    expect(back.fencers.map(f => f.lastName)).toEqual(['DUPONT', 'MARTIN']);
    expect(back.fencers.map(f => f.category)).toEqual(['SENIOR', 'V2']);
  });

  it('rapieresTeamsOf fusionne : tireurs d’abord, session pour les autres', () => {
    const sessionOnly = info({ level: 'expert' });
    const teams = rapieresTeamsOf(
      [
        fencer({ id: 'a', level: 1, members: [{ lastName: 'Q', firstName: 'q' }] }),
        fencer({ id: 'b' }),
      ],
      { b: sessionOnly, c: sessionOnly }
    );
    expect(teams.a.level).toBe('beginner');
    expect(teams.b).toBe(sessionOnly);
    expect(teams.c).toBe(sessionOnly);
  });
});
