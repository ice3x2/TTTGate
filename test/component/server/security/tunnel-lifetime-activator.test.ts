import fs from "node:fs/promises";
import path from "node:path";
import TTTServer from "../../../../src/server/TTTServer";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {AdmissionController} from "../../../../src/server/security/AdmissionController";
import {TunnelingOption} from "../../../../src/types/TunnelingOption";
import {serializeIdentityFixture} from "../../../helpers/identityFixture";
import {getFreePort} from "../../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

// 이슈 347 FR-14·FR-15 — 켤 때의 상한은 소유자 그룹 상한과 켠 사람 그룹 상한 중 짧은 값이다.
// 켠 사람은 활성 상태에 메모리로만 두고, 리스너를 다시 띄워도 이어받는다.
jest.setTimeout(30_000);

const HOUR_MS = 3_600_000;
const OWNER = "u_0000000000000a01";
const SHORT = "u_0000000000000a02";
const ADMIN = "u_0000000000000a03";

const quietSink: AuditSink = {reserve: () => true, record: () => Promise.resolve()};

describe("tunnel-lifetime-activator", () => {
    let testRoot: TestRoot;
    let server: TTTServer | undefined;
    let port: number;

    const status = () => server!.externalServerStatus(port);
    const stored = () => ServerOptionStore.instance.getTunnelingOption(port)!;
    const save = async (patch: Partial<TunnelingOption>) => {
        const previous = stored();
        expect(ServerOptionStore.instance.updateTunnelingOption({...previous, ...patch})).toBe(true);
        expect((await server!.applyTunnelingOption(stored(), previous)).success).toBe(true);
    };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

    beforeEach(async () => {
        testRoot = await createTestRoot("tunnel-lifetime-activator");
        applyTestRoot(testRoot.rootDir);
        await CertificationStore.instance.load();
        AdmissionController.resetForTest();
        // 소유자 그룹 상한 8시간, 켠 사람 그룹 상한 2시간(AC-7).
        const yaml = await serializeIdentityFixture({
            groups: [{id: "g_owner", name: "Owners", attributes: {max_tunnel_duration_ms: 8 * HOUR_MS}},
                {id: "g_short", name: "Operators", attributes: {tunnel_crud: "toggle", max_tunnel_duration_ms: 2 * HOUR_MS}}],
            users: [
                {id: OWNER, username: "owner", password: "owner-password-1234", role: "regular", groupId: "g_owner"},
                {id: SHORT, username: "operator", password: "operator-password-1234", role: "regular", groupId: "g_short"},
                {id: ADMIN, username: "admin", password: "admin-password-1234", role: "superuser"}
            ]
        });
        await fs.writeFile(path.join(testRoot.rootDir, "config", "identity.yaml"), yaml, "utf-8");
        IdentityStore.resetForTest();
        expect(IdentityStore.instance.load()).toEqual({success: true, source: "file"});

        port = await getFreePort();
        const store = ServerOptionStore.instance;
        // inactiveOnStartup 으로 둬 기동 때의 자동 활성(켠 사람 없음)과 섞이지 않게 한다.
        expect(store.updateServerOption({...store.serverOption, port: await getFreePort(), tunnelingOptions: [{
            forwardPort: port, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0,
            inactiveOnStartup: true, ownerId: OWNER, sharedUserIds: [SHORT]} as TunnelingOption]})).toBeTruthy();
        AuditSinkRegistry.set(quietSink);
        server = TTTServer.create(store.serverOption);
        await server.start();
    });

    afterEach(async () => {
        try {
            await server?.close();
        } finally {
            server = undefined;
            AuditSinkRegistry.reset();
            IdentityStore.resetForTest();
            AdmissionController.resetForTest();
            await cleanupTestRoot(testRoot);
        }
    });

    it("켠 사람 그룹 상한이 더 짧으면 그 값으로 켜지고, 슈퍼유저가 켜면 소유자 상한이다 (AC-7)", async () => {
        expect(await server!.activeExternalPortServer(port, 0, SHORT)).toBe(true);
        expect(status()).toMatchObject({active: true, activeTimeout: 2 * 3600, activatedBy: SHORT});
        expect(await server!.activeExternalPortServer(port, 0, ADMIN)).toBe(true);
        expect(status()).toMatchObject({active: true, activeTimeout: 8 * 3600, activatedBy: ADMIN});
    });

    it("켠 사람 그룹 상한을 줄이면 이미 켜진 터널의 상한도 줄고 시작 시각은 그대로다 (AC-7·FR-15)", async () => {
        expect(await server!.activeExternalPortServer(port, 0, SHORT)).toBe(true);
        const startedAt = status().activeStart;
        await tick();
        expect(IdentityStore.instance.updateGroup("g_short", {attributes: {max_tunnel_duration_ms: HOUR_MS}}).success).toBe(true);
        server!.reapplyActiveCaps();
        expect(status().activeTimeout).toBeLessThanOrEqual(3600);
        expect(status().activeStart).toBe(startedAt);
    });

    it("켠 사람이 공유에서 빠지면(켜기 권한 상실) 터널은 켜진 채 다음 재적용부터 소유자 상한만 쓴다 (FR-15)", async () => {
        expect(await server!.activeExternalPortServer(port, 0, SHORT)).toBe(true);
        expect(ServerOptionStore.instance.updateTunnelingOption({...stored(), sharedUserIds: []})).toBe(true);
        server!.reapplyActiveCaps();
        expect(status()).toMatchObject({active: true, activeTimeout: 8 * 3600});
    });

    it("소유자가 이름 말고 다른 설정을 바꿔 저장해도(리스너 재시작) 켠 사람의 상한이 남는다 (AC-13)", async () => {
        expect(await server!.activeExternalPortServer(port, 0, SHORT)).toBe(true);
        const before = {...status()};
        await tick();
        await save({destinationPort: 10});
        expect(status().uptime).toBeGreaterThan(before.uptime);
        expect(status()).toMatchObject({online: true, active: true, activeTimeout: 2 * 3600, activatedBy: SHORT, activeStart: before.activeStart});
    });

    it("적용 실패를 되돌릴 때도 켠 사람을 이어받는다 (FR-15, 실패 복원)", async () => {
        expect(await server!.activeExternalPortServer(port, 0, SHORT)).toBe(true);
        const runtime = server!.captureRuntimeState();
        await save({destinationPort: 10});
        expect(await server!.restoreRuntimeState(runtime)).toEqual([]);
        expect(status()).toMatchObject({online: true, active: true, activeTimeout: 2 * 3600, activatedBy: SHORT});
    });

    it("이미 켜진 터널을 다른 사람이 다시 켜면 그 사람이 새 켠 사람이다 (FR-15)", async () => {
        expect(await server!.activeExternalPortServer(port, 0, SHORT)).toBe(true);
        expect(await server!.activeExternalPortServer(port, 0, OWNER)).toBe(true);
        expect(status()).toMatchObject({activeTimeout: 8 * 3600, activatedBy: OWNER});
    });

    it("공유 목록만 바꿔 저장하면 리스너를 다시 시작하지 않는다 (FR-8·AC-6)", async () => {
        // 기동 때 넣은 설정은 저장 경로의 기본값 채우기를 거치지 않았다. 한 번 저장해 실행 중인 설정과 맞춘다.
        await save({});
        expect(await server!.activeExternalPortServer(port, 0, SHORT)).toBe(true);
        const before = {...status()};
        await tick();
        await save({sharedUserIds: [SHORT, ADMIN]});
        expect(status()).toMatchObject({online: true, active: true, uptime: before.uptime, activeStart: before.activeStart});
        expect(server!.captureRuntimeState().external[port].option).toEqual(stored());
    });

    it("새 터널을 바로 켜면 만든 사람이 켠 사람이다 (FR-15)", async () => {
        const created = await getFreePort();
        const option = {forwardPort: created, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0,
            inactiveOnStartup: false, ownerId: OWNER, sharedUserIds: [SHORT]} as TunnelingOption;
        expect(ServerOptionStore.instance.updateTunnelingOption(option)).toBe(true);
        expect((await server!.applyTunnelingOption(ServerOptionStore.instance.getTunnelingOption(created)!, undefined, undefined, undefined, SHORT)).success).toBe(true);
        expect(server!.externalServerStatus(created)).toMatchObject({active: true, activeTimeout: 2 * 3600, activatedBy: SHORT});
    });

    it("상태 목록에는 켠 사람을 싣지 않는다", async () => {
        expect(await server!.activeExternalPortServer(port, 0, SHORT)).toBe(true);
        const listed = server!.externalServerStatuses().find((entry) => entry.port === port)!;
        expect(listed.active).toBe(true);
        expect("activatedBy" in listed).toBe(false);
    });
    // 이슈 369 M1 — 켜진 시각(activatedAt)은 꺼짐→켜짐일 때만 잡힌다. 저장(리스너 재시작)·실패 복원·기동·상한 재적용으로 다시 잡히지 않는다.
    it("이슈 369 켜진 터널을 저장해 리스너를 다시 띄워도 켜진 시각이 그대로다", async () => {
        expect(await server!.activeExternalPortServer(port, 0, SHORT)).toBe(true);
        const activatedAt = status().activatedAt;
        expect(activatedAt).toBeDefined();
        await tick();
        await save({destinationPort: 10});
        expect(status()).toMatchObject({active: true, activatedAt});
    });

    it("이슈 369 적용 실패를 되돌릴 때도 켜진 시각을 이어받는다", async () => {
        expect(await server!.activeExternalPortServer(port, 0, SHORT)).toBe(true);
        const activatedAt = status().activatedAt;
        const runtime = server!.captureRuntimeState();
        await tick();
        await save({destinationPort: 10});
        expect(await server!.restoreRuntimeState(runtime)).toEqual([]);
        expect(status()).toMatchObject({active: true, activatedAt});
    });

    it("이슈 369 켜진 채 기동한 터널은 기동 시각이 켜진 시각이고, 상한을 다시 걸어도 그대로다", async () => {
        await server!.close();
        // 상한이 없으면 기동 때 active() 를 부르지 않는다(activateNewListener). 그래도 켜진 시각이 있어야 한다.
        expect(IdentityStore.instance.updateGroup("g_owner", {attributes: {max_tunnel_duration_ms: 0}}).success).toBe(true);
        expect(ServerOptionStore.instance.updateTunnelingOption({...stored(), inactiveOnStartup: false})).toBe(true);
        const before = Date.now();
        server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
        const activatedAt = status().activatedAt!;
        expect(status().active).toBe(true);
        expect(activatedAt).toBeGreaterThanOrEqual(before);
        await tick();
        expect(IdentityStore.instance.updateGroup("g_owner", {attributes: {max_tunnel_duration_ms: HOUR_MS}}).success).toBe(true);
        server.reapplyActiveCaps();
        await tick();
        expect(status()).toMatchObject({active: true, activatedAt});
    });
});
