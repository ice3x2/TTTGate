import fs from "fs/promises";
import net from "net";
import path from "path";
import {once} from "events";
import {SocketHandler} from "../../../../src/util/SocketHandler";
import SocketState from "../../../../src/util/SocketState";
import {withConfigurationServer} from "./configuration-revision-fixture";

// #268 — 닫기 기한(정체 closeStallMs·FIN closeGraceMs)을 서버 설정으로 바꾸면 다시 시작하지 않고 이후 닫는 연결에 적용한다.
jest.setTimeout(60_000);

const deadlines = () => ({stall: SocketHandler.closeStallMs, grace: SocketHandler.closeGraceMs});

describe("server option close deadlines (#268)", () => {
    let previous: {stall: number, grace: number};
    beforeEach(() => { previous = deadlines(); });
    afterEach(() => { SocketHandler.closeStallMs = previous.stall; SocketHandler.closeGraceMs = previous.grace; });

    test.each(["PUT", "POST"])("%s /api/serverOption applies both deadlines at once (REQ-1·REQ-2)", async (method) => withConfigurationServer(async ({request, snapshot, store}) => {
        const read = await snapshot();
        expect(read.serverOption).toMatchObject({closeStallMs: 60_000, closeGraceMs: 10_000});
        const saved = await request(method, "/api/serverOption", {...read.serverOption, closeStallMs: 120_000, closeGraceMs: 3_000,
            expectedRevision: read.revisionState.currentRevision});
        expect(saved.statusCode).toBe(200);
        expect(store.serverOption).toMatchObject({closeStallMs: 120_000, closeGraceMs: 3_000});
        expect(deadlines()).toEqual({stall: 120_000, grace: 3_000});
    }));

    // AC-1 — 실행 중 closeGraceMs 를 바꾸면, 그 뒤 FIN 을 보내고 상대가 닫지 않는 연결은 새 기한에 강제로 닫힌다.
    test("a connection that sends FIN after the change is force-closed at the new grace (AC-1)", async () => withConfigurationServer(async ({request, snapshot}) => {
        const read = await snapshot();
        expect((await request("POST", "/api/serverOption", {...read.serverOption, closeGraceMs: 1_000,
            expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
        const server = net.createServer();
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        // FIN 을 받아도 답하지 않는 상대(allowHalfOpen).
        const client = net.connect({port: (server.address() as net.AddressInfo).port, host: "127.0.0.1", allowHalfOpen: true});
        client.on("error", () => {});
        client.on("end", () => {});
        const [serverSide] = await once(server, "connection") as [net.Socket];
        try {
            const events: SocketState[] = [];
            const handler = SocketHandler.bound({socket: serverSide, port: 0, addr: "127.0.0.1", tls: false, keepAlive: 0},
                (_handler, state) => { if(state !== SocketState.Receive) events.push(state); });
            const started = Date.now();
            handler.end_();
            await new Promise((resolve) => setTimeout(resolve, 300));
            expect(events).not.toContain(SocketState.Closed);
            // 기본값 10초였다면 이 기다림 안에 닫히지 않는다.
            const deadline = Date.now() + 6_000;
            while(!events.includes(SocketState.Closed) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
            expect(events).toContain(SocketState.Closed);
            expect(Date.now() - started).toBeGreaterThanOrEqual(900);
            expect(serverSide.destroyed).toBe(true);
        } finally {
            client.destroy();
            serverSide.destroy();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    }));

    test.each([
        ["closeStallMs", 999, "closeStallMs must be an integer within 1000..600000"],
        ["closeStallMs", 600_001, "closeStallMs must be an integer within 1000..600000"],
        ["closeGraceMs", 999, "closeGraceMs must be an integer within 1000..120000"],
        ["closeGraceMs", 120_001, "closeGraceMs must be an integer within 1000..120000"]
    ] as const)("%s %d is 400 and leaves server.yaml and the running deadlines unchanged (AC-2)", async (field, value, message) => withConfigurationServer(async ({request, snapshot, store, root}) => {
        const read = await snapshot();
        const file = path.join(root.rootDir, "config", "server.yaml");
        const before = await fs.readFile(file, "utf8");
        const running = deadlines();
        const rejected = await request("POST", "/api/serverOption", {...read.serverOption, [field]: value, expectedRevision: read.revisionState.currentRevision});
        expect(rejected.statusCode).toBe(400);
        expect(JSON.parse(rejected.body).message).toBe(message);
        expect(await fs.readFile(file, "utf8")).toBe(before);
        expect(store.revisionState.currentRevision).toBe(read.revisionState.currentRevision);
        expect(deadlines()).toEqual(running);
    }));

    // 적용 중 다른 범위가 실패해 저장을 되돌리면 기한도 이전 값으로 돌아가야 한다(#267 과 같은 경로).
    test("a save rolled back after a runtime apply failure also restores the running deadlines", async () => withConfigurationServer(async ({request, snapshot, store, tunnel}) => {
        const read = await snapshot();
        expect((await request("POST", "/api/serverOption", {...read.serverOption, closeStallMs: 90_000, closeGraceMs: 5_000,
            expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
        expect(deadlines()).toEqual({stall: 90_000, grace: 5_000});
        const baseline = await snapshot();
        const apply = tunnel.applyServerOption;
        let applied = 0;
        tunnel.applyServerOption = async (...args: any[]) => {
            await apply.apply(tunnel, args);
            applied++;
            return {success: false, partial: true, failedScopes: ["memory-limit"], restartRequiredScopes: [], warnings: []};
        };
        try {
            const failed = await request("POST", "/api/serverOption", {...baseline.serverOption, closeStallMs: 30_000, closeGraceMs: 2_000,
                expectedRevision: baseline.revisionState.currentRevision});
            expect(failed.statusCode).toBe(400);
            expect(applied).toBe(1);
            expect(store.serverOption).toMatchObject({closeStallMs: 90_000, closeGraceMs: 5_000});
            expect(deadlines()).toEqual({stall: 90_000, grace: 5_000});
        } finally { tunnel.applyServerOption = apply; }
    }));
});
