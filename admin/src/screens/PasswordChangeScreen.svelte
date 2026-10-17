<script lang="ts">
    import InvalidSession from '../controller/InvalidSession';
    import MeCtrl from '../controller/MeCtrl';
    import Button from '../ui/Button.svelte';
    import Field from '../ui/Field.svelte';
    import TextInput from '../ui/TextInput.svelte';
    import {toast} from '../ui/toast';
    import {loadMe, me} from '../me';
    import {navigate} from '../router';
    import {defaultHash} from '../shell/nav';
    import {signOut, useSession} from '../shell/session';

    // U3-02: #/me/password. 임시 비밀번호 상태(forced)면 App 이 이 화면에 고정하고 메뉴·뒤로 가기를 숨긴다.
    const session = useSession();

    const forced = $derived($me?.user.mustChangePassword === true);

    let current = $state('');
    let next = $state('');
    let confirm = $state('');
    let errors = $state<{current?: string; next?: string; confirm?: string}>({});
    let message = $state('');
    let pending = $state(false);

    /** 순서대로 검사해 첫 오류 하나만 돌려준다. */
    const validate = (): {current?: string; next?: string; confirm?: string} => {
        if(current === '') return {current: 'Enter your current password.'};
        if(next.length < 8) return {next: 'Use at least 8 characters.'};
        if(next === current) return {next: 'Choose a password different from the current one.'};
        if(confirm !== next) return {confirm: 'Passwords do not match.'};
        return {};
    };

    const submit = async (e: SubmitEvent) => {
        e.preventDefault();
        if(pending) return;
        errors = validate();
        message = '';
        if(Object.keys(errors).length > 0) return;
        const wasForced = forced;
        pending = true;
        // 상태 코드로 분기하지 않는다. 세션이 끝났으면(InvalidSession) 다른 화면과 같이 세션 무효화로 로그인 화면에 간다.
        try {
            const result = await MeCtrl.instance.changePassword(current, next);
            if(!result.success) {
                message = result.message ?? '';
                return;
            }
            const principal = await loadMe();
            if(!principal) {
                // 비밀번호는 이미 바뀌었다. 계정 정보를 다시 읽지 못했으므로 이동하지 않고 알린다.
                message = 'Password changed, but the account could not be reloaded. Reload the page.';
                return;
            }
            if(wasForced) {
                navigate(defaultHash(principal.sections));
            } else {
                toast.push({tone: 'pulse', message: 'Password changed.'});
                navigate('#/me');
            }
        } catch(error) {
            // adminRequest 는 네트워크 오류를 실패 값으로 돌려준다. 여기에는 InvalidSession 과 예상하지 못한 예외만 온다.
            if(error instanceof InvalidSession) session.invalidate();
            else message = 'Unable to connect to the server.';
        } finally {
            pending = false;
        }
    };
</script>

<div style="display: flex; flex-direction: column; gap: var(--s-4);">
    {#if forced}
        <p id="pw-forced-note">Set a new password before continuing.</p>
    {/if}
    <form onsubmit={submit} novalidate style="display: flex; flex-direction: column; gap: var(--s-4);">
        <Field label={forced ? 'Temporary password' : 'Current password'} for="pw-current" error={errors.current}>
            <TextInput id="pw-current" type="password" autocomplete="current-password" invalid={errors.current !== undefined} bind:value={current} />
        </Field>
        <Field label="New password" hint="At least 8 characters." for="pw-new" error={errors.next}>
            <TextInput id="pw-new" type="password" autocomplete="new-password" invalid={errors.next !== undefined} bind:value={next} />
        </Field>
        <Field label="Confirm new password" for="pw-confirm" error={errors.confirm}>
            <TextInput id="pw-confirm" type="password" autocomplete="new-password" invalid={errors.confirm !== undefined} bind:value={confirm} />
        </Field>
        {#if message}
            <p id="pw-message" role="alert">{message}</p>
        {/if}
        <div><Button variant="primary" type="submit" disabled={pending}>Change password</Button></div>
    </form>
    {#if forced}
        <!-- 강제 변경 중에는 드로어가 숨겨지므로 이 버튼이 유일한 탈출구다. 드로어의 Sign out 과 같은 경로다. -->
        <div><Button variant="ghost" onclick={() => { void signOut(session); }}>Sign out</Button></div>
    {/if}
</div>
