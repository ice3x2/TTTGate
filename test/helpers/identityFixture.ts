import YAML from "yaml";
import bcrypt from "bcryptjs";
import {
    createSystemGroups,
    DEFAULT_GROUP_ATTRIBUTES,
    DEFAULT_GROUP_ID,
    Group,
    GroupAttributes,
    IDENTITY_SCHEMA_VERSION,
    newUserId,
    Role,
    SYSTEM_SUPERUSER_GROUP_ID,
    User,
    validateGroupAttributes,
    validateUsername
} from "../../src/server/rbac/IdentityTypes";

// U2-09 / #101: 프로세스 하네스가 config/identity.yaml 을 미리 심을 때 쓰는 직렬화기.
// 서버의 IdentityStore.save() 와 같은 형태를 내보내므로, 기동한 서버가 그대로 읽는다.
// 픽스처 오류는 테스트 작성 오류이므로 예외로 알린다(제어 흐름이 아니다).

export const E2E_ADMIN_PASSWORD = 'e2e-password-1234';

const BCRYPT_COST = 12;

export type IdentityFixtureUser = {
    /** 생략하면 newUserId() 로 만든다. 터널 ownerId 를 미리 정해야 하는 E2E(#123)가 고정 id 를 쓴다. */
    id?: string;
    username: string;
    password: string;
    role: Role;
    groupId?: string;
    displayName?: string;
    mustChangePassword?: boolean;
};

export type IdentityFixtureGroup = {
    id: string;
    name: string;
    attributes?: Partial<GroupAttributes>;
};

export type IdentityFixture = {
    users: IdentityFixtureUser[];
    groups?: IdentityFixtureGroup[];
};

// 같은 평문을 여러 픽스처가 쓰더라도 cost-12 해시는 한 번만 계산한다.
const hashCache = new Map<string, string>();

const hashOnce = async (password: string): Promise<string> => {
    const cached = hashCache.get(password);
    if(cached !== undefined) return cached;
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    hashCache.set(password, hash);
    return hash;
};

const buildGroups = (fixture: IdentityFixture): Group[] => {
    const [superuserGroup, defaultGroup] = createSystemGroups();
    const groups: Group[] = [superuserGroup, defaultGroup];
    for(const requested of fixture.groups ?? []) {
        if(groups.some((group) => group.id === requested.id)) {
            throw new Error(`identityFixture group id collides with a system group: ${requested.id}`);
        }
        const attributes = validateGroupAttributes(requested.attributes ?? {}, DEFAULT_GROUP_ATTRIBUTES as GroupAttributes);
        if(!attributes.success) {
            throw new Error(`identityFixture group ${requested.id} has invalid attributes: ${attributes.message}`);
        }
        groups.push({id: requested.id, name: requested.name, system: false, attributes: attributes.value});
    }
    return groups;
};

const resolveGroupId = (user: IdentityFixtureUser, groups: Group[]): string => {
    if(user.role === 'superuser') {
        if(user.groupId !== undefined && user.groupId !== SYSTEM_SUPERUSER_GROUP_ID) {
            throw new Error(`identityFixture superuser ${user.username} cannot be placed in ${user.groupId}`);
        }
        return SYSTEM_SUPERUSER_GROUP_ID;
    }
    const groupId = user.groupId ?? DEFAULT_GROUP_ID;
    if(groupId === SYSTEM_SUPERUSER_GROUP_ID) {
        throw new Error(`identityFixture regular user ${user.username} cannot join the superuser group`);
    }
    if(!groups.some((group) => group.id === groupId)) {
        throw new Error(`identityFixture user ${user.username} references an undeclared groupId: ${groupId}`);
    }
    return groupId;
};

/** 하네스가 config/identity.yaml 에 그대로 쓰는 텍스트. */
export async function serializeIdentityFixture(fixture: IdentityFixture): Promise<string> {
    if(fixture.users.length === 0) {
        throw new Error('identityFixture needs at least one user');
    }
    const groups = buildGroups(fixture);
    const now = Date.now();
    const users: User[] = [];
    for(const requested of fixture.users) {
        const username = validateUsername(requested.username);
        if(!username.success) {
            throw new Error(`identityFixture username is invalid: ${requested.username}`);
        }
        if(users.some((user) => user.username === username.value)) {
            throw new Error(`identityFixture username is declared twice: ${username.value}`);
        }
        if(requested.id !== undefined && users.some((user) => user.id === requested.id)) {
            throw new Error(`identityFixture user id is declared twice: ${requested.id}`);
        }
        users.push({
            id: requested.id ?? newUserId(),
            username: username.value,
            displayName: requested.displayName ?? username.value,
            role: requested.role,
            status: 'active',
            groupId: resolveGroupId(requested, groups),
            passwordHash: await hashOnce(requested.password),
            mustChangePassword: requested.mustChangePassword ?? false,
            migratedFromLegacyAdmin: false,
            migrationAcknowledged: false,
            createdAt: now,
            updatedAt: now
        });
    }
    // 슈퍼유저 그룹의 속성은 서버가 읽을 때 기본값으로 되돌리므로 저장 형태도 빈 객체로 둔다.
    const serializableGroups = groups.map((group) => group.id === SYSTEM_SUPERUSER_GROUP_ID
        ? {...group, attributes: {}}
        : group);
    return YAML.stringify({version: IDENTITY_SCHEMA_VERSION, users, groups: serializableGroups});
}
