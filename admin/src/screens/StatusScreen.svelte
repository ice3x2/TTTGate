<script lang="ts">
    import {onMount} from 'svelte';
    import ServerStatusCtrl, {type SysInfoResult} from '../controller/ServerStatusCtrl';
    import InvalidSession from '../controller/InvalidSession';
    import type {ClientStatus, SysInfo, Usage} from '../controller/Types';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Chip from '../ui/Chip.svelte';
    import Gauge from '../ui/Gauge.svelte';
    import Modal from '../ui/Modal.svelte';
    import {useSession} from '../shell/session';
    import SysinfoPopup from './parts/SysinfoPopup.svelte';
    import {byteToUnit, timeToDMH} from './parts/units';
    import {t} from '../i18n';
    import {errorMessageOf} from '../i18n/serverError';

    let usage = $state<Usage | undefined>();
    let clients = $state<ClientStatus[]>([]);
    let sysInfo = $state<SysInfo | undefined>();
    let infoOpen = $state(false);
    let alertOpen = $state(false);
    let alertMessage = $state('');
    let alertClose = $state<() => void>(() => {});
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const session = useSession();

    const alert = (message: string, onClose?: () => void) => {
        alertMessage = message;
        alertClose = onClose ?? (() => {});
        alertOpen = true;
    };

    const sessionOut = () => alert(t('common.sessionExpired'), () => session.invalidate());

    const loadServerStatus = async (): Promise<boolean> => {
        try {
            const nextUsage = await ServerStatusCtrl.instance.getSysUsage();
            const nextClients = await ServerStatusCtrl.instance.getClientStatus();
            // 권한이 없는 주체(일반 유저, U2-10)는 403 본문을 받아 값이 비어 온다. 실패로 보고 폴링을 멈춘다.
            if(nextUsage === undefined || !Array.isArray(nextClients)) return false;
            usage = nextUsage;
            clients = nextClients;
            return true;
        } catch(e) {
            if(e instanceof InvalidSession) sessionOut();
        }
        return false;
    };

    // 옛 화면과 같다. 즉시 한 번 읽고 1초마다 다시 읽되, 실패하면 폴링을 멈춘다.
    const startStatusUpdate = () => {
        loadServerStatus();
        if(!intervalId) {
            intervalId = setInterval(async () => {
                if(await loadServerStatus() === false) clearInterval(intervalId);
            }, 1000);
        }
    };

    // 서버가 거절하면 그 code 의 문구를, 서버에 닿지 못하면 연결 실패 문구를 보인다. 예외 원문은 보이지 않는다.
    const showSysInfo = async (load: () => Promise<SysInfoResult>) => {
        try {
            const result = await load();
            if(result.success) {
                sysInfo = result.sysInfo;
                infoOpen = true;
            } else {
                alert(errorMessageOf(result, t('common.unableToConnect')));
            }
        } catch(e) {
            if(e instanceof InvalidSession) sessionOut();
            else alert(t('common.unableToConnect'));
        }
    };

    const showInfo = () => showSysInfo(() => ServerStatusCtrl.instance.getSysInfo());

    const showClient = (id: number) => showSysInfo(() => ServerStatusCtrl.instance.getClientSysInfo(id));

    onMount(() => {
        startStatusUpdate();
        return () => clearInterval(intervalId);
    });
</script>

<div class="status">
    <div class="status-bar">
        <Button variant="ghost" size="sm" onclick={showInfo}>{t('status.info')}</Button>
        {#if usage}<Chip mono class="status-uptime">{timeToDMH(usage.uptime)}</Chip>{/if}
    </div>

    {#if usage}
        <div class="gauges">
            <Gauge title="CPU" value={usage.cpu.process} max={100}
                message={`${usage.cpu.process}/${usage.cpu.total}%`} />
            <Gauge title={t('status.memory')} value={usage.memory.process} max={usage.memory.total}
                message={`${byteToUnit(usage.memory.process)}/${byteToUnit(usage.memory.total)}`} />
            <Gauge title={t('status.heap')} value={usage.heap.used} max={usage.heap.total}
                message={`${byteToUnit(usage.heap.used)}/${byteToUnit(usage.heap.total)}`} />
            <Gauge title={t('status.buffer')} value={usage.totalBuffer.used} max={usage.totalBuffer.total}
                message={`${byteToUnit(usage.totalBuffer.used)}/${byteToUnit(usage.totalBuffer.total)}`} />
        </div>
    {/if}

    <h2 class="section-title">{t('status.clientList')}</h2>
    {#if clients.length === 0}
        <p class="empty">{t('status.noClients')}</p>
    {:else}
        <ul class="client-list">
            {#each clients as client (client.id)}
                <li>
                    <div class="client-tap" role="button" tabindex="0" aria-label={t('status.clientDetails', {id: client.id})}
                        onclick={() => showClient(client.id)}
                        onkeydown={(e) => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showClient(client.id); } }}>
                        <Card label={`ID: ${client.id}`}>
                            <h3 class="client-name">{client.name}</h3>
                            <dl class="client-meta">
                                <dt>{t('status.address')}</dt><dd>{client.address}</dd>
                                <dt>{t('status.uptime')}</dt><dd>{timeToDMH(client.uptime)}</dd>
                                <dt>{t('status.activeSession')}</dt><dd>{client.activeSessionCount}</dd>
                            </dl>
                        </Card>
                    </div>
                </li>
            {/each}
        </ul>
    {/if}

    <SysinfoPopup bind:open={infoOpen} {sysInfo} />

    <Modal bind:open={alertOpen} title={t('nav.status')}>
        {alertMessage}
        {#snippet footer()}
            <Button variant="primary" onclick={() => { alertOpen = false; alertClose(); }}>{t('common.ok')}</Button>
        {/snippet}
    </Modal>
</div>

<style>
    .status-bar { display: flex; align-items: center; gap: var(--s-3); margin-bottom: var(--s-4); }
    .gauges { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--s-4); }
    @media (min-width: 640px) { .gauges { grid-template-columns: repeat(4, 1fr); } }
    .section-title { font-family: var(--ff-display); font-size: var(--fs-lg); margin: var(--s-6) 0 var(--s-3); }
    .empty { color: var(--ink-2); }
    .client-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-3); }
    .client-tap { cursor: pointer; border-radius: var(--r-2); }
    .client-tap:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }
    .client-name { font-family: var(--ff-ui); font-size: var(--fs-lg); margin: 0 0 var(--s-2); }
    .client-meta { display: grid; grid-template-columns: max-content 1fr; gap: var(--s-1) var(--s-3); margin: 0; font-size: var(--fs-sm); }
    .client-meta dd { margin: 0; font-family: var(--ff-mono); }
</style>
