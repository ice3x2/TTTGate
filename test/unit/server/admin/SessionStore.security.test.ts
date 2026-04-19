import fs from "fs";
import Path from "path";
import CryptoJS from "crypto-js";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../../../src/server/admin/SessionStore";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

const legacyHashPassword = (password: string): string => {
    const normalizedPassword = password.trim() + "@";
    let salt = "";
    for(let i = 0; i < normalizedPassword.length; i += 1) {
        salt += Math.round(normalizedPassword.charCodeAt(i) / 2).toString(16);
    }
    return CryptoJS.SHA512(normalizedPassword + salt).toString();
};

describe("SessionStore security behavior", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("session-store-security");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("creates a bootstrap token file with owner-only permissions and requires it for first login", async () => {
        const store = SessionStore.instance;
        const bootstrapTokenFile = Path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME);
        const bootstrapToken = fs.readFileSync(bootstrapTokenFile, {encoding: "utf-8"}).trim();
        const stat = fs.statSync(bootstrapTokenFile);

        const deniedLogin = await store.loginWithDetails("supersecret1");
        const bootstrapLogin = await store.loginWithDetails("supersecret1", bootstrapToken);

        expect(stat.mode & 0o777).toBe(0o600);
        expect(deniedLogin).toMatchObject({
            success: false,
            bootstrapRequired: true,
            invalidBootstrapToken: true
        });
        expect(bootstrapLogin.success).toBe(true);
        expect(fs.existsSync(bootstrapTokenFile)).toBe(false);
    });

    it("upgrades legacy password hashes to bcrypt on successful login", async () => {
        const keyFile = Path.join(testRoot.rootDir, "config", ".key");
        fs.writeFileSync(keyFile, legacyHashPassword("legacy-secret"), {encoding: "utf-8"});

        SessionStore.resetForTest();
        const store = SessionStore.instance;
        const loginResult = await store.loginWithDetails("legacy-secret");
        const savedHash = fs.readFileSync(keyFile, {encoding: "utf-8"}).trim();

        expect(loginResult).toMatchObject({
            success: true,
            migratedLegacyHash: true
        });
        expect(savedHash.startsWith("$2")).toBe(true);
        expect((fs.statSync(keyFile).mode & 0o777)).toBe(0o600);
    });
});
