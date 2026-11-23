/**
 * Lecture des réglages du Sabre Laser créés avec l'ancien repli 5 / 21 (#2208).
 */
import { describe, it, expect } from 'vitest';
import {
  LASER_DEFAULT_MAX_SCORE,
  LASER_MAX_SCORE_LIMITS,
  readLaserMaxScores,
} from './laserMaxScores';
import { LASER_SCORE_LIMIT } from '../match/matchEndValidation';
import { Weapon } from '../../types';

const s = (pool?: number, table?: number) => ({
  defaultPoolMaxScore: pool,
  defaultTableMaxScore: table,
});

describe('readLaserMaxScores', () => {
  it('ancien repli 5 / 21 : lu 25 / 25', () => {
    expect(readLaserMaxScores(Weapon.LASER, false, s(5, 21))).toEqual(s(25, 25));
    expect(LASER_DEFAULT_MAX_SCORE).toBe(25);
    expect(LASER_MAX_SCORE_LIMITS.min).toBe(LASER_SCORE_LIMIT);
  });

  it('poule ou tableau sous 15 : lu 25 ; tableau 21 seul conservé', () => {
    expect(readLaserMaxScores(Weapon.LASER, false, s(14, 30))).toEqual(s(25, 30));
    expect(readLaserMaxScores(Weapon.LASER, false, s(21, 10))).toEqual(s(21, 25));
    expect(readLaserMaxScores(Weapon.LASER, false, s(21, 21))).toEqual(s(21, 21));
  });

  it('réglage valide, sans limite (0) ou absent : tel quel', () => {
    const valid = s(30, 25);
    expect(readLaserMaxScores(Weapon.LASER, false, valid)).toBe(valid);
    expect(readLaserMaxScores(Weapon.LASER, false, s(15, 0))).toEqual(s(15, 0));
    expect(readLaserMaxScores(Weapon.LASER, false, {})).toEqual({});
  });

  it('épreuve par équipes et autres armes : tel quel', () => {
    expect(readLaserMaxScores(Weapon.LASER, true, s(5, 15))).toEqual(s(5, 15));
    for (const w of [Weapon.EPEE, Weapon.FOIL, Weapon.SABRE, Weapon.CUSTOM]) {
      expect(readLaserMaxScores(w, false, s(5, 21))).toEqual(s(5, 21));
    }
  });
});
