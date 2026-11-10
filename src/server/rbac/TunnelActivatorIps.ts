import ServerOptionStore from "../ServerOptionStore";
import {AuthorizationContext} from "./AuthorizationContext";
import {activatorIpOnlyOf, activatorIpsOf, allowedActivatorIps, usableActivatorIps, withoutActivatorIps} from "../security/ActivatorIps";
import {TunnelingOption} from "../../types/TunnelingOption";

// 이슈 348 — 저장된 허용 IP 목록과 지금의 켜기 권한으로 판정에 쓸 항목을 고른다. 접속 판정·기존 연결 정리·상태 API 가 이 모듈을 쓴다.

/** 지금 그 포트를 켤 수 있는 활성 사용자인가. 비활성·삭제·권한을 잃은 사용자의 항목은 남아 있어도 판정에 쓰지 않는다(FR-5). */
const canActivate = (port: number) => (userId: string): boolean => AuthorizationContext.activatorOf(userId, port) !== undefined;

/** 판정에 쓰이는 항목 {userId → IP}. 상태 API 의 allowedIpCount 가 이 수를 센다. */
export function effectiveActivatorIps(option: TunnelingOption): Record<string, string> {
    return usableActivatorIps(activatorIpsOf(option), canActivate(option.forwardPort));
}

/** 그 포트의 허용 IP. IP 제한이 꺼져 있거나 없는 터널이면 undefined 다. 판정마다 저장소와 권한을 새로 읽는다. */
export function activatorIpRestriction(port: number): ReadonlySet<string> | undefined {
    const option = ServerOptionStore.instance.getTunnelingOption(port);
    if(!option || !activatorIpOnlyOf(option)) return undefined;
    return allowedActivatorIps(activatorIpsOf(option), canActivate(port));
}

/** 상태 API 의 항목마다 더하는 값(FR-14). allowedIps 는 슈퍼유저에게만 준다(다른 사용자의 IP 다). */
export type ActivatorIpStatus = {activatorIpOnly: boolean; myAllowedIp: string | null; allowedIpCount: number; allowedIps?: Record<string, string>};

export function activatorIpStatusOf(option: TunnelingOption | undefined, viewer: {userId: string; superuser: boolean}): ActivatorIpStatus {
    if(!option) return {activatorIpOnly: false, myAllowedIp: null, allowedIpCount: 0};
    const ips = activatorIpsOf(option);
    return {activatorIpOnly: activatorIpOnlyOf(option), myAllowedIp: ips[viewer.userId] ?? null,
        allowedIpCount: Object.keys(effectiveActivatorIps(option)).length, ...(viewer.superuser ? {allowedIps: ips} : {})};
}

/**
 * FR-5: 소유자가 바뀌어 이전 소유자가 그 터널을 켤 수 없게 되면 그 사람의 항목을 지운다. next 는 저장하려는 설정이다.
 * 이전 소유자가 공유 목록에 있거나 슈퍼유저라 계속 켤 수 있으면 남긴다.
 */
export function withoutFormerOwnerIp(ips: Record<string, string>, formerOwnerId: string, next: TunnelingOption): {ips: Record<string, string>; removed: string[]} {
    const keeps = !Object.prototype.hasOwnProperty.call(ips, formerOwnerId) || AuthorizationContext.activatorOf(formerOwnerId, next.forwardPort,
        AuthorizationContext.targetOfOption(next, next.forwardPort)) !== undefined;
    return keeps ? {ips, removed: []} : {ips: withoutActivatorIps(ips, [formerOwnerId]), removed: [formerOwnerId]};
}
