/**
 * BPM - Escrime - Signatures des feuilles (tablette) : feuille de poule et feuille de match du
 * tableau (#2159). Pièce jointe hors journal de l'épreuve : une signature valide une feuille,
 * elle ne change ni score ni classement, et l'image n'a pas sa place dans le journal (RGPD).
 * Règles reprises des routes du serveur distant : tireur de la poule, ses matchs terminés,
 * feuille verrouillée une fois signée par tous ; signature de match réservée au tableau.
 * Licensed under GPL-3.0
 */
import { MatchStatus } from '../../../shared/types';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { readSession } from './sessionView';
import { sessionPools, sessionTableau } from './sport';

interface SheetMatch {
  status?: unknown;
  poolId?: unknown;
  fencerA?: { id?: string } | null;
  fencerB?: { id?: string } | null;
  fencerAId?: string;
  fencerBId?: string;
}

const sideIds = (m: SheetMatch) =>
  [m.fencerA?.id ?? m.fencerAId, m.fencerB?.id ?? m.fencerBId].filter((id): id is string => !!id);

const isFinished = (m: SheetMatch) => m.status === MatchStatus.FINISHED || m.status === 'finished';

export function signPoolSheet(
  ctx: CommandContext,
  input: { competitionId: string; poolId: string; fencerId: string; signatureData: string }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  // Matchs de la poule : base, sinon état de session (poule pas encore enregistrée)
  const fromDb = ctx.db.getMatchesByPool(input.poolId) as SheetMatch[];
  const matches: SheetMatch[] = fromDb.length
    ? fromDb
    : ((sessionPools(readSession(ctx, comp.id)).find(p => p.id === input.poolId)?.matches ??
        []) as SheetMatch[]);
  if (matches.length === 0) {
    throw new CommandError('pool_not_found', `Poule introuvable : ${input.poolId}`);
  }
  const own = matches.filter(m => sideIds(m).includes(input.fencerId));
  if (own.length === 0) {
    throw new CommandError('fencer_not_in_pool', 'Tireur absent de cette poule');
  }
  if (!own.every(isFinished)) {
    throw new CommandError('fencer_matches_pending', 'Matchs du tireur pas tous terminés');
  }
  const poolFencers = new Set(matches.flatMap(sideIds));
  const signed = new Set(ctx.db.getPoolSignatures(input.poolId).map(s => s.fencerId));
  if ([...poolFencers].every(id => signed.has(id))) {
    throw new CommandError('signatures_locked', 'Feuille déjà signée par tous les tireurs');
  }
  ctx.db.savePoolSignature(input.poolId, input.fencerId, input.signatureData);
  signed.add(input.fencerId);
  return {
    poolId: input.poolId,
    fencerId: input.fencerId,
    signed: signed.size,
    total: poolFencers.size,
    locked: [...poolFencers].every(id => signed.has(id)),
  };
}

export function signMatchSheet(
  ctx: CommandContext,
  input: { competitionId: string; matchId: string; fencerId: string; signatureData: string }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  // Identifiant de tableau (« r16-3 ») ou composite en base (« ${competitionId}-r16-3 »)
  const match: SheetMatch | undefined =
    ctx.db.getMatch(input.matchId) ??
    ctx.db.getMatch(`${comp.id}-${input.matchId}`) ??
    sessionTableau(readSession(ctx, comp.id)).find(m => m.id === input.matchId) ??
    undefined;
  if (!match) throw new CommandError('match_not_found', `Match introuvable : ${input.matchId}`);
  if (match.poolId) {
    throw new CommandError('signature_tableau_only', 'Signature de match réservée au tableau');
  }
  ctx.db.saveDEMatchSignature(input.matchId, input.fencerId, input.signatureData);
  return { matchId: input.matchId, fencerId: input.fencerId };
}
