<script lang="ts">
    import Button from '../../ui/Button.svelte';
    import Modal from '../../ui/Modal.svelte';
    import {t} from '../../i18n';

    // U3-03: 임시 비밀번호를 한 번만 보여 준다. 닫히는 모든 경로(Done, Escape)에서 ondone 을 한 번 부르고,
    // 부모는 ondone 에서 비밀번호를 지운다. 비밀번호는 어디에도 남기지 않는다.
    let {
        open = $bindable(false),
        username,
        password,
        ondone,
        secondFactorsReset = false,
    }: {
        open?: boolean;
        username: string;
        password: string;
        ondone: () => void;
        /** 이슈 346: 비밀번호와 함께 2단계 인증·패스키도 초기화했다. */
        secondFactorsReset?: boolean;
    } = $props();

    let wasOpen = false;
    $effect(() => {
        if(open) {
            wasOpen = true;
        } else if(wasOpen) {
            wasOpen = false;
            ondone();
        }
    });

    const copy = () => {
        // 보안 컨텍스트가 아니면 clipboard 가 없다. 실패해도 화면은 바꾸지 않는다.
        navigator.clipboard?.writeText(password)?.catch(() => {});
    };
</script>

<Modal bind:open title={t('user.tempPassword')} closeOnOverlay={false}>
    <p id="temp-password-username" class="mono">@{username}</p>
    <p id="temp-password-value" class="mono" style="font-size: var(--fs-2xl)">{password}</p>
    <p>{t('tempPassword.shownOnce')}</p>
    {#if secondFactorsReset}
        <p id="temp-password-second-factors">{t('tempPassword.secondFactorsReset')}</p>
    {/if}
    {#snippet footer()}
        <Button onclick={copy}>{t('common.copy')}</Button>
        <Button variant="primary" onclick={() => (open = false)}>{t('common.done')}</Button>
    {/snippet}
</Modal>
