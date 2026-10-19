# 단위 3 — RBAC 관리 화면

| 항목 | 내용 |
|---|---|
| 상위 문서 | [프로그램 개요](./2026-09-11-program-overview.md), [단위 1](./2026-09-11-unit1-admin-ui-shell.md)(부품·골격), [단위 2](./2026-09-11-unit2-rbac-model-api.md)(API), [PRD](../plan/prd/TTTGate-admin-rbac.md) §5.2.3 §6 |
| 적용 결정 | D2 D4 D5 D7 |
| 선행 단위 | 1 전부, 2 전부 |
| 후행 단위 | 4(화면 이슈), 5(U5-06). 이 단위의 마지막 이슈는 U3-06 |
| 대상 | `admin/src/screens/`, `admin/src/shell/nav.ts`, `admin/src/controller/`(신규 컨트롤러), `test/admin/` |

## 1. 목표

2 단위의 API 위에 사용자·그룹·내 계정 화면과 첫 로그인 비밀번호 변경 흐름을 만들고, 터널 화면에 소유권과 속성 제한을 반영하며, 권한이 없는 화면을 숨긴다(PRD NFR-USAB-HIDE-001). 끝나면 슈퍼유저가 UI 만으로 §6.1 의 일과(사용자 추가 → 임시 비밀번호 전달 → 그룹 속성 검토)를 마칠 수 있고, 일반 유저는 §6.2 의 일과(내 터널만 보기, 범위 안에서 추가, 비밀번호 변경)를 마칠 수 있다.

**비목표.** 감사 로그·세션·MFA 화면(4 단위). 보안 화면(5 단위).

## 2. 컨트롤러 (`admin/src/controller/`)

기존 패턴(`adminRequest` 사용)을 따른다. `ServerOptionCtrl`·`ServerStatusCtrl` 처럼 `instance` 싱글턴의 인스턴스 메서드로 만든다(`LoginCtrl` 만 정적).

| 파일 | 메서드 | API |
|---|---|---|
| `UsersCtrl.ts` | `list()`, `get(id)`, `create(input)`, `update(id, patch)`, `remove(id)`, `resetPassword(id, temp?)` | `/api/users*` |
| `GroupsCtrl.ts` | `list()`, `get(id)`, `create(input)`, `update(id, patch)`, `remove(id)` | `/api/groups*` |
| `MeCtrl.ts` | `me()`, `changePassword(current, next)`, `acknowledgeMigration()` | `/api/me*` |
| `ServerOptionCtrl.ts`(기존, 터널 API 메서드가 `:58-172` 에 있음) | `reassignOwner(port, ownerId)` 추가 | `PUT /api/tunnelingOption/:port/owner` |

타입은 `controller/Types.ts` 에 `UserView`, `Group`, `GroupAttributes`, `MeResponse` 를 추가한다(2 단위 문서 3절·5.2 표와 같은 형태).

## 3. 라우트와 내비게이션

`router.ts` 의 `Screen` 확장과 `nav.ts` 갱신.

| 해시 | Screen | title | back | 표시 조건(`me.sections`) |
|---|---|---|---|---|
| `#/users` | `users` | Users | — | `users` |
| `#/users/new` | `user-edit` (param `new`) | New user | `#/users` | `users` |
| `#/users/:id` | `user-edit` | User | `#/users` | `users` |
| `#/groups` | `groups` | Groups | — | `groups` |
| `#/groups/new` | `group-edit` (`new`) | New group | `#/groups` | `groups` |
| `#/groups/:id` | `group-edit` | Group | `#/groups` | `groups` |
| `#/me` | `me` | My account | — | `me` |
| `#/me/password` | `me-password` | Change password | `#/me` (강제 변경 상태에서는 back 없음) | 항상 |
| `#/denied` | `denied` | No access | — | 항상 |

- `NAV` 순서: Status, Tunnels, Server settings, Users, Groups, Security(5 단위), Audit log(4), Sessions(4), My account. 각 항목에 `section` 키를 두고 `Drawer` 가 `me.sections.includes(section)` 인 항목만 그린다. 드로어 하단에 사용자명 + "Sign out".
- 라우트 가드(`App.svelte`): 현재 route 의 `section` 이 `me.sections` 에 없으면 `#/denied` 로 보낸다. 단, 해시가 비어 있거나 `#/`, `#/status`(라우터 기본값) 인 경우는 사용자가 직접 입력한 것이 아니므로 `denied` 가 아니라 기본 화면(아래)으로 보낸다. `#/denied` 화면은 "You don't have access to this page." + `Button` "Go to my tunnels"(첫 허용 섹션으로). `denied` 진입은 감사 대상이 아니다(서버가 403 을 낼 때 `access_denied` 를 기록한다. PRD §6.4).
- 일반 유저의 기본 화면: `sections` 의 첫 항목. `tunnels` 가 없으면 `me`.
- `me.mustChangePassword` 이면 어떤 해시든 `#/me/password` 로 고정하고 드로어 메뉴 버튼을 숨긴다(NFR-USAB-FIRST-LOGIN-001).
- 마이그레이션 배너: `me.migrationBanner` 가 true 면 `Shell` 헤더 아래에 `Banner tone="trace" dismissible`(단위 1 §6 부품) "Your account was promoted to superuser during the upgrade." + "Dismiss"(→ `acknowledgeMigration`). PRD §6.3.

## 4. 화면

### 4.1 `UsersScreen` (`#/users`)

- 상단 `Button variant="primary"` "Add user" → `#/users/new`.
- 카드 목록(사용자마다 `Card`, `data-user-id`): 1행 `displayName` + `Chip` role(`superuser` 는 `tone="signal"`, `regular` 는 neutral) + `Badge` status(`active` pulse / `disabled` alarm); 2행 mono `@username · {groupName}`; `mustChangePassword` 면 `Chip tone="warn"` "temp password". 카드 탭 → `#/users/:id`.
- 필터: `TextInput` "Filter by name or group" (클라이언트 측 필터).

### 4.2 `UserEditScreen` (`#/users/new`, `#/users/:id`)

- 필드: `TextInput id="user-username"`(생성 시만 편집 가능, 형식 힌트 "3–32 chars, lowercase letters, digits, . _ -"), `TextInput id="user-display-name"`, `Select id="user-role"` (Superuser / Regular), `Select id="user-group"`(일반 유저만; 목록은 `GroupsCtrl.list()` 에서 `system:superuser` 제외), `Select id="user-status"`(수정 시만).
- 생성 시 "Temporary password" 절: `Checkbox` "Generate automatically"(기본 on) 또는 `TextInput type="password" id="user-temp-password"`(8자 이상).
- 저장 성공(생성): **1회 노출 모달** `Modal title="Temporary password"` — 본문에 username 과 임시 비밀번호(mono, 큰 글자), "This password is shown only once. Send it to the user through a channel you trust." 문구, `Button` "Copy"(`navigator.clipboard.writeText`; 실패해도 오류 없이 무시) 와 "Done". Done 을 누르면 `#/users/:id` 로 이동. 모달 밖 클릭으로는 닫히지 않는다(`closeOnOverlay={false}`).
- 수정 화면 하단 고정 바: "Save"(변경 있을 때), "Reset password"(→ 확인 모달 → `resetPassword` → 1회 노출 모달), "Delete"(danger, 확인 모달; 409 `user_owns_tunnels` 면 토스트 "Reassign this user's tunnels first.").
- 서버 오류 코드 → 문구: `username_taken` "That username is already in use.", `last_superuser` "At least one active superuser must remain.", `password_change_required` 는 발생하지 않음(슈퍼유저 화면).

### 4.3 `GroupsScreen` (`#/groups`)

- "Add group" 버튼. 카드: 이름, `system` 이면 `Chip` "system", 멤버 수, 핵심 속성 요약 한 줄(mono: `crud=full · tunnels≤10 · ports 20000-20099 · TCP,HTTP`). 탭 → `#/groups/:id`. `system:superuser` 카드는 탭 시 읽기 전용 화면.

### 4.4 `GroupEditScreen` (`#/groups/new`, `#/groups/:id`)

속성 11종을 세 `Card` 로 나눈다. id 는 `group-attr-<속성키>`.

| 카드 | 속성 | 부품 |
|---|---|---|
| Tunnel permissions | `tunnel_crud` | `Select` none / read only / full |
| | `max_tunnel_count` | `NumberInput` 0..1000, 힌트 "0 disables tunnel creation" |
| | `max_tunnel_duration_ms` | `NumberInput` 시간 단위(hours, 0 = unlimited; 저장 시 ×3,600,000) |
| | `allowed_port_range` | 행 목록(from · to `NumberInput` + 제거 ×) + "Add range" |
| | `allowed_protocols` | `Checkbox` 4개 TCP / HTTP / HTTPS / HTTP rewrite |
| | `http_tunnel_rewrite_permissions` | `Checkbox` 4개 CORS / Host / Headers / Body (HTTP rewrite 가 꺼지면 disabled + 자동 해제) |
| | `allowed_trusted_clients` | `Checkbox` 목록(서버 옵션의 `trustedClients` 에서 clientId·displayName) |
| Limits | `max_concurrent_connections` | `NumberInput` 0..100000 |
| | `rate_limit` | `Select` Unlimited / 1 MB/s / 10 MB/s / 100 MB/s |
| Visibility | `admin_ui_section_access` | `Checkbox` 4개 Tunnels / My audit log / My profile / My sessions |
| | `tunnel_visibility` | `Select` Private / Readable by group |

- 하단 바: "Save", "Delete"(system 그룹은 숨김; 409 `group_not_empty` 면 토스트 "Move the members to another group first.").
- 정합성 오류(422)는 서버 메시지를 `Field error` 로 해당 카드 상단에 표시.
- `system:superuser` 는 읽기 전용(모든 입력 disabled, 안내 "Superusers are not limited by attributes."). `default` 는 이름만 읽기 전용.

### 4.5 `MeScreen` (`#/me`)

- `Card` "Account": username, display name, role `Chip`, group name. `Button` "Change password" → `#/me/password`.
- 4 단위가 "Two-factor authentication" 카드와 "Sessions" 링크를 추가한다(자리만 비워 둘 필요 없음).

### 4.6 `PasswordChangeScreen` (`#/me/password`)

- `TextInput type="password" id="pw-current"`(라벨: 강제 변경이면 "Temporary password", 아니면 "Current password"), `id="pw-new"`, `id="pw-confirm"`. 클라이언트 검증: 8자 이상, 둘 일치, 현재와 다름.
- 강제 변경 상태 상단 안내: "Set a new password before continuing."
- 성공 → `loadMe()` 갱신 → 강제 변경이었으면 기본 화면으로, 아니면 `#/me` + 토스트. 서버 401/422 메시지는 `role="alert"`.

### 4.7 터널 화면 반영 (`TunnelsScreen`, `TunnelEditScreen`)

- 카드 1행에 소유자 `Chip`(mono): `@username` 또는 `migrated`. `editable === false` 면 `Chip tone="trace"` "read only" 와 스위치·타이머 숨김, 탭 시 편집 화면이 읽기 전용(모든 입력 disabled, 하단 바 없음).
- "Add tunneling service" 버튼은 `me.role === 'regular'` 이고 (`tunnel_crud !== 'full'` 또는 `max_tunnel_count === 0` 또는 소유 터널 수 ≥ `max_tunnel_count`) 이면 숨김. 한도에 걸려 숨길 때는 목록 상단에 `--ink-2` 문구 "Tunnel limit reached ({n}/{max})."
- 일반 유저의 편집 화면:
  - 포트 `NumberInput` 아래 힌트 "Allowed ranges: 20000–20099, 30000–30010"(그룹 속성에서). 범위 밖이면 즉시 `Field error`.
  - 프로토콜 `Select` 옵션은 `allowed_protocols` 에 있는 것만.
  - HTTP options 절은 `HTTP_REWRITE` 가 있을 때만, 그 안의 각 항목은 `http_tunnel_rewrite_permissions` 의 플래그별로 표시(없는 항목은 아예 그리지 않는다).
  - "Allowed Client names" 입력은 숨기고 대신 "Trusted clients" `Checkbox` 목록(`allowed_trusted_clients` 의 clientId 만 표시. `/api/me` 는 displayName 을 주지 않는다).
  - 인증서 업로드(`InputCertFile`) 숨김. TLS 체크는 유지(무작위 인증서 사용 안내 문구).
- 슈퍼유저의 편집 화면: "Owner" `Select`(사용자 목록 + `system:migrated`). 변경 시 `reassignOwner` 는 저장 버튼과 별도의 "Change owner" 버튼으로 즉시 반영(확인 모달).
- 서버 422 코드 → 문구: `port_not_allowed`, `protocol_not_allowed`, `rewrite_not_allowed`, `trusted_client_not_allowed`, `tunnel_count_exceeded`. 알 수 없는 코드는 서버 `message` 그대로.

### 4.8 Status 화면

`status` 섹션은 슈퍼유저에게만 있으므로 변경 없음. 일반 유저는 라우트 가드로 `#/denied`.

## 5. 테스트

`test/helpers/adminApp.ts` 의 fixture 를 확장한다: `'rbac'` fixture = 슈퍼유저 `admin`, 그룹 `field`(포트 20000–20099, TCP·HTTP·HTTP_REWRITE, cors·host 허용, `max_tunnel_count 2`, `group_read`), 일반 유저 `alice`(field, 터널 20001 소유), `bob`(field, 터널 20002 소유), `carol`(default, 터널 없음), `dave`(field, 임시 비밀번호 `temp-password-1234`, `mustChangePassword: true`), 마이그레이션 터널 20003. 비밀번호는 `alice`·`bob`·`carol` 모두 `user-password-1234`, `admin` 은 `test-password-1234`. `startAdminApp({fixture:'rbac', login: {username:'alice', password:'user-password-1234'}})`. `login` 옵션은 U1-05 의 `boolean` 에서 U2-10 이 `boolean | {username, password}` 로 넓힌다(`true` = 기본 admin 계정). 진입점은 `login` 하나다.

| 파일 | 시나리오 |
|---|---|
| `screen-users.test.ts` | admin: 목록 5명(admin·alice·bob·carol·dave), 필터, 생성(자동 임시 비밀번호 모달 → 값이 16자 → Done → 상세) , 역할 변경 저장, 비활성화, 마지막 슈퍼유저 강등 시 오류 문구, 삭제 409 문구, reset password 모달 |
| `screen-groups.test.ts` | admin: 목록, 생성(속성 전부 입력 → 저장 → 다시 열어 값 일치), 정합성 오류 표시, system:superuser 읽기 전용, default 이름 읽기 전용, 비어 있지 않은 그룹 삭제 409 |
| `screen-me.test.ts` | alice: 계정 카드, 비밀번호 변경 성공 후 재로그인. 강제 변경: 새 사용자로 로그인 → `#/me/password` 고정, 메뉴 버튼 없음, 다른 해시 입력해도 되돌아옴 → 변경 → 기본 화면 |
| `screen-tunnels-rbac.test.ts` | alice: 카드 2개(20001 editable, 20002 read only, 20003 보이지 않음), Add 버튼 표시 → 20001 편집: 포트 힌트, 프로토콜 옵션 2개(TCP·HTTP), HTTP options 에 CORS·Host 만, 인증서 업로드 없음, 포트 30000 입력 시 오류. bob 소유 20002 는 읽기 전용. 터널 하나 더 만들면(합 2) Add 버튼 사라지고 한도 문구. carol(default 그룹: crud full, max 10, 포트 범위 비어 있음): 카드 0개, Add 버튼 표시, 포트 힌트 "No ports are allowed for your group.", 미사용 포트 25000 입력 후 저장 시 `port_not_allowed` 문구 표시(20001 같은 타인 소유 기존 포트는 서버가 404 를 낸다) |
| `screen-access.test.ts` | alice: 드로어에 Users/Groups/Server settings/Status 없음. `#/users` 직접 입력 → `#/denied` 화면과 "Go to my tunnels". admin: 전부 표시. 배너: 마이그레이션 admin 으로 로그인 → 배너 → Dismiss → 새로고침 후 없음 |

## 6. 이슈 분할

| # | 제목 | 만드는 것 | 수용 기준 | 선행 |
|---|---|---|---|---|
| U3-01 | RBAC fixture 와 섹션 기반 내비게이션·가드 | `admin-backend-driver` 의 `rbac` fixture(identity.yaml + 터널 4개), `startAdminApp({fixture, loginAs})`, `MeCtrl`, `me.ts` 의 `me` 스토어 확장, 라우트 표 확장(3절), `nav.ts` section 필터, 가드, `#/denied` 화면 | `screen-access.test.ts` | U1-10, U2-10 |
| U3-02 | 강제 비밀번호 변경과 마이그레이션 배너 | `PasswordChangeScreen`, `mustChangePassword` 고정 흐름, `Banner` 로 마이그레이션 안내와 Dismiss | `screen-me.test.ts`(비밀번호 변경·강제 변경·배너 부분) | U3-01 |
| U3-03 | 사용자 화면 | `UsersCtrl`, `UsersScreen`, `UserEditScreen`, 임시 비밀번호 모달 | `screen-users.test.ts` | U3-01 |
| U3-04 | 그룹 화면 | `GroupsCtrl`, `GroupsScreen`, `GroupEditScreen` | `screen-groups.test.ts` | U3-01 |
| U3-05 | 내 계정 화면 | `MeScreen` | `screen-me.test.ts` 계정 카드 부분 | U3-02 |
| U3-06 | 터널 화면의 소유권·속성 반영 | 4.7 전부 | `screen-tunnels-rbac.test.ts` | U3-03, U3-04, U2-08 |

U3-03·04 는 U3-01 이후 서로 병렬 가능하고, U3-02 도 그들과 병렬 가능하다(같은 구현자가 순서대로 해도 무방).
