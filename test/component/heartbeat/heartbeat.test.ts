import net from "net";
import {once} from "events";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer} from "../../../src/commons/CtrlPacket";
import {buildHandshakeProof, CONTROL_PROTOCOL_V2} from "../../../src/commons/ProtocolV2";
import {HEARTBEAT_CAPABILITY, HeartbeatPolicyRegistry} from "../../../src/commons/Heartbeat";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import TTTServer from "../../../src/server/TTTServer";
import TTTClient from "../../../src/client/TTTClient";
import {ClientHandlerPool} from "../../../src/server/ClientHandlerPool";
import {DEFAULT_KEY, ServerOption} from "../../../src/types/TunnelingOption";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(60_000);

const POLICY = {intervalMs: 200, timeoutMs: 1000};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 연결은 그대로 두고 전달만 멈출 수 있는 TCP 프록시(반쯤 열린 연결 흉내). */
const startProxy = async (targetPort: number) => {
    let blackhole = false;
    const sockets = new Set<net.Socket>();
    const server = net.createServer((inbound) => {
        const outbound = net.connect(targetPort, "127.0.0.1");
        for(const socket of [inbound, outbound]) { sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket)); }
        inbound.on("data", (chunk) => { if(!blackhole) outbound.write(chunk); });
        outbound.on("data", (chunk) => { if(!blackhole) inbound.write(chunk); });
        inbound.on("close", () => outbound.destroy());
        outbound.on("close", () => inbound.destroy());
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {port: (server.address() as net.AddressInfo).port,
        /** 지금 열린 연결은 그대로 두고 전달만 멈춘다. 새 연결은 heal 뒤에야 정상 전달된다. */
        setBlackhole(value: boolean) { blackhole = value; if(!value) { sockets.forEach((s) => s.destroy()); } },
        close: () => new Promise<void>((resolve) => { sockets.forEach((s) => s.destroy()); server.close(() => resolve()); })};
};

/** 핸드셰이크만 하고 그 뒤로는 아무것도 보내지 않는 원시 v2 제어 클라이언트. */
const rawClient = async (port: number, capabilities: string[]) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.on("error", () => {});
    await once(socket, "connect");
    const streamer = new CtrlPacketStreamer();
    const received: CtrlPacket[] = [];
    socket.on("data", (chunk) => received.push(...streamer.readCtrlPacketList(chunk)));
    socket.write(CtrlPacket.createSyncCtrl().toBuffer());
    await waitFor(() => { if(!received.some((p) => p.cmd === CtrlCmd.SyncCtrlAck)) throw new Error("no sync ack"); return true; }, {timeoutMs: 5000, intervalMs: 20});
    const ack = received.find((p) => p.cmd === CtrlCmd.SyncCtrlAck)!;
    const meta = ack.syncCtrlAckMeta!;
    const controlID = meta.controlID ?? ack.ID;
    socket.write(CtrlPacket.createAckCtrl(ack.ID, "raw", "", {protocolVersion: CONTROL_PROTOCOL_V2, capabilities, controlID,
        clientId: "edge", displayName: "edge", proof: buildHandshakeProof("edge-secret", "edge", controlID, meta.challengeNonce)} as any).toBuffer());
    return {socket, received, serverCapabilities: meta.capabilities as string[],
        ping: () => socket.write(CtrlPacket.message(controlID, {type: "ping", payload: {}}).toBuffer())};
};

// #230 — 제어 연결 heartbeat
describe("control connection heartbeat (#230)", () => {
    let root: TestRoot;
    let server: TTTServer;
    let port: number;
    const cleanups: Array<() => unknown> = [];

    beforeEach(async () => {
        root = await createTestRoot("heartbeat");
        applyTestRoot(root.rootDir);
        HeartbeatPolicyRegistry.configure(POLICY);
        await CertificationStore.instance.load();
        port = await getFreePort();
        const option: ServerOption = {key: DEFAULT_KEY, adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true, port, tls: false,
            controlProtocolMode: "mixed", trustedClients: [{clientId: "edge", clientSecret: "edge-secret"}], tunnelingOptions: [], keepAlive: 0, globalMemCacheLimit: 128};
        if(!ServerOptionStore.instance.updateServerOption(option)) throw new Error("bad fixture");
        server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
    });
    afterEach(async () => {
        for(const cleanup of cleanups.splice(0).reverse()) await cleanup();
        jest.restoreAllMocks();
        await server.close();
        HeartbeatPolicyRegistry.reset();
        await cleanupTestRoot(root);
    });

    const poolIds = () => server.clientStatus().map((s) => s.id);
    const startClient = (clientPort: number) => {
        const client = TTTClient.create({host: "127.0.0.1", port: clientPort, tls: false, key: DEFAULT_KEY, name: "edge", clientId: "edge",
            clientSecret: "edge-secret", allowLegacyFallback: false, keepAlive: 0, globalMemCacheLimit: 128});
        cleanups.push(() => client.stop());
        client.start();
        return client;
    };

    test("REQ-3 the server advertises the heartbeat capability", async () => {
        const raw = await rawClient(port, [HEARTBEAT_CAPABILITY]);
        cleanups.push(() => raw.socket.destroy());
        expect(raw.serverCapabilities).toContain(HEARTBEAT_CAPABILITY);
    });

    test("REQ-1 a ping gets a pong", async () => {
        const raw = await rawClient(port, [HEARTBEAT_CAPABILITY]);
        cleanups.push(() => raw.socket.destroy());
        await waitFor(() => { if(poolIds().length !== 1) throw new Error("not registered"); return true; }, {timeoutMs: 5000, intervalMs: 20});
        raw.ping();
        await waitFor(() => {
            if(!raw.received.some((p) => p.cmd === CtrlCmd.Message && p.messageMetaResult.kind === "valid" && (p.messageMetaResult as any).value.type === "pong")) throw new Error("no pong");
            return true;
        }, {timeoutMs: 3000, intervalMs: 20});
    });

    test("REQ-2 the server drops a heartbeat client that goes silent, but REQ-3 keeps a silent client without the capability", async () => {
        const silentNew = await rawClient(port, [HEARTBEAT_CAPABILITY]);
        cleanups.push(() => silentNew.socket.destroy());
        await waitFor(() => { if(poolIds().length !== 1) throw new Error("not registered"); return true; }, {timeoutMs: 5000, intervalMs: 20});
        await waitFor(() => { if(poolIds().length !== 0) throw new Error("still registered"); return true; }, {timeoutMs: POLICY.timeoutMs * 4, intervalMs: 50});

        const silentOld = await rawClient(port, ["protocol-v2", "proof-of-possession", "client-identity"]);
        cleanups.push(() => silentOld.socket.destroy());
        await waitFor(() => { if(poolIds().length !== 1) throw new Error("not registered"); return true; }, {timeoutMs: 5000, intervalMs: 20});
        await sleep(POLICY.timeoutMs * 3);
        expect(poolIds()).toHaveLength(1);
    });

    test("REQ-1/4 a real client stays connected through pings without logging each ping", async () => {
        startClient(port);
        await waitFor(() => { if(poolIds().length !== 1) throw new Error("offline"); return true; }, {timeoutMs: 10_000, intervalMs: 50});
        const first = poolIds()[0];
        const lines: string[] = [];
        const log = jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
        await sleep(POLICY.timeoutMs * 4);
        log.mockRestore();
        expect(poolIds()).toEqual([first]);
        expect(lines.filter((line) => /ping|pong|cmd:\s*Message/.test(line))).toEqual([]);
    });

    test("REQ-2 a blackholed connection is detected by both sides and the client reconnects after it heals", async () => {
        const proxy = await startProxy(port);
        cleanups.push(() => proxy.close());
        startClient(proxy.port);
        await waitFor(() => { if(poolIds().length !== 1) throw new Error("offline"); return true; }, {timeoutMs: 10_000, intervalMs: 50});
        const first = poolIds()[0];

        proxy.setBlackhole(true);
        // 서버는 시간 초과 안에 그 클라이언트를 뺀다.
        await waitFor(() => { if(poolIds().includes(first)) throw new Error("server still has the client"); return true; }, {timeoutMs: POLICY.timeoutMs * 5, intervalMs: 50});
        proxy.setBlackhole(false);
        // 클라이언트도 끊김을 알아채고 다시 연결한다(재연결 간격 5초 포함).
        await waitFor(() => { const ids = poolIds(); if(ids.length !== 1 || ids[0] === first) throw new Error("not reconnected"); return true; }, {timeoutMs: 20_000, intervalMs: 100});
    });

    test("REQ-3 against a server without the capability the client sends no ping and does not time out", async () => {
        const original = CtrlPacket.createSyncCtrlAck;
        jest.spyOn(CtrlPacket, "createSyncCtrlAck").mockImplementation((id, meta) =>
            original.call(CtrlPacket, id, meta ? {...meta, capabilities: meta.capabilities.filter((c) => c !== HEARTBEAT_CAPABILITY)} : meta));
        // 구버전 서버에는 시간 초과 코드가 없다. 새 서버의 시간 초과 적용도 꺼서 같은 조건을 만든다.
        jest.spyOn(ClientHandlerPool.prototype, "supportsHeartbeat", "get").mockReturnValue(false);
        const message = jest.spyOn(CtrlPacket, "message");
        startClient(port);
        await waitFor(() => { if(poolIds().length !== 1) throw new Error("offline"); return true; }, {timeoutMs: 10_000, intervalMs: 50});
        const first = poolIds()[0];
        await sleep(POLICY.timeoutMs * 3);
        expect(message.mock.calls.filter(([, body]) => body.type === "ping")).toEqual([]);
        expect(poolIds()).toEqual([first]);
    });
});
