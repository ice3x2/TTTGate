import net from "net";
import {ExternalPortServerPool} from "../../../src/server/ExternalPortServerPool";
import {AdmissionController} from "../../../src/server/security/AdmissionController";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

// 이슈 369 — 실제 소켓으로 연결 목록(연결 시각·주소·송수신)과 연결 하나 끊기, 켜진 시각(activatedAt)을 본다.
// 리눅스는 127.0.0.0/8 전체가 루프백이라 localAddress 로 원격 주소를 고를 수 있다.
jest.setTimeout(30_000);

const IP_A = "127.0.0.1";
const IP_B = "127.0.0.2";

describe("tunnel connections 실제 소켓 (이슈 369)", () => {
    let testRoot: TestRoot;
    let pool: ExternalPortServerPool;
    let forwardPort: number;
    let otherPort: number;
    const kept: net.Socket[] = [];
    const base = {destinationAddress: "127.0.0.1", destinationPort: 18080, keepAlive: 0};

    const hold = (port: number, from: string): net.Socket => {
        const socket = net.connect({host: "127.0.0.1", port, localAddress: from});
        socket.on("error", () => {});
        kept.push(socket);
        return socket;
    };
    const waitConnections = (port: number, count: number) => waitFor(() => {
        const got = pool.connections(port).length;
        if(got !== count) throw new Error(`waiting for ${count} connections, got ${got}`);
    }, {timeoutMs: 3000});
    const closed = (socket: net.Socket) => new Promise<void>((resolve) => { if(socket.destroyed) resolve(); else socket.once("close", () => resolve()); });

    beforeEach(async () => {
        testRoot = await createTestRoot("tunnel-connections-socket");
        applyTestRoot(testRoot.rootDir);
        AdmissionController.resetForTest();
        pool = ExternalPortServerPool.create([]);
        forwardPort = await getFreePort();
        otherPort = await getFreePort();
    });

    afterEach(async () => {
        kept.splice(0).forEach((socket) => socket.destroy());
        await pool.stopAll();
        AdmissionController.resetForTest();
        await cleanupTestRoot(testRoot);
    });

    it("FR-8·FR-9 연결 목록은 최근 연결부터 id·주소·포트·연결 시각·RX·TX 를 준다", async () => {
        await expect(pool.startServer({...base, forwardPort, protocol: "tcp" as const})).resolves.toBe(true);
        const before = Date.now();
        hold(forwardPort, IP_A);
        await waitConnections(forwardPort, 1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const second = hold(forwardPort, IP_B);
        await waitConnections(forwardPort, 2);
        second.write("hello");
        await waitFor(() => { if(pool.connections(forwardPort)[0].rx !== 5) throw new Error("rx not counted"); }, {timeoutMs: 3000});
        const list = pool.connections(forwardPort);
        expect(list.map((connection) => connection.remoteAddress)).toEqual([IP_B, IP_A]);
        for(const connection of list) {
            expect(typeof connection.id).toBe("number");
            expect(connection.remotePort).toBeGreaterThan(0);
            expect(connection.connectedAt).toBeGreaterThanOrEqual(before);
            expect(connection.tx).toBe(0);
        }
        expect(list[0].rx).toBe(5);
        expect(pool.connections(otherPort)).toEqual([]);
    });

    it("FR-10·AC-6 연결 하나를 끊으면 그 소켓만 닫히고, 끝난 id 는 gone, 다른 포트의 id 는 other-port 다", async () => {
        await expect(pool.startServer({...base, forwardPort, protocol: "tcp" as const})).resolves.toBe(true);
        await expect(pool.startServer({...base, forwardPort: otherPort, protocol: "tcp" as const})).resolves.toBe(true);
        const a = hold(forwardPort, IP_A);
        const b = hold(forwardPort, IP_B);
        hold(otherPort, IP_A);
        await waitConnections(forwardPort, 2);
        await waitConnections(otherPort, 1);
        const target = pool.connections(forwardPort).find((connection) => connection.remoteAddress === IP_A)!;
        await expect(pool.closeConnection(forwardPort, target.id)).resolves.toEqual({result: "closed", remoteAddress: IP_A});
        await closed(a);
        await waitConnections(forwardPort, 1);
        expect(b.destroyed).toBe(false);
        await expect(pool.closeConnection(forwardPort, target.id)).resolves.toEqual({result: "gone"});
        const foreign = pool.connections(otherPort)[0];
        await expect(pool.closeConnection(forwardPort, foreign.id)).resolves.toEqual({result: "other-port"});
        expect(pool.connections(otherPort)).toHaveLength(1);
    });

    it("FR-12·AC-8·AC-9 차단 판정에 걸리는 기존 연결만 끊고 끊은 수를 돌려준다", async () => {
        await expect(pool.startServer({...base, forwardPort, protocol: "tcp" as const})).resolves.toBe(true);
        await expect(pool.startServer({...base, forwardPort: otherPort, protocol: "tcp" as const})).resolves.toBe(true);
        const bHere = hold(forwardPort, IP_B);
        const aHere = hold(forwardPort, IP_A);
        const bThere = hold(otherPort, IP_B);
        await waitConnections(forwardPort, 2);
        await waitConnections(otherPort, 1);
        // "이 터널만" 차단: forwardPort 의 B 만 걸린다.
        const closedCount = await pool.closeBlockedSessions((port, ip) => port === forwardPort && ip === IP_B);
        expect(closedCount).toBe(1);
        await closed(bHere);
        expect(aHere.destroyed).toBe(false);
        expect(bThere.destroyed).toBe(false);
        // "모든 터널" 차단: 남은 B 도 끊긴다.
        expect(await pool.closeBlockedSessions((_port, ip) => ip === IP_B)).toBe(1);
        await closed(bThere);
    });

    it("이슈 369 결정 3 변경: activatedAt 은 꺼짐→켜짐일 때만 잡히고 켜 둘 시간을 바꿔도 그대로다", async () => {
        await expect(pool.startServer({...base, forwardPort, protocol: "tcp" as const, inactiveOnStartup: true})).resolves.toBe(true);
        expect(pool.getServerStatus(forwardPort).activatedAt).toBeUndefined();
        const turnedOn = Date.now();
        await pool.active(forwardPort, 600);
        const first = pool.getServerStatus(forwardPort).activatedAt!;
        expect(first).toBeGreaterThanOrEqual(turnedOn);
        await new Promise((resolve) => setTimeout(resolve, 15));
        await pool.active(forwardPort, 1200);
        expect(pool.getServerStatus(forwardPort).activatedAt).toBe(first);
        await pool.inactive(forwardPort);
        await new Promise((resolve) => setTimeout(resolve, 15));
        await pool.active(forwardPort, 0);
        expect(pool.getServerStatus(forwardPort).activatedAt!).toBeGreaterThan(first);
    });
});
