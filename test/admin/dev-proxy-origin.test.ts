import fs from "fs/promises";
import path from "path";
import {spawnSync} from "child_process";
import AdminServer from "../../src/server/admin/AdminServer";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../src/server/admin/SessionStore";
import ServerOptionStore from "../../src/server/ServerOptionStore";
import {applyTestRoot, cleanupTestRoot, createTestRoot} from "../helpers/runtime";
import {httpRequest} from "../helpers/http";
import {startAdminBrowser} from "../helpers/adminBrowser";

test.each([false, true])("actual configured proxy adapts only trusted present origins (preview=%s)", async (preview) => {
    if(preview) {
        const adminRoot = path.resolve(__dirname, "../../admin");
        const build = spawnSync(process.execPath, [path.join(adminRoot, "node_modules/vite/bin/vite.js"),
            "build", "--config", "test/proxy-build.config.ts"], {
            cwd: adminRoot, encoding: "utf8", timeout: 30_000, env: {...process.env, NODE_ENV: "production"},
        });
        expect(build.error).toBeUndefined();
        expect({status: build.status, error: build.status ? build.stderr : ""}).toEqual({status: 0, error: ""});
    }
    const root = await createTestRoot("dev-proxy-origin-67");
    let api: AdminServer | undefined;
    let app: Awaited<ReturnType<typeof startAdminBrowser>> | undefined;
    try {
        applyTestRoot(root.rootDir);
        const option = ServerOptionStore.instance.serverOption;
        SessionStore.instance;
        api = new AdminServer({} as any, false);
        const backendPort = await api.listen(0, "127.0.0.1");
        const backendOrigin = `http://127.0.0.1:${backendPort}`;
        const token = (await fs.readFile(path.join(root.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();
        const login = await httpRequest({port: backendPort, path: "/api/login", method: "POST",
            headers: {"Content-Type": "application/json"}, body: JSON.stringify({key: "proxy-browser-password1!", bootstrapToken: token})});
        expect(login.statusCode).toBe(200);
        const cookies = login.headers["set-cookie"]!.map((cookie) => cookie.split(";")[0]);
        const csrf = JSON.parse(login.body).csrfToken;
        const headers = {Cookie: cookies.join("; "), "Content-Type": "application/json", "X-CSRF-Token": csrf};
        const read = JSON.parse((await httpRequest({port: backendPort, path: "/api/serverOption", headers})).body);
        const expectedRevision = read.revisionState.currentRevision;
        const direct = await httpRequest({port: backendPort, path: "/api/serverOption", method: "POST",
            headers: {...headers, Origin: backendOrigin}, body: JSON.stringify({...option, expectedRevision})});
        expect(direct.statusCode).toBe(200);
        app = await startAdminBrowser({preview, proxyTarget: `${backendOrigin}/api`});
        const proxyPort = Number(new URL(app.url).port);
        await app.page.context().addCookies(cookies.map((cookie) => {
            const separator = cookie.indexOf("=");
            return {name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: app!.url,
                httpOnly: cookie.startsWith("sessionKey="), sameSite: "Strict" as const};
        }));
        await app.page.goto(`${app.url}/test/proxy.html`);
        await app.page.waitForFunction(() => typeof (window as any).adminControllers !== "undefined", undefined, {timeout: 5000});
        const browserResult = await app.page.evaluate(async () => {
            const controller = (window as any).adminControllers.server;
            const snapshot = await controller.getServerOption();
            return controller.updateServerOption(snapshot.value, snapshot.revision);
        });
        const probe = async (extra: Record<string, string>, includeToken = true) => {
            const snapshot = JSON.parse((await httpRequest({port: backendPort, path: "/api/serverOption", headers})).body);
            return httpRequest({port: proxyPort, path: "/api/serverOption", method: "POST", headers: {...headers,
                ...(includeToken ? {} : {"X-CSRF-Token": ""}), ...extra},
                body: JSON.stringify({...snapshot.serverOption, expectedRevision: snapshot.revisionState.currentRevision})});
        };
        const cases: Array<[string, Record<string, string>, boolean, number]> = [
            ["localhost alias", {Origin: `http://localhost:${proxyPort}`, Host: `localhost:${proxyPort}`}, true, 200],
            ["IPv6 loopback alias", {Origin: `http://[::1]:${proxyPort}`, Host: `[::1]:${proxyPort}`}, true, 200],
            ["Host authority differs from Origin", {Origin: `http://localhost:${proxyPort}`}, true, 403],
            ["foreign origin", {Origin: "https://evil.example"}, true, 403],
            ["backend origin is foreign to development", {Origin: backendOrigin}, true, 403],
            ["spoofed Host and Origin backend port", {Origin: backendOrigin, Host: `127.0.0.1:${backendPort}`}, true, 403],
            ["wrong scheme", {Origin: app.url.replace("http:", "https:")}, true, 403],
            ["origin credentials", {Origin: app.url.replace("://", "://user@")}, true, 403],
            ["origin path", {Origin: `${app.url}/path`}, true, 403],
            ["origin query", {Origin: `${app.url}?x=1`}, true, 403],
            ["origin fragment", {Origin: `${app.url}#fragment`}, true, 403],
            ["opaque origin", {Origin: "null"}, true, 403],
            ["forwarded headers do not confer trust", {Origin: "https://evil.example", "X-Forwarded-Host": `127.0.0.1:${proxyPort}`, "X-Forwarded-Proto": "http"}, true, 403],
            ["forwarded headers cannot alter socket scheme", {Origin: app.url, "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "https"}, true, 200],
            ["missing CSRF remains rejected", {Origin: app.url}, false, 403],
            ["no Origin retains authenticated CLI behavior", {}, true, 200],
            ["no Origin still needs CSRF", {}, false, 403],
        ];
        const outcomes = [{name: "actual browser mutation", actual: browserResult.success ? 200 : browserResult.status, expected: 200}];
        for(const [name, extra, includeToken, expected] of cases) {
            const response = await probe(extra, includeToken);
            outcomes.push({name, actual: response.statusCode, expected});
        }
        for(const includeToken of [true, false]) {
            const response = await httpRequest({port: proxyPort, path: "/api/externalCert/65000", method: "DELETE",
                headers: {...headers, ...(includeToken ? {} : {"X-CSRF-Token": ""})}});
            outcomes.push({name: `no Origin DELETE (CSRF=${includeToken})`, actual: response.statusCode,
                expected: includeToken ? 200 : 403});
        }
        expect(outcomes).toEqual(outcomes.map(({name, expected}) => ({name, actual: expected, expected})));
        expect(browserResult).toMatchObject({success: true});
        expect(app.errors).toEqual([]);
    } finally {
        try { await app?.close(); }
        finally {
            try { await api?.close(); }
            finally { await cleanupTestRoot(root); }
        }
    }
}, 60_000);
