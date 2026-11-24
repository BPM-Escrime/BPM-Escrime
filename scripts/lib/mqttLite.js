/**
 * Client MQTT 3.1.1 minimal pour les simulateurs (#1960) : CONNECT (dernière volonté,
 * identifiants), SUBSCRIBE, PUBLISH QoS 0 / 1 (PUBACK des messages reçus), PINGREQ.
 * Sans dépendance : les scripts tournent sous Node sans compilation. Le logiciel a son propre
 * client typé (src/main/opp2/mqttClient.ts).
 * Événements : `message` (topic, payload Buffer), `close`.
 * Licensed under GPL-3.0
 */
const net = require('net');
const tls = require('tls');
const { EventEmitter } = require('events');

const str = s => {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
};

function remainingLength(n) {
  const out = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return Buffer.from(out);
}

const packet = (header, body) =>
  Buffer.concat([Buffer.from([header]), remainingLength(body.length), body]);

class MqttLite extends EventEmitter {
  /**
   * @param {{host?: string, port?: number, clientId: string, username?: string, password?: string,
   *   tls?: boolean, rejectUnauthorized?: boolean, keepalive?: number,
   *   will?: {topic: string, payload: string, qos?: 0 | 1, retain?: boolean}}} opts
   */
  constructor(opts) {
    super();
    this.opts = opts;
    this.socket = null;
    this.buf = Buffer.alloc(0);
    this.nextId = 0;
    this.waiting = new Map();
    this.ping = null;
  }

  connect() {
    const o = this.opts;
    return new Promise((resolve, reject) => {
      const port = o.port ?? (o.tls ? 8883 : 1883);
      const host = o.host ?? '127.0.0.1';
      const socket = o.tls
        ? tls.connect({ port, host, rejectUnauthorized: o.rejectUnauthorized ?? false })
        : net.connect(port, host);
      this.socket = socket;
      let connacked = false;
      socket.on('error', err => {
        if (!connacked) reject(err);
      });
      socket.on('close', () => {
        if (this.ping) clearInterval(this.ping);
        this.ping = null;
        if (!connacked) reject(new Error('connexion fermée'));
        this.emit('close');
      });
      socket.on('data', chunk =>
        this.onData(chunk, code => {
          connacked = true;
          if (code !== 0) reject(new Error(`CONNACK ${code} (identifiants refusés ?)`));
          else resolve();
        })
      );
      socket.once(o.tls ? 'secureConnect' : 'connect', () => {
        const keepalive = o.keepalive ?? 30;
        let flags = 0x02; // session propre
        const payload = [str(o.clientId)];
        if (o.will) {
          flags |= 0x04 | ((o.will.qos ?? 1) << 3) | (o.will.retain ? 0x20 : 0);
          payload.push(str(o.will.topic), str(o.will.payload));
        }
        if (o.username !== undefined) {
          flags |= 0x80;
          payload.push(str(o.username));
          if (o.password !== undefined) {
            flags |= 0x40;
            payload.push(str(o.password));
          }
        }
        const ka = Buffer.alloc(2);
        ka.writeUInt16BE(keepalive);
        const vh = Buffer.concat([str('MQTT'), Buffer.from([4, flags]), ka]);
        socket.write(packet(0x10, Buffer.concat([vh, ...payload])));
        this.ping = setInterval(() => socket.write(Buffer.from([0xc0, 0])), (keepalive * 1000) / 2);
      });
    });
  }

  onData(chunk, onConnack) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      if (this.buf.length < 2) return;
      let mult = 1;
      let len = 0;
      let i = 1;
      let byte;
      do {
        if (i >= this.buf.length) return;
        byte = this.buf[i++];
        len += (byte & 0x7f) * mult;
        mult *= 128;
      } while (byte & 0x80);
      if (this.buf.length < i + len) return;
      const header = this.buf[0];
      const body = this.buf.subarray(i, i + len);
      this.buf = this.buf.subarray(i + len);
      this.handle(header, body, onConnack);
    }
  }

  handle(header, body, onConnack) {
    const type = header >> 4;
    if (type === 2) return onConnack(body[1]);
    if (type === 4 || type === 9) {
      const done = this.waiting.get(body.readUInt16BE(0));
      this.waiting.delete(body.readUInt16BE(0));
      return done?.();
    }
    if (type !== 3) return undefined;
    const qos = (header >> 1) & 3;
    const tlen = body.readUInt16BE(0);
    const topic = body.subarray(2, 2 + tlen).toString('utf8');
    let off = 2 + tlen;
    if (qos > 0) {
      const id = body.readUInt16BE(off);
      off += 2;
      const ack = Buffer.alloc(2);
      ack.writeUInt16BE(id);
      this.socket?.write(packet(0x40, ack));
    }
    this.emit('message', topic, body.subarray(off), (header & 1) === 1);
    return undefined;
  }

  id() {
    this.nextId = (this.nextId % 0xffff) + 1;
    return this.nextId;
  }

  subscribe(filter, qos = 1) {
    const id = this.id();
    const idb = Buffer.alloc(2);
    idb.writeUInt16BE(id);
    return new Promise(resolve => {
      this.waiting.set(id, resolve);
      this.socket?.write(packet(0x82, Buffer.concat([idb, str(filter), Buffer.from([qos])])));
    });
  }

  publish(topic, payload, { qos = 1, retain = false } = {}) {
    const parts = [str(topic)];
    let id = 0;
    if (qos > 0) {
      id = this.id();
      const idb = Buffer.alloc(2);
      idb.writeUInt16BE(id);
      parts.push(idb);
    }
    parts.push(Buffer.from(payload, 'utf8'));
    const header = 0x30 | (qos << 1) | (retain ? 1 : 0);
    if (!this.socket) return Promise.resolve();
    if (qos === 0) {
      this.socket.write(packet(header, Buffer.concat(parts)));
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.waiting.set(id, resolve);
      this.socket.write(packet(header, Buffer.concat(parts)));
    });
  }

  /** Départ annoncé : DISCONNECT, la dernière volonté n'est pas publiée */
  end() {
    this.socket?.end(Buffer.from([0xe0, 0]));
  }

  /** Coupure brutale (débranchement) : le broker publie la dernière volonté */
  destroy() {
    this.socket?.destroy();
  }
}

module.exports = { MqttLite };
