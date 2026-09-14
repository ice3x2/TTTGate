import SessionStore from "./SessionStore";
import {auditEventOf, isFieldProvided, RouteContext, RouteHandlers} from "./routes";
import {recordAuditEvent} from "../audit/AuditSink";
import {IdentityStore} from "../rbac/IdentityStore";
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
        type: 'temp_password_issued',
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
    replyResult(ctx, store.updateUser(ctx.params.id, patch), (user) => ({user: toUserView(user, store.groups())}));
};

const onDeleteUser = async (ctx: RouteContext): Promise<void> => {
    replyResult(ctx, IdentityStore.instance.deleteUser(ctx.params.id), () => ({}));
};

const onResetUserPassword = async (ctx: RouteContext): Promise<void> => {
    const temporary = resolveTemporaryPassword(ctx);
    if(!temporary) {
        return;
    }
    const store = IdentityStore.instance;
    const stored = await store.setPassword(ctx.params.id, temporary.password, {clearMustChange: false});
    if(!stored.success) {
        ctx.fail(stored.status, stored.code, stored.message);
        return;
    }
    const updated = store.updateUser(ctx.params.id, {mustChangePassword: true});
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
    ctx.ok({group: toGroupView(updated.value)});
};

const onDeleteGroup = async (ctx: RouteContext): Promise<void> => {
    replyResult(ctx, IdentityStore.instance.deleteGroup(ctx.params.id), () => ({}));
};

/**
 * 라우트 표(routes.ts)가 이름으로 가리키는 사용자·그룹 핸들러.
 * 단위 4 가 /api/me/mfa/* 와 /api/me/sessions* 를 더할 때도 이 맵에 항목을 더하고
 * 같은 ctx.ok / ctx.fail / ctx.auditDetail 을 쓴다. AdminServer.ts 에 핸들러를 새로 두지 않는다.
 */
export const rbacRouteHandlers: RouteHandlers = {
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
