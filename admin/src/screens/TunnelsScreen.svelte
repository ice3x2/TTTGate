<script lang="ts">
    import {onMount} from 'svelte';
    import ServerOptionCtrl from '../controller/ServerOptionCtrl';
    import InvalidSession from '../controller/InvalidSession';
    import type {Options, TunnelingStatus} from '../controller/Options';
    import Button from '../ui/Button.svelte';
    import Loading from '../ui/Loading.svelte';
    import Modal from '../ui/Modal.svelte';
    import Switch from '../ui/Switch.svelte';
    import {toast} from '../ui/toast';
    import {me} from '../me';
    import {navigate} from '../router';
    import {useSession} from '../shell/session';
    import {tunnelPolicy} from './parts/tunnelPolicy';
    import {StatusPoller} from './parts/statusPoller';
    import {tunnelRowView, tunnelTitle, undoTimeoutOf} from './parts/tunnelRow';
    import {ipLimitView, withIpResult, type IpLimitView} from './parts/ipLimit';
    import Clock from '../ui/Clock.svelte';
    import {errorMessageOf} from '../i18n/serverError';
    import {t, plural} from '../i18n';

    // 이슈 338: 로그인하면 먼저 보이는 화면이다. 터널마다 제목·상태 한 줄·스위치를 그리고 한 번 눌러 켜고 끈다.
    // 연결이 있는 터널을 끌 때만 묻고, 바꾼 뒤 5초 동안 Undo 를 보인다. 요청 중에는 그 행의 스위치만 잠근다.
    const STALE_MS = 5000;
    const UNDO_MS = 5000;
    const UNDO_KEY = 'tunnel-undo';

    let options = $state<Options[]>([]);
    let listLoaded = $state(false);
    let statuses = $state<Record<number, TunnelingStatus>>({});
    let statusLoaded = $state(false);
    let serverTime = $state(0);
    let lastReadAt = $state(0);
    let now = $state(Date.now());
    let loading = $state(false);
    /** 요청 중인 포트와 요청한 상태. 폴링 결과가 이 행을 덮지 않는다. */
    let pending = $state<Record<number, boolean>>({});
    /** 이슈 348: IP 제한·갱신 요청 중인 포트. 그 줄의 두 버튼만 잠근다. */
    let ipPending = $state<Record<number, true>>({});
    /** 이슈 348: 서버가 본 지금 내 IP. 내 허용 IP 와 다르면 갱신 버튼을 강조한다. */
    let requesterIp = $state<string | null>(null);
    let confirmTarget = $state<{option: Options; sessions: number} | undefined>(undefined);
    let confirmOpen = $state(false);

    let alertOpen = $state(false);
    let alertMessage = $state('');
    let alertButton = $state(t('common.ok'));
    let alertClose = $state<() => void>(() => {});

    const policy = $derived($me ? tunnelPolicy($me) : undefined);
    const ownedCount = $derived(options.filter((option) => option.owner?.id === $me?.user.id).length);
    const onCount = $derived(options.filter((option) => statuses[option.forwardPort]?.online && statuses[option.forwardPort]?.active).length);
    const stale = $derived(statusLoaded && now - lastReadAt > STALE_MS);

    const session = useSession();

    const alert = (message: string, button: string, onClose: () => void) => {
        alertMessage = message;
        alertButton = button;
        alertClose = onClose;
        alertOpen = true;
    };

    const sessionOut = () => {
        poller.stop();
        alert(t('common.sessionExpired'), t('common.ok'), () => session.invalidate());
    };

    // 상태는 화면이 열리면 바로 1초마다 읽는다(목록과 따로). 실패해도 이어 가고 401 만 멈춘다.
    const poller = new StatusPoller({
        load: (signal) => ServerOptionCtrl.instance.loadTunnelingStatus(signal),
        isSessionOut: (error) => error instanceof InvalidSession,
        onSessionOut: () => sessionOut(),
        onTick: (value) => { now = value; },
        onSnapshot: (result) => {
            const next: Record<number, TunnelingStatus> = {};
            for(const status of result.statuses) next[status.port] = status;
            statuses = next;
            serverTime = result.serverTime;
            requesterIp = result.requesterIp ?? null;
            lastReadAt = Date.now();
            now = lastReadAt;
            statusLoaded = true;
        }
    });

    const load = async () => {
        try {
            loading = true;
            const snapshot = await ServerOptionCtrl.instance.getTunnelingOption();
            options = snapshot.value;
            listLoaded = true;
            loading = false;
        } catch(e) {
            console.error(e);
            loading = false;
            if(e instanceof InvalidSession) {
                sessionOut();
                return;
            }
            alert(t('common.unableToConnect'), t('common.retry'), () => load());
        }
    };

    const undoToast = (message: string, run?: () => void) => toast.push({
        tone: 'pulse', message, timeoutMs: UNDO_MS, key: UNDO_KEY, ...(run ? {action: {label: t('tunnels.undo'), run}} : {})
    });

    /** 한 행의 활성 상태를 바꾼다. undo 는 되돌리기 요청이라 알림을 다시 띄우지 않는다. 그 행이 처리 중이면 무시한다. */
    const request = async (option: Options, active: boolean, timeout: number, undo = false): Promise<void> => {
        const port = option.forwardPort;
        if(pending[port] !== undefined) return;
        const title = tunnelTitle(option);
        const before = statuses[port];
        const readAt = serverTime + (Date.now() - lastReadAt);
        pending = {...pending, [port]: active};
        // 요청 앞에 시작한 상태 읽기는 바꾸기 전의 값이다. 그 결과가 이 행을 되돌리지 않게 버린다.
        poller.invalidate();
        try {
            const result = await ServerOptionCtrl.instance.activeExternalPortServer(active, port, timeout);
            if(!result.success) {
                toast.push({tone: 'alarm', message: errorMessageOf(result, t('tunnels.changeFailed', {title}))});
                return;
            }
            if(before) statuses = {...statuses, [port]: {...before, active}};
            // 요청 뒤에 시작한 읽기가 끝날 때까지 행을 처리 중으로 둔다.
            await poller.refresh();
            if(undo) return;
            if(active) {
                undoToast(t('tunnels.turnedOn', {title}), () => { void request(option, false, 0, true); });
            } else {
                // 끄기를 되돌리면 끈 순간에 남아 있던 시간으로 켠다. 기한이 지났거나 앞 상태를 모르면 되돌리지 않는다(0 은 무기한이다).
                const restore = before ? undoTimeoutOf(before, readAt) : undefined;
                undoToast(t('tunnels.turnedOff', {title}), restore === undefined ? undefined : () => { void request(option, true, restore, true); });
            }
        } catch(e) {
            if(e instanceof InvalidSession) {
                sessionOut();
                return;
            }
            toast.push({tone: 'alarm', message: t('tunnels.changeFailed', {title})});
        } finally {
            const {[port]: _done, ...rest} = pending;
            pending = rest;
        }
    };

    /** 스위치를 눌렀다. 켜기는 바로, 끄기는 연결이 있을 때만 묻는다. */
    const toggle = (option: Options, next: boolean) => {
        const sessions = statuses[option.forwardPort]?.sessions ?? 0;
        if(!next && sessions > 0) {
            confirmTarget = {option, sessions};
            confirmOpen = true;
            return;
        }
        void request(option, next, 0);
    };

    /** 이슈 348: 한 줄의 IP 제한·갱신 요청. 요청 중이면 무시하고, 끝나면 상태를 다시 읽어 개수(+N)까지 맞춘다. */
    const ipRequest = async (option: Options, failure: string, send: () => Promise<{success: boolean; message?: string} & Record<string, unknown>>,
                             patch: (result: Record<string, unknown>) => Partial<TunnelingStatus>): Promise<void> => {
        const port = option.forwardPort;
        if(ipPending[port]) return;
        ipPending = {...ipPending, [port]: true};
        poller.invalidate();
        try {
            const result = await send();
            if(!result.success) {
                toast.push({tone: 'alarm', message: errorMessageOf(result, failure)});
                return;
            }
            ({options, statuses} = withIpResult({options, statuses}, port, patch(result)));
            await poller.refresh();
        } catch(e) {
            if(e instanceof InvalidSession) {
                sessionOut();
                return;
            }
            toast.push({tone: 'alarm', message: failure});
        } finally {
            const {[port]: _done, ...rest} = ipPending;
            ipPending = rest;
        }
    };

    /** IP 제한 토글. 잠긴 켜짐(켜기 권한만 있음)이나 요청 중이면 요청을 보내지 않는다. */
    const toggleIpLimit = (option: Options, view: IpLimitView) => {
        if(!view.pressable) return;
        const next = !view.on;
        void ipRequest(option, t('tunnels.ipLimitFailed', {title: tunnelTitle(option)}),
            () => ServerOptionCtrl.instance.setActivatorIpOnly(option.forwardPort, next),
            (result) => ({activatorIpOnly: next, myAllowedIp: (result.myAllowedIp as string | null | undefined) ?? null}));
    };

    /** 내 허용 IP 를 지금 IP 로 바꾼다. 결과 IP 를 바로 보인다. */
    const refreshIp = (option: Options) => {
        void ipRequest(option, t('tunnels.ipRefreshFailed', {title: tunnelTitle(option)}),
            () => ServerOptionCtrl.instance.refreshActivatorIp(option.forwardPort),
            (result) => ({myAllowedIp: result.allowedIp as string}));
    };

    const confirmOff = () => {
        const target = confirmTarget;
        confirmOpen = false;
        if(target) void request(target.option, false, 0);
    };

    onMount(() => {
        poller.start();
        void load();
        return () => poller.stop();
    });
</script>

<div class="tunnels">
    {#if policy?.canCreate(ownedCount) ?? true}
        <div class="tunnels-bar">
            <Button variant="primary" onclick={() => navigate('#/tunnels/new')}>{t('tunnels.add')}</Button>
        </div>
    {/if}
    {#if policy?.limitReached(ownedCount)}
        <p id="tunnel-limit-note" style="color: var(--ink-2)">{t('tunnels.limitReached', {owned: ownedCount, max: policy.maxTunnelCount})}</p>
    {/if}
    {#if options.length > 0 && statusLoaded}
        <p class="tunnel-summary"><span id="tunnel-summary">{t('tunnels.summary', {on: onCount, total: options.length})}</span>{#if stale}<span id="tunnel-stale" class="stale">{t('tunnels.stale')}</span>{/if}</p>
    {/if}
    {#if options.length === 0}
        <p class="empty">{t('tunnels.empty')}</p>
        {#if listLoaded && policy && !policy.canCreate(ownedCount)}
            <p id="tunnel-ask-admin" class="empty">{t('tunnels.askAdmin')}</p>
        {/if}
    {/if}
    {#if options.length > 0}
        <ul class="tunnel-list">
            {#each options as option (option.forwardPort)}
                {@const title = tunnelTitle(option)}
                {@const view = tunnelRowView({option, status: statuses[option.forwardPort], loaded: statusLoaded, meId: $me?.user.id ?? '', serverTime})}
                {@const busy = pending[option.forwardPort] !== undefined}
                {@const parts = busy ? [{text: t(pending[option.forwardPort] ? 'tunnels.turningOn' : 'tunnels.turningOff'), muted: true}] : view.parts}
                {@const ipView = ipLimitView({option, status: statuses[option.forwardPort], requesterIp, busy: ipPending[option.forwardPort] === true})}
                <li data-port={option.forwardPort}>
                    <!-- 이슈 347 FR-12: 고칠 수 없는 터널은 편집 화면으로 가지 않는다. 같은 모양을 지키려고 같은 클래스를 쓴다. -->
                    <svelte:element this={view.link ? 'a' : 'div'} class="tunnel-link" href={view.link ? `#/tunnels/${option.forwardPort}` : undefined}>
                        <span class="tunnel-title">{title}</span>
                        <span class="tunnel-status">{#each parts as part, index}{#if index > 0}<span class="sep">{' · '}</span>{/if}<span class:warn={part.warn} class:muted={part.muted} title={part.title}>{part.text}</span>{/each}</span>
                        {#if !busy && view.clock}
                            <span class="tunnel-time-row">
                                <Clock class="tunnel-clock" label={view.clock.label} fraction={view.clock.kind === 'limited' ? view.clock.fraction : undefined}
                                    warn={view.clock.kind === 'limited' && view.clock.warn} />
                                {#if view.clock.kind === 'limited'}<span class="tunnel-time" class:warn={view.clock.warn} aria-hidden="true">{view.clock.left} · {view.clock.ends}</span>{/if}
                            </span>
                        {/if}
                    </svelte:element>
                    {#if view.control === 'lock'}
                        <span class="tunnel-lock" title={t('tunnels.viewOnly')} aria-label={t('tunnels.viewOnly')}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
                        </span>
                    {:else}
                        <span class="tunnel-switch">
                            <Switch size="lg" ariaLabel={title} on={busy ? pending[option.forwardPort] : view.checked} {busy}
                                disabled={view.control === 'disabled'} onrequest={(next) => toggle(option, next)} />
                        </span>
                    {/if}
                    {#if ipView}
                        <!-- 이슈 348: 줄 링크 밖에 둔다(누르면 편집 화면으로 가지 않는다). 터널이 꺼져도 같은 규칙으로 보인다. -->
                        <div class="tunnel-ip-row">
                            <button type="button" class="tunnel-ip-toggle" class:on={ipView.on} class:locked={ipView.locked}
                                aria-label={ipView.label} title={ipView.title} aria-disabled={ipView.pressable ? undefined : 'true'}
                                onclick={() => toggleIpLimit(option, ipView)}>
                                {#if ipView.locked}<svg class="tunnel-ip-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>{/if}
                                <span class="ip-text" class:warn={ipView.warn}>{ipView.text}</span>{#if ipView.extra}{' '}<span class="ip-extra">{ipView.extra}</span>{/if}
                            </button>
                            <button type="button" class="tunnel-ip-refresh" class:emphasized={ipView.refresh.emphasized}
                                aria-label={ipView.refresh.label} title={ipView.refresh.label} disabled={!ipView.refresh.enabled}
                                onclick={() => refreshIp(option)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>
                            </button>
                        </div>
                    {/if}
                </li>
            {/each}
        </ul>
    {/if}
    {#if loading}<Loading overlay />{/if}
    <Modal bind:open={confirmOpen} title={confirmTarget ? t('tunnels.turnOffConfirm', {title: tunnelTitle(confirmTarget.option)}) : t('tunnels.turnOffConfirmUntitled')}>
        {plural('tunnels.connectionsCut', confirmTarget?.sessions ?? 0)}
        {#snippet footer()}
            <Button onclick={() => (confirmOpen = false)}>{t('common.cancel')}</Button>
            <Button variant="danger" onclick={confirmOff}>{t('tunnels.turnOff')}</Button>
        {/snippet}
    </Modal>
    <Modal bind:open={alertOpen} title={t('nav.tunnels')}>
        {alertMessage}
        {#snippet footer()}
            <Button variant="primary" onclick={() => { alertOpen = false; alertClose(); }}>{alertButton}</Button>
        {/snippet}
    </Modal>
</div>

<style>
    .tunnels-bar { margin-bottom: var(--s-4); }
    .tunnel-summary { margin: 0 0 var(--s-3); font-size: var(--fs-sm); color: var(--ink-2); display: flex; flex-wrap: wrap; gap: var(--s-3); }
    .stale { color: var(--warn); }
    .tunnel-list { list-style: none; margin: 0; padding: 0; background: var(--bg-2); border-radius: var(--r-3); overflow: hidden; }
    .tunnel-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--s-3); min-height: 64px; padding: 0 var(--s-3) 0 0; }
    .tunnel-list li + li { box-shadow: 0 -1px 0 var(--line-0); }
    .tunnel-link { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: var(--s-3) 0 var(--s-3) var(--s-4); color: inherit; text-decoration: none; }
    .tunnel-title { font-size: var(--fs-lg); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tunnel-status { font-size: var(--fs-sm); color: var(--ink-2); }
    .tunnel-status .warn { color: var(--warn); }
    .tunnel-status .muted { color: var(--ink-3); }
    .tunnel-time-row { display: flex; align-items: center; gap: var(--s-2); min-width: 0; }
    .tunnel-time { font-size: var(--fs-sm); color: var(--ink-2); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .tunnel-time.warn { color: var(--warn); }
    .tunnel-switch { flex: 0 0 auto; min-width: 52px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; }
    .tunnel-lock { flex: 0 0 auto; width: 52px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; color: var(--ink-3); }
    .empty { color: var(--ink-2); }
    /* 이슈 348: IP 제한 토글과 갱신 버튼은 상태 줄 아래 한 줄을 쓴다. 360px 에서도 넘치지 않게 토글이 줄어들고 IP 는 줄임표로 줄인다. */
    .tunnel-ip-row { flex: 1 0 100%; min-width: 0; display: flex; align-items: center; gap: var(--s-2); padding: 0 0 var(--s-3) var(--s-4); }
    .tunnel-ip-toggle { min-width: 0; max-width: 100%; min-height: 32px; display: inline-flex; align-items: center; gap: var(--s-1);
        padding: 0 var(--s-3); border-radius: 999px; border: 1px solid var(--line-1); background: var(--bg-3); color: var(--ink-2);
        font: inherit; font-size: var(--fs-sm); cursor: pointer; }
    .tunnel-ip-toggle.on { background: var(--pulse-glow); border-color: var(--pulse-dim); color: var(--pulse); }
    .tunnel-ip-toggle.locked { cursor: default; }
    .tunnel-ip-toggle[aria-disabled='true']:not(.locked) { cursor: progress; }
    .tunnel-ip-toggle .ip-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--ff-mono); }
    .tunnel-ip-toggle.on .ip-text.warn { color: var(--warn); font-family: inherit; }
    .tunnel-ip-toggle .ip-extra { flex: 0 0 auto; }
    .tunnel-ip-lock { flex: 0 0 auto; }
    .tunnel-ip-refresh { flex: 0 0 auto; width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center;
        border: 1px solid transparent; border-radius: var(--r-3); background: transparent; color: var(--ink-2); cursor: pointer; }
    .tunnel-ip-refresh.emphasized { color: var(--warn); border-color: var(--warn); }
    .tunnel-ip-refresh:disabled { color: var(--ink-3); border-color: transparent; cursor: default; }
</style>
