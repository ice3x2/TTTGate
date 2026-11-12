import {authorize} from "./AdminAuthorizer";
import {AuthorizationContext} from "./AuthorizationContext";
import {enforce} from "./AttributeEnforcer";
import {IdentityStore} from "./IdentityStore";
import {Failure, MIGRATED_OWNER_ID} from "./IdentityTypes";
import {Principal} from "./Principal";
import ServerOptionStore from "../ServerOptionStore";
import {TunnelingOption} from "../../types/TunnelingOption";
import {resolveSharedUserIds, sharedUserIdsOf, sharedUsersChange} from "./TunnelSharing";
import {activatorIpOnlyOf, activatorIpsOf, placeRequesterIp, resolveActivatorIpOnly, withActivatorIps, withoutActivatorIps} from "../security/ActivatorIps";
import {withoutFormerOwnerIp} from "./TunnelActivatorIps";
import LoggerFactory from "../../util/logger/LoggerFactory";

const logger = LoggerFactory.getLogger('server', 'TunnelOwnership');

/** 목록 응답이 싣는 소유자 표현. 소유자를 해석할 수 없으면 system:migrated 로 보인다. */
/** 이슈 367 FR-1: 목록을 소유자별로 묶을 때 머리글에 쓰는 표시 이름(displayName)도 준다. username 을 받는 범위와 같다. */
export type OwnerView = {id: string; username?: string; displayName?: string};

/** 이슈 347: 공유 목록 칩에 그리는 사용자 표현. */
export type SharedUserView = {id: string; username: string; displayName: string};

type TunnelDenial = Failure;
type OwnerAdmission = {success: true; ownerId: string} | TunnelDenial;
/**
 * sharedUserIds 는 저장할 공유 목록이다(이슈 347). 본문에 없으면 저장된 목록을 그대로 둔다.
 * sharing 은 저장된 목록에 견준 변경분이다(감사용).
 * 이슈 348: activatorIpOnly 는 저장할 IP 제한이다. undefined 는 필드가 없는 옛 터널을 그대로 둔다는 뜻이다(꺼짐으로 읽는다).
 * activatorIps 는 저장할 허용 IP 목록이다. 본문의 값은 쓰지 않고 저장된 목록에서 만든다.
 * activatorIpOnlyChanged 는 기존 터널의 IP 제한이 바뀌었는가다(감사용).
 */
export type TunnelAdmission = {success: true; ownerId: string; sharedUserIds: string[]; sharing: {added: string[]; removed: string[]};
    activatorIpOnly: boolean | undefined; activatorIps: Record<string, string>; activatorIpOnlyChanged: boolean} | TunnelDenial;

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
    const user = IdentityStore.instance.user(owner.userId);
    return {id: owner.userId, username: user?.username, displayName: user?.displayName};
}

/** 재할당이 받는 ownerId. 사용자 id 이거나 system:migrated 여야 한다. */
export function resolveOwnerId(value: unknown): {success: true; ownerId: string} | Failure<422> {
    if(typeof value === 'string' && (value === MIGRATED_OWNER_ID || IdentityStore.instance.user(value) !== undefined)) {
        return {success: true, ownerId: value};
    }
    return {success: false, status: 422, code: 'owner_not_found', message: `owner not found: ${String(value)}`, values: {ownerId: String(value)}};
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
                                 request: {certInfo?: unknown; previousForwardPort?: unknown; requesterIp?: string}): TunnelAdmission {
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
    const change = sharedUsersChange(before, sharing.ids);
    const activator = admitActivatorIps(principal, next, previousOption, {ownerId: owner.ownerId, sharedUserIds: sharing.ids, unshared: change.removed},
        request.requesterIp);
    if(!activator.success) {
        return activator;
    }
    return {success: true, ownerId: owner.ownerId, sharedUserIds: sharing.ids, sharing: change, ...activator.value};
}

/**
 * 이슈 348: 저장할 IP 제한과 허용 IP 목록. 목록은 서버만 바꾸므로 본문의 activatorIps 는 보지 않는다(FR-6).
 * - 본문에 activatorIpOnly 가 없으면 새 터널은 켜고, 기존 터널은 저장된 값을 둔다(FR-1).
 * - 공유에서 빠진 사용자와 켜기 권한을 잃은 이전 소유자의 항목은 지운다(FR-5).
 * - IP 제한을 켜는 저장(새 터널 포함)과 바로 켜지는 새 터널은 요청자 항목이 없을 때 요청자 IP 를 넣는다(FR-3·FR-12).
 */
function admitActivatorIps(principal: Principal, next: TunnelingOption, previousOption: TunnelingOption | undefined,
                           saved: {ownerId: string; sharedUserIds: string[]; unshared: string[]}, requesterIp: string | undefined)
    : {success: true; value: Pick<Extract<TunnelAdmission, {success: true}>, 'activatorIpOnly' | 'activatorIps' | 'activatorIpOnlyChanged'>} | TunnelDenial {
    const wasOn = previousOption ? activatorIpOnlyOf(previousOption) : undefined;
    const resolved = resolveActivatorIpOnly(next.activatorIpOnly, wasOn);
    if(!resolved.success) {
        return resolved;
    }
    // 필드가 없는 옛 터널을 필드 없이 저장하면 그대로 없는 채로 둔다. 옛 버전으로 되돌릴 때의 모양을 지킨다.
    const keepAbsent = previousOption !== undefined && next.activatorIpOnly === undefined && previousOption.activatorIpOnly === undefined;
    let ips = withoutActivatorIps(previousOption ? activatorIpsOf(previousOption) : {}, saved.unshared);
    const formerOwnerId = previousOption ? AuthorizationContext.ownerIdOf(previousOption) : undefined;
    if(formerOwnerId !== undefined && formerOwnerId !== saved.ownerId) {
        ips = withoutFormerOwnerIp(ips, formerOwnerId, withSharedUserIds({...next, ownerId: saved.ownerId}, saved.sharedUserIds)).ips;
    }
    const turningOn = resolved.value && wasOn !== true;
    const activatesNow = previousOption === undefined && next.inactiveOnStartup !== true;
    if(turningOn || activatesNow) ips = placeRequesterIp(ips, principal.userId, requesterIp, 'add-if-missing').ips;
    return {success: true, value: {activatorIpOnly: keepAbsent ? undefined : resolved.value, activatorIps: ips,
        activatorIpOnlyChanged: wasOn !== undefined && wasOn !== resolved.value}};
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
            currentServerBufferMiB: previousOption?.bufferLimitOnServer,
            currentClientBufferMiB: previousOption?.bufferLimitOnClient});
    if(!result.success) {
        return result;
    }
    return {success: true, ownerId: principal.userId};
}

/**
 * 이슈 347 FR-7: 지운 사용자를 모든 터널의 공유 목록에서 뺀다. 이슈 348 FR-5: 허용 IP 목록의 그 사람 항목도 지운다.
 * 둘 다 판정이 저장소에서 바로 읽으므로 설정만 고친다(남은 연결은 호출자가 끊는다).
 * 사용자는 이미 지워졌으므로 실패해도 되돌리지 않고 남긴다(지운 사용자의 항목은 판정에 쓰이지 않는다).
 */
export async function removeDeletedUserFromTunnels(userId: string): Promise<void> {
    const store = ServerOptionStore.instance;
    await store.runConfigurationMutation(async () => {
        // 사용자 삭제 응답을 이 실패로 바꾸지 않는다(읽기·쓰기 모두). 남은 id 는 로그로 알리고, 다음 저장이 조용히 뺀다.
        try {
            const serverOption = store.serverOption;
            let changed = false;
            for(const option of serverOption.tunnelingOptions) {
                const ids = sharedUserIdsOf(option);
                const ips = activatorIpsOf(option);
                const sharedWith = ids.includes(userId);
                const hasIp = Object.prototype.hasOwnProperty.call(ips, userId);
                if(!sharedWith && !hasIp) continue;
                changed = true;
                if(sharedWith) withSharedUserIds(option, ids.filter((id) => id !== userId));
                if(hasIp) withActivatorIps(option, withoutActivatorIps(ips, [userId]));
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
