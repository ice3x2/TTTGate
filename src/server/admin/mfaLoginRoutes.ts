import {IncomingMessage, ServerResponse} from "http";
import {RouteContext} from "./routes";
import {IdentityStore} from "../rbac/IdentityStore";
import {User} from "../rbac/IdentityTypes";
import {AuditEvent} from "../audit/AuditSink";
import {AUDIT_EVENT_TYPES} from "../audit/AuditEventTypes";
import {MfaTicketStore} from "../mfa/MfaTickets";
import {base32Decode} from "../mfa/Base32";
import {hashRecoveryCode, normalizeRecoveryCode, verify} from "../mfa/Totp";
import {ClockRngProvider} from "../../util/ClockRng";

// U4-08 / #127 — 2단계 로그인 POST /api/login/mfa. 공개 라우트라 audited() 를 거치지 않고 성공·실패를 직접 감사한다.
// AdminServer.ts 가 2,000줄을 넘지 않도록 rbacRoutes.ts·auditRoutes.ts 처럼 따로 두고, 로그인 백오프와 세션 발급은
// AdminServer 의 것을 그대로 넘겨받는다(같은 버킷·같은 쿠키 형식).

export type LoginGuard = {
    isBlocked(req: IncomingMessage): boolean;
    /** recordLoginFailure + delayFailedLogin. 비밀번호 실패와 같은 비용을 치르게 한다. */
    fail(req: IncomingMessage): Promise<void>;
    /** resetLoginAttempts + 세션·쿠키 발급 + login_success 감사. */
    issueSession(req: IncomingMessage, res: ServerResponse, user: User): Promise<void>;
    sendFailure(res: ServerResponse, statusCode: number, payload: {[key: string]: any}): void;
    emitAudit(event: AuditEvent): void;
};

const TICKET_INVALID = {code: 'mfa_ticket_invalid', message: 'The sign-in expired. Start again.'};
const CODE_INVALID = {code: 'mfa_code_invalid', message: 'The code is incorrect.'};

export function mfaLoginHandler(tickets: MfaTicketStore, guard: LoginGuard) {
    return async (ctx: RouteContext): Promise<void> => {
        const {req, res} = ctx;
        if(guard.isBlocked(req)) {
            guard.sendFailure(res, 429, {message: 'Too many login attempts'});
            return;
        }
        const body = ctx.body ?? {};
        const code = typeof body.code === 'string' ? body.code : undefined;
        const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode : undefined;
        if((code === undefined) === (recoveryCode === undefined)) {
            guard.sendFailure(res, 422, {status: 422, message: 'Provide code or recoveryCode'});
            return;
        }
        const ticketValue = typeof body.mfaTicket === 'string' ? body.mfaTicket : '';
        const ticket = ticketValue ? tickets.peek(ticketValue, ctx.ip) : undefined;
        const store = IdentityStore.instance;
        const user = ticket ? store.user(ticket.userId) : undefined;
        // 1단계 뒤에 비활성화·삭제·MFA 초기화된 사용자는 티켓이 남아 있어도 들이지 않는다.
        if(!ticket || !user || user.status === 'disabled' || user.mfa?.enabled !== true) {
            await guard.fail(req);
            guard.sendFailure(res, 401, {status: 401, ...TICKET_INVALID});
            return;
        }

        const now = ClockRngProvider.current().now();
        const audit = (type: AuditEvent['type'], outcome: AuditEvent['outcome'], detail?: Record<string, unknown>) => guard.emitAudit({
            at: now, actor: {userId: user.id, username: user.username, role: user.role}, ip: ctx.ip,
            type, target: {kind: 'user', id: user.id}, outcome, summary: `${type} ${user.id}`, ...(detail ? {detail} : {})
        });

        let accepted = false;
        if(code !== undefined) {
            const secret = base32Decode(user.mfa.secret);
            const result = secret ? verify(secret, code, now, user.mfa.lastUsedStep) : {ok: false as const, reason: 'format' as const};
            if(result.ok) {
                // 사용한 스텝을 저장하지 못하면 재사용 거부를 보장할 수 없으므로 세션을 주지 않는다.
                // 사용자의 잘못이 아니므로 티켓 시도·백오프는 세지 않고 503 으로 알린다.
                if(!store.markMfaStep(user.id, result.step).success) {
                    audit(AUDIT_EVENT_TYPES.mfa_failure, 'failure', {reason: 'store'});
                    guard.sendFailure(res, 503, {status: 503, message: 'Unable to complete sign-in. Try again.'});
                    return;
                }
                accepted = true;
                audit(AUDIT_EVENT_TYPES.mfa_success, 'success');
            } else {
                audit(AUDIT_EVENT_TYPES.mfa_failure, 'failure', {reason: result.reason});
            }
        } else {
            const normalized = normalizeRecoveryCode(recoveryCode!);
            // 복구 코드 실패는 TOTP 실패와 같은 401 mfa_code_invalid 로 응답한다(어느 쪽이 틀렸는지 알리지 않는다).
            const consumed = normalized === undefined ? undefined : store.consumeRecoveryCode(user.id, hashRecoveryCode(normalized, user.id));
            if(consumed?.success) {
                accepted = true;
                audit(AUDIT_EVENT_TYPES.mfa_recovery_used, 'success', {remaining: consumed.value.remaining});
            } else {
                audit(AUDIT_EVENT_TYPES.mfa_failure, 'failure', {reason: 'recovery_code'});
            }
        }

        if(!accepted) {
            tickets.fail(ticketValue);
            await guard.fail(req);
            guard.sendFailure(res, 401, {status: 401, ...CODE_INVALID});
            return;
        }
        tickets.consume(ticketValue);
        await guard.issueSession(req, res, store.user(user.id)!);
    };
}
