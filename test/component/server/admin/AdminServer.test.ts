import fs from "fs/promises";
import Path from "path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../../../src/server/admin/SessionStore";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

describe("AdminServer baseline behavior", () => {
    let testRoot: TestRoot;
    let adminServer: AdminServer;
    let port: number;

    beforeEach(async () => {
        testRoot = await createTestRoot("admin-server");
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

    it("serves index.html from the configured web root", async () => {
        const response = await httpRequest({port, path: "/"});

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain("baseline admin index");
        expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    });

    it("returns 404 for missing static assets", async () => {
        const response = await httpRequest({port, path: "/missing.txt"});

        expect(response.statusCode).toBe(404);
        expect(response.body).toContain("Not Found /missing.txt");
    });

    it("issues a session cookie on login and validates it on follow-up requests", async () => {
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

        expect(loginResponse.statusCode).toBe(200);
        const setCookie = loginResponse.headers["set-cookie"];
        expect(setCookie).toBeDefined();

        const response = await httpRequest({
            port,
            path: "/api/validateSession",
            headers: {
                cookie: (setCookie as string[])[0].split(";")[0]
            }
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({success: true, valid: true});
    });
});
