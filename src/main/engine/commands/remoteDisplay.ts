/**
 * BPM - Escrime - Serveur distant : mots de passe, thèmes, kiosque, note d'organisation,
 * inscription, pointage, espace formateurs, webhook, logo et synthèse vocale (#1981 lot 2,
 * docs/adr/0022). Reprise des anciens canaux IPC remote:* (remoteDisplayHandlers,
 * remoteSettingsHandlers, remoteSessionHandlers, webhookHandlers). Pas de journal.
 * Licensed under GPL-3.0
 */
import type {
  CustomTheme,
  DisplayTheme,
  OrgNote,
  ThemeTargetType,
} from '../../../shared/types/remote';
import type { RemoteScoreServer } from '../../remoteScoreServer';
import { publishRemoteActivity } from '../api/events';
import { CommandError } from './context';
import {
  adminOf,
  passwordRefusal,
  refuse,
  refuseAsync,
  refuseLogged,
  serverOf,
  type RemoteHandler,
} from './remoteSupport';

type DisplayOps =
  | 'setRemoteTheme'
  | 'setArenaTheme'
  | 'clearArenaThemeOverride'
  | 'setArenaScreenTheme'
  | 'setKioskViews'
  | 'setKioskTheme'
  | 'setRemoteWallpaper'
  | 'setOrgNote'
  | 'clearOrgNote'
  | 'setArenaPassword'
  | 'configureRegistration'
  | 'configureCheckin'
  | 'configureTrainerSpace'
  | 'setRemoteWebhook'
  | 'testRemoteWebhook'
  | 'setRemoteLogo'
  | 'setTtsConfig';

type KioskViews = Parameters<RemoteScoreServer['updateKioskViews']>[0];

export const remoteDisplayHandlers: { [N in DisplayOps]: RemoteHandler<N> } = {
  // ── Thèmes et affichages ──
  setRemoteTheme: (ctx, { competitionId, theme }) =>
    refuseLogged('Error updating theme:', () =>
      serverOf(ctx, competitionId).updateTheme(theme as DisplayTheme)
    ),
  setArenaTheme: (ctx, { competitionId, arenaId, theme, customTheme }) =>
    refuseLogged('Error updating arena theme:', () =>
      serverOf(ctx, competitionId).updateArenaTheme(
        arenaId,
        theme as DisplayTheme,
        customTheme as CustomTheme | undefined
      )
    ),
  clearArenaThemeOverride: (ctx, { competitionId, arenaId }) =>
    refuse(() => serverOf(ctx, competitionId).clearArenaThemeOverride(arenaId)),
  setArenaScreenTheme: (ctx, { competitionId, arenaId, targetType, customTheme }) =>
    refuse(() =>
      serverOf(ctx, competitionId).updateArenaScreenTheme(
        arenaId,
        targetType as ThemeTargetType,
        customTheme as CustomTheme | undefined
      )
    ),
  setKioskViews: (ctx, { competitionId, views }) =>
    refuseLogged('Error updating kioskViews:', () =>
      serverOf(ctx, competitionId).updateKioskViews(views as unknown as KioskViews)
    ),
  setKioskTheme: (ctx, { competitionId, variables }) =>
    refuseLogged('Error updating kiosk theme:', () =>
      serverOf(ctx, competitionId).updateKioskTheme(variables)
    ),
  setRemoteWallpaper: (ctx, { competitionId, wallpaper }) =>
    refuse(() => serverOf(ctx, competitionId).setWallpaper(wallpaper)),
  setOrgNote: (ctx, { competitionId, note }) => {
    refuseLogged('Error setting org note:', () =>
      serverOf(ctx, competitionId).setOrgNote(note as OrgNote)
    );
    publishRemoteActivity({ kind: 'org_note_changed', competitionId, note: note as OrgNote });
  },
  clearOrgNote: (ctx, { competitionId }) => {
    refuseLogged('Error clearing org note:', () => serverOf(ctx, competitionId).clearOrgNote());
    publishRemoteActivity({ kind: 'org_note_changed', competitionId, note: null });
  },

  // ── Mots de passe, inscription, pointage, espace formateurs ──
  setArenaPassword: (ctx, { competitionId, arenaId, password }) =>
    passwordRefusal(() => serverOf(ctx, competitionId).setArenaPassword(arenaId, password)),
  configureRegistration: (ctx, { competitionId, enabled }) =>
    refuse(() => serverOf(ctx, competitionId).setRegistrationEnabled(enabled)),
  configureCheckin: (ctx, { competitionId, enabled, password }) =>
    passwordRefusal(() => {
      const server = serverOf(ctx, competitionId);
      if (enabled !== undefined) server.setCheckinEnabled(enabled);
      if (password !== undefined) server.setCheckinPassword(password);
    }),
  configureTrainerSpace: (ctx, { competitionId, enabled, password }) =>
    passwordRefusal(() => {
      const server = serverOf(ctx, competitionId);
      if (enabled !== undefined) server.setTrainerEnabled(enabled);
      if (password !== undefined) server.setTrainerPassword(password);
    }),

  // ── Réglages valables pour tous les serveurs du poste ──
  setRemoteWebhook: (ctx, { url }) =>
    refuse(() => {
      for (const server of adminOf(ctx).servers()) server.setWebhookUrl(url);
    }),
  testRemoteWebhook: async (ctx, { url }) => {
    const result = await adminOf(ctx).testWebhook(url);
    if (result.success) return { status: result.status };
    if (result.error === 'invalid_url') {
      throw new CommandError('invalid_url', 'URL du webhook refusée : https vers un hôte public');
    }
    throw new CommandError('remote_refused', result.error ?? 'Échec du webhook');
  },
  setRemoteLogo: (ctx, { logo }) => refuseAsync(() => adminOf(ctx).setLogo(logo)),
  setTtsConfig: (ctx, { config }) => refuseAsync(() => adminOf(ctx).setTtsConfig(config)),
};
