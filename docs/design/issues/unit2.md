# 단위 2 이슈 초안 — 계정·그룹·권한 모델과 관리 API

근거: [단위 2 설계](../2026-09-11-unit2-rbac-model-api.md), [프로그램 개요](../2026-09-11-program-overview.md), [PRD](../../plan/prd/TTTGate-admin-rbac.md)

## U2-01

**title**: feat(admin): 관리자 신원 타입·저장소·기동 시 승격 마이그레이션 추가
**labels**: enhancement, area:admin, unit:2
**body**:
## 목적

관리자 사용자와 그룹을 `config/identity.yaml` 에 저장하는 모듈 `src/server/rbac/` 를 만든다. 이 이슈가 끝나면 사용자·그룹 CRUD 와 비밀번호 검증이 코드에서 가능해지고, 서버 기동 시 기존 단일 관리자(`config/.key`)가 슈퍼유저 `admin` 으로 자동 승격된다. `AdminServer` 와 `SessionStore` 는 아직 이 모듈을 쓰지 않는다(U2-02).

## 배경

- `src/server/admin/SessionStore.ts:32-301` 싱글턴이 관리자 비밀번호 해시 하나를 `config/.key` 에서 읽는다(`loadKey` `:62`). `.key` 가 없거나 비어 있으면 `ensureBootstrapState` `:187` 이 `config/.bootstrap-token`(0o600) 을 만들고, `loginWithDetails(key, bootstrapToken)` `:145` 가 최초 비밀번호를 설정한다. 레거시 SHA512 해시는 `hashPassword` `:178`(비밀번호 + `'@'`, 문자코드/2 를 16진수로 이은 salt, sha512 hex) 로 비교하고 로그인 성공 시 bcrypt 로 재해시한다(`verifyPassword` `:224`, `migrateToBcrypt`). 토큰 비교는 `timingSafeStringEqual` `:221`. 상수 `MIN_PASSWORD_LENGTH = 8` `:22` 은 export 되지 않는다(설계 문서는 "기존 `MIN_PASSWORD_LENGTH`" 라 쓰지만 모듈 밖에서 쓸 수 없으므로 이 이슈가 `IdentityTypes.ts` 에 새로 정의한다).
- 원자 저장: `src/util/Files.ts:160` `writeAtomicSync(file: File, data: any): void`(임시 파일 `.<name>.<pid>.<ts>.<seq>.tmp` → `renameSync`), `:19` `writeAtomicBatchSync(changes: AtomicFileValue[]): void`(`AtomicFileValue = {file: File, data?: Buffer | string, mode?: number}`).
- 경로: `src/Environment.ts:12` `Environment.path.configDir`. 파일 래퍼 `src/util/File.ts`.
- 시계·난수: `src/util/ClockRng.ts` 의 `ClockRngProvider.current().now()`(`SessionStore.ts:54` 참조). `createdAt/updatedAt` 은 이것으로 찍는다.
- 비밀값 비교: `src/util/timingSafeStringEqual.ts` `timingSafeStringEqual(a, b, 'utf8')`. `npm run lint`(`scripts/lint-auth-compare.mjs:26`)가 식별자에 `token`·`secret`·`sessionId` 등이 든 `===`/`!==` 비교를 실패 처리한다. 부트스트랩 토큰·레거시 해시 비교는 이 함수만 쓴다.
- 기존 `src/server/IdentityRegistry.ts` 는 프로토콜 v2 의 **클라이언트** 신원(trusted client)이다. 이 이슈의 `rbac/Identity*` 는 **관리자 사용자** 신원이며 서로 import 하지 않는다.
- 테스트 루트: `test/helpers/runtime.ts:24` `createTestRoot(prefix)`, `applyTestRoot(rootDir)`, `cleanupTestRoot(root)`. `resetRuntimeState` `:55` 가 `SessionStore.resetForTest()` 를 부른다.
- 의존성: `bcryptjs ^2.4.3`, `yaml ^2.3.1` 은 이미 `package.json` dependencies 에 있다. 새 패키지를 추가하지 않는다.

먼저 열어 볼 파일: `src/server/admin/SessionStore.ts`, `src/util/Files.ts`, `src/util/File.ts`, `src/util/timingSafeStringEqual.ts`, `src/Environment.ts`, `test/helpers/runtime.ts`, `test/unit/server/admin/SessionStore.security.test.ts`(부트스트랩·레거시 해시 테스트의 작성 방식).

## 적용되는 결정

- D1 기능 범위는 PRD v0.2 RBAC 전체 → 사용자·그룹 모델은 PRD §4, §5.1.1~5.1.3, §7 을 그대로 따른다.
- D14 동작 변경은 2번 단위부터 → 이 이슈는 서버 기동 경로에 마이그레이션을 끼워 넣지만 `AdminServer` 의 로그인 동작은 바꾸지 않는다(U2-02).
- 개요 §3.1 비밀값 비교는 `timingSafeStringEqual` 만.

## 만들 것

### `src/server/rbac/IdentityTypes.ts`

```ts
export type Role = 'superuser' | 'regular';
export type UserStatus = 'active' | 'disabled';
export type TunnelCrud = 'none' | 'read_only' | 'full';
export type AllowedProtocol = 'TCP' | 'HTTP' | 'HTTPS' | 'HTTP_REWRITE';
export type AdminUiSection = 'tunnels' | 'my_audit' | 'my_profile' | 'my_sessions';
export type TunnelVisibility = 'private' | 'group_read';
export type RateLimitPreset = 'unlimited' | '1MB/s' | '10MB/s' | '100MB/s';
export type PortRange = {from: number; to: number};
export type RewritePermissions = {cors: boolean; host: boolean; header: boolean; body: boolean};
export type GroupAttributes = {
    tunnel_crud: TunnelCrud;                       // 기본 'full'
    max_tunnel_count: number;                      // int >= 0, 기본 10
    max_tunnel_duration_ms: number;                // int >= 0 (0 = 무제한), 기본 0
    allowed_port_range: PortRange[];               // 각 항목 1..65535, from <= to. 기본 []
    allowed_protocols: AllowedProtocol[];          // 기본 []
    max_concurrent_connections: number;            // int >= 0, 기본 100
    allowed_trusted_clients: string[];             // clientId 목록. '*' 는 허용하지 않는다. 기본 []
    http_tunnel_rewrite_permissions: RewritePermissions;   // 기본 모두 false
    admin_ui_section_access: AdminUiSection[];     // 기본 네 개 전부
    tunnel_visibility: TunnelVisibility;           // 기본 'private'
    rate_limit: RateLimitPreset;                   // 기본 'unlimited'
};
export type User = {
    id: string;                    // 'u_' + 16 hex (crypto.randomBytes(8))
    username: string;              // 3..32 자, /^[a-z0-9._-]+$/, 소문자 저장, 유일
    displayName: string;           // 1..64 자
    role: Role;
    status: UserStatus;
    groupId: string;
    passwordHash: string;          // bcryptjs (기본 cost 12). 레거시 승격 직후에만 SHA512 hex 일 수 있다
    mustChangePassword: boolean;
    migratedFromLegacyAdmin: boolean;
    migrationAcknowledged: boolean;
    createdAt: number;
    updatedAt: number;
};
export type Group = {id: string; name: string; system: boolean; attributes: GroupAttributes};   // id: 'g_' + 16 hex 또는 시스템 id
export type IdentityFile = {version: 1; users: User[]; groups: Group[]};

export const IDENTITY_FILE_NAME = 'identity.yaml';
export const IDENTITY_SCHEMA_VERSION = 1;
export const SYSTEM_SUPERUSER_GROUP_ID = 'system:superuser';
export const DEFAULT_GROUP_ID = 'default';
export const MIGRATED_OWNER_ID = 'system:migrated';
export const MIN_PASSWORD_LENGTH = 8;
export const DEFAULT_GROUP_ATTRIBUTES: Readonly<GroupAttributes>;   // 위 기본값. 호출자는 항상 깊은 복사해서 쓴다

export type Result<T> = {success: true; value: T} | {success: false; status: 404 | 409 | 422; code: string; message: string};
export type ValidationFailure = {success: false; status: 422; code: string; message: string};

export function validateUsername(value: unknown): {success: true; value: string} | ValidationFailure;   // trim → toLowerCase → 길이·정규식. 실패 code 'username_invalid'
export function validateDisplayName(value: unknown): {success: true; value: string} | ValidationFailure;   // 'display_name_invalid'
export function validatePassword(value: unknown): {success: true; value: string} | ValidationFailure;      // 문자열이고 trim 길이 >= 8. 'password_too_short'
export function validateGroupAttributes(patch: unknown, base: GroupAttributes): {success: true; value: GroupAttributes} | ValidationFailure;
export function newUserId(): string;    // 'u_' + randomBytes(8).toString('hex')
export function newGroupId(): string;   // 'g_' + randomBytes(8).toString('hex')
export function createSystemGroups(): [Group, Group];   // [system:superuser(Superusers, attributes 기본값), default(Default, attributes 기본값)]
export function isBcryptHash(hash: string): boolean;    // /^\$2[aby]\$\d{2}\$/
```

`validateGroupAttributes` 규칙: `patch` 는 객체여야 하고(아니면 422 `attributes_invalid`), 11개 키 외의 키가 있으면 422 `attributes_unknown_key`(message 에 키 이름). `base` 에 `patch` 를 얕게 덮어쓴 뒤 각 키를 검사한다. 실패 코드는 키 이름을 message 에 넣고 code 는 아래 표.

| 검사 | code |
|---|---|
| enum 값이 목록 밖 (`tunnel_crud`, `tunnel_visibility`, `rate_limit`, `allowed_protocols` 원소, `admin_ui_section_access` 원소) | `attribute_enum_invalid` |
| 정수 아님 또는 음수 (`max_tunnel_count`, `max_tunnel_duration_ms`, `max_concurrent_connections`) | `attribute_int_invalid` |
| `allowed_port_range` 원소가 `{from, to}` 정수가 아니거나 1..65535 밖이거나 `from > to` | `port_range_invalid` |
| `allowed_trusted_clients` 가 문자열 배열이 아니거나 원소가 빈 문자열·`'*'` | `trusted_clients_invalid` |
| `http_tunnel_rewrite_permissions` 가 네 boolean 키가 아님 | `rewrite_permissions_invalid` |
| `allowed_protocols` 에 `HTTP_REWRITE` 가 없는데 `http_tunnel_rewrite_permissions` 중 true 가 있음 | `rewrite_requires_http_rewrite` |
| `allowed_protocols` 에 `HTTP_REWRITE` 가 있는데 `HTTP` 도 `HTTPS` 도 없음 | `http_rewrite_requires_http` |

배열 원소 중복은 제거하지 않고 그대로 저장한다. 포트 범위는 서로 겹쳐도 된다.

### `src/server/rbac/legacyPasswordHash.ts`

```ts
export function hashLegacyPassword(password: string): string;   // SessionStore.ts:178-185 의 hashPassword 를 그대로 옮긴 것
```

`IdentityStore` 와 `IdentityMigration` 이 둘 다 이 함수를 쓰므로 두 모듈의 순환 import 를 피하려고 별도 파일에 둔다. 구현은 기존 `SessionStore.hashPassword` 와 바이트 단위로 같아야 한다(비밀번호 + `'@'`, 문자코드/2 를 16진수로 이은 salt, sha512 hex). `IdentityMigration` 은 이 함수를 그대로 재export 한다(기존 테스트 `login-bootstrap.test.ts:155` 가 `IdentityMigration.hashLegacyPassword` 로 부른다).

### `src/server/rbac/IdentityStore.ts`

```ts
type LoadResult = {success: true; source: 'file' | 'empty'} | {success: false; reason: 'read-error' | 'parse' | 'validation'; message: string};
type VerifyResult = {success: true; user: User; rehashed: boolean} | {success: false; reason: 'not-found' | 'disabled' | 'mismatch'};
type CreateUserInput = {username: string; displayName?: string; role: Role; groupId?: string; mustChangePassword: boolean; migratedFromLegacyAdmin?: boolean}
    & ({password: string} | {passwordHash: string});   // 설계 §4.1 은 password 만 받지만, 승격은 .key 의 해시를 평문 없이 넣어야 하므로 passwordHash 대안을 둔다

class IdentityStore {
    static get instance(): IdentityStore;
    static resetForTest(): void;
    static bcryptCost: number;                         // 기본 12. 테스트는 beforeAll 에서 4 로 낮추고 afterAll 에서 12 로 되돌린다. 검증(bcrypt.compare)은 해시에 든 cost 를 따른다
    get mode(): 'ready' | 'legacy-fallback';
    enterLegacyFallback(reason: string): void;         // IdentityMigration 이 저장·로드 실패 시 호출. 로그 warn
    get filePath(): string;                            // Environment.path.configDir + '/identity.yaml'
    load(): LoadResult;                                // 파일 없으면 {source:'empty'} 이고 메모리는 사용자 0 + createSystemGroups()
    save(): {success: true} | {success: false; message: string};   // Files.writeAtomicBatchSync([{file, data, mode: 0o600}]). 예외는 여기서 잡아 실패로 바꾼다
    users(): User[]; user(id: string): User | undefined; userByUsername(name: string): User | undefined;   // 반환은 복사본
    groups(): Group[]; group(id: string): Group | undefined;
    createUser(input: CreateUserInput): Promise<Result<User>>;     // password 면 validatePassword 후 bcrypt.hash(password, bcryptCost)
    updateUser(id: string, patch: {displayName?: string; role?: Role; status?: UserStatus; groupId?: string; mustChangePassword?: boolean; migrationAcknowledged?: boolean}): Result<User>;
    deleteUser(id: string): Result<void>;
    setPassword(id: string, password: string, options: {clearMustChange: boolean}): Promise<Result<void>>;
    verifyPassword(username: string, password: string): Promise<VerifyResult>;
    createGroup(input: {name: string; attributes?: Partial<GroupAttributes>}): Result<Group>;
    updateGroup(id: string, patch: {name?: string; attributes?: Partial<GroupAttributes>}): Result<Group>;
    deleteGroup(id: string): Result<void>;
    membersOf(groupId: string): User[];
}
```

`updateUser` 의 `mustChangePassword`·`migrationAcknowledged` 는 설계 §4.1 패치 목록에 없지만 U2-04(`/api/me/acknowledge-migration`)와 U2-06(`password-reset`)이 필요로 하므로 여기서 함께 둔다.

동작 규칙:

- 상태는 `IdentityFile` 하나를 불변 값으로 들고 모든 변경은 새 객체를 만들어 참조를 바꾼 뒤 `save()` 한다. `save()` 가 실패하면 메모리 참조를 되돌리고 그 실패를 `Result` 로 돌려준다(`status: 422`, code `identity_save_failed`). 잠금·뮤텍스를 두지 않는다.
- `save()` 는 `Files.writeAtomicBatchSync([{file: filePath, data: yamlString, mode: 0o600}])` 한 번으로 쓴다. `writeAtomicSync` + 별도 `fs.chmodSync` 조합은 rename 직후 파일이 0644 로 노출되는 구간을 만들므로 쓰지 않는다(`Files.writeAtomicBatchSync` 는 `mode` 를 rename 전에 임시 파일에 적용한다).
- `save()` 는 `system:superuser` 그룹의 `attributes` 만 빈 객체 `{}` 로 직렬화한다(설계 §3 의 파일 예시). 슈퍼유저는 속성을 무시하므로 파일에 기본값을 적어 둘 이유가 없고, 값이 적혀 있으면 운영자가 수정해도 효과가 없다는 오해를 부른다. `load()` 는 `system:superuser` 의 `attributes` 를 `DEFAULT_GROUP_ATTRIBUTES` 의 깊은 복사본으로 채워, 메모리의 `Group` 은 항상 11종 키를 모두 갖는다. 나머지 그룹은 11종을 그대로 저장한다.
- `load()`: YAML 파싱 실패 → `parse`. `version !== 1` 이거나 `users`/`groups` 가 배열이 아니거나 시스템 그룹 2개가 없거나 사용자의 `groupId` 가 존재하지 않는 그룹이면 `validation`. 이 경우 메모리는 비운 채 두고 호출자(IdentityMigration)가 폴백을 결정한다. `version` 이 1 보다 크면 `validation`(하위 호환 없음). 스키마 상향 시 `identity.yaml.bak.<version>` 을 먼저 쓰는 규칙은 version 2 가 생길 때 구현하며, 이 이슈에서는 주석으로만 남긴다.
- `createUser`: `validateUsername` → 유일성(409 `username_taken`) → `displayName` 생략 시 username → `password` 와 `passwordHash` 가 둘 다 있거나 둘 다 없으면 422 `credential_invalid` → `role === 'superuser'` 면 `groupId` 는 무조건 `system:superuser`; `role === 'regular'` 면 `groupId` 생략 시 `default`, 지정 시 존재하는 비시스템 그룹 또는 `default` 여야 하고 `system:superuser` 를 지정하면 422 `superuser_group_reserved`. 존재하지 않는 그룹은 422 `group_not_found`. `status: 'active'`, `migrationAcknowledged: false`. bcrypt 해시는 `save()` 전에 끝내고, 해시 중 다른 호출이 끼어들어도 각 호출이 자기 스냅샷에서 새 파일 객체를 만들므로 마지막 `save()` 가 이긴다 — 이를 막기 위해 `await bcrypt.hash` 가 끝난 직후 정규화된 username 으로 **유일성을 다시 검사해** 그 사이에 같은 이름이 등록되었으면 409 `username_taken` 을 돌려주고, 재검사부터 참조 교체·`save()` 까지의 동기 구간을 한 틱 안에서 끝낸다(그 사이에 `await` 를 두지 않는다).
- `updateUser`: 존재하지 않으면 404 `user_not_found`. `role` 이 바뀌면 그룹 자동 이동(superuser→`system:superuser`, regular→`default`). 설계 §4.1 의 불변식 문장은 이 방향을 "superuser→`default`, regular→`system:superuser`" 로 뒤집어 적었는데, 같은 문장 앞부분의 "`role === 'superuser'` ⇔ `groupId === 'system:superuser'`" 와 모순되는 설계 문서의 오기다. 여기 적은 방향이 맞으며, 설계와의 충돌로 오인하지 않는다. `role === 'superuser'` 인 사용자에게 `groupId` 를 명시해 다른 그룹으로 옮기려 하거나, `regular` 사용자에게 `groupId: 'system:superuser'` 를 주면 422 `superuser_group_reserved`. 마지막 활성 슈퍼유저(`role === 'superuser' && status === 'active'` 인 사용자가 이 사용자 하나뿐)를 `regular` 로 강등하거나 `disabled` 로 바꾸면 409 `last_superuser`. `updatedAt` 갱신.
- `deleteUser`: 마지막 활성 슈퍼유저면 409 `last_superuser`. 없는 id 는 404.
- `createGroup`: `name` 1..64 자(422 `group_name_invalid`), `attributes` 는 `validateGroupAttributes(patch, DEFAULT_GROUP_ATTRIBUTES)`, `system: false`.
- `updateGroup`: `system:superuser` 는 어떤 수정도 422 `system_group_readonly`. `default` 는 `attributes` 만 수정 가능하고 `name` 이 오면 422 `system_group_readonly`. 없는 id 404 `group_not_found`.
- `deleteGroup`: 시스템 그룹 2개는 422 `system_group_readonly`. `membersOf(id).length > 0` 이면 409 `group_not_empty`.
- `setPassword`: `validatePassword` → `bcrypt.hash(password, IdentityStore.bcryptCost)` → `clearMustChange` 면 `mustChangePassword = false` → `save()`.
- `verifyPassword`: `userByUsername(validateUsername 정규화)` 없으면 `not-found`, `status === 'disabled'` 면 `disabled`. 빈 비밀번호는 즉시 `mismatch`. `passwordHash` 가 bcrypt 면 `bcrypt.compare`. bcrypt 가 아니면 `hashLegacyPassword(password)`(`rbac/legacyPasswordHash.ts` 에서 직접 import. `IdentityMigration` 을 거치지 않아야 순환 import 가 생기지 않는다)와 `timingSafeStringEqual` 로 비교하고, 일치하면 bcrypt 로 재해시해 저장한 뒤 `rehashed: true`.
- 마지막 슈퍼유저 가드가 409 를 낼 때 `last_superuser_guard_hit` 감사 이벤트를 남기는 규칙은 `AuditSink` 가 생기는 U2-05 에서 추가한다. 이 이슈에서는 가드가 409 를 돌려주는 것까지만 구현한다.
- 비활성화 시 `SessionStore.removeSessionsOfUser(id)` 호출은 U2-02 가 그 메서드를 만든 뒤 U2-02 에서 연결한다.

### `src/server/rbac/IdentityMigration.ts`

```ts
export const BOOTSTRAP_TOKEN_FILE_NAME = '.bootstrap-token';
export const KEY_FILE_NAME = '.key';
export const LEGACY_ADMIN_USERNAME = 'admin';
export type MigrationOutcome =
    | {kind: 'loaded'} | {kind: 'migrated'} | {kind: 'bootstrap-required'} | {kind: 'legacy-fallback'; reason: string};
export type BootstrapResult =
    | {success: true; user: User}
    | {success: false; bootstrapRequired: true; invalidBootstrapToken: boolean; weakPassword: boolean; invalidUsername: boolean}
    | {success: false; bootstrapRequired: false};   // 부트스트랩 상태가 아닐 때

export const IdentityMigration = {
    runAtStartup(): Promise<MigrationOutcome>,   // 프로세스당 1회. 두 번 부르면 첫 결과를 그대로 돌려준다. 승격 분기가 `createUser`(Promise) 의 성공 여부로 `migrated` / `legacy-fallback` 을 가르므로 비동기다
    outcome(): MigrationOutcome | undefined,
    bootstrapRequired(): boolean,
    completeBootstrap(input: {username: string; password: string; bootstrapToken?: string}): Promise<BootstrapResult>,
    verifyLegacyKey(password: string): Promise<boolean>,   // legacy-fallback 모드 전용: .key 해시로만 검증(bcrypt 또는 레거시)
    hashLegacyPassword(password: string): string,          // `rbac/legacyPasswordHash.ts` 의 같은 이름 함수를 재export 한 것(위 소절). 기존 테스트(login-bootstrap.test.ts:155)가 이 이름으로 부른다
    resetForTest(): void
};
```

`runAtStartup()` 판정표(설계 §4.2):

| 상태 | 동작 | 반환 |
|---|---|---|
| `identity.yaml` 있고 `load()` 성공 | 끝. `.bootstrap-token` 이 있으면 삭제 | `loaded` |
| `identity.yaml` 있고 `load()` 실패(parse/validation/read-error) | `IdentityStore.enterLegacyFallback(reason)`. 로그 error `identity.yaml unreadable (<reason>); falling back to legacy admin key` | `legacy-fallback` |
| 없음, `.key` 에 비어 있지 않은 문자열(trim 후) | `createUser({username:'admin', role:'superuser', passwordHash: .key 내용(trim), mustChangePassword:false, migratedFromLegacyAdmin:true})` → `save()`. 성공 시 로그 info `identity migrated from legacy admin key`. `.key` 는 **그대로 둔다**. `.bootstrap-token` 이 있으면 삭제 | `migrated` |
| 없음, `.key` 해시로 승격했으나 `save()` 실패 | 메모리 사용자 제거, `enterLegacyFallback('identity save failed')` | `legacy-fallback` |
| 없음, `.key` 가 없거나 비어 있음(`SessionStore.ensureBootstrapState :187` 과 같은 판정) | 저장하지 않는다. `.bootstrap-token` 이 있으면 읽고(0o600 재적용), 없으면 `crypto.randomBytes(32).toString('hex')` 를 0o600 으로 쓴다(`SessionStore.ts:194-206` 로직 이전). 로그 warn `Bootstrap token created at <path>` 유지 | `bootstrap-required` |

`completeBootstrap`: `bootstrapRequired()` 가 false 면 `{success:false, bootstrapRequired:false}`. 순서: `validatePassword` 실패 → `weakPassword` / `validateUsername` 실패 → `invalidUsername` / 토큰 불일치(`timingSafeStringEqual(storedToken, input.trim(), 'utf8')`; 토큰이 문자열이 아니면 불일치) → `invalidBootstrapToken` / 통과 → `createUser({..., password, role:'superuser', mustChangePassword:false, migratedFromLegacyAdmin:false})` + `save()` → `.bootstrap-token` 삭제 → 상태를 `loaded` 로 바꾼다. 저장 실패면 `enterLegacyFallback` 하지 않고 `{success:false, bootstrapRequired:true, ...모두 false}` 를 돌려준다(기존 `persistPasswordHash` 실패 동작과 같음). 부트스트랩으로 만든 슈퍼유저는 `.key` 를 쓰지 않는다(이전 바이너리 롤백 시 이 계정은 사라지며 U2-09 문서가 이를 적는다).

`verifyLegacyKey`: `.key` 를 읽어 bcrypt 면 `bcrypt.compare`, 아니면 `timingSafeStringEqual(keyHash, hashLegacyPassword(password), 'utf8')`. legacy-fallback 모드에서는 재해시하지 않는다(`.key` 는 서버가 쓰지 않는다).

### `src/server/ServerApp.ts` 변경은 "변경할 것" 절.

### 테스트 (신규)

- `test/unit/server/rbac/IdentityTypes.test.ts`
- `test/unit/server/rbac/IdentityStore.test.ts`
- `test/unit/server/rbac/IdentityMigration.test.ts`

bcrypt cost 12 는 한 번에 200~400ms 걸린다. 세 파일 모두 `beforeAll` 에서 `IdentityStore.bcryptCost = 4`, `afterAll` 에서 `= 12`. `.key` 승격 케이스처럼 cost 12 해시가 꼭 필요한 곳은 파일당 한 번만 `bcrypt.hash(pw, 12)` 를 만들어 상수로 재사용한다. `jest` 타임아웃은 케이스별 `15_000`.

## 변경할 것

- `src/server/ServerApp.ts:26` `startService` 첫 줄(`applyGlobalMemLimitMiB` 앞)에 `const identity = await IdentityMigration.runAtStartup();` 을 넣고 `identity.kind === 'legacy-fallback'` 이면 `logger.error` 로 사유를 남긴다. 서버는 계속 기동한다. `new AdminServer(...)`(`:30`)보다 앞이어야 한다. `startService` 는 이미 `async` 이므로(`ServerApp.ts:26` `const startService = async (...)`) 시그니처를 바꾸지 않는다.
- `test/helpers/runtime.ts:55` `resetRuntimeState` 에 `IdentityStore.resetForTest(); IdentityMigration.resetForTest();` 를 추가한다.
- `SessionStore.ts` 는 이 이슈에서 건드리지 않는다(부트스트랩 토큰 로직이 잠시 두 곳에 있게 되지만 U2-02 가 `SessionStore` 쪽을 제거한다. 그 사이 서버 기동 시 두 모듈이 같은 `.bootstrap-token` 파일을 읽으므로 값은 하나다: `IdentityMigration` 이 먼저 만들고 `SessionStore` 는 있는 파일을 읽는다).

## 하지 말 것

- `AdminServer` 로그인 경로·`SessionStore` 의 공개 메서드를 바꾸지 않는다(U2-02).
- 사용자·그룹 API, 권한 검사, 터널 소유권을 만들지 않는다(U2-04~08).
- `.key` 를 삭제·수정하지 않는다. 승격 후에도 파일은 남는다.
- 토큰·해시를 `===` 로 비교하지 않는다(`npm run lint` 실패). `timingSafeStringEqual` 만 쓴다.
- 예외를 제어 흐름으로 쓰지 않는다: 검증 실패·중복·없음은 `Result` 로 돌려준다. `throw` 는 `Files.writeAtomicBatchSync` 같은 I/O 경계 안에서만 발생하고 `save()` 가 즉시 `Result` 로 바꾼다.
- 파일을 쓴 뒤 `fs.chmodSync` 로 권한을 고치지 않는다. 권한은 `writeAtomicBatchSync` 의 `mode` 로만 준다.
- 잠금·세마포어·`Promise` 체인 뮤텍스를 만들지 않는다. 불변 객체 + 참조 교체로 충분하다.
- `GroupAttributes` 에 PRD §7 의 11종 외 키를 추가하지 않는다. `allowed_trusted_clients` 에 `'*'` 를 허용하지 않는다.
- `identity.yaml` 에 평문 비밀번호·임시 비밀번호를 쓰지 않는다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/unit/server/rbac/IdentityTypes.test.ts`
  - `validateUsername('Admin')` 이면 `{success:true, value:'admin'}` 이다.
  - `validateUsername('ab')`, 33자, `'a b'`, `'한글'`, 숫자 타입이면 각각 `status 422`, code `username_invalid` 이다.
  - `validatePassword('1234567')` 이면 422 `password_too_short`, `'12345678'` 이면 성공이다.
  - `validateGroupAttributes({}, DEFAULT_GROUP_ATTRIBUTES)` 이면 값이 기본값과 깊은 동등이다.
  - `{tunnel_crud:'admin'}` 이면 `attribute_enum_invalid`, `{max_tunnel_count:-1}`·`{max_tunnel_count:1.5}` 이면 `attribute_int_invalid`, `{allowed_port_range:[{from:20,to:10}]}`·`[{from:0,to:1}]`·`[{from:1,to:70000}]` 이면 `port_range_invalid`, `{allowed_trusted_clients:['*']}` 이면 `trusted_clients_invalid`, `{unknown:1}` 이면 `attributes_unknown_key` 이다.
  - `{http_tunnel_rewrite_permissions:{cors:true,host:false,header:false,body:false}}`(protocols 기본 []) 이면 `rewrite_requires_http_rewrite` 이고, `{allowed_protocols:['HTTP_REWRITE']}` 이면 `http_rewrite_requires_http` 이며, `{allowed_protocols:['HTTP','HTTP_REWRITE'], http_tunnel_rewrite_permissions:{cors:true,host:true,header:true,body:true}}` 이면 성공이다.
  - `{allowed_port_range:[{from:1,to:100},{from:50,to:200}]}` 처럼 겹치는 범위는 성공이다.
  - `createSystemGroups()` 이면 id 가 `['system:superuser','default']`, 둘 다 `system: true` 이다.
  - `newUserId()` 는 `/^u_[0-9a-f]{16}$/`, `newGroupId()` 는 `/^g_[0-9a-f]{16}$/` 에 맞는다.
- `test/unit/server/rbac/IdentityStore.test.ts` (임시 루트 + `applyTestRoot`, `bcryptCost 4`)
  - 파일이 없을 때 `load()` 면 `{success:true, source:'empty'}`, `users()` 길이 0, `groups()` 길이 2 이다.
  - `createUser({password:'test-password-1234', …})` 이면 저장된 `passwordHash` 가 `/^\$2[aby]\$04\$/` 에 맞는다(cost 4 반영).
  - 슈퍼유저 1 + 일반 유저 1 + `createGroup` 1 뒤 `resetForTest()` → 새 인스턴스 `load()` 면 `users()`·`groups()` 가 저장 전과 깊은 동등이다(yaml 왕복).
  - 저장 후 `config/` 디렉터리에 `.tmp` 로 끝나는 파일이 없고 `identity.yaml` 의 mode 가 0o600 이다(Windows 에서는 mode 단언을 건너뛴다: `process.platform !== 'win32'` 조건).
  - `identity.yaml` 내용에 `passwordHash` 는 있고 평문 `test-password-1234` 는 없다.
  - `createUser` 에 `password` 와 `passwordHash` 를 둘 다 주거나 둘 다 빼면 422 `credential_invalid` 이다.
  - `createUser({role:'superuser', groupId:'default'})` 이면 저장된 `groupId` 가 `system:superuser` 이다(명시 무시). `createUser({role:'regular', groupId:'system:superuser'})` 이면 422 `superuser_group_reserved` 이다.
  - 같은 username(대소문자 다름 포함) 으로 두 번 만들면 두 번째는 409 `username_taken` 이다. 두 `createUser` 를 `Promise.all` 로 동시에 부르면 하나만 성공하고 파일에는 사용자가 하나만 있다(구현: username 유일성 검사를 `await bcrypt.hash` 가 끝난 뒤 동기 구간에서 다시 수행한다).
  - 슈퍼유저 1명일 때 `updateUser(id,{role:'regular'})`·`updateUser(id,{status:'disabled'})`·`deleteUser(id)` 는 모두 409 `last_superuser` 이고, 슈퍼유저를 하나 더 만든 뒤에는 세 호출이 성공한다.
  - `updateUser(regularId,{role:'superuser'})` 이면 `groupId` 가 `system:superuser`, 다시 `{role:'regular'}` 이면 `default` 이다. `updateUser(id,{mustChangePassword:true})`·`{migrationAcknowledged:true}` 가 반영된다.
  - `updateGroup('system:superuser',{name:'x'})`·`updateGroup('system:superuser',{attributes:{max_tunnel_count:1}})`·`updateGroup('default',{name:'x'})` 은 422 `system_group_readonly` 이고 `updateGroup('default',{attributes:{max_tunnel_count:1}})` 은 성공이다.
  - `deleteGroup('default')`·`deleteGroup('system:superuser')` 은 422, 사용자가 있는 사용자 정의 그룹은 409 `group_not_empty`, 비어 있으면 성공이다.
  - `updateGroup(gid,{attributes:{allowed_protocols:['HTTP_REWRITE']}})` 이면 422 `http_rewrite_requires_http` 이다.
  - `setPassword(id,'short',{clearMustChange:true})` 이면 422 `password_too_short`. `setPassword(id,'new-password-1234',{clearMustChange:true})` 뒤 `verifyPassword(username,'new-password-1234')` 이면 `success:true, rehashed:false` 이고 `mustChangePassword` 가 false 이다.
  - `verifyPassword('nobody','x')` 이면 `not-found`, disabled 사용자면 `disabled`, 틀린 비밀번호면 `mismatch` 이다.
  - `passwordHash: hashLegacyPassword('legacy-pass-1')` 로 만든 사용자에 `verifyPassword` 가 맞으면 `rehashed: true` 이고 저장된 해시가 bcrypt 다.
  - 저장 후 `identity.yaml` 을 `YAML.parse` 하면 `system:superuser` 그룹의 `attributes` 가 `{}` 이고 `default` 그룹의 `attributes` 는 11종 키를 모두 가진다. 같은 파일을 `load()` 한 메모리의 `group('system:superuser')!.attributes` 는 `DEFAULT_GROUP_ATTRIBUTES` 와 깊은 동등이면서 다른 객체다.
  - `Files.writeAtomicBatchSync` 를 던지도록 `jest.spyOn` 한 상태에서 `createUser` 하면 `status 422`, code `identity_save_failed` 이고 `users()` 길이가 호출 전과 같다(파일시스템 경계 스텁 허용).
- `test/unit/server/rbac/IdentityMigration.test.ts` (임시 루트. `runAtStartup()` 은 `Promise<MigrationOutcome>` 이므로 아래 모든 호출을 `await` 한다)
  - `config/.key` 에 bcrypt 해시만 있는 루트에서 `runAtStartup()` 이면 `migrated` 이고, `identity.yaml` 이 생기며 사용자 `admin`(`role superuser`, `migratedFromLegacyAdmin true`, `passwordHash` 가 `.key` 내용과 같음)이 있고 `.key` 파일이 그대로 남아 있으며 `.bootstrap-token` 은 없다.
  - 같은 루트에서 다시 `resetForTest()` 후 `runAtStartup()` 이면 `loaded` 이고 `identity.yaml` 의 mtime 이 바뀌지 않는다.
  - `.key` 에 `hashLegacyPassword('old-pass-1234')` 를 두면 `migrated` 후 `IdentityStore.instance.verifyPassword('admin','old-pass-1234')` 가 `rehashed: true` 이고 파일의 해시가 bcrypt 로 바뀌며 `.key` 는 레거시 값 그대로다.
  - `.key` 도 `identity.yaml` 도 없으면(또는 `.key` 가 빈 파일이면) `bootstrap-required` 이고 `config/.bootstrap-token` 이 64자 hex 로 생기며 `bootstrapRequired()` 가 true 이다.
  - `completeBootstrap({username:'root', password:'short', bootstrapToken})` 이면 `weakPassword true`; 잘못된 토큰이면 `invalidBootstrapToken true`; `username:'A B'` 이면 `invalidUsername true`; 올바르면 `success true`, `identity.yaml` 에 슈퍼유저 `root` 가 있고 `.bootstrap-token` 이 삭제되고 `bootstrapRequired()` 가 false 이며 다시 부르면 `{bootstrapRequired:false}` 이다.
  - `identity.yaml` 에 잘못된 YAML(`{{`) 을 두면 `legacy-fallback` 이고 `IdentityStore.instance.mode === 'legacy-fallback'` 이며 `verifyLegacyKey(원문)` 이 `.key` 해시에 대해 true, 틀린 값에 false 이다.
  - `.key` 만 있고 `Files.writeAtomicBatchSync` 가 던지면 `legacy-fallback` 이고 `identity.yaml` 이 없다.
  - `hashLegacyPassword('legacy-pass-1')` 이 64바이트 sha512 hex(128자)이고, 같은 입력에 같은 값이며, `IdentityMigration.hashLegacyPassword` 재export 가 `rbac/legacyPasswordHash.ts` 의 함수와 같은 값을 돌려준다.

기존 테스트 전부 통과: `test/unit/server/admin/*.test.ts` 7개, `test/component/server/admin/*.test.ts` 15개(설계 문서는 18개라 적었으나 실제 `.test.ts` 는 15개이고 나머지 3개는 `*-fixture.ts` 다), `test/admin/*.test.ts` 13개, `test/unit/server/ServerOptionStore*.test.ts`.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/server/rbac
npm run test:browser:install
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 로봇 이모지 등 서명 0건 확인
```

## 선행 · 후행

- 선행: 없음(단위 2 의 첫 이슈. 파동 0).
- 후행: U2-02(세션 저장소가 `IdentityStore.verifyPassword` 와 `IdentityMigration` 을 쓴다).

## 근거 문서

- `docs/design/2026-09-11-unit2-rbac-model-api.md` §3(저장 모델), §4.1(IdentityStore, `bcryptCost`), §4.2(IdentityMigration, `hashLegacyPassword`), §8.1(세 테스트), §9(U2-01)
- `docs/plan/prd/TTTGate-admin-rbac.md` §4.1~4.3, §5.1.1(FR-USER-ROLE-001, FR-USER-LAST-SUPERUSER-001, FR-USER-STATUS-001), §5.1.2(FR-GROUP-ATTR-ASSIGN-001, FR-GROUP-MEMBER-ASSIGN-001, FR-GROUP-DELETE-GUARD-001), §7, §8.2(승격 단계), §9.1 R-T1
- `docs/design/2026-09-11-program-overview.md` §1 D1·D14, §3.1(TDD·비밀값 비교·예외·잠금 규약), §3.2 커밋 규약

---

## U2-02

**title**: feat(admin): 세션 저장소를 사용자 기반으로 바꾸고 로그아웃 API 추가
**labels**: enhancement, area:admin, unit:2
**body**:
## 목적

관리자 세션이 "비밀번호 하나" 가 아니라 "사용자" 에 묶이게 한다. 이 이슈가 끝나면 `/api/login` 이 `username` + `password` 로 `IdentityStore` 를 통해 인증하고, 세션이 `userId`·IP·생성 시각을 가지며, `/api/logout` 이 생기고, `/api/validateSession` 이 사용자 정보를 돌려준다. 기존 UI 와 테스트가 보내는 `{key, bootstrapToken}` 은 호환 별칭으로 그대로 동작한다(U2-10 가 제거).

## 배경

- `src/server/admin/SessionStore.ts`
  - `:14-17` `type Session = {key: string; timeout: number}`, `:19` `DEFAULT_TIMEOUT = 12h`(export 됨), `:34` `Map<string, Session>`.
  - `:76` `newSession(): Promise<string>`, `:83` `removeSession(sessionKey)`, `:87` `sweepSession()`, `:99` `isSessionValid(sessionKeyList: string[]): Promise<boolean>`(유효하면 timeout 연장), `:121` `static parseCookieHeader(header)`(req-16 테스트가 직접 호출).
  - 제거 대상: `:62` `loadKey`, `:72` `isEmptyKey`, `:141` `login`, `:145` `loginWithDetails`, `:178` `hashPassword`, `:187` `ensureBootstrapState`, `:209` `isStrongPassword`, `:213` `isBootstrapTokenValid`, `:224` `verifyPassword`, `:237` `isBcryptHash`, `:241` `persistPasswordHash`, `:255` `clearBootstrapToken`, `:265` `removeBootstrapTokenFile`, `:272-294` 파일 쓰기 헬퍼, 상수 `KEY_FILE_NAME`·`BOOTSTRAP_TOKEN_FILE_NAME`·`MIN_PASSWORD_LENGTH`, 타입 `LoginResult`. 이 로직은 U2-01 의 `IdentityStore`/`IdentityMigration` 에 이미 있다.
- `src/server/admin/AdminServer.ts`
  - `:1032` `onLogin`: 본문 `key`·`bootstrapToken` 읽기(`:1042-1043`) → IP 버킷 백오프(`isLoginBlocked` `:1402`, `recordLoginFailure` `:1407`, `delayFailedLogin` `:1435`, `resetLoginAttempts` `:1431`) → `SessionStore.loginWithDetails` → 성공 시 `sessionKey`·`csrfToken` 쿠키 2개(`:1057-1065`) → 실패 시 `bootstrapRequired ? (weakPassword ? 400 : 403) : 401`(`:1070-1078`).
  - `:1139` `validateSession(req): Promise<boolean>` → `SessionStore.isSessionValid(getSessionKey(req))`. `:389` `static getSessionKey(req): string[]`, `:400` `static parseCookies(req)`. `:843` `checkSession(req,res)` 가 401 을 보낸다. `:814` `onGetValidateSession`: `{valid: true}`.
  - `:226` `routePost` 에 `/api/logout` 이 없다. `:160` CSRF 헤더 예외는 `/api/login` 만.
  - `:1360` `getClientAddress(req): string`(`trustXForwardedFor` 정책), `:1317` `sendApiEnvelope(res, status, payload)`.
- 테스트가 `SessionStore.instance` 의 생성자 부수효과(부트스트랩 토큰 파일 생성)에 기대고 있다. `SessionStore.instance;` 한 줄로 토큰을 만들고 `BOOTSTRAP_TOKEN_FILE_NAME` 을 `SessionStore` 에서 import 하는 파일(`grep -rl "SessionStore" test`): `test/admin/csrf-requests.test.ts`, `test/admin/dev-proxy-origin.test.ts`, `test/admin/login-backend-driver.ts`(U1-05 가 `admin-backend-driver.ts` 로 대체하므로 이 이슈 시점에 존재하는 쪽을 고친다), `test/component/server/admin/AdminServer.apply.test.ts`, `AdminServer.security.test.ts`, `AdminServer.test.ts`, `admin-routes.test.ts`, `configuration-revision-fixture.ts`, `test/security/req-03-server-option-hash.test.ts`, `req-12-csrf.test.ts`, `test/unit/server/admin/req-07-rate-limit.test.ts`, `req-11-body-limit.test.ts`, `req-19-listen-listeners.test.ts`, `test/unit/server/req-04-constant-time-compare.test.ts`, `req-18-path-normalization.test.ts`.
- 제거되는 메서드를 직접 부르는 기존 테스트(삭제 금지, 같은 시나리오를 새 API 로 다시 쓴다): `test/unit/server/admin/SessionStore.test.ts:24` "persists the first login key and validates issued sessions"(`loginWithDetails` + `newSession` + `isSessionValid`), `:40` "expires sessions…"; `SessionStore.security.test.ts:36` "creates a bootstrap token file and requires it for first login", `:58` "upgrades legacy password hashes to bcrypt on successful login"; `test/admin/login-bootstrap.test.ts:155` `(SessionStore.prototype as any).hashPassword(password)`. `login-bootstrap.test.ts:106` 의 `postDataJSON()` 단언 `{key: password, bootstrapToken}` 은 이 이슈에서 그대로 통과해야 한다(별칭).
- `test/admin/login-bootstrap.test.ts` 의 `.key` 파일 단언 3곳은 새 설계에서 반드시 실패한다. 비밀번호의 진실 원천이 `config/.key` 에서 `config/identity.yaml` 의 `passwordHash` 로 옮겨 가고, `.key` 는 승격 뒤 **변경되지 않기** 때문이다.
  - `:108-109` `fs.readFile(config/.key)` + `bcrypt.compare(password.trim(), key)` — 부트스트랩 경로라 이제 `.key` 자체가 만들어지지 않는다(읽기가 ENOENT).
  - `:160-162` `const persisted = fs.readFile(config/.key)` + `expect(persisted).toMatch(/^\$2/)` + `bcrypt.compare` — `legacy` 케이스에서 `.key` 는 레거시 해시 그대로 남으므로 `/^\$2/` 가 깨진다.
  - `:167` 재기동 뒤 `.key` 가 `persisted` 와 같은지 — `.key` 불변은 새 설계에서도 참이지만 `:160` 의 `persisted` 정의가 바뀌므로 함께 고친다.
- `req-16-session-cookie.test.ts:34,35,43` 의 `store.newSession()` 은 인자가 없어 새 시그니처 `newSession(userId, meta)` 에서 컴파일되지 않는다. `parseCookieHeader`·`isSessionValid` 는 그대로다.

먼저 열어 볼 파일: `src/server/admin/SessionStore.ts`, `src/server/admin/AdminServer.ts`(`:1032-1080`, `:1139-1146`, `:814-850`, `:226-245`), `src/server/rbac/IdentityMigration.ts`, `src/server/rbac/IdentityStore.ts`, `test/unit/server/admin/SessionStore.test.ts`, `test/unit/server/admin/SessionStore.security.test.ts`, `test/admin/login-bootstrap.test.ts`, `test/component/server/admin/admin-routes.test.ts`(`login` 헬퍼 `:35-41`).

## 적용되는 결정

- D1 PRD 범위: FR-LOGOUT-001(명시적 로그아웃), FR-USER-STATUS-001(disabled 사용자 세션 즉시 무효), NFR-SEC-PRESERVE-001(백오프·bcrypt·쿠키 속성 유지).
- 프로그램 개요 §3.4: `/api/login` 만 CSRF 헤더 예외, Origin 검사는 받는다. 세션 없음 401. §3.1: 비밀값 비교는 `timingSafeStringEqual`.
- 단위 2 설계 §4.3: 관리자 세션 TTL 은 고정 12시간, 요청마다 연장, `sweepSession` 유지. `ServerOption.sessionTtlMs` 는 컨트롤 터널 TTL 이므로 건드리지 않는다. §5.2: 호환 별칭(`password` 없으면 `key`, `username` 없으면 `'admin'`)은 U2-02~U2-09 동안만.

## 만들 것

### `src/server/admin/SessionStore.ts` (전면 교체)

```ts
export type Session = {key: string; userId: string; createdAt: number; lastSeenAt: number; timeout: number; ip: string; userAgent?: string};
export const DEFAULT_TIMEOUT = 1000 * 60 * 60 * 12;

class SessionStore {
    static get instance(): SessionStore; static resetForTest(): void;
    static parseCookieHeader(header: string | undefined): Map<string, string>;   // 그대로 유지
    static sessionIdOf(key: string): string;                      // createHash('sha256').update(key).digest('hex').slice(0, 16). 감사 sessionIdHash 와 4 단위 세션 API 의 id 가 이 한 곳을 쓴다
    newSession(userId: string, meta: {ip: string; userAgent?: string}): Promise<string>;   // key = randomBytes(64).hex, createdAt = lastSeenAt = now
    resolveSession(sessionKeys: string[]): Session | undefined;   // 첫 유효 키. 유효하면 lastSeenAt = now, timeout = now + DEFAULT_TIMEOUT. 만료 키는 삭제
    isSessionValid(sessionKeys: string[]): Promise<boolean>;      // resolveSession(keys) !== undefined (호환)
    removeSession(sessionKey: string): Promise<void>;
    removeSessionsOfUser(userId: string, options?: {except?: string}): number;   // 제거한 개수. except 는 남길 세션 키(설계 §4.3 에 없는 옵션. U2-04 의 /api/me/password 가 현재 세션을 남기는 데 쓴다)
    listSessions(): Session[];                                    // 복사본. 4 단위가 사용
    sweepSession(): void;
}
export default SessionStore;
```

`resolveSession` 은 세션 객체를 제자리에서 고치지 않고 새 객체로 교체해 Map 에 `set` 한다(참조 교체). 반환값은 복사본. 세션 키 조회는 `Map.get` 이며 키 문자열을 `===` 로 비교하는 코드를 쓰지 않는다(`except` 판정도 `Map.get(except) === entry` 가 아니라 키로 `delete` 대상을 고른 뒤 `except` 키만 `Map` 에서 제외하는 식으로 쓴다).

### `AdminServer.onLogin` (재작성, `:1032`)

요청 `{username?: string, password?: string, key?: string, bootstrapToken?: string}`.

1. `isLoginBlocked(req)` 이면 429 `Too many login attempts`(기존). **본문 검증보다 먼저** 판정한다 — 차단된 IP 가 형식 오류로 401 을 받아 백오프를 우회하거나, 차단 상태를 401/429 로 구분당하지 않게 한다.
2. `password = typeof json.password == 'string' ? json.password : (typeof json.key == 'string' ? json.key : '')`, trim. **별칭**: `password` 가 없으면 `key`.
3. `username = validateUsername(json.username)` 성공값; `json.username` 이 없으면 `'admin'`(**별칭**). 있는데 형식이 틀리면 `recordLoginFailure(req)` + `delayFailedLogin` 후, 부트스트랩 상태면 403 `{bootstrapRequired:true, invalidBootstrapToken:false, weakPassword:false, invalidUsername:true}`, 아니면 401. 형식 실패도 실패 횟수에 넣는다(비밀번호 오류와 같은 비용을 치르게 해 username 열거·탐색을 막는다).
4. 분기:
   - `IdentityMigration.bootstrapRequired()` 이면 `completeBootstrap({username, password, bootstrapToken})`. 실패면 `recordLoginFailure` + `delayFailedLogin` 후 `sendApiFailure(res, weakPassword ? 400 : 403, {bootstrapRequired: true, invalidBootstrapToken, weakPassword, invalidUsername})`. 성공이면 5 로.
   - `IdentityStore.instance.mode === 'legacy-fallback'` 이면 `IdentityMigration.verifyLegacyKey(password)`. 실패 401(백오프 포함). 성공이면 `userId = 'legacy-admin'` 으로 5 로.
   - 그 외 `IdentityStore.instance.verifyPassword(username, password)`. `success:false` 면(`not-found`·`disabled`·`mismatch` 를 구분하지 않고) `recordLoginFailure` + `delayFailedLogin` + 401.
5. 성공: `resetLoginAttempts(req)` → `SessionStore.instance.newSession(userId, {ip: this.getClientAddress(req), userAgent: req.headers['user-agent']})` → 기존과 같은 `Set-Cookie` 2개 → 본문 `{success:true, partial:false, failedScopes:[], warnings:[], message:'', csrfToken, user: {id, username, displayName, role}, mustChangePassword}`. 레거시 주체는 `user: {id:'legacy-admin', username:'admin', displayName:'admin', role:'superuser'}, mustChangePassword: false`.

로그인 성공·실패 감사 이벤트는 U2-05 에서 붙인다.

### `POST /api/logout` (신규)

`routePost` 에 추가. 세션 쿠키가 없거나 무효면 401(기존 `checkSession`). 유효하면 `SessionStore.removeSession(key)` 후 200 `{success:true}` 와 함께 `Set-Cookie: sessionKey=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict;<Secure>` 와 `csrfToken=; Path=/; Max-Age=0; SameSite=Strict;<Secure>`. CSRF 헤더 검사는 다른 POST 와 같이 받는다(예외 아님).

### `GET /api/validateSession` (응답 확장, `:814`)

유효하면 `{valid: true, user: {id, username, displayName, role}, mustChangePassword}`. 사용자 조회는 `IdentityStore.instance.user(session.userId)`; 사용자가 삭제되었거나 `status === 'disabled'` 면 세션을 제거하고 401. `legacy-admin` 은 위 고정 값.

### `AdminServer.validateSession` → `resolveSession`

`:1139` 를 `private resolveSession(req): Session | undefined` 로 바꾸고 `checkSession` 은 이것을 쓴다. 다른 핸들러의 `checkSession` 호출은 그대로 둔다(U2-03 이 라우트 표로 바꾼다).

### `IdentityStore.updateUser` 연결

U2-01 에서 미뤄 둔 규칙: `updateUser` 가 `status` 를 `disabled` 로 바꾸는 데 성공하면 `SessionStore.instance.removeSessionsOfUser(id)` 를 호출한다. `deleteUser` 성공 시에도 호출한다.

### 테스트

- `test/component/server/admin/rbac-login.test.ts`(신규, 실제 `AdminServer` + 임시 루트, `admin-routes.test.ts` 의 `withRoutes` 패턴을 따르되 `await IdentityMigration.runAtStartup()` 으로 준비, `IdentityStore.bcryptCost = 4`). 이 이슈에서는 로그인·로그아웃·validateSession 케이스만 쓰고 U2-04 가 `mustChangePassword`·`/api/me/password` 케이스를 덧붙인다.
- `test/unit/server/admin/SessionStore.test.ts`, `SessionStore.security.test.ts` 재작성(아래).

## 변경할 것

- `src/server/admin/SessionStore.ts`: 위 계약으로 교체. `bcryptjs`·`fs`·`File`·`Files`·`timingSafeStringEqual` import 가 불필요해지면 제거.
- `src/server/admin/AdminServer.ts`: `onLogin`, `onGetValidateSession`, `validateSession`, `routePost`(`/api/logout` 추가). `import SessionStore from "./SessionStore"` 는 유지하고 `IdentityStore`, `IdentityMigration`, `validateUsername` import 추가.
- `src/server/rbac/IdentityStore.ts`: `updateUser`/`deleteUser` 에서 `SessionStore.removeSessionsOfUser` 호출.
- 테스트 갱신(동작이 아니라 준비 코드만):
  - `SessionStore.instance;`(토큰 생성 목적) → `await IdentityMigration.runAtStartup();`(`runAtStartup` 이 `Promise` 를 돌려주므로 준비 코드가 동기 함수였다면 `async` 로 바꾼다)
  - `import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from ".../SessionStore"` → `import {BOOTSTRAP_TOKEN_FILE_NAME, IdentityMigration} from ".../rbac/IdentityMigration"`
  - 로그인 본문 `{key, bootstrapToken}` 은 그대로 둔다(별칭 검증을 겸한다).
  - `test/admin/login-bootstrap.test.ts:155` `(SessionStore.prototype as any).hashPassword(password)` → `IdentityMigration.hashLegacyPassword(password)`.
  - `test/admin/login-bootstrap.test.ts` 의 `.key` 단언 3곳을 `config/identity.yaml` 기준으로 바꾼다. 세 곳 모두 `YAML.parse(await fs.readFile(path.join(root, "config", "identity.yaml"), "utf8"))` 로 읽고 `users.find(u => u.username === 'admin')!.passwordHash` 를 본다.
    - `:108-109` → `expect(await bcrypt.compare(password.trim(), passwordHash)).toBe(true)`. `.key` 를 읽지 않는다(부트스트랩 경로에는 `.key` 가 없다).
    - `:160-162` → `const persisted = passwordHash; expect(persisted).toMatch(/^\$2/); expect(await bcrypt.compare(password.trim(), persisted)).toBe(true);`. `bcrypt`·`legacy` 두 케이스 모두 로그인 성공 뒤 `identity.yaml` 의 해시는 bcrypt 다(레거시는 `verifyPassword` 가 재해시한다).
    - `:167` → 재기동 뒤 `identity.yaml` 의 `passwordHash` 가 `persisted` 와 같다. 여기에 `config/.key` 파일이 여전히 존재하고 내용이 기동 전 `storedKey` 와 **같다**(승격이 `.key` 를 고치지 않는다)는 단언을 한 줄 더한다.
  - `test/unit/server/admin/req-16-session-cookie.test.ts:34,35,43` 의 `store.newSession()` → `store.newSession('u_test', {ip: '127.0.0.1'})`. 세 곳 모두 같은 인자를 쓰며 그 외 단언(`isSessionValid`, 만료, `parseCookieHeader`)은 바꾸지 않는다.
- `test/unit/server/admin/SessionStore.test.ts`: 기존 두 시나리오를 새 API 로 다시 쓴다 — "첫 로그인 키를 저장하고 발급된 세션을 검증한다" 는 `IdentityMigration.runAtStartup()`(bootstrap-required) → `completeBootstrap` → `IdentityStore.verifyPassword` 성공 → `newSession(user.id, …)` → `isSessionValid([key])` true 로; "시계를 넘기면 만료" 는 `resolveSession` 으로. 그 위에 아래 신규 케이스를 더한다.
- `test/unit/server/admin/SessionStore.security.test.ts`: "부트스트랩 토큰 파일이 생기고 첫 로그인에 필요하다" 는 `IdentityMigration.runAtStartup()` + `completeBootstrap` 의 `invalidBootstrapToken` 분기로, "레거시 해시가 로그인 성공 시 bcrypt 로 승격된다" 는 `.key` 에 `hashLegacyPassword` 값 → `runAtStartup()` → `verifyPassword` 의 `rehashed` 로 다시 쓴다(U2-01 의 `IdentityMigration.test.ts` 와 겹치더라도 파일은 남긴다). 여기에 "disabled 사용자의 세션이 `removeSessionsOfUser` 로 사라진다" 를 더한다.

## 하지 말 것

- 라우트 표·권한 검사·`/api/me` 를 만들지 않는다(U2-03·04). 다른 핸들러의 `checkSession` 을 건드리지 않는다.
- 세션 TTL·쿠키 속성·백오프 상수(`LOGIN_WINDOW_MS`, `LOGIN_BLOCK_MS`, `LOGIN_MAX_FAILURES`)를 바꾸지 않는다.
- 로그인 실패 사유(`not-found`/`disabled`/`mismatch`)를 응답으로 구분하지 않는다(사용자 열거 방지). 모두 401.
- `key`·`'admin'` 별칭을 지우지 않는다(U2-10). 별칭을 쓰는 테스트 본문을 고치지 않는다.
- 기존 `SessionStore.test.ts`·`SessionStore.security.test.ts` 케이스를 삭제하지 않는다(재작성).
- 감사 이벤트를 기록하지 않는다(U2-05).
- 세션 키·토큰을 `===` 로 비교하지 않는다(lint).
- 예외를 제어 흐름으로 쓰지 않는다. 세션 조회 실패는 `undefined` 반환.
- 세션 Map 에 잠금을 두지 않는다. 항목 교체는 새 객체 `set`.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트(`IdentityMigration.runAtStartup()` 은 `Promise` 를 돌려주므로 아래 모든 호출을 `await` 한다):

- `test/unit/server/admin/SessionStore.test.ts`
  - (재작성) 부트스트랩 루트에서 `completeBootstrap` 성공 후 `newSession(user.id, {ip:'127.0.0.1'})` 키로 `isSessionValid([key])` 가 true 이다.
  - (재작성) 시계를 `DEFAULT_TIMEOUT + 1` 진행하면 `resolveSession([key])` 이 `undefined` 이고 `listSessions()` 길이가 0 이다.
  - `newSession('u_1', {ip:'127.0.0.1'})` 이면 128자 hex 키를 돌려주고 `listSessions()[0]` 이 `{userId:'u_1', ip:'127.0.0.1', createdAt === lastSeenAt}` 이다.
  - `resolveSession([key])` 이면 `userId 'u_1'` 이고, 시계를 1시간 진행한 뒤 다시 부르면 `lastSeenAt` 이 진행된 시각이고 `timeout` 이 `now + DEFAULT_TIMEOUT` 이다.
  - 같은 사용자 세션 3개 + 다른 사용자 1개에서 `removeSessionsOfUser('u_1', {except: k2})` 이면 반환이 2 이고 남은 세션이 `[k2, 다른 사용자]` 이다.
  - `isSessionValid(['bogus', key])` 이면 true, `isSessionValid(['bogus'])` 이면 false 이다.
  - `SessionStore.sessionIdOf('abc')` 는 16자 hex 이고 같은 입력에 같은 값, 다른 입력에 다른 값이다.
- `test/unit/server/admin/SessionStore.security.test.ts`
  - (재작성) `.key` 없는 루트에서 `runAtStartup()` 이면 `.bootstrap-token` 이 생기고, 토큰 없이 `completeBootstrap` 하면 `invalidBootstrapToken true`, 파일의 토큰으로 하면 성공이다.
  - (재작성) `.key` 에 `hashLegacyPassword('legacy-pw-1234')` 를 두고 `runAtStartup()` 후 `verifyPassword('admin','legacy-pw-1234')` 이면 `rehashed true` 이고 `identity.yaml` 의 해시가 bcrypt 다.
  - `IdentityStore` 에 일반 유저를 만들고 세션 2개를 연 뒤 `updateUser(id,{status:'disabled'})` 이면 `listSessions()` 에 그 사용자 세션이 0개다.
  - `deleteUser(id)`(슈퍼유저가 따로 있는 상태) 이면 그 사용자 세션이 0개다.
- `test/unit/server/admin/req-16-session-cookie.test.ts`: `:34,35,43` 의 `newSession()` 을 `newSession('u_test', {ip:'127.0.0.1'})` 로 바꾼 뒤 나머지 단언이 그대로 통과한다(`isSessionValid`·`parseCookieHeader` 시그니처 유지).
- `test/component/server/admin/rbac-login.test.ts`
  - `.key`(bcrypt, 비밀번호 `routes-password`) 루트에서 `runAtStartup()` 후 `POST /api/login {username:'admin', password:'routes-password'}` 이면 200, `Set-Cookie` 에 `sessionKey=`·`csrfToken=` 이 있고 본문 `user.username === 'admin'`, `user.role === 'superuser'`, `mustChangePassword === false` 이다.
  - 본문 `{key:'routes-password'}`(username 없음) 이면 200 이다(별칭 두 개 동시).
  - `{username:'ADMIN', password:'routes-password'}` 이면 200 이다(소문자 정규화). `{username:'no spaces', password:'routes-password'}` 이면 401 이다.
  - 틀린 비밀번호면 401 이고, 존재하지 않는 username 이면 401 이며 두 응답 본문이 같다.
  - `GET /api/validateSession`(세션 쿠키) 이면 200 `{valid:true, user.username:'admin', mustChangePassword:false}`, 쿠키 없이면 401.
  - `POST /api/logout`(세션 + CSRF 헤더) 이면 200 이고 `Set-Cookie` 두 개에 `Max-Age=0` 이 있으며, 같은 쿠키로 `GET /api/validateSession` 이면 401 이다. CSRF 헤더 없이 `POST /api/logout` 이면 403 이다.
  - 부트스트랩 루트(`.key` 없음)에서 `{username:'root', password:'root-password-1', bootstrapToken}` 이면 200 `user.username 'root'`; 토큰이 틀리면 403 `{bootstrapRequired:true, invalidBootstrapToken:true}`; 비밀번호 `short` 면 400 `{weakPassword:true}`; `username:'no spaces allowed'` 면 403 `{invalidUsername:true}`; `{key:'root-password-1', bootstrapToken}`(별칭) 이면 200 `user.username 'admin'`.
  - `identity.yaml` 을 깨뜨린 루트(legacy-fallback)에서 `.key` 비밀번호로 로그인하면 200 `user.id === 'legacy-admin'` 이고 틀리면 401 이다.
  - 틀린 비밀번호 5회 뒤 6회째는 429 이다(`req-07` 과 같은 IP 버킷). 차단된 상태에서 `{username:'no spaces', password:'x'}`(형식 오류) 를 보내도 401 이 아니라 429 다.
  - `{username:'no spaces', password:'x'}` 를 5회 보낸 뒤 올바른 자격 증명을 보내면 429 다(형식 실패도 실패 횟수에 들어간다).
  - disabled 로 바꾼 사용자는 로그인이 401 이다.

기존 테스트 전부 통과: `test/admin/*.test.ts` 13개(`login-bootstrap.test.ts` 는 `:106` 별칭 단언을 그대로 두고 `.key` 단언 3곳을 위 "변경할 것" 대로 `identity.yaml` 기준으로 고친 뒤 `:152` 레거시 재시작 케이스가 통과한다), `test/unit/server/admin/*.test.ts` 7개(위 재작성 반영), `test/component/server/admin/*.test.ts` 15개, `test/security/req-03-server-option-hash.test.ts`, `test/security/req-12-csrf.test.ts`, `test/unit/server/req-04-constant-time-compare.test.ts`, `test/unit/server/req-18-path-normalization.test.ts`, `test/unit/server/rbac/*.test.ts` 3개.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npx jest --runInBand test/unit/server/admin test/unit/server/rbac test/component/server/admin
npm run test:admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 로봇 이모지 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U2-01.
- 후행: U2-03(라우트 표가 `resolveSession` 을 쓴다), U2-10(별칭 제거).

## 근거 문서

- `docs/design/2026-09-11-unit2-rbac-model-api.md` §2(현재 상태), §4.2(부트스트랩·legacy-fallback·`hashLegacyPassword`), §4.3(SessionStore·`sessionIdOf`), §5.2(`POST /api/login` 별칭, `POST /api/logout`, `GET /api/validateSession`), §8.2(`rbac-login.test.ts`, 기존 테스트 이전 규칙), §9(U2-02)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.1 FR-USER-STATUS-001, §5.1.6 FR-LOGOUT-001, §5.2.1 NFR-SEC-PRESERVE-001, §C.2 `BR-AUTH-006`
- `docs/design/2026-09-11-program-overview.md` §3.1(비밀값 비교), §3.4(응답 규약·CSRF 예외), §3.2

---

## U2-03

**title**: refactor(admin): AdminServer 의 if/else 라우팅을 routes.ts 라우트 표로 전환
**labels**: enhancement, area:admin, unit:2
**body**:
## 목적

`AdminServer` 의 `if/else` 라우팅을 선언적 라우트 표 `ADMIN_ROUTES` 로 바꾼다. 이 이슈가 끝나면 모든 엔드포인트가 `src/server/admin/routes.ts` 한 곳에 메서드·패턴·핸들러로 나열되고, `route()` 가 매칭과 세션 해석을 한 번에 하며, 핸들러는 `checkSession` 을 부르지 않는다. **동작은 바뀌지 않는다**: 같은 요청에 같은 상태 코드·본문. 예외는 아래 "배경" 이 적은 다중 세그먼트 경로(`/api/externalCert/12/34`) 한 가지뿐이며 200 에서 404 로 바뀐다. 권한 검사(`authorize`)는 U2-04 가 이 표 위에 얹는다.

## 배경

- `src/server/admin/AdminServer.ts`
  - `:141` `route(req,res)`: idle timeout → HSTS → `Vary: Origin` → POST/PUT/DELETE 는 `verifyCsrfGuard(req,res, pathname == '/api/login')`(`:157-164`) → 메서드별 `routeGet`(`:247`)/`routePost`(`:226`, PUT 도 여기)/`routeDelete`(`:213`) → 예외 처리(`:182-208`, 413/408/400/500) → 매칭 없으면 404 텍스트(`:209`).
  - `routeGet` 은 `/api/` 가 아니면 `onGetWebResource`(`:301`) 로 정적 파일. `Cache-Control: no-cache` 헤더(`:249`). `/api/sysInfo` 분기가 두 번 있다(`:254`, `:256`, 죽은 코드).
  - 핸들러 20개가 각자 `checkSession(req,res)`(`:843`) 를 첫 줄에서 부른다: `onUpdateAdminCert :349`, `onUpdateServerOption :456`, `onUpdateTunnelingOption :601`, `onRemoveTunnelingOption :756`, `onGetCsrfToken :828`, `onGetAdminCert :852`, `getNumberInPath :863`(→ `onActiveTunneling :878`, `onDeleteExternalServerCert :898`, `onUpdateExternalServerCert :911`, `onGetExternalServerCert :979`, `onGetClientSysInfo :994`), `onGetServerOption :1149`, `onGetSysInfo :1167`, `onGetSysUsage :1175`, `onGetClientStatus :1183`, `onGetTunnelingOption :1192`, `onGetExternalServerStatuses :1206`, `onGetServerOptionHash :1215`. `onGetVersion :973` 과 `onLogin :1032` 은 세션 없이 동작. `onGetValidateSession :814` 과 U2-02 의 `/api/logout` 은 세션만 필요.
  - POST/PUT/DELETE 핸들러는 각자 `AdminServer.readJson(req)`(`:1088`) 를 부른다.
  - `:1338` `pathname(url)` = `url.split('?')[0]`.
- `test/component/server/admin/admin-routes.test.ts` 가 라우팅 세부를 고정한다: 알 수 없는 POST/PUT/DELETE 는 보안 검사 뒤 404 JSON(`:48`), `POST /api/absent` + 악성 Origin 은 매칭 실패보다 CSRF/Origin 검사가 먼저라 403(`:73`), `/api/login?query` 도 CSRF 예외(`:55`), `/api/externalCert/12suffix?value=3` 은 **200** 이고 인증서 이름이 `external.12.cert.pem`(`:79-84`, `parseInt('12suffix') === 12`), `/api/externalCert/?value=12` 는 400(`:85`), `GET /api/version?value=` 200. 라우트 표는 이 테스트를 그대로 통과해야 한다.
- 다중 세그먼트 경로는 동작이 한 군데 바뀐다. 현재 `getNumberInPath`(`:863`) 는 `pathname.substring('/api/externalCert/'.length)` 를 `parseInt` 하므로 `/api/externalCert/12/34` 가 12 로 해석되어 200 이다. 표의 `^/api/externalCert/(?<port>[^/]*)$` 는 이 경로를 매칭하지 못해 404 JSON 이 된다. 이 경로를 고정하는 기존 테스트는 없고(테스트가 보는 것은 `/12`·`/12suffix`·`/`), 남는 세그먼트를 포트로 해석하던 기존 동작은 의도된 계약이 아니므로 404 를 받아들인다. `clientSysInfo/:id`·`tunneling/active/:port` 도 같다. 이것이 이 이슈에서 허용하는 **유일한** 동작 차이이며, 아래 "하지 말 것" 의 "응답을 바꾸지 않는다" 는 나머지 전부에 적용된다.
- U2-03 시작 시점의 API 경로(이 이슈의 `routes.test.ts` 가 표와 대조한다): `/api/login`, `/api/logout`(U2-02), `/api/version`, `/api/validateSession`, `/api/csrfToken`, `/api/serverOption`, `/api/serverOptionHash`, `/api/adminCert`, `/api/sysInfo`, `/api/sysUsage`, `/api/clientStatus`, `/api/clientSysInfo/:id`, `/api/tunnelingOption`, `/api/tunneling/active/:port`, `/api/externalServerStatuses`, `/api/externalCert/:port` — 16개(설계 §9 의 "15개" 는 `/api/logout` 이전 수). 단위 5 의 U5-02 가 먼저 끝나 있으면 `GET /api/security/bans`, `DELETE /api/security/bans/:port/:ip` 2개가 더 있으며(세션 검사만), 그 경우 표에 함께 옮긴다.

먼저 열어 볼 파일: `src/server/admin/AdminServer.ts` 전체, `test/component/server/admin/admin-routes.test.ts`, `test/component/server/admin/AdminServer.security.test.ts`, `test/unit/server/req-18-path-normalization.test.ts`.

## 적용되는 결정

- D14 는 이 이슈까지 유지된다: 기능 1:1, 동작 변경 없음.
- 개요 §3.4: 세션 없음 401, 응답 envelope 유지. §3.1: 범위 밖 리팩터링 금지(핸들러 본문은 옮기기만).
- 단위 2 §5.1: 표는 `routes.ts` 의 `export const ADMIN_ROUTES: readonly Route[]`(감사 커버리지 테스트가 순회한다).

## 만들 것

### `src/server/admin/routes.ts`

```ts
import type {Action} from "../rbac/AdminAuthorizer";   // U2-04 가 만든다. 이 이슈에서는 아래 로컬 타입으로 두고 U2-04 가 import 로 바꾼다
export type Action = string;                            // U2-03 임시. U2-04 가 유니온으로 교체
export type RouteContext = {
    req: IncomingMessage; res: ServerResponse;
    params: Record<string, string>;                     // pattern 의 이름 있는 그룹
    body?: any;                                         // POST/PUT/DELETE 에서 route() 가 readJson 한 결과
    session?: Session;                                  // action !== 'public' 일 때 채워짐
    principal?: Principal;                              // U2-04
    ip: string;                                         // getClientAddress(req)
};
export type RouteAction = Action | 'public' | 'session' | ((ctx: RouteContext) => Action);
export type Route = {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    pattern: RegExp;                                    // pathname 전체 일치(^…$). 이름 있는 그룹 (?<port>[^/]+)
    action: RouteAction;
    handler: (ctx: RouteContext) => Promise<void>;
};
export type RouteHandlers = {[name: string]: (ctx: RouteContext) => Promise<void>};
export function buildAdminRoutes(handlers: RouteHandlers): readonly Route[];   // 정적 표의 handler 이름을 함수로 치환해 Route[] 생성
export const ADMIN_ROUTES: ReadonlyArray<{method: Route['method']; pattern: RegExp; action: RouteAction; handler: string}>;   // 핸들러 이름만 든 정적 표. 테스트가 인스턴스 없이 순회
```

정적 표 `ADMIN_ROUTES` 는 핸들러를 이름(문자열)으로 가리켜 인스턴스 없이 순회할 수 있다. `AdminServer` 인스턴스는 `buildAdminRoutes(this.handlers)` 로 만든 `Route[]` 를 `public readonly routes` 로 노출한다. 표의 진입점은 `ADMIN_ROUTES` 하나이며, 같은 목록을 다른 이름으로 한 번 더 내보내지 않는다.

표(순서 = 매칭 우선순위. 이 이슈의 `action` 은 `'public'` 또는 `'session'` 두 값뿐이며 U2-04 가 `Action` 으로 바꾼다):

| method | pattern | action | handler |
|---|---|---|---|
| POST | `^/api/login$` | public | `onLogin` |
| GET | `^/api/version$` | public | `onGetVersion` |
| POST | `^/api/logout$` | session | `onLogout` |
| GET | `^/api/validateSession$` | session | `onGetValidateSession` |
| GET | `^/api/csrfToken$` | session | `onGetCsrfToken` |
| GET | `^/api/serverOption$` | session | `onGetServerOption` |
| POST, PUT | `^/api/serverOption$` | session | `onUpdateServerOption` |
| GET | `^/api/serverOptionHash$` | session | `onGetServerOptionHash` |
| GET | `^/api/adminCert$` | session | `onGetAdminCert` |
| POST, PUT | `^/api/adminCert$` | session | `onUpdateAdminCert` |
| GET | `^/api/sysInfo$` | session | `onGetSysInfo` |
| GET | `^/api/sysUsage$` | session | `onGetSysUsage` |
| GET | `^/api/clientStatus$` | session | `onGetClientStatus` |
| GET | `^/api/clientSysInfo/(?<id>[^/]*)$` | session | `onGetClientSysInfo` |
| GET | `^/api/tunnelingOption$` | session | `onGetTunnelingOption` |
| POST, PUT | `^/api/tunnelingOption$` | session | `onUpdateTunnelingOption` |
| DELETE | `^/api/tunnelingOption$` | session | `onRemoveTunnelingOption` |
| POST | `^/api/tunneling/active/(?<port>[^/]*)$` | session | `onActiveTunneling` |
| GET | `^/api/externalServerStatuses$` | session | `onGetExternalServerStatuses` |
| GET | `^/api/externalCert/(?<port>[^/]*)$` | session | `onGetExternalServerCert` |
| POST, PUT | `^/api/externalCert/(?<port>[^/]*)$` | session | `onUpdateExternalServerCert` |
| DELETE | `^/api/externalCert/(?<port>[^/]*)$` | session | `onDeleteExternalServerCert` |
| (U5-02 가 있으면) GET `^/api/security/bans$`, DELETE `^/api/security/bans/(?<port>[^/]+)/(?<ip>[^/]+)$` | session | 해당 핸들러 |

POST 와 PUT 은 표에 두 행으로 적는다(메서드 배열 금지 — 순회 테스트가 단순해진다). 숫자 파라미터(`externalCert`·`clientSysInfo`·`tunneling/active`)는 `[^/]*`(빈 세그먼트 허용)로 잡는다: 핸들러의 `getNumberInPath` 가 `parseInt` 로 받으므로 `12suffix` 는 12 로 **200**(`admin-routes.test.ts:79-84`, cert name `external.12.cert.pem`), 빈 세그먼트(`/api/externalCert/?value=12`)와 `abc` 는 NaN 으로 **400**(`:85`) 이다. `[^/]+` 로 잡으면 빈 세그먼트가 404 로 떨어져 `:85` 가 깨진다. 세그먼트를 더 붙인 `/api/externalCert/12/34` 는 매칭되지 않아 404 가 되며(배경의 유일한 동작 차이), 이를 되살리려고 `(?<port>.*)` 같은 패턴으로 넓히지 않는다. `security/bans` 의 `(?<port>[^/]+)/(?<ip>[^/]+)` 는 그대로 둔다.

### `route()` 재작성

순서(설계 §5.1 을 그대로 따른다):

1. idle timeout → HSTS → `Vary: Origin`.
2. **CSRF/Origin 검사를 라우트 매칭보다 먼저** 한 번만 한다: POST/PUT/DELETE 면 `verifyCsrfGuard(req, res, pathname == '/api/login')`(기존 `:157-164` 와 같은 호출. 쿼리스트링을 뗀 pathname 기준). 매칭 결과를 보지 않으므로 알 수 없는 경로도 보안 검사를 먼저 받는다 — `admin-routes.test.ts:73` 이 `POST /api/absent` + 악성 Origin 에 403 을, `:48` 이 정상 Origin·CSRF 에 404 를 기대한다. 라우트의 `action` 으로 예외를 판정하면 매칭 실패 시 `action` 이 없어 이 두 케이스가 갈라지므로, 예외 판정은 `pathname == '/api/login'` 한 곳에만 둔다.
3. `pathname` 으로 표 매칭(메서드 + pattern). 매칭 없음: `/api/` 로 시작하면 404 JSON(`{message: 'Not Found <url>'}`, 기존 `:221`·`:243`·`:292` 와 같은 본문), GET 이고 `/api/` 밖이면 `onGetWebResource`, 그 외는 404 JSON.
4. GET 이면 `Cache-Control: no-cache` 헤더(기존 `:249`).
5. `action !== 'public'` 이면 `resolveSession(req)` → 없으면 401 `{message: 'Invalid session'}`(기존 메시지) → `ctx.session`.
6. **그다음** POST/PUT/DELETE 면 `ctx.body = await readJson(req)`. 세션 해석보다 뒤여야 세션 없는 POST 가 413/408/400 대신 401 을 받는 기존 동작(핸들러가 `checkSession` 을 첫 줄에서 부르던 순서)이 유지된다.
7. 핸들러. 예외 처리 `:182-208` 는 그대로.

기존 핸들러는 시그니처만 `(ctx: RouteContext)` 로 바꾸고 본문 첫 줄에 `const {req, res} = ctx;` 를 두어 나머지 줄을 그대로 둔다. `checkSession` 첫 줄은 제거한다. `readJson` 을 부르던 줄은 `const payload = ctx.body;` 로 바꾼다(스트림은 `route()` 가 이미 소비했다). `getNumberInPath`(`:863`) 는 세션 검사를 빼고 `ctx.params.port`/`ctx.params.id` 를 파싱한다. `checkSession`(`:843`)·`routeGet/routePost/routeDelete` 는 삭제.

### 테스트

- `test/component/server/admin/routes.test.ts`(신규)

## 변경할 것

- `src/server/admin/AdminServer.ts`: 위 전부. `public get routes(): readonly Route[]`.
- `src/server/admin/routes.ts`: 신규.
- 기존 테스트: 수정 없음이 목표다. `(api as any)._server` 처럼 내부에 닿는 테스트가 있어도 `_server` 는 유지된다.

## 하지 말 것

- 핸들러 본문 로직(리비전·롤백·인증서·CORS 헤더)을 손보지 않는다. 옮기기만 한다. `:254-257` 의 중복 `sysInfo` 분기는 표에서 한 행이 되지만 그 외 정리는 하지 않는다.
- `authorize`·`Principal`·`/api/me` 를 만들지 않는다(U2-04). 이 이슈의 `action` 값은 `'public'`·`'session'` 뿐이다.
- 응답 본문·상태 코드·헤더를 바꾸지 않는다(배경이 적은 다중 세그먼트 경로 하나만 예외). 404 본문 문자열(`Not Found <url>`)도 그대로.
- CSRF/Origin 예외 판정을 `route.action` 으로 바꾸지 않는다. `pathname == '/api/login'` 한 곳에 둔다.
- `readJson` 을 세션 해석보다 앞에 두지 않는다.
- 정적 파일 경로 처리(`normalizeAssetUrl`, `req-18`)를 바꾸지 않는다.
- 예외를 제어 흐름으로 쓰지 않는다: 매칭 실패는 `undefined` 반환 후 분기.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/component/server/admin/routes.test.ts`
  - `ADMIN_ROUTES` 의 `(method, pattern.source)` 집합이 위 표(U5-02 가 있으면 2행 추가)와 정확히 일치한다(테스트 파일에 기대 목록을 리터럴로 적는다).
  - `ADMIN_ROUTES` 의 모든 `pattern.source` 가 `^` 로 시작하고 `$` 로 끝난다.
  - 실제 `AdminServer` 로 표의 모든 GET 경로를 세션 없이 호출하면 `public` 두 개(`/api/version`, 그리고 POST 인 `/api/login` 은 제외)만 200 이고 나머지는 401 `{message:'Invalid session'}` 이다.
  - 알 수 없는 `GET /api/nothing` 은 404 JSON, `GET /nothing.txt` 는 정적 파일 404(텍스트) 이다.
  - 매칭 실패보다 CSRF/Origin 검사가 먼저다: 세션·CSRF 헤더를 갖춘 `POST /api/absent` 는 404, 악성 `Origin` 을 붙인 같은 요청은 403 이다.
  - 세션 쿠키 없이 본문 제한(`req-11`)을 넘기는 크기로 `POST /api/serverOption` 을 보내면 413 이 아니라 401 `{message:'Invalid session'}` 이다(`readJson` 이 세션 해석보다 뒤).
  - `POST /api/tunneling/active/abc`(세션 + CSRF) 는 400 `Invalid port` 이다(표가 아니라 핸들러가 판정).
  - `GET /api/externalCert/12/34`(세션) 는 404 JSON 이다(배경이 적은 유일한 동작 차이. 200 이던 경로).
  - 표에서 `handler` 이름이 `AdminServer` 의 실제 메서드로 모두 존재한다(`typeof (api as any)[name] === 'function'`).
- `test/component/server/admin/admin-routes.test.ts`: 수정 없이 통과한다.

기존 테스트 전부 통과(라우트 표 전환의 직접 영향권): `test/component/server/admin/*.test.ts` 15개 + `rbac-login.test.ts`, `test/unit/server/admin/*.test.ts` 7개, `test/admin/*.test.ts` 13개, `test/security/*.test.ts`, `test/unit/server/req-18-path-normalization.test.ts`, `test/unit/server/rbac/*.test.ts`, (있다면) `test/unit/server/security/*`·U5-02 의 bans 테스트.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npx jest --runInBand test/component/server/admin test/unit/server/admin test/security
npm run test:admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 로봇 이모지 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U2-02.
- 후행: U2-04(`action` 을 `Action` 으로 바꾸고 `authorize` 를 끼운다), U5-05(bans 라우트에 권한).

## 근거 문서

- `docs/design/2026-09-11-unit2-rbac-model-api.md` §2(현재 라우팅), §5.1(라우트 표 구조, `routes.ts`), §8.2(기존 컴포넌트 테스트 전체 통과), §9(U2-03: 동작 동일, `routes.test.ts`)
- `docs/design/2026-09-11-unit5-connection-security.md` §5(U5-02 의 bans 임시 API, 세션 검사만)
- `docs/design/2026-09-11-program-overview.md` §1 D14, §3.1(범위 밖 리팩터링 금지), §3.4

---

## U2-04

**title**: feat(admin): 권한 결정기와 비밀번호 변경 게이트를 도입하고 /api/me 추가
**labels**: enhancement, area:admin, unit:2
**body**:
## 목적

모든 관리 API 가 세션 → 주체(`Principal`) → 권한 결정(`authorize`) 을 거치게 한다. 이 이슈가 끝나면 라우트 표의 각 항목이 `Action` 을 선언하고, `mustChangePassword` 사용자는 `/api/me` 와 `/api/me/password` 외에 아무것도 못 하며, `/api/me`·`/api/me/password`·`/api/me/acknowledge-migration` 이 생긴다. 슈퍼유저(승격된 `admin`)에게 기존 엔드포인트의 응답은 그대로다.

## 배경

- U2-03 뒤의 `src/server/admin/routes.ts`: `Route = {method, pattern, action: 'public' | 'session', handler}`, `RouteContext = {req, res, params, body?, session?, principal?, ip}`, `ADMIN_ROUTES`. `route()` 가 세션을 해석해 `ctx.session` 을 채운다.
- `AdminServer` 생성자 `:74` `constructor(tttServer: TTTServer, tls: boolean, certInfo?: CertInfo)`. 호출처: `src/server/ServerApp.ts:30`, 테스트의 `new AdminServer(undefined as any, false)`·`new AdminServer({} as any, false)`.
- `IdentityStore`(U2-01: `user`, `group`, `verifyPassword`, `setPassword`, `updateUser({mustChangePassword, migrationAcknowledged})`), `SessionStore.removeSessionsOfUser(userId, {except})`(U2-02).
- PRD 부록 A 권한 매트릭스와 §7 속성 1·2·9·10 이 규칙의 원천.
- `npm run lint` 는 `token`·`secret`·`sessionId` 식별자의 `===` 를 막는다. 세션 키 비교를 새로 쓰지 않는다.

먼저 열어 볼 파일: `src/server/admin/routes.ts`, `src/server/admin/AdminServer.ts`(`route()`, 생성자), `src/server/rbac/IdentityTypes.ts`, `src/server/rbac/IdentityStore.ts`, `test/component/server/admin/rbac-login.test.ts`, `docs/plan/prd/TTTGate-admin-rbac.md` Appendix A.

## 적용되는 결정

- D1 PRD 범위: FR-USER-FIRST-LOGIN-FORCE-001(비밀번호 변경 전 API 차단), NFR-USAB-FIRST-LOGIN-001, NFR-PERF-PERMCHECK-001(p95 ≤ 2ms), NFR-SEC-NEW-ENDPOINT-CSRF-001.
- 프로그램 개요 §3.4: 세션 없음 401, 권한 없음 403, 검증 실패 422. 새 엔드포인트도 같은 envelope.
- D14 는 여기서 끝난다: 이 이슈부터 슈퍼유저가 아닌 주체에게는 응답이 달라진다.
- 단위 2 §8.1: `X-Authz-Us` 노출은 생성자 옵션 `exposeAuthzTiming`(기본 false)으로만. 환경변수 금지.

## 만들 것

### `src/server/rbac/Principal.ts`

```ts
export type Principal = {
    userId: string; username: string; role: Role; groupId: string;
    attributes: GroupAttributes;         // superuser 는 무시된다(값은 system:superuser 그룹의 것)
    mustChangePassword: boolean;
    legacy?: true;                       // legacy-fallback 세션
};
export const LEGACY_PRINCIPAL: Readonly<Principal>;   // {userId:'legacy-admin', username:'admin', role:'superuser', groupId:'system:superuser', attributes: DEFAULT_GROUP_ATTRIBUTES, mustChangePassword:false, legacy:true}
export function principalOf(session: Session, store: IdentityStore): Principal | undefined;
```

`principalOf`: `session.userId === 'legacy-admin'` 이면 `LEGACY_PRINCIPAL`. 아니면 `store.user(userId)` 가 없거나 `disabled` 면 `undefined`(호출자가 세션을 제거하고 401). 그룹은 `store.group(user.groupId)`; 없으면(수동 편집으로 깨진 경우) `DEFAULT_GROUP_ATTRIBUTES` 를 쓰고 `logger.warn`.

### `src/server/rbac/AdminAuthorizer.ts`

```ts
export type Action =
    | 'user:manage' | 'group:manage' | 'server:manage' | 'security:manage' | 'session:manage' | 'audit:read-all'
    | 'tunnel:list' | 'tunnel:create' | 'tunnel:read' | 'tunnel:update' | 'tunnel:delete' | 'tunnel:activate' | 'tunnel:cert' | 'tunnel:reassign'
    | 'status:read' | 'me:read' | 'me:password' | 'me:sessions' | 'audit:read-self';
export type Target = {port?: number; owner?: {userId: string; groupId: string}};   // owner 없음 = system:migrated 또는 미존재
export type Decision = {allowed: true} | {allowed: false; status: 403 | 404; code: string};
export type Section = 'status' | 'tunnels' | 'server' | 'users' | 'groups' | 'security' | 'audit' | 'sessions' | 'me';
export function authorize(principal: Principal, action: Action, target?: Target): Decision;
export function sections(principal: Principal): Section[];
```

설계 §4.4 의 `Target = {port?}` 에 `owner` 를 더했다. `authorize` 는 저장소를 조회하지 않는 순수 함수여야 p95 목표와 표 기반 테스트가 성립하기 때문이며, `owner` 는 라우트 계층이 채운다(이 이슈에서는 항상 `undefined`; U2-08 이 `AuthorizationContext.targetOf(port)` 로 채운다).

규칙(위에서 아래로 첫 일치):

| 조건 | 결정 |
|---|---|
| `principal.mustChangePassword` 이고 action 이 `me:read`·`me:password` 가 아님 | 403 `password_change_required` |
| `role === 'superuser'` | 허용 |
| action ∈ {`user:manage`, `group:manage`, `server:manage`, `security:manage`, `session:manage`, `audit:read-all`, `status:read`, `tunnel:reassign`, `tunnel:cert`} | 403 `forbidden` |
| action ∈ {`me:read`, `me:password`, `me:sessions`, `audit:read-self`} | 허용 |
| `tunnel:list`: `attributes.tunnel_crud !== 'none'` | 허용, 아니면 403 `tunnel_access_disabled` |
| `tunnel:create`: `tunnel_crud === 'full' && max_tunnel_count > 0` | 허용, 아니면 403 `tunnel_create_forbidden` |
| `tunnel:read`: `tunnel_crud !== 'none'` 이고 (`target.owner.userId === principal.userId` 또는 (`tunnel_visibility === 'group_read'` 이고 `target.owner.groupId === principal.groupId`)) | 허용 |
| `tunnel:read` 그 외 (`tunnel_crud === 'none'` 포함) | **404** `not_found` (존재를 숨긴다) |
| `tunnel:update`·`tunnel:delete`·`tunnel:activate`: 소유가 아니고 그룹 공유로 읽을 수 있는 터널 | 403 `read_only` |
| 같은 세 action: 소유이고 `tunnel_crud === 'full'` | 허용 |
| 같은 세 action: 소유이고 `tunnel_crud === 'read_only'` | 403 `read_only` |
| 같은 세 action: 그 외(타인·미존재) | 404 `not_found` |

`sections(principal)`: 슈퍼유저 → `['status','tunnels','server','users','groups','security','audit','sessions','me']`. 일반 유저 → `admin_ui_section_access` 를 순서대로 `{tunnels→'tunnels', my_audit→'audit', my_profile→'me', my_sessions→'sessions'}` 로 바꾸되 `tunnel_crud === 'none'` 이면 `tunnels` 를 뺀다.

### 라우트 표의 `action` 지정 (`routes.ts`)

`Action` 타입을 `AdminAuthorizer` 에서 import 하고 U2-03 의 `'session'` 을 아래로 바꾼다. `'public'`(`/api/login`, `/api/version`)과 `'session'`(`/api/logout`, `/api/validateSession`, `/api/csrfToken`)은 유지.

| 경로 | action |
|---|---|
| `GET /api/me` (신규) | me:read |
| `PUT /api/me/password` (신규) | me:password |
| `POST /api/me/acknowledge-migration` (신규) | me:read |
| `GET`·`POST`·`PUT /api/serverOption`, `GET /api/serverOptionHash`, `GET`·`POST`·`PUT /api/adminCert` | server:manage |
| `GET /api/sysInfo`, `sysUsage`, `clientStatus`, `clientSysInfo/:id` | status:read |
| `GET /api/tunnelingOption`, `GET /api/externalServerStatuses` | tunnel:list |
| `POST`·`PUT /api/tunnelingOption` | 함수형: `ServerOptionStore.instance.getTunnelingOption(ctx.body?.forwardPort)` 가 있으면 `tunnel:update`, 없으면 `tunnel:create` |
| `DELETE /api/tunnelingOption` | tunnel:delete |
| `POST /api/tunneling/active/:port` | tunnel:activate |
| `GET`·`POST`·`PUT`·`DELETE /api/externalCert/:port` | tunnel:cert |
| (U5-02 가 있으면) `/api/security/bans*` | security:manage |

`Route` 에 `target?: (ctx: RouteContext) => Target | undefined` 를 추가한다. 이 이슈에서는 `tunnel:*` 항목이 `{port: Number(ctx.params.port ?? ctx.body?.forwardPort)}` 만 돌려준다.

### `route()` 확장

세션 해석 뒤: `principalOf(session, IdentityStore.instance)` → `undefined` 면 `SessionStore.removeSession(key)` + 401 → `ctx.principal` → `action !== 'session'` 이면 `Action` 결정(함수형이면 호출) → `const t0 = process.hrtime.bigint(); const decision = authorize(principal, action, route.target?.(ctx)); const t1 = …` → 거부면 `sendApiFailure(res, decision.status, {code: decision.code, message: decision.status === 403 ? 'Forbidden' : 'Not Found'})` → 허용이면 `exposeAuthzTiming` 일 때 `res.setHeader('X-Authz-Us', String(Number((t1 - t0) / 1000n)))` → 핸들러.

`AdminServer` 생성자를 `constructor(tttServer, tls, certInfo?, options: {exposeAuthzTiming?: boolean} = {})` 로 확장한다. 기존 호출처는 바꾸지 않는다.

### 신규 엔드포인트

`GET /api/me` → 200:
```json
{"success":true,"partial":false,"failedScopes":[],"warnings":[],"message":"",
 "user":{"id":"u_3f9a1c2e7b4d5a60","username":"admin","displayName":"admin","role":"superuser","status":"active","groupId":"system:superuser","groupName":"Superusers","mustChangePassword":false,"migratedFromLegacyAdmin":true,"createdAt":1757548800000,"updatedAt":1757548800000},
 "group":{"id":"system:superuser","name":"Superusers","attributes":{"tunnel_crud":"full","max_tunnel_count":10,"max_tunnel_duration_ms":0,"allowed_port_range":[],"allowed_protocols":[],"max_concurrent_connections":100,"allowed_trusted_clients":[],"http_tunnel_rewrite_permissions":{"cors":false,"host":false,"header":false,"body":false},"admin_ui_section_access":["tunnels","my_audit","my_profile","my_sessions"],"tunnel_visibility":"private","rate_limit":"unlimited"}},
 "sections":["status","tunnels","server","users","groups","security","audit","sessions","me"],
 "migrationBanner":true}
```
`migrationBanner = user.migratedFromLegacyAdmin && !user.migrationAcknowledged`. `user` 는 `UserView`(`passwordHash` 제외, `groupName` 포함) — 변환 함수 `toUserView(user, groups)` 를 `src/server/rbac/UserView.ts` 에 두고 U2-06 이 재사용한다. 레거시 주체는 `user` 를 `LEGACY_PRINCIPAL` 로 합성하고(`status 'active'`, `groupName 'Superusers'`, 시각 0), `migrationBanner false`.

`PUT /api/me/password` 요청 `{"currentPassword":"temp-1234-abcd","newPassword":"new-password-1234"}` → 200 `{"success":true, ..., "mustChangePassword":false}`. 검사 순서: 레거시 주체 503 `identity_store_unavailable` → `validatePassword(newPassword)` 실패 422 `password_too_short` → `IdentityStore.verifyPassword(username, currentPassword)` 실패 422 `current_password_mismatch`(백오프 대상 아님) → `setPassword(userId, newPassword, {clearMustChange: true})` → `SessionStore.removeSessionsOfUser(userId, {except: 현재 세션 키})`. `mustChangePassword` 상태에서는 임시 비밀번호가 `currentPassword` 다.

`POST /api/me/acknowledge-migration` → `IdentityStore.updateUser(userId, {migrationAcknowledged: true})` → 200 `{"success":true}`. 레거시 주체 503.

### 테스트

- `test/unit/server/rbac/AdminAuthorizer.test.ts`
- `test/component/server/admin/authorize-latency.test.ts`
- `test/component/server/admin/rbac-login.test.ts` 확장

## 변경할 것

- `src/server/admin/routes.ts`: `action` 값, `target`, `Action` import.
- `src/server/admin/AdminServer.ts`: `route()` 의 principal·authorize 단계, 생성자 옵션, 새 핸들러 3개.
- `test/component/server/admin/routes.test.ts`(U2-03): 기대 목록에 `/api/me` 3행 추가, "세션 없이 401" 케이스 유지.
- `test/component/server/admin/rbac-login.test.ts`: 케이스 추가.

## 하지 말 것

- 핸들러 본문 로직을 손보지 않는다.
- 터널 소유 필터·`owner` 계산·`AttributeEnforcer` 를 만들지 않는다(U2-07·U2-08). 이 이슈에서 `tunnel:*` 의 `target.owner` 는 항상 `undefined` 이며, 그 결과 일반 유저는 모든 기존 터널에 대해 404/403 을 받는다. 이것은 의도된 중간 상태다(일반 유저를 만드는 API 는 U2-06 에서 생긴다).
- 사용자·그룹 API(U2-06), 감사(U2-05)를 만들지 않는다.
- `authorize` 안에서 `IdentityStore`·`ServerOptionStore` 를 조회하지 않는다(순수 함수).
- `authorize` 결과를 세션에 캐시하지 않는다(PRD R-T3 의 캐싱은 p95 미달일 때만 고려하며 이 이슈의 측정으로 판단한다).
- `X-Authz-Us` 를 환경변수로 켜지 않는다.
- 예외를 제어 흐름으로 쓰지 않는다: `Decision` 반환.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트(`bcryptCost 4`):

- `test/unit/server/rbac/AdminAuthorizer.test.ts`
  - 표 데이터 `test.each` 로 다음 조합을 전수 단언한다. 주체 4종: `superuser`, `regular(full, private)`, `regular(read_only, group_read)`, `regular(none)`. 대상 4종: 소유(`owner.userId === 본인`), 같은 그룹 타인, 다른 그룹 타인, `owner undefined`. action 19종 전부. 기대값은 위 규칙 표에서 계산해 테스트 파일에 리터럴로 적는다(예: `['regular(full,private)','tunnel:read','same-group-other', {allowed:false,status:404,code:'not_found'}]`).
  - `mustChangePassword: true` 인 슈퍼유저에 `server:manage` 면 403 `password_change_required` 이고 `me:password`·`me:read` 면 허용이다.
  - `regular(full)` 에 `max_tunnel_count: 0` 이면 `tunnel:create` 가 403 `tunnel_create_forbidden` 이다.
  - `sections(superuser)` 는 9개 순서 그대로이고, `regular` 에 `admin_ui_section_access: ['my_profile','tunnels']` 이면 `['me','tunnels']`, 거기에 `tunnel_crud:'none'` 이면 `['me']` 이다.
  - 성능: `regular(full,private)` 주체로 `authorize(p,'tunnel:read',{port:1,owner:{userId:'x',groupId:'g'}})` 를 10,000회 호출해 각 호출 시간을 `process.hrtime.bigint()` 로 재고 p95 ≤ 0.2ms 이다(워밍업 1,000회 제외).
- `test/component/server/admin/authorize-latency.test.ts`
  - `new AdminServer(stub, false, undefined, {exposeAuthzTiming: true})` 로 띄우고 슈퍼유저 세션으로 `GET /api/tunnelingOption` 을 1,000회 호출해 `X-Authz-Us` 헤더 값(정수 µs)의 p95 ≤ 2000 이다.
  - 옵션 없이 띄우면 `X-Authz-Us` 헤더가 없다. `process.env` 에 무엇을 두어도 헤더가 생기지 않는다.
- `test/component/server/admin/rbac-login.test.ts` (추가)
  - `IdentityStore` 로 `mustChangePassword: true` 인 일반 유저를 만들어 로그인하면 200 `mustChangePassword true` 이고, 그 세션으로 `GET /api/tunnelingOption` 이면 403 `code 'password_change_required'`, `GET /api/me` 는 200, `GET /api/validateSession`·`POST /api/logout` 은 200 이다.
  - `PUT /api/me/password {currentPassword: 틀림}` 이면 422 `current_password_mismatch`; `{newPassword:'short'}` 이면 422 `password_too_short`; 올바르면 200 이고 `/api/me` 의 `mustChangePassword` 가 false 이며 이후 `GET /api/tunnelingOption` 이 403 `password_change_required` 가 아니다(이 이슈에서는 owner 가 없어 빈 목록 200 또는 `tunnel_access_disabled` 가 아닌 200).
  - 같은 사용자 세션 2개에서 비밀번호를 바꾸면 요청한 세션은 살아 있고 다른 세션은 401 이다.
  - 승격된 `admin` 의 `GET /api/me` 는 `migrationBanner true`, `user.groupName 'Superusers'`, `sections` 9개이며, `POST /api/me/acknowledge-migration` 후 `migrationBanner false` 이다.
  - 일반 유저 세션으로 `GET /api/serverOption`·`GET /api/sysInfo`·`GET /api/externalCert/1` 이면 403 `forbidden`, `GET /api/users` 는 이 이슈에서 라우트가 없으므로 404 이다.
  - 사용자를 `disabled` 로 바꾼 뒤 그 세션으로 `GET /api/me` 면 401 이다.
  - 세션 쿠키 없이 `GET /api/me` 면 401, `POST /api/me/acknowledge-migration` 을 CSRF 헤더 없이 보내면 403 이다.
  - legacy-fallback 서버에서 `GET /api/me` 는 200 `user.id 'legacy-admin'`, `PUT /api/me/password` 는 503 `identity_store_unavailable` 이다.

기존 테스트 전부 통과: `test/component/server/admin/*.test.ts` 15개 + `routes`·`rbac-login`, `test/unit/server/admin/*.test.ts` 7개, `test/admin/*.test.ts` 13개, `test/security/*.test.ts`, `test/unit/server/rbac/*.test.ts`.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npx jest --runInBand test/unit/server/rbac test/component/server/admin
npm run test:admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 로봇 이모지 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U2-03.
- 후행: U2-05(감사 헬퍼가 `RouteContext.principal` 을 쓴다), U2-10(UI 가 `/api/me` 를 읽는다), U4-*(라우트 표에 항목 추가), U5-05(bans 에 `security:manage`).

## 근거 문서

- `docs/design/2026-09-11-unit2-rbac-model-api.md` §4.4(Principal·AdminAuthorizer·sections), §5.1(`route()` 순서), §5.2(`/api/me`, `/api/me/password`, `/api/me/acknowledge-migration`, action 열), §8.1(`AdminAuthorizer.test.ts`, `authorize-latency.test.ts` 와 `exposeAuthzTiming`), §8.2, §9(U2-04)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.1 FR-USER-FIRST-LOGIN-FORCE-001, §5.2.2 NFR-PERF-PERMCHECK-001, §5.2.3 NFR-USAB-FIRST-LOGIN-001, §7 속성 1·2·9·10, §9.1 R-T3, Appendix A
- `docs/design/2026-09-11-program-overview.md` §3.4, §3.1

---

## U2-05

**title**: feat(admin): 감사 싱크 삽입점과 CUD 라우트 감사 래핑 추가
**labels**: enhancement, area:admin, unit:2
**body**:
## 목적

관리 API 의 생성·수정·삭제 호출과 로그인·권한 거부·마지막 슈퍼유저 가드가 모두 한 인터페이스 `AuditSink` 를 거치게 한다. 이 이슈가 끝나면 기본 싱크가 로거로 JSON 을 남기고, 4 단위는 `AuditSinkRegistry.set(new FileAuditSink())` 한 줄로 파일 저장을 붙일 수 있으며(`audited()` 는 고치지 않는다), 라우트 표의 CUD 항목 전수가 감사를 남기는지 테스트가 기계적으로 확인한다(PRD K3).

## 배경

- U2-04 뒤의 `src/server/admin/routes.ts`: `Route = {method, pattern, action, target?, handler}`, `ADMIN_ROUTES`, `RouteContext = {req, res, params, body?, session?, principal?, ip}`. `route()` 가 `authorize` 거부 시 403/404 를 보낸다.
- `IdentityStore.updateUser/deleteUser` 의 마지막 슈퍼유저 가드는 409 만 돌려준다(U2-01 에서 감사는 이 이슈로 미룸).
- `SessionStore.sessionIdOf(key)`(U2-02).
- 로거: `src/util/logger/LoggerFactory.ts` `LoggerFactory.getLogger('server', '<name>')` → `logger.info(message)`.
- 민감정보 마스킹: `src/util/SecretRedactor.ts` `redactSecrets(value)`(키 접미사 `password`·`secret`·`token` 을 `[REDACTED]` 로).
- 4 단위 §2.1 이 `FileAuditSink` 의 큐 상한 도달 시 `reserve()` 가 false 를 돌려주고 `audited()` 가 503 을 내야 한다고 정한다. §2.2 가 이벤트 타입 목록을 확정하며 이 이슈는 그 문자열을 그대로 쓴다(4 단위가 상수 파일로 옮긴다).

먼저 열어 볼 파일: `src/server/admin/routes.ts`, `src/server/admin/AdminServer.ts`(`route()`, `onLogin`), `src/util/SecretRedactor.ts`, `src/server/rbac/IdentityStore.ts`(`last_superuser` 분기), `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §2.1~2.2.

## 적용되는 결정

- D1 PRD 범위: FR-AUDIT-CAPTURE-001(CUD 성공·실패 전수), NFR-VISI-COVERAGE-001(자동 테스트가 커버리지 강제), NFR-VISI-LOGIN-EVENTS-001(로그인·역할 변경 등 별도 타입), NFR-PERF-AUDIT-WRITE-001(드롭 금지, 배압으로 API 실패).
- 단위 2 §4.6: `reserve(): boolean` 을 처음부터 두고 `audited()` 는 핸들러 실행 **전에** 부른다. `sessionIdHash = SessionStore.sessionIdOf(key)`. `login_success` 의 `actor.role` 채움.

## 만들 것

### `src/server/audit/AuditSink.ts`

```ts
export type AuditActor = {userId: string; username: string; role?: Role} | {userId: 'system'};
export type AuditTargetKind = 'user' | 'group' | 'tunnel' | 'server' | 'session' | 'security';
export type AuditEvent = {
    at: number; actor: AuditActor; sessionIdHash?: string; ip?: string;
    type: string; target?: {kind: AuditTargetKind; id: string};
    outcome: 'success' | 'failure'; summary: string; detail?: Record<string, unknown>;
};
export interface AuditSink {
    reserve(): boolean;                          // 기록할 자리가 있으면 true. false 면 호출자가 작업을 실행하지 않는다
    record(event: AuditEvent): Promise<void>;
}
export class LoggerAuditSink implements AuditSink {
    constructor(write: (line: string) => void = (line) => logger.info(line));   // 테스트 캡처용 주입
    reserve() { return true; }
    record(event) { this.write('audit ' + JSON.stringify(redactSecrets(event))); return Promise.resolve(); }
}
export const AuditSinkRegistry = { current(): AuditSink; set(sink: AuditSink): void; reset(): void /* LoggerAuditSink 로 */ };
```

`Role` 은 `IdentityTypes` 에서 type-only import. `audit/` 는 `rbac/` 의 값을 import 하지 않는다(순환 방지).

### `AdminServer.audited()` 헬퍼

```ts
private async audited(ctx: RouteContext,
    event: {type: string; target?: AuditEvent['target']; summary: string; detail?: Record<string, unknown>},
    handler: (ctx: RouteContext) => Promise<void>): Promise<void>
```

동작:
1. `const sink = AuditSinkRegistry.current(); if(!sink.reserve()) { sendApiFailure(res, 503, {code:'audit_unavailable', message:'Audit log unavailable'}); return; }` — 핸들러를 실행하지 않는다.
2. `handler(ctx)` 를 실행한다. 정상 종료면 `outcome = ctx.res.statusCode < 400 ? 'success' : 'failure'`; 예외로 끝나면 `outcome 'failure'` 에 `detail.error = String(e)` 를 더하고 예외를 잡아 둔다.
3. `sink.record({at: now, actor: {userId, username, role}, sessionIdHash: SessionStore.sessionIdOf(ctx.session.key), ip: ctx.ip, type, target, outcome, summary, detail: redactSecrets(detail)})` 를 `await` 한다. reject 되면 `logger.error('audit record failed', e)` 만 남긴다(자리는 `reserve()` 로 이미 확보했으므로 여기서의 실패는 싱크 장애다. 응답은 이미 나갔다).
4. 잡아 둔 예외가 있으면 다시 던져 `route()` 의 기존 처리(413/408/400/500)를 받게 한다.

`Route` 에 `audit?: (ctx: RouteContext) => {type: string; target?: AuditEvent['target']; summary: string; detail?: Record<string, unknown>}` 를 추가하고 `route()` 가 `audit` 이 있으면 `audited(ctx, route.audit(ctx), route.handler)` 로, 없으면 `route.handler(ctx)` 로 부른다. 라우트 표의 CUD 항목:

| 라우트 | type | target |
|---|---|---|
| POST/PUT `/api/serverOption` | `server_option_updated` | `{kind:'server', id:'server'}` |
| POST/PUT `/api/adminCert` | `admin_cert_updated` | `{kind:'server', id:'admin-cert'}` |
| POST/PUT `/api/tunnelingOption` | `tunnel_created` 또는 `tunnel_updated`(action 과 같은 판정) | `{kind:'tunnel', id: String(forwardPort)}` |
| DELETE `/api/tunnelingOption` | `tunnel_deleted` | tunnel |
| POST `/api/tunneling/active/:port` | 본문 `active` 가 true 면 `tunnel_activated`, 아니면 `tunnel_deactivated` | tunnel |
| POST/PUT `/api/externalCert/:port` | `tunnel_cert_updated` | tunnel |
| DELETE `/api/externalCert/:port` | `tunnel_cert_deleted` | tunnel |
| PUT `/api/me/password` | `password_changed`(`detail.firstLogin = principal.mustChangePassword`) | `{kind:'user', id: userId}` |
| POST `/api/me/acknowledge-migration` | `user_updated`(`detail.field:'migrationAcknowledged'`) | user |
| POST `/api/logout` | `logout` | `{kind:'session', id: sessionIdOf(key)}` |
| (U5-02 가 있으면) DELETE `/api/security/bans/:port/:ip` | `security_ban_removed` | `{kind:'security', id:'<port>/<ip>'}` |

`summary` 는 `'<type> <target.id>'` 형식으로 고정한다.

### `audited()` 밖의 이벤트

- `onLogin`: 성공 시 `login_success`(`actor.role` 포함 — PRD K2 가 `role=superuser` 로 집계, target user, `sessionIdHash` 는 새 세션), 실패 시 `login_failure`(actor `{userId:'system'}`, `detail.username`, target 없음). 부트스트랩 실패·429 도 `login_failure`. `reserve()` 를 부르지 않고 `record(...).catch(e => logger.error(...))` 로 흘린다(로그인은 CUD 가 아니며 응답을 감사 배압으로 막지 않는다).
- `route()` 의 `authorize` 거부: `access_denied`(`detail.action`, `detail.path`, outcome `failure`), 같은 방식으로 흘린다.
- `IdentityStore.updateUser/deleteUser` 의 `last_superuser` 분기: `AuditSinkRegistry.current().record({at, actor:{userId:'system'}, type:'last_superuser_guard_hit', target:{kind:'user', id}, outcome:'failure', summary, detail:{operation:'demote'|'disable'|'delete'}})` 를 흘린다.

### 테스트

- `test/unit/server/audit/AuditSink.test.ts`(신규)
- `test/component/server/admin/audit-sink.test.ts`(신규)

## 변경할 것

- `src/server/admin/routes.ts`: `Route.audit`, CUD 항목의 메타.
- `src/server/admin/AdminServer.ts`: `audited()`, `route()` 분기, 로그인·거부 이벤트.
- `src/server/rbac/IdentityStore.ts`: `last_superuser` 분기에 이벤트.
- `test/helpers/runtime.ts` `resetRuntimeState` 에 `AuditSinkRegistry.reset()` 추가.
- `src/server/ServerApp.ts`: 변경 없음(기본 싱크가 로거. 4 단위가 `set` 한다).

## 하지 말 것

- 파일 저장·큐·보존·조회 API 를 만들지 않는다(U4-01~02).
- 이벤트 타입 상수 파일을 만들지 않는다(U4-01 이 `audit/AuditEventTypes.ts` 로 옮긴다).
- `detail` 에 비밀번호·임시 비밀번호·세션 키·토큰을 넣지 않는다. `redactSecrets` 는 마지막 안전망이지 허가가 아니다.
- GET 라우트에 `audit` 을 달지 않는다.
- `audited()` 안에서 응답을 버퍼링하거나 큐를 만들지 않는다. 배압은 `reserve()` 한 곳으로 표현한다.
- 예외를 제어 흐름으로 쓰지 않는다: `reserve()` 는 boolean, `record` 의 reject 는 싱크 장애에만.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/unit/server/audit/AuditSink.test.ts`
  - `AuditSinkRegistry.current()` 기본값이 `LoggerAuditSink` 이고 `reserve()` 가 true 이며, `set(stub)` 뒤 `current() === stub`, `reset()` 뒤 다시 `LoggerAuditSink` 이다.
  - `new LoggerAuditSink(capture).record({... detail:{temporaryPassword:'x', sessionToken:'y'}})` 가 캡처한 문자열에 `'x'`·`'y'` 가 없고 `[REDACTED]` 가 있으며 `type`·`outcome` 은 그대로 있다.
- `test/component/server/admin/audit-sink.test.ts` (실제 `AdminServer`, 스텁 싱크 `{events: AuditEvent[]; reserveResult: boolean; reserve() {return this.reserveResult}; record(e) {events.push(e); return Promise.resolve()}}`)
  - `ADMIN_ROUTES` 에서 `method !== 'GET'` 이고 `action !== 'public'` 이며 `action !== 'session'` 인 항목 전부에 `audit` 이 정의되어 있고, `POST /api/logout` 에도 정의되어 있다(K3 자동 검증. 4 단위·5 단위가 항목을 더해도 그대로 판정된다).
  - 슈퍼유저로 `POST /api/tunnelingOption`(유효 본문) 이면 이벤트 1건 `type 'tunnel_created'`, `outcome 'success'`, `actor.username 'admin'`, `actor.role 'superuser'`, `target {kind:'tunnel', id:'<port>'}`, `sessionIdHash` 가 `SessionStore.sessionIdOf(쿠키의 sessionKey)` 와 같고, `ip '127.0.0.1'` 이다.
  - 같은 요청을 잘못된 본문(`forwardPort` 없음)으로 보내 400 이면 이벤트 `outcome 'failure'` 이고 응답 상태가 400 그대로다.
  - `DELETE /api/tunnelingOption` 존재하지 않는 포트 → 404 응답 + `tunnel_deleted failure`.
  - `reserveResult = false` 로 두고 `POST /api/tunnelingOption` 이면 응답이 503 `code 'audit_unavailable'`, 이벤트 0건, `ServerOptionStore` 의 터널 수가 요청 전과 같다(실행되지 않음). 같은 상태에서 `GET /api/tunnelingOption` 은 200 이다.
  - 로그인 성공이면 `login_success`(`actor.role 'superuser'`, `sessionIdHash` 16자), 틀린 비밀번호면 `login_failure`(`detail.username`), 둘 다 `detail` 에 `password` 키가 없다. `reserveResult = false` 여도 로그인은 200 이다.
  - 일반 유저로 `GET /api/serverOption`(403) 이면 `access_denied`(`detail.action 'server:manage'`, `detail.path '/api/serverOption'`).
  - 마지막 슈퍼유저를 `IdentityStore.updateUser(id,{role:'regular'})` 하면 `last_superuser_guard_hit`(`detail.operation 'demote'`) 1건, `deleteUser` 면 `'delete'` 1건이다.
  - `PUT /api/me/password` 성공이면 `password_changed`(`detail.firstLogin`) 이고 `detail` 에 `currentPassword`·`newPassword` 가 없다. `POST /api/logout` 이면 `logout` 이고 `target.id` 가 `sessionIdOf(key)` 다.

기존 테스트 전부 통과: `test/component/server/admin/*.test.ts`(15 + `routes`, `rbac-login`, `authorize-latency`), `test/unit/server/admin/*.test.ts`, `test/admin/*.test.ts`, `test/unit/server/rbac/*.test.ts`.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/server/audit test/unit/server/rbac test/component/server/admin
npm run test:browser:install
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 로봇 이모지 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U2-04.
- 후행: U2-06(사용자·그룹 API 가 `audit` 메타를 단다), U4-01(FileAuditSink 의 `reserve`).

## 근거 문서

- `docs/design/2026-09-11-unit2-rbac-model-api.md` §4.1(마지막 슈퍼유저 가드 이벤트), §4.3(`sessionIdOf`), §4.6(AuditSink·`reserve`·`audited` 순서), §5.1(`login_success` 의 role), §8.2(`audit-sink.test.ts`), §9(U2-05)
- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §2.1(배압 → 503 `audit_unavailable`), §2.2(이벤트 타입 표)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.4 FR-AUDIT-CAPTURE-001, §5.2.2 NFR-PERF-AUDIT-WRITE-001, §5.2.5 NFR-VISI-COVERAGE-001·NFR-VISI-LOGIN-EVENTS-001, §3.3 K2·K3, §6.4

---

## U2-06

**title**: feat(admin): 사용자·그룹 관리 API 와 임시 비밀번호 발급 추가
**labels**: enhancement, area:admin, unit:2
**body**:
## 목적

슈퍼유저가 HTTP API 로 사용자와 그룹을 만들고 고치고 지울 수 있게 한다. 이 이슈가 끝나면 `/api/users*` 6개와 `/api/groups*` 5개 라우트가 표에 있고, 사용자 생성·비밀번호 초기화 응답에만 임시 비밀번호 평문이 1회 실린다. 3 단위 화면은 이 API 만 쓴다.

## 배경

- `IdentityStore`(U2-01) 의 `createUser({password,…}): Promise<Result<User>>`, `updateUser({displayName, role, status, groupId, mustChangePassword})`, `deleteUser`, `setPassword(id, pw, {clearMustChange})`, `createGroup`, `updateGroup`, `deleteGroup`, `membersOf`, `Result<T>`(status 404/409/422 + code).
- 라우트 표·`RouteContext`·`Route.audit`·`audited()`(U2-03~05). `user:manage`·`group:manage` action 은 이미 `authorize` 에 있다(슈퍼유저만).
- `UserView`·`toUserView(user, groups)`(U2-04 `src/server/rbac/UserView.ts`).
- `SessionStore.removeSessionsOfUser`(U2-02).
- 무작위: `crypto.randomInt(0, 62)` 를 16회.
- `AdminServer.ts` 는 현재 1,569줄(`wc -l src/server/admin/AdminServer.ts`)이고 U2-02~U2-05 가 `onLogin` 재작성·`/api/logout`·`/api/me` 3개·`audited()` 를 더해 U2-05 뒤에는 1,700줄 안팎이 된다. 이 이슈의 핸들러 11개를 같은 파일에 두면 설계 §5.1 이 정한 상한 2,000줄을 넘으므로 분리한다(아래).

먼저 열어 볼 파일: `src/server/admin/routes.ts`, `src/server/admin/AdminServer.ts`(`/api/me` 핸들러, `sendApiSuccess/sendApiFailure`), `src/server/rbac/IdentityStore.ts`, `src/server/rbac/UserView.ts`, `test/component/server/admin/rbac-login.test.ts`(세션·CSRF 헬퍼 재사용).

## 적용되는 결정

- D1 PRD 범위: FR-USER-CRUD-001, FR-USER-TEMP-PW-001(평문 1회 노출, 저장은 해시), FR-USER-ROLE-001, FR-USER-LAST-SUPERUSER-001, FR-USER-STATUS-001, FR-GROUP-CRUD-001, FR-GROUP-ATTR-ASSIGN-001, FR-GROUP-MEMBER-ASSIGN-001, FR-GROUP-DELETE-GUARD-001.
- 프로그램 개요 §3.4: 검증 422, 충돌 409, 없음 404. `IdentityStore` 의 `Result` status·code 를 그대로 HTTP 로 낸다.

## 만들 것

### `src/server/admin/rbacRoutes.ts` (핸들러 분리)

`RouteContext` 에 설계 §5.1 의 헬퍼 세 개를 두어 두 파일이 같은 진입점을 쓴다.

```ts
ok(data: object, status = 200): void;                  // sendApiSuccess 를 감싼 클로저
fail(status: number, code: string, message: string): void;   // sendApiFailure 를 감싼 클로저
auditDetail(patch: Record<string, unknown>): void;     // audited() 가 record 직전에 읽는 누적 객체에 얕게 병합
```

구현은 `route()` 가 `ctx` 를 만들 때 넣는 클로저다. `ok` 의 `status` 기본 인자는 설계 §5.1 의 `ok(data)` 에 더한 것으로, `POST /api/users`·`POST /api/groups` 가 201 을 내야 하기 때문이며 생략하면 설계와 같은 200 이다. `fail` 은 설계 시그니처 `fail(status, code, message)` 를 그대로 쓴다(`{code, message}` 객체를 받는 변형을 따로 두지 않는다). `auditDetail` 은 필드가 아니라 함수이며, 호출이 없으면 `detail` 은 `audit` 메타가 준 값 그대로다.

`rbacRoutes.ts` 는 `export function rbacRouteTable(): Route[]` 로 아래 11행을 돌려주고 `routes.ts` 의 표가 이를 펼쳐 넣는다. `replyResult(ctx, result: Result<T>, onSuccess: (value: T) => object, successStatus = 200)` 헬퍼 하나가 `Result` 를 HTTP 로 바꾼다(실패면 `ctx.fail(result.status, result.code, result.message)`).

`rbacRoutes.ts` 는 단위 4 가 `/api/me/mfa/*` 와 `/api/me/sessions*` 핸들러를 더할 확장 지점이다. 그 이슈들은 `rbacRouteTable()` 에 행을 더하고 같은 `ctx.ok/fail/auditDetail` 을 쓰며, `AdminServer.ts` 에 핸들러를 새로 두지 않는다.

### 라우트 표 추가 (모두 `audit` 메타 포함)

| method | pattern | action | audit type / target |
|---|---|---|---|
| GET | `^/api/users$` | user:manage | — |
| POST | `^/api/users$` | user:manage | `user_created` / `{kind:'user', id: body.username}`(생성 전이라 username) |
| GET | `^/api/users/(?<id>[^/]+)$` | user:manage | — |
| PUT | `^/api/users/(?<id>[^/]+)$` | user:manage | body 에 `role` 키가 있으면 `role_changed`, `status` 키가 있으면 `user_status_changed`, 그 외 `user_updated` / user(id) |
| DELETE | `^/api/users/(?<id>[^/]+)$` | user:manage | `user_deleted` / user |
| POST | `^/api/users/(?<id>[^/]+)/password-reset$` | user:manage | `temp_password_issued` / user |
| GET | `^/api/groups$` | group:manage | — |
| POST | `^/api/groups$` | group:manage | `group_created` / `{kind:'group', id: body.name}` |
| GET | `^/api/groups/(?<id>[^/]+)$` | group:manage | — |
| PUT | `^/api/groups/(?<id>[^/]+)$` | group:manage | body 에 `attributes` 가 있으면 `group_attributes_changed`, 아니면 `group_updated` / group(id) |
| DELETE | `^/api/groups/(?<id>[^/]+)$` | group:manage | `group_deleted` / group |

`audit` 메타는 요청 전에 계산되므로 `detail` 에 뒤늦게 알게 되는 값(새 사용자 id, `changedKeys`)은 핸들러가 `ctx.auditDetail({...})` 로 넣고 `audited()` 가 `record` 직전에 합친다(위 헬퍼). `POST /api/users` 성공 시 `temp_password_issued`(`detail.generated: boolean`) 는 핸들러 안에서 `AuditSinkRegistry.current().record(...)` 로 하나 더 흘린다. `group_attributes_changed` 의 `detail.changedKeys` 는 값이 실제로 바뀐 키 목록(깊은 비교).

### 요청·응답

`GET /api/users` → `{"success":true,…,"users":[UserView…]}`. `UserView = {id, username, displayName, role, status, groupId, groupName, mustChangePassword, migratedFromLegacyAdmin, createdAt, updatedAt}`. `createdAt` 오름차순.

`POST /api/users`
```json
{"username":"alice","displayName":"Alice","role":"regular","groupId":"g_7c1d0a2b3c4d5e6f","temporaryPassword":"optional-1234"}
```
→ 201
```json
{"success":true,"partial":false,"failedScopes":[],"warnings":[],"message":"",
 "user":{"id":"u_…","username":"alice","displayName":"Alice","role":"regular","status":"active","groupId":"g_…","groupName":"Field team","mustChangePassword":true,"migratedFromLegacyAdmin":false,"createdAt":1757548800000,"updatedAt":1757548800000},
 "temporaryPassword":"optional-1234"}
```
순서: `role` 이 `'superuser'|'regular'` 가 아니면 422 `role_invalid` → `temporaryPassword` 가 있으면 문자열이어야 하고(아니면 422 `password_too_short`), 없으면 `generateTemporaryPassword()` → `createUser({username, displayName, role, groupId, password, mustChangePassword: true})` → `Result` 실패면 그 status·code(`password_too_short`, `username_taken`, `superuser_group_reserved`, `group_not_found` …) → 성공 201.

`GET /api/users/:id` → `{"user": UserView}`, 없으면 404 `user_not_found`.

`PUT /api/users/:id` 요청 `{"displayName":"Alice K","role":"superuser","status":"disabled","groupId":"default"}`(모두 선택) → 200 `{"user": UserView}`. `displayName` 은 `validateDisplayName`. 나머지는 `updateUser` 의 `Result`(409 `last_superuser`, 422 `superuser_group_reserved`, 404). 본문에 `mustChangePassword`·`migrationAcknowledged` 가 와도 무시한다(패치 허용 키 4개만 골라 넘긴다). 자기 자신을 `disabled` 로 바꾸는 요청은 슈퍼유저가 둘 이상이면 허용되며 현재 세션도 제거된다(다음 요청 401).

`DELETE /api/users/:id` → 200 `{"success":true}`. 자기 자신 삭제도 같은 규칙. 없으면 404. 소유 터널 검사(409 `user_owns_tunnels`)는 `ownerId` 가 생기는 U2-08 이 추가한다.

`POST /api/users/:id/password-reset` 요청 `{"temporaryPassword":"optional-1234"}`(선택) → 200 `{"user": UserView, "temporaryPassword":"…"}`. `setPassword(id, pw, {clearMustChange: false})` → `updateUser(id, {mustChangePassword: true})` → `SessionStore.removeSessionsOfUser(id)`. 없는 id 404.

`GET /api/groups` → `{"groups":[{"id":"default","name":"Default","system":true,"attributes":{…},"memberCount":2}, …]}`. 시스템 그룹 먼저(`system:superuser`, `default` 순), 그 뒤 이름 오름차순.

`POST /api/groups` 요청 `{"name":"Field team","attributes":{"allowed_port_range":[{"from":20000,"to":20099}],"allowed_protocols":["HTTP","HTTPS"],"max_concurrent_connections":50}}` → 201 `{"group":{"id":"g_…","name":"Field team","system":false,"attributes":{11종 전부, 미지정은 기본값},"memberCount":0}}`.

`GET /api/groups/:id` → `{"group": Group & {memberCount}, "members": UserView[]}`. 없으면 404 `group_not_found`.

`PUT /api/groups/:id` 요청 `{"name":"Field team B","attributes":{"tunnel_visibility":"group_read"}}` → 200 `{"group": …}`. 정합성 규칙은 `validateGroupAttributes`(422 `rewrite_requires_http_rewrite` 등). `system:superuser` 는 422 `system_group_readonly`.

`DELETE /api/groups/:id` → 200 또는 422 `system_group_readonly` / 409 `group_not_empty` / 404.

legacy-fallback 모드(`IdentityStore.instance.mode === 'legacy-fallback'`)에서는 위 11개 전부 503 `identity_store_unavailable`. 이 판정은 `route()` 가 `action` 이 `user:manage`·`group:manage` 이면 `authorize` 뒤, 핸들러 전에 한 번에 한다.

### `src/server/rbac/temporaryPassword.ts`

`export function generateTemporaryPassword(length = 16): string`. 문자 집합 `A-Za-z0-9`(62자), `crypto.randomInt(62)` 반복. `Math.random` 금지.

### 테스트

- `test/component/server/admin/rbac-users-groups.test.ts`(신규)
- `test/unit/server/rbac/temporaryPassword.test.ts`(신규)

## 변경할 것

- `src/server/admin/routes.ts`: `RouteContext` 에 `ok(data, status)`·`fail(status, code, message)`·`auditDetail(patch)` 추가, `rbacRouteTable()` 병합.
- `src/server/admin/AdminServer.ts`: 세 헬퍼 주입, `audited()` 가 `auditDetail` 누적값을 `record` 직전에 병합, legacy-fallback 503 분기.
- `src/server/admin/rbacRoutes.ts`: 신규.
- `test/component/server/admin/routes.test.ts`: 기대 목록에 11행 추가.

## 하지 말 것

- 터널 소유·재할당·사용자 삭제 시 소유 터널 검사(U2-08).
- 임시 비밀번호를 로그·감사 `detail`·`identity.yaml` 에 남기지 않는다. 응답 본문 1회뿐이다.
- 임시 비밀번호 응답을 `redactSecrets` 로 지우지 않는다(응답은 의도된 노출이다. `SecretRedactor` 는 로그·감사에만 적용된다).
- 사용자 목록에 `passwordHash` 를 싣지 않는다.
- 일반 유저에게 "본인만" 조회를 허용하는 `GET /api/users/:id` 분기를 만들지 않는다(PRD 부록 A 의 "본인만" 은 `/api/me` 가 담당한다).
- 임시 비밀번호를 응답 외의 곳(세션·메모리 캐시)에 두지 않는다.
- 예외를 제어 흐름으로 쓰지 않는다: `replyResult` 하나로 `Result` 를 변환한다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트. **bcrypt 주의**: 컴포넌트 테스트는 `IdentityStore.bcryptCost = 4` 로 두고 사용자를 최대 4명만 만든다.

- `test/unit/server/rbac/temporaryPassword.test.ts`
  - `generateTemporaryPassword()` 는 길이 16 이고 `/^[A-Za-z0-9]+$/` 에 맞으며, 100회 호출 결과가 모두 서로 다르다. `generateTemporaryPassword(24)` 는 길이 24 다.
- `test/component/server/admin/rbac-users-groups.test.ts` (슈퍼유저 세션 `S`, 일반 유저 세션 `R`)
  - `S`: `POST /api/groups {name:'Field team', attributes:{allowed_port_range:[{from:20000,to:20099}], allowed_protocols:['HTTP','HTTPS']}}` 이면 201, `group.attributes.max_tunnel_count === 10`(기본값 채움), `memberCount 0`.
  - `S`: `POST /api/groups {name:'x', attributes:{allowed_protocols:['HTTP_REWRITE']}}` 이면 422 `http_rewrite_requires_http`. `{name:''}` 이면 422 `group_name_invalid`.
  - `S`: `POST /api/users {username:'alice', role:'regular', groupId:<g>}` 이면 201, `temporaryPassword` 가 16자 `[A-Za-z0-9]`, `user.mustChangePassword true`, `user.groupName 'Field team'`; 응답 이후 `identity.yaml` 파일 내용에 그 평문이 없다.
  - `S`: `POST /api/users {username:'alice', …}` 다시 이면 409 `username_taken`. `{username:'bob', role:'admin'}` 이면 422 `role_invalid`. `{username:'bob', role:'regular', temporaryPassword:'short'}` 이면 422 `password_too_short`. `{username:'bob', role:'regular', groupId:'g_none'}` 이면 422 `group_not_found`.
  - `alice` 가 임시 비밀번호로 로그인하면 200 `mustChangePassword true` 이다(세션 `R` 은 이 뒤 `/api/me/password` 로 변경한 세션).
  - `R`: `GET /api/users`, `POST /api/users`, `GET /api/groups`, `DELETE /api/groups/default` 전부 403 `forbidden`.
  - `S`: `GET /api/users` 이면 `users` 에 `admin`·`alice` 가 `createdAt` 순으로 있고 어떤 항목에도 `passwordHash` 키가 없다.
  - `S`: `PUT /api/users/<alice> {role:'superuser'}` 이면 200 `groupId 'system:superuser'`; `{role:'regular'}` 이면 `groupId 'default'`; `{groupId:'system:superuser'}` 이면 422 `superuser_group_reserved`; `{displayName:''}` 이면 422 `display_name_invalid`; `{mustChangePassword:true}` 만 보내면 200 이고 값이 바뀌지 않는다.
  - `S`: `PUT /api/users/<admin> {role:'regular'}`(alice 가 regular 인 상태) 이면 409 `last_superuser`; `{status:'disabled'}` 도 409; `DELETE /api/users/<admin>` 도 409.
  - `S`: `PUT /api/users/<alice> {status:'disabled'}` 이면 200 이고 `R` 세션으로 `GET /api/me` 가 401 이며 alice 로그인이 401 이다. 다시 `{status:'active'}` 이면 로그인 200.
  - `S`: `POST /api/users/<alice>/password-reset {temporaryPassword:'reset-pass-1234'}` 이면 200 `temporaryPassword 'reset-pass-1234'`, `user.mustChangePassword true` 이고 alice 의 기존 세션은 401 이며 새 비밀번호로 로그인하면 `mustChangePassword true` 다.
  - `S`: `GET /api/groups/<g>` 이면 `members` 에 alice 가 있고 `memberCount 1`; `DELETE /api/groups/<g>` 이면 409 `group_not_empty`; alice 를 `default` 로 옮긴 뒤 `DELETE` 면 200; `DELETE /api/groups/default` 면 422 `system_group_readonly`; `PUT /api/groups/system:superuser {name:'x'}` 면 422; `GET /api/groups/g_none` 이면 404.
  - `S`: `PUT /api/groups/default {attributes:{tunnel_visibility:'group_read', max_tunnel_count:10}}` 이면 200 이고 감사 스텁에 `group_attributes_changed` 의 `detail.changedKeys` 가 `['tunnel_visibility']` 이다(값이 같은 키는 제외).
  - `S`: `DELETE /api/users/<alice>` 이면 200 이고 `GET /api/users/<alice>` 는 404 `user_not_found`.
  - 감사 스텁에 `user_created`(`detail.userId` 가 새 id), `temp_password_issued`(2건), `role_changed`, `user_status_changed`, `user_deleted`, `group_created`, `group_deleted` 가 각각 1건 이상 있고 어떤 이벤트의 `detail` 에도 `temporaryPassword` 키가 없다.
  - `identity.yaml` 을 깨뜨려 legacy-fallback 으로 띄운 서버에서 `S`(legacy-admin) 로 `GET /api/users`·`POST /api/groups` 이면 503 `identity_store_unavailable`.
  - `POST /api/users` 를 CSRF 헤더 없이 보내면 403 이다.
- `test/component/server/admin/audit-sink.test.ts` 의 "CUD 전수 `audit` 정의" 케이스가 새 라우트 11개를 포함해 통과한다.
- `test/component/server/admin/routes.test.ts` 기대 목록 갱신 후 통과.

기존 테스트 전부 통과: `test/component/server/admin/*.test.ts`, `test/unit/server/admin/*.test.ts`, `test/admin/*.test.ts`, `test/unit/server/rbac/*.test.ts`, `test/unit/server/audit/*.test.ts`.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/server/rbac test/component/server/admin
npm run test:browser:install
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 로봇 이모지 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U2-05.
- 후행: U2-07(속성 집행기·권한 컨텍스트), U2-08(사용자 삭제 시 소유 터널 검사, 일반 유저 테스트가 이 API 로 사용자를 만든다), U3-02/03(화면).

## 근거 문서

- `docs/design/2026-09-11-unit2-rbac-model-api.md` §4.1(불변식), §5.2(`/api/users*`, `/api/groups*`, `UserView`), §8.2(`rbac-users-groups.test.ts`), §9(U2-06)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.1 전체, §5.1.2 전체, §7, §6.1, Appendix A(Users·Groups 행)
- `docs/design/2026-09-11-program-overview.md` §3.4, §3.5(용어)

---

## U2-07

**title**: feat(admin): 그룹 속성 집행기와 터널 권한 컨텍스트 모듈 추가
**labels**: enhancement, area:admin, unit:2
**body**:
## 목적

일반 유저의 터널 입력을 그룹 속성으로 검증하는 `AttributeEnforcer` 와, 터널의 소유자·그룹 속성을 조회하는 `AuthorizationContext` 를 만든다. 이 이슈가 끝나면 두 모듈이 단위 테스트로 고정되어 있고, U2-08 이 라우트에 연결하며, 5 단위(U5-05~09)가 `AuthorizationContext` 를 그대로 쓴다. **라우트에는 아직 연결하지 않는다**: 이 이슈 뒤에도 API 동작은 U2-06 과 같다.

## 배경

- `src/types/TunnelingOption.ts:71-84` `type TunnelingOption = {forwardPort, protocol?: 'tcp'|'http'|'https', httpOption?, destinationAddress, destinationPort?, allowedClientNames?, allowedClientIds?, inactiveOnStartup?, tls?, bufferLimitOnServer?, bufferLimitOnClient?, keepAlive}`. `HttpOption`(`:17-24`) = `{rewriteHostInTextBody?, customRequestHeaders?, customResponseHeaders?, bodyRewriteRules?, replaceAccessControlAllowOrigin?, keepAliveTimeout?}`. `ownerId` 필드는 아직 없다(U2-08 이 추가). 이 이슈의 `AuthorizationContext` 는 `(option as {ownerId?: string}).ownerId` 로 읽는다.
- `src/server/ServerOptionStore.ts:219` `getTunnelingOptions(): TunnelingOption[]`, `:229` `getTunnelingOption(forwardPort)`. `:414` `verificationTunnelingOption` 은 알 수 없는 필드를 지우지 않으므로(허용 목록 없음) `ownerId` 가 든 yaml 은 그대로 로드된다.
- `Principal`(U2-04), `Target = {port?; owner?: {userId; groupId}}`(U2-04 `AdminAuthorizer`), `IdentityStore.user/group/users`(U2-01), `DEFAULT_GROUP_ATTRIBUTES`(U2-01).
- 로거: `LoggerFactory.getLogger('server', 'AuthorizationContext')`.

먼저 열어 볼 파일: `src/types/TunnelingOption.ts`, `src/server/ServerOptionStore.ts`(`:219-240`, `:414-470`), `src/server/rbac/AdminAuthorizer.ts`, `src/server/rbac/Principal.ts`, `src/server/rbac/IdentityTypes.ts`.

## 적용되는 결정

- D1 PRD 범위: §7 속성 1·2·4·5·7·8(집행기), 속성 10 과 소유 개념(컨텍스트). 슈퍼유저는 매트릭스의 영향을 받지 않는다(§7 기본 규칙).
- 단위 2 §4.5: `enforce(principal, next, mode: 'create' | 'update', context)`. 수정 때도 `next` 전체 검사. §6: `AuthorizationContext` 는 5 단위 계약. §5.3: `ownerId` 없으면 `system:migrated`.
- 용어(개요 §3.5): `system:migrated`.

## 만들 것

### `src/server/rbac/AttributeEnforcer.ts`

```ts
export type EnforceMode = 'create' | 'update';
export type EnforceContext = {ownedCount: number; trustedClientIds: string[]};
export type EnforceResult = {success: true} | {success: false; status: 403 | 409 | 422; code: string; message: string};
export function enforce(principal: Principal, next: TunnelingOption, mode: EnforceMode, context: EnforceContext): EnforceResult;
export function requiredProtocols(option: TunnelingOption): AllowedProtocol[];   // 아래 사상
```

슈퍼유저 주체면 즉시 `{success:true}`(호출자는 보통 부르지 않는다). `update` 때도 `next` 전체를 검사한다 — 기존 값이 이미 범위 밖(그룹 속성이 나중에 좁아짐)이면 일반 유저는 수정할 수 없고(422) 슈퍼유저가 고치거나 재할당한다. 검사 순서(첫 실패에서 멈춤):

| 검사 | 실패 |
|---|---|
| `mode === 'create'` 이고 `ownedCount >= attributes.max_tunnel_count` | 409 `tunnel_count_exceeded` |
| `next.forwardPort` 가 `allowed_port_range` 어느 구간에도 없음(`from <= port <= to`) | 422 `port_not_allowed` |
| `requiredProtocols(next)` 중 하나라도 `allowed_protocols` 에 없음 | 422 `protocol_not_allowed` |
| `next.allowedClientNames` 가 비어 있지 않음 | 422 `legacy_client_names_not_allowed` |
| `next.allowedClientIds` 의 각 id 가 `allowed_trusted_clients` 와 `context.trustedClientIds` 양쪽 모두에 있지는 않음(어느 한쪽에라도 없으면 실패) | 422 `trusted_client_not_allowed` |
| `httpOption.replaceAccessControlAllowOrigin` 이고 `!permissions.cors` / `rewriteHostInTextBody` 이고 `!host` / `customRequestHeaders`·`customResponseHeaders` 중 비어 있지 않은 것이 있고 `!header` / `bodyRewriteRules` 비어 있지 않고 `!body` | 422 `rewrite_not_allowed`(message 에 어느 플래그인지) |

`allowed_trusted_clients` 검사에 `context.trustedClientIds` 를 함께 보는 이유: 설계 §4.5 는 `allowed_trusted_clients` 만 적었지만, 그 목록은 그룹 속성이라 서버에 실제로 등록되지 않은 clientId 도 담을 수 있다(운영자가 오타를 냈거나 `ServerOption.trustedClients` 에서 지운 뒤 그룹 속성을 정리하지 않은 경우). 등록되지 않은 id 를 터널에 붙이면 그 터널은 아무 클라이언트도 붙지 못하는 상태로 저장되므로, 그룹이 허용했는지(`allowed_trusted_clients`)와 서버에 실재하는지(`context.trustedClientIds`)를 모두 요구한다. 두 조건 중 하나만 어긋나도 같은 422 `trusted_client_not_allowed` 를 내고 응답으로 어느 쪽인지 구분하지 않는다(등록된 clientId 목록이 새지 않게 한다).

`requiredProtocols`: `protocol` `tcp→['TCP']`, `http→['HTTP']`, `https→['HTTPS']`; `httpOption` 에 `replaceAccessControlAllowOrigin === true`, `rewriteHostInTextBody === true`, `customRequestHeaders`/`customResponseHeaders`/`bodyRewriteRules` 중 길이 > 0 인 것이 하나라도 있으면 `'HTTP_REWRITE'` 추가. `keepAliveTimeout` 은 리라이트가 아니다.

### `src/server/rbac/AuthorizationContext.ts`

```ts
export type OwnerInfo = {userId: string; groupId: string; role: Role};
export const AuthorizationContext = {
    ownerIdOf(option: TunnelingOption): string,                       // (option as {ownerId?: string}).ownerId ?? MIGRATED_OWNER_ID
    ownerOf(port: number): OwnerInfo | undefined,                     // system:migrated·미존재 포트·미존재 사용자 → undefined
    targetOf(port: number): Target,                                   // {port, owner: ownerOf(port) && {userId, groupId}} — U2-08 의 라우트가 authorize 에 넘기는 값
    groupAttributes(groupId: string): GroupAttributes,                // 없는 그룹이면 DEFAULT_GROUP_ATTRIBUTES 복사
    portsOfGroup(groupId: string): number[],                          // 소유자의 groupId 가 일치하는 forwardPort 목록(오름차순)
    isSuperuserOwned(port: number): boolean,                          // ownerOf(port)?.role === 'superuser'
    ownedCount(userId: string): number,
    resetForTest(): void                                              // 아래 경고 Set 비움
};
```

`ServerOptionStore.instance.getTunnelingOptions()` 와 `IdentityStore.instance` 를 매 호출마다 읽는 순수 조회. **조회 결과를 캐시하지 않는다.** `ownerId` 가 있는데 `IdentityStore.user(ownerId)` 가 없으면(수동 편집으로 생긴 고아) `undefined` 를 돌려주고 `logger.warn('tunnel <port> owner <id> not found; treating as system:migrated')` 를 남기되, 모듈 수준 `Set<number>` 에 포트를 기억해 포트당 1회만 경고한다(로그 폭주 방지. 이것이 유일한 모듈 상태이며 `resetForTest` 가 비운다).

### 테스트

- `test/unit/server/rbac/AttributeEnforcer.test.ts`
- `test/unit/server/rbac/AuthorizationContext.test.ts`

## 변경할 것

- 없음. 새 파일 두 개와 테스트 두 개만 추가한다. `routes.ts`·`AdminServer.ts`·`TunnelingOption.ts` 는 건드리지 않는다.

## 하지 말 것

- 라우트·핸들러에 연결하지 않는다(U2-08). `TunnelingOption` 타입에 `ownerId` 를 추가하지 않는다(U2-08).
- 속성 3(`max_tunnel_duration_ms`)·6(`max_concurrent_connections`)·11(`rate_limit`) 을 집행하지 않는다(5 단위).
- `enforce` 안에서 저장소를 조회하지 않는다(`context` 로 받는다). `authorize` 에 저장소 조회를 넣지 않는다.
- `AuthorizationContext` 에 조회 결과 캐시를 두지 않는다(경고용 포트 `Set` 만 허용).
- 예외를 제어 흐름으로 쓰지 않는다: `EnforceResult` 반환, 조회 실패는 `undefined`.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트(`bcryptCost 4`. `AuthorizationContext.test.ts` 는 사용자를 `createUser` 로 만들지 않고 `config/identity.yaml` 을 테스트가 직접 써서 id 를 고정한다 — `passwordHash` 는 `bcrypt.hashSync('x', 4)`):

- `test/unit/server/rbac/AttributeEnforcer.test.ts` (주체는 `regular`, 속성은 케이스마다 덮어씀. `tcp` 터널 `{forwardPort:20010, protocol:'tcp', destinationAddress:'127.0.0.1', destinationPort:80, keepAlive:0}` 기준)
  - `allowed_port_range:[{from:20000,to:20099}], allowed_protocols:['TCP'], max_tunnel_count:2`, `ownedCount 1`, `mode 'create'` 이면 성공. `ownedCount 2` 면 409 `tunnel_count_exceeded`. `mode 'update'` 면 `ownedCount 5` 여도 성공.
  - `forwardPort 30000` 이면 `create`·`update` 모두 422 `port_not_allowed`(수정 때도 전체 검사). 범위 두 개 `[{1,10},{20000,20099}]` 에서 20050 은 성공. `allowed_port_range: []`(기본값) 이면 어떤 포트든 422.
  - `protocol:'http'` 에 `allowed_protocols:['TCP']` 면 422 `protocol_not_allowed`; `['HTTP']` 면 성공; `httpOption:{rewriteHostInTextBody:true}` 이면 `['HTTP']` 로는 422 `protocol_not_allowed`, `['HTTP','HTTP_REWRITE']` + `permissions.host false` 면 422 `rewrite_not_allowed`, `host true` 면 성공.
  - `customRequestHeaders:[{name:'X',value:'1',replace:false}]` 는 `header`, `bodyRewriteRules:[{from:'a',to:'b'}]` 는 `body`, `replaceAccessControlAllowOrigin:true` 는 `cors` 플래그를 요구한다(각각 422 `rewrite_not_allowed` / true 면 성공). `keepAliveTimeout:1000` 만 있으면 `HTTP_REWRITE` 가 필요 없다.
  - `allowedClientNames:['old']` 면 422 `legacy_client_names_not_allowed`.
  - `allowedClientIds:['c1']` 에 `allowed_trusted_clients:['c1']`, `context.trustedClientIds:['c1']` 면 성공; `allowed_trusted_clients:[]` 면 422 `trusted_client_not_allowed`; `context.trustedClientIds:[]` 여도 422.
  - `requiredProtocols({protocol:'https', httpOption:{bodyRewriteRules:[…]}})` 는 `['HTTPS','HTTP_REWRITE']` 이다.
  - 슈퍼유저 주체면 어떤 입력이든 `{success:true}` 이다.
- `test/unit/server/rbac/AuthorizationContext.test.ts` (임시 루트. `identity.yaml` 에 슈퍼유저 `u_admin0000000000`(system:superuser)·일반 유저 `u_alice00000000000`(그룹 `g_field00000000000`) 를 직접 쓰고 `server.yaml` 에 터널 4개: 20001 `ownerId` 없음, 20002 `ownerId u_alice…`, 20003 `ownerId u_ghost…`(없는 사용자), 20004 `ownerId u_admin…`)
  - `ownerIdOf` 는 각각 `'system:migrated'`, `'u_alice…'`, `'u_ghost…'`, `'u_admin…'` 이다.
  - `ownerOf(20001)` 은 `undefined`, `ownerOf(20002)` 는 `{userId:'u_alice…', groupId:'g_field…', role:'regular'}`, `ownerOf(20003)` 은 `undefined` 이고 `logger.warn` 이 1회 호출되며 두 번째 `ownerOf(20003)` 호출에서는 더 호출되지 않는다. `resetForTest()` 뒤에는 다시 1회 호출된다. `ownerOf(65000)` 은 `undefined`, 경고 없음.
  - `targetOf(20002)` 는 `{port:20002, owner:{userId:'u_alice…', groupId:'g_field…'}}`, `targetOf(20001)` 은 `{port:20001, owner:undefined}` 다.
  - `portsOfGroup('g_field…')` 는 `[20002]`, `ownedCount('u_alice…')` 는 1, `ownedCount('u_ghost…')` 는 0, `isSuperuserOwned(20004)` 는 true, `isSuperuserOwned(20001)` 은 false 이다.
  - `groupAttributes('g_none')` 는 `DEFAULT_GROUP_ATTRIBUTES` 와 깊은 동등이고 다른 객체(복사본)다.
  - `server.yaml` 에 터널을 하나 추가한 뒤(`ServerOptionStore.updateTunnelingOption`) 다시 `ownedCount` 를 부르면 새 값이 반영된다(캐시 없음).

기존 테스트 전부 통과: `test/component/server/admin/*.test.ts`, `test/unit/server/admin/*.test.ts`, `test/admin/*.test.ts`, `test/unit/server/rbac/*.test.ts`(모듈 추가만이므로 동작 변화 없음).

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/server/rbac
npm run test:browser:install
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 로봇 이모지 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U2-06.
- 후행: U2-08(라우트 연결), U5-05~09(`AuthorizationContext`).

## 근거 문서

- `docs/design/2026-09-11-unit2-rbac-model-api.md` §4.5(AttributeEnforcer 표·`mode`), §5.3(소유권 해석), §6(AuthorizationContext), §8.1(`AttributeEnforcer.test.ts`), §9(U2-07: 라우트 미연결)
- `docs/design/2026-09-11-unit5-connection-security.md` §7(PRD 런타임 속성 집행: `AuthorizationContext` 사용 계약)
- `docs/plan/prd/TTTGate-admin-rbac.md` §7 속성 1·2·4·5·7·8·10, §8.2 3항
- `docs/design/2026-09-11-program-overview.md` §3.5(소유자 `system:migrated`)

---

## U2-08

**title**: feat(admin): 터널 소유권을 저장하고 관리 API 에 소유·가시성·속성 집행 적용
**labels**: enhancement, area:admin, unit:2
**body**:
## 목적

터널이 소유자를 가지고, 일반 유저는 자기 터널만 그룹 속성 범위 안에서 만들고 고치게 한다. 이 이슈가 끝나면 `TunnelingOption.ownerId` 가 저장되고, 터널 목록·읽기·수정·삭제·활성화가 소유·가시성으로 걸러지며, 슈퍼유저가 소유자를 재할당할 수 있고, 소유 터널이 있는 사용자는 삭제되지 않는다. 속성 1·2·4·5·7·8·9·10 이 API 에서 집행된다(3·6·11 은 5 단위 런타임).

## 배경

- `src/types/TunnelingOption.ts:71-84` `TunnelingOption`(U2-07 배경 참조). `ServerOption.trustedClients?: Array<{clientId, clientSecret, displayName?}>`(`:46-62`).
- `src/server/ServerOptionStore.ts:414` `verificationTunnelingOption` 은 알 수 없는 필드를 지우지 않으므로 `ownerId` 는 그대로 YAML 왕복된다. `:82` `composeServerOptionWithTunnelingOption`, `:99` `composeServerOptionWithoutTunnelingOption`, `:229` `getTunnelingOption`.
- U2-04 라우트 표의 `tunnel:*` 항목은 `target` 에 `{port}` 만 넣는다. `authorize(principal, action, {port, owner?})` 는 `owner` 로 판정한다(U2-04 규칙 표). `AuthorizationContext.targetOf/ownedCount`, `enforce`(U2-07).
- `AdminServer.onUpdateTunnelingOption`(U2-03 뒤 `ctx.body` 사용): 본문에서 `certInfo`, `expectedCertificateRevision`, `previousForwardPort` 를 떼고 나머지를 `tunnelingOption` 으로 쓴다(`:606-607`). `previousForwardPort` 가 있으면 포트 변경(rename) 경로 `applyCompoundTunnelingOption`(`:686`).
- `onGetTunnelingOption`(`:1192`) 은 `store.serverOption.tunnelingOptions` 를 그대로 싣는다. `onGetExternalServerStatuses`(`:1206`) 는 `tttServer.externalServerStatuses()` 전부.
- `/api/tunnelingOption` 응답에 `owner`·`editable` 이 더해지고 저장된 터널 옵션에 `ownerId` 가 생기므로, 항목 객체를 깊은 동등으로 단언하는 기존 테스트가 있으면 깨진다. `grep -rn "tunnelingOptions\|getTunnelingOption" test --include=*.ts | grep -E "toEqual|toStrictEqual|toMatchObject"` 를 실행한 결과 후보는 아래 7곳이고, **기대값을 고쳐야 하는 곳은 0곳**이다.
  - `test/admin/configuration-editor.test.ts:82` — `final.tunnelingOptions.map(o => o.forwardPort)` 에 `toEqual`. 단일 필드만 뽑으므로 통과.
  - `test/component/invalid-config.test.ts:42` — `toEqual([])`(빈 목록). 통과.
  - `test/component/multi-client-harness.test.ts:36` — `map(o => o.allowedClientIds)` 에 `toEqual`. 통과.
  - `test/admin/compound-stale-rename.test.ts:45`, `test/admin/server-buffer-minimum.test.ts:27`, `test/component/server/admin/AdminServer.apply.test.ts:111`, `test/component/server/admin/normalized-tunnel-apply.test.ts:64` — 모두 `store.getTunnelingOption(port)` 에 `toMatchObject`(부분 일치)이거나 단일 필드 비교. `ownerId` 가 더 붙어도 통과.
  - 따라서 이 이슈에서 기존 테스트의 **기대값을 바꾸지 않는다**. 구현 중 새로 깨지는 단언이 나오면 위 grep 을 다시 돌려 해당 줄을 이슈 코멘트에 적고 기대값에 필드를 더한다(느슨하게 바꾸지 않는다).
- U2-06 `DELETE /api/users/:id`, `rbacRoutes.ts`.

먼저 열어 볼 파일: `src/types/TunnelingOption.ts`, `src/server/admin/routes.ts`, `src/server/admin/AdminServer.ts`(터널 핸들러 5개), `src/server/admin/rbacRoutes.ts`, `src/server/rbac/AuthorizationContext.ts`, `src/server/rbac/AttributeEnforcer.ts`, `test/component/server/admin/normalized-tunnel-apply.test.ts`(터널 본문 형태).

## 적용되는 결정

- D1 PRD 범위: §7 속성 1·2·4·5·7·8·9·10, §8.2 3항(터널 소유권 백필 `system:migrated`, 자동 재할당 금지), Q7(재할당은 슈퍼유저만, 감사 기록), NFR-COMPAT-YAML-001(기존 yaml 은 그대로 읽힘).
- 단위 2 §5.2: 목록 필터 `authorize(principal,'tunnel:read',{port})`, `editable = authorize(principal,'tunnel:update',{port}).allowed`(둘 다 `targetOf(port)` 를 넘긴다). §5.3: `ownerId` 없으면 `system:migrated` 로 읽고, 새로 저장할 때만 필드를 쓴다.

## 만들 것

### `src/types/TunnelingOption.ts`

`TunnelingOption` 에 `ownerId?: string` 추가(주석: 사용자 id 또는 `'system:migrated'`; 없으면 `system:migrated` 로 해석). `AuthorizationContext.ownerIdOf` 의 캐스트를 지운다. 다른 변경 없음.

### 라우트 표 변경 (U2-04 표의 `tunnel:*` 항목)

- 모든 `tunnel:*` 라우트의 `target` 을 `AuthorizationContext.targetOf(port)` 로. 포트는 `ctx.params.port` 또는 본문 `forwardPort`.
- `GET /api/tunnelingOption`(tunnel:list): 슈퍼유저는 전부. 일반 유저는 `authorize(p,'tunnel:read', targetOf(port)).allowed` 인 항목만. 각 항목에 `owner: {id, username} | {id:'system:migrated'}` 와 `editable = authorize(p,'tunnel:update', targetOf(port)).allowed` 를 덧붙인다(슈퍼유저는 항상 `editable true`). 기존 필드(`keepAlive` 기본값 채움 포함)는 그대로. `ownerId` 필드도 응답에 남긴다.
- `GET /api/externalServerStatuses`(tunnel:list): 같은 필터로 `statuses` 를 거른다(`status.port` 기준).
- `POST/PUT /api/tunnelingOption`: action 함수형(기존 포트면 `tunnel:update`, 아니면 `tunnel:create`) 은 U2-04 그대로. 핸들러 앞에:
  - 슈퍼유저: 본문 `ownerId` 가 있으면 사용자 id 또는 `'system:migrated'` 여야 하고(아니면 422 `owner_not_found`), 없으면 생성 시 `principal.userId`, 수정 시 기존 값 유지. `principal.legacy` 면 `ownerId` 는 항상 `'system:migrated'`(`legacy-admin` 은 사용자 id 가 아니다).
  - 일반 유저: 본문 `ownerId` 는 무시하고 `principal.userId` 로 고정. `previousForwardPort`(rename) 가 있으면 그 포트도 `tunnel:update` 로 `authorize`(실패 시 404). `enforce(principal, option, previousOption ? 'update' : 'create', {ownedCount: ownedCount(userId), trustedClientIds: serverOption.trustedClients.map(c => c.clientId)})` 실패면 그 status·code. `certInfo` 가 있으면(외부 인증서 업로드) 403 `forbidden`(인증서는 `tunnel:cert`, 슈퍼유저 전용).
  - `ctx.auditDetail({ownerId})`.
- `DELETE /api/tunnelingOption`, `POST /api/tunneling/active/:port`: `target` 만 붙이면 `authorize` 가 404/403 을 낸다. 핸들러 변경 없음.
- `PUT ^/api/tunnelingOption/(?<port>[^/]*)/owner$`(신규, tunnel:reassign, audit `tunnel_reassigned` / tunnel, 핸들러가 `ctx.auditDetail({from, to})`): 요청 `{"ownerId":"u_…","expectedRevision":7}` 또는 `{"ownerId":"system:migrated","expectedRevision":7}` → 존재하지 않는 포트 404 `not_found`, 사용자 없음 422 `owner_not_found` → `composeServerOptionWithTunnelingOption({...option, ownerId})` 후 기존 `mutateConfiguration` 커밋 경로(`expectedRevision` 필수) → 200 `{"forwardPort":20001,"owner":{"id":"u_…","username":"alice"},"revisionState":{…}}`.
- `DELETE /api/users/:id`(U2-06, `rbacRoutes.ts`): `AuthorizationContext.ownedCount(id) > 0` 이면 409 `user_owns_tunnels`(`message` 에 포트 목록).

### 테스트

- `test/component/server/admin/rbac-tunnel-ownership.test.ts`(신규)

## 변경할 것

- `src/types/TunnelingOption.ts`: `ownerId?`.
- `src/server/admin/routes.ts`, `AdminServer.ts`(터널 핸들러), `rbacRoutes.ts`(사용자 삭제 가드): 위 전부.
- `src/server/rbac/AuthorizationContext.ts`: 캐스트 제거.
- `src/server/ServerOptionStore.ts`: 변경 없음(`ownerId` 통과 확인됨). 만약 `normalizationOfHttpOption` 등이 객체를 재구성해 `ownerId` 가 떨어지면 그 함수만 `ownerId` 를 보존하도록 고친다.
- `test/component/server/admin/routes.test.ts`: `PUT /api/tunnelingOption/:port/owner` 행 추가.
- 기존 테스트: 기대값 변경 없음(위 배경의 grep 결과 7곳 전부 부분 일치·단일 필드 비교라 `owner`·`editable`·`ownerId` 추가에 영향받지 않는다).

## 하지 말 것

- `server.yaml` 을 기동 시 다시 써서 `ownerId: system:migrated` 를 백필하지 않는다(읽기 호환. 파일은 사용자가 저장할 때만 바뀐다).
- 일반 유저가 들어왔다고 `system:migrated` 터널을 자동 재할당하지 않는다.
- 속성 3·6·11 을 집행하지 않는다(5 단위).
- `allowed_port_range` 를 슈퍼유저에게 적용하지 않는다.
- 존재하지 않는 터널과 남의 터널을 응답으로 구분하지 않는다(둘 다 404).
- 기존 테스트의 단언을 느슨하게(`toMatchObject` 로) 바꾸지 않는다. 기대값에 필드를 더한다.
- 예외를 제어 흐름으로 쓰지 않는다: `EnforceResult`·`Decision` 반환.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트. **bcrypt 주의**: `bcryptCost 4`. `beforeAll` 에서 사용자 3명(같은 그룹 `alice`·`bob`, 다른 그룹 `carol`)만 만들고 각자 임시 비밀번호로 로그인해 `/api/me/password` 로 바꾼 세션을 파일 전체가 공유한다. `jest.setTimeout(60_000)`.

- `test/component/server/admin/rbac-tunnel-ownership.test.ts` (그룹 `G1`: `allowed_port_range [{20000,20099}]`, `allowed_protocols ['TCP','HTTP']`, `max_tunnel_count 2`, `tunnel_visibility 'group_read'`; 그룹 `G2`: 같은 범위, `private`. alice·bob ∈ G1, carol ∈ G2. 서버 yaml 에 `system:migrated` 터널 20001 이 미리 있음. 스텁 `TTTServer` 는 `normalized-tunnel-apply.test.ts` 방식)
  - alice `POST /api/tunnelingOption {forwardPort:20010, protocol:'tcp', …, expectedRevision}` 이면 200 이고 `server.yaml` 의 그 항목에 `ownerId: <alice id>` 가 있다. 본문에 `ownerId:'u_someone'` 을 넣어도 저장은 alice 다.
  - alice `{forwardPort:30000}` 이면 422 `port_not_allowed`; `{protocol:'https'}` 면 422 `protocol_not_allowed`; 두 번째 터널 20011 은 200, 세 번째 20012 는 409 `tunnel_count_exceeded`.
  - 슈퍼유저가 `PUT /api/groups/G1 {attributes:{allowed_port_range:[{from:20011,to:20099}]}}` 로 범위를 좁힌 뒤 alice 가 20010 을 수정하면 422 `port_not_allowed`(수정 때도 전체 검사), 범위를 되돌리면 200.
  - alice `POST` 에 `certInfo` 를 넣으면 403 `forbidden`.
  - `GET /api/tunnelingOption`: alice 는 20010·20011 만(20001 없음), 각 `owner.id` 가 alice, `editable true`. bob(같은 그룹, group_read) 은 alice 의 두 개가 보이고 `editable false`. carol 은 빈 배열. 슈퍼유저는 세 개 전부 + 20001 의 `owner {id:'system:migrated'}`, 모두 `editable true`.
  - `GET /api/externalServerStatuses`: carol 은 `statuses` 빈 배열, bob 은 alice 포트 2개.
  - bob `POST /api/tunnelingOption {forwardPort:20010,…}` 이면 403 `read_only`; bob `DELETE {forwardPort:20010}` 403 `read_only`; bob `POST /api/tunneling/active/20010` 403.
  - carol `POST {forwardPort:20010,…}` 이면 404; carol `DELETE {forwardPort:20010}` 404; carol `POST /api/tunneling/active/20010` 404; carol `POST /api/tunneling/active/65000`(미존재) 404 — 네 응답의 본문이 동일하다.
  - alice `DELETE {forwardPort:20001}`(migrated) 이면 404. 슈퍼유저 `DELETE` 는 200.
  - alice 가 `previousForwardPort:20010, forwardPort:20020` 으로 rename 하면 200 이고 20020 의 `ownerId` 가 alice; carol 이 `previousForwardPort:20011` 로 시도하면 404.
  - 슈퍼유저 `PUT /api/tunnelingOption/20011/owner {ownerId:<carol>, expectedRevision}` 이면 200 `owner.username 'carol'`, 이후 alice 목록에서 20011 이 사라지고 carol 목록에 나타난다. `{ownerId:'u_none'}` 이면 422 `owner_not_found`; 없는 포트면 404; alice 가 호출하면 403 `forbidden`; 감사에 `tunnel_reassigned`(`detail.from` alice id, `detail.to` carol id).
  - 슈퍼유저가 `ownerId` 없이 새 터널 20030 을 만들면 `ownerId` 가 슈퍼유저 id 다. legacy-fallback 서버에서 legacy-admin 이 만들면 `ownerId 'system:migrated'` 다.
  - 슈퍼유저 `DELETE /api/users/<carol>` 이면 409 `user_owns_tunnels` 이고 message 에 `20011` 이 있다. 20011 을 `system:migrated` 로 재할당한 뒤에는 200.
  - `PUT /api/groups/G1 {attributes:{tunnel_crud:'read_only'}}` 뒤 alice `POST {forwardPort:20020,…}` 은 403 `read_only`, `GET` 은 여전히 200 이고 `editable false`. `tunnel_crud:'none'` 이면 `GET /api/tunnelingOption` 이 403 `tunnel_access_disabled`.
- `test/component/server/admin/audit-sink.test.ts` 의 CUD 전수 케이스가 `PUT /api/tunnelingOption/:port/owner` 를 포함해 통과한다.
- `test/component/server/admin/routes.test.ts` 기대 목록 갱신 후 통과.

기존 테스트 전부 통과: `test/component/server/admin/*.test.ts`(특히 `normalized-tunnel-apply`, `compound-*`, `configuration-*` — 슈퍼유저 경로는 응답에 `owner`·`editable`·`ownerId` 필드가 추가되는 것 외에 같아야 한다), `test/admin/*.test.ts`(`configuration-editor`, `configuration-snapshot` 등 터널 응답을 보는 파일), `test/unit/server/ServerOptionStore*.test.ts`, `test/unit/server/admin/*.test.ts`, `test/unit/server/rbac/*.test.ts`.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npx jest --runInBand test/unit/server/rbac test/unit/server/ServerOptionStore.test.ts test/component/server/admin
npm run test:admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 로봇 이모지 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U2-07.
- 후행: U2-09(E2E 에서 `system:migrated` 소유자 확인), U3-03(터널 화면의 owner·editable), U5-05~09.

## 근거 문서

- `docs/design/2026-09-11-unit2-rbac-model-api.md` §4.4(tunnel 규칙), §4.5(`enforce` 연결), §5.2(터널 행 6개, 필터·editable), §5.3(소유권), §8.2(`rbac-tunnel-ownership.test.ts`), §9(U2-08)
- `docs/plan/prd/TTTGate-admin-rbac.md` §7 속성 1·2·4·5·7·8·10, §8.2 3항, §12 Q7, §6.2, Appendix A(Tunnels 행)
- `docs/design/2026-09-11-program-overview.md` §3.5(소유자 `system:migrated`)

---

## U2-09

**title**: test(admin): 레거시 admin 승격 E2E 와 롤백 백업·마이그레이션 문서 추가
**labels**: test, area:admin, area:test-ci, unit:2
**body**:
## 목적

업그레이드 경로(기존 `.key` 만 있는 서버가 새 바이너리로 기동해 `admin` 이 그대로 로그인되는 것)와 롤백 경로(`server.yaml.bak`·`.server.state.json.bak` 이 첫 신필드 저장 때 생기는 것)를 실제 프로세스와 브라우저로 고정한다. 이 이슈가 끝나면 프로세스 하네스가 `identityFixture` 로 사용자·그룹을 미리 심을 수 있고, `docs/guide/MIGRATION.md` 가 운영자의 승격·롤백·다운타임 리허설 절차를 담는다(PRD K1·K2).

## 배경

- `src/server/ServerOptionStore.ts`
  - `:122` `prepareServerOptionCommit(serverOption, options)` 가 `prepared.files: AtomicFileValue[]`(`server.yaml` + `.server.state.json`) 를 만들고 `:110` `commitPreparedServerOption` 이 `Files.writeAtomicBatchSync(result.prepared.files)`(`:117`) 로 쓴다. 관리 API 의 저장은 모두 이 경로다.
  - `:274` `save()` 는 `Files.writeAtomicSync(this._configFile, yamlString)` + `fs.chmodSync` + `saveRevisionState()`(`:517`) 인 별도 경로지만, **`src/` 안에서 이것을 부르는 코드는 없다**(`grep -rn "\.save()" src` 0건). `updateServerOption`(`:192`)·`updateTunnelingOption`(`:211`)·`removeTunnelingOption`(`:203`) 은 모두 `commitPreparedServerOption` 을 거치고, `ServerApp.applyStartupOptions`(`ServerApp.ts:37-63`, CLI `-adminPort` 등)도 `updateServerOption` 을 부르므로 같은 경로다. `save()` 의 유일한 호출자는 `test/unit/server/invalid-config-admission.test.ts:48`(`expect(store.save()).toBe(false)` — 로드 실패 상태에서 저장이 거부되는지만 본다) 이다. 설계 §9 가 적은 대로 **저장 경로의 삽입점은 `prepareServerOptionCommit` 하나**다.
  - `:339-360` `verificationServerOption` 은 키 허용 목록이 없어 알 수 없는 필드를 그대로 통과·보존한다(설계 §3.1 확정). 이전 바이너리(`5f772fc`)도 같은 함수이므로 `ownerId` 등 새 필드가 든 `server.yaml` 을 읽는다. `.bak` 은 그래도 남긴다(수기 편집 손실 방지). `5f772fc` 빌드로 새 yaml 을 읽는 확인은 수동 절차.
- `src/util/Files.ts:19` `writeAtomicBatchSync(changes)` 는 실패 시 이전 내용을 되돌린다(`:38-53`).
- 프로세스 하네스 `test/helpers/processTunnelHarness.ts`(U0-01, 단위 0 §3.2): `ProcessTunnelOptions.identityFixture?: unknown` — "사용자 항목은 평문 `password` 필드를 받고 하네스가 bcrypt cost 12 로 `passwordHash` 를 채운다(같은 평문은 모듈 수준 캐시로 한 번만 해시). 지정하면 `.key` 는 쓰지 않는다"; `adminLogin?: {username; password}` — `adminRequest` 가 로그인할 계정, 기본 `{username:'admin', password:'e2e-password-1234'}`. 하네스는 `.key` 에 그 비밀번호의 bcrypt 해시를 두고 `adminRequest` 가 `/api/login` 으로 세션을 얻는다(이 이슈 시점에는 별칭 `{key}` 로 보낼 수 있다. U2-10 가 `{username, password}` 로 바꾼다). 브라우저 E2E 는 `test/e2e/browser/*.test.ts`, 실행 `npm run test:e2e:browser`(빌드 선행), CI 잡 `browser-e2e`(U0-06).
- `test/helpers/adminBrowser.ts:5` `startAdminBrowser({apiOrigin})`. 하네스가 띄운 실제 서버의 `https://127.0.0.1:<adminPort>` 를 `apiOrigin` 으로 준다.
- `docs/guide/` 에는 `certificate-filenames.md`, `compound-tls-save.md`, `test-evidence-policy.md` 만 있다. `MIGRATION.md` 는 없다.
- 로그인 UI 는 U2-10(UI 레인, U1-10 이후) 가 username 필드를 붙인다. 이 이슈의 브라우저 시나리오는 U2-10 없이도 성립해야 하므로 `#login-username` 이 있으면 채우고 없으면 비밀번호만 넣는다(U2-02 의 `'admin'` 별칭). U2-10 가 조건 분기를 지운다.

먼저 열어 볼 파일: `src/server/ServerOptionStore.ts`(`:110-150`, `:274-283`), `src/util/Files.ts`, `test/helpers/processTunnelHarness.ts`, `test/e2e/browser/tcp-page.test.ts`(U0-01 의 브라우저 E2E 예), `docs/guide/test-evidence-policy.md`, `src/server/rbac/IdentityTypes.ts`.

## 적용되는 결정

- D13 E2E 는 자체 프로세스 하네스. D1 PRD §8.2(제로다운 전략)·§8.3(롤백 계획: `.bak` 을 같은 트랜잭션에, 자동 삭제 금지, 14일 보존), NFR-COMPAT-YAML-001, K1(다운타임 0초 — 수동 리허설 절차로 대신, 개요 §4 완료 기준), K2(레거시 admin 로그인 100%).
- 단위 2 §3.1 롤백 계약 전문(이전 바이너리가 새 필드를 읽는다는 확정 포함).

## 만들 것

### `ServerOptionStore` 롤백 백업

```ts
const ROLLBACK_SENSITIVE_TOP_FIELDS = ['connectionSecurity', 'mfaRequiredForSuperusers', 'auditRetentionDays', 'auditQueueSize'] as const;   // 최상위
const ROLLBACK_SENSITIVE_TUNNEL_FIELDS = ['ownerId', 'rateLimit'] as const;   // tunnelingOptions[*] 의 필드(단위 5 §3.2 의 rateLimit 은 터널별)
private rollbackBackupFiles(next: ServerOption): AtomicFileValue[];
```

판정: 디스크의 `server.yaml` 텍스트를 `YAML.parse` 해서 **최상위 4개 키(`connectionSecurity`·`mfaRequiredForSuperusers`·`auditRetentionDays`·`auditQueueSize`)가 하나도 없고 `tunnelingOptions[*]` 어디에도 `ownerId`·`rateLimit` 이 없으며**, `next` 에는 그 6개 중 하나라도 있으면 → `[{file: server.yaml.bak, data: 디스크 원문 그대로, mode: 0o600}, {file: .server.state.json.bak, data: 디스크 원문, mode: 0o600}]`. 즉 판정에 쓰는 키 집합은 `ROLLBACK_SENSITIVE_TOP_FIELDS`(4개) ∪ `ROLLBACK_SENSITIVE_TUNNEL_FIELDS`(2개) 이고, 두 상수 모두 판정식에 쓰인다. 이미 `server.yaml.bak` 이 있으면 빈 배열(덮어쓰지 않는다). `.server.state.json` 이 없으면 그 항목은 뺀다. 디스크 파일이 없거나 파싱이 안 되면 빈 배열.

- 삽입점은 `prepareServerOptionCommit` 하나다: `files` 앞에 `rollbackBackupFiles(serverOption)` 결과를 붙인다(같은 배치). 관리 API 저장과 `ServerApp.applyStartupOptions` 가 모두 이 경로를 거치므로 이 한 곳으로 충분하다.
- `save()`(`:274`) 는 바꾸지 않는다. `src/` 안에 호출자가 없고(배경 참조) 설계 §9 도 삽입점을 `prepareServerOptionCommit` 하나로 정했다. 호출자 없는 경로를 함께 고치면 같은 책임이 두 곳으로 갈라진다.
- 서버는 `.bak` 과 `.key` 를 어떤 경로에서도 지우지 않는다. `ServerOptionStore.reset()`(`:285`) 은 `server.yaml`·`.server.state.json` 만 지우는 현재 동작을 유지한다(`.bak` 은 남긴다).

### `test/helpers/identityFixture.ts`

```ts
export type IdentityFixture = {
    users: Array<{username: string; password: string; role: Role; groupId?: string; displayName?: string; mustChangePassword?: boolean}>;
    groups?: Array<{id: string; name: string; attributes?: Partial<GroupAttributes>}>;   // 시스템 그룹 2개는 자동
};
export async function serializeIdentityFixture(fixture: IdentityFixture): Promise<string>;   // identity.yaml 텍스트. bcrypt cost 12, 같은 평문은 모듈 수준 Map 캐시로 한 번만 해시
export const E2E_ADMIN_PASSWORD = 'e2e-password-1234';
```

`IdentityTypes` 의 `createSystemGroups`, `validateGroupAttributes`, `validateUsername`, `newUserId` 를 쓴다(실패는 `throw` — 픽스처 오류는 테스트 작성 오류이므로 예외가 맞다). 하네스는 `identityFixture` 가 있으면 `config/identity.yaml` 에 이 문자열을 쓰고 `.key` 를 쓰지 않는다; `adminRequest` 의 로그인 계정은 `adminLogin`(기본 `admin` / `e2e-password-1234`, `identityFixture` 를 쓰면 그 안에 이 슈퍼유저가 있어야 하며 없으면 하네스가 즉시 실패). `ProcessTunnelOptions.identityFixture` 타입을 `unknown` 에서 `IdentityFixture` 로 좁힌다.

### `test/e2e/browser/legacy-admin-migration.test.ts`

하네스 옵션: 터널 1개(tcp, 대상 서비스), `identityFixture` 없음(`.key` 경로), `startClient: false`.

1. 기동 뒤 `rootDir/config/identity.yaml` 이 존재하고 YAML 에 `username: admin`, `migratedFromLegacyAdmin: true` 가 있다. `.key` 가 존재하고 내용이 기동 전과 같다. `.bootstrap-token` 없음.
2. `startAdminBrowser({apiOrigin})` → 로그인 화면에서 `#login-username` 이 있으면 `admin` 입력, `#login-password` 에 `e2e-password-1234` → "OK" → 로그인 성공(`/api/validateSession` 200).
3. `adminRequest('/api/tunnelingOption')` 의 항목 `owner.id === 'system:migrated'`.
4. `adminRequest('/api/me')` 의 `migrationBanner === true`.
5. `identity.yaml` 의 mtime 을 기록 → `harness.restartServer()` → mtime 동일, `.key` 존재, 같은 비밀번호로 `adminRequest` 재로그인 200.
6. 서버 stdout 에 `identity migrated from legacy admin key` 가 첫 기동에 1회, 재기동에 0회. 읽는 수단은 `harness.server.readChannel().stdout` 이며, `restartServer()` 가 새 자식 프로세스를 띄워 `harness.server` 를 교체하므로 **5 의 `restartServer()` 를 부르기 전에** 첫 기동 stdout 을 지역 변수에 담아 1회를 단언하고, 재기동 뒤에는 교체된 `harness.server.readChannel().stdout` 에서 0회를 단언한다.

### `test/e2e/browser/regular-user-login.test.ts`

`identityFixture: {users: [{username:'admin', password:'e2e-password-1234', role:'superuser'}, {username:'alice', password:'alice-pass-1234', role:'regular', groupId:'g_field'}], groups: [{id:'g_field', name:'Field', attributes:{allowed_port_range:[{from:20000,to:20099}], allowed_protocols:['TCP']}}]}`.

1. `.key` 가 없다. `identity.yaml` 이 픽스처 내용이다(`alice` 의 `passwordHash` 가 bcrypt).
2. 하네스에 `adminRequestAs(login: {username: string; password: string})` 를 추가하고(계정별로 세션·CSRF 쿠키를 따로 들고 있는 요청 함수를 돌려준다. 같은 `login` 으로 다시 부르면 같은 함수를 돌려준다), `adminRequestAs({username:'alice', password:'alice-pass-1234'})` 로 `/api/me` 를 호출하면 `user.username` 이 `'alice'` 이고 `sections` 에 `server` 가 없다. 서버 프로세스를 하나 더 띄우지 않는다.
3. alice 의 `/api/tunnelingOption` 은 빈 배열(하네스 터널은 `system:migrated`), admin 의 목록은 1개.
4. 브라우저: `#login-username` 이 있으면 `alice` 로 로그인 성공까지 확인하고, 없으면(U2-10 전) 이 단계는 건너뛴다(U2-10 가 항상 수행하도록 바꾼다).

### `test/unit/server/rollback-backup.test.ts`

임시 루트에 이전 형식 `server.yaml`(신필드 없음) + `.server.state.json`.

### `docs/guide/MIGRATION.md`

절 구성(`## ` 제목 7개, 순서 고정):
1. 대상 독자와 요약(기존 단일 admin → 슈퍼유저 `admin`, 비밀번호 동일)
2. 업그레이드 절차(바이너리 교체 → 기동 → 로그 `identity migrated from legacy admin key` 확인 → 로그인 → 배너)
3. 생성·보존되는 파일 표: `config/identity.yaml`(0o600), `config/.key`(보존, 삭제 금지), `config/.bootstrap-token`(신규 설치만), `config/server.yaml.bak`·`config/.server.state.json.bak`(첫 신필드 저장 때 1회, 자동 삭제 없음, 최소 14일 보존 권고)
4. 롤백 절차(서버 정지 → `.bak` 2개를 원본 이름으로 복사 → 이전 바이너리 기동 → `.key` 로 로그인). 이전 바이너리 `5f772fc` 는 새 필드(`ownerId` 등)가 남아 있어도 `server.yaml` 을 읽으므로(`verificationServerOption` 에 허용 목록이 없음) `.bak` 복원은 새 필드와 그 뒤의 변경을 되돌리려는 경우의 절차라는 문장. 이 사실의 확인은 `5f772fc` 빌드로 새 yaml 을 기동해 보는 수동 절차로 두고 그 명령을 적는다. 부트스트랩으로 만든 슈퍼유저(`.key` 없음)는 이전 바이너리에서 사라지고 부트스트랩 토큰 흐름이 다시 시작된다는 경고. `identity.yaml` 은 그대로 두어도 무해
5. legacy-fallback 증상(로그 `identity.yaml unreadable`, `/api/users` 503 `identity_store_unavailable`, `/api/me` 의 `user.id 'legacy-admin'`)과 복구(파일 수정 또는 삭제 후 재기동 → 재승격)
6. K1 다운타임 리허설: 준비 서버에서 `while true; do curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:<adminPort>/api/version; sleep 1; done` 을 돌리며 바이너리 교체·재기동을 수행하고 200 이 아닌 줄의 개수를 기록한다. 목표 0(프로세스 재기동 자체의 공백은 서비스 매니저의 소켓 인계 여부에 따르며, 그 값을 기록한다)
7. 자주 묻는 질문(비밀번호를 잊었을 때: `identity.yaml` 삭제 → `.key` 로 재승격; `.key` 도 없으면 부트스트랩 토큰)

## 변경할 것

- `src/server/ServerOptionStore.ts`: `rollbackBackupFiles` 신규, `prepareServerOptionCommit` 에 삽입. `save()` 는 건드리지 않는다.
- `test/helpers/processTunnelHarness.ts`: `identityFixture` 직렬화·`.key` 생략·`adminLogin`·`adminRequestAs`.
- `docs/guide/test-evidence-policy.md`: E2E 목록에 두 파일 추가(한 줄씩).

## 하지 말 것

- `.bak` 자동 삭제·회전을 만들지 않는다.
- `identity.yaml.bak` 을 만들지 않는다(스키마 version 이 1 이라 상향이 없다).
- 롤백을 서버 코드로 자동화하지 않는다(문서 절차).
- `ServerOptionStore.save()` 에 백업을 붙이지 않는다. 삽입점은 `prepareServerOptionCommit` 하나다.
- 하네스에 고정 포트·고정 경로를 넣지 않는다.
- E2E 에서 외부 사이트를 열지 않는다(D13).
- 하네스의 `adminRequest` 로그인 본문을 이 이슈에서 바꾸지 않는다(U2-10).
- 예외를 제어 흐름으로 쓰지 않는다: `rollbackBackupFiles` 는 파싱 실패를 빈 배열로 돌려준다(YAML 파싱은 `try/catch` 로 감싸되 그것이 유일한 예외 경계다).

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/unit/server/rollback-backup.test.ts`
  - 이전 형식 yaml 에서 `commitPreparedServerOption({...option, tunnelingOptions:[{...t, ownerId:'u_1'}]})` 이면 `server.yaml.bak` 이 원문과 바이트 동일, `.server.state.json.bak` 이 원문과 동일, mode 0o600(win32 제외) 이다.
  - 같은 저장을 한 번 더(다른 `ownerId`) 하면 `.bak` 내용이 바뀌지 않는다.
  - `.bak` 이 없는 상태에서 신필드 없는 옵션을 저장하면 `.bak` 이 생기지 않는다.
  - `.bak` 이 없는 상태에서 `updateTunnelingOption({...t, ownerId:'u_1'})`(→ `commitPreparedServerOption`) 도 `.bak` 2개를 만든다. `updateServerOption({...option, auditQueueSize: 1000})`(최상위 신필드) 도 마찬가지다.
  - `rollbackBackupFiles` 가 `ROLLBACK_SENSITIVE_TUNNEL_FIELDS` 의 두 필드를 모두 본다: 이전 형식 yaml 에서 `tunnelingOptions[0].rateLimit` 만 든 옵션을 저장해도 `.bak` 2개가 생긴다.
  - `save()` 는 이 이슈에서 바뀌지 않는다: `test/unit/server/invalid-config-admission.test.ts:48` 의 `expect(store.save()).toBe(false)` 가 그대로 통과한다.
  - `reset()` 뒤에도 `.bak` 2개가 남아 있다.
  - `server.yaml` 을 `verificationServerOption` 에 `ownerId`·`rateLimit` 이 든 채로 넘기면 `success true` 이고 두 필드가 보존된다(이전 바이너리 호환의 근거).
- `test/e2e/browser/legacy-admin-migration.test.ts`: 위 1~6 각각 단언. `errors` 빈 배열.
- `test/e2e/browser/regular-user-login.test.ts`: 위 1~4.
- `test/e2e/target/targetService.test.ts`·`test/e2e/browser/tcp-page.test.ts`(U0-01) 가 그대로 통과한다(`identityFixture` 없는 경로 무변경).
- 문서: `grep -c '^## ' docs/guide/MIGRATION.md` 가 7 이다.

기존 테스트 전부 통과: `test/unit/server/ServerOptionStore*.test.ts`, `test/component/server/admin/*.test.ts`(`configuration-*`, `rollback-*` 는 `.bak` 생성으로 디렉터리 목록 단언이 있으면 기대값에 추가), `test/unit/server/admin/*.test.ts`, `test/admin/*.test.ts`, `test/e2e/**`.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npx jest --runInBand test/unit/server/rollback-backup.test.ts test/unit/server/ServerOptionStore.test.ts test/component/server/admin
npm run test:e2e:browser
npm test -- --runInBand
grep -c '^## ' docs/guide/MIGRATION.md   # 7
git log -1 --format=%B   # Co-Authored-By, Generated, 로봇 이모지 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U2-08, U0-01(프로세스 하네스), U0-06(`npm run test:e2e:browser` 스크립트와 `browser-e2e` 잡).
- 후행: U5-07·U5-08(`identityFixture` 로 일반 유저 시나리오), U2-10(브라우저 케이스의 `#login-username` 조건 분기 제거, `adminRequest` 본문 변경).

## 근거 문서

- `docs/design/2026-09-11-unit2-rbac-model-api.md` §3(파일 쓰기·`.bak`), §3.1(롤백 계약, 이전 바이너리 호환 확정), §4.2(승격 표), §8.3(E2E), §9(U2-09)
- `docs/design/2026-09-11-unit0-verification-foundation.md` §3.2(`identityFixture`·`adminLogin`·`adminRequest`, 준비 판정), §3.4(브라우저 E2E)
- `docs/plan/prd/TTTGate-admin-rbac.md` §3.3 K1·K2, §5.2.4 NFR-COMPAT-YAML-001, §8.2, §8.3, §9.1 R-T1, §9.2
- `docs/design/2026-09-11-program-overview.md` §1 D13, §4 완료 기준

---

## U2-10

**title**: feat(admin): 로그인 화면 username 입력, 세션 스토어, Sign out 추가
**labels**: enhancement, area:admin, area:frontend, unit:2
**body**:
## 목적

관리자 UI 가 다사용자 로그인을 하게 한다. 이 이슈가 끝나면 로그인 화면에 "Username" 필드가 있고, 로그인 뒤 `/api/me` 결과가 `me` 스토어에 실리며, 드로어에 "Sign out" 이 있고, NAV 는 `me.sections` 로 걸러지며, `mustChangePassword` 사용자는 임시 안내만 본다(3 단위가 화면으로 대체). 서버의 `/api/login` 호환 별칭(`key`, 기본 `'admin'`)은 여기서 제거하고, 별칭으로 로그인하던 모든 호출부(UI 컨트롤러·프로세스 하네스·테스트)를 `{username, password}` 로 바꾼다. 이 이슈는 **UI 레인**이다(단위 1 완료 후).

## 배경

- `admin/src/controller/LoginCtrl.ts:26` `static async login(key: string, bootstrapToken?: string): Promise<LoginResult>` 가 `POST /api/login` 에 `{key, bootstrapToken}` 을 보낸다. `:16` `validateSession(): Promise<boolean>`. `LoginResult = {success, status, bootstrapRequired?, invalidBootstrapToken?, weakPassword?, message?}`.
- U1-05·U1-10 뒤의 구조(단위 1 설계 §5.2, §5.5, §7.1): `admin/src/screens/LoginScreen.svelte`(단독 `Card`, "Sign in", `Field label="Password"` + `TextInput type="password" id="login-password"`, 부트스트랩 시 `id="bootstrap-token"`, `<p id="login-message" role="alert">`, `Button variant="primary"` "OK", 성공 시 `onsuccess`), `admin/src/App.svelte`(세션 상태 4종 `type SessionState = 'Checking' | 'Valid' | 'Invalid' | 'Offline'` — U1-04 계약. `'Offline'` 은 `validateSession()` 이 네트워크 오류로 실패한 경우다. `LoginCtrl.validateSession()`), `admin/src/shell/Drawer.svelte`(`nav.ts` 의 `NAV: Array<{hash; title; screen}>` 순회, "로그아웃 항목 없음(2 단위가 추가)"), `admin/src/shell/Shell.svelte`, `test/helpers/adminApp.ts` `startAdminApp({fixture})`(드라이버 포크 + 로그인), `test/admin/admin-backend-driver.ts`(`.key` 에 `test-password-1234` 해시; 드라이버는 `src/` 를 직접 import 하는 프로세스). `layout/`·`component/` 는 U1-10 이 지웠다.
- 서버(U2-02·04): `/api/login` `{username, password, bootstrapToken?}` → `{csrfToken, user, mustChangePassword}`; 별칭 `password` 없으면 `key`, `username` 없으면 `'admin'`(`AdminServer.onLogin` 1·2 단계); `/api/logout`; `/api/me` → `{user, group, sections, migrationBanner}`; `/api/validateSession` → `{valid, user, mustChangePassword}`.
- 별칭 `{key}` 로 `/api/login` 을 부르는 호출부(`grep -rn "key:" test | grep -i login` 으로 다시 뽑는다. 설계 §9 는 "test/admin 8개, admin-routes·AdminServer.apply, login-bootstrap:106" 이라 적었으나 실제 목록은 아래가 전부다):
  - `test/admin/`(8): `compound-stale-rename.test.ts:23`, `configuration-certificate-conflict.discovery.test.ts:24`, `configuration-editor.test.ts:17,61`, `configuration-snapshot.test.ts:16`, `csrf-requests.test.ts:78`, `dev-proxy-origin.test.ts:34`, `login-bootstrap.test.ts:106`(단언), `server-buffer-minimum.test.ts:16`
  - `test/component/server/admin/`(5): `AdminServer.apply.test.ts:27`, `AdminServer.security.test.ts:55,70,97,108,121,140,187`(7곳), `AdminServer.test.ts:59`, `admin-routes.test.ts:36,57`, `configuration-revision-fixture.ts:35`
  - `test/security/`(2): `req-03-server-option-hash.test.ts:51`, `req-12-csrf.test.ts:51`
  - `test/unit/server/admin/`(2): `req-07-rate-limit.test.ts`(`login({key: …})` 다수), `req-11-body-limit.test.ts`
  - `test/helpers/processTunnelHarness.ts` 의 `adminRequest` 로그인(U0-01·U2-09), `test/component/server/admin/rbac-login.test.ts` 의 별칭 케이스(U2-02)
- 브라우저 테스트: `test/admin/screen-login.test.ts`, `test/admin/shell.test.ts`(U1-05·U1-04), `test/admin/login-bootstrap.test.ts`(기존, 드라이버로 실제 백엔드), `test/admin/design-system-rules.test.ts` R1·R2·R5(`ui/` 에 fetch 금지, hex 금지, 외부 URL 금지).
- 문구는 영어 단일(D5).

먼저 열어 볼 파일: `admin/src/screens/LoginScreen.svelte`, `admin/src/App.svelte`, `admin/src/shell/Drawer.svelte`, `admin/src/shell/nav.ts`, `admin/src/controller/LoginCtrl.ts`, `test/admin/screen-login.test.ts`, `test/admin/shell.test.ts`, `test/helpers/adminApp.ts`, `test/admin/admin-backend-driver.ts`, `test/helpers/processTunnelHarness.ts`, `src/server/admin/AdminServer.ts`(`onLogin`).

## 적용되는 결정

- D5 UI 문구 영어 단일. D4 헤더 + 드로어. D1 PRD FR-LOGOUT-001, NFR-USAB-HIDE-001(권한 없는 섹션 숨김), NFR-USAB-FIRST-LOGIN-001.
- 개요 §2·단위 2 §9: U2-10 는 UI 레인, 선행 U2-04·U1-10·U0-01. 별칭 제거는 이 이슈에서.

## 만들 것

### `admin/src/controller/LoginCtrl.ts`

```ts
export type LoginUser = {id: string; username: string; displayName: string; role: 'superuser' | 'regular'};
export type LoginResult = {success: boolean; status: number; user?: LoginUser; mustChangePassword?: boolean;
    bootstrapRequired?: boolean; invalidBootstrapToken?: boolean; weakPassword?: boolean; invalidUsername?: boolean; message?: string};
static async login(username: string, password: string, bootstrapToken?: string): Promise<LoginResult>;   // body {username, password, bootstrapToken}
static async validateSession(): Promise<boolean>;      // 그대로
static async logout(): Promise<void>;                  // POST /api/logout (CSRF 헤더는 기존 fetch 래퍼 규칙대로)
```

### `admin/src/me.ts` (신규)

```ts
export type Me = {user: {id; username; displayName; role; status; groupId; groupName; mustChangePassword; migratedFromLegacyAdmin; createdAt; updatedAt};
    group: {id: string; name: string; attributes: Record<string, unknown>}; sections: string[]; migrationBanner: boolean};
export const me: Writable<Me | undefined>;
export async function loadMe(): Promise<Me>;      // GET /api/me → me.set
export function clearMe(): void;                  // me.set(undefined)
```

`InvalidSession` 처리는 다른 컨트롤러와 같은 규칙(단위 1 §5.2 의 `sessionInvalid()`).

### `LoginScreen.svelte`

- 비밀번호 필드 **위**에 `Field label="Username"` + `TextInput id="login-username" autocomplete="username"`. 초기값은 `localStorage['tttgate.lastUsername']`(없으면 빈 문자열). 부트스트랩 상태(`bootstrapRequired` true 응답 뒤)에서는 `Field` 의 `hint="Choose the first superuser name (default: admin)"`.
- 제출: `username` 이 비어 있으면 `'admin'` 을 보낸다(UI 기본값. 서버 별칭 제거 후에도 동작). 비밀번호 비어 있음 검사는 기존 그대로.
- 성공 시 `localStorage['tttgate.lastUsername'] = username` 저장(`try/catch`) 후 `onsuccess({user, mustChangePassword})`.
- 오류 문구 추가: `invalidUsername` → "Username must be 3-32 characters: a-z, 0-9, dot, underscore, hyphen." 나머지 문구·분기는 U1-05 그대로.

### `Drawer.svelte`, `nav.ts`

- `NAV` 항목에 `section: 'status' | 'tunnels' | 'server'` 를 추가하고 `Drawer` 는 `$me?.sections.includes(item.section)` 인 항목만 그린다(`me` 가 아직 없으면 아무 항목도 그리지 않는다).
- 드로어 하단에 사용자명(`$me.user.username`, `class="mono"`)과 `Button variant="ghost"` "Sign out"(`id="nav-sign-out"`). 클릭 → `LoginCtrl.logout()` → `clearMe()` → App 상태 `'Invalid'`(컨텍스트 콜백 `sessionInvalid()` 재사용). 요청이 실패해도 `clearMe()` 와 상태 전환은 수행한다.

### `App.svelte`

- `'Valid'` 진입 직후 `loadMe()`. 완료 전에는 `<Loading/>`. `loadMe` 가 `InvalidSession` 이면 `'Invalid'`, 네트워크 오류로 실패하면 `'Offline'`(`validateSession` 실패와 같은 상태로 모은다).
- `$me.mustChangePassword` 이면 `Shell` 대신 `<p role="alert" id="password-change-required">Password change required. Use the API or wait for the account screen.</p>` 와 "Sign out" 버튼(`id="password-change-sign-out"`) 만 표시(U3-01 이 `#/me/password` 화면으로 대체).
- 로그인 화면의 `onsuccess` 뒤 상태 `'Valid'` → `loadMe()`.

### 서버 `onLogin` 별칭 제거

`password` 만 읽는다(`key` 무시). `username` 이 없거나 `validateUsername` 실패면 401(기본값 `'admin'` 제거). 부트스트랩 경로는 `username` 없으면 `invalidUsername: true` 로 403.

### 호출부 갱신 (별칭 제거와 같은 커밋)

- `test/helpers/processTunnelHarness.ts` `adminRequest`: `{username: adminLogin.username, password: adminLogin.password}`.
- 위 "배경" 의 별칭 호출부 전부를 `{username:'admin', password:<기존 key 값>, bootstrapToken}` 로. `login-bootstrap.test.ts:106` 단언을 `{username:'admin', password, bootstrapToken}` 로(`loginFixture.login` 이 username 을 받도록 픽스처도 갱신). `rbac-login.test.ts` 의 별칭 케이스를 "`{key}` 만 보내면 401, `{password}` 만 보내면 401" 로 뒤집는다.
- `test/e2e/browser/legacy-admin-migration.test.ts`·`regular-user-login.test.ts`(U2-09): `#login-username` 조건 분기를 지우고 항상 입력한다. `regular-user-login` 4단계를 항상 수행한다.

### 테스트 드라이버

- `test/admin/admin-backend-driver.ts`: 픽스처 `'regular-user'` 추가 — 드라이버 프로세스 안에서 `IdentityStore.bcryptCost = 4` 로 두고 `await IdentityMigration.runAtStartup()` 뒤 `IdentityStore.instance.createUser(...)` 로 일반 유저 `alice`(`alice-pass-1234`, `default` 그룹; `updateGroup('default', {attributes:{admin_ui_section_access:['tunnels']}})`) 와 `mustChangePassword: true` 인 `temp`(`temp-pass-1234`) 를 만든다(슈퍼유저 `admin`/`test-password-1234` 는 `.key` 승격). U2-09 의 `serializeIdentityFixture` 에 의존하지 않는다.
- `test/helpers/adminApp.ts` `startAdminApp({fixture, login?: boolean | {username, password}})`: U1-05 의 `login?: boolean` 을 넓힌다. `true`(기본)는 `admin`/`test-password-1234`, 객체면 그 계정. 별도 `loginAs` 옵션은 만들지 않는다. 로그인 시 `#login-username` 에 username 입력.

### 테스트

- `test/admin/screen-login.test.ts` 케이스 추가
- `test/admin/shell.test.ts` 케이스 추가

## 변경할 것

- `admin/src/controller/LoginCtrl.ts`, `admin/src/screens/LoginScreen.svelte`, `admin/src/shell/Drawer.svelte`, `admin/src/shell/nav.ts`, `admin/src/App.svelte`, `admin/src/me.ts`(신규).
- `src/server/admin/AdminServer.ts` `onLogin`: 별칭 제거.
- `test/helpers/processTunnelHarness.ts`, `test/helpers/adminApp.ts`, `test/admin/admin-backend-driver.ts`, 별칭 호출부 테스트 17개 파일, `rbac-login.test.ts`, E2E 2개.

## 하지 말 것

- `#/me`, `#/me/password`, 사용자·그룹 화면, 마이그레이션 배너를 만들지 않는다(3 단위). `Banner` 부품을 여기서 쓰지 않는다.
- `ui/` 부품에서 `fetch` 하지 않는다(R1). hex 색·외부 URL 금지(R2·R5).
- 한국어·다국어 문구를 넣지 않는다(D5).
- username 을 쿠키·세션스토리지에 저장하지 않는다(`localStorage['tttgate.lastUsername']` 하나).
- `LoginCtrl.login` 의 `key` 매개변수·서버의 `key` 별칭을 남겨 두지 않는다(진입점 하나).
- 별칭 호출부를 일부만 고치고 서버 별칭을 남기지 않는다(전부 고치고 제거한다).
- 예외를 제어 흐름으로 쓰지 않는다: `localStorage` 접근만 `try/catch`(브라우저 정책 예외).

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트(브라우저 테스트는 400×800, `finally` 에서 `close()`, `expect(errors).toEqual([])`):

- `test/admin/screen-login.test.ts` (추가)
  - 비밀번호 픽스처: `#login-username` 이 비밀번호 필드보다 DOM 순서상 앞에 있고 `autocomplete="username"` 이다.
  - `#login-username` 에 `admin`, 비밀번호 정답 → `#/status` 도착, `localStorage.getItem('tttgate.lastUsername') === 'admin'`. 페이지를 새로 열면 `#login-username` 값이 `admin` 이다.
  - `#login-username` 비움 + 정답 → 성공한다(`page.waitForRequest` 로 본문 `{username:'admin', password:…}` 확인).
  - `#login-username` 에 `nobody` + 정답 비밀번호 → `#login-message` 텍스트 "The password is incorrect."(401 공통 문구).
  - 부트스트랩 픽스처: `Field` 힌트 텍스트 "Choose the first superuser name (default: admin)" 이 보이고, `#login-username` 에 `bad name` 을 넣으면 "Username must be 3-32 characters: a-z, 0-9, dot, underscore, hyphen." 이며, `root` + 강한 비밀번호 + 올바른 토큰이면 `#/status`.
  - `regular-user` 픽스처, `alice` 로그인 → `#/status`(라우터 기본값; 3 단위가 바꾼다) 도착 후 드로어에 "Status"·"Server settings" 항목이 없고 "Tunnels" 만 있다.
  - `temp` 로그인 → `#password-change-required` 가 보이고 헤더 메뉴 버튼이 없으며 `#password-change-sign-out` 클릭 시 로그인 화면으로 돌아간다.
- `test/admin/shell.test.ts` (추가)
  - 로그인 후 드로어 하단에 사용자명 `admin` 과 `#nav-sign-out` 이 있다. 클릭 → 로그인 화면(`#login-password` 존재) → `GET /api/validateSession` 이 401(`page.request` 로 확인). 브라우저 뒤로 가기로도 화면이 복귀하지 않는다.
  - 드로어 항목이 `me.sections` 순서(status, tunnels, server) 대로다.
- `test/admin/login-bootstrap.test.ts`: `:106` 단언이 `{username:'admin', password, bootstrapToken}` 이고 전부 통과.
- `test/component/server/admin/rbac-login.test.ts`: `{key:'…'}` 만 보내면 401, `{password:'…'}` 만(username 없음) 보내면 401, `{username:'admin', password:'…'}` 200, 부트스트랩 루트에서 `{password, bootstrapToken}`(username 없음) 은 403 `invalidUsername true`.
- `test/e2e/browser/regular-user-login.test.ts`: 브라우저에서 alice 로그인 후 `/api/me` `username 'alice'`. `legacy-admin-migration.test.ts` 는 항상 `#login-username` 을 채운다.
- `test/admin/design-system-rules.test.ts` R1·R2·R5 통과.

기존 테스트 전부 통과: `test/admin/*.test.ts`(U1 이후 전체), `test/component/server/admin/*.test.ts`, `test/unit/server/admin/*.test.ts`, `test/security/*.test.ts`, `test/e2e/**`.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm --prefix admin run check
npm run lint
npm run test:admin
npx jest --runInBand test/component/server/admin test/unit/server/admin test/security
npm run test:e2e:browser
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 로봇 이모지 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U2-04(`/api/me`, `/api/logout`, 별칭이 든 `onLogin`), U1-10(단위 1 완료: LoginScreen·`startAdminApp`·`admin-backend-driver`·옛 코드 제거), U0-01(프로세스 하네스의 `adminRequest`). U2-09 의 E2E 두 파일이 이미 있으면 조건 분기를 지우고, 없으면 그 항목은 U2-09 이 처음부터 무조건 입력으로 쓴다.
- 후행: U3-01(`#/me/password` 화면, 배너, `denied`), U4-05/06.

## 근거 문서

- `docs/design/2026-09-11-unit2-rbac-model-api.md` §5.2(`/api/login` 별칭과 제거 시점, `/api/logout`, `/api/me`), §7(클라이언트 변경 전문), §8.2(`login-bootstrap.test.ts:106` 갱신), §9(U2-10: UI 레인, 호출부 갱신 목록)
- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §5.2(App 상태), §5.5(Drawer, 로그아웃 항목 예약), §6(`Field`·`TextInput`·`Button` 계약), §7.1(LoginScreen), §8.2~8.3(드라이버·브라우저 테스트), §9(U1-05·U1-10)
- `docs/design/2026-09-11-unit3-rbac-screens.md` §3(라우트와 내비게이션: NAV·`me.sections`·`mustChangePassword` 고정. 이 이슈가 임시 처리하는 부분의 최종 형태)
- `docs/design/2026-09-11-unit0-verification-foundation.md` §3.2(`adminLogin`, `adminRequest`)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.6 FR-LOGOUT-001, §5.2.3 NFR-USAB-HIDE-001·NFR-USAB-FIRST-LOGIN-001, §6.4
- `docs/design/2026-09-11-program-overview.md` §1 D4·D5, §2(U2-10 는 단위 1 이후)

---
