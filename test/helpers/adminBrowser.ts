import {fork} from "child_process";
import * as path from "path";
import {Browser, chromium} from "playwright";

export const startAdminBrowser = async (options: {apiOrigin?: string, proxyTarget?: string, preview?: boolean, httpAlias?: boolean} = {}) => {
    const server = fork(path.resolve(__dirname, "../../admin/test/server.mjs"), [], {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {...process.env, ADMIN_TEST_API_ORIGIN: options.apiOrigin,
            ADMIN_TEST_PROXY_TARGET: options.proxyTarget,
            NODE_ENV: options.preview ? "production" : "development",
            ADMIN_TEST_HTTP_ALIAS: options.httpAlias ? "1" : "0",
            ADMIN_TEST_PREVIEW: options.preview ? "1" : "0"},
    });
    let stdout = "", stderr = "", stage = "fork-created";
    let closeCode: number | null | undefined, closeSignal: string | null | undefined;
    server.stdout!.on("data", (chunk) => { stdout += chunk; });
    server.stderr!.on("data", (chunk) => { stderr += chunk; });
    server.on("close", (code, signal) => { closeCode = code; closeSignal = signal; });
    const diagnostic = () => `pid=${server.pid} ipc=${server.connected} stage=${stage} exitCode=${server.exitCode} exitSignal=${server.signalCode} closeCode=${closeCode} closeSignal=${closeSignal} stdout=${stdout} stderr=${stderr}`;
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
                if(value && typeof value.stage === "string") stage = value.stage;
                if(value && typeof value.url === "string") { stage = "ipc-ready"; finish(undefined, value.url); }
            };
            const failed = (error: Error) => finish(new Error(`Admin test server error: ${error.message}; ${diagnostic()}`, {cause: error}));
            const closed = () => finish(new Error(`Admin test server closed before ready: ${diagnostic()}`));
            const timeout = setTimeout(() => finish(new Error(`Admin test server did not start within 15000ms: ${diagnostic()}`)), 15_000);
            server.on("message", message); server.once("error", failed); server.once("close", closed);
        });
        browser = await chromium.launch(options.httpAlias ? {
            args: ["--host-resolver-rules=MAP admin.test 127.0.0.1", "--no-proxy-server"],
        } : {});
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
