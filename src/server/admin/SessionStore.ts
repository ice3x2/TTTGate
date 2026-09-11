import {ClockRngProvider} from "../../util/ClockRng";
import crypto, {createHash} from "crypto";

export type Session = {
    key: string;
    userId: string;
    createdAt: number;
    lastSeenAt: number;
    timeout: number;
    ip: string;
    userAgent?: string;
}

const DEFAULT_TIMEOUT = 1000 * 60 * 60 * 12; // 12 hours

class SessionStore {
    private static _instance: SessionStore;
    private _sessions: Map<string, Session> = new Map<string, Session>();

    private constructor() {
    }

    public static get instance(): SessionStore {
        if (!SessionStore._instance) {
            SessionStore._instance = new SessionStore();
        }
        return SessionStore._instance;
    }

    public static resetForTest(): void {
        SessionStore._instance = undefined as any;
    }

    private now(): number {
        return ClockRngProvider.current().now();
    }

    /**
     * 세션 키를 감사 로그·4 단위 세션 API에 노출할 수 있는 짧은 식별자로 축약한다.
     * 세션 키 원문은 절대 노출하지 않으므로, 이 해시가 유일한 노출 표면이다.
     */
    public static sessionIdOf(key: string): string {
        return createHash('sha256').update(key).digest('hex').slice(0, 16);
    }

    public async newSession(userId: string, meta: {ip: string; userAgent?: string}): Promise<string> {
        const now = this.now();
        const sessionKey = crypto.randomBytes(64).toString("hex");
        this._sessions.set(sessionKey, {
            key: sessionKey,
            userId,
            createdAt: now,
            lastSeenAt: now,
            timeout: now + DEFAULT_TIMEOUT,
            ip: meta.ip,
            userAgent: meta.userAgent
        });
        return sessionKey;
    }

    /**
     * 주어진 키 목록 중 첫 번째 유효한 세션을 돌려준다. 유효한 세션은 조회 시점에
     * lastSeenAt·timeout이 갱신된 새 객체로 교체되어 Map에 set된다(불변 객체 + 참조 교체).
     * 만료된 키는 Map에서 삭제한다. 유효한 세션이 없으면 undefined.
     */
    public resolveSession(sessionKeys: string[]): Session | undefined {
        const now = this.now();
        for(const sessionKey of sessionKeys) {
            const session = this._sessions.get(sessionKey);
            if(!session) continue;
            if(session.timeout <= now) {
                this._sessions.delete(sessionKey);
                continue;
            }
            const renewed: Session = {...session, lastSeenAt: now, timeout: now + DEFAULT_TIMEOUT};
            this._sessions.set(sessionKey, renewed);
            return {...renewed};
        }
        return undefined;
    }

    public async isSessionValid(sessionKeys: string[]): Promise<boolean> {
        return this.resolveSession(sessionKeys) !== undefined;
    }

    public async removeSession(sessionKey: string): Promise<void> {
        this._sessions.delete(sessionKey);
    }

    /**
     * userId 소유의 세션을 모두 제거한다. options.except로 지정한 키는 남긴다
     * (#96 (U2-04)의 /api/me/password가 현재 세션을 남기는 데 쓴다). 반환값은 제거한 개수.
     */
    public removeSessionsOfUser(userId: string, options?: {except?: string}): number {
        const exceptKey = options?.except;
        const keysToRemove: string[] = [];
        for(const [key, session] of this._sessions) {
            if(session.userId !== userId) continue;
            if(exceptKey !== undefined && key === exceptKey) continue;
            keysToRemove.push(key);
        }
        for(const key of keysToRemove) {
            this._sessions.delete(key);
        }
        return keysToRemove.length;
    }

    public listSessions(): Session[] {
        return Array.from(this._sessions.values()).map((session) => ({...session}));
    }

    public sweepSession() : void {
        // P5-T5 / REQ-16: forEach → for...of 로 반복 변경.
        // forEach 는 async/await 를 무시하므로 비동기 안전성이 낮다.
        const now = this.now();
        for(const [key, session] of this._sessions) {
            if(session.timeout < now) {
                this._sessions.delete(key);
            }
        }
    }

    /**
     * P5-T5 / REQ-16: Cookie 파싱 방어용 헬퍼.
     * split('=') 대신 indexOf('=')로 첫 분리자만 사용한다. 값에 '='가 포함된 쿠키
     * (예: base64url 패딩이 남은 토큰 `sid=abc=xy`)도 `abc=xy` 그대로 추출 가능.
     */
    public static parseCookieHeader(header: string | undefined): Map<string, string> {
        const result = new Map<string, string>();
        if(header == undefined) return result;
        const parts = header.split(';');
        for(const raw of parts) {
            const seg = raw.trim();
            if(seg.length == 0) continue;
            const eq = seg.indexOf('=');
            if(eq <= 0) continue;
            const key = seg.substring(0, eq).trim();
            const value = seg.substring(eq + 1).trim();
            if(key.length == 0) continue;
            if(!result.has(key)) {
                result.set(key, value);
            }
        }
        return result;
    }
}

export default SessionStore;
export { DEFAULT_TIMEOUT };
