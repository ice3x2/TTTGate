<script lang="ts">
    import Button from '../../ui/Button.svelte';
    import Modal from '../../ui/Modal.svelte';

    // U3-03: 임시 비밀번호를 한 번만 보여 준다. 닫히는 모든 경로(Done, Escape)에서 ondone 을 한 번 부르고,
    // 부모는 ondone 에서 비밀번호를 지운다. 비밀번호는 어디에도 남기지 않는다.
    let {
        open = $bindable(false),
        username,
        password,
        ondone,
    }: {
        open?: boolean;
        username: string;
        password: string;
        ondone: () => void;
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

<Modal bind:open title="Temporary password" closeOnOverlay={false}>
    <p id="temp-password-username" class="mono">@{username}</p>
    <p id="temp-password-value" class="mono" style="font-size: var(--fs-2xl)">{password}</p>
    <p>This password is shown only once. Send it to the user through a channel you trust.</p>
    {#snippet footer()}
        <Button onclick={copy}>Copy</Button>
        <Button variant="primary" onclick={() => (open = false)}>Done</Button>
    {/snippet}
</Modal>
