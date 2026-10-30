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
  import PasswordChangeScreen from "./screens/PasswordChangeScreen.svelte";
  import UsersScreen from "./screens/UsersScreen.svelte";
  import UserEditScreen from "./screens/UserEditScreen.svelte";
  import GroupsScreen from "./screens/GroupsScreen.svelte";
  import GroupEditScreen from "./screens/GroupEditScreen.svelte";
  import MeScreen from "./screens/MeScreen.svelte";
  import AuditScreen from "./screens/AuditScreen.svelte";
  import SessionsScreen from "./screens/SessionsScreen.svelte";
  import SecurityScreen from "./screens/SecurityScreen.svelte";
  import TrustedClientsScreen from "./screens/TrustedClientsScreen.svelte";
  import MeCtrl from "./controller/MeCtrl";
  import Loading from "./ui/Loading.svelte";
  import Banner from "./ui/Banner.svelte";
  import {toast} from "./ui/toast";
  import Shell from "./shell/Shell.svelte";
  import {provideSession} from "./shell/session";
  import ServerOptionCtrl from "./controller/ServerOptionCtrl";
  import {chrome, defaultHash, SECTION_OF_SCREEN} from "./shell/nav";
  import {navigate, route} from "./router";
  import {clearMe, loadMe, me} from "./me";

  type SessionState = 'Checking' | 'Valid' | 'Invalid' | 'Offline';

  let state = $state<SessionState>('Checking');

  // 세션이 끝나면 서버 옵션 캐시(비밀값 포함)도 비운다.
  const session = {invalidate() { clearMe(); ServerOptionCtrl.instance.clearCache(); state = 'Invalid'; }};
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
  // 강제 비밀번호 변경 중에는 #/me/password 만 그린다(다른 화면은 서버가 403 으로 막는다).
  const forced = $derived($me?.user.mustChangePassword === true);
  // U4-09: MFA 강제 등록 중인 슈퍼유저는 #/me 와 #/me/password 만 쓴다(비밀번호 변경은 허용 액션이다).
  const enrolling = $derived(!forced && $me?.mustEnrollMfa === true);
  const allowed = $derived.by(() => {
    if($me === undefined) return false;
    if(forced) return $route.screen === 'me-password';
    if(enrolling) return $route.screen === 'me' || $route.screen === 'me-password';
    const section = SECTION_OF_SCREEN[$route.screen];
    return section === null || $me.sections.includes(section);
  });

  // U3-01 라우트 가드. 권한 없는 섹션이면 라우터 기본값(#/status 류)은 기본 화면으로, 직접 고른 해시는 #/denied 로 보낸다.
  // U3-02: 강제 비밀번호 변경 중이면 어떤 해시든 #/me/password 로 고정하고 다음 단계로 가지 않는다.
  $effect(() => {
    const principal = $me;
    if(state !== 'Valid' || !principal) return;
    if(forced) {
      if($route.screen !== 'me-password' || location.hash !== '#/me/password') navigate('#/me/password');
      return;
    }
    if(enrolling) {
      if($route.screen !== 'me' && $route.screen !== 'me-password') navigate('#/me');
      return;
    }
    if(allowed) return;
    const raw = location.hash;
    if(raw === '' || raw === '#' || raw === '#/' || raw === '#/status') navigate(defaultHash(principal.sections));
    else navigate('#/denied');
  });

  // U4-06: chrome() 은 역할을 모른다. 일반 유저의 감사 화면 제목만 여기서 덮는다.
  const current = $derived($route.screen === 'audit' && $me?.user.role === 'regular' ? {title: 'My activity'} : chrome($route));

  // U3-02: 마이그레이션 안내 배너를 닫는다. 성공하면 me 를 다시 읽어 migrationBanner 가 false 가 된다.
  const dismissMigration = async (): Promise<void> => {
    try {
      const result = await MeCtrl.instance.acknowledgeMigration();
      if(!result.success) toast.push({tone: 'alarm', message: result.message});
      else if(!(await loadMe())) toast.push({tone: 'alarm', message: 'Unable to refresh the account. Reload the page.'});
    } catch(error) {
      // adminRequest 는 네트워크 오류를 실패 값으로 돌려준다. 여기에는 InvalidSession 과 예상하지 못한 예외만 온다.
      if(error instanceof InvalidSession) session.invalidate();
      else toast.push({tone: 'alarm', message: 'Unable to connect to the server.'});
    }
  };
</script>

{#if state === 'Checking'}
  <Loading overlay />
{:else if state === 'Offline'}
  <p class="offline">Offline server...</p>
{:else if state === 'Invalid'}
  <LoginScreen onsuccess={() => { void enterValid(); }} />
{:else if !$me}
  <Loading overlay />
{:else}
  <Shell title={current.title} back={forced ? undefined : current.back} hideMenu={forced || enrolling}>
    {#snippet banner()}
      {#if $me?.migrationBanner}
        <Banner tone="trace" dismissible ondismiss={() => { void dismissMigration(); }}>Your account was promoted to superuser during the upgrade.</Banner>
      {/if}
    {/snippet}
    {#if !allowed}<Loading />
    {:else if $route.screen === 'status'}<StatusScreen />
    {:else if $route.screen === 'tunnels'}<TunnelsScreen />
    {:else if $route.screen === 'tunnel-edit'}{#key $route.param}<TunnelEditScreen param={$route.param ?? 'new'} />{/key}
    {:else if $route.screen === 'server'}<ServerSettingsScreen />
    {:else if $route.screen === 'denied'}<DeniedScreen />
    {:else if $route.screen === 'me-password'}<PasswordChangeScreen />
    {:else if $route.screen === 'users'}<UsersScreen />
    {:else if $route.screen === 'user-edit'}{#key $route.param}<UserEditScreen param={$route.param ?? 'new'} />{/key}
    {:else if $route.screen === 'groups'}<GroupsScreen />
    {:else if $route.screen === 'group-edit'}{#key $route.param}<GroupEditScreen param={$route.param ?? 'new'} />{/key}
    {:else if $route.screen === 'me'}<MeScreen />
    {:else if $route.screen === 'audit'}<AuditScreen />
    {:else if $route.screen === 'sessions'}<SessionsScreen />
    {:else if $route.screen === 'security'}<SecurityScreen />
    {:else if $route.screen === 'clients'}<TrustedClientsScreen />
    {:else}
      <p id="screen-placeholder">This screen is not available yet.</p>
    {/if}
  </Shell>
{/if}

<style>
  .offline { padding: var(--s-6); color: var(--ink-2); }
</style>
