import net from 'node:net';
import LoggerFactory from '../../../src/util/logger/LoggerFactory';
import {once} from 'node:events';
import * as options from '../../../src/types/TunnelingOption';
import {TunnelClient} from '../../../src/client/TunnelClient';
import TTTClient from '../../../src/client/TTTClient';
import {__testInternals} from '../../../src/client/ClientApp';
import {TlsOptionsFactoryRegistry} from '../../../src/util/TlsOptionsFactory';
import {withLegacyIds, until} from '../server/legacy-handler-id-fixture';
import ServerOptionStore from '../../../src/server/ServerOptionStore';

jest.setTimeout(20_000);

test.each([undefined, 0, 23456, -1, NaN, 'bad'])('shared keepalive resolver preserves exact contract for %s', value => {
    const warnings: string[] = [];
    const resolve = (options as any).resolveClientKeepAlive;
    expect(typeof resolve).toBe('function');
    const invalid = value !== undefined && !(typeof value === 'number' && Number.isFinite(value) && value >= 0);
    expect(resolve(value, (message: string) => warnings.push(message))).toBe(value === 0 || value === 23456 ? value : 10000);
    expect(warnings.length).toBe(invalid ? 1 : 0);
});

test('direct constructor clones only keepalive without changing unrelated caller options', () => {
    const input = {host: '', port: -7, globalMemCacheLimit: 3, tls: false, keepAlive: undefined} as any;
    const client = TunnelClient.create(input) as any;
    expect(client._option).not.toBe(input);
    expect(client._option).toEqual({...input, keepAlive: 10000});
    expect(input.keepAlive).toBeUndefined();
});

describe.each(['direct', 'cli'] as const)('%s option path', mode => {
    test.each([undefined, 0, 23456, -1])('actual control/data native factory use same keepalive %s', async keepAlive => withLegacyIds(async f => {
        const port = f.server.tunnelServer.port;
        const original = TlsOptionsFactoryRegistry.current();
        const observed: Array<{input: any; native: any}> = [];
        TlsOptionsFactoryRegistry.configure({...original, createClientSocketOptions(input) {
            const native = original.createClientSocketOptions(input);
            if(input.host === '127.0.0.1' && input.port === port) observed.push({input: {...input}, native: {...native}});
            return native;
        }});
        const warn = console.warn; const warnings: string[] = [];
        console.warn = (...args: any[]) => { warnings.push(args.join(' ')); warn(...args); };
        const normalizationWarnings: string[] = [];
        const loggers = ['ClientApp', 'TunnelClient'].map(name => LoggerFactory.getLogger('client', name));
        const loggerWarnings = loggers.map(logger => logger.warn);
        loggers.forEach((logger, index) => { logger.warn = function(...args: any[]) {
            if(String(args[0]).includes('normalizationClientOption: keepAlive')) normalizationWarnings.push(String(args[0]));
            return loggerWarnings[index].apply(this, args);
        }; });
        let client: TTTClient | undefined, socket: net.Socket | undefined;
        try {
            const base = {host: '127.0.0.1', port, tls: false, key: options.DEFAULT_KEY, name: 'wide', clientId: 'wide', clientSecret: 'fixture-wide-secret', allowLegacyFallback: false, globalMemCacheLimit: 128};
            const input = mode === 'direct' ? {...base, keepAlive} : __testInternals.loadClientOption({addr: `127.0.0.1:${port}`, name: 'wide', clientId: 'wide', clientSecret: 'fixture-wide-secret', ...(keepAlive === undefined ? {} : {keepAlive: String(keepAlive)})});
            const before = {...input};
            client = TTTClient.create(input as any); client.start();
            await until(() => (client as any)._isOnline, 'Actual client did not authenticate');
            socket = net.createConnection({host: '127.0.0.1', port: ServerOptionStore.instance.serverOption.tunnelingOptions[1].forwardPort});
            socket.on('error', () => {}); const bytes: Buffer[] = []; socket.on('data', data => bytes.push(Buffer.from(data)));
            await once(socket, 'connect'); socket.write('keepalive-owned-echo');
            await until(() => Buffer.concat(bytes).toString() === 'keepalive-owned-echo', 'Actual data echo failed');
            expect(observed).toHaveLength(2);
            const expected = keepAlive === 0 || keepAlive === 23456 ? keepAlive : 10000;
            for(const item of observed) {
                expect(item.input.keepalive).toBe(expected);
                expect(item.native.keepAlive).toBe(expected > 0);
                expect(item.native.keepAliveInitialDelay).toBe(Math.max(expected, 500));
                expect(item.native.rejectUnauthorized).toBe(true);
            }
            expect(input).toEqual(before);
            expect(warnings.filter(message => message.includes('keepAlive is disabled'))).toHaveLength(0);
            expect(normalizationWarnings).toHaveLength(keepAlive === -1 ? 1 : 0);
        } finally { socket?.destroy(); client?.stop(); console.warn = warn; loggers.forEach((logger, index) => { logger.warn = loggerWarnings[index]; }); TlsOptionsFactoryRegistry.configure(original); }
    }));
});
