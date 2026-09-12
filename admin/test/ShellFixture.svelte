<script lang="ts">
    import '../src/app.css';
    import Shell from '../src/shell/Shell.svelte';
    import {chrome} from '../src/shell/nav';
    import {route} from '../src/router';

    const current = $derived(chrome($route));
</script>

<Shell title={current.title} back={current.back}>
    <p id="screen">{$route.screen}{$route.param ? ':' + $route.param : ''}</p>
</Shell>
