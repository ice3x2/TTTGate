# 단위 2 — 계정 · 그룹 · 권한 모델과 관리 API

| 항목 | 내용 |
|---|---|
| 상위 문서 | [프로그램 개요](./2026-09-11-program-overview.md), [PRD](../plan/prd/TTTGate-admin-rbac.md) §4 §5.1.1~5.1.3 §7 §8 §10 |
| 적용 결정 | D1 |
| 선행 단위 | 0. 1 과 병렬 가능(마지막 이슈 U2-10 만 1 단위 완료(U1-10) 이후, UI 레인) |
| 후행 단위 | 3, 4, 5(U5-05~09) |
| 대상 | `src/server/rbac/`(신규), `src/server/audit/AuditSink.ts`(신규), `src/server/admin/{AdminServer,SessionStore}.ts`, `src/types/TunnelingOption.ts`, `src/server/ServerApp.ts`, `admin/src/screens/LoginScreen.svelte`, `admin/src/session.ts` |

## 1. 목표

PRD 의 계정 모델을 백엔드에 도입한다. 끝나면:

- 사용자(`superuser` / `regular`)와 그룹(속성 11종)이 `config/identity.yaml` 에 저장되고 관리 API 로 CRUD 된다.
- 기존 단일 `admin`(`config/.key`)은 서버 기동 때 자동으로 슈퍼유저 `admin` 으로 승격된다. 기존 비밀번호로 그대로 로그인된다(PRD K2).
- 모든 관리 API 가 세션의 사용자·역할·그룹 속성으로 권한 검사를 받는다. 터널은 소유자를 가진다.
- 속성 1·2·4·5·7·8·9·10 은 API 에서 집행된다. 3·6·11 은 5 단위가 런타임에서 집행한다.
- 감사 로그의 삽입 지점(`AuditSink`)이 생긴다. 실제 기록은 4 단위.

**비목표.** MFA, 세션 목록·강제 종료, 감사 로그 저장·조회(4 단위). RBAC 화면(3 단위). PRD §11 의 범위 외 항목.

## 2. 현재 상태 (기준 커밋 `5f772fc`)

- `src/server/admin/SessionStore.ts`: 싱글턴. `config/.key` 의 bcrypt 해시 하나로 `loginWithDetails(key, bootstrapToken)`; `.key` 가 비어 있으면 `config/.bootstrap-token` 으로 최초 비밀번호 설정. 세션은 메모리 `Map<sessionKey, {key, timeout}>`, TTL 12시간(요청마다 연장), `sweepSession`.
- `src/server/admin/AdminServer.ts`: `route → routeGet/routePost/routeDelete` 의 `if/else` 체인. 각 핸들러가 `checkSession(req,res)` 를 직접 부른다. 로그인 백오프는 IP 버킷(`isLoginBlocked/recordLoginFailure/delayFailedLogin`, `loginBackoff.ts`). 요청 IP 는 `getClientAddress(req)`(`:1361`, `trustXForwardedFor` 정책 존중).
- 터널 옵션에 소유자 개념 없음. `ServerOption.trustedClients` 는 `/api/serverOption` 으로 편집.
- 설정 저장: `ServerOptionStore.runConfigurationMutation` + `Files.writeAtomicSync`(임시 파일 → rename). `.server.state.json` 이 리비전 상태.

## 3. 저장 모델 — `config/identity.yaml`

```yaml
version: 1
users:
  - id: u_3f9a1c2e7b4d5a60          # 'u_' + 16 hex (crypto.randomBytes(8))
    username: admin                  # 3..32 자, /^[a-z0-9._-]+$/, 소문자 저장, 유일
    displayName: admin               # 1..64 자
    role: superuser                  # superuser | regular
    status: active                   # active | disabled
    groupId: system:superuser
    passwordHash: "$2a$12$..."       # bcryptjs cost 12
    mustChangePassword: false
    migratedFromLegacyAdmin: true    # 승격된 계정만 true
    migrationAcknowledged: false     # 배너 닫음 여부
    createdAt: 1757548800000
    updatedAt: 1757548800000
groups:
  - id: system:superuser
    name: Superusers
    system: true
    attributes: {}                   # 파일에는 빈 객체로 저장. 읽을 때 기본값으로 채워 GroupAttributes 형태를 유지하되 슈퍼유저에게는 무시된다
  - id: default
    name: Default
    system: true
    attributes: {…11종, 아래 기본값}
  - id: g_7c1d…                      # 'g_' + 16 hex
    name: Field team
    system: false
    attributes: {…}
```

`GroupAttributes`(PRD §7 그대로):

| 키 | 타입 | 기본값 |
|---|---|---|
| `tunnel_crud` | `'none'\|'read_only'\|'full'` | `'full'` |
| `max_tunnel_count` | int ≥ 0 | `10` |
| `max_tunnel_duration_ms` | int ≥ 0 (0 = 무제한) | `0` |
| `allowed_port_range` | `Array<{from: number; to: number}>` (1..65535, from ≤ to) | `[]` |
| `allowed_protocols` | `Array<'TCP'\|'HTTP'\|'HTTPS'\|'HTTP_REWRITE'>` | `[]` |
| `max_concurrent_connections` | int ≥ 0 (`0` = 상한 없음. 속성 3 과 같은 규칙) | `100` |
| `allowed_trusted_clients` | `string[]` (PRD 의 `'*'` 는 두지 않는다. 슈퍼유저는 속성 자체를 무시하므로 필요 없다) | `[]` |
| `http_tunnel_rewrite_permissions` | `{cors: boolean; host: boolean; header: boolean; body: boolean}` | 모두 `false` |
| `admin_ui_section_access` | `Array<'tunnels'\|'my_audit'\|'my_profile'\|'my_sessions'>` | 네 개 전부 |
| `tunnel_visibility` | `'private'\|'group_read'` | `'private'` |
| `rate_limit` | `'unlimited'\|'1MB/s'\|'10MB/s'\|'100MB/s'` (저장 리터럴. PRD 표기 `1 MB/s` 의 공백을 뺀 것이며 UI 라벨은 공백을 넣는다) | `'unlimited'` |

정합성 규칙(저장 시 422): `allowed_protocols` 에 `HTTP_REWRITE` 가 없으면 `http_tunnel_rewrite_permissions` 는 모두 false 여야 함(UI 규칙과 동일). `HTTP_REWRITE` 는 `HTTP` 또는 `HTTPS` 없이 단독 허용 불가. 포트 범위는 서로 겹칠 수 있으나 각 항목은 유효 범위.

파일 쓰기는 `Files.writeAtomicSync`. 스키마 `version` 상향 때는 같은 디렉터리에 `identity.yaml.bak.<version>` 을 먼저 쓴다. 자동 삭제 없음(PRD §8.3).

### 3.1 롤백 계약 (PRD §8.3)

- 이 프로그램이 `server.yaml` 에 새 필드(`ownerId`, `rateLimit`, `connectionSecurity`, `mfaRequiredForSuperusers`, `auditRetentionDays`, `auditQueueSize`)를 **처음** 쓰는 저장에서, `ServerOptionStore` 는 `Files.writeAtomicBatchSync` 로 `server.yaml.bak` 과 `.server.state.json.bak` 을 같은 배치에 함께 쓴다(이미 있으면 덮어쓰지 않는다). 판정은 "현재 디스크의 `server.yaml` 에 위 필드가 하나도 없고, 저장하려는 옵션에는 있다" 이다.
- `.bak` 파일과 `.key` 는 서버가 절대 지우지 않는다(PRD 14일 보존은 하한이며 운영자가 수동 정리).
- 롤백 절차(`docs/guide/MIGRATION.md`, U2-09): 서버 정지 → `server.yaml.bak`→`server.yaml`, `.server.state.json.bak`→`.server.state.json` 복사 → `identity.yaml` 은 그대로 두어도 이전 바이너리가 읽지 않으므로 무해 → 이전 바이너리 기동. `.key` 가 보존되어 있으므로 이전 바이너리의 단일 admin 로그인이 그대로 된다.
- 이전 바이너리(`5f772fc`)의 `verificationServerOption`(`ServerOptionStore.ts:339-360`)은 키 허용 목록이 없어 알 수 없는 필드를 그대로 통과·보존한다(YAML 왕복). 따라서 새 필드가 든 `server.yaml` 도 이전 바이너리가 읽는다. `.bak` 은 그래도 남긴다(수기 편집 손실 방지, PRD §8.3). U2-09 은 이 사실을 MIGRATION.md 에 적고, `5f772fc` 빌드로 새 yaml 을 읽는 확인은 수동 절차로 둔다.

## 4. 모듈 — `src/server/rbac/`

```
src/server/rbac/
  IdentityTypes.ts          User, Group, GroupAttributes, Role, UserStatus, 상수(SYSTEM_SUPERUSER_GROUP_ID='system:superuser', DEFAULT_GROUP_ID='default', MIGRATED_OWNER_ID='system:migrated'), DEFAULT_GROUP_ATTRIBUTES, 검증 함수(validateUsername, validateGroupAttributes)
  IdentityStore.ts          identity.yaml 로드·저장·CRUD. 불변식 집행. 싱글턴 + resetForTest
  IdentityMigration.ts      기동 시 .key → admin 슈퍼유저 승격, 부트스트랩 상태 판정
  Principal.ts              세션에서 파생되는 요청 주체 {userId, username, role, groupId, attributes, mustChangePassword}
  AdminAuthorizer.ts        authorize(principal, action, target) → 결정
  AttributeEnforcer.ts      터널 생성·수정 입력을 그룹 속성으로 검증
  AuthorizationContext.ts   5 단위가 쓰는 조회: ownerOf(port), groupAttributes(groupId), portsOfGroup(groupId)
src/server/audit/
  AuditSink.ts              interface AuditSink { record(event: AuditEvent): Promise<void> }, AuditEvent 타입, LoggerAuditSink(기본), AuditSinkRegistry
```

### 4.1 `IdentityStore`

```ts
class IdentityStore {
    static get instance(): IdentityStore; static resetForTest(): void;
    readonly mode: 'ready' | 'legacy-fallback';          // 4.2 참조
    load(): void;                                          // 파일 없으면 빈 상태(사용자 0, 시스템 그룹 2)
    users(): User[]; user(id: string): User | undefined; userByUsername(name: string): User | undefined;
    groups(): Group[]; group(id: string): Group | undefined;
    createUser(input: {username; displayName?; role; groupId?; password?: string; passwordHash?: string; mustChangePassword: boolean}): Promise<Result<User>>;   // 둘 중 하나. 승격은 `.key` 해시를 passwordHash 로 그대로 넣고, API 는 평문 password 를 넘긴다
    updateUser(id, patch: {displayName?; role?; status?; groupId?; mustChangePassword?; migrationAcknowledged?}): Result<User>;
    deleteUser(id): Result<void>;
    setPassword(id, password: string, options: {clearMustChange: boolean}): Promise<Result<void>>;   // bcrypt 12
    verifyPassword(username, password): Promise<{user: User} | {reason: 'not-found' | 'disabled' | 'mismatch'}>;
    createGroup(input: {name; attributes?: Partial<GroupAttributes>}): Result<Group>;
    updateGroup(id, patch: {name?; attributes?: Partial<GroupAttributes>}): Result<Group>;
    deleteGroup(id): Result<void>;
    membersOf(groupId): User[];
}
type Result<T> = {success: true; value: T} | {success: false; status: 404 | 409 | 422; code: string; message: string};
```

불변식(모두 테스트로 고정):
- 사용자는 정확히 한 그룹. `role === 'superuser'` ⇔ `groupId === 'system:superuser'`. 역할 변경 시 그룹 자동 이동(`regular` → `superuser` 이면 `system:superuser` 로, `superuser` → `regular` 이면 `default` 로). `groupId` 를 명시해 `system:superuser` 로 넣는 요청은 422.
- 마지막 활성 슈퍼유저의 삭제·강등·비활성화는 409 `last_superuser`. 이때 `AuditSinkRegistry.current().record` 로 `last_superuser_guard_hit` 이벤트를 남긴다(PRD K6 집계 근거. `audited()` 가 남기는 `user_updated` failure 와 별개로 하나 더).
- `username` 유일(409 `username_taken`), 형식 422.
- 시스템 그룹 수정(이름·속성)은 `default` 만 속성 수정 가능, `system:superuser` 는 어떤 수정도 422. 두 시스템 그룹 삭제 422. 소속 사용자 > 0 인 그룹 삭제 409 `group_not_empty`.
- 비밀번호 최소 8자(기존 `MIN_PASSWORD_LENGTH`), 해시는 `bcryptjs` cost 12. 테스트 시간을 위해 `IdentityStore.bcryptCost`(정적, 기본 12)를 테스트에서 4 로 낮출 수 있다. 검증(`bcrypt.compare`)은 해시에 든 cost 를 따르므로 운영 데이터와 무관하다.
- 비활성화 시 `SessionStore.removeSessionsOfUser(id)` 즉시 호출.

### 4.2 `IdentityMigration` (기동 시, `ServerApp` 에서 `AdminServer` 생성 전에 1회)

| 상태 | 동작 |
|---|---|
| `identity.yaml` 있음 | 로드. 끝 |
| 없음, `.key` 에 해시 있음 | 사용자 `admin`(role superuser, group system:superuser, passwordHash = `.key` 내용, `migratedFromLegacyAdmin: true`) + 시스템 그룹 2개를 `identity.yaml` 로 원자 저장. `.key` 는 **그대로 둔다**(롤백용, 삭제 금지). 로그 `identity migrated from legacy admin key` |
| 없음, `.key` 가 없거나 비어 있음(신규 설치. 현재 판정은 `SessionStore.ensureBootstrapState`(`:187`)) | 빈 identity 를 저장하지 않고 `bootstrapRequired` 상태. 최초 로그인(`/api/login` 에 `username`, `password`, `bootstrapToken`)이 성공하면 그 순간 슈퍼유저를 만들고 저장. 토큰 파일 처리는 기존 `SessionStore.ensureBootstrapState/clearBootstrapToken` 로직을 `IdentityMigration` 으로 옮긴다 |
| 저장 실패(권한·디스크) | `mode = 'legacy-fallback'`: 로그인은 `.key` 해시로만 검증하고, 성공 시 가상 주체 `{userId:'legacy-admin', role:'superuser'}` 로 세션을 만든다. 사용자·그룹 API 는 503 `identity_store_unavailable`. 서버는 기동한다(PRD §8.2 폴백) |

`.key` 의 레거시(비 bcrypt) 해시 판정과 재해시 로직(`SessionStore.ts:224-234` 의 `verifyPassword` 가 돌려주는 `migrateToBcrypt`)은 `IdentityMigration` 으로 옮겨 승격 시점에 한 번 적용한다. 레거시 해시 함수는 `IdentityMigration.hashLegacyPassword` 로 노출한다(기존 테스트가 `SessionStore.prototype.hashPassword` 를 직접 부른다): 레거시 해시면 로그인 성공 직후 bcrypt 로 재해시해 `identity.yaml` 에 저장.

### 4.3 `SessionStore` 변경

```ts
type Session = {key: string; userId: string; createdAt: number; lastSeenAt: number; timeout: number; ip: string; userAgent?: string};
newSession(userId: string, meta: {ip: string; userAgent?: string}): Promise<string>;
resolveSession(sessionKeys: string[]): Session | undefined;       // 유효하면 lastSeenAt·timeout 갱신
isSessionValid(keys): Promise<boolean>;                           // resolveSession 위임 (호환)
removeSession(key); removeSessionsOfUser(userId, options?: {except?: string}): number; listSessions(): Session[];   // except 는 현재 세션 키(비밀번호 변경 시 유지). list 는 4 단위가 사용
static sessionIdOf(key: string): string;   // sha256(key).slice(0,16). 감사 sessionIdHash 와 4 단위 세션 API 의 id 가 이 한 곳을 쓴다
```

`loginWithDetails`, `loadKey`, 부트스트랩 관련 메서드는 `IdentityStore`/`IdentityMigration` 으로 옮기고 `SessionStore` 에서 제거한다. 관리자 세션 TTL 은 지금처럼 고정 12시간(`SessionStore.ts:19` `DEFAULT_TIMEOUT`)·요청마다 연장·sweep 을 유지한다. `ServerOption.sessionTtlMs` 는 컨트롤 터널 세션의 유휴 TTL(`TunnelServer.ts:88-203`)이라 관리자 세션과 무관하며 건드리지 않는다.

이름 구분: 기존 `src/server/IdentityRegistry.ts` 는 프로토콜 v2 의 **클라이언트** 신원(trusted client, 바인딩 토큰)이고, 이 단위의 `rbac/Identity*` 는 **관리자 사용자** 신원이다. 파일 충돌은 없지만 import 할 때 혼동하지 않는다.

### 4.4 `Principal` 과 `AdminAuthorizer`

```ts
type Principal = {userId; username; role: Role; groupId; attributes: GroupAttributes /* superuser 는 무시 */; mustChangePassword: boolean; legacy?: true};
type Action =
  | 'user:manage' | 'group:manage' | 'server:manage' | 'security:manage' | 'session:manage' | 'audit:read-all'
  | 'tunnel:list' | 'tunnel:create' | 'tunnel:read' | 'tunnel:update' | 'tunnel:delete' | 'tunnel:activate' | 'tunnel:cert' | 'tunnel:reassign'
  | 'status:read' | 'me:read' | 'me:password' | 'me:sessions' | 'audit:read-self';
type Target = {port?: number; owner?: {userId: string; groupId: string}};   // owner 는 호출부가 채워 넣어 authorize 를 순수 함수로 유지한다(p95 테스트 성립). U2-04 는 owner 를 채우지 않고 U2-08 이 채운다
type Decision = {allowed: true} | {allowed: false; status: 403 | 404; code: string};
authorize(principal: Principal, action: Action, target?: Target): Decision;
```

규칙(PRD 부록 A 를 코드로):
- `mustChangePassword` 이면 `me:read`, `me:password` 외 전부 403 `password_change_required`.
- 슈퍼유저: 전부 허용.
- 일반 유저: `user:manage group:manage server:manage security:manage session:manage audit:read-all status:read tunnel:reassign tunnel:cert` → 403. `tunnel:list` 는 `tunnel_crud !== 'none'`. `tunnel:create` 는 `tunnel_crud === 'full' && max_tunnel_count > 0`. `tunnel:read` 는 소유 터널 또는 `tunnel_visibility === 'group_read'` 인 같은 그룹원의 터널; 그 외 **404**(존재를 숨긴다). `tunnel:update/delete/activate` 는 소유 터널이고 `tunnel_crud === 'full'`; 그룹 공유 터널은 403 `read_only`. `me:*`, `audit:read-self` 허용.
- `sections(principal)`: 슈퍼유저 → `['status','tunnels','server','users','groups','security','audit','sessions','me']`. 일반 유저 → `admin_ui_section_access` 를 `{tunnels→'tunnels', my_audit→'audit', my_profile→'me', my_sessions→'sessions'}` 로 사상하되 `tunnel_crud === 'none'` 이면 `tunnels` 제외.

### 4.5 `AttributeEnforcer` (일반 유저의 터널 생성·수정 입력 검증)

`enforce(principal, next: TunnelingOption, mode: 'create' | 'update', context: {ownedCount: number; trustedClientIds: string[]}): {success: true} | {success: false; status: 403 | 409 | 422; code; message}`

수정(`update`) 때도 `next` 전체를 검사한다. 기존 값이 이미 범위 밖(예: 그룹 속성이 나중에 좁아짐)이면 일반 유저는 수정할 수 없고(422), 슈퍼유저가 고치거나 재할당한다.

| 검사 | 실패 |
|---|---|
| 생성 시 `ownedCount >= max_tunnel_count` | 409 `tunnel_count_exceeded` |
| `forwardPort` 가 `allowed_port_range` 어느 구간에도 없음 | 422 `port_not_allowed` |
| 프로토콜 사상: `tcp→TCP`, `http→HTTP`, `https→HTTPS`; `httpOption` 에 리라이트(host/ACAO/헤더/본문 중 하나라도 설정)가 있으면 추가로 `HTTP_REWRITE` 필요 | 422 `protocol_not_allowed` |
| `allowedClientIds` 의 각 id 가 `allowed_trusted_clients` 에 없음 | 422 `trusted_client_not_allowed` |
| `httpOption.replaceAccessControlAllowOrigin` 이고 `!permissions.cors`; `rewriteHostInTextBody` 이고 `!host`; `customRequestHeaders/customResponseHeaders` 비어 있지 않고 `!header`; `bodyRewriteRules` 비어 있지 않고 `!body` | 422 `rewrite_not_allowed` |
| `allowedClientNames`(레거시 이름 기반) 사용 | 422 `legacy_client_names_not_allowed` (일반 유저는 clientId 만) |

슈퍼유저는 `enforce` 를 거치지 않는다.

### 4.6 `AuditSink`

```ts
type AuditEvent = {at: number; actor: {userId; username; role?: Role} | {userId: 'system'}; sessionIdHash?: string; ip?: string;
    type: string;             // 'user_created' 등, 4 단위가 목록 확정
    target?: {kind: 'user' | 'group' | 'tunnel' | 'server' | 'session' | 'security'; id: string};
    outcome: 'success' | 'failure'; summary: string; detail?: Record<string, unknown>};
interface AuditSink { record(event: AuditEvent): Promise<void>; }
class LoggerAuditSink implements AuditSink { /* logger.info('audit', JSON) */ }
const AuditSinkRegistry = { current(): AuditSink; set(sink: AuditSink): void; reset(): void };
```

`AdminServer` 의 모든 CUD 핸들러는 `this.audited(req, principal, type, target, async () => …)` 헬퍼를 거친다. 헬퍼는 성공·실패(예외·`success:false`)를 모두 `record` 한다. 4 단위는 `AuditSinkRegistry.set(new FileAuditSink())` 만 하면 된다. (`AuditSink` 는 U2-05 이후 항상 존재한다.) `sessionIdHash` 는 `SessionStore.sessionIdOf(sessionKey)`. `AuditSink` 인터페이스에는 `reserve(): boolean` 도 처음부터 둔다(`LoggerAuditSink` 는 항상 true). `audited()` 는 핸들러를 실행하기 **전에** `reserve()` 를 부르고 false 면 실행 없이 503 `audit_unavailable` 을 낸다. 4 단위는 `FileAuditSink` 만 갈아끼우고 `audited()` 를 고치지 않는다.

## 5. 관리 API

### 5.1 라우팅 구조 변경

`AdminServer` 의 `if/else` 체인을 라우트 표로 바꾼다. 표는 `src/server/admin/routes.ts` 에 `export const ADMIN_ROUTES: readonly Route[]` 로 두어 감사 커버리지 테스트(K3)가 순회할 수 있게 한다.

```ts
type Route = {method: 'GET'|'POST'|'PUT'|'DELETE'; pattern: RegExp;
    action: Action | 'public' | 'session' | ((ctx: RouteContext) => Action);   // 함수형은 본문·주체를 보고 action 을 고른다(예: POST tunnelingOption 은 기존 포트면 update, 아니면 create)
    handler: (ctx: RouteContext) => Promise<void>};
type RouteContext = {req; res; params: Record<string,string>; principal?: Principal; ip: string};
```

- `route()` 는 CSRF 검사(기존. **매칭보다 먼저**, POST/PUT/DELETE 는 매칭 결과와 무관하게 통과해야 한다 — `admin-routes.test.ts:73` 이 `POST /api/absent` + 악성 Origin 에 403 을 기대한다) → 라우트 매칭(없으면 `/api/` 경로는 404 JSON) → `action !== 'public'` 이면 `resolveSession` → 없으면 401 → **그다음** `readJson`(세션 없는 POST 가 413/400 대신 401 을 받는 기존 동작 유지) → `principal` 구성 → `action` 이 `'session'` 이 아니면 `authorize` → 403/404 → 핸들러. `/api/externalCert/:port`·`/api/clientSysInfo/:id` 의 세그먼트는 `[^/]*`(빈 값 허용)로 잡고 `getNumberInPath` 로 판정한다. 포트는 권한 판정(`tunnelPortOf`)과 같은 `parsePathPort`(1–65535 의 십진 표기만)를, id 는 `parsePathId`(십진 숫자만)를 쓴다. 빈 값·`abc`·`12suffix`·`1e3` 은 400 이다(#138 — 예전의 `parseInt` 접두 해석은 판정과 동작이 다른 포트로 읽히는 우회로였다). 기존 `routePost` 가 PUT 도 같은 핸들러로 처리하므로 표에는 POST 경로마다 PUT 행도 둔다(동작 동일).
- 기존 핸들러 본문은 그대로 옮기고 `checkSession` 호출만 제거한다. 3.1 규약의 응답 형태 유지. 새 RBAC 핸들러(사용자·그룹·me)는 `src/server/admin/rbacRoutes.ts` 에 두고 `RouteContext` 에 `ok(data)`, `fail(status, code, message)`, `auditDetail(obj)` 헬퍼를 둔다(`AdminServer.ts` 가 2,000줄을 넘지 않게).
- `public`: `/api/login`, `/api/version` 두 개. `'session'`(세션만 있으면 됨): `/api/csrfToken`, `/api/validateSession`, `/api/logout`.
- 로그인 성공 이벤트 `login_success` 는 `actor.role` 을 채운다(PRD K2 는 `role=superuser` 로 집계한다).

### 5.2 엔드포인트 표

| 메서드·경로 | action | 요청 | 응답·동작 |
|---|---|---|---|
| `POST /api/login` | public | `{username, password, bootstrapToken?}`. **호환 별칭(U2-02~U2-09 동안만):** `password` 가 없으면 `key` 값을 password 로, `username` 이 없으면 `'admin'` 으로 간주한다. 이 별칭은 U2-10 가 UI(`LoginCtrl`)와 `processTunnelHarness.adminRequest` 를 바꾼 뒤 같은 이슈에서 제거한다 | 성공: 쿠키 2개(기존) + `{user: {id, username, displayName, role}, mustChangePassword}`. 부트스트랩 필요: `weakPassword ? 400 : 403`(기존 `AdminServer.ts:1071`) + `{bootstrapRequired: true, invalidBootstrapToken?, weakPassword?}`. 실패 401. 백오프·429 유지. |
| `POST /api/logout` | session | — | 세션 삭제, `Set-Cookie` 로 두 쿠키 만료 |
| `GET /api/validateSession` | session | — | `{valid: true, user, mustChangePassword}` |
| `GET /api/me` | me:read | — | `{user, group: {id, name, attributes}, sections: string[], migrationBanner: boolean}` |
| `PUT /api/me/password` | me:password | `{currentPassword, newPassword}` | 현재 비밀번호 검증(`mustChangePassword` 상태에서는 임시 비밀번호가 current) → `setPassword(clearMustChange: true)` → 다른 세션 전부 제거(현재 세션 유지) |
| `POST /api/me/acknowledge-migration` | me:read | — | `migrationAcknowledged = true` |
| `GET /api/users` | user:manage | — | `{users: Array<UserView>}` (`passwordHash` 제외, `groupName` 포함) |
| `POST /api/users` | user:manage | `{username, displayName?, role, groupId?, temporaryPassword?}` | `temporaryPassword` 생략 시 서버가 16자 무작위(대소문자·숫자) 생성. `mustChangePassword: true`. 응답 `{user, temporaryPassword}` — **이 응답에만 평문 1회**. 감사 `user_created`, `temp_password_issued`(평문은 기록 금지) |
| `GET /api/users/:id` | user:manage | — | `{user}` |
| `PUT /api/users/:id` | user:manage | `{displayName?, role?, status?, groupId?}` | 불변식 적용. 역할 변경 감사 `role_changed`, 상태 변경 `user_status_changed` |
| `DELETE /api/users/:id` | user:manage | — | 소유 터널이 있으면 409 `user_owns_tunnels` (먼저 재할당). 세션 제거 |
| `POST /api/users/:id/password-reset` | user:manage | `{temporaryPassword?}` | 새 임시 비밀번호, `mustChangePassword: true`, 세션 제거. 응답에 평문 1회 |
| `GET /api/groups` | group:manage | — | `{groups: Array<Group & {memberCount}>}` |
| `POST /api/groups` | group:manage | `{name, attributes?}` | 기본값 채움 |
| `GET /api/groups/:id` | group:manage | — | `{group, members: UserView[]}` |
| `PUT /api/groups/:id` | group:manage | `{name?, attributes?}` | 정합성 규칙. 감사 `group_attributes_changed`(변경된 키 목록) |
| `DELETE /api/groups/:id` | group:manage | — | 가드 |
| `GET /api/tunnelingOption` | tunnel:list | — | 소유·가시성 필터(`authorize(principal, 'tunnel:read', {port}).allowed` 인 항목만). 각 항목에 `owner: {id, username} \| {id: 'system:migrated'}`, `editable = authorize(principal, 'tunnel:update', {port}).allowed` 추가 |
| `POST /api/tunnelingOption` | 함수형: 본문 `forwardPort` 가 기존 옵션이면 `tunnel:update`, 아니면 `tunnel:create` | 기존 본문 + `ownerId?`(슈퍼유저만) | 일반 유저: `AttributeEnforcer`, `ownerId = principal.userId`. 기존 포트인데 소유가 아니면 404 |
| `DELETE /api/tunnelingOption` | tunnel:delete | 기존 | 소유 검사 |
| `PUT /api/tunnelingOption/:port/owner` | tunnel:reassign | `{ownerId}` | `ownerId` 는 사용자 id 또는 `'system:migrated'`. 감사 `tunnel_reassigned` |
| `POST /api/tunneling/active/:port` | tunnel:activate | 기존 | 소유 검사 |
| `GET /api/externalServerStatuses` | tunnel:list | — | 볼 수 있는 포트만 |
| `GET/POST/DELETE /api/externalCert/:port` | tunnel:cert | 기존 | 슈퍼유저 전용(PRD §11 인증서 업로드 제외) |
| `GET/POST /api/serverOption`, `serverOptionHash`, `adminCert` | server:manage | 기존 | |
| `GET /api/sysInfo`, `sysUsage`, `clientStatus`, `clientSysInfo/:id` | status:read | 기존 | |
| `GET /api/version` | public | | |

`UserView = {id, username, displayName, role, status, groupId, groupName, mustChangePassword, migratedFromLegacyAdmin, createdAt, updatedAt}`.

### 5.3 터널 소유권

- `TunnelingOption.ownerId?: string`. 없으면 `system:migrated` 로 읽는다(읽기 호환, `server.yaml` 을 건드리지 않음). 새로 저장할 때만 필드를 쓴다.
- `AuthorizationContext.ownerOf(port)` 는 `ServerOptionStore` 의 옵션과 `IdentityStore` 를 조합한다. 사용자 삭제는 소유 터널이 있으면 거부하므로 고아 소유자는 생기지 않는다(단, `identity.yaml` 수동 편집으로 생기면 `system:migrated` 취급하고 경고 로그).

## 6. `AuthorizationContext` (5 단위 계약)

```ts
export const AuthorizationContext = {
    ownerOf(port: number): {userId: string; groupId: string; role: Role} | undefined,   // system:migrated → undefined
    groupAttributes(groupId: string): GroupAttributes,
    portsOfGroup(groupId: string): number[],
    isSuperuserOwned(port: number): boolean,
    targetOf(port: number): Target                      // {port, owner} 를 채워 authorize 에 넘긴다
};
```

## 7. 클라이언트 (관리자 UI) 변경 — U2-10

- `admin/src/controller/LoginCtrl.ts`: `login(username, password, bootstrapToken?)`. 응답의 `user`, `mustChangePassword` 반환.
- `admin/src/me.ts`(신규. 단위 1 의 `shell/session.ts`(`useSession().invalidate()`)와 이름이 겹치지 않게 `me.ts` 로 한다): `me` 스토어(`/api/me` 결과), `loadMe()`, `clearMe()`. `App.svelte` 가 세션 확인 뒤 `loadMe()`.
- `LoginScreen`: `Field label="Username"` + `TextInput id="login-username" autocomplete="username"` 을 비밀번호 위에 추가. 부트스트랩 상태에서는 힌트 "Choose the first superuser name (default: admin)". 저장된 마지막 username 을 `localStorage['tttgate.lastUsername']` 에 기억.
- `test/helpers/adminApp.ts` 의 `startAdminApp` 옵션 `login?: boolean` 을 `login?: boolean | {username: string; password: string}` 로 넓힌다(`true` = admin / `test-password-1234`). 별도 `loginAs` 옵션은 만들지 않는다.
- `Drawer` 에 "Sign out" 항목(`POST /api/logout` → `clearMe()` → 상태 Invalid). NAV 는 `me.sections` 로 필터(3 단위가 항목을 늘린다; 이 단위에서는 `status/tunnels/server` 가 sections 에 있을 때만 보임).
- `App.svelte`: `me.mustChangePassword` 이면 3 단위의 `#/me/password` 로 보낸다. 3 단위 전에는 임시로 `<p role="alert">Password change required. Use the API or wait for the account screen.</p>` 를 표시(U3-01 이 대체).

## 8. 테스트

### 8.1 단위 (`test/unit/server/rbac/`)

- `IdentityTypes.test.ts`: username 형식, 속성 검증·정합성 규칙 표, 기본값.
- `IdentityStore.test.ts`: 임시 루트에 yaml 왕복(저장→새 인스턴스 로드 동일), 4.1 불변식 각각, 원자 저장(저장 중 임시 파일이 rename 됨: 저장 후 디렉터리에 `.tmp` 잔재 없음), 비밀번호 해시 검증.
- `IdentityMigration.test.ts`: `.key`(bcrypt) → 승격 결과와 `.key` 보존, 레거시 해시 → 첫 로그인 후 재해시, 신규 설치 부트스트랩, 쓰기 실패(읽기 전용 디렉터리 또는 `Files.writeAtomicSync` 를 던지는 스텁 — 정책상 파일시스템 경계 스텁 허용) → `legacy-fallback`.
- `AdminAuthorizer.test.ts`: 부록 A 매트릭스를 표 데이터로(역할 × action × target 소유/타인/그룹공유) 전수. 성능(NFR-PERF-PERMCHECK-001): 일반 유저 주체로 `authorize` 를 10,000회 호출해 p95 ≤ 0.2ms(순수 함수 기준).
- `authorize-latency.test.ts`(`test/component/server/admin/`): 실제 `AdminServer` 에 `RouteContext.timing = {authorizeStartNs, authorizeEndNs}` 를 기록하게 하고 응답 헤더 `X-Authz-Us` 로 노출한다. 노출은 `AdminServer` 생성자 옵션 `exposeAuthzTiming?: boolean`(기본 false)으로만 켜고 환경변수는 쓰지 않는다. `/api/tunnelingOption` GET 1,000회의 p95 ≤ 2ms 를 단언(PRD K5).
- `AttributeEnforcer.test.ts`: 4.5 표 각 행, 슈퍼유저 우회.

### 8.2 컴포넌트 (`test/component/server/admin/`, 실제 `AdminServer`)

- `rbac-login.test.ts`: username 로그인, `mustChangePassword` 세션의 403 `password_change_required`, `/api/me/password` 후 정상, `/api/logout` 후 401, 백오프 유지(기존 `req-07` 테스트 통과).
- 기존 `test/unit/server/admin/SessionStore.test.ts`·`SessionStore.security.test.ts` 와 `test/admin/login-bootstrap.test.ts:155`(`SessionStore.prototype.hashPassword`)는 `loginWithDetails`·부트스트랩 메서드를 직접 부른다. U2-02 는 같은 시나리오를 `IdentityStore`/`IdentityMigration` API 로 옮겨 다시 쓴다(삭제 금지). `login-bootstrap.test.ts:106` 의 로그인 본문 정확 단언(`{key, bootstrapToken}`)은 U2-02 에서는 호환 별칭으로 유지되고 U2-10 가 `{username, password, bootstrapToken}` 으로 갱신한다.
- 기존 `test/component/server/admin/*.test.ts`(18개: `admin-routes`, `AdminServer.security`, `configuration-*` 등)는 라우트 표 전환의 직접 영향권이므로 U2-02·U2-03 의 수용 기준에 전체 통과를 포함한다.
- `rbac-users-groups.test.ts`: 전체 CRUD 왕복, 임시 비밀번호 1회 노출, 마지막 슈퍼유저 가드, 그룹 삭제 가드, 일반 유저의 403.
- `rbac-tunnel-ownership.test.ts`: 두 일반 유저(같은 그룹 `group_read` / 다른 그룹)와 슈퍼유저로 목록·읽기·수정·삭제·활성화·재할당의 200/403/404 표, 속성 집행(포트 범위·프로토콜·개수·리라이트).
- `audit-sink.test.ts`: 모든 CUD 라우트가 `AuditSink.record` 를 성공·실패 양쪽에서 부르는지(라우트 표를 순회해 CUD 항목 전수 — PRD K3 의 자동 검증. 4 단위가 이 테스트를 확장).

### 8.3 E2E (프로세스 하네스)

- `test/e2e/browser/legacy-admin-migration.test.ts`: `.key` 만 있는 루트로 기동 → `identity.yaml` 생성 확인 → 브라우저에서 `admin` / 기존 비밀번호로 로그인 성공 → 터널 목록에 소유자 `system:migrated`. 재기동해도 재승격되지 않음(파일 mtime 불변). `.key` 존재.

## 9. 이슈 분할

| # | 제목 | 만드는 것 | 수용 기준 | 선행 |
|---|---|---|---|---|
| U2-01 | 신원 타입·저장소·마이그레이션 | `rbac/{IdentityTypes,IdentityStore,IdentityMigration,legacyPasswordHash}.ts`, `identity.yaml`, `bcryptCost` 조절 | 8.1 의 세 테스트 | — |
| U2-02 | 세션 저장소를 사용자 기반으로 | `SessionStore` 4.3, `AdminServer` 로그인 핸들러가 `IdentityStore.verifyPassword` 사용(호환 별칭 `key`/`admin`), `/api/logout`, `validateSession` 응답 확장, 기존 SessionStore 테스트 세 파일의 이전 | `rbac-login.test.ts` 로그인·로그아웃 부분, 기존 `test/admin`·`test/unit/server/admin`·`test/component/server/admin` 전부 통과 | U2-01 |
| U2-03 | 라우트 표 전환 | `routes.ts` 의 `ADMIN_ROUTES`, `route()` 의 매칭·세션 해석 골격(권한 검사는 아직 `'session'` 동작), 기존 핸들러 본문 이동. **동작 동일** | 기존 테스트 전부, 새 `routes.test.ts`(표의 경로가 U2-03 시작 시점의 기존 경로 전부와 일치, 알 수 없는 경로 404) | U2-02 |
| U2-04 | 권한 결정기와 게이트 | `Principal`, `AdminAuthorizer`, `route()` 의 `authorize` 호출, `mustChangePassword` 게이트, `/api/me`, `/api/me/password`, `/api/me/acknowledge-migration` | `AdminAuthorizer.test.ts`(p95 포함), `authorize-latency.test.ts`, `rbac-login.test.ts` 전체 | U2-03 |
| U2-05 | 감사 삽입점 | `audit/AuditSink.ts`(`reserve` 포함), `audited()` 헬퍼로 기존 CUD 핸들러 감싸기, `last_superuser_guard_hit`, `login_success` 의 `actor.role` | `audit-sink.test.ts` | U2-04 |
| U2-06 | 사용자·그룹 API | `rbacRoutes.ts`, `/api/users*`, `/api/groups*`, 임시 비밀번호 | `rbac-users-groups.test.ts` | U2-05 |
| U2-07 | 속성 집행기와 권한 컨텍스트 | `AttributeEnforcer`, `AuthorizationContext`(`ownerOf`·`groupAttributes`·`portsOfGroup`·`targetOf`), 단위 테스트 2개. **라우트에는 아직 연결하지 않는다** | `AttributeEnforcer.test.ts`, `AuthorizationContext.test.ts` | U2-06 |
| U2-08 | 터널 소유권 적용 | `TunnelingOption.ownerId` 저장·읽기 호환, 터널 라우트의 소유·가시성 필터와 `editable`, `enforce` 연결, `PUT /api/tunnelingOption/:port/owner`, `DELETE /api/users/:id` 의 `user_owns_tunnels` 가드, `owner`·`editable` 추가로 깨지는 기존 깊은 동등 단언 갱신 | `rbac-tunnel-ownership.test.ts` | U2-07 |
| U2-09 | 마이그레이션·롤백 E2E 와 문서 | 3.1 롤백 계약(`.bak` 배치 쓰기, 삽입점은 `prepareServerOptionCommit` 하나), `legacy-admin-migration.test.ts`, 프로세스 하네스의 `identityFixture` 직렬화 구현(단위 0 §3.2 확장 지점; U0-01 의 임시 해시 로직을 대체), `docs/guide/MIGRATION.md`(승격·롤백 절차, `.bak`·`.key` 보존 규칙, legacy-fallback 증상, K1 다운타임 리허설 절차) | E2E 통과, `rollback-backup.test.ts`(첫 신필드 저장 시 `.bak` 2개 생성, 두 번째 저장은 덮어쓰지 않음), 하네스 `identityFixture` 로 일반 유저 로그인 E2E | U2-08, U0-01, U0-06 |
| U2-10 | 관리자 UI 로그인·세션 스토어·로그아웃 | 7절 전부 + `processTunnelHarness.adminRequest` 를 `{username, password}` 로 변경 + `/api/login` 호환 별칭 제거 + `{key}` 로 로그인하는 기존 호출부 전부 갱신. **UI 레인에 속한다**(`App.svelte`·`Drawer.svelte`·`LoginScreen.svelte` 를 만지므로 U1-10 뒤에 배치) | `screen-login.test.ts` 에 username 케이스 추가, `shell.test.ts` 에 Sign out 케이스 추가, 별칭 제거 후 `{key}` 로그인이 401, 기존 테스트 전부 통과 | U2-04, U1-10, U0-01 |
