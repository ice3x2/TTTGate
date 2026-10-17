<script lang="ts">
    import {onMount} from 'svelte';
    import InvalidSession from '../controller/InvalidSession';
    import UsersCtrl from '../controller/UsersCtrl';
    import type {UserView} from '../controller/Types';
    import Badge from '../ui/Badge.svelte';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Chip from '../ui/Chip.svelte';
    import TextInput from '../ui/TextInput.svelte';
    import {toast} from '../ui/toast';
    import {navigate} from '../router';
    import {useSession} from '../shell/session';

    // U3-03: #/users. 카드 목록과 클라이언트 필터. 카드 이동은 <a href> 기본 동작이다.
    const session = useSession();

    let users = $state<UserView[]>([]);
    // 첫 응답 전에는 빈 목록 문구를 보이지 않는다.
    let loaded = $state(false);
    let filter = $state('');

    const visible = $derived.by(() => {
        const query = filter.trim().toLowerCase();
        if(query === '') return users;
        return users.filter((user) => [user.username, user.displayName, user.groupName]
            .some((value) => value.toLowerCase().includes(query)));
    });

    onMount(async () => {
        try {
            const result = await UsersCtrl.instance.list();
            if(result.success) users = result.users;
            else toast.push({tone: 'alarm', message: result.message});
            loaded = true;
        } catch(error) {
            // adminRequest 는 네트워크 오류를 실패 값으로 돌려준다. 여기에는 InvalidSession 과 예상하지 못한 예외만 온다.
            if(error instanceof InvalidSession) session.invalidate();
            else toast.push({tone: 'alarm', message: 'Unable to connect to the server.'});
        }
    });
</script>

<div style="display: flex; flex-direction: column; gap: var(--s-4);">
    <div style="display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between;">
        <Button variant="primary" onclick={() => navigate('#/users/new')}>Add user</Button>
        <TextInput id="users-filter" placeholder="Filter by name or group" bind:value={filter} />
    </div>
    {#if loaded && visible.length === 0}
        <p style="color: var(--ink-2);">No users match.</p>
    {/if}
    <ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-3);">
        {#each visible as user (user.id)}
            <li data-user-id={user.id}>
                <Card compact>
                    <a href={'#/users/' + user.id} style="display: block; color: inherit; text-decoration: none;">
                        <div style="display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center;">
                            <span>{user.displayName}</span>
                            <Chip tone={user.role === 'superuser' ? 'signal' : 'neutral'}>{user.role}</Chip>
                            <Badge tone={user.status === 'active' ? 'pulse' : 'alarm'}>{user.status}</Badge>
                            {#if user.mustChangePassword}<Chip tone="warn">temp password</Chip>{/if}
                        </div>
                        <div class="mono" style="margin-top: var(--s-1); color: var(--ink-2);">@{user.username} · {user.groupName}</div>
                    </a>
                </Card>
            </li>
        {/each}
    </ul>
</div>
