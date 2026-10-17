<script lang="ts">
    import {onMount} from 'svelte';
    import ServerOptionCtrl from '../controller/ServerOptionCtrl';
    import InvalidSession from '../controller/InvalidSession';
    import type {Options, TunnelingStatus} from '../controller/Options';
    import Badge from '../ui/Badge.svelte';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Chip from '../ui/Chip.svelte';
    import Loading from '../ui/Loading.svelte';
    import Modal from '../ui/Modal.svelte';
    import Switch from '../ui/Switch.svelte';
    import Timer from '../ui/Timer.svelte';
    import {me} from '../me';
    import {navigate} from '../router';
    import {useSession} from '../shell/session';
    import {tunnelPolicy} from './parts/tunnelPolicy';
    import {startupTime, toSize} from './parts/units';

    let options = $state<Options[]>([]);

    // U3-06: 소유자 표시와 그룹 한도. 한도에 걸리면 추가 버튼을 숨긴다.
    const policy = $derived($me ? tunnelPolicy($me) : undefined);
    const ownedCount = $derived(options.filter((option) => option.owner?.id === $me?.user.id).length);
    let statuses = $state<Record<number, TunnelingStatus>>({});
    let serverTime = $state(0);
    let loading = $state(false);
    let intervalId: ReturnType<typeof setInterval> | undefined;

    let alertOpen = $state(false);
    let alertMessage = $state('');
    let alertButton = $state('OK');
    let alertClose = $state<() => void>(() => {});

    const session = useSession();

    const alert = (message: string, button: string, onClose: () => void) => {
        alertMessage = message;
        alertButton = button;
        alertClose = onClose;
        alertOpen = true;
    };

    const sessionOut = () => alert('Session is expired. Please login again.', 'OK', () => session.invalidate());

    const connectionFail = () => alert('Unable to connect to the server.', 'Retry', () => load());

    const load = async () => {
        try {
            loading = true;
            const snapshot = await ServerOptionCtrl.instance.getTunnelingOption();
            options = snapshot.value;
            loading = false;
            await loadStatus();
        } catch(e) {
            console.error(e);
            loading = false;
            if(e instanceof InvalidSession) {
                sessionOut();
                return;
            }
            connectionFail();
        }
    };

    const loadStatus = async (ignoreError?: true): Promise<boolean> => {
        try {
            const next: Record<number, TunnelingStatus> = {};
            const result = await ServerOptionCtrl.instance.loadTunnelingStatus();
            serverTime = result.serverTime;
            for(const status of result.statuses) {
                next[status.port] = status;
            }
            statuses = next;
            return true;
        } catch(e) {
            if(ignoreError) {
                return false;
            }
            if(e instanceof InvalidSession) {
                sessionOut();
                return false;
            }
            connectionFail();
            return false;
        }
    };

    // 옛 화면과 같다. 즉시 한 번 읽고 1초마다 다시 읽되, 로딩 중이면 건너뛰고 실패하면 폴링을 멈춘다.
    const startStatusUpdate = () => {
        loadStatus();
        if(!intervalId) {
            intervalId = setInterval(async () => {
                if(loading) return;
                if(await loadStatus(true) == false) {
                    clearInterval(intervalId);
                }
            }, 1000);
        }
    };

    const getTimeout = (status: TunnelingStatus): number => {
        let timeout = status.activeStart + (status.activeTimeout * 1000) - serverTime;
        if(timeout < 0) {
            timeout = 0;
        }
        return Math.floor(timeout / 1000);
    };

    const onChangeActive = async (active: boolean, port: number, time?: number) => {
        const oldActive = statuses[port].active;
        if(oldActive == active && time == undefined) {
            return;
        }
        time = time ?? statuses[port].activeTimeout;
        try {
            loading = true;
            const result = await ServerOptionCtrl.instance.activeExternalPortServer(active, port, time);
            await loadStatus();
            if(result.success) {
                statuses[port].active = active;
            } else {
                statuses[port].active = oldActive;
            }
            loading = false;
        } catch(e) {
            console.error(e);
            loading = false;
            if(e instanceof InvalidSession) {
                sessionOut();
                return;
            }
            connectionFail();
        }
    };

    onMount(() => {
        load().then(startStatusUpdate);
        return () => clearInterval(intervalId);
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
    {#if options.length === 0}<p class="empty">No tunnels yet.</p>{/if}
    <ul class="tunnel-list">
        {#each options as option (option.forwardPort)}
            {@const status = statuses[option.forwardPort]}
            <li data-port={option.forwardPort}>
                <Card>
                    <a class="tunnel-link" href={`#/tunnels/${option.forwardPort}`}>
                        <div class="tunnel-row tunnel-head">
                            <span class="mono tunnel-port">{option.forwardPort}</span>
                            <span class="tunnel-arrow" aria-hidden="true">⬌</span>
                            <span class="tunnel-dest">{option.destinationAddress}:{option.destinationPort}</span>
                            <Chip>{(option.protocol ?? '').toUpperCase()}</Chip>
                            {#if option.owner}
                                <!-- 프로토콜 Chip 하나만 .chip 이어야 기존 목록 계약(screen-tunnels)이 성립한다. 소유자는 mono 글자로 그린다. -->
                                <span data-owner class="mono" style="color: var(--ink-2);">{option.owner.username !== undefined ? '@' + option.owner.username : option.owner.id === 'system:migrated' ? 'migrated' : option.owner.id}</span>
                            {/if}
                            {#if option.editable === false}
                                <span data-readonly><Chip tone="trace">read only</Chip></span>
                            {/if}
                        </div>
                        <div class="tunnel-row">
                            {#if status && status.online}
                                <Badge tone="pulse">Online</Badge>
                                <span class="mono tunnel-stats">Uptime {startupTime(status.uptime)} · Sessions {status.sessions} · RX {toSize(status.rx)} · TX {toSize(status.tx)}</span>
                            {:else if status}
                                <Badge tone="alarm">Error</Badge>
                            {:else}
                                <Badge tone="neutral">Offline</Badge>
                            {/if}
                        </div>
                    </a>
                    {#if status?.online && option.editable !== false}
                        <div class="tunnel-row tunnel-controls">
                            <span class="tunnel-label">Activation</span>
                            <Switch on={status.active} ariaLabel={`Activation ${option.forwardPort}`}
                                onchange={(on) => onChangeActive(on, option.forwardPort)} />
                            {#if status.active}
                                <span class="tunnel-label">Timeout</span>
                                <Timer seconds={getTimeout(status)} total={status.activeTimeout}
                                    onchange={(seconds) => onChangeActive(true, option.forwardPort, seconds)} />
                            {/if}
                        </div>
                    {/if}
                </Card>
            </li>
        {/each}
    </ul>
    {#if loading}<Loading overlay />{/if}
    <Modal bind:open={alertOpen} title="Tunnels">
        {alertMessage}
        {#snippet footer()}
            <Button variant="primary" onclick={() => { alertOpen = false; alertClose(); }}>{alertButton}</Button>
        {/snippet}
    </Modal>
</div>

<style>
    .tunnels-bar { margin-bottom: var(--s-4); }
    .tunnel-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-3); }
    .tunnel-link { display: block; color: inherit; text-decoration: none; }
    .tunnel-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); }
    .tunnel-head { margin-bottom: var(--s-2); }
    .tunnel-port { font-size: var(--fs-lg); font-weight: 500; }
    .tunnel-dest { color: var(--ink-1); word-break: break-all; }
    .tunnel-stats { font-size: var(--fs-xs); color: var(--ink-2); }
    .tunnel-controls { margin-top: var(--s-3); padding-top: var(--s-3); border-top: 1px solid var(--line-0); gap: var(--s-3); }
    .tunnel-label { font-size: var(--fs-sm); color: var(--ink-2); }
    .empty { color: var(--ink-2); }
</style>
