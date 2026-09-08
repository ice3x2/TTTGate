import {TTTClientRuntimeRegistry} from "../../src/client/TTTClientRuntime";
import TTTClient from "../../src/client/TTTClient";
import {SystemInfoProviderRegistry} from "../../src/commons/SystemInfoProvider";
import {CertificationStore} from "../../src/server/CertificationStore";
import ServerOptionStore from "../../src/server/ServerOptionStore";
import TTTServer from "../../src/server/TTTServer";
import {DEFAULT_KEY, ClientOption, ServerOption, TunnelingOption} from "../../src/types/TunnelingOption";
import {collectResourceStats, ResourceStats} from "./resourceStats";
import {EchoServer, getFreePort, sendTcpAndReceiveOnce, startEchoServer, sleep} from "./network";
import {applyTestRoot, cleanupTestRoot, createTestRoot} from "./runtime";

type HarnessClientSpec = {clientId: string; clientSecret: string; name?: string;
    clientOptionOverride?: Partial<ClientOption>; tunnelingOptionOverride?: Partial<TunnelingOption>};
type TunnelHarnessOptions = {
    clients?: HarnessClientSpec[];
    reconnectIntervalMs?: number;
    clientName?: string;
    serverOptionOverride?: Partial<ServerOption>;
    tunnelingOptionOverride?: Partial<TunnelingOption>;
    clientOptionOverride?: Partial<ClientOption>;
}

type TunnelHarness = {
    rootDir: string;
    serverPort: number;
    forwardPort: number;
    start(): Promise<void>;
    restartServer(): Promise<void>;
    clients: ReadonlyArray<{clientId: string; forwardPort: number; endpointPort: number}>;
    stopClient(clientId: string): Promise<void>;
    waitForClientOnline(expectedClientIds?: readonly string[]): Promise<void>;
    sendAndReceive(payload: Buffer | string, clientId?: string): Promise<Buffer>;
    collectResourceStats(): ResourceStats;
    shutdown(): Promise<void>;
    dispose(): Promise<void>;
    // P6-T1 개선 1회차 / REQ-09 E2E 테스트용 진단 접근자.
    getServer(): TTTServer | undefined;
}

const createTunnelHarness = async (options: TunnelHarnessOptions = {}): Promise<TunnelHarness> => {
    const explicit = options.clients !== undefined;
    const specs = options.clients ?? [{clientId: options.clientOptionOverride?.clientId ?? `${options.clientName ?? 'baseline-client'}-id`,
        clientSecret: options.clientOptionOverride?.clientSecret ?? 'test-client-secret', name: options.clientName ?? 'baseline-client',
        clientOptionOverride: options.clientOptionOverride, tunnelingOptionOverride: options.tunnelingOptionOverride}];
    if(explicit && (specs.length === 0 || new Set(specs.map(s => s.clientId)).size !== specs.length ||
        specs.some(s => !s.clientId?.trim() || !s.clientSecret?.trim()) || options.clientName !== undefined ||
        options.clientOptionOverride !== undefined || options.tunnelingOptionOverride !== undefined ||
        options.serverOptionOverride?.trustedClients !== undefined || options.serverOptionOverride?.tunnelingOptions !== undefined ||
        specs.some(s => ['clientId', 'clientSecret', 'name'].some(key => Object.prototype.hasOwnProperty.call(s.clientOptionOverride ?? {}, key)) ||
            ['allowedClientIds', 'allowedClientNames'].some(key => Object.prototype.hasOwnProperty.call(s.tunnelingOptionOverride ?? {}, key)))))
        throw new Error('Conflicting multi-client fixture configuration');
    const testRoot = await createTestRoot('tunnel-harness');
    type Owner = {spec: HarnessClientSpec; endpoint: EchoServer; option: TunnelingOption; client?: TTTClient; stopped: boolean; endpointClosed: boolean};
    const owners: Owner[] = [];
    let server: TTTServer | undefined, started = false, shutdown = false, disposed = false;
    const shutdownHarness = async (): Promise<void> => {
        if(shutdown) return;
        const failures: unknown[] = [];
        for(const owner of owners) {
            if(!owner.stopped) { owner.stopped = true; try { owner.client?.stop(); } catch(error) { failures.push(error); } }
        }
        try { await server?.close(); } catch(error) { failures.push(error); }
        for(const owner of owners) if(!owner.endpointClosed) {
            try { await owner.endpoint.close(); owner.endpointClosed = true; } catch(error) { failures.push(error); }
        }
        if(failures.length) throw new AggregateError(failures, 'Harness resource cleanup failed');
        shutdown = true;
    };
    const dispose = async (): Promise<void> => {
        if(disposed) return;
        try { await shutdownHarness(); } finally { await cleanupTestRoot(testRoot); }
        disposed = true;
    };
    try {
    applyTestRoot(testRoot.rootDir);
    TTTClientRuntimeRegistry.configure({reconnectIntervalMs: options.reconnectIntervalMs ?? 100});
    SystemInfoProviderRegistry.configure({
        async sysInfo() {
            return {
                osInfo: {
                    platform: "test",
                    release: "0",
                    type: "test",
                    hostname: "localhost"
                },
                ram: 0,
                cpuInfo: {
                    model: "test",
                    speed: 0,
                    cores: 1
                },
                network: {}
            };
        }
    });

    const serverPort = await getFreePort();
    for(const spec of specs) {
        const forwardPort = await getFreePort();
        const endpoint = await startEchoServer();
        const owner: Owner = {spec, endpoint, stopped: false, endpointClosed: false,
            option: {forwardPort, protocol: 'tcp', destinationAddress: '127.0.0.1', destinationPort: endpoint.port,
                tls: false, keepAlive: 0, allowedClientIds: [spec.clientId], ...spec.tunnelingOptionOverride}};
        owners.push(owner);
    }
    await CertificationStore.instance.load();
    const serverOption: ServerOption = {key: DEFAULT_KEY, adminPort: 9300, port: serverPort, tls: false, controlProtocolMode: 'mixed',
        trustedClients: owners.map(o => ({clientId: o.spec.clientId, clientSecret: o.spec.clientSecret, displayName: o.spec.name ?? o.spec.clientId})),
        tunnelingOptions: owners.map(o => o.option), keepAlive: 0, globalMemCacheLimit: 128, ...options.serverOptionOverride};
    if(!ServerOptionStore.instance.updateServerOption(serverOption)) throw new Error('Failed to update server option for tunnel harness');
    const find = (id: string): Owner => {
        const owner = owners.find(o => o.spec.clientId === id);
        if(!owner) throw new Error('Unknown client identity');
        return owner;
    };
    const waitUntil = async (condition: () => boolean): Promise<void> => {
        const deadline = Date.now() + 10_000;
        while(!condition()) { if(Date.now() >= deadline) throw new Error('Client readiness deadline exceeded'); await sleep(50); }
    };
    const waitForClientOnline = async (ids: readonly string[] = owners.filter(o => !o.stopped).map(o => o.spec.clientId)): Promise<void> => {
        for(const id of ids) if(find(id).stopped) throw new Error('Client is stopped');
        const expected = [...ids].sort();
        await waitUntil(() => {
            const actual = (server?.clientStatus() ?? []).map(s => s.clientId).sort();
            return actual.length === expected.length && actual.every((id, i) => id === expected[i]);
        });
    };
    const startServer = async () => { server = TTTServer.create(ServerOptionStore.instance.serverOption); await server.start(); };
    return {
        rootDir: testRoot.rootDir, serverPort, forwardPort: owners[0].option.forwardPort,
        get clients() { return owners.map(o => ({clientId: o.spec.clientId, forwardPort: o.option.forwardPort, endpointPort: o.option.destinationPort!})); },
        async start() {
            if(started) return;
            if(shutdown) throw new Error('Harness is stopped');
            try {
                await startServer();
                for(const owner of owners) {
                    owner.client = TTTClient.create({key: DEFAULT_KEY, host: '127.0.0.1', port: serverPort, tls: false,
                        name: owner.spec.name ?? owner.spec.clientId, clientId: owner.spec.clientId, clientSecret: owner.spec.clientSecret,
                        displayName: owner.spec.name ?? owner.spec.clientId, allowLegacyFallback: false, globalMemCacheLimit: 128,
                        keepAlive: 0, ...owner.spec.clientOptionOverride});
                    owner.client.start();
                }
                await waitForClientOnline(); started = true;
            } catch(error) { try { await dispose(); } catch(cleanup) { throw new AggregateError([error, cleanup], 'Harness startup and cleanup failed'); } throw error; }
        },
        async restartServer() {
            if(!started || shutdown) throw new Error('Harness is not started');
            try { await server?.close(); await startServer(); await waitForClientOnline(); }
            catch(error) { try { await dispose(); } catch(cleanup) { throw new AggregateError([error, cleanup], 'Harness restart and cleanup failed'); } throw error; }
        },
        waitForClientOnline,
        async stopClient(id: string) {
            const owner = find(id);
            if(owner.stopped) return;
            owner.stopped = true; owner.client?.stop();
            await waitUntil(() => !(server?.clientStatus() ?? []).some(s => s.clientId === id));
        },
        async sendAndReceive(payload: Buffer | string, id?: string) {
            if(id === undefined && owners.length !== 1) throw new Error('Client identity required for multi-client exchange');
            const owner = find(id ?? owners[0].spec.clientId);
            if(owner.stopped) throw new Error('Client is stopped');
            const expected = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
            owner.endpoint.setFiniteResponseLength(expected.length);
            const received = await sendTcpAndReceiveOnce({host: '127.0.0.1', port: owner.option.forwardPort, payload: expected, timeoutMs: 10_000});
            if(!received.equals(expected)) throw new Error('Echo payload mismatch');
            return received;
        },
        collectResourceStats, shutdown: shutdownHarness, dispose, getServer: () => server
    };
    } catch(error) { try { await dispose(); } catch(cleanup) { throw new AggregateError([error, cleanup], 'Harness creation and cleanup failed'); } throw error; }
};

export {createTunnelHarness, TunnelHarness, TunnelHarnessOptions, HarnessClientSpec};
