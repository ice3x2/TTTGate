# 단위 3 이슈 초안 — RBAC 관리 화면

근거: [단위 3 설계](../2026-09-11-unit3-rbac-screens.md), [단위 1 설계](../2026-09-11-unit1-admin-ui-shell.md), [단위 2 설계](../2026-09-11-unit2-rbac-model-api.md), [프로그램 개요](../2026-09-11-program-overview.md), [PRD](../../plan/prd/TTTGate-admin-rbac.md)

## 단위 3 공통 참고 (설계 문서와 다른 점)

- 단위 1·2 이슈 ID 는 각 단위 설계 문서의 "이슈 분할" 표(단위 2 는 §9, U2-01~U2-10, UI 로그인이 U2-10)를 따랐다. `issues/unit1.md`·`issues/unit2.md` 의 번호가 이와 다르면 등록 전에 이 파일의 선행 ID 를 그쪽에 맞춘다.
- 단위 1 설계 §6 의 `Banner` 는 §9 의 분할 표에 없지만 `issues/unit1.md` 의 U1-03 이 만든다. U3-02 는 그것을 쓴다.
- `startAdminApp` 은 설계 §5 의 `loginAs` 대신 U2-10 가 이미 만든 `login: {username, password}` 옵션을 그대로 쓴다(진입점 하나). 비밀번호는 `RBAC_PASSWORDS` 에서 가져온다. 로그인 완료 판정은 `#/status` 대기에서 Shell 제목 대기로 바뀐다.
- 설계 §6 U3-01 의 "터널 4개" 는 §5 가 나열한 20001·20002·20003 세 개로 확정했다.
- 화면별 title/back 은 설계 §3 표대로지만, `App.svelte` 가 아니라 U1-04 의 `nav.ts` `chrome()` 표를 확장해 둔다.
- `defaultHash` 는 "NAV 순서로 첫 허용 항목" 이다. 4 단위가 Audit log 항목을 NAV 에 넣으면 `sections` 가 `['audit','me']` 인 유저의 기본 화면은 `#/audit` 가 된다(설계 §3 은 "`tunnels` 가 없으면 `me`").
- 그룹 편집의 422 표시는 카드별 `Field error` 대신 "Tunnel permissions" 카드 상단의 `#group-form-error` 하나로 정했다.
- 일반 유저의 터널 편집 화면은 인증서 업로드를 숨길 뿐 아니라 `/api/externalCert/:port` 조회 자체를 건너뛰고, 저장 전에 그룹이 허용하지 않은 리라이트 플래그를 false 로 정규화한다(설계 §4.7 에는 없는 규칙. U1-09 의 `loadCertInfo()`·`emptyOption()` 기본값과 U2-04·U2-08 의 서버 규칙이 만나면 필요하다).
- `#/users`·`#/groups`·`#/me`·`#/me/password` 는 U3-01 시점에 화면이 없으므로 `#screen-placeholder` 를 두고 U3-02~05 가 교체한다.

## U3-01

**title**: feat(admin): RBAC 테스트 fixture 와 섹션 기반 내비게이션·라우트 가드
**labels**: enhancement, area:frontend, unit:3
**body**:
## 목적

로그인한 사용자의 `sections` 에 따라 드로어 항목과 라우트를 제한하고, 권한이 없는 해시는 `#/denied` 로 보낸다. 이 이슈가 끝나면 일반 유저는 자기에게 허용된 화면만 보고, 슈퍼유저는 Users·Groups·My account 항목이 드로어에 생긴다(화면 자체는 U3-03~05 가 만든다). 또한 단위 3 의 모든 화면 테스트가 쓰는 `rbac` fixture 와 `MeCtrl` 이 이 이슈에서 확정된다.

## 배경

이 이슈는 단위 1(UI 골격)과 단위 2(RBAC API)의 산출물 위에 놓인다. **착수 시점에 아래 표의 파일과 심볼이 실제로 있는지 먼저 확인한다. 하나라도 없거나 시그니처가 다르면 이슈에 코멘트를 남기고 중단한다.** 시그니처가 다른 경우에는 실제 코드를 따르되 그 차이를 코멘트에 적는다. 단위 2 의 이슈 ID 는 단위 2 설계 §9(U2-01~U2-10) 기준이다.

이 이슈가 전제하는 산출물:

| 출처 | 경로 | 이 이슈가 쓰는 계약 |
|---|---|---|
| U1-04 | `admin/src/router.ts` | `type Screen`, `type Route = {screen: Screen; param?: string}`, `route: Readable<Route>`, `navigate(hash: string): void`, `parseHash(hash: string): Route` |
| U1-04 | `admin/src/shell/nav.ts` | `NAV: ReadonlyArray<{hash; title; screen}>`, `chrome(route: Route): {title: string; back?: string}`(화면별 title/back 표), `navScreen(route: Route): Screen`(`'tunnel-edit' → 'tunnels'`, 드로어의 현재 항목 판정) |
| U1-04 | `admin/src/shell/Drawer.svelte` | `role="dialog" aria-modal="true" aria-label="Navigation"`, `NAV` 순회, `aria-current={navScreen($route) === item.screen ? 'page' : undefined}` |
| U1-04 | `admin/src/shell/session.ts` | `type SessionContext = {invalidate(): void}`, `provideSession(ctx)`, `useSession(): SessionContext`(컴포넌트 초기화 중에만 호출. 컨텍스트가 없으면 no-op) |
| U1-04 | `admin/src/App.svelte` | 세션 상태 `'Checking' \| 'Valid' \| 'Invalid'`, `provideSession({invalidate() { state = 'Invalid'; }})`, `const current = $derived(chrome($route))` 로 `Shell` 의 `title`/`back` 계산 |
| U1-04 | `test/admin/router.test.ts` | `parseHash` 표 테스트 |
| U1-02 | `admin/src/ui/Button.svelte` | `variant`, `size`, `disabled`, `type`, `onclick`, children |
| U1-05 | `test/admin/admin-backend-driver.ts` | argv `[rootDir, fixtureName?]`. fixture `'with-tunnels'` 가 `rootDir/config/server.yaml` 을 쓴다. 스텁 `TTTServer` 와 IPC `{type:'calls'}` |
| U1-05 | `test/helpers/adminApp.ts` | 로그인 완료 판정이 `page.waitForFunction(() => location.hash === '#/status')` + `h1` 텍스트 "Status" 대기다(이 이슈가 바꾼다) |
| U2-10 | `admin/src/shell/nav.ts` | `NAV` 항목에 `section: 'status' \| 'tunnels' \| 'server'` 추가. `Drawer` 는 `$me?.sections.includes(item.section)` 인 항목만 그린다 |
| U2-10 | `admin/src/shell/Drawer.svelte` | 드로어 하단에 사용자명(`$me.user.username`, `class="mono"`)과 `Button` "Sign out"(`id="nav-sign-out"`) → `LoginCtrl.logout()` → `clearMe()` → `useSession().invalidate()` |
| U2-10 | `admin/src/me.ts` | `type Me = {user: {…, mustChangePassword, migratedFromLegacyAdmin, …}; group: {id; name; attributes}; sections: string[]; migrationBanner: boolean}`, `me: Writable<Me \| undefined>`, `loadMe(): Promise<Me>`(`GET /api/me` → `me.set`), `clearMe()` |
| U2-10 | `admin/src/App.svelte` | `'Valid'` 직후 `loadMe()`. `$me.user.mustChangePassword` 이면 `Shell` 대신 `<p role="alert" id="password-change-required">` 와 `#password-change-sign-out` 만 표시(U3-02 가 대체한다. 이 이슈는 손대지 않는다) |
| U2-10 | `admin/src/screens/LoginScreen.svelte` | `#login-username`, `#login-password`, 버튼 "OK", `#login-message` |
| U2-10 | `test/helpers/adminApp.ts` | `startAdminApp({fixture, login?: {username, password}}) → Promise<{page, url, errors, calls(), close}>`. 뷰포트 400×800, 로그인까지 수행. `login` 생략 시 `admin` / `test-password-1234` |
| U2-10 | `test/admin/admin-backend-driver.ts` fixture `'regular-user'` | 드라이버 프로세스 안에서 `IdentityMigration.runAtStartup()`(`.key` 승격으로 `admin`) 뒤 `IdentityStore.instance.createUser(...)` 로 `alice`·`temp` 를 만든다. `serializeIdentityFixture` 를 쓰지 않는다. 이 이슈의 `'rbac'` 은 그와 달리 `identity.yaml` 을 파일로 쓴다(아래) |
| U2-10 | `test/admin/screen-login.test.ts` | `regular-user` fixture 의 `alice` 로그인 → `#/status` 도착 케이스(이 이슈가 `#/tunnels` 로 바꾼다) |
| U2-10 | `test/admin/shell.test.ts` | 드로어 항목 순서 케이스(status, tunnels, server) |
| U2-09 | `test/helpers/identityFixture.ts` | `type IdentityFixture = {users: Array<{username; password; role; groupId?; displayName?; mustChangePassword?}>; groups?: Array<{id; name; attributes?: Partial<GroupAttributes>}>}`, `serializeIdentityFixture(fixture): Promise<string>`(`identity.yaml` 텍스트, `id` 는 `newUserId()`, 시스템 그룹 2개 자동) |
| U2-04 | `GET /api/me` | `{success: true, user: UserView, group: {id, name, attributes: GroupAttributes}, sections: string[], migrationBanner: boolean}` |
| U2-04 | `PUT /api/me/password` | 요청 `{currentPassword, newPassword}`. 성공 `{success: true}`. 실패 422 `password_too_short`, 422 `current_password_mismatch` |
| U2-04 | `POST /api/me/acknowledge-migration` | `{success: true}` |
| U2-08 | `server.yaml` 의 `tunnelingOptions[].ownerId` | 없으면 서버가 `system:migrated` 로 읽는다 |

`sections` 의 값(단위 2 §4.4 `sections(principal)`): 슈퍼유저 `['status','tunnels','server','users','groups','security','audit','sessions','me']`. 일반 유저는 그룹 속성 `admin_ui_section_access` 를 `tunnels→'tunnels'`, `my_audit→'audit'`, `my_profile→'me'`, `my_sessions→'sessions'` 로 사상한 것(단, `tunnel_crud === 'none'` 이면 `tunnels` 제외).

현재 저장소에서 그대로 쓰는 것:

- `admin/src/controller/AdminRequest.ts:36` `adminRequest(path, options)`: CSRF 헤더를 붙이고, 401 이면 `InvalidSession` 을 던지며, 2xx 가 아니면 `{...body, success: false, status, message}` 를 돌려준다. 새 컨트롤러는 모두 이것을 쓴다.
- `admin/src/controller/ServerOptionCtrl.ts:32-37` 의 `instance` 싱글턴 패턴. 새 컨트롤러도 같은 패턴이다(`LoginCtrl` 만 정적).
- `admin/src/controller/Types.ts` 의 `export {type …}` 목록. 여기에 타입을 추가한다.

먼저 열어 볼 파일: `admin/src/App.svelte`, `admin/src/router.ts`, `admin/src/shell/nav.ts`, `admin/src/shell/Drawer.svelte`, `admin/src/shell/session.ts`, `admin/src/me.ts`, `admin/src/controller/AdminRequest.ts`, `admin/src/controller/Types.ts`, `test/helpers/identityFixture.ts`, `test/admin/admin-backend-driver.ts`, `test/helpers/adminApp.ts`, `test/admin/router.test.ts`, `test/admin/screen-login.test.ts`, `test/admin/shell.test.ts`.

## 적용되는 결정

- D4 내비게이션은 상단 헤더 + 햄버거 드로어 → 섹션 필터는 드로어 항목에 적용한다. 별도 골격을 만들지 않는다.
- D5 UI 문구는 영어 단일 → 아래 문구를 따옴표 그대로 쓴다.
- D2 기존 화면도 디자인 시스템으로 → 새 화면은 `ui/` 부품만 쓴다.

## 만들 것

### `admin/src/controller/Types.ts` (추가)

```ts
export type Role = 'superuser' | 'regular';
export type UserStatus = 'active' | 'disabled';
export type UserView = {id: string; username: string; displayName: string; role: Role; status: UserStatus;
    groupId: string; groupName: string; mustChangePassword: boolean; migratedFromLegacyAdmin: boolean;
    createdAt: number; updatedAt: number};
export type TunnelProtocolName = 'TCP' | 'HTTP' | 'HTTPS' | 'HTTP_REWRITE';
export type GroupAttributes = {
    tunnel_crud: 'none' | 'read_only' | 'full';
    max_tunnel_count: number;
    max_tunnel_duration_ms: number;
    allowed_port_range: Array<{from: number; to: number}>;
    allowed_protocols: TunnelProtocolName[];
    max_concurrent_connections: number;
    allowed_trusted_clients: string[];
    http_tunnel_rewrite_permissions: {cors: boolean; host: boolean; header: boolean; body: boolean};
    admin_ui_section_access: Array<'tunnels' | 'my_audit' | 'my_profile' | 'my_sessions'>;
    tunnel_visibility: 'private' | 'group_read';
    rate_limit: 'unlimited' | '1MB/s' | '10MB/s' | '100MB/s';
};
export type Group = {id: string; name: string; system: boolean; attributes: GroupAttributes};
export type MeResponse = {user: UserView; group: {id: string; name: string; attributes: GroupAttributes};
    sections: string[]; migrationBanner: boolean};
export type ApiFailure = {success: false; status: number; message: string; code?: string};
export type ApiResult<T> = ({success: true} & T) | ApiFailure;
```

`ApiResult` 는 `adminRequest` 의 반환값을 그대로 담는 타입이다. 서버 오류 코드는 `code` 필드에 온다(단위 2 §4.1 `Result` 의 `code`). U3-03·04·06 의 컨트롤러도 이 타입을 쓴다.

### `admin/src/controller/MeCtrl.ts` (신규)

```ts
class MeCtrl {
    static get instance(): MeCtrl;
    me(): Promise<ApiResult<MeResponse>>;                                        // GET  /api/me
    changePassword(currentPassword: string, newPassword: string): Promise<ApiResult<{}>>;   // PUT  /api/me/password, body {currentPassword, newPassword}
    acknowledgeMigration(): Promise<ApiResult<{}>>;                              // POST /api/me/acknowledge-migration
}
export default MeCtrl;
```

세 메서드 모두 `adminRequest` 로 호출하고 응답 JSON 을 그대로 돌려준다. `fetch` 를 직접 쓰지 않는다. `changePassword` 와 `acknowledgeMigration` 은 U3-02 가 쓴다.

### `admin/src/shell/nav.ts` (확장)

기존 `chrome()`·`navScreen()` 은 남기고 아래를 추가·확장한다.

```ts
import type {Route, Screen} from '../router';
export type Section = 'status' | 'tunnels' | 'server' | 'users' | 'groups' | 'security' | 'audit' | 'sessions' | 'me';
export type NavItem = {hash: string; title: string; screen: Screen; section: Section};
export const NAV: ReadonlyArray<NavItem> = [
    {hash: '#/status',  title: 'Status',          screen: 'status',  section: 'status'},
    {hash: '#/tunnels', title: 'Tunnels',         screen: 'tunnels', section: 'tunnels'},
    {hash: '#/server',  title: 'Server settings', screen: 'server',  section: 'server'},
    {hash: '#/users',   title: 'Users',           screen: 'users',   section: 'users'},
    {hash: '#/groups',  title: 'Groups',          screen: 'groups',  section: 'groups'},
    // 4·5 단위가 이 자리에 Security, Audit log, Sessions 를 이 순서로 삽입한다
    {hash: '#/me',      title: 'My account',      screen: 'me',      section: 'me'},
];
export const SECTION_OF_SCREEN: Record<Screen, Section | null> = {
    status: 'status', tunnels: 'tunnels', 'tunnel-edit': 'tunnels', server: 'server',
    users: 'users', 'user-edit': 'users', groups: 'groups', 'group-edit': 'groups',
    me: 'me', 'me-password': null, denied: null,          // null = 항상 허용
};
export function visibleNav(sections: string[]): NavItem[];   // NAV 중 section 이 sections 에 있는 것, 순서 유지
export function defaultHash(sections: string[]): string;     // visibleNav(sections)[0]?.hash ?? '#/me'
export function chrome(route: Route): {title: string; back?: string};   // 기존. 아래 9행 추가
export function navScreen(route: Route): Screen;                        // 기존. 'user-edit' → 'users', 'group-edit' → 'groups', 'me-password' → 'me', 그 외 그대로
```

`chrome()` 표에 추가하는 행(기존 5행은 그대로):

| route | title | back |
|---|---|---|
| `users` | `Users` | — |
| `user-edit`, param `new` | `New user` | `#/users` |
| `user-edit`, param id | `User` | `#/users` |
| `groups` | `Groups` | — |
| `group-edit`, param `new` | `New group` | `#/groups` |
| `group-edit`, param id | `Group` | `#/groups` |
| `me` | `My account` | — |
| `me-password` | `Change password` | `#/me` |
| `denied` | `No access` | — |

Security·Audit log·Sessions 항목은 화면이 없으므로 이 이슈에서 넣지 않는다(4·5 단위가 넣는다). `defaultHash` 는 슈퍼유저에게 `#/status`, `sections` 가 `['tunnels','audit','me','sessions']` 인 유저에게 `#/tunnels`, `['audit','me']` 면 `#/me`, 빈 배열이면 `#/me` 를 돌려준다.

### `admin/src/screens/DeniedScreen.svelte` (신규)

`<p id="denied-message">` "You don't have access to this page." + `Button variant="primary"` "Go to my tunnels" → `navigate(defaultHash($me.sections))`. 버튼 문구는 기본 화면이 무엇이든 고정이다.

### `admin/src/App.svelte` 라우트 가드 (변경)

`$route` 와 `$me` 가 바뀔 때마다(`$effect`) 아래 순서로 판단한다. `$me` 가 아직 없거나 `$me.user.mustChangePassword` 이면 아무것도 하지 않는다(강제 변경 흐름은 U3-02).

1. `section = SECTION_OF_SCREEN[$route.screen]`. `null` 이면 통과.
2. `$me.sections.includes(section)` 이면 통과.
3. `location.hash` 가 `''`, `'#'`, `'#/'`, `'#/status'` 중 하나이면(라우터 기본값이라 사용자가 직접 입력한 것이 아니다) `navigate(defaultHash($me.sections))`.
4. 그 외에는 `navigate('#/denied')`.

`title`/`back` 은 `chrome($route)`(위 표)가 준다. 새 screen 마다 그리는 것:

| screen | 이 이슈에서 그리는 것 |
|---|---|
| users, user-edit | `<p id="screen-placeholder">This screen is not available yet.</p>` (U3-03 이 교체) |
| groups, group-edit | 같은 placeholder (U3-04 가 교체) |
| me | 같은 placeholder (U3-05 가 교체) |
| me-password | 같은 placeholder (U3-02 가 교체) |
| denied | `DeniedScreen` |

### `test/helpers/rbacFixture.ts` (신규)

드라이버와 테스트가 함께 import 하는 fixture 값의 단일 출처.

```ts
import type {IdentityFixture} from './identityFixture';
export const RBAC_USER_IDS = {admin: 'u_0000000000000001', alice: 'u_0000000000000002', bob: 'u_0000000000000003',
    carol: 'u_0000000000000004', dave: 'u_0000000000000005'} as const;
export const RBAC_GROUP_FIELD_ID = 'g_0000000000000001';
export const RBAC_PASSWORDS = {admin: 'test-password-1234', alice: 'user-password-1234', bob: 'user-password-1234',
    carol: 'user-password-1234', dave: 'temp-password-1234'} as const;
export const RBAC_IDENTITY_FIXTURE: IdentityFixture;      // 아래 두 표
export const RBAC_TUNNELS: Array<{forwardPort: number; protocol: 'tcp' | 'http'; destinationAddress: string; destinationPort: number; ownerId?: string}>;
export const RBAC_TRUSTED_CLIENTS: Array<{clientId: string; clientSecret: string; displayName: string}>;
```

`RBAC_IDENTITY_FIXTURE.users`:

| username | id | displayName | role | groupId | mustChangePassword | password | migratedFromLegacyAdmin |
|---|---|---|---|---|---|---|---|
| `admin` | `u_0000000000000001` | `Admin` | `superuser` | (생략 → `system:superuser`) | `false` | `test-password-1234` | `true` |
| `alice` | `u_0000000000000002` | `Alice` | `regular` | `g_0000000000000001` | `false` | `user-password-1234` | `false` |
| `bob` | `u_0000000000000003` | `Bob` | `regular` | `g_0000000000000001` | `false` | `user-password-1234` | `false` |
| `carol` | `u_0000000000000004` | `Carol` | `regular` | `default` | `false` | `user-password-1234` | `false` |
| `dave` | `u_0000000000000005` | `Dave` | `regular` | `g_0000000000000001` | `true` | `temp-password-1234` | `false` |

`RBAC_IDENTITY_FIXTURE.groups` (시스템 그룹 `system:superuser` "Superusers", `default` "Default" 는 `serializeIdentityFixture` 가 자동으로 만들며 `default` 의 속성은 단위 2 §3 기본값이다):

| id | name | attributes |
|---|---|---|
| `g_0000000000000001` | `Field team` | `tunnel_crud: 'full'`, `max_tunnel_count: 2`, `max_tunnel_duration_ms: 0`, `allowed_port_range: [{from: 20000, to: 20099}]`, `allowed_protocols: ['TCP','HTTP','HTTP_REWRITE']`, `max_concurrent_connections: 100`, `allowed_trusted_clients: ['client-a']`, `http_tunnel_rewrite_permissions: {cors: true, host: true, header: false, body: false}`, `admin_ui_section_access: ['tunnels','my_audit','my_profile','my_sessions']`, `tunnel_visibility: 'group_read'`, `rate_limit: 'unlimited'` |

`RBAC_TUNNELS`:

| forwardPort | protocol | destinationAddress | destinationPort | ownerId |
|---|---|---|---|---|
| 20001 | `tcp` | `127.0.0.1` | 8081 | `u_0000000000000002` (alice) |
| 20002 | `http` | `127.0.0.1` | 8082 | `u_0000000000000003` (bob) |
| 20003 | `tcp` | `127.0.0.1` | 8083 | (필드 없음 → `system:migrated`) |

`RBAC_TRUSTED_CLIENTS`: `[{clientId: 'client-a', clientSecret: 'client-a-secret-0123456789abcdef', displayName: 'Client A'}, {clientId: 'client-b', clientSecret: 'client-b-secret-0123456789abcdef', displayName: 'Client B'}]`.

## 변경할 것

- `test/helpers/identityFixture.ts`: `IdentityFixture.users[]` 항목에 `id?: string` 과 `migratedFromLegacyAdmin?: boolean` 을 추가한다. `id` 가 있으면 `newUserId()` 대신 그 값을 쓰되 `/^u_[0-9a-f]{16}$/` 에 맞지 않으면 `Error` 를 던진다. `migratedFromLegacyAdmin` 기본값은 `false`, `migrationAcknowledged` 는 항상 `false` 로 쓴다. 기존 호출부(U2-09·U2-10)는 두 필드를 생략하므로 동작이 바뀌지 않는다.
- `test/admin/admin-backend-driver.ts`: fixture `'rbac'` 추가. `'regular-user'` 와 같은 방식으로 `rootDir/config/identity.yaml` 에 `await serializeIdentityFixture(RBAC_IDENTITY_FIXTURE)` 를 쓰고 `.key` 는 쓰지 않는다. `rootDir/config/server.yaml` 은 `'with-tunnels'` 가 쓰는 내용에서 `tunnelingOptions` 를 `RBAC_TUNNELS` 로, `trustedClients` 를 `RBAC_TRUSTED_CLIENTS` 로 바꾼 것이다. 스텁 `TTTServer` 의 `externalServerStatuses` 는 기존과 같이 fixture 의 터널마다 `{port, online: true, active: true, sessions: 0, rx: 0, tx: 0, uptime: 1000, activeStart: Date.now(), activeTimeout: 3600}` 을 돌려준다.
- `test/helpers/adminApp.ts`: `fixture` 유니온에 `'rbac'` 을 추가한다. `login` 옵션은 그대로 쓴다(테스트는 `startAdminApp({fixture: 'rbac', login: {username: 'alice', password: RBAC_PASSWORDS.alice}})` 로 부른다). 새 진입점을 만들지 않는다. 로그인 완료 판정을 "`location.hash === '#/status'` + `h1` 'Status'" 대기에서 "`#login-password` 가 DOM 에서 사라지고 헤더의 `h1`(Shell 제목)이 보일 때까지" 로 바꾼다(일반 유저는 `#/tunnels` 에, 강제 변경 사용자는 U3-02 이후 `#/me/password` 에 도착하므로). 기존 호출부의 기대는 바뀌지 않는다(admin 은 여전히 `#/status` 에 도착한다).
- `admin/src/router.ts`: `Screen` 에 `'users' | 'user-edit' | 'groups' | 'group-edit' | 'me' | 'me-password' | 'denied'` 를 추가하고 `parseHash` 표를 확장한다. 기존 행은 그대로.

  | 해시 | Route |
  |---|---|
  | `#/users` | `{screen: 'users'}` |
  | `#/users/new` | `{screen: 'user-edit', param: 'new'}` |
  | `#/users/<u_ + 16 hex>` | `{screen: 'user-edit', param: '<그 id>'}` |
  | `#/users/<그 외>` | `{screen: 'users'}` |
  | `#/groups` | `{screen: 'groups'}` |
  | `#/groups/new` | `{screen: 'group-edit', param: 'new'}` |
  | `#/groups/<g_ + 16 hex \| default \| system:superuser>` | `{screen: 'group-edit', param: '<그 id>'}` |
  | `#/groups/<그 외>` | `{screen: 'groups'}` |
  | `#/me` | `{screen: 'me'}` |
  | `#/me/password` | `{screen: 'me-password'}` |
  | `#/denied` | `{screen: 'denied'}` |

- `admin/src/me.ts`: `type Me` 의 자체 정의를 `export type Me = MeResponse`(`controller/Types.ts`)로 바꾼다(`group.attributes` 가 `GroupAttributes` 로 좁혀진다). `loadMe()` 의 `GET /api/me` 호출을 `MeCtrl.instance.me()` 로 바꾼다. `success: true` 면 스토어에 `{user, group, sections, migrationBanner}` 를 넣고 그 값을 돌려주며, `success: false` 면 스토어를 `undefined` 로 두고 `Error(message)` 를 던진다(기존 반환 타입 `Promise<Me>` 유지). `InvalidSession` 은 그대로 전파한다.
- `admin/src/shell/Drawer.svelte`: `NAV` 대신 `visibleNav($me?.sections ?? [])` 를 순회한다(`aria-current` 판정의 `navScreen($route)` 는 그대로). 하단의 기존 사용자명 요소에 `id="drawer-username"` 을 단다(문구는 U2-10 그대로 `{$me.user.username}`).
- `admin/src/App.svelte`: 위 "라우트 가드" 절과 placeholder 표. `#password-change-required` 블록은 손대지 않는다.
- `test/admin/router.test.ts`: 위 `parseHash` 표의 11행을 케이스로 추가한다.
- `test/admin/screen-login.test.ts`: `regular-user` fixture 의 `alice` 로그인 케이스에서 도착 해시 기대값을 `#/status` 에서 `#/tunnels` 로 바꾼다(`admin_ui_section_access: ['tunnels']` → `defaultHash` 가 `#/tunnels`).
- `test/admin/shell.test.ts`: 드로어 항목 순서 케이스의 기대값을 `['Status','Tunnels','Server settings']` 에서 `['Status','Tunnels','Server settings','Users','Groups','My account']` 로 바꾼다.

## 하지 말 것

- 비밀번호 변경 화면·강제 변경 흐름·마이그레이션 배너를 만들지 않는다(U3-02). `#password-change-required` 블록을 지우지 않는다.
- 사용자·그룹·내 계정 화면을 만들지 않는다(U3-03·04·05). placeholder 만 둔다.
- Security·Audit log·Sessions NAV 항목을 미리 넣지 않는다(4·5 단위).
- `#/denied` 진입을 서버에 알리지 않는다(감사 대상이 아니다. 서버가 403 을 낼 때 기록한다).
- `startAdminApp` 에 `loginAs` 같은 두 번째 로그인 진입점을 만들지 않는다. `login` 옵션 하나다.
- `rbac` fixture 의 `identity.yaml` 을 드라이버에서 직접 직렬화하지 않는다. `serializeIdentityFixture` 를 쓴다(`regular-user` 가 `IdentityStore` API 로 만드는 방식은 그대로 둔다).
- `chrome()`·`navScreen()` 을 지우거나 `App.svelte` 로 옮기지 않는다(확장만 한다).
- 백엔드(`src/**`)를 수정하지 않는다.
- Svelte 5 룬(`$props`, `$state`, `$derived`, `$effect`, `$bindable`)만 쓴다. `export let`, `createEventDispatcher` 금지.
- `.svelte` 파일에 hex 색상 리터럴을 쓰지 않는다. 색은 토큰(`var(--ink-2)`)으로만.
- `ui/` 밖(`screens/`, `shell/`, `App.svelte`)에서 새 스타일 클래스를 만들지 않는다. 배치는 인라인 `style` 의 flex/grid 와 토큰 간격으로만 한다. 기존 `.mono` 는 써도 된다.
- fixture 의 사용자·그룹·터널 값을 바꾸지 않는다. 뒤 이슈들의 테스트가 이 값을 그대로 쓴다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트. 브라우저 테스트는 전부 `startAdminApp({fixture: 'rbac', login: {username, password: RBAC_PASSWORDS[username]}})` 로 시작하고(`admin` 은 `login` 생략), `finally` 에서 `close()` 하며, `expect(errors).toEqual([])` 로 끝난다. 각 `test()` 는 독립적으로 앱을 띄운다.

- `test/admin/router.test.ts` (추가)
  - 위 `parseHash` 표의 각 행에 대해 `parseHash(해시)` 가 오른쪽 Route 와 `toEqual` 이다.
- `test/admin/nav.test.ts` (신규, 순수 함수)
  - `chrome({screen: 'user-edit', param: 'new'})` 가 `{title: 'New user', back: '#/users'}` 이고, `chrome({screen: 'me-password'})` 가 `{title: 'Change password', back: '#/me'}` 이며, `chrome({screen: 'denied'})` 가 `{title: 'No access'}` 이다.
  - `navScreen({screen: 'group-edit', param: 'default'})` 가 `'groups'` 이고 `navScreen({screen: 'me-password'})` 가 `'me'` 이다.
  - `visibleNav(슈퍼유저 sections)` 가 NAV 6개 전부를 순서대로 돌려준다.
  - `visibleNav(['tunnels','audit','me','sessions'])` 의 title 이 `['Tunnels','My account']` 이다.
  - `defaultHash(슈퍼유저 sections)` 가 `'#/status'` 이다.
  - `defaultHash(['tunnels','audit','me','sessions'])` 가 `'#/tunnels'` 이다.
  - `defaultHash(['audit','me'])` 와 `defaultHash([])` 가 `'#/me'` 이다.
- `test/unit/helpers/identityFixture.test.ts` (신규)
  - `users[0].id` 를 `u_0000000000000009` 로 주면 직렬화된 YAML 에 `id: u_0000000000000009` 가 있다.
  - `users[0].id` 를 `bad` 로 주면 `Error` 를 던진다.
  - `migratedFromLegacyAdmin: true` 를 주면 YAML 에 `migratedFromLegacyAdmin: true` 와 `migrationAcknowledged: false` 가 있고, 생략하면 `migratedFromLegacyAdmin: false` 이다.
- `test/admin/screen-access.test.ts` (신규)
  - alice 로 로그인하면 해시가 `#/tunnels` 이다.
  - alice 가 메뉴 버튼을 누르면 드로어(`[role=dialog][aria-label="Navigation"]`)에 "Tunnels" 와 "My account" 만 있고 "Status", "Server settings", "Users", "Groups" 는 없다. `#drawer-username` 의 텍스트가 `alice` 이다.
  - alice 가 `#/users` 로 이동하면(`page.goto(url + '#/users')`) 해시가 `#/denied` 가 되고 `#denied-message` 가 "You don't have access to this page." 이며, 버튼 "Go to my tunnels" 를 누르면 해시가 `#/tunnels` 이다.
  - alice 가 `#/status` 로 이동하면 해시가 `#/tunnels` 이다(`#/denied` 가 아니다).
  - alice 가 `#/server`, `#/groups` 로 각각 이동하면 둘 다 `#/denied` 이고, `#/me` 와 `#/me/password` 로 이동하면 각각 해시가 그대로이며 `#screen-placeholder` 가 보인다.
  - admin 으로 로그인하면 해시가 `#/status` 이고 드로어에 NAV 6개 제목이 전부 이 순서로 있다: Status, Tunnels, Server settings, Users, Groups, My account.
  - admin 이 `#/users`, `#/groups`, `#/me`, `#/denied` 로 이동하면 각각 해시가 그대로이고 앞의 셋은 `#screen-placeholder`, 마지막은 `#denied-message` 가 보인다.
  - carol(Default 그룹) 로 로그인하면 해시가 `#/tunnels` 이고 드로어에 "Tunnels" 와 "My account" 가 있다.

기존 `test/admin/*.test.ts` 전부(위에서 갱신한 `screen-login`·`shell` 케이스 포함)가 통과한다.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm --prefix admin run check
npm run lint
npm run test:admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건, 제목에 단계 표식 0건 확인
```

## 선행 · 후행

- 선행: U1-10(단위 1 전부), U2-10(단위 2 전부).
- 후행: U3-02, U3-03, U3-04(서로 병렬 가능), U3-05, U3-06.

## 근거 문서

- `docs/design/2026-09-11-unit3-rbac-screens.md` §2(`MeCtrl`), §3(라우트·가드), §5(fixture, `screen-access`), §6(U3-01)
- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §5(라우터·골격), §8.2(드라이버·`startAdminApp`)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §3(`identity.yaml`), §4.4(`sections`), §5.2(`/api/me*`), §7(U2-10), §9(U2-09 `identityFixture`)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.2.3(NFR-USAB-HIDE-001, NFR-USAB-EMPTY-STATE-001), §6.4
- `docs/design/2026-09-11-program-overview.md` §1 D2·D4·D5, §3.2 커밋 규약

---

## U3-02

**title**: feat(admin): 강제 비밀번호 변경 화면과 마이그레이션 안내 배너
**labels**: enhancement, area:frontend, unit:3
**body**:
## 목적

임시 비밀번호 상태의 사용자를 `#/me/password` 에 고정해 비밀번호를 바꾸게 하고, 마이그레이션으로 승격된 슈퍼유저에게 배너를 한 번 보여 준다. 이 이슈가 끝나면 U2-10 의 임시 안내(`#password-change-required`)가 실제 화면으로 바뀌고, 일반 유저가 자기 비밀번호를 바꿀 수 있다(PRD NFR-USAB-FIRST-LOGIN-001, §6.3).

## 배경

**착수 시점에 아래 표의 파일과 심볼이 실제로 있는지 먼저 확인한다. 하나라도 없거나 시그니처가 다르면 이슈에 코멘트를 남기고 중단한다.** 단위 2 이슈 ID 는 단위 2 설계 §9 기준이다.

| 출처 | 경로 | 이 이슈가 쓰는 계약 |
|---|---|---|
| U3-01 | `admin/src/controller/MeCtrl.ts` | `changePassword(current, next): Promise<ApiResult<{}>>`, `acknowledgeMigration(): Promise<ApiResult<{}>>` |
| U3-01 | `admin/src/shell/nav.ts` | `defaultHash(sections)`, `SECTION_OF_SCREEN` |
| U3-01 | `admin/src/App.svelte` | 라우트 가드(`$me.user.mustChangePassword` 이면 건너뜀), `me-password` 분기의 `#screen-placeholder`, title "Change password" / back `#/me` |
| U3-01 | `admin/src/me.ts` | `me`(`Me = MeResponse`), `loadMe(): Promise<Me>` |
| U3-01 | `test/helpers/rbacFixture.ts` | `RBAC_PASSWORDS`, fixture `rbac`(admin 은 `migratedFromLegacyAdmin: true`, dave 는 `mustChangePassword: true`) |
| U2-10 | `admin/src/App.svelte` | `$me.user.mustChangePassword` 이면 `Shell` 대신 `<p role="alert" id="password-change-required">…</p>` 와 `#password-change-sign-out` 을 표시(이 이슈가 제거) |
| U2-10 | `admin/src/controller/LoginCtrl.ts` | `static logout(): Promise<void>` |
| U2-10 | `admin/src/shell/Drawer.svelte` | "Sign out"(`#nav-sign-out`) → `LoginCtrl.logout()` → `clearMe()` → `useSession().invalidate()` |
| U2-10 | `test/admin/screen-login.test.ts` | `regular-user` fixture 의 `temp` 로그인 → `#password-change-required` 케이스(이 이슈가 바꾼다) |
| U1-04 | `admin/src/shell/Shell.svelte` | props `title: string`, `back?: string`, children. `Header` 와 `<main>` 을 감싼다 |
| U1-04 | `admin/src/shell/Header.svelte` | 메뉴 버튼 `aria-label="Open menu"`, 뒤로 버튼 `aria-label="Back"` |
| U1-04 | `admin/src/shell/session.ts` | `useSession(): {invalidate(): void}` |
| U1-02 | `admin/src/ui/{Button,Field,TextInput}.svelte` | `Field`: `label`, `hint?`, `error?`, `for?`. `TextInput`: `value`(bindable), `id`, `type`, `disabled`, `autocomplete`, `invalid?` |
| U1-03 | `admin/src/ui/Banner.svelte` | props `tone: Tone`, `dismissible = false`, `class`, 스니펫 `children`, 콜백 `ondismiss?: () => void`. 루트 `<div class="banner {tone}" role="status">`, `dismissible` 이면 `<button type="button" class="banner-close" aria-label="Dismiss">×</button>`. 숨김 상태는 부모의 몫 |
| U1-03 | `admin/src/ui/toast.ts` | `toast.push({tone, message, timeoutMs = 4000})` |
| U2-04 | `PUT /api/me/password` | 요청 `{currentPassword, newPassword}`. 검사 순서: 422 `password_too_short` → 422 `current_password_mismatch`(백오프 대상 아님) → 성공 `{success: true}` 후 다른 세션 제거(현재 세션 유지). `mustChangePassword` 상태에서는 임시 비밀번호가 `currentPassword` 다 |
| U2-04 | `GET /api/me` | `migrationBanner = user.migratedFromLegacyAdmin && !user.migrationAcknowledged` |
| U2-04 | `POST /api/me/acknowledge-migration` | `{success: true}`. 이후 `migrationBanner` 가 false |

먼저 열어 볼 파일: `admin/src/App.svelte`, `admin/src/shell/Shell.svelte`, `admin/src/shell/Header.svelte`, `admin/src/shell/session.ts`, `admin/src/controller/MeCtrl.ts`, `admin/src/me.ts`, `admin/src/ui/Banner.svelte`, `admin/src/ui/Field.svelte`, `test/admin/screen-login.test.ts`, `test/admin/screen-access.test.ts`.

## 적용되는 결정

- D5 UI 문구 영어 단일.
- D4 헤더 + 드로어 → 강제 변경 상태에서는 메뉴 버튼을 숨겨 이동 경로를 없앤다.
- D2 새 화면·부품은 디자인 시스템 토큰만 쓴다.

## 만들 것

### `admin/src/screens/PasswordChangeScreen.svelte` (신규, `#/me/password`)

`forced` 는 `$me.user.mustChangePassword` 다.

| 요소 | id / 문구 |
|---|---|
| 강제 변경 안내 (`forced` 일 때만) | `<p id="pw-forced-note">` "Set a new password before continuing." |
| 현재 비밀번호 | `Field label={forced ? 'Temporary password' : 'Current password'} for="pw-current"` + `TextInput type="password" id="pw-current" autocomplete="current-password"` |
| 새 비밀번호 | `Field label="New password" hint="At least 8 characters." for="pw-new"` + `TextInput type="password" id="pw-new" autocomplete="new-password"` |
| 확인 | `Field label="Confirm new password" for="pw-confirm"` + `TextInput type="password" id="pw-confirm" autocomplete="new-password"` |
| 서버 오류 | `<p id="pw-message" role="alert">` 서버 `message`. 비어 있으면 요소를 그리지 않는다 |
| 제출 | `<form onsubmit>` 안의 `Button variant="primary" type="submit"` "Change password". 요청 중 `disabled` |
| 로그아웃 (`forced` 일 때만) | 폼 아래 `Button variant="ghost"` "Sign out" → 드로어의 "Sign out" 과 같은 경로(`LoginCtrl.logout()` → `clearMe()` → `useSession().invalidate()`; `useSession()` 은 컴포넌트 초기화 중에 부른다). 드로어가 숨겨진 상태에서 유일한 탈출구다 |

제출 시 클라이언트 검증(순서대로 검사해 첫 오류만 해당 `Field` 의 `error` 로 표시하고 요청하지 않는다):

| 조건 | 필드 | 문구 |
|---|---|---|
| 현재 비밀번호가 비어 있음 | `pw-current` | "Enter your current password." |
| 새 비밀번호 길이 < 8 | `pw-new` | "Use at least 8 characters." |
| 새 비밀번호 === 현재 비밀번호 | `pw-new` | "Choose a password different from the current one." |
| 확인 !== 새 비밀번호 | `pw-confirm` | "Passwords do not match." |

검증 통과 → `MeCtrl.instance.changePassword(current, next)`.
- `success: false` → `#pw-message` 에 `message`(코드로 분기하지 않는다. `current_password_mismatch` 도 서버 문구 그대로). 필드 값은 유지.
- `success: true` → `await loadMe()` → `forced` 였으면 `navigate(defaultHash($me.sections))`; 아니면 `toast.push({tone: 'pulse', message: 'Password changed.'})` 후 `navigate('#/me')`.
- `InvalidSession` 예외는 잡지 않는다(App 의 공통 처리로 간다).

### `admin/src/App.svelte` 강제 변경 고정과 배너 (변경)

- U2-10 의 `#password-change-required`·`#password-change-sign-out` 블록을 삭제한다. `mustChangePassword` 여도 `Shell` 을 그린다.
- 라우트 가드 맨 앞에 한 단계를 넣는다: `$me.user.mustChangePassword` 이면 `location.hash !== '#/me/password'` 일 때 `navigate('#/me/password')` 하고 끝낸다(다음 단계로 가지 않는다).
- `me-password` 분기의 placeholder 를 `<PasswordChangeScreen/>` 으로 바꾼다. `forced` 이면 `back` 을 `undefined` 로, `Shell` 에 `hideMenu={true}` 를 넘긴다.
- 마이그레이션 배너: `Shell` 의 `banner` 스니펫으로 넘긴다.

```svelte
{#snippet banner()}
  {#if $me?.migrationBanner}
    <Banner tone="trace" dismissible ondismiss={dismissMigration}>Your account was promoted to superuser during the upgrade.</Banner>
  {/if}
{/snippet}
```

`dismissMigration` 은 `MeCtrl.instance.acknowledgeMigration()` 을 부르고 `success: true` 면 `loadMe()` 를 다시 부른다(`migrationBanner` 가 false 가 되어 배너가 사라진다). 실패하면 `toast.push({tone: 'alarm', message})`.

## 변경할 것

- `admin/src/shell/Shell.svelte`: props 에 `hideMenu?: boolean`(기본 false)과 `banner?: Snippet` 을 추가한다. `hideMenu` 는 `Header` 로 전달하고, `banner` 는 `Header` 와 `<main>` 사이에 `{@render banner?.()}` 로 그린다(전체 폭, `max-width` 밖).
- `admin/src/shell/Header.svelte`: `hideMenu` 가 true 면 메뉴 버튼도 뒤로 버튼도 그리지 않는다(빈 44×44 자리만 유지해 제목 위치가 흔들리지 않게 한다).
- `admin/src/App.svelte`: 위 "만들 것".
- `test/admin/screen-login.test.ts`: `regular-user` fixture 의 `temp` 케이스를 "로그인 → 해시 `#/me/password`, `#pw-forced-note` 가 보이고 `[aria-label="Open menu"]` 가 없으며, 버튼 "Sign out" 을 누르면 `#login-password` 가 보인다" 로 바꾼다.
- `test/admin/screen-access.test.ts`: U3-01 의 "`#/me/password` 로 이동하면 `#screen-placeholder`" 단언을 "`#pw-current` 가 보인다" 로 바꾼다.

## 하지 말 것

- 내 계정 화면(`#/me`)을 만들지 않는다(U3-05). 비강제 변경 성공 뒤 도착하는 `#/me` 는 아직 placeholder 다.
- 상태 코드로 분기해 401 을 이 화면에서 잡지 않는다. `InvalidSession` 은 App 의 공통 처리에 맡긴다.
- `Banner` 를 다시 만들거나 스타일을 바꾸지 않는다(U1-03 의 부품을 그대로 쓴다). `ui/` 부품에 표에 없는 prop 을 추가하지 않는다.
- 백엔드(`src/**`)를 수정하지 않는다.
- Svelte 5 룬만 쓴다. `export let`, `createEventDispatcher` 금지. `.svelte` 안 hex 색상 금지. `ui/` 밖에서 새 스타일 클래스를 만들지 않는다.

## 수용 기준

브라우저 테스트는 `startAdminApp({fixture: 'rbac', login: {username, password: RBAC_PASSWORDS[username]}})`, `finally close()`, `expect(errors).toEqual([])`.

- `test/admin/screen-me.test.ts` (신규. 계정 카드 케이스는 U3-05 가 추가한다)
  - alice 가 `#/me/password` 로 가면 `#pw-current` 의 라벨이 "Current password" 이고 `#pw-forced-note` 와 버튼 "Sign out" 이 없으며 헤더에 `[aria-label="Back"]` 이 있다.
  - alice 가 `#pw-current` 에 `user-password-1234`, `#pw-new` 에 `short` 를 넣고 제출하면 "Use at least 8 characters." 가 보인다.
  - alice 가 `#pw-current` 에 `user-password-1234`, `#pw-new` 에 `new-password-5678`, `#pw-confirm` 에 `different-5678` 을 넣고 제출하면 "Passwords do not match." 가 보인다.
  - alice 가 `#pw-current` 와 `#pw-new` 에 같은 값 `user-password-1234` 를 넣고 제출하면 "Choose a password different from the current one." 이 보인다.
  - alice 가 `#pw-current` 를 비우고 제출하면 "Enter your current password." 가 보인다.
  - alice 가 `#pw-current` 에 `wrong-password-1` 을, 새 비밀번호·확인에 `new-password-5678` 을 넣고 제출하면 `#pw-message[role=alert]` 에 비어 있지 않은 문구가 보이고 해시는 `#/me/password` 이며 `#login-username` 이 나타나지 않는다(세션 유지).
  - alice 가 `user-password-1234` → `new-password-5678` 로 바꾸면 토스트 "Password changed." 가 보이고 해시가 `#/me` 이다. 이어서 메뉴 → `#nav-sign-out` 으로 로그아웃하고 `#login-username` 에 `alice`, `#login-password` 에 `user-password-1234` 를 넣고 "OK" 를 누르면 `#login-message` 에 "The password is incorrect." 가 보이며, `#login-password` 를 `new-password-5678` 로 바꿔 "OK" 를 누르면 해시가 `#/tunnels` 이다.
  - dave 로 로그인하면 해시가 `#/me/password` 이고, `#pw-forced-note` 가 "Set a new password before continuing." 이며, `#pw-current` 의 라벨이 "Temporary password" 이고, `[aria-label="Open menu"]` 와 `[aria-label="Back"]` 이 모두 없으며, 버튼 "Sign out" 이 있다.
  - dave 가 `#/tunnels` 로 이동하면 해시가 다시 `#/me/password` 가 된다.
  - dave 가 `temp-password-1234` → `dave-new-password-1` 로 바꾸면 해시가 `#/tunnels` 이고 `[aria-label="Open menu"]` 가 있다.
  - dave 가 버튼 "Sign out" 을 누르면 `#login-password` 가 보인다.
- `test/admin/screen-access.test.ts` (추가)
  - admin 의 화면에 "Your account was promoted to superuser during the upgrade." 가 있고, `[aria-label="Dismiss"]` 를 누르면 사라지며, `page.reload()` 뒤에도 없다.
  - alice 의 화면에 "Your account was promoted to superuser during the upgrade." 가 없다.

기존 `test/admin/*.test.ts` 전부(위에서 갱신한 `screen-login` 의 `temp` 케이스 포함)가 통과한다.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm --prefix admin run check
npm run lint
npm run test:admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건, 제목에 단계 표식 0건 확인
```

## 선행 · 후행

- 선행: U3-01. (U3-03·U3-04 와 병렬 가능.)
- 후행: U3-05(`#/me` 화면이 "Change password" 로 이 화면에 들어온다).

## 근거 문서

- `docs/design/2026-09-11-unit3-rbac-screens.md` §3(`mustChangePassword` 고정, 배너), §4.6(`PasswordChangeScreen`), §5(`screen-me` 비밀번호·강제 변경·배너), §6(U3-02)
- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §5.3~5.4(Shell·Header), §6(`Banner` 계약)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §5.2(`/api/me/password`, `/api/me/acknowledge-migration`), §7(U2-10 의 임시 안내)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.1(FR-USER-FIRST-LOGIN-FORCE-001), §5.2.3(NFR-USAB-FIRST-LOGIN-001), §6.3(배너)

---

## U3-03

**title**: feat(admin): 사용자 목록·편집 화면과 임시 비밀번호 1회 노출 모달
**labels**: enhancement, area:frontend, unit:3
**body**:
## 목적

슈퍼유저가 UI 만으로 사용자를 추가하고 임시 비밀번호를 받아 전달하며, 역할·그룹·상태를 바꾸고, 비밀번호를 초기화하고, 사용자를 삭제할 수 있게 한다. 이 이슈가 끝나면 PRD §6.1 의 1·3·4 단계(사용자 추가 → 그룹 배정 → 임시 비밀번호 전달)가 화면에서 끝난다.

## 배경

**착수 시점에 아래 표의 파일과 심볼이 실제로 있는지 먼저 확인한다. 하나라도 없거나 시그니처가 다르면 이슈에 코멘트를 남기고 중단한다.** 단위 2 이슈 ID 는 단위 2 설계 §9 기준이다.

| 출처 | 경로 | 이 이슈가 쓰는 계약 |
|---|---|---|
| U3-01 | `admin/src/router.ts` | `#/users` → `users`, `#/users/new` → `user-edit`(`new`), `#/users/<u_16hex>` → `user-edit`(id) |
| U3-01 | `admin/src/App.svelte` | `users`·`user-edit` 분기의 `#screen-placeholder`. title "Users" / "New user" / "User", back `#/users` |
| U3-01 | `admin/src/controller/Types.ts` | `Role`, `UserStatus`, `UserView`, `Group`, `GroupAttributes`, `ApiResult<T>`, `ApiFailure` |
| U3-01 | `admin/src/controller/MeCtrl.ts` | 싱글턴·`adminRequest` 패턴의 본보기 |
| U3-01 | `test/helpers/adminApp.ts`, `test/helpers/rbacFixture.ts` | `startAdminApp({fixture: 'rbac', login?})`, `RBAC_PASSWORDS`, `RBAC_USER_IDS`, `RBAC_GROUP_FIELD_ID` |
| U3-01 | fixture `rbac` | 사용자 5명(admin·alice·bob·carol·dave), 그룹 3개(`system:superuser` "Superusers", `default` "Default", `g_0000000000000001` "Field team"), alice 가 20001·bob 이 20002 소유 |
| U1-02 | `admin/src/ui/{Button,Field,TextInput,Select,Checkbox,Card,Chip,Badge}.svelte` | 단위 1 §6 표. `Select`: `value`(bindable), `id`, `options: Array<{value, label}>`, `disabled`. `Checkbox`: `checked`(bindable), `id`, `label`, `disabled`. `Chip`: `tone`, `mono?`. `Badge`: `tone` |
| U1-03 | `admin/src/ui/Modal.svelte`, `admin/src/ui/toast.ts` | `Modal`: `open`(bindable), `title`, `closeOnOverlay = true`, children, `footer` 스니펫. `toast.push({tone, message})` |
| U1-08 | `admin/src/screens/TunnelsScreen.svelte` | 카드마다 `Card` 에 `data-port` 를 다는 방식(같은 방식으로 `data-user-id` 를 단다) |
| U2-06 | `GET /api/users` | `{success: true, users: UserView[]}` |
| U2-06 | `GET /api/users/:id` | `{success: true, user: UserView}`. 없으면 404 |
| U2-06 | `POST /api/users` | 요청 `{username, displayName?, role, groupId?, temporaryPassword?}`. `temporaryPassword` 생략 시 서버가 16자(`[A-Za-z0-9]`) 생성. 응답 201 `{success: true, user: UserView, temporaryPassword: string}`(평문은 이 응답에만). 409 `username_taken`, 422 `role_invalid`·`password_too_short`·형식 |
| U2-06 | `PUT /api/users/:id` | 요청 `{displayName?, role?, status?, groupId?}`. 응답 `{success: true, user}`. 409 `last_superuser`, 422 |
| U2-06 | `DELETE /api/users/:id` | `{success: true}`. 409 `user_owns_tunnels` |
| U2-06 | `POST /api/users/:id/password-reset` | 요청 `{temporaryPassword?}`. 응답 `{success: true, temporaryPassword}` |
| U2-06 | `GET /api/groups` | `{success: true, groups: Array<Group & {memberCount: number}>}` |

역할과 그룹의 불변식(단위 2 §4.1): `role === 'superuser'` ⇔ `groupId === 'system:superuser'`. 역할을 바꾸면 서버가 그룹을 자동으로 옮긴다(superuser→`default`, regular→`system:superuser`). 그래서 이 화면은 `superuser` 를 고를 때 `groupId` 를 보내지 않는다.

라우트 패턴은 `/api/users/([^/]+)` 이다(U2-06). 사용자 id 는 `u_` + 16 hex 뿐이므로 경로에 그대로 붙인다(인코딩하지 않는다).

현재 저장소에서 그대로 쓰는 것: `admin/src/controller/AdminRequest.ts:36` `adminRequest`, `admin/src/controller/ServerOptionCtrl.ts:32-37` 싱글턴 패턴.

먼저 열어 볼 파일: `admin/src/App.svelte`, `admin/src/controller/MeCtrl.ts`, `admin/src/controller/Types.ts`, `admin/src/screens/TunnelsScreen.svelte`, `admin/src/screens/TunnelEditScreen.svelte`(하단 고정 바·삭제 모달의 본보기), `test/admin/screen-tunnels.test.ts`.

## 적용되는 결정

- D7 카드 목록 + 카드 탭 시 전체 화면 편집 → 사용자 목록도 같은 구조다.
- D5 UI 문구 영어 단일.
- D2 새 화면은 `ui/` 부품만 쓴다.

## 만들 것

### `admin/src/controller/UsersCtrl.ts` (신규)

```ts
class UsersCtrl {
    static get instance(): UsersCtrl;
    list(): Promise<ApiResult<{users: UserView[]}>>;                                   // GET    /api/users
    get(id: string): Promise<ApiResult<{user: UserView}>>;                             // GET    /api/users/:id
    create(input: {username: string; displayName?: string; role: Role; groupId?: string; temporaryPassword?: string})
        : Promise<ApiResult<{user: UserView; temporaryPassword: string}>>;             // POST   /api/users
    update(id: string, patch: {displayName?: string; role?: Role; status?: UserStatus; groupId?: string})
        : Promise<ApiResult<{user: UserView}>>;                                        // PUT    /api/users/:id
    remove(id: string): Promise<ApiResult<{}>>;                                        // DELETE /api/users/:id
    resetPassword(id: string, temporaryPassword?: string): Promise<ApiResult<{temporaryPassword: string}>>;   // POST /api/users/:id/password-reset
}
export default UsersCtrl;
```

요청 본문에서 `undefined` 필드는 보내지 않는다(`JSON.stringify` 가 자연히 뺀다). `id` 는 경로에 그대로 붙인다.

### `admin/src/controller/GroupsCtrl.ts` (신규, 이 이슈에서는 `list()` 하나)

```ts
class GroupsCtrl {
    static get instance(): GroupsCtrl;
    list(): Promise<ApiResult<{groups: Array<Group & {memberCount: number}>}>>;        // GET /api/groups
}
export default GroupsCtrl;
```

U3-04 가 나머지 메서드를 같은 파일에 추가한다. 두 이슈가 병렬로 진행되면 나중에 병합되는 쪽이 먼저 병합된 파일에 자기 메서드를 덧붙인다.

### `admin/src/screens/UsersScreen.svelte` (신규, `#/users`)

마운트 시 `UsersCtrl.instance.list()`. 실패(`success: false`)면 `toast.push({tone: 'alarm', message})`.

| 요소 | 규칙 |
|---|---|
| 상단 `Button variant="primary"` "Add user" | `navigate('#/users/new')` |
| `TextInput id="users-filter" placeholder="Filter by name or group"` | 클라이언트 필터. 입력값을 소문자로 바꿔 `username`, `displayName`, `groupName` 의 소문자에 부분 일치하는 사용자만 남긴다. 빈 입력은 전부 |
| 사용자마다 `Card compact` + `data-user-id={user.id}` | 1행: `{displayName}` + `Chip tone={role === 'superuser' ? 'signal' : 'neutral'}` 문구 `{role}`(`superuser` / `regular` 그대로) + `Badge tone={status === 'active' ? 'pulse' : 'alarm'}` 문구 `{status}`(`active` / `disabled`). `mustChangePassword` 면 `Chip tone="warn"` "temp password". 2행(`.mono`): `@{username} · {groupName}`. 카드 클릭 → `navigate('#/users/' + id)` |
| 목록이 비면 | `<p>` "No users match." (`--ink-2`) |

정렬은 서버가 준 순서 그대로.

### `admin/src/screens/parts/TempPasswordModal.svelte` (신규)

props: `open: $bindable<boolean>`, `username: string`, `password: string`, `ondone: () => void`.

`Modal title="Temporary password" closeOnOverlay={false}` 안에:
- `<p id="temp-password-username" class="mono">@{username}</p>`
- `<p id="temp-password-value" class="mono" style="font-size: var(--fs-2xl)">{password}</p>`
- `<p>` "This password is shown only once. Send it to the user through a channel you trust."
- footer: `Button` "Copy" → `navigator.clipboard.writeText(password)` 를 `await` 하되 거부(reject)되면 무시한다(`.catch(() => {})`). 성공·실패 모두 화면 변화 없음. `Button variant="primary"` "Done" → `open = false`.
- `open` 이 true 에서 false 로 바뀌는 모든 경로("Done", `Modal` 의 Escape)에서 한 번 `ondone()` 을 부른다(`$effect` 로 감시). 부모는 `ondone` 에서 `password = ''` 로 지운다.

### `admin/src/screens/UserEditScreen.svelte` (신규, `#/users/new`, `#/users/:id`)

`isNew = param === 'new'`. 마운트 시 `GroupsCtrl.instance.list()` 로 그룹 목록을 받고(`id !== 'system:superuser'` 만 남김), `isNew` 가 아니면 `UsersCtrl.instance.get(id)`. `get` 이 `success: false` 면 `navigate('#/users')`.

폼 상태: `username`, `displayName`, `role`(기본 `'regular'`), `groupId`(기본 `'default'`), `status`, `tempAuto`(기본 `true`), `tempPassword`. 수정 화면은 로드된 값과 비교해 `dirty` 를 계산한다.

| 요소 | 규칙 |
|---|---|
| `Field label="Username" hint="3–32 chars, lowercase letters, digits, . _ -" for="user-username"` + `TextInput id="user-username" autocomplete="off"` | `isNew` 가 아니면 `disabled` |
| `Field label="Display name" for="user-display-name"` + `TextInput id="user-display-name"` | 비어 있으면 요청에서 뺀다 |
| `Field label="Role" for="user-role"` + `Select id="user-role" options=[{value:'superuser',label:'Superuser'},{value:'regular',label:'Regular'}]` | |
| `Field label="Group" for="user-group"` + `Select id="user-group"` | `role === 'regular'` 일 때만 그린다. options 는 그룹 목록(`system:superuser` 제외)의 `{value: id, label: name}` |
| `Field label="Status" for="user-status"` + `Select id="user-status" options=[{value:'active',label:'Active'},{value:'disabled',label:'Disabled'}]` | `isNew` 가 아닐 때만 |
| 생성 시 `Card label="Temporary password"` | `Checkbox id="user-temp-auto" label="Generate automatically"`(기본 checked). 해제하면 `Field label="Temporary password" hint="At least 8 characters." for="user-temp-password"` + `TextInput type="password" id="user-temp-password" autocomplete="new-password"` 가 나타난다 |
| `<p id="user-form-error" role="alert">` | 저장 오류 문구. 비어 있으면 그리지 않는다 |
| 하단 고정 바(`TunnelEditScreen` 과 같은 배치) | 생성: `Button variant="primary"` "Create user". 수정: `Button variant="primary"` "Save"(`dirty` 가 아니면 `disabled`), `Button` "Reset password", `Button variant="danger"` "Delete". 요청 중에는 전부 `disabled` |

클라이언트 검증(제출 시, 첫 오류만 해당 `Field` 의 `error` 로):

| 조건 | 필드 | 문구 |
|---|---|---|
| `isNew` 이고 `username` 이 `/^[a-z0-9._-]{3,32}$/` 에 맞지 않음 | `user-username` | "Username must be 3–32 chars, lowercase letters, digits, . _ -" |
| `isNew` 이고 `!tempAuto` 이고 `tempPassword.length < 8` | `user-temp-password` | "Use at least 8 characters." |

`#user-role` 을 `regular` 로 바꿨을 때 `groupId` 가 `'system:superuser'` 이면(슈퍼유저 강등) `groupId = 'default'` 로 바꾼다(`#user-group` 의 초기 선택이 된다).

생성: `create({username, displayName?, role, groupId: role === 'regular' ? groupId : undefined, temporaryPassword: tempAuto ? undefined : tempPassword})`. 성공 → `TempPasswordModal` 을 연다(`username = user.username`, `password = temporaryPassword`). `ondone` → `password = ''` 로 지우고 `navigate('#/users/' + user.id)`.

수정: `update(id, patch)` 에 바뀐 필드만 담는다. `role` 이 `'superuser'` 면 `groupId` 를 담지 않는다. `role` 이 `'superuser'` 에서 `'regular'` 로 바뀌면 `groupId` 를 반드시 담는다. 성공 → `toast.push({tone: 'pulse', message: 'User saved.'})` 후 `get(id)` 로 다시 읽어 폼을 갱신한다(화면 이동 없음).

저장 오류 코드 → `#user-form-error` 문구:

| `code` | 문구 |
|---|---|
| `username_taken` | "That username is already in use." |
| `last_superuser` | "At least one active superuser must remain." |
| 그 외 | 서버 `message` 그대로 |

"Reset password": `Modal title="Reset password"` 본문 `Issue a new temporary password for @{username}? Their current sessions will be signed out.` footer `Button` "Cancel", `Button variant="primary"` "Issue password" → 확인 모달을 닫고(`open = false`) `resetPassword(id)` → 성공이면 `TempPasswordModal`(`ondone` 은 화면 이동 없이 `password = ''` 후 `get(id)` 재조회), 실패면 `toast.push({tone: 'alarm', message})`.

"Delete": `Modal title="Delete user"` 본문 `Delete @{username}? This cannot be undone.` footer `Button` "Cancel", `Button variant="danger"` "Delete user" → 확인 모달을 닫고 `remove(id)`.

| 결과 | 동작 |
|---|---|
| 성공 | `toast.push({tone: 'pulse', message: 'User deleted.'})` → `navigate('#/users')` |
| `code === 'user_owns_tunnels'` | `toast.push({tone: 'alarm', message: "Reassign this user's tunnels first."})` |
| 그 외 실패 | `toast.push({tone: 'alarm', message})` |

## 변경할 것

- `admin/src/App.svelte`: `users` 분기의 placeholder 를 `<UsersScreen/>` 으로, `user-edit` 분기를 `<UserEditScreen param={$route.param}/>` 으로 바꾼다. title/back 표는 U3-01 그대로.
- `test/admin/screen-access.test.ts`: admin 의 `#/users` placeholder 단언을 "`[data-user-id]` 카드가 5개" 로 바꾼다.

## 하지 말 것

- 그룹 편집·생성 화면을 만들지 않는다(U3-04). `GroupsCtrl` 은 `list()` 만.
- 임시 비밀번호를 `localStorage`·URL·토스트·콘솔 어디에도 남기지 않는다. 모달이 닫히면 컴포넌트 상태에서도 지운다(`password = ''`).
- `Modal` 에 Escape 차단 같은 새 prop 을 추가하지 않는다(단위 1 계약 유지).
- 자기 자신(로그인한 admin)의 편집을 막지 않는다. 마지막 슈퍼유저 보호는 서버의 409 를 그대로 보여 준다.
- 사용자 삭제 전에 터널을 자동 재할당하지 않는다(재할당은 U3-06 의 터널 편집 화면).
- 백엔드(`src/**`)를 수정하지 않는다.
- Svelte 5 룬만 쓴다. `export let`, `createEventDispatcher` 금지. `.svelte` 안 hex 색상 금지. `ui/` 밖에서 새 스타일 클래스를 만들지 않는다.

## 수용 기준

`test/admin/screen-users.test.ts` (신규). 모든 케이스는 `startAdminApp({fixture: 'rbac'})`(admin)로 시작해 `page.goto(url + '#/users')` 로 들어가고, `finally` 에서 `close()` 하며, `expect(errors).toEqual([])` 로 끝난다. 각 `test()` 는 앱을 새로 띄운다(fixture 가 초기화된다). 버튼은 `getByRole('button', {name, exact: true})` 로 찾는다("Delete" 와 "Delete user" 를 구분하기 위해).

- `#/users` 에 `[data-user-id]` 카드가 5개이면 통과한다. `[data-user-id="u_0000000000000001"]` 의 텍스트에 `Admin`, `superuser`, `active`, `@admin · Superusers` 가 있고, `[data-user-id="u_0000000000000005"]` 에 "temp password" 가 있으며 `[data-user-id="u_0000000000000002"]` 에는 없다.
- `#users-filter` 에 `field` 를 넣으면 카드가 3개(alice·bob·dave)이고, `zzz` 를 넣으면 0개에 "No users match." 가 보이며, 비우면 5개이다.
- `[data-user-id="u_0000000000000002"]` 를 클릭하면 해시가 `#/users/u_0000000000000002` 이고, `#user-username` 의 값이 `alice` 이며 `disabled` 이고, `#user-display-name` 이 `Alice`, `#user-role` 이 `regular`, `#user-group` 이 `g_0000000000000001`, `#user-status` 가 `active` 이다. 버튼 "Save" 는 `disabled` 이다. `[aria-label="Back"]` 을 누르면 `#/users` 이다.
- "Add user" 를 누르면 해시가 `#/users/new` 이고 `#user-username` 이 편집 가능하며 `#user-status` 가 없고 `#user-temp-auto` 가 checked 이며 `#user-temp-password` 가 없다.
- 새 사용자 `erin`(`#user-display-name` `Erin`, role `regular`, group `g_0000000000000001`)을 "Create user" 로 만들면 `#temp-password-username` 이 `@erin` 이고 `#temp-password-value` 가 `/^[A-Za-z0-9]{16}$/` 에 맞으며, "Done" 을 누르면 해시가 `/^#\/users\/u_[0-9a-f]{16}$/` 에 맞고 `#user-username` 값이 `erin` 이며 `disabled` 이다. `#/users` 로 돌아가면 카드가 6개이고 erin 카드에 "temp password" 와 `@erin · Field team` 이 있다.
- 새 사용자 화면에서 `#user-username` 에 `frank` 를 넣고 `#user-temp-auto` 를 해제하면 `#user-temp-password` 가 나타나고, `short` 를 넣고 "Create user" 를 누르면 "Use at least 8 characters." 가 보이며, `manual-pass-1234` 로 바꿔 누르면 `#temp-password-username` 이 `@frank` 이고 `#temp-password-value` 가 `manual-pass-1234` 이다.
- 새 사용자 이름 `AB` 로 "Create user" 를 누르면 "Username must be 3–32 chars, lowercase letters, digits, . _ -" 가 보이고 해시는 `#/users/new` 이다.
- 새 사용자 이름 `alice` 로 "Create user" 를 누르면 `#user-form-error` 가 "That username is already in use." 이고 해시는 `#/users/new` 이다.
- alice 의 `#user-role` 을 `superuser` 로 바꾸면 `#user-group` 이 사라지고, "Save" 를 누르면 토스트 "User saved." 가 보이며, `#/users` 의 alice 카드에 `superuser` 와 `@alice · Superusers` 가 있다.
- bob 의 `#user-status` 를 `disabled` 로 바꿔 "Save" 하면 `#/users` 의 bob 카드에 `disabled` 가 있다.
- admin 의 `#user-role` 을 `regular` 로 바꾸면 `#user-group` 이 나타나고 값이 `default` 이며, "Save" 하면 `#user-form-error` 가 "At least one active superuser must remain." 이다. `#user-role` 을 `superuser` 로 되돌리고 `#user-status` 를 `disabled` 로 바꿔 "Save" 해도 같은 문구이다.
- alice 에서 "Delete" → 모달의 "Delete user" 를 누르면 토스트 "Reassign this user's tunnels first." 가 보이고 해시는 `#/users/u_0000000000000002` 그대로이다.
- carol 에서 "Delete" → "Delete user" 를 누르면 토스트 "User deleted." 가 보이고 해시가 `#/users` 이며 카드가 4개이다.
- bob 에서 "Reset password" 를 누르면 모달 본문에 `@bob` 이 있고, "Issue password" 를 누르면 `#temp-password-value` 가 16자이며, "Done" 을 누르면 해시가 `#/users/u_0000000000000003` 이고 `#/users` 의 bob 카드에 "temp password" 가 있다.

기존 `test/admin/*.test.ts` 와 U3-01·U3-02 의 테스트가 통과한다(`screen-access` 의 갱신 포함).

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm --prefix admin run check
npm run lint
npm run test:admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건, 제목에 단계 표식 0건 확인
```

## 선행 · 후행

- 선행: U3-01. (U3-02·U3-04 와 병렬 가능.)
- 후행: U3-06(터널 편집의 "Owner" 목록이 `UsersCtrl.list()` 를 쓴다).

## 근거 문서

- `docs/design/2026-09-11-unit3-rbac-screens.md` §2(`UsersCtrl`), §4.1(`UsersScreen`), §4.2(`UserEditScreen`), §5(`screen-users`), §6(U3-03)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §4.1(불변식), §5.2(`/api/users*`, `/api/groups`)
- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §6(부품 계약), §7.4(하단 고정 바·삭제 모달)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.1(FR-USER-*), §6.1, §12 Q2

---

## U3-04

**title**: feat(admin): 그룹 목록·편집 화면과 속성 11종 입력
**labels**: enhancement, area:frontend, unit:3
**body**:
## 목적

슈퍼유저가 그룹을 만들고 속성 11종을 화면에서 편집·검토할 수 있게 한다. 이 이슈가 끝나면 PRD §6.1 의 2 단계(그룹 속성 검토)가 화면에서 끝나고, `system:superuser` 는 읽기 전용, `default` 는 이름만 읽기 전용으로 보인다.

## 배경

**착수 시점에 아래 표의 파일과 심볼이 실제로 있는지 먼저 확인한다. 하나라도 없거나 시그니처가 다르면 이슈에 코멘트를 남기고 중단한다.** 단위 2 이슈 ID 는 단위 2 설계 §9 기준이다.

| 출처 | 경로 | 이 이슈가 쓰는 계약 |
|---|---|---|
| U3-01 | `admin/src/router.ts` | `#/groups` → `groups`, `#/groups/new` → `group-edit`(`new`), `#/groups/<g_16hex \| default \| system:superuser>` → `group-edit`(id) |
| U3-01 | `admin/src/App.svelte` | `groups`·`group-edit` 분기의 `#screen-placeholder`. title "Groups" / "New group" / "Group", back `#/groups` |
| U3-01 | `admin/src/controller/Types.ts` | `Group`, `GroupAttributes`, `TunnelProtocolName`, `UserView`, `ApiResult<T>` |
| U3-01 | `test/helpers/adminApp.ts`, fixture `rbac` | 그룹 3개(`system:superuser` "Superusers" 멤버 1, `default` "Default" 멤버 1, `g_0000000000000001` "Field team" 멤버 3), `trustedClients` `client-a` "Client A"·`client-b` "Client B" |
| U3-03 | `admin/src/controller/GroupsCtrl.ts` | `list()` 가 이미 있으면 그 파일에 추가한다. 없으면 이 이슈가 파일을 만든다 |
| U1-02 | `admin/src/ui/{Button,Field,TextInput,NumberInput,Select,Checkbox,Card,Chip}.svelte` | 단위 1 §6 표. `NumberInput`: `value: $bindable<number \| null>`(빈 입력은 `null`), `id`, `min`, `max`, `step`, `disabled`, `invalid?` |
| U1-03 | `admin/src/ui/Modal.svelte`, `admin/src/ui/toast.ts` | `Modal`: `open`(bindable), `title`, `closeOnOverlay`, `footer` 스니펫 |
| U1-08 | `admin/src/screens/TunnelsScreen.svelte` | `Card` 에 `data-port` 를 다는 방식(같은 방식으로 `data-group-id`) |
| 기존 | `admin/src/controller/Types.ts` `ServerOption` | 관리자 UI 의 서버 옵션 타입. 이 이슈가 `trustedClients` 를 추가한다 |
| 기존 | `admin/src/controller/ServerOptionCtrl.ts:43-55` `getServerOption()` | `{value: ServerOption, revision}`. 직접 `fetch` 이며 401 이면 `InvalidSession` 을 던진다. 서버 응답 `serverOption` 에 `trustedClients` 가 그대로 담겨 온다(`src/server/admin/AdminServer.ts:1149-1164`) |
| U2-06 | `GET /api/groups` | `{success: true, groups: Array<Group & {memberCount: number}>}` |
| U2-06 | `GET /api/groups/:id` | `{success: true, group: Group, members: UserView[]}`. `system:superuser` 의 `attributes` 는 `{}` 이거나 기본값 전체다(단위 2 §3 예시는 `{}`, U2-01 의 `createSystemGroups()` 는 기본값). 어느 쪽이든 기본값으로 표시한다 |
| U2-06 | `POST /api/groups` | 요청 `{name, attributes?}`(미지정 속성은 기본값). 응답 `{success: true, group}`. 422 |
| U2-06 | `PUT /api/groups/:id` | 요청 `{name?, attributes?}`. 응답 `{success: true, group}`. 422(정합성·시스템 그룹) |
| U2-06 | `DELETE /api/groups/:id` | `{success: true}`. 409 `group_not_empty`, 422(시스템 그룹) |

서버의 정합성 규칙(단위 2 §3, 저장 시 422): `allowed_protocols` 에 `HTTP_REWRITE` 가 없으면 `http_tunnel_rewrite_permissions` 는 모두 false 여야 한다. `HTTP_REWRITE` 는 `HTTP` 또는 `HTTPS` 없이 단독 허용 불가. 포트 범위 각 항목은 1..65535 이고 `from ≤ to`. `system:superuser` 는 어떤 수정도 422. `default` 는 속성만 수정 가능.

`rate_limit` 저장 리터럴은 공백 없는 `'1MB/s'` 이고 UI 라벨은 공백을 넣은 "1 MB/s" 다(단위 2 §3).

라우트 패턴은 `/api/groups/([^/]+)` 이다(U2-06). 그룹 id 는 `g_` + 16 hex, `default`, `system:superuser` 뿐이므로 경로에 그대로 붙인다(인코딩하지 않는다. `encodeURIComponent` 는 `:` 를 `%3A` 로 바꾸므로 쓰지 않는다).

먼저 열어 볼 파일: `admin/src/controller/GroupsCtrl.ts`, `admin/src/controller/Types.ts`, `admin/src/controller/ServerOptionCtrl.ts`, `admin/src/screens/TunnelEditScreen.svelte`(하단 바·모달의 본보기).

## 적용되는 결정

- D7 카드 목록 + 카드 탭 시 전체 화면 편집.
- D5 UI 문구 영어 단일.
- D2 새 화면은 `ui/` 부품만 쓴다.

## 만들 것

### `admin/src/controller/GroupsCtrl.ts` (U3-03 의 `list()` 에 추가)

```ts
class GroupsCtrl {
    static get instance(): GroupsCtrl;
    list(): Promise<ApiResult<{groups: Array<Group & {memberCount: number}>}>>;        // GET    /api/groups
    get(id: string): Promise<ApiResult<{group: Group; members: UserView[]}>>;          // GET    /api/groups/:id
    create(input: {name: string; attributes: GroupAttributes}): Promise<ApiResult<{group: Group}>>;   // POST /api/groups
    update(id: string, patch: {name?: string; attributes?: GroupAttributes}): Promise<ApiResult<{group: Group}>>;   // PUT /api/groups/:id
    remove(id: string): Promise<ApiResult<{}>>;                                        // DELETE /api/groups/:id
}
```

### `admin/src/controller/Types.ts` (추가)

- `ServerOption` 에 `trustedClients?: Array<{clientId: string; displayName?: string}>` 를 추가한다(`clientSecret` 은 타입에 넣지 않고 화면에서도 쓰지 않는다).
- `export const DEFAULT_GROUP_ATTRIBUTES: GroupAttributes` — 단위 2 §3 기본값(`tunnel_crud: 'full'`, `max_tunnel_count: 10`, `max_tunnel_duration_ms: 0`, `allowed_port_range: []`, `allowed_protocols: []`, `max_concurrent_connections: 100`, `allowed_trusted_clients: []`, `http_tunnel_rewrite_permissions` 모두 false, `admin_ui_section_access` 네 개 전부, `tunnel_visibility: 'private'`, `rate_limit: 'unlimited'`). 새 그룹 폼의 초기값이자 `system:superuser` 의 표시용 값.

### `admin/src/screens/parts/groupSummary.ts` (신규, 순수 함수)

```ts
export function summarizeAttributes(a: GroupAttributes): string;
```

형식(구분자는 ` · `): `crud={tunnel_crud} · tunnels≤{max_tunnel_count} · ports {ranges} · {protocols}`. `ranges` 는 각 항목을 `{from}-{to}` 로 만들어 `, ` 로 잇고 비어 있으면 `none`. `protocols` 는 배열을 고정 순서 `TCP, HTTP, HTTPS, HTTP_REWRITE` 로 정렬해 `,` 로 잇고 비어 있으면 `none`(서버가 돌려주는 순서에 기대지 않는다). 예: Field team → `crud=full · tunnels≤2 · ports 20000-20099 · TCP,HTTP,HTTP_REWRITE`, Default → `crud=full · tunnels≤10 · ports none · none`.

### `admin/src/screens/GroupsScreen.svelte` (신규, `#/groups`)

마운트 시 `GroupsCtrl.instance.list()`. 실패면 `toast.push({tone: 'alarm', message})`.

| 요소 | 규칙 |
|---|---|
| 상단 `Button variant="primary"` "Add group" | `navigate('#/groups/new')` |
| 그룹마다 `Card compact` + `data-group-id={group.id}` | 1행: `{name}` + (`system` 이면 `Chip` "system") + `<span class="mono">Members: {memberCount}</span>`. 2행(`.mono`, `--ink-2`): `id === 'system:superuser'` 면 "Superusers are not limited by attributes.", 아니면 `summarizeAttributes(attributes)`. 카드 클릭 → `navigate('#/groups/' + id)` |

### `admin/src/screens/GroupEditScreen.svelte` (신규, `#/groups/new`, `#/groups/:id`)

`isNew = param === 'new'`, `isSuperuserGroup = param === 'system:superuser'`, `isDefaultGroup = param === 'default'`. 마운트 시 `ServerOptionCtrl.instance.getServerOption()` 으로 `trustedClients` 를 받고(`InvalidSession` 은 잡지 않는다. 그 밖의 예외는 `toast.push({tone: 'alarm', message: 'Could not load trusted clients.'})` 후 빈 목록), `isNew` 가 아니면 `GroupsCtrl.instance.get(id)`(실패 → `navigate('#/groups')`). 폼 상태: `name`, `attrs: GroupAttributes`, `durationHours = Math.floor(attrs.max_tunnel_duration_ms / 3_600_000)`. `attrs` 의 초기값은 새 그룹이면 `DEFAULT_GROUP_ATTRIBUTES` 의 깊은 복사, 기존 그룹이면 `{...DEFAULT_GROUP_ATTRIBUTES, ...group.attributes}` 의 깊은 복사(`system:superuser` 의 `{}` 는 기본값으로 **표시만** 한다).

`readOnly = isSuperuserGroup`. `readOnly` 면 모든 입력이 `disabled` 이고 하단 바를 그리지 않으며 어떤 요청도 보내지 않고, 상단에 `<p id="group-readonly-note">` "Superusers are not limited by attributes." 를 그린다. `isDefaultGroup` 이면 `#group-name` 만 `disabled`.

상단: `Field label="Name" for="group-name"` + `TextInput id="group-name"`.

세 `Card`. 입력 id 는 `group-attr-<속성키>`, 체크박스 목록은 `group-attr-<속성키>-<값>`.

| `Card label` | 속성 | 부품 |
|---|---|---|
| "Tunnel permissions" | `tunnel_crud` | `Field label="Tunnel access"` + `Select id="group-attr-tunnel_crud" options=[{value:'none',label:'None'},{value:'read_only',label:'Read only'},{value:'full',label:'Full'}]` |
| | `max_tunnel_count` | `Field label="Max tunnels" hint="0 disables tunnel creation"` + `NumberInput id="group-attr-max_tunnel_count" min={0} max={1000} step={1}` |
| | `max_tunnel_duration_ms` | `Field label="Max tunnel duration (hours)" hint="0 = unlimited"` + `NumberInput id="group-attr-max_tunnel_duration_ms" min={0} max={8760} step={1}` — 값은 `durationHours`. 저장 시 `× 3_600_000` |
| | `allowed_port_range` | 행마다 `<div data-range-index={i}>` 안에 `NumberInput id="group-attr-allowed_port_range-{i}-from" min={1} max={65535}`, `NumberInput id="group-attr-allowed_port_range-{i}-to" min={1} max={65535}`, `Button size="sm"` "Remove". 아래 `Button size="sm"` "Add range" → `{from: 1, to: 65535}` 행 추가. 행이 없으면 `<p>` "No ports are allowed." |
| | `allowed_protocols` | `Checkbox id="group-attr-allowed_protocols-TCP" label="TCP"`, `-HTTP` "HTTP", `-HTTPS` "HTTPS", `-HTTP_REWRITE` "HTTP rewrite" |
| | `http_tunnel_rewrite_permissions` | `Checkbox id="group-attr-http_tunnel_rewrite_permissions-cors" label="CORS"`, `-host` "Host", `-header` "Headers", `-body` "Body". `allowed_protocols` 에 `HTTP_REWRITE` 가 없으면 넷 다 `disabled` 이고 `false` 로 되돌린다(`$effect`) |
| | `allowed_trusted_clients` | `trustedClients` 마다 `Checkbox id="group-attr-allowed_trusted_clients-{clientId}" label={displayName ?? clientId}`. 목록이 비면 `<p>` "No trusted clients are registered." |
| "Limits" | `max_concurrent_connections` | `Field label="Max concurrent connections"` + `NumberInput id="group-attr-max_concurrent_connections" min={0} max={100000} step={1}` |
| | `rate_limit` | `Field label="Bandwidth"` + `Select id="group-attr-rate_limit" options=[{value:'unlimited',label:'Unlimited'},{value:'1MB/s',label:'1 MB/s'},{value:'10MB/s',label:'10 MB/s'},{value:'100MB/s',label:'100 MB/s'}]` |
| "Visibility" | `admin_ui_section_access` | `Checkbox id="group-attr-admin_ui_section_access-tunnels" label="Tunnels"`, `-my_audit` "My audit log", `-my_profile` "My profile", `-my_sessions` "My sessions" |
| | `tunnel_visibility` | `Field label="Tunnel visibility"` + `Select id="group-attr-tunnel_visibility" options=[{value:'private',label:'Private'},{value:'group_read',label:'Readable by group'}]` |

체크박스 목록 ↔ 배열 변환: 체크된 항목의 값을 표 순서대로 모아 배열로 만든다. `NumberInput` 값이 `null`(빈 입력)이면 `max_tunnel_count`·`durationHours`·`max_concurrent_connections` 는 `0` 으로 저장하고, 포트 범위의 `from`/`to` 는 `null` 그대로 보내 서버의 422 를 받는다(`#group-form-error`).

"Tunnel permissions" 카드 맨 위에 `<p id="group-form-error" role="alert">`(비어 있으면 그리지 않음). 저장 실패의 `message` 를 여기에 표시한다(코드 무관).

하단 고정 바: 생성 `Button variant="primary"` "Create group"; 수정 `Button variant="primary"` "Save"(변경 없으면 `disabled`) + `Button variant="danger"` "Delete"(`group.system` 이면 그리지 않음). 요청 중 전부 `disabled`.

클라이언트 검증: `name.trim()` 이 비어 있으면 `Field` error "Enter a group name." 만. 포트 범위·정합성은 서버에 맡긴다(422 → `#group-form-error`).

저장: 생성은 `create({name, attributes})`, 수정은 `update(id, {name?: 바뀐 경우만, attributes: 전체})`(`isDefaultGroup` 이면 `name` 을 절대 보내지 않는다). 성공 → 생성이면 `navigate('#/groups/' + group.id)`, 수정이면 `toast.push({tone: 'pulse', message: 'Group saved.'})` 후 `get(id)` 재조회.

"Delete": `Modal title="Delete group"` 본문 `Delete {name}? This cannot be undone.` footer "Cancel", `Button variant="danger"` "Delete group" → 확인 모달을 닫고 `remove(id)`.

| 결과 | 동작 |
|---|---|
| 성공 | `toast.push({tone: 'pulse', message: 'Group deleted.'})` → `navigate('#/groups')` |
| `code === 'group_not_empty'` | `toast.push({tone: 'alarm', message: 'Move the members to another group first.'})` |
| 그 외 실패 | `toast.push({tone: 'alarm', message})` |

## 변경할 것

- `admin/src/App.svelte`: `groups` 분기의 placeholder 를 `<GroupsScreen/>` 으로, `group-edit` 분기를 `<GroupEditScreen param={$route.param}/>` 으로 바꾼다.
- `admin/src/controller/Types.ts`: 위 두 항목 추가.
- `test/admin/screen-access.test.ts`: admin 의 `#/groups` placeholder 단언을 "`[data-group-id]` 카드가 3개" 로 바꾼다.

## 하지 말 것

- 멤버 목록·멤버 이동 UI 를 만들지 않는다(멤버 배정은 U3-03 의 사용자 편집에서 한다). `get()` 의 `members` 는 이 이슈에서 쓰지 않는다.
- 클라이언트에서 정합성 규칙을 서버와 중복 구현하지 않는다. 자동 해제 하나(HTTP rewrite 꺼짐 → 리라이트 권한 false)만 클라이언트에 둔다.
- `rate_limit` 라벨을 저장 값으로 보내지 않는다(`'1 MB/s'` 가 아니라 `'1MB/s'`).
- `system:superuser` 화면에서 어떤 요청도 보내지 않는다(표시용 기본값을 저장하지 않는다).
- 서버 옵션 화면이나 `trustedClients` 편집 기능을 만들지 않는다.
- 백엔드(`src/**`)를 수정하지 않는다.
- Svelte 5 룬만 쓴다. `export let`, `createEventDispatcher` 금지. `.svelte` 안 hex 색상 금지. `ui/` 밖에서 새 스타일 클래스를 만들지 않는다.

## 수용 기준

- `test/admin/groupSummary.test.ts` (신규, 순수 함수)
  - Field team 속성이면 `crud=full · tunnels≤2 · ports 20000-20099 · TCP,HTTP,HTTP_REWRITE` 이다.
  - `DEFAULT_GROUP_ATTRIBUTES` 이면 `crud=full · tunnels≤10 · ports none · none` 이다.
  - 범위가 두 개(`20000-20099`, `30000-30010`)이면 `ports 20000-20099, 30000-30010` 을 포함한다.
- `test/admin/screen-groups.test.ts` (신규). 모든 케이스는 `startAdminApp({fixture: 'rbac'})`(admin)로 시작해 `#/groups` 로 들어가고, `finally` 에서 `close()` 하며, `expect(errors).toEqual([])` 로 끝난다. 버튼은 `getByRole('button', {name, exact: true})` 로 찾는다.
  - `[data-group-id]` 카드가 3개이면 통과한다. `[data-group-id="system:superuser"]` 에 `Superusers`, "system", `Members: 1`, "Superusers are not limited by attributes." 가 있다. `[data-group-id="g_0000000000000001"]` 에 `Field team`, `Members: 3`, `crud=full · tunnels≤2 · ports 20000-20099 · TCP,HTTP,HTTP_REWRITE` 가 있다. `[data-group-id="default"]` 에 `Members: 1` 과 `ports none` 이 있다.
  - "Add group" 을 누르면 해시가 `#/groups/new` 이고 `#group-attr-max_tunnel_count` 가 `10`, `#group-attr-tunnel_crud` 가 `full`, `#group-attr-allowed_protocols-TCP` 가 unchecked, `#group-attr-http_tunnel_rewrite_permissions-cors` 가 `disabled`, `#group-attr-allowed_trusted_clients-client-a` 와 `-client-b` 가 있으며 라벨이 "Client A", "Client B" 이다.
  - 새 그룹에 `#group-name` `Lab`, `tunnel_crud` `read_only`, `max_tunnel_count` `5`, duration `12`, "Add range" 후 `#group-attr-allowed_port_range-0-from` `30000`·`-0-to` `30010`, 프로토콜 HTTP·HTTPS·HTTP rewrite, 리라이트 CORS·Body, 트러스티드 `client-b`, 동시 연결 `50`, 대역폭 `10MB/s`, 섹션 Tunnels·My profile 만, 가시성 `group_read` 를 넣고 "Create group" 을 누르면 해시가 `/^#\/groups\/g_[0-9a-f]{16}$/` 에 맞고, `page.reload()` 뒤에 위 값이 전부 그대로이다(`#group-attr-max_tunnel_duration_ms` 는 `12`, `#group-attr-allowed_protocols-TCP` unchecked, `-my_audit` unchecked, `-client-a` unchecked). `#/groups` 로 돌아가면 카드가 4개이고 Lab 카드에 `crud=read_only · tunnels≤5 · ports 30000-30010 · HTTP,HTTPS,HTTP_REWRITE` 가 있다.
  - 새 그룹에 이름 `Bad` 와 프로토콜 HTTP rewrite 만 체크하고 "Create group" 을 누르면 `#group-form-error[role=alert]` 에 비어 있지 않은 문구가 보이고 해시는 `#/groups/new` 이다.
  - 새 그룹에 이름 `Bad2`, 범위 `40000`–`30000`(from > to) 을 넣고 "Create group" 을 누르면 `#group-form-error` 가 보이고 해시는 `#/groups/new` 이다.
  - 이름을 비우고 "Create group" 을 누르면 "Enter a group name." 이 보인다.
  - 새 그룹에서 HTTP rewrite 를 체크하면 `#group-attr-http_tunnel_rewrite_permissions-cors` 가 enabled 이고, CORS 를 체크한 뒤 HTTP rewrite 를 해제하면 CORS 가 `disabled` 이고 unchecked 이다.
  - `[data-group-id="system:superuser"]` 를 클릭하면 해시가 `#/groups/system:superuser` 이고 `#group-readonly-note` 가 보이며 `#group-name`·`#group-attr-tunnel_crud`·`#group-attr-max_tunnel_count` 가 모두 `disabled` 이고 `#group-attr-max_tunnel_count` 의 값이 `10` 이며 버튼 "Save"·"Delete" 가 없다.
  - `[data-group-id="default"]` 를 클릭하면 `#group-name` 이 `disabled` 이고 `#group-attr-max_tunnel_count` 는 enabled 이며 "Delete" 가 없다. `max_tunnel_count` 를 `7` 로 바꿔 "Save" 하면 토스트 "Group saved." 가 보이고, `page.reload()` 뒤 값이 `7` 이다.
  - `[data-group-id="g_0000000000000001"]` 에서 "Delete" → "Delete group" 을 누르면 토스트 "Move the members to another group first." 가 보이고 해시는 `#/groups/g_0000000000000001` 이다.
  - 새 그룹 `Temp` 를 만든 뒤 그 화면에서 "Delete" → "Delete group" 을 누르면 토스트 "Group deleted." 가 보이고 해시가 `#/groups` 이며 카드가 3개이다.

기존 `test/admin/*.test.ts` 와 U3-01~03 의 테스트가 통과한다(`screen-access` 의 갱신 포함).

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm --prefix admin run check
npm run lint
npm run test:admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건, 제목에 단계 표식 0건 확인
```

## 선행 · 후행

- 선행: U3-01. (U3-02·U3-03 과 병렬 가능. `GroupsCtrl.ts` 를 U3-03 과 둘 다 만지므로 나중에 병합하는 쪽이 `list()` 중복을 정리한다.)
- 후행: U3-06.

## 근거 문서

- `docs/design/2026-09-11-unit3-rbac-screens.md` §2(`GroupsCtrl`), §4.3(`GroupsScreen`), §4.4(`GroupEditScreen`), §5(`screen-groups`), §6(U3-04)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §3(속성 11종·기본값·정합성 규칙), §4.1(시스템 그룹 불변식), §5.2(`/api/groups*`)
- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §6(부품 계약)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.2(FR-GROUP-*), §7(속성 매트릭스)

---

## U3-05

**title**: feat(admin): 내 계정 화면
**labels**: enhancement, area:frontend, unit:3
**body**:
## 목적

로그인한 사용자가 자기 계정 정보(사용자명·표시 이름·역할·그룹)를 보고 비밀번호 변경 화면으로 갈 수 있게 한다. 이 이슈가 끝나면 `#/me` 의 placeholder 가 실제 화면으로 바뀌고, PRD §6.2 의 4 단계(비밀번호 변경) 진입점이 생긴다.

## 배경

**착수 시점에 아래 표의 파일과 심볼이 실제로 있는지 먼저 확인한다. 하나라도 없거나 시그니처가 다르면 이슈에 코멘트를 남기고 중단한다.**

| 출처 | 경로 | 이 이슈가 쓰는 계약 |
|---|---|---|
| U3-01 | `admin/src/App.svelte` | `me` 분기의 `#screen-placeholder`. title "My account" |
| U3-01 | `admin/src/me.ts` | `me` 스토어 = `MeResponse \| undefined` (`user.username`, `user.displayName`, `user.role`, `group.name`) |
| U3-01 | `test/helpers/rbacFixture.ts` | `RBAC_PASSWORDS`. alice = "Alice", regular, "Field team"; admin = "Admin", superuser, "Superusers" |
| U3-02 | `admin/src/screens/PasswordChangeScreen.svelte` | `#/me/password`. 비강제 변경 성공 시 `#/me` 로 돌아온다 |
| U3-02 | `test/admin/screen-me.test.ts` | 비밀번호 변경 케이스. 이 이슈가 계정 카드 케이스를 추가한다 |
| U1-02 | `admin/src/ui/{Button,Card,Chip}.svelte` | `Card`: `label?`. `Chip`: `tone`, `mono?` |

먼저 열어 볼 파일: `admin/src/App.svelte`, `admin/src/me.ts`, `admin/src/screens/PasswordChangeScreen.svelte`, `test/admin/screen-me.test.ts`.

## 적용되는 결정

- D5 UI 문구 영어 단일.
- D2 새 화면은 `ui/` 부품만 쓴다.

## 만들 것

### `admin/src/screens/MeScreen.svelte` (신규, `#/me`)

`$me` 만 읽는다(API 호출 없음). `$me` 가 없으면 아무것도 그리지 않는다.

`Card label="Account"` 안에 `<dl>` 로 네 항목:

| `<dt>` | `<dd>` |
|---|---|
| "Username" | `<span id="me-username" class="mono">@{user.username}</span>` |
| "Display name" | `<span id="me-display-name">{user.displayName}</span>` |
| "Role" | `<span id="me-role"><Chip tone={user.role === 'superuser' ? 'signal' : 'neutral'}>{user.role}</Chip></span>` |
| "Group" | `<span id="me-group">{group.name}</span>` |

카드 아래 `Button variant="primary"` "Change password" → `navigate('#/me/password')`.

4 단위가 이 화면에 "Two-factor authentication" 카드와 "Sessions" 링크를 추가한다. 자리를 미리 비워 두지 않는다.

## 변경할 것

- `admin/src/App.svelte`: `me` 분기의 placeholder 를 `<MeScreen/>` 으로 바꾼다.
- `test/admin/screen-access.test.ts`: `#/me` 의 placeholder 단언(alice·admin 두 곳)을 "`#me-username` 이 보인다" 로 바꾼다.

## 하지 말 것

- 표시 이름 편집, MFA, 세션 목록을 만들지 않는다(4 단위).
- `/api/me` 를 다시 부르지 않는다. `$me` 스토어를 읽는다.
- 백엔드(`src/**`)를 수정하지 않는다.
- Svelte 5 룬만 쓴다. `export let`, `createEventDispatcher` 금지. `.svelte` 안 hex 색상 금지. `ui/` 밖에서 새 스타일 클래스를 만들지 않는다.

## 수용 기준

`test/admin/screen-me.test.ts` (U3-02 파일에 추가). `startAdminApp({fixture: 'rbac', login?})`, `finally close()`, `expect(errors).toEqual([])`.

- alice 가 `#/me` 로 가면 `#me-username` 이 `@alice`, `#me-display-name` 이 `Alice`, `#me-role` 이 `regular`, `#me-group` 이 `Field team` 이고 `#screen-placeholder` 가 없다.
- alice 가 "Change password" 를 누르면 해시가 `#/me/password` 이고, `[aria-label="Back"]` 을 누르면 `#/me` 이다.
- alice 가 드로어에서 "My account" 를 고르면 해시가 `#/me` 이다.
- admin 이 `#/me` 로 가면 `#me-role` 이 `superuser`, `#me-group` 이 `Superusers` 이다.
- U3-02 의 "올바른 현재 비밀번호로 바꾸면 해시가 `#/me`" 케이스에서, 도착한 화면에 `#me-username` 이 `@alice` 로 보인다(해당 케이스에 단언 한 줄 추가).

기존 `test/admin/*.test.ts` 전부(갱신한 `screen-access` 포함)가 통과한다.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm --prefix admin run check
npm run lint
npm run test:admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건, 제목에 단계 표식 0건 확인
```

## 선행 · 후행

- 선행: U3-02.
- 후행: U4-07(MFA 카드·세션 카드가 이 화면에 들어온다).

## 근거 문서

- `docs/design/2026-09-11-unit3-rbac-screens.md` §4.5(`MeScreen`), §5(`screen-me` 계정 카드), §6(U3-05)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §5.2(`GET /api/me`), §7(`session.ts`)
- `docs/plan/prd/TTTGate-admin-rbac.md` §6.2

---

## U3-06

**title**: feat(admin): 터널 화면에 소유권 표시와 그룹 속성 제한 반영
**labels**: enhancement, area:frontend, unit:3
**body**:
## 목적

터널 목록·편집 화면이 소유자와 그룹 속성을 반영하게 한다. 일반 유저는 자기 터널만 편집하고 그룹이 허용한 포트·프로토콜·리라이트·트러스티드 클라이언트 안에서만 입력할 수 있으며, 한도에 걸리면 추가 버튼이 사라진다. 슈퍼유저는 터널 소유자를 바꿀 수 있다. 이 이슈가 끝나면 PRD §6.2 의 1·2 단계(내 터널만 보기, 범위 안에서 추가)가 화면에서 끝난다.

## 배경

**착수 시점에 아래 표의 파일과 심볼이 실제로 있는지 먼저 확인한다. 하나라도 없거나 시그니처가 다르면 이슈에 코멘트를 남기고 중단한다.** 단위 2 이슈 ID 는 단위 2 설계 §9 기준이다.

| 출처 | 경로 | 이 이슈가 쓰는 계약 |
|---|---|---|
| U1-08 | `admin/src/screens/TunnelsScreen.svelte` | 카드 `Card` + `data-port`, 1행 `{forwardPort} ⬌ {destinationAddress}:{destinationPort}` + 프로토콜 `Chip`, 2행 `Badge` 상태, 3행 "Activation" `Switch` + "Timeout" `Timer`. 상단 `Button variant="primary"` "Add tunneling service". 빈 목록 "No tunnels yet." |
| U1-09 | `admin/src/screens/TunnelEditScreen.svelte` | `param`(`'new'` 또는 포트). `load()`: `getTunnelingOption()` → `snapshotRevision`; `'new'` 면 `emptyOption()`(`httpOption.rewriteHostInTextBody: true` 가 기본값), 아니면 옵션을 찾은 뒤 **`loadCertInfo(forwardPort)`** 를 부른다. `onChangeSecureTunneling()` 도 `loadCertInfo()` 를 부른다. 저장 `apply()` 는 `compound` 에 `certInfo`·`expectedCertificateRevision` 을 담는다. 필드 id `input-external-port`, TLS `Checkbox id="input-tls"`(`disabled={protocol !== 'tcp'}`, 켜면 `InputCertFile`), `input-destination-host`, `input-destination-port`, `input-allow-client-names`, `input-active-timeout`, `input-buffer-limit-server`, `input-buffer-limit-client`, `select-protocol`(`PROTOCOLS = [{value:'tcp',label:'TCP'},{value:'http',label:'HTTP (http/1.1)'},{value:'https',label:'HTTPS (http/1.1)'}]`), http/https 일 때 "HTTP options" 절(`select-change-host-in-body`, `select-change-acao`, "Inject request header" `HeaderAppender`, "Inject response header" `HeaderAppender`, "Replace text in body" `BodyReplaceAppender`), "Inactive on startup". 하단 고정 바: 저장(`isSync ? 'Apply and Restart' : 'Start'`), 삭제(`isSync ? 'Stop and Remove' : 'Remove'`). 저장 실패는 `toast`, 접속 실패는 `connectionFail()` 모달("Unable to connect to the server.") |
| 기존 | `admin/src/controller/CertificationCtrl.ts:41-51` `loadExternalServerCert(port)` | `GET /api/externalCert/:port` 를 직접 `fetch`. 401 이면 `InvalidSession`, 그 밖의 실패 응답은 `json.revisionState.currentRevision` 접근에서 `TypeError` 를 던진다 → 화면의 `connectionFail()` 모달로 이어진다 |
| U2-04 | `GET /api/externalCert/:port` | action `tunnel:cert` → 일반 유저는 403. 따라서 일반 유저 화면은 이 요청을 보내면 안 된다 |
| U1-09 | `admin/src/screens/parts/{InputCertFile,HeaderAppender,BodyReplaceAppender}.svelte` | `bind:options` 계약 |
| U1-02/03 | `admin/src/ui/{Button,Field,NumberInput,Select,Checkbox,Chip,Modal}.svelte`, `ui/toast.ts` | 단위 1 §6 표 |
| U3-01 | `admin/src/me.ts` | `$me.user.id`, `$me.user.role`, `$me.group.attributes: GroupAttributes` |
| U3-01 | `admin/src/controller/Types.ts` | `GroupAttributes`, `TunnelProtocolName`, `MeResponse`, `ApiResult` |
| U3-01 | `test/helpers/rbacFixture.ts`, fixture `rbac` | `RBAC_PASSWORDS`, `RBAC_USER_IDS`. alice(Field team: 포트 20000–20099, TCP·HTTP·HTTP_REWRITE, cors·host, `max_tunnel_count 2`, trusted `client-a`, `group_read`) 20001 소유, bob 20002 소유, carol(Default: 포트 범위 없음, 프로토콜 없음, max 10), 20003 은 `system:migrated` |
| U3-03 | `admin/src/controller/UsersCtrl.ts` | `list()` → `{users: UserView[]}` (슈퍼유저의 "Owner" 목록) |
| U2-08 | `GET /api/tunnelingOption` | 각 항목에 `owner: {id: string; username: string} \| {id: 'system:migrated'}`, `editable: boolean` 이 추가된다. 일반 유저에게는 소유·그룹 공유 터널만 온다 |
| U2-08 | `POST /api/tunnelingOption` | 일반 유저는 `AttributeEnforcer` 검사. 실패 `{success: false, status: 409 \| 422, code, message}`. 코드: `tunnel_count_exceeded`(409), `port_not_allowed`, `protocol_not_allowed`, `rewrite_not_allowed`, `trusted_client_not_allowed`, `legacy_client_names_not_allowed`. 타인 소유의 기존 포트는 404 |
| U2-08 | `PUT /api/tunnelingOption/:port/owner` | 요청 `{ownerId, expectedRevision}`(`ownerId` 는 사용자 id 또는 `'system:migrated'`; `expectedRevision` 필수, 기존 `mutateConfiguration` 커밋 경로). 응답 `{success: true, forwardPort, owner: {id, username?}, revisionState: {currentRevision}}`. 404 `not_found`, 422 `owner_not_found`. 슈퍼유저 전용 |
| U2-08 | `TunnelingOption.allowedClientIds?: string[]` | 일반 유저는 `allowedClientNames` 대신 이것만 쓴다 |

현재 저장소에서 그대로 쓰는 것:

- `admin/src/controller/ServerOptionCtrl.ts:58-69` `getTunnelingOption()`(`{value, revision}`), `:146-158` `updateTunnelingOption()`(149행의 배열에 있는 화면 전용 필드 `certInfo`·`certificateRevision`·`originalCertificateRevision`·`originalForwardPort`·`previousForwardPort`·`expectedCertificateRevision`·`isSync`·`updatable`·`allowedClientNamesQuery`·`activeTimeout` 을 POST 전에 지운다. 여기에 `owner`, `editable` 을 추가한다), `:160-169` `removeTunnelingOption()`.
- `admin/src/controller/Options.ts` `Options` 타입(`allowedClientNames`, `httpOption` 을 포함한 터널 옵션). 여기에 `owner`, `editable`, `allowedClientIds` 를 추가한다.

프로토콜 사상(단위 2 §4.5): `tcp→TCP`, `http→HTTP`, `https→HTTPS`. `httpOption` 에 리라이트가 하나라도 있으면 추가로 `HTTP_REWRITE` 가 필요하다.

먼저 열어 볼 파일: `admin/src/screens/TunnelsScreen.svelte`, `admin/src/screens/TunnelEditScreen.svelte`, `admin/src/controller/ServerOptionCtrl.ts`, `admin/src/controller/Options.ts`, `admin/src/me.ts`, `test/admin/screen-tunnels.test.ts`.

## 적용되는 결정

- D7 카드 목록 + 카드 탭 시 전체 화면 편집 → 읽기 전용 터널도 같은 편집 화면을 disabled 로 연다.
- D5 UI 문구 영어 단일.
- D2 새 요소는 `ui/` 부품만 쓴다.

## 만들 것

### `admin/src/controller/Options.ts` (추가)

```ts
type Options = {
    …기존 필드…
    owner?: {id: string; username?: string};                 // GET 응답. username 은 system:migrated 에 없다
    editable?: boolean;                                      // GET 응답
    allowedClientIds?: Array<string>;
};
```

### `admin/src/controller/ServerOptionCtrl.ts` (추가)

```ts
reassignOwner(port: number, ownerId: string, expectedRevision: number)
    : Promise<ApiResult<{forwardPort: number; owner: {id: string; username?: string}; revisionState: {currentRevision: number}}>>;
// PUT /api/tunnelingOption/:port/owner, body {ownerId, expectedRevision}
```

`adminRequest` 사용. `updateTunnelingOption()` 의 삭제 필드 목록에 `'owner'`, `'editable'` 을 추가한다.

### `admin/src/screens/parts/tunnelPolicy.ts` (신규, 순수 함수)

```ts
export type TunnelPolicy = {
    restricted: boolean;                                            // 일반 유저면 true
    canCreate(ownedCount: number): boolean;                         // !restricted || (crud === 'full' && max > 0 && ownedCount < max)
    limitReached(ownedCount: number): boolean;                      // restricted && crud === 'full' && max > 0 && ownedCount >= max
    maxTunnelCount: number;
    portHint(): string;                                             // 아래 형식
    isPortAllowed(port: number): boolean;                           // !restricted || 어느 범위에든 포함
    protocolOptions(current: 'tcp' | 'http' | 'https'): Array<{value: string; label: string}>;
    showHttpOptions: boolean;                                       // !restricted || allowed_protocols 에 HTTP_REWRITE 포함
    rewrite: {cors: boolean; host: boolean; header: boolean; body: boolean};   // 슈퍼유저는 전부 true
    trustedClients: string[];                                       // 일반 유저: allowed_trusted_clients. 슈퍼유저: []
};
export function tunnelPolicy(me: MeResponse): TunnelPolicy;
export function tunnelErrorMessage(code: string | undefined, fallback: string): string;
```

- `portHint()`: 슈퍼유저는 `''`. 범위가 비어 있으면 "No ports are allowed for your group.". 아니면 `Allowed ranges: ` + 각 범위를 `{from}–{to}`(엔 대시 U+2013)로 만들어 `, ` 로 이은 것. 예: `Allowed ranges: 20000–20099, 30000–30010`.
- `protocolOptions(current)`: 전체 목록은 U1-09 의 `PROTOCOLS`(`tcp`/"TCP", `http`/"HTTP (http/1.1)", `https`/"HTTPS (http/1.1)"). 슈퍼유저는 전체. 일반 유저는 `allowed_protocols` 에 사상값이 있는 것만 남기되, `current` 가 목록에 없으면 맨 앞에 넣는다(기존 터널의 실제 값을 보이기 위해).
- `normalizeHttpOption(option)`(같은 파일, `TunnelPolicy` 의 메서드): `restricted` 일 때 저장 직전의 `httpOption` 을 정규화한다 — `rewrite.cors` 가 false 면 `replaceAccessControlAllowOrigin = false`, `rewrite.host` 가 false 면 `rewriteHostInTextBody = false`, `rewrite.header` 가 false 면 `customRequestHeaders = []`·`customResponseHeaders = []`, `rewrite.body` 가 false 면 `bodyRewriteRules = []`. 프로토콜이 `tcp` 면 넷 다 그렇게 한다(서버의 `requiredProtocols` 는 프로토콜과 무관하게 리라이트 플래그로 `HTTP_REWRITE` 를 요구하므로, `emptyOption()` 의 `rewriteHostInTextBody: true` 가 그대로 가면 TCP 터널도 거부된다). 슈퍼유저는 손대지 않는다.
- `tunnelErrorMessage`:

| `code` | 문구 |
|---|---|
| `port_not_allowed` | "This port is outside your group's allowed ranges." |
| `protocol_not_allowed` | "This protocol is not allowed for your group." |
| `rewrite_not_allowed` | "HTTP rewrite options are not allowed for your group." |
| `trusted_client_not_allowed` | "One of the selected trusted clients is not allowed for your group." |
| `tunnel_count_exceeded` | "You have reached your tunnel limit." |
| 그 외 | `fallback`(서버 `message`) |

### `admin/src/screens/TunnelsScreen.svelte` (변경)

- `policy = tunnelPolicy($me)`, `ownedCount = options.filter(o => o.owner?.id === $me.user.id).length`.
- 카드 1행 끝에 `<span data-owner>` 안 `Chip mono` — `owner.username` 이 있으면 `@{username}`, `owner.id === 'system:migrated'` 면 `migrated`.
- `editable === false` 이면 1행에 `<span data-readonly>` 안 `Chip tone="trace"` "read only" 를 더 그리고, 3행("Activation" 스위치·"Timeout" 타이머)을 그리지 않는다.
- "Add tunneling service" 버튼은 `policy.canCreate(ownedCount)` 일 때만 그린다. `policy.limitReached(ownedCount)` 이면 목록 위에 `<p id="tunnel-limit-note" style="color: var(--ink-2)">` `Tunnel limit reached ({ownedCount}/{policy.maxTunnelCount}).`

### `admin/src/screens/TunnelEditScreen.svelte` (변경)

`policy = tunnelPolicy($me)`, `readOnly = !isNew && option.editable === false`.

| 항목 | 규칙 |
|---|---|
| 인증서 로드 | `policy.restricted` 면 `load()` 와 `onChangeSecureTunneling()` 에서 `loadCertInfo()` 를 부르지 않고, `apply()` 의 `compound` 에 `certInfo`·`expectedCertificateRevision` 을 넣지 않는다(`/api/externalCert/:port` 요청 0건) |
| 새 터널 기본값 | `policy.restricted` 면 `emptyOption()` 뒤 `policy.normalizeHttpOption(option)` 을 적용한다. 저장(`apply()`) 직전에도 한 번 더 적용한다 |
| `readOnly` | 모든 입력(`TextInput`·`NumberInput`·`Select`·`Checkbox`·appender)이 `disabled`. 하단 고정 바를 그리지 않는다. 상단에 `<p id="tunnel-readonly-note">` "This tunnel is shared with you as read only." |
| 포트 힌트 | `policy.restricted` 면 `input-external-port` 의 `Field` 에 `hint={policy.portHint()}`. 값이 있고 `!policy.isPortAllowed(value)` 이면 `Field error` "Port is outside the allowed ranges." (저장 버튼은 막지 않는다. 서버가 최종 판정한다) |
| 프로토콜 | `select-protocol` 의 options 를 `policy.protocolOptions(현재값)` 로 |
| HTTP options 절 | 프로토콜이 http/https 이고 `policy.showHttpOptions` 일 때만. 절 안에서 `select-change-acao` 는 `policy.rewrite.cors`, `select-change-host-in-body` 는 `policy.rewrite.host`, `<div id="http-request-headers">`·`<div id="http-response-headers">`(각 `HeaderAppender`)는 `policy.rewrite.header`, `<div id="http-body-rewrite">`(`BodyReplaceAppender`)는 `policy.rewrite.body` 일 때만 그린다(없는 항목은 DOM 에 두지 않는다) |
| 클라이언트 제한 | `policy.restricted` 면 `input-allow-client-names` 를 그리지 않고 대신 `Field label="Trusted clients"` 아래 `policy.trustedClients` 마다 `Checkbox id="tunnel-trusted-{clientId}" label={clientId}`. 체크된 것이 `allowedClientIds` 가 되고 `allowedClientNames` 는 요청에서 뺀다. 목록이 비면 `<p>` "No trusted clients are allowed for your group." 슈퍼유저는 기존 `input-allow-client-names` 그대로 |
| 인증서 | 기존 `InputCertFile` 을 `<div id="tunnel-cert">` 로 감싼다. `policy.restricted` 면 `#input-tls` 를 켜도 `#tunnel-cert` 를 그리지 않고 `<p id="tunnel-cert-note">` "A generated certificate will be used." 를 그린다 |
| 소유자 (슈퍼유저, `!isNew`) | `Field label="Owner" for="tunnel-owner"` + `Select id="tunnel-owner"` options = `UsersCtrl.instance.list()` 의 사용자를 `username` 오름차순으로 `{value: id, label: '@' + username}` + 마지막에 `{value: 'system:migrated', label: 'system:migrated'}`. 초기값 `option.owner.id`. 옆에 `Button` "Change owner"(선택값이 현재 소유자와 같으면 `disabled`) → `Modal title="Change owner"` 본문 `Move tunnel {port} to {선택 label}?` footer "Cancel", `Button variant="primary"` "Move" → 확인 모달을 닫고 `reassignOwner(port, ownerId, revision)`(`revision` 은 이 화면이 `getTunnelingOption()` 에서 받아 저장에 쓰는 값). 성공 → `revision = revisionState.currentRevision`, 현재 소유자 갱신, `toast.push({tone: 'pulse', message: 'Owner changed.'})`. 실패 → `toast.push({tone: 'alarm', message})`. 저장 버튼과 무관하게 즉시 반영된다 |
| 저장 실패 | 기존 토스트 경로에서 문구를 `tunnelErrorMessage(result.code, result.message)` 로 바꾼다 |

## 변경할 것

- `admin/src/controller/Options.ts`, `admin/src/controller/ServerOptionCtrl.ts`: 위 "만들 것".
- `admin/src/screens/TunnelsScreen.svelte`, `admin/src/screens/TunnelEditScreen.svelte`: 위 "만들 것". 그 밖의 필드 순서·id·저장 흐름은 U1-08·09 그대로.
- `test/admin/screen-tunnels.test.ts`: 수정하지 않는다. `with-tunnels` fixture 의 터널은 `system:migrated` 소유이고 admin 은 슈퍼유저이므로 카드에 `migrated` 칩과 편집 화면에 `#tunnel-owner` 가 더 보일 뿐 기존 단언은 그대로 성립해야 한다. 성립하지 않으면 이 이슈의 구현이 잘못된 것이다.

규모: 컨트롤러·타입 40줄, `tunnelPolicy.ts` 100줄 + 단위 테스트 80줄, 두 화면 변경 300줄, 브라우저 테스트 400줄로 약 900줄이다. 구현 중 1,500줄을 넘으면 "소유자" 행(`#tunnel-owner`·"Change owner"·`reassignOwner`)과 admin 의 재할당 케이스 2건을 별도 후속 이슈로 분리해 코멘트로 알리고 파일 끝 "번호 변경" 절에 알린다.

## 하지 말 것

- 단위 4·5 의 필드(레이트 리밋, 국가 필터)를 만들지 않는다.
- 클라이언트에서 서버 검사를 대신 막지 않는다. 포트 범위 오류는 표시만 하고 저장은 서버에 보낸다(서버가 최종 판정).
- 슈퍼유저 화면에 그룹 제한을 적용하지 않는다(`policy.restricted === false`).
- 소유자 변경을 저장 버튼에 묶지 않는다(별도 버튼, 즉시 반영).
- 새 터널 생성 시 소유자 선택 UI 를 만들지 않는다(생성자가 소유자다. 재할당은 생성 뒤).
- 일반 유저 화면에서 `allowedClientNames` 를 보내지 않는다(서버가 422 `legacy_client_names_not_allowed` 로 거부한다).
- `TunnelsScreen`·`TunnelEditScreen` 의 기존 동작(상태 갱신 주기, 스위치·타이머, 저장·삭제 흐름)을 바꾸지 않는다.
- 백엔드(`src/**`)를 수정하지 않는다.
- Svelte 5 룬만 쓴다. `export let`, `createEventDispatcher` 금지. `.svelte` 안 hex 색상 금지. `ui/` 밖에서 새 스타일 클래스를 만들지 않는다.

## 수용 기준

- `test/admin/tunnelPolicy.test.ts` (신규, 순수 함수. `MeResponse` 를 fixture 값으로 직접 만든다)
  - alice 의 `MeResponse` 이면 `restricted` 가 true, `portHint()` 가 `Allowed ranges: 20000–20099`, `isPortAllowed(20050)` 이 true, `isPortAllowed(30000)` 이 false, `protocolOptions('tcp')` 의 value 가 `['tcp','http']` 이고 label 이 `['TCP','HTTP (http/1.1)']`, `protocolOptions('https')` 의 value 가 `['https','tcp','http']`, `showHttpOptions` 가 true, `rewrite` 가 `{cors: true, host: true, header: false, body: false}`, `trustedClients` 가 `['client-a']`, `canCreate(1)` 이 true, `canCreate(2)` 가 false, `limitReached(2)` 가 true 이다.
  - alice 의 정책으로 `normalizeHttpOption({protocol: 'tcp', httpOption: {rewriteHostInTextBody: true, replaceAccessControlAllowOrigin: true, customRequestHeaders: [{name: 'a', value: 'b'}], customResponseHeaders: [], bodyRewriteRules: [{from: 'x', to: 'y'}]}})` 이면 `httpOption` 이 `{rewriteHostInTextBody: false, replaceAccessControlAllowOrigin: false, customRequestHeaders: [], customResponseHeaders: [], bodyRewriteRules: []}` 이다. 같은 입력에 `protocol: 'http'` 이면 `rewriteHostInTextBody`·`replaceAccessControlAllowOrigin` 은 true 로 남고 두 배열은 `[]` 이다.
  - carol 의 `MeResponse` 이면 `portHint()` 가 "No ports are allowed for your group.", `isPortAllowed(25000)` 이 false, `protocolOptions('tcp')` 의 value 가 `['tcp']`, `showHttpOptions` 가 false, `canCreate(0)` 이 true 이다.
  - `tunnel_crud` 가 `read_only` 이면 `canCreate(0)` 이 false 이고 `limitReached(0)` 이 false 이다.
  - admin 의 `MeResponse` 이면 `restricted` 가 false, `portHint()` 가 `''`, `isPortAllowed(1)` 이 true, `protocolOptions('tcp')` 가 3개, `rewrite` 가 전부 true, `canCreate(1000)` 이 true 이다.
  - `tunnelErrorMessage('port_not_allowed', 'x')` 가 "This port is outside your group's allowed ranges." 이고 `tunnelErrorMessage('unknown_code', 'server says')` 가 `server says` 이다.
- `test/admin/screen-tunnels-rbac.test.ts` (신규). `startAdminApp({fixture: 'rbac', login: {username, password: RBAC_PASSWORDS[username]}})`(admin 은 `login` 생략), `#/tunnels` 로 진입, `finally close()`, `expect(errors).toEqual([])`. 버튼은 `getByRole('button', {name, exact: true})`.
  - alice: `[data-port]` 카드가 2개이고 `[data-port="20003"]` 이 없다. `[data-port="20001"] [data-owner]` 가 `@alice` 이고 `[data-port="20001"] [data-readonly]` 가 없으며 카드에 "Activation" 이 있다. `[data-port="20002"] [data-owner]` 가 `@bob` 이고 `[data-port="20002"] [data-readonly]` 가 "read only" 이며 카드에 "Activation" 이 없다. 버튼 "Add tunneling service" 가 있고 `#tunnel-limit-note` 가 없다.
  - alice 가 `[data-port="20001"]` 을 클릭하면 해시가 `#/tunnels/20001` 이고, `page.on('request')` 로 모은 URL 중 `/api/externalCert/` 를 포함한 것이 0건이며, "Unable to connect to the server." 가 없고, `#input-external-port` 의 힌트 "Allowed ranges: 20000–20099" 가 보이며, `#select-protocol` 의 `<option>` value 가 정확히 `['tcp','http']` 이고, `#input-allow-client-names` 가 없고 `#tunnel-trusted-client-a` 가 있으며 `#tunnel-trusted-client-b` 가 없고, `#tunnel-owner` 가 없으며, `#input-external-port` 에 `30000` 을 넣으면 "Port is outside the allowed ranges." 가 보이고 버튼 "Apply and Restart" 는 여전히 enabled 이다.
  - alice 가 20001 에서 `#select-protocol` 을 `http` 로 바꾸면 `#select-change-acao` 와 `#select-change-host-in-body` 가 있고 `#http-request-headers`, `#http-response-headers`, `#http-body-rewrite` 가 없다.
  - alice 가 20001 에서 `#input-tls` 를 켜면 `#tunnel-cert` 가 없고 `#tunnel-cert-note` 가 "A generated certificate will be used." 이며 `/api/externalCert/` 요청은 여전히 0건이다.
  - alice 가 `[data-port="20002"]` 를 클릭하면 `#tunnel-readonly-note` 가 보이고 `#input-destination-host` 가 `disabled` 이며 버튼 "Apply and Restart" 와 "Stop and Remove" 가 없다.
  - alice 가 "Add tunneling service" → `#input-external-port` `20050`, `#input-destination-host` `127.0.0.1`, `#input-destination-port` `9000` 으로 저장하면 `#/tunnels` 에 카드가 3개이고, "Add tunneling service" 가 없으며 `#tunnel-limit-note` 가 `Tunnel limit reached (2/2).` 이다.
  - carol: 카드가 0개이고 "No tunnels yet." 과 "Add tunneling service" 가 보인다. "Add tunneling service" 를 누르면 힌트 "No ports are allowed for your group." 이 보이고 `#select-protocol` 의 option 이 `['tcp']` 하나이며, `#input-external-port` 에 `25000` 을 넣으면 "Port is outside the allowed ranges." 가 보이고, `#input-destination-host` `127.0.0.1`·`#input-destination-port` `9000` 으로 저장하면 토스트 "This port is outside your group's allowed ranges." 가 보이고 해시는 `#/tunnels/new` 이다.
  - admin: 카드가 3개이고 `[data-port="20003"] [data-owner]` 가 `migrated` 이며 `[data-port="20001"] [data-owner]` 가 `@alice` 이고 어느 카드에도 `[data-readonly]` 가 없다.
  - admin 이 `[data-port="20003"]` 을 클릭하면 `#tunnel-owner` 의 값이 `system:migrated` 이고 버튼 "Change owner" 가 `disabled` 이며, `#input-allow-client-names` 가 있고, `#input-tls` 를 켜면 `#tunnel-cert` 가 있다. `#tunnel-owner` 를 `u_0000000000000002` 로 바꾸면 "Change owner" 가 enabled 이고, 누르면 모달 본문에 `Move tunnel 20003 to @alice?` 가 보이며, "Move" 를 누르면 토스트 "Owner changed." 가 보이고 `#/tunnels` 로 돌아가면 `[data-port="20003"] [data-owner]` 가 `@alice` 이다.
  - 위 재할당 뒤 `#nav-sign-out` 으로 로그아웃하고 `#login-username` `alice`·`#login-password` `user-password-1234` 로 "OK" 를 누르면 카드가 3개이고 `[data-port="20003"]` 에 `[data-readonly]` 가 없다.

기존 `test/admin/screen-tunnels.test.ts` 와 `test/admin/*.test.ts` 전부, U3-01~05 의 테스트가 그대로 통과한다.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm --prefix admin run check
npm run lint
npm run test:admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건, 제목에 단계 표식 0건 확인
```

## 선행 · 후행

- 선행: U3-03(`UsersCtrl.list()`), U3-04(그룹 화면으로 fixture 속성을 검토할 수 있어야 한다), U2-08(소유권·속성 집행 API).
- 후행: U4-06·U4-07, U5-06(터널 편집에 레이트 리밋·보안 필드 추가).

## 근거 문서

- `docs/design/2026-09-11-unit3-rbac-screens.md` §2(`reassignOwner`), §4.7(터널 화면 반영), §5(`screen-tunnels-rbac`), §6(U3-06)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §4.4(`tunnel:*` 규칙), §4.5(`AttributeEnforcer` 코드), §5.2(`/api/tunnelingOption*`), §5.3(소유권)
- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §7.3(`TunnelsScreen`), §7.4(`TunnelEditScreen`)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.2.3(NFR-USAB-HIDE-001), §6.2, §7(속성 1·2·4·5·7·8·10), §12 Q7

---
