/**
 * BPM - Escrime - Créneau d'une piste pour les écrans et feuilles de match (#1960)
 * Créneau de l'arène (`getArenaSlot`) → `PisteRecord` du modèle commun : n° des matchs
 * identiques à ceux de l'affichage (`resolveCyranoCoords`), tireurs A à droite, B à gauche.
 * Licensed under GPL-3.0
 */

import { createHash } from 'crypto';
import type { ArenaSlot, ArenaSlotResult } from '../remote/arenaSlot';
import type { Fencer } from '../../shared/types';
import { resolveCyranoCoords, type MatchCoordsSource } from '../cyrano/matchCoords';
import { pickCyranoNat, type CyranoNatSource } from '../cyrano/names';
import type { PisteRecord, PisteRecordFencer, PisteRecordResult } from './types';

export interface PisteRecordInput {
  slot: ArenaSlot;
  competitionId?: string;
  arenaId: string;
  activeMatchId?: string;
  referee?: { id: string; name: string };
  options: { natSource: CyranoNatSource; international: boolean };
  coordsSource?: MatchCoordsSource;
}

/** Identifiant opaque et stable du créneau, à la forme d'un UUID (spéc. OPP2 § 17) */
export function pisteSlotId(competitionId: string | undefined, key: string): string {
  const h = createHash('sha256')
    .update(`${competitionId ?? ''}\u0000${key}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function status(side: 'A' | 'B', r: ArenaSlotResult): PisteRecordResult['right']['status'] {
  const out = side === 'A' ? r.outA : r.outB;
  if (out) return out === 'exclusion' ? 'E' : 'A';
  return r.winner === side ? 'V' : 'D';
}

export function buildPisteRecord(input: PisteRecordInput): PisteRecord {
  const { slot, competitionId, options } = input;
  const fencer = (f: Fencer): PisteRecordFencer => {
    const nat = pickCyranoNat(f, options.natSource, options.international);
    return { id: f.id, lastName: f.lastName, firstName: f.firstName, ...(nat ? { nat } : {}) };
  };
  let poulTab: string | undefined;
  let activeBout: number | undefined;
  const bouts = slot.bouts.map(({ match, result }) => {
    const coords = resolveCyranoCoords(match, competitionId, input.coordsSource);
    poulTab ??= coords.poulTab;
    if (match.id === input.activeMatchId) activeBout = coords.matchNum;
    return {
      id: coords.matchNum,
      right: fencer(match.fencerA),
      left: fencer(match.fencerB),
      result: result
        ? {
            right: { score: result.scoreA, status: status('A', result) },
            left: { score: result.scoreB, status: status('B', result) },
          }
        : null,
    };
  });
  const pool = slot.poolId !== undefined;
  const label = pool
    ? `Poule ${poulTab ?? ''}`.trim()
    : poulTab && /^A\d+$/.test(poulTab)
      ? `Tableau de ${poulTab.slice(1)}`
      : 'Tableau';
  return {
    slotId: pisteSlotId(competitionId, pool ? `pool:${slot.poolId}` : `de:${input.arenaId}`),
    phaseType: pool ? 'pool' : 'DE',
    label,
    ...(activeBout !== undefined ? { activeBout } : {}),
    ...(input.referee ? { referee: input.referee } : {}),
    participants: slot.participants.map(fencer),
    bouts,
  };
}
