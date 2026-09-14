<script lang="ts">
    import LoginCtrl from '../controller/LoginCtrl';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Field from '../ui/Field.svelte';
    import TextInput from '../ui/TextInput.svelte';

    let {onsuccess}: {onsuccess: () => void} = $props();

    let password = $state('');
    let bootstrapToken = $state('');
    let bootstrapRequired = $state(false);
    let message = $state('');
    let pending = $state(false);

    const submit = async (e: SubmitEvent) => {
        e.preventDefault();
        if(pending) return;
        if(password == '') {
            message = 'Please enter your password.';
            return;
        }
        pending = true;
        try {
            const result = await LoginCtrl.login(password, bootstrapToken || undefined);
            if(result.success) {
                onsuccess();
                return;
            }
            if(result.bootstrapRequired) bootstrapRequired = true;
            if(result.status === 429) {
                message = 'Too many login attempts. Please try again later.';
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
        <form onsubmit={submit} novalidate>
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
    </Card>
</main>

<style>
    .login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: var(--s-4); }
    /* Card 가 그리는 요소이므로 :global 로 짚는다. 스코프 선택자로는 닿지 않는다. */
    .login :global(.login-card) { width: 100%; max-width: 400px; }
    .login-title { font-family: var(--ff-display); font-size: var(--fs-2xl); margin: 0 0 var(--s-5); }
    form { display: flex; flex-direction: column; gap: var(--s-4); }
    .login-message { min-height: 1.5em; margin: 0; color: var(--alarm); font-size: var(--fs-sm); }
    .login-actions { display: flex; justify-content: flex-end; }
</style>
