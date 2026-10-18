import fs from "fs";
import Path from "path";
import YAML from "yaml";
import Files from "../../../../src/util/Files";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {hashLegacyPassword} from "../../../../src/server/rbac/legacyPasswordHash";
import {DEFAULT_GROUP_ATTRIBUTES, UserMfa} from "../../../../src/server/rbac/IdentityTypes";
import {hashRecoveryCode} from "../../../../src/server/mfa/Totp";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

jest.setTimeout(15_000);

describe("IdentityStore", () => {
    let testRoot: TestRoot;

    beforeAll(() => {
        IdentityStore.bcryptCost = 4;
    });

    afterAll(() => {
        IdentityStore.bcryptCost = 12;
    });

    beforeEach(async () => {
        testRoot = await createTestRoot("identity-store");
        applyTestRoot(testRoot.rootDir);
        IdentityStore.resetForTest();
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    const identityYamlPath = (): string => Path.join(testRoot.rootDir, "config", "identity.yaml");

    it("starts empty when no identity.yaml exists", () => {
        const result = IdentityStore.instance.load();
        expect(result).toEqual({success: true, source: "empty"});
        expect(IdentityStore.instance.users()).toHaveLength(0);
        expect(IdentityStore.instance.groups()).toHaveLength(2);
    });

    it("hashes a new user's password with the configured bcrypt cost", async () => {
        IdentityStore.instance.load();
        const result = await IdentityStore.instance.createUser({
            username: "alice",
            role: "regular",
            password: "test-password-1234",
            mustChangePassword: false
        });
        expect(result.success).toBe(true);
        if(result.success) {
            expect(result.value.passwordHash).toMatch(/^\$2[aby]\$04\$/);
        }
    });

    it("round-trips users and groups through identity.yaml", async () => {
        IdentityStore.instance.load();
        await IdentityStore.instance.createUser({username: "root", role: "superuser", password: "super-password-1", mustChangePassword: false});
        await IdentityStore.instance.createUser({username: "bob", role: "regular", password: "bob-password-1234", mustChangePassword: false});
        IdentityStore.instance.createGroup({name: "custom-group"});

        const usersBefore = IdentityStore.instance.users();
        const groupsBefore = IdentityStore.instance.groups();

        IdentityStore.resetForTest();
        const loadResult = IdentityStore.instance.load();

        expect(loadResult).toEqual({success: true, source: "file"});
        expect(IdentityStore.instance.users()).toEqual(usersBefore);
        expect(IdentityStore.instance.groups()).toEqual(groupsBefore);
    });

    it("writes identity.yaml atomically with 0600 and without plaintext passwords", async () => {
        IdentityStore.instance.load();
        await IdentityStore.instance.createUser({username: "carol", role: "regular", password: "test-password-1234", mustChangePassword: false});

        const configDir = Path.join(testRoot.rootDir, "config");
        const leftoverTemp = fs.readdirSync(configDir).filter((name) => name.endsWith(".tmp"));
        expect(leftoverTemp).toHaveLength(0);

        if(process.platform !== "win32") {
            const stat = fs.statSync(identityYamlPath());
            expect(stat.mode & 0o777).toBe(0o600);
        }

        const content = fs.readFileSync(identityYamlPath(), "utf-8");
        expect(content).toContain("passwordHash");
        expect(content).not.toContain("test-password-1234");
    });

    it("rejects createUser when both password and passwordHash are given or missing", async () => {
        IdentityStore.instance.load();
        const both = await IdentityStore.instance.createUser({
            username: "dave", role: "regular", password: "test-password-1234", passwordHash: "x", mustChangePassword: false
        } as never);
        expect(both).toMatchObject({success: false, status: 422, code: "credential_invalid"});

        const neither = await IdentityStore.instance.createUser({
            username: "erin", role: "regular", mustChangePassword: false
        } as never);
        expect(neither).toMatchObject({success: false, status: 422, code: "credential_invalid"});
    });

    it("forces superuser accounts into the superuser group and reserves it from regular users", async () => {
        IdentityStore.instance.load();
        const superuserResult = await IdentityStore.instance.createUser({
            username: "root2", role: "superuser", groupId: "default", password: "super-password-1", mustChangePassword: false
        } as never);
        expect(superuserResult.success).toBe(true);
        if(superuserResult.success) {
            expect(superuserResult.value.groupId).toBe("system:superuser");
        }

        const regularResult = await IdentityStore.instance.createUser({
            username: "frank", role: "regular", groupId: "system:superuser", password: "frank-password-1", mustChangePassword: false
        });
        expect(regularResult).toMatchObject({success: false, status: 422, code: "superuser_group_reserved"});
    });

    it("rejects duplicate usernames and resolves races to a single winner", async () => {
        IdentityStore.instance.load();
        const first = await IdentityStore.instance.createUser({username: "grace", role: "regular", password: "grace-password-1", mustChangePassword: false});
        expect(first.success).toBe(true);
        const second = await IdentityStore.instance.createUser({username: "Grace", role: "regular", password: "grace-password-2", mustChangePassword: false});
        expect(second).toMatchObject({success: false, status: 409, code: "username_taken"});

        IdentityStore.resetForTest();
        IdentityStore.instance.load();
        const [raceA, raceB] = await Promise.all([
            IdentityStore.instance.createUser({username: "heidi", role: "regular", password: "heidi-password-1", mustChangePassword: false}),
            IdentityStore.instance.createUser({username: "HEIDI", role: "regular", password: "heidi-password-2", mustChangePassword: false})
        ]);
        const successes = [raceA, raceB].filter((r) => r.success);
        expect(successes).toHaveLength(1);
        expect(IdentityStore.instance.users().filter((u) => u.username === "heidi")).toHaveLength(1);
    });

    it("#144 validates group names on update and display names on create", async () => {
        IdentityStore.instance.load();
        const group = IdentityStore.instance.createGroup({name: "Ops"});
        expect(group.success).toBe(true);
        if(!group.success) return;
        for(const name of [5, "", "   ", "x".repeat(65), null, {}]) {
            expect(IdentityStore.instance.updateGroup(group.value.id, {name: name as any}))
                .toMatchObject({success: false, status: 422, code: "group_name_invalid"});
        }
        expect(IdentityStore.instance.group(group.value.id)!.name).toBe("Ops");
        const renamed = IdentityStore.instance.updateGroup(group.value.id, {name: "  Ops West  "});
        expect(renamed.success).toBe(true);
        expect(IdentityStore.instance.group(group.value.id)!.name).toBe("Ops West");

        for(const displayName of [5, "", "x".repeat(65)]) {
            const created = await IdentityStore.instance.createUser({username: "judy", displayName: displayName as any, role: "regular", password: "judy-password-1", mustChangePassword: false});
            expect(created).toMatchObject({success: false, status: 422, code: "display_name_invalid"});
        }
        const created = await IdentityStore.instance.createUser({username: "judy", displayName: "  Judy  ", role: "regular", password: "judy-password-1", mustChangePassword: false});
        expect(created.success).toBe(true);
        if(created.success) expect(created.value.displayName).toBe("Judy");
    });

    it("guards the last active superuser from demotion, disabling, and deletion", async () => {
        IdentityStore.instance.load();
        const onlySuperuser = await IdentityStore.instance.createUser({username: "solo", role: "superuser", password: "solo-password-1", mustChangePassword: false});
        expect(onlySuperuser.success).toBe(true);
        if(!onlySuperuser.success) return;
        const soloId = onlySuperuser.value.id;

        expect(IdentityStore.instance.updateUser(soloId, {role: "regular"})).toMatchObject({success: false, status: 409, code: "last_superuser"});
        expect(IdentityStore.instance.updateUser(soloId, {status: "disabled"})).toMatchObject({success: false, status: 409, code: "last_superuser"});
        expect(IdentityStore.instance.deleteUser(soloId)).toMatchObject({success: false, status: 409, code: "last_superuser"});

        const secondSuperuser = await IdentityStore.instance.createUser({username: "backup", role: "superuser", password: "backup-password-1", mustChangePassword: false});
        expect(secondSuperuser.success).toBe(true);

        expect(IdentityStore.instance.updateUser(soloId, {role: "regular"}).success).toBe(true);
        const resetResult = IdentityStore.instance.updateUser(soloId, {role: "superuser"});
        expect(resetResult.success).toBe(true);
        expect(IdentityStore.instance.updateUser(soloId, {status: "disabled"}).success).toBe(true);
        expect(IdentityStore.instance.updateUser(soloId, {status: "active"}).success).toBe(true);
        expect(IdentityStore.instance.deleteUser(soloId).success).toBe(true);
    });

    it("moves a regular user's group automatically when role changes", async () => {
        IdentityStore.instance.load();
        // 승격된 사용자를 다시 강등할 때 마지막 활성 슈퍼유저 가드에 걸리지 않도록 다른 슈퍼유저를 미리 만들어 둔다.
        await IdentityStore.instance.createUser({username: "ivan-superuser", role: "superuser", password: "ivan-superuser-1", mustChangePassword: false});
        const created = await IdentityStore.instance.createUser({username: "ivan", role: "regular", password: "ivan-password-1", mustChangePassword: false});
        expect(created.success).toBe(true);
        if(!created.success) return;

        const promoted = IdentityStore.instance.updateUser(created.value.id, {role: "superuser"});
        expect(promoted.success).toBe(true);
        if(promoted.success) expect(promoted.value.groupId).toBe("system:superuser");

        const demoted = IdentityStore.instance.updateUser(created.value.id, {role: "regular"});
        expect(demoted.success).toBe(true);
        if(demoted.success) expect(demoted.value.groupId).toBe("default");

        const flagged = IdentityStore.instance.updateUser(created.value.id, {mustChangePassword: true, migrationAcknowledged: true});
        expect(flagged.success).toBe(true);
        if(flagged.success) {
            expect(flagged.value.mustChangePassword).toBe(true);
            expect(flagged.value.migrationAcknowledged).toBe(true);
        }
    });

    it("keeps system groups read-only while allowing default's attributes to change", () => {
        IdentityStore.instance.load();
        expect(IdentityStore.instance.updateGroup("system:superuser", {name: "x"})).toMatchObject({success: false, status: 422, code: "system_group_readonly"});
        expect(IdentityStore.instance.updateGroup("system:superuser", {attributes: {max_tunnel_count: 1}})).toMatchObject({success: false, status: 422, code: "system_group_readonly"});
        expect(IdentityStore.instance.updateGroup("default", {name: "x"})).toMatchObject({success: false, status: 422, code: "system_group_readonly"});
        expect(IdentityStore.instance.updateGroup("default", {attributes: {max_tunnel_count: 1}}).success).toBe(true);
    });

    it("prevents deleting system groups or non-empty groups", async () => {
        IdentityStore.instance.load();
        expect(IdentityStore.instance.deleteGroup("default")).toMatchObject({success: false, status: 422, code: "system_group_readonly"});
        expect(IdentityStore.instance.deleteGroup("system:superuser")).toMatchObject({success: false, status: 422, code: "system_group_readonly"});

        const groupResult = IdentityStore.instance.createGroup({name: "custom"});
        expect(groupResult.success).toBe(true);
        if(!groupResult.success) return;
        const groupId = groupResult.value.id;

        await IdentityStore.instance.createUser({username: "judy", role: "regular", groupId, password: "judy-password-1", mustChangePassword: false});
        expect(IdentityStore.instance.deleteGroup(groupId)).toMatchObject({success: false, status: 409, code: "group_not_empty"});

        IdentityStore.instance.deleteUser(IdentityStore.instance.userByUsername("judy")!.id);
        expect(IdentityStore.instance.deleteGroup(groupId).success).toBe(true);
    });

    it("rejects a group attribute update that violates the rewrite/protocol cross rule", () => {
        IdentityStore.instance.load();
        const groupResult = IdentityStore.instance.createGroup({name: "rewrite-group"});
        expect(groupResult.success).toBe(true);
        if(!groupResult.success) return;
        const updateResult = IdentityStore.instance.updateGroup(groupResult.value.id, {attributes: {allowed_protocols: ["HTTP_REWRITE"]}});
        expect(updateResult).toMatchObject({success: false, status: 422, code: "http_rewrite_requires_http"});
    });

    it("validates password strength and verifies a freshly set password", async () => {
        IdentityStore.instance.load();
        const created = await IdentityStore.instance.createUser({username: "kevin", role: "regular", password: "kevin-password-1", mustChangePassword: true});
        expect(created.success).toBe(true);
        if(!created.success) return;

        const tooShort = await IdentityStore.instance.setPassword(created.value.id, "short", {clearMustChange: true});
        expect(tooShort).toMatchObject({success: false, status: 422, code: "password_too_short"});

        const setResult = await IdentityStore.instance.setPassword(created.value.id, "new-password-1234", {clearMustChange: true});
        expect(setResult.success).toBe(true);

        const verifyResult = await IdentityStore.instance.verifyPassword("kevin", "new-password-1234");
        expect(verifyResult).toMatchObject({success: true, rehashed: false});
        expect(IdentityStore.instance.user(created.value.id)!.mustChangePassword).toBe(false);
    });

    it("distinguishes not-found, disabled, and mismatch outcomes on verifyPassword", async () => {
        IdentityStore.instance.load();
        const notFound = await IdentityStore.instance.verifyPassword("nobody", "x");
        expect(notFound).toEqual({success: false, reason: "not-found"});

        const created = await IdentityStore.instance.createUser({username: "laura", role: "regular", password: "laura-password-1", mustChangePassword: false});
        expect(created.success).toBe(true);
        if(!created.success) return;
        IdentityStore.instance.updateUser(created.value.id, {status: "disabled"});
        const disabled = await IdentityStore.instance.verifyPassword("laura", "laura-password-1");
        expect(disabled).toEqual({success: false, reason: "disabled"});

        IdentityStore.instance.updateUser(created.value.id, {status: "active"});
        const mismatch = await IdentityStore.instance.verifyPassword("laura", "wrong-password");
        expect(mismatch).toEqual({success: false, reason: "mismatch"});
    });

    it("upgrades a legacy sha512 password hash to bcrypt on successful verification", async () => {
        IdentityStore.instance.load();
        const created = await IdentityStore.instance.createUser({
            username: "mallory",
            role: "regular",
            passwordHash: hashLegacyPassword("legacy-pass-1"),
            mustChangePassword: false
        } as never);
        expect(created.success).toBe(true);

        const verifyResult = await IdentityStore.instance.verifyPassword("mallory", "legacy-pass-1");
        expect(verifyResult.success).toBe(true);
        if(verifyResult.success) {
            expect(verifyResult.rehashed).toBe(true);
        }
        const stored = IdentityStore.instance.userByUsername("mallory")!;
        expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    });

    it("serializes the superuser group's attributes as an empty object while keeping other groups fully populated", async () => {
        IdentityStore.instance.load();
        await IdentityStore.instance.createUser({username: "nathan", role: "regular", password: "nathan-password-1", mustChangePassword: false});

        const parsed = YAML.parse(fs.readFileSync(identityYamlPath(), "utf-8"));
        const superuserGroup = parsed.groups.find((g: {id: string}) => g.id === "system:superuser");
        const defaultGroup = parsed.groups.find((g: {id: string}) => g.id === "default");
        expect(superuserGroup.attributes).toEqual({});
        expect(Object.keys(defaultGroup.attributes)).toHaveLength(11);

        IdentityStore.resetForTest();
        IdentityStore.instance.load();
        const loadedSuperuserGroup = IdentityStore.instance.group("system:superuser")!;
        expect(loadedSuperuserGroup.attributes).toEqual(DEFAULT_GROUP_ATTRIBUTES);
        expect(loadedSuperuserGroup.attributes).not.toBe(DEFAULT_GROUP_ATTRIBUTES);
    });

    it("rolls back in-memory state and reports identity_save_failed when the atomic write throws", async () => {
        IdentityStore.instance.load();
        const usersBefore = IdentityStore.instance.users().length;
        const spy = jest.spyOn(Files, "writeAtomicBatchSync").mockImplementation(() => {
            throw new Error("disk full");
        });
        try {
            const result = await IdentityStore.instance.createUser({username: "oliver", role: "regular", password: "oliver-password-1", mustChangePassword: false});
            expect(result).toMatchObject({success: false, status: 422, code: "identity_save_failed"});
            expect(IdentityStore.instance.users()).toHaveLength(usersBefore);
        } finally {
            spy.mockRestore();
        }
    });
});

describe("IdentityStore MFA (#112 U4-04)", () => {
    let testRoot: TestRoot;

    beforeAll(() => { IdentityStore.bcryptCost = 4; });
    afterAll(() => { IdentityStore.bcryptCost = 12; });

    beforeEach(async () => {
        testRoot = await createTestRoot("identity-store-mfa");
        applyTestRoot(testRoot.rootDir);
        IdentityStore.resetForTest();
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    const createAlice = async (): Promise<string> => {
        IdentityStore.instance.load();
        const created = await IdentityStore.instance.createUser({username: "alice", role: "regular", password: "alice-password-1", mustChangePassword: false});
        expect(created.success).toBe(true);
        return created.success ? created.value.id : "";
    };

    const mfaOf = (userId: string, hashes: string[]): UserMfa => ({
        enabled: true, secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", enrolledAt: 1_757_548_800_000, lastUsedStep: 58_584_960,
        recoveryCodeHashes: hashes
    });

    const reload = () => {
        IdentityStore.resetForTest();
        expect(IdentityStore.instance.load()).toEqual({success: true, source: "file"});
        return IdentityStore.instance;
    };

    it("setMfa 는 저장되어 새 인스턴스에서도 같고, clearMfa 뒤에는 mfa 가 없다", async () => {
        const id = await createAlice();
        const hashes = Array.from({length: 10}, (_, i) => hashRecoveryCode(`code-${i}`, id));
        expect(IdentityStore.instance.setMfa(id, mfaOf(id, hashes))).toEqual({success: true, value: undefined});
        expect(reload().user(id)!.mfa).toEqual(mfaOf(id, hashes));

        expect(IdentityStore.instance.clearMfa(id).success).toBe(true);
        expect(reload().user(id)!.mfa).toBeUndefined();
        expect(fs.readFileSync(Path.join(testRoot.rootDir, "config", "identity.yaml"), "utf8")).not.toContain("GEZDGNBVGY3TQOJQ");
    });

    it("markMfaStep 은 lastUsedStep 을 갱신해 저장한다", async () => {
        const id = await createAlice();
        IdentityStore.instance.setMfa(id, mfaOf(id, []));
        expect(IdentityStore.instance.markMfaStep(id, 58_584_999).success).toBe(true);
        expect(reload().user(id)!.mfa!.lastUsedStep).toBe(58_584_999);
    });

    it("replaceRecoveryCodeHashes 는 목록을 통째로 바꾼다", async () => {
        const id = await createAlice();
        IdentityStore.instance.setMfa(id, mfaOf(id, [hashRecoveryCode("old", id)]));
        const next = [hashRecoveryCode("new-1", id), hashRecoveryCode("new-2", id)];
        expect(IdentityStore.instance.replaceRecoveryCodeHashes(id, next).success).toBe(true);
        expect(reload().user(id)!.mfa!.recoveryCodeHashes).toEqual(next);
    });

    it("consumeRecoveryCode 는 해당 해시만 지우고 남은 개수를 돌려준다", async () => {
        const id = await createAlice();
        const hashes = Array.from({length: 10}, (_, i) => hashRecoveryCode(`code-${i}`, id));
        IdentityStore.instance.setMfa(id, mfaOf(id, hashes));

        expect(IdentityStore.instance.consumeRecoveryCode(id, hashes[3])).toEqual({success: true, value: {remaining: 9}});
        const stored = reload().user(id)!.mfa!.recoveryCodeHashes;
        expect(stored).toEqual(hashes.filter((_, i) => i !== 3));

        const missing = IdentityStore.instance.consumeRecoveryCode(id, hashRecoveryCode("not-issued", id));
        expect(missing).toMatchObject({success: false, status: 422, code: "recovery_code_invalid", message: "The code is incorrect."});
        expect(reload().user(id)!.mfa!.recoveryCodeHashes).toHaveLength(9);

        // 이미 쓴 코드는 다시 쓸 수 없다.
        expect(IdentityStore.instance.consumeRecoveryCode(id, hashes[3])).toMatchObject({success: false, code: "recovery_code_invalid"});
    });

    it("user() 가 돌려준 mfa 를 고쳐도 저장소는 바뀌지 않는다", async () => {
        const id = await createAlice();
        const hashes = [hashRecoveryCode("a", id), hashRecoveryCode("b", id)];
        IdentityStore.instance.setMfa(id, mfaOf(id, hashes));
        const copy = IdentityStore.instance.user(id)!;
        copy.mfa!.recoveryCodeHashes.push("tampered");
        copy.mfa!.lastUsedStep = 0;
        expect(IdentityStore.instance.user(id)!.mfa).toEqual(mfaOf(id, hashes));
        expect(IdentityStore.instance.users().find((user) => user.id === id)!.mfa).toEqual(mfaOf(id, hashes));
    });

    it("없는 사용자나 MFA 가 없는 사용자는 실패한다", async () => {
        const id = await createAlice();
        expect(IdentityStore.instance.setMfa("u_missing", mfaOf("u_missing", []))).toMatchObject({success: false, status: 404});
        expect(IdentityStore.instance.markMfaStep(id, 1)).toMatchObject({success: false});
        expect(IdentityStore.instance.consumeRecoveryCode(id, "x")).toMatchObject({success: false, code: "recovery_code_invalid"});
    });
});
