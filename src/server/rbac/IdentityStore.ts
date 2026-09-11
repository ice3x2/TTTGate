import bcrypt from "bcryptjs";
import YAML from "yaml";
import Environment from "../../Environment";
import File from "../../util/File";
import Files from "../../util/Files";
import {ClockRngProvider} from "../../util/ClockRng";
import {timingSafeStringEqual} from "../../util/timingSafeStringEqual";
import LoggerFactory from "../../util/logger/LoggerFactory";
import {hashLegacyPassword} from "./legacyPasswordHash";
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
    UserStatus,
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
    return {...user};
}

function cloneGroup(group: Group): Group {
    return {...group, attributes: cloneGroupAttributes(group.attributes)};
}

function emptyIdentityFile(): IdentityFile {
    return {version: IDENTITY_SCHEMA_VERSION, users: [], groups: createSystemGroups()};
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

        const groups = (raw.groups as Group[]).map((group) => ({...group}));
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
            return {success: false, message: error instanceof Error ? error.message : String(error)};
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

        const displayName = input.displayName ?? username;

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
        return {success: true, value: cloneUser(updatedUser)};
    }

    public deleteUser(id: string): Result<void> {
        const user = this._data.users.find((u) => u.id === id);
        if(!user) {
            return {success: false, status: 404, code: 'user_not_found', message: `user not found: ${id}`};
        }
        if(user.role === 'superuser' && user.status === 'active' && this.countOtherActiveSuperusers(id) === 0) {
            return {success: false, status: 409, code: 'last_superuser', message: 'cannot delete the last active superuser'};
        }
        const saveResult = this.replaceData({...this._data, users: this._data.users.filter((u) => u.id !== id)});
        if(!saveResult.success) {
            return saveFailedResult(saveResult.message);
        }
        return {success: true, value: undefined};
    }

    public createGroup(input: {name: string; attributes?: Partial<GroupAttributes>}): Result<Group> {
        const name = input.name;
        if(typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 64) {
            return {success: false, status: 422, code: 'group_name_invalid', message: `group name is invalid: ${name}`};
        }
        const attributesResult = validateGroupAttributes(input.attributes ?? {}, DEFAULT_GROUP_ATTRIBUTES as GroupAttributes);
        if(!attributesResult.success) {
            return attributesResult;
        }
        const group: Group = {id: newGroupId(), name: name.trim(), system: false, attributes: attributesResult.value};
        const saveResult = this.replaceData({...this._data, groups: [...this._data.groups, group]});
        if(!saveResult.success) {
            return saveFailedResult(saveResult.message);
        }
        return {success: true, value: cloneGroup(group)};
    }

    public updateGroup(id: string, patch: {name?: string; attributes?: Partial<GroupAttributes>}): Result<Group> {
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

        const group = this._data.groups[index];
        let nextAttributes = group.attributes;
        if(patch.attributes !== undefined) {
            const attributesResult = validateGroupAttributes(patch.attributes, group.attributes);
            if(!attributesResult.success) {
                return attributesResult;
            }
            nextAttributes = attributesResult.value;
        }
        const updatedGroup: Group = {...group, name: patch.name ?? group.name, attributes: nextAttributes};
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

    public async setPassword(id: string, password: string, options: {clearMustChange: boolean}): Promise<Result<void>> {
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
            mustChangePassword: options.clearMustChange ? false : current.mustChangePassword,
            updatedAt: ClockRngProvider.current().now()
        };
        const nextUsers = [...this._data.users];
        nextUsers[currentIndex] = updatedUser;
        const saveResult = this.replaceData({...this._data, users: nextUsers});
        if(!saveResult.success) {
            return saveFailedResult(saveResult.message);
        }
        return {success: true, value: undefined};
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
