import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

describe("ServerOptionStore revision metadata", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("server-option-revision");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("tracks pending restart scopes and rollback metadata separately from last-known-good", () => {
        const store = ServerOptionStore.instance;

        expect(store.revisionState.currentRevision).toBe(1);
        expect(store.revisionState.lastKnownGoodRevision).toBe(1);

        const commitResult = store.commitPreparedServerOption({
            ...store.serverOption,
            adminPort: 9301
        }, {
            markLastKnownGood: false,
            pendingRestartScopes: ["admin-server"]
        });

        expect(commitResult.success).toBe(true);
        expect(store.revisionState.currentRevision).toBe(2);
        expect(store.revisionState.lastKnownGoodRevision).toBe(1);
        expect(store.revisionState.pendingRestartScopes).toEqual(["admin-server"]);

        store.recordRollback("server option runtime apply failed", ["admin-server"]);

        expect(store.revisionState.lastRollback).toMatchObject({
            reason: "server option runtime apply failed",
            failedScopes: ["admin-server"],
            restoredRevision: 1
        });
    });
});
