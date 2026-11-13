<script lang="ts">
    // 이슈 369: 터널 목록에서 연 연결 창. 연결마다 주소·국가·연결된 지·RX·TX 와 끊기·차단 아이콘 버튼을 보인다.
    // 열려 있는 동안 2초마다 다시 읽고(앞의 읽기가 끝나지 않았으면 건너뜀), 줄 순서를 지킨다(mergeConnections).
    // 차단은 보안 관리 권한(슈퍼유저)에게만 보이고, 누르면 확인 창을 먼저 띄운다. 겹친 창의 Esc 는 맨 위 창만 닫는다(Modal).
    import {onDestroy} from 'svelte';
    import Modal from '../../ui/Modal.svelte';
    import Button from '../../ui/Button.svelte';
    import TextInput from '../../ui/TextInput.svelte';
    import {toast} from '../../ui/toast';
    import ServerOptionCtrl from '../../controller/ServerOptionCtrl';
    import SecurityCtrl from '../../controller/SecurityCtrl';
    import InvalidSession from '../../controller/InvalidSession';
    import {StatusPoller} from './statusPoller';
    import {addedConnections, announcement, blockBodyText, blockedDoneText, closingFailure, duplicateBlockText, duplicateCoversTunnel, mergeConnections, summaryCount,
        type ConnectionRow, type FetchedConnection} from './connections';
    import {byteToUnit} from './units';
    import {relativeTime} from '../../util/relativeTime';
    import {errorMessageOf} from '../../i18n/serverError';
    import {t, plural} from '../../i18n';

    let {
        open = $bindable(false),
        port,
        title,
        canBlock,
        requesterIp,
        onsessionout,
    }: {
        open?: boolean;
        port: number;
        title: string;
        /** 보안 관리 권한(슈퍼유저)이 있으면 차단 버튼을 보인다. */
        canBlock: boolean;
        /** 지금 이 관리 화면에 접속한 주소. 그 주소를 차단하려 하면 확인 창에 경고한다. */
        requesterIp: string | null;
        onsessionout: () => void;
    } = $props();

    let rows = $state<ConnectionRow[]>([]);
    let serverTime = $state(Date.now());
    let loaded = $state(false);
    let failed = $state(false);
    // 이미 읽은 뒤 다시 읽기가 실패했다. 옛 목록을 그대로 두고 새로 고치지 못했다고 알린다. 다음 읽기가 되면 사라진다.
    let stale = $state(false);
    // 창이 열린 동안 받은 모든 id(숨긴 줄 포함). 숨겼던 오래된 연결이 다시 보여도 "새"로 붙이지 않는다. 화면에 그리지 않으므로 $state 가 아니다.
    let seen = new Set<number>();
    let truncated = $state(false);
    // 서버가 준 전체 연결 수. 잘린 목록이어도 요약은 이 수로 센다. 옛 서버는 주지 않는다.
    let total = $state<number | undefined>();
    // 2초마다 다시 읽은 결과는 알리지 않는다. 새 연결이 붙을 때만 화면 낭독기에 조용히 알린다(설계 반영).
    let announce = $state('');
    let busy = $state<Record<number, boolean>>({});
    let blockTarget = $state<ConnectionRow | undefined>();
    let blockOpen = $state(false);
    let blockScope = $state<'tunnel' | 'all'>('tunnel');
    let blockNote = $state('');
    let blocking = $state(false);

    type Snapshot = {serverTime: number; truncated: boolean; total: number | undefined; connections: FetchedConnection[]};

    let poller: StatusPoller<Snapshot> | undefined;

    const stop = () => {
        poller?.stop();
        poller = undefined;
    };

    $effect(() => {
        if(!open) {
            stop();
            return;
        }
        rows = [];
        loaded = false;
        failed = false;
        stale = false;
        seen = new Set<number>();
        truncated = false;
        total = undefined;
        announce = '';
        poller = new StatusPoller<Snapshot>({
            intervalMs: 2000,
            load: async () => {
                const result = await ServerOptionCtrl.instance.tunnelConnections(port);
                // 옛 서버는 목록이 버튼을 보이지 않으므로(connectionsSupported) 여기의 404 는 이 터널을 더 볼 수 없다는 뜻이다
                // (권한이 바뀌었거나 지운 터널). 403 은 볼 수만 있게 된 것이다. 다시 읽어도 나아지지 않으므로 알리고 이 창만 닫는다.
                // 다른 터널의 연결 버튼은 그대로다. 위에 떠 있던 차단 확인 창도 함께 닫는다.
                // 2단계 인증 등록이 필요하면(403 mfa_enrollment_required) 등록 화면으로 옮겨 가므로 알림 없이 닫기만 한다.
                const closing = result.success ? undefined : closingFailure(result);
                if(closing !== undefined) {
                    stop();
                    blockOpen = false;
                    open = false;
                    if(closing.notice !== undefined) toast.push({tone: 'warn', message: closing.notice});
                }
                if(!result.success) throw new Error('connections');
                return {serverTime: result.serverTime, truncated: result.truncated === true, total: result.total, connections: result.connections};
            },
            isSessionOut: (error) => error instanceof InvalidSession,
            onSessionOut: () => { open = false; onsessionout(); },
            onFailure: () => {
                failed = !loaded;
                stale = loaded;
            },
            onSnapshot: (snapshot) => {
                serverTime = snapshot.serverTime;
                // 처음 읽기는 줄 수가 아니라 이미 읽었는지로 판단한다. 빈 목록으로 연 창에 들어온 연결도 "새"로 알린다.
                const next = mergeConnections(rows, snapshot.connections, {truncated: snapshot.truncated, first: !loaded, seen});
                for(const connection of snapshot.connections) seen.add(connection.id);
                const added = addedConnections(rows, next);
                if(added > 0) announce = announcement(announce, plural('connections.newAnnounce', added));
                rows = next;
                truncated = snapshot.truncated;
                total = snapshot.total;
                loaded = true;
                failed = false;
                stale = false;
            },
        });
        poller.start();
        return stop;
    });

    onDestroy(stop);

    const mark = (match: (row: ConnectionRow) => boolean, state: ConnectionRow['state']) => {
        rows = rows.map((row) => match(row) ? {...row, state} : row);
    };

    // 끝났거나 요청 중인 줄의 버튼은 지우거나 disabled 로 바꾸지 않고 aria-disabled 로 둔다. 눌렀던 버튼에서 초점이 빠지지 않는다.
    const inactive = (row: ConnectionRow) => row.state !== 'live' || busy[row.id] === true;

    const close = async (row: ConnectionRow) => {
        if(inactive(row)) return;
        busy = {...busy, [row.id]: true};
        try {
            const result = await ServerOptionCtrl.instance.closeTunnelConnection(port, row.id);
            if(result.success) {
                // 이미 끝난 연결(closed:false)은 오류가 아니다. 줄만 "끝남"으로 바꾸고 알림은 띄우지 않는다(설계 반영).
                mark((entry) => entry.id === row.id, result.closed ? 'closed' : 'ended');
                if(result.closed) toast.push({tone: 'pulse', message: t('connections.closed')});
            } else {
                toast.push({tone: 'alarm', message: errorMessageOf(result, t('connections.closeFailed'))});
            }
        } catch(e) {
            if(e instanceof InvalidSession) { open = false; onsessionout(); return; }
            toast.push({tone: 'alarm', message: t('connections.closeFailed')});
        } finally {
            const {[row.id]: _done, ...rest} = busy;
            busy = rest;
        }
    };

    const liveFrom = (address: string | undefined) => rows.filter((row) => row.state === 'live' && row.remoteAddress === address).length;

    const connectionCount = $derived(summaryCount(rows, total));

    const askBlock = (row: ConnectionRow) => {
        if(inactive(row)) return;
        blockTarget = row;
        blockScope = 'tunnel';
        blockNote = '';
        blockOpen = true;
    };

    const confirmBlock = async () => {
        const target = blockTarget;
        if(!target?.remoteAddress) return;
        const scope = blockScope;
        blocking = true;
        try {
            const result = await SecurityCtrl.instance.block({address: target.remoteAddress, port: scope === 'tunnel' ? port : null,
                note: blockNote.trim() === '' ? t('connections.defaultNote', {title}) : blockNote.trim()});
            if(result.success) {
                mark((row) => row.remoteAddress === target.remoteAddress && row.state === 'live', 'blocked');
                toast.push({tone: 'pulse', message: blockedDoneText(target.remoteAddress, result.closedConnections ?? 0)});
                blockOpen = false;
            } else if(result.code === 'duplicate') {
                // 이미 있는 차단이 이 터널에 걸리면 서버가 그 연결을 끊었다. 줄도 "차단됨"으로 바꾼다.
                // 서버는 주소마다 차단을 하나만 두므로, 그 차단이 요청한 범위를 덮지 못하면 이미 걸린 포트를 밝혀 알린다.
                if(duplicateCoversTunnel(result, port)) mark((row) => row.remoteAddress === target.remoteAddress && row.state === 'live', 'blocked');
                toast.push({tone: 'warn', message: duplicateBlockText(result, {port, scope})});
                blockOpen = false;
            } else {
                // 차단 목록이 가득 차면 보안 화면과 같은 안내를 보인다. 창은 연 채로 두어 다른 범위를 고르거나 취소할 수 있다.
                toast.push({tone: 'alarm', message: errorMessageOf(result)});
            }
        } catch(e) {
            if(e instanceof InvalidSession) { blockOpen = false; open = false; onsessionout(); return; }
            toast.push({tone: 'alarm', message: t('common.unableToConnect')});
        } finally {
            blocking = false;
        }
    };

    const stateLabel = (row: ConnectionRow): string | undefined => row.state === 'ended' ? t('connections.stateEnded')
        : row.state === 'closed' ? t('connections.stateClosed') : row.state === 'blocked' ? t('connections.stateBlocked') : undefined;
</script>

<Modal bind:open title={t('connections.title', {title})} class="connections-modal">
    <p class="sr-only" aria-live="polite">{announce}</p>
    {#if failed}
        <p class="conn-note" role="alert">{t('connections.failed')}</p>
    {:else if loaded}
        <p class="conn-summary">{plural('connections.summary', connectionCount)}</p>
        {#if stale}<p class="conn-note" role="status">{t('connections.refreshFailed')}</p>{/if}
        {#if rows.length === 0}<p class="conn-note">{t('connections.empty')}</p>{/if}
    {/if}
    <ul class="conn-list" id={`connections-${port}`}>
        {#each rows as row (row.id)}
            {@const label = stateLabel(row)}
            <li class="conn" class:ended={row.state !== 'live'} class:new={row.isNew} data-connection={row.id}>
                <div class="conn-addr mono">{row.remoteAddress ?? '—'}{#if row.remoteAddress === requesterIp}<span class="me-ip">{t('connections.yourIp')}</span>{/if}</div>
                <div class="conn-meta">
                    {#if label}<span class="tag">{label}</span> · {/if}{#if row.isNew && row.state === 'live'}<span class="tag new-tag">{t('connections.new')}</span> · {/if}{#if row.country}{row.country} · {/if}{t('connections.connectedAgo', {ago: relativeTime(row.connectedAt, serverTime)})} · RX {byteToUnit(row.rx)} · TX {byteToUnit(row.tx)}
                </div>
                <div class="conn-act">
                    <!-- 책임자 지시(2026-11-13): 끊기·차단은 작은 아이콘 버튼이다. 이름은 aria-label·title 로 준다.
                         끝난 줄에서도 버튼을 남기고 aria-disabled 로 둔다. 버튼이 사라지면 키보드 초점이 창 밖(body)으로 빠진다. -->
                    <button type="button" class="ibtn" data-close={row.id} aria-disabled={inactive(row)}
                        aria-label={t('connections.closeLabel', {address: row.remoteAddress ?? ''})} title={t('connections.close')} onclick={() => close(row)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10"/><path d="M17 7L7 17"/></svg>
                    </button>
                    {#if canBlock && row.remoteAddress}
                        <button type="button" class="ibtn danger" data-block={row.id} aria-disabled={inactive(row)}
                            aria-label={t('connections.blockLabel', {address: row.remoteAddress})} title={t('connections.block')} onclick={() => askBlock(row)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>
                        </button>
                    {/if}
                </div>
            </li>
        {/each}
    </ul>
    {#if truncated}<p class="conn-note capped">{t('connections.capped')}</p>{/if}
    {#snippet footer()}<Button onclick={() => (open = false)}>{t('common.dismiss')}</Button>{/snippet}
</Modal>

<Modal bind:open={blockOpen} title={t('connections.blockTitle', {address: blockTarget?.remoteAddress ?? ''})}>
    <p class="block-body">{blockBodyText({count: liveFrom(blockTarget?.remoteAddress), scope: blockScope})}</p>
    {#if blockTarget?.remoteAddress === requesterIp}
        <p class="warnbox" role="alert">{t('connections.selfWarning')}</p>
    {/if}
    <div class="scope" role="radiogroup" aria-label={t('connections.scope')}>
        <label><input type="radio" name={`block-scope-${port}`} value="tunnel" bind:group={blockScope} />{t('connections.scopeTunnel')}{' '}<small>{title}</small></label>
        <label><input type="radio" name={`block-scope-${port}`} value="all" bind:group={blockScope} />{t('connections.scopeAll')}</label>
    </div>
    <label class="note-label" for={`block-note-${port}`}>{t('connections.note')}</label>
    <TextInput id={`block-note-${port}`} bind:value={blockNote} placeholder={t('connections.defaultNote', {title})} />
    {#snippet footer()}
        <Button onclick={() => (blockOpen = false)}>{t('common.cancel')}</Button>
        <Button variant="danger" disabled={blocking} onclick={confirmBlock}>{t('connections.block')}</Button>
    {/snippet}
</Modal>

<style>
    /* 설계 반영(FR-17): 데스크톱에서는 연결 창을 640px 로 넓힌다. 좁은 화면에서는 Modal 의 100% 폭을 그대로 쓴다. */
    :global(.modal.connections-modal) { max-width: 640px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .conn-summary { margin: 0 0 var(--s-3); font-size: var(--fs-sm); color: var(--ink-2); font-variant-numeric: tabular-nums; }
    .conn-note.capped { margin: var(--s-3) 0 0; }
    .conn-note { margin: 0 0 var(--s-3); font-size: var(--fs-sm); color: var(--ink-2); }
    .conn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-2); }
    .conn { border: 1px solid var(--line-1); border-radius: var(--r-3); background: var(--bg-2); padding: var(--s-3);
        display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: var(--s-3); row-gap: 4px; }
    /* 주소와 설명은 늘 첫째 칸, 버튼은 둘째 칸이다. */
    .conn-addr, .conn-meta { grid-column: 1; min-width: 0; }
    .conn-addr { font-size: 13px; color: var(--ink-0); overflow-wrap: anywhere; }
    .me-ip { margin-left: 6px; font-family: var(--ff-ui); font-size: 11px; font-weight: 600; color: var(--warn); white-space: nowrap; }
    .conn-meta { font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
    .tag { font-size: 11px; font-weight: 600; color: var(--ink-2); }
    .new-tag { color: var(--pulse); }
    .conn.ended { opacity: .55; }
    .conn.new { border-color: var(--pulse-dim); }
    .conn-act { grid-column: 2; grid-row: 1 / span 2; display: flex; gap: 4px; }
    /* 보이는 크기 32px(WCAG 2.5.8 최소 24px 이상)의 아이콘 버튼. */
    .ibtn { width: 32px; height: 32px; display: inline-grid; place-items: center; padding: 0; border: 1px solid var(--line-1);
        border-radius: var(--r-2); background: var(--bg-1); color: var(--ink-1); cursor: pointer; }
    .ibtn:hover { background: var(--bg-3); color: var(--ink-0); }
    .ibtn:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }
    .ibtn[aria-disabled="true"] { opacity: .42; cursor: not-allowed; }
    .ibtn.danger { color: var(--alarm); }
    .ibtn.danger:hover { border-color: var(--alarm); }
    .ibtn svg { width: 16px; height: 16px; }
    .block-body { margin: 0 0 var(--s-3); }
    .warnbox { margin: 0 0 var(--s-3); padding: var(--s-3); border: 1px solid var(--warn); border-radius: var(--r-2); color: var(--warn); font-size: var(--fs-sm); }
    .scope { display: flex; flex-direction: column; gap: var(--s-2); margin: 0 0 var(--s-3); }
    .scope label { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 var(--s-3); border: 1px solid var(--line-1);
        border-radius: var(--r-3); background: var(--bg-2); cursor: pointer; font-size: 14px; color: var(--ink-0); }
    .scope label:has(input:checked) { border-color: var(--signal); background: var(--signal-glow); }
    .scope small { min-width: 0; overflow-wrap: anywhere; color: var(--ink-2); font-size: var(--fs-sm); }
    .scope input { accent-color: var(--signal); width: 18px; height: 18px; margin: 0; }
    .note-label { display: block; margin-bottom: var(--s-2); font-size: var(--fs-sm); color: var(--ink-1); }
</style>
