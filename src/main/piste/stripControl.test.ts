/**
 * Pilotage de la salle hors compétition (#2117) : trame DISP Cyrano d'un affichage libre (noms
 * tronqués par names.ts, HELLO derrière), messages OPP2 équivalents, écho des appareils et
 * accusé de réception (reçu, refusé en plein combat, sans réponse), routage par le
 * MultiPisteDriver, affichage gardé par le PisteHub sur une piste libre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCyrano, parseCyrano } from '../cyrano/codec';
import { CyranoServer } from '../cyrano/server';
import { CyranoPisteDriver, cyranoPanelEcho, panelToDisp } from '../cyrano/driver';
import { MqttBroker } from '../opp2/mqttBroker';
import { Opp2PisteDriver } from '../opp2/driver';
import { MultiPisteDriver } from './multiDriver';
import { PisteHub } from './pisteHub';
import { StripControl } from './stripControl';
import type { StripControlChange, StripPanel } from '../../shared/types/stripDevice';

const IP = '10.0.0.9';
const PANEL: StripPanel = {
  weapon: 'S',
  left: { name: 'Dupont-Lefèvre Léa', nat: 'France' },
  right: { name: 'Rossi Gia', nat: 'ITA' },
};

describe('affichage libre Cyrano', () => {
  it('DISP : arme, noms translittérés et tronqués, nations sur 3 caractères, sans Id', () => {
    const disp = panelToDisp(PANEL, 10);
    const frame = buildCyrano({
      ...disp,
      protocol: 'EFP1.1',
      command: 'DISP',
      piste: '1',
      compe: '',
    });
    const msg = parseCyrano(frame)!;
    expect(msg).toMatchObject({ command: 'DISP', weapon: 'S', type: 'I', round: '1' });
    expect(msg.left).toMatchObject({ name: 'DUPONT-LEF', nat: 'FRA' });
    expect(msg.right).toMatchObject({ name: 'ROSSI GIA', nat: 'ITA' });
    expect(msg.left?.id).toBeUndefined();
    expect(cyranoPanelEcho(PANEL, 10)).toEqual({
      weapon: 'S',
      left: 'DUPONT-LEF',
      right: 'ROSSI GIA',
      clear: false,
    });
    // Remise à blanc : DISP vide
    expect(panelToDisp({})).toEqual({});
    expect(cyranoPanelEcho({})).toEqual({ left: '', right: '', clear: true });
  });
});

describe('StripControl', () => {
  let server: CyranoServer;
  let broker: MqttBroker;
  let opp2: Opp2PisteDriver;
  let multi: MultiPisteDriver;
  let changes: StripControlChange[];
  let hold: ReturnType<typeof vi.fn<(piste: string) => void>>;
  let control: StripControl;
  let disp: ReturnType<typeof vi.spyOn>;
  let hello: ReturnType<typeof vi.spyOn>;
  const now = 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    server = new CyranoServer();
    server.setPistes([{ piste: '1', ip: IP, arena: 1 }]);
    disp = vi.spyOn(server, 'sendDisp').mockReturnValue(true);
    hello = vi.spyOn(server, 'sendHello').mockReturnValue(true);
    broker = new MqttBroker();
    opp2 = new Opp2PisteDriver(broker, { now: () => now });
    opp2.setPistes([{ piste: 'bleue', arena: 2 }]);
    opp2.start();
    multi = new MultiPisteDriver([new CyranoPisteDriver(server), opp2]);
    changes = [];
    hold = vi.fn();
    control = new StripControl({
      driver: multi,
      hold,
      onChange: c => changes.push(c),
      now: () => now,
      timeoutMs: 5000,
    });
  });
  afterEach(() => {
    control.dispose();
    vi.useRealTimers();
  });

  const info = (state: string, weapon: string, right: string, left: string) =>
    server.handle(
      `|EFP1.1|INFO|1||||||||I|${weapon}|N|${state}||||%||${right}|FRA|0|U|%||${left}|ITA|0|U|%|`,
      IP,
      50100
    );
  const target = { venueId: 'v1', strip: 1, piste: '1', protocol: 'cyrano' as const };

  it('Cyrano : DISP puis HELLO, piste gardée, INFO qui reflète l’envoi = reçu', () => {
    expect(control.send(target, PANEL)).toBe(true);
    expect(disp).toHaveBeenCalledWith('1', expect.objectContaining({ weapon: 'S' }));
    expect(hello).toHaveBeenCalledWith('1');
    expect(hold).toHaveBeenCalledWith('1');
    expect(control.lastFor('1')).toMatchObject({ ack: 'pending', at: now, panel: PANEL });
    // INFO croisé (ancien affichage, au repos) : on attend
    info('W', 'E', 'X', 'Y');
    expect(control.lastFor('1')?.ack).toBe('pending');
    info('W', 'S', 'ROSSI GIA', 'DUPONT-LEF');
    expect(control.lastFor('1')).toMatchObject({ ack: 'acked', ackAt: now });
    expect(changes.filter(c => c.kind === 'ack')).toEqual([
      { kind: 'ack', piste: '1', venueId: 'v1', strip: 1, ack: 'acked' },
    ]);
    // Accusé lié à la piste de la salle visée
    expect(control.lastFor('1', { venueId: 'v1', strip: 1 })).not.toBeNull();
    expect(control.lastFor('1', { venueId: 'v2', strip: 1 })).toBeNull();
  });

  it('Cyrano : appareil en plein combat = refusé ; sans INFO = sans réponse', () => {
    control.send(target, PANEL);
    info('F', 'E', 'X', 'Y');
    expect(control.lastFor('1')?.ack).toBe('refused');
    control.send(target, { weapon: 'E' });
    vi.advanceTimersByTime(5000);
    expect(control.lastFor('1')?.ack).toBe('no_response');
    // Liaison passée en ligne au premier INFO : avis, rattaché à la piste de la salle
    expect(changes.find(c => c.kind === 'link')).toMatchObject({
      piste: '1',
      venueId: 'v1',
      strip: 1,
    });
  });

  it('OPP2 : fencers + match publiés sans Id ; écho apparatus/fencers = reçu', () => {
    const published: Record<string, Record<string, unknown>> = {};
    broker.subscribe('openpiste/bleue/software/#', (t, p) => {
      published[t.split('/')[3]] = JSON.parse(p.toString());
    });
    const t2 = { venueId: 'v1', strip: 2, piste: 'bleue', protocol: 'opp2' as const };
    expect(control.send(t2, PANEL)).toBe(true);
    expect(published.fencers).toMatchObject({
      left: { fencer: { id: '', name: 'DUPONT-LEFÈVRE LÉA', club_abbr: 'France' } },
      right: { fencer: { id: '', name: 'ROSSI GIA', nation: 'ITA' } },
    });
    expect(published.match).toMatchObject({ weapon: 'S', competition: '' });
    // Morceau sans nom : rien de conclusif
    broker.publish(
      'openpiste/bleue/apparatus/state',
      JSON.stringify({ protocol: 'OPP2', version: '1.0', seq: 1, ts: 1, state: 'W' }),
      { qos: 1 }
    );
    expect(control.lastFor('bleue')?.ack).toBe('pending');
    broker.publish(
      'openpiste/bleue/apparatus/fencers',
      JSON.stringify({
        protocol: 'OPP2',
        version: '1.0',
        seq: 2,
        ts: 2,
        left: { fencer: { id: '', name: 'Dupont-Lefèvre Léa' } },
        right: { fencer: { id: '', name: 'ROSSI GIA' } },
      }),
      { qos: 1 }
    );
    expect(control.lastFor('bleue')?.ack).toBe('acked');
  });

  it('OPP2 : appareil en combat = refusé ; piste inconnue ou pilote arrêté : pas d’envoi', () => {
    const t2 = { venueId: 'v1', strip: 2, piste: 'bleue', protocol: 'opp2' as const };
    control.send(t2, { weapon: 'F' });
    broker.publish(
      'openpiste/bleue/apparatus/state',
      JSON.stringify({ protocol: 'OPP2', version: '1.0', seq: 1, ts: 1, state: 'F' }),
      { qos: 1 }
    );
    expect(control.lastFor('bleue')?.ack).toBe('refused');
    expect(control.send({ ...t2, piste: 'inconnue' }, PANEL)).toBe(false);
    opp2.stop();
    expect(control.send(t2, PANEL)).toBe(false);
  });
});

describe('PisteHub : affichage libre gardé sur une piste libre', () => {
  it('retour en ligne sans épreuve : pas de remise à blanc si la piste est pilotée par la salle', () => {
    const server = new CyranoServer({ now: () => Date.now() });
    server.setPistes([
      { piste: '1', ip: IP, arena: 1 },
      { piste: '2', ip: '10.0.0.8', arena: 2 },
    ]);
    const driver = new CyranoPisteDriver(server);
    const send = vi.spyOn(driver, 'send');
    const hub = new PisteHub(driver, () => null);
    hub.attach();
    hub.holdPanel('1');
    const resend = (piste: string) =>
      (hub as unknown as { resendMatch(p: string): void }).resendMatch(piste);
    resend('1');
    resend('2');
    expect(send.mock.calls.map(c => [c[0], c[1].kind])).toEqual([['2', 'clear']]);
    hub.detach();
  });
});
