<script lang="ts">
  import {onMount} from "svelte";
  import LoginCtrl from "./controller/LoginCtrl";
  import InvalidSession from "./controller/InvalidSession";
  import LoginScreen from "./screens/LoginScreen.svelte";
  import StatusScreen from "./screens/StatusScreen.svelte";
  import ServerSettingsScreen from "./screens/ServerSettingsScreen.svelte";
  import TunnelsScreen from "./screens/TunnelsScreen.svelte";
  import TunnelEditScreen from "./screens/TunnelEditScreen.svelte";
  import Loading from "./ui/Loading.svelte";
  import Button from "./ui/Button.svelte";
  import Shell from "./shell/Shell.svelte";
  import {provideSession, signOut} from "./shell/session";
  import {chrome} from "./shell/nav";
  import {navigate, route} from "./router";
  import {clearMe, loadMe, me} from "./me";

  type SessionState = 'Checking' | 'Valid' | 'Invalid' | 'Offline';

  let state = $state<SessionState>('Checking');

  const session = {invalidate() { clearMe(); state = 'Invalid'; }};
  provideSession(session);

  // U2-10: 'Valid' 에 들어가면 /api/me 를 읽는다. 읽기 전에는 Loading 이다.
  // 401 은 InvalidSession(→ 'Invalid'), 네트워크 오류 등은 validateSession 실패와 같은 'Offline' 으로 모은다.
  const enterValid = async (): Promise<void> => {
    clearMe();
    state = 'Valid';
    try {
      if(!(await loadMe())) state = 'Offline';
    } catch(error) {
      state = error instanceof InvalidSession ? 'Invalid' : 'Offline';
    }
  };

  onMount(async () => {
    let valid: boolean;
    try { valid = await LoginCtrl.validateSession(); }
    catch { state = 'Offline'; return; }
    if(valid) await enterValid();
    else state = 'Invalid';
  });

  $effect(() => { if(state === 'Valid' && $me && location.hash === '') navigate('#/status'); });

  const current = $derived(chrome($route));
</script>

{#if state === 'Checking'}
  <Loading overlay />
{:else if state === 'Offline'}
  <p class="offline">Offline server...</p>
{:else if state === 'Invalid'}
  <LoginScreen onsuccess={() => { void enterValid(); }} />
{:else if !$me}
  <Loading overlay />
{:else if $me.user.mustChangePassword}
  <!-- 3 단위(U3-01)가 비밀번호 변경 화면으로 대체한다. -->
  <main class="password-change">
    <p role="alert" id="password-change-required">Password change required. Use the API or wait for the account screen.</p>
    <Button id="password-change-sign-out" variant="ghost" onclick={() => { void signOut(session); }}>Sign out</Button>
  </main>
{:else}
  <Shell title={current.title} back={current.back}>
    {#if $route.screen === 'status'}<StatusScreen />
    {:else if $route.screen === 'tunnels'}<TunnelsScreen />
    {:else if $route.screen === 'tunnel-edit'}{#key $route.param}<TunnelEditScreen param={$route.param ?? 'new'} />{/key}
    {:else}<ServerSettingsScreen />{/if}
  </Shell>
{/if}

<style>
  .offline { padding: var(--s-6); color: var(--ink-2); }
  .password-change { padding: var(--s-6); display: flex; flex-direction: column; gap: var(--s-4); align-items: flex-start; }
</style>
