<script lang="ts">
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Chip from '../ui/Chip.svelte';
    import {me} from '../me';
    import {navigate} from '../router';

    // U3-05: #/me. me 스토어만 읽는다(API 를 다시 부르지 않는다). MFA·세션 카드는 4 단위가 더한다.
</script>

{#if $me}
    <div style="display: flex; flex-direction: column; gap: var(--s-4); align-items: flex-start;">
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
        <Button variant="primary" onclick={() => navigate('#/me/password')}>Change password</Button>
    </div>
{/if}
