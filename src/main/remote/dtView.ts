/**
 * BellePoule Modern - Espace « Vue DT » du serveur distant (#1981 lot 3, docs/adr/0020)
 * Mot de passe haché, jeton en cookie bp_dt_token (8 h), désactivé par défaut. Branche
 * l'adaptateur WebSocket du contrat (/api, lecture seule) avec les limites des autres sockets :
 * plafond de connexions par IP, seau à jetons par socket.
 * Licensed under GPL-3.0
 */
import type express from 'express';
import type { Server as SocketIOServer, Namespace } from 'socket.io';
import {
  assertPasswordStrength,
  hashPassword,
  issueToken,
  isTokenValid,
  parseCookies,
  sendLoginLimited,
  verifyPasswordAsync,
  TOKEN_TTL_MS,
  type LoginGuard,
} from './auth';
import { isLoopbackAddress, normalizeIp } from './network';
import { registerWsApi, WS_API_NAMESPACE } from '../engine/api/wsAdapter';
import type { CommandContext, DtViewPort } from '../engine/commands/context';
import { logger, LogCategory } from '../../shared/services/logger';

export const DT_COOKIE = 'bp_dt_token';
export const DT_LOGIN_PATH = '/api/dt/login';
const LOGIN_TARGET = 'dt';

export interface DtViewStatus {
  enabled: boolean;
  configured: boolean;
}

export interface DtViewLimits {
  maxSocketsPerIp: number;
  eventBurst: number;
  eventsPerSec: number;
}

export class DtViewAccess implements DtViewPort {
  private enabled = false;
  private password: string | null = null;
  readonly tokens = new Map<string, number>();
  private nsp: Namespace | null = null;

  status(): DtViewStatus {
    return { enabled: this.enabled, configured: !!this.password };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.revoke();
    logger.info(
      LogCategory.NETWORK,
      `[RemoteScoreServer] Vue DT ${enabled ? 'ouverte' : 'fermée'}`
    );
  }

  /** Vide : mot de passe retiré (espace inaccessible). Tout changement ferme les sessions. */
  setPassword(password: string): void {
    assertPasswordStrength(password);
    this.password = password ? hashPassword(password) : null;
    this.revoke();
    logger.info(
      LogCategory.NETWORK,
      `[RemoteScoreServer] Mot de passe Vue DT ${password ? 'défini' : 'supprimé'}`
    );
  }

  isAuthorized(cookieHeader: string | undefined): boolean {
    if (!this.enabled || !this.password) return false;
    return isTokenValid(this.tokens, parseCookies(cookieHeader)[DT_COOKIE]);
  }

  /** Jetons invalidés et vues DT ouvertes déconnectées */
  private revoke(): void {
    this.tokens.clear();
    this.nsp?.disconnectSockets(true);
  }

  registerRoutes(
    app: express.Application,
    deps: { loginGuard: LoginGuard; clientIp: (req: express.Request) => string }
  ): void {
    app.get('/api/dt/status', (req, res) => {
      res.json({ ...this.status(), authenticated: this.isAuthorized(req.headers.cookie) });
    });

    app.post(DT_LOGIN_PATH, async (req, res) => {
      const ip = deps.clientIp(req);
      const limited = deps.loginGuard.check(ip, LOGIN_TARGET);
      if (limited) return sendLoginLimited(res, limited);
      if (!this.enabled || !this.password) {
        return res.status(403).json({ success: false, closed: true });
      }
      const { password } = (req.body ?? {}) as { password?: unknown };
      if (!(await verifyPasswordAsync(password, this.password))) {
        await deps.loginGuard.recordFailure(ip, LOGIN_TARGET);
        return res.status(401).json({ success: false, error: 'wrong_password' });
      }
      deps.loginGuard.recordSuccess(ip);
      const token = issueToken(this.tokens);
      res.setHeader(
        'Set-Cookie',
        `${DT_COOKIE}=${token}; HttpOnly; SameSite=Strict; Max-Age=${TOKEN_TTL_MS / 1000}; Path=/${req.secure ? '; Secure' : ''}`
      );
      res.json({ success: true });
    });
  }

  /** Espace de noms /api : jeton exigé à la poignée de main, limites des sockets */
  attach(
    io: SocketIOServer,
    ctx: CommandContext,
    competitionId: () => string | undefined,
    limits: DtViewLimits
  ): void {
    const nsp = io.of(WS_API_NAMESPACE);
    this.nsp = nsp;
    // Jeton d'abord : un socket refusé n'entre pas dans le décompte par IP
    registerWsApi(nsp, ctx, {
      competitionId,
      authorize: handshake => this.isAuthorized(handshake.headers.cookie),
    });
    const perIp = new Map<string, number>();
    nsp.use((socket, next) => {
      const ip = normalizeIp(socket.handshake.address);
      const count = (perIp.get(ip) ?? 0) + 1;
      if (count > limits.maxSocketsPerIp && !isLoopbackAddress(ip)) {
        return next(new Error('too_many_connections'));
      }
      perIp.set(ip, count);
      socket.on('disconnect', () => {
        const n = (perIp.get(ip) ?? 1) - 1;
        if (n <= 0) perIp.delete(ip);
        else perIp.set(ip, n);
      });
      let tokens = limits.eventBurst;
      let last = Date.now();
      socket.use((_packet, nextPacket) => {
        const now = Date.now();
        tokens = Math.min(limits.eventBurst, tokens + ((now - last) / 1000) * limits.eventsPerSec);
        last = now;
        if (tokens < 1) {
          socket.disconnect(true);
          return;
        }
        tokens -= 1;
        nextPacket();
      });
      next();
    });
  }
}
