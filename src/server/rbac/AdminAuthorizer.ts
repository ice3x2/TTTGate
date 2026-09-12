import {Principal} from "./Principal";
import {AdminUiSection} from "./IdentityTypes";

export type Action =
    | 'user:manage' | 'group:manage' | 'server:manage' | 'security:manage' | 'session:manage' | 'audit:read-all'
    | 'tunnel:list' | 'tunnel:create' | 'tunnel:read' | 'tunnel:update' | 'tunnel:delete' | 'tunnel:activate' | 'tunnel:cert' | 'tunnel:reassign'
    | 'status:read' | 'me:read' | 'me:password' | 'me:sessions' | 'audit:read-self';

/** owner 가 없으면 system:migrated 소유이거나 아직 존재하지 않는 터널이다. 라우트 계층이 채운다. */
export type Target = {port?: number; owner?: {userId: string; groupId: string}};

export type Decision = {allowed: true} | {allowed: false; status: 403 | 404; code: string};

export type Section = 'status' | 'tunnels' | 'server' | 'users' | 'groups' | 'security' | 'audit' | 'sessions' | 'me';

const ALLOWED: Decision = {allowed: true};
const FORBIDDEN: Decision = {allowed: false, status: 403, code: 'forbidden'};
const NOT_FOUND: Decision = {allowed: false, status: 404, code: 'not_found'};
const READ_ONLY: Decision = {allowed: false, status: 403, code: 'read_only'};
const TUNNEL_ACCESS_DISABLED: Decision = {allowed: false, status: 403, code: 'tunnel_access_disabled'};
const TUNNEL_CREATE_FORBIDDEN: Decision = {allowed: false, status: 403, code: 'tunnel_create_forbidden'};
const PASSWORD_CHANGE_REQUIRED: Decision = {allowed: false, status: 403, code: 'password_change_required'};

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

function canReadTunnel(principal: Principal, target?: Target): boolean {
    if(principal.attributes.tunnel_crud === 'none') {
        return false;
    }
    return isOwned(principal, target) || isGroupShared(principal, target);
}

/**
 * tunnel:update / tunnel:delete / tunnel:activate 의 공통 판정.
 * 읽을 수는 있으나 고칠 수 없으면 403 read_only, 애초에 읽을 수도 없으면 404 로 존재를 숨긴다.
 */
function authorizeTunnelWrite(principal: Principal, target?: Target): Decision {
    const owned = isOwned(principal, target);
    if(!owned && canReadTunnel(principal, target)) {
        return READ_ONLY;
    }
    if(owned && principal.attributes.tunnel_crud === 'full') {
        return ALLOWED;
    }
    if(owned && principal.attributes.tunnel_crud === 'read_only') {
        return READ_ONLY;
    }
    return NOT_FOUND;
}

/**
 * PRD 부록 A 권한 매트릭스를 코드로 옮긴 순수 함수. 저장소를 조회하지 않으므로
 * 호출부가 target.owner 를 채워 넣어야 소유 기반 판정이 성립한다(#100 (U2-08)).
 */
export function authorize(principal: Principal, action: Action, target?: Target): Decision {
    if(principal.mustChangePassword && action !== 'me:read' && action !== 'me:password') {
        return PASSWORD_CHANGE_REQUIRED;
    }
    if(principal.role === 'superuser') {
        return ALLOWED;
    }
    switch(action) {
        case 'me:read':
        case 'me:password':
        case 'me:sessions':
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
        case 'tunnel:activate':
            return authorizeTunnelWrite(principal, target);
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
