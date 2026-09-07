import {fork} from "child_process";
import * as path from "path";
import {Browser, chromium} from "playwright";

export const startAdminBrowser = async (options: {apiOrigin?: string, preview?: boolean, httpAlias?: boolean} = {}) => {
    const server = fork(path.resolve(__dirname, "../../admin/test/server.mjs"), [], {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {...process.env, ADMIN_TEST_API_ORIGIN: options.apiOrigin,
            NODE_ENV: options.preview ? "production" : "development",
            ADMIN_TEST_HTTP_ALIAS: options.httpAlias ? "1" : "0",
            ADMIN_TEST_PREVIEW: options.preview ? "1" : "0"},
    });
    let output = "";
    server.stdout!.on("data", (chunk) => { output += chunk; });
    server.stderr!.on("data", (chunk) => { output += chunk; });
    let browser: Browser | undefined;
    const close = async () => {
        await browser?.close();
        if(server.exitCode !== null || server.signalCode !== null) return;
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                server.kill();
                reject(new Error(`Admin test server did not stop: ${output}`));
            }, 5000);
            server.once("exit", () => { clearTimeout(timeout); resolve(); });
            if(server.connected) server.send("close");
            else server.kill();
        });
    };
    try {
        const url = await new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Admin test server did not start: ${output}`));
            }, 15_000);
            server.once("message", (message: {url: string}) => {
                clearTimeout(timeout);
                resolve(message.url);
            });
            server.once("error", (error) => { clearTimeout(timeout); reject(error); });
            server.once("exit", (code) => {
                clearTimeout(timeout);
                reject(new Error(`Admin test server exited ${code}: ${output}`));
            });
        });
        browser = await chromium.launch(options.httpAlias ? {
            args: ["--host-resolver-rules=MAP admin.test 127.0.0.1", "--no-proxy-server"],
        } : {});
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        return {page, url, errors, close};
    } catch(error) {
        await close();
        throw error;
    }
};
