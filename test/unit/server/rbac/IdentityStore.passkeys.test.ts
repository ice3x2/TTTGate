import fs from "fs";
import Path from "path";
import YAML from "yaml";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import type {Passkey} from "../../../../src/server/passkey/Passkey";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

// #336 REQ-1 — identity.yaml 의 사용자 항목에 저장하는 패스키.

jest.setTimeout(15_000);

describe("IdentityStore passkeys (#336)", () => {
    let testRoot: TestRoot;

    beforeAll(() => { IdentityStore.bcryptCost = 4; });
    afterAll(() => { IdentityStore.bcryptCost = 12; });

    beforeEach(async () => {
        testRoot = await createTestRoot("identity-store-passkeys");
        applyTestRoot(testRoot.rootDir);
        IdentityStore.resetForTest();
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    const identityPath = (): string => Path.join(testRoot.rootDir, "config", "identity.yaml");

    const createUser = async (username: string): Promise<string> => {
        const created = await IdentityStore.instance.createUser({username, role: "regular", password: `${username}-password-1`, mustChangePassword: false});
        if(!created.success) throw new Error(created.message);
        return created.value.id;
    };

    const passkey = (id: string, overrides: Partial<Passkey> = {}): Passkey => ({
        id, publicKey: `pk-${id}`, counter: 0, transports: ["internal"], rpId: "admin.example.com",
        name: `Key ${id}`, createdAt: 1_700_000_000_000, backedUp: false, ...overrides
    });

    const reload = (): IdentityStore => {
        IdentityStore.resetForTest();
        expect(IdentityStore.instance.load()).toEqual({success: true, source: "file"});
        return IdentityStore.instance;
    };

    it("addPasskey 는 저장되어 다시 읽어도 같다", async () => {
        IdentityStore.instance.load();
        const id = await createUser("alice");
        expect(IdentityStore.instance.addPasskey(id, passkey("cred-1"))).toEqual({success: true, value: undefined});
        expect(reload().user(id)!.passkeys).toEqual([passkey("cred-1")]);
    });

    it("패스키가 없는 기존 사용자는 passkeys 가 없다", async () => {
        IdentityStore.instance.load();
        const id = await createUser("alice");
        expect(reload().user(id)!.passkeys).toBeUndefined();
    });

    it("없는 사용자에게는 더할 수 없다", () => {
        IdentityStore.instance.load();
        expect(IdentityStore.instance.addPasskey("u_missing", passkey("cred-1"))).toMatchObject({success: false, status: 404, code: "user_not_found"});
    });

    it("자격증명 ID 는 모든 사용자를 통틀어 하나뿐이다", async () => {
        IdentityStore.instance.load();
        const alice = await createUser("alice");
        const bob = await createUser("bob");
        expect(IdentityStore.instance.addPasskey(alice, passkey("cred-1")).success).toBe(true);
        expect(IdentityStore.instance.addPasskey(alice, passkey("cred-1"))).toMatchObject({success: false, status: 409, code: "passkey_already_registered"});
        expect(IdentityStore.instance.addPasskey(bob, passkey("cred-1"))).toMatchObject({success: false, status: 409, code: "passkey_already_registered"});
    });

    it("사용자당 20개가 상한이다", async () => {
        IdentityStore.instance.load();
        const id = await createUser("alice");
        for(let i = 0; i < 20; i++) expect(IdentityStore.instance.addPasskey(id, passkey(`cred-${i}`)).success).toBe(true);
        expect(IdentityStore.instance.addPasskey(id, passkey("cred-20"))).toMatchObject({success: false, status: 409, code: "passkey_limit"});
        expect(IdentityStore.instance.user(id)!.passkeys).toHaveLength(20);
    });

    it("removePasskey 는 본인의 패스키만 지우고 지운 항목을 돌려준다", async () => {
        IdentityStore.instance.load();
        const alice = await createUser("alice");
        const bob = await createUser("bob");
        IdentityStore.instance.addPasskey(alice, passkey("cred-a"));
        IdentityStore.instance.addPasskey(bob, passkey("cred-b"));
        expect(IdentityStore.instance.removePasskey(alice, "cred-b")).toMatchObject({success: false, status: 404, code: "passkey_not_found"});
        expect(IdentityStore.instance.removePasskey(alice, "cred-a")).toEqual({success: true, value: passkey("cred-a")});
        const store = reload();
        expect(store.user(alice)!.passkeys ?? []).toEqual([]);
        expect(store.user(bob)!.passkeys).toEqual([passkey("cred-b")]);
    });

    it("없는 사용자의 removePasskey 는 404 user_not_found 다", () => {
        IdentityStore.instance.load();
        expect(IdentityStore.instance.removePasskey("u_missing", "cred")).toMatchObject({success: false, status: 404, code: "user_not_found"});
    });

    it("clearPasskeys 는 모두 지운 수를 돌려주고, 없어도 성공이다", async () => {
        IdentityStore.instance.load();
        const id = await createUser("alice");
        IdentityStore.instance.addPasskey(id, passkey("cred-1"));
        IdentityStore.instance.addPasskey(id, passkey("cred-2"));
        expect(IdentityStore.instance.clearPasskeys(id)).toEqual({success: true, value: {removed: 2}});
        expect(reload().user(id)!.passkeys ?? []).toEqual([]);
        expect(IdentityStore.instance.clearPasskeys(id)).toEqual({success: true, value: {removed: 0}});
        expect(IdentityStore.instance.clearPasskeys("u_missing")).toMatchObject({success: false, status: 404});
    });

    it("findPasskey 는 자격증명 ID 로 주인과 패스키를 찾는다", async () => {
        IdentityStore.instance.load();
        const alice = await createUser("alice");
        IdentityStore.instance.addPasskey(alice, passkey("cred-a"));
        const found = IdentityStore.instance.findPasskey("cred-a");
        expect(found?.user.id).toBe(alice);
        expect(found?.passkey).toEqual(passkey("cred-a"));
        expect(IdentityStore.instance.findPasskey("cred-x")).toBeUndefined();
    });

    it("markPasskeyUsed 는 counter·backedUp·lastUsedAt 을 저장한다", async () => {
        IdentityStore.instance.load();
        const id = await createUser("alice");
        IdentityStore.instance.addPasskey(id, passkey("cred-1"));
        expect(IdentityStore.instance.markPasskeyUsed(id, "cred-1", {counter: 7, backedUp: true, at: 1_700_000_500_000}).success).toBe(true);
        expect(reload().user(id)!.passkeys![0]).toMatchObject({counter: 7, backedUp: true, lastUsedAt: 1_700_000_500_000});
        expect(IdentityStore.instance.markPasskeyUsed(id, "cred-x", {counter: 1, backedUp: false, at: 1})).toMatchObject({success: false, status: 404, code: "passkey_not_found"});
    });

    it("markPasskeyUsed 는 저장된 카운터가 0 보다 크고 새 값이 그 이하면 거절한다(동시 로그인의 되감기 방지)", async () => {
        IdentityStore.instance.load();
        const id = await createUser("alice");
        IdentityStore.instance.addPasskey(id, passkey("cred-1"));
        expect(IdentityStore.instance.markPasskeyUsed(id, "cred-1", {counter: 6, backedUp: false, at: 10}).success).toBe(true);
        expect(IdentityStore.instance.markPasskeyUsed(id, "cred-1", {counter: 5, backedUp: false, at: 11}))
            .toMatchObject({success: false, status: 409, code: "passkey_counter_stale"});
        expect(IdentityStore.instance.markPasskeyUsed(id, "cred-1", {counter: 6, backedUp: false, at: 12}))
            .toMatchObject({success: false, code: "passkey_counter_stale"});
        expect(IdentityStore.instance.user(id)!.passkeys![0]).toMatchObject({counter: 6, lastUsedAt: 10});
    });

    it("카운터를 쓰지 않는 인증기(늘 0)는 계속 쓸 수 있다", async () => {
        IdentityStore.instance.load();
        const id = await createUser("alice");
        IdentityStore.instance.addPasskey(id, passkey("cred-1"));
        expect(IdentityStore.instance.markPasskeyUsed(id, "cred-1", {counter: 0, backedUp: true, at: 10}).success).toBe(true);
        expect(IdentityStore.instance.markPasskeyUsed(id, "cred-1", {counter: 0, backedUp: true, at: 11}).success).toBe(true);
    });

    it("읽을 때 transports 를 허용 값으로 다듬고, 다른 사용자와 겹치는 자격증명 ID 는 버린다", async () => {
        IdentityStore.instance.load();
        const alice = await createUser("alice");
        const bob = await createUser("bob");
        IdentityStore.instance.addPasskey(alice, passkey("cred-1"));
        IdentityStore.instance.addPasskey(bob, passkey("cred-2"));
        const raw = YAML.parse(fs.readFileSync(identityPath(), "utf8"));
        const aliceRaw = raw.users.find((entry: {id: string}) => entry.id === alice);
        const bobRaw = raw.users.find((entry: {id: string}) => entry.id === bob);
        aliceRaw.passkeys[0].transports = ["usb", "junk", 7];
        bobRaw.passkeys.push({...aliceRaw.passkeys[0], name: "copy"});
        fs.writeFileSync(identityPath(), YAML.stringify(raw), "utf8");

        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const store = reload();
            expect(store.user(alice)!.passkeys![0].transports).toEqual(["usb"]);
            expect(store.user(bob)!.passkeys!.map((entry) => entry.id)).toEqual(["cred-2"]);
            expect(store.findPasskey("cred-1")!.user.id).toBe(alice);
        } finally {
            warn.mockRestore();
        }
    });

    it("user()·findPasskey() 가 돌려준 패스키를 고쳐도 저장소는 바뀌지 않는다", async () => {
        IdentityStore.instance.load();
        const id = await createUser("alice");
        IdentityStore.instance.addPasskey(id, passkey("cred-1"));
        const copy = IdentityStore.instance.user(id)!;
        copy.passkeys![0].counter = 99;
        copy.passkeys![0].transports.push("usb");
        copy.passkeys!.push(passkey("cred-2"));
        IdentityStore.instance.findPasskey("cred-1")!.passkey.name = "changed";
        expect(IdentityStore.instance.user(id)!.passkeys).toEqual([passkey("cred-1")]);
    });

    it("읽을 때 형식이 틀린 패스키 항목은 버리고 경고하며, 나머지는 그대로 읽는다", async () => {
        IdentityStore.instance.load();
        const id = await createUser("alice");
        IdentityStore.instance.addPasskey(id, passkey("cred-good"));
        const raw = YAML.parse(fs.readFileSync(identityPath(), "utf8"));
        const user = raw.users.find((entry: {id: string}) => entry.id === id);
        user.passkeys.push({id: "cred-bad", counter: "x"}, "junk");
        fs.writeFileSync(identityPath(), YAML.stringify(raw), "utf8");

        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const store = reload();
            expect(store.user(id)!.passkeys).toEqual([passkey("cred-good")]);
            expect(store.user(id)!.username).toBe("alice");
        } finally {
            warn.mockRestore();
        }
    });

    it("passkeys 가 배열이 아니면 패스키 없이 읽는다", async () => {
        IdentityStore.instance.load();
        const id = await createUser("alice");
        const raw = YAML.parse(fs.readFileSync(identityPath(), "utf8"));
        raw.users.find((entry: {id: string}) => entry.id === id).passkeys = "oops";
        fs.writeFileSync(identityPath(), YAML.stringify(raw), "utf8");
        expect(reload().user(id)!.passkeys).toBeUndefined();
    });
});
