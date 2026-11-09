<script lang="ts">
    import {onMount} from 'svelte';
    import InvalidSession from '../../controller/InvalidSession';
    import type {TunnelingStatus} from '../../controller/Options';
    import ServerOptionCtrl from '../../controller/ServerOptionCtrl';
    import {serverMessageOf} from '../../controller/AdminRequest';
    import Card from '../../ui/Card.svelte';
    import Timer from '../../ui/Timer.svelte';
    import {toast} from '../../ui/toast';
    import {StatusPoller} from './statusPoller';
    import {remainingMsOf} from './tunnelRow';
    import {startupTime, toSize} from './units';

    // 이슈 338 REQ-18: 편집 화면의 Status 영역. 목록에서 뺀 가동 정보·거절 수·사용 시간 Timer 를 여기서 보인다.
    // 열려 있는 동안 1초마다 상태를 읽는다. 앞의 읽기가 끝나지 않았으면 건너뛰고, 실패하면 영역을 숨긴 채 다시 읽는다.
    let {port, editable, onsessionout}: {port: number; editable: boolean; onsessionout: () => void} = $props();

    let status = $state<TunnelingStatus | undefined>(undefined);
    let serverTime = $state(0);

    const poller = new StatusPoller({
        load: (signal) => ServerOptionCtrl.instance.loadTunnelingStatus(signal),
        isSessionOut: (error) => error instanceof InvalidSession,
        onSessionOut: () => onsessionout(),
        onFailure: () => { status = undefined; },
        onSnapshot: (result) => {
            serverTime = result.serverTime;
            status = result.statuses.find((entry) => entry.port === port);
        }
    });

    const blocked = $derived(status ? (status.rejected?.rateLimit ?? 0) + (status.rejected?.geo ?? 0) : 0);
    const remaining = $derived(status ? Math.max(0, Math.floor((remainingMsOf(status, serverTime) ?? 0) / 1000)) : 0);

    /** 사용 시간을 바꾸면 폼 저장과 관계없이 바로 켠 채로 그 시간을 건다(옛 목록의 Timer 와 같다). */
    const changeTimeout = async (seconds: number) => {
        poller.invalidate();
        try {
            const result = await ServerOptionCtrl.instance.activeExternalPortServer(true, port, seconds);
            if(!result.success) toast.push({tone: 'alarm', message: serverMessageOf(result) || 'Unable to change the time limit.'});
            await poller.refresh();
        } catch(e) {
            if(e instanceof InvalidSession) {
                poller.stop();
                onsessionout();
                return;
            }
            toast.push({tone: 'alarm', message: 'Unable to change the time limit.'});
        }
    };

    onMount(() => {
        poller.start();
        return () => poller.stop();
    });
</script>

{#if status?.online}
    <section id="tunnel-status-area">
        <Card label="Status">
            <div class="status-stack">
                <div>
                    <span class="mono tunnel-stats">Uptime {startupTime(status.uptime)} · Sessions {status.sessions} · RX {toSize(status.rx)} · TX {toSize(status.tx)}</span>{#if blocked > 0}<span class="mono stats-extra" aria-hidden="true"> · </span><span class="mono stats-extra" data-blocked>Blocked {blocked}</span>{/if}
                </div>
                {#if status.active && editable}
                    <div class="status-timer">
                        <span class="status-label">Time limit</span>
                        <Timer seconds={remaining} total={status.activeTimeout} onchange={(seconds) => { void changeTimeout(seconds); }} />
                    </div>
                {/if}
            </div>
        </Card>
    </section>
{/if}

<style>
    .status-stack { display: flex; flex-direction: column; gap: var(--s-3); }
    .tunnel-stats, .stats-extra { font-size: var(--fs-xs); color: var(--ink-2); }
    .status-timer { display: flex; align-items: center; gap: var(--s-3); }
    .status-label { font-size: var(--fs-sm); color: var(--ink-2); }
</style>
