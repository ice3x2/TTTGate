import http from 'node:http';
import tls from 'node:tls';
import net from 'node:net';
import fs from 'node:fs';
import {createTunnelHarness} from '../../helpers/tunnelHarness';
import * as runtime from '../../helpers/runtime';
import * as network from '../../helpers/network';
import {createHttpEndpoint} from '../../fixtures/http-tls-endpoint';
import {SocketHandler} from '../../../src/util/SocketHandler';
import {TCPServer} from '../../../src/util/TCPServer';
import {until} from '../../component/server/legacy-handler-id-fixture';

jest.setTimeout(30_000);
const httpSpec = {clientId: 'http-owner', clientSecret: 'owned-http-secret',
    tunnelingOptionOverride: {protocol: 'http', httpOption: {rewriteHostInTextBody: true}}};
const tcpSpec = {clientId: 'tcp-owner', clientSecret: 'owned-tcp-secret'};
const binary = Buffer.from([0, 255, 17, 128, 65, 0, 66]);

function request(port: number, agent: http.Agent, path: string, host: string, payload = Buffer.alloc(0), observeSocket?: (socket: net.Socket) => void) {
    let socket: unknown;
    const result = new Promise<{body: Buffer; complete: boolean; status: number; headers: http.IncomingHttpHeaders; socket: unknown}>((resolve, reject) => {
        const req = http.request({host: '127.0.0.1', port, agent, method: 'POST', path,
            headers: {Host: host, 'Content-Length': payload.length, 'X-Unchanged': 'public-one.example/internal'}}, res => {
            const chunks: Buffer[] = [];
            res.on('data', bytes => chunks.push(Buffer.from(bytes)));
            res.on('error', reject); res.on('aborted', () => reject(new Error('HTTP response aborted')));
            res.on('end', () => resolve({body: Buffer.concat(chunks), complete: res.complete, status: res.statusCode!, headers: res.headers, socket}));
        });
        req.on('socket', value => { socket = value; observeSocket?.(value); });
        req.on('error', reject);
        req.setTimeout(5000, () => req.destroy(new Error('Owned HTTP request deadline exceeded')));
        req.end(payload);
    });
    return result;
}

test.each([
    {serverOptionOverride: {tls: false}},
    ...['tls', 'ca', 'serverName', 'allowInsecureTls'].map(key => ({clients: [{...tcpSpec, clientOptionOverride: {[key]: key === 'tls' ? false : key === 'allowInsecureTls' ? true : 'conflict'}}]}))
])('trusted TLS rejects conflicting explicit fixture input before allocation %j', async conflict => {
    const create = jest.spyOn(runtime, 'createTestRoot'); let harness: any;
    try {
        await expect(createTunnelHarness({trustedControlTls: true, ...conflict} as any).then(value => { harness = value; return value; })).rejects.toThrow(/TLS|conflict/i);
        expect(create).not.toHaveBeenCalled();
    } finally { await harness?.dispose(); create.mockRestore(); }
});

test('custom endpoint is owned and echo misuse rejects before a connection', async () => {
    let endpoint: Awaited<ReturnType<typeof createHttpEndpoint>> | undefined;
    let calls = 0;
    const harness = await createTunnelHarness({clients: [{...httpSpec, endpointFactory: async () => {
        calls++; endpoint = await createHttpEndpoint((_req, _body, res) => res.end('unexpected')); return endpoint;
    }}]} as any);
    const send = jest.spyOn(network, 'sendTcpAndReceiveOnce');
    try {
        expect(calls).toBe(1);
        expect(harness.clients[0].endpointPort).toBe(endpoint!.port);
        await expect(harness.sendAndReceive('not-an-HTTP-request')).rejects.toThrow(/custom|endpoint/i);
        expect(send).not.toHaveBeenCalled();
    } finally { send.mockRestore(); await harness.dispose(); await endpoint?.close(); }
    expect(endpoint!.server.listening).toBe(false);
});

test('later custom endpoint factory failure closes the earlier real owned endpoint', async () => {
    let endpoint: Awaited<ReturnType<typeof createHttpEndpoint>> | undefined, harness: any;
    const fault = new Error('owned-second-endpoint-factory');
    const roots: string[] = [], create = runtime.createTestRoot;
    const spy = jest.spyOn(runtime, 'createTestRoot').mockImplementation(async (...args) => {
        const root = await create(...args); roots.push(root.rootDir); return root;
    });
    try {
        await expect(createTunnelHarness({clients: [{...httpSpec, endpointFactory: async () => {
            endpoint = await createHttpEndpoint((_req, _body, res) => res.end('unused')); return endpoint;
        }}, {...tcpSpec, endpointFactory: async () => { throw fault; }}]} as any).then(value => { harness = value; return value; })).rejects.toBe(fault);
        expect(endpoint!.server.listening).toBe(false);
        expect(roots.every(root => !fs.existsSync(root))).toBe(true);
    } finally { spy.mockRestore(); await harness?.dispose(); await endpoint?.close(); }
});

test.each([false, true])('full HTTP CL/chunked contexts overlap TCP owner with trusted tunnel TLS=%s', async encrypted => {
    const observed: Array<{handler: SocketHandler; secure: number; authorized: boolean; localPort?: number}> = [];
    const serverSecurePorts = new Set<number>();
    const connect = SocketHandler.connect, create = TCPServer.create;
    // Delegating observation of actual returned sockets; no socket factory result is replaced.
    SocketHandler.connect = (options, callback) => {
        const handler = connect(options, callback);
        if(options.tls) {
            const record: typeof observed[number] = {handler, secure: 0, authorized: false}; observed.push(record);
            (handler.socket as tls.TLSSocket).on('secureConnect', () => {
                record.secure++; record.authorized = (handler.socket as tls.TLSSocket).authorized;
                record.localPort = handler.socket.localPort;
            });
        }
        return handler;
    };
    TCPServer.create = options => {
        const server = create(options);
        if(options.tls) (server as any)._server.on('secureConnection', (socket: tls.TLSSocket) => serverSecurePorts.add(socket.remotePort!));
        return server;
    };
    const records: Array<{path: string; method: string; host: string; unchanged: string; body: string}> = [];
    let release: (() => void) | undefined, endpoint: Awaited<ReturnType<typeof createHttpEndpoint>> | undefined, harness: any;
    const agent = new http.Agent({keepAlive: true});
    try {
        harness = await createTunnelHarness({trustedControlTls: encrypted, clients: [{...httpSpec, endpointFactory: async () => {
            endpoint = await createHttpEndpoint((req, body, res) => {
                records.push({path: req.url!, method: req.method!, host: req.headers.host!, unchanged: String(req.headers['x-unchanged']), body: body.toString()});
                const data = Buffer.from(`http://127.0.0.1${req.url}`);
                res.setHeader('Content-Type', 'text/plain; charset=UTF-8'); res.setHeader('X-Reply', 'unchanged');
                if(req.url === '/one') { res.setHeader('Content-Length', data.length); release = () => res.end(data); }
                else { res.write(data.subarray(0, 8)); res.end(data.subarray(8)); }
            }); return endpoint;
        }}, tcpSpec]} as any);
        expect(endpoint).toBeDefined(); // Real endpoint capability must exist before issuing protocol traffic.
        await harness.start();
        const port = harness.clients[0].forwardPort;
        let firstDone = false;
        const first = request(port, agent, '/one', 'public-one.example', Buffer.from('request-one'));
        first.then(() => { firstDone = true; }, () => {});
        await until(() => !!release, 'HTTP request never reached its actual endpoint');
        expect(await harness.sendAndReceive(binary, 'tcp-owner')).toEqual(binary);
        expect(firstDone).toBe(false);
        release!(); const one = await first;
        expect(one).toMatchObject({body: Buffer.from('http://public-one.example/one'), complete: true, status: 200, headers: {'x-reply': 'unchanged'}});
        const two = await request(port, agent, '/two', 'public-two.example', Buffer.from('request-two'));
        expect(two).toMatchObject({body: Buffer.from('http://public-two.example/two'), complete: true, status: 200});
        expect(two.socket).toBe(one.socket);
        expect(records).toEqual(['/one', '/two'].map((path, i) => ({path, method: 'POST', host: '127.0.0.1', unchanged: 'public-one.example/internal', body: i ? 'request-two' : 'request-one'})));
        if(encrypted) {
            const control = observed.filter(record => (record.handler as any).sessionID === undefined);
            const data = observed.filter(record => (record.handler as any).sessionID !== undefined);
            process.stdout.write(`TLS47 native roles ${JSON.stringify(observed.map(record => ({role: (record.handler as any).sessionID === undefined ? 'control' : 'data', secure: record.secure,
                authorized: record.authorized, localPortAtSecure: record.localPort, localPortNow: record.handler.socket.localPort,
                matchingServerSecure: serverSecurePorts.has(record.localPort!)})))}\n`);
            expect(control).toHaveLength(2); expect(data.length).toBeGreaterThanOrEqual(2);
            for(const record of observed) {
                expect(record.secure).toBe(1); expect(record.authorized).toBe(true);
                expect(serverSecurePorts.has(record.localPort!)).toBe(true);
            }
            const negative = tls.connect({host: '127.0.0.1', port: harness.serverPort,
                ca: (await import('../../../src/server/CertificationStore')).CertificationStore.instance.getTempCert().cert.value,
                servername: 'wrong-owned-name.example', rejectUnauthorized: true});
            let secure = 0, bytes = 0;
            negative.on('secureConnect', () => secure++); negative.on('data', data => bytes += data.length);
            try {
                const failure = await new Promise<NodeJS.ErrnoException>(resolve => negative.once('error', resolve));
                expect(failure.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID'); expect(secure).toBe(0); expect(bytes).toBe(0); expect(negative.authorized).toBe(false);
            } finally { negative.destroy(); }
            expect(await harness.sendAndReceive(binary, 'tcp-owner')).toEqual(binary);
        } else expect(observed).toHaveLength(0);
    } finally {
        agent.destroy();
        try { await harness?.dispose(); await endpoint?.close(); }
        finally { SocketHandler.connect = connect; TCPServer.create = create; }
    }
});

test('actual server restart terminates in-flight HTTP once then scheduled TLS owners serve a new request', async () => {
    let endpoint: Awaited<ReturnType<typeof createHttpEndpoint>> | undefined, harness: any;
    const paths: string[] = [];
    const oldAgent = new http.Agent({keepAlive: true}), newAgent = new http.Agent({keepAlive: true});
    try {
        harness = await createTunnelHarness({trustedControlTls: true, clients: [{...httpSpec, endpointFactory: async () => {
            endpoint = await createHttpEndpoint((req, _body, res) => {
                paths.push(req.url!);
                if(req.url === '/inflight') return;
                const body = Buffer.from('http://127.0.0.1/fresh');
                res.writeHead(200, {'Content-Type': 'text/plain', 'Content-Length': body.length}); res.end(body);
            }); return endpoint;
        }}, tcpSpec]} as any);
        expect(endpoint).toBeDefined();
        await harness.start();
        const port = harness.clients[0].forwardPort;
        let oldClosed = false;
        const old = request(port, oldAgent, '/inflight', 'restart.example', Buffer.alloc(0), socket => socket.once('close', () => { oldClosed = true; }))
            .then(() => ({completed: true, error: ''}), error => ({completed: false, error: String(error)}));
        await until(() => paths.includes('/inflight'), 'In-flight HTTP never reached endpoint');
        await harness.restartServer();
        await until(() => oldClosed, 'Restart did not close actual in-flight HTTP socket');
        const outcome = await old;
        expect(outcome.completed).toBe(false);
        expect(outcome.error).not.toContain('deadline');
        const fresh = await request(port, newAgent, '/fresh', 'restart.example');
        expect(fresh).toMatchObject({body: Buffer.from('http://restart.example/fresh'), complete: true, status: 200});
        expect(paths).toEqual(['/inflight', '/fresh']);
        expect(await harness.sendAndReceive(binary, 'tcp-owner')).toEqual(binary);
    } finally { oldAgent.destroy(); newAgent.destroy(); await harness?.dispose(); await endpoint?.close(); }
});
