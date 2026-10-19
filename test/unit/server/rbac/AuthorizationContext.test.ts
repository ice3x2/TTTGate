import fs from "fs";
import Path from "path";
import YAML from "yaml";
import bcrypt from "bcryptjs";
import AuthorizationContextDefault, {AuthorizationContext} from "../../../../src/server/rbac/AuthorizationContext";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {
    cloneGroupAttributes,
    createSystemGroups,
    DEFAULT_GROUP_ATTRIBUTES,
    GroupAttributes,
    MIGRATED_OWNER_ID,
    User
} from "../../../../src/server/rbac/IdentityTypes";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import LoggerFactory from "../../../../src/util/logger/LoggerFactory";
import {TunnelingOption} from "../../../../src/types/TunnelingOption";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

jest.setTimeout(15_000);

const ADMIN = "u_admin0000000000";
const ALICE = "u_alice00000000000";
const GHOST = "u_ghost00000000000";
const FIELD = "g_field00000000000";

const userRecord = (id: string, username: string, role: "superuser" | "regular", groupId: string, passwordHash: string): User => ({
    id, username, displayName: username, role, status: "active", groupId, passwordHash,
    mustChangePassword: false, migratedFromLegacyAdmin: false, migrationAcknowledged: false,
    createdAt: 1_757_548_800_000, updatedAt: 1_757_548_800_000
});

const tcpTunnel = (forwardPort: number, ownerId?: string): TunnelingOption => ({
    forwardPort, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 80, keepAlive: 0,
    ...(ownerId === undefined ? {} : {ownerId})
} as TunnelingOption);

// 5 단위 이슈(#122~#124)는 기본 내보내기 싱글턴으로 가져온다. 두 형태가 같은 객체여야 상태(경고 Set)가 갈리지 않는다.
it("기본 내보내기와 이름 내보내기는 같은 싱글턴 객체다", () => {
    expect(AuthorizationContextDefault).toBe(AuthorizationContext);
});

describe("AuthorizationContext", () => {
    let testRoot: TestRoot;
    let warn: jest.SpyInstance;

    beforeEach(async () => {
        testRoot = await createTestRoot("authorization-context");
        applyTestRoot(testRoot.rootDir);
        const configDir = Path.join(testRoot.rootDir, "config");

        // id 를 고정하기 위해 createUser 를 쓰지 않고 identity.yaml 을 직접 쓴다.
        const passwordHash = bcrypt.hashSync("x", 4);
        const field = {id: FIELD, name: "Field team", system: false, attributes: cloneGroupAttributes(DEFAULT_GROUP_ATTRIBUTES as GroupAttributes)};
        fs.writeFileSync(Path.join(configDir, "identity.yaml"), YAML.stringify({
            version: 1,
            users: [userRecord(ADMIN, "admin", "superuser", "system:superuser", passwordHash), userRecord(ALICE, "alice", "regular", FIELD, passwordHash)],
            groups: [...createSystemGroups(), field]
        }), "utf8");
        expect(IdentityStore.instance.load()).toEqual({success: true, source: "file"});

        // 기본 server.yaml 을 만든 뒤 터널 4개를 넣어 다시 쓰고, 저장소가 그 파일을 새로 읽게 한다.
        ServerOptionStore.instance.getTunnelingOptions();
        const serverYamlPath = Path.join(configDir, "server.yaml");
        const serverOption = YAML.parse(fs.readFileSync(serverYamlPath, "utf8"));
        serverOption.tunnelingOptions = [tcpTunnel(20001), tcpTunnel(20002, ALICE), tcpTunnel(20003, GHOST), tcpTunnel(20004, ADMIN)];
        fs.writeFileSync(serverYamlPath, YAML.stringify(serverOption), "utf8");
        ServerOptionStore.resetForTest();
        expect(ServerOptionStore.instance.getTunnelingOptions().map((option) => option.forwardPort)).toEqual([20001, 20002, 20003, 20004]);

        AuthorizationContext.resetForTest();
        warn = jest.spyOn(LoggerFactory.getLogger("server", "AuthorizationContext"), "warn").mockImplementation(() => undefined);
    });

    afterEach(async () => {
        warn.mockRestore();
        AuthorizationContext.resetForTest();
        await cleanupTestRoot(testRoot);
    });

    const optionAt = (port: number): TunnelingOption => ServerOptionStore.instance.getTunnelingOption(port)!;

    it("ownerIdOf 는 ownerId 가 없으면 system:migrated 다", () => {
        expect(AuthorizationContext.ownerIdOf(optionAt(20001))).toBe("system:migrated");
        expect(AuthorizationContext.ownerIdOf(optionAt(20002))).toBe(ALICE);
        expect(AuthorizationContext.ownerIdOf(optionAt(20003))).toBe(GHOST);
        expect(AuthorizationContext.ownerIdOf(optionAt(20004))).toBe(ADMIN);
    });

    it.each([[""], [12345], [null], [{id: ALICE}]])("형식이 틀린 ownerId %j 는 system:migrated 로 본다", (ownerId) => {
        expect(AuthorizationContext.ownerIdOf({...tcpTunnel(20009), ownerId} as TunnelingOption)).toBe(MIGRATED_OWNER_ID);
    });

    it("ownerOf 는 실재하는 사용자에게만 소유자 정보를 준다", () => {
        expect(AuthorizationContext.ownerOf(20001)).toBeUndefined();
        expect(AuthorizationContext.ownerOf(20002)).toEqual({userId: ALICE, groupId: FIELD, role: "regular"});
        expect(AuthorizationContext.ownerOf(20004)).toEqual({userId: ADMIN, groupId: "system:superuser", role: "superuser"});
        expect(warn).not.toHaveBeenCalled();
    });

    it("없는 사용자가 소유한 포트는 포트당 한 번만 경고하고 resetForTest 뒤 다시 경고한다", () => {
        expect(AuthorizationContext.ownerOf(20003)).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toBe(`tunnel 20003 owner ${GHOST} not found; treating as system:migrated`);

        expect(AuthorizationContext.ownerOf(20003)).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);

        AuthorizationContext.resetForTest();
        expect(AuthorizationContext.ownerOf(20003)).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it("존재하지 않는 포트는 경고 없이 undefined 다", () => {
        expect(AuthorizationContext.ownerOf(65000)).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
    });

    it("targetOf 는 authorize 에 넘길 {port, owner} 를 만든다", () => {
        expect(AuthorizationContext.targetOf(20002)).toEqual({port: 20002, owner: {userId: ALICE, groupId: FIELD}});
        expect(AuthorizationContext.targetOf(20001)).toEqual({port: 20001, owner: undefined});
        expect(AuthorizationContext.targetOf(20003)).toEqual({port: 20003, owner: undefined});
        expect(AuthorizationContext.targetOf(65000)).toEqual({port: 65000, owner: undefined});
    });

    it("그룹 포트·소유 수·슈퍼유저 소유는 실재하는 소유자만 센다", () => {
        expect(AuthorizationContext.portsOfGroup(FIELD)).toEqual([20002]);
        expect(AuthorizationContext.portsOfGroup("system:superuser")).toEqual([20004]);
        expect(AuthorizationContext.portsOfGroup("g_none")).toEqual([]);
        expect(AuthorizationContext.ownedCount(ALICE)).toBe(1);
        expect(AuthorizationContext.ownedCount(GHOST)).toBe(0);
        expect(AuthorizationContext.ownedCount(MIGRATED_OWNER_ID)).toBe(0);
        expect(AuthorizationContext.isSuperuserOwned(20004)).toBe(true);
        expect(AuthorizationContext.isSuperuserOwned(20001)).toBe(false);
        expect(AuthorizationContext.isSuperuserOwned(20002)).toBe(false);
        expect(AuthorizationContext.isSuperuserOwned(20003)).toBe(false);
    });

    it("portsOfGroup 는 포트 오름차순이다", () => {
        expect(ServerOptionStore.instance.updateTunnelingOption(tcpTunnel(20000, ALICE))).toBe(true);
        expect(AuthorizationContext.portsOfGroup(FIELD)).toEqual([20000, 20002]);
    });

    it("groupAttributes 는 없는 그룹이면 기본값의 복사본을 준다", () => {
        const attributes = AuthorizationContext.groupAttributes("g_none");
        expect(attributes).toEqual(DEFAULT_GROUP_ATTRIBUTES);
        expect(attributes).not.toBe(DEFAULT_GROUP_ATTRIBUTES);

        attributes.allowed_port_range.push({from: 1, to: 65535});
        attributes.max_tunnel_count = 999;
        expect(AuthorizationContext.groupAttributes("g_none")).toEqual(DEFAULT_GROUP_ATTRIBUTES);
        expect(DEFAULT_GROUP_ATTRIBUTES.allowed_port_range).toEqual([]);
    });

    it("groupAttributes 는 실재하는 그룹의 속성을 주되 저장소와 참조를 공유하지 않는다", () => {
        const attributes = AuthorizationContext.groupAttributes(FIELD);
        expect(attributes).toEqual(IdentityStore.instance.group(FIELD)!.attributes);
        attributes.allowed_protocols.push("TCP");
        expect(IdentityStore.instance.group(FIELD)!.attributes.allowed_protocols).toEqual([]);
    });

    it("조회 결과를 캐시하지 않아 터널 추가가 곧바로 반영된다", () => {
        expect(AuthorizationContext.ownedCount(ALICE)).toBe(1);
        expect(ServerOptionStore.instance.updateTunnelingOption(tcpTunnel(20005, ALICE))).toBe(true);
        expect(AuthorizationContext.ownedCount(ALICE)).toBe(2);
        expect(AuthorizationContext.ownerOf(20005)).toEqual({userId: ALICE, groupId: FIELD, role: "regular"});
    });
});
