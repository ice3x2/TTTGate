import ServerOptionStore from "../../../src/server/ServerOptionStore";
import fs from "node:fs";
import path from "node:path";
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
        const committedOption = store.serverOption;
        const configFile = path.join(testRoot.rootDir, "config/server.yaml");
        const committedBytes = fs.readFileSync(configFile);

        store.recordRollback("server option runtime apply failed", ["admin-server"]);

        expect(store.revisionState.lastRollback).toMatchObject({
            reason: "server option runtime apply failed",
            failedScopes: ["admin-server"],
            attemptedRevision: 3,
            restoredRevision: 2
        });
        expect(store.revisionState).toMatchObject({currentRevision: 2, lastKnownGoodRevision: 1,
            pendingRestartScopes: ["admin-server"]});
        expect(store.serverOption).toEqual(committedOption);
        expect(store.serverOption.adminPort).toBe(9301);
        expect(fs.readFileSync(configFile)).toEqual(committedBytes);
        const persistedState = JSON.parse(fs.readFileSync(path.join(testRoot.rootDir, "config/.server.state.json"), "utf8"));
        expect(persistedState).toMatchObject({currentRevision: 2, lastKnownGoodRevision: 1,
            pendingRestartScopes: ["admin-server"], lastRollback: store.revisionState.lastRollback});
    });
});
