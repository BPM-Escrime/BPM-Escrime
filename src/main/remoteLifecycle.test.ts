import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
vi.mock('./remoteScoreServer', () => ({ RemoteScoreServer: class {} }));
vi.mock('./certManager', () => ({ ensureCert: vi.fn() }));

import { listNetworkInterfaces, reloadRemoteServer, remoteServerInfo } from './remoteLifecycle';
import { remoteServers, usedPorts } from './remoteRegistry';

describe('cycle de vie du serveur distant (#1341, #1981)', () => {
  beforeEach(() => {
    remoteServers.clear();
    usedPorts.clear();
  });

  it('serveur absent : pas d’adresse', () => {
    expect(remoteServerInfo('inconnu')).toBeUndefined();
  });

  it('listNetworkInterfaces propose toujours 0.0.0.0 en premier', () => {
    expect(listNetworkInterfaces()[0].address).toBe('0.0.0.0');
  });

  describe('reloadRemoteServer (rechargement à chaud)', () => {
    const fakeServer = (port: number) => {
      const s = {
        port,
        restart: vi.fn(async (p: number) => {
          s.port = p;
        }),
        getServerUrl: () => `http://10.0.0.1:${s.port}`,
        getLocalIPAddress: () => '10.0.0.1',
      };
      return s;
    };
    const register = (id: string, port: number) => {
      const server = fakeServer(port);
      remoteServers.set(id, { server: server as never, port, host: '0.0.0.0', useHttps: false });
      usedPorts.add(port);
      return server;
    };

    it('serveur absent', async () => {
      expect(await reloadRemoteServer('inconnu', { port: 9000 })).toEqual({
        success: false,
        error: 'remote_not_started',
      });
    });

    it('port invalide refusé sans redémarrage', async () => {
      const server = register('c1', 8066);
      const res = await reloadRemoteServer('c1', { port: 70000 });
      expect(res).toMatchObject({ success: false, error: 'port_invalid' });
      expect(server.restart).not.toHaveBeenCalled();
    });

    it('port d’un autre serveur refusé', async () => {
      register('c1', 8066);
      const server = register('c2', 8067);
      const res = await reloadRemoteServer('c2', { port: 8066 });
      expect(res).toMatchObject({ success: false, error: 'port_in_use', port: 8066 });
      expect(server.restart).not.toHaveBeenCalled();
    });

    it('change port et interface, met à jour le registre (même instance conservée)', async () => {
      const server = register('c1', 8066);
      const res = await reloadRemoteServer('c1', { port: 9000, host: '10.0.0.1' });
      expect(server.restart).toHaveBeenCalledWith(9000, '10.0.0.1', undefined);
      expect(res).toMatchObject({ success: true, serverInfo: { port: 9000, useHttps: false } });
      expect(remoteServers.get('c1')).toMatchObject({ server, port: 9000, host: '10.0.0.1' });
      expect(usedPorts.has(8066)).toBe(false);
      expect(usedPorts.has(9000)).toBe(true);
      expect(remoteServerInfo('c1')).toMatchObject({ port: 9000 });
    });

    it('échec du redémarrage : registre inchangé', async () => {
      const server = register('c1', 8066);
      server.restart.mockRejectedValueOnce(
        Object.assign(new Error('busy'), { code: 'EADDRINUSE' })
      );
      const res = await reloadRemoteServer('c1', { port: 9001 });
      expect(res).toMatchObject({ success: false, error: 'port_in_use', port: 9001 });
      expect(remoteServers.get('c1')?.port).toBe(8066);
      expect(usedPorts.has(8066)).toBe(true);
    });
  });
});
