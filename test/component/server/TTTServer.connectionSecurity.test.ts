import TTTServer from "../../../src/server/TTTServer";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {CertificationStore} from "../../../src/server/CertificationStore";
import {AdmissionController} from "../../../src/server/security/AdmissionController";
import {getFreePort} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(30_000);

describe("TTTServer connectionSecurity wiring", () => {
    let testRoot: TestRoot;
    let server: TTTServer | undefined;

    beforeEach(async () => {
        testRoot = await createTestRoot("ttt-server-connection-security");
        applyTestRoot(testRoot.rootDir);
        await CertificationStore.instance.load();
        AdmissionController.resetForTest();
    });

    afterEach(async () => {
        await server?.close();
        await cleanupTestRoot(testRoot);
        AdmissionController.resetForTest();
    });

    it("hot-applies a connectionSecurity.geo change without requiring a tunnel-control restart", async () => {
        const store = ServerOptionStore.instance;
        const baseOption = {...store.serverOption, port: await getFreePort(), tunnelingOptions: []};
        server = TTTServer.create(baseOption);

        const denyOption = {
            ...baseOption,
            connectionSecurity: {geo: {mode: "deny" as const, countries: [], applyToAdmin: true, unknownPolicy: "deny" as const}}
        };
        const result = await server.applyServerOption(denyOption, baseOption);

        expect(result.success).toBe(true);
        expect(result.restartRequiredScopes).toEqual([]);
        expect(AdmissionController.instance.admit({kind: "admin"}, "127.0.0.1", 0)).toEqual({allowed: false, reason: "geo-deny"});
    });

    it("restores the previously applied connectionSecurity.geo on restoreRuntimeState", async () => {
        const store = ServerOptionStore.instance;
        const baseOption = {...store.serverOption, port: await getFreePort(), tunnelingOptions: []};
        server = TTTServer.create(baseOption);
        await server.start();

        const snapshot = server.captureRuntimeState();

        const denyOption = {
            ...baseOption,
            connectionSecurity: {geo: {mode: "deny" as const, countries: [], applyToAdmin: true, unknownPolicy: "deny" as const}}
        };
        await server.applyServerOption(denyOption, baseOption);
        expect(AdmissionController.instance.admit({kind: "admin"}, "127.0.0.1", 0)).toEqual({allowed: false, reason: "geo-deny"});

        const failures = await server.restoreRuntimeState(snapshot);

        expect(failures).toEqual([]);
        expect(AdmissionController.instance.admit({kind: "admin"}, "127.0.0.1", 0)).toEqual({allowed: true});
        expect(AdmissionController.instance.geo.isDatabaseLoaded()).toBe(true);
    });
});
