import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import YAML from "yaml";
import bcrypt from "bcryptjs";
import {spawnProcess, getFreePort, waitUntil, SpawnedProcess} from "./smokeProcess";
import {httpsRequest} from "./http";
import {E2E_ADMIN_PASSWORD, IdentityFixture, serializeIdentityFixture} from "./identityFixture";
import {__testInternals as clientAppTestInternals} from "../../src/client/ClientApp";
import type {ClientOption, HttpOption, ServerOption, TunnelingOption} from "../../src/types/TunnelingOption";

const APP_JS = path.resolve(__dirname, "..", "..", "build", "src", "app.js");
const ADMIN_PASSWORD = E2E_ADMIN_PASSWORD;
const DEFAULT_ADMIN_USERNAME = "admin";
// P0-U0-01: 하네스 생성마다 cost-12 bcrypt 해시를 반복하지 않도록 모듈 수준에서 한 번만 계산한다.
// 하네스가 .key 에 심는 해시. 승격이 .key 를 다시 쓰지 않는 것을 테스트가 바이트로 고정할 수 있게 내보낸다.
export const ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 12);
const VERBOSE = process.env.TTTGATE_E2E_VERBOSE === "1";

export type ProcessTunnelSpec = {
    forwardPort?: number;
    protocol: "tcp" | "http" | "https";
    destinationPort: number;
    httpOption?: HttpOption;
    tls?: boolean;
    extra?: Partial<TunnelingOption>;
};

export type ProcessTunnelOptions = {
    tunnels: ProcessTunnelSpec[];
    serverOptionExtra?: Partial<ServerOption>;
    clientOptionExtra?: Partial<ClientOption>;
    clientCount?: number;
    startClient?: boolean;
    // U5-03 / #118 — false면 관리자 포트 폴링 대신 서버 stdout의 `Listen - port:` 로그로 준비 판정한다.
    // 국가 필터가 외부 포트·관리자 포트를 막아 놓은 상태로 기동하는 시나리오(geo-filter.test.ts)를 위한 옵션.
    adminAccess?: boolean;
    // U2-09 / #101 — 사용자·그룹을 config/identity.yaml 에 미리 심는다. 지정하면 .key 를 쓰지 않으므로
    // 레거시 승격 경로를 타지 않고, adminLogin 계정이 이 픽스처 안에 있어야 한다.
    identityFixture?: IdentityFixture;
    // U2-09 / #101 — adminRequest 가 로그인할 계정. 기본은 레거시 admin 계정이다.
    adminLogin?: AdminLogin;
};

export type AdminLogin = {username: string; password: string};

export type AdminRequest = (path: string, init?: {method?: string; body?: unknown}) => Promise<{status: number; json: any}>;

export type ProcessTunnelHarness = {
    rootDir: string;
    clientRootDirs: string[];
    adminPort: number;
    tunnelPort: number;
    tunnels: Array<{forwardPort: number; protocol: "tcp" | "http" | "https"; destinationPort: number}>;
    clientIds: string[];
    server: SpawnedProcess;
    clients: SpawnedProcess[];
    adminRequest: AdminRequest;
    // U2-09 / #101 — 계정별로 세션·CSRF 쿠키를 따로 들고 있는 요청 함수. 같은 login 이면 같은 함수를 돌려준다.
    adminRequestAs(login: AdminLogin): AdminRequest;
    waitForClientOnline(timeoutMs?: number): Promise<void>;
    waitForTunnelOnline(forwardPort: number, timeoutMs?: number): Promise<void>;
    restartServer(patch?: {serverOptionExtra?: Partial<ServerOption>}): Promise<void>;
    /** #232: 서버 프로세스를 SIGKILL 로 즉시 죽인다(정리 기회 없음). 다시 띄우려면 startServer. */
    killServer(): Promise<void>;
    startServer(): Promise<void>;
    stopClient(index?: number): Promise<void>;
    /** #231: 클라이언트 프로세스를 SIGKILL 로 즉시 죽인다. 서버가 그 클라이언트를 목록에서 뺄 때까지 기다리지 않는다. */
    killClient(index?: number): Promise<void>;
    startClient(index?: number): Promise<void>;
    dispose(): Promise<void>;
};

export function formatTail(proc: SpawnedProcess, lines: number): string {
    const {stdout, stderr} = proc.readChannel();
    const tailOf = (text: string): string => text.split(/\r?\n/).slice(-lines).join("\n");
    return `--- stdout (last ${lines}) ---\n${tailOf(stdout)}\n--- stderr (last ${lines}) ---\n${tailOf(stderr)}`;
}

export function readRssMiB(pid: number): number | undefined {
    if(process.platform !== "linux") return undefined;
    try {
        const status = fs.readFileSync(`/proc/${pid}/status`, "utf-8");
        const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
        if(!match) return undefined;
        return parseInt(match[1], 10) / 1024;
    } catch {
        return undefined;
    }
}

const mkdtempRoot = async (prefix: string): Promise<string> => fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));

const makeRootLayout = async (rootDir: string): Promise<void> => {
    for(const sub of ["config", "bin", "logs", path.join("cache", "server"), path.join("cache", "client"), "cert"]) {
        await fs.promises.mkdir(path.join(rootDir, sub), {recursive: true});
    }
};

/** SIGKILL 로 즉시 끝낸다. Windows 에서는 TerminateProcess 와 같다. */
const forceKill = async (proc: SpawnedProcess): Promise<void> => {
    if(proc.child.exitCode !== null || proc.child.signalCode !== null) return;
    proc.kill("SIGKILL");
    await proc.waitForExit(10000);
    if(proc.child.exitCode === null && proc.child.signalCode === null) throw new Error(`Process did not die: pid ${proc.pid}`);
};

const terminate = async (proc: SpawnedProcess): Promise<void> => {
    if(proc.child.exitCode !== null || proc.child.signalCode !== null) return;
    proc.kill("SIGTERM");
    await proc.waitForExit(5000);
    if(process.platform !== "win32" && proc.child.exitCode === null && proc.child.signalCode === null) {
        proc.kill("SIGKILL");
        await proc.waitForExit(5000);
    }
    if(proc.child.exitCode === null && proc.child.signalCode === null) {
        throw new Error(`Process did not exit: pid ${proc.pid}`);
    }
};

const removeRoot = async (rootDir: string): Promise<void> => {
    await fs.promises.rm(rootDir, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
};

export async function createProcessTunnelHarness(options: ProcessTunnelOptions): Promise<ProcessTunnelHarness> {
    if(!fs.existsSync(APP_JS)) {
        throw new Error("Run npm run build first");
    }
    const insecureFields = clientAppTestInternals.INSECURE_FIELD_NAMES;
    if(options.clientOptionExtra && insecureFields.some((name) => Object.prototype.hasOwnProperty.call(options.clientOptionExtra, name))) {
        throw new Error("clientOptionExtra must not contain insecure fields");
    }
    if(!options.tunnels || options.tunnels.length === 0) {
        throw new Error("At least one tunnel is required");
    }

    const clientCount = options.clientCount ?? 1;
    const startClientOnBoot = options.startClient !== false;
    const adminAccessEnabled = options.adminAccess !== false;
    const adminLogin: AdminLogin = options.adminLogin ?? {username: DEFAULT_ADMIN_USERNAME, password: ADMIN_PASSWORD};
    const identityFixture = options.identityFixture;
    if(identityFixture) {
        const loginUser = identityFixture.users.find((user) => user.username === adminLogin.username);
        if(!loginUser || loginUser.role !== "superuser" || loginUser.password !== adminLogin.password) {
            throw new Error(`identityFixture must contain the adminLogin superuser: ${adminLogin.username}`);
        }
    }

    const createdRoots: string[] = [];
    // 생성 도중 실패 시 정리용: spawn된 모든 프로세스(서버 재시작 이력 포함)를 남긴다.
    const allSpawnedServers: SpawnedProcess[] = [];
    const allSpawnedClients: SpawnedProcess[] = [];

    const cleanupPartial = async (): Promise<void> => {
        for(const proc of allSpawnedClients) await terminate(proc).catch(() => undefined);
        for(const proc of allSpawnedServers) await terminate(proc).catch(() => undefined);
        for(const root of createdRoots) await removeRoot(root).catch(() => undefined);
    };

    try {
        const adminPort = await getFreePort();
        const tunnelPort = await getFreePort();
        const forwardPorts: number[] = [];
        for(const tunnel of options.tunnels) {
            forwardPorts.push(tunnel.forwardPort ?? await getFreePort());
        }

        const rootDir = await mkdtempRoot("tttgate-e2e-server-");
        createdRoots.push(rootDir);
        await makeRootLayout(rootDir);

        const clientIds = Array.from({length: clientCount}, (_, n) => `e2e-client-${n}`);
        const clientRootDirs: string[] = [];
        for(let n = 0; n < clientCount; n++) {
            const clientRootDir = await mkdtempRoot(`tttgate-e2e-client-${n}-`);
            createdRoots.push(clientRootDir);
            await makeRootLayout(clientRootDir);
            clientRootDirs.push(clientRootDir);
        }

        const tunnels = options.tunnels.map((tunnel, i) => ({
            forwardPort: forwardPorts[i],
            protocol: tunnel.protocol,
            destinationAddress: "127.0.0.1",
            destinationPort: tunnel.destinationPort,
            tls: tunnel.tls === true,
            keepAlive: 0,
            allowedClientIds: clientIds,
            ...(tunnel.httpOption ? {httpOption: tunnel.httpOption} : {}),
            ...tunnel.extra
        }));

        const serverOption: Record<string, unknown> = {
            key: "e2e-" + crypto.randomBytes(14).toString("hex"),
            adminPort,
            adminBindHost: "127.0.0.1",
            adminTls: true,
            port: tunnelPort,
            tls: false,
            controlProtocolMode: "mixed",
            allowLegacyControlAuth: false,
            trustedClients: clientIds.map((id, n) => ({clientId: id, clientSecret: `e2e-secret-${n}`, displayName: id})),
            tunnelingOptions: tunnels,
            keepAlive: 0,
            globalMemCacheLimit: 128,
            ...options.serverOptionExtra
        };

        const writeServerYaml = async (): Promise<void> => {
            await fs.promises.writeFile(path.join(rootDir, "config", "server.yaml"), YAML.stringify(serverOption), {encoding: "utf-8"});
        };
        await writeServerYaml();
        if(identityFixture) {
            await fs.promises.writeFile(path.join(rootDir, "config", "identity.yaml"),
                await serializeIdentityFixture(identityFixture), {encoding: "utf-8"});
        } else {
            await fs.promises.writeFile(path.join(rootDir, "config", ".key"), ADMIN_PASSWORD_HASH + "\n", {encoding: "utf-8"});
        }

        for(let n = 0; n < clientCount; n++) {
            const clientOption = {
                key: "hello-TTTGate",
                host: "127.0.0.1",
                port: tunnelPort,
                tls: false,
                name: clientIds[n],
                clientId: clientIds[n],
                clientSecret: `e2e-secret-${n}`,
                displayName: clientIds[n],
                globalMemCacheLimit: 128,
                keepAlive: 0,
                ...options.clientOptionExtra
            };
            await fs.promises.writeFile(path.join(clientRootDirs[n], "config", "client.yaml"), YAML.stringify(clientOption), {encoding: "utf-8"});
        }

        const spawnServer = (): SpawnedProcess => {
            const proc = spawnProcess(process.execPath, [APP_JS, "server"], {
                cwd: rootDir,
                logPrefix: VERBOSE ? "e2e-server" : undefined
            });
            allSpawnedServers.push(proc);
            return proc;
        };

        const spawnClient = (index: number): SpawnedProcess => {
            const proc = spawnProcess(process.execPath, [
                APP_JS, "client",
                "-addr", `127.0.0.1:${tunnelPort}`,
                "-clientId", clientIds[index],
                "-name", clientIds[index]
            ], {
                cwd: clientRootDirs[index],
                // #209: 권장 경로대로 비밀값을 환경 변수로 넘긴다(명령줄은 프로세스 목록에 보인다).
                env: {TTTGATE_CLIENT_SECRET: `e2e-secret-${index}`},
                logPrefix: VERBOSE ? `e2e-client-${index}` : undefined
            });
            allSpawnedClients.push(proc);
            return proc;
        };

        let currentServer = spawnServer();
        const clientProcesses: (SpawnedProcess | undefined)[] = new Array(clientCount).fill(undefined);

        const sessions = new Map<string, {sessionKey: string; csrfToken: string}>();
        const requestFunctions = new Map<string, AdminRequest>();

        // #102 (U2-10) 이 서버의 {key} 별칭을 지웠다. 로그인 본문은 언제나 {username, password} 다.
        const loginBody = (login: AdminLogin): Record<string, string> => ({username: login.username, password: login.password});

        const adminRequestAs = (login: AdminLogin): AdminRequest => {
            const identity = `${login.username}\n${login.password}`;
            const existing = requestFunctions.get(identity);
            if(existing) return existing;

            const doRequest = async (requestPath: string, init: {method?: string; body?: unknown}): Promise<{status: number; json: any}> => {
                const method = init.method ?? "GET";
                const headers: Record<string, string> = {};
                const session = sessions.get(identity);
                if(session) {
                    headers["Cookie"] = `sessionKey=${session.sessionKey}; csrfToken=${session.csrfToken}`;
                }
                if(method !== "GET") {
                    headers["Origin"] = `https://127.0.0.1:${adminPort}`;
                    headers["Content-Type"] = "application/json";
                    if(session) headers["X-CSRF-Token"] = session.csrfToken;
                }
                const body = init.body !== undefined ? JSON.stringify(init.body) : undefined;
                const res = await httpsRequest({port: adminPort, path: requestPath, method, headers, body});
                let json: any = null;
                try { json = res.body.length > 0 ? JSON.parse(res.body) : null; } catch { json = null; }
                return {status: res.statusCode, json};
            };

            const acquireSession = async (): Promise<void> => {
                const headers = {"Origin": `https://127.0.0.1:${adminPort}`, "Content-Type": "application/json"};
                const res = await httpsRequest({port: adminPort, path: "/api/login", method: "POST", headers,
                    body: JSON.stringify(loginBody(login))});
                const json = res.body.length > 0 ? JSON.parse(res.body) : null;
                const setCookieHeader = res.headers["set-cookie"] ?? [];
                const sessionKeyMatch = setCookieHeader.map((c) => c.match(/^sessionKey=([^;]+)/)).find((m) => m)?.[1];
                if(!sessionKeyMatch || !json?.csrfToken) {
                    throw new Error(`admin login failed for ${login.username}: status=${res.statusCode} body=${res.body}`);
                }
                sessions.set(identity, {sessionKey: sessionKeyMatch, csrfToken: json.csrfToken});
            };

            const request: AdminRequest = async (requestPath, init = {}) => {
                if(!sessions.has(identity)) {
                    await acquireSession();
                }
                let result = await doRequest(requestPath, init);
                if(result.status === 401) {
                    sessions.delete(identity);
                    await acquireSession();
                    result = await doRequest(requestPath, init);
                }
                return result;
            };
            requestFunctions.set(identity, request);
            return request;
        };

        const adminRequest = adminRequestAs(adminLogin);

        const waitForAdminReady = async (timeoutMs: number = 20000): Promise<void> => {
            await waitUntil(async () => {
                if(currentServer.child.exitCode !== null) {
                    throw new Error(`Server exited while waiting for admin api.\n${formatTail(currentServer, 50)}`);
                }
                try {
                    const res = await httpsRequest({port: adminPort, path: "/api/version"});
                    return res.statusCode === 200;
                } catch {
                    return false;
                }
            }, {timeoutMs, intervalMs: 200, label: "waitForAdminReady"});
        };

        const waitForTunnelOnline = async (forwardPort: number, timeoutMs: number = 20000): Promise<void> => {
            await waitUntil(async () => {
                if(currentServer.child.exitCode !== null) {
                    throw new Error(`Server exited while waiting for tunnel online.\n${formatTail(currentServer, 50)}`);
                }
                const {status, json} = await adminRequest("/api/externalServerStatuses");
                if(status !== 200 || !json?.statuses) return false;
                const found = (json.statuses as Array<{port: number; online: boolean}>).find((s) => s.port === forwardPort);
                return found?.online === true;
            }, {timeoutMs, intervalMs: 200, label: `waitForTunnelOnline(${forwardPort})`});
        };

        const waitForClientOnline = async (timeoutMs: number = 20000): Promise<void> => {
            const expectedIds = new Set(clientProcesses
                .map((proc, n) => (proc && proc.child.exitCode === null && proc.child.signalCode === null ? clientIds[n] : undefined))
                .filter((id): id is string => id !== undefined));
            await waitUntil(async () => {
                if(currentServer.child.exitCode !== null) {
                    throw new Error(`Server exited while waiting for clients online.\n${formatTail(currentServer, 50)}`);
                }
                const {status, json} = await adminRequest("/api/clientStatus");
                if(status !== 200 || !json?.statuses) return false;
                const onlineIds = new Set<string>((json.statuses as Array<{clientId: string}>).map((s) => s.clientId));
                if(onlineIds.size !== expectedIds.size) return false;
                for(const id of expectedIds) if(!onlineIds.has(id)) return false;
                return true;
            }, {timeoutMs, intervalMs: 200, label: "waitForClientOnline"});
        };

        // U5-03 / #118 — adminAccess: false일 때의 유일한 준비 판정: 서버 stdout에 `Listen - port: <forwardPort>` 로그가 나타나는지.
        const waitForListenLog = async (forwardPort: number, timeoutMs: number = 20000): Promise<void> => {
            const marker = `Listen - port: ${forwardPort}`;
            await waitUntil(() => {
                if(currentServer.child.exitCode !== null) {
                    throw new Error(`Server exited while waiting for listen log.\n${formatTail(currentServer, 50)}`);
                }
                return Buffer.concat(currentServer.stdoutChunks).toString("utf-8").includes(marker);
            }, {timeoutMs, intervalMs: 200, label: `waitForListenLog(${forwardPort})`});
        };

        const disabledFn = (name: string) => async (): Promise<never> => {
            throw new Error(`${name} is disabled when adminAccess is false`);
        };

        if(adminAccessEnabled) {
            await waitForAdminReady();
            for(const forwardPort of forwardPorts) {
                await waitForTunnelOnline(forwardPort);
            }
        } else {
            for(const forwardPort of forwardPorts) {
                await waitForListenLog(forwardPort);
            }
        }

        if(startClientOnBoot) {
            for(let n = 0; n < clientCount; n++) {
                clientProcesses[n] = spawnClient(n);
            }
            if(adminAccessEnabled) {
                await waitForClientOnline();
            }
        }

        const stopClient = async (index: number = 0): Promise<void> => {
            const proc = clientProcesses[index];
            if(!proc || proc.child.exitCode !== null || proc.child.signalCode !== null) return;
            await terminate(proc);
            await waitUntil(async () => {
                const {status, json} = await adminRequest("/api/clientStatus");
                if(status !== 200 || !json?.statuses) return false;
                return !(json.statuses as Array<{clientId: string}>).some((s) => s.clientId === clientIds[index]);
            }, {timeoutMs: 20000, intervalMs: 200, label: `stopClient(${index})`});
        };

        const killClient = async (index: number = 0): Promise<void> => {
            const proc = clientProcesses[index];
            if(!proc || proc.child.exitCode !== null || proc.child.signalCode !== null) return;
            await forceKill(proc);
        };

        const startClient = async (index: number = 0): Promise<void> => {
            const existing = clientProcesses[index];
            if(existing && existing.child.exitCode === null && existing.child.signalCode === null) {
                throw new Error("Client is already running");
            }
            clientProcesses[index] = spawnClient(index);
            await waitForClientOnline();
        };

        const killServer = async (): Promise<void> => {
            await forceKill(currentServer);
        };

        const restartServer = async (patch: {serverOptionExtra?: Partial<ServerOption>} = {}): Promise<void> => {
            await terminate(currentServer);
            if(patch.serverOptionExtra) {
                Object.assign(serverOption, patch.serverOptionExtra);
                await writeServerYaml();
            }
            await startServer();
        };

        const startServer = async (): Promise<void> => {
            if(currentServer.child.exitCode === null && currentServer.child.signalCode === null) throw new Error("Server is already running");
            const deadline = Date.now() + 20000;
            for(;;) {
                currentServer = spawnServer();
                try {
                    if(adminAccessEnabled) {
                        await waitForAdminReady(Math.max(1000, deadline - Date.now()));
                        for(const forwardPort of forwardPorts) {
                            await waitForTunnelOnline(forwardPort, Math.max(1000, deadline - Date.now()));
                        }
                    } else {
                        for(const forwardPort of forwardPorts) {
                            await waitForListenLog(forwardPort, Math.max(1000, deadline - Date.now()));
                        }
                    }
                    break;
                } catch(err) {
                    // Windows에서 같은 포트 재바인드가 EADDRINUSE로 실패할 수 있다.
                    // 서버가 이미 죽어 있고 시간이 남아 있으면 재시도한다.
                    if(currentServer.child.exitCode === null || Date.now() >= deadline) throw err;
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
            }
            if(adminAccessEnabled) {
                const anyClientRunning = clientProcesses.some((p) => p && p.child.exitCode === null && p.child.signalCode === null);
                if(anyClientRunning) {
                    await waitForClientOnline();
                }
            }
        };

        let disposed = false;
        const dispose = async (): Promise<void> => {
            if(disposed) return;
            disposed = true;
            for(const proc of allSpawnedClients) await terminate(proc).catch(() => undefined);
            for(const proc of allSpawnedServers) await terminate(proc).catch(() => undefined);
            for(const root of createdRoots) await removeRoot(root);
        };

        return {
            rootDir,
            clientRootDirs,
            adminPort,
            tunnelPort,
            tunnels: tunnels.map((t) => ({forwardPort: t.forwardPort, protocol: t.protocol as "tcp" | "http" | "https", destinationPort: t.destinationPort})),
            clientIds,
            get server() { return currentServer; },
            get clients() { return clientProcesses.filter((p): p is SpawnedProcess => p !== undefined); },
            adminRequest: adminAccessEnabled ? adminRequest : disabledFn("adminRequest"),
            adminRequestAs: adminAccessEnabled ? adminRequestAs : () => disabledFn("adminRequestAs"),
            waitForClientOnline: adminAccessEnabled ? waitForClientOnline : disabledFn("waitForClientOnline"),
            waitForTunnelOnline: adminAccessEnabled ? waitForTunnelOnline : disabledFn("waitForTunnelOnline"),
            restartServer,
            killServer,
            startServer,
            stopClient,
            killClient,
            startClient,
            dispose
        };
    } catch(err) {
        await cleanupPartial();
        throw err;
    }
}
