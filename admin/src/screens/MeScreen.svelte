<script lang="ts">
    import {onMount} from 'svelte';
    import InvalidSession from '../controller/InvalidSession';
    import MeCtrl from '../controller/MeCtrl';
    import type {SessionView} from '../controller/Types';
    import Badge from '../ui/Badge.svelte';
    import Banner from '../ui/Banner.svelte';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Checkbox from '../ui/Checkbox.svelte';
    import Chip from '../ui/Chip.svelte';
    import Field from '../ui/Field.svelte';
    import Modal from '../ui/Modal.svelte';
    import TextInput from '../ui/TextInput.svelte';
    import {toast} from '../ui/toast';
    import {loadMe, me} from '../me';
    import {navigate} from '../router';
    import {useSession} from '../shell/session';
    import {relativeTime} from '../util/relativeTime';
    import QrCanvas from './parts/QrCanvas.svelte';

    // U3-05: #/me. 계정 카드는 me 스토어만 읽는다.
    // U4-09: MFA 카드(등록 3단계·해제·복구 코드 재발급)와 세션 카드. secret·복구 코드는 모달이 닫히면 상태에서 지운다.
    const session = useSession();
    const UA_LIMIT = 48;

    const mfaEnabled = $derived($me?.mfa?.enabled === true);

    let pending = $state(false);

    // 등록 모달
    let enrollOpen = $state(false);
    let enrollStep = $state<1 | 2 | 3>(1);
    let secret = $state('');
    let otpauthUri = $state('');
    let recoveryCodes = $state<string[]>([]);
    let code = $state('');
    let codeError = $state('');
    let saved = $state(false);

    // 해제·재발급 모달
    let disableOpen = $state(false);
    let disablePassword = $state('');
    let disableError = $state('');
    let codesOpen = $state(false);
    // 새 복구 코드를 저장했다는 확인. 서버는 이미 옛 코드를 무효화했으므로 확인 전에는 닫지 않는다.
    let codesSaved = $state(false);
    let codesPassword = $state('');
    let codesError = $state('');
    let newCodes = $state<string[]>([]);

    // 세션 카드
    let sessions = $state<SessionView[]>([]);
    let now = $state(Date.now());
    const others = $derived(sessions.filter((entry) => !entry.current).length);

    const failed = (error: unknown) => {
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

    const clearEnrollment = () => {
        secret = '';
        otpauthUri = '';
        recoveryCodes = [];
        code = '';
        codeError = '';
        saved = false;
        enrollStep = 1;
    };

    // 모달이 어떤 경로(Cancel, Escape, Done)로 닫혀도 비밀 값을 지운다.
    let enrollWasOpen = false;
    $effect(() => {
        if(enrollOpen) enrollWasOpen = true;
        else if(enrollWasOpen) {
            enrollWasOpen = false;
            clearEnrollment();
        }
    });
    let codesWasOpen = false;
    $effect(() => {
        if(codesOpen) codesWasOpen = true;
        else if(codesWasOpen) {
            codesWasOpen = false;
            newCodes = [];
            codesPassword = '';
            codesError = '';
            codesSaved = false;
            void run(async () => { await loadMe(); });
        }
    });
    // 해제 모달을 어떤 경로로 닫아도 입력한 비밀번호를 상태에 남기지 않는다.
    $effect(() => {
        if(!disableOpen) disablePassword = '';
    });

    // 3단계(복구 코드 저장)와 새 복구 코드를 보이는 동안에는 Escape 로 닫히지 않게 캡처 단계에서 막는다(Modal 을 고치지 않는다).
    $effect(() => {
        const showingCodes = (enrollOpen && enrollStep === 3) || (codesOpen && newCodes.length > 0);
        if(!showingCodes) return;
        const block = (e: KeyboardEvent) => { if(e.key === 'Escape') e.stopPropagation(); };
        window.addEventListener('keydown', block, true);
        return () => window.removeEventListener('keydown', block, true);
    });

    const copy = (text: string) => { navigator.clipboard?.writeText(text)?.catch(() => {}); };

    const startEnroll = () => run(async () => {
        clearEnrollment();
        const result = await MeCtrl.instance.enrollMfa();
        if(!result.success) {
            toast.push({tone: 'alarm', message: result.message});
            return;
        }
        secret = result.secret;
        otpauthUri = result.otpauthUri;
        recoveryCodes = result.recoveryCodes;
        enrollOpen = true;
    });

    const confirm = () => run(async () => {
        codeError = '';
        const result = await MeCtrl.instance.confirmMfa(code);
        if(result.success) {
            enrollStep = 3;
        } else if(result.code === 'mfa_enrollment_expired') {
            toast.push({tone: 'alarm', message: 'The setup expired. Start again.'});
            enrollOpen = false;
        } else if(result.status === 401) {
            codeError = 'The code is incorrect.';
        } else {
            codeError = result.message;
        }
    });

    const finishEnroll = () => {
        enrollOpen = false;
        void run(async () => { await loadMe(); });
    };

    const disable = () => run(async () => {
        disableError = '';
        const result = await MeCtrl.instance.disableMfa(disablePassword);
        if(result.success) {
            disableOpen = false;
            disablePassword = '';
            await loadMe();
            toast.push({tone: 'pulse', message: 'Two-factor authentication disabled.'});
        } else if(result.code === 'mfa_required') {
            disableError = 'Superusers must keep two-factor authentication enabled.';
        } else if(result.status === 401) {
            disableError = 'The password is incorrect.';
        } else {
            disableError = result.message;
        }
    });

    const generateCodes = () => run(async () => {
        codesError = '';
        const result = await MeCtrl.instance.regenerateRecoveryCodes(codesPassword);
        if(result.success) {
            newCodes = result.recoveryCodes;
            codesPassword = '';
        } else if(result.status === 401) {
            codesError = 'The password is incorrect.';
        } else {
            codesError = result.message;
        }
    });

    const loadSessions = async () => {
        const result = await MeCtrl.instance.sessions();
        now = Date.now();
        if(result.success) sessions = result.sessions;
    };

    const logoutOthers = () => run(async () => {
        const result = await MeCtrl.instance.logoutOthers();
        if(!result.success) {
            toast.push({tone: 'alarm', message: result.message});
            return;
        }
        toast.push({tone: 'pulse', message: `Signed out ${result.removed} other device(s).`});
        await loadSessions();
    });

    const shortAgent = (agent: string): string => agent.length > UA_LIMIT ? agent.slice(0, UA_LIMIT) + '…' : agent;

    onMount(() => { void run(loadSessions); });
</script>

{#if $me}
    <div style="display: flex; flex-direction: column; gap: var(--s-4); align-items: stretch;">
        {#if $me.mustEnrollMfa}
            <div id="mfa-required-banner"><Banner tone="warn">Superusers must enable two-factor authentication.</Banner></div>
        {/if}
        <Card label="Account">
            <dl style="display: grid; grid-template-columns: max-content 1fr; gap: var(--s-2) var(--s-4); margin: 0; align-items: center;">
                <dt>Username</dt>
                <dd style="margin: 0;"><span id="me-username" class="mono">@{$me.user.username}</span></dd>
                <dt>Display name</dt>
                <dd style="margin: 0;"><span id="me-display-name">{$me.user.displayName}</span></dd>
                <dt>Role</dt>
                <dd style="margin: 0;"><span id="me-role"><Chip tone={$me.user.role === 'superuser' ? 'signal' : 'neutral'}>{$me.user.role}</Chip></span></dd>
                <dt>Group</dt>
                <dd style="margin: 0;"><span id="me-group">{$me.group.name}</span></dd>
            </dl>
        </Card>
        <div><Button variant="primary" onclick={() => navigate('#/me/password')}>Change password</Button></div>

        <section id="me-mfa">
            <Card label="Two-factor authentication">
                <div style="display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center;">
                    {#if mfaEnabled}
                        <span id="mfa-status"><Badge tone="pulse">Enabled</Badge></span>
                        <span id="mfa-recovery-remaining">{$me.mfa?.recoveryCodesRemaining ?? 0} recovery codes left</span>
                        <span id="mfa-new-codes"><Button disabled={pending} onclick={() => { codesError = ''; newCodes = []; codesOpen = true; }}>New recovery codes</Button></span>
                        <span id="mfa-disable"><Button variant="danger" disabled={pending} onclick={() => { disableError = ''; disablePassword = ''; disableOpen = true; }}>Disable</Button></span>
                    {:else}
                        <span id="mfa-status"><Badge tone="neutral">Off</Badge></span>
                        <span id="mfa-setup"><Button variant="primary" disabled={pending} onclick={() => { void startEnroll(); }}>Set up</Button></span>
                    {/if}
                </div>
            </Card>
        </section>

        <section id="me-sessions">
            <Card label="Sessions">
                <div style="display: flex; flex-direction: column; gap: var(--s-3);">
                    <ul id="me-session-list" style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-3);">
                        {#each sessions as entry (entry.id)}
                            <li class="session-row" data-session-id={entry.id}>
                                <div style="display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center;">
                                    <span class="mono">{entry.ip}</span>
                                    {#if entry.current}<Chip tone="signal">this device</Chip>{/if}
                                </div>
                                <div class="mono" style="color: var(--ink-2);">last seen {relativeTime(entry.lastSeenAt, now)}</div>
                                <div class="mono" style="color: var(--ink-2); overflow-wrap: anywhere;" title={entry.userAgent}>{shortAgent(entry.userAgent)}</div>
                            </li>
                        {/each}
                    </ul>
                    <div><span id="me-logout-others"><Button disabled={pending || others === 0} onclick={() => { void logoutOthers(); }}>Sign out other devices</Button></span></div>
                </div>
            </Card>
        </section>
    </div>
{/if}

<Modal bind:open={enrollOpen} title="Set up two-factor authentication" closeOnOverlay={false} class="mfa-enroll-modal">
    {#if enrollStep === 1}
        <div style="display: flex; flex-direction: column; gap: var(--s-3); align-items: flex-start;">
            <QrCanvas value={otpauthUri} />
            <div style="display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center;">
                <code class="mono" id="mfa-secret">{secret}</code>
                <span id="mfa-copy-secret"><Button size="sm" onclick={() => copy(secret)}>Copy</Button></span>
            </div>
            <p style="margin: 0;">Scan the QR code, or enter the key manually.</p>
        </div>
    {:else if enrollStep === 2}
        <Field label="6-digit code" for="mfa-code" error={codeError || undefined}>
            <TextInput id="mfa-code" inputmode="numeric" autocomplete="one-time-code" bind:value={code}
                oninput={(v) => (code = v.replace(/\D/g, '').slice(0, 6))} />
        </Field>
    {:else}
        <div style="display: flex; flex-direction: column; gap: var(--s-3);">
            <ul id="mfa-recovery-codes" style="margin: 0; padding-left: var(--s-4);">
                {#each recoveryCodes as recovery (recovery)}<li class="mono">{recovery}</li>{/each}
            </ul>
            <div><span id="mfa-copy-codes"><Button size="sm" onclick={() => copy(recoveryCodes.join('\n'))}>Copy all</Button></span></div>
            <p style="margin: 0;">Each code works once. Keep them somewhere safe.</p>
            <Checkbox id="mfa-saved" label="I saved these codes" bind:checked={saved} />
        </div>
    {/if}
    {#snippet footer()}
        {#if enrollStep !== 3}
            <span id="mfa-cancel"><Button onclick={() => (enrollOpen = false)}>Cancel</Button></span>
        {/if}
        {#if enrollStep === 1}
            <span id="mfa-next"><Button variant="primary" onclick={() => (enrollStep = 2)}>Next</Button></span>
        {:else if enrollStep === 2}
            <span id="mfa-confirm"><Button variant="primary" disabled={pending} onclick={() => { void confirm(); }}>Verify</Button></span>
        {:else}
            <span id="mfa-done"><Button variant="primary" disabled={!saved} onclick={finishEnroll}>Done</Button></span>
        {/if}
    {/snippet}
</Modal>

<Modal bind:open={disableOpen} title="Disable two-factor authentication" class="mfa-disable-modal">
    <Field label="Password" for="mfa-disable-password" error={disableError || undefined}>
        <TextInput id="mfa-disable-password" type="password" autocomplete="current-password" bind:value={disablePassword} />
    </Field>
    {#snippet footer()}
        <Button onclick={() => (disableOpen = false)}>Cancel</Button>
        <span id="mfa-disable-confirm"><Button variant="danger" disabled={pending} onclick={() => { void disable(); }}>Disable</Button></span>
    {/snippet}
</Modal>

<Modal bind:open={codesOpen} title="New recovery codes" closeOnOverlay={newCodes.length === 0} class="mfa-codes-modal">
    {#if newCodes.length === 0}
        <Field label="Password" for="mfa-codes-password" error={codesError || undefined}>
            <TextInput id="mfa-codes-password" type="password" autocomplete="current-password" bind:value={codesPassword} />
        </Field>
    {:else}
        <ul id="mfa-recovery-codes" style="margin: 0; padding-left: var(--s-4);">
            {#each newCodes as recovery (recovery)}<li class="mono">{recovery}</li>{/each}
        </ul>
        <div style="margin-top: var(--s-3);"><span id="mfa-copy-codes"><Button size="sm" onclick={() => copy(newCodes.join('\n'))}>Copy all</Button></span></div>
        <p style="margin: var(--s-3) 0 0;">Your previous codes no longer work. Each new code works once.</p>
        <Checkbox id="mfa-codes-saved" label="I saved these codes" bind:checked={codesSaved} />
    {/if}
    {#snippet footer()}
        {#if newCodes.length === 0}
            <Button onclick={() => (codesOpen = false)}>Cancel</Button>
            <span id="mfa-codes-generate"><Button variant="primary" disabled={pending} onclick={() => { void generateCodes(); }}>Generate</Button></span>
        {:else}
            <span id="mfa-codes-done"><Button variant="primary" disabled={!codesSaved} onclick={() => (codesOpen = false)}>Done</Button></span>
        {/if}
    {/snippet}
</Modal>
