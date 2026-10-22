<script lang="ts">
    import {onMount} from 'svelte';
    import InvalidSession from '../controller/InvalidSession';
    import ServerOptionCtrl from '../controller/ServerOptionCtrl';
    import TrustedClientsCtrl from '../controller/TrustedClientsCtrl';
    import type {EnrollmentCodeView, TrustedClientView} from '../controller/Types';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Field from '../ui/Field.svelte';
    import Modal from '../ui/Modal.svelte';
    import TextInput from '../ui/TextInput.svelte';
    import {toast} from '../ui/toast';
    import {useSession} from '../shell/session';
    import {formatLocal} from '../util/relativeTime';

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
    const expired = $derived(!!enrollCode && enrollCode.expiresAt <= now);

    const failed = (error: unknown): void => {
        if(error instanceof InvalidSession) session.invalidate();
        else toast.push({tone: 'alarm', message: 'Unable to connect to the server.'});
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
            toast.push({tone: 'alarm', message: result.message});
        }
    };

    const revision = async (): Promise<number> => {
        const snapshot = await ServerOptionCtrl.instance.getServerOption();
        tls = snapshot.value.tls === true;
        return snapshot.revision;
    };

    const issue = (clientId: string) => run(async () => {
        const result = await TrustedClientsCtrl.instance.issueCode(clientId);
        if(!result.success) {
            toast.push({tone: 'alarm', message: result.message});
            return;
        }
        enrollFor = clientId;
        enrollCode = {code: result.code, expiresAt: result.expiresAt, controlPort: result.controlPort};
        now = Date.now();
        enrollOpen = true;
    });

    const create = () => run(async () => {
        const clientId = newId.trim();
        const result = await TrustedClientsCtrl.instance.create(clientId, newName, await revision());
        if(!result.success) {
            toast.push({tone: 'alarm', message: result.message});
            return;
        }
        newId = '';
        newName = '';
        toast.push({tone: 'pulse', message: `Client ${clientId} created.`});
        await load();
        if(tls) {
            pending = false;
            await issue(clientId);
        }
    });

    const remove = () => {
        deleteOpen = false;
        const clientId = target;
        void run(async () => {
            const result = await TrustedClientsCtrl.instance.remove(clientId, await revision());
            if(!result.success) {
                toast.push({tone: 'alarm', message: result.message});
                return;
            }
            toast.push({tone: 'pulse', message: `Client ${clientId} deleted.`});
            await load();
        });
    };

    const rotate = () => {
        rotateOpen = false;
        const clientId = target;
        void run(async () => {
            const result = await TrustedClientsCtrl.instance.rotateSecret(clientId, await revision());
            if(!result.success) {
                toast.push({tone: 'alarm', message: result.message});
                return;
            }
            toast.push({tone: 'pulse', message: `New secret for ${clientId}. Its connection was closed; enroll it again.`});
            if(tls) {
                pending = false;
                await issue(clientId);
            }
        });
    };

    const copy = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(command);
            toast.push({tone: 'pulse', message: 'Command copied.'});
        } catch {
            toast.push({tone: 'alarm', message: 'Copy is not available here. Select the command and copy it.'});
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
            <Field label="Client ID" for="client-new-id">
                <TextInput id="client-new-id" bind:value={newId} placeholder="edge-1" />
            </Field>
            <Field label="Display name (optional)" for="client-new-name">
                <TextInput id="client-new-name" bind:value={newName} />
            </Field>
            <span id="client-create"><Button variant="primary" disabled={pending || newId.trim() === ''} onclick={(e) => { rememberTrigger(e); void create(); }}>Add client</Button></span>
        </div>
    </Card>

    {#if loaded && !tls}
        <p id="clients-tls-notice" style="color: var(--ink-2); margin: 0;">
            Turn on TLS for the control port in Server settings to use enrollment codes. Until then, set up clients by hand.
        </p>
    {:else if loaded}
        <Field label="Server address for the join command" for="clients-address">
            <TextInput id="clients-address" bind:value={address} placeholder="gw.example.com" oninput={rememberAddress} />
        </Field>
    {/if}

    {#if loaded && clients.length === 0}
        <p id="clients-empty">No trusted clients.</p>
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
                                <Button size="sm" class="client-code" disabled={pending} onclick={(e) => { rememberTrigger(e); void issue(client.clientId); }}>Enrollment code</Button>
                            {/if}
                            <Button size="sm" class="client-rotate" disabled={pending} onclick={(e) => { rememberTrigger(e); target = client.clientId; rotateOpen = true; }}>New secret</Button>
                            <Button variant="danger" size="sm" class="client-delete" disabled={pending} onclick={() => { target = client.clientId; deleteOpen = true; }}>Delete</Button>
                        </div>
                    </div>
                </Card>
            </li>
        {/each}
    </ul>
</div>

<Modal bind:open={enrollOpen} title={`Enroll ${enrollFor}`} class="enroll-modal">
    <div style="display: flex; flex-direction: column; gap: var(--s-3);">
        <p style="margin: 0;">Run this on the client host. The code works once.</p>
        <code id="enroll-command" class:expired class="mono" style="overflow-wrap: anywhere; user-select: all; opacity: {expired ? 0.45 : 1};">{command}</code>
        {#if enrollCode}
            <p style="margin: 0; color: var(--ink-2);">{expired ? 'Expired' : 'Expires'} {formatLocal(enrollCode.expiresAt, false)}</p>
        {/if}
    </div>
    {#snippet footer()}
        <Button onclick={() => (enrollOpen = false)}>Close</Button>
        {#if expired}
            <span id="enroll-reissue"><Button variant="primary" disabled={pending} onclick={() => { void issue(enrollFor); }}>Issue new code</Button></span>
        {:else}
            <span id="enroll-copy"><Button variant="primary" onclick={() => { void copy(); }}>Copy command</Button></span>
        {/if}
    {/snippet}
</Modal>
<Modal bind:open={deleteOpen} title="Delete trusted client" class="delete-client-modal">
    Delete {target}? Its connection closes and it can no longer authenticate.
    {#snippet footer()}
        <Button onclick={() => (deleteOpen = false)}>Cancel</Button>
        <Button variant="danger" id="confirm-delete-client" onclick={remove}>Delete</Button>
    {/snippet}
</Modal>
<Modal bind:open={rotateOpen} title="New secret" class="rotate-client-modal">
    Make a new secret for {target}? Its connection closes until it enrolls again.
    {#snippet footer()}
        <Button onclick={() => (rotateOpen = false)}>Cancel</Button>
        <span id="confirm-rotate-client"><Button variant="danger" onclick={rotate}>New secret</Button></span>
    {/snippet}
</Modal>
