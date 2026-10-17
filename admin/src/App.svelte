<script lang="ts">
  import {onMount} from "svelte";
  import LoginCtrl from "./controller/LoginCtrl";
  import InvalidSession from "./controller/InvalidSession";
  import LoginScreen from "./screens/LoginScreen.svelte";
  import StatusScreen from "./screens/StatusScreen.svelte";
  import ServerSettingsScreen from "./screens/ServerSettingsScreen.svelte";
  import TunnelsScreen from "./screens/TunnelsScreen.svelte";
  import TunnelEditScreen from "./screens/TunnelEditScreen.svelte";
  import DeniedScreen from "./screens/DeniedScreen.svelte";
  import Loading from "./ui/Loading.svelte";
  import Button from "./ui/Button.svelte";
  import Shell from "./shell/Shell.svelte";
  import {provideSession, signOut} from "./shell/session";
  import {chrome, defaultHash, SECTION_OF_SCREEN} from "./shell/nav";
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
  // 위 '#/status' 는 라우터 기본값이므로, 권한이 없으면 아래 가드가 기본 화면으로 바꾼다(여기서 바로 바꾸면 가드가 직접 고른 해시로 본다).

  // 권한 판정이 끝나기 전에는 화면을 마운트하지 않는다. 가드의 navigate 는 hashchange 를 기다리므로,
  // 그 사이 권한 없는 화면의 onMount 가 API 를 부르면 403 과 access_denied 감사가 쌓인다.
  const allowed = $derived.by(() => {
    const section = SECTION_OF_SCREEN[$route.screen];
    return $me !== undefined && (section === null || $me.sections.includes(section));
  });

  // U3-01 라우트 가드. 권한 없는 섹션이면 라우터 기본값(#/status 류)은 기본 화면으로, 직접 고른 해시는 #/denied 로 보낸다.
  // 강제 비밀번호 변경 흐름은 U3-02 가 맡으므로 여기서는 손대지 않는다.
  $effect(() => {
    const principal = $me;
    if(state !== 'Valid' || !principal || principal.user.mustChangePassword || allowed) return;
    const raw = location.hash;
    if(raw === '' || raw === '#' || raw === '#/' || raw === '#/status') navigate(defaultHash(principal.sections));
    else navigate('#/denied');
  });

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
    {#if !allowed}<Loading />
    {:else if $route.screen === 'status'}<StatusScreen />
    {:else if $route.screen === 'tunnels'}<TunnelsScreen />
    {:else if $route.screen === 'tunnel-edit'}{#key $route.param}<TunnelEditScreen param={$route.param ?? 'new'} />{/key}
    {:else if $route.screen === 'server'}<ServerSettingsScreen />
    {:else if $route.screen === 'denied'}<DeniedScreen />
    {:else}
      <!-- U3-03~05 와 U3-02 가 users·groups·me·me-password 화면으로 교체한다. -->
      <p id="screen-placeholder">This screen is not available yet.</p>
    {/if}
  </Shell>
{/if}

<style>
  .offline { padding: var(--s-6); color: var(--ink-2); }
  .password-change { padding: var(--s-6); display: flex; flex-direction: column; gap: var(--s-4); align-items: flex-start; }
</style>
