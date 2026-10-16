import {ServerResponse} from "http";
import {RouteContext, RouteHandlers} from "./routes";
import {AuditFilter, AuditQuery, AuditTargetKind} from "../audit/AuditQuery";
import {AUDIT_EVENT_TYPE_LIST, isAuditEventType} from "../audit/AuditEventTypes";

// U4-02 / #110 — 감사 조회 핸들러. AdminServer.ts 가 2,000줄을 넘지 않도록 rbacRoutes.ts 처럼 따로 둔다.
// 조회 자체는 감사하지 않는다(설계 §2.3). 라우트 표에 audit 콜백을 달지 않는다.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const TARGET_KINDS: readonly AuditTargetKind[] = ['user', 'group', 'tunnel', 'server', 'session', 'security'];
/** Date 가 표현할 수 있는 epoch ms 의 한계(ECMAScript 시간 값 범위). 밖이면 파일 날짜를 계산할 수 없다. */
const MAX_EPOCH_MS = 8.64e15;

type Fail = (res: ServerResponse, statusCode: number, payload: {[key: string]: any}) => void;

type Parsed = {filter: AuditFilter} | {message: string};

/** 쿼리 문자열의 정수. 비었거나 정수 표기가 아니면 undefined 가 아니라 NaN 을 돌려 검증이 걸러내게 한다. */
const integerOf = (raw: string): number => /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;

/** 쿼리 문자열을 AuditFilter 로 바꾼다. 실패하면 422 message 를 돌려준다. 커서 검사는 decodeCursor 하나가 맡는다. */
export function parseAuditQuery(params: URLSearchParams, ctx: RouteContext): Parsed {
    const filter: AuditFilter = {limit: DEFAULT_LIMIT};

    const from = params.get('from');
    const to = params.get('to');
    if(from !== null) filter.from = integerOf(from);
    if(to !== null) filter.to = integerOf(to);
    const epochInvalid = (value: number | undefined): boolean =>
        value !== undefined && (!Number.isSafeInteger(value) || Math.abs(value) > MAX_EPOCH_MS);
    if(epochInvalid(filter.from) || epochInvalid(filter.to)) {
        return {message: 'from and to must be epoch milliseconds'};
    }
    if(filter.from !== undefined && filter.to !== undefined && filter.from > filter.to) {
        return {message: 'from must not exceed to'};
    }

    const limit = params.get('limit');
    if(limit !== null) {
        const value = integerOf(limit);
        if(!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) return {message: 'limit must be an integer within 1..500'};
        filter.limit = value;
    }

    const type = params.get('type');
    if(type !== null) {
        if(!isAuditEventType(type)) return {message: 'unknown audit type'};
        filter.type = type;
    }

    const outcome = params.get('outcome');
    if(outcome !== null) {
        if(outcome !== 'success' && outcome !== 'failure') return {message: 'outcome must be success or failure'};
        filter.outcome = outcome;
    }

    const targetKind = params.get('targetKind');
    if(targetKind !== null) {
        if(!TARGET_KINDS.includes(targetKind as AuditTargetKind)) return {message: 'unknown target kind'};
        filter.targetKind = targetKind as AuditTargetKind;
    }

    // 빈 문자열은 지정하지 않은 것으로 본다(빈 id 로는 어떤 이벤트도 맞지 않는다).
    const targetId = params.get('targetId');
    if(targetId) filter.targetId = targetId;

    const cursor = params.get('cursor');
    if(cursor !== null) {
        if(AuditQuery.decodeCursor(cursor) === undefined) return {message: 'invalid cursor'};
        filter.cursor = cursor;
    }

    // 일반 유저는 요청의 userId 를 조용히 본인으로 덮어쓴다(403 으로 거부하지 않는다).
    const userId = params.get('userId');
    if(ctx.principal?.role !== 'superuser') filter.userId = ctx.principal?.userId;
    else if(userId) filter.userId = userId;

    return {filter};
}

export function auditRouteHandlers(query: AuditQuery, fail: Fail): RouteHandlers {
    return {
        onListAudit: async (ctx: RouteContext) => {
            const params = new URL(ctx.req.url ?? '/', 'http://localhost').searchParams;
            const parsed = parseAuditQuery(params, ctx);
            if('message' in parsed) {
                fail(ctx.res, 422, {status: 422, message: parsed.message});
                return;
            }
            const page = await query.query(parsed.filter);
            ctx.ok(page.nextCursor === undefined ? {events: page.events} : {events: page.events, nextCursor: page.nextCursor});
        },
        onListAuditTypes: async (ctx: RouteContext) => {
            ctx.ok({types: [...AUDIT_EVENT_TYPE_LIST]});
        }
    };
}
