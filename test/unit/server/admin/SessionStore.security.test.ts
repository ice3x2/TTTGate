import fs from "fs";
import Path from "path";
import YAML from "yaml";
import SessionStore from "../../../../src/server/admin/SessionStore";
import {IdentityMigration, BOOTSTRAP_TOKEN_FILE_NAME} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {hashLegacyPassword} from "../../../../src/server/rbac/legacyPasswordHash";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

// OS 가드: POSIX 모드 비트(0o600) 검증은 Windows에서 의미가 없다(NTFS는 다른 ACL 모델).
// Windows에서 stat.mode는 0o666으로 보고되므로 기대값과 충돌한다.
// MEDIUM-B 라운드 4 수정: describe 전체 skip은 과도했음. chmod 모드 비트 검증(0o600)을
// 포함하는 개별 expect만 플랫폼 가드하고, 나머지 로직(bootstrap token 흐름, legacy → bcrypt 업그레이드)은
// Windows에서도 실행하여 회귀 방지. Jest mock 금지 원칙은 유지.

describe("SessionStore security behavior", () => {
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
        testRoot = await createTestRoot("session-store-security");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    const isPosix = process.platform !== "win32";
    const identityYamlPath = (): string => Path.join(testRoot.rootDir, "config", "identity.yaml");
    const passwordHashOf = (username: string): string => {
        const parsed = YAML.parse(fs.readFileSync(identityYamlPath(), "utf-8"));
        return parsed.users.find((u: {username: string}) => u.username === username).passwordHash;
    };

    it("creates a bootstrap token file and requires it for first login", async () => {
        const outcome = await IdentityMigration.runAtStartup();
        expect(outcome).toEqual({kind: "bootstrap-required"});

        const bootstrapTokenFile = Path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME);
        const bootstrapToken = fs.readFileSync(bootstrapTokenFile, {encoding: "utf-8"}).trim();
        const stat = fs.statSync(bootstrapTokenFile);

        // MEDIUM-B: chmod 모드 비트 검증은 POSIX 한정 (NTFS는 모드 비트 의미 없음).
        if(isPosix) {
            expect(stat.mode & 0o777).toBe(0o600);
        }

        const denied = await IdentityMigration.completeBootstrap({username: "admin", password: "supersecret1"});
        expect(denied).toMatchObject({success: false, bootstrapRequired: true, invalidBootstrapToken: true});

        const accepted = await IdentityMigration.completeBootstrap({username: "admin", password: "supersecret1", bootstrapToken});
        expect(accepted.success).toBe(true);
        expect(fs.existsSync(bootstrapTokenFile)).toBe(false);
    });

    it("upgrades legacy password hashes to bcrypt on successful login", async () => {
        const keyFile = Path.join(testRoot.rootDir, "config", ".key");
        fs.writeFileSync(keyFile, hashLegacyPassword("legacy-pw-1234"), {encoding: "utf-8"});

        const outcome = await IdentityMigration.runAtStartup();
        expect(outcome).toEqual({kind: "migrated"});

        const verifyResult = await IdentityStore.instance.verifyPassword("admin", "legacy-pw-1234");
        expect(verifyResult).toMatchObject({success: true, rehashed: true});
        expect(passwordHashOf("admin")).toMatch(/^\$2/);
    });

    it("removes every session of a user the moment it is disabled", async () => {
        await IdentityMigration.runAtStartup();
        const createResult = await IdentityStore.instance.createUser({
            username: "regular1",
            password: "regular-pass-1",
            role: "regular",
            mustChangePassword: false
        });
        expect(createResult.success).toBe(true);
        const user = (createResult as {success: true; value: {id: string}}).value;

        const store = SessionStore.instance;
        await store.newSession(user.id, {ip: "127.0.0.1"});
        await store.newSession(user.id, {ip: "127.0.0.1"});

        const updateResult = IdentityStore.instance.updateUser(user.id, {status: "disabled"});
        expect(updateResult.success).toBe(true);

        expect(store.listSessions().filter((s) => s.userId === user.id).length).toBe(0);
    });

    it("removes every session of a user when it is deleted", async () => {
        const outcome = await IdentityMigration.runAtStartup();
        expect(outcome).toEqual({kind: "bootstrap-required"});
        const bootstrapTokenFile = Path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME);
        const bootstrapToken = fs.readFileSync(bootstrapTokenFile, {encoding: "utf-8"}).trim();
        await IdentityMigration.completeBootstrap({username: "admin", password: "supersecret1", bootstrapToken});

        // 마지막 슈퍼유저 삭제 방지 규칙을 피하려면 슈퍼유저를 하나 더 만들어 둔다("admin"이 따로 남는다).
        const createResult = await IdentityStore.instance.createUser({
            username: "root2",
            password: "root2-pass-1",
            role: "superuser",
            mustChangePassword: false
        });
        expect(createResult.success).toBe(true);
        const user = (createResult as {success: true; value: {id: string}}).value;

        const store = SessionStore.instance;
        await store.newSession(user.id, {ip: "127.0.0.1"});

        const deleteResult = IdentityStore.instance.deleteUser(user.id);
        expect(deleteResult.success).toBe(true);

        expect(store.listSessions().filter((s) => s.userId === user.id).length).toBe(0);
    });
});
