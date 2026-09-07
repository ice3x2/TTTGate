import fs from "fs/promises";
import path from "path";
import http from "http";
import net from "net";
import {once} from "events";
import AdminServer from "../../src/server/admin/AdminServer";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../src/server/admin/SessionStore";
import ServerOptionStore from "../../src/server/ServerOptionStore";
import {CertificationStore} from "../../src/server/CertificationStore";
import TTTServer from "../../src/server/TTTServer";
import {applyTestRoot, cleanupTestRoot, createTestRoot, writeWebFixture} from "../helpers/runtime";
import {getFreePort} from "../helpers/network";
import {generateSelfSignedCert} from "../helpers/testCerts";
import {startAdminBrowser} from "../helpers/adminBrowser";

const certificate = generateSelfSignedCert("csrf-browser-test");
const certInfo = {key: {name: "csrf-key.pem", value: certificate.keyPem},
    cert: {name: "csrf-cert.pem", value: certificate.certPem}, ca: {name: "", value: ""}};

type SetupResources = {
    root: Awaited<ReturnType<typeof createTestRoot>>;
    tunnel: TTTServer;
    api: AdminServer;
    port: number;
    forwardPort: number;
    app?: Awaited<ReturnType<typeof startAdminBrowser>>;
};

const setup = async (observe?: (resources: SetupResources) => void) => {
    const root = await createTestRoot("admin-csrf-browser");
    let ownedTunnel: TTTServer | undefined;
    let ownedApi: AdminServer | undefined;
    let ownedApp: Awaited<ReturnType<typeof startAdminBrowser>> | undefined;
    let apiClosed = false;
    const close = async () => {
        try {
            await ownedApp?.close();
        } finally {
            try {
                if(!apiClosed) await ownedApi?.close();
            } finally {
                try {
                    await ownedTunnel?.close();
                } finally {
                    await cleanupTestRoot(root);
                }
            }
        }
    };
    try {
        applyTestRoot(root.rootDir);
        await CertificationStore.instance.load();
        const forwardPort = await getFreePort();
        const addedPort = await getFreePort();
        const option = {forwardPort, protocol: "tcp" as const, destinationAddress: "127.0.0.1", destinationPort: 9,
            tls: false, keepAlive: 0, inactiveOnStartup: true, bufferLimitOnServer: 8, bufferLimitOnClient: 8};
        if(!ServerOptionStore.instance.updateServerOption({...ServerOptionStore.instance.serverOption,
            port: await getFreePort(), tunnelingOptions: [option]})) throw new Error("Invalid test server configuration");
        const tunnel = TTTServer.create(ServerOptionStore.instance.serverOption);
        ownedTunnel = tunnel;
        await tunnel.start();
        const api = new AdminServer(tunnel, false);
        ownedApi = api;
        const port = await api.listen(0, "127.0.0.1");
        observe?.({root, tunnel, api, port, forwardPort});
        const app = await startAdminBrowser();
        ownedApp = app;
        observe?.({root, tunnel, api, port, forwardPort, app});
        await writeWebFixture(root.rootDir, "index.html", `<script type="module" src="${app.url}/test/requests.ts"></script>`);
        await writeWebFixture(root.rootDir, "invalid.json", "not-json");
        await writeWebFixture(root.rootDir, "invalid-envelope.json", "{}");
        await app.page.goto(`http://127.0.0.1:${port}`);
        await app.page.waitForFunction(() => typeof (window as any).adminControllers !== "undefined");
        SessionStore.instance;
        const bootstrapToken = (await fs.readFile(path.join(root.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();
        const login = await app.page.evaluate(async (token: string) => {
            const response = await fetch("/api/login", {method: "POST", credentials: "same-origin",
                headers: {"Content-Type": "application/json"}, body: JSON.stringify({key: "csrf-browser-test1!", bootstrapToken: token})});
            return {status: response.status, body: await response.json()};
        }, bootstrapToken);
        expect(login.status).toBe(200);
        expect(login.body.success).toBe(true);
        const requests: Array<{path: string, method: string, headers: Record<string, string>}> = [];
        const responses: Array<{method: string, status: number}> = [];
        app.page.on("request", (request) => {
            const url = new URL(request.url());
            if(url.port === String(port)) requests.push({path: url.pathname, method: request.method(), headers: request.headers()});
        });
        app.page.on("response", (response) => {
            if(new URL(response.url()).port === String(port)) responses.push({method: response.request().method(), status: response.status()});
        });
        return {app, option, forwardPort, addedPort, requests, responses, tunnel,
            async exposeHelper() {
                await app.page.addScriptTag({type: "module", content:
                    `import {adminRequest} from '${app.url}/src/controller/AdminRequest.ts'; window.adminRequest = adminRequest;`});
                await app.page.waitForFunction(() => typeof (window as any).adminRequest === "function", undefined, {timeout: 5000});
            },
            async closeApi() { await api.close(); apiClosed = true; },
            close,
        };
    } catch(error) {
        try {
            await close();
        } finally {
            throw error;
        }
    }
};

test.each([false, true])("setup failure releases real resources (browser acquired=%s)", async (withBrowser) => {
    const failure = new Error("intentional setup checkpoint failure");
    let acquired: SetupResources | undefined;
    try {
        await expect(setup((resources) => {
            acquired = resources;
            if(Boolean(resources.app) === withBrowser) throw failure;
        })).rejects.toBe(failure);
        expect(acquired).toBeDefined();
        await expect(fs.access(acquired!.root.rootDir)).rejects.toMatchObject({code: "ENOENT"});
        if(acquired!.app) expect(acquired!.app.page.isClosed()).toBe(true);
        for(const port of [acquired!.port, acquired!.forwardPort]) {
            const listener = net.createServer();
            try {
                listener.listen(port, "127.0.0.1");
                await once(listener, "listening");
            } finally {
                await new Promise<void>((resolve) => listener.close(() => resolve()));
            }
        }
    } finally {
        // Baseline failure must not leak the deliberately acquired real resources.
        if(acquired && await fs.stat(acquired.root.rootDir).then(() => true, () => false)) {
            await acquired.app?.close();
            await acquired.api.close();
            await acquired.tunnel.close();
            await cleanupTestRoot(acquired.root);
        }
    }
}, 45_000);

test("all seven authenticated browser controller mutations succeed against the real admin API", async () => {
    const fixture = await setup();
    try {
        const current = ServerOptionStore.instance.serverOption;
        const results = await fixture.app.page.evaluate(async (data) => {
            const {server, certificates} = (window as any).adminControllers;
            const calls = [
                () => server.updateServerOption(data.current),
                () => server.updateTunnelingOption({...data.option, forwardPort: data.addedPort}),
                () => server.removeTunnelingOption({forwardPort: data.addedPort}),
                () => server.activeExternalPortServer(true, data.forwardPort),
                () => certificates.updateAdminCert(data.certInfo),
                () => certificates.updateExternalServerCert(data.forwardPort, data.certInfo),
                () => certificates.deleteExternalServerCert(data.forwardPort),
            ];
            const results = [];
            for(const call of calls) results.push(await call());
            return results;
        }, {current, option: fixture.option, addedPort: fixture.addedPort, forwardPort: fixture.forwardPort, certInfo});
        expect(fixture.responses.filter((response) => response.method !== "GET").map((response) => response.status)).toEqual(Array(7).fill(200));
        expect(results.map((result: any) => ({success: result.success, message: result.success ? "" : result.message})))
            .toEqual(Array(7).fill({success: true, message: ""}));
        const mutations = fixture.requests.filter((request) => request.method !== "GET");
        expect(mutations).toHaveLength(7);
        expect(mutations.every((request) => Boolean(request.headers["x-csrf-token"]))).toBe(true);
        expect(mutations.filter((request) => request.method === "POST").every((request) => request.headers["content-type"] === "application/json")).toBe(true);
        expect(fixture.requests.filter((request) => request.path === "/api/csrfToken")).toHaveLength(0);
        expect(ServerOptionStore.instance.getTunnelingOption(fixture.addedPort)).toBeUndefined();
        expect(fixture.tunnel.externalServerStatus(fixture.forwardPort).active).toBe(true);
        expect(CertificationStore.instance.getAdminCert().cert.value).toBe(certInfo.cert.value);
    } finally {
        await fixture.close();
    }
}, 45_000);

test("lost CSRF cookie is restored once before concurrent mutations, without replaying mutations", async () => {
    const fixture = await setup();
    try {
        const current = ServerOptionStore.instance.serverOption;
        const results = await fixture.app.page.evaluate(async (option) => {
            document.cookie = "csrfToken=; Path=/; Max-Age=0";
            const controller = (window as any).adminControllers.server;
            return Promise.all([controller.updateServerOption(option), controller.updateServerOption(option)]);
        }, current);
        expect(results.map((result: any) => result.success)).toEqual([true, true]);
        expect(fixture.requests.filter((request) => request.path === "/api/csrfToken")).toHaveLength(1);
        expect(fixture.requests.filter((request) => request.method === "POST")).toHaveLength(2);
        expect(fixture.requests[0].path).toBe("/api/csrfToken");
    } finally {
        await fixture.close();
    }
}, 45_000);

test("real 403, malformed JSON and network failures remain visible to callers without mutation retries", async () => {
    const fixture = await setup();
    try {
        await fixture.exposeHelper();
        const denied = await fixture.app.page.evaluate(() => (window as any).adminRequest("/api/serverOption", {
            method: "POST", mode: "no-cors", body: "{}",
        }));
        expect(denied).toMatchObject({success: false, status: 403});
        expect(denied.message).toMatch(/CSRF/);
        expect(fixture.requests.filter((request) => request.method === "POST")).toHaveLength(1);
        const invalid = await fixture.app.page.evaluate(() => (window as any).adminRequest("/invalid.json"));
        expect(invalid.success).toBe(false);
        expect(invalid.message).toMatch(/JSON/);
        const missingEnvelope = await fixture.app.page.evaluate(() => (window as any).adminRequest("/invalid-envelope.json"));
        expect(missingEnvelope.success).toBe(false);
        expect(missingEnvelope.message).toMatch(/JSON|response/);
        await fixture.closeApi();
        const failed = await fixture.app.page.evaluate(() => (window as any).adminRequest("/api/serverOption", {method: "POST", body: "{}"}));
        expect(failed.success).toBe(false);
        expect(failed.message).toMatch(/network|reach|fetch/i);
    } finally {
        await fixture.close();
    }
}, 45_000);

test("failed session recovery preserves InvalidSession and sends no mutation", async () => {
    const fixture = await setup();
    try {
        await fixture.app.page.context().clearCookies();
        const failure = await fixture.app.page.evaluate(async (option) => {
            try {
                await (window as any).adminControllers.server.updateServerOption(option);
                return {name: "none"};
            } catch(error) { return {name: (error as Error).name}; }
        }, ServerOptionStore.instance.serverOption);
        expect(failure.name).toBe("InvalidSession");
        expect(fixture.requests.filter((request) => request.method === "POST")).toHaveLength(0);
    } finally {
        await fixture.close();
    }
}, 45_000);

test("foreign URLs and same-origin redirects cannot leak a CSRF token to another origin", async () => {
    const fixture = await setup();
    let foreignRequests = 0;
    let redirectedMutations = 0;
    const foreign = http.createServer((_req, res) => {
        foreignRequests++;
        res.writeHead(200, {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "X-CSRF-Token, Content-Type",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json"});
        res.end('{"success":true}');
    });
    foreign.listen(0, "127.0.0.1");
    await once(foreign, "listening");
    const foreignOrigin = `http://127.0.0.1:${(foreign.address() as import("net").AddressInfo).port}`;
    const redirect = http.createServer((req, res) => {
        if(req.url === "/") {
            res.writeHead(200, {"Content-Type": "text/html"});
            res.end(`<script type="module">import {adminRequest} from '${fixture.app.url}/src/controller/AdminRequest.ts'; window.adminRequest=adminRequest;</script>`);
        } else {
            redirectedMutations++;
            res.writeHead(307, {Location: foreignOrigin});
            res.end();
        }
    });
    redirect.listen(0, "127.0.0.1");
    await once(redirect, "listening");
    try {
        await fixture.exposeHelper();
        const blocked = await fixture.app.page.evaluate((url) => (window as any).adminRequest(url, {method: "POST", body: "{}"}), foreignOrigin);
        expect(blocked.success).toBe(false);
        expect(blocked.message).toMatch(/same.origin/i);
        expect(foreignRequests).toBe(0);
        await fixture.app.page.goto(`http://127.0.0.1:${(redirect.address() as import("net").AddressInfo).port}`);
        await fixture.app.page.waitForFunction(() => typeof (window as any).adminRequest === "function");
        const refused = await fixture.app.page.evaluate(() => (window as any).adminRequest("/redirect", {method: "POST", body: "{}"}));
        expect(refused.success).toBe(false);
        expect(redirectedMutations).toBe(1);
        expect(foreignRequests).toBe(0);
    } finally {
        await fixture.close();
        await Promise.all([new Promise<void>((resolve) => foreign.close(() => resolve())),
            new Promise<void>((resolve) => redirect.close(() => resolve()))]);
    }
}, 45_000);
