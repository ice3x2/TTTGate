<script lang="ts">
    import {onDestroy, onMount} from 'svelte';
    import InvalidSession from '../controller/InvalidSession';
    import ServerOptionCtrl from '../controller/ServerOptionCtrl';
    import TrustedClientsCtrl from '../controller/TrustedClientsCtrl';
    import type {EnrollmentCodeView, TrustedClientView} from '../controller/Types';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Field from '../ui/Field.svelte';
    import Modal from '../ui/Modal.svelte';
    import Select from '../ui/Select.svelte';
    import TextInput from '../ui/TextInput.svelte';
    import {toast} from '../ui/toast';
    import {useSession} from '../shell/session';
    import {formatLocal} from '../util/relativeTime';
    import {errorMessageOf} from '../i18n/serverError';
    import {t} from '../i18n';

    // 이슈 213: 해시 /clients. 신뢰 클라이언트를 만들고 지우며, 클라이언트 PC 에 붙여 넣을 등록 명령을 보여 준다.
    // 비밀값은 화면에 보이지 않는다. 클라이언트는 등록 코드(client join)로만 받아 간다.
    const session = useSession();
    const ADDRESS_KEY = 'tttgate.enroll.address';

    let clients = $state<TrustedClientView[]>([]);
    let loaded = $state(false);
    let tls = $state(false);
    let pending = $state(false);
    let newId = $state('');
    let newName = $state('');
    let address = $state('');
    let now = $state(Date.now());

    let enrollOpen = $state(false);
    let enrollFor = $state('');
    let enrollCode = $state<EnrollmentCodeView | undefined>();
    let deleteOpen = $state(false);
    /**
     * 등록 창을 연 버튼. 코드를 받는 동안 버튼이 비활성이 되어 포커스가 본문으로 빠지므로, 창이 기억한 곳 대신
     * 이 버튼으로 포커스를 돌려준다(이슈 213 REQ-6, 이슈 225).
     */
    let returnFocusTo: HTMLElement | null = null;
    let enrollWasOpen = false;
    $effect(() => {
        if(enrollOpen) {
            enrollWasOpen = true;
        } else if(enrollWasOpen) {
            enrollWasOpen = false;
            const target = returnFocusTo;
            returnFocusTo = null;
            if(target) queueMicrotask(() => target.focus());
        }
    });
    const rememberTrigger = (e?: Event): void => {
        if(e?.currentTarget instanceof HTMLElement) returnFocusTo = e.currentTarget;
    };
    let rotateOpen = $state(false);
    let target = $state('');

    /** 관리 콘솔은 SSH 터널·프록시 뒤에서 열릴 수 있어 브라우저 주소를 기본값으로 쓰지 않는다. 마지막 입력만 기억한다. */
    const readAddress = (): string => {
        try { return localStorage.getItem(ADDRESS_KEY) ?? ''; } catch { return ''; }
    };
    const rememberAddress = (value: string): void => {
        try { localStorage.setItem(ADDRESS_KEY, value.trim()); } catch { /* 저장소를 못 써도 화면은 동작한다 */ }
    };

    const hostPart = (value: string): string => {
        const trimmed = value.trim();
        if(trimmed === '') return '<server-address>';
        return trimmed.includes(':') && !trimmed.startsWith('[') ? `[${trimmed}]` : trimmed;
    };
    const command = $derived(enrollCode ? `TTTGate client join ${hostPart(address)}:${enrollCode.controlPort} --code ${enrollCode.code}` : '');
    /**
     * 이슈 313: 발급이 실패했다. 실패 사유(다른 발급, 제어 포트 설정 변경, 클라이언트 삭제)는 대개 화면의 코드도 이미 무효라는 뜻이고,
     * 응답만 잃었을 수도 있다. 만료된 코드처럼 복사를 막고 다시 받게 한다.
     */
    let invalidated = $state(false);
    const expired = $derived(!!enrollCode && (invalidated || (enrollCode.expiresAt !== null && enrollCode.expiresAt <= now)));

    // 이슈 313: 등록 코드의 만료. 값은 분이고 never 는 만료 없음이다. 바꾸면 그 기한으로 새 코드를 받는다.
    const TTL_OPTIONS = [
        {value: '15', label: t('clients.ttl15m')}, {value: '60', label: t('clients.ttl1h')}, {value: '1440', label: t('clients.ttl24h')},
        {value: '10080', label: t('clients.ttl7d')}, {value: '43200', label: t('clients.ttl30d')}, {value: 'never', label: t('clients.neverExpires')}
    ];
    const DEFAULT_TTL = '15';
    let ttl = $state(DEFAULT_TTL);
    /** 마지막으로 발급에 성공한 기한. 발급이 실패하면 선택 칸을 이 값으로 되돌린다. */
    let issuedTtl = DEFAULT_TTL;
    /**
     * 발급 요청은 한 번에 하나만 보낸다. 겹쳐 보내면 서버가 받는 순서와 화면의 최신이 어긋나, 화면에는 무효가 된 코드가
     * 남고 보이지 않는 코드가 서버에 남을 수 있다. 요청 중에 고른 기한은 queuedTtl 에 두었다가 앞 요청이 끝나면 보낸다.
     * 그사이 창을 닫았으면 보내지 않는다. 코드는 임시로 받고, 창에 보여 줄 때만 고른 기한을 확인한다. 그래서 닫힌 창에 온
     * 긴 기한의 코드는 확인되지 않고 기본 15분 뒤 사라진다. 아무도 보지 못한 긴 기한의 코드가 남지 않는다.
     */
    let issuing = false;
    let queuedTtl: string | undefined;
    /** 화면을 떠났다. 창은 닫히지 않은 채 사라지므로, 응답을 받은 뒤에는 창을 닫은 것과 같게 다룬다. */
    let disposed = false;
    onDestroy(() => { disposed = true; });
    /** 그 클라이언트의 코드 창이 보이고 있다. 보이지 않는 창에 온 코드는 확인하지 않는다. */
    const shown = (clientId: string): boolean => !disposed && enrollOpen && enrollFor === clientId;
    /** 기본(15분)보다 긴 기한은 코드를 보여 줄 때 확인해야 적용된다. */
    const needsConfirm = (value: string): boolean => value === 'never' || Number(value) > Number(DEFAULT_TTL);
    /**
     * 요청이 적용되었는지 알 수 없다. 서버가 답하지 못했거나(네트워크 오류), 중간에서 실패했거나(5xx),
     * 2xx 인데 본문을 읽지 못했다. 409·400 은 서버가 답한 확실한 실패다.
     */
    const resultUnknown = (status: number): boolean => status === 0 || status >= 500 || (status >= 200 && status < 300);
    const ttlMinutesOf = (value: string): number | null => value === 'never' ? null : Number(value);

    const failed = (error: unknown): void => {
        if(error instanceof InvalidSession) session.invalidate();
        else toast.push({tone: 'alarm', message: t('common.unableToConnect')});
    };

    const run = async (task: () => Promise<void>): Promise<void> => {
        pending = true;
        try {
            await task();
        } catch(error) {
            failed(error);
        } finally {
            pending = false;
        }
    };

    const load = async (): Promise<void> => {
        const result = await TrustedClientsCtrl.instance.list();
        if(result.success) {
            clients = result.trustedClients;
            loaded = true;
        } else {
            toast.push({tone: 'alarm', message: errorMessageOf(result)});
        }
    };

    const revision = async (): Promise<number> => {
        const snapshot = await ServerOptionCtrl.instance.getServerOption();
        tls = snapshot.value.tls === true;
        return snapshot.revision;
    };

    /** 코드를 받는다. open 이 참일 때만 창을 연다. 창 안에서 다시 받는 경우 늦게 온 응답이 닫은 창을 다시 열면 안 된다. */
    const issue = async (clientId: string, open = false): Promise<void> => {
        if(issuing) {
            queuedTtl = ttl;
            return;
        }
        issuing = true;
        const chosen = ttl;
        /** 확인 결과를 끝내 몰랐다. 서버에는 만료 없는 코드가 있을 수 있으므로 기본 기한 코드로 대체한다. */
        let replaceWithDefault = false;
        try {
            await run(async () => {
                const result = await TrustedClientsCtrl.instance.issueCode(clientId, ttlMinutesOf(chosen));
                if(!result.success) {
                    ttl = issuedTtl;
                    invalidated = true;
                    toast.push({tone: 'alarm', message: errorMessageOf(result)});
                    return;
                }
                // 창이 닫혔거나 화면을 떠났으면 확인하지 않는다. 임시 코드는 기본 15분 뒤 사라진다.
                if(open ? disposed : !shown(clientId)) return;
                // 먼저 보여 준다. 고른 기한은 보여 준 코드에만 확인한다.
                invalidated = false;
                enrollFor = clientId;
                enrollCode = {code: result.code, expiresAt: result.expiresAt, controlPort: result.controlPort};
                now = Date.now();
                if(open) enrollOpen = true;
                if(needsConfirm(chosen) && shown(clientId)) {
                    let confirmed = await TrustedClientsCtrl.instance.confirmCode(clientId, result.issueId);
                    // 확인은 같은 요청을 다시 보내도 결과가 같다. 응답만 잃었으면 한 번 더 보내 실제 결과를 받는다.
                    if(!confirmed.success && resultUnknown(confirmed.status)) confirmed = await TrustedClientsCtrl.instance.confirmCode(clientId, result.issueId);
                    if(!confirmed.success && resultUnknown(confirmed.status)) {
                        invalidated = true;
                        replaceWithDefault = true;
                        toast.push({tone: 'alarm', message: t('clients.confirmFailed')});
                        return;
                    }
                    if(!confirmed.success) {
                        // 그 코드는 대체되었거나 무효다. 응답만 잃었다면 서버에서는 긴 기한일 수 있으니 다시 받게 한다.
                        ttl = issuedTtl;
                        invalidated = true;
                        toast.push({tone: 'alarm', message: errorMessageOf(confirmed)});
                        return;
                    }
                    enrollCode = {...enrollCode, expiresAt: confirmed.expiresAt};
                }
                issuedTtl = chosen;
            });
        } finally {
            issuing = false;
        }
        const next = queuedTtl;
        queuedTtl = undefined;
        // 창이 닫혔어도 대체한다. 대체한 코드는 임시 발급이라 아무도 보지 않으면 15분 뒤 사라진다.
        if(replaceWithDefault) {
            ttl = DEFAULT_TTL;
            await issue(clientId);
            return;
        }
        if(!shown(clientId)) return;
        if(next !== undefined && next !== issuedTtl) {
            ttl = next;
            await issue(clientId);
        }
    };

    /** 새 창을 열 때는 기한을 기본(15분)으로 되돌린다. 이전 창에서 고른 값이 다른 클라이언트로 넘어가지 않게 한다. */
    const openCode = (clientId: string) => {
        ttl = DEFAULT_TTL;
        issuedTtl = DEFAULT_TTL;
        return issue(clientId, true);
    };

    const create = () => run(async () => {
        const clientId = newId.trim();
        const result = await TrustedClientsCtrl.instance.create(clientId, newName, await revision());
        if(!result.success) {
            toast.push({tone: 'alarm', message: errorMessageOf(result)});
            return;
        }
        newId = '';
        newName = '';
        toast.push({tone: 'pulse', message: t('clients.created', {clientId})});
        await load();
        if(tls) {
            pending = false;
            await openCode(clientId);
        }
    });

    const remove = () => {
        deleteOpen = false;
        const clientId = target;
        void run(async () => {
            const result = await TrustedClientsCtrl.instance.remove(clientId, await revision());
            if(!result.success) {
                toast.push({tone: 'alarm', message: errorMessageOf(result)});
                return;
            }
            toast.push({tone: 'pulse', message: t('clients.deleted', {clientId})});
            await load();
        });
    };

    const rotate = () => {
        rotateOpen = false;
        const clientId = target;
        void run(async () => {
            const result = await TrustedClientsCtrl.instance.rotateSecret(clientId, await revision());
            if(!result.success) {
                toast.push({tone: 'alarm', message: errorMessageOf(result)});
                return;
            }
            toast.push({tone: 'pulse', message: t('clients.rotated', {clientId})});
            if(tls) {
                pending = false;
                await openCode(clientId);
            }
        });
    };

    const copy = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(command);
            toast.push({tone: 'pulse', message: t('clients.copied')});
        } catch {
            toast.push({tone: 'alarm', message: t('clients.copyUnavailable')});
        }
    };

    onMount(() => {
        address = readAddress();
        void run(async () => {
            await revision();
            await load();
        });
        // 만료 표시를 위해 시각만 갱신한다.
        const timer = setInterval(() => { now = Date.now(); }, 1000);
        return () => clearInterval(timer);
    });
</script>

<div style="display: flex; flex-direction: column; gap: var(--s-4);">
    <Card>
        <div style="display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: flex-end;">
            <Field label={t('clients.clientId')} for="client-new-id">
                <TextInput id="client-new-id" bind:value={newId} placeholder="edge-1" />
            </Field>
            <Field label={t('clients.displayNameOptional')} for="client-new-name">
                <TextInput id="client-new-name" bind:value={newName} />
            </Field>
            <span id="client-create"><Button variant="primary" disabled={pending || newId.trim() === ''} onclick={(e) => { rememberTrigger(e); void create(); }}>{t('clients.add')}</Button></span>
        </div>
    </Card>

    {#if loaded && !tls}
        <p id="clients-tls-notice" style="color: var(--ink-2); margin: 0;">
            {t('clients.tlsNotice')}
        </p>
    {:else if loaded}
        <Field label={t('clients.serverAddress')} for="clients-address">
            <TextInput id="clients-address" bind:value={address} placeholder="gw.example.com" oninput={rememberAddress} />
        </Field>
    {/if}

    {#if loaded && clients.length === 0}
        <p id="clients-empty">{t('clients.empty')}</p>
    {/if}
    <ul id="clients-list" style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-3);">
        {#each clients as client (client.clientId)}
            <li class="client-row" data-client-id={client.clientId}>
                <Card compact>
                    <div style="display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between;">
                        <div style="min-width: 0; display: flex; flex-direction: column; gap: var(--s-1);">
                            <span class="mono">{client.clientId}</span>
                            {#if client.displayName && client.displayName !== client.clientId}<span style="color: var(--ink-2);">{client.displayName}</span>{/if}
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: var(--s-2);">
                            {#if tls}
                                <Button size="sm" class="client-code" disabled={pending} onclick={(e) => { rememberTrigger(e); void openCode(client.clientId); }}>{t('clients.enrollmentCode')}</Button>
                            {/if}
                            <Button size="sm" class="client-rotate" disabled={pending} onclick={(e) => { rememberTrigger(e); target = client.clientId; rotateOpen = true; }}>{t('clients.newSecret')}</Button>
                            <Button variant="danger" size="sm" class="client-delete" disabled={pending} onclick={() => { target = client.clientId; deleteOpen = true; }}>{t('common.delete')}</Button>
                        </div>
                    </div>
                </Card>
            </li>
        {/each}
    </ul>
</div>

<Modal bind:open={enrollOpen} title={t('clients.enrollTitle', {clientId: enrollFor})} class="enroll-modal">
    <div style="display: flex; flex-direction: column; gap: var(--s-3);">
        <p style="margin: 0;">{t('clients.runOnHost')}</p>
        <code id="enroll-command" class:expired class="mono" style="overflow-wrap: anywhere; user-select: {expired || pending ? 'none' : 'all'}; opacity: {expired || pending ? 0.45 : 1};">{command}</code>
        <div aria-live="polite" style="display: contents;">
        {#if enrollCode}
            {#if invalidated}
                <p style="margin: 0; color: var(--ink-2);">{t('clients.codeInvalidated')}</p>
            {:else if enrollCode.expiresAt === null}
                <p style="margin: 0; color: var(--ink-2);">{t('clients.neverExpires')}</p>
                <p id="enroll-never-warning" style="margin: 0;">{t('clients.neverWarning')}</p>
            {:else}
                <p style="margin: 0; color: var(--ink-2);">{t(expired ? 'clients.expired' : 'clients.expires', {time: formatLocal(enrollCode.expiresAt, false)})}</p>
            {/if}
        {/if}
        </div>
        <Field label={t('clients.expiresAfter')} for="enroll-ttl">
            <Select id="enroll-ttl" options={TTL_OPTIONS} bind:value={ttl} describedby={!invalidated && enrollCode?.expiresAt === null ? 'enroll-never-warning' : undefined}
                onchange={() => { void issue(enrollFor); }} />
        </Field>
    </div>
    {#snippet footer()}
        <Button onclick={() => (enrollOpen = false)}>{t('clients.close')}</Button>
        {#if expired}
            <span id="enroll-reissue"><Button variant="primary" disabled={pending} onclick={() => { void issue(enrollFor); }}>{t('clients.issueNewCode')}</Button></span>
        {:else}
            <span id="enroll-copy"><Button variant="primary" disabled={pending} onclick={() => { void copy(); }}>{t('clients.copyCommand')}</Button></span>
        {/if}
    {/snippet}
</Modal>
<Modal bind:open={deleteOpen} title={t('clients.deleteTitle')} class="delete-client-modal">
    {t('clients.deleteConfirm', {clientId: target})}
    {#snippet footer()}
        <Button onclick={() => (deleteOpen = false)}>{t('common.cancel')}</Button>
        <Button variant="danger" id="confirm-delete-client" onclick={remove}>{t('common.delete')}</Button>
    {/snippet}
</Modal>
<Modal bind:open={rotateOpen} title={t('clients.newSecret')} class="rotate-client-modal">
    {t('clients.rotateConfirm', {clientId: target})}
    {#snippet footer()}
        <Button onclick={() => (rotateOpen = false)}>{t('common.cancel')}</Button>
        <span id="confirm-rotate-client"><Button variant="danger" onclick={rotate}>{t('clients.newSecret')}</Button></span>
    {/snippet}
</Modal>
