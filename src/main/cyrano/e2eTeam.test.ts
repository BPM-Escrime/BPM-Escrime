/**
 * Bout en bout Cyrano — relais FIE par équipes (#1829) : appareil simulé en UDP réel (boucle
 * locale, DISP `Type=T`) ↔ CyranoServer ↔ pilote Cyrano ↔ PisteHub ↔ RemoteScoreServer (arène
 * équipe `/equipe1`) ↔ commandes du moteur (docs/adr/0024, lot E4), base SQLite réelle.
 * Scénario : relais 1 → VALIDATE → ACK → relais 2 aux cumuls → remplaçant → VALIDATE →
 * relais 3 → PREV (relais 2 rouvert) → relais 2 à 9 → rencontre terminée, rejeu sans écart.
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
import { CyranoServer } from './server';
import { CyranoPisteDriver } from './driver';
import { PisteHub } from '../piste/pisteHub';
import { hasNodeSqlite } from '../../database/testing/nodeSqliteDatabase';
import { Weapon } from '../../shared/types';
import { teamRelayFixture, type TeamRelayFixture } from '../__tests__/teamRelayFixture';
// Appareil simulé (scripts/lib/cyranoDevice.js), testé ici car Vitest ne couvre que src/
const { CyranoDevice } = require('../../../scripts/lib/cyranoDevice.js');

const short = (id: string) => id.slice(0, 8);
const d = hasNodeSqlite ? describe : describe.skip;

async function until(cond: () => boolean, ms = 15000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('délai dépassé en attendant la trame UDP');
    await new Promise(r => setTimeout(r, 15));
  }
}

d(
  'Cyrano bout en bout : relais par équipes, UDP réel (#1829, ADR-0024 E4)',
  { timeout: 60_000 },
  () => {
    let fx: TeamRelayFixture;
    let cyrano: CyranoServer;
    let remote: RemoteScoreServer;
    let device: InstanceType<typeof CyranoDevice>;
    let hub: PisteHub;
    let acks = 0;
    let naks = 0;
    /**
     * DISP reçus par l'appareil. Après l'ACK d'un relais, le logiciel en envoie deux : celui du
     * relais suivant, puis un second en réponse à l'état « attente » que l'appareil émet à
     * l'ACK (il montre encore l'ancien relais). Les tests attendent les deux avant d'appuyer sur
     * une touche : le simulateur applique un DISP reçu en plein relais, qui effacerait la touche.
     */
    let disps = 0;
    const team = () => remote.teamArenaCtx.teamArenaState.get('1')!;
    const snap = () => device.snapshot();
    const bout = (n: number) => fx.db.teams.getTeamMatch(fx.matchId)!.bouts[n - 1];
    const journal = (type: string) =>
      fx.db.eventLog.getSince(fx.competitionId).filter(e => e.type === type);

    /** VALIDATE → ACK → relais suivant affiché (ou affichage vide en fin de rencontre) */
    async function validate(next: number | null): Promise<void> {
      const seen = disps;
      const acked = acks;
      device.command('validate');
      await until(() => acks > acked);
      if (next === null) await until(() => team().currentBoutIndex === -1 && disps > seen);
      else await until(() => disps >= seen + 2 && snap().relay === next && snap().state === 'W');
    }

    beforeAll(async () => {
      fx = await teamRelayFixture({ weapon: Weapon.EPEE });
      remote = new RemoteScoreServer(fx.db, 8066);
      cyrano = new CyranoServer({ host: '127.0.0.1', port: 0, helloIntervalMs: 60_000 });
      const serverPort = await cyrano.start(0);
      device = new CyranoDevice({ piste: '1', port: 0, serverPort, server: '127.0.0.1' });
      await device.start();
      device.sock.on('message', (buf: Buffer) => {
        if (buf.toString('latin1').includes('|DISP|')) disps++;
      });
      device.port = device.sock.address().port;
      cyrano.setPistes([{ piste: '1', ip: '127.0.0.1', port: device.port, arena: 1 }]);
      hub = new PisteHub(new CyranoPisteDriver(cyrano), () => remote);
      hub.attach();
      const sendAck = cyrano.sendAck.bind(cyrano);
      vi.spyOn(cyrano, 'sendAck').mockImplementation(p => (++acks, sendAck(p)));
      const sendNak = cyrano.sendNak.bind(cyrano);
      vi.spyOn(cyrano, 'sendNak').mockImplementation(p => (++naks, sendNak(p)));
      remote.cyranoTeamHook = id => hub.onTeamArenaUpdate(id, remote);
      remote.setTeamArenaMatch('1', fx.matchId, false);
      await until(() => snap().team && snap().right.id === short(fx.relay(1)[0]));
    });

    afterAll(async () => {
      device?.stop();
      await cyrano?.stop();
      fx?.db.close();
    });

    it('DISP Type=T reçu par UDP : relais 1 (ordre FIE), tireurs du relais, nation = équipe', () => {
      expect(snap()).toMatchObject({
        team: true,
        relay: 1,
        state: 'W',
        general: { weapon: 'E' },
        right: { id: short(fx.relay(1)[0]), nat: 'PAR', score: 0 },
        left: { id: short(fx.relay(1)[1]), nat: 'ROM', score: 0 },
      });
    });

    it('relais 1 : touches de l’appareil → score du relais sur l’arène équipe, rien en base', async () => {
      device.command('begin');
      for (let i = 0; i < 5; i++) device.command('r+');
      device.command('l+');
      device.command('l+');
      await until(() => team().liveScoreA === 5 && team().liveScoreB === 2);
      expect(bout(1).status).toBe('not_started');
    });

    it('VALIDATE → ACK → relais enregistré par recordRelayScore, relais 2 affiché aux cumuls', async () => {
      await validate(2);
      expect(bout(1)).toMatchObject({ status: 'finished', scoreA: 5, scoreB: 2 });
      expect(journal('RelayScoreRecorded')).toEqual([
        expect.objectContaining({ source: 'cyrano' }),
      ]);
      expect(snap()).toMatchObject({
        right: { id: short(fx.relay(2)[0]), score: 5 },
        left: { id: short(fx.relay(2)[1]), score: 2 },
      });
    });

    it('relais 2 : BEGIN sans remise à zéro, remplaçant demandé (RESERVE), pas encore pris en compte', async () => {
      device.command('begin');
      device.command('resr');
      device.command('l+');
      await until(() => team().liveScoreB === 1);
      expect(team().liveScoreA).toBe(0);
      // Annulable pendant le relais (spéc. § 4) : rien n'est changé avant la fin du relais
      expect(journal('TeamFencerSubstituted')).toHaveLength(0);
    });

    it('VALIDATE → relais 3 ; remplaçant par substituteTeamFencer ; PREV → relais 2 rouvert', async () => {
      const out = fx.relay(2)[0]; // A1 : relais 2, 4 et 7 (ordre FIE)
      await validate(3);
      expect(journal('TeamFencerSubstituted')).toEqual([
        expect.objectContaining({
          source: 'cyrano',
          payload: expect.objectContaining({
            outFencerId: out,
            inFencerId: fx.A[3],
            relayIds: [fx.boutId(4), fx.boutId(7)],
          }),
        }),
      ]);
      expect(bout(2).fencerAId).toBe(out);
      expect(snap()).toMatchObject({ right: { score: 5 }, left: { score: 3 } });
      device.command('prev');
      await until(() => snap().relay === 2);
      expect(journal('RelayReopened')).toHaveLength(1);
      expect(bout(2).status).toBe('in_progress');
      expect(team()).toMatchObject({ currentBoutIndex: 1, liveScoreA: 0, liveScoreB: 1 });
      expect(snap()).toMatchObject({ right: { score: 5 }, left: { score: 3 } });
    });

    it('relais 2 réenregistré puis relais 3 à 9 : rencontre terminée, journal rejoué sans écart', async () => {
      device.command('begin');
      await validate(3);
      for (let n = 3; n <= 9; n++) {
        device.command('begin');
        for (let i = 0; i < 5; i++) device.command('r+');
        await until(() => team().liveScoreA === 5);
        await validate(n < 9 ? n + 1 : null);
      }
      expect(naks).toBe(0);
      expect(fx.db.teams.getTeamMatch(fx.matchId)).toMatchObject({
        status: 'finished',
        winnerId: fx.teamAId,
      });
      expect(journal('TeamMatchDecided')).toHaveLength(1);
      // Le remplaçant a tiré les relais 4 et 7
      expect(bout(4).fencerAId).toBe(fx.A[3]);
      expect(fx.divergences()).toEqual([]);
    });
  }
);
