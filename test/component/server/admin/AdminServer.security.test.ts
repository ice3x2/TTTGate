import fs from "fs/promises";
import Path from "path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../../../src/server/admin/SessionStore";
import {AdminSecurityPolicyRegistry, LEGACY_ADMIN_HTTP_FLAG, LEGACY_ADMIN_REMOTE_FLAG} from "../../../../src/server/AdminSecurityPolicy";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

jest.setTimeout(30_000);

describe("AdminServer security hardening", () => {
    let testRoot: TestRoot;
    let adminServer: AdminServer;
    let port: number;

    beforeEach(async () => {
        testRoot = await createTestRoot("admin-server-security");
        applyTestRoot(testRoot.rootDir);
        await fs.copyFile(
            Path.join(process.cwd(), "test", "fixtures", "web", "index.html"),
            Path.join(testRoot.rootDir, "web", "index.html")
        );
        ServerOptionStore.instance;
        adminServer = new AdminServer({} as any, false);
        port = await adminServer.listen(0);
    });

    afterEach(async () => {
        await adminServer.close();
        await cleanupTestRoot(testRoot);
    });

    it("rejects traversal requests and does not fall back unknown api paths to static files", async () => {
        await fs.writeFile(Path.join(testRoot.rootDir, "config", ".key"), "should-not-leak", {encoding: "utf-8"});

        const traversalResponse = await httpRequest({port, path: "/../config/.key"});
        const apiFallbackResponse = await httpRequest({port, path: "/api/does-not-exist"});

        expect(traversalResponse.statusCode).toBe(404);
        expect(traversalResponse.body).not.toContain("should-not-leak");
        expect(apiFallbackResponse.statusCode).toBe(404);
        expect(apiFallbackResponse.body).not.toContain("baseline admin index");
    });

    it("requires a bootstrap token for first-login initialization and removes emptyKey discovery", async () => {
        SessionStore.instance;
        const deniedLogin = await httpRequest({
            port,
            path: "/api/login",
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({key: "supersecret1"})
        });

        const emptyKeyResponse = await httpRequest({port, path: "/api/emptyKey"});
        const bootstrapToken = (await fs.readFile(
            Path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME),
            {encoding: "utf-8"}
        )).trim();
        const bootstrapLogin = await httpRequest({
            port,
            path: "/api/login",
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({key: "supersecret1", bootstrapToken})
        });

        expect(deniedLogin.statusCode).toBe(403);
        expect(JSON.parse(deniedLogin.body)).toMatchObject({
            success: false,
            bootstrapRequired: true,
            invalidBootstrapToken: true
        });
        expect(emptyKeyResponse.statusCode).toBe(404);
        expect(bootstrapLogin.statusCode).toBe(200);
    });

    it("rate limits repeated failed login attempts", async () => {
        SessionStore.instance;
        const bootstrapToken = (await fs.readFile(
            Path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME),
            {encoding: "utf-8"}
        )).trim();

        await httpRequest({
            port,
            path: "/api/login",
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({key: "supersecret1", bootstrapToken})
        });

        for(let i = 0; i < 5; i += 1) {
            const response = await httpRequest({
                port,
                path: "/api/login",
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({key: "wrong-password"})
            });

            expect([401, 429]).toContain(response.statusCode);
        }

        const blockedResponse = await httpRequest({
            port,
            path: "/api/login",
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({key: "wrong-password"})
        });

        expect(blockedResponse.statusCode).toBe(429);
    });

    it("rejects insecure admin option updates without explicit legacy allowances", async () => {
        SessionStore.instance;
        const bootstrapToken = (await fs.readFile(
            Path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME),
            {encoding: "utf-8"}
        )).trim();
        const loginResponse = await httpRequest({
            port,
            path: "/api/login",
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({key: "supersecret1", bootstrapToken})
        });
        const setCookies = loginResponse.headers["set-cookie"] as string[];
        const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
        const csrfCookie = setCookies.find((c) => c.startsWith("csrfToken="))!;
        const csrfToken = csrfCookie.split(";")[0].split("=")[1];
        const read = JSON.parse((await httpRequest({port, path: "/api/serverOption", headers: {cookie}})).body);
        const insecureOption = read.serverOption;
        insecureOption.adminTls = false;
        insecureOption.adminBindHost = "0.0.0.0";

        const response = await httpRequest({
            port,
            path: "/api/serverOption",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                cookie,
                "x-csrf-token": csrfToken
            },
            body: JSON.stringify({...insecureOption, expectedRevision: read.revisionState.currentRevision})
        });

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toMatchObject({
            success: false,
            legacyFlagsRequired: [LEGACY_ADMIN_HTTP_FLAG, LEGACY_ADMIN_REMOTE_FLAG]
        });
    });

    it("allows insecure admin option updates only when explicit legacy allowances are enabled", async () => {
        AdminSecurityPolicyRegistry.configure({
            allowLegacyAdminHttp: true,
            allowLegacyAdminRemote: true
        });
        SessionStore.instance;
        const bootstrapToken = (await fs.readFile(
            Path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME),
            {encoding: "utf-8"}
        )).trim();
        const loginResponse = await httpRequest({
            port,
            path: "/api/login",
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({key: "supersecret1", bootstrapToken})
        });
        const setCookies = loginResponse.headers["set-cookie"] as string[];
        const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
        const csrfCookie = setCookies.find((c) => c.startsWith("csrfToken="))!;
        const csrfToken = csrfCookie.split(";")[0].split("=")[1];
        const read = JSON.parse((await httpRequest({port, path: "/api/serverOption", headers: {cookie}})).body);
        const legacyOption = read.serverOption;
        legacyOption.adminTls = false;
        legacyOption.adminBindHost = "0.0.0.0";

        const response = await httpRequest({
            port,
            path: "/api/serverOption",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                cookie,
                "x-csrf-token": csrfToken
            },
            body: JSON.stringify({...legacyOption, expectedRevision: read.revisionState.currentRevision})
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({
            success: true,
            updated: true
        });
    });
});
