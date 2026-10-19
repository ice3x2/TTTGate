import fs from "fs";
import Path from "path";
import bcrypt from "bcryptjs";
import Files from "../../../../src/util/Files";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {hashLegacyPassword} from "../../../../src/server/rbac/legacyPasswordHash";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

jest.setTimeout(15_000);

describe("IdentityMigration", () => {
    let testRoot: TestRoot;
    let bcryptCostBackup: number;

    beforeAll(() => {
        bcryptCostBackup = IdentityStore.bcryptCost;
        IdentityStore.bcryptCost = 4;
    });

    afterAll(() => {
        IdentityStore.bcryptCost = bcryptCostBackup;
    });

    beforeEach(async () => {
        testRoot = await createTestRoot("identity-migration");
        applyTestRoot(testRoot.rootDir);
        IdentityStore.resetForTest();
        IdentityMigration.resetForTest();
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    const configDir = (): string => Path.join(testRoot.rootDir, "config");
    const keyPath = (): string => Path.join(configDir(), ".key");
    const identityYamlPath = (): string => Path.join(configDir(), "identity.yaml");
    const bootstrapTokenPath = (): string => Path.join(configDir(), ".bootstrap-token");

    it("migrates a bcrypt legacy key into identity.yaml as the superuser admin", async () => {
        const bcryptHash = await bcrypt.hash("does-not-matter", 4);
        fs.writeFileSync(keyPath(), bcryptHash, {encoding: "utf-8"});

        const outcome = await IdentityMigration.runAtStartup();

        expect(outcome).toEqual({kind: "migrated"});
        expect(fs.existsSync(identityYamlPath())).toBe(true);
        const admin = IdentityStore.instance.userByUsername("admin");
        expect(admin).toBeDefined();
        expect(admin!.role).toBe("superuser");
        expect(admin!.migratedFromLegacyAdmin).toBe(true);
        expect(admin!.passwordHash).toBe(bcryptHash);
        expect(fs.existsSync(keyPath())).toBe(true);
        expect(fs.existsSync(bootstrapTokenPath())).toBe(false);
    });

    it("returns loaded on a second startup without rewriting identity.yaml", async () => {
        const bcryptHash = await bcrypt.hash("does-not-matter", 4);
        fs.writeFileSync(keyPath(), bcryptHash, {encoding: "utf-8"});
        await IdentityMigration.runAtStartup();
        const mtimeBefore = fs.statSync(identityYamlPath()).mtimeMs;

        IdentityStore.resetForTest();
        IdentityMigration.resetForTest();
        const outcome = await IdentityMigration.runAtStartup();

        expect(outcome).toEqual({kind: "loaded"});
        expect(fs.statSync(identityYamlPath()).mtimeMs).toBe(mtimeBefore);
    });

    it("migrates a legacy sha512 key and upgrades it to bcrypt on first successful verification", async () => {
        fs.writeFileSync(keyPath(), hashLegacyPassword("old-pass-1234"), {encoding: "utf-8"});

        const outcome = await IdentityMigration.runAtStartup();
        expect(outcome).toEqual({kind: "migrated"});

        const verifyResult = await IdentityStore.instance.verifyPassword("admin", "old-pass-1234");
        expect(verifyResult).toMatchObject({success: true, rehashed: true});
        const admin = IdentityStore.instance.userByUsername("admin")!;
        expect(admin.passwordHash).toMatch(/^\$2[aby]\$/);
        expect(fs.readFileSync(keyPath(), "utf-8")).toBe(hashLegacyPassword("old-pass-1234"));
    });

    it("requires bootstrap when neither identity.yaml nor a usable .key exists", async () => {
        const outcome = await IdentityMigration.runAtStartup();

        expect(outcome).toEqual({kind: "bootstrap-required"});
        expect(IdentityMigration.bootstrapRequired()).toBe(true);
        const token = fs.readFileSync(bootstrapTokenPath(), "utf-8").trim();
        expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it("treats an empty .key the same as a missing one", async () => {
        fs.writeFileSync(keyPath(), "", {encoding: "utf-8"});
        const outcome = await IdentityMigration.runAtStartup();
        expect(outcome).toEqual({kind: "bootstrap-required"});
    });

    describe("completeBootstrap", () => {
        let bootstrapToken: string;

        beforeEach(async () => {
            await IdentityMigration.runAtStartup();
            bootstrapToken = fs.readFileSync(bootstrapTokenPath(), "utf-8").trim();
        });

        it("rejects a weak password", async () => {
            const result = await IdentityMigration.completeBootstrap({username: "root", password: "short", bootstrapToken});
            expect(result).toMatchObject({success: false, weakPassword: true});
        });

        it("rejects an invalid bootstrap token", async () => {
            const result = await IdentityMigration.completeBootstrap({username: "root", password: "root-password-1234", bootstrapToken: "wrong-token"});
            expect(result).toMatchObject({success: false, invalidBootstrapToken: true});
        });

        it("rejects an invalid username", async () => {
            const result = await IdentityMigration.completeBootstrap({username: "A B", password: "root-password-1234", bootstrapToken});
            expect(result).toMatchObject({success: false, invalidUsername: true});
        });

        it("creates the first superuser and closes bootstrap on success", async () => {
            const result = await IdentityMigration.completeBootstrap({username: "root", password: "root-password-1234", bootstrapToken});
            expect(result.success).toBe(true);
            expect(IdentityStore.instance.userByUsername("root")).toMatchObject({role: "superuser"});
            expect(fs.existsSync(bootstrapTokenPath())).toBe(false);
            expect(IdentityMigration.bootstrapRequired()).toBe(false);

            const secondAttempt = await IdentityMigration.completeBootstrap({username: "root2", password: "root-password-1234", bootstrapToken});
            expect(secondAttempt).toEqual({success: false, bootstrapRequired: false});
        });
    });

    it("falls back to legacy mode when identity.yaml is corrupt and verifies against the legacy .key", async () => {
        fs.writeFileSync(identityYamlPath(), "{{not-valid-yaml", {encoding: "utf-8"});
        fs.writeFileSync(keyPath(), hashLegacyPassword("fallback-pass-1"), {encoding: "utf-8"});

        const outcome = await IdentityMigration.runAtStartup();

        expect(outcome).toMatchObject({kind: "legacy-fallback"});
        expect(IdentityStore.instance.mode).toBe("legacy-fallback");
        expect(await IdentityMigration.verifyLegacyKey("fallback-pass-1")).toBe(true);
        expect(await IdentityMigration.verifyLegacyKey("wrong-pass")).toBe(false);
    });

    it("falls back to legacy mode without creating identity.yaml when the atomic write fails", async () => {
        fs.writeFileSync(keyPath(), hashLegacyPassword("save-will-fail-1"), {encoding: "utf-8"});
        const spy = jest.spyOn(Files, "writeAtomicBatchSync").mockImplementation(() => {
            throw new Error("disk full");
        });

        try {
            const outcome = await IdentityMigration.runAtStartup();
            expect(outcome).toMatchObject({kind: "legacy-fallback"});
            expect(fs.existsSync(identityYamlPath())).toBe(false);
        } finally {
            spy.mockRestore();
        }
    });

    describe("hashLegacyPassword", () => {
        it("produces a deterministic 128-char sha512 hex digest matching the re-exported function", () => {
            const direct = hashLegacyPassword("legacy-pass-1");
            expect(direct).toHaveLength(128);
            expect(direct).toMatch(/^[0-9a-f]{128}$/);
            expect(hashLegacyPassword("legacy-pass-1")).toBe(direct);
            expect(IdentityMigration.hashLegacyPassword("legacy-pass-1")).toBe(direct);
        });
    });
});
