import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import TTTServer from "../../../../src/server/TTTServer";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditEvent, AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {AdmissionController} from "../../../../src/server/security/AdmissionController";
import {TunnelingOption} from "../../../../src/types/TunnelingOption";
import {serializeIdentityFixture} from "../../../helpers/identityFixture";
import {getFreePort} from "../../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

jest.setTimeout(30_000);

type StubSink = AuditSink & {events: AuditEvent[]};

const createStubSink = (): StubSink => ({
    events: [],
    reserve(): boolean { return true; },
    record(event: AuditEvent): Promise<void> { this.events.push(event); return Promise.resolve(); }
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("tunnel-lifetime", () => {
    let testRoot: TestRoot;
    let server: TTTServer | undefined;
    let sink: StubSink;
    let ports: {a: number; b: number; c: number; d: number};
    let aliceId: string;

    const status = (port: number) => server!.externalServerStatus(port);
    const autoExpireEvents = () => sink.events.filter((event) => event.type === "tunnel_autoexpire");

    beforeEach(async () => {
        testRoot = await createTestRoot("tunnel-lifetime");
        applyTestRoot(testRoot.rootDir);
        await CertificationStore.instance.load();
        AdmissionController.resetForTest();

        // g_field 의 수명 상한은 2초다. alice 는 그 그룹의 일반 유저, admin 은 슈퍼유저다.
        const yaml = await serializeIdentityFixture({
            groups: [{id: "g_field", name: "Field team", attributes: {max_tunnel_duration_ms: 2000}}],
            users: [
                {username: "alice", password: "alice-password-1234", role: "regular", groupId: "g_field"},
                {username: "admin", password: "admin-password-1234", role: "superuser"}
            ]
        });
        await fs.writeFile(path.join(testRoot.rootDir, "config", "identity.yaml"), yaml, "utf-8");
        const idOf = (username: string): string => YAML.parse(yaml).users.find((user: any) => user.username === username).id;
        aliceId = idOf("alice");
        IdentityStore.resetForTest();
        expect(IdentityStore.instance.load()).toEqual({success: true, source: "file"});

        ports = {a: await getFreePort(), b: await getFreePort(), c: await getFreePort(), d: await getFreePort()};
        const tunnel = (forwardPort: number, ownerId?: string, inactiveOnStartup = false): TunnelingOption => ({
            forwardPort, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0,
            inactiveOnStartup, ...(ownerId ? {ownerId} : {})
        } as TunnelingOption);
        const store = ServerOptionStore.instance;
        const updated = store.updateServerOption({...store.serverOption, port: await getFreePort(),
            tunnelingOptions: [tunnel(ports.a, idOf("alice")), tunnel(ports.b, idOf("admin")), tunnel(ports.c),
                tunnel(ports.d, idOf("alice"), true)]});
        expect(updated).toBeTruthy();

        sink = createStubSink();
        AuditSinkRegistry.set(sink);
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

    it("기동 직후 일반 유저 터널에만 그룹 상한이 걸리고, 상한 뒤 비활성화되며 감사가 1건 남는다", async () => {
        expect(status(ports.a)).toMatchObject({active: true, activeTimeout: 2});
        expect(status(ports.b)).toMatchObject({active: true, activeTimeout: 0});
        expect(status(ports.c)).toMatchObject({active: true, activeTimeout: 0});
        expect(autoExpireEvents()).toEqual([]);

        await sleep(2500);

        expect(status(ports.a).active).toBe(false);
        expect(status(ports.b).active).toBe(true);
        expect(status(ports.c).active).toBe(true);
        const events = autoExpireEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            type: "tunnel_autoexpire", target: {kind: "tunnel", id: String(ports.a)}, outcome: "success",
            actor: {userId: "system"}, detail: {port: ports.a, timeoutSeconds: 2}
        });
    });

    it("활성화 요청의 타임아웃은 상한으로 잘리고, 상한보다 짧으면 그대로 둔다", async () => {
        expect(await server!.activeExternalPortServer(ports.a, 10)).toBe(true);
        expect(status(ports.a).activeTimeout).toBe(2);
        expect(await server!.activeExternalPortServer(ports.a, 0)).toBe(true);
        expect(status(ports.a).activeTimeout).toBe(2);
        expect(await server!.activeExternalPortServer(ports.a, 1)).toBe(true);
        expect(status(ports.a).activeTimeout).toBe(1);

        // 사용자가 정한 1초 만료는 그룹 상한의 집행이 아니므로 감사하지 않는다.
        await sleep(1500);
        expect(status(ports.a).active).toBe(false);
        expect(autoExpireEvents()).toEqual([]);
    });

    // #141 — Node 는 2^31-1ms(약 24.8일)를 넘는 setTimeout 지연을 1ms 로 바꾼다. 긴 수명이 즉시 만료로 바뀌면 안 된다.
    it("24.8일을 넘는 사용자 타임아웃과 그룹 상한에서도 터널이 켜진 채로 남는다", async () => {
        expect(await server!.activeExternalPortServer(ports.b, 3_000_000)).toBe(true);
        const thirtyDaysMs = 30 * 86_400_000;
        const group = IdentityStore.instance.updateGroup("g_field", {attributes: {max_tunnel_duration_ms: thirtyDaysMs}});
        expect(group.success).toBe(true);
        expect(await server!.activeExternalPortServer(ports.a, 0)).toBe(true);
        expect(status(ports.a).activeTimeout).toBe(thirtyDaysMs / 1000);

        await sleep(300);

        expect(status(ports.b)).toMatchObject({active: true, activeTimeout: 3_000_000});
        expect(status(ports.a).active).toBe(true);
        expect(autoExpireEvents()).toEqual([]);
    });

    it("슈퍼유저 터널의 사용자 타임아웃 만료는 감사하지 않는다", async () => {
        expect(await server!.activeExternalPortServer(ports.b, 1)).toBe(true);
        expect(status(ports.b).activeTimeout).toBe(1);

        await sleep(2500);

        expect(status(ports.b).active).toBe(false);
        expect(status(ports.a).active).toBe(false);
        expect(autoExpireEvents().map((event) => event.target)).toEqual([{kind: "tunnel", id: String(ports.a)}]);
    });

    // #137 — 활성 중인 터널의 소유자·그룹 상한이 바뀌면 그 자리에서 다시 계산한다. 시작 시각은 유지한다.
    it("슈퍼유저 터널을 상한 있는 그룹 사용자에게 넘기면 활성 중인 터널에 상한이 걸린다", async () => {
        expect(status(ports.b)).toMatchObject({active: true, activeTimeout: 0});
        const option = ServerOptionStore.instance.getTunnelingOption(ports.b)!;
        expect(ServerOptionStore.instance.updateTunnelingOption({...option, ownerId: aliceId})).toBe(true);
        server!.reapplyActiveCaps();
        expect(status(ports.b)).toMatchObject({active: true, activeTimeout: 2});
        // 기동 때 켜진 터널이라도 다시 계산한 순간 바로 만료되면 안 된다(시작 시각 0 이 마감을 과거로 만들던 회귀).
        await sleep(300);
        expect(status(ports.b).active).toBe(true);
        await sleep(2200);
        expect(status(ports.b).active).toBe(false);
        expect(autoExpireEvents().map((event) => event.target)).toContainEqual({kind: "tunnel", id: String(ports.b)});
    });

    it("그룹 상한을 올리면 활성 중인 터널도 새 상한을 따른다", async () => {
        expect(status(ports.a)).toMatchObject({active: true, activeTimeout: 2});
        expect(IdentityStore.instance.updateGroup("g_field", {attributes: {max_tunnel_duration_ms: 3_600_000}}).success).toBe(true);
        server!.reapplyActiveCaps();
        expect(status(ports.a).activeTimeout).toBe(3600);
        await sleep(2500);
        expect(status(ports.a).active).toBe(true);
    });

    it("재적용은 상한을 처음부터 다시 걸지 않는다(시작 시각 유지)", async () => {
        await sleep(1200);
        const option = ServerOptionStore.instance.getTunnelingOption(ports.a)!;
        expect((await server!.applyTunnelingOption(JSON.parse(JSON.stringify(option)), option)).success).toBe(true);
        await sleep(1300);
        expect(status(ports.a).active).toBe(false);
    });

    it("상한으로 잘린 터널을 슈퍼유저에게 넘긴 뒤 재적용하면 상한 없이 켜져 있다", async () => {
        const option = ServerOptionStore.instance.getTunnelingOption(ports.a)!;
        const admin = ServerOptionStore.instance.getTunnelingOption(ports.b)!.ownerId;
        expect(ServerOptionStore.instance.updateTunnelingOption({...option, ownerId: admin})).toBe(true);
        const updated = ServerOptionStore.instance.getTunnelingOption(ports.a)!;
        expect((await server!.applyTunnelingOption(JSON.parse(JSON.stringify(updated)), updated)).success).toBe(true);
        expect(status(ports.a)).toMatchObject({active: true, activeTimeout: 0});
        await sleep(2500);
        expect(status(ports.a).active).toBe(true);
    });

    it("터널 옵션을 다시 적용해 재생성해도 상한이 유지된다", async () => {
        const option = ServerOptionStore.instance.getTunnelingOption(ports.a)!;
        const result = await server!.applyTunnelingOption(JSON.parse(JSON.stringify(option)), option);
        expect(result.success).toBe(true);
        expect(status(ports.a)).toMatchObject({active: true, activeTimeout: 2});

        await sleep(2500);

        expect(status(ports.a).active).toBe(false);
        expect(autoExpireEvents().map((event) => event.target)).toEqual([{kind: "tunnel", id: String(ports.a)}]);
    });

    it("기동 시 비활성으로 둔 일반 유저 터널은 상한이 있어도 켜지지 않는다", async () => {
        expect(status(ports.d)).toMatchObject({active: false, activeTimeout: 0});
        await sleep(2500);
        expect(status(ports.d).active).toBe(false);
        expect(autoExpireEvents().map((event) => event.target)).toEqual([{kind: "tunnel", id: String(ports.a)}]);
    });

    it("비활성화하면 타이머가 취소되어 만료 감사가 남지 않는다", async () => {
        expect(await server!.inactiveExternalPortServer(ports.a)).toBe(true);
        await sleep(2500);
        expect(status(ports.a).active).toBe(false);
        expect(autoExpireEvents()).toEqual([]);
    });
});
