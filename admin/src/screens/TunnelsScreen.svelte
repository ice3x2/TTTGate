<script lang="ts">
    import {onMount} from 'svelte';
    import ServerOptionCtrl from '../controller/ServerOptionCtrl';
    import {serverMessageOf} from '../controller/AdminRequest';
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
    import Clock from '../ui/Clock.svelte';

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
    let confirmTarget = $state<{option: Options; sessions: number} | undefined>(undefined);
    let confirmOpen = $state(false);

    let alertOpen = $state(false);
    let alertMessage = $state('');
    let alertButton = $state('OK');
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
        alert('Session is expired. Please login again.', 'OK', () => session.invalidate());
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
            alert('Unable to connect to the server.', 'Retry', () => load());
        }
    };

    const undoToast = (message: string, run?: () => void) => toast.push({
        tone: 'pulse', message, timeoutMs: UNDO_MS, key: UNDO_KEY, ...(run ? {action: {label: 'Undo', run}} : {})
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
                toast.push({tone: 'alarm', message: serverMessageOf(result) || `Unable to change ${title}.`});
                return;
            }
            if(before) statuses = {...statuses, [port]: {...before, active}};
            // 요청 뒤에 시작한 읽기가 끝날 때까지 행을 처리 중으로 둔다.
            await poller.refresh();
            if(undo) return;
            if(active) {
                undoToast(`${title} is on`, () => { void request(option, false, 0, true); });
            } else {
                // 끄기를 되돌리면 끈 순간에 남아 있던 시간으로 켠다. 기한이 지났거나 앞 상태를 모르면 되돌리지 않는다(0 은 무기한이다).
                const restore = before ? undoTimeoutOf(before, readAt) : undefined;
                undoToast(`${title} is off`, restore === undefined ? undefined : () => { void request(option, true, restore, true); });
            }
        } catch(e) {
            if(e instanceof InvalidSession) {
                sessionOut();
                return;
            }
            toast.push({tone: 'alarm', message: `Unable to change ${title}.`});
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
            <Button variant="primary" onclick={() => navigate('#/tunnels/new')}>Add tunneling service</Button>
        </div>
    {/if}
    {#if policy?.limitReached(ownedCount)}
        <p id="tunnel-limit-note" style="color: var(--ink-2)">Tunnel limit reached ({ownedCount}/{policy.maxTunnelCount}).</p>
    {/if}
    {#if options.length > 0 && statusLoaded}
        <p class="tunnel-summary"><span id="tunnel-summary">{onCount} of {options.length} on</span>{#if stale}<span id="tunnel-stale" class="stale">Couldn't update · retrying</span>{/if}</p>
    {/if}
    {#if options.length === 0}
        <p class="empty">No tunnels yet.</p>
        {#if listLoaded && policy && !policy.canCreate(ownedCount)}
            <p id="tunnel-ask-admin" class="empty">Ask an administrator to add a tunnel for you.</p>
        {/if}
    {/if}
    {#if options.length > 0}
        <ul class="tunnel-list">
            {#each options as option (option.forwardPort)}
                {@const title = tunnelTitle(option)}
                {@const view = tunnelRowView({option, status: statuses[option.forwardPort], loaded: statusLoaded, meId: $me?.user.id ?? '', serverTime})}
                {@const busy = pending[option.forwardPort] !== undefined}
                {@const parts = busy ? [{text: pending[option.forwardPort] ? 'Turning on…' : 'Turning off…', muted: true}] : view.parts}
                <li data-port={option.forwardPort}>
                    <a class="tunnel-link" href={`#/tunnels/${option.forwardPort}`}>
                        <span class="tunnel-title">{title}</span>
                        <span class="tunnel-status">{#each parts as part, index}{#if index > 0}<span class="sep">{' · '}</span>{/if}<span class:warn={part.warn} class:muted={part.muted} title={part.title}>{part.text}</span>{/each}</span>
                        {#if !busy && view.clock}
                            <span class="tunnel-time-row">
                                <Clock class="tunnel-clock" label={view.clock.label} fraction={view.clock.kind === 'limited' ? view.clock.fraction : undefined}
                                    warn={view.clock.kind === 'limited' && view.clock.warn} />
                                {#if view.clock.kind === 'limited'}<span class="tunnel-time" class:warn={view.clock.warn} aria-hidden="true">{view.clock.left} · {view.clock.ends}</span>{/if}
                            </span>
                        {/if}
                    </a>
                    {#if view.control === 'lock'}
                        <span class="tunnel-lock" title="View only" aria-label="View only">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
                        </span>
                    {:else}
                        <span class="tunnel-switch">
                            <Switch size="lg" ariaLabel={title} on={busy ? pending[option.forwardPort] : view.checked} {busy}
                                disabled={view.control === 'disabled'} onrequest={(next) => toggle(option, next)} />
                        </span>
                    {/if}
                </li>
            {/each}
        </ul>
    {/if}
    {#if loading}<Loading overlay />{/if}
    <Modal bind:open={confirmOpen} title={confirmTarget ? `Turn off ${tunnelTitle(confirmTarget.option)}?` : 'Turn off?'}>
        {confirmTarget?.sessions} {confirmTarget?.sessions === 1 ? 'connection' : 'connections'} will be cut.
        {#snippet footer()}
            <Button onclick={() => (confirmOpen = false)}>Cancel</Button>
            <Button variant="danger" onclick={confirmOff}>Turn Off</Button>
        {/snippet}
    </Modal>
    <Modal bind:open={alertOpen} title="Tunnels">
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
    .tunnel-list li { display: flex; align-items: center; gap: var(--s-3); min-height: 64px; padding: 0 var(--s-3) 0 0; }
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
</style>
