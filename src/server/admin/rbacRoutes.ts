import SessionStore, {Session} from "./SessionStore";
import {auditEventOf, isFieldProvided, RouteContext, RouteHandlers} from "./routes";
import {recordAuditEvent} from "../audit/AuditSink";
import {AUDIT_EVENT_TYPES} from "../audit/AuditEventTypes";
import {IdentityStore} from "../rbac/IdentityStore";
import {AuthorizationContext} from "../rbac/AuthorizationContext";
import {toUserView} from "../rbac/UserView";
import {generateTemporaryPassword} from "../rbac/temporaryPassword";
import {
    DEFAULT_GROUP_ID,
    Group,
    GroupAttributes,
    Result,
    Role,
    SYSTEM_SUPERUSER_GROUP_ID,
    UserStatus,
    validateDisplayName
} from "../rbac/IdentityTypes";
import ObjectUtil from "../../util/ObjectUtil";
import {ClockRngProvider} from "../../util/ClockRng";
import ServerOptionStore from "../ServerOptionStore";
import {sections} from "../rbac/AdminAuthorizer";
import {SYSTEM_SUPERUSER_GROUP_NAME, User} from "../rbac/IdentityTypes";
import {base32Encode} from "../mfa/Base32";
import {generateRecoveryCodes, generateSecret, hashRecoveryCode, otpauthUri, verify} from "../mfa/Totp";
import LoggerFactory from "../../util/logger/LoggerFactory";

const logger = LoggerFactory.getLogger('server', 'rbacRoutes');

const ROLES: readonly string[] = ['superuser', 'regular'];
const USER_STATUSES: readonly string[] = ['active', 'disabled'];

/** 목록에서 시스템 그룹을 앞에 두는 순서. 그 뒤는 이름 오름차순이다. */
const SYSTEM_GROUP_ORDER: readonly string[] = [SYSTEM_SUPERUSER_GROUP_ID, DEFAULT_GROUP_ID];

type GroupView = Group & {memberCount: number};

/**
 * Result 를 HTTP 응답으로 옮기는 단 하나의 변환기.
 * 실패를 예외로 바꾸지 않으므로 호출부가 try/catch 로 분기할 일이 없다.
 */
function replyResult<T>(ctx: RouteContext, result: Result<T>, onSuccess: (value: T) => object, successStatus: number = 200): void {
    if(!result.success) {
        ctx.fail(result.status, result.code, result.message);
        return;
    }
    ctx.ok(onSuccess(result.value), successStatus);
}

const toGroupView = (group: Group): GroupView =>
    ({...group, memberCount: IdentityStore.instance.membersOf(group.id).length});

const groupRank = (group: Group): number => {
    const index = SYSTEM_GROUP_ORDER.indexOf(group.id);
    return index < 0 ? SYSTEM_GROUP_ORDER.length : index;
};

/**
 * 값이 실제로 바뀐 속성 키만 고른다. 같은 값으로 덮어쓴 키는 감사에 남기지 않는다.
 * 속성 값에는 숫자·문자열과 배열·객체가 섞여 있으므로, 한 겹 감싸서 깊은 비교기 하나로 둘 다 다룬다.
 */
const changedAttributeKeys = (before: GroupAttributes, after: GroupAttributes): string[] =>
    (Object.keys(after) as Array<keyof GroupAttributes>)
        .filter((key) => !ObjectUtil.equalsDeep({value: before[key]}, {value: after[key]}));

/**
 * 요청이 지정한 임시 비밀번호를 고르거나 새로 만든다.
 * 문자열이 아닌 값이 오면 비밀번호 검증과 같은 코드로 거절해 생성·초기화가 같은 규약을 갖게 한다.
 */
function resolveTemporaryPassword(ctx: RouteContext): {password: string; generated: boolean} | undefined {
    const requested = ctx.body?.temporaryPassword;
    if(isFieldProvided(ctx.body, 'temporaryPassword') && typeof requested !== 'string') {
        ctx.fail(422, 'password_too_short', 'temporaryPassword must be a string');
        return undefined;
    }
    return !isFieldProvided(ctx.body, 'temporaryPassword')
        ? {password: generateTemporaryPassword(), generated: true}
        : {password: requested, generated: false};
}

/** 임시 비밀번호를 발급한 사실만 남긴다. 평문은 응답 본문 1회뿐이며 detail 에 담지 않는다. */
function emitTemporaryPasswordIssued(ctx: RouteContext, userId: string, generated: boolean): void {
    recordAuditEvent(auditEventOf(ctx, {
        type: AUDIT_EVENT_TYPES.temp_password_issued,
        target: {kind: 'user', id: userId},
        summary: `temp_password_issued ${userId}`,
        detail: {generated}
    }, 'success')).catch((e) => logger.error('audit record failed', e));
}

const onListUsers = async (ctx: RouteContext): Promise<void> => {
    const store = IdentityStore.instance;
    const groups = store.groups();
    const users = store.users()
        .sort((left, right) => left.createdAt - right.createdAt)
        .map((user) => toUserView(user, groups));
    ctx.ok({users});
};

const onCreateUser = async (ctx: RouteContext): Promise<void> => {
    const body = ctx.body ?? {};
    if(!ROLES.includes(body.role)) {
        ctx.fail(422, 'role_invalid', `role must be one of ${ROLES.join(', ')}`);
        return;
    }
    const temporary = resolveTemporaryPassword(ctx);
    if(!temporary) {
        return;
    }
    const store = IdentityStore.instance;
    const created = await store.createUser({
        username: body.username,
        displayName: body.displayName,
        role: body.role as Role,
        groupId: body.groupId,
        password: temporary.password,
        mustChangePassword: true
    });
    if(!created.success) {
        ctx.fail(created.status, created.code, created.message);
        return;
    }
    ctx.auditDetail({userId: created.value.id});
    emitTemporaryPasswordIssued(ctx, created.value.id, temporary.generated);
    ctx.ok({user: toUserView(created.value, store.groups()), temporaryPassword: temporary.password}, 201);
};

const onGetUser = async (ctx: RouteContext): Promise<void> => {
    const store = IdentityStore.instance;
    const user = store.user(ctx.params.id);
    if(!user) {
        ctx.fail(404, 'user_not_found', `user not found: ${ctx.params.id}`);
        return;
    }
    ctx.ok({user: toUserView(user, store.groups())});
};

const onUpdateUser = async (ctx: RouteContext): Promise<void> => {
    const body = ctx.body ?? {};
    // 허용하는 네 키만 골라 넘긴다. mustChangePassword·migrationAcknowledged 가 와도 무시한다.
    const patch: {displayName?: string; role?: Role; status?: UserStatus; groupId?: string} = {};
    if(isFieldProvided(body, 'displayName')) {
        const displayName = validateDisplayName(body.displayName);
        if(!displayName.success) {
            ctx.fail(displayName.status, displayName.code, displayName.message);
            return;
        }
        patch.displayName = displayName.value;
    }
    if(isFieldProvided(body, 'role')) {
        if(!ROLES.includes(body.role)) {
            ctx.fail(422, 'role_invalid', `role must be one of ${ROLES.join(', ')}`);
            return;
        }
        patch.role = body.role as Role;
    }
    if(isFieldProvided(body, 'status')) {
        if(!USER_STATUSES.includes(body.status)) {
            ctx.fail(422, 'status_invalid', `status must be one of ${USER_STATUSES.join(', ')}`);
            return;
        }
        patch.status = body.status as UserStatus;
    }
    if(isFieldProvided(body, 'groupId')) {
        patch.groupId = body.groupId;
    }
    const store = IdentityStore.instance;
    const updated = store.updateUser(ctx.params.id, patch);
    // 그룹·역할이 바뀌면 그 사용자 터널의 수명 상한도 바뀐다(#137).
    if(updated.success && (patch.groupId !== undefined || patch.role !== undefined)) ctx.reapplyTunnelCaps?.();
    replyResult(ctx, updated, (user) => ({user: toUserView(user, store.groups())}));
};

const onDeleteUser = async (ctx: RouteContext): Promise<void> => {
    // 소유 터널을 남긴 채 사용자를 지우면 그 터널이 소유자 없는 상태가 된다. 재할당을 먼저 요구한다(#100 U2-08).
    const owned = AuthorizationContext.portsOfOwner(ctx.params.id);
    if(owned.length > 0) {
        ctx.fail(409, 'user_owns_tunnels', `user still owns tunnels: ${owned.join(', ')}`);
        return;
    }
    replyResult(ctx, IdentityStore.instance.deleteUser(ctx.params.id), () => ({}));
};

const onResetUserPassword = async (ctx: RouteContext): Promise<void> => {
    const temporary = resolveTemporaryPassword(ctx);
    if(!temporary) {
        return;
    }
    const store = IdentityStore.instance;
    // 해시와 mustChangePassword 를 한 번에 저장한다(#145).
    const updated = await store.setPassword(ctx.params.id, temporary.password, {requireChange: true});
    if(!updated.success) {
        ctx.fail(updated.status, updated.code, updated.message);
        return;
    }
    // 발급받은 사람이 새 비밀번호로 다시 들어오도록 기존 세션을 모두 끊는다.
    SessionStore.instance.removeSessionsOfUser(ctx.params.id);
    ctx.auditDetail({generated: temporary.generated});
    ctx.ok({user: toUserView(updated.value, store.groups()), temporaryPassword: temporary.password});
};

const onListGroups = async (ctx: RouteContext): Promise<void> => {
    const groups = IdentityStore.instance.groups()
        .sort((left, right) => groupRank(left) - groupRank(right) || left.name.localeCompare(right.name))
        .map(toGroupView);
    ctx.ok({groups});
};

const onCreateGroup = async (ctx: RouteContext): Promise<void> => {
    const created = IdentityStore.instance.createGroup({name: ctx.body?.name, attributes: ctx.body?.attributes});
    replyResult(ctx, created, (group) => ({group: toGroupView(group)}), 201);
};

const onGetGroup = async (ctx: RouteContext): Promise<void> => {
    const store = IdentityStore.instance;
    const group = store.group(ctx.params.id);
    if(!group) {
        ctx.fail(404, 'group_not_found', `group not found: ${ctx.params.id}`);
        return;
    }
    const groups = store.groups();
    ctx.ok({
        group: toGroupView(group),
        members: store.membersOf(group.id).map((user) => toUserView(user, groups))
    });
};

const onUpdateGroup = async (ctx: RouteContext): Promise<void> => {
    const store = IdentityStore.instance;
    const before = store.group(ctx.params.id);
    const patch: {name?: string; attributes?: Partial<GroupAttributes>} = {};
    if(isFieldProvided(ctx.body, 'name')) {
        patch.name = ctx.body.name;
    }
    if(isFieldProvided(ctx.body, 'attributes')) {
        patch.attributes = ctx.body.attributes;
    }
    const updated = store.updateGroup(ctx.params.id, patch);
    if(!updated.success) {
        ctx.fail(updated.status, updated.code, updated.message);
        return;
    }
    if(before && isFieldProvided(ctx.body, 'attributes')) {
        ctx.auditDetail({changedKeys: changedAttributeKeys(before.attributes, updated.value.attributes)});
    }
    if(isFieldProvided(ctx.body, 'attributes')) ctx.reapplyTunnelCaps?.(); // 수명 상한이 바뀌었을 수 있다(#137).
    ctx.ok({group: toGroupView(updated.value)});
};

const onDeleteGroup = async (ctx: RouteContext): Promise<void> => {
    replyResult(ctx, IdentityStore.instance.deleteGroup(ctx.params.id), () => ({}));
};

/** /api/me 와 MFA 응답의 mfa 요약. secret·해시는 담지 않는다. */
const mfaSummaryOf = (user: User | undefined): {enabled: boolean; recoveryCodesRemaining: number} =>
    user?.mfa?.enabled ? {enabled: true, recoveryCodesRemaining: user.mfa.recoveryCodeHashes.length} : {enabled: false, recoveryCodesRemaining: 0};

/**
 * U2-04 / #96: 현재 주체의 프로필·그룹 속성·볼 수 있는 섹션을 한 번에 돌려준다.
 * identity.yaml 을 읽지 못한 legacy-fallback 주체는 저장소에 사용자가 없으므로 합성해 응답한다.
 * #112 (U4-04) 이 me 계열 핸들러의 자리인 이 파일로 옮기며 mfa 요약을 더했다.
 */
const onGetMe = async (ctx: RouteContext): Promise<void> => {
    const principal = ctx.principal!;
    if(principal.legacy) {
        ctx.ok({
            user: {
                id: principal.userId, username: principal.username, displayName: principal.username,
                role: principal.role, status: 'active', groupId: principal.groupId, groupName: SYSTEM_SUPERUSER_GROUP_NAME,
                mustChangePassword: false, migratedFromLegacyAdmin: false, mfaEnabled: false, createdAt: 0, updatedAt: 0
            },
            group: {id: principal.groupId, name: SYSTEM_SUPERUSER_GROUP_NAME, attributes: principal.attributes},
            sections: sections(principal),
            migrationBanner: false,
            mfa: mfaSummaryOf(undefined),
            mustEnrollMfa: false
        });
        return;
    }
    const store = IdentityStore.instance;
    const user = store.user(principal.userId)!;
    const groups = store.groups();
    const group = groups.find((candidate) => candidate.id === user.groupId);
    ctx.ok({
        user: toUserView(user, groups),
        group: {id: principal.groupId, name: group?.name ?? principal.groupId, attributes: principal.attributes},
        sections: sections(principal),
        migrationBanner: user.migratedFromLegacyAdmin && !user.migrationAcknowledged,
        mfa: mfaSummaryOf(user),
        mustEnrollMfa: ctx.session?.mustEnrollMfa === true
    });
};

// ---- #112 (U4-04) 본인 MFA. 코드·해시 비교는 Totp.ts 의 verify·findRecoveryCodeHash 만 거친다. ----

const nowMs = (): number => ClockRngProvider.current().now();

/** MFA 를 다루려면 identity.yaml 의 사용자가 있어야 한다(legacy-fallback 은 503). */
const mfaUserOf = (ctx: RouteContext): User | undefined => {
    if(ctx.principal!.legacy) {
        ctx.fail(503, 'identity_store_unavailable', 'Identity store is unavailable');
        return undefined;
    }
    const user = IdentityStore.instance.user(ctx.principal!.userId);
    // 세션 확인 뒤 본문을 읽는 사이에 사용자가 지워졌을 수 있다.
    if(!user) ctx.fail(404, 'user_not_found', 'User not found');
    return user;
};

/** 세션 안의 재확인이라 로그인 백오프 버킷에 기록하지 않는다(PUT /api/me/password 와 같다). */
const passwordConfirmed = async (ctx: RouteContext, user: User): Promise<boolean> => {
    const password = typeof ctx.body?.password === 'string' ? ctx.body.password : '';
    const verified = await IdentityStore.instance.verifyPassword(user.username, password);
    if(!verified.success) ctx.fail(401, 'password_incorrect', 'The password is incorrect.');
    return verified.success;
};

const onEnrollMfa = async (ctx: RouteContext): Promise<void> => {
    const user = mfaUserOf(ctx);
    if(!user) return;
    if(user.mfa?.enabled) {
        ctx.fail(409, 'mfa_already_enabled', 'Two-factor authentication is already enabled.');
        return;
    }
    const secret = generateSecret();
    const recoveryCodes = generateRecoveryCodes();
    ctx.mfa!.pending.set(user.id, {secret, recoveryCodes});
    const secretBase32 = base32Encode(secret);
    // 평문 secret·복구 코드는 이 응답에만 실린다.
    ctx.ok({secret: secretBase32, otpauthUri: otpauthUri(user.username, secretBase32), recoveryCodes});
};

const onConfirmMfa = async (ctx: RouteContext): Promise<void> => {
    const user = mfaUserOf(ctx);
    if(!user) return;
    const pending = ctx.mfa!.pending.peek(user.id);
    if(!pending) {
        ctx.fail(409, 'mfa_enrollment_expired', 'Start the setup again.');
        return;
    }
    // 코드는 6자리 문자열이다. 숫자로 보내면 앞자리 0 이 사라지므로 받지 않는다(형식 오류로 실패 1회).
    const code = typeof ctx.body?.code === 'string' ? ctx.body.code : '';
    const now = nowMs();
    const verified = verify(pending.secret, code, now, -1);
    if(!verified.ok) {
        ctx.mfa!.pending.fail(user.id);
        ctx.fail(401, 'mfa_code_invalid', 'The code is incorrect.');
        return;
    }
    const saved = IdentityStore.instance.setMfa(user.id, {
        enabled: true, secret: base32Encode(pending.secret), enrolledAt: now, lastUsedStep: verified.step,
        recoveryCodeHashes: pending.recoveryCodes.map((code) => hashRecoveryCode(code, user.id))
    });
    // 저장에 성공했을 때만 대기 항목을 지운다. 디스크 오류면 QR 을 다시 찍지 않고 재시도할 수 있다(사이에 await 없음).
    if(saved.success) {
        ctx.mfa!.pending.consume(user.id);
        // #127 (U4-08): 강제 등록 중이던 이 세션은 재로그인 없이 풀린다.
        SessionStore.instance.updateSession(ctx.session!.key, {mustEnrollMfa: false});
    }
    replyResult(ctx, saved, () => ({mfa: {enabled: true, recoveryCodesRemaining: pending.recoveryCodes.length}}));
};

const onDisableMfa = async (ctx: RouteContext): Promise<void> => {
    const user = mfaUserOf(ctx);
    if(!user || !await passwordConfirmed(ctx, user)) return;
    if(ServerOptionStore.instance.serverOption.mfaRequiredForSuperusers === true && user.role === 'superuser') {
        ctx.fail(409, 'mfa_required', 'Superusers must keep two-factor authentication enabled.');
        return;
    }
    if(!user.mfa?.enabled) {
        ctx.fail(409, 'mfa_not_enabled', 'Two-factor authentication is not enabled.');
        return;
    }
    replyResult(ctx, IdentityStore.instance.clearMfa(user.id), () => ({mfa: mfaSummaryOf(undefined)}));
};

const onRegenerateRecoveryCodes = async (ctx: RouteContext): Promise<void> => {
    const user = mfaUserOf(ctx);
    if(!user || !await passwordConfirmed(ctx, user)) return;
    if(!user.mfa?.enabled) {
        ctx.fail(409, 'mfa_not_enabled', 'Two-factor authentication is not enabled.');
        return;
    }
    const recoveryCodes = generateRecoveryCodes();
    const hashes = recoveryCodes.map((code) => hashRecoveryCode(code, user.id));
    // 평문 복구 코드는 이 응답에만 실린다. 기존 코드는 모두 무효가 된다.
    replyResult(ctx, IdentityStore.instance.replaceRecoveryCodeHashes(user.id, hashes), () => ({recoveryCodes}));
};

// ---- #113 (U4-05) 세션 목록·강제 종료. 세션 키는 응답·감사에 싣지 않고 sessionIdOf 만 쓴다. ----

type SessionView = {id: string; userId: string; username: string; createdAt: number; lastSeenAt: number;
    ip: string; userAgent: string; current: boolean};

const sessionViewsOf = (ctx: RouteContext, filter: (session: Session) => boolean): SessionView[] => {
    const store = IdentityStore.instance;
    const currentKey = ctx.session!.key;
    return SessionStore.instance.listSessions()
        .filter(filter)
        .map((session) => ({
            id: SessionStore.sessionIdOf(session.key),
            userId: session.userId,
            // legacy-fallback 주체(legacy-admin)는 저장소에 없으므로 userId 를 그대로 쓴다.
            username: store.user(session.userId)?.username ?? session.userId,
            createdAt: session.createdAt,
            lastSeenAt: session.lastSeenAt,
            ip: session.ip,
            userAgent: session.userAgent ?? '',
            current: session.key === currentKey
        }))
        .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
};

const onListSessions = async (ctx: RouteContext): Promise<void> => {
    ctx.ok({sessions: sessionViewsOf(ctx, () => true)});
};

const onListMySessions = async (ctx: RouteContext): Promise<void> => {
    const userId = ctx.principal!.userId;
    ctx.ok({sessions: sessionViewsOf(ctx, (session) => session.userId === userId)});
};

const onKillSession = async (ctx: RouteContext): Promise<void> => {
    const removed = SessionStore.instance.removeSessionById(ctx.params.id);
    if(!removed) {
        ctx.fail(404, 'session_not_found', 'Session not found');
        return;
    }
    const self = removed.key === ctx.session!.key;
    ctx.auditDetail({userId: removed.userId});
    if(self) ctx.expireSessionCookies();
    ctx.ok({removed: true, self});
};

const onKillUserSessions = async (ctx: RouteContext): Promise<void> => {
    if(!IdentityStore.instance.user(ctx.params.id)) {
        ctx.fail(404, 'user_not_found', 'User not found');
        return;
    }
    // 사용자 상태(disabled 등)는 바꾸지 않는다. 세션만 끊는다.
    const removed = SessionStore.instance.removeSessionsOfUser(ctx.params.id);
    const self = ctx.params.id === ctx.principal!.userId;
    ctx.auditDetail({removed});
    if(self) ctx.expireSessionCookies();
    ctx.ok({removed, self});
};

const onLogoutOtherSessions = async (ctx: RouteContext): Promise<void> => {
    const removed = SessionStore.instance.removeSessionsOfUser(ctx.principal!.userId, {except: ctx.session!.key});
    ctx.auditDetail({removed});
    ctx.ok({removed});
};

/** #127 (U4-08) 슈퍼유저의 남의 MFA 초기화. 켜져 있지 않아도 200(멱등)이고 대상의 세션을 모두 끊는다. */
const onResetUserMfa = async (ctx: RouteContext): Promise<void> => {
    const store = IdentityStore.instance;
    if(!store.user(ctx.params.id)) {
        ctx.fail(404, 'user_not_found', 'User not found');
        return;
    }
    const cleared = store.clearMfa(ctx.params.id);
    if(!cleared.success) {
        ctx.fail(cleared.status, cleared.code, cleared.message);
        return;
    }
    SessionStore.instance.removeSessionsOfUser(ctx.params.id);
    ctx.ok({user: toUserView(store.user(ctx.params.id)!, store.groups())});
};

/**
 * 라우트 표(routes.ts)가 이름으로 가리키는 사용자·그룹 핸들러.
 * 단위 4 가 /api/me/mfa/* 와 /api/me/sessions* 를 더할 때도 이 맵에 항목을 더하고
 * 같은 ctx.ok / ctx.fail / ctx.auditDetail 을 쓴다. AdminServer.ts 에 핸들러를 새로 두지 않는다.
 */
export const rbacRouteHandlers: RouteHandlers = {
    onListSessions,
    onListMySessions,
    onKillSession,
    onKillUserSessions,
    onLogoutOtherSessions,
    onGetMe,
    onEnrollMfa,
    onConfirmMfa,
    onDisableMfa,
    onRegenerateRecoveryCodes,
    onResetUserMfa,
    onListUsers,
    onCreateUser,
    onGetUser,
    onUpdateUser,
    onDeleteUser,
    onResetUserPassword,
    onListGroups,
    onCreateGroup,
    onGetGroup,
    onUpdateGroup,
    onDeleteGroup
};
