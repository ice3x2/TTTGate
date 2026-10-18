import bcrypt from "bcryptjs";
import YAML from "yaml";
import Environment from "../../Environment";
import File from "../../util/File";
import Files from "../../util/Files";
import {ClockRngProvider} from "../../util/ClockRng";
import {timingSafeStringEqual} from "../../util/timingSafeStringEqual";
import LoggerFactory from "../../util/logger/LoggerFactory";
import SessionStore from "../admin/SessionStore";
import {recordAuditEvent} from "../audit/AuditSink";
import {AUDIT_EVENT_TYPES} from "../audit/AuditEventTypes";
import {hashLegacyPassword} from "./legacyPasswordHash";
import {findRecoveryCodeHash} from "../mfa/Totp";
import {
    cloneGroupAttributes,
    createSystemGroups,
    DEFAULT_GROUP_ATTRIBUTES,
    DEFAULT_GROUP_ID,
    Group,
    GroupAttributes,
    IdentityFile,
    IDENTITY_FILE_NAME,
    IDENTITY_SCHEMA_VERSION,
    isBcryptHash,
    newGroupId,
    newUserId,
    Result,
    Role,
    SYSTEM_SUPERUSER_GROUP_ID,
    User,
    UserMfa,
    UserStatus,
    validateDisplayName,
    validateGroupAttributes,
    validatePassword,
    validateUsername
} from "./IdentityTypes";

const logger = LoggerFactory.getLogger('server', 'IdentityStore');

type LoadResult = {success: true; source: 'file' | 'empty'} | {success: false; reason: 'read-error' | 'parse' | 'validation'; message: string};
type VerifyResult = {success: true; user: User; rehashed: boolean} | {success: false; reason: 'not-found' | 'disabled' | 'mismatch'};
type CreateUserInput = {username: string; displayName?: string; role: Role; groupId?: string; mustChangePassword: boolean; migratedFromLegacyAdmin?: boolean}
    & ({password: string} | {passwordHash: string});

function cloneUser(user: User): User {
    // mfa 는 중첩 객체라 함께 복사해야 호출자가 저장소 내부를 고치지 못한다.
    return user.mfa ? {...user, mfa: {...user.mfa, recoveryCodeHashes: [...user.mfa.recoveryCodeHashes]}} : {...user};
}

function cloneGroup(group: Group): Group {
    return {...group, attributes: cloneGroupAttributes(group.attributes)};
}

function emptyIdentityFile(): IdentityFile {
    return {version: IDENTITY_SCHEMA_VERSION, users: [], groups: createSystemGroups()};
}

/** 그룹 이름 규칙: 문자열이고 앞뒤 공백을 뺀 길이가 1–64. 맞으면 다듬은 값, 아니면 undefined. */
function groupNameOf(value: unknown): string | undefined {
    if(typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length >= 1 && trimmed.length <= 64 ? trimmed : undefined;
}

function saveFailedResult(message: string): {success: false; status: 422; code: string; message: string} {
    return {success: false, status: 422, code: 'identity_save_failed', message};
}

class IdentityStore {
    private static _instance: IdentityStore;
    public static bcryptCost = 12;

    private _mode: 'ready' | 'legacy-fallback' = 'ready';
    private _data: IdentityFile = emptyIdentityFile();

    private constructor() {
    }

    public static get instance(): IdentityStore {
        if(!IdentityStore._instance) {
            IdentityStore._instance = new IdentityStore();
        }
        return IdentityStore._instance;
    }

    public static resetForTest(): void {
        IdentityStore._instance = undefined as unknown as IdentityStore;
    }

    public get mode(): 'ready' | 'legacy-fallback' {
        return this._mode;
    }

    public enterLegacyFallback(reason: string): void {
        this._mode = 'legacy-fallback';
        logger.warn(`entering legacy fallback mode: ${reason}`);
    }

    private identityFile(): File {
        return new File(Environment.path.configDir, IDENTITY_FILE_NAME);
    }

    public get filePath(): string {
        return this.identityFile().toString();
    }

    public load(): LoadResult {
        const file = this.identityFile();
        if(!file.exists()) {
            this._data = emptyIdentityFile();
            return {success: true, source: 'empty'};
        }

        const raw = Files.toStringSync(file);
        if(raw === undefined) {
            return {success: false, reason: 'read-error', message: `cannot read ${file.toString()}`};
        }

        let parsed: unknown;
        try {
            parsed = YAML.parse(raw);
        } catch(error) {
            return {success: false, reason: 'parse', message: error instanceof Error ? error.message : String(error)};
        }

        const parseResult = this.parseIdentityFile(parsed);
        if(!parseResult.success) {
            return {success: false, reason: 'validation', message: parseResult.message};
        }

        this._data = parseResult.value;
        return {success: true, source: 'file'};
    }

    private parseIdentityFile(parsed: unknown): {success: true; value: IdentityFile} | {success: false; message: string} {
        if(typeof parsed !== 'object' || parsed === null) {
            return {success: false, message: 'identity.yaml root must be an object'};
        }
        const raw = parsed as {version?: unknown; users?: unknown; groups?: unknown};
        if(raw.version !== 1) {
            return {success: false, message: `unsupported identity.yaml version: ${raw.version}`};
        }
        if(!Array.isArray(raw.users) || !Array.isArray(raw.groups)) {
            return {success: false, message: 'identity.yaml users/groups must be arrays'};
        }

        // 이름은 문자열로 맞춘다. 검증 전에 저장된 숫자 이름이 남아 있으면 목록 정렬(localeCompare)이 500 을 낸다(#172).
        const groups = (raw.groups as Group[]).map((group) => ({...group, name: typeof group.name === 'string' ? group.name : String(group.name ?? group.id)}));
        const hasSuperuserGroup = groups.some((group) => group.id === SYSTEM_SUPERUSER_GROUP_ID);
        const hasDefaultGroup = groups.some((group) => group.id === DEFAULT_GROUP_ID);
        if(!hasSuperuserGroup || !hasDefaultGroup) {
            return {success: false, message: 'identity.yaml is missing a required system group'};
        }

        const normalizedGroups = groups.map((group) => group.id === SYSTEM_SUPERUSER_GROUP_ID
            ? {...group, attributes: cloneGroupAttributes(DEFAULT_GROUP_ATTRIBUTES as GroupAttributes)}
            : group);
        const groupIds = new Set(normalizedGroups.map((group) => group.id));

        const users = (raw.users as User[]).map((user) => ({...user}));
        for(const user of users) {
            if(!groupIds.has(user.groupId)) {
                return {success: false, message: `user ${user.id} references an unknown groupId: ${user.groupId}`};
            }
        }

        return {success: true, value: {version: 1, users, groups: normalizedGroups}};
    }

    public save(): {success: true} | {success: false; message: string} {
        try {
            const serializableGroups = this._data.groups.map((group) => group.id === SYSTEM_SUPERUSER_GROUP_ID
                ? {...group, attributes: {}}
                : group);
            const serializable: {version: number; users: User[]; groups: Group[]} = {
                version: this._data.version,
                users: this._data.users,
                groups: serializableGroups as Group[]
            };
            const yamlString = YAML.stringify(serializable);
            Files.writeAtomicBatchSync([{file: this.identityFile(), data: yamlString, mode: 0o600}]);
            return {success: true};
        } catch(error) {
            // 응답에는 오류 코드만 싣는다. fs 메시지에는 identity.yaml 의 절대 경로가 들어 있다(#172).
            logger.error('identity.yaml save failed', error);
            const code = error && typeof error === 'object' ? (error as {code?: unknown}).code : undefined;
            return {success: false, message: `identity file could not be saved${typeof code === 'string' ? ` (${code})` : ''}`};
        }
    }

    public users(): User[] {
        return this._data.users.map(cloneUser);
    }

    public user(id: string): User | undefined {
        const found = this._data.users.find((u) => u.id === id);
        return found ? cloneUser(found) : undefined;
    }

    public userByUsername(name: string): User | undefined {
        const found = this._data.users.find((u) => u.username === name);
        return found ? cloneUser(found) : undefined;
    }

    public groups(): Group[] {
        return this._data.groups.map(cloneGroup);
    }

    public group(id: string): Group | undefined {
        const found = this._data.groups.find((g) => g.id === id);
        return found ? cloneGroup(found) : undefined;
    }

    public membersOf(groupId: string): User[] {
        return this._data.users.filter((u) => u.groupId === groupId).map(cloneUser);
    }

    private countOtherActiveSuperusers(excludeId: string): number {
        return this._data.users.filter((u) => u.id !== excludeId && u.role === 'superuser' && u.status === 'active').length;
    }

    private replaceData(next: IdentityFile): {success: true} | {success: false; message: string} {
        const previous = this._data;
        this._data = next;
        const saveResult = this.save();
        if(!saveResult.success) {
            this._data = previous;
        }
        return saveResult;
    }

    public async createUser(input: CreateUserInput): Promise<Result<User>> {
        const usernameResult = validateUsername(input.username);
        if(!usernameResult.success) {
            return usernameResult;
        }
        const username = usernameResult.value;
        if(this._data.users.some((u) => u.username === username)) {
            return {success: false, status: 409, code: 'username_taken', message: `username already taken: ${username}`};
        }

        // 수정 경로와 같은 규칙으로 검증한다(#144). 없으면 username 을 쓴다.
        let displayName = username;
        if(input.displayName !== undefined) {
            const displayNameResult = validateDisplayName(input.displayName);
            if(!displayNameResult.success) return displayNameResult;
            displayName = displayNameResult.value;
        }

        const hasPassword = 'password' in input;
        const hasPasswordHash = 'passwordHash' in input;
        if(hasPassword === hasPasswordHash) {
            return {success: false, status: 422, code: 'credential_invalid', message: 'exactly one of password or passwordHash must be provided'};
        }

        let groupId: string;
        if(input.role === 'superuser') {
            groupId = SYSTEM_SUPERUSER_GROUP_ID;
        } else {
            const requestedGroupId = input.groupId ?? DEFAULT_GROUP_ID;
            if(requestedGroupId === SYSTEM_SUPERUSER_GROUP_ID) {
                return {success: false, status: 422, code: 'superuser_group_reserved', message: 'regular users cannot join the superuser group'};
            }
            const group = this._data.groups.find((g) => g.id === requestedGroupId);
            if(!group) {
                return {success: false, status: 422, code: 'group_not_found', message: `group not found: ${requestedGroupId}`};
            }
            groupId = requestedGroupId;
        }

        let passwordHash: string;
        if(hasPassword) {
            const passwordResult = validatePassword((input as {password: string}).password);
            if(!passwordResult.success) {
                return passwordResult;
            }
            passwordHash = await bcrypt.hash(passwordResult.value, IdentityStore.bcryptCost);
            if(this._data.users.some((u) => u.username === username)) {
                return {success: false, status: 409, code: 'username_taken', message: `username already taken: ${username}`};
            }
        } else {
            passwordHash = (input as {passwordHash: string}).passwordHash;
        }

        const now = ClockRngProvider.current().now();
        const user: User = {
            id: newUserId(),
            username,
            displayName,
            role: input.role,
            status: 'active',
            groupId,
            passwordHash,
            mustChangePassword: input.mustChangePassword,
            migratedFromLegacyAdmin: input.migratedFromLegacyAdmin ?? false,
            migrationAcknowledged: false,
            createdAt: now,
            updatedAt: now
        };

        const saveResult = this.replaceData({...this._data, users: [...this._data.users, user]});
        if(!saveResult.success) {
            return saveFailedResult(saveResult.message);
        }
        return {success: true, value: cloneUser(user)};
    }

    public updateUser(id: string, patch: {displayName?: string; role?: Role; status?: UserStatus; groupId?: string; mustChangePassword?: boolean; migrationAcknowledged?: boolean}): Result<User> {
        const index = this._data.users.findIndex((u) => u.id === id);
        if(index < 0) {
            return {success: false, status: 404, code: 'user_not_found', message: `user not found: ${id}`};
        }
        const current = this._data.users[index];
        const effectiveRole = patch.role ?? current.role;

        if(patch.groupId !== undefined) {
            // 없는 그룹을 저장하면 실행 중에는 기본 그룹 속성이 적용되고, 재기동 때는 파일 검증이 실패해
            // 서버가 legacy-fallback 으로 떨어진다(#140). createUser 와 같은 코드로 거절한다.
            if(typeof patch.groupId !== 'string' || !this._data.groups.some((g) => g.id === patch.groupId)) {
                return {success: false, status: 422, code: 'group_not_found', message: 'group not found'};
            }
            if(effectiveRole === 'superuser' && patch.groupId !== SYSTEM_SUPERUSER_GROUP_ID) {
                return {success: false, status: 422, code: 'superuser_group_reserved', message: 'superuser accounts must stay in the superuser group'};
            }
            if(effectiveRole === 'regular' && patch.groupId === SYSTEM_SUPERUSER_GROUP_ID) {
                return {success: false, status: 422, code: 'superuser_group_reserved', message: 'regular users cannot join the superuser group'};
            }
        }

        let nextGroupId = current.groupId;
        if(patch.groupId !== undefined) {
            nextGroupId = patch.groupId;
        } else if(patch.role !== undefined && patch.role !== current.role) {
            nextGroupId = patch.role === 'superuser' ? SYSTEM_SUPERUSER_GROUP_ID : DEFAULT_GROUP_ID;
        }

        const nextStatus = patch.status ?? current.status;
        if(current.role === 'superuser' && current.status === 'active') {
            const willBeDemoted = effectiveRole !== 'superuser';
            const willBeDisabled = nextStatus !== 'active';
            if((willBeDemoted || willBeDisabled) && this.countOtherActiveSuperusers(id) === 0) {
                this.recordLastSuperuserGuardHit(id, willBeDemoted ? 'demote' : 'disable');
                return {success: false, status: 409, code: 'last_superuser', message: 'cannot remove the last active superuser'};
            }
        }

        const updatedUser: User = {
            ...current,
            displayName: patch.displayName ?? current.displayName,
            role: effectiveRole,
            status: nextStatus,
            groupId: nextGroupId,
            mustChangePassword: patch.mustChangePassword ?? current.mustChangePassword,
            migrationAcknowledged: patch.migrationAcknowledged ?? current.migrationAcknowledged,
            updatedAt: ClockRngProvider.current().now()
        };

        const nextUsers = [...this._data.users];
        nextUsers[index] = updatedUser;
        const saveResult = this.replaceData({...this._data, users: nextUsers});
        if(!saveResult.success) {
            return saveFailedResult(saveResult.message);
        }
        if(updatedUser.status === 'disabled') {
            SessionStore.instance.removeSessionsOfUser(updatedUser.id);
        }
        return {success: true, value: cloneUser(updatedUser)};
    }

    // #112 (U4-04) 본인 MFA. 모두 원자 저장이며 lastUsedStep 도 파일에 남겨 재기동 뒤에도 재사용을 막는다.
    public setMfa(id: string, mfa: UserMfa): Result<void> {
        return this.replaceMfa(id, () => ({...mfa, recoveryCodeHashes: [...mfa.recoveryCodeHashes]}), false);
    }

    public clearMfa(id: string): Result<void> {
        return this.replaceMfa(id, () => undefined, false);
    }

    public markMfaStep(id: string, step: number): Result<void> {
        return this.replaceMfa(id, (current) => ({...current!, lastUsedStep: step}), true);
    }

    public replaceRecoveryCodeHashes(id: string, hashes: string[]): Result<void> {
        return this.replaceMfa(id, (current) => ({...current!, recoveryCodeHashes: [...hashes]}), true);
    }

    /** 일치하는 복구 코드 해시를 지운다. 없으면 422 recovery_code_invalid(401 매핑은 쓰는 라우트가 한다). */
    public consumeRecoveryCode(id: string, hash: string): Result<{remaining: number}> {
        const current = this._data.users.find((u) => u.id === id)?.mfa;
        const index = current ? findRecoveryCodeHash(current.recoveryCodeHashes, hash) : -1;
        if(!current || index < 0) {
            return {success: false, status: 422, code: 'recovery_code_invalid', message: 'The code is incorrect.'};
        }
        const remaining = current.recoveryCodeHashes.filter((_, i) => i !== index);
        const saved = this.replaceMfa(id, () => ({...current, recoveryCodeHashes: remaining}), true);
        return saved.success ? {success: true, value: {remaining: remaining.length}} : saved;
    }

    /** 사용자의 mfa 를 next() 결과로 바꿔 저장한다. requireMfa 면 mfa 가 없는 사용자는 409 다. */
    private replaceMfa(id: string, next: (current: UserMfa | undefined) => UserMfa | undefined, requireMfa: boolean): Result<void> {
        const index = this._data.users.findIndex((u) => u.id === id);
        if(index < 0) {
            return {success: false, status: 404, code: 'user_not_found', message: `user not found: ${id}`};
        }
        const current = this._data.users[index];
        if(requireMfa && !current.mfa) {
            return {success: false, status: 409, code: 'mfa_not_enabled', message: 'Two-factor authentication is not enabled.'};
        }
        const {mfa: _previous, ...rest} = current;
        const mfa = next(current.mfa);
        const updatedUser: User = mfa ? {...rest, mfa} : rest;
        const nextUsers = [...this._data.users];
        nextUsers[index] = updatedUser;
        const saveResult = this.replaceData({...this._data, users: nextUsers});
        return saveResult.success ? {success: true, value: undefined} : saveFailedResult(saveResult.message);
    }

    public deleteUser(id: string): Result<void> {
        const user = this._data.users.find((u) => u.id === id);
        if(!user) {
            return {success: false, status: 404, code: 'user_not_found', message: `user not found: ${id}`};
        }
        if(user.role === 'superuser' && user.status === 'active' && this.countOtherActiveSuperusers(id) === 0) {
            this.recordLastSuperuserGuardHit(id, 'delete');
            return {success: false, status: 409, code: 'last_superuser', message: 'cannot delete the last active superuser'};
        }
        const saveResult = this.replaceData({...this._data, users: this._data.users.filter((u) => u.id !== id)});
        if(!saveResult.success) {
            return saveFailedResult(saveResult.message);
        }
        SessionStore.instance.removeSessionsOfUser(id);
        return {success: true, value: undefined};
    }

    /** 대소문자와 앞뒤 공백을 무시하고 같은 이름의 다른 그룹이 있는지(#172). */
    private groupNameTaken(name: string, exceptId?: string): boolean {
        const key = name.trim().toLowerCase();
        return this._data.groups.some((group) => group.id !== exceptId && String(group.name).trim().toLowerCase() === key);
    }

    public createGroup(input: {name: string; attributes?: Partial<GroupAttributes>}): Result<Group> {
        const name = groupNameOf(input.name);
        if(name === undefined) {
            return {success: false, status: 422, code: 'group_name_invalid', message: 'group name is invalid'};
        }
        if(this.groupNameTaken(name)) {
            return {success: false, status: 409, code: 'group_name_taken', message: 'group name is already used'};
        }
        const attributesResult = validateGroupAttributes(input.attributes ?? {}, DEFAULT_GROUP_ATTRIBUTES as GroupAttributes);
        if(!attributesResult.success) {
            return attributesResult;
        }
        const group: Group = {id: newGroupId(), name, system: false, attributes: attributesResult.value};
        const saveResult = this.replaceData({...this._data, groups: [...this._data.groups, group]});
        if(!saveResult.success) {
            return saveFailedResult(saveResult.message);
        }
        return {success: true, value: cloneGroup(group)};
    }

    public updateGroup(id: string, patch: {name?: string; attributes?: Partial<GroupAttributes>}, expectedRevision?: number): Result<Group> {
        const index = this._data.groups.findIndex((g) => g.id === id);
        if(index < 0) {
            return {success: false, status: 404, code: 'group_not_found', message: `group not found: ${id}`};
        }
        if(id === SYSTEM_SUPERUSER_GROUP_ID) {
            return {success: false, status: 422, code: 'system_group_readonly', message: 'the superuser group is read-only'};
        }
        if(id === DEFAULT_GROUP_ID && patch.name !== undefined) {
            return {success: false, status: 422, code: 'system_group_readonly', message: 'the default group name is read-only'};
        }

        // 생성과 같은 이름 규칙이다. 숫자 이름이 저장되면 목록 정렬(localeCompare)이 500 을 낸다(#144).
        const nextName = patch.name === undefined ? undefined : groupNameOf(patch.name);
        if(patch.name !== undefined && nextName === undefined) {
            return {success: false, status: 422, code: 'group_name_invalid', message: 'group name is invalid'};
        }
        if(nextName !== undefined && nextName.toLowerCase() !== String(this._data.groups[index].name).trim().toLowerCase() && this.groupNameTaken(nextName, id)) {
            return {success: false, status: 409, code: 'group_name_taken', message: 'group name is already used'};
        }
        const group = this._data.groups[index];
        // 화면이 읽은 뒤 다른 사람이 바꿨으면 거절한다. 덮어쓰면 다른 운영자의 권한 축소가 되돌아간다(#152).
        // 파일에 숫자가 아닌 revision 이 있으면 0 으로 본다("3"+1 이 "31" 이 되지 않게).
        const currentRevision = Number.isSafeInteger(group.revision) ? group.revision! : 0;
        if(expectedRevision !== undefined && currentRevision !== expectedRevision) {
            return {success: false, status: 409, code: 'group_revision_conflict', message: 'the group was changed by someone else'};
        }
        let nextAttributes = group.attributes;
        if(patch.attributes !== undefined) {
            // 바뀐 키만 오므로, 이전 파일에 없던 속성은 기본값으로 채운 위에 합친다(#152). 그러지 않으면 빠진 키 때문에 어떤 저장도 422 다.
            const attributesResult = validateGroupAttributes(patch.attributes, {...cloneGroupAttributes(DEFAULT_GROUP_ATTRIBUTES as GroupAttributes), ...group.attributes});
            if(!attributesResult.success) {
                return attributesResult;
            }
            nextAttributes = attributesResult.value;
        }
        const updatedGroup: Group = {...group, name: nextName ?? group.name, attributes: nextAttributes, revision: currentRevision + 1};
        const nextGroups = [...this._data.groups];
        nextGroups[index] = updatedGroup;
        const saveResult = this.replaceData({...this._data, groups: nextGroups});
        if(!saveResult.success) {
            return saveFailedResult(saveResult.message);
        }
        return {success: true, value: cloneGroup(updatedGroup)};
    }

    public deleteGroup(id: string): Result<void> {
        if(id === SYSTEM_SUPERUSER_GROUP_ID || id === DEFAULT_GROUP_ID) {
            return {success: false, status: 422, code: 'system_group_readonly', message: 'system groups cannot be deleted'};
        }
        const group = this._data.groups.find((g) => g.id === id);
        if(!group) {
            return {success: false, status: 404, code: 'group_not_found', message: `group not found: ${id}`};
        }
        if(this.membersOf(id).length > 0) {
            return {success: false, status: 409, code: 'group_not_empty', message: `group has members: ${id}`};
        }
        const saveResult = this.replaceData({...this._data, groups: this._data.groups.filter((g) => g.id !== id)});
        if(!saveResult.success) {
            return saveFailedResult(saveResult.message);
        }
        return {success: true, value: undefined};
    }

    /** PRD K6 집계 근거. 409 를 내는 호출마다 하나씩 흘린다(응답을 막지 않는다). */
    private recordLastSuperuserGuardHit(id: string, operation: 'demote' | 'disable' | 'delete'): void {
        recordAuditEvent({
            at: ClockRngProvider.current().now(),
            actor: {userId: 'system'},
            type: AUDIT_EVENT_TYPES.last_superuser_guard_hit,
            target: {kind: 'user', id},
            outcome: 'failure',
            summary: `last_superuser_guard_hit ${id}`,
            detail: {operation}
        }).catch((e) => logger.error('audit record failed', e));
    }

    /**
     * 해시와 mustChangePassword 를 한 번의 저장으로 바꾼다. requireChange 는 관리자 초기화용이다 — 둘을 나눠 저장하면
     * 두 번째 저장이 실패할 때 해시만 바뀐 채 실패 응답이 나가 사용자가 모르는 비밀번호에 갇힌다(#145).
     */
    public async setPassword(id: string, password: string, options: {clearMustChange?: boolean; requireChange?: boolean}): Promise<Result<User>> {
        const index = this._data.users.findIndex((u) => u.id === id);
        if(index < 0) {
            return {success: false, status: 404, code: 'user_not_found', message: `user not found: ${id}`};
        }
        const passwordResult = validatePassword(password);
        if(!passwordResult.success) {
            return passwordResult;
        }
        const passwordHash = await bcrypt.hash(passwordResult.value, IdentityStore.bcryptCost);

        const currentIndex = this._data.users.findIndex((u) => u.id === id);
        if(currentIndex < 0) {
            return {success: false, status: 404, code: 'user_not_found', message: `user not found: ${id}`};
        }
        const current = this._data.users[currentIndex];
        const updatedUser: User = {
            ...current,
            passwordHash,
            mustChangePassword: options.requireChange ? true : options.clearMustChange ? false : current.mustChangePassword,
            updatedAt: ClockRngProvider.current().now()
        };
        const nextUsers = [...this._data.users];
        nextUsers[currentIndex] = updatedUser;
        const saveResult = this.replaceData({...this._data, users: nextUsers});
        if(!saveResult.success) {
            return saveFailedResult(saveResult.message);
        }
        return {success: true, value: cloneUser(updatedUser)};
    }

    public async verifyPassword(username: string, password: string): Promise<VerifyResult> {
        const normalized = typeof username === 'string' ? username.trim().toLowerCase() : '';
        const index = this._data.users.findIndex((u) => u.username === normalized);
        if(index < 0) {
            return {success: false, reason: 'not-found'};
        }
        const user = this._data.users[index];
        if(user.status === 'disabled') {
            return {success: false, reason: 'disabled'};
        }
        if(!password) {
            return {success: false, reason: 'mismatch'};
        }

        if(isBcryptHash(user.passwordHash)) {
            const matches = await bcrypt.compare(password, user.passwordHash);
            if(!matches) {
                return {success: false, reason: 'mismatch'};
            }
            return {success: true, user: cloneUser(user), rehashed: false};
        }

        const legacyHash = hashLegacyPassword(password);
        const matches = timingSafeStringEqual(user.passwordHash, legacyHash, 'utf8');
        if(!matches) {
            return {success: false, reason: 'mismatch'};
        }

        const newHash = await bcrypt.hash(password, IdentityStore.bcryptCost);
        const currentIndex = this._data.users.findIndex((u) => u.id === user.id);
        const rehashedUser: User = {...user, passwordHash: newHash};
        if(currentIndex >= 0) {
            const nextUsers = [...this._data.users];
            nextUsers[currentIndex] = {...nextUsers[currentIndex], passwordHash: newHash, updatedAt: ClockRngProvider.current().now()};
            this.replaceData({...this._data, users: nextUsers});
        }
        return {success: true, user: cloneUser(rehashedUser), rehashed: true};
    }
}

export {IdentityStore};
