import {authorize} from "./AdminAuthorizer";
import {AuthorizationContext} from "./AuthorizationContext";
import {enforce} from "./AttributeEnforcer";
import {IdentityStore} from "./IdentityStore";
import {MIGRATED_OWNER_ID} from "./IdentityTypes";
import {Principal} from "./Principal";
import ServerOptionStore from "../ServerOptionStore";
import {TunnelingOption} from "../../types/TunnelingOption";

/** 목록 응답이 싣는 소유자 표현. 소유자를 해석할 수 없으면 system:migrated 로 보인다. */
export type OwnerView = {id: string; username?: string};

export type TunnelAdmission =
    | {success: true; ownerId: string}
    | {success: false; status: number; code: string; message: string};

const denied = (status: number, code: string, message: string): TunnelAdmission =>
    ({success: false, status, code, message});

/** 목록·상태 조회의 가시성 판정. 두 라우트가 이 함수 하나를 쓴다. */
export function isTunnelVisibleTo(principal: Principal, port: number): boolean {
    return authorize(principal, 'tunnel:read', AuthorizationContext.targetOf(port)).allowed;
}

/** 목록 항목의 editable. 실제 수정 라우트와 같은 action 으로 판정해 표시와 동작이 갈리지 않게 한다. */
export function isTunnelEditable(principal: Principal, port: number): boolean {
    return authorize(principal, 'tunnel:update', AuthorizationContext.targetOf(port)).allowed;
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
 * 터널 쓰기 요청의 소유자를 정하고, 일반 유저면 그룹 속성까지 집행한다.
 * 소유자 판정을 여기 한 곳에 두어 핸들러와 감사가 같은 답을 쓴다.
 *
 * legacy-fallback 세션: legacy-admin 은 사용자 id 가 아니므로 소유자가 될 수 없고 항상 system:migrated 다.
 * 슈퍼유저: 본문 ownerId 를 존중하되 실재하는 사용자여야 한다. 없으면 수정은 기존 소유자를 지키고 생성은 자기 자신이 된다.
 * 일반 유저: 본문 ownerId 를 무시하고 항상 자기 자신이다.
 */
export function admitTunnelWrite(principal: Principal, next: TunnelingOption,
                                 request: {certInfo?: unknown; previousForwardPort?: unknown}): TunnelAdmission {
    const store = ServerOptionStore.instance;
    // 포트를 바꾸는 요청이 고치는 터널은 원래 포트에 있다. 이 한 번의 조회가 소유자 유지와 생성·수정 판정을 함께 정한다.
    const previousPort = request.previousForwardPort === undefined ? next.forwardPort : Number(request.previousForwardPort);
    const previousOption = store.getTunnelingOption(previousPort);
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
    if(request.certInfo !== undefined) {
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
