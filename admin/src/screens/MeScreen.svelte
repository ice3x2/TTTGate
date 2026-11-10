<script lang="ts">
    import {onMount} from 'svelte';
    import {startRegistration} from '@simplewebauthn/browser';
    import InvalidSession from '../controller/InvalidSession';
    import MeCtrl from '../controller/MeCtrl';
    import type {PasskeyView, SessionView} from '../controller/Types';
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
    import {blockNavigation, navigate} from '../router';
    import {useSession} from '../shell/session';
    import {relativeTime} from '../util/relativeTime';
    import {i18n, t} from '../i18n';
    import {errorMessageOf} from '../i18n/serverError';
    import QrCanvas from './parts/QrCanvas.svelte';
    import {defaultPasskeyName, errorNameOf, isCertificateError, passkeysAvailable, rememberPasskeyPreferred} from '../util/passkey';

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

    const clearEnrollment = () => {
        secret = '';
        otpauthUri = '';
        recoveryCodes = [];
        code = '';
        codeError = '';
        saved = false;
        enrollStep = 1;
        replacing = false;
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
        // 뒤로가기·주소 변경으로 화면이 사라지면 코드를 잃는다. 서버는 이미 옛 코드를 무효화했으므로 이동도 막는다.
        const release = blockNavigation(() => {
            toast.push({tone: 'alarm', message: t('me.saveCodesFirst')});
            return false;
        });
        return () => { window.removeEventListener('keydown', block, true); release(); };
    });

    const copy = (text: string) => { navigator.clipboard?.writeText(text)?.catch(() => {}); };

    const startEnroll = () => run(async () => {
        clearEnrollment();
        const result = await MeCtrl.instance.enrollMfa();
        if(!result.success) {
            toast.push({tone: 'alarm', message: errorMessageOf(result)});
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
            toast.push({tone: 'alarm', message: errorMessageOf(result)});
            enrollOpen = false;
        } else {
            codeError = errorMessageOf(result);
        }
    });

    const finishEnroll = () => {
        enrollOpen = false;
        if(replacing) toast.push({tone: 'pulse', message: t('me.appReplaced')});
        replacing = false;
        void run(async () => { await loadMe(); });
    };

    // 이슈 346: 휴대폰을 잃고 복구 코드로 들어온 사용자가 새 휴대폰을 등록한다. 비밀번호를 확인한 뒤 등록 창을 그대로 쓴다.
    let replaceOpen = $state(false);
    let replacePassword = $state('');
    let replaceError = $state('');
    let replacing = $state(false);
    const startReplace = () => run(async () => {
        replaceError = '';
        clearEnrollment();
        const result = await MeCtrl.instance.enrollMfa({password: replacePassword});
        if(!result.success) {
            replaceError = errorMessageOf(result);
            return;
        }
        replaceOpen = false;
        replacePassword = '';
        replacing = true;
        secret = result.secret;
        otpauthUri = result.otpauthUri;
        recoveryCodes = result.recoveryCodes;
        enrollOpen = true;
    });

    const disable = () => run(async () => {
        disableError = '';
        const result = await MeCtrl.instance.disableMfa(disablePassword);
        if(result.success) {
            disableOpen = false;
            disablePassword = '';
            await loadMe();
            toast.push({tone: 'pulse', message: t('me.mfaDisabled')});
        } else {
            disableError = errorMessageOf(result);
            // 다른 탭에서 패스키를 지운 경우처럼 화면이 늦었다(mfa_required). 화면을 서버 상태에 맞춘다.
            if(result.code === 'mfa_required') { await loadMe(); await loadPasskeys(); }
        }
    });

    const generateCodes = () => run(async () => {
        codesError = '';
        const result = await MeCtrl.instance.regenerateRecoveryCodes(codesPassword);
        if(result.success) {
            newCodes = result.recoveryCodes;
            codesPassword = '';
        } else {
            codesError = errorMessageOf(result);
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
            toast.push({tone: 'alarm', message: errorMessageOf(result)});
            return;
        }
        toast.push({tone: 'pulse', message: t('sessions.signedOutOthers', {count: result.removed})});
        await loadSessions();
    });

    // 이슈 336: 패스키 카드. 비밀번호를 다시 확인한 뒤 브라우저가 패스키를 만든다. 비밀번호는 창이 닫히면 상태에서 지운다.
    const passkeySupported = passkeysAvailable();
    let passkeys = $state<PasskeyView[]>([]);
    // 이슈 346: 강제 대상의 마지막 2단계 수단. 지우는 버튼을 미리 막는다(서버도 409 mfa_required 로 막는다).
    const totpIsLast = $derived($me?.mfaRequired === true && mfaEnabled && passkeys.length === 0);
    const passkeyIsLast = $derived($me?.mfaRequired === true && !mfaEnabled && passkeys.length === 1);
    let passkeyOpen = $state(false);
    let passkeyName = $state('');
    let passkeyPassword = $state('');
    let passkeyError = $state('');
    let removeOpen = $state(false);
    let removeTarget = $state<PasskeyView | undefined>(undefined);

    $effect(() => {
        if(!passkeyOpen) passkeyPassword = '';
    });

    /** 서버가 패스키 등록을 거절한 이유. 코드별 문구는 이슈 349 의 errorMessageOf 가 고른다. */
    const failureMessageOf = (result: {code?: string; message?: string; generated?: boolean}): string =>
        errorMessageOf(result, t('common.unableToConnect'));
    /** 브라우저가 패스키를 만들지 못한 이유. 인증서 오류를 NotAllowedError 보다 먼저 본다. */
    const browserMessageOf = (error: unknown): string => {
        if(isCertificateError(error)) return t('serverError.passkey_origin_unsupported');
        if(errorNameOf(error) === 'InvalidStateError') return t('serverError.passkey_already_registered');
        return t('me.passkeyNotCreated');
    };

    const loadPasskeys = async () => {
        const result = await MeCtrl.instance.passkeys();
        if(result.success) passkeys = result.passkeys;
    };

    const openAddPasskey = () => {
        passkeyName = defaultPasskeyName();
        passkeyPassword = '';
        passkeyError = '';
        passkeyOpen = true;
    };

    const addPasskey = () => run(async () => {
        passkeyError = '';
        const options = await MeCtrl.instance.passkeyOptions(passkeyPassword);
        if(!options.success) {
            passkeyError = failureMessageOf(options);
            return;
        }
        let response;
        try {
            response = await startRegistration({optionsJSON: options.options});
        } catch(error) {
            // 사용자가 브라우저 창을 닫거나 기기가 거절하면 브라우저는 예외로 알린다(고를 수 없는 계약이다).
            passkeyError = browserMessageOf(error);
            return;
        }
        const saved = await MeCtrl.instance.registerPasskey(passkeyName, response);
        if(!saved.success) {
            passkeyError = failureMessageOf(saved);
            return;
        }
        passkeyOpen = false;
        // 이슈 338: 이 기기에 패스키가 생겼으므로 다음 로그인 화면은 패스키를 먼저 보인다.
        rememberPasskeyPreferred();
        // 이슈 346 결정 7: 강제 대상이 인증 앱 없이 패스키만 가지면 비밀번호 로그인이 막히고 IP 주소로는 들어올 수 없다.
        toast.push({tone: 'pulse', message: t($me?.mfaRequired && !mfaEnabled ? 'me.passkeyAddedSetUpApp' : 'me.passkeyAdded')});
        await loadPasskeys();
        // 이슈 346: 패스키도 2단계 수단이다. 강제 등록 중이었으면 이제 풀렸으므로 내 정보를 다시 읽는다.
        await loadMe();
    });

    const removePasskey = () => run(async () => {
        const target = removeTarget;
        removeOpen = false;
        if(!target) return;
        const result = await MeCtrl.instance.removePasskey(target.id);
        if(!result.success) {
            toast.push({tone: 'alarm', message: errorMessageOf(result)});
            if(result.code === 'mfa_required') { await loadMe(); await loadPasskeys(); }
            return;
        }
        toast.push({tone: 'pulse', message: t('me.passkeyRemoved')});
        await loadPasskeys();
    });

    /** 패스키를 추가한 날. 이 언어의 Intl 날짜 형식이다(이슈 349 FR-6). */
    const addedOn = (at: number): string => i18n().dateTime({year: 'numeric', month: 'numeric', day: 'numeric'}).format(new Date(at));

    const shortAgent = (agent: string): string => agent.length > UA_LIMIT ? agent.slice(0, UA_LIMIT) + '…' : agent;

    onMount(() => { void run(loadSessions); });
    // 이슈 346: 강제 등록 중에도 패스키를 등록할 수 있다. 다만 이 주소에서 패스키를 쓸 수 없으면 카드를 숨기고 목록도 읽지 않는다.
    let passkeysLoaded = false;
    $effect(() => {
        if(!$me || ($me.mustEnrollMfa && !passkeySupported) || passkeysLoaded) return;
        passkeysLoaded = true;
        void run(loadPasskeys);
    });
</script>

{#if $me}
    <div style="display: flex; flex-direction: column; gap: var(--s-4); align-items: stretch;">
        {#if $me.mustEnrollMfa}
            <div id="mfa-required-banner"><Banner tone="warn">{t('me.mfaRequiredBanner')}</Banner></div>
            {#if !passkeySupported}
                <p id="mfa-enroll-passkey-unavailable" style="margin: 0; color: var(--ink-2); font-size: var(--fs-sm);">{t('me.passkeyUnavailableUseApp', {condition: t('passkey.condition')})}</p>
            {/if}
        {/if}
        <Card label={t('me.account')}>
            <dl style="display: grid; grid-template-columns: max-content 1fr; gap: var(--s-2) var(--s-4); margin: 0; align-items: center;">
                <dt>{t('user.username')}</dt>
                <dd style="margin: 0;"><span id="me-username" class="mono">@{$me.user.username}</span></dd>
                <dt>{t('user.displayName')}</dt>
                <dd style="margin: 0;"><span id="me-display-name">{$me.user.displayName}</span></dd>
                <dt>{t('user.role')}</dt>
                <dd style="margin: 0;"><span id="me-role"><Chip tone={$me.user.role === 'superuser' ? 'signal' : 'neutral'}>{t($me.user.role === 'superuser' ? 'users.roleSuperuser' : 'users.roleRegular')}</Chip></span></dd>
                <dt>{t('user.group')}</dt>
                <dd style="margin: 0;"><span id="me-group">{$me.group.name}</span></dd>
            </dl>
        </Card>
        <div><Button variant="primary" onclick={() => navigate('#/me/password')}>{t('nav.changePassword')}</Button></div>

        <section id="me-mfa">
            <Card label={t('me.twoFactor')}>
                <!-- 이슈 343: 왼쪽은 상태, 오른쪽은 동작 버튼이다. 폭이 모자라면 버튼 묶음이 다음 줄로 내려간다. -->
                <div style="display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between;">
                    {#if mfaEnabled}
                        <div style="display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center;">
                            <span id="mfa-status" style="font-size: var(--fs-md); color: var(--pulse);">{t('user.mfaEnabled')}</span>
                            <span id="mfa-recovery-remaining" style="font-size: var(--fs-sm); color: var(--ink-2);">{t('me.recoveryLeft', {count: $me.mfa?.recoveryCodesRemaining ?? 0})}</span>
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center;">
                            <span id="mfa-replace"><Button disabled={pending} onclick={() => { replaceError = ''; replacePassword = ''; replaceOpen = true; }}>{t('me.replaceApp')}</Button></span>
                            <span id="mfa-new-codes"><Button disabled={pending} onclick={() => { codesError = ''; newCodes = []; codesOpen = true; }}>{t('me.newRecoveryCodes')}</Button></span>
                            <span id="mfa-disable"><Button variant="danger" disabled={pending || totpIsLast} onclick={() => { disableError = ''; disablePassword = ''; disableOpen = true; }}>{t('me.disable')}</Button></span>
                        </div>
                        {#if totpIsLast}
                            <!-- 이슈 346: 누른 뒤 거절하지 않고, 미리 막고 이유를 보인다. -->
                            <p id="mfa-disable-blocked" style="margin: 0; flex-basis: 100%; color: var(--ink-2); font-size: var(--fs-sm);">{t(passkeySupported ? 'me.disableBlockedAddPasskey' : 'me.disableBlocked')}</p>
                        {/if}
                    {:else}
                        <span id="mfa-status" style="font-size: var(--fs-md); color: var(--ink-2);">{t('user.mfaOff')}</span>
                        <span id="mfa-setup"><Button variant="primary" disabled={pending} onclick={() => { void startEnroll(); }}>{t('me.setUp')}</Button></span>
                    {/if}
                </div>
            </Card>
        </section>

        {#if !$me.mustEnrollMfa || passkeySupported}
        <section id="me-passkeys">
            <Card label={t('user.passkeys')}>
                <div style="display: flex; flex-direction: column; gap: var(--s-3);">
                    {#if passkeys.length === 0}
                        <p id="passkey-empty" style="margin: 0;">{t('me.noPasskeys')}</p>
                    {:else}
                        <ul id="passkey-list" style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-3);">
                            {#each passkeys as passkey (passkey.id)}
                                <li class="passkey-row" data-passkey-id={passkey.id} style="display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-3); align-items: center; justify-content: space-between;">
                                    <div style="display: flex; flex-direction: column; gap: var(--s-1); min-width: 0;">
                                        <div style="display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center;">
                                            <span style="overflow-wrap: anywhere;">{passkey.name}</span>
                                            {#if passkey.backedUp}<Chip tone="neutral">{t('me.synced')}</Chip>{/if}
                                        </div>
                                        <div class="mono" style="color: var(--ink-2);">
                                            {passkey.lastUsedAt === null ? t('me.passkeyNeverUsed', {date: addedOn(passkey.createdAt)})
                                                : t('me.passkeyLastUsed', {date: addedOn(passkey.createdAt), ago: relativeTime(passkey.lastUsedAt, now)})}
                                        </div>
                                    </div>
                                    <span class="passkey-remove"><Button size="sm" variant="danger" disabled={pending || passkeyIsLast} onclick={() => { removeTarget = passkey; removeOpen = true; }}>{t('common.remove')}</Button></span>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                    {#if passkeyIsLast}
                        <p id="passkey-remove-blocked" style="margin: 0; color: var(--ink-2); font-size: var(--fs-sm);">{t('me.removeBlocked')}</p>
                    {/if}
                    <div><span id="passkey-add"><Button variant="primary" disabled={pending || !passkeySupported} onclick={openAddPasskey}>{t('me.addPasskey')}</Button></span></div>
                    <p id="passkey-hint" style="margin: 0; color: var(--ink-2); font-size: var(--fs-sm);">{passkeySupported
                        ? ($me.mfaRequired && !mfaEnabled ? t('me.passkeyReplacesPassword', {condition: t('passkey.condition')}) : t('passkey.condition'))
                        : t('serverError.passkey_origin_unsupported')}</p>
                </div>
            </Card>
        </section>
        {/if}

        <section id="me-sessions">
            <Card label={t('user.sessions')}>
                <div style="display: flex; flex-direction: column; gap: var(--s-3);">
                    <ul id="me-session-list" style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-3);">
                        {#each sessions as entry (entry.id)}
                            <li class="session-row" data-session-id={entry.id}>
                                <div style="display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center;">
                                    <span class="mono">{entry.ip}</span>
                                    {#if entry.current}<Chip tone="signal">{t('sessions.thisDevice')}</Chip>{/if}
                                </div>
                                <div class="mono" style="color: var(--ink-2);">{t('me.lastSeen', {ago: relativeTime(entry.lastSeenAt, now)})}</div>
                                <div class="mono" style="color: var(--ink-2); overflow-wrap: anywhere;" title={entry.userAgent}>{shortAgent(entry.userAgent)}</div>
                            </li>
                        {/each}
                    </ul>
                    <div><span id="me-logout-others"><Button disabled={pending || others === 0} onclick={() => { void logoutOthers(); }}>{t('sessions.signOutOthers')}</Button></span></div>
                </div>
            </Card>
        </section>
    </div>
{/if}

<Modal bind:open={enrollOpen} title={t('me.enrollTitle')} closeOnOverlay={false} class="mfa-enroll-modal">
    {#if enrollStep === 1}
        <div style="display: flex; flex-direction: column; gap: var(--s-3); align-items: flex-start;">
            <QrCanvas value={otpauthUri} />
            <div style="display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center;">
                <code class="mono" id="mfa-secret">{secret}</code>
                <span id="mfa-copy-secret"><Button size="sm" onclick={() => copy(secret)}>{t('common.copy')}</Button></span>
            </div>
            <p style="margin: 0;">{t('me.scanOrEnter')}</p>
        </div>
    {:else if enrollStep === 2}
        <Field label={t('me.sixDigitCode')} for="mfa-code" error={codeError || undefined}>
            <TextInput id="mfa-code" inputmode="numeric" autocomplete="one-time-code" bind:value={code}
                oninput={(v) => (code = v.replace(/\D/g, '').slice(0, 6))} />
        </Field>
    {:else}
        <div style="display: flex; flex-direction: column; gap: var(--s-3);">
            <ul id="mfa-recovery-codes" style="margin: 0; padding-left: var(--s-4);">
                {#each recoveryCodes as recovery (recovery)}<li class="mono">{recovery}</li>{/each}
            </ul>
            <div><span id="mfa-copy-codes"><Button size="sm" onclick={() => copy(recoveryCodes.join('\n'))}>{t('me.copyAll')}</Button></span></div>
            <p style="margin: 0;">{t('me.codesOnce')}</p>
            <Checkbox id="mfa-saved" label={t('me.savedCodes')} bind:checked={saved} />
        </div>
    {/if}
    {#snippet footer()}
        {#if enrollStep !== 3}
            <span id="mfa-cancel"><Button onclick={() => (enrollOpen = false)}>{t('common.cancel')}</Button></span>
        {/if}
        {#if enrollStep === 1}
            <span id="mfa-next"><Button variant="primary" onclick={() => (enrollStep = 2)}>{t('me.next')}</Button></span>
        {:else if enrollStep === 2}
            <span id="mfa-confirm"><Button variant="primary" disabled={pending} onclick={() => { void confirm(); }}>{t('login.verify')}</Button></span>
        {:else}
            <span id="mfa-done"><Button variant="primary" disabled={!saved} onclick={finishEnroll}>{t('common.done')}</Button></span>
        {/if}
    {/snippet}
</Modal>

<Modal bind:open={passkeyOpen} title={t('me.addPasskey')} closeOnOverlay={false} class="passkey-add-modal">
    <div style="display: flex; flex-direction: column; gap: var(--s-3);">
        <Field label={t('me.passkeyName')} for="passkey-name">
            <TextInput id="passkey-name" autocomplete="off" bind:value={passkeyName} />
        </Field>
        <Field label={t('login.password')} for="passkey-password">
            <TextInput id="passkey-password" type="password" autocomplete="current-password" bind:value={passkeyPassword} />
        </Field>
        <p id="passkey-error" role="alert" style="min-height: 1.5em; margin: 0; color: var(--alarm); font-size: var(--fs-sm);">{passkeyError}</p>
    </div>
    {#snippet footer()}
        <span id="passkey-cancel"><Button onclick={() => (passkeyOpen = false)}>{t('common.cancel')}</Button></span>
        <span id="passkey-continue"><Button variant="primary" disabled={pending} onclick={() => { void addPasskey(); }}>{t('me.continue')}</Button></span>
    {/snippet}
</Modal>

<Modal bind:open={removeOpen} title={t('me.removePasskey')} class="passkey-remove-modal">
    {t('me.removePasskeyConfirm', {name: removeTarget?.name ?? ''})}
    {#snippet footer()}
        <Button onclick={() => (removeOpen = false)}>{t('common.cancel')}</Button>
        <span id="passkey-remove-confirm"><Button variant="danger" onclick={() => { void removePasskey(); }}>{t('common.remove')}</Button></span>
    {/snippet}
</Modal>

<Modal bind:open={replaceOpen} title={t('me.replaceTitle')} class="mfa-replace-modal">
    <div style="display: flex; flex-direction: column; gap: var(--s-3);">
        <p style="margin: 0;">{t('me.replaceHint')}</p>
        <Field label={t('login.password')} for="mfa-replace-password" error={replaceError || undefined}>
            <TextInput id="mfa-replace-password" type="password" autocomplete="current-password" bind:value={replacePassword} />
        </Field>
    </div>
    {#snippet footer()}
        <Button onclick={() => (replaceOpen = false)}>{t('common.cancel')}</Button>
        <span id="mfa-replace-continue"><Button variant="primary" disabled={pending} onclick={() => { void startReplace(); }}>{t('me.continue')}</Button></span>
    {/snippet}
</Modal>

<Modal bind:open={disableOpen} title={t('me.disableTitle')} class="mfa-disable-modal">
    <Field label={t('login.password')} for="mfa-disable-password" error={disableError || undefined}>
        <TextInput id="mfa-disable-password" type="password" autocomplete="current-password" bind:value={disablePassword} />
    </Field>
    {#snippet footer()}
        <Button onclick={() => (disableOpen = false)}>{t('common.cancel')}</Button>
        <span id="mfa-disable-confirm"><Button variant="danger" disabled={pending} onclick={() => { void disable(); }}>{t('me.disable')}</Button></span>
    {/snippet}
</Modal>

<Modal bind:open={codesOpen} title={t('me.newRecoveryCodes')} closeOnOverlay={newCodes.length === 0} class="mfa-codes-modal">
    {#if newCodes.length === 0}
        <Field label={t('login.password')} for="mfa-codes-password" error={codesError || undefined}>
            <TextInput id="mfa-codes-password" type="password" autocomplete="current-password" bind:value={codesPassword} />
        </Field>
    {:else}
        <ul id="mfa-recovery-codes" style="margin: 0; padding-left: var(--s-4);">
            {#each newCodes as recovery (recovery)}<li class="mono">{recovery}</li>{/each}
        </ul>
        <div style="margin-top: var(--s-3);"><span id="mfa-copy-codes"><Button size="sm" onclick={() => copy(newCodes.join('\n'))}>{t('me.copyAll')}</Button></span></div>
        <p style="margin: var(--s-3) 0 0;">{t('me.previousCodesGone')}</p>
        <Checkbox id="mfa-codes-saved" label={t('me.savedCodes')} bind:checked={codesSaved} />
    {/if}
    {#snippet footer()}
        {#if newCodes.length === 0}
            <Button onclick={() => (codesOpen = false)}>{t('common.cancel')}</Button>
            <span id="mfa-codes-generate"><Button variant="primary" disabled={pending} onclick={() => { void generateCodes(); }}>{t('me.generate')}</Button></span>
        {:else}
            <span id="mfa-codes-done"><Button variant="primary" disabled={!codesSaved} onclick={() => (codesOpen = false)}>{t('common.done')}</Button></span>
        {/if}
    {/snippet}
</Modal>
