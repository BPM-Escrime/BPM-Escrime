/**
 * Tour en vagues : calendrier, vagues d'un tour, feuilles d'arbitrage, état de session
 * (docs/adr/0043, lot F4a ; ex-tests des rapières, #1118)
 */
import { describe, it, expect } from 'vitest';
import { Fencer, FencerStatus, Gender, Match, MatchStatus, Pool } from '../../types';
import {
  applyClassicOrder,
  canLaunchNextWave,
  emptyPoolWaves,
  isPoolRoundFinished,
  isWaveComplete,
  isWavesOrder,
  poolMatchWaves,
  poolWavesOf,
  scheduleWaves,
  waveCount,
  waveMatchIds,
  waveMatchOrder,
  wavesBoutOrder,
  waveSheetMatches,
} from './waves';
import { classicMatchOrder } from './wavesClassicOrder';

const fencer = (id: string, status = FencerStatus.CHECKED_IN): Fencer =>
  ({
    id,
    ref: 0,
    lastName: `Équipe ${id}`,
    firstName: '',
    gender: Gender.MIXED,
    nationality: 'FRA',
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Fencer;

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

/** Poule générée comme en préparation : ordre des matchs suivant les vagues */
const makePool = (fencers: Fencer[], number = 1): Pool => {
  const poolId = `p${number}`;
  const matches: Match[] = waveMatchOrder(fencers).map(([a, b], i) => ({
    id: `${poolId}-m${i + 1}`,
    number: i + 1,
    fencerA: fencers[a - 1],
    fencerB: fencers[b - 1],
    scoreA: null,
    scoreB: null,
    maxScore: 5,
    status: MatchStatus.NOT_STARTED,
    poolId,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  return {
    id: poolId,
    number,
    phaseId: 'phase-pools',
    fencers,
    matches,
    referees: [],
    isComplete: false,
    hasError: false,
    ranking: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Pool;
};

/** Le plus petit numéro gagne toujours */
const play = (pool: Pool, filter: (m: Match) => boolean = () => true) => {
  for (const m of pool.matches.filter(filter)) {
    const aWins = Number(m.fencerA!.id.slice(1)) < Number(m.fencerB!.id.slice(1));
    m.scoreA = { value: aWins ? 5 : 1, isVictory: aWins } as Match['scoreA'];
    m.scoreB = { value: aWins ? 1 : 5, isVictory: !aWins } as Match['scoreB'];
    m.status = MatchStatus.FINISHED;
  }
};

describe('Tour en vagues (docs/adr/0043)', () => {
  describe('vagues', () => {
    for (const n of [3, 5, 7, 9]) {
      it(`${n} équipes (impair) : une équipe au repos par vague, la dernière d'abord`, () => {
        const teams = ids(n);
        const bouts = scheduleWaves(teams);
        expect(bouts).toHaveLength((n * (n - 1)) / 2);
        expect(new Set(bouts.map(b => [b.teamAId, b.teamBId].sort().join('|'))).size).toBe(
          bouts.length
        );
        expect(Math.max(...bouts.map(b => b.wave))).toBe(n);
        for (let w = 1; w <= n; w++) {
          const playing = bouts.filter(b => b.wave === w).flatMap(b => [b.teamAId, b.teamBId]);
          expect(new Set(playing).size).toBe(playing.length); // personne ne tire deux fois
          expect(playing).toHaveLength(n - 1);
          const resting = teams.filter(id => !playing.includes(id));
          expect(resting).toEqual([teams[n - w]]); // repos : dernière, puis en remontant
        }
      });
    }

    for (const n of [2, 4, 6, 10]) {
      it(`${n} équipes : round-robin complet, toutes les équipes tirent à chaque vague`, () => {
        const teams = ids(n);
        const bouts = scheduleWaves(teams);
        expect(bouts).toHaveLength((n * (n - 1)) / 2);
        const pairs = new Set(bouts.map(b => [b.teamAId, b.teamBId].sort().join('|')));
        expect(pairs.size).toBe(bouts.length);
        const doubled: string[] = [];
        const waves = Math.max(...bouts.map(b => b.wave));
        for (let w = 1; w <= waves; w++) {
          const counts = new Map<string, number>();
          for (const b of bouts.filter(x => x.wave === w))
            for (const id of [b.teamAId, b.teamBId]) counts.set(id, (counts.get(id) ?? 0) + 1);
          for (const [id, c] of counts) if (c === 2) doubled.push(id);
          if (w < waves) expect(counts.size).toBe(n);
        }
        // Une équipe ne tire jamais deux fois dans deux vagues différentes
        expect(new Set(doubled).size).toBe(doubled.length);
      });
    }

    it('ordre des matchs de la poule suivant les vagues', () => {
      const pool = makePool(ids(4).map(id => fencer(id)));
      const waves = poolMatchWaves(pool);
      const order = pool.matches.map(m => waves.get(m.id));
      expect(order).toEqual([...order].sort());
      expect(waveCount([pool])).toBe(3);
      expect(waveMatchIds([pool], 1).size).toBe(2);
    });

    it('vague suivante lancée seulement quand la précédente est saisie', () => {
      const pool = makePool(ids(4).map(id => fencer(id)));
      expect(canLaunchNextWave([pool], 0)).toBe(true);
      expect(canLaunchNextWave([pool], 1)).toBe(false);
      const wave1 = waveMatchIds([pool], 1);
      play(pool, m => wave1.has(m.id));
      expect(isWaveComplete([pool], 1)).toBe(true);
      expect(canLaunchNextWave([pool], 1)).toBe(true);
      expect(canLaunchNextWave([pool], 3)).toBe(false);
    });

    it('équipe retirée : ses matchs ne bloquent pas la vague', () => {
      const fencers = ids(4).map(id => fencer(id));
      const pool = makePool(fencers);
      fencers[0].status = FencerStatus.ABANDONED;
      const wave1 = waveMatchIds([pool], 1);
      play(pool, m => wave1.has(m.id) && m.fencerA!.id !== 't1' && m.fencerB!.id !== 't1');
      expect(isWaveComplete([pool], 1)).toBe(true);
    });
  });

  describe('feuilles de la vague active', () => {
    it('ne contient que les matchs de la vague, triés par poule', () => {
      const poolB = makePool(
        ids(4).map(id => fencer(`b${id}`)),
        2
      );
      const poolA = makePool(
        ids(4).map(id => fencer(`a${id}`)),
        1
      );
      const sheets = waveSheetMatches([poolB, poolA], 1);
      expect(sheets).toHaveLength(4);
      expect(sheets.map(m => m.label)).toEqual([
        'Vague 1 — Poule 1',
        'Vague 1 — Poule 1',
        'Vague 1 — Poule 2',
        'Vague 1 — Poule 2',
      ]);
      const wave1 = new Set([...waveMatchIds([poolA], 1), ...waveMatchIds([poolB], 1)]);
      expect(sheets.every(m => wave1.has(m.id))).toBe(true);
      expect(sheets.every(m => !m.isBye && m.scoreA === null && m.winner === null)).toBe(true);
    });

    it('vague 0 ou inexistante : aucune feuille', () => {
      const pool = makePool(ids(4).map(id => fencer(id)));
      expect(waveSheetMatches([pool], 0)).toEqual([]);
      expect(waveSheetMatches([pool], 9)).toEqual([]);
    });

    it('exclut les matchs annulés et ceux d’une équipe retirée', () => {
      const fencers = ids(4).map(id => fencer(id));
      const pool = makePool(fencers);
      const wave1 = [...waveMatchIds([pool], 1)];
      pool.matches.find(m => m.id === wave1[0])!.status = MatchStatus.CANCELLED;
      expect(waveSheetMatches([pool], 1)).toHaveLength(1);
      fencers.forEach(f => (f.status = FencerStatus.FORFAIT));
      expect(waveSheetMatches([pool], 1)).toHaveLength(0);
    });

    it('reprend la piste de la poule', () => {
      const pool = makePool(ids(4).map(id => fencer(id)));
      pool.strip = 3;
      expect(waveSheetMatches([pool], 1).every(m => m.arena === 3)).toBe(true);
    });
  });

  describe('ordre « waves » et « waves_classic », état de session', () => {
    it('isWavesOrder : seulement waves et waves_classic', () => {
      expect(['fie', 'free', 'waves', 'waves_classic', undefined].map(isWavesOrder)).toEqual([
        false,
        false,
        true,
        true,
        false,
      ]);
    });

    it('« waves » : ordre des vagues, toutes tailles de 2 à 10', () => {
      for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const fencers = ids(n).map(id => fencer(id));
        expect(wavesBoutOrder('waves', fencers)).toEqual(waveMatchOrder(fencers));
        expect(waveMatchOrder(fencers)).toHaveLength((n * (n - 1)) / 2);
      }
    });

    it('« waves_classic » : table fixe de la taille (10), sinon vagues calculées', () => {
      const ten = ids(10).map(id => fencer(id));
      expect(wavesBoutOrder('waves_classic', ten)).toEqual(classicMatchOrder(10));
      const six = ids(6).map(id => fencer(id));
      expect(wavesBoutOrder('waves_classic', six)).toEqual(waveMatchOrder(six));
      // Les vagues d'une poule tirée en ordre classique suivent la table
      const pool = applyClassicOrder(makePool(ten));
      expect(waveCount([pool])).toBe(9);
    });

    it('poolWavesOf : clé waves, sinon ancienne clé des rapières (alias), sinon rien', () => {
      expect(poolWavesOf({})).toEqual(emptyPoolWaves());
      expect(poolWavesOf({ waves: { launched: 2, ended: true } })).toEqual({
        launched: 2,
        ended: true,
      });
      expect(poolWavesOf({ rapieres: { launchedWave: 3, wavesEnded: true } })).toEqual({
        launched: 3,
        ended: true,
      });
      // La clé waves prime sur l'ancienne
      expect(
        poolWavesOf({ waves: { launched: 1, ended: false }, rapieres: { launchedWave: 5 } })
      ).toEqual({ launched: 1, ended: false });
    });

    it('isPoolRoundFinished : poules réglées, ou vagues arrêtées pour un tour en vagues', () => {
      const pool = makePool(ids(4).map(id => fencer(id)));
      expect(isPoolRoundFinished([pool], undefined, false)).toBe(false);
      expect(isPoolRoundFinished([pool], { launched: 1, ended: true }, false)).toBe(false);
      expect(isPoolRoundFinished([pool], { launched: 1, ended: false }, true)).toBe(false);
      expect(isPoolRoundFinished([pool], { launched: 1, ended: true }, true)).toBe(true);
      expect(isPoolRoundFinished([], { launched: 1, ended: true }, true)).toBe(false);
      play(pool);
      expect(isPoolRoundFinished([pool], undefined, false)).toBe(true);
    });
  });
});
