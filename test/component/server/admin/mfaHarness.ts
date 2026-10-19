import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditEvent, AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {ClockRngProvider} from "../../../../src/util/ClockRng";
import {base32Decode} from "../../../../src/server/mfa/Base32";
import {generate} from "../../../../src/server/mfa/Totp";
import {serializeIdentityFixture} from "../../../helpers/identityFixture";
import {getFreePort} from "../../../helpers/network";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot} from "../../../helpers/runtime";

// U4-08 / #127 — 2단계 로그인·강제 게이트·MFA 초기화 테스트가 함께 쓰는 실제 AdminServer 픽스처. 시계는 주입한다.

export const ADMIN_PASSWORD = "test-password-1234";
export const USER_PASSWORD = "user-password-1234";

export type ApiResponse = {status: number; headers: any; body: any; elapsedMs: number};
export type Auth = {Cookie: string; "X-CSRF-Token": string};
export type StubSink = AuditSink & {events: AuditEvent[]};

export type MfaFixture = {
    request: (method: string, target: string, body?: object, headers?: Record<string, string>) => Promise<ApiResponse>;
    /** 1단계까지만 하는 로그인. MFA 가 없으면 auth 가, 있으면 mfaTicket 이 온다. */
    login: (username: string, password: string, headers?: Record<string, string>) => Promise<ApiResponse & {auth?: Auth}>;
    /** MFA 를 켜고 secret·복구 코드를 돌려준다. */
    enable: (auth: Auth) => Promise<{secret: string; recoveryCodes: string[]}>;
    codeOf: (secret: string) => string;
    now: () => number;
    advance: (ms: number) => void;
    sink: StubSink;
    idOf: (username: string) => string;
    /** 이 서버의 Origin(허용된 자기 자신). */
    origin: string;
};

export const authOf = (response: {headers: any}): Auth => {
    const pairs = (response.headers["set-cookie"] as string[]).map((value) => value.split(";")[0]);
    return {
        Cookie: pairs.join("; "),
        "X-CSRF-Token": pairs.find((value) => value.startsWith("csrfToken="))!.slice("csrfToken=".length)
    };
};

export const withMfaServer = async (check: (f: MfaFixture) => Promise<void>,
                                    options: {mfaRequiredForSuperusers?: boolean; trustProxy?: boolean} = {}): Promise<void> => {
    const root = await createTestRoot("mfa-login");
    let api: AdminServer | undefined;
    let offset = 0;
    const now = (): number => Date.now() + offset;
    const bcryptBackup = IdentityStore.bcryptCost;
    try {
        IdentityStore.bcryptCost = 4;
        applyTestRoot(root.rootDir);
        ClockRngProvider.configure({now, random: () => Math.random(), secureRandomBytes: (n: number) => crypto.randomBytes(n)});
        await CertificationStore.instance.load();
        const store = ServerOptionStore.instance;
        if(!store.updateServerOption({...store.serverOption, port: await getFreePort(), adminBindHost: "127.0.0.1",
            adminTls: false, tls: false, keepAlive: 0, tunnelingOptions: [], mfaRequiredForSuperusers: options.mfaRequiredForSuperusers === true})) {
            throw new Error("mfa fixture: invalid server option");
        }
        await fs.writeFile(path.join(root.rootDir, "config", "identity.yaml"), await serializeIdentityFixture({users: [
            {username: "admin", password: ADMIN_PASSWORD, role: "superuser"},
            {username: "alice", password: USER_PASSWORD, role: "regular"},
            {username: "bob", password: USER_PASSWORD, role: "regular"},
        ]}), "utf8");
        IdentityStore.resetForTest();
        await IdentityMigration.runAtStartup();

        api = new AdminServer(undefined as any, false);
        const port = await api.listen(0, "127.0.0.1");
        const request = async (method: string, target: string, body: object = {}, headers: Record<string, string> = {}): Promise<ApiResponse> => {
            const bytes = JSON.stringify(body);
            const startedAt = Date.now();
            const response = await httpRequest({
                port, path: target, method,
                headers: {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bytes)), ...headers},
                body: bytes
            });
            let parsed: any;
            try { parsed = JSON.parse(response.body); } catch { parsed = response.body; }
            return {status: response.statusCode, headers: response.headers, body: parsed, elapsedMs: Date.now() - startedAt};
        };
        const login = async (username: string, password: string, headers: Record<string, string> = {}) => {
            const response = await request("POST", "/api/login", {username, password}, headers);
            return response.status === 200 && response.headers["set-cookie"] ? {...response, auth: authOf(response)} : response;
        };
        const codeOf = (secret: string): string => generate(base32Decode(secret)!, now());
        const enable = async (auth: Auth) => {
            const enrolled = await request("POST", "/api/me/mfa/enroll", {}, auth);
            if(enrolled.status !== 200) throw new Error(`enroll failed: ${JSON.stringify(enrolled.body)}`);
            const confirmed = await request("POST", "/api/me/mfa/confirm", {code: codeOf(enrolled.body.secret)}, auth);
            if(confirmed.status !== 200) throw new Error(`confirm failed: ${JSON.stringify(confirmed.body)}`);
            return {secret: enrolled.body.secret as string, recoveryCodes: enrolled.body.recoveryCodes as string[]};
        };
        const sink: StubSink = {
            events: [],
            reserve(): boolean { return true; },
            record(event: AuditEvent): Promise<void> { this.events.push(event); return Promise.resolve(); }
        };
        AuditSinkRegistry.set(sink);
        await check({request, login, enable, codeOf, now, advance: (ms) => { offset += ms; }, sink,
            idOf: (username) => IdentityStore.instance.userByUsername(username)!.id, origin: `http://127.0.0.1:${port}`});
    } finally {
        IdentityStore.bcryptCost = bcryptBackup;
        AuditSinkRegistry.reset();
        try { await api?.close(); } finally { await cleanupTestRoot(root); }
    }
};
