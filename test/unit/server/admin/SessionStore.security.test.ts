import fs from "fs";
import Path from "path";
import {createHash} from "node:crypto";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../../../src/server/admin/SessionStore";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

const legacyHashPassword = (password: string): string => {
    const normalizedPassword = password.trim() + "@";
    let salt = "";
    for(let i = 0; i < normalizedPassword.length; i += 1) {
        salt += Math.round(normalizedPassword.charCodeAt(i) / 2).toString(16);
    }
    return createHash('sha512').update(normalizedPassword + salt).digest('hex');
};

// OS 가드: POSIX 모드 비트(0o600) 검증은 Windows에서 의미가 없다(NTFS는 다른 ACL 모델).
// Windows에서 stat.mode는 0o666으로 보고되므로 기대값과 충돌한다.
// MEDIUM-B 라운드 4 수정: describe 전체 skip은 과도했음. chmod 모드 비트 검증(0o600)을
// 포함하는 개별 expect만 플랫폼 가드하고, 나머지 로직(bootstrap token 흐름, legacy → bcrypt 업그레이드)은
// Windows에서도 실행하여 회귀 방지. Jest mock 금지 원칙은 유지.

describe("SessionStore security behavior", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("session-store-security");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    const isPosix = process.platform !== "win32";

    it("creates a bootstrap token file and requires it for first login", async () => {
        const store = SessionStore.instance;
        const bootstrapTokenFile = Path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME);
        const bootstrapToken = fs.readFileSync(bootstrapTokenFile, {encoding: "utf-8"}).trim();
        const stat = fs.statSync(bootstrapTokenFile);

        const deniedLogin = await store.loginWithDetails("supersecret1");
        const bootstrapLogin = await store.loginWithDetails("supersecret1", bootstrapToken);

        // MEDIUM-B: chmod 모드 비트 검증은 POSIX 한정 (NTFS는 모드 비트 의미 없음).
        if (isPosix) {
            expect(stat.mode & 0o777).toBe(0o600);
        }
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
        // MEDIUM-B: chmod 모드 비트 검증은 POSIX 한정.
        if (isPosix) {
            expect((fs.statSync(keyFile).mode & 0o777)).toBe(0o600);
        }
    });
});
