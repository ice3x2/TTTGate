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

    it("슈퍼유저 터널의 사용자 타임아웃 만료는 감사하지 않는다", async () => {
        expect(await server!.activeExternalPortServer(ports.b, 1)).toBe(true);
        expect(status(ports.b).activeTimeout).toBe(1);

        await sleep(2500);

        expect(status(ports.b).active).toBe(false);
        expect(status(ports.a).active).toBe(false);
        expect(autoExpireEvents().map((event) => event.target)).toEqual([{kind: "tunnel", id: String(ports.a)}]);
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
