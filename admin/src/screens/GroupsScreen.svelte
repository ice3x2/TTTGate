<script lang="ts">
    import {onMount} from 'svelte';
    import GroupsCtrl from '../controller/GroupsCtrl';
    import InvalidSession from '../controller/InvalidSession';
    import {DEFAULT_GROUP_ATTRIBUTES, type Group} from '../controller/Types';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Chip from '../ui/Chip.svelte';
    import {toast} from '../ui/toast';
    import {navigate} from '../router';
    import {useSession} from '../shell/session';
    import {summarizeAttributes} from './parts/groupSummary';

    // U3-04: #/groups. 카드 목록이며 이동은 <a href> 기본 동작이다.
    const session = useSession();

    let groups = $state<Array<Group & {memberCount: number}>>([]);

    onMount(async () => {
        try {
            const result = await GroupsCtrl.instance.list();
            if(result.success) groups = result.groups;
            else toast.push({tone: 'alarm', message: result.message});
        } catch(error) {
            // adminRequest 는 네트워크 오류를 실패 값으로 돌려준다. 여기에는 InvalidSession 과 예상하지 못한 예외만 온다.
            if(error instanceof InvalidSession) session.invalidate();
            else toast.push({tone: 'alarm', message: 'Unable to connect to the server.'});
        }
    });
</script>

<div style="display: flex; flex-direction: column; gap: var(--s-4);">
    <div><Button variant="primary" onclick={() => navigate('#/groups/new')}>Add group</Button></div>
    <ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-3);">
        {#each groups as group (group.id)}
            <li data-group-id={group.id}>
                <Card compact>
                    <a href={'#/groups/' + group.id} style="display: block; color: inherit; text-decoration: none;">
                        <div style="display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center;">
                            <span>{group.name}</span>
                            {#if group.system}<Chip>system</Chip>{/if}
                            <span class="mono">Members: {group.memberCount}</span>
                        </div>
                        <div class="mono" style="margin-top: var(--s-1); color: var(--ink-2);">
                            {group.id === 'system:superuser' ? 'Superusers are not limited by attributes.' : summarizeAttributes({...DEFAULT_GROUP_ATTRIBUTES, ...group.attributes})}
                        </div>
                    </a>
                </Card>
            </li>
        {/each}
    </ul>
</div>
