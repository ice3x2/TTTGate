import net from "net";
import {once} from "events";
import {withConfigurationServer} from "./configuration-revision-fixture";
import {addTunnel} from "./tunnel-admin-fixture";
import {startEchoServer, waitFor} from "../../../helpers/network";
import TTTClient from "../../../../src/client/TTTClient";
import TTTServer from "../../../../src/server/TTTServer";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";

// 이슈 389 — "서버 시작 시 꺼진 채로"(inactiveOnStartup)만 바꾼 저장은 리스너를 다시 띄우지 않는다.
// 저장한 값은 다음 기동에 쓰인다.
jest.setTimeout(60000);

const save = async (f: any, option: any) => {
    const response = await f.request("POST", "/api/tunnelingOption", {...option, expectedRevision: f.store.revisionState.currentRevision});
    expect(response.statusCode).toBe(200);
};

/** 열린 소켓으로 보내고 같은 바이트가 돌아올 때까지 기다린다. */
const roundTrip = async (socket: net.Socket, text: string): Promise<string> => {
    let received = "";
    const done = new Promise<string>((resolve, reject) => {
        const onData = (chunk: Buffer) => {
            received += chunk.toString();
            if(received.length >= text.length) { socket.off("data", onData); resolve(received); }
        };
        socket.on("data", onData);
        socket.once("close", () => reject(new Error("socket closed")));
    });
    socket.write(text);
    return done;
};

/** 켜진 터널에 터널 클라이언트를 붙이고, 그 터널을 지나는 연결 하나를 열어 둔다. */
const withLiveConnection = async (f: any, check: (port: number, option: any, socket: net.Socket) => Promise<void>) => {
    const echo = await startEchoServer();
    let client: TTTClient | undefined;
    let socket: net.Socket | undefined;
    try {
        const initial = await f.snapshot();
        expect((await f.request("POST", "/api/trustedClients", {clientId: "startup-off", displayName: "startup-off",
            expectedRevision: initial.revisionState.currentRevision})).statusCode).toBe(201);
        const clientSecret = f.store.serverOption.trustedClients.find((value: any) => value.clientId === "startup-off").clientSecret;
        const {port, option} = await addTunnel(f, {destinationPort: echo.port});
        expect((await f.request("POST", `/api/tunneling/active/${port}`, {active: true, timeout: 600})).statusCode).toBe(200);
        client = TTTClient.create({host: "127.0.0.1", port: f.tunnel.tunnelServer.port, key: f.store.serverOption.key, tls: false,
            name: "startup-off", clientId: "startup-off", clientSecret, displayName: "startup-off", keepAlive: 0, globalMemCacheLimit: 128});
        client.start();
        await waitFor(() => { if(f.tunnel.clientStatus().length !== 1) throw new Error("client pending"); return true; }, {timeoutMs: 5000, intervalMs: 20});
        socket = net.connect(port, "127.0.0.1");
        await once(socket, "connect");
        expect(await roundTrip(socket, "before")).toBe("before");
        await check(port, option, socket);
    } finally {
        socket?.destroy();
        client?.stop();
        await echo.close();
    }
};

test("an inactiveOnStartup-only save keeps the listener, its activation and a live connection (AC-4)", async () => withConfigurationServer(async f => {
    await withLiveConnection(f, async (port, option, socket) => {
        let closed = false;
        socket.once("close", () => { closed = true; });
        const before = {...f.tunnel.externalServerStatus(port)};
        // 다시 띄우는 결함이 같은 밀리초에 숨지 않도록 시간을 조금 흘려보낸다.
        await new Promise((resolve) => setTimeout(resolve, 20));

        await save(f, {...option, inactiveOnStartup: true});

        const after = f.tunnel.externalServerStatus(port);
        expect(after.online).toBe(true);
        expect(after.active).toBe(true);
        expect(after.uptime).toBe(before.uptime);
        expect(after.activeStart).toBe(before.activeStart);
        expect(after.activeTimeout).toBe(before.activeTimeout);
        expect(after.requestedTimeout).toBe(before.requestedTimeout);
        expect(await roundTrip(socket, "after")).toBe("after");
        expect(closed).toBe(false);
        expect(f.store.getTunnelingOption(port).inactiveOnStartup).toBe(true);
        expect(f.tunnel.captureRuntimeState().external[port].option).toEqual(f.store.getTunnelingOption(port));
    });
}));

// FR-4 — 이름과 함께 바꿔도 다시 띄우지 않는다. 반대 방향(켜짐→꺼짐)도 같다.
test("an inactiveOnStartup change saved together with the name keeps the listener (FR-4)", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f, {inactiveOnStartup: true});
    expect(await f.tunnel.activeExternalPortServer(port, 600)).toBe(true);
    const before = {...f.tunnel.externalServerStatus(port)};
    await new Promise((resolve) => setTimeout(resolve, 20));

    await save(f, {...option, name: "office ssh", inactiveOnStartup: false});

    const after = f.tunnel.externalServerStatus(port);
    expect(after.uptime).toBe(before.uptime);
    expect(after.active).toBe(true);
    expect(after.activeStart).toBe(before.activeStart);
    expect(f.store.getTunnelingOption(port).inactiveOnStartup).toBe(false);
}));

// AC-5 — 그렇게 저장한 뒤 설정을 다시 읽어 서버를 띄우면 그 터널은 꺼진 채로 뜬다.
test("after an inactiveOnStartup-only save, a server started from the reloaded configuration starts the tunnel inactive (AC-5)", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f);
    expect(f.tunnel.externalServerStatus(port).active).toBe(true);
    await save(f, {...option, inactiveOnStartup: true});
    expect(f.tunnel.externalServerStatus(port).active).toBe(true);

    await f.tunnel.close();
    ServerOptionStore.resetForTest();
    const reloaded = ServerOptionStore.instance;
    expect(reloaded.getTunnelingOption(port)?.inactiveOnStartup).toBe(true);
    const restarted = TTTServer.create(reloaded.serverOption);
    try {
        await restarted.start();
        const status = restarted.externalServerStatus(port);
        expect(status.online).toBe(true);
        expect(status.active).toBe(false);
    } finally { await restarted.close(); }
}));
