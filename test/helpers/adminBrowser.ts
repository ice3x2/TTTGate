import {fork} from "child_process";
import * as path from "path";
import {Browser, chromium} from "playwright";

// Startup diagnostics carry each stage's duration so a timeout report alone
// tells which stage was slow and whether the budget needs to grow.
export const createStageLog = (now: () => number = Date.now) => {
    const started = now();
    const marks = [{stage: "fork-created", at: started}];
    const last = () => marks[marks.length - 1];
    return {
        get current() { return last().stage; },
        record(stage: string) { if(last().stage !== stage) marks.push({stage, at: now()}); },
        format() {
            const ended = now();
            const spans = marks.map((mark, index) => `${mark.stage}=${(marks[index + 1]?.at ?? ended) - mark.at}ms`);
            return `${spans.join(" ")} total=${ended - started}ms`;
        },
    };
};

const ADMIN_TEST_SERVER_START_TIMEOUT_MS = 60_000;
/** 브라우저 실행 기한. Playwright 기본값(3분)에 맡기지 않는다(#273). */
const BROWSER_LAUNCH_TIMEOUT_MS = 30_000;
/** #273: startAdminBrowser 가 쓸 수 있는 가장 긴 시간(개발 서버 기동 + 브라우저 실행). */
export const ADMIN_BROWSER_START_BUDGET_MS = ADMIN_TEST_SERVER_START_TIMEOUT_MS + BROWSER_LAUNCH_TIMEOUT_MS;
/** #273: startAdminBrowser 를 쓰는 테스트의 제한. 기동 예산에 화면 작업 여유를 더한다. */
export const ADMIN_BROWSER_TEST_TIMEOUT_MS = ADMIN_BROWSER_START_BUDGET_MS + 60_000;

/**
 * deadline(절대 시각)을 주면 서버 기동과 브라우저 실행이 그 안에서 끝나야 한다(#273). 실행 기한은 서버가 뜬 뒤 남은 시간으로 정한다.
 */
export const startAdminBrowser = async (options: {apiOrigin?: string, proxyTarget?: string, preview?: boolean, httpAlias?: boolean,
    startTimeoutMs?: number, deadline?: number} = {}) => {
    const remaining = (stageMs: number, stage: string): number => {
        if(options.deadline === undefined) return stageMs;
        const left = options.deadline - Date.now();
        if(left <= 0) throw new Error(`Admin start budget exhausted before stage=${stage}`);
        return Math.min(stageMs, left);
    };
    const startTimeoutMs = remaining(options.startTimeoutMs ?? ADMIN_TEST_SERVER_START_TIMEOUT_MS, "admin-test-server");
    const server = fork(path.resolve(__dirname, "../../admin/test/server.mjs"), [], {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {...process.env, ADMIN_TEST_API_ORIGIN: options.apiOrigin,
            ADMIN_TEST_PROXY_TARGET: options.proxyTarget,
            NODE_ENV: options.preview ? "production" : "development",
            ADMIN_TEST_HTTP_ALIAS: options.httpAlias ? "1" : "0",
            ADMIN_TEST_PREVIEW: options.preview ? "1" : "0"},
    });
    let stdout = "", stderr = "";
    const stages = createStageLog();
    let closeCode: number | null | undefined, closeSignal: string | null | undefined;
    server.stdout!.on("data", (chunk) => { stdout += chunk; });
    server.stderr!.on("data", (chunk) => { stderr += chunk; });
    server.on("close", (code, signal) => { closeCode = code; closeSignal = signal; });
    const diagnostic = () => `pid=${server.pid} ipc=${server.connected} stage=${stages.current} timings=${stages.format()} exitCode=${server.exitCode} exitSignal=${server.signalCode} closeCode=${closeCode} closeSignal=${closeSignal} stdout=${stdout} stderr=${stderr}`;
    let browser: Browser | undefined;
    const close = async () => {
        await browser?.close();
        if(server.exitCode !== null || server.signalCode !== null) return;
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                server.kill();
                reject(new Error(`Admin test server did not stop: ${diagnostic()}`));
            }, 5000);
            server.once("exit", () => { clearTimeout(timeout); resolve(); });
            if(server.connected) server.send("close");
            else server.kill();
        });
    };
    try {
        const url = await new Promise<string>((resolve, reject) => {
            const finish = (error?: Error, url?: string) => {
                clearTimeout(timeout);
                server.off("message", message); server.off("error", failed); server.off("close", closed);
                if(error) reject(error); else resolve(url!);
            };
            const message = (value: any) => {
                if(value && typeof value.stage === "string") stages.record(value.stage);
                if(value && typeof value.url === "string") { stages.record("ipc-ready"); finish(undefined, value.url); }
            };
            const failed = (error: Error) => finish(new Error(`Admin test server error: ${error.message}; ${diagnostic()}`, {cause: error}));
            const closed = () => finish(new Error(`Admin test server closed before ready: ${diagnostic()}`));
            // 개발 서버 기동은 CPU 부하에서 느려진다(#181). 기동 실패는 여전히 이 기한에서 드러난다.
            const timeout = setTimeout(() => finish(new Error(`Admin test server did not start within ${startTimeoutMs}ms: ${diagnostic()}`)), startTimeoutMs);
            server.on("message", message); server.once("error", failed); server.once("close", closed);
        });
        const launchTimeoutMs = remaining(BROWSER_LAUNCH_TIMEOUT_MS, "browser-launch");
        browser = await chromium.launch(options.httpAlias ? {
            args: ["--host-resolver-rules=MAP admin.test 127.0.0.1", "--no-proxy-server"], timeout: launchTimeoutMs,
        } : {timeout: launchTimeoutMs});
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        return {page, url, errors, close};
    } catch(error) {
        try { await close(); }
        catch(cleanupError) {
            throw new AggregateError([error, cleanupError], `Admin startup failed: ${String(error)}; cleanup failed: ${String(cleanupError)}; ${diagnostic()}`);
        }
        throw new Error(`Admin startup failed: ${String(error)}; after cleanup: ${diagnostic()}`, {cause: error});
    }
};
