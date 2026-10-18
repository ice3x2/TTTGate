import {AuditEvent} from "../audit/AuditSink";
import {AUDIT_EVENT_TYPES} from "../audit/AuditEventTypes";
import {auditEventOf, Route, RouteContext} from "./routes";
import {authorize} from "../rbac/AdminAuthorizer";

/** 감사에 남길 경로의 최대 길이. 경로는 URL 에서 오므로 헤더 상한(16KiB)까지 길어질 수 있다. */
const MAX_AUDIT_PATH_LENGTH = 256;

/**
 * #135: 본문을 읽다가 실패한(413·408·400) 감사 대상 CUD 요청의 최소 이벤트.
 * 본문이 없으므로 대상(target)을 채울 수 없다. 어느 경로에 대한 어떤 실패였는지만 남긴다.
 * 예외 메시지는 담지 않는다 — JSON 파서 메시지에는 본문 일부가 섞일 수 있다.
 */
export type BodyRejectionReason = 'too_large' | 'timeout' | 'invalid_json' | 'unreadable';

export function bodyRejectionReasonOf(error: unknown): BodyRejectionReason {
    const code = error && typeof error === 'object' ? (error as {code?: unknown}).code : undefined;
    if(code === 'E_BODY_TOO_LARGE') return 'too_large';
    if(code === 'E_REQ_TIMEOUT') return 'timeout';
    if(error instanceof SyntaxError) return 'invalid_json';
    return 'unreadable';
}

/**
 * 이 요청의 본문 실패를 감사할지. 본문 읽기는 권한 판정보다 먼저이므로, 권한이 없는 사용자의 시도가 그 사용자 이름의
 * CUD 시도로 남지 않게 여기서 미리 판정한다. 거부될 요청의 본문 실패는 남기지 않는다(본문 오류가 권한 판정보다 먼저 나므로 access_denied 도 남지 않는다).
 * 본문에 따라 action 이 갈리는 라우트(tunnel 생성·수정)는 둘 중 하나라도 허용될 때만 남긴다.
 */
export function isBodyRejectionAuditable(ctx: RouteContext, route: Route): boolean {
    if(typeof route.audit !== 'function' || !ctx.principal) return false;
    if(route.action === 'public' || route.action === 'session') return false;
    if(typeof route.action === 'function') {
        return authorize(ctx.principal, 'tunnel:create').allowed || authorize(ctx.principal, 'tunnel:update', route.target?.(ctx)).allowed;
    }
    return authorize(ctx.principal, route.action, route.target?.(ctx)).allowed;
}

export function bodyRejectionEvent(ctx: RouteContext, method: string, rawPath: string, error: unknown): AuditEvent {
    const reason = bodyRejectionReasonOf(error);
    const path = rawPath.length > MAX_AUDIT_PATH_LENGTH ? `${rawPath.slice(0, MAX_AUDIT_PATH_LENGTH)}…` : rawPath;
    return auditEventOf(ctx, {
        type: AUDIT_EVENT_TYPES.request_body_rejected,
        summary: `request_body_rejected ${method} ${path}`,
        detail: {method, path, reason}
    }, 'failure');
}
