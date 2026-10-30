import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import AdminServer from "../../src/server/admin/AdminServer";
import ServerOptionStore from "../../src/server/ServerOptionStore";
import {CertificationStore} from "../../src/server/CertificationStore";
import {ExternalPortServerStatus} from "../../src/server/ExternalPortServerPool";
import {ClientStatus} from "../../src/server/TunnelServer";
import {SysInfo} from "../../src/commons/SysMonitor";
import {IdentityMigration} from "../../src/server/rbac/IdentityMigration";
import SessionStore from "../../src/server/admin/SessionStore";
import {TunnelingOption} from "../../src/types/TunnelingOption";
import {ADMIN_FIXTURES, ADMIN_TEST_PASSWORD, REGULAR_USER, TEMP_USER} from "../helpers/adminFixture";
import {IdentityStore} from "../../src/server/rbac/IdentityStore";
import {DEFAULT_GROUP_ID} from "../../src/server/rbac/IdentityTypes";
import {serializeIdentityFixture} from "../helpers/identityFixture";
import {RBAC_IDENTITY_FIXTURE, RBAC_PASSWORDS, RBAC_TRUSTED_CLIENTS, RBAC_TUNNELS, RBAC_USER_IDS} from "../helpers/rbacFixture";
import {ClockRngProvider} from "../../src/util/ClockRng";
import {generateRecoveryCodes, generateSecret, hashRecoveryCode} from "../../src/server/mfa/Totp";
import {base32Encode} from "../../src/server/mfa/Base32";
import {AuditSinkRegistry} from "../../src/server/audit/AuditSink";
import {AUDIT_EVENT_TYPES} from "../../src/server/audit/AuditEventTypes";
import {auditDirPath, FileAuditSink} from "../../src/server/audit/FileAuditSink";
import {httpRequest} from "../helpers/http";
import {AdmissionController} from "../../src/server/security/AdmissionController";
import type {AdminFixture} from "../helpers/adminFixture";
import {applyTestRoot} from "../helpers/runtime";

// 관리자 브라우저 테스트용 백엔드 드라이버. 실제 AdminServer 를 띄우고 TTTServer 만 스텁으로 바꾼다.
// 인자: [rootDir, fixture]. fixture 는 adminFixture.ts 의 ADMIN_FIXTURES 중 하나다.

const rootDir = process.argv[2];
const fixture = (process.argv[3] ?? "bootstrap") as AdminFixture;
if(!ADMIN_FIXTURES.includes(fixture)) {
    process.exit(2);
}
const rbac = fixture === "rbac" || fixture === "rbac-no-audit" || fixture === "rbac-mfa";

// U4-07: 테스트가 TOTP 코드를 계산할 수 있게 서버 시계는 실시각 + 누적 offset 이다(advanceClock IPC 가 offset 을 늘린다).
let clockOffset = 0;
let enrollmentCodeCount = 0;
// 'rbac-mfa' 의 alice 복구 코드 평문. identity.yaml 에는 해시만 있다.
let mfaRecoveryCodes: string[] = [];

const TUNNEL_OPTIONS: Array<TunnelingOption> = [
    {
        forwardPort: 20001, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9,
        tls: false, keepAlive: 0, inactiveOnStartup: false,
        bufferLimitOnServer: 8, bufferLimitOnClient: 8, allowedClientNames: []
    },
    {
        forwardPort: 20002, protocol: "http", destinationAddress: "127.0.0.1", destinationPort: 8080,
        tls: false, keepAlive: 0, inactiveOnStartup: false,
        bufferLimitOnServer: 8, bufferLimitOnClient: 8, allowedClientNames: [],
        httpOption: {
            rewriteHostInTextBody: true, replaceAccessControlAllowOrigin: false,
            customRequestHeaders: [], customResponseHeaders: [], bodyRewriteRules: []
        }
    }
];

const startedAt = Date.now();
const calls: Array<{method: string; args: unknown[]}> = [];
const active = new Map<number, {active: boolean; activeTimeout: number; activeStart: number}>();

const OK = () => ({success: true, partial: false, warnings: [], failedScopes: [], restartRequiredScopes: []});

const record = (method: string, args: unknown[]): void => { calls.push({method, args}); };

// 반환 타입을 실제 정의로 못박아 둔다 — 서버 쪽 타입이 늘면 여기서 컴파일이 깨져 드러난다.
const statusOf = (port: number): ExternalPortServerStatus => ({
    port,
    online: true,
    active: active.get(port)?.active ?? true,
    sessions: 0,
    rx: 0,
    tx: 0,
    // 화면이 Date.now() - uptime 으로 경과를 계산하므로 uptime 은 시작 시각이다.
    uptime: startedAt,
    activeStart: active.get(port)?.activeStart ?? startedAt,
    activeTimeout: active.get(port)?.activeTimeout ?? 3600,
    // U5-06: 20002 는 거절 7건(geo 2 + rateLimit 5)이 있는 카드다.
    rejected: port === 20002 ? {geo: 2, rateLimit: 5} : {geo: 0, rateLimit: 0},
    bannedIps: port === 20002 ? 1 : 0
});

const configuredPorts = (): Array<number> =>
    (ServerOptionStore.instance.serverOption.tunnelingOptions ?? []).map((option) => option.forwardPort);

const stub = {
    captureRuntimeState(...args: unknown[]) {
        record("captureRuntimeState", args);
        return {};
    },
    restoreRuntimeState(...args: unknown[]) {
        record("restoreRuntimeState", args);
        return [];
    },
    async applyServerOption(...args: unknown[]) {
        record("applyServerOption", args);
        return OK();
    },
    // #213: 등록 코드 발급. 실제 TTTServer 와 같은 판정(TLS·등록 여부)을 저장소 값으로 흉내 낸다.
    async issueEnrollmentCode(clientId: string, ttlMs?: number) {
        record("issueEnrollmentCode", [clientId, ttlMs]);
        const option = ServerOptionStore.instance.serverOption;
        if(option.tls !== true) return {ok: false, reason: "tls-required"};
        if(!(option.trustedClients ?? []).some((client) => client.clientId === clientId)) return {ok: false, reason: "unknown-client"};
        // #225: 재발급 결과를 구별할 수 있게 호출마다 다른 코드를 준다.
        enrollmentCodeCount++;
        return {ok: true, code: `7Q4K-M2XP-${String(enrollmentCodeCount).padStart(4, "0")}`, expiresAt: Date.now() + clockOffset + (ttlMs ?? 15 * 60_000)};
    },
    async applyTunnelingOption(...args: unknown[]) {
        record("applyTunnelingOption", args);
        return OK();
    },
    // U5-06: 국가 필터 저장(PUT /api/security/geo)이 부른다. 기록만 한다 — 실제로 적용하면
    // unknownPolicy=deny + applyToAdmin 조합에서 루프백인 테스트 브라우저가 관리 콘솔에서 막힌다.
    applyConnectionSecurity(...args: unknown[]) {
        record("applyConnectionSecurity", args);
    },
    async applyExternalServerCert(...args: unknown[]) {
        record("applyExternalServerCert", args);
        return OK();
    },
    async stopExternalPortServer(...args: unknown[]) {
        record("stopExternalPortServer", args);
        return true;
    },
    async activeExternalPortServer(port: number, timeout: number) {
        record("activeExternalPortServer", [port, timeout]);
        active.set(port, {active: true, activeTimeout: timeout, activeStart: Date.now()});
        return true;
    },
    async inactiveExternalPortServer(port: number) {
        record("inactiveExternalPortServer", [port]);
        active.set(port, {
            active: false,
            activeTimeout: active.get(port)?.activeTimeout ?? 3600,
            activeStart: active.get(port)?.activeStart ?? startedAt
        });
        return true;
    },
    externalServerStatuses(...args: unknown[]) {
        record("externalServerStatuses", args);
        return configuredPorts().map((port) => statusOf(port));
    },
    externalServerStatus(port: number): ExternalPortServerStatus {
        record("externalServerStatus", [port]);
        if(configuredPorts().includes(port)) return statusOf(port);
        return {port, online: false, sessions: 0, rx: 0, tx: 0, uptime: 0, active: false, activeStart: 0, activeTimeout: 0,
            rejected: {geo: 0, rateLimit: 0}, bannedIps: 0};
    },
    clientStatus(...args: unknown[]): Array<ClientStatus> {
        record("clientStatus", args);
        return [{
            id: 1, name: "client-a", clientId: "client-a", protocolVersion: 2, controlProtocolMode: "legacy",
            legacy: true, uptime: 65000, address: "127.0.0.1:50000", activeSessionCount: 0
        }];
    },
    getClientSysInfo(id: number): SysInfo | undefined {
        record("getClientSysInfo", [id]);
        if(id !== 1) return undefined;
        return {
            osInfo: {platform: "linux", release: "6.1", type: "Linux", hostname: "client-a"},
            ram: 8589934592,
            cpuInfo: {model: "Fixture CPU", speed: 2400, cores: 4},
            network: {
                eth0: [{
                    address: "10.0.0.2", netmask: "255.255.255.0", family: "IPv4",
                    mac: "00:11:22:33:44:55", internal: false, cidr: "10.0.0.2/24"
                }]
            }
        };
    }
};

(async () => {
    applyTestRoot(rootDir);
    // applyTestRoot 가 런타임 상태(시계 포함)를 초기화하므로 그 뒤에 시계를 건다.
    // 난수는 기본 구현(크기 검사 포함)에 맡기고 시각만 바꾼다.
    const baseClock = ClockRngProvider.current();
    ClockRngProvider.configure({now: () => Date.now() + clockOffset, random: () => baseClock.random(),
        secureRandomBytes: (n: number) => baseClock.secureRandomBytes(n)});
    if(fixture === "password" || fixture === "with-tunnels" || fixture === "regular-user") {
        fs.writeFileSync(path.join(rootDir, "config", ".key"), bcrypt.hashSync(ADMIN_TEST_PASSWORD, 12));
    }
    if(rbac) {
        // #103 (U3-01): 사용자·그룹은 identity.yaml 로 심는다(.key 없음). 런타임 해시(사용자 생성 등)만 cost 4 다.
        IdentityStore.bcryptCost = 4;
        fs.writeFileSync(path.join(rootDir, "config", "identity.yaml"), await serializeIdentityFixture(RBAC_IDENTITY_FIXTURE));
    }
    await CertificationStore.instance.load();
    if(rbac) {
        const store = ServerOptionStore.instance;
        const tunnels = RBAC_TUNNELS.map((tunnel) => ({...TUNNEL_OPTIONS[0], ...tunnel,
            ...(tunnel.protocol === "http" ? {httpOption: TUNNEL_OPTIONS[1].httpOption} : {})}));
        if(!store.updateServerOption({...store.serverOption, tunnelingOptions: tunnels as TunnelingOption[], trustedClients: RBAC_TRUSTED_CLIENTS})) {
            throw new Error("Invalid rbac fixture configuration");
        }
    } else if(fixture === "with-tunnels") {
        const store = ServerOptionStore.instance;
        if(!store.updateServerOption({...store.serverOption, tunnelingOptions: TUNNEL_OPTIONS})) {
            throw new Error("Invalid with-tunnels fixture configuration");
        }
    } else {
        // 싱글턴을 미리 만들어 설정 파일을 준비시킨다(옛 login-backend-driver.ts 와 같다).
        void ServerOptionStore.instance;
    }
    void SessionStore.instance;
    // U4-06: 감사 화면이 실제 파일을 읽도록 ServerApp 과 같이 파일 싱크를 연결한다(rootDir/logs/audit).
    const auditSink = new FileAuditSink({dir: auditDirPath(), queueSize: 1000, retentionDays: 0});
    AuditSinkRegistry.set(auditSink);
    await IdentityMigration.runAtStartup();
    if(fixture === "rbac-mfa") {
        const codes = generateRecoveryCodes();
        const enabled = IdentityStore.instance.setMfa(RBAC_USER_IDS.alice, {enabled: true, secret: base32Encode(generateSecret()),
            enrolledAt: Date.now(), lastUsedStep: -1, recoveryCodeHashes: codes.map((code) => hashRecoveryCode(code, RBAC_USER_IDS.alice))});
        if(!enabled.success) throw new Error("Invalid rbac-mfa fixture");
        mfaRecoveryCodes = codes;
    }
    if(fixture === "rbac-no-audit") {
        const grouped = IdentityStore.instance.updateGroup(DEFAULT_GROUP_ID, {attributes: {admin_ui_section_access: ["tunnels", "my_profile", "my_sessions"]}});
        if(!grouped.success) throw new Error("Invalid rbac-no-audit fixture");
    }
    if(fixture === "regular-user") {
        // 슈퍼유저 admin 은 .key 승격으로 생긴다. 일반 유저 둘은 저장소 API 로 직접 만든다(빠른 bcrypt).
        IdentityStore.bcryptCost = 4;
        const store = IdentityStore.instance;
        const grouped = store.updateGroup(DEFAULT_GROUP_ID, {attributes: {admin_ui_section_access: ["tunnels"]}});
        const alice = await store.createUser({username: REGULAR_USER.username, role: "regular", password: REGULAR_USER.password, mustChangePassword: false});
        const temp = await store.createUser({username: TEMP_USER.username, role: "regular", password: TEMP_USER.password, mustChangePassword: true});
        if(!grouped.success || !alice.success || !temp.success) throw new Error("Invalid regular-user fixture");
    }
    const api = new AdminServer(stub as any, false);
    const port = await api.listen(0, "127.0.0.1");
    process.send?.({port, pid: process.pid});
    process.on("message", async (message: any) => {
        if(message === "close") {
            await api.close();
            process.disconnect?.();
            return;
        }
        if(message && message.type === "calls") {
            process.send?.({type: "calls", calls});
        }
        // U4-06: 브라우저 로그인 전에 다른 사용자 세션을 서버에 만들어 둔다(로그인 진입점이 아니라 사전 세션 시드다).
        if(message && message.type === "login") {
            const password = (RBAC_PASSWORDS as Record<string, string>)[message.username];
            const body = JSON.stringify({username: message.username, password});
            const response = await httpRequest({port, path: "/api/login", method: "POST",
                headers: {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)), "User-Agent": message.userAgent},
                body});
            process.send?.({type: "login", ok: response.statusCode === 200});
        }
        if(message && message.type === "sessions") {
            // 화면과 같은 모양이다. 세션을 새로 만들지 않도록 HTTP 대신 저장소를 직접 읽는다.
            const sessions = SessionStore.instance.listSessions().map((session) => ({
                id: SessionStore.sessionIdOf(session.key), userId: session.userId,
                username: IdentityStore.instance.user(session.userId)?.username ?? session.userId,
                createdAt: session.createdAt, lastSeenAt: session.lastSeenAt, ip: session.ip, userAgent: session.userAgent ?? "", current: false
            }));
            process.send?.({type: "sessions", sessions});
        }
        // U5-06: 실제 리미터에 차단을 하나 만든다(한 번 허용 뒤 두 번째가 차단된다).
        if(message && message.type === "seed-ban") {
            AdmissionController.instance.configureTunnel({forwardPort: message.port,
                rateLimit: {enabled: true, windowMs: 60000, maxConnections: 1, banMs: 600000}} as any);
            AdmissionController.instance.admit({kind: "tunnel", port: message.port, protocol: "tcp"} as any, message.ip);
            AdmissionController.instance.admit({kind: "tunnel", port: message.port, protocol: "tcp"} as any, message.ip);
            process.send?.({type: "seed-ban"});
        }
        // U4-07: 테스트 드라이버 전용 IPC. AdminServer 라우트로 노출하지 않는다.
        // U4-09: 서버 옵션 일부를 갱신한다(드라이버 전용, 프로덕션 API 아님).
        if(message && message.type === "serverOption") {
            const store = ServerOptionStore.instance;
            const ok = store.updateServerOption({...store.serverOption, ...message.patch});
            process.send?.({type: "serverOption", ok: ok !== false});
        }
        if(message && message.type === "mfaSecret") {
            process.send?.({type: "mfaSecret", secret: IdentityStore.instance.userByUsername(message.username)?.mfa?.secret});
        }
        if(message && message.type === "mfaRecoveryCodes") {
            process.send?.({type: "mfaRecoveryCodes", codes: message.username === "alice" ? mfaRecoveryCodes : []});
        }
        if(message && message.type === "advanceClock") {
            clockOffset += message.ms;
            process.send?.({type: "advanceClock", offset: clockOffset});
        }
        if(message && message.type === "seedAudit") {
            const now = Date.now();
            for(let i = 0; i < message.n; i++) {
                await AuditSinkRegistry.current().record({at: now - message.n + i, actor: {userId: "system"}, type: AUDIT_EVENT_TYPES.user_updated,
                    target: {kind: "user", id: "u_0000000000000002"}, outcome: "success", summary: "user_updated u_0000000000000002"});
            }
            await (AuditSinkRegistry.current() as FileAuditSink).flush();
            process.send?.({type: "seedAudit"});
        }
    });
})();
