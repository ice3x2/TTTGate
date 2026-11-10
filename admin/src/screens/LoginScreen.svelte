<script lang="ts">
    import {WebAuthnAbortService, browserSupportsWebAuthnAutofill, startAuthentication, type AuthenticationResponseJSON} from '@simplewebauthn/browser';
    import LoginCtrl, {type LoginResult, type LoginUser} from '../controller/LoginCtrl';
    import {onDestroy, onMount, tick} from 'svelte';
    import {PASSKEY_CONDITION, PASSKEY_UNSUPPORTED, consumeSignedOut, forgetPasskeyPreferred, isCertificateError, passkeyPreferred, passkeysAvailable, rememberPasskeyPreferred} from '../util/passkey';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Field from '../ui/Field.svelte';
    import TextInput from '../ui/TextInput.svelte';
    import {t} from '../i18n';
    import {errorMessageOf} from '../i18n/serverError';

    let {onsuccess}: {onsuccess: (result: {user?: LoginUser; mustChangePassword: boolean}) => void} = $props();

    const LAST_USERNAME_KEY = 'tttgate.lastUsername';

    // localStorage 는 브라우저 정책으로 막힐 수 있다. 이 접근만 예외로 감싼다.
    const readLastUsername = (): string => {
        try { return localStorage.getItem(LAST_USERNAME_KEY) ?? ''; } catch { return ''; }
    };
    const rememberUsername = (value: string): void => {
        try { localStorage.setItem(LAST_USERNAME_KEY, value); } catch { /* 저장하지 못해도 로그인은 계속한다 */ }
    };

    let username = $state(readLastUsername());
    let password = $state('');
    let bootstrapToken = $state('');
    let bootstrapRequired = $state(false);
    let message = $state('');
    let pending = $state(false);
    // U4-07: 2단계. 티켓은 이 컴포넌트 상태에만 둔다(새로고침하면 처음부터).
    let ticket = $state('');
    let useRecovery = $state(false);
    let code = $state('');
    let recoveryCode = $state('');

    const startOver = (notice = '') => {
        ticket = '';
        code = '';
        recoveryCode = '';
        useRecovery = false;
        password = '';
        message = notice;
    };

    const verify = async (e?: SubmitEvent) => {
        e?.preventDefault();
        if(pending) return;
        const value = useRecovery ? recoveryCode.trim() : code;
        if(value === '') {
            message = 'Enter the code.';
            return;
        }
        pending = true;
        const sent = ticket;
        try {
            const result = await LoginCtrl.loginMfa(sent, useRecovery ? {recoveryCode: value} : {code: value});
            // 응답을 기다리는 사이 사용자가 처음으로 돌아갔다면 결과를 버린다.
            if(ticket !== sent) return;
            if(result.success) {
                rememberUsername(username.trim() === '' ? 'admin' : username.trim());
                signedIn = true;
                onsuccess({user: result.user, mustChangePassword: result.mustChangePassword === true});
                return;
            }
            if(result.code === 'mfa_ticket_invalid') startOver('The sign-in expired. Start again.');
            else if(result.code === 'mfa_code_invalid') message = 'The code is incorrect.';
            else if(result.status === 429) message = 'Too many attempts. Try again later.';
            else if(result.status === 422) message = 'Enter the code.';
            else message = result.message || 'Unable to connect to the server.';
        } catch {
            message = 'Unable to connect to the server.';
        } finally {
            pending = false;
        }
    };

    // 이슈 336: 패스키 로그인. 사용자 이름 없이 브라우저가 이 사이트의 패스키를 고르게 한다. TOTP 는 묻지 않는다.
    const passkeySupported = passkeysAvailable();
    // 이슈 338: 이 기기에서 패스키를 쓴 적이 있으면 비밀번호 칸을 접고 패스키를 먼저 보인다.
    let showPassword = $state(!(passkeySupported && passkeyPreferred()));
    // 이슈 346: 비밀번호는 맞았지만 이 계정은 패스키로만 로그인한다(2단계 인증 강제 대상이 패스키만 가졌다).
    let passkeyRequired = $state(false);
    const useDifferentAccount = () => {
        passkeyRequired = false;
        message = '';
        showPassword = true;
    };

    const usePassword = async () => {
        // 이슈 345: 자동 요청이 응답을 기다리고 있으면 취소한다. 취소는 자동 요청 경로에서 문구 없이 끝난다.
        if(autoRunning) WebAuthnAbortService.cancelCeremony();
        showPassword = true;
        await tick();
        document.getElementById('login-username')?.focus();
    };

    /** 패스키 로그인이 실패한 이유. 코드별 문구는 이슈 349 의 errorMessageOf 가 고른다. 시도 횟수 제한(429)은 상태 코드로 본다. */
    const passkeyFailureOf = (result: LoginResult): string =>
        result.status === 429 ? t('login.tooManyAttempts') : errorMessageOf(result, t('common.unableToConnect'));

    // 이슈 345: 로그인이 끝났다. 화면이 사라지기 전에 자동 완성 요청을 다시 걸지 않는다.
    let signedIn = $state(false);

    /**
     * 브라우저가 돌려준 패스키 응답을 서버에 보낸다. 버튼이나 자동 요청의 패스키를 서버가 거부하면(이슈 345) 이 기기의
     * 패스키 우선 표시를 지운다. 자동 완성 경로의 거부는 challenge 만료일 수도 있으므로 표시를 지우지 않는다.
     */
    const completePasskey = async (response: AuthenticationResponseJSON, fromAutofill = false): Promise<void> => {
        const result = await LoginCtrl.loginPasskey(response);
        if(result.success) {
            if(result.user) rememberUsername(result.user.username);
            rememberPasskeyPreferred();
            signedIn = true;
            onsuccess({user: result.user, mustChangePassword: result.mustChangePassword === true});
            return;
        }
        if(result.code === 'passkey_invalid' && !fromAutofill) forgetPasskeyPreferred();
        message = passkeyFailureOf(result);
        showPassword = true;
    };

    /**
     * 패스키 로그인. auto 는 이슈 345 의 화면을 열 때 보내는 자동 요청이다. 자동 요청은 사용자가 고른 동작이 아니므로
     * 옵션을 받지 못하거나 브라우저가 거절·취소하면 문구 없이 패스키 버튼 화면에 머문다.
     */
    // 자동 요청이 진행 중이다. 이 동안에도 Use password 는 누를 수 있다.
    let autoRunning = $state(false);

    const passkeySignIn = async (auto = false) => {
        if(pending) return;
        pending = true;
        autoRunning = auto;
        message = '';
        try {
            const options = await LoginCtrl.passkeyOptions();
            // 옵션을 기다리는 사이 화면을 떠났거나 Use password 를 눌렀으면 요청을 시작하지 않는다.
            if(destroyed || (auto && showPassword)) return;
            if(!options.success || !options.options) {
                if(auto) return;
                message = passkeyFailureOf(options);
                showPassword = true;
                return;
            }
            let response;
            try {
                // 진행 중인 자동 완성(조건부 UI) 요청은 라이브러리가 새 요청을 시작하면서 취소한다.
                response = await startAuthentication({optionsJSON: options.options});
            } catch(error) {
                if(auto) return;
                // 사용자가 브라우저 창을 닫으면 브라우저는 예외로 알린다. 인증서 오류를 취소보다 먼저 본다.
                message = isCertificateError(error) ? PASSKEY_UNSUPPORTED : 'Sign-in was canceled.';
                showPassword = true;
                return;
            }
            await completePasskey(response);
        } catch {
            message = 'Unable to connect to the server.';
            showPassword = true;
        } finally {
            pending = false;
            autoRunning = false;
        }
    };

    // 이슈 345: 비밀번호 화면에서는 사용자 이름 칸의 자동 완성으로 패스키를 고를 수 있다(조건부 UI).
    let autofillAvailable = $state(false);
    let autofillRunning = false;
    let destroyed = false;
    // 서버 challenge 는 150초 뒤 만료된다. 브라우저가 자동 완성 요청에 시간 제한을 두지 않을 수 있으므로 100초마다 새로 건다.
    const AUTOFILL_REFRESH_MS = 100_000;

    const autofillAllowed = (): boolean =>
        !passkeyRequired && !destroyed && !signedIn && autofillAvailable && !pending && showPassword && ticket === '' && !bootstrapRequired;

    const startAutofill = async () => {
        if(autofillRunning || !autofillAllowed()) return;
        autofillRunning = true;
        let refresh = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const options = await LoginCtrl.passkeyOptions();
            if(!options.success || !options.options || !autofillAllowed()) return;
            let response;
            try {
                // 라이브러리는 지원 여부를 확인한 뒤에야 취소 신호를 만든다. 그 사이에 화면을 떠났으면 새로 걸지 않고 정리만 한다.
                timer = setTimeout(() => { refresh = autofillAllowed(); WebAuthnAbortService.cancelCeremony(); }, AUTOFILL_REFRESH_MS);
                response = await startAuthentication({optionsJSON: options.options, useBrowserAutofill: true});
            } catch {
                // 다른 요청이 시작되었거나, 화면을 떠났거나, 새로 걸려고 취소했다. 사용자에게 알릴 일이 아니다.
                return;
            } finally {
                clearTimeout(timer);
            }
            // 비밀번호 제출이 진행 중이면 그 결과를 따른다. 고른 패스키는 버린다.
            if(pending) return;
            pending = true;
            message = '';
            // 사용자가 직접 고른 패스키이므로 버튼 경로처럼 연결 오류를 알린다.
            try { await completePasskey(response, true); } catch { message = 'Unable to connect to the server.'; } finally { pending = false; }
        } catch {
            // 옵션을 받지 못하면 자동 완성 제안만 빠진다. 비밀번호 로그인은 그대로 쓸 수 있다.
        } finally {
            autofillRunning = false;
            if(refresh) void startAutofill();
        }
    };

    // 비밀번호 칸이 보이고 다른 요청이 없으면 자동 완성 요청을 건다. 버튼 요청이 끝나면 다시 건다.
    $effect(() => {
        if(autofillAvailable && showPassword && !passkeyRequired && ticket === '' && !bootstrapRequired && !pending && !signedIn) void tick().then(startAutofill);
    });

    // 2단계(TOTP)로 넘어가거나 첫 비밀번호를 정해야 하면 진행 중인 자동 완성 요청을 취소한다.
    $effect(() => {
        if(ticket !== '' || bootstrapRequired) WebAuthnAbortService.cancelCeremony();
    });

    onMount(() => {
        // 로그아웃 표시는 화면이 열릴 때마다 한 번 읽고 지운다.
        const justSignedOut = consumeSignedOut();
        if(passkeySupported) {
            void browserSupportsWebAuthnAutofill().then((supported) => { if(!destroyed) autofillAvailable = supported; });
        }
        if(passkeySupported && !showPassword && !justSignedOut) void passkeySignIn(true);
    });

    onDestroy(() => {
        destroyed = true;
        WebAuthnAbortService.cancelCeremony();
    });

    const submit = async (e: SubmitEvent) => {
        e.preventDefault();
        if(pending) return;
        if(password == '') {
            message = 'Please enter your password.';
            return;
        }
        pending = true;
        // 비워 두면 admin 으로 보낸다(UI 기본값. 서버에는 별칭이 없다).
        const effectiveUsername = username.trim() === '' ? 'admin' : username.trim();
        try {
            const result = await LoginCtrl.login(effectiveUsername, password, bootstrapToken || undefined);
            if(result.success && result.mfaRequired && result.mfaTicket) {
                // 비밀번호는 맞았다. 쿠키 없이 티켓만 왔으므로 코드 단계로 넘어간다.
                ticket = result.mfaTicket;
                // 2단계로 넘어가면 1단계 비밀번호는 더 쓰지 않는다. 처음부터 다시 할 때는 새로 입력한다.
                password = '';
                message = '';
                return;
            }
            if(result.success) {
                rememberUsername(effectiveUsername);
                signedIn = true;
                onsuccess({user: result.user, mustChangePassword: result.mustChangePassword === true});
                return;
            }
            if(result.status === 403 && result.code === 'passkey_required') {
                // 비밀번호 칸을 접고 패스키 로그인으로 안내한다. 입력한 비밀번호는 더 쓰지 않는다.
                password = '';
                message = '';
                passkeyRequired = true;
                return;
            }
            if(result.bootstrapRequired) bootstrapRequired = true;
            if(result.status === 429) {
                message = 'Too many login attempts. Please try again later.';
            } else if(result.invalidUsername) {
                message = 'Username must be 3-32 characters: a-z, 0-9, dot, underscore, hyphen.';
            } else if(result.weakPassword) {
                message = "The password must be 8 to 1024 characters long.";
            } else if(result.invalidBootstrapToken && bootstrapToken) {
                message = 'The bootstrap token is invalid. Check config/.bootstrap-token on the server.';
            } else if(result.bootstrapRequired) {
                message = bootstrapToken ? 'Unable to set the first password.' : 'Enter the bootstrap token to set the first password.';
            } else {
                message = result.message || 'The password is incorrect.';
            }
        } catch {
            message = 'Unable to connect to the server.';
        } finally {
            pending = false;
        }
    };
</script>

<main class="login">
    <Card class="login-card">
        <h1 class="login-title">Sign in</h1>
        {#if ticket === '' && passkeyRequired}
        <div class="login-passkey-first">
            {#if passkeySupported}
                <p id="login-passkey-required" role="status" style="margin: 0;">This account signs in with a passkey.</p>
                <span id="login-passkey"><Button variant="primary" disabled={pending} onclick={() => { void passkeySignIn(); }}>Sign in with a passkey</Button></span>
                <p id="login-passkey-hint" class="login-hint">Use the passkey on this device, your phone, or a security key.</p>
                <p id="login-passkey-lost" class="login-hint">Lost your passkey? Ask your administrator to reset your sign-in.</p>
            {:else}
                <p id="login-passkey-required" role="status" style="margin: 0;">This account signs in with a passkey, but passkeys aren't available at this address.</p>
                <p id="login-passkey-hint" class="login-hint">{PASSKEY_CONDITION} Open TTTGate at an address like that and sign in with your passkey.</p>
                <p id="login-passkey-lost" class="login-hint">If you can't, ask your administrator to reset your password and two-factor authentication.</p>
            {/if}
            <p id="login-message" role="alert" class="login-message">{message}</p>
            <button type="button" id="login-start-over" class="login-link" disabled={pending} onclick={useDifferentAccount}>Use a different account</button>
        </div>
        {:else if ticket === '' && !showPassword}
        <!-- 이슈 338: 패스키를 먼저 보이는 화면. 비밀번호 칸은 Use password 를 누르거나 패스키가 실패하면 편다. -->
        <div class="login-passkey-first">
            <span id="login-passkey"><Button variant="primary" disabled={pending} onclick={() => { void passkeySignIn(); }}>Sign in with a passkey</Button></span>
            <p id="login-passkey-hint" class="login-hint">{PASSKEY_CONDITION}</p>
            <p id="login-message" role="alert" class="login-message">{message}</p>
            <button type="button" id="login-use-password" class="login-link" disabled={pending && !autoRunning} onclick={() => { void usePassword(); }}>Use password</button>
        </div>
        {:else if ticket === ''}
        <form onsubmit={submit} novalidate>
            <Field label="Username" for="login-username" hint={bootstrapRequired ? 'Choose the first superuser name (default: admin)' : undefined}>
                <TextInput id="login-username" autocomplete={autofillAvailable && !bootstrapRequired ? 'username webauthn' : 'username'} bind:value={username} />
            </Field>
            <Field label="Password" for="login-password">
                <TextInput id="login-password" type="password" autocomplete="current-password" bind:value={password} />
            </Field>
            {#if bootstrapRequired}
                <Field label="Bootstrap token" for="bootstrap-token" hint="Read the token from config/.bootstrap-token on the server.">
                    <TextInput id="bootstrap-token" type="password" autocomplete="off" bind:value={bootstrapToken} />
                </Field>
            {/if}
            <p id="login-message" role="alert" class="login-message">{message}</p>
            <div class="login-actions"><Button type="submit" variant="primary" disabled={pending}>OK</Button></div>
        </form>
        {#if passkeySupported && !bootstrapRequired}
            <div class="login-passkey">
                <span id="login-passkey"><Button disabled={pending} onclick={() => { void passkeySignIn(); }}>Sign in with a passkey</Button></span>
                <p id="login-passkey-hint" class="login-hint">{PASSKEY_CONDITION}</p>
            </div>
        {/if}
        {:else}
        <form onsubmit={verify} novalidate>
            <p id="login-mfa-hint">{useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.'}</p>
            {#if useRecovery}
                <Field label="Recovery code" for="login-recovery-code">
                    <TextInput id="login-recovery-code" autocomplete="off" bind:value={recoveryCode} />
                </Field>
                <button type="button" id="login-use-code" disabled={pending} style="align-self: flex-start; padding: 0; border: 0; background: none; color: var(--ink-2); font: inherit; font-size: var(--fs-sm); text-decoration: underline; cursor: pointer;" onclick={() => { useRecovery = false; recoveryCode = ''; message = ''; }}>Use the authenticator app instead</button>
            {:else}
                <Field label="Code" for="login-mfa-code">
                    <!-- 6자리 제한은 입력 때 자른다(TextInput 계약에 maxlength 가 없다). 앞자리 0 을 지키려고 text 를 쓴다. -->
                    <TextInput id="login-mfa-code" inputmode="numeric" autocomplete="one-time-code" bind:value={code}
                        oninput={(v) => (code = v.replace(/\D/g, '').slice(0, 6))} />
                </Field>
                <button type="button" id="login-use-recovery" disabled={pending} style="align-self: flex-start; padding: 0; border: 0; background: none; color: var(--ink-2); font: inherit; font-size: var(--fs-sm); text-decoration: underline; cursor: pointer;" onclick={() => { useRecovery = true; code = ''; message = ''; }}>Use a recovery code instead</button>
            {/if}
            <p id="login-message" role="alert" class="login-message">{message}</p>
            <div class="login-actions">
                <button type="button" id="login-mfa-back" disabled={pending} style="align-self: flex-start; padding: 0; border: 0; background: none; color: var(--ink-2); font: inherit; font-size: var(--fs-sm); text-decoration: underline; cursor: pointer;" onclick={() => startOver()}>Start over</button>
                <span id="login-mfa-submit"><Button type="submit" variant="primary" disabled={pending}>Verify</Button></span>
            </div>
        </form>
        {/if}
    </Card>
</main>

<style>
    .login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: var(--s-4); }
    /* Card 가 그리는 요소이므로 :global 로 짚는다. 스코프 선택자로는 닿지 않는다. */
    .login :global(.login-card) { width: 100%; max-width: 400px; }
    .login-title { font-family: var(--ff-display); font-size: var(--fs-2xl); margin: 0 0 var(--s-5); }
    form { display: flex; flex-direction: column; gap: var(--s-4); }
    .login-message { min-height: 1.5em; margin: 0; color: var(--alarm); font-size: var(--fs-sm); }
    .login-actions { display: flex; justify-content: flex-end; align-items: center; gap: var(--s-3); }
    .login-passkey { display: flex; flex-direction: column; align-items: stretch; gap: var(--s-2); margin-top: var(--s-5);
        padding-top: var(--s-4); border-top: 1px solid var(--line-0); }
    .login-hint { margin: 0; color: var(--ink-2); font-size: var(--fs-sm); }
    .login-passkey-first { display: flex; flex-direction: column; align-items: stretch; gap: var(--s-3); }
    .login-passkey-first :global(button:not(.login-link)) { width: 100%; }
    .login-link { align-self: center; padding: var(--s-2); border: 0; background: none; color: var(--ink-2); font: inherit; font-size: var(--fs-md); cursor: pointer; }
</style>
