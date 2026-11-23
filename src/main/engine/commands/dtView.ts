/**
 * BPM - Escrime - Réglage de l'espace « Vue DT » (#1981 lot 3, docs/adr/0020)
 * configureDtView, getDtViewStatus : l'écran du poste serveur ouvre ou ferme l'accès en
 * lecture seule au contrat sur le réseau de la salle. Mot de passe jamais renvoyé ni journalisé.
 * Licensed under GPL-3.0
 */
import { CommandError, type CommandContext, type DtViewPort } from './context';
import { getCompetitionOrThrow } from './competitions';

function portOf(ctx: CommandContext, competitionId: string): DtViewPort | undefined {
  getCompetitionOrThrow(ctx, competitionId);
  return ctx.remote?.dtView?.(competitionId);
}

export function getDtViewStatus(ctx: CommandContext, input: { competitionId: string }) {
  const port = portOf(ctx, input.competitionId);
  return port
    ? { running: true, ...port.status() }
    : { running: false, enabled: false, configured: false };
}

export function configureDtView(
  ctx: CommandContext,
  input: { competitionId: string; enabled?: boolean; password?: string; dryRun?: boolean }
) {
  const port = portOf(ctx, input.competitionId);
  if (!port) {
    throw new CommandError('remote_not_running', 'Saisie distante de l’épreuve non démarrée');
  }
  const before = port.status();
  // Ouvrir l'espace sans mot de passe (ou en le retirant) : refusé
  const willHavePassword = input.password !== undefined ? !!input.password : before.configured;
  const willBeEnabled = input.enabled ?? before.enabled;
  if (willBeEnabled && !willHavePassword) {
    throw new CommandError('weak_password', 'Mot de passe requis pour ouvrir la vue DT');
  }
  if (!input.dryRun) {
    if (input.password !== undefined) {
      try {
        port.setPassword(input.password);
      } catch (e) {
        // Règle de robustesse du serveur distant (assertPasswordStrength)
        throw new CommandError('weak_password', (e as Error).message);
      }
    }
    if (input.enabled !== undefined) port.setEnabled(input.enabled);
  }
  return { dryRun: !!input.dryRun, ...(input.dryRun ? before : port.status()) };
}
