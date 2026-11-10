import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import TTTServer from "../../../../src/server/TTTServer";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {AdmissionController} from "../../../../src/server/security/AdmissionController";
import {TunnelingOption} from "../../../../src/types/TunnelingOption";
import {serializeIdentityFixture} from "../../../helpers/identityFixture";
import {getFreePort, waitFor} from "../../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

// 이슈 348 — TTTServer 가 저장된 허용 IP 목록과 지금의 켜기 권한으로 접속을 판정하고, 목록이 바뀌면 기존 연결을 끊는다.
// 실제 리스너에 루프백의 서로 다른 주소 127.0.0.1·127.0.0.2 로 연결한다.
jest.setTimeout(30_000);

const ADMIN = "u_0000000000000b01";
const OPERATOR = "u_0000000000000b02";
const OUTSIDER = "u_0000000000000b03";
const GONE = "u_0000000000000bff";
const IP_A = "127.0.0.1";
const IP_B = "127.0.0.2";

const quietSink: AuditSink = {reserve: () => true, record: () => Promise.resolve()};

/** from 주소에서 연결하고 닫힐 때까지 기다린다. 이 터널에는 클라이언트가 없어 받은 연결도 곧 닫힌다. */
const connectOnce = (port: number, from: string): Promise<void> => new Promise((resolve, reject) => {
    const socket = net.connect({host: "127.0.0.1", port, localAddress: from});
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`connection from ${from} was not closed`)); }, 3_000);
    socket.on("error", () => {});
    socket.once("close", () => { clearTimeout(timer); resolve(); });
});

describe("activator-ip runtime (이슈 348)", () => {
    let testRoot: TestRoot;
    let server: TTTServer | undefined;
    let port: number;

    const stored = () => ServerOptionStore.instance.getTunnelingOption(port)!;
    const activatorDenials = (): number => AdmissionController.instance.snapshot().ports[String(port)]?.rejectedActivatorIp ?? 0;
    const save = async (patch: Partial<TunnelingOption>) => {
        const previous = stored();
        expect(ServerOptionStore.instance.updateTunnelingOption({...previous, ...patch})).toBe(true);
        expect((await server!.applyTunnelingOption(stored(), previous)).success).toBe(true);
    };

    beforeEach(async () => {
        testRoot = await createTestRoot("activator-ip-runtime");
        applyTestRoot(testRoot.rootDir);
        await CertificationStore.instance.load();
        AdmissionController.resetForTest();
        AuditSinkRegistry.set(quietSink);
        const yaml = await serializeIdentityFixture({
            groups: [{id: "g_toggle", name: "Operators", attributes: {tunnel_crud: "toggle"}}],
            users: [
                {id: ADMIN, username: "admin", password: "admin-password-1234", role: "superuser"},
                {id: OPERATOR, username: "operator", password: "operator-password-1234", role: "regular", groupId: "g_toggle"},
                {id: OUTSIDER, username: "outsider", password: "outsider-password-1234", role: "regular", groupId: "g_toggle"}
            ]
        });
        await fs.writeFile(path.join(testRoot.rootDir, "config", "identity.yaml"), yaml, "utf-8");
        IdentityStore.resetForTest();
        expect(IdentityStore.instance.load()).toEqual({success: true, source: "file"});

        port = await getFreePort();
        const store = ServerOptionStore.instance;
        // 서버를 다시 시작한 상황: 설정 파일에 허용 IP 목록이 남아 있고, inactiveOnStartup=false 로 자동으로 켜진다(AC-7).
        const option: TunnelingOption = {forwardPort: port, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0,
            inactiveOnStartup: false, ownerId: OPERATOR, activatorIpOnly: true,
            // 사라진 사용자와 켜기 권한이 없는 사용자(공유되지 않은 다른 toggle 사용자)의 항목은 판정에 쓰지 않는다(FR-5).
            activatorIps: {[OPERATOR]: IP_A, [GONE]: IP_B, [OUTSIDER]: IP_B}};
        expect(store.updateServerOption({...store.serverOption, port: await getFreePort(), tls: false, tunnelingOptions: [option]})).toBe(true);
        server = TTTServer.create(store.serverOption);
        await server.start();
    });

    afterEach(async () => {
        await server?.close();
        server = undefined;
        AdmissionController.resetForTest();
        AuditSinkRegistry.reset();
        await cleanupTestRoot(testRoot);
    });

    it("다시 시작한 서버는 저장된 목록의 IP 만 받고, 시작이 목록을 바꾸지 않는다 (AC-7·AC-12)", async () => {
        await connectOnce(port, IP_B);
        await waitFor(() => { if(activatorDenials() !== 1) throw new Error("waiting for the denial"); }, {timeoutMs: 2000});
        await connectOnce(port, IP_A);
        expect(activatorDenials()).toBe(1);
        expect(stored().activatorIps).toEqual({[OPERATOR]: IP_A, [GONE]: IP_B, [OUTSIDER]: IP_B});
    });

    it("IP 제한과 허용 IP 목록만 바꾼 저장은 리스너를 다시 시작하지 않는다 (FR-2·AC-6)", async () => {
        // 손으로 넣은 설정은 첫 저장에서 정규화되며 한 번 다시 시작한다. 그 뒤의 상태를 기준으로 본다.
        await save({});
        const uptime = server!.externalServerStatus(port).uptime;
        await new Promise((resolve) => setTimeout(resolve, 20));
        await save({activatorIpOnly: false, activatorIps: {[OPERATOR]: IP_B}});
        expect(server!.externalServerStatus(port).uptime).toBe(uptime);
        await connectOnce(port, IP_B);
        await connectOnce(port, IP_A);
        expect(activatorDenials()).toBe(0);
    });

    it("enforceActivatorIps 는 허용 IP 가 아닌 세션만 끊고, 제한이 꺼진 터널은 건드리지 않는다 (FR-8)", async () => {
        const pool = (server as any)._externalPortServerPool;
        const close = jest.spyOn(pool, "closeSessionsWhere");
        await server!.enforceActivatorIps(port);
        expect(close).toHaveBeenCalledTimes(1);
        const [closedPort, refuse] = close.mock.calls[0] as [number, (address: string | undefined) => boolean];
        expect(closedPort).toBe(port);
        expect(refuse(IP_A)).toBe(false);
        expect(refuse(`::ffff:${IP_A}`)).toBe(false);
        expect(refuse(IP_B)).toBe(true);
        expect(refuse(undefined)).toBe(true);

        close.mockClear();
        expect(ServerOptionStore.instance.updateTunnelingOption({...stored(), activatorIpOnly: false})).toBe(true);
        await server!.enforceActivatorIps();
        expect(close).not.toHaveBeenCalled();
    });
});
