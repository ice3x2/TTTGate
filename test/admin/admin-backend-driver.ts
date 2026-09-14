import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import AdminServer from "../../src/server/admin/AdminServer";
import ServerOptionStore from "../../src/server/ServerOptionStore";
import {CertificationStore} from "../../src/server/CertificationStore";
import {IdentityMigration} from "../../src/server/rbac/IdentityMigration";
import SessionStore from "../../src/server/admin/SessionStore";
import {TunnelingOption} from "../../src/types/TunnelingOption";
import {applyTestRoot} from "../helpers/runtime";

// 관리자 브라우저 테스트용 백엔드 드라이버. 실제 AdminServer 를 띄우고 TTTServer 만 스텁으로 바꾼다.
// 인자: [rootDir, fixture]. fixture 는 'bootstrap' | 'password' | 'with-tunnels'.

const FIXTURES = ["bootstrap", "password", "with-tunnels"] as const;
type Fixture = typeof FIXTURES[number];

const TEST_PASSWORD = "test-password-1234";

const rootDir = process.argv[2];
const fixture = (process.argv[3] ?? "bootstrap") as Fixture;
if(!FIXTURES.includes(fixture)) {
    process.exit(2);
}

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

const statusOf = (port: number) => ({
    port,
    online: true,
    active: active.get(port)?.active ?? true,
    sessions: 0,
    rx: 0,
    tx: 0,
    // 화면이 Date.now() - uptime 으로 경과를 계산하므로 uptime 은 시작 시각이다.
    uptime: startedAt,
    activeStart: active.get(port)?.activeStart ?? startedAt,
    activeTimeout: active.get(port)?.activeTimeout ?? 3600
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
    async applyTunnelingOption(...args: unknown[]) {
        record("applyTunnelingOption", args);
        return OK();
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
    externalServerStatus(port: number) {
        record("externalServerStatus", [port]);
        if(configuredPorts().includes(port)) return statusOf(port);
        return {port, online: false, sessions: 0, rx: 0, tx: 0, uptime: 0, active: false, activeStart: 0, activeTimeout: 0};
    },
    clientStatus(...args: unknown[]) {
        record("clientStatus", args);
        return [{
            id: 1, name: "client-a", clientId: "client-a", protocolVersion: 2, controlProtocolMode: "legacy",
            legacy: true, uptime: 65000, address: "127.0.0.1:50000", activeSessionCount: 0
        }];
    },
    getClientSysInfo(id: number) {
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
    if(fixture === "password" || fixture === "with-tunnels") {
        fs.writeFileSync(path.join(rootDir, "config", ".key"), bcrypt.hashSync(TEST_PASSWORD, 12));
    }
    await CertificationStore.instance.load();
    if(fixture === "with-tunnels") {
        const store = ServerOptionStore.instance;
        if(!store.updateServerOption({...store.serverOption, tunnelingOptions: TUNNEL_OPTIONS})) {
            throw new Error("Invalid with-tunnels fixture configuration");
        }
    } else {
        ServerOptionStore.instance;
    }
    SessionStore.instance;
    await IdentityMigration.runAtStartup();
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
    });
})();
