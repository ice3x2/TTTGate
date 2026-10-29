import {ADMIT, AdmissionDecision, AdmissionDenial} from "./AdmissionPolicy";
import {ipv6Groups} from "./address";

export type RateLimitConfig = {windowMs: number; maxConnections: number; banMs: number};

export const MAX_TRACKED_IPS_PER_PORT = 10_000;
/** IPv6 /48 하나가 따로 셀 수 있는 /64 버킷 수. 넘으면 그 /48 의 새 /64 는 /48 하나로 센다(#175). */
export const MAX_TRACKED_SUBNETS_PER_PREFIX = 256;

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
    // IPv6 가 아닌 문자열은 바꾸지 않는다. 억지로 읽으면 관계없는 버킷과 겹친다(일시 차단 해제 API 가 입력을 그대로 넘긴다, #288).
    const groups = ipv6Groups(address);
    if(!groups) return address;
    return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`;
}

/**
 * IPv6 /64 버킷이 속한 /48. 다른 버킷(IPv4, /48 자신)은 undefined 다(#175).
 * IPv6 /48 하나를 받은 공격자는 /64 를 6만여 개 만들 수 있다. /64 마다 따로 세면 표(1만)를 넘쳐 다른 버킷의 카운터를
 * 밀어내 속도 제한을 초기화하므로, /48 하나가 따로 셀 수 있는 /64 수에 상한을 둔다.
 */
export function prefixBucketOf(bucket: string): string | undefined {
    const v6 = /^([0-9a-f]+):([0-9a-f]+):([0-9a-f]+):[0-9a-f]+::\/64$/i.exec(bucket);
    return v6 ? `${v6[1]}:${v6[2]}:${v6[3]}::/48` : undefined;
}

type BanEntry = {until: number; hits: number};

type PortState = {
    config: RateLimitConfig;
    bans: Map<string, BanEntry>;
    windows: Map<string, number[]>;
    /** /48 별로 표에 따로 있는 /64 버킷 수. */
    subnetsPerPrefix: Map<string, number>;
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
            subnetsPerPrefix: new Map(),
            rejectedBans: 0,
            rejectedExceeded: 0
        });
    }

    /**
     * 이 주소가 지금 차단 중이면 그 거절을 돌려준다. admit 이 세는 것과 같은 키를 본다. 따로 세는 버킷이 아니면
     * /48 로 묶어 센 차단(#175)도 본다. TLS 포트는 핸드셰이크 전에 이 판정만 쓴다(#287).
     */
    public banned(port: number, address: string, now: number): AdmissionDenial | undefined {
        const ip = rateLimitBucketOf(address);
        const state = this._ports.get(port);
        if (!state) return undefined;

        const direct = this.activeBan(state, ip, now);
        if (direct) return direct;
        const key = this.windowKeyOf(state, ip);
        return key !== ip ? this.activeBan(state, key, now) : undefined;
    }

    public admit(port: number, address: string, now: number): AdmissionDecision {
        return this.banned(port, address, now) ?? this.count(port, address, now);
    }

    /**
     * 차단 판정(banned)을 이미 한 연결을 창에 세고, 넘치면 차단한다. AdmissionController 는 차단 판정을 국가 필터보다
     * 먼저 따로 하므로 이 메서드로 세기만 한다(#287). 그 밖에는 admit 을 쓴다.
     */
    public count(port: number, address: string, now: number): AdmissionDecision {
        const ip = rateLimitBucketOf(address);
        const state = this._ports.get(port);
        if (!state) return ADMIT;

        const {windowMs, maxConnections, banMs} = state.config;
        const key = this.windowKeyOf(state, ip);

        let arr = state.windows.get(key);
        if (!arr) {
            arr = [];
            this.makeRoom(state, now);
            this.countSubnet(state, key, 1);
        } else {
            const cut = arr.findIndex(t => t > now - windowMs);
            if (cut === -1) {
                arr.length = 0;
            } else if (cut > 0) {
                arr.splice(0, cut);
            }
            state.windows.delete(key);  // 다시 넣어 표를 마지막으로 센 시각 순서로 둔다.
        }
        arr.push(now);
        state.windows.set(key, arr);

        if (arr.length > maxConnections) {
            // 표가 가득 차면 만료된 ban 만 비운다. 살아 있는 ban 을 밀어내면 새 주소로 ban 을 만들어 기존 ban 을 풀 수 있다(#167).
            // ban 은 늘 now + banMs 로 넣으므로 표는 만료 시각 순서다. 앞에서부터 지난 것만 지우고 첫 살아 있는 ban 에서 멈춘다.
            if (state.bans.size >= MAX_TRACKED_IPS_PER_PORT) {
                for (const [bannedIp, ban] of state.bans) {
                    if (ban.until > now) break;
                    state.bans.delete(bannedIp);
                }
            }
            state.rejectedExceeded++;
            if (state.bans.size < MAX_TRACKED_IPS_PER_PORT) {
                state.bans.delete(key);  // 다시 넣어 만료 시각 순서를 지킨다.
                state.bans.set(key, {until: now + banMs, hits: arr.length});
                this.deleteWindow(state, key);
                return {allowed: false, reason: 'rate-limit-exceeded', retryAfterMs: banMs};
            }
            // ban 표가 살아 있는 ban 으로 가득 차면 ban 을 남길 수 없다. 창을 지우면 바로 다시 maxConnections 번 허용되므로
            // 창을 상한 바로 위 길이로 남겨 창이 지날 때까지 이 버킷을 계속 거부한다(#175).
            arr.splice(0, arr.length - (maxConnections + 1));
            return {allowed: false, reason: 'rate-limit-exceeded', retryAfterMs: Math.max(1, arr[0] + windowMs - now)};
        }

        return ADMIT;
    }

    /**
     * 이 연결을 셀 창 표의 키. 정책(#175):
     * - 이미 세고 있는 버킷이면 그대로 쓴다.
     * - IPv6 /48 하나가 따로 세는 /64 가 MAX_TRACKED_SUBNETS_PER_PREFIX 개에 이르면, 그 /48 의 새 /64 는 /48 하나로 센다.
     *   /48 차단은 이렇게 묶여 세는 새 /64 에만 걸린다. 이미 따로 세던 /64 와 다른 가입자는 영향을 받지 않는다.
     * 모두가 나눠 쓰는 공용 버킷은 두지 않는다. 공용 버킷이 차단되면 새 클라이언트 전체가 막힌다.
     */
    private windowKeyOf(state: PortState, ip: string): string {
        if (state.windows.has(ip)) return ip;
        const prefix = prefixBucketOf(ip);
        return prefix !== undefined && (state.subnetsPerPrefix.get(prefix) ?? 0) >= MAX_TRACKED_SUBNETS_PER_PREFIX ? prefix : ip;
    }

    /**
     * 새 버킷을 넣기 전에 표 자리를 만든다. 창이 지난 항목을 오래된 것부터 비우고, 그래도 가득 차면 가장 오래 안 센 버킷을 민다.
     * 표는 마지막으로 센 시각 순서다(셀 때마다 지우고 다시 넣는다). /48 하나는 최대 257칸을 쓰므로 활동 중인 버킷을 밀려면
     * 창 안에 /48 약 40개(또는 IPv4 주소 1만 개)가 필요하다. 밀린 버킷은 카운터가 초기화될 뿐 막히지는 않는다.
     */
    private makeRoom(state: PortState, now: number): void {
        if (state.windows.size < MAX_TRACKED_IPS_PER_PORT) return;
        for (const [tracked, arr] of state.windows) {
            if (arr.length > 0 && arr[arr.length - 1] > now - state.config.windowMs) break;
            this.deleteWindow(state, tracked);
        }
        while (state.windows.size >= MAX_TRACKED_IPS_PER_PORT) {
            const oldest = state.windows.keys().next().value;
            if (oldest === undefined) return;
            this.deleteWindow(state, oldest);
        }
    }

    private deleteWindow(state: PortState, key: string): void {
        if (state.windows.delete(key)) this.countSubnet(state, key, -1);
    }

    private countSubnet(state: PortState, key: string, delta: 1 | -1): void {
        const prefix = prefixBucketOf(key);
        if (prefix === undefined) return;
        const count = (state.subnetsPerPrefix.get(prefix) ?? 0) + delta;
        if (count > 0) state.subnetsPerPrefix.set(prefix, count);
        else state.subnetsPerPrefix.delete(prefix);
    }

    private activeBan(state: PortState, key: string, now: number): AdmissionDenial | undefined {
        const ban = state.bans.get(key);
        if (!ban) return undefined;
        if (ban.until > now) {
            state.rejectedBans++;
            return {allowed: false, reason: 'rate-limit-ban', retryAfterMs: ban.until - now};
        }
        state.bans.delete(key);
        return undefined;
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
        // /48 로 묶어 센 차단(…::/48)은 목록에 보인 문자열 그대로 지운다.
        return state.bans.delete(ip) || state.bans.delete(rateLimitBucketOf(ip));
    }

    public prune(now: number): void {
        for (const state of this._ports.values()) {
            for (const [ip, ban] of state.bans) {
                if (ban.until <= now) state.bans.delete(ip);
            }
            for (const [ip, arr] of state.windows) {
                const last = arr[arr.length - 1];
                if (arr.length === 0 || last < now - state.config.windowMs) {
                    this.deleteWindow(state, ip);
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
