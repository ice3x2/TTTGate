<script lang="ts">
    import LoginCtrl, {type LoginUser} from '../controller/LoginCtrl';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Field from '../ui/Field.svelte';
    import TextInput from '../ui/TextInput.svelte';

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
                message = '';
                return;
            }
            if(result.success) {
                rememberUsername(effectiveUsername);
                onsuccess({user: result.user, mustChangePassword: result.mustChangePassword === true});
                return;
            }
            if(result.bootstrapRequired) bootstrapRequired = true;
            if(result.status === 429) {
                message = 'Too many login attempts. Please try again later.';
            } else if(result.invalidUsername) {
                message = 'Username must be 3-32 characters: a-z, 0-9, dot, underscore, hyphen.';
            } else if(result.weakPassword) {
                message = "The password does not meet the server's minimum length.";
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
        {#if ticket === ''}
        <form onsubmit={submit} novalidate>
            <Field label="Username" for="login-username" hint={bootstrapRequired ? 'Choose the first superuser name (default: admin)' : undefined}>
                <TextInput id="login-username" autocomplete="username" bind:value={username} />
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
</style>
