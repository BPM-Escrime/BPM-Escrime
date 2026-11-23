/**
 * BellePoule Modern - Pilotage des appareils de la salle hors compétition (#2117, docs/adr/0023)
 * Envoie un affichage libre (arme, noms, nationalités ; vide = remise à blanc) à une piste du
 * pilote, hors PisteHub, et suit son accusé de réception :
 * - Cyrano n'acquitte pas un DISP : le pilote envoie un HELLO derrière, l'INFO qui répond (ou
 *   le suivant) fait foi ; noms et arme renvoyés = reçu ; appareil en plein combat = refusé ;
 * - OPP2 : l'écho `apparatus/fencers` fait foi (noms) ; `apparatus/state` actif = refusé ;
 * - rien dans le délai : sans réponse.
 * Ce ne sont que des ordres d'affichage : aucun fait d'épreuve, aucun journal, et jamais de nom
 * dans les traces (RGPD). État en mémoire, perdu au redémarrage.
 * Licensed under GPL-3.0
 */
import type { PisteDriver } from './types';
import type {
  StripControlChange,
  StripDeviceProtocol,
  StripEcho,
  StripLastSend,
  StripPanel,
} from '../../shared/types/stripDevice';
import {
  STRIP_ACK_TIMEOUT_MS,
  stripAckVerdict,
  type StripEchoState,
} from '../../shared/domain/stripDevices/stripControl';

/** Piste de la salle visée par un envoi */
export interface StripControlTarget {
  venueId: string;
  strip: number;
  piste: string;
  protocol: StripDeviceProtocol;
}

interface Pending extends StripLastSend {
  target: StripControlTarget;
  echo: StripEcho | null;
  timer?: ReturnType<typeof setTimeout>;
}

export interface StripControlOptions {
  driver: PisteDriver;
  /** Affichage gardé par le PisteHub tant qu'aucune épreuve n'a la piste */
  hold?: (piste: string) => void;
  onChange?: (change: StripControlChange) => void;
  now?: () => number;
  timeoutMs?: number;
}

export class StripControl {
  private readonly last = new Map<string, Pending>();
  private readonly driver: PisteDriver;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(private readonly options: StripControlOptions) {
    this.driver = options.driver;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? STRIP_ACK_TIMEOUT_MS;
    this.driver.on('echo', this.onEcho);
    this.driver.on('status', this.onStatus);
  }

  dispose(): void {
    this.driver.off('echo', this.onEcho);
    this.driver.off('status', this.onStatus);
    for (const p of this.last.values()) if (p.timer) clearTimeout(p.timer);
  }

  /** Dernier affichage libre envoyé à une piste du pilote (fusion du suivant, accusé) */
  lastFor(piste: string, match?: { venueId: string; strip: number }): StripLastSend | null {
    const p = this.last.get(piste);
    if (!p) return null;
    if (match && (p.target.venueId !== match.venueId || p.target.strip !== match.strip))
      return null;
    const { target: _t, echo: _e, timer: _timer, ...view } = p;
    return view;
  }

  /** Envoie l'affichage ; false si la piste est inconnue du pilote ou le pilote arrêté */
  send(target: StripControlTarget, panel: StripPanel): boolean {
    const previous = this.last.get(target.piste);
    if (previous?.timer) clearTimeout(previous.timer);
    if (!this.driver.send(target.piste, { kind: 'panel', panel })) return false;
    this.options.hold?.(target.piste);
    const echo = this.driver.panelEcho?.(target.piste, panel) ?? null;
    const entry: Pending = {
      target,
      echo,
      at: this.now(),
      ack: 'pending',
      clear: !panel.weapon && !panel.left && !panel.right,
      panel,
    };
    entry.timer = setTimeout(() => this.expire(target.piste, entry), this.timeoutMs);
    entry.timer.unref?.();
    this.last.set(target.piste, entry);
    return true;
  }

  private settle(piste: string, entry: Pending, ack: StripLastSend['ack']): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.ack = ack;
    entry.ackAt = this.now();
    this.options.onChange?.({
      kind: 'ack',
      piste,
      venueId: entry.target.venueId,
      strip: entry.target.strip,
      ack,
    });
  }

  private expire(piste: string, entry: Pending): void {
    if (this.last.get(piste) !== entry || entry.ack !== 'pending') return;
    this.settle(piste, entry, 'no_response');
  }

  private onEcho = (piste: string, state: StripEchoState): void => {
    const entry = this.last.get(piste);
    if (!entry || entry.ack !== 'pending' || !entry.echo) return;
    const verdict = stripAckVerdict(entry.echo, state);
    if (verdict) this.settle(piste, entry, verdict);
  };

  private onStatus = (link: { piste: string }): void => {
    const entry = this.last.get(link.piste);
    this.options.onChange?.({
      kind: 'link',
      piste: link.piste,
      ...(entry ? { venueId: entry.target.venueId, strip: entry.target.strip } : {}),
    });
  };
}
