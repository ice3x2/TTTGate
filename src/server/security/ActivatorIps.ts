import {isIP} from "net";
import {normalizeRemoteAddress} from "./address";
import {parseBlockedAddress} from "./IpBlocklist";

// 이슈 348 — 터널을 켠 사람의 IP 에서만 연결을 받는다. 허용 IP 목록({userId → IP})의 읽기·갱신·판정 규칙이다.
// 저장소를 모르는 순수 함수만 둔다. 저장소를 읽는 쪽은 rbac/TunnelActivatorIps.ts 다.

/** 터널마다 저장하는 허용 IP 목록. 사용자마다 IP 하나다. */
export type ActivatorIps = Readonly<Record<string, string>>;

export type ActivatorIpOnlyResult = {success: true; value: boolean} | {success: false; status: 422; code: string; message: string};

/** 저장된 IP 제한. 필드가 없는 옛 터널은 꺼짐이다(업그레이드가 운영 중인 연결을 끊지 않게 한다). */
export function activatorIpOnlyOf(option: {activatorIpOnly?: unknown}): boolean {
    return option.activatorIpOnly === true;
}

/**
 * 저장할 IP 제한. stored 가 undefined 면 새 터널이다. 본문에 없으면 새 터널은 켜고(기본값), 기존 터널은 저장된 값을 둔다.
 */
export function resolveActivatorIpOnly(requested: unknown, stored: boolean | undefined): ActivatorIpOnlyResult {
    if(requested === undefined) return {success: true, value: stored ?? true};
    if(typeof requested !== 'boolean') {
        return {success: false, status: 422, code: 'activator_ip_only_invalid', message: 'activatorIpOnly must be a boolean'};
    }
    return {success: true, value: requested};
}

/** 저장된 허용 IP 목록. 손으로 고친 파일의 문자열 아닌 값은 버린다. 프로토타입 키를 피하려고 자기 속성만 새 객체에 옮긴다. */
export function activatorIpsOf(option: {activatorIps?: unknown}): Record<string, string> {
    const value = option.activatorIps;
    const ips: Record<string, string> = {};
    if(typeof value !== 'object' || value === null || Array.isArray(value)) return ips;
    for(const [userId, ip] of Object.entries(value)) {
        if(typeof ip === 'string' && ip.length > 0 && userId !== '__proto__') ips[userId] = ip;
    }
    return ips;
}

/** 허용 IP 목록을 터널 설정에 넣는다. 비면 필드를 지워 옛 설정과 같은 모양을 지킨다. */
export function withActivatorIps<T extends {activatorIps?: Record<string, string>}>(option: T, ips: ActivatorIps): T {
    if(Object.keys(ips).length > 0) option.activatorIps = {...ips};
    else delete option.activatorIps;
    return option;
}

/**
 * 비교에 쓰는 IP 표기. 요청자 IP 와 연결 IP 가 이 함수 하나를 쓴다(FR-7). IPv6 는 차단 목록과 같은 정규화로
 * RFC 5952 압축형(IPv4-mapped 는 IPv4)으로 바꾼다. X-Forwarded-For 의 펼친 표기도 소켓 주소와 같아진다.
 */
export function canonicalIp(address: string): string {
    const host = normalizeRemoteAddress(address);
    if(isIP(host) !== 6) return host.toLowerCase();
    const parsed = parseBlockedAddress(host);
    return parsed.ok ? parsed.address : host.toLowerCase();
}

/** 관리 요청의 요청자 IP. 주소를 모르면("unknown") 없다. */
export function requesterIpOf(clientAddress: string | undefined): string | undefined {
    if(clientAddress === undefined || clientAddress === '' || clientAddress === 'unknown') return undefined;
    return canonicalIp(clientAddress);
}

/** 요청자 자신의 항목만 넣거나 바꾼다. 다른 사용자의 항목은 그대로 둔다. */
export function withActivatorIp(ips: ActivatorIps, userId: string, ip: string): Record<string, string> {
    return {...ips, [userId]: ip};
}

/** replace: 켜기·갱신(요청자 항목을 지금 IP 로 넣거나 바꾼다). add-if-missing: IP 제한을 켤 때(항목이 없을 때만 넣는다). */
export type RequesterIpMode = 'replace' | 'add-if-missing';
export type RequesterIpPlacement = {ips: Record<string, string>; before: string | null; after: string | null; changed: boolean};

/** 요청자 항목을 정한다. 요청자 IP 를 모르면 바꾸지 않는다. before·after 는 감사 detail 에 남길 요청자 항목이다. */
export function placeRequesterIp(ips: ActivatorIps, userId: string, requesterIp: string | undefined, mode: RequesterIpMode): RequesterIpPlacement {
    const before = Object.prototype.hasOwnProperty.call(ips, userId) ? ips[userId] : null;
    const keep = requesterIp === undefined || (mode === 'add-if-missing' && before !== null) || before === requesterIp;
    if(keep) return {ips: {...ips}, before, after: before, changed: false};
    return {ips: withActivatorIp(ips, userId, requesterIp), before, after: requesterIp, changed: true};
}

/** 빠진 사용자(공유 해제·삭제·켜기 권한을 잃은 이전 소유자)의 항목을 지운다. */
export function withoutActivatorIps(ips: ActivatorIps, userIds: readonly string[]): Record<string, string> {
    return Object.fromEntries(Object.entries(ips).filter(([userId]) => !userIds.includes(userId)));
}

/** 판정에 쓰는 항목. 지금 켜기 권한이 있는 사용자의 항목만 남긴다(비활성·권한을 잃은 사용자의 항목은 저장되어 있어도 뺀다). */
export function usableActivatorIps(ips: ActivatorIps, canToggle: (userId: string) => boolean): Record<string, string> {
    return Object.fromEntries(Object.entries(ips).filter(([userId]) => canToggle(userId)));
}

/** 판정에 쓰는 허용 IP 집합. usableActivatorIps 의 IP 를 비교용 표기로 바꾼다. */
export function allowedActivatorIps(ips: ActivatorIps, canToggle: (userId: string) => boolean): Set<string> {
    return new Set(Object.values(usableActivatorIps(ips, canToggle)).map(canonicalIp));
}

/** 연결 IP 가 허용 IP 인가. 주소를 모르면 거부한다. 목록이 비면 모두 거부한다. */
export function isActivatorIpAllowed(allowed: ReadonlySet<string>, remoteAddress: string | undefined): boolean {
    if(remoteAddress === undefined || remoteAddress === '') return false;
    return allowed.has(canonicalIp(remoteAddress));
}
