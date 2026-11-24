/**
 * Appareil de piste OPP2 simulé (JSON sur MQTT, #1960). Même appareil que le simulateur Cyrano
 * (scripts/lib/cyranoDevice.js : chrono, score, cartons, états W / H / F / P / E, mêmes
 * commandes), autre transport : messages `openpiste/{piste}/apparatus/*` publiés sur le broker,
 * `software/*` reçus. Spécification : https://github.com/OpenPiste/protocols (docs/level2.md).
 * - `apparatus/connection` retenu, dernière volonté `{"online":false}` (débranchement : `unplug`) ;
 * - `state`, `score`, `lights`, `uw2f`, `medical` (QoS 1, retenus), `clock` (QoS 0, retenu) ;
 * - `control` NEXT / PREV / END / RESERVE ; `fencers` à l'inversion ⟷ et à chaque match reçu ;
 * - reçus : `software/fencers` + `match` (match chargé en W), `score` / `clock` / `uw2f`
 *   (reprise ou correction), `control` ACK / NAK, `record` (créneau), `connection`.
 * Licensed under GPL-3.0
 */
const { CyranoDevice, emptyFencer, fmtWatch } = require('./cyranoDevice');
const { MqttLite } = require('./mqttLite');

const ROOT = 'openpiste';
const SIDES = ['right', 'left'];

class Opp2Device extends CyranoDevice {
  /**
   * @param {{piste?: string, broker?: string, brokerPort?: number, username?: string,
   *   password?: string, tls?: boolean}} opts
   */
  constructor(opts = {}) {
    super({ piste: opts.piste, port: opts.brokerPort ?? (opts.tls ? 8883 : 1883) });
    this.protocol = 'OPP2';
    this.broker = opts.broker ?? '127.0.0.1';
    this.server = this.broker;
    this.serverPort = this.port;
    this.bind = undefined;
    this.credentials = { username: opts.username, password: opts.password, tls: !!opts.tls };
    this.client = null;
    this.seq = 0;
    /** Dernier corps publié par message : rien n'est republié à l'identique */
    this.published = new Map();
    /** `software/fencers` reçu, en attente de `software/match` */
    this.pendingFencers = null;
    this.medicalSeen = { right: 0, left: 0 };
    this.slot = null;
  }

  topic(role, message) {
    return `${ROOT}/${this.piste}/${role}/${message}`;
  }

  async start() {
    this.client = new MqttLite({
      host: this.broker,
      port: this.port,
      clientId: `apparatus-${this.piste}-${process.pid}`,
      username: this.credentials.username,
      password: this.credentials.password,
      tls: this.credentials.tls,
      will: {
        topic: this.topic('apparatus', 'connection'),
        payload: '{"online":false}',
        qos: 1,
        retain: true,
      },
    });
    this.client.on('message', (topic, payload) => this.receive(topic, payload));
    this.client.on('close', () => this.note('broker : connexion fermée'));
    await this.client.connect();
    await this.client.subscribe(`${ROOT}/${this.piste}/software/#`);
    this.publish('connection', {
      online: true,
      device: 'BPM-Escrime simulateur',
      fw_version: '1.0',
    });
    this.published.clear();
    this.sendInfo();
  }

  /** Arrêt propre : départ annoncé (retenu), sans dernière volonté */
  stop() {
    this.stopTimer();
    if (!this.client) return;
    this.publish('connection', { online: false });
    this.client.end();
    this.client = null;
  }

  /** Débranchement : coupure brute, le broker publie la dernière volonté */
  unplug() {
    this.stopTimer();
    this.client?.destroy();
    this.client = null;
  }

  publish(message, body, { qos = 1, retain = message !== 'control' } = {}) {
    if (!this.client) return;
    const header = { protocol: 'OPP2', version: '1.0' };
    if (qos === 1) header.seq = ++this.seq;
    header.ts = Date.now();
    const payload = JSON.stringify({ ...header, ...body });
    this.client.publish(this.topic('apparatus', message), payload, { qos, retain });
    this.emit('log', { dir: 'out', text: `${message} ${JSON.stringify(body)}` });
  }

  /** Publie le message seulement s'il a changé */
  publishIfChanged(message, body, opts) {
    const key = JSON.stringify(body);
    if (this.published.get(message) === key) return;
    this.published.set(message, key);
    this.publish(message, body, opts);
  }

  // ── Appareil → logiciel ──────────────────────────────────────────────────────

  /** État complet : chaque message publié s'il a changé (l'appareil publie par morceaux) */
  sendInfo() {
    const { s } = this;
    this.publishIfChanged('state', { state: s.state });
    const scoreSide = f => ({
      score: f.score,
      status: f.status === 'A' || f.status === 'E' ? f.status : 'U',
      yellow_card: f.y > 0,
      red_cards: f.r,
      black_card: f.status === 'E',
    });
    this.publishIfChanged('score', {
      right: scoreSide(s.right),
      left: scoreSide(s.left),
      priority: s.priority,
    });
    this.publishIfChanged(
      'clock',
      {
        running: s.state === 'F' || s.state === 'P',
        time_ms: s.stopwatchMs,
        time: fmtWatch(s.stopwatchMs),
      },
      { qos: 0, retain: true }
    );
    this.publishIfChanged('lights', {
      right: { green: !!s.right.light, white: !!s.right.white },
      left: { red: !!s.left.light, white: !!s.left.white },
    });
    this.publishIfChanged('uw2f', {
      time_ms: 0,
      time: '0:00',
      right: { p_card: s.right.p },
      left: { p_card: s.left.p },
    });
    for (const side of SIDES) {
      const n = s[side].medical;
      if (n > this.medicalSeen[side]) {
        // Intervention accordée puis close : le logiciel compte les débuts
        this.publish('medical', {
          active: true,
          side,
          duration_ms: 300000,
          remaining_ms: 300000,
          remaining: '5:00',
        });
        this.publish('medical', { active: false, side });
      }
      this.medicalSeen[side] = n;
    }
    this.emit('change');
  }

  sendCmd(cmd) {
    this.publish('control', { command: cmd });
  }

  /** Tireurs affichés (`apparatus/fencers`, retenu) : écho d'un match reçu, inversion ⟷ */
  sendFencers() {
    const { s } = this;
    const side = f => ({ fencer: { id: f.id, name: f.name, nation: f.nat } });
    this.publish('fencers', { right: side(s.right), left: side(s.left) });
  }

  command(name) {
    const before = { r: this.s.right.reserve, l: this.s.left.reserve, state: this.s.state };
    const ok = super.command(name);
    if (!ok || !this.client) return ok;
    const { s } = this;
    if ((name === 'end' || name === 'validate') && s.state === 'E' && before.state !== 'E')
      this.sendCmd('END');
    if (name === 'swap' && s.state !== 'W') this.sendFencers();
    if (name === 'resr' && s.right.reserve === 'R' && before.r !== 'R')
      this.publish('control', { command: 'RESERVE', side: 'right' });
    if (name === 'resl' && s.left.reserve === 'R' && before.l !== 'R')
      this.publish('control', { command: 'RESERVE', side: 'left' });
    if (name === 'raz') this.sendFencers();
    return ok;
  }

  // ── Logiciel → appareil ──────────────────────────────────────────────────────

  receive(topic, payload) {
    const parts = topic.split('/');
    if (parts.length !== 4 || parts[2] !== 'software') return;
    let msg;
    try {
      msg = JSON.parse(payload.toString('utf8'));
    } catch {
      return;
    }
    const message = parts[3];
    this.emit('log', { dir: 'in', text: `${message} ${payload.toString('utf8')}` });
    const { s } = this;
    switch (message) {
      case 'connection':
        return this.note(
          msg.online ? `logiciel en ligne (${msg.software ?? '?'})` : 'logiciel hors ligne'
        );
      case 'fencers': {
        const empty = !msg.right?.fencer?.id && !msg.left?.fencer?.id;
        if (s.state !== 'W') return this.note('tireurs ignorés (match en cours)');
        if (empty && !msg.right?.fencer?.name && !msg.left?.fencer?.name) {
          s.right = emptyFencer();
          s.left = emptyFencer();
          this.pendingFencers = null;
          this.note('aucun match disponible');
          this.sendFencers();
          return this.sendInfo();
        }
        this.pendingFencers = msg;
        return undefined;
      }
      case 'match':
        return this.installMatch(msg);
      case 'score':
        return this.applyScore(msg);
      case 'clock': {
        if (s.state === 'F') return undefined;
        const ms = Number.isInteger(msg.time_ms) ? msg.time_ms : null;
        if (ms !== null) s.stopwatchMs = ms;
        return this.sendInfo();
      }
      case 'uw2f':
        for (const side of SIDES)
          if (Number.isInteger(msg[side]?.p_card)) s[side].p = msg[side].p_card;
        return this.sendInfo();
      case 'control':
        if (msg.command === 'ACK') {
          this.note('fin de match acquittée (ACK)');
          if (s.state !== 'W') {
            s.state = 'W';
            this.sendInfo();
          }
        } else if (msg.command === 'NAK') {
          this.note('END refusé (NAK) : corriger puis VALIDATE');
          if (s.state === 'E') {
            s.state = 'H';
            this.sendInfo();
          }
        }
        return undefined;
      case 'record': {
        const done = (msg.bouts ?? []).filter(b => b.result).length;
        this.slot = {
          label: msg.label ?? '',
          bouts: (msg.bouts ?? []).length,
          done,
          active: msg.active_bout,
        };
        return this.note(
          `créneau ${msg.label ?? msg.slot_id} : ${done}/${this.slot.bouts} match(s) confirmé(s)` +
            (msg.active_bout ? `, match actif ${msg.active_bout}` : '')
        );
      }
      default:
        return undefined;
    }
  }

  /** `software/match` (après `software/fencers`) : match chargé, appareil en attente */
  installMatch(msg) {
    const { s } = this;
    if (s.state !== 'W') return this.note('match ignoré (match en cours)');
    const f = this.pendingFencers;
    this.pendingFencers = null;
    const fencer = z => ({
      ...emptyFencer(),
      id: z?.fencer?.id ?? '',
      name: z?.fencer?.name ?? '',
      nat: z?.fencer?.nation || z?.fencer?.club_abbr || '',
    });
    s.general = {
      phase: msg.phase ?? '',
      poulTab: msg.poule ?? '',
      match: msg.match ? String(msg.match) : '',
      round: String(msg.round ?? 1),
      time: msg.scheduled ?? '',
      type: msg.type === 'T' ? 'T' : 'I',
      weapon: msg.weapon || s.general.weapon,
    };
    s.compe = msg.competition ?? '';
    s.priority = 'N';
    s.stopwatchMs = s.periodMs;
    if (f) {
      s.right = fencer(f.right);
      s.left = fencer(f.left);
      const ref = f.common?.referee;
      s.ref = [ref?.id ?? '', ref?.name ?? '', ref?.nation ?? ''];
    }
    this.medicalSeen = { right: 0, left: 0 };
    if (!s.right.id)
      this.note(
        s.right.name ? `affichage : ${s.right.name} – ${s.left.name}` : 'aucun match disponible'
      );
    else if (this.isTeam())
      this.note(`relais ${s.general.round} : ${s.right.name} – ${s.left.name}`);
    else this.note(`match ${s.general.match} : ${s.right.name} – ${s.left.name}`);
    this.sendFencers();
    return this.sendInfo();
  }

  /** `software/score` : scores et cartons repris (match chargé) ou corrigés (match en cours) */
  applyScore(msg) {
    const { s } = this;
    for (const side of SIDES) {
      const z = msg[side];
      if (!z) continue;
      const f = s[side];
      if (Number.isInteger(z.score)) f.score = z.score;
      f.y = z.yellow_card ? 1 : 0;
      if (Number.isInteger(z.red_cards)) f.r = z.red_cards;
      if (z.status === 'A' || z.status === 'E') f.status = z.status;
      else if (s.state === 'W') f.status = 'U';
    }
    if (s.state !== 'W') this.note(`scores corrigés : ${s.right.score} – ${s.left.score}`);
    return this.sendInfo();
  }

  snapshot() {
    return { ...super.snapshot(), bind: this.broker, slot: this.slot };
  }
}

module.exports = { Opp2Device };
