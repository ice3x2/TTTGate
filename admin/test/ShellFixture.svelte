<script lang="ts">
    import '../src/app.css';
    import Shell from '../src/shell/Shell.svelte';
    import {chrome} from '../src/shell/nav';
    import {route} from '../src/router';
    import {me} from '../src/me';

    // #102 (U2-10): 드로어가 me.sections 로 항목을 거르므로 계약 fixture 는 세 섹션을 다 보는 주체를 둔다.
    me.set({
        user: {id: 'u_fixture', username: 'admin', displayName: 'admin', role: 'superuser', status: 'active',
            groupId: 'g_superusers', groupName: 'Superusers', mustChangePassword: false, migratedFromLegacyAdmin: false,
            createdAt: 0, updatedAt: 0},
        group: {id: 'g_superusers', name: 'Superusers', attributes: {}},
        sections: ['status', 'tunnels', 'server'],
        migrationBanner: false
    });

    const current = $derived(chrome($route));
</script>

<Shell title={current.title} back={current.back}>
    <p id="screen">{$route.screen}{$route.param ? ':' + $route.param : ''}</p>
</Shell>
