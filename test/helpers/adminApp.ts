import {ChildProcess, fork} from "child_process";
import fs from "fs/promises";
import path from "path";
import type {Page} from "playwright";
import {cleanupTestRoot, createTestRoot} from "./runtime";
import {startAdminBrowser} from "./adminBrowser";

export type AdminFixture = 'bootstrap' | 'password' | 'with-tunnels';

export const ADMIN_TEST_PASSWORD = 'test-password-1234';

export type AdminApp = {
    page: Page;
    url: string;
    origin: string;
    rootDir: string;
    errors: string[];
    calls(): Promise<Array<{method: string; args: any[]}>>;
    token(): Promise<string>;
    close(): Promise<void>;
};

const BACKEND_START_TIMEOUT_MS = 15_000;
const BACKEND_STOP_TIMEOUT_MS = 10_000;
const CALLS_TIMEOUT_MS = 5_000;

export const startAdminApp = async (options: {fixture?: AdminFixture; login?: boolean} = {}): Promise<AdminApp> => {
    const fixture: AdminFixture = options.fixture ?? 'password';
    const shouldLogin = options.login ?? true;
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

    const calls = async (): Promise<Array<{method: string; args: any[]}>> => {
        const owned = child!;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                owned.off("message", listener);
                reject(new Error(`Admin backend did not report calls within ${CALLS_TIMEOUT_MS}ms: ${output}`));
            }, CALLS_TIMEOUT_MS);
            const listener = (message: any) => {
                if(!message || message.type !== "calls") return;
                clearTimeout(timer);
                owned.off("message", listener);
                resolve(message.calls);
            };
            owned.on("message", listener);
            owned.send({type: "calls"});
        });
    };

    try {
        child = fork(path.resolve(__dirname, "../admin/admin-backend-driver.ts"), [root.rootDir, fixture], {
            execArgv: ["-r", "ts-node/register/transpile-only"], stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
        child.stdout!.on("data", (data) => { output += data; });
        child.stderr!.on("data", (data) => { output += data; });
        const port = await new Promise<number>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Admin backend did not start within ${BACKEND_START_TIMEOUT_MS}ms: ${output}`)), BACKEND_START_TIMEOUT_MS);
            child!.once("message", (message: any) => { clearTimeout(timer); resolve(message.port); });
            child!.once("error", (error) => { clearTimeout(timer); reject(error); });
            child!.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Admin backend exited ${code}: ${output}`)); });
        });
        const origin = `http://127.0.0.1:${port}`;

        browser = await startAdminBrowser({apiOrigin: origin});
        const page = browser.page;
        await page.setViewportSize({width: 400, height: 800});
        await page.goto(browser.url);

        if(shouldLogin) {
            const ok = () => page.getByRole("button", {name: "OK", exact: true}).click();
            const password = page.locator("#login-password");
            await password.waitFor({state: "visible"});
            await password.fill(ADMIN_TEST_PASSWORD);
            await ok();
            if(fixture === 'bootstrap') {
                const bootstrapToken = page.locator("#bootstrap-token");
                await bootstrapToken.waitFor({state: "visible"});
                await bootstrapToken.fill(await token());
                await ok();
            }
            await page.waitForFunction(() => location.hash === '#/status');
            await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Status");
        }

        const owned = browser;
        return {
            page, url: owned.url, origin, rootDir: root.rootDir, errors: owned.errors, calls, token,
            async close(): Promise<void> {
                try { await owned.close(); }
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
