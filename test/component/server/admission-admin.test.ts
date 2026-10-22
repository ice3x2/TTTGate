import fs from "fs/promises";
import Path from "path";
import AdminServer from "../../../src/server/admin/AdminServer";
import {AdmissionController} from "../../../src/server/security/AdmissionController";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {httpRequest} from "../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(30_000);

describe("AdminServer geo admission", () => {
    let testRoot: TestRoot;
    let adminServer: AdminServer;
    let port: number;

    beforeEach(async () => {
        testRoot = await createTestRoot("admission-admin");
        applyTestRoot(testRoot.rootDir);
        await fs.copyFile(
            Path.join(process.cwd(), "test", "fixtures", "web", "index.html"),
            Path.join(testRoot.rootDir, "web", "index.html")
        );
        ServerOptionStore.instance;
        AdmissionController.resetForTest();
        adminServer = new AdminServer({} as any, false);
        port = await adminServer.listen(0);
    });

    afterEach(async () => {
        await adminServer.close();
        await cleanupTestRoot(testRoot);
        AdmissionController.resetForTest();
    });

    it("destroys the connection before any response when geo denies the admin scope", async () => {
        AdmissionController.instance.configureGeo({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "deny"});

        await expect(httpRequest({port, path: "/api/version"})).rejects.toBeDefined();
    });

    it("responds normally when applyToAdmin is false, even under a deny-everything geo policy", async () => {
        AdmissionController.instance.configureGeo({mode: "deny", countries: [], applyToAdmin: false, unknownPolicy: "deny"});

        const response = await httpRequest({port, path: "/api/version"});
        expect(response.statusCode).toBe(200);
    });

    it("responds normally when unknownPolicy is allow", async () => {
        AdmissionController.instance.configureGeo({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "allow"});

        const response = await httpRequest({port, path: "/api/version"});
        expect(response.statusCode).toBe(200);
    });

    it("responds normally and keeps the geo database unloaded when mode is off", async () => {
        const response = await httpRequest({port, path: "/api/version"});
        expect(response.statusCode).toBe(200);
        expect(AdmissionController.instance.geo.isDatabaseLoaded()).toBe(false);
    });
});
