import {ADMIT, AdmissionDecision, AdmissionDenial} from "./AdmissionPolicy";

export type RateLimitConfig = {windowMs: number; maxConnections: number; banMs: number};

export const MAX_TRACKED_IPS_PER_PORT = 10_000;

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

    public banned(port: number, ip: string, now: number): AdmissionDenial | undefined {
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

    public admit(port: number, ip: string, now: number): AdmissionDecision {
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
            if (state.bans.size >= MAX_TRACKED_IPS_PER_PORT) {
                const oldestBan = state.bans.keys().next().value;
                if (oldestBan !== undefined) state.bans.delete(oldestBan);
            }
            state.bans.set(ip, {until: now + banMs, hits: arr.length});
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
        return state.bans.delete(ip);
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
