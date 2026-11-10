import {Group, Role, User, UserStatus} from "./IdentityTypes";
import {isMfaRequired, type MfaPolicyOptions} from "./MfaPolicy";

/** 관리 API 가 내보내는 사용자 표현. passwordHash 를 제외하고 groupName 을 더한다. */
export type UserView = {
    id: string;
    username: string;
    displayName: string;
    role: Role;
    status: UserStatus;
    groupId: string;
    groupName: string;
    mustChangePassword: boolean;
    migratedFromLegacyAdmin: boolean;
    /** #112 (U4-04). mfa 객체 자체는 어떤 응답에도 넣지 않는다. */
    mfaEnabled: boolean;
    /** #336 등록한 패스키 수. 패스키 자체는 담지 않는다. */
    passkeyCount: number;
    /** 이슈 346: 이 사용자가 2단계 인증 강제 대상인가(그룹 속성 또는 슈퍼유저 서버 옵션). */
    mfaRequired: boolean;
    createdAt: number;
    updatedAt: number;
};

/** 그룹 참조가 끊어진 사용자는 groupId 를 이름 자리에 넣어 추적 가능하게 남긴다. */
export function toUserView(user: User, groups: Group[], mfa: MfaPolicyOptions): UserView {
    const group = groups.find((candidate) => candidate.id === user.groupId);
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        groupId: user.groupId,
        groupName: group?.name ?? user.groupId,
        mustChangePassword: user.mustChangePassword,
        migratedFromLegacyAdmin: user.migratedFromLegacyAdmin,
        mfaEnabled: user.mfa?.enabled === true,
        passkeyCount: user.passkeys?.length ?? 0,
        mfaRequired: isMfaRequired(user, group?.attributes, mfa),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
    };
}
