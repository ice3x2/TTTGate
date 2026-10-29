import {ServerResponse} from "http";
import ServerOptionStore from "../ServerOptionStore";
import {AdmissionController} from "../security/AdmissionController";
import {addBlocklistEntry, AddBlocklistResult, isPortNumber, MAX_BLOCKLIST_ENTRIES, removeBlocklistEntry} from "../security/IpBlocklist";
import {BlocklistEntry, ConnectionSecurityOption, DEFAULT_GEO_CONFIG} from "../../types/TunnelingOption";
import {decodedPathSegment, RouteContext, RouteHandlers} from "./routes";
import {truncateAuditValue} from "./auditValue";

// #286 — 관리자 차단 목록 API. AdminServer.ts 가 2,000줄을 넘지 않도록 rbacRoutes.ts·auditRoutes.ts 처럼 따로 둔다.
// server.yaml 의 connectionSecurity.blocklist 에 저장하고 applyConnectionSecurity 로 바로 적용한다.

type Fail = (res: ServerResponse, statusCode: number, payload: {[key: string]: any}) => void;
type ApplyConnectionSecurity = (next: ConnectionSecurityOption) => void;

/** connectionSecurity 를 바꾼 결과. */
export type ConnectionSecurityUpdate = 'not-ready' | 'unchanged' | 'commit-failed' | 'applied';

/**
 * 국가 필터·차단 목록(connectionSecurity)을 바꿔 저장하고, 저장에 성공하면 바로 적용한다.
 * change 는 지금 값을 받아 새 값을 돌려준다. undefined 를 돌려주면 저장하지 않는다(unchanged).
 * 런타임 반영은 applyServerOption 이 아니라 applyConnectionSecurity 로만 한다(#118 U5-03).
 */
export async function updateConnectionSecurity(apply: ApplyConnectionSecurity,
                                               change: (current: ConnectionSecurityOption) => ConnectionSecurityOption | undefined):
    Promise<ConnectionSecurityUpdate> {
    let outcome = 'not-ready' as ConnectionSecurityUpdate;
    let next = undefined as ConnectionSecurityOption | undefined;
    await ServerOptionStore.instance.runConfigurationMutation(async () => {
        const store = ServerOptionStore.instance;
        const read = store.readServerOption();
        if(!read.success) return;
        const serverOption = read.serverOption;
        next = change(serverOption.connectionSecurity ?? {geo: {...DEFAULT_GEO_CONFIG, countries: []}, blocklist: []});
        if(next === undefined) {
            outcome = 'unchanged';
            return;
        }
        serverOption.connectionSecurity = next;
        outcome = store.commitPreparedServerOption(serverOption).success ? 'applied' : 'commit-failed';
    });
    if(outcome === 'applied' && next !== undefined) apply(next);
    return outcome;
}

/**
 * POST 의 fromBan. 없으면 undefined, 형식이 틀리면 'invalid' 다.
 * ip 는 일시 차단 표에 보인 문자열 그대로다(IPv6 는 /64·/48 대역).
 */
const parseFromBan = (value: unknown): {port: number; ip: string} | undefined | 'invalid' => {
    if(value === undefined || value === null) return undefined;
    if(typeof value !== 'object' || Array.isArray(value)) return 'invalid';
    const {port, ip} = value as Record<string, unknown>;
    if(!isPortNumber(port)) return 'invalid';
    if(typeof ip !== 'string' || ip.trim().length === 0) return 'invalid';
    return {port, ip: ip.trim()};
};

export function blocklistRouteHandlers(deps: {applyConnectionSecurity: ApplyConnectionSecurity; fail: Fail}): RouteHandlers {
    const notReady = (res: ServerResponse) => deps.fail(res, 503, {message: 'server configuration is not ready'});
    const commitFailed = (res: ServerResponse) => deps.fail(res, 500, {message: 'Unable to commit server option.'});

    const onGetSecurityBlocklist = async (ctx: RouteContext): Promise<void> => {
        const read = ServerOptionStore.instance.readServerOption();
        if(!read.success) {
            notReady(ctx.res);
            return;
        }
        ctx.ok({entries: read.serverOption.connectionSecurity?.blocklist ?? [], limit: MAX_BLOCKLIST_ENTRIES});
    };

    const onAddSecurityBlock = async (ctx: RouteContext): Promise<void> => {
        const {res} = ctx;
        const body = typeof ctx.body === 'object' && ctx.body !== null ? ctx.body : {};
        const fromBan = parseFromBan(body.fromBan);
        if(fromBan === 'invalid') {
            deps.fail(res, 422, {code: 'invalid', message: 'fromBan must be {port, ip}'});
            return;
        }
        // 일시 차단에서 옮기면 그 주소를 All tunnels 로 넣고, 메모가 없으면 출처 포트를 적는다(REQ-5 AC-1).
        // 요청의 address·port 는 쓰지 않는다.
        const request = fromBan
            ? {address: fromBan.ip, port: null, note: body.note || `From rate-limit ban on ${fromBan.port}`}
            : body;
        let result = undefined as AddBlocklistResult | undefined;
        const update = await updateConnectionSecurity(deps.applyConnectionSecurity, (current) => {
            result = addBlocklistEntry(current.blocklist ?? [], request, {now: Date.now(), createdBy: ctx.principal!.username}, {widen: fromBan !== undefined});
            return result.ok ? {...current, blocklist: result.entries} : undefined;
        });
        if(update === 'not-ready' || result === undefined) {
            notReady(res);
            return;
        }
        if(!result.ok) {
            // 이미 All tunnels 로 막힌 주소(widen 으로도 넓힐 것이 없는 중복)의 일시 차단은 더 의미가 없으므로 푼다(REQ-5 AC-3).
            const unbanned = result.code === 'duplicate' && fromBan ? AdmissionController.instance.rateLimiter.unban(fromBan.port, fromBan.ip) : undefined;
            if(unbanned !== undefined) ctx.auditDetail({fromBan, unbanned});
            deps.fail(res, result.code === 'invalid' ? 422 : 409, {code: result.code, message: result.message, ...(unbanned === undefined ? {} : {unbanned})});
            return;
        }
        if(update === 'commit-failed') {
            commitFailed(res);
            return;
        }
        // 영구 차단을 건 뒤에 일시 차단을 푼다. 넣기가 실패하면 위에서 돌아가므로 일시 차단은 그대로 남는다(REQ-5 AC-2).
        const unbanned = fromBan ? AdmissionController.instance.rateLimiter.unban(fromBan.port, fromBan.ip) : false;
        const {address, port, note} = result.entry;
        ctx.auditDetail({address, port, note, ...(fromBan ? {fromBan, unbanned} : {})});
        ctx.ok({entry: result.entry, unbanned}, 201);
    };

    const onDeleteSecurityBlock = async (ctx: RouteContext): Promise<void> => {
        const {res} = ctx;
        const address = decodedPathSegment(ctx.params.address);
        if(address === undefined || address.length === 0) {
            deps.fail(res, 400, {message: 'invalid address'});
            return;
        }
        let removed = undefined as BlocklistEntry | undefined;
        const update = await updateConnectionSecurity(deps.applyConnectionSecurity, (current) => {
            const result = removeBlocklistEntry(current.blocklist ?? [], address);
            removed = result.removed;
            return result.removed ? {...current, blocklist: result.entries} : undefined;
        });
        if(update === 'not-ready') {
            notReady(res);
            return;
        }
        if(removed === undefined) {
            ctx.auditDetail({address: truncateAuditValue(address), removed: false});
            ctx.ok({removed: false});
            return;
        }
        if(update === 'commit-failed') {
            commitFailed(res);
            return;
        }
        ctx.auditDetail({address: removed.address, port: removed.port, note: removed.note, removed: true});
        ctx.ok({removed: true});
    };

    return {onGetSecurityBlocklist, onAddSecurityBlock, onDeleteSecurityBlock};
}
