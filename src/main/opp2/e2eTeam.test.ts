/**
 * Bout en bout OPP2 — relais FIE par équipes (docs/adr/0024, lot E4) : broker MQTT intégré (TCP
 * réel, boucle locale) ↔ appareil simulé ↔ Opp2PisteDriver ↔ PisteHub ↔ RemoteScoreServer
 * (arène équipe `/equipe2`) ↔ commandes du moteur, base SQLite réelle. Scénario : 9 relais
 * joués à l'appareil (recordRelayScore, source opp2), END au-delà du palier → NAK, PREV →
 * reopenRelay, fin de rencontre, journal rejoué sans écart.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppPath: () => '/opt/app', getPath: () => '/tmp', isPackaged: false },
  BrowserWindow: class {},
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  net: { request: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({}) },
  session: { defaultSession: {} },
  shell: { openExternal: vi.fn() },
}));
vi.mock('fs', async importOriginal => ({
  ...(await importOriginal<typeof import('fs')>()),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  readdirSync: vi.fn().mockReturnValue([]),
}));
vi.mock('socket.io', () => ({
  Server: vi.fn().mockImplementation(function () {
    return {
      on: vi.fn(),
      of: vi.fn(() => ({ use: vi.fn(), on: vi.fn(), disconnectSockets: vi.fn() })),
      emit: vi.fn(),
      to: vi.fn().mockReturnThis(),
    };
  }),
}));
vi.mock('../ipc/dbHandlers', async importOriginal => ({
  ...(await importOriginal<typeof import('../ipc/dbHandlers')>()),
  emitCompetitionEvent: vi.fn(),
}));
vi.mock('http', () => ({
  createServer: vi
    .fn()
    .mockReturnValue({ listen: vi.fn(), close: vi.fn(), on: vi.fn(), once: vi.fn() }),
}));
vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

import { RemoteScoreServer } from '../remoteScoreServer';
import { PisteHub } from '../piste/pisteHub';
import { MqttBroker } from './mqttBroker';
import { MqttClient } from './mqttClient';
import { Opp2PisteDriver } from './driver';
import { hasNodeSqlite } from '../../database/testing/nodeSqliteDatabase';
import { Weapon } from '../../shared/types';
import { teamRelayFixture, type TeamRelayFixture } from '../__tests__/teamRelayFixture';

const d = hasNodeSqlite ? describe : describe.skip;

async function until(cond: () => boolean, ms = 15000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('délai dépassé en attendant le message MQTT');
    await new Promise(r => setTimeout(r, 15));
  }
}

/** Appareil OPP2 simulé : reçoit `software/*`, publie `apparatus/*` (QoS 1, retenus). */
class Opp2Apparatus {
  readonly client: MqttClient;
  readonly received: Record<string, Record<string, unknown>[]> = {};
  private seq = 0;

  constructor(
    port: number,
    readonly piste: string
  ) {
    this.client = new MqttClient({
      port,
      clientId: `apparatus-${piste}`,
      will: { topic: this.topic('connection'), payload: '{"online":false}', qos: 1, retain: true },
    });
  }
  topic(m: string): string {
    return `openpiste/${this.piste}/apparatus/${m}`;
  }
  async start(): Promise<void> {
    this.client.on('message', (topic, payload) => {
      const m = topic.split('/')[3];
      (this.received[m] ??= []).push(JSON.parse(payload.toString()));
    });
    await this.client.connect();
    await this.client.subscribe(`openpiste/${this.piste}/software/#`);
    await this.send('connection', { online: true, device: 'sim' });
  }
  last(m: string): Record<string, unknown> | undefined {
    return this.received[m]?.[this.received[m].length - 1];
  }
  count(m: string): number {
    return this.received[m]?.length ?? 0;
  }
  send(m: string, body: object, retain = m !== 'control'): Promise<void> {
    const payload = { protocol: 'OPP2', version: '1.0', seq: ++this.seq, ts: Date.now(), ...body };
    return this.client.publish(this.topic(m), JSON.stringify(payload), { qos: 1, retain });
  }
  /** Score cumulé de l'équipe affichée à droite (A) et à gauche (B) */
  score(right: number, left: number): Promise<void> {
    const s = (n: number) => ({
      score: n,
      status: 'U',
      yellow_card: false,
      red_cards: 0,
      black_card: false,
    });
    return this.send('score', { right: s(right), left: s(left), priority: 'N' });
  }
  /** Relais affiché par le logiciel (`software/match`, round) */
  relay(): number {
    return Number(this.last('match')?.round ?? 0);
  }
}

d(
  'OPP2 bout en bout : relais FIE par équipes par les commandes (ADR-0024, E4)',
  { timeout: 60_000 },
  () => {
    let fx: TeamRelayFixture;
    let broker: MqttBroker;
    let remote: RemoteScoreServer;
    let device: Opp2Apparatus;
    let driver: Opp2PisteDriver;
    let hub: PisteHub;
    const team = () => remote.teamArenaCtx.teamArenaState.get('2')!;
    const control = () => device.last('control')?.command;
    const journal = (type: string) =>
      fx.db.eventLog.getSince(fx.competitionId).filter(e => e.type === type);

    /** Relais joué à l'appareil jusqu'à la réponse (ACK ou NAK) */
    async function end(right: number, left: number): Promise<unknown> {
      await device.send('state', { state: 'F' });
      await device.score(right, left);
      await until(() => {
        const t = team();
        const done = t.bouts.filter(b => b.status === 'finished');
        const before = (k: 'scoreA' | 'scoreB') => done.reduce((s, b) => s + b[k], 0);
        return (
          t.liveScoreA + before('scoreA') === right && t.liveScoreB + before('scoreB') === left
        );
      });
      const before = device.count('control');
      await device.send('state', { state: 'H' });
      await device.send('control', { command: 'END' });
      await device.send('state', { state: 'E' });
      await until(() => device.count('control') > before);
      const answer = control();
      await device.send('state', { state: 'W' });
      return answer;
    }

    beforeAll(async () => {
      fx = await teamRelayFixture({ weapon: Weapon.EPEE });
      remote = new RemoteScoreServer(fx.db, 8066);
      broker = new MqttBroker({ host: '127.0.0.1' });
      const port = await broker.start(0);
      driver = new Opp2PisteDriver(broker);
      driver.setPistes([{ piste: '2', arena: 2 }]);
      driver.start();
      hub = new PisteHub(driver, () => remote);
      hub.attach();
      remote.cyranoTeamHook = id => hub.onTeamArenaUpdate(id, remote);
      device = new Opp2Apparatus(port, '2');
      await device.start();
      await until(() => driver.findPiste('2')?.status === 'online');
      await device.send('state', { state: 'W' });
      remote.setTeamArenaMatch('2', fx.matchId, false);
      await until(() => device.relay() === 1 && device.last('match')?.type === 'T');
    });

    afterAll(async () => {
      device?.client.destroy();
      driver?.stop();
      await broker?.stop();
      fx?.db.close();
    });

    it('relais 1 à 3 : END → ACK, relais enregistré par le moteur (source opp2), relais suivant affiché', async () => {
      for (const [n, a, b] of [
        [1, 5, 3],
        [2, 10, 6],
        [3, 15, 9],
      ]) {
        expect(await end(a, b)).toBe('ACK');
        await until(() => device.relay() === n + 1);
      }
      expect(journal('RelayScoreRecorded').map(e => [e.source, e.payload])).toEqual([
        ['opp2', expect.objectContaining({ scoreA: 5, scoreB: 3 })],
        ['opp2', expect.objectContaining({ scoreA: 5, scoreB: 3 })],
        ['opp2', expect.objectContaining({ scoreA: 5, scoreB: 3 })],
      ]);
      expect(team()).toMatchObject({ currentBoutIndex: 3, liveScoreA: 0, liveScoreB: 0 });
    });

    it('PREV avant le début du relais 4 : relais 3 rouvert par reopenRelay, puis réenregistré', async () => {
      await device.score(15, 9);
      await device.send('control', { command: 'PREV' });
      await until(() => device.relay() === 3);
      expect(journal('RelayReopened')).toEqual([expect.objectContaining({ source: 'opp2' })]);
      expect(team()).toMatchObject({ currentBoutIndex: 2, liveScoreA: 5, liveScoreB: 3 });
      // Correction : relais 3 terminé à 14-9
      expect(await end(14, 9)).toBe('ACK');
      await until(() => device.relay() === 4);
      expect(fx.db.teams.getTeamMatch(fx.matchId)!.bouts[2]).toMatchObject({
        status: 'finished',
        scoreA: 4,
        scoreB: 3,
      });
    });

    it('END au-delà du palier du relais : NAK, rien d’enregistré', async () => {
      const recorded = journal('RelayScoreRecorded').length;
      // Relais 4 : palier 20 ; l'arène ignore le cumul, l'END est refusé
      await device.send('state', { state: 'F' });
      await device.score(21, 9);
      const before = device.count('control');
      await device.send('state', { state: 'H' });
      await device.send('control', { command: 'END' });
      await device.send('state', { state: 'E' });
      await until(() => device.count('control') > before);
      expect(control()).toBe('NAK');
      await device.send('state', { state: 'W' });
      expect(journal('RelayScoreRecorded')).toHaveLength(recorded);
      expect(team().currentBoutIndex).toBe(3);
    });

    it('relais 4 à 9 : rencontre terminée par le moteur, journal rejoué sans écart', async () => {
      for (const [a, b] of [
        [19, 13],
        [24, 17],
        [29, 21],
        [34, 25],
        [39, 29],
        [44, 33],
      ]) {
        expect(await end(a, b)).toBe('ACK');
      }
      await until(() => team().currentBoutIndex === -1);
      expect(fx.db.teams.getTeamMatch(fx.matchId)).toMatchObject({
        status: 'finished',
        winnerId: fx.teamAId,
      });
      expect(journal('RelayScoreRecorded')).toHaveLength(10);
      expect(journal('TeamMatchDecided')).toHaveLength(1);
      expect(fx.divergences()).toEqual([]);
    });
  }
);
