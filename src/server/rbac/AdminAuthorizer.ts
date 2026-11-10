import {Principal} from "./Principal";
import {AdminUiSection} from "./IdentityTypes";

export type Action =
    | 'user:manage' | 'group:manage' | 'server:manage' | 'security:manage' | 'session:manage' | 'audit:read-all'
    | 'tunnel:list' | 'tunnel:create' | 'tunnel:read' | 'tunnel:update' | 'tunnel:delete' | 'tunnel:activate' | 'tunnel:cert' | 'tunnel:reassign'
    | 'user:lookup'
    | 'status:read' | 'me:read' | 'me:password' | 'me:sessions' | 'me:mfa' | 'me:passkey' | 'audit:read-self';

/**
 * owner 가 없으면 system:migrated 소유이거나 아직 존재하지 않는 터널이다. 라우트 계층이 채운다.
 * sharedUserIds 는 이슈 347 의 공유 목록이다. 없으면 공유가 없다.
 */
export type Target = {port?: number; owner?: {userId: string; groupId: string}; sharedUserIds?: readonly string[]};

export type Decision = {allowed: true} | {allowed: false; status: 403 | 404; code: string};

export type Section = 'status' | 'tunnels' | 'server' | 'users' | 'groups' | 'security' | 'audit' | 'sessions' | 'me';

const ALLOWED: Decision = {allowed: true};
const FORBIDDEN: Decision = {allowed: false, status: 403, code: 'forbidden'};
const NOT_FOUND: Decision = {allowed: false, status: 404, code: 'not_found'};
const READ_ONLY: Decision = {allowed: false, status: 403, code: 'read_only'};
const TUNNEL_ACCESS_DISABLED: Decision = {allowed: false, status: 403, code: 'tunnel_access_disabled'};
const TUNNEL_CREATE_FORBIDDEN: Decision = {allowed: false, status: 403, code: 'tunnel_create_forbidden'};
const PASSWORD_CHANGE_REQUIRED: Decision = {allowed: false, status: 403, code: 'password_change_required'};
const MFA_ENROLLMENT_REQUIRED: Decision = {allowed: false, status: 403, code: 'mfa_enrollment_required'};
// 이슈 346: 패스키도 2단계 수단이므로 등록 중에 패스키를 등록할 수 있다.
const MFA_ENROLLMENT_ACTIONS: ReadonlySet<Action> = new Set<Action>(['me:read', 'me:password', 'me:mfa', 'me:sessions', 'me:passkey']);

const SUPERUSER_SECTIONS: readonly Section[] = ['status', 'tunnels', 'server', 'users', 'groups', 'security', 'audit', 'sessions', 'me'];

const SECTION_OF_ATTRIBUTE: Readonly<Record<AdminUiSection, Section>> = {
    tunnels: 'tunnels',
    my_audit: 'audit',
    my_profile: 'me',
    my_sessions: 'sessions'
};

function isOwned(principal: Principal, target?: Target): boolean {
    return target?.owner !== undefined && target.owner.userId === principal.userId;
}

/** 소유하지 않았지만 그룹 공유(tunnel_visibility === 'group_read') 로 볼 수 있는 터널인가. */
function isGroupShared(principal: Principal, target?: Target): boolean {
    return target?.owner !== undefined
        && principal.attributes.tunnel_visibility === 'group_read'
        && target.owner.groupId === principal.groupId;
}

/** 이슈 347: 공유 목록에 든 터널인가. 소유자와 무관하다. */
function isSharedWith(principal: Principal, target?: Target): boolean {
    return target?.sharedUserIds?.includes(principal.userId) === true;
}

function canReadTunnel(principal: Principal, target?: Target): boolean {
    if(principal.attributes.tunnel_crud === 'none') {
        return false;
    }
    return isOwned(principal, target) || isGroupShared(principal, target) || isSharedWith(principal, target);
}

/**
 * tunnel:update / tunnel:delete 의 판정. 소유자이고 full 일 때만 고친다(공유만으로는 고칠 수 없다).
 * 읽을 수는 있으나 고칠 수 없으면 403 read_only, 애초에 읽을 수도 없으면 404 로 존재를 숨긴다.
 */
function authorizeTunnelWrite(principal: Principal, target?: Target): Decision {
    if(isOwned(principal, target) && principal.attributes.tunnel_crud === 'full') {
        return ALLOWED;
    }
    return canReadTunnel(principal, target) ? READ_ONLY : NOT_FOUND;
}

/**
 * 이슈 347: tunnel:activate 는 고치기와 따로 판정한다. 소유자는 full·toggle 이면, 공유된 사용자는 none 이 아니면 켠다.
 * 거부 응답은 고치기와 같다(보이면 403 read_only, 안 보이면 404).
 */
function authorizeTunnelActivate(principal: Principal, target?: Target): Decision {
    const crud = principal.attributes.tunnel_crud;
    const ownerCanToggle = isOwned(principal, target) && (crud === 'full' || crud === 'toggle');
    if(crud !== 'none' && (ownerCanToggle || isSharedWith(principal, target))) {
        return ALLOWED;
    }
    return canReadTunnel(principal, target) ? READ_ONLY : NOT_FOUND;
}

/**
 * PRD 부록 A 권한 매트릭스를 코드로 옮긴 순수 함수. 저장소를 조회하지 않으므로
 * 호출부가 target.owner 를 채워 넣어야 소유 기반 판정이 성립한다(#100 (U2-08)).
 */
export function authorize(principal: Principal, action: Action, target?: Target): Decision {
    if(principal.mustChangePassword && action !== 'me:read' && action !== 'me:password') {
        return PASSWORD_CHANGE_REQUIRED;
    }
    // #127 (U4-08) 비밀번호 게이트 다음이다. 등록을 마칠 때까지 me 계열만 쓴다.
    if(principal.mustEnrollMfa === true && !MFA_ENROLLMENT_ACTIONS.has(action)) {
        return MFA_ENROLLMENT_REQUIRED;
    }
    if(principal.role === 'superuser') {
        return ALLOWED;
    }
    switch(action) {
        case 'me:read':
        case 'me:password':
        case 'me:sessions':
        case 'me:mfa':
        case 'me:passkey':
        case 'audit:read-self':
            return ALLOWED;
        case 'tunnel:list':
            return principal.attributes.tunnel_crud !== 'none' ? ALLOWED : TUNNEL_ACCESS_DISABLED;
        case 'tunnel:create':
            return principal.attributes.tunnel_crud === 'full' && principal.attributes.max_tunnel_count > 0
                ? ALLOWED : TUNNEL_CREATE_FORBIDDEN;
        case 'tunnel:read':
            return canReadTunnel(principal, target) ? ALLOWED : NOT_FOUND;
        case 'tunnel:update':
        case 'tunnel:delete':
            return authorizeTunnelWrite(principal, target);
        case 'tunnel:activate':
            return authorizeTunnelActivate(principal, target);
        case 'user:lookup':
            // 이슈 347: 공유할 사용자를 고르는 검색이다. 터널을 고칠 수 있는 그룹만 쓴다.
            return principal.attributes.tunnel_crud === 'full' ? ALLOWED : FORBIDDEN;
        default:
            // user:manage group:manage server:manage security:manage session:manage
            // audit:read-all status:read tunnel:reassign tunnel:cert — 슈퍼유저 전용.
            return FORBIDDEN;
    }
}

/** 관리자 UI 가 그릴 수 있는 섹션 목록. 권한 없는 섹션은 비활성이 아니라 비노출이다(PRD §7). */
export function sections(principal: Principal): Section[] {
    if(principal.role === 'superuser') {
        return [...SUPERUSER_SECTIONS];
    }
    const tunnelsDisabled = principal.attributes.tunnel_crud === 'none';
    return principal.attributes.admin_ui_section_access
        .filter((section) => !(tunnelsDisabled && section === 'tunnels'))
        .map((section) => SECTION_OF_ATTRIBUTE[section]);
}
