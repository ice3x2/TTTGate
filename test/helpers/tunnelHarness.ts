import {TTTClientRuntimeRegistry} from "../../src/client/TTTClientRuntime";
import TTTClient from "../../src/client/TTTClient";
import {SystemInfoProviderRegistry} from "../../src/commons/SystemInfoProvider";
import {CertificationStore} from "../../src/server/CertificationStore";
import ServerOptionStore from "../../src/server/ServerOptionStore";
import TTTServer from "../../src/server/TTTServer";
import {DEFAULT_KEY, ClientOption, ServerOption, TunnelingOption} from "../../src/types/TunnelingOption";
import {collectResourceStats, ResourceStats} from "./resourceStats";
import {EchoServer, getFreePort, sendTcpAndReceive, startEchoServer, waitFor} from "./network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "./runtime";

type TunnelHarnessOptions = {
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
    waitForClientOnline(): Promise<void>;
    sendAndReceive(payload: Buffer | string): Promise<Buffer>;
    collectResourceStats(): ResourceStats;
    shutdown(): Promise<void>;
    dispose(): Promise<void>;
    // P6-T1 개선 1회차 / REQ-09 E2E 테스트용 진단 접근자.
    getServer(): TTTServer | undefined;
}

const createTunnelHarness = async (options: TunnelHarnessOptions = {}): Promise<TunnelHarness> => {
    const testRoot = await createTestRoot("tunnel-harness");
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

    const echoServer = await startEchoServer();
    await CertificationStore.instance.load();

    const serverPort = await getFreePort();
    const forwardPort = await getFreePort();
    const clientId = options.clientOptionOverride?.clientId ?? `${options.clientName ?? "baseline-client"}-id`;
    const clientSecret = options.clientOptionOverride?.clientSecret ?? "test-client-secret";
    const tunnelOption: TunnelingOption = {
        forwardPort,
        protocol: "tcp",
        destinationAddress: "127.0.0.1",
        destinationPort: echoServer.port,
        tls: false,
        keepAlive: 0,
        allowedClientIds: [clientId],
        ...options.tunnelingOptionOverride
    };

    const serverOption: ServerOption = {
        key: DEFAULT_KEY,
        adminPort: 9300,
        port: serverPort,
        tls: false,
        controlProtocolMode: "mixed",
        trustedClients: [{
            clientId,
            clientSecret,
            displayName: options.clientName ?? "baseline-client"
        }],
        tunnelingOptions: [tunnelOption],
        keepAlive: 0,
        globalMemCacheLimit: 128,
        ...options.serverOptionOverride
    };

    if(!ServerOptionStore.instance.updateServerOption(serverOption)) {
        throw new Error("Failed to update server option for tunnel harness");
    }

    let server: TTTServer | undefined;
    let client: TTTClient | undefined;
    let started = false;
    let shutdown = false;

    const startServer = async (): Promise<void> => {
        server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
    };

    const startClient = (): void => {
        client = TTTClient.create({
            key: DEFAULT_KEY,
            host: "127.0.0.1",
            port: serverPort,
            tls: false,
            name: options.clientName ?? "baseline-client",
            clientId,
            clientSecret,
            displayName: options.clientName ?? "baseline-client",
            allowLegacyFallback: false,
            globalMemCacheLimit: 128,
            keepAlive: 0,
            ...options.clientOptionOverride
        });
        client.start();
    };

    const waitForClientOnline = async (): Promise<void> => {
        await waitFor(() => {
            const statuses = server?.clientStatus() ?? [];
            if(statuses.length !== 1) {
                throw new Error(`Expected 1 connected client, got ${statuses.length}`);
            }
            return statuses[0];
        }, {timeoutMs: 10000, intervalMs: 50});
    };

    const shutdownHarness = async (): Promise<void> => {
        if(shutdown) {
            return;
        }
        shutdown = true;
        client?.stop();
        await server?.close();
        await echoServer.close();
    };

    return {
        rootDir: testRoot.rootDir,
        serverPort,
        forwardPort,
        async start(): Promise<void> {
            if(started) {
                return;
            }
            await startServer();
            startClient();
            await waitForClientOnline();
            started = true;
        },
        async restartServer(): Promise<void> {
            if(!started) {
                throw new Error("Harness is not started");
            }
            await server?.close();
            await startServer();
            await waitForClientOnline();
        },
        async waitForClientOnline(): Promise<void> {
            await waitForClientOnline();
        },
        async sendAndReceive(payload: Buffer | string): Promise<Buffer> {
            const expected = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf-8");
            return await waitFor(async () => {
                const received = await sendTcpAndReceive(forwardPort, expected);
                if(!received.equals(expected)) {
                    throw new Error("Echo payload mismatch");
                }
                return received;
            }, {timeoutMs: 10000, intervalMs: 50});
        },
        collectResourceStats(): ResourceStats {
            return collectResourceStats();
        },
        async shutdown(): Promise<void> {
            await shutdownHarness();
        },
        async dispose(): Promise<void> {
            await shutdownHarness();
            await cleanupTestRoot(testRoot);
        },
        getServer(): TTTServer | undefined {
            return server;
        }
    };
};

export { createTunnelHarness, TunnelHarness, TunnelHarnessOptions };
