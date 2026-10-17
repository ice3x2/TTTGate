import {Session} from "../admin/SessionStore";
import LoggerFactory from "../../util/logger/LoggerFactory";
import {IdentityStore} from "./IdentityStore";
import {
    cloneGroupAttributes,
    DEFAULT_GROUP_ATTRIBUTES,
    GroupAttributes,
    Role,
    SYSTEM_SUPERUSER_GROUP_ID
} from "./IdentityTypes";

const logger = LoggerFactory.getLogger('server', 'Principal');

/** legacy-fallback 세션이 쓰는 고정 사용자 id. SessionStore.userId 에 그대로 들어간다. */
export const LEGACY_ADMIN_USER_ID = 'legacy-admin';

/**
 * 요청 1건이 대표하는 주체. AdminAuthorizer 가 저장소를 조회하지 않고 판정할 수 있도록
 * 권한 판정에 필요한 값(역할·그룹·속성·비밀번호 변경 요구)을 모두 담아 둔다.
 */
export type Principal = {
    userId: string;
    username: string;
    role: Role;
    groupId: string;
    /** 슈퍼유저에게는 무시된다(값은 system:superuser 그룹의 것). */
    attributes: GroupAttributes;
    mustChangePassword: boolean;
    /** #127 (U4-08) 세션에 실린 MFA 등록 강제. 없으면 false 로 본다. */
    mustEnrollMfa?: boolean;
    /** identity.yaml 을 읽지 못해 .key 로만 인증한 legacy-fallback 세션. */
    legacy?: true;
};

export const LEGACY_PRINCIPAL: Readonly<Principal> = Object.freeze({
    userId: LEGACY_ADMIN_USER_ID,
    username: 'admin',
    role: 'superuser' as Role,
    groupId: SYSTEM_SUPERUSER_GROUP_ID,
    attributes: DEFAULT_GROUP_ATTRIBUTES as GroupAttributes,
    mustChangePassword: false,
    legacy: true as const
});

/**
 * 세션이 가리키는 사용자를 주체로 바꾼다. 사용자가 없거나 비활성이면 undefined 를 돌려주며,
 * 호출자(route())가 세션을 제거하고 401 을 응답한다.
 * 그룹이 사라진 경우(파일 수동 편집 등)에는 기본 속성으로 낮춰 잡고 경고만 남긴다.
 */
export function principalOf(session: Session, store: IdentityStore): Principal | undefined {
    if(session.userId === LEGACY_ADMIN_USER_ID) {
        return LEGACY_PRINCIPAL;
    }
    const user = store.user(session.userId);
    if(!user || user.status === 'disabled') {
        return undefined;
    }
    const group = store.group(user.groupId);
    if(!group) {
        logger.warn(`group not found for user ${user.id}: ${user.groupId}. falling back to default attributes`);
    }
    return {
        userId: user.id,
        username: user.username,
        role: user.role,
        groupId: user.groupId,
        attributes: group ? group.attributes : cloneGroupAttributes(DEFAULT_GROUP_ATTRIBUTES),
        mustChangePassword: user.mustChangePassword,
        mustEnrollMfa: session.mustEnrollMfa === true
    };
}
