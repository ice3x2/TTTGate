import net from 'node:net';
import {once} from 'node:events';
import {withLegacyIds, until} from '../server/legacy-handler-id-fixture';
import TTTClient from '../../../src/client/TTTClient';
import ServerOptionStore from '../../../src/server/ServerOptionStore';
import {TTTClientRuntimeRegistry} from '../../../src/client/TTTClientRuntime';
import {DEFAULT_KEY} from '../../../src/types/TunnelingOption';

// Bounded reuse of the existing #45 real-client attachment; original reviewed test remains untouched.
export async function withClient(check: (h: any) => Promise<void>) {
    await withLegacyIds(async f => {
        TTTClientRuntimeRegistry.configure({reconnectIntervalMs: 100});
        const client = TTTClient.create({host: '127.0.0.1', port: f.server.tunnelServer.port, tls: false,
            key: DEFAULT_KEY, name: 'wide', clientId: 'wide', clientSecret: 'fixture-wide-secret',
            allowLegacyFallback: false, keepAlive: 0});
        const sockets: net.Socket[] = [];
        try {
            client.start();
            const tunnel = (client as any)._tunnelClient;
            await until(() => (client as any)._isOnline, 'Actual client did not authenticate');
            const sibling = await f.peer(); const siblingSession = await sibling.open(); await sibling.complete(siblingSession);
            const echo = async (marker: string) => {
                const port = ServerOptionStore.instance.serverOption.tunnelingOptions[1].forwardPort;
                const socket = net.createConnection({host: '127.0.0.1', port}); sockets.push(socket);
                socket.on('error', () => {}); await once(socket, 'connect');
                const data: Buffer[] = []; socket.on('data', bytes => data.push(bytes)); socket.write(marker);
                await until(() => Buffer.concat(data).toString() === marker, 'Actual wide endpoint echo failed');
                return socket;
            };
            await echo('before-framing');
            const pool = [...((f.server.tunnelServer as any)._clientHandlerPoolMap.values())].find((p: any) => !p.legacyMode) as any;
            f.server.tunnelServer.configureSessionTtl(60_000, 1000);
            await check({client, tunnel, pool, sibling, siblingSession, echo, sockets, server: f.server.tunnelServer});
        } finally { sockets.forEach(socket => socket.destroy()); client.stop(); }
    });
}
