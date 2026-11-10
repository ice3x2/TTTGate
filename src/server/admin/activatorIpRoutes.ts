import ServerOptionStore from "../ServerOptionStore";
import {TunnelingOption} from "../../types/TunnelingOption";
import {parsePathPort, RouteContext, RouteHandlers} from "./routes";
import {activatorIpOnlyOf, activatorIpsOf, placeRequesterIp, requesterIpOf, RequesterIpPlacement, withActivatorIps} from "../security/ActivatorIps";

// 이슈 348 — 켠 사람의 IP 만 받는 설정(FR-12)과 내 허용 IP 갱신(FR-13). 권한·감사 메타는 routes.ts 의 표가 정한다.
// 둘 다 설정 파일만 고치고 리스너를 다시 띄우지 않는다. 판정은 저장소를 바로 읽고, 기존 연결은 enforceActivatorIps 가 끊는다.

/**
 * 리스너를 다시 띄우지 않고 터널 설정 한 줄을 저장한다. 실패하면 응답을 보내고 false 다.
 * 호출자는 runConfigurationMutation 안에서 부른다.
 */
export function commitTunnelOption(ctx: RouteContext, option: TunnelingOption): boolean {
    const store = ServerOptionStore.instance;
    const composed = store.composeServerOptionWithTunnelingOption(option);
    if(!composed.success || !composed.serverOption) {
        ctx.fail(400, 'tunnel_update_failed', `Unable to update tunnel ${option.forwardPort}.`);
        return false;
    }
    if(!store.commitPreparedServerOption(composed.serverOption).success) {
        store.recordRollback('tunnel allowed IP commit failed', ['tunneling-option']);
        ctx.fail(500, 'tunnel_commit_failed', `Unable to save tunnel ${option.forwardPort}.`);
        return false;
    }
    return true;
}

/**
 * 켜기(FR-3)·갱신(FR-4)·IP 제한 켜기(FR-12)가 요청자 항목을 정해 저장한다. 바뀐 것이 없으면 저장하지 않는다.
 * 저장에 실패하면 응답을 보내고 undefined 다.
 */
export function recordRequesterIp(ctx: RouteContext, option: TunnelingOption, mode: 'replace' | 'add-if-missing',
                                  patch: Partial<TunnelingOption> = {}): RequesterIpPlacement | undefined {
    const placed = placeRequesterIp(activatorIpsOf(option), ctx.principal!.userId, requesterIpOf(ctx.ip), mode);
    const patched = Object.entries(patch).some(([key, value]) => (option as Record<string, unknown>)[key] !== value);
    if(!placed.changed && !patched) return placed;
    return commitTunnelOption(ctx, withActivatorIps({...option, ...patch}, placed.ips)) ? placed : undefined;
}

const portOf = (ctx: RouteContext): number | undefined => {
    const port = parsePathPort(ctx.params.port);
    if(port === undefined) ctx.fail(400, 'invalid_port', 'Invalid port');
    return port;
};

/** PUT /api/tunneling/:port/activatorIpOnly {enabled}. 같은 값이면 저장하지 않고 성공한다(켜기면 요청자 항목이 없을 때만 넣는다). */
const onSetActivatorIpOnly = async (ctx: RouteContext): Promise<void> => {
    const port = portOf(ctx);
    if(port === undefined) return;
    const enabled = ctx.body?.enabled;
    if(typeof enabled !== 'boolean') {
        ctx.fail(422, 'enabled_invalid', 'enabled must be a boolean');
        return;
    }
    await ServerOptionStore.instance.runConfigurationMutation(async () => {
        const option = ServerOptionStore.instance.getTunnelingOption(port);
        if(!option) {
            ctx.fail(404, 'not_found', `External port(${port}) is not configured.`);
            return;
        }
        const changed = activatorIpOnlyOf(option) !== enabled;
        // 같은 값이면 필드를 새로 쓰지 않는다(필드가 없는 옛 터널에 끄기를 보내도 그대로 둔다).
        const patch: Partial<TunnelingOption> = changed ? {activatorIpOnly: enabled} : {};
        if(!enabled) {
            if(changed && !commitTunnelOption(ctx, {...option, ...patch})) return;
            ctx.ok({forwardPort: port, activatorIpOnly: false, myAllowedIp: activatorIpsOf(option)[ctx.principal!.userId] ?? null});
            return;
        }
        const placed = recordRequesterIp(ctx, option, 'add-if-missing', patch);
        if(!placed) return;
        if(changed || placed.changed) await ctx.enforceActivatorIps?.(port);
        ctx.ok({forwardPort: port, activatorIpOnly: true, myAllowedIp: placed.after});
    });
};

/** POST /api/tunneling/:port/activatorIp. 터널의 켜짐·꺼짐과 관계없이 요청자 항목을 지금 IP 로 바꾼다. */
const onRefreshActivatorIp = async (ctx: RouteContext): Promise<void> => {
    const port = portOf(ctx);
    if(port === undefined) return;
    if(requesterIpOf(ctx.ip) === undefined) {
        ctx.fail(422, 'requester_ip_unknown', 'Unable to tell your IP address.');
        return;
    }
    await ServerOptionStore.instance.runConfigurationMutation(async () => {
        const option = ServerOptionStore.instance.getTunnelingOption(port);
        if(!option) {
            ctx.fail(404, 'not_found', `External port(${port}) is not configured.`);
            return;
        }
        const placed = recordRequesterIp(ctx, option, 'replace');
        if(!placed) return;
        ctx.auditDetail({allowedIpBefore: placed.before, allowedIp: placed.after});
        if(placed.changed) await ctx.enforceActivatorIps?.(port);
        ctx.ok({forwardPort: port, allowedIp: placed.after, previousIp: placed.before});
    });
};

export const activatorIpRouteHandlers: RouteHandlers = {onSetActivatorIpOnly, onRefreshActivatorIp};
