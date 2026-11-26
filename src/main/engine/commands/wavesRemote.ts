/**
 * BPM - Escrime - Vague active des tablettes, poussée par le moteur (docs/adr/0043, F4a)
 * Une vague lancée, arrêtée ou remise à zéro par une commande (MCP compris) met à jour le
 * serveur distant de l'épreuve, comme le fait l'écran par le canal setActiveWave (inchangé).
 * Absent (tests, MCP sans serveur) : rien.
 * Licensed under GPL-3.0
 */
import { poolWavesOf, waveMatchIds } from '../../../shared/domain/pools/waves';
import type { Pool } from '../../../shared/types';
import type { CommandContext } from './context';

/**
 * Pousse la vague active : matchs de la vague lancée (liste vide : aucune vague lancée), ou
 * `null` quand les vagues sont arrêtées (plus aucun match de poule proposé).
 */
export function pushActiveWave(
  ctx: CommandContext,
  competitionId: string,
  session: Record<string, unknown>
): void {
  const waves = poolWavesOf(session as Parameters<typeof poolWavesOf>[0]);
  const pools = Array.isArray(session.pools) ? (session.pools as Pool[]) : [];
  const ids = waves.ended ? null : [...waveMatchIds(pools, waves.launched)];
  ctx.remote?.admin?.setActiveWave(competitionId, ids, waves.ended);
}

/** Tirage hors tour en vagues : filtre de vague levé */
export function clearActiveWave(ctx: CommandContext, competitionId: string): void {
  ctx.remote?.admin?.setActiveWave(competitionId, null, false);
}
