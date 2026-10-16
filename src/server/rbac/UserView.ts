import {Group, Role, User, UserStatus} from "./IdentityTypes";

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
    createdAt: number;
    updatedAt: number;
};

/** 그룹 참조가 끊어진 사용자는 groupId 를 이름 자리에 넣어 추적 가능하게 남긴다. */
export function toUserView(user: User, groups: Group[]): UserView {
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        groupId: user.groupId,
        groupName: groups.find((group) => group.id === user.groupId)?.name ?? user.groupId,
        mustChangePassword: user.mustChangePassword,
        migratedFromLegacyAdmin: user.migratedFromLegacyAdmin,
        mfaEnabled: user.mfa?.enabled === true,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
    };
}
