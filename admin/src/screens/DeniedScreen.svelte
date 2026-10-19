<script lang="ts">
    import Button from '../ui/Button.svelte';
    import {me} from '../me';
    import {navigate} from '../router';
    import {defaultHash, visibleNav} from '../shell/nav';
</script>

<!-- U3-01: 권한이 없는 해시로 온 사용자에게 보인다. 서버에 알리지 않는다(403 은 서버가 기록한다). -->
<div style="display: flex; flex-direction: column; align-items: flex-start; gap: var(--s-4);">
    <p id="denied-message">You don't have access to this page.</p>
    <!-- 갈 수 있는 화면이 하나도 없으면 버튼이 #/denied 로 되돌아오므로 대신 안내만 보인다. -->
    {#if $me && visibleNav($me.sections).length > 0}
        <Button variant="primary" onclick={() => { if($me) navigate(defaultHash($me.sections)); }}>Go to my tunnels</Button>
    {:else}
        <p id="denied-help">No page is available to this account. Ask an administrator for access, or sign out.</p>
    {/if}
</div>
