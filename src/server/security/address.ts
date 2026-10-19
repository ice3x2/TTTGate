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
