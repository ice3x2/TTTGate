import {ADMIT, AdmissionDecision, AdmissionDenial} from "./AdmissionPolicy";

export type RateLimitConfig = {windowMs: number; maxConnections: number; banMs: number};

export const MAX_TRACKED_IPS_PER_PORT = 10_000;

/**
 * 속도 제한과 차단을 묶는 단위. IPv4(와 IPv4-mapped IPv6)는 주소 하나, IPv6 는 /64 하나다.
 * IPv6 는 한 가입자가 /64 를 통째로 받는 경우가 많아 주소 단위로 세면 주소만 바꿔 우회한다(#167).
 */
export function rateLimitBucketOf(ip: string): string {
    const address = ip.split('%')[0];
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
    if(mapped) return mapped[1];
    if(!address.includes(':')) return address;
    // 목록에 보인 버킷 문자열(…::/64)도 같은 버킷으로 읽는다. 압축 표기가 달라도 같은 접두로 정규화한다.
    if(address.endsWith('/64')) return rateLimitBucketOf(address.slice(0, -3));
    const [head, tail] = address.includes('::') ? address.split('::') : [address, undefined];
    const headParts = head ? head.split(':') : [];
    const tailParts = tail === undefined ? [] : (tail ? tail.split(':') : []);
    const groups = tail === undefined ? headParts : [...headParts, ...Array(Math.max(0, 8 - headParts.length - tailParts.length)).fill('0'), ...tailParts];
    const prefix = groups.slice(0, 4).map((group) => (parseInt(group || '0', 16) || 0).toString(16));
    while(prefix.length < 4) prefix.push('0');
    return `${prefix.join(':')}::/64`;
}

type BanEntry = {until: number; hits: number};

type PortState = {
    config: RateLimitConfig;
    bans: Map<string, BanEntry>;
    windows: Map<string, number[]>;
    rejectedBans: number;
    rejectedExceeded: number;
};

export class ConnectionRateLimiter {
    private readonly _ports = new Map<number, PortState>();

    public configurePort(port: number, config: RateLimitConfig | undefined): void {
        if (config === undefined) {
            this._ports.delete(port);
            return;
        }
        this._ports.set(port, {
            config,
            bans: new Map(),
            windows: new Map(),
            rejectedBans: 0,
            rejectedExceeded: 0
        });
    }

    public banned(port: number, address: string, now: number): AdmissionDenial | undefined {
        const ip = rateLimitBucketOf(address);
        const state = this._ports.get(port);
        if (!state) return undefined;

        const ban = state.bans.get(ip);
        if (!ban) return undefined;

        if (ban.until > now) {
            state.rejectedBans++;
            return {allowed: false, reason: 'rate-limit-ban', retryAfterMs: ban.until - now};
        }

        state.bans.delete(ip);
        return undefined;
    }

    public admit(port: number, address: string, now: number): AdmissionDecision {
        const ip = rateLimitBucketOf(address);
        const state = this._ports.get(port);
        if (!state) return ADMIT;

        const banDecision = this.banned(port, ip, now);
        if (banDecision) return banDecision;

        const {windowMs, maxConnections, banMs} = state.config;

        let arr = state.windows.get(ip);
        if (!arr) {
            arr = [];
            if (state.windows.size >= MAX_TRACKED_IPS_PER_PORT) {
                const oldest = state.windows.keys().next().value;
                if (oldest !== undefined) state.windows.delete(oldest);
            }
        } else {
            const cut = arr.findIndex(t => t > now - windowMs);
            if (cut === -1) {
                arr.length = 0;
            } else if (cut > 0) {
                arr.splice(0, cut);
            }
            state.windows.delete(ip);
        }
        arr.push(now);
        state.windows.set(ip, arr);

        if (arr.length > maxConnections) {
            // 표가 가득 차면 만료된 ban 만 비운다. 살아 있는 ban 을 밀어내면 새 주소로 ban 을 만들어 기존 ban 을 풀 수 있다(#167).
            if (state.bans.size >= MAX_TRACKED_IPS_PER_PORT) {
                for (const [bannedIp, ban] of state.bans) {
                    if (ban.until <= now) state.bans.delete(bannedIp);
                }
            }
            if (state.bans.size < MAX_TRACKED_IPS_PER_PORT) state.bans.set(ip, {until: now + banMs, hits: arr.length});
            state.windows.delete(ip);
            state.rejectedExceeded++;
            return {allowed: false, reason: 'rate-limit-exceeded', retryAfterMs: banMs};
        }

        return ADMIT;
    }

    public bans(now: number): Array<{port: number; ip: string; bannedUntil: number; hits: number}> {
        const result: Array<{port: number; ip: string; bannedUntil: number; hits: number}> = [];
        const ports = [...this._ports.keys()].sort((a, b) => a - b);
        for (const port of ports) {
            const state = this._ports.get(port)!;
            const entries = [...state.bans.entries()]
                .filter(([, ban]) => ban.until > now)
                .sort((a, b) => a[1].until - b[1].until);
            for (const [ip, ban] of entries) {
                result.push({port, ip, bannedUntil: ban.until, hits: ban.hits});
            }
        }
        return result;
    }

    public unban(port: number, ip: string): boolean {
        const state = this._ports.get(port);
        if (!state) return false;
        return state.bans.delete(rateLimitBucketOf(ip));
    }

    public prune(now: number): void {
        for (const state of this._ports.values()) {
            for (const [ip, ban] of state.bans) {
                if (ban.until <= now) state.bans.delete(ip);
            }
            for (const [ip, arr] of state.windows) {
                const last = arr[arr.length - 1];
                if (arr.length === 0 || last < now - state.config.windowMs) {
                    state.windows.delete(ip);
                }
            }
        }
    }

    public ports(): number[] {
        return [...this._ports.keys()].sort((a, b) => a - b);
    }

    public stats(port: number): {rejectedBans: number; rejectedExceeded: number; bannedIps: number} {
        const state = this._ports.get(port);
        if (!state) return {rejectedBans: 0, rejectedExceeded: 0, bannedIps: 0};
        return {
            rejectedBans: state.rejectedBans,
            rejectedExceeded: state.rejectedExceeded,
            bannedIps: state.bans.size
        };
    }

    public trackedIps(port: number): number {
        const state = this._ports.get(port);
        return state ? state.windows.size : 0;
    }
}
