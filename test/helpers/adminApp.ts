import {ChildProcess, fork} from "child_process";
import fs from "fs/promises";
import path from "path";
import type {Page} from "playwright";
import {cleanupTestRoot, createTestRoot} from "./runtime";
import {startAdminBrowser} from "./adminBrowser";
import {ADMIN_TEST_PASSWORD} from "./adminFixture";
import type {AdminFixture} from "./adminFixture";

export {ADMIN_TEST_PASSWORD};
export type {AdminFixture};

export type AdminApp = {
    page: Page;
    url: string;
    origin: string;
    rootDir: string;
    errors: string[];
    calls(): Promise<Array<{method: string; args: any[]}>>;
    token(): Promise<string>;
    /** U4-06: 서버의 현재 세션 목록(드라이버가 저장소를 읽는다). 요청 세션이 없으므로 current 는 늘 false 다. */
    sessions(): Promise<Array<{id: string; userId: string; username: string; createdAt: number; lastSeenAt: number; ip: string; userAgent: string}>>;
    /** U4-06: user_updated 감사 이벤트 n 건을 파일에 기록하고 내려앉기를 기다린다. */
    seedAudit(n: number): Promise<void>;
    /** U5-06: 드라이버의 실제 리미터에 (port, ip) 차단 하나를 만든다. */
    seedBan(port: number, ip: string): Promise<void>;
    /** U4-07: 드라이버가 들고 있는 사용자의 MFA secret(Base32). */
    mfaSecret(username: string): Promise<string | undefined>;
    /** U4-07: 'rbac-mfa' 가 심은 alice 의 복구 코드 평문. */
    mfaRecoveryCodes(username: string): Promise<string[]>;
    /** U4-07: 서버 시계를 ms 만큼 앞당기고 누적 offset 을 돌려준다. */
    advanceClock(ms: number): Promise<number>;
    /** U4-09: 서버 옵션 일부를 드라이버에서 바꾼다. */
    serverOption(patch: Record<string, unknown>): Promise<void>;
    close(): Promise<void>;
};

const BACKEND_START_TIMEOUT_MS = 15_000;
const BACKEND_STOP_TIMEOUT_MS = 10_000;
const CALLS_TIMEOUT_MS = 5_000;

/**
 * login: true(기본)는 admin / ADMIN_TEST_PASSWORD 로, 객체면 그 계정으로 로그인한 뒤 상태 화면까지 기다린다.
 * false 면 로그인 화면에서 멈춘다(#102 U2-10 이 계정 지정을 더했다).
 */
export const startAdminApp = async (options: {fixture?: AdminFixture; login?: boolean | {username: string; password: string};
    /** U4-06: 브라우저 로그인 전에 서버 측에 만들어 둘 세션. 로그인 진입점이 아니라 사전 세션 시드다. */
    extraLogins?: Array<{as: string; userAgent: string}>} = {}): Promise<AdminApp> => {
    const fixture: AdminFixture = options.fixture ?? 'password';
    const shouldLogin = options.login !== false;
    const account = typeof options.login === 'object' ? options.login : {username: 'admin', password: ADMIN_TEST_PASSWORD};
    const root = await createTestRoot(`admin-app-${fixture}`);
    let child: ChildProcess | undefined;
    let browser: Awaited<ReturnType<typeof startAdminBrowser>> | undefined;
    let output = "";

    const closeBackend = async (): Promise<void> => {
        const owned = child;
        if(!owned || owned.exitCode !== null || owned.signalCode !== null) return;
        await new Promise<void>((resolve, reject) => {
            let timedOut = false;
            const timer = setTimeout(() => { timedOut = true; owned.kill("SIGKILL"); }, BACKEND_STOP_TIMEOUT_MS);
            owned.once("exit", (code) => {
                clearTimeout(timer);
                code === 0 && !timedOut ? resolve() : reject(new Error(`Admin backend exited ${code} (timeout=${timedOut}): ${output}`));
            });
            if(owned.connected) owned.send("close");
            else owned.kill();
        });
    };

    const token = async (): Promise<string> =>
        (await fs.readFile(path.join(root.rootDir, "config", ".bootstrap-token"), "utf8")).trim();

    /** 드라이버에 IPC 요청을 보내고 같은 type 의 첫 응답을 기다린다. */
    const ask = <T,>(request: {type: string} & Record<string, unknown>, timeoutMs = CALLS_TIMEOUT_MS): Promise<T> => {
        const owned = child!;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                owned.off("message", listener);
                reject(new Error(`Admin backend did not answer ${request.type} within ${timeoutMs}ms: ${output}`));
            }, timeoutMs);
            const listener = (message: any) => {
                if(!message || message.type !== request.type) return;
                clearTimeout(timer);
                owned.off("message", listener);
                resolve(message as T);
            };
            owned.on("message", listener);
            owned.send(request);
        });
    };

    const calls = async (): Promise<Array<{method: string; args: any[]}>> =>
        (await ask<{calls: Array<{method: string; args: any[]}>}>({type: "calls"})).calls;
    const sessions = async () => (await ask<{sessions: any[]}>({type: "sessions"})).sessions;
    const seedAudit = async (n: number): Promise<void> => { await ask({type: "seedAudit", n}, 30_000); };
    const seedBan = async (port: number, ip: string): Promise<void> => { await ask({type: "seed-ban", port, ip}); };
    const mfaSecret = async (username: string) => (await ask<{secret?: string}>({type: "mfaSecret", username})).secret;
    const mfaRecoveryCodes = async (username: string) => (await ask<{codes: string[]}>({type: "mfaRecoveryCodes", username})).codes;
    const advanceClock = async (ms: number) => (await ask<{offset: number}>({type: "advanceClock", ms})).offset;
    const serverOption = async (patch: Record<string, unknown>): Promise<void> => {
        const result = await ask<{ok: boolean}>({type: "serverOption", patch});
        if(!result.ok) throw new Error(`serverOption patch was rejected: ${JSON.stringify(patch)}`);
    };

    try {
        child = fork(path.resolve(__dirname, "../admin/admin-backend-driver.ts"), [root.rootDir, fixture], {
            execArgv: ["-r", "ts-node/register/transpile-only"], stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
        child.stdout!.on("data", (data) => { output += data; });
        child.stderr!.on("data", (data) => { output += data; });
        const owned = child;
        const port = await new Promise<number>((resolve, reject) => {
            const finish = (error?: Error, port?: number) => {
                clearTimeout(timer);
                owned.off("message", ready); owned.off("error", failed); owned.off("exit", ended);
                if(error) reject(error); else resolve(port!);
            };
            const ready = (message: any) => { if(typeof message?.port === "number") finish(undefined, message.port); };
            const failed = (error: Error) => finish(error);
            const ended = (code: number | null) => finish(new Error(`Admin backend exited ${code}: ${output}`));
            const timer = setTimeout(() => finish(new Error(`Admin backend did not start within ${BACKEND_START_TIMEOUT_MS}ms: ${output}`)), BACKEND_START_TIMEOUT_MS);
            owned.on("message", ready); owned.once("error", failed); owned.once("exit", ended);
        });
        const origin = `http://127.0.0.1:${port}`;
        for(const extra of options.extraLogins ?? []) {
            const result = await ask<{ok: boolean}>({type: "login", username: extra.as, userAgent: extra.userAgent}, 15_000);
            if(!result.ok) throw new Error(`extraLogins: ${extra.as} could not sign in: ${output}`);
        }

        browser = await startAdminBrowser({apiOrigin: origin});
        const page = browser.page;
        await page.setViewportSize({width: 400, height: 800});
        await page.goto(browser.url);

        if(shouldLogin) {
            const ok = () => page.getByRole("button", {name: "OK", exact: true}).click();
            const password = page.locator("#login-password");
            await password.waitFor({state: "visible"});
            await page.locator("#login-username").fill(account.username);
            await password.fill(account.password);
            await ok();
            if(fixture === 'bootstrap') {
                const bootstrapToken = page.locator("#bootstrap-token");
                await bootstrapToken.waitFor({state: "visible"});
                await bootstrapToken.fill(await token());
                await ok();
            }
            // 일반 유저는 #/tunnels, 강제 변경 사용자는 #/me/password 에 도착하므로 해시를 고정하지 않는다(U3-01, U3-02).
            await page.waitForFunction(() => !document.querySelector('#login-password') && document.querySelector('header h1'));
        }

        const ownedBrowser = browser;
        return {
            page, url: ownedBrowser.url, origin, rootDir: root.rootDir, errors: ownedBrowser.errors, calls, token, sessions, seedAudit, seedBan, mfaSecret, mfaRecoveryCodes, advanceClock, serverOption,
            async close(): Promise<void> {
                try { await ownedBrowser.close(); }
                finally {
                    try { await closeBackend(); }
                    finally { await cleanupTestRoot(root); }
                }
            },
        };
    } catch(error) {
        // 시작 도중 실패하면 확보한 자원을 같은 순서로 정리하고 원래 오류를 그대로 던진다.
        try { await browser?.close(); } catch {}
        try { await closeBackend(); } catch {}
        try { await cleanupTestRoot(root); } catch {}
        throw error;
    }
};
