import net from "net";
import {once} from "events";
import TTTClient from "../../../src/client/TTTClient";
import {TTTClientRuntimeRegistry} from "../../../src/client/TTTClientRuntime";
import {DEFAULT_KEY, ServerOption} from "../../../src/types/TunnelingOption";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import TTTServer from "../../../src/server/TTTServer";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

// #255 — 제어 연결 접속과 SyncCtrlAck 대기에 기한을 둔다. 접속만 받고 답하지 않는 서버에 묶여 멈추지 않고 다시 연결한다.
jest.setTimeout(30_000);

/** 접속을 받기만 하고 아무것도 보내지 않는 서버. 받은 연결과 닫힌 연결 수를 센다. */
const startSilentServer = async () => {
    const sockets: net.Socket[] = [];
    let closed = 0;
    const server = net.createServer((socket) => {
        sockets.push(socket);
        socket.on("error", () => {});
        socket.on("close", () => { closed++; });
        // 받은 바이트는 읽고 버린다. 읽지 않으면 상대가 닫아도 'end'·'close' 가 오지 않는다.
        socket.resume();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
        port: (server.address() as net.AddressInfo).port,
        accepted: () => sockets.length,
        closed: () => closed,
        close: () => new Promise<void>((resolve) => { sockets.forEach((socket) => socket.destroy()); server.close(() => resolve()); })
    };
};

describe("control connection deadlines (#255)", () => {
    let root: TestRoot;
    let silent: Awaited<ReturnType<typeof startSilentServer>>;
    let client: TTTClient | undefined;

    beforeEach(async () => {
        root = await createTestRoot("control-deadline");
        applyTestRoot(root.rootDir);
        TTTClientRuntimeRegistry.configure({reconnectIntervalMs: 100, controlConnectTimeoutMs: 400, syncAckTimeoutMs: 400});
        silent = await startSilentServer();
    });
    afterEach(async () => {
        client?.stop();
        client = undefined;
        TTTClientRuntimeRegistry.reset();
        await silent.close();
        await cleanupTestRoot(root);
    });

    const start = (tls: boolean) => {
        client = TTTClient.create({host: "127.0.0.1", port: silent.port, tls, allowInsecureTls: true, key: DEFAULT_KEY, name: "edge",
            keepAlive: 0, globalMemCacheLimit: 128} as any);
        client.start();
    };

    // REQ-2 / AC-1 — 평문 연결은 접속 뒤 SyncCtrl 을 보내고 SyncCtrlAck 를 기다린다.
    test("a server that never answers SyncCtrl is dropped within the deadline and the client connects again", async () => {
        // 이 테스트는 SyncCtrlAck 기한만 본다. 접속 기한은 길게 두어 그것이 대신 연결을 닫지 않게 한다.
        TTTClientRuntimeRegistry.configure({controlConnectTimeoutMs: 10_000, syncAckTimeoutMs: 400});
        start(false);
        await waitFor(() => { if(silent.accepted() < 1) throw new Error("no connection"); return true; }, {timeoutMs: 5000, intervalMs: 20});
        await waitFor(() => { if(silent.closed() < 1 || silent.accepted() < 2) throw new Error("not reconnected"); return true; }, {timeoutMs: 5000, intervalMs: 20});
    });

    // REQ-1 / AC-1 — TLS 연결은 ServerHello 가 오지 않으면 접속이 끝나지 않는다(접속 단계에 머문다).
    test("a TLS connection that never completes is dropped within the deadline and the client connects again", async () => {
        TTTClientRuntimeRegistry.configure({controlConnectTimeoutMs: 400, syncAckTimeoutMs: 10_000});
        start(true);
        await waitFor(() => { if(silent.accepted() < 1) throw new Error("no connection"); return true; }, {timeoutMs: 5000, intervalMs: 20});
        await waitFor(() => { if(silent.closed() < 1 || silent.accepted() < 2) throw new Error("not reconnected"); return true; }, {timeoutMs: 5000, intervalMs: 20});
    });

    // REQ-3 — 핸드셰이크를 마친 정상 연결은 기한이 지나도 닫지 않는다.
    test("a completed handshake keeps the connection after the deadlines pass", async () => {
        await CertificationStore.instance.load();
        const port = await getFreePort();
        const option: ServerOption = {key: DEFAULT_KEY, adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true, port, tls: false,
            controlProtocolMode: "mixed", trustedClients: [{clientId: "edge", clientSecret: "edge-secret"}], tunnelingOptions: [], keepAlive: 0, globalMemCacheLimit: 128};
        if(!ServerOptionStore.instance.updateServerOption(option)) throw new Error("bad fixture");
        const server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
        try {
            TTTClientRuntimeRegistry.configure({controlConnectTimeoutMs: 300, syncAckTimeoutMs: 300});
            client = TTTClient.create({host: "127.0.0.1", port, tls: false, key: DEFAULT_KEY, name: "edge", clientId: "edge",
                clientSecret: "edge-secret", allowLegacyFallback: false, keepAlive: 0, globalMemCacheLimit: 128});
            client.start();
            const ids = () => server.clientStatus().map((status) => status.id);
            await waitFor(() => { if(ids().length !== 1) throw new Error("not connected"); return true; }, {timeoutMs: 5000, intervalMs: 20});
            const first = ids()[0];
            await new Promise((resolve) => setTimeout(resolve, 1200));
            expect(ids()).toEqual([first]);
        } finally {
            client?.stop();
            client = undefined;
            await server.close();
        }
    });

    // REQ-3 — 기한의 기본값은 30초다.
    test("the default deadlines are thirty seconds", () => {
        TTTClientRuntimeRegistry.reset();
        const runtime = TTTClientRuntimeRegistry.current();
        expect(runtime.controlConnectTimeoutMs).toBe(30_000);
        expect(runtime.syncAckTimeoutMs).toBe(30_000);
    });
});
