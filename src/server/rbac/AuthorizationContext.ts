import {authorize, Target} from "./AdminAuthorizer";
import {IdentityStore} from "./IdentityStore";
import {cloneGroupAttributes, DEFAULT_GROUP_ATTRIBUTES, GroupAttributes, MIGRATED_OWNER_ID, Role} from "./IdentityTypes";
import ServerOptionStore from "../ServerOptionStore";
import {TunnelingOption} from "../../types/TunnelingOption";
import LoggerFactory from "../../util/logger/LoggerFactory";
import {sharedUserIdsOf} from "./TunnelSharing";

const logger = LoggerFactory.getLogger('server', 'AuthorizationContext');

export type OwnerInfo = {userId: string; groupId: string; role: Role};

/** 고아 소유자 경고를 이미 남긴 포트. 로그 폭주를 막기 위한 이 모듈의 유일한 상태이며 조회 결과는 캐시하지 않는다. */
const warnedOrphanPorts = new Set<number>();

/** ownerId 가 없거나 문자열이 아니거나 비어 있으면 슈퍼유저만 다룰 수 있는 system:migrated 소유로 본다. */
function ownerIdOf(option: TunnelingOption): string {
    const ownerId: unknown = option.ownerId;
    return typeof ownerId === 'string' && ownerId.length > 0 ? ownerId : MIGRATED_OWNER_ID;
}

/**
 * 저장된 터널 하나의 소유자를 해석한다. ownerOf·portsOfGroup·ownedCount 가 모두 이 판정 하나를 쓴다.
 * system:migrated 이거나 사용자가 없으면 undefined 다(authorize 는 소유자 없는 터널을 슈퍼유저 전용으로 다룬다).
 */
function resolveOwner(option: TunnelingOption): OwnerInfo | undefined {
    const ownerId = ownerIdOf(option);
    if(ownerId === MIGRATED_OWNER_ID) {
        return undefined;
    }
    const user = IdentityStore.instance.user(ownerId);
    if(!user) {
        if(!warnedOrphanPorts.has(option.forwardPort)) {
            warnedOrphanPorts.add(option.forwardPort);
            logger.warn(`tunnel ${option.forwardPort} owner ${ownerId} not found; treating as system:migrated`);
        }
        return undefined;
    }
    return {userId: user.id, groupId: user.groupId, role: user.role};
}

function ownerOf(port: number): OwnerInfo | undefined {
    const option = ServerOptionStore.instance.getTunnelingOption(port);
    return option ? resolveOwner(option) : undefined;
}

/** #100 (U2-08) 의 라우트가 authorize 에 넘기는 대상. 이슈 347 의 공유 목록은 비어 있지 않을 때만 싣는다. */
function targetOf(port: number): Target {
    const option = ServerOptionStore.instance.getTunnelingOption(port);
    const owner = option ? resolveOwner(option) : undefined;
    const sharedUserIds = option ? sharedUserIdsOf(option) : [];
    return {port, owner: owner ? {userId: owner.userId, groupId: owner.groupId} : undefined,
        ...(sharedUserIds.length > 0 ? {sharedUserIds} : {})};
}

/** 없는 그룹이면 기본값의 복사본을 준다. 어느 경우든 저장소·상수와 참조를 공유하지 않는다. */
function groupAttributes(groupId: string): GroupAttributes {
    const group = IdentityStore.instance.group(groupId);
    return group ? group.attributes : cloneGroupAttributes(DEFAULT_GROUP_ATTRIBUTES as GroupAttributes);
}

/** 한 사용자가 소유한 포트. 사용자 삭제 가드가 포트를 알려줘야 하므로 개수만이 아니라 목록을 돌려준다. */
function portsOfOwner(userId: string): number[] {
    return ServerOptionStore.instance.getTunnelingOptions()
        .filter((option) => resolveOwner(option)?.userId === userId)
        .map((option) => option.forwardPort)
        .sort((left, right) => left - right);
}

function portsOfGroup(groupId: string): number[] {
    return ServerOptionStore.instance.getTunnelingOptions()
        .filter((option) => resolveOwner(option)?.groupId === groupId)
        .map((option) => option.forwardPort)
        .sort((left, right) => left - right);
}

/**
 * 이슈 347 FR-15: 수명 상한에 넣을 켠 사람. 지금 그 포트를 켤 수 있는 활성 사용자만 준다.
 * 삭제되었거나 켜기 권한을 잃었으면 undefined 이고, 그때는 소유자 그룹 상한만 쓴다.
 * 비밀번호 변경·MFA 등록 요구는 로그인 절차의 일이므로 보지 않는다.
 */
function activatorOf(userId: string, port: number): OwnerInfo | undefined {
    const user = IdentityStore.instance.user(userId);
    if(!user || user.status !== 'active') {
        return undefined;
    }
    const decision = authorize({userId: user.id, username: user.username, role: user.role, groupId: user.groupId,
        attributes: groupAttributes(user.groupId), mustChangePassword: false}, 'tunnel:activate', targetOf(port));
    return decision.allowed ? {userId: user.id, groupId: user.groupId, role: user.role} : undefined;
}

function isSuperuserOwned(port: number): boolean {
    return ownerOf(port)?.role === 'superuser';
}

function ownedCount(userId: string): number {
    return portsOfOwner(userId).length;
}

/**
 * 터널의 소유자와 그룹 속성을 조회한다. 매 호출마다 ServerOptionStore 와 IdentityStore 를 새로 읽는 순수 조회다.
 * 5 단위(#120 (U5-05)~)가 이 계약을 그대로 쓴다.
 */
export const AuthorizationContext = {
    ownerIdOf,
    ownerOf,
    targetOf,
    groupAttributes,
    portsOfGroup,
    portsOfOwner,
    isSuperuserOwned,
    ownedCount,
    activatorOf,
    resetForTest(): void {
        warnedOrphanPorts.clear();
    }
};

// 5 단위(#122~#124)는 기본 내보내기로 가져온다. 이름 내보내기와 같은 객체다.
export default AuthorizationContext;
