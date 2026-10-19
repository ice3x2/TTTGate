import {AUDIT_EVENT_TYPES} from "../audit/AuditEventTypes";
import type {AuditEvent} from "../audit/AuditSink";
import {validateUsername} from "../rbac/IdentityTypes";
import {AuditRateGate} from "../security/AuditRateGate";

/** 차단 중(429) 감사의 IP 별 간격. 차단 시간(LOGIN_BLOCK_MS)과 같은 1분이다. */
const BLOCKED_AUDIT_INTERVAL_MS = 60_000;
/** 게이트 키 수의 상한. 넘으면 만료된 키를 비우고, 그래도 넘으면 넘친 요청을 키 하나로 묶는다. */
const BLOCKED_AUDIT_MAX_KEYS = 10_000;
const OVERFLOW_KEY = 'overflow';

/**
 * 로그인 실패 감사에 남길 username. 형식 검증(validateUsername)을 통과한 값만 원문으로 남긴다.
 * 인증 없는 경로라 본문 상한(1MiB)까지의 문자열이 그대로 감사 파일에 쌓일 수 있고, 사용자가 username 칸에
 * 잘못 넣은 비밀번호도 남을 수 있기 때문이다(#139). 형식이 틀리면 고정값과 길이만 남긴다.
 */
export function loginFailureUsername(value: unknown): {username: string; usernameLength?: number} {
    if(value === undefined || value === null) return {username: '(missing)'};
    const result = validateUsername(value);
    if(result.success) return {username: result.value};
    return typeof value === 'string' ? {username: '(invalid)', usernameLength: value.length} : {username: '(invalid)'};
}

/**
 * POST /api/login 실패 감사 이벤트를 만든다. 차단(429) 응답은 즉시 돌아가므로 요청마다 남기면 인증 없이
 * 감사 파일과 큐를 채울 수 있다. 그래서 차단 버킷별 1분 1건만 blocked 로 남기고 나머지는 undefined 다.
 *
 * gateKey 는 차단 판정과 같은 네트워크 버킷(IPv6 /64 등)이어야 한다. 원본 IP 로 묶으면 같은 /64 안에서
 * 주소를 바꿔 가며 요청마다 감사를 남길 수 있다. 키 수가 상한을 넘으면 넘친 요청은 키 하나로 묶어 맵과 순회 비용을 묶는다.
 */
export function createLoginFailureAuditor(options: {maxKeys?: number} = {}): (body: any, ip: string, gateKey: string, status: number, now: number) => AuditEvent | undefined {
    const maxKeys = options.maxKeys ?? BLOCKED_AUDIT_MAX_KEYS;
    const blockedGate = new AuditRateGate(BLOCKED_AUDIT_INTERVAL_MS);
    let lastPrunedAt = Number.NEGATIVE_INFINITY;
    return (body, ip, gateKey, status, now) => {
        const blocked = status === 429;
        if(blocked) {
            // 순회는 간격당 한 번만 한다. 상한에 머무는 동안 요청마다 맵 전체를 훑지 않게 한다.
            if(blockedGate.size() >= maxKeys && now - lastPrunedAt >= BLOCKED_AUDIT_INTERVAL_MS) {
                blockedGate.prune(now);
                lastPrunedAt = now;
            }
            const key = blockedGate.size() >= maxKeys ? OVERFLOW_KEY : gateKey;
            if(!blockedGate.allow(key, now)) return undefined;
        }
        const name = loginFailureUsername(body?.['username']);
        return {
            at: now, actor: {userId: 'system'}, ip,
            type: AUDIT_EVENT_TYPES.login_failure, outcome: 'failure',
            summary: `login_failure ${name.username}`, detail: {...name, ...(blocked ? {blocked: true} : {})}
        };
    };
}
