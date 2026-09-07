import fs from "fs/promises";
import Path from "path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../../../src/server/admin/SessionStore";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

const loginAndGetCookie = async (port: number, testRoot: TestRoot): Promise<string> => {
    const {cookie} = await loginAndGetAuth(port, testRoot);
    return cookie;
};

const loginAndGetAuth = async (port: number, testRoot: TestRoot): Promise<{cookie: string, csrfToken: string}> => {
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
    return {cookie, csrfToken};
};

describe("AdminServer staged apply behavior", () => {
    let testRoot: TestRoot;
    let adminServer: AdminServer;
    let port: number;
    let tttServerStub: any;

    beforeEach(async () => {
        testRoot = await createTestRoot("admin-server-apply");
        applyTestRoot(testRoot.rootDir);
        await fs.copyFile(
            Path.join(process.cwd(), "test", "fixtures", "web", "index.html"),
            Path.join(testRoot.rootDir, "web", "index.html")
        );
        ServerOptionStore.instance;
        tttServerStub = {
            applyServerOption: jest.fn(),
            applyTunnelingOption: jest.fn(),
            externalServerStatus: jest.fn(() => ({online: false})),
            stopExternalPortServer: jest.fn(async () => true),
            applyExternalServerCert: jest.fn()
        };
        adminServer = new AdminServer(tttServerStub, false);
        port = await adminServer.listen(0);
    });

    afterEach(async () => {
        await adminServer.close();
        await cleanupTestRoot(testRoot);
        jest.restoreAllMocks();
    });

    it("keeps the last committed tunneling option when runtime apply fails", async () => {
        const store = ServerOptionStore.instance;
        store.updateTunnelingOption({
            forwardPort: 18081,
            protocol: "tcp",
            destinationAddress: "127.0.0.1",
            destinationPort: 8080,
            keepAlive: 0
        });
        tttServerStub.applyTunnelingOption.mockResolvedValue({
            success: false,
            partial: false,
            warnings: ["listener restart failed"],
            failedScopes: ["external-listener:18081"],
            restartRequiredScopes: []
        });
        const {cookie, csrfToken} = await loginAndGetAuth(port, testRoot);
        const read = JSON.parse((await httpRequest({port, path: "/api/serverOption", headers: {cookie}})).body);

        const response = await httpRequest({
            port,
            path: "/api/tunnelingOption",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                cookie,
                "x-csrf-token": csrfToken
            },
            body: JSON.stringify({
                expectedRevision: read.revisionState.currentRevision,
                forwardPort: 18081,
                protocol: "tcp",
                destinationAddress: "127.0.0.2",
                destinationPort: 8081,
                keepAlive: 0
            })
        });

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toMatchObject({
            success: false,
            failedScopes: ["external-listener:18081"],
            warnings: ["listener restart failed"]
        });
        expect(store.getTunnelingOption(18081)).toMatchObject({
            destinationAddress: "127.0.0.1",
            destinationPort: 8080
        });
        expect(store.revisionState.lastRollback?.failedScopes).toEqual(["external-listener:18081"]);
    });

    it("commits restart-required server option changes with a partial envelope", async () => {
        tttServerStub.applyServerOption.mockResolvedValue({
            success: true,
            partial: true,
            warnings: ["admin listener changes require process restart"],
            failedScopes: [],
            restartRequiredScopes: ["admin-server"]
        });
        const store = ServerOptionStore.instance;
        const {cookie, csrfToken} = await loginAndGetAuth(port, testRoot);
        const read = JSON.parse((await httpRequest({port, path: "/api/serverOption", headers: {cookie}})).body);
        const nextServerOption = {
            ...store.serverOption,
            adminPort: store.serverOption.adminPort! + 1
        };

        const response = await httpRequest({
            port,
            path: "/api/serverOption",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                cookie,
                "x-csrf-token": csrfToken
            },
            body: JSON.stringify({...nextServerOption, expectedRevision: read.revisionState.currentRevision})
        });

        const body = JSON.parse(response.body);
        expect(response.statusCode).toBe(200);
        expect(body).toMatchObject({
            success: true,
            partial: true,
            restartRequiredScopes: ["admin-server"],
            warnings: ["admin listener changes require process restart"]
        });
        expect(store.serverOption.adminPort).toBe(nextServerOption.adminPort);
        expect(store.revisionState.pendingRestartScopes).toEqual(["admin-server"]);
        expect(store.revisionState.lastKnownGoodRevision).toBe(1);
    });
});
