import {isIP} from "net";

const IPV4_MAPPED_PATTERN = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
const IPV4_PATTERN = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;

export function normalizeRemoteAddress(addr: string): string {
    const withoutZone = addr.split('%')[0];
    const v4Mapped = withoutZone.match(IPV4_MAPPED_PATTERN);
    return v4Mapped ? v4Mapped[1] : withoutZone;
}

export function isPrivateAddress(ip: string): boolean {
    const normalized = normalizeRemoteAddress(ip);

    const v4 = normalized.match(IPV4_PATTERN);
    if (v4) {
        const a = Number(v4[1]);
        const b = Number(v4[2]);
        if (a === 10) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 127) return true;
        if (a === 169 && b === 254) return true;
        return false;
    }

    if (normalized === '::1') return true;

    const lower = normalized.toLowerCase();
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

    return false;
}

/**
 * IPv6 주소를 16비트 그룹 8개로 편다. `::` 압축, 대소문자, 끝의 IPv4 점 표기(`::ffff:1.2.3.4`)를 받는다.
 * 형식이 맞는 IPv6 가 아니면(존 표기 `%eth0` 포함) undefined 다. 레이트 리밋 버킷과 차단 목록 정규화가 이 함수 하나를 쓴다(#288).
 */
export function ipv6Groups(address: string): number[] | undefined {
    if (address.includes('%') || isIP(address) !== 6) return undefined;
    const groupsOf = (part: string): number[] => part === '' ? [] : part.split(':').flatMap((group) => {
        if (!group.includes('.')) return [parseInt(group, 16)];
        const [a, b, c, d] = group.split('.').map(Number);
        return [(a << 8) | b, (c << 8) | d];
    });
    const gap = address.indexOf('::');
    if (gap < 0) return groupsOf(address);
    const head = groupsOf(address.slice(0, gap));
    const tail = groupsOf(address.slice(gap + 2));
    return [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail];
}
