<script lang="ts">
  import {onMount} from "svelte";
  import LoginCtrl from "./controller/LoginCtrl";
  import LoginScreen from "./screens/LoginScreen.svelte";
  import ServerSetLayout from "./layout/ServerSetLayout.svelte";
  import ServerStatusLayout from "./layout/ServerStatusLayout.svelte";
  import TunnelOptionSetLayout from "./layout/TunnelOptionSetLayout.svelte";
  import Loading from "./ui/Loading.svelte";
  import Shell from "./shell/Shell.svelte";
  import {provideSession} from "./shell/session";
  import {chrome} from "./shell/nav";
  import {navigate, route} from "./router";

  type SessionState = 'Checking' | 'Valid' | 'Invalid' | 'Offline';

  let state = $state<SessionState>('Checking');

  provideSession({invalidate() { state = 'Invalid'; }});

  onMount(async () => {
    try { state = (await LoginCtrl.validateSession()) ? 'Valid' : 'Invalid'; }
    catch { state = 'Offline'; }
  });

  $effect(() => { if(state === 'Valid' && location.hash === '') navigate('#/status'); });

  const current = $derived(chrome($route));
</script>

{#if state === 'Checking'}
  <Loading overlay />
{:else if state === 'Offline'}
  <p class="offline">Offline server...</p>
{:else if state === 'Invalid'}
  <LoginScreen onsuccess={() => (state = 'Valid')} />
{:else}
  <Shell title={current.title} back={current.back}>
    {#if $route.screen === 'status'}<ServerStatusLayout />
    {:else if $route.screen === 'tunnels' || $route.screen === 'tunnel-edit'}<TunnelOptionSetLayout />
    {:else}<ServerSetLayout />{/if}
  </Shell>
{/if}

<style>
  .offline { padding: var(--s-6); color: var(--ink-2); }
</style>
