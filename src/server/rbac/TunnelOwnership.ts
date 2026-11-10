import {authorize} from "./AdminAuthorizer";
import {AuthorizationContext} from "./AuthorizationContext";
import {enforce} from "./AttributeEnforcer";
import {IdentityStore} from "./IdentityStore";
import {MIGRATED_OWNER_ID} from "./IdentityTypes";
import {Principal} from "./Principal";
import ServerOptionStore from "../ServerOptionStore";
import {TunnelingOption} from "../../types/TunnelingOption";
import {resolveSharedUserIds, sharedUserIdsOf, sharedUsersChange} from "./TunnelSharing";
import LoggerFactory from "../../util/logger/LoggerFactory";

const logger = LoggerFactory.getLogger('server', 'TunnelOwnership');

/** 목록 응답이 싣는 소유자 표현. 소유자를 해석할 수 없으면 system:migrated 로 보인다. */
export type OwnerView = {id: string; username?: string};

/** 이슈 347: 공유 목록 칩에 그리는 사용자 표현. */
export type SharedUserView = {id: string; username: string; displayName: string};

type TunnelDenial = {success: false; status: number; code: string; message: string};
type OwnerAdmission = {success: true; ownerId: string} | TunnelDenial;
/**
 * sharedUserIds 는 저장할 공유 목록이다(이슈 347). 본문에 없으면 저장된 목록을 그대로 둔다.
 * sharing 은 저장된 목록에 견준 변경분이다(감사용).
 */
export type TunnelAdmission = {success: true; ownerId: string; sharedUserIds: string[]; sharing: {added: string[]; removed: string[]}} | TunnelDenial;

const denied = (status: number, code: string, message: string): TunnelDenial =>
    ({success: false, status, code, message});

/** 목록·상태 조회의 가시성 판정. 두 라우트가 이 함수 하나를 쓴다. */
export function isTunnelVisibleTo(principal: Principal, port: number): boolean {
    return authorize(principal, 'tunnel:read', AuthorizationContext.targetOf(port)).allowed;
}

/** 목록 항목의 editable. 실제 수정 라우트와 같은 action 으로 판정해 표시와 동작이 갈리지 않게 한다. */
export function isTunnelEditable(principal: Principal, port: number): boolean {
    return authorize(principal, 'tunnel:update', AuthorizationContext.targetOf(port)).allowed;
}

/** 이슈 347: 목록 항목의 toggleable. 켜기 라우트와 같은 action 으로 판정한다. */
export function isTunnelToggleable(principal: Principal, port: number): boolean {
    return authorize(principal, 'tunnel:activate', AuthorizationContext.targetOf(port)).allowed;
}

/** 이슈 347: 아직 있는 사용자의 공유 id. 조회 응답의 sharedUserIds 와 sharedUsers 가 이 결과 하나를 쓴다. */
export function existingSharedUserIds(ids: readonly string[]): string[] {
    return ids.filter((id) => IdentityStore.instance.user(id) !== undefined);
}

/** 이슈 347: 공유 목록의 사용자 표현. 사라진 사용자는 뺀다. */
export function sharedUsersOf(ids: readonly string[]): SharedUserView[] {
    return ids.flatMap((id) => {
        const user = IdentityStore.instance.user(id);
        return user ? [{id: user.id, username: user.username, displayName: user.displayName}] : [];
    });
}

/**
 * 소유자 표현. 소유자가 없거나(system:migrated) 사용자가 사라진 터널은 모두 system:migrated 로 보인다.
 * authorize 가 그 둘을 똑같이 "소유자 없음" 으로 다루므로 표시도 같아야 한다.
 */
export function ownerViewOf(port: number): OwnerView {
    const owner = AuthorizationContext.ownerOf(port);
    if(!owner) {
        return {id: MIGRATED_OWNER_ID};
    }
    return {id: owner.userId, username: IdentityStore.instance.user(owner.userId)?.username};
}

/** 재할당이 받는 ownerId. 사용자 id 이거나 system:migrated 여야 한다. */
export function resolveOwnerId(value: unknown): {success: true; ownerId: string} | {success: false; status: 422; code: string; message: string} {
    if(typeof value === 'string' && (value === MIGRATED_OWNER_ID || IdentityStore.instance.user(value) !== undefined)) {
        return {success: true, ownerId: value};
    }
    return {success: false, status: 422, code: 'owner_not_found', message: `owner not found: ${String(value)}`};
}

const trustedClientIdsOf = (): string[] =>
    (ServerOptionStore.instance.serverOption.trustedClients ?? [])
        .map((client) => client.clientId)
        .filter((clientId): clientId is string => typeof clientId === 'string');

/**
 * 터널 쓰기 요청의 소유자와 공유 목록을 정하고, 일반 유저면 그룹 속성까지 집행한다.
 * 판정을 여기 한 곳에 두어 핸들러와 감사가 같은 답을 쓴다.
 *
 * legacy-fallback 세션: legacy-admin 은 사용자 id 가 아니므로 소유자가 될 수 없고 항상 system:migrated 다.
 * 슈퍼유저: 본문 ownerId 를 존중하되 실재하는 사용자여야 한다. 없으면 수정은 기존 소유자를 지키고 생성은 자기 자신이 된다.
 * 일반 유저: 본문 ownerId 를 무시하고 항상 자기 자신이다.
 * 공유 목록(이슈 347): 저장 권한이 있는 사람만 여기까지 온다. 본문에 없으면 저장된 목록을 새 소유자 기준으로 다시 정규화한다.
 */
export function admitTunnelWrite(principal: Principal, next: TunnelingOption,
                                 request: {certInfo?: unknown; previousForwardPort?: unknown}): TunnelAdmission {
    // 포트를 바꾸는 요청이 고치는 터널은 원래 포트에 있다. 이 한 번의 조회가 소유자 유지와 생성·수정 판정을 함께 정한다.
    const previousPort = request.previousForwardPort === undefined ? next.forwardPort : Number(request.previousForwardPort);
    const previousOption = ServerOptionStore.instance.getTunnelingOption(previousPort);
    const owner = admitOwner(principal, next, request.certInfo, previousPort, previousOption);
    if(!owner.success) {
        return owner;
    }
    const before = previousOption ? sharedUserIdsOf(previousOption) : [];
    const sharing = resolveSharedUserIds(next.sharedUserIds, {ownerId: owner.ownerId, stored: before, userOf: (id) => IdentityStore.instance.user(id)});
    if(!sharing.success) {
        return sharing;
    }
    return {success: true, ownerId: owner.ownerId, sharedUserIds: sharing.ids, sharing: sharedUsersChange(before, sharing.ids)};
}

function admitOwner(principal: Principal, next: TunnelingOption, certInfo: unknown, previousPort: number,
                    previousOption: TunnelingOption | undefined): OwnerAdmission {
    const renaming = previousPort !== next.forwardPort;
    if(principal.legacy) {
        return {success: true, ownerId: MIGRATED_OWNER_ID};
    }
    if(principal.role === 'superuser') {
        const requested: unknown = next.ownerId;
        if(requested !== undefined) {
            const resolved = resolveOwnerId(requested);
            return resolved.success ? {success: true, ownerId: resolved.ownerId} : resolved;
        }
        return {success: true, ownerId: previousOption ? AuthorizationContext.ownerIdOf(previousOption) : principal.userId};
    }

    // 외부 인증서는 tunnel:cert(슈퍼유저 전용)다. 터널 쓰기 권한으로 얹을 수 없다.
    if(certInfo !== undefined) {
        return denied(403, 'forbidden', 'uploading a certificate requires tunnel:cert');
    }
    // 포트를 바꾸는 요청은 원래 포트에 대한 수정 권한도 있어야 한다.
    if(renaming) {
        const decision = authorize(principal, 'tunnel:update', AuthorizationContext.targetOf(previousPort));
        if(!decision.allowed) {
            return denied(decision.status, decision.code, decision.status === 403 ? 'Forbidden' : 'Not Found');
        }
    }
    // 고치려는 터널이 이미 있으면 수정이다. 포트를 바꾸는 요청도 새 터널이 아니므로 개수 상한을 다시 세지 않는다.
    const mode = previousOption ? 'update' : 'create';
    const result = enforce(principal, {...next, ownerId: principal.userId}, mode,
        {ownedCount: AuthorizationContext.ownedCount(principal.userId), trustedClientIds: trustedClientIdsOf(),
            maxServerBufferMiB: ServerOptionStore.instance.serverOption.globalMemCacheLimit,
            currentServerBufferMiB: previousOption?.bufferLimitOnServer});
    if(!result.success) {
        return denied(result.status, result.code, result.message);
    }
    return {success: true, ownerId: principal.userId};
}

/**
 * 이슈 347 FR-7: 지운 사용자를 모든 터널의 공유 목록에서 뺀다. 공유 목록은 런타임이 쓰지 않으므로 설정만 고친다.
 * 사용자는 이미 지워졌으므로 실패해도 되돌리지 않고 남긴다(지운 사용자는 로그인할 수 없어 남은 id 로 할 수 있는 일이 없다).
 */
export async function removeSharedUserEverywhere(userId: string): Promise<void> {
    const store = ServerOptionStore.instance;
    await store.runConfigurationMutation(async () => {
        // 사용자 삭제 응답을 이 실패로 바꾸지 않는다(읽기·쓰기 모두). 남은 id 는 로그로 알리고, 다음 저장이 조용히 뺀다.
        try {
            const serverOption = store.serverOption;
            let changed = false;
            for(const option of serverOption.tunnelingOptions) {
                const ids = sharedUserIdsOf(option);
                if(!ids.includes(userId)) continue;
                changed = true;
                withSharedUserIds(option, ids.filter((id) => id !== userId));
            }
            if(changed && !store.commitPreparedServerOption(serverOption).success) {
                logger.error(`failed to remove deleted user ${userId} from tunnel sharing lists`);
            }
        } catch(error) {
            logger.error(`failed to remove deleted user ${userId} from tunnel sharing lists`, error);
        }
    });
}

/** 공유 목록을 터널 설정에 넣는다. 비면 필드를 지워 옛 설정과 같은 모양을 지킨다. */
export function withSharedUserIds(option: TunnelingOption, ids: string[]): TunnelingOption {
    if(ids.length > 0) option.sharedUserIds = ids;
    else delete option.sharedUserIds;
    return option;
}
