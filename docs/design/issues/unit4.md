# 단위 4 이슈 초안 — 감사 로그 · MFA · 세션 관리

근거: [단위 4 설계](../2026-09-11-unit4-audit-mfa-sessions.md), [단위 2 설계](../2026-09-11-unit2-rbac-model-api.md), [단위 3 설계](../2026-09-11-unit3-rbac-screens.md), [단위 1 설계](../2026-09-11-unit1-admin-ui-shell.md), [프로그램 개요](../2026-09-11-program-overview.md), [PRD](../../plan/prd/TTTGate-admin-rbac.md) §5.1.4~5.1.6 §5.2

## U4-01

**title**: feat(admin): 파일 기반 감사 저장소와 보존 정책, 이벤트 타입 상수 추가
**labels**: enhancement, area:admin, unit:4
**body**:
## 목적

단위 2 가 만든 `AuditSink` 삽입점에 파일 기반 append-only 저장소 `FileAuditSink` 를 붙인다. 이 이슈가 끝나면 모든 관리 API 의 CUD 호출이 `logs/audit/audit-YYYY-MM-DD.jsonl` 에 한 줄씩 기록되고, 큐가 가득 차면 `reserve()` 가 false 를 돌려주어 `audited()` 가 핸들러 실행 없이 503 으로 실패하며(드롭 금지), 보존 기간이 지난 파일이 하루 한 번 삭제된다. 이벤트 타입 이름은 상수 파일 하나에 고정되고 기존 CUD 핸들러가 그 상수를 쓴다. 조회 API 는 다음 이슈(U4-02).

## 배경

### 전제하는 산출물 (단위 2 가 만든다. 착수 시 아래 표의 파일·심볼이 저장소에 없으면 이 이슈에 코멘트를 남기고 중단한다)

| 파일 | 심볼 | 계약 (단위 2 문서 §4.3·§4.6·§5.1) |
|---|---|---|
| `src/server/audit/AuditSink.ts` | `type AuditEvent` | `{at: number; actor: {userId; username; role?: Role} \| {userId: 'system'}; sessionIdHash?: string; ip?: string; type: string; target?: {kind: 'user' \| 'group' \| 'tunnel' \| 'server' \| 'session' \| 'security'; id: string}; outcome: 'success' \| 'failure'; summary: string; detail?: Record<string, unknown>}` |
| 같은 파일 | `interface AuditSink` | `{ reserve(): boolean; record(event: AuditEvent): Promise<void> }`. `reserve()` 는 큐 1칸 선점(단위 2 가 인터페이스에 미리 둔다) |
| 같은 파일 | `class LoggerAuditSink` | 기본 구현. `reserve()` 항상 true, `record()` 는 `logger.info('audit', JSON)` |
| 같은 파일 | `const AuditSinkRegistry` | `{ current(): AuditSink; set(sink: AuditSink): void; reset(): void }` |
| `src/server/admin/AdminServer.ts` | `audited(req, principal, type, target, fn)` | 모든 CUD 핸들러를 감싸는 헬퍼. **핸들러 실행 전에** `reserve()` 를 부르고 false 면 실행 없이 503 `{success: false, status: 503, code: 'audit_unavailable'}`. 성공·실패(예외·`success:false`)를 모두 `record()`. **이 이슈에서 `audited()` 를 바꾸지 않는다** |
| `src/server/admin/routes.ts` | `ADMIN_ROUTES: readonly Route[]` | 라우트 표. 감사 커버리지 테스트가 순회한다 |
| `src/server/admin/SessionStore.ts` | `static sessionIdOf(key): string` | `sha256(key).slice(0,16)`. `sessionIdHash` 의 출처 |
| `src/server/rbac/IdentityStore.ts` | 마지막 슈퍼유저 가드 | 409 를 낼 때 `last_superuser_guard_hit` 을 `record` |
| 같은 파일 | `type Route`, `RouteContext`, `route()` | `type Route = {method; pattern: RegExp; action: Action \| 'public' \| 'session' \| ((ctx: RouteContext) => Action); handler}`, `RouteContext = {req; res; params; principal?; ip; ok(payload?, status?); fail(status, payload)}`. `route()` 가 표를 훑어 `authorize` 후 `handler` 를 부른다 (단위 2 §5.1) |
| `src/server/admin/rbacRoutes.ts` | `rbacRouteTable(): Route[]` | 사용자·그룹·me 계열 핸들러가 모여 있는 분리 파일. `routes.ts` 의 표가 펼쳐 넣는다 (단위 2 §5.2) |
| `test/component/server/admin/audit-sink.test.ts` | — | `ADMIN_ROUTES` 를 순회해 CUD 항목 전수가 `record` 를 부르는지 단언 (PRD K3) |

### 실제로 변경할 기존 파일 (현재 저장소 기준)

- `src/util/SecretRedactor.ts:3-16` `isSensitiveKey(key)`: 소문자 정규화 뒤 `key`, `clientsecret`, `cert`, `ca`, `password`, `sessionkey`, `bootstraptoken` 완전 일치 또는 접미사 `secret`·`token`·`password`·`privatekey` 를 민감 키로 본다. `:1` `REDACTED_VALUE = "[REDACTED]"`. `:18` `redactSecrets(value)` 가 객체를 재귀 순회하며 민감 키의 값을 `[REDACTED]` 로 바꾼다. `totp`, `code`, `recoveryCode` 는 지금 민감 키가 아니다.
- `src/types/TunnelingOption.ts:52-66` `type ServerOption = {sessionTtlMs?, key, adminPort?, adminBindHost?, adminTls?, port, tls, controlProtocolMode?, allowLegacyControlAuth?, trustedClients?, tunnelingOptions, globalMemCacheLimit?, keepAlive}`. 감사 관련 필드 없음. `:102-107` `resolveSessionTtlMs(value)` 가 `{success: true; ttlMs} | {success: false; message}` 를 돌려주는 검증 함수의 본보기.
- `src/server/ServerOptionStore.ts:339` `public verificationServerOption(option: ServerOption): {success: boolean, message: string, serverOption?: ServerOption}`. `:351-353` 에서 `resolveSessionTtlMs` 로 `sessionTtlMs` 를 검증·기본값 채움. 이 함수 안에서 새 옵션 두 개를 같은 방식으로 검증한다.
- `src/Environment.ts:11` `logDir: Path.join(rootDir, 'logs')`. `Environment.path.logDir` 로 읽는다. `Environment.configure({rootDir})` 가 테스트 루트로 바꾼다.
- `src/util/logger/LogWriter.ts:53` 가 `fs.createWriteStream(this._filePath, {flags: 'a'})` 로 로그 파일을 열고 `:184-186` 에서 날짜가 바뀌면 `nextLogFile()` 로 교체하며 `:65-84` `sweepOldFiles()` 로 `history` 일 초과 파일을 지운다. `FileAuditSink` 는 이 클래스를 **재사용하지 않는다**(로그 줄 포맷·콘솔 출력이 섞여 있고 큐 상한·선점·배압 거부가 없다). 구조만 참고한다.
- `src/bootstrap/AppCompositionRoot.ts:10` `config.logFileDir = Environment.path.logDir` — 로그 디렉터리가 결정되는 곳. 감사 디렉터리는 그 하위 `audit/`.
- `src/server/ServerApp.ts:26-35` `startService(serverOption, adminCertInfo)`: `TTTServer.create` → `new AdminServer(...)` → `listen` → `tttServer.start()`. `AuditSinkRegistry.set` 은 `new AdminServer` 앞에 둔다. 같은 파일의 `updateServerOption(option)`(서버 옵션 저장 성공 뒤 실행 중 서버에 값을 반영하는 함수. 이름이 다르면 `ServerOptionStore` 의 저장 성공 콜백을 받는 `ServerApp` 메서드 하나)이 감사 옵션 변경 시 싱크를 교체할 지점이다.
- 로거는 `src/util/logger/LoggerFactory.ts` 의 서버 카테고리(`LoggerFactory.getLogger('server')`, 기존 서버 코드가 쓰는 것과 같은 취득 방식)를 쓴다. 감사 전용 로거 카테고리를 새로 만들지 않는다.

먼저 열어 볼 파일: `src/server/audit/AuditSink.ts`(단위 2 산출물), `src/server/admin/routes.ts`, `src/util/SecretRedactor.ts`, `src/util/logger/LogWriter.ts`, `src/server/ServerOptionStore.ts`(339~415행), `src/types/TunnelingOption.ts`(52~66행, 100~106행), `src/server/ServerApp.ts`, `test/component/server/admin/audit-sink.test.ts`, `test/helpers/runtime.ts`(`createTestRoot`·`cleanupTestRoot`).

## 적용되는 결정

- D1 기능 범위는 PRD v0.2 전체 → FR-AUDIT-CAPTURE-001, FR-AUDIT-RETENTION-001(기본 90일), FR-AUDIT-TAMPER-RESIST-001, NFR-PERF-AUDIT-WRITE-001(응답 경로 비블로킹, 오버플로 시 드롭 대신 API 실패), NFR-SEC-AUDIT-INTEGRITY-001(append-only, 읽기 API 만).
- PRD §12 Q3 가정: 보존 기간 상한 없음. `auditRetentionDays: 0` 이 무제한. 양수 범위 1..3650 은 입력 오류 방지용이지 정책 상한이 아니다.

## 만들 것

### `src/server/audit/AuditEventTypes.ts` (신규)

```ts
export const AUDIT_EVENT_TYPES = {
    // 로그인·MFA (/api/login, /api/login/mfa)
    login_success: 'login_success', login_failure: 'login_failure',
    mfa_success: 'mfa_success', mfa_failure: 'mfa_failure', mfa_recovery_used: 'mfa_recovery_used',
    mfa_enrolled: 'mfa_enrolled', mfa_disabled: 'mfa_disabled', mfa_reset: 'mfa_reset',
    mfa_recovery_codes_regenerated: 'mfa_recovery_codes_regenerated',
    // 세션
    logout: 'logout', session_killed: 'session_killed',
    sessions_killed_for_user: 'sessions_killed_for_user', sessions_killed_self_others: 'sessions_killed_self_others',
    // 사용자
    user_created: 'user_created', user_updated: 'user_updated', user_deleted: 'user_deleted',
    user_status_changed: 'user_status_changed', role_changed: 'role_changed',
    temp_password_issued: 'temp_password_issued', password_changed: 'password_changed',
    // 그룹
    group_created: 'group_created', group_updated: 'group_updated',
    group_attributes_changed: 'group_attributes_changed', group_deleted: 'group_deleted',
    // 터널
    tunnel_created: 'tunnel_created', tunnel_updated: 'tunnel_updated', tunnel_deleted: 'tunnel_deleted',
    tunnel_activated: 'tunnel_activated', tunnel_deactivated: 'tunnel_deactivated', tunnel_reassigned: 'tunnel_reassigned',
    tunnel_cert_updated: 'tunnel_cert_updated', tunnel_cert_deleted: 'tunnel_cert_deleted',
    // 서버
    server_option_updated: 'server_option_updated', admin_cert_updated: 'admin_cert_updated',
    // 연결 보안 (단위 5 가 기록)
    security_geo_updated: 'security_geo_updated', security_ban_removed: 'security_ban_removed',
    // 가드·런타임
    access_denied: 'access_denied', last_superuser_guard_hit: 'last_superuser_guard_hit',
    conn_limit_hit: 'conn_limit_hit', tunnel_autoexpire: 'tunnel_autoexpire',
    audit_retention_pruned: 'audit_retention_pruned'
} as const;
export type AuditEventType = keyof typeof AUDIT_EVENT_TYPES;
export const AUDIT_EVENT_TYPE_LIST: readonly AuditEventType[] = Object.keys(AUDIT_EVENT_TYPES) as AuditEventType[];
export const isAuditEventType = (value: string): value is AuditEventType =>
    Object.prototype.hasOwnProperty.call(AUDIT_EVENT_TYPES, value);   // `value in ...` 은 'toString' 에도 true 라 쓰지 않는다
```

이벤트 타입 표(어느 코드 경로가 어떤 타입을 내는가). 이 이슈에서는 이미 존재하는 `audited(...)`·`record(...)` 호출부에 문자열 리터럴 대신 이 상수를 쓰도록 바꾼다. 착수 시점에 단위 5(U5-07·U5-08)가 `conn_limit_hit`·`tunnel_autoexpire` 를 리터럴로 이미 썼으면 그것도 상수로 치환한다(없으면 단위 5 가 이 상수를 쓴다). U4-04·U4-05 가 먼저 끝나 `mfa_*`·`session*` 을 리터럴로 썼어도 같은 규칙.

| type | 발생 지점 | target.kind | detail 규칙 |
|---|---|---|---|
| `login_success` | `POST /api/login` 성공 | `user` | `actor.role` 을 채운다 |
| `login_failure` | `POST /api/login` 실패 | `user` | 사용자를 특정하지 못하므로 `detail.username` 만. `actor` 는 `{userId: 'system'}` |
| `mfa_success` `mfa_failure` `mfa_recovery_used` | `POST /api/login/mfa` (U4-04) | `user` | |
| `mfa_enrolled` `mfa_disabled` `mfa_reset` `mfa_recovery_codes_regenerated` | MFA 등록·해제·초기화·복구 코드 재발급 (U4-04) | `user` | 복구 코드 평문·해시를 `detail` 에 넣지 않는다 |
| `logout` | `POST /api/logout` | `session` | id = `sessionIdHash` |
| `session_killed` `sessions_killed_for_user` `sessions_killed_self_others` | 세션 API (U4-05) | `session` / `user` | |
| `user_created` `user_updated` `user_deleted` `user_status_changed` `role_changed` `temp_password_issued` | `/api/users*` | `user` | `temp_password_issued` 의 `detail` 에 평문 금지 |
| `password_changed` | `PUT /api/me/password` | `user` | `detail.firstLogin: boolean`(`mustChangePassword` 였으면 true) |
| `group_created` `group_updated` `group_deleted` | `/api/groups*` | `group` | |
| `group_attributes_changed` | `PUT /api/groups/:id` 에서 `attributes` 가 바뀔 때 | `group` | `detail.changedKeys: string[]` |
| `tunnel_created` `tunnel_updated` `tunnel_deleted` `tunnel_activated` `tunnel_deactivated` `tunnel_reassigned` | 터널 라우트 | `tunnel` | `target.id = String(forwardPort)` |
| `tunnel_cert_updated` `tunnel_cert_deleted` | `POST/DELETE /api/externalCert/:port` | `tunnel` | |
| `server_option_updated` | `POST /api/serverOption` | `server` | `target.id = 'server'` |
| `admin_cert_updated` | `POST /api/adminCert` | `server` | |
| `security_geo_updated` `security_ban_removed` | 단위 5 (U5-05) | `security` | |
| `access_denied` | `route()` 의 `authorize` 가 403 또는 404 를 낼 때 | 없음 | `detail.action`(Action 문자열), `detail.status` |
| `last_superuser_guard_hit` | `IdentityStore` 가드가 409 를 낼 때 | `user` | |
| `conn_limit_hit` `tunnel_autoexpire` | 단위 5 런타임 (U5-08, U5-07) | `tunnel` | |
| `audit_retention_pruned` | `FileAuditSink.pruneRetention()` | 없음 | `detail.files: string[]`(삭제한 파일명), `detail.retentionDays` |

### `src/server/audit/FileAuditSink.ts` (신규)

```ts
export class AuditBackpressureError extends Error { readonly code = 'audit_unavailable'; }
export type FileAuditSinkOptions = {
    dir: string;                       // Path.join(Environment.path.logDir, 'audit')
    queueSize: number;                 // 서버 옵션 auditQueueSize
    retentionDays: number;             // 서버 옵션 auditRetentionDays, 0 = 무제한
    openStream?: (path: string) => Pick<fs.WriteStream, 'write' | 'once' | 'end' | 'on'>;   // 테스트 배압 스텁 경계. 기본 fs.createWriteStream(path, {flags: 'a', mode: 0o600})
};
export class FileAuditSink implements AuditSink {
    constructor(options: FileAuditSinkOptions);
    reserve(): boolean;                            // 큐 1칸 선점. queue.length + reserved >= queueSize 이면 false
    record(event: AuditEvent): Promise<void>;      // 선점된 칸이 있으면 그 칸에, 없으면 여유가 있을 때만. 즉시 resolve. 여유 없으면 reject(new AuditBackpressureError())
    flush(): Promise<void>;                        // 큐가 비고 마지막 write 의 콜백이 호출될 때까지 대기 (테스트·종료용)
    pruneRetention(now: number = Date.now()): string[];   // 보존 기간 초과 파일 삭제(동기), 삭제한 파일명 반환. 테스트는 now 를 주입
    startRetentionTimer(): void;                   // 기동 직후 1회 pruneRetention() + 24시간 간격 setInterval(...).unref()
    close(): Promise<void>;                        // 타이머 해제, flush, 스트림 end. 이후 reserve() 는 false, record() 는 reject
    get queueLength(): number; get reservedCount(): number;
    get queueSize(): number; get retentionDays(): number;   // 옵션 변경 시 교체 여부 비교용
    static fileNameFor(atMs: number): string;      // 'audit-YYYY-MM-DD.jsonl' (UTC)
}
```

동작 규칙:

1. **경로.** `dir/audit-YYYY-MM-DD.jsonl`, 날짜는 `new Date(event.at).toISOString().slice(0, 10)`(UTC). 디렉터리는 첫 쓰기 전에 `fs.mkdirSync(dir, {recursive: true, mode: 0o700})`. 파일은 `flags: 'a'`, `mode: 0o600`(Windows 는 무시된다). 파일 이름이 바뀌면 이전 스트림을 `end()` 하고 새 스트림을 연다.
2. **한 줄 형식.** `JSON.stringify(redacted) + '\n'`. `JSON.stringify` 결과에는 개행이 들어가지 않는다(문자열 안 개행은 `\n` 으로 이스케이프된다).
3. **redaction.** `record()` 진입 시 `event.detail` 이 있으면 `redactSecrets(event.detail)` 결과로 바꾼 새 객체를 큐에 넣는다(입력 객체를 변경하지 않는다). `actor`·`target`·`summary` 는 redaction 대상이 아니다(민감 값이 들어오면 안 되는 필드이며, 넣지 않는 것은 호출부 책임). 단위 2 의 `audited()`(U2-05)도 `detail` 에 `redactSecrets` 를 이미 적용하므로 `audited()` 를 거친 이벤트에는 같은 변환이 두 번 걸린다. `redactSecrets` 는 멱등이므로 결과가 달라지지 않으며, **싱크 레벨의 redaction 은 `reserve()` 없이 `record()` 만 부르는 호출부(`IdentityStore` 가드, 로그인 이벤트, `pruneRetention`, 단위 5 런타임)를 위한 최종 방어선**이다. `audited()` 쪽의 redaction 을 지우지 않는다.
4. **선점과 거부.** 상태는 배열 `queue` 와 정수 `reserved` 둘뿐이고 불변식은 `queue.length + reserved <= queueSize` 다. `reserve()` 는 `queue.length + reserved >= queueSize` 이면 false 를 돌려주고 `logger.warn('audit queue full (n)')` 을 남긴다. 아니면 `reserved += 1` 후 true. `record()` 는 `reserved > 0` 이면 `reserved -= 1` 하고 push(선점된 칸을 쓴다); `reserved === 0` 이면 `queue.length >= queueSize` 일 때 `Promise.reject(new AuditBackpressureError())`, 아니면 push. push 뒤 드레인이 돌고 있지 않으면 `setImmediate(drain)` 을 예약하고 `Promise.resolve()` 를 돌려준다. 선점은 소유되지 않고 개수로만 센다(어느 호출자의 `record()` 든 선점된 칸을 하나 소비한다). `audited()` 가 `reserve()` 한 번에 `record()` 를 정확히 한 번 부르므로 선점이 새지 않는다. `reserve()` 없이 `record()` 만 부르는 호출부(`IdentityStore` 가드, 로그인 이벤트, `pruneRetention`)는 여유가 있을 때만 성공한다.
5. **드레인과 배압.** `drain()` 은 큐 앞의 항목을 **꺼내지 않고** `queue[0]` 으로 읽어 `stream.write(line, callback)` 한다. `write` 의 콜백이 불린 뒤에야 `queue.shift()` 로 그 항목을 버리고 다음 항목으로 넘어간다. 즉 **쓰기 대기 중인 항목도 `queue.length` 에 그대로 포함되며**, 그래야 `queue.length + reserved <= queueSize` 불변식이 "아직 디스크에 닿지 않은 이벤트 수" 를 정확히 세고 배압 거부 경계가 흔들리지 않는다. `write` 가 `false` 를 돌려주면 `stream.once('drain', ...)` 까지 기다린 뒤 다음 항목으로 넘어간다(콜백과 `drain` 둘 다 온 뒤). 큐가 비면 드레인 플래그를 내리고 `flush()` 의 대기자를 깨운다. 스트림 `error` 이벤트는 `logger.error` 로 남기고 스트림을 버린 뒤 다음 쓰기에서 다시 연다(같은 파일). 큐를 비우지 않는다.
6. **보존.** `pruneRetention(now)` 은 `retentionDays === 0` 이면 아무것도 하지 않고 `[]`. 그 외에는 `fs.readdirSync(dir)` 중 `^audit-(\d{4}-\d{2}-\d{2})\.jsonl$` 에 맞는 파일마다 **파일 날짜의 다음날 00:00(UTC)** 를 구해(`Date.UTC(y, m - 1, d) + 86_400_000`) 그 값이 `now - retentionDays × 86,400,000` **이하**이면 `fs.unlinkSync` 한다. 달리 말하면 "그 날짜가 완전히 끝난 시점부터 `retentionDays` 일이 지난 파일" 만 지우므로, 오늘 파일과 보존 기간 안의 파일은 시각과 무관하게 남는다. 삭제 파일이 1개 이상이면 `record({at: now, actor: {userId: 'system'}, type: 'audit_retention_pruned', outcome: 'success', summary: 'Pruned N audit files', detail: {files, retentionDays}})` 를 자기 자신에게 기록한다(큐가 가득 차 reject 되면 `logger.warn` 만 남긴다). 디렉터리가 없으면 `[]`.
7. **타이머.** `startRetentionTimer()` 는 즉시 `pruneRetention()` 을 호출하고 `setInterval(() => this.pruneRetention(), 86_400_000)` 에 `unref()` 를 건다. `close()` 가 `clearInterval`.

### 서버 옵션 두 개

`src/types/TunnelingOption.ts` `ServerOption` 에 추가:

```ts
    auditRetentionDays?: number,   // 기본 90. 0 = 무제한. 그 외 정수 1..3650
    auditQueueSize?: number,       // 기본 1000. 정수 100..100000
```

`resolveSessionTtlMs`(`:102-107`) 바로 아래에 같은 형태로 두 함수를 만들고 export 한다:

```ts
export const DEFAULT_AUDIT_RETENTION_DAYS = 90;
export const DEFAULT_AUDIT_QUEUE_SIZE = 1000;
export const resolveAuditRetentionDays = (value: unknown): {success: true; days: number} | {success: false; message: string};
export const resolveAuditQueueSize = (value: unknown): {success: true; size: number} | {success: false; message: string};
```

`undefined` 면 기본값. `Number.isInteger` 가 아니거나 범위 밖이면 실패이고 메시지는 정확히 `'auditRetentionDays must be 0 or an integer within 1..3650'`, `'auditQueueSize must be an integer within 100..100000'`.

`src/server/ServerOptionStore.ts:339 verificationServerOption` 안, `sessionTtlMs` 검증(`:351-353`) 바로 뒤에 추가:

```ts
        const retention = resolveAuditRetentionDays(option.auditRetentionDays);
        if(!retention.success) return retention;
        option.auditRetentionDays = retention.days;
        const queue = resolveAuditQueueSize(option.auditQueueSize);
        if(!queue.success) return queue;
        option.auditQueueSize = queue.size;
```

### `src/server/ServerApp.ts` 연결

`startService` 에서 `new AdminServer(...)` 앞에:

```ts
    const auditSink = new FileAuditSink({
        dir: Path.join(Environment.path.logDir, 'audit'),
        queueSize: serverOption.auditQueueSize ?? DEFAULT_AUDIT_QUEUE_SIZE,
        retentionDays: serverOption.auditRetentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS
    });
    auditSink.startRetentionTimer();
    AuditSinkRegistry.set(auditSink);
```

서버 옵션 교체 반영은 **`ServerApp.updateServerOption(option)` 한 곳**에서만 한다(그 이름의 메서드가 없으면 `ServerOptionStore` 의 저장 성공 뒤 실행 중 서버에 값을 반영하는 `ServerApp` 메서드 하나를 골라 거기에 둔다. 두 곳에 나눠 넣지 않는다). 그 안에서 새 `auditRetentionDays`·`auditQueueSize` 가 현재 싱크의 값과 **하나라도 다를 때만** 아래를 한다:

```ts
    const previous = AuditSinkRegistry.current();
    if(previous instanceof FileAuditSink && (previous.retentionDays !== nextRetentionDays || previous.queueSize !== nextQueueSize)) {
        const next = new FileAuditSink({dir, queueSize: nextQueueSize, retentionDays: nextRetentionDays});
        next.startRetentionTimer();
        AuditSinkRegistry.set(next);        // 새 인스턴스를 먼저 등록해 이후 이벤트가 새 큐로 가게 한다
        await previous.close();             // 옛 큐에 남은 이벤트는 close() 의 flush 가 다 쓴다
    }
```

`FileAuditSink` 에 읽기 전용 게터 `get retentionDays(): number`, `get queueSize(): number` 를 둔다(비교용).

### `src/util/SecretRedactor.ts` 변경

`isSensitiveKey` 의 완전 일치 목록에 `"totp"`, `"code"`, `"recoverycode"` 를 추가한다(`:11` `bootstraptoken` 다음 줄. 입력 키는 소문자 정규화되므로 `recoveryCode` 도 덮인다). 다른 규칙은 건드리지 않는다.

## 변경할 것

- `src/server/audit/AuditSink.ts`: `AuditEvent.type` 의 타입을 `string` 에서 `AuditEventType` 으로 좁힌다.
- `src/server/admin/AdminServer.ts`, `src/server/admin/routes.ts`, `src/server/admin/rbacRoutes.ts`, `src/server/rbac/IdentityStore.ts`: `audited(req, principal, 'user_created', ...)` 처럼 문자열 리터럴로 적힌 type 을 전부 `AUDIT_EVENT_TYPES.user_created` 형태로 바꾼다. `route()` 의 `authorize` 403/404 지점에 `access_denied` 기록이 없으면 추가한다(단위 2 가 이미 넣었다면 상수만 교체). **`audited()` 의 본문은 바꾸지 않는다.**
- `src/server/ServerApp.ts`: `startService` 의 싱크 생성·등록과 `updateServerOption` 의 싱크 교체.
- `test/component/server/admin/audit-sink.test.ts`: 단위 2 의 라우트 순회 테스트에 "기록된 `event.type` 이 `AUDIT_EVENT_TYPE_LIST` 에 포함된다" 단언을 추가한다(K3 확장).
- 삭제할 파일 없음.

## 하지 말 것

- `audited()` 를 수정하지 않는다(`reserve()` 선행 호출과 503 응답은 단위 2 U2-05 범위). `FileAuditSink.reserve()` 구현만 한다.
- 감사 파일을 수정·삭제하는 API 를 만들지 않는다. 조회 API 도 이 이슈가 아니다(U4-02).
- `LogWriter` 를 확장하거나 `LoggerFactory` 에 감사 카테고리를 추가하지 않는다. `LoggerAuditSink` 는 그대로 둔다(테스트와 폴백용).
- 큐가 가득 찼을 때 오래된 이벤트를 버리고 새 것을 넣지 않는다. 경고만 남기고 통과시키지도 않는다. `reserve()` 는 false, `record()` 는 reject.
- 큐 상태를 잠금·세마포어로 다루지 않는다. 배열 push/shift 와 정수 카운터, 드레인 플래그(불리언) 하나로 충분하다(Node 단일 스레드).
- 예외를 제어 흐름으로 쓰지 않는다: 큐 가득 참은 `queue.length + reserved >= queueSize` 조건문으로 먼저 검사한다. `AuditBackpressureError` 는 `record()` 의 반환 Promise 를 reject 하는 값이지 `throw` 로 던져 잡는 용도가 아니다.
- 파일 하나를 통째로 읽거나 `fs.readFileSync` 로 기존 내용을 확인하지 않는다(append 만).
- `detail` 외의 필드에 `redactSecrets` 를 적용하지 않는다. `summary` 에 비밀번호·코드를 넣는 호출부를 발견하면 그 호출부를 고친다.
- `SecretRedactor` 의 문자열 패턴(`SECRET_PATTERNS`)을 바꾸지 않는다.
- 로컬 시간대로 파일 이름을 만들지 않는다(UTC 고정).
- 감사 `detail` 에 **민감하지 않은 오류 코드·상태 코드를 `code` 라는 키로 담지 않는다.** 이 이슈가 `code` 를 완전 일치 민감 키로 올리므로 그런 값은 `[REDACTED]` 가 되어 조사 때 쓸모가 없어진다. 오류 사유는 `detail.reason`, 상태 코드는 `detail.status` 로 담는다(이벤트 타입 표의 `access_denied` 규칙과 같은 이름 규약).
- 큐에서 항목을 꺼낸 뒤 쓰기를 기다리지 않는다(규칙 5). `shift` 를 `write` 앞에 두면 쓰기 대기 항목이 회계에서 빠져 배압 경계가 무너진다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/unit/server/audit/AuditEventTypes.test.ts`
  - `AUDIT_EVENT_TYPE_LIST` 의 길이가 41 이고 표의 모든 이름을 포함하면 통과한다.
  - `isAuditEventType('user_created')` 가 true, `isAuditEventType('nope')` 가 false 이다.
  - `isAuditEventType('toString')` 과 `isAuditEventType('constructor')` 가 false 이다(프로토타입 키를 타입으로 받지 않는다).
- `test/unit/server/audit/FileAuditSink.test.ts` (임시 루트: `createTestRoot()` 의 `rootDir/logs/audit`)
  - `record()` 한 이벤트 1건 뒤 `flush()` 하면 `audit-<UTC 날짜>.jsonl` 이 존재하고 내용이 정확히 한 줄이며 `JSON.parse` 결과가 입력 이벤트와 같다.
  - `at` 을 `2026-09-11T23:59:59.000Z` 로 둔 1건, `2026-09-12T00:00:00.000Z` 로 둔 1건을 기록하면 파일이 두 개(`audit-2026-09-11.jsonl`, `audit-2026-09-12.jsonl`)이고 각각 한 줄이다.
  - `queueSize: 3` 에서 `openStream` 스텁의 `write` 가 false 를 돌려주고 `drain` 을 내지 않는 상태로 `reserve()` 를 3번 부르면 모두 true, 네 번째는 false 이고 `reservedCount` 가 3 이다. 이어 `record()` 3번은 모두 resolve 되고 `queueLength` 3, `reservedCount` 0, 네 번째 `record()` 는 `AuditBackpressureError` 로 reject 된다.
  - `queueSize: 3` 에서 `reserve()` 없이 `record()` 를 4번 부르면 네 번째가 reject 되고 `queueLength` 가 3 이다.
  - `reserve()` 2번 뒤 `record()` 1번이면 `reservedCount` 가 1, `queueLength` 가 1 이고 `queue.length + reserved` 가 2 다.
  - `write(line, cb)` 가 `cb` 를 `setImmediate` 로 부르면서 처음에 `false` 를 돌려주고 100ms 뒤 `drain` 을 내는 스텁에서 `record()` 3건 → `flush()` 하면 `write` 호출 순서가 기록 순서와 같고, `drain` 전에는 두 번째 `write` 가 호출되지 않으며, 첫 `write` 가 불린 직후(콜백 전) `queueLength` 가 3 이다(쓰기 대기 항목도 큐에 남는다). `flush()` 가 resolve 된 뒤 `queueLength` 가 0 이고 세 줄이 모두 스텁에 전달되었다.
  - `write` 의 콜백을 100ms 뒤에 부르는 스텁에서 `record()` 1건 뒤 `flush()` 를 `await` 하면, 콜백이 불린 뒤에 resolve 된다(콜백 전에 resolve 되지 않는다).
  - `detail: {password: 'p', totp: '123456', code: '111111', recoveryCode: 'abcd-efgh', note: 'x'}` 를 기록하면 파일의 줄에서 `password`·`totp`·`code`·`recoveryCode` 값이 `"[REDACTED]"` 이고 `note` 는 `"x"` 이다. 입력 객체의 `detail.password` 는 `'p'` 그대로다.
  - `retentionDays: 2` 에서 디렉터리에 `audit-2026-09-08.jsonl`, `audit-2026-09-09.jsonl`, `audit-2026-09-10.jsonl`, `audit-2026-09-11.jsonl`, `other.txt` 를 미리 두고 `pruneRetention(Date.UTC(2026, 8, 11, 12))` 하면 반환값이 `['audit-2026-09-08.jsonl']` 이고 그 파일만 사라지며 `other.txt` 는 남는다(09-09 의 다음날 00:00 은 09-10T00:00Z 이고 cutoff 09-09T12:00Z 보다 뒤이므로 남는다). `flush()` 후 `audit-2026-09-11.jsonl` 마지막 줄의 `type` 이 `'audit_retention_pruned'` 이고 `detail.files` 가 `['audit-2026-09-08.jsonl']`, `detail.retentionDays` 가 2 다.
  - `retentionDays: 0` 이면 위 배치에서 `pruneRetention(같은 now)` 이 `[]` 를 돌려주고 파일이 하나도 사라지지 않는다.
  - `retentionDays: 1` 에서 디렉터리에 `audit-2026-09-09.jsonl`, `audit-2026-09-10.jsonl`, `audit-2026-09-11.jsonl` **세 개만** 두고 `pruneRetention(Date.UTC(2026, 8, 11, 0, 0, 30))` 하면 반환값이 `['audit-2026-09-09.jsonl']` 이고 `audit-2026-09-10.jsonl` 은 남는다(09-10 의 다음날 00:00 은 09-11T00:00Z 이고 cutoff 09-10T00:00:30Z 보다 뒤다).
  - 디렉터리가 없을 때 `pruneRetention()` 이 `[]` 를 돌려준다.
  - POSIX(`process.platform !== 'win32'`)에서 기록 후 파일 mode 가 `0o600`, 디렉터리 mode 가 `0o700` 이다(Windows 에서는 이 케이스를 `test.skip`).
  - `close()` 뒤 `reserve()` 가 false 이고 `record()` 는 reject 된다. **이 케이스는 `openStream` 스텁 없이 실제 `fs` 스트림으로 연다**(배압 스텁을 쓰면 `close()` 의 flush 가 끝나지 않는다).
  - `retentionDays: 90`, `queueSize: 1000` 으로 만든 인스턴스의 `retentionDays` 가 90, `queueSize` 가 1000 이다(옵션 교체 판정에 쓰는 게터).
- `test/unit/server/ServerOptionStore.test.ts` (기존 파일에 케이스 추가)
  - `auditRetentionDays` 생략 → 90, `0` → 0, `3650` → 3650, `3651` → `success: false` 와 메시지 `'auditRetentionDays must be 0 or an integer within 1..3650'`, `1.5` → 실패, `-1` → 실패.
  - `auditQueueSize` 생략 → 1000, `99` → 실패 메시지 `'auditQueueSize must be an integer within 100..100000'`, `100000` → 통과, `100001` → 실패.
- `test/unit/util/SecretRedactor.test.ts` (이미 있는 파일. 케이스만 추가한다)
  - `redactSecrets({totp: '1', code: '2', recoveryCode: '3', Code: '4', keep: '5'})` 가 `{totp: '[REDACTED]', code: '[REDACTED]', recoveryCode: '[REDACTED]', Code: '[REDACTED]', keep: '5'}` 이다.
- `test/unit/server/ServerApp.test.ts` (기존 파일에 추가. 없으면 신규)
  - `auditRetentionDays: 90` 으로 기동한 뒤 `updateServerOption({... auditRetentionDays: 30})` 을 부르면 `AuditSinkRegistry.current()` 가 **다른 인스턴스**이고 그 `retentionDays` 가 30 이며, 옛 인스턴스의 `reserve()` 가 false 다(닫혔다).
  - 같은 값으로 다시 부르면 `AuditSinkRegistry.current()` 가 **같은 인스턴스**다(불필요한 교체 없음).
- `test/component/server/admin/audit-sink.test.ts` (확장)
  - `ADMIN_ROUTES` 의 모든 CUD 항목 호출 뒤 기록된 이벤트의 `type` 이 전부 `AUDIT_EVENT_TYPE_LIST` 에 있다.
- `test/component/server/admin/audit-file.test.ts` (신규, 실제 `AdminServer` + 실제 `FileAuditSink`)
  - 슈퍼유저로 로그인 → `POST /api/groups` → `DELETE /api/groups/:id` → `flush()` 하면 오늘 파일에 `login_success`, `group_created`, `group_deleted` 세 줄이 이 순서로 있고 각 줄의 `actor.username` 이 `'admin'`, `ip` 가 `'127.0.0.1'` 또는 `'::1'`, `sessionIdHash` 가 `SessionStore.sessionIdOf(쿠키의 sessionKey)` 와 같다.
  - 잘못된 비밀번호로 로그인하면 `login_failure` 줄의 `detail.username` 이 입력값이고 `detail.password` 키가 없다.
  - **슈퍼유저 로그인을 먼저 끝낸 뒤**(로그인 이벤트가 큐를 먹지 않도록) `queueSize: 100` 의 `FileAuditSink` 를 `openStream` 스텁(`write` false, `drain` 없음)으로 `AuditSinkRegistry.set` 하고, 그 다음 `POST /api/groups` 를 101번 부르면 앞 100번은 200/409 이고 101번째는 503 `{success: false, status: 503, code: 'audit_unavailable'}` 이며 그 요청은 그룹을 만들지 않는다(`GET /api/groups` 개수 불변). 스텁이 `write` 콜백을 부르지 않으므로 100건 전부가 `queue.length` 에 남아 경계가 정확히 101번째에 걸린다.

기존 `test/component/server/admin/*.test.ts`, `test/unit/server/**` 전부 통과.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run test:browser:install
npm run lint
npx jest --runInBand test/unit/server/audit test/unit/server/ServerOptionStore.test.ts test/unit/util test/component/server/admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U2-08 (단위 2 의 `AuditSink`·`audited()`·`routes.ts`·`IdentityStore`·터널 소유권까지 모두 있어야 이벤트 타입 표의 호출부가 전부 존재한다).
- 후행: U4-02(조회 API 가 이 파일 형식을 읽는다), U4-04·U4-05·U4-08(MFA·세션 이벤트 타입 사용), U5-05·U5-07·U5-08(연결 보안 이벤트).

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §2.1(저장·reserve·pruneRetention), §2.2(이벤트 타입), §3.2(서버 옵션), §6.1(FileAuditSink 테스트), §7(U4-01)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §4.3(`sessionIdOf`), §4.6(AuditSink 계약·`audited()`·`reserve()`), §5.1(`routes.ts`), §8.2(`audit-sink.test.ts`)
- `docs/design/2026-09-11-program-overview.md` §1 D1, §3.1 작업 규약, §3.2 커밋 규약, §3.4 응답 규약
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.4, §5.2.1 NFR-PERF-AUDIT-WRITE-001·NFR-SEC-AUDIT-INTEGRITY-001, §5.2.5, §12 Q3

---

## U4-02

**title**: feat(admin): 감사 로그 조회 API 와 커서 페이지 추가
**labels**: enhancement, area:admin, unit:4
**body**:
## 목적

U4-01 이 쓰는 JSONL 감사 파일을 읽는 `AuditQuery` 와 `GET /api/audit`, `GET /api/audit/types` 를 만든다. 이 이슈가 끝나면 슈퍼유저는 기간·사용자·타입·대상·결과로 필터한 이벤트를 최신순으로 커서 페이지로 받고, 일반 유저는 자기 이벤트만 받는다. 한 번에 하루 파일 하나까지만 메모리에 올린다.

## 배경

### 전제하는 산출물 (착수 시 아래가 저장소에 없으면 코멘트를 남기고 중단한다)

| 파일 | 심볼 | 출처 |
|---|---|---|
| `src/server/audit/FileAuditSink.ts` | `FileAuditSink.fileNameFor(atMs)`, 파일 규칙 `audit-YYYY-MM-DD.jsonl`(UTC), 한 줄 = `AuditEvent` JSON | U4-01 |
| `src/server/audit/AuditEventTypes.ts` | `AUDIT_EVENT_TYPE_LIST`, `isAuditEventType` | U4-01 |
| `src/server/audit/AuditSink.ts` | `type AuditEvent` | 단위 2 §4.6 |
| `src/server/rbac/AdminAuthorizer.ts` | `type Action` 에 `'audit:read-all'`, `'audit:read-self'` 가 있고 `authorize` 가 슈퍼유저에게 둘 다, 일반 유저에게 `audit:read-self` 만 허용 | 단위 2 §4.4 |
| `src/server/admin/routes.ts` | `ADMIN_ROUTES: readonly Route[]`, `type Route = {method; pattern: RegExp; action: Action \| 'public' \| 'session' \| ((ctx: RouteContext) => Action); handler}`, `RouteContext = {req; res; params; principal?; ip}` | 단위 2 §5.1 |
| `src/server/rbac/Principal.ts` | `Principal = {userId; username; role; groupId; attributes; mustChangePassword; legacy?}` | 단위 2 §4.4 |

### 실제로 변경할 기존 파일

- `src/server/admin/AdminServer.ts`: 핸들러 2개 추가. 응답 작성은 기존 `sendApiFailure(res, statusCode, payload)`(`:1334`) 와 성공 응답 규약(`{success: true, partial: false, failedScopes: [], warnings: [], message: '', ...}`)을 따른다.
- `src/server/admin/routes.ts`: 항목 2개 추가.
- `src/Environment.ts:11` `logDir`. 감사 디렉터리는 `Path.join(Environment.path.logDir, 'audit')`.

먼저 열어 볼 파일: `src/server/audit/FileAuditSink.ts`, `src/server/audit/AuditSink.ts`, `src/server/admin/routes.ts`, `src/server/admin/AdminServer.ts`, `test/component/server/admin/audit-file.test.ts`(U4-01).

## 적용되는 결정

- D1 → FR-AUDIT-READ-SU-001(슈퍼유저 전체 열람·필터), FR-AUDIT-READ-SELF-001(일반 유저 본인만), FR-AUDIT-TAMPER-RESIST-001(읽기만).
- 조회 자체는 감사하지 않는다(설계 §2.3).

## 만들 것

### `src/server/audit/AuditQuery.ts` (신규)

```ts
export type AuditTargetKind = 'user' | 'group' | 'tunnel' | 'server' | 'session' | 'security';
export type AuditFilter = {
    from?: number; to?: number;          // epoch ms, 닫힌 구간 [from, to]
    userId?: string;                     // actor.userId 완전 일치
    type?: AuditEventType;
    targetKind?: AuditTargetKind;
    targetId?: string;
    outcome?: 'success' | 'failure';
    limit: number;                       // 1..500
    cursor?: string;
};
export type AuditPage = {events: AuditEvent[]; nextCursor?: string};
export type AuditCursor = {file: string; offset: number; total: number};   // offset = 그 파일의 최신순(뒤집힌) 0 기반 라인 인덱스(필터 적용 전). total = 커서를 만들 때 그 파일의 전체 라인 수
export class AuditQuery {
    constructor(dir: string);
    query(filter: AuditFilter): Promise<AuditPage>;
    static encodeCursor(c: AuditCursor): string;                 // base64url(JSON.stringify(c))
    static decodeCursor(s: string): AuditCursor | undefined;     // 아래 검사를 모두 통과할 때만 값, 아니면 undefined (throw 금지)
}
```

읽기 규칙:

1. **파일 선택.** `dir` 의 `audit-YYYY-MM-DD.jsonl` 을 파일명 날짜 **내림차순**으로 정렬한다. `from`·`to` 가 있으면 날짜가 `[UTC날짜(from), UTC날짜(to)]` 밖인 파일은 열지 않는다. 디렉터리가 없으면 빈 결과.
2. **한 파일 안의 순서.** 파일은 append-only 이므로 줄 순서가 시간순이다. 하루 파일 하나를 `readline.createInterface({input: fs.createReadStream(path)})` 로 라인 배열에 올린 뒤 `reverse()` 해 최신순으로 만든다. 한 번에 파일 하나까지만 메모리에 두고, 다음 파일로 넘어가기 전에 앞 파일 배열을 버린다.
3. **커서.** 첫 페이지는 최신 파일의 `offset 0` 부터. 뒤집힌 배열의 `offset` 부터 순서대로 파싱·필터해 `limit` 만큼 채운다. 채워지면 마지막으로 소비한 라인의 다음 인덱스와 그 파일의 전체 라인 수를 `{file, offset, total}` 으로 인코딩해 `nextCursor` 로 준다. 다음 페이지에서 커서의 파일을 다시 읽었을 때 전체 라인 수 `n` 이 `total` 보다 크면(오늘 파일에 새 이벤트가 append 된 경우) `offset + (n - total)` 부터 이어 간다 — 뒤집힌 인덱스는 append 로 밀리지만 `total` 로 보정하므로 페이지 사이에 같은 이벤트가 다시 보이지 않는다. `n < total` 이면(파일이 바뀐 비정상 상황) `offset 0` 부터. 파일 끝에 이르면 다음(더 오래된) 파일의 `offset 0` 으로 넘어간다(그 파일의 `total` 은 그때 읽은 라인 수). 마지막 파일까지 다 소비하면 `nextCursor` 를 넣지 않는다. 커서의 `file` 이 더 이상 없으면(보존 삭제) 그보다 오래된 파일부터 이어 간다.
4. **손상된 줄.** `JSON.parse` 가 실패하거나 `at`·`type`·`outcome` 이 없는 줄은 건너뛰고 파일당 1회만 `logger.warn` 을 남긴다. 파싱 실패로 요청이 실패하지 않는다.
5. **`limit`.** `AuditQuery` 는 검증된 정수 1..500 만 받는다. 쿼리 문자열 → 숫자 변환과 검증은 라우트 핸들러가 한다.
5.1. **커서 검사의 주체는 `decodeCursor` 하나다.** `decodeCursor(s)` 가 base64url 디코드·`JSON.parse`·`file` 이 `^audit-\d{4}-\d{2}-\d{2}\.jsonl$` 에 맞는지·`offset` 과 `total` 이 각각 0 이상 정수인지·`offset <= total` 인지를 **모두** 검사하고, 하나라도 어긋나면 `undefined` 를 돌려준다. 라우트 핸들러는 그 `undefined` 하나만 보고 422 `invalid cursor` 를 낸다(핸들러가 필드를 다시 검사하지 않는다).
6. **타입 목록.** `GET /api/audit/types` 는 파일을 읽지 않고 `AUDIT_EVENT_TYPE_LIST` 를 돌려준다.

### 라우트 2개 (`routes.ts`)

| 메서드·경로 | action | 요청 | 응답 |
|---|---|---|---|
| `GET /api/audit` | 함수형: `ctx.principal.role === 'superuser' ? 'audit:read-all' : 'audit:read-self'` | 쿼리 `from`, `to`(epoch ms 정수), `userId`, `type`, `targetKind`, `targetId`, `outcome`, `limit`(기본 100, 최대 500), `cursor` | `{events, nextCursor?}` 최신순. 일반 유저는 요청의 `userId` 를 무시하고 `principal.userId` 로 강제 |

일반 유저 필터는 `actor.userId` 완전 일치이므로 **본인의 `login_failure` 는 자기 목록에 나오지 않는다**(그 이벤트의 `actor` 는 `{userId: 'system'}` 이고 사용자명만 `detail.username` 에 있다. U4-01 이벤트 타입 표). 이것은 의도된 동작이다. 실패한 로그인은 사용자를 특정하지 못한 상태에서 기록되므로 사칭자가 남의 목록을 오염시킬 수 없어야 한다. 슈퍼유저는 `GET /api/audit?type=login_failure` 로 전수를 본다.
| `GET /api/audit/types` | 위와 같음 | — | `{types: string[]}` |

검증 실패는 422 이고 `message` 는 아래 문자열 그대로:

| 조건 | message |
|---|---|
| `from`·`to` 가 정수가 아님 | `from and to must be epoch milliseconds` |
| `from > to` | `from must not exceed to` |
| `limit` 이 정수 1..500 밖 | `limit must be an integer within 1..500` |
| `type` 이 `isAuditEventType` 아님 | `unknown audit type` |
| `outcome` 이 `success`/`failure` 아님 | `outcome must be success or failure` |
| `targetKind` 가 6종 밖 | `unknown target kind` |
| `cursor` 디코드 실패, `offset`·`total` 이 0 이상 정수가 아님, `offset > total`, 또는 `file` 이 `^audit-\d{4}-\d{2}-\d{2}\.jsonl$` 아님 | `invalid cursor` |

요청·응답 예시:

```
GET /api/audit?type=group_created&from=1757548800000&to=1757635200000&limit=2
→ 200
{"success": true, "partial": false, "failedScopes": [], "warnings": [], "message": "",
 "events": [
   {"at": 1757600000000, "actor": {"userId": "u_3f9a1c2e7b4d5a60", "username": "admin", "role": "superuser"},
    "sessionIdHash": "9f2c1a7b3e4d5c6a", "ip": "127.0.0.1", "type": "group_created",
    "target": {"kind": "group", "id": "g_7c1d2e3f4a5b6c7d"}, "outcome": "success",
    "summary": "Created group Field team", "detail": {"name": "Field team"}},
   {"at": 1757590000000, "actor": {"userId": "u_3f9a1c2e7b4d5a60", "username": "admin", "role": "superuser"},
    "type": "group_created", "target": {"kind": "group", "id": "g_1111222233334444"}, "outcome": "failure",
    "summary": "Create group rejected: name_taken"}
 ],
 "nextCursor": "eyJmaWxlIjoiYXVkaXQtMjAyNi0wOS0xMS5qc29ubCIsIm9mZnNldCI6NywidG90YWwiOjQxfQ"}

GET /api/audit?cursor=eyJmaWxlIjoiYXVkaXQtMjAyNi0wOS0xMS5qc29ubCIsIm9mZnNldCI6NywidG90YWwiOjQxfQ&limit=2
→ 200 {"success": true, "partial": false, "failedScopes": [], "warnings": [], "message": "", "events": [ ... ]}
      (마지막 페이지에는 nextCursor 키가 없다)

GET /api/audit?limit=0
→ 422 {"success": false, "status": 422, "message": "limit must be an integer within 1..500"}
      (`sendApiFailure` 는 `status` 를 자동으로 넣지 않는다. 위 검증 실패 응답은 전부 payload 에 `status: 422` 를 직접 담는다)

GET /api/audit/types
→ 200 {"success": true, "partial": false, "failedScopes": [], "warnings": [], "message": "",
       "types": ["login_success", "login_failure", "mfa_success", "...", "audit_retention_pruned"]}
```

## 변경할 것

- `src/server/admin/routes.ts`: 두 항목 추가.
- `src/server/admin/AdminServer.ts`: `AuditQuery` 인스턴스는 생성자에서 한 번 만든다(`new AuditQuery(Path.join(Environment.path.logDir, 'audit'))`). 핸들러는 쿼리 파싱·검증 → `query(filter)` → 성공 응답.
- 삭제할 파일 없음.

## 하지 말 것

- 여러 날짜 파일을 동시에 메모리에 올리지 않는다. 파일 하나를 다 소비하거나 페이지가 차면 배열을 버린다.
- 감사 파일 옆에 인덱스 파일이나 캐시 파일을 만들지 않는다.
- 이 조회를 `audited()` 로 감싸지 않는다.
- 일반 유저의 `userId` 쿼리를 403 으로 거부하지 않는다. 조용히 본인으로 덮어쓴다.
- 커서에 파일 경로 전체를 넣지 않는다(파일명만).
- 파싱 실패를 상위로 전파하지 않는다. 손상된 줄 건너뛰기는 정상 분기다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트. **`AdminServer` 를 띄우는 컴포넌트 테스트는 감사 파일을 읽기 전에 `await (AuditSinkRegistry.current() as FileAuditSink).flush()` 를 부른다**(싱크의 쓰기는 응답 경로와 분리되어 있으므로 flush 없이 파일을 읽으면 단언이 플래키하다). `AuditSink` 인터페이스에는 `flush` 가 없으므로 `as FileAuditSink` 로 좁혀 부른다.

- `test/unit/server/audit/AuditQuery.test.ts` (임시 디렉터리에 3일치 파일을 직접 쓴다: `audit-2026-09-09.jsonl` 3줄, `audit-2026-09-10.jsonl` 4줄, `audit-2026-09-11.jsonl` 5줄. 각 줄의 `at` 은 파일 날짜 안에서 오름차순, `actor.userId` 는 `u_a`/`u_b` 교대, `type` 은 `user_created`/`group_created` 교대, `outcome` 은 `success`/`failure` 교대, `target` 은 `{kind: 'group', id: 'g_1'}` 과 `{kind: 'user', id: 'u_b'}` 교대)
  - 필터 없이 `limit: 500` 이면 12건이 `at` 내림차순이고 `nextCursor` 가 없다.
  - `limit: 5` 첫 페이지는 9월 11일 5건이고 `nextCursor` 가 `{file: 'audit-2026-09-11.jsonl', offset: 5, total: 5}` 를 인코딩한 값이다. 그 커서로 `limit: 5` 를 부르면 9월 10일 4건 + 9월 9일 최신 1건이고 `nextCursor` 가 `{file: 'audit-2026-09-09.jsonl', offset: 1, total: 3}` 이다. 세 번째 페이지는 2건이고 `nextCursor` 가 없다. 세 페이지 합집합이 12건이고 중복이 없다.
  - `limit: 2` 첫 페이지(9월 11일 최신 2건, `nextCursor = {file: 'audit-2026-09-11.jsonl', offset: 2, total: 5}`)를 받은 뒤 9월 11일 파일에 2줄을 더 append 하고 그 커서로 `limit: 2` 를 부르면 첫 페이지의 2건과 겹치지 않고 첫 페이지 다음 이벤트(원래 3·4번째로 최신인 것)부터 이어지며 `nextCursor.total` 이 7 이다. 새로 append 된 2건은 어느 페이지에도 나오지 않는다.
  - `userId: 'u_a'` 이면 전 건의 `actor.userId` 가 `'u_a'` 이다.
  - `type: 'group_created'`, `outcome: 'failure'` 를 함께 주면 두 조건을 모두 만족하는 건만 나온다.
  - `type: 'group_created'`, `limit: 2` 의 `nextCursor.offset` 은 필터 통과 건수가 아니라 소비한 라인 수 기준이다(9월 11일 파일에서 `group_created` 가 뒤집힌 인덱스 1·3 이면 offset 4).
  - `from`·`to` 를 9월 10일 00:00:00Z~23:59:59.999Z 로 주면 4건이고, `from` 을 9월 10일 두 번째 이벤트의 `at` 으로 주면 3건이다(닫힌 구간).
  - `targetKind: 'group'`, `targetId: 'g_1'` 이면 해당 target 만 나온다.
  - 9월 10일 파일 중간에 `not json` 한 줄과 `{"at": 1}` 한 줄을 끼워 넣어도 나머지 4건이 정상으로 나온다.
  - 커서의 `file` 을 `audit-2026-09-10.jsonl` 로 준 뒤 그 파일을 지우면 9월 9일 3건이 나온다.
  - `decodeCursor('***')` 가 `undefined` 이고, `decodeCursor(encodeCursor({file: 'audit-2026-09-10.jsonl', offset: 2, total: 4}))` 가 같은 객체다. `total` 이 없는 JSON 을 인코딩한 값은 `undefined`. `{file: 'evil.jsonl', offset: 0, total: 0}`, `{file: 'audit-2026-09-10.jsonl', offset: -1, total: 4}`, `{offset: 1.5, …}`, `{offset: 5, total: 4}` 를 인코딩한 값도 전부 `undefined` 다.
  - 디렉터리가 없으면 `events: []` 이고 `nextCursor` 가 없다.
- `test/component/server/admin/audit-api.test.ts` (신규, 실제 `AdminServer` + 실제 `FileAuditSink`)
  - 슈퍼유저 `admin` 으로 그룹 생성·수정·삭제, 사용자 `alice` 생성 후 `GET /api/audit?limit=100` 을 부르면 `events[].type` 에 `user_created`, `group_deleted`, `group_updated`, `group_created`, `login_success` 가 이 순서(최신순)로 나타난다(사이에 `temp_password_issued` 가 끼어도 된다).
  - `GET /api/audit?type=group_created` 는 1건이다.
  - `alice`(일반 유저)로 로그인해 `PUT /api/me/password` 를 부른 뒤 `GET /api/audit` 를 부르면 모든 `events[].actor.userId` 가 alice 의 id 이고 `admin` 의 이벤트는 없다. `GET /api/audit?userId=<admin id>` 를 불러도 결과가 같다.
  - `alice` 의 `password_changed` 이벤트 `detail` 에 `currentPassword`·`newPassword` 키가 있다면 값이 `"[REDACTED]"` 이다(키가 없어도 통과).
  - `GET /api/audit?limit=501` 은 422 이고 `message` 가 `limit must be an integer within 1..500` 이다. `?from=abc` 는 422 `from and to must be epoch milliseconds`. `?cursor=zzz` 는 422 `invalid cursor`.
  - `GET /api/audit/types` 의 `types` 가 `AUDIT_EVENT_TYPE_LIST` 와 같다.
  - 세션 없이 `GET /api/audit` 는 401.
  - 조회를 10번 해도 감사 파일 줄 수가 늘지 않는다.

기존 `test/component/server/admin/*.test.ts` 전부 통과.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run test:browser:install
npm run lint
npx jest --runInBand test/unit/server/audit test/component/server/admin/audit-api.test.ts test/component/server/admin/audit-file.test.ts
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U4-01.
- 후행: U4-06(AuditScreen 이 두 엔드포인트를 쓴다).

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §2.3(조회 API·커서), §6.1(AuditQuery 테스트), §6.2(audit-api), §7(U4-02). **설계와 다른 점**: 설계 §2.3 의 커서는 `{file, offset}` 두 필드이지만 이 이슈는 `total` 을 더한 세 필드로 정한다. 오늘 파일은 조회 사이에도 append 되는데, 최신순 인덱스는 append 될 때마다 앞으로 밀리므로 `offset` 만으로는 다음 페이지가 이미 보여 준 이벤트를 다시 낸다. 커서를 만들 때의 전체 라인 수를 함께 담아 `offset + (n - total)` 로 보정하면 그 중복이 사라진다(규칙 3).
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §4.4(`audit:read-all`·`audit:read-self`), §5.1(`routes.ts`·함수형 action)
- `docs/design/2026-09-11-program-overview.md` §3.4 응답 규약
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.4 FR-AUDIT-READ-SU-001·FR-AUDIT-READ-SELF-001, §5.2.1 NFR-SEC-AUDIT-INTEGRITY-001

---

## U4-03

**title**: feat(admin): RFC 6238 TOTP 와 복구 코드를 Node crypto 만으로 구현
**labels**: enhancement, area:admin, unit:4
**body**:
## 목적

외부 의존성 없이 Node `crypto` 만으로 RFC 4648 Base32, RFC 4226 HOTP, RFC 6238 TOTP(HMAC-SHA1, 30초, 6자리, ±1 스텝, 재사용 거부), otpauth URI, 복구 코드(생성·정규화·해시)를 순수 함수 모듈로 만든다. 이 이슈는 서버·API·저장소를 건드리지 않으며 선행 이슈가 없다. 로그인 흐름과 API 는 U4-04.

## 배경

이 이슈가 만드는 것은 새 파일 두 개와 테스트뿐이다. 전제하는 산출물은 없다.

### 참고할 기존 파일

- `src/util/timingSafeStringEqual.ts` `timingSafeStringEqual(a: string | Buffer, b: string | Buffer, encoding: BufferEncoding = 'hex', expectedLength?: number): boolean`. 길이 불일치도 상수 시간으로 false. **`encoding` 이 `'hex'`(기본값)이면 `:60-63` 에서 두 인자가 `/^[0-9a-fA-F]*$/` 이고 길이가 짝수인지 먼저 검사하고, 어긋나면 내용과 무관하게 false 를 돌려준다.** 따라서 hex 로 비교할 값은 반드시 실제 hex 문자열이어야 한다(sha256 은 64자). 비밀값 비교는 저장소 규칙(`npm run lint` = `scripts/lint-auth-compare.mjs src --strict`, 식별자 8종 `authKey|proof|token|secret|hmac|bindingToken|challengeNonce|sessionId` 에 `===`·`!==`·`==`·`!=` 금지, 대소문자 무시)에 따라 **이 함수만** 쓴다. 코드는 6자리 ASCII 이므로 `encoding: 'utf8'`.
- `src/util/ClockRng.ts` `ClockRngProvider.current().now()` — 시간이 필요한 곳은 인자로 받으므로 이 모듈은 시계를 직접 읽지 않는다.

먼저 열어 볼 파일: `src/util/timingSafeStringEqual.ts`, `scripts/lint-auth-compare.mjs`(어떤 비교가 걸리는지), `test/unit/server/req-04-constant-time-compare.test.ts`(테스트 본보기).

## 적용되는 결정

- D1 → FR-MFA-ENROLL-001, FR-MFA-ENFORCE-001 의 코드 검증 알고리즘 부분.
- 프로그램 개요 §3.1: 새 코드는 예외를 제어 흐름으로 쓰지 않는다. 이 모듈의 모든 함수는 형식 오류를 반환값으로 알린다.

## 만들 것

### `src/server/mfa/Base32.ts` (신규)

RFC 4648 §6 Base32, 알파벳 `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`, **패딩 없음**.

```ts
export const base32Encode = (bytes: Buffer): string;       // 5비트 단위로 잘라 알파벳 사상. 마지막 조각은 0 으로 채움. '=' 를 붙이지 않는다
export const base32Decode = (text: string): Buffer | undefined;   // 대소문자 무시, '=' 와 공백 제거 후 디코드. 알파벳 밖 문자가 있으면 undefined (throw 금지). 남는 비트는 버린다
```

### `src/server/mfa/Totp.ts` (신규)

```ts
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;                        // ±1 스텝
export const TOTP_SECRET_BYTES = 20;
export const generateSecret = (): Buffer;            // crypto.randomBytes(20)
export const stepOf = (nowMs: number): number;       // Math.floor(nowMs / 1000 / 30)
export const hotp = (secret: Buffer, counter: number): string;    // RFC 4226. 아래 구현 지침
export const generate = (secret: Buffer, nowMs: number): string;  // hotp(secret, stepOf(nowMs))
export type VerifyResult = {ok: true; step: number} | {ok: false; reason: 'format' | 'mismatch' | 'replayed'};
export const verify = (secret: Buffer, code: string, nowMs: number, lastUsedStep: number): VerifyResult;
export const otpauthUri = (username: string, secretBase32: string): string;
export const RECOVERY_CODE_COUNT = 10;
export const generateRecoveryCodes = (): string[];   // 10개, 'xxxx-xxxx', 서로 다름
export const hashRecoveryCode = (code: string, userId: string): string;   // sha256(code + userId) hex
export const normalizeRecoveryCode = (input: string): string | undefined; // 소문자화·공백 제거, 'xxxxxxxx' 이면 'xxxx-xxxx' 로. 형식 밖이면 undefined
export const findRecoveryCodeHash = (hashes: readonly string[], hash: string): number;   // timingSafeStringEqual 로 전수 비교, 인덱스 또는 -1
```

HMAC-SHA1 · 동적 절단 구현 지침(RFC 4226 §5.3):

```ts
const hotp = (secret: Buffer, counter: number): string => {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));                 // 8바이트 big-endian 카운터
    const mac = crypto.createHmac('sha1', secret).update(msg).digest();   // 20바이트
    const offset = mac[19] & 0x0f;
    const bin = ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16)
              | ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff);
    return String(bin % 1_000_000).padStart(6, '0');
};
```

`verify` 규칙:
1. `code` 가 `/^\d{6}$/` 가 아니면 `{ok: false, reason: 'format'}`(정규식 검사, 예외 아님).
2. `step = stepOf(nowMs)`. `[step - 1, step, step + 1]` 각각에 대해 `timingSafeStringEqual(hotp(secret, s), code, 'utf8')` 를 **세 번 모두** 계산한 뒤(조기 return 없이) 맞은 스텝을 고른다. 하나도 안 맞으면 `mismatch`.
3. 맞은 `s` 가 `lastUsedStep` 이하이면 `replayed`(같은 코드는 물론 더 이른 스텝의 코드도 거부). 아니면 `{ok: true, step: s}`. 호출자(U4-04)가 `s` 를 `mfa.lastUsedStep` 에 저장한다. 처음 등록 확인 때는 `lastUsedStep = -1` 을 넘긴다.

`otpauthUri`: 정확히 `otpauth://totp/TTTGate:${encodeURIComponent(username)}?secret=${secretBase32}&issuer=TTTGate&algorithm=SHA1&digits=6&period=30`.

복구 코드: 각 8자는 알파벳 `abcdefghijklmnopqrstuvwxyz0123456789` 에서 `crypto.randomInt(36)` 으로 뽑는다. 형식 `xxxx-xxxx`. 10개가 서로 다를 때까지 다시 뽑는다(`Set` 크기 검사 루프, 예외 아님). `hashRecoveryCode` 는 `crypto.createHash('sha256').update(code + userId).digest('hex')`. `findRecoveryCodeHash` 는 배열 전체를 순회하며 `timingSafeStringEqual(h, hash, 'hex')` 를 부르고 처음 일치한 인덱스를 기억해 순회가 끝난 뒤 돌려준다(`includes`·`indexOf` 금지).

### 테스트 벡터 (RFC 6238 부록 B, SHA1)

비밀은 ASCII `12345678901234567890`(20바이트, hex `3132333435363738393031323334353637383930`, Base32 `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`).

| 시간(초) | T (카운터) | 8자리 (RFC) | 6자리 (이 구현) |
|---|---|---|---|
| 59 | 1 | `94287082` | `287082` |
| 1111111109 | 0x23523EC | `07081804` | `081804` |
| 1234567890 | 0x273EF07 | `89005924` | `005924` |
| 2000000000 | 0x3F940AA | `69279037` | `279037` |

6자리 구현은 8자리 값의 뒤 6자리와 같다(`bin % 10^6` 은 `bin % 10^8` 의 하위 6자리). RFC 4226 부록 D 의 HOTP 벡터(같은 비밀): counter 0 → `755224`, 1 → `287082`, 2 → `359152`, 3 → `969429`, 4 → `338314`, 5 → `254676`, 6 → `287922`, 7 → `162583`, 8 → `399871`, 9 → `520489`.

## 변경할 것

- 없음. 기존 파일을 건드리지 않는다.

## 하지 말 것

- `otplib`, `speakeasy`, `thirty-two`, `hi-base32` 같은 패키지를 추가하지 않는다. `crypto` 만.
- 코드·해시 비교에 `===`, `includes`, `indexOf`, `crypto.timingSafeEqual` 직접 호출을 쓰지 않는다. `timingSafeStringEqual` 만.
- `verify` 안에서 맞는 스텝을 찾자마자 return 하지 않는다(세 스텝 모두 계산).
- `verify`·`base32Decode`·`normalizeRecoveryCode` 가 예외를 던지거나 잡지 않는다. 형식 오류·불일치·재사용은 모두 반환값이다.
- `Date.now()` 나 `ClockRngProvider` 를 이 모듈 안에서 읽지 않는다. 시간은 인자.
- SHA256·SHA512 TOTP 변형, 8자리, 다른 스텝 길이를 옵션으로 만들지 않는다.
- 이 이슈에서 `AdminServer`·`IdentityStore`·서버 옵션·라우트를 건드리지 않는다(U4-04).

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/unit/server/mfa/Base32.test.ts`
  - `base32Encode(Buffer.from('12345678901234567890', 'ascii'))` 가 `'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'` 이다.
  - `base32Encode(Buffer.from(''))` 가 `''`, `base32Encode(Buffer.from('f'))` 가 `'MY'`, `'fo'` → `'MZXQ'`, `'foo'` → `'MZXW6'`, `'foob'` → `'MZXW6YQ'`, `'fooba'` → `'MZXW6YTB'`, `'foobar'` → `'MZXW6YTBOI'` (RFC 4648 §10 벡터에서 `=` 를 뺀 것).
  - 무작위 20바이트 100개에 대해 `base32Decode(base32Encode(b))` 가 `b` 와 같다.
  - `base32Decode('mzxw6ytboi')`(소문자) 와 `base32Decode('MZXW6YTBOI======')`(패딩) 가 둘 다 `'foobar'` 이다. `base32Decode('MZ1')` 과 `base32Decode('MZX-')` 는 `undefined` 이다.
- `test/unit/server/mfa/Totp.test.ts` (비밀 `Buffer.from('12345678901234567890', 'ascii')`)
  - `generate(secret, 59_000)` 이 `'287082'`.
  - `generate(secret, 1_111_111_109_000)` 이 `'081804'`.
  - `generate(secret, 1_234_567_890_000)` 이 `'005924'`.
  - `generate(secret, 2_000_000_000_000)` 이 `'279037'`.
  - `hotp(secret, 0)` 이 `'755224'`, `hotp(secret, 1)` 이 `'287082'`, `hotp(secret, 9)` 가 `'520489'`.
  - `stepOf(59_000)` 이 1, `stepOf(1_111_111_109_000)` 이 `0x23523EC`.
  - `now = 1_234_567_890_000` 에서 `verify(secret, generate(secret, now - 30_000), now, -1)` 과 `+30_000` 이 `ok: true`(각각 `step` 이 `stepOf(now) - 1`, `+ 1`), `-60_000` 과 `+60_000` 이 `{ok: false, reason: 'mismatch'}`.
  - `verify(secret, '28708', now, -1)`, `'28708a'`, `' 287082'` 가 `reason: 'format'`.
  - `verify(secret, generate(secret, now), now, stepOf(now))` 이 `reason: 'replayed'`; `lastUsedStep = stepOf(now)` 인데 코드가 `now - 30_000` 의 것이면 `replayed`; `lastUsedStep = stepOf(now) - 1` 이고 코드가 `now` 의 것이면 `ok: true`.
  - `generateSecret()` 이 길이 20 이고 100번 호출해 전부 다르다.
  - `otpauthUri('alice', 'ABC')` 가 정확히 `'otpauth://totp/TTTGate:alice?secret=ABC&issuer=TTTGate&algorithm=SHA1&digits=6&period=30'` 이고 `otpauthUri('a b', 'ABC')` 의 label 이 `TTTGate:a%20b` 이다.
  - `generateRecoveryCodes()` 가 길이 10, 각 원소가 `/^[a-z0-9]{4}-[a-z0-9]{4}$/`, 중복 없음. 200번 생성해도 형식이 유지된다.
  - `hashRecoveryCode('ab12-cd34', 'u_1')` 이 `crypto.createHash('sha256').update('ab12-cd34u_1').digest('hex')` 와 같다.
  - `normalizeRecoveryCode(' AB12CD34 ')` 가 `'ab12-cd34'`, `normalizeRecoveryCode('ab12-cd34')` 가 `'ab12-cd34'`, `normalizeRecoveryCode('ab12-cd3')` 와 `normalizeRecoveryCode('ab12_cd34')` 가 `undefined`.
  - `findRecoveryCodeHash` 의 입력은 실제 sha256 hex 64자여야 한다(`timingSafeStringEqual` 이 hex 형식을 검사하므로 `'h1'` 같은 값은 언제나 false 다). `H1 = hashRecoveryCode('ab12-cd34', 'u_1') = 'a2da249db43c0533ec93bd2a270f46340fa997586ee5a1606b5df719b2225de1'`, `H2 = hashRecoveryCode('ef56-gh78', 'u_1') = '2f6d2cd72b171ca7a86bb445fcbdb0dc2e3464342f7930032bbb7a51be63c921'`, `H3 = hashRecoveryCode('ij90-kl12', 'u_1') = '90d5033c31b84454cdf5929cd6a2f4acf46ebcc01cf5af8304c18a1989658da4'`, `HX = hashRecoveryCode('zz99-yy88', 'u_1') = 'b75aa027f19bdbf1aae770443c993cc178d53a899e661377472a35a535e4c0e9'` 일 때 `findRecoveryCodeHash([H1, H2, H3], H2)` 가 1, `findRecoveryCodeHash([H1, H2, H3], HX)` 가 -1, `findRecoveryCodeHash([], H1)` 이 -1 이다.
  - `findRecoveryCodeHash([H1, H2, H3], 'not-hex')` 가 -1 이다(형식 오류를 예외가 아니라 불일치로 다룬다).
- `npm run lint` 가 `src/server/mfa/*.ts` 에 대해 위반 0건.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run test:browser:install
npm run lint
npx jest --runInBand test/unit/server/mfa
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: 없음. 언제든 시작할 수 있다.
- 후행: U4-04(본인 MFA API), U4-08(2단계 로그인이 `verify`·`normalizeRecoveryCode` 를 쓴다), U4-07·U4-09(브라우저 테스트가 `generate`·`base32Decode` 로 코드를 계산한다).

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §3.1(Totp), §6.1(Totp 테스트 벡터), §7(U4-03)
- `docs/design/2026-09-11-program-overview.md` §3.1(예외 규약)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.5
- RFC 6238 부록 B(테스트 벡터), RFC 4226 §5.3(동적 절단)·부록 D, RFC 4648 §6·§10(Base32)

---

## U4-04

**title**: feat(admin): 본인 MFA 등록·해제·복구 코드 API 추가
**labels**: enhancement, area:admin, unit:4
**body**:
## 목적

U4-03 의 `Totp` 위에 사용자가 자기 MFA 를 등록·확인·해제하고 복구 코드를 재발급하는 `/api/me/mfa/*` 네 개를 만든다. 이 이슈가 끝나면 사용자 레코드에 `mfa` 가 저장되고, `GET /api/me` 가 `mfa: {enabled, recoveryCodesRemaining}` 를 돌려주며, `UserView` 에 `mfaEnabled` 가 생긴다. 2단계 로그인(`/api/login` 분기·`POST /api/login/mfa`), 슈퍼유저 강제 게이트(`mustEnrollMfa`), 남의 MFA 초기화(`POST /api/users/:id/mfa/reset`)는 **U4-08** 이 이 위에 얹는다. 화면은 U4-07·U4-09.

## 배경

### 전제하는 산출물 (착수 시 아래가 저장소에 없으면 코멘트를 남기고 중단한다)

| 파일 | 심볼 | 출처 |
|---|---|---|
| `src/server/mfa/Totp.ts`, `src/server/mfa/Base32.ts` | `generateSecret`, `verify`, `otpauthUri`, `generateRecoveryCodes`, `hashRecoveryCode`, `normalizeRecoveryCode`, `findRecoveryCodeHash`, `base32Encode`, `base32Decode` | U4-03 |
| `src/server/rbac/IdentityStore.ts` | `IdentityStore.instance`, `user(id)`, `userByUsername(name)`, `verifyPassword(username, password): Promise<{user} \| {reason}>`, `updateUser(id, patch)`, 원자 저장(`Files.writeAtomicSync`) | 단위 2 §4.1 |
| 같은 파일 | `export type Result<T> = {success: true; value: T} \| {success: false; status: 404 \| 409 \| 422; code: string; message: string}` — **status 는 이 세 값으로 닫혀 있다.** 새 실패 상태를 쓰려면 라우트에서 매핑한다 | 단위 2 §4.1 |
| `src/server/admin/rbacRoutes.ts` | `rbacRouteTable(): Route[]`, `RouteContext.ok(payload?, status?)`·`ctx.fail(status, payload)`, `replyResult(ctx, result, onSuccess, successStatus?)` | 단위 2 §5.2 |
| `src/server/rbac/IdentityTypes.ts` | `type User = {id; username; displayName; role; status; groupId; passwordHash; mustChangePassword; migratedFromLegacyAdmin; migrationAcknowledged; createdAt; updatedAt}` | 단위 2 §3 |
| `src/server/rbac/AdminAuthorizer.ts` | `type Action`, `authorize(principal, action, target)`, `mustChangePassword` 게이트(`me:read`·`me:password` 외 403 `password_change_required`) | 단위 2 §4.4 |
| `src/server/rbac/Principal.ts` | `Principal` | 단위 2 §4.4 |
| `src/server/admin/SessionStore.ts` | `type Session`, `newSession(userId, {ip, userAgent})`, `resolveSession(keys)`, `removeSessionsOfUser(userId, options?: {except?: string}): number`, `static sessionIdOf(key)` | 단위 2 §4.3 |
| `src/server/admin/routes.ts`, `AdminServer.ts` | `ADMIN_ROUTES`, `audited()`, `PUT /api/me/password` 핸들러(비밀번호 확인이 필요한 me 계열 라우트의 본보기) | 단위 2 §5.1·§5.2 |
| `src/server/audit/AuditEventTypes.ts` | `AUDIT_EVENT_TYPES.mfa_enrolled`·`mfa_disabled`·`mfa_recovery_codes_regenerated` — U4-01 이 아직 없으면 같은 이름의 문자열 리터럴을 쓰고 U4-01 이 상수로 치환한다 | U4-01 |
| `test/component/server/admin/rbac-login.test.ts` | 로그인 테스트 헬퍼 패턴 | 단위 2 §8.2 |

### 실제로 변경할 기존 파일 (현재 저장소 기준)

- `src/server/admin/AdminServer.ts:34-38` 백오프 상수 `LOGIN_WINDOW_MS = 60_000`, `LOGIN_BLOCK_MS = 60_000`, `LOGIN_MAX_FAILURES = 5`, `LOGIN_ATTEMPT_MAP_LIMIT = 10_000`. `:68` `_loginAttempts: Map<string, LoginAttemptState>`. `:1360` `getClientAddress(req)`, `:1398` `buildLoginAttemptKey(req)`(IPv4 /24, IPv6 /64 버킷), `:1402` `isLoginBlocked(req)`, `:1407` `recordLoginFailure(req)`, `:1431` `resetLoginAttempts(req)`, `:1435` `delayFailedLogin(req)`(`computeBackoffMs(failedCount)` 만큼 대기). **이 이슈의 `/api/me/mfa/*` 는 세션이 있는 요청이므로 이 네 함수를 부르지 않는다**(2단계 로그인의 백오프는 U4-08).
- `src/server/admin/AdminServer.ts:1352` `now()` = `ClockRngProvider.current().now()`. MFA 저장소의 시계는 이 함수를 쓴다.
- `src/types/TunnelingOption.ts:52-66` `ServerOption`. `mfaRequiredForSuperusers?: boolean` 추가.
- `src/server/ServerOptionStore.ts:339` `verificationServerOption`: `option.adminTls = option.adminTls === true;`(`:384`) 옆에 `option.mfaRequiredForSuperusers = option.mfaRequiredForSuperusers === true;` 추가.
- `src/util/SecretRedactor.ts:12` `secret` 접미사 규칙이 `mfa.secret` 을 덮는다. `totp`·`code`·`recoverycode` 키 추가는 U4-01 범위이며 이 이슈는 `SecretRedactor` 를 건드리지 않는다.

먼저 열어 볼 파일: `src/server/admin/AdminServer.ts`(1035~1075행, 1330~1360행), `src/server/admin/routes.ts`, `src/server/admin/rbacRoutes.ts`, `src/server/rbac/IdentityStore.ts`, `src/server/rbac/IdentityTypes.ts`, `src/server/rbac/AdminAuthorizer.ts`, `src/server/mfa/Totp.ts`, `test/component/server/admin/rbac-login.test.ts`.

## 적용되는 결정

- D1 → FR-MFA-ENROLL-001(등록·해제, QR + 복구 코드 1회 노출), FR-MFA-SU-POLICY-001(슈퍼유저 강제 토글의 서버 옵션 부분), NFR-SEC-NEW-ENDPOINT-CSRF-001(새 상태 변경 API 는 CSRF 적용. 이 이슈가 만드는 네 라우트는 전부 CSRF 대상이다).
- PRD §12 Q1 가정: `mfaRequiredForSuperusers` 기본 false. Q4 가정: 강제 대상이 아니면 일반 유저·슈퍼유저 모두 본인 MFA 해제 가능.
- 프로그램 개요 §3.1: 새 코드는 예외를 제어 흐름으로 쓰지 않고 잠금 대신 원자 연산을 쓴다.

## 만들 것

### 사용자 레코드 확장 (`src/server/rbac/IdentityTypes.ts`, `identity.yaml`)

```ts
export type UserMfa = {
    enabled: boolean;
    secret: string;               // base32. API 응답·감사 detail 에 절대 노출 금지 (SecretRedactor 의 'secret' 접미사가 덮는다)
    enrolledAt: number;
    lastUsedStep: number;
    recoveryCodeHashes: string[];
};
// User 에 추가
    mfa?: UserMfa;                // 없으면 MFA 없음
```

`IdentityStore` 에 추가(모두 원자 저장):

```ts
    setMfa(id: string, mfa: UserMfa): Result<void>;
    clearMfa(id: string): Result<void>;                          // mfa 필드 제거
    markMfaStep(id: string, step: number): Result<void>;         // lastUsedStep 갱신
    replaceRecoveryCodeHashes(id: string, hashes: string[]): Result<void>;
    consumeRecoveryCode(id: string, hash: string): Result<{remaining: number}>;   // findRecoveryCodeHash 로 찾아 제거
```

`consumeRecoveryCode` 의 실패값은 `{success: false, status: 422, code: 'recovery_code_invalid', message: 'The code is incorrect.'}` 다. **`Result<T>` 의 `status` 는 단위 2 가 `404 | 409 | 422` 로 닫아 두었으므로 401 을 여기서 돌려줄 수 없다.** 로그인 응답에 필요한 401 은 이 값을 쓰는 라우트(U4-08 의 `POST /api/login/mfa`)가 `recovery_code_invalid` 를 보고 401 `mfa_code_invalid` 로 바꿔 응답한다. `Result` 의 status 유니온을 넓히지 않는다.

`UserView`(단위 2 §5.2) 에 `mfaEnabled: boolean` 을 추가하고 `mfa` 객체 자체는 어떤 API 응답에도 넣지 않는다. `/api/me` 응답에 `mfa: {enabled: boolean; recoveryCodesRemaining: number}` 를 추가한다(`mustEnrollMfa` 는 U4-08).

### `src/server/mfa/MfaTickets.ts` (신규, 메모리)

**이 파일은 이 이슈가 두 클래스를 모두 만든다.** `PendingEnrollmentStore` 는 이 이슈의 `enroll`·`confirm` 이 쓰고, `MfaTicketStore` 는 U4-08 의 2단계 로그인이 쓴다(같은 파일을 두 이슈가 나눠 만들면 병합이 꼬이므로 한 번에 만들고 U4-08 은 쓰기만 한다).

```ts
export type MfaTicket = {userId: string; ip: string; expiresAt: number; attempts: number};
export class MfaTicketStore {
    static readonly TTL_MS = 120_000; static readonly MAX_ATTEMPTS = 5;
    constructor(now: () => number);
    issue(userId: string, ip: string): string;                  // 32바이트 hex. 같은 userId 의 기존 티켓은 제거
    peek(ticket: string, ip: string): MfaTicket | undefined;    // 없음·만료·IP 불일치 → undefined (만료·불일치 티켓은 삭제). 티켓은 남긴다
    fail(ticket: string): number;                                // attempts + 1 을 새 객체로 교체하고 값 반환. MAX_ATTEMPTS 이상이면 삭제
    consume(ticket: string): void;                               // 성공 시 삭제
    sweep(): void;                                               // 만료 삭제. AdminServer 가 60초 setInterval(unref) 로 부른다
}
export type PendingEnrollment = {secret: Buffer; recoveryCodes: string[]; expiresAt: number; attempts: number};
export class PendingEnrollmentStore {
    static readonly TTL_MS = 300_000; static readonly MAX_ATTEMPTS = 5;
    constructor(now: () => number);
    set(userId: string, p: Omit<PendingEnrollment, 'expiresAt' | 'attempts'>): void;
    peek(userId: string): PendingEnrollment | undefined;        // 만료면 삭제 후 undefined
    fail(userId: string): number;  consume(userId: string): void;  sweep(): void;
}
```

두 저장소는 `AdminServer` 필드이고 `now` 는 `() => ClockRngProvider.current().now()`. `Map` 항목은 불변 객체로 두고 갱신은 새 객체 `set` 으로 한다. 잠금 없음. 티켓 문자열은 `Map.get` 으로만 찾는다(비교 아님).

### 서버 옵션

`ServerOption.mfaRequiredForSuperusers?: boolean`(기본 false). `verificationServerOption` 에서 `=== true` 로 정규화. `/api/serverOption` 편집은 기존 경로 그대로(슈퍼유저, `server:manage`).

### MFA API (`rbacRoutes.ts`)

`Action` 에 `'me:mfa'` 를 추가한다(슈퍼유저·일반 유저 모두 허용, `mustChangePassword` 게이트 뒤). **핸들러 네 개는 전부 `src/server/admin/rbacRoutes.ts` 의 `rbacRouteTable()` 에 넣는다.** 단위 2 가 me·사용자·그룹 계열 핸들러를 그 파일로 분리한 이유(`AdminServer.ts` 비대화 방지)가 그대로 적용되며, `POST /api/me/mfa/*` 는 기존 `PUT /api/me/password` 와 같은 자리에 놓인다. `AdminServer.ts` 에는 저장소 필드와 sweep 타이머만 둔다.

| 메서드·경로 | action | 요청 | 응답·동작 |
|---|---|---|---|
| `POST /api/me/mfa/enroll` | `me:mfa` | — | 이미 `enabled` 면 409 `mfa_already_enabled`. 아니면 `secret = generateSecret()`, `codes = generateRecoveryCodes()` 를 `pendingEnrollments.set(userId, ...)` 하고 `{secret: base32Encode(secret), otpauthUri, recoveryCodes}` — **이 응답에만 평문**. 감사 없음(아직 등록 아님) |
| `POST /api/me/mfa/confirm` | `me:mfa` | `{code}` | `pendingEnrollments.peek(userId)` 가 없으면 409 `mfa_enrollment_expired`. `verify(secret, code, now, -1)` 실패면 `fail(userId)`(5회째면 pending 삭제) + 401 `mfa_code_invalid`. 성공: `consume`, `setMfa(id, {enabled: true, secret: base32, enrolledAt: now, lastUsedStep: step, recoveryCodeHashes: codes.map(hash)})`, 감사 `mfa_enrolled`. 응답 `{mfa: {enabled: true, recoveryCodesRemaining: 10}}`. **U4-08 이 이 핸들러 성공 경로에 "현재 세션의 `mustEnrollMfa` 를 false 로" 를 덧붙인다** |
| `DELETE /api/me/mfa` | `me:mfa` | `{password}` | `verifyPassword(username, password)` 실패 401 `password_incorrect`. `mfaRequiredForSuperusers && role === 'superuser'` 면 409 `mfa_required`. `enabled` 아니면 409 `mfa_not_enabled`. 성공: `clearMfa`, 감사 `mfa_disabled`. 응답 `{mfa: {enabled: false, recoveryCodesRemaining: 0}}` |
| `POST /api/me/mfa/recovery-codes` | `me:mfa` | `{password}` | 비밀번호 검증(401). `enabled` 아니면 409 `mfa_not_enabled`. 새 10개 생성 → `replaceRecoveryCodeHashes`(기존 전부 무효). 응답 `{recoveryCodes}` 평문 1회. 감사 `mfa_recovery_codes_regenerated`(target user, `detail` 없음) |

네 라우트 모두 **CSRF 헤더 검사 대상**이다(`skipCsrfHeader` 에 넣지 않는다). 비밀번호 확인 실패(`DELETE /api/me/mfa`, `recovery-codes`)는 로그인 백오프 버킷에 기록하지 않는다(세션이 있는 요청이며 기존 `PUT /api/me/password` 와 같은 취급).

**감사 면제 표식.** `POST /api/me/mfa/enroll` 은 상태를 바꾸지 않는 준비 단계라 감사하지 않는다. `routes.ts`·`rbacRoutes.ts` 의 `Route` 항목에 `audit: false` 를 명시적으로 붙이고(`type Route` 에 `audit?: boolean` 추가, 생략 시 CUD 메서드는 감사 대상), `audit-sink.test.ts` 의 라우트 순회가 `audit === false` 인 항목을 건너뛴다. 조용히 빠뜨리지 않고 표에 적힌 예외로 둔다.

요청·응답 예시:

```
POST /api/me/mfa/enroll
→ 200 {"success": true, ..., "secret": "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
       "otpauthUri": "otpauth://totp/TTTGate:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=TTTGate&algorithm=SHA1&digits=6&period=30",
       "recoveryCodes": ["k3x9-p2mq", "…9 more"]}

POST /api/me/mfa/confirm  {"code": "287082"}
→ 200 {"success": true, ..., "mfa": {"enabled": true, "recoveryCodesRemaining": 10}}
→ 409 {"success": false, "status": 409, "code": "mfa_enrollment_expired", "message": "Start the setup again."}

DELETE /api/me/mfa  {"password": "user-password-1234"}
→ 200 {"success": true, ..., "mfa": {"enabled": false, "recoveryCodesRemaining": 0}}
→ 409 {"success": false, "status": 409, "code": "mfa_required", "message": "Superusers must keep two-factor authentication enabled."}

POST /api/me/mfa/recovery-codes  {"password": "user-password-1234"}
→ 200 {"success": true, ..., "recoveryCodes": ["…10"]}

GET /api/me  (MFA 를 켠 alice)
→ 200 {"success": true, ..., "user": {...}, "mfa": {"enabled": true, "recoveryCodesRemaining": 9}}
```

## 변경할 것

- `src/server/admin/rbacRoutes.ts`: `rbacRouteTable()` 에 라우트·핸들러 4개 추가(`POST /api/me/mfa/enroll`(`audit: false`), `POST /api/me/mfa/confirm`, `DELETE /api/me/mfa`, `POST /api/me/mfa/recovery-codes`. 전부 `me:mfa`). `/api/me` 응답에 `mfa` 추가.
- `src/server/admin/routes.ts`: `type Route` 에 `audit?: boolean` 추가. 라우트 표 자체는 `rbacRouteTable()` 을 펼치는 기존 구조 그대로.
- `src/server/admin/AdminServer.ts`: `MfaTicketStore`·`PendingEnrollmentStore` 필드와 60초 sweep 타이머(`unref`, `close()` 에서 해제). 두 저장소를 `RouteContext` 로 핸들러에 넘기는 기존 경로(단위 2 §5.2 의 `ctx`)를 쓴다. **로그인 핸들러와 `issueSession` 은 이 이슈에서 건드리지 않는다**(U4-08).
- `src/server/rbac/{IdentityTypes,IdentityStore,AdminAuthorizer}.ts`: `UserMfa`·`User.mfa`, 저장소 메서드 5개, `Action` 의 `'me:mfa'`, `UserView.mfaEnabled`.
- `src/types/TunnelingOption.ts`, `src/server/ServerOptionStore.ts`: `mfaRequiredForSuperusers`.
- 삭제할 파일 없음.

## 하지 말 것

- `Totp.ts`·`Base32.ts` 를 수정하지 않는다(U4-03). 코드·해시 비교를 핸들러 안에서 직접 하지 않는다(`verify`·`findRecoveryCodeHash` 경유).
- 새 핸들러를 `AdminServer.ts` 에 넣지 않는다. `rbacRoutes.ts` 가 me 계열 핸들러의 자리다(단위 2 §5.2).
- `secret` 을 `identity.yaml` 외 어디에도(로그·감사 detail·`UserView`·`/api/me`) 넣지 않는다. 감사 `detail` 에 `code`·`recoveryCode` 를 넣지 않는다(U4-01 뒤에는 redaction 되지만 넣지 않는다).
- 이 이슈의 네 라우트를 CSRF 예외에 넣지 않는다. `AdminServer.ts:160` 의 `skipCsrfHeader` 를 건드리지 않는다(U4-08 범위).
- `Result<T>` 의 `status` 유니온(`404 | 409 | 422`)을 넓히지 않는다. 401 이 필요하면 라우트에서 매핑한다.
- 티켓·pending 저장소에 잠금이나 `async-mutex` 를 쓰지 않는다. 항목 갱신은 새 객체 `set`.
- 예외를 제어 흐름으로 쓰지 않는다: 티켓 없음·만료·형식 오류는 `undefined`·반환값 분기.
- `lastUsedStep` 을 메모리에만 두지 않는다(재기동 뒤에도 재사용 거부). 저장은 `IdentityStore` 원자 저장.
- 비밀번호 검증 실패 백오프 규칙(`LOGIN_MAX_FAILURES` 등)을 바꾸지 않는다. 이 이슈의 비밀번호 확인 실패는 백오프 버킷에 기록하지 않는다.
- `audited()` 를 바꾸지 않는다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/unit/server/mfa/MfaTickets.test.ts` (`now` 주입)
  - `issue` 뒤 `peek(ticket, sameIp)` 가 티켓을 돌려주고 두 번 불러도 같은 티켓이 남아 있다. `peek(ticket, otherIp)` 는 `undefined` 이며 그 뒤 같은 IP 로도 `undefined` 다.
  - 발급 120초 뒤 `peek` 가 `undefined`. 119,999ms 뒤에는 티켓이 있다.
  - `fail` 을 5번 부르면 다섯 번째 반환이 5 이고 그 뒤 `peek` 가 `undefined`. 네 번째까지는 남아 있다.
  - 같은 `userId` 로 두 번 `issue` 하면 첫 티켓은 `peek` 가 `undefined`.
  - `consume` 뒤 `peek` 가 `undefined`.
  - `PendingEnrollmentStore` 는 300초 뒤 `peek` 가 `undefined`, `fail` 5회 뒤 `undefined`.
- `test/unit/server/ServerOptionStore.test.ts` (추가)
  - `mfaRequiredForSuperusers` 생략 → false, `true` → true, `'yes'` → false.
- `test/unit/server/rbac/AdminAuthorizer.test.ts` (추가)
  - 일반 유저와 슈퍼유저 모두 `me:mfa` 가 허용이다.
  - `mustChangePassword: true` 인 주체는 `me:mfa` 가 403 `password_change_required` 다(비밀번호 게이트가 먼저).
- `test/unit/server/rbac/IdentityStore.test.ts` (추가)
  - `setMfa` → 새 인스턴스 `load()` 뒤 `user(id).mfa` 가 같다. `clearMfa` 뒤 `mfa` 가 `undefined`. `markMfaStep` 뒤 `lastUsedStep` 갱신.
  - `consumeRecoveryCode` 가 해당 해시만 제거하고 `value.remaining` 이 9 다. 목록에 없는 해시는 `{success: false, status: 422, code: 'recovery_code_invalid'}` 이고 저장된 해시 개수가 변하지 않는다.
- `test/component/server/admin/mfa-api.test.ts` (신규, 실제 `AdminServer`. 테스트가 `generate(base32Decode(secret), now)` 로 코드를 계산한다. fixture: `admin`(`test-password-1234`), 일반 유저 `alice`(`user-password-1234`))
  - `alice` 로 로그인 → `POST /api/me/mfa/enroll` 200 이고 `secret` 이 32자 Base32, `otpauthUri` 가 `otpauth://totp/TTTGate:alice?secret=<secret>&issuer=TTTGate&algorithm=SHA1&digits=6&period=30`, `recoveryCodes` 10개 → `POST /api/me/mfa/confirm {code}` 200 → `GET /api/me` 의 `mfa.enabled` 가 true, `recoveryCodesRemaining` 이 10, `GET /api/users`(admin)의 alice 항목 `mfaEnabled` 가 true 이고 `mfa` 키가 없다.
  - `enroll` 직후 `POST /api/me/mfa/confirm` 에 `'000000'` 을 보내면 401 `mfa_code_invalid` 이고 pending 이 남아 있어 올바른 코드로 다시 confirm 하면 200 이다.
  - 새 앱을 띄워 `enroll` 한 뒤 `'000000'` 을 5번 보내면 다섯 번 모두 401 이고, 그 뒤 **올바른 코드**를 보내도 409 `mfa_enrollment_expired` 다(다섯 번째 실패로 pending 이 삭제된다).
  - `POST /api/me/mfa/confirm` 을 pending 없이 부르면 409 `mfa_enrollment_expired`. `enroll` 뒤 `ClockRngProvider` 시계를 301초 앞당기고 `confirm` 하면 409.
  - 이미 enabled 인 상태에서 `enroll` 은 409 `mfa_already_enabled`.
  - `POST /api/me/mfa/recovery-codes {password: 'wrong'}` 는 401 `password_incorrect`, 정답이면 200 이고 `recoveryCodes` 10개가 이전 목록과 전부 다르며 `GET /api/me` 의 `recoveryCodesRemaining` 이 10 이다. MFA 를 켜지 않은 `bob` 이 부르면 409 `mfa_not_enabled`.
  - `DELETE /api/me/mfa {password: 'wrong'}` 401 `password_incorrect`, `{password: 정답}` 200 이고 `GET /api/me` 의 `mfa.enabled` 가 false 다. 다시 부르면 409 `mfa_not_enabled`.
  - 서버 옵션 `mfaRequiredForSuperusers: true` 에서 MFA 를 켠 슈퍼유저 `admin` 의 `DELETE /api/me/mfa` 는 409 `mfa_required` 이고, `alice`(일반 유저)는 같은 옵션에서도 200 이다(Q4).
  - `POST /api/me/mfa/enroll`·`confirm`·`recovery-codes` 와 `DELETE /api/me/mfa` 를 CSRF 헤더 없이 부르면 전부 403 이다.
  - 세션 없이 위 네 경로를 부르면 401 이다.
  - 기록된 감사 이벤트(`AuditSinkRegistry` 에 배열 스텁을 두어 수집)에 `mfa_enrolled`, `mfa_recovery_codes_regenerated`, `mfa_disabled` 가 있고 `enroll` 로 인한 이벤트는 없다. 어떤 이벤트를 `JSON.stringify` 해도 응답으로 받은 `secret` 문자열과 복구 코드 평문이 나타나지 않는다.
- `test/component/server/admin/audit-sink.test.ts` (확장): 새 CUD 라우트 중 감사 대상 3개(`POST /api/me/mfa/confirm`, `DELETE /api/me/mfa`, `POST /api/me/mfa/recovery-codes`)가 `ADMIN_ROUTES` 순회에 포함되어 `record` 가 불리고, `audit: false` 인 `POST /api/me/mfa/enroll` 은 순회에서 제외된다.
- `npm run lint` 위반 0건.

기존 `test/component/server/admin/*.test.ts`, `test/unit/server/admin/*.test.ts`(백오프·쿠키 테스트 포함) 전부 통과.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run test:browser:install
npm run lint
npx jest --runInBand test/unit/server/mfa test/unit/server/rbac test/unit/server/ServerOptionStore.test.ts test/component/server/admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U4-03, U2-08(단위 2 의 터널 소유권까지. `rbacRoutes.ts`·`Result<T>`·`UserView` 가 있어야 한다). U4-01·U4-05 와 병렬 가능(모두 라우트 표에 항목을 더하므로 병합 시 배열 항목 충돌만 해결).
- 후행: U4-08(2단계 로그인·강제 게이트·MFA 초기화), U4-09(MeScreen MFA 화면).

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §3.2(저장·서버 옵션), §3.4(API), §6.2(mfa 컴포넌트 테스트), §7(U4-04)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §3(사용자 레코드), §4.1(IdentityStore·`Result<T>`), §4.4(Action·게이트), §5.1(`routes.ts`), §5.2(`rbacRoutes.ts`·`/api/me`·`UserView`)
- `docs/design/2026-09-11-program-overview.md` §3.1(예외·잠금 규약), §3.4(응답 규약)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.5, §5.2.1 NFR-SEC-NEW-ENDPOINT-CSRF-001, §12 Q1·Q4

---

## U4-05

**title**: feat(admin): 세션 목록·강제 종료·다른 기기 로그아웃 API 추가
**labels**: enhancement, area:admin, unit:4
**body**:
## 목적

슈퍼유저가 활성 세션 전체를 보고 특정 세션이나 특정 사용자의 세션 전부를 끊을 수 있게 하고, 모든 사용자가 자기 세션 목록을 보고 "다른 기기에서 로그아웃" 할 수 있게 한다. 세션 키는 어떤 응답에도 나타나지 않고 `SessionStore.sessionIdOf(key)`(= `sha256(key).slice(0, 16)`) 만 노출된다. 세션은 지금처럼 메모리 저장(재기동 시 소멸)이다. 화면은 U4-06.

## 배경

### 전제하는 산출물 (착수 시 아래가 저장소에 없으면 코멘트를 남기고 중단한다)

| 파일 | 심볼 | 출처 |
|---|---|---|
| `src/server/admin/SessionStore.ts` | `type Session = {key; userId; createdAt; lastSeenAt; timeout; ip; userAgent?}`, `newSession(userId, {ip, userAgent})`, `resolveSession(keys)`, `removeSession(key)`, `removeSessionsOfUser(userId, options?: {except?: string}): number`(`except` 는 남길 세션 키. 단위 2 가 `PUT /api/me/password` 를 위해 더한 옵션이다), `listSessions(): Session[]`, `static sessionIdOf(key): string` | 단위 2 §4.3 |
| `src/server/admin/routes.ts`, `AdminServer.ts` | `ADMIN_ROUTES`, `type Route`, `audited()`, `POST /api/logout` 핸들러(만료 `Set-Cookie` 2개) | 단위 2 §5.1·§5.2 |
| `src/server/admin/rbacRoutes.ts` | `rbacRouteTable(): Route[]`, `ctx.ok(payload?, status?)`·`ctx.fail(status, payload)`. 사용자·그룹·me 계열 핸들러가 모여 있는 분리 파일 | 단위 2 §5.2 |
| `src/server/rbac/AdminAuthorizer.ts` | `Action` 에 `'session:manage'`(슈퍼유저만), `'me:sessions'`(모두) | 단위 2 §4.4 |
| `src/server/rbac/IdentityStore.ts` | `user(id)` (username 조회용) | 단위 2 §4.1 |
| `src/server/audit/AuditEventTypes.ts` | `session_killed`, `sessions_killed_for_user`, `sessions_killed_self_others` — U4-01 이 아직 없으면 같은 이름의 문자열 리터럴을 쓰고 U4-01 이 치환한다 | U4-01 |

### 실제로 변경할 기존 파일 (현재 저장소 기준. 단위 2 가 먼저 바꾼 뒤의 모습 위에 얹는다)

- `src/server/admin/SessionStore.ts:14-17` 현재 `type Session = {key: string; timeout: number}`, `:19` `DEFAULT_TIMEOUT = 12h`, `:34` `_sessions: Map<string, Session>`, `:76` `newSession(): Promise<string>`(`crypto.randomBytes(64).toString('hex')`), `:83` `removeSession(sessionKey)`, `:87` `sweepSession()`, `:99` `isSessionValid(keys)`. 단위 2 가 `Session` 필드·`listSessions`·`sessionIdOf` 를 만든다. 이 이슈는 그 위에 **`removeSessionById(id)` 하나만** 더한다.
- `src/server/admin/AdminServer.ts:1053-1065` 세션 쿠키 발급부(`sessionKey=...; Path=/; Max-Age=43200; HttpOnly; SameSite=Strict; Secure?`). 본인 세션을 끊었을 때 만료 쿠키(`Max-Age=0`)를 내는 형식은 `POST /api/logout`(단위 2) 과 같다.
- `src/server/admin/AdminServer.ts:1360` `getClientAddress(req)`: 세션 `ip` 의 출처(`trustXForwardedFor` 정책 존중).

먼저 열어 볼 파일: `src/server/admin/SessionStore.ts`, `src/server/admin/AdminServer.ts`(로그인·로그아웃 핸들러), `src/server/admin/routes.ts`, `src/server/rbac/AdminAuthorizer.ts`, `test/component/server/admin/rbac-login.test.ts`, `test/unit/server/admin/SessionStore.test.ts`.

## 적용되는 결정

- D1 → FR-SESSION-LIST-001(목록: 사용자·시작·최근 활동·IP), FR-SESSION-KILL-001(특정 세션·특정 사용자 전체), FR-SESSION-SELF-KILL-001(다른 기기에서 로그아웃), NFR-VISI-LOGIN-EVENTS-001(세션 강제 종료는 별도 이벤트 타입).
- PRD §12 Q5 가정: 슈퍼유저끼리 세션 강제 종료 가능. 본인 세션도 가능(응답 뒤 쿠키 만료).

## 만들 것

### `SessionStore` 확장 (`src/server/admin/SessionStore.ts`)

```ts
    removeSessionById(id: string): Session | undefined;   // listSessions() 에서 SessionStore.sessionIdOf(s.key) === id 인 것을 찾아 삭제하고 돌려준다. 없으면 undefined
```

- `listSessions()` 가 만료 항목을 포함한다면 이 메서드 안에서 `sweepSession()` 을 먼저 부른다.
- 구현은 `listSessions().find(s => SessionStore.sessionIdOf(s.key) === id)` 처럼 **호출식을 좌변에 둔다.** 비교 대상을 `const sessionId = SessionStore.sessionIdOf(s.key)` 같은 지역 변수로 빼면 `npm run lint`(`scripts/lint-auth-compare.mjs`, 식별자 `sessionId` 에 `===` 금지)가 위반으로 잡는다.
- "사용자별 세션 전부 제거" 는 새 메서드를 만들지 않고 기존 `removeSessionsOfUser(userId)` 를 쓴다. "현재 세션만 남기고 제거" 도 새로 만들지 않고 `removeSessionsOfUser(userId, {except: 현재 세션 키})` 를 쓴다(단위 2 가 이미 만든 옵션이다. 같은 일을 하는 두 번째 경로를 만들지 않는다).

### API (`rbacRoutes.ts`)

**핸들러 다섯 개는 전부 `src/server/admin/rbacRoutes.ts` 의 `rbacRouteTable()` 에 넣는다.** 세션·사용자 관리는 단위 2 가 그 파일로 모아 둔 계열이고, `AdminServer.ts` 를 더 키우지 않는다는 것이 단위 2 §5.2 의 분리 취지다. `AdminServer.ts` 에는 만료 쿠키 헬퍼만 둔다.

`SessionView = {id: string; userId: string; username: string; createdAt: number; lastSeenAt: number; ip: string; userAgent: string; current: boolean}`. `id = SessionStore.sessionIdOf(key)`. `username` 은 `IdentityStore.user(userId)?.username ?? userId`(legacy-fallback 주체 `legacy-admin` 은 그대로). `userAgent` 는 없으면 `''`. `current` 는 요청 세션과 같은 키인지.

| 메서드·경로 | action | 요청 | 응답·동작 |
|---|---|---|---|
| `GET /api/sessions` | `session:manage` | — | `{sessions: SessionView[]}` `lastSeenAt` 내림차순 |
| `DELETE /api/sessions/:id` | `session:manage` | — | `removeSessionById(id)`. 없으면 404 `session_not_found`. 본인 세션이면 응답에 만료 `Set-Cookie` 2개(`sessionKey`, `csrfToken`, `Max-Age=0`)를 붙인다. 응답 `{removed: true, self: boolean}`. 감사 `session_killed`(target `{kind: 'session', id}`, `detail.userId` 대상 사용자) |
| `DELETE /api/users/:id/sessions` | `session:manage` | — | 사용자 없음 404 `user_not_found`. `removeSessionsOfUser(id)`. 본인이면 만료 쿠키. 응답 `{removed: n, self: boolean}`. 감사 `sessions_killed_for_user`(target user, `detail.removed`) |
| `GET /api/me/sessions` | `me:sessions` | — | `{sessions: SessionView[]}` 본인 것만, `lastSeenAt` 내림차순 |
| `POST /api/me/sessions/logout-others` | `me:sessions` | — | `removeSessionsOfUser(principal.userId, {except: 현재 세션 키})` 한 번. 응답 `{removed: n}`(그 반환값 그대로). 감사 `sessions_killed_self_others`(target user 본인, `detail.removed`) |

요청·응답 예시:

```
GET /api/sessions
→ 200 {"success": true, "partial": false, "failedScopes": [], "warnings": [], "message": "",
       "sessions": [
         {"id": "9f2c1a7b3e4d5c6a", "userId": "u_3f9a1c2e7b4d5a60", "username": "admin",
          "createdAt": 1757600000000, "lastSeenAt": 1757603600000, "ip": "127.0.0.1",
          "userAgent": "Mozilla/5.0 (X11; Linux x86_64) ...", "current": true},
         {"id": "1a2b3c4d5e6f7a8b", "userId": "u_9e8d7c6b5a4f3e2d", "username": "alice",
          "createdAt": 1757590000000, "lastSeenAt": 1757599000000, "ip": "10.0.0.7", "userAgent": "", "current": false}
       ]}

DELETE /api/sessions/1a2b3c4d5e6f7a8b
→ 200 {"success": true, ..., "removed": true, "self": false}
DELETE /api/sessions/9f2c1a7b3e4d5c6a          (본인)
→ 200 Set-Cookie: sessionKey=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict
      Set-Cookie: csrfToken=; Path=/; Max-Age=0; SameSite=Strict
      {"success": true, ..., "removed": true, "self": true}
DELETE /api/sessions/doesnotexist
→ 404 {"success": false, "status": 404, "code": "session_not_found", "message": "Session not found"}

DELETE /api/users/u_9e8d7c6b5a4f3e2d/sessions
→ 200 {"success": true, ..., "removed": 2, "self": false}

GET /api/me/sessions
→ 200 {"success": true, ..., "sessions": [ {"id": "...", "current": true, ...}, {"id": "...", "current": false, ...} ]}

POST /api/me/sessions/logout-others
→ 200 {"success": true, ..., "removed": 1}
```

## 변경할 것

- `src/server/admin/SessionStore.ts`: `removeSessionById`.
- `src/server/admin/rbacRoutes.ts`: `rbacRouteTable()` 에 라우트·핸들러 5개 추가.
- `src/server/admin/AdminServer.ts`: 만료 쿠키를 만드는 코드가 `POST /api/logout` 핸들러 안에 인라인이면 `expireSessionCookies(res)` 로 뽑아 세 곳(logout, `DELETE /api/sessions/:id` self, `DELETE /api/users/:id/sessions` self)에서 쓴다. 핸들러 자체는 `AdminServer.ts` 에 두지 않는다.
- `src/server/rbac/AdminAuthorizer.ts`: `session:manage`·`me:sessions` 가 이미 있으면 변경 없음. 없으면 추가(슈퍼유저만 / 모두).
- 삭제할 파일 없음.

## 하지 말 것

- 세션 키(64바이트 hex)를 응답·로그·감사 detail 에 넣지 않는다. `id`(16 hex) 만.
- `sessionIdOf` 를 다시 만들거나 핸들러에 해시 계산을 인라인하지 않는다(단위 2 의 한 곳).
- `removeSessionById` 외의 메서드를 `SessionStore` 에 추가하지 않는다. 특히 "현재 세션 제외 제거" 를 위한 새 메서드를 만들지 않는다(`removeSessionsOfUser(userId, {except})` 가 이미 있다).
- 비교 대상을 `sessionId` 라는 이름의 지역 변수에 담아 `===` 로 비교하지 않는다(`npm run lint` 위반). 호출식을 좌변에 둔다.
- 세션을 파일·DB 에 저장하지 않는다. 재기동 시 소멸은 기존 동작이다.
- 슈퍼유저가 다른 슈퍼유저의 세션을 끊는 것을 막지 않는다(Q5).
- `GET /api/sessions`·`GET /api/me/sessions` 를 `audited()` 로 감싸지 않는다(읽기).
- `DELETE /api/users/:id/sessions` 에서 `IdentityStore` 의 사용자 상태(disabled 등)를 바꾸지 않는다. 세션만.
- 목록 정렬을 `Map` 삽입 순서에 기대지 않는다. `lastSeenAt` 으로 정렬한다.
- `Map` 순회 중 `delete` 하지 않는다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/unit/server/admin/SessionStore.test.ts` (기존 파일에 추가)
  - 사용자 `u1` 세션 2개(`k1`, `k2`), `u2` 세션 1개를 만들면 `removeSessionById(SessionStore.sessionIdOf(k1))` 이 `key === k1` 인 세션을 돌려주고 `listSessions()` 길이 2, `resolveSession([k1])` 이 `undefined`, `resolveSession([k2])` 는 유효.
  - 없는 id 는 `undefined` 를 돌려주고 목록이 변하지 않는다.
  - 만료된 세션은 `removeSessionById` 가 `undefined` 를 돌려준다. 만료 판정에 쓰는 값은 **그 세션의 `timeout` 필드**이고, 이 테스트는 `SessionStore` 를 서버 옵션 없이 직접 만들므로 `DEFAULT_TIMEOUT`(12시간)이 적용된다. 따라서 `ClockRngProvider` 시계를 12시간 + 1ms 앞당긴다(`sessionTtlMs` 서버 옵션은 `AdminServer` 를 거쳐 기동할 때만 반영되므로 이 단위 테스트와 무관하다).
- `test/component/server/admin/sessions-api.test.ts` (신규, 실제 `AdminServer`. fixture: 슈퍼유저 `admin`, 일반 유저 `alice`)
  - `admin` 세션 A, `alice` 세션 B·C(각각 다른 `User-Agent` 헤더)를 만든 뒤 A 로 `GET /api/sessions` 하면 3건, A 의 `current` 가 true, B·C 의 `username` 이 `'alice'`, `userAgent` 가 보낸 값과 같고, `lastSeenAt` 내림차순이며, 어떤 항목에도 `key` 필드나 64자 hex 가 없다.
  - A 로 `DELETE /api/sessions/<B id>` → 200 `{removed: true, self: false}` → B 쿠키로 `GET /api/me` 가 401 → C 는 여전히 200.
  - A 로 `DELETE /api/sessions/<B id>` 를 다시 부르면 404 `session_not_found`.
  - A 로 `DELETE /api/users/<alice id>/sessions` → `{removed: 1}` (C 만 남아 있었음) → C 가 401. 없는 사용자 id 는 404 `user_not_found`.
  - alice 세션 D·E 를 새로 만들고 D 로 `GET /api/me/sessions` → 2건, D 가 `current` → `POST /api/me/sessions/logout-others` → `{removed: 1}` → E 401, D 200. 다시 부르면 `{removed: 0}`.
  - alice(D)로 `GET /api/sessions` 는 403, `DELETE /api/sessions/<A id>` 는 403, A 는 계속 200.
  - A 로 `DELETE /api/sessions/<A id>` → 200 `{self: true}`, 응답 `Set-Cookie` 에 `sessionKey=;` 와 `Max-Age=0` 이 있고 → A 로 `GET /api/me` 401.
  - 기록된 감사 이벤트에 `session_killed`(target id = B id, `detail.userId` = alice id), `sessions_killed_for_user`(`detail.removed` 1), `sessions_killed_self_others`(`detail.removed` 1) 가 있다.
  - `DELETE /api/sessions/<id>` 와 `POST /api/me/sessions/logout-others` 를 CSRF 헤더 없이 부르면 403.
- `test/component/server/admin/audit-sink.test.ts` (확장): 새 CUD 라우트 3개(`DELETE /api/sessions/:id`, `DELETE /api/users/:id/sessions`, `POST /api/me/sessions/logout-others`)가 순회에 포함된다.

기존 `test/unit/server/admin/*.test.ts`(`req-16-session-cookie` 포함), `test/component/server/admin/*.test.ts` 전부 통과.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run test:browser:install
npm run lint
npx jest --runInBand test/unit/server/admin test/component/server/admin/sessions-api.test.ts test/component/server/admin/audit-sink.test.ts
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U2-08(단위 2 의 터널 소유권까지). U4-01·U4-04 와 병렬 가능(모두 `routes.ts` 에 항목을 더하므로 병합 시 배열 항목 충돌만 해결).
- 후행: U4-06(SessionsScreen·UserEditScreen 세션 행), U4-09(MeScreen 세션 카드).

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §4(세션 관리 API·`removeSessionById`), §6.2(sessions-api), §7(U4-05)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §4.3(SessionStore·`sessionIdOf`), §4.4(`session:manage`·`me:sessions`), §5.1(`routes.ts`), §5.2(`/api/logout`)
- `docs/design/2026-09-11-program-overview.md` §3.4(응답·쿠키 규약), §3.1(잠금 대신 원자 연산)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.6, §5.2.5 NFR-VISI-LOGIN-EVENTS-001, §12 Q5

---

## U4-06

**title**: feat(admin): 감사 로그 화면과 세션 관리 화면 추가
**labels**: enhancement, area:frontend, unit:4
**body**:
## 목적

U4-02·U4-05 의 API 위에 감사 로그 화면(`#/audit`)과 세션 관리 화면(`#/sessions`)을 만들고, 드로어 NAV 에 "Audit log"·"Sessions" 항목을 추가하며, 사용자 편집 화면에 "Sessions" 행(개수 + "End all sessions")을 붙인다. 슈퍼유저는 전체 이벤트를 필터·페이지로 보고 세션을 끊을 수 있고, 일반 유저는 "My activity" 제목으로 자기 이벤트만 본다. MFA 관련 화면은 U4-07(로그인 2단계)·U4-09(등록·해제·Security 카드).

## 배경

### 전제하는 산출물 (착수 시 아래가 저장소에 없으면 코멘트를 남기고 중단한다)

| 파일 | 심볼·계약 | 출처 |
|---|---|---|
| `admin/src/ui/*.svelte` | `Button`(`variant`, `size`, `disabled`, `type`, `class`, `onclick`), `Field`(`label`, `hint`, `error`, `for`), `TextInput`(`value` bindable, `id?`, `type`, `placeholder`, `disabled`, `autocomplete`, `invalid`, `inputmode`, `oninput`, `onkeydown`), `Select`(`value` bindable, `id?`, `options`, `onchange`), `Card`(`label`, `ticked`, `compact`), `Chip`(`tone`, `mono`), `Badge`(`tone`), `Tabs`(`items`, `active` bindable, `onchange`), `Modal`(`open` bindable, `title`, `closeOnOverlay`, `footer` 스니펫), `toast` 스토어, `Loading`. **부품의 공통 prop 은 `class` 하나이고 `id` prop 은 `TextInput`·`NumberInput`·`Select`·`Checkbox` 에만 있다.** tone 값 `'signal' \| 'pulse' \| 'alarm' \| 'trace' \| 'warn' \| 'neutral'` | 단위 1 §6 |
| `admin/src/router.ts` | `type Screen`, `type Route = {screen; param?}`, `route` 스토어, `navigate(hash)`, `parseHash(hash)` | 단위 1 §5.1, 단위 3 §3 |
| `admin/src/shell/nav.ts` | `type Section = 'status'\|'tunnels'\|'server'\|'users'\|'groups'\|'security'\|'audit'\|'sessions'\|'me'`, `NAV: ReadonlyArray<{hash; title; screen; section}>` — **현재 항목은 6개**(Status, Tunnels, Server settings, Users, Groups, My account)이고 Groups 와 My account 사이에 "4·5 단위가 이 자리에 Security, Audit log, Sessions 를 이 순서로 삽입한다" 는 주석만 있다. `SECTION_OF_SCREEN: Record<Screen, Section \| null>`, `visibleNav(sections)`, `defaultHash(sections)` = `visibleNav(sections)[0]?.hash ?? '#/me'`, `chrome(route): {title; back?}`, `navScreen(route)`. `Drawer` 는 `visibleNav(me.sections)` 를 그린다 | 단위 3 §3 |
| `admin/src/App.svelte` | `const current = $derived(chrome($route))` 로 `Shell` `title`/`back` 계산, 섹션 가드(`SECTION_OF_SCREEN` → `#/denied`), `sessionInvalid()` 컨텍스트. **화면별 제목 표는 `App.svelte` 가 아니라 `nav.ts` 의 `chrome()` 이 가진다** | 단위 1 §5.2·§5.3, 단위 3 §3 |
| `admin/src/me.ts` | `me` 스토어(`/api/me` 결과: `user`, `group`, `sections`, `migrationBanner`, `mustChangePassword`), `loadMe()` | 단위 2 §7, 단위 3 U3-01 |
| `admin/src/controller/AdminRequest.ts` | `adminRequest(path, options): Promise<any>` — CSRF 헤더·401→`InvalidSession` 처리 | 현재 저장소 `:36` |
| `admin/src/controller/UsersCtrl.ts` | `instance.list(): Promise<UserView[]>` | 단위 3 §2 |
| `admin/src/controller/MeCtrl.ts` | `instance.me()`, `changePassword()`, `acknowledgeMigration()` | 단위 3 §2 |
| `admin/src/controller/Types.ts` | `UserView`, `MeResponse` | 단위 3 §2 |
| `admin/src/screens/UserEditScreen.svelte` | 수정 화면 하단 고정 바("Save", "Reset password", "Delete") | 단위 3 §4.2 |
| `test/helpers/adminApp.ts` | `startAdminApp({fixture, login?: {username, password}}) → {page, url, errors, calls(), close}`. **로그인 진입점은 `login` 하나다**(단위 3 U3-01 이 `loginAs` 같은 두 번째 진입점을 금지했다). 생략하면 `admin`/`test-password-1234`. 뷰포트 400×800 기본 | 단위 1 §8.2, 단위 3 §5 |
| `test/helpers/rbacFixture.ts` | `'rbac'` fixture 의 상수: `RBAC_PASSWORDS`(일반 유저는 전부 `user-password-1234`, `dave` 는 `temp-password-1234`), `RBAC_USER_IDS`, `RBAC_GROUP_FIELD_ID`. 사용자 `admin`(슈퍼유저)·`alice`·`bob`(그룹 `Field team`)·`carol`(`default` 그룹)·`dave`(임시 비밀번호). `Field team` 과 `default` 모두 `admin_ui_section_access` 에 `my_audit`·`my_sessions` 를 포함한다 | 단위 3 §5 |
| `test/admin/admin-backend-driver.ts` | 실제 `AdminServer` 를 임시 루트에서 포크. IPC `{type: 'calls'}` | 단위 1 §8.2 |
| 백엔드 API | `GET /api/audit`, `GET /api/audit/types`(U4-02), `GET /api/sessions`, `DELETE /api/sessions/:id`, `DELETE /api/users/:id/sessions`, `GET /api/me/sessions`, `POST /api/me/sessions/logout-others`(U4-05), `GET /api/users`(단위 2) | |

### 실제로 변경할 기존 파일

- `admin/src/controller/ServerStatusCtrl.ts`, `ServerOptionCtrl.ts`: 컨트롤러 패턴(`instance` 싱글턴 + `adminRequest`)의 본보기. 새 컨트롤러는 같은 형태.
- `admin/src/controller/Types.ts`: 타입 추가.

먼저 열어 볼 파일: `admin/src/shell/nav.ts`, `admin/src/router.ts`, `admin/src/App.svelte`, `admin/src/screens/UsersScreen.svelte`(카드 목록 본보기), `admin/src/screens/UserEditScreen.svelte`, `admin/src/controller/UsersCtrl.ts`, `admin/src/controller/MeCtrl.ts`, `test/admin/screen-users.test.ts`(테스트 본보기), `test/helpers/adminApp.ts`, `test/admin/admin-backend-driver.ts`.

## 적용되는 결정

- D2 디자인 시스템 부품만 사용. D3 모바일 우선(카드 목록). D4 드로어 NAV. D5 UI 문구 영어 단일.
- D1 → FR-AUDIT-READ-SU-001, FR-AUDIT-READ-SELF-001, FR-SESSION-LIST-001, FR-SESSION-KILL-001, FR-SESSION-SELF-KILL-001, NFR-USAB-HIDE-001(권한 없는 항목은 숨김).

## 만들 것

### 컨트롤러

`admin/src/controller/AuditCtrl.ts`:

```ts
class AuditCtrl {
    static instance: AuditCtrl;
    list(input: AuditQueryInput): Promise<{events: AuditEventView[]; nextCursor?: string}>;   // GET /api/audit?… (빈 값은 쿼리에서 뺀다)
    types(): Promise<string[]>;                                                                // GET /api/audit/types
}
```

`admin/src/controller/SessionsCtrl.ts`:

```ts
class SessionsCtrl {
    static instance: SessionsCtrl;
    list(): Promise<SessionView[]>;                              // GET /api/sessions
    kill(id: string): Promise<{removed: boolean; self: boolean}>; // DELETE /api/sessions/:id
    killAllForUser(userId: string): Promise<{removed: number; self: boolean}>;   // DELETE /api/users/:id/sessions
}
```

`admin/src/controller/MeCtrl.ts` 추가: `sessions(): Promise<SessionView[]>`(`GET /api/me/sessions`), `logoutOthers(): Promise<{removed: number}>`(`POST /api/me/sessions/logout-others`). U4-09 의 MeScreen 세션 카드가 같은 두 메서드를 쓴다.

`admin/src/controller/Types.ts` 추가:

```ts
export type AuditEventView = {at: number; actor: {userId: string; username?: string; role?: string}; sessionIdHash?: string; ip?: string;
    type: string; target?: {kind: string; id: string}; outcome: 'success' | 'failure'; summary: string; detail?: Record<string, unknown>};
export type AuditQueryInput = {from?: number; to?: number; userId?: string; type?: string; outcome?: 'success' | 'failure'; limit?: number; cursor?: string};
export type SessionView = {id: string; userId: string; username: string; createdAt: number; lastSeenAt: number; ip: string; userAgent: string; current: boolean};
```

`admin/src/util/relativeTime.ts`(신규): `relativeTime(fromMs: number, nowMs: number): string` → `< 60초` "just now", `< 60분` "{n} min ago", `< 24시간` "{n} h ago", 그 외 "{n} d ago". `formatLocal(ms: number, withSeconds: boolean): string` → 로컬 `YYYY-MM-DD HH:mm` 또는 `YYYY-MM-DD HH:mm:ss`. 단위 테스트 `test/admin/relativeTime.test.ts` 는 Jest(CommonJS 변환)로 돌아가므로 이 파일에 `import.meta` 를 비롯한 ESM 전용 문법을 쓰지 않는다. 순수 함수 두 개와 `export` 뿐이어야 한다.

### 라우트·NAV

- `router.ts` `Screen` 에 `'audit' | 'sessions'` 추가. `#/audit` → `{screen: 'audit'}`, `#/sessions` → `{screen: 'sessions'}`. `test/admin/router.test.ts` 의 `parseHash` 표에 두 행 추가.
- `nav.ts` `NAV` 에 `{hash: '#/audit', title: 'Audit log', screen: 'audit', section: 'audit'}`, `{hash: '#/sessions', title: 'Sessions', screen: 'sessions', section: 'sessions'}` 를 **Groups 와 My account 사이의 주석 자리**에 이 순서로 넣는다. Security 항목은 단위 5 가 같은 자리 맨 앞에 넣으므로, 이 이슈는 주석을 지우지 말고 `// 단위 5 가 이 앞에 Security 를 넣는다` 로 줄여 남긴다.
- `nav.ts` `SECTION_OF_SCREEN` 에 `audit: 'audit'`, `sessions: 'sessions'` 두 항목을 추가한다. 이 객체는 `Record<Screen, Section | null>` 이라 `Screen` 에 두 값을 더하면 **추가하지 않는 한 컴파일되지 않고**, 추가하지 않으면 `App.svelte` 의 섹션 가드도 동작하지 않는다.
- `nav.ts` `chrome()` 표에 두 행을 추가한다: `sessions` → `{title: 'Sessions'}`, `audit` → `{title: 'Audit log'}`. **back 은 없다.** `chrome(route)` 는 `route` 만 받는 순수 함수여서 역할을 모르므로 여기서 "My activity" 를 낼 수 없다. **역할별 제목은 `AuditScreen` 이 덮는다**: 단위 1 §5.2 의 `Shell` 제목은 `App.svelte` 가 `chrome($route).title` 로 주므로, `AuditScreen` 이 `$me.user.role === 'regular'` 일 때 `Shell` 제목을 `'My activity'` 로 바꾸도록 `App.svelte` 에 한 줄을 둔다: `const current = $derived($route.screen === 'audit' && $me?.user.role === 'regular' ? {title: 'My activity'} : chrome($route))`. `chrome()` 의 표는 역할과 무관한 기본값(`'Audit log'`)을 유지한다.
- 일반 유저에게는 `me.sections` 에 `audit`(그룹 속성 `my_audit`)·`sessions`(`my_sessions`) 가 있을 때만 NAV 항목이 보인다.
- **`defaultHash` 변동을 허용한다.** `defaultHash(sections)` 는 `visibleNav(sections)[0].hash` 이므로 이 이슈가 NAV 에 두 항목을 넣으면 `sections` 가 `['audit','me']` 인 사용자의 기본 화면이 `#/me` 에서 `#/audit` 으로 바뀐다(단위 3 U3-01 이 4 단위에 넘긴 판단이다). 이 변동을 정정하지 않고 그대로 받아들인다 — 사용자가 볼 수 있는 첫 화면으로 보내는 것이 `defaultHash` 의 정의이고, 예외 표를 따로 두면 규칙이 둘로 갈린다. 다만 **단위 3 이 이미 쓴 기대값은 바뀌지 않는지 확인한다**: `defaultHash(슈퍼유저 sections)` 는 `#/status`, `defaultHash(['tunnels','audit','me','sessions'])` 는 `#/tunnels`, `defaultHash([])` 는 `#/me` 로 그대로다. `test/admin/nav.test.ts` 의 `defaultHash(['audit','me'])` 기대값만 `'#/me'` 에서 `'#/audit'` 으로 고치고, 그 한 줄이 이 이슈가 단위 3 테스트에 가하는 유일한 변경이다.

### 부품에 id 를 붙이는 규약

아래 두 화면 표에서 `Card id="audit-filters"` 처럼 적은 것은 **그 부품을 감싸는 요소에 id 를 붙인다는 뜻이다.** 단위 1 §6 의 부품 공통 prop 은 `class` 하나뿐이고 `Button`·`Card`·`Chip`·`Badge`·`Tabs`·`Modal` 에는 `id` prop 이 없다. 단위 1 의 부품 파일을 이 이슈에서 고치지 않는다.

| 부품 | 어떻게 |
|---|---|
| `TextInput`, `NumberInput`, `Select`, `Checkbox` | `id?` 가 계약에 있다. 표에 적힌 대로 prop 으로 넘긴다 |
| `Card` | `<section id="audit-filters"><Card …>…</Card></section>` 로 감싼다 |
| `Tabs` | `<div id="audit-range"><Tabs …/></div>` 로 감싼다 |
| `Button` | `<span id="audit-load-more"><Button …>Load more</Button></span>` 로 감싼다. **버튼의 `disabled` 를 단언하는 테스트는 `#audit-load-more button` 으로 안쪽 `<button>` 을 고른다** |
| `Badge`, `Chip` | `<span id="…"><Badge …>…</Badge></span>` 로 감싼다 |
| `Modal` | 감싸지 않는다(감싸는 요소는 모달이 닫혀도 남아 "모달이 사라졌다" 를 단언할 수 없다). `class` prop 을 쓰고 선택자를 `.end-session-modal` 처럼 클래스로 적는다 |

### `admin/src/screens/AuditScreen.svelte` (`#/audit`)

| 요소 | id / 선택자 | 문구·동작 |
|---|---|---|
| 필터 카드 | `Card` `id="audit-filters"` | |
| 타입 필터 | `Select id="audit-filter-type"` | 옵션 `[{value: '', label: 'All types'}, ...types()]`. 변경 즉시 재조회 |
| 사용자 필터 | `Select id="audit-filter-user"` | **슈퍼유저에게만** 그린다. 옵션 `[{value: '', label: 'All users'}, ...UsersCtrl.list() 의 {value: id, label: username}]` |
| 결과 필터 | `Select id="audit-filter-outcome"` | `All outcomes` / `Success` / `Failure` (`''`/`success`/`failure`) |
| 기간 프리셋 | `Tabs id="audit-range"` items `[{id: '24h', label: '24h'}, {id: '7d', label: '7d'}, {id: '30d', label: '30d'}, {id: 'all', label: 'All'}]`, 기본 `'7d'` | `from = now - 기간`, `all` 이면 `from` 없음. `to` 는 항상 생략 |
| 목록 | `<ul id="audit-list">`, 항목 `<li class="audit-event" data-type="{type}" data-outcome="{outcome}">` 안에 `Card compact` | 1행: `<span class="mono audit-time">` `formatLocal(at, true)` + `Badge tone={outcome === 'success' ? 'pulse' : 'alarm'}` 문구 `success`/`failure` + `Chip` `{type}`; 2행: `<span class="audit-summary">{summary}</span>`; 3행: `<span class="mono audit-meta">@{actor.username ?? actor.userId} · {target ? target.kind + ':' + target.id : '—'} · {ip ?? '—'}</span>` |
| 상세 펼침 | 항목 클릭(`button.audit-toggle`, `aria-expanded`) | `<pre class="mono audit-detail">{JSON.stringify(detail ?? {}, null, 2)}</pre>` 토글 |
| 더 보기 | `Button id="audit-load-more"` "Load more" | `nextCursor` 가 있을 때만. 누르면 같은 필터 + `cursor` 로 조회해 뒤에 붙인다 |
| 빈 상태 | `<p id="audit-empty">` "No events in this range." | 목록이 비었을 때 |
| 로딩 | `Loading` | 조회 중. 필터 변경으로 재조회할 때 목록을 비우고 표시 |
| 오류 | `toast.push({tone: 'alarm', message: 'Failed to load audit events.'})` | `InvalidSession` 이면 `sessionInvalid()` |

- `limit` 은 50 고정. 필터를 바꾸면 `cursor` 를 버리고 처음부터.
- 일반 유저: 사용자 필터 없음, 제목 "My activity". 서버가 본인 것만 주므로 클라이언트 필터 없음.

### `admin/src/screens/SessionsScreen.svelte` (`#/sessions`)

슈퍼유저 분기:

| 요소 | id / 선택자 | 문구·동작 |
|---|---|---|
| 사용자 필터 | `Select id="sessions-filter-user"` | `All users` + 사용자 목록. 클라이언트 측 필터 |
| 사용자 전체 종료 | `Button variant="danger" id="sessions-end-all-user"` "End all for user" | 필터에 사용자가 선택된 경우에만 활성. 확인 `Modal class="end-all-modal"` 제목 "End all sessions" 본문 "End all sessions for {username}?"(본인이면 "End all sessions for {username}? You will be signed out.") + `Button id="confirm-end-all"` "End all" + "Cancel" |
| 목록 | `<ul id="sessions-list">`, 항목 `<li class="session-row" data-session-id="{id}">` 안에 `Card compact` | 1행: `<span class="session-user">{username}</span>` + 현재 세션이면 `Chip tone="signal"` "this device"; 2행 mono: `started {formatLocal(createdAt, false)}` · `last seen {relativeTime(lastSeenAt, now)}`; 3행 mono: `{ip}` · `{userAgent 를 48자에서 자르고 '…', title 속성에 전체}`; 오른쪽 `Button variant="danger" size="sm" class="session-end"` "End" |
| 개별 종료 확인 | `Modal class="end-session-modal"` 제목 "End session" 본문 "End this session for {username}?"(본인이면 "End this session? You will be signed out.") + `Button id="confirm-end"` "End" + "Cancel" | 확인 → `kill(id)` → `self` 면 `sessionInvalid()`(로그인 화면으로), 아니면 목록 갱신 + `toast` "Session ended." |
| 갱신 | `setInterval(load, 10_000)`, 언마운트 시 `clearInterval` | 갱신 중 모달이 열려 있으면 목록만 바꾸고 모달은 유지 |
| 빈 상태 | `<p id="sessions-empty">` "No active sessions." | |

일반 유저 분기(`me.user.role === 'regular'`): 필터·"End all for user"·"End" 버튼 없음. `MeCtrl.sessions()` 목록과 `Button id="sessions-logout-others"` "Sign out other devices"(확인 없이 즉시 `MeCtrl.logoutOthers()` → 토스트 "Signed out {n} other device(s)." → 목록 갱신).

### `UserEditScreen` 확장 (수정 화면, `#/users/:id`)

- "Sessions" 행 `Card label="Sessions" id="user-sessions"`: `<span id="user-session-count">{n} active session(s)</span>`(`SessionsCtrl.list()` 를 `userId` 로 세어 표시) + `Button variant="danger" id="user-end-sessions"` "End all sessions"(n = 0 이면 disabled) → 확인 `Modal class="end-all-modal"` 제목 "End all sessions" 본문 "End all sessions for {username}?" + `Button id="confirm-end-all"` "End all" + "Cancel" → `killAllForUser(id)` → 개수 갱신 + 토스트 "Ended {n} session(s)."
- 생성 화면(`new`)에는 그리지 않는다.

### 테스트 fixture

`test/helpers/adminApp.ts` 의 `'rbac'` fixture 를 쓰고, 로그인은 **기존 `login: {username, password}` 옵션 하나**로 한다(`loginAs` 같은 두 번째 진입점을 만들지 않는다. 단위 3 U3-01 §하지 말 것). 비밀번호는 `test/helpers/rbacFixture.ts` 의 `RBAC_PASSWORDS` 에서 가져온다.

**`extraLogins` 는 이 이슈가 새로 정의하는 확장이다**(단위 1·단위 3 의 `startAdminApp` 계약에 없다). `startAdminApp({fixture, login?, extraLogins?})` 의 `extraLogins?: Array<{as: string; userAgent: string}>` 는 브라우저 로그인 **전에** 드라이버 IPC `{type: 'login', username, userAgent}` 로 해당 사용자 세션을 서버 측에 만들어 둔다(드라이버가 `POST /api/login` 을 로컬로 호출하고 비밀번호는 `RBAC_PASSWORDS` 에서 찾는다). `extraLogins` 는 **로그인 진입점이 아니라 사전 세션 시드**이므로 `login` 과 역할이 겹치지 않는다.

반환에 `sessions(): Promise<SessionView[]>`(드라이버가 `GET /api/sessions` 를 admin 세션으로 호출) 와 `seedAudit(n: number): Promise<void>`(드라이버가 `AuditSinkRegistry.current().record` 로 `user_updated` 이벤트 n 건을 기록한 뒤 `await (AuditSinkRegistry.current() as FileAuditSink).flush()` 로 파일에 내려앉기를 기다린다. `AuditSink` 인터페이스에는 `flush` 가 없으므로 반드시 `as FileAuditSink` 로 좁혀 부른다) 를 더한다. `admin-backend-driver.ts` 가 `FileAuditSink` 를 `rootDir/logs/audit` 에 연결하지 않았으면 연결한다(U4-01 의 `ServerApp` 코드와 같은 세 줄).

`'rbac'` fixture 의 `Field team` 그룹과 `default` 그룹은 둘 다 `admin_ui_section_access` 에 `my_audit`·`my_sessions` 를 이미 갖고 있다(단위 3 §5 표, 단위 2 §3 기본값). 착수 시 둘 중 하나라도 빠져 있으면 이 이슈에서 채운다. 그 위에 **`default` 그룹의 `admin_ui_section_access` 에서 `my_audit` 만 뺀 변형 `'rbac-no-audit'`** 을 추가한다(carol 용).

## 변경할 것

- `admin/src/router.ts`: `Screen` 에 두 값, `parseHash` 표에 두 행.
- `admin/src/shell/nav.ts`: `NAV` 두 항목, `SECTION_OF_SCREEN` 두 항목, `chrome()` 표 두 행.
- `admin/src/App.svelte`: `audit` 화면의 일반 유저 제목 덮어쓰기 한 줄과 두 화면 렌더 분기.
- `admin/src/screens/UserEditScreen.svelte`: Sessions 행.
- `admin/src/controller/MeCtrl.ts`, `Types.ts`: 위 메서드·타입.
- `test/admin/router.test.ts`: 두 행 추가.
- `test/admin/nav.test.ts`: `chrome`·`SECTION_OF_SCREEN`·`visibleNav` 케이스 추가, `defaultHash(['audit','me'])` 기대값을 `'#/me'` 에서 `'#/audit'` 으로 수정.
- `test/helpers/adminApp.ts`, `test/admin/admin-backend-driver.ts`: `extraLogins`·`sessions()`·`seedAudit()`·`'rbac-no-audit'` fixture·`FileAuditSink` 연결.
- 삭제할 파일 없음.

## 하지 말 것

- 화면에서 `fetch` 를 직접 부르지 않는다(컨트롤러 경유). `ui/` 부품에 API 호출을 넣지 않는다.
- hex 색상 리터럴·외부 URL 을 `.svelte` 에 넣지 않는다(`design-system-rules.test.ts` R2·R5).
- 감사 이벤트를 클라이언트에서 필터하지 않는다(서버 쿼리). 예외는 세션 화면의 사용자 필터(목록이 작다).
- 감사 목록을 한 번에 500건 요청하지 않는다(50 고정 + Load more).
- 폴링 간격을 바꾸지 않는다(10초). 폴링 중 오류가 `InvalidSession` 이면 `sessionInvalid()`, 그 외에는 토스트 없이 다음 주기 재시도.
- 이 이슈에서 MFA 관련 요소(MeScreen 카드, 로그인 2단계, "Reset MFA", Security 카드)를 만들지 않는다(U4-07·U4-09).
- 일반 유저 `#/sessions` 에 슈퍼유저 전용 요소를 숨김(`hidden`)으로 두지 않는다. 아예 그리지 않는다.
- `ui/` 부품에 계약 밖 prop(`id`, `maxlength` 등)을 넘기지 않는다. 위 "부품에 id 를 붙이는 규약" 을 따르고 단위 1 의 부품 파일을 고치지 않는다.
- `startAdminApp` 에 `loginAs` 같은 두 번째 로그인 진입점을 만들지 않는다(단위 3 U3-01 의 금지 사항).
- `defaultHash` 에 "Audit log 는 기본 화면이 될 수 없다" 같은 예외를 넣지 않는다. NAV 순서의 첫 허용 항목이라는 정의를 그대로 둔다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트. 모든 브라우저 테스트는 `startAdminApp({fixture: 'rbac', login: {username, password: RBAC_PASSWORDS[username]}})`(admin 은 `login` 생략)으로 시작하고, 뷰포트 400×800(기본), `finally` 에서 `close()`, 마지막에 `expect(errors).toEqual([])` 로 끝난다.

- `test/admin/nav.test.ts` (단위 3 이 만든 파일에 추가·수정)
  - `chrome({screen: 'audit'})` 가 `{title: 'Audit log'}`, `chrome({screen: 'sessions'})` 가 `{title: 'Sessions'}` 이고 둘 다 `back` 이 없다.
  - `SECTION_OF_SCREEN.audit` 가 `'audit'`, `SECTION_OF_SCREEN.sessions` 가 `'sessions'` 이다.
  - `visibleNav(['status','tunnels','server','users','groups','security','audit','sessions','me']).map(i => i.hash)` 에서 `'#/audit'` 이 `'#/sessions'` 앞이고 둘 다 `'#/me'` 앞이다.
  - `defaultHash(['audit','me'])` 가 `'#/audit'` 이다(단위 3 의 `'#/me'` 기대값을 이 값으로 고친다). `defaultHash(슈퍼유저 sections)` 는 `'#/status'`, `defaultHash(['tunnels','audit','me','sessions'])` 는 `'#/tunnels'`, `defaultHash([])` 는 `'#/me'` 로 그대로다.
- `test/admin/router.test.ts` (추가)
  - `parseHash('#/audit')` 가 `{screen: 'audit'}`, `parseHash('#/sessions')` 가 `{screen: 'sessions'}` 이다.
- `test/admin/relativeTime.test.ts`
  - `relativeTime(now - 30_000, now)` 가 `'just now'`, `- 5 × 60_000` 이 `'5 min ago'`, `- 3 × 3_600_000` 이 `'3 h ago'`, `- 2 × 86_400_000` 이 `'2 d ago'`.
- `test/admin/screen-audit.test.ts`
  - `admin` 으로 로그인 → 드라이버 IPC 로 그룹 하나 생성 → 드로어에 "Audit log" 항목 → 클릭 → 해시 `#/audit`, 헤더 제목 "Audit log", `#audit-filter-user` 가 존재한다.
  - `#audit-list .audit-event` 가 1개 이상이고 첫 항목의 `data-type` 이 `group_created`(최신)이며 `Badge` 문구가 `success`, `.audit-meta` 에 `@admin` 이 있다.
  - `#audit-filter-type` 을 `login_success` 로 바꾸면 모든 `.audit-event` 의 `data-type` 이 `login_success` 다. `#audit-filter-outcome` 을 `failure` 로 바꾸면 `#audit-empty` 문구 "No events in this range." 가 보인다.
  - 첫 항목의 `.audit-toggle` 클릭 → `.audit-detail` 이 보이고 `aria-expanded="true"`; 다시 클릭 → 사라진다.
  - `seedAudit(60)` 뒤 새로고침하면 `#audit-list .audit-event` 가 50개이고 `#audit-load-more` 가 보인다 → 클릭 → 60개 이상, `#audit-load-more` 사라짐.
  - `login: {username: 'alice', password: RBAC_PASSWORDS.alice}`(그룹 `Field team` 의 `admin_ui_section_access` 에 `my_audit` 포함) → 드로어 "Audit log" 클릭 → 헤더 제목이 "My activity", `#audit-filter-user` 가 없고, 모든 `.audit-meta` 가 `@alice` 로 시작한다.
  - `startAdminApp({fixture: 'rbac-no-audit', login: {username: 'carol', password: RBAC_PASSWORDS.carol}})` → 드로어에 "Audit log" 없음, `#/audit` 직접 입력 → `#/denied`.
- `test/admin/screen-sessions.test.ts`
  - `startAdminApp({fixture: 'rbac', extraLogins: [{as: 'alice', userAgent: 'UA-ALICE-1'}, {as: 'alice', userAgent: 'UA-ALICE-2'}]})`(`login` 생략 = admin) → 드로어 "Sessions" → `#/sessions`, `#sessions-list .session-row` 3개, `Chip` "this device" 가 정확히 1개(admin 행), alice 행 둘의 3행에 `UA-ALICE-1`·`UA-ALICE-2`.
  - alice 첫 행의 `.session-end` 클릭 → `.end-session-modal` 이 보이고 제목 "End session", 본문에 `alice` → `#confirm-end` → 토스트 "Session ended." → 행 2개 → `sessions()` 로 서버 측도 2개.
  - `#sessions-filter-user` 를 alice 로 → 행 1개 → `#sessions-end-all-user button` 이 enabled → 클릭 → `.end-all-modal` → `#confirm-end-all` → 행 0개(필터 유지) → 필터 해제 → admin 행 1개.
  - admin 행 `.session-end` → `.end-session-modal` 본문에 "You will be signed out." → `#confirm-end` → 로그인 화면(`#login-password` 존재).
  - `login: {username: 'alice', password: RBAC_PASSWORDS.alice}`(`my_sessions` 포함) + `extraLogins` alice 1개 → `#/sessions` → `#sessions-filter-user` 없음, `.session-end` 없음, 행 2개, `#sessions-logout-others` 클릭 → 토스트 "Signed out 1 other device(s)." → 행 1개.
- `test/admin/screen-users.test.ts` (추가)
  - `extraLogins` 로 alice 세션 2개를 만든 뒤 admin 으로 `#/users/<alice id>` → `#user-session-count` 문구 "2 active session(s)" → `#user-end-sessions` 클릭 → `.end-all-modal` → `#confirm-end-all` → 토스트 "Ended 2 session(s)." → 문구 "0 active session(s)", `#user-end-sessions button` 이 disabled.
- `test/admin/design-system-rules.test.ts`: R1·R2·R4·R5 가 새 파일에도 통과.

기존 `test/admin/*.test.ts` 전부 통과.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm --prefix admin run check
npm run test:admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U4-02, U4-05, U3-06(단위 3 전체: NAV section 필터·가드·UserEditScreen·`rbac` fixture·터널 화면).
- 후행: U4-07(`extraLogins` 확장을 쓴다), U4-09(MeScreen 세션 카드가 이 이슈의 `MeCtrl.sessions()`·`logoutOthers()`·`util/relativeTime.ts`·`SessionView`·`extraLogins` fixture·`UserEditScreen` Sessions 행을 그대로 쓴다).

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §5.1(AuditScreen), §5.4(SessionsScreen), §5.5(UserEditScreen 세션 행), §6.3(브라우저 테스트), §7(U4-06)
- `docs/design/2026-09-11-unit3-rbac-screens.md` §2(컨트롤러 패턴), §3(NAV 순서·section 필터·가드), §4.2(UserEditScreen 하단 바), §5(`rbac` fixture)
- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §3(층 규칙), §5(라우터·Shell title), §6(부품 계약), §8.2·§8.3(드라이버·브라우저 테스트 규약)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §3(`admin_ui_section_access` → `my_audit`·`my_sessions`), §4.4(`sections`)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.4, §5.1.6, §5.2.3 NFR-USAB-HIDE-001

---

## U4-07

**title**: feat(admin): 로그인 화면에 2단계 코드 입력과 복구 코드 전환 추가
**labels**: enhancement, area:frontend, unit:4
**body**:
## 목적

U4-08 이 만든 2단계 로그인 API 를 로그인 화면에 붙인다. 이 이슈가 끝나면 MFA 가 켜진 계정으로 로그인할 때 비밀번호 확인 뒤 6자리 코드 입력 단계가 나타나고, 인증 앱 대신 복구 코드로도 들어갈 수 있으며, 티켓이 만료되면 비밀번호 단계로 되돌아간다. 브라우저 테스트가 실제 TOTP 코드를 계산할 수 있도록 드라이버 IPC 세 개(`mfaSecret`·`mfaRecoveryCodes`·`advanceClock`)와 fixture `'rbac-mfa'` 를 만든다. 내 계정 화면의 MFA 등록·해제, 세션 카드, "Reset MFA", 서버 설정 Security 카드는 **U4-09**.

## 배경

### 전제하는 산출물 (착수 시 아래가 저장소에 없으면 코멘트를 남기고 중단한다)

| 파일 | 심볼·계약 | 출처 |
|---|---|---|
| `admin/src/ui/*.svelte` | `Button`(`variant`, `size`, `disabled`, `type`, `class`, `onclick`), `Field`(`label`, `hint`, `error`, `for`), `TextInput`(`value` bindable, `id?`, `type`, `placeholder`, `disabled`, `autocomplete: FullAutoFill`, `invalid`, `inputmode: 'text'\|'numeric'`, `class`, `oninput`, `onkeydown`), `toast`. **공통 prop 은 `class` 하나이고 `id?` 는 `TextInput`·`NumberInput`·`Select`·`Checkbox` 에만 있다. `maxlength` prop 은 없다** | 단위 1 §6 |
| `admin/src/screens/LoginScreen.svelte` | `#login-username`, `#login-password`, `#login-message`(`role="alert"`), "OK" 버튼, `onsuccess` 콜백, `localStorage['tttgate.lastUsername']` | 단위 1 §7.1, 단위 2 §7(U2-10) |
| `admin/src/controller/LoginCtrl.ts` | 정적 `login(username, password, bootstrapToken?)` → `{success, user?, mustChangePassword?, message?, ...}` | 단위 2 §7 |
| `test/helpers/adminApp.ts` | `startAdminApp({fixture, login?: {username, password}, extraLogins?}) → {page, url, errors, calls(), close}`. 로그인 진입점은 `login` 하나다. 뷰포트 400×800 | 단위 1 §8.2, 단위 3 §5, U4-06 |
| `test/helpers/rbacFixture.ts` | `RBAC_IDENTITY_FIXTURE`, `RBAC_PASSWORDS`(일반 유저 `user-password-1234`), `RBAC_USER_IDS`, `serializeIdentityFixture` | 단위 3 §5 |
| `test/admin/admin-backend-driver.ts` | 실제 `AdminServer` 를 임시 루트에서 포크한다. IPC `{type: 'calls'}`·`{type: 'login', username, userAgent}`(U4-06). fixture `'rbac'` 는 `rootDir/config/identity.yaml` 을 `serializeIdentityFixture` 로 쓴다 | 단위 1 §8.2, 단위 3 §5, U4-06 |
| `src/util/ClockRng.ts` | `ClockRngProvider.current()`·`configure(impl)`, `createFakeClockRng(seedMs)` — 인자를 생략하면 seed 가 `1_700_000_000_000` 이다 | 현재 저장소 |
| `src/server/mfa/Totp.ts`, `src/server/mfa/Base32.ts` | `generate(secret: Buffer, nowMs): string`, `generateSecret()`, `generateRecoveryCodes()`, `hashRecoveryCode(code, userId)`, `base32Encode(bytes)`, `base32Decode(text): Buffer \| undefined` | U4-03 |
| `src/server/rbac/IdentityTypes.ts` | `type UserMfa = {enabled; secret; enrolledAt; lastUsedStep; recoveryCodeHashes}`, `User.mfa?: UserMfa` | U4-04 |
| 백엔드 API | `POST /api/login` 이 MFA 계정에 `{mfaRequired: true, mfaTicket}` 을 쿠키 없이 돌려주고, `POST /api/login/mfa {mfaTicket, code}` 또는 `{mfaTicket, recoveryCode}` 가 성공 시 쿠키 2개와 `{user, mustChangePassword, mustEnrollMfa, csrfToken}` 을, 실패 시 401 `mfa_code_invalid`·401 `mfa_ticket_invalid`·422·429 를 돌려준다 | U4-08 |

### 실제로 변경할 기존 파일

- `admin/src/controller/LoginCtrl.ts:26` `login(...)`: 반환 타입에 `mfaRequired?: boolean; mfaTicket?: string; code?: string` 를 추가한다(실패 응답의 `code` 를 화면이 분기에 쓴다).
- `admin/src/screens/LoginScreen.svelte`: 비밀번호 폼 아래에 2단계 블록을 더한다. 기존 요소 id 와 `onsuccess` 계약은 그대로 둔다.

먼저 열어 볼 파일: `admin/src/screens/LoginScreen.svelte`, `admin/src/controller/LoginCtrl.ts`, `admin/src/controller/AdminRequest.ts`, `test/admin/screen-login.test.ts`, `test/helpers/adminApp.ts`, `test/helpers/rbacFixture.ts`, `test/admin/admin-backend-driver.ts`, `src/util/ClockRng.ts`.

## 적용되는 결정

- D2 디자인 시스템 부품만 사용. D3 모바일 우선. D5 UI 문구 영어 단일.
- D1 → FR-MFA-ENFORCE-001(비밀번호 + 코드, 복구 코드 1회성)의 화면 부분.
- 프로그램 개요 §3.3 테스트 규약: 브라우저 테스트는 `startAdminApp` 으로 시작하고 `finally` 에서 `close()` 하며 `expect(errors).toEqual([])` 로 끝난다.

## 만들 것

### 부품에 id 를 붙이는 규약

아래 표에서 `Button id="login-mfa-submit"` 처럼 적은 것은 **그 부품을 감싸는 요소에 id 를 붙인다는 뜻이다**(단위 1 §6 의 부품 공통 prop 은 `class` 하나뿐이고 `Button` 에는 `id` prop 이 없다). `Button` 은 `<span id="login-mfa-submit"><Button …>Verify</Button></span>` 로 감싸고, 버튼의 `disabled` 를 단언하는 테스트는 `#login-mfa-submit button` 으로 안쪽 `<button>` 을 고른다. `TextInput` 은 `id?` 가 계약에 있으므로 prop 으로 넘긴다. 단위 1 의 부품 파일을 이 이슈에서 고치지 않는다.

### 컨트롤러

`admin/src/controller/LoginCtrl.ts` 추가:

```ts
    public static async loginMfa(mfaTicket: string, input: {code: string} | {recoveryCode: string}): Promise<LoginResult>;   // POST /api/login/mfa
```

`login()` 과 같은 방식으로 `adminRequest` 를 쓰고 응답 JSON 을 그대로 돌려준다. `fetch` 를 직접 쓰지 않는다. 실패 응답의 `code`·`status`·`message` 를 `LoginResult` 에 그대로 실어 화면이 분기할 수 있게 한다.

### `LoginScreen` 2단계

| 요소 | id | 문구·동작 |
|---|---|---|
| 비밀번호 폼 | 기존 | `login()` 응답이 `mfaRequired` 이면 `mfaTicket` 을 컴포넌트 상태(`let ticket = $state('')`)에 두고 폼을 `{#if}` 로 **DOM 에서 제거한다**(`hidden` 속성이 아니라 아예 렌더하지 않는다). 아래 단계를 그린다 |
| 안내 | `<p id="login-mfa-hint">` | "Enter the 6-digit code from your authenticator app." |
| 코드 입력 | `TextInput id="login-mfa-code" inputmode="numeric" autocomplete="one-time-code"` | 6자리 제한은 `oninput={(v) => code = v.replace(/\D/g, '').slice(0, 6)}` 로 **클라이언트에서 자른다**(`maxlength` 는 `TextInput` 계약에 없는 prop 이라 넘기지 않는다). Enter(`onkeydown`) 또는 "Verify" 로 제출 |
| 제출 | `Button variant="primary" id="login-mfa-submit"` "Verify" | `loginMfa(ticket, {code})`. 성공 → `onsuccess()` |
| 복구 코드 전환 | `<button type="button" id="login-use-recovery">` "Use a recovery code instead" | 코드 입력을 `TextInput id="login-recovery-code" autocomplete="off"` 로 바꾸고(`#login-mfa-code` 는 DOM 에서 사라진다) 안내를 "Enter one of your recovery codes." 로 바꾸며 되돌아가는 링크 `<button type="button" id="login-use-code">` "Use the authenticator app instead" 를 그린다. 제출은 `loginMfa(ticket, {recoveryCode})` |
| 처음으로 | `<button type="button" id="login-mfa-back">` "Start over" | 티켓과 코드 입력을 비우고 비밀번호 폼으로 되돌아간다 |
| 오류 | 기존 `#login-message`(`role="alert"`) | 아래 표 |

오류 문구(`#login-message` 에 그대로 넣는다):

| 응답 | 문구 |
|---|---|
| 401 `mfa_code_invalid` | "The code is incorrect." |
| 401 `mfa_ticket_invalid` | "The sign-in expired. Start again." + 비밀번호 폼으로 되돌림(`#login-password` 를 비우고 티켓 제거) |
| 429 | "Too many attempts. Try again later." |
| 422 | "Enter the code." |
| 빈 코드 제출(클라이언트 검사) | "Enter the code." — 서버를 부르지 않는다 |
| 그 외 | `result.message` 또는 "Unable to connect to the server." |

- 새로고침하면 비밀번호 단계부터 다시 시작한다. 티켓을 어떤 저장소에도 두지 않는다.
- MFA 가 없는 계정의 로그인 흐름은 한 글자도 바뀌지 않는다(`mfaRequired` 가 없으면 기존 `onsuccess()` 경로 그대로).

### 드라이버 IPC 세 개

`test/admin/admin-backend-driver.ts` 에 추가한다. 셋 다 **테스트 드라이버 전용이며 프로덕션 API 가 아니다**(`AdminServer` 라우트로 노출하지 않는다).

| IPC | 응답·동작 |
|---|---|
| `{type: 'mfaSecret', username}` | 드라이버 프로세스 안에서 `IdentityStore.instance.userByUsername(username)?.mfa?.secret`(Base32 문자열)를 돌려준다. 없으면 `undefined` |
| `{type: 'mfaRecoveryCodes', username}` | fixture 가 심어 둔 **평문** 복구 코드 배열을 돌려준다(드라이버가 fixture 를 만들 때 메모리에 들고 있던 값이다. `identity.yaml` 에는 해시만 있다) |
| `{type: 'advanceClock', ms}` | 아래 시계 규약대로 누적 offset 에 `ms` 를 더하고 새 누적값을 돌려준다 |

**가짜 시계 규약.** 드라이버는 기동 시 `ClockRngProvider.configure(createFakeClockRng(Date.now()))` 로 **실시각을 seed 한다**(인자를 생략해 기본 seed `1_700_000_000_000` 을 쓰면 서버 시각과 테스트 프로세스의 `Date.now()` 가 26년 어긋나 TOTP 코드가 절대 맞지 않는다). `advanceClock(ms)` 는 드라이버가 들고 있는 `offset` 에 `ms` 를 더하고, 시계가 `seed + 경과 실시간 + offset` 을 돌려주게 한다. 테스트 프로세스는 같은 offset 을 지역 변수에 누적해 두고 코드를 `generate(base32Decode(secret)!, Date.now() + 누적offset)` 으로 계산한다.

### fixture `'rbac-mfa'`

`'rbac'` 과 같되 `alice` 에 MFA 를 미리 켜 둔다. 드라이버가 fixture 를 만들 때:

1. `secret = generateSecret()` → `base32Encode(secret)` 를 `mfa.secret` 에 둔다.
2. `codes = generateRecoveryCodes()`(평문 10개). 드라이버가 이 배열을 메모리에 보관해 `mfaRecoveryCodes` IPC 로 돌려준다.
3. `alice` 의 `mfa` 를 `{enabled: true, secret: <base32>, enrolledAt: <기동 시각>, lastUsedStep: -1, recoveryCodeHashes: codes.map(c => hashRecoveryCode(c, RBAC_USER_IDS.alice))}` 로 두고 `identity.yaml` 에 직렬화한다.
4. 다른 사용자(`admin`·`bob`·`carol`·`dave`)는 MFA 없음 그대로다.

`test/helpers/adminApp.ts` 의 `fixture` 유니온에 `'rbac-mfa'` 를 추가한다.

## 변경할 것

- `admin/src/controller/LoginCtrl.ts`: `LoginResult` 확장과 `loginMfa`.
- `admin/src/screens/LoginScreen.svelte`: 2단계 블록.
- `test/admin/admin-backend-driver.ts`: IPC 세 개, fixture `'rbac-mfa'`, 가짜 시계 seed 규약.
- `test/helpers/adminApp.ts`: `fixture` 유니온에 `'rbac-mfa'` 추가, 반환에 `mfaSecret(username)`·`mfaRecoveryCodes(username)`·`advanceClock(ms)` 세 헬퍼(각각 위 IPC 를 부른다).
- 삭제할 파일 없음.

## 하지 말 것

- MFA 티켓을 `localStorage`·`sessionStorage`·쿠키에 넣지 않는다. 새로고침하면 처음부터다.
- 코드 입력에 `type="number"` 를 쓰지 않는다(`text` + `inputmode="numeric"`. 앞자리 0 이 보존되어야 한다).
- `ui/` 부품에 계약 밖 prop(`maxlength`, `id` 등)을 넘기지 않는다. 단위 1 의 부품 파일을 고치지 않는다.
- 2단계로 넘어갈 때 비밀번호 폼을 `hidden` 속성으로 남겨 두지 않는다. `{#if}` 로 DOM 에서 제거한다(테스트가 `#login-password` 의 부재로 단계를 판정한다).
- 화면에서 `fetch` 를 직접 부르지 않는다(`LoginCtrl` 경유). hex 색상 리터럴·외부 URL 을 `.svelte` 에 넣지 않는다(`design-system-rules.test.ts` R2·R5).
- 이 이슈에서 `MeScreen`·`UserEditScreen`·`ServerSettingsScreen`·`QrCanvas`·`qrcode` 의존성을 건드리지 않는다(U4-09).
- `mfaSecret`·`mfaRecoveryCodes` 를 `AdminServer` 라우트로 노출하지 않는다. 드라이버 IPC 로만.
- `createFakeClockRng()` 를 인자 없이 부르지 않는다(기본 seed 로는 TOTP 가 어긋난다).

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트. 모든 브라우저 테스트는 뷰포트 400×800, `finally` 에서 `close()`, 마지막에 `expect(errors).toEqual([])`. 코드 계산은 `import {generate} from '../../src/server/mfa/Totp'`, `import {base32Decode} from '../../src/server/mfa/Base32'`.

- `test/admin/screen-login-mfa.test.ts` (신규. 전부 `startAdminApp({fixture: 'rbac-mfa'})` 로 시작하되 `login` 을 넘기지 않고 로그인 화면에서 직접 입력한다)
  - `#login-username` 에 `alice`, `#login-password` 에 `user-password-1234` → "OK" → `#login-password` 가 DOM 에 없고 `#login-mfa-code` 가 보이며 `#login-mfa-hint` 문구가 "Enter the 6-digit code from your authenticator app." 다.
  - `#login-mfa-code` 에 `000000` → "Verify" → `#login-message` 문구가 "The code is incorrect." 이고 `#login-mfa-code` 가 그대로 보인다.
  - 이어서 `mfaSecret('alice')` 로 받은 Base32 로 `generate(base32Decode(secret)!, Date.now())` 를 계산해 입력 → "Verify" → alice 의 기본 화면(`#/tunnels`)에 도착하고 `page.on('load')` 횟수가 1 이다(전체 새로고침 없음).
  - 새 앱에서 1단계를 마친 뒤 `#login-use-recovery` 클릭 → `#login-recovery-code` 가 보이고 `#login-mfa-code` 는 DOM 에 없으며 안내가 "Enter one of your recovery codes." 다 → `mfaRecoveryCodes('alice')[0]` 입력 → "Verify" → 로그인 성공.
  - 위 상태에서 로그아웃하고 **같은 복구 코드**로 다시 시도하면 `#login-message` 가 "The code is incorrect." 다(1회성).
  - `#login-use-recovery` → `#login-use-code` 클릭 → `#login-mfa-code` 가 다시 보이고 `#login-recovery-code` 는 DOM 에 없다.
  - 1단계를 마친 뒤 `advanceClock(121_000)` → 올바른 코드 입력 → "Verify" → `#login-message` 가 "The sign-in expired. Start again." 이고 `#login-password` 가 다시 보이며 값이 비어 있다.
  - 1단계를 마친 뒤 `#login-mfa-back` → `#login-password` 가 다시 보이고 `#login-mfa-code` 는 DOM 에 없다.
  - 코드를 비운 채 "Verify" → `#login-message` 가 "Enter the code." 이고 `calls()` 에 `/api/login/mfa` 요청이 늘지 않는다.
  - `#login-mfa-code` 에 `12a34b567` 를 입력하면 값이 `123456` 이다(숫자만 남기고 6자리에서 자른다).
  - `'rbac-mfa'` 의 `admin`(MFA 없음)으로 로그인하면 2단계 없이 바로 `#/status` 에 도착하고 `#login-mfa-code` 가 한 번도 나타나지 않는다.
- `test/admin/screen-login.test.ts`: 기존 케이스가 그대로 통과한다(`'rbac'`·`'regular-user'` fixture 의 계정은 MFA 가 없으므로 2단계가 나타나지 않는다).
- `test/admin/design-system-rules.test.ts`: R1·R2·R4·R5 가 바뀐 `LoginScreen.svelte` 에도 통과한다.

기존 `test/admin/*.test.ts` 전부 통과. `npm --prefix admin run check` 오류 0.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm --prefix admin run check
npm --prefix admin run build
npm run test:admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U4-08(2단계 로그인 API), U4-06(`extraLogins` 를 더한 `startAdminApp` 과 드라이버 확장), U3-06(단위 3 전체).
- 후행: U4-09(MFA 등록·해제 화면이 이 이슈의 `'rbac-mfa'` fixture 와 IPC 세 개를 그대로 쓴다).

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §3.3(로그인 흐름), §5.3(LoginScreen), §6.3(브라우저 테스트), §7(U4-07)
- `docs/design/2026-09-11-unit3-rbac-screens.md` §5(fixture·`RBAC_PASSWORDS`)
- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §3(층 규칙), §6(부품 계약), §7.1(LoginScreen), §8.2·§8.3(드라이버·브라우저 테스트 규약)
- `docs/design/2026-09-11-program-overview.md` §3.3 테스트 규약, §1 D5
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.5 FR-MFA-ENFORCE-001

---

## U4-08

**title**: feat(admin): 2단계 로그인과 슈퍼유저 MFA 강제 게이트 추가
**labels**: enhancement, area:admin, unit:4
**body**:
## 목적

U4-04 가 만든 MFA 저장소 위에 로그인을 두 단계로 나눈다. 이 이슈가 끝나면 MFA 가 켜진 사용자의 `POST /api/login` 은 쿠키 없이 단기 티켓만 돌려주고, `POST /api/login/mfa` 가 TOTP 코드 또는 복구 코드를 확인한 뒤에야 세션을 발급한다. 서버 옵션 `mfaRequiredForSuperusers` 가 true 면 MFA 없는 슈퍼유저는 로그인 뒤 등록을 마치기 전까지 `me:*` 외 API 가 403 이고, 슈퍼유저는 `POST /api/users/:id/mfa/reset` 으로 남의 MFA 를 초기화할 수 있다. 화면은 U4-07(로그인 2단계)·U4-09(등록 화면·강제 배너).

## 배경

### 전제하는 산출물 (착수 시 아래가 저장소에 없으면 코멘트를 남기고 중단한다)

| 파일 | 심볼 | 출처 |
|---|---|---|
| `src/server/mfa/MfaTickets.ts` | `MfaTicketStore`(`TTL_MS = 120_000`, `MAX_ATTEMPTS = 5`, `issue(userId, ip): string`, `peek(ticket, ip): MfaTicket \| undefined`, `fail(ticket): number`, `consume(ticket): void`, `sweep()`), `PendingEnrollmentStore` | U4-04 |
| `src/server/rbac/IdentityTypes.ts` | `type UserMfa = {enabled; secret; enrolledAt; lastUsedStep; recoveryCodeHashes}`, `User.mfa?: UserMfa` | U4-04 |
| `src/server/rbac/IdentityStore.ts` | `markMfaStep(id, step)`, `clearMfa(id)`, `consumeRecoveryCode(id, hash): Result<{remaining}>` — 실패값은 `{success: false, status: 422, code: 'recovery_code_invalid'}` | U4-04 |
| 같은 파일 | `export type Result<T> = {success: true; value: T} \| {success: false; status: 404 \| 409 \| 422; code: string; message: string}` — **status 는 세 값으로 닫혀 있다** | 단위 2 §4.1 |
| `src/server/mfa/Totp.ts`, `src/server/mfa/Base32.ts` | `verify(secret, code, nowMs, lastUsedStep): VerifyResult`, `normalizeRecoveryCode`, `hashRecoveryCode`, `base32Decode` | U4-03 |
| `src/server/rbac/AdminAuthorizer.ts` | `type Action`(`'me:mfa'` 포함), `authorize(principal, action, target)`, `mustChangePassword` 게이트(`me:read`·`me:password` 외 403 `password_change_required`) | 단위 2 §4.4, U4-04 |
| `src/server/rbac/Principal.ts` | `Principal = {userId; username; role; groupId; attributes; mustChangePassword; legacy?}` | 단위 2 §4.4 |
| `src/server/admin/SessionStore.ts` | `type Session = {key; userId; createdAt; lastSeenAt; timeout; ip; userAgent?}`, `newSession(userId, {ip, userAgent})`, `resolveSession(keys)`, `removeSessionsOfUser(userId, options?: {except?: string}): number`, `static sessionIdOf(key)` | 단위 2 §4.3 |
| `src/server/admin/routes.ts` | `ADMIN_ROUTES`, `type Route = {method; pattern; action: Action \| 'public' \| 'session' \| ((ctx) => Action); handler; audit?: boolean}`, `RouteContext = {req; res; params; principal?; ip; ok(); fail()}` | 단위 2 §5.1, U4-04 |
| `src/server/admin/rbacRoutes.ts` | `rbacRouteTable(): Route[]`, `replyResult(ctx, result, onSuccess, successStatus?)`. `/api/me/mfa/*` 네 개가 여기 있다 | 단위 2 §5.2, U4-04 |
| `src/server/audit/AuditEventTypes.ts` | `AUDIT_EVENT_TYPES.mfa_success`·`mfa_failure`·`mfa_recovery_used`·`mfa_reset`·`login_success`·`login_failure` — U4-01 이 아직 없으면 같은 이름의 문자열 리터럴을 쓰고 U4-01 이 상수로 치환한다 | U4-01 |
| `test/component/server/admin/rbac-login.test.ts`, `mfa-api.test.ts` | 로그인·MFA 컴포넌트 테스트 패턴 | 단위 2 §8.2, U4-04 |

### 실제로 변경할 기존 파일 (현재 저장소 기준)

- `src/server/admin/AdminServer.ts:34-38` 백오프 상수 `LOGIN_WINDOW_MS = 60_000`, `LOGIN_BLOCK_MS = 60_000`, `LOGIN_MAX_FAILURES = 5`, `LOGIN_ATTEMPT_MAP_LIMIT = 10_000`. `:68` `_loginAttempts: Map<string, LoginAttemptState>`. `:1352` `now()`, `:1360` `getClientAddress(req)`, `:1398` `buildLoginAttemptKey(req)`(IPv4 /24, IPv6 /64 버킷), `:1402` `isLoginBlocked(req)`, `:1407` `recordLoginFailure(req)`, `:1431` `resetLoginAttempts(req)`, `:1435` `delayFailedLogin(req)`(`computeBackoffMs(failedCount) = min(2^n × 100, 5000)` 만큼 실제로 대기). **MFA 코드 실패도 이 네 함수를 그대로 부른다.**
- `src/server/admin/AdminServer.ts:160` `const skipCsrfHeader = (pathname == '/api/login');` 과 `:1496` `verifyCsrfGuard(req, res, skipCsrfHeader)`: `skipCsrfHeader` 가 true 면 Origin 화이트리스트 검사만 하고 CSRF 헤더 검사를 건너뛴다. 여기에 `/api/login/mfa` 를 더한다.
- `src/server/admin/AdminServer.ts:1053-1065` 로그인 성공 시 `sessionKey` 쿠키(HttpOnly, SameSite=Strict, TLS 면 Secure, Max-Age 12h)와 `csrfToken` 쿠키를 발급하고 `{success: true, ..., csrfToken}` 을 돌려준다. **이 블록을 `issueSession(req, res, user)` 로 뽑아** 로그인 성공과 MFA 성공 두 곳에서 쓴다.

먼저 열어 볼 파일: `src/server/admin/AdminServer.ts`(150~175행, 1035~1075행, 1345~1445행, 1488~1560행), `src/server/admin/routes.ts`, `src/server/admin/rbacRoutes.ts`, `src/server/admin/SessionStore.ts`, `src/server/rbac/AdminAuthorizer.ts`, `src/server/rbac/Principal.ts`, `src/server/mfa/MfaTickets.ts`, `src/server/mfa/Totp.ts`, `test/component/server/admin/rbac-login.test.ts`.

## 적용되는 결정

- D1 → FR-MFA-ENFORCE-001(비밀번호 + 코드, 복구 코드 1회성), FR-MFA-SU-POLICY-001(슈퍼유저 강제 토글), FR-MFA-RESET-001(슈퍼유저 초기화 + 감사), NFR-SEC-NEW-ENDPOINT-BACKOFF-001(MFA·복구 코드 실패도 백오프), NFR-SEC-NEW-ENDPOINT-CSRF-001.
- 프로그램 개요 §3.4: CSRF 헤더 예외는 `/api/login` 과 `/api/login/mfa` 두 개뿐이고 이 둘도 Origin 검사는 받는다.
- PRD §12 Q1 가정: `mfaRequiredForSuperusers` 기본 false.

## 만들 것

### 로그인 흐름

```
POST /api/login {username, password}
  → 비밀번호 실패: 401 (기존 백오프·감사 login_failure)
  → 성공, user.mfa?.enabled !== true: 기존대로 세션 발급 (issueSession)
  → 성공, user.mfa.enabled === true:
       resetLoginAttempts(req) 는 하지 않는다 (2단계가 끝나야 성공)
       ticket = mfaTickets.issue(user.id, ip)
       200 {success: true, partial: false, failedScopes: [], warnings: [], message: '', mfaRequired: true, mfaTicket: ticket}
       쿠키 없음. 감사 없음 (login_success 는 2단계 뒤).
POST /api/login/mfa {mfaTicket, code} | {mfaTicket, recoveryCode}
  → isLoginBlocked(req) 이면 429 'Too many login attempts' (기존과 동일)
  → 본문에 code 와 recoveryCode 가 둘 다 없거나 둘 다 있으면 422 'Provide code or recoveryCode'
  → peek(ticket, ip) 가 undefined: recordLoginFailure + delayFailedLogin,
       401 {code: 'mfa_ticket_invalid', message: 'The sign-in expired. Start again.'}
  → code: Totp.verify(base32Decode(mfa.secret), code, now, mfa.lastUsedStep)
       ok → markMfaStep(userId, step), 감사 mfa_success
       아니면 → fail(ticket) (5회째면 티켓 삭제), recordLoginFailure + delayFailedLogin,
                감사 mfa_failure(detail.reason), 401 {code: 'mfa_code_invalid', message: 'The code is incorrect.'}
  → recoveryCode: normalizeRecoveryCode → undefined 면 위 실패 경로.
       아니면 consumeRecoveryCode(userId, hashRecoveryCode(정규화된 코드, userId))
       성공 → 감사 mfa_recovery_used(detail.remaining), 계속
       실패(422 recovery_code_invalid) → 위 실패 경로와 동일하게 401 'mfa_code_invalid' 로 매핑
  → 성공: consume(ticket), resetLoginAttempts(req), issueSession(req, res, user)
       → 응답은 /api/login 성공과 같은 형태 (user, mustChangePassword, mustEnrollMfa, csrfToken, 쿠키 2개), 감사 login_success
```

- `/api/login/mfa` 는 `routes.ts` 에서 `action: 'public'` 이고 `audit: false` 를 붙이지 않는다(성공·실패 모두 감사한다. 다만 `audited()` 가 아니라 핸들러가 직접 `record` 한다. 감사 커버리지 테스트에서 `public` 라우트는 주체 없이 호출할 수 없으므로 `ADMIN_ROUTES` 순회 대상에서 빠진다).
- `AdminServer.ts:160` 의 `skipCsrfHeader` 를 `(pathname == '/api/login' || pathname == '/api/login/mfa')` 로 바꾼다. Origin 검사는 그대로 받는다.
- `Result<T>` 의 `status` 유니온을 넓히지 않는다. `consumeRecoveryCode` 의 422 `recovery_code_invalid` 는 **이 핸들러가** 401 `mfa_code_invalid` 로 바꿔 응답한다(로그인 경로의 실패는 어느 쪽이 틀렸는지 알려 주지 않는다).

### 강제 게이트 (`mustEnrollMfa`)

- `issueSession` 시점에 `serverOption.mfaRequiredForSuperusers === true && user.role === 'superuser' && user.mfa?.enabled !== true` 이면 세션에 `mustEnrollMfa: true` 를 둔다. `Session` 타입과 `Principal` 에 `mustEnrollMfa: boolean` 을 추가한다.
- `SessionStore.updateSession(key: string, patch: {mustEnrollMfa?: boolean}): void` 를 추가한다. `Map` 항목은 불변 객체로 두고 새 객체로 `set` 한다.
- `authorize` 는 `mustChangePassword` 게이트 **다음**에 `mustEnrollMfa` 게이트를 둔다: `me:read`, `me:password`, `me:mfa`, `me:sessions` 외 전부 `{allowed: false, status: 403, code: 'mfa_enrollment_required', message: 'Enable two-factor authentication first.'}`.
- U4-04 가 만든 `POST /api/me/mfa/confirm` 핸들러의 성공 경로 끝에 `SessionStore.updateSession(현재 세션 키, {mustEnrollMfa: false})` 한 줄을 더한다.
- 게이트는 **로그인 시점에만 계산한다.** 옵션을 켠 순간 이미 열려 있던 세션은 잠기지 않는다.
- `/api/me` 와 `/api/validateSession` 응답에 `mustEnrollMfa: boolean` 을 추가한다.

### `POST /api/users/:id/mfa/reset` (`rbacRoutes.ts`)

| 메서드·경로 | action | 요청 | 응답·동작 |
|---|---|---|---|
| `POST /api/users/:id/mfa/reset` | `user:manage` | — | 대상 없음 404 `user_not_found`. `clearMfa(id)` + `SessionStore.removeSessionsOfUser(id)`. `enabled` 가 아니었어도 200(멱등). 감사 `mfa_reset`(target user). 응답 `{user: UserView}` |

**이 핸들러는 `src/server/admin/rbacRoutes.ts` 의 `rbacRouteTable()` 에 넣는다**(단위 2 가 `/api/users/*` 를 그 파일로 모아 두었고 `AdminServer.ts` 를 더 키우지 않는다). CSRF 헤더 검사 대상이다.

요청·응답 예시:

```
POST /api/login  {"username": "alice", "password": "user-password-1234"}
→ 200 {"success": true, "partial": false, "failedScopes": [], "warnings": [], "message": "",
       "mfaRequired": true, "mfaTicket": "3c1f…(64 hex)"}

POST /api/login/mfa  {"mfaTicket": "3c1f…", "code": "287082"}
→ 200 Set-Cookie: sessionKey=…; HttpOnly; SameSite=Strict   Set-Cookie: csrfToken=…; SameSite=Strict
      {"success": true, "partial": false, "failedScopes": [], "warnings": [], "message": "", "csrfToken": "…",
       "user": {"id": "u_…", "username": "alice", "displayName": "Alice", "role": "regular"},
       "mustChangePassword": false, "mustEnrollMfa": false}

POST /api/login/mfa  {"mfaTicket": "3c1f…", "code": "000000"}
→ 401 {"success": false, "status": 401, "code": "mfa_code_invalid", "message": "The code is incorrect."}

POST /api/login/mfa  {"mfaTicket": "expired", "recoveryCode": "ab12-cd34"}
→ 401 {"success": false, "status": 401, "code": "mfa_ticket_invalid", "message": "The sign-in expired. Start again."}

POST /api/login/mfa  {"mfaTicket": "3c1f…"}
→ 422 {"success": false, "status": 422, "message": "Provide code or recoveryCode"}

POST /api/users/u_1234/mfa/reset
→ 200 {"success": true, ..., "user": {"id": "u_1234", "username": "bob", "mfaEnabled": false, "…": "…"}}
→ 404 {"success": false, "status": 404, "code": "user_not_found", "message": "User not found"}

GET /api/me  (mfaRequiredForSuperusers=true, MFA 없는 슈퍼유저)
→ 200 {"success": true, ..., "user": {...}, "mustEnrollMfa": true, "mfa": {"enabled": false, "recoveryCodesRemaining": 0}}
GET /api/users  (같은 세션)
→ 403 {"success": false, "status": 403, "code": "mfa_enrollment_required", "message": "Enable two-factor authentication first."}
```

## 변경할 것

- `src/server/admin/AdminServer.ts`: `:160` CSRF 예외 확장; `POST /api/login` 핸들러의 MFA 분기; `issueSession(req, res, user)` 추출; `POST /api/login/mfa` 핸들러(공개 라우트라 `AdminServer.ts` 의 로그인 핸들러 옆에 둔다); `/api/me`·`/api/validateSession` 응답에 `mustEnrollMfa`.
- `src/server/admin/rbacRoutes.ts`: `POST /api/users/:id/mfa/reset` 라우트·핸들러; `POST /api/me/mfa/confirm` 성공 경로에 세션 `mustEnrollMfa` 해제 한 줄.
- `src/server/admin/routes.ts`: `POST /api/login/mfa` 항목 추가(`action: 'public'`).
- `src/server/admin/SessionStore.ts`: `Session.mustEnrollMfa: boolean`, `updateSession(key, patch)`.
- `src/server/rbac/Principal.ts`, `src/server/rbac/AdminAuthorizer.ts`: `mustEnrollMfa` 필드와 게이트.
- 삭제할 파일 없음.

## 하지 말 것

- `Totp.ts`·`Base32.ts`·`MfaTickets.ts` 를 수정하지 않는다(U4-03·U4-04). 코드·해시 비교를 핸들러 안에서 직접 하지 않는다(`verify`·`consumeRecoveryCode` 경유).
- MFA 티켓을 쿠키로 주지 않는다. 본문 필드로만.
- 1단계 비밀번호 성공 시점에 `resetLoginAttempts` 나 `login_success` 기록을 하지 않는다.
- `/api/login/mfa` 를 제외한 새 POST/DELETE 를 CSRF 예외에 넣지 않는다. `/api/users/:id/mfa/reset` 은 CSRF 대상이다.
- `Result<T>` 의 `status` 유니온(`404 | 409 | 422`)을 넓히지 않는다. 401 이 필요하면 이 핸들러에서 매핑한다.
- 복구 코드 실패와 TOTP 코드 실패에 서로 다른 `code` 를 주지 않는다. 둘 다 `mfa_code_invalid` 다.
- 옵션을 켠 순간 기존 세션을 소급해서 잠그지 않는다(게이트는 로그인 시점 계산).
- `mustEnrollMfa` 게이트를 `mustChangePassword` 게이트보다 앞에 두지 않는다.
- 비밀번호 검증 실패 백오프 규칙(`LOGIN_MAX_FAILURES` 등)을 바꾸지 않는다.
- 티켓 저장소에 잠금이나 `async-mutex` 를 쓰지 않는다. 항목 갱신은 새 객체 `set`.
- 예외를 제어 흐름으로 쓰지 않는다: 티켓 없음·만료·형식 오류는 `undefined`·반환값 분기.
- `audited()` 를 바꾸지 않는다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/unit/server/admin/SessionStore.test.ts` (기존 파일에 추가)
  - `newSession` 뒤 `updateSession(key, {mustEnrollMfa: false})` 하면 `resolveSession([key])` 의 `mustEnrollMfa` 가 false 이고 다른 필드(`createdAt`·`ip`·`userAgent`)가 그대로다. 없는 키로 부르면 아무 일도 일어나지 않는다.
- `test/unit/server/rbac/AdminAuthorizer.test.ts` (추가)
  - `mustEnrollMfa: true` 주체는 `me:read`·`me:password`·`me:mfa`·`me:sessions` 만 허용이고 `tunnel:list` 는 `{allowed: false, status: 403, code: 'mfa_enrollment_required'}` 다.
  - `mustChangePassword: true` 와 `mustEnrollMfa: true` 가 같이 있으면 `me:mfa` 가 403 `password_change_required` 다(비밀번호 게이트가 먼저).
  - `mustEnrollMfa: false` 주체는 게이트의 영향을 받지 않는다.
- `test/component/server/admin/mfa-login.test.ts` (신규, 실제 `AdminServer`. 테스트가 `generate(base32Decode(secret), now)` 로 코드를 계산하고 시계는 `ClockRngProvider` 를 앞당긴다. fixture: 슈퍼유저 `admin`(`test-password-1234`), 일반 유저 `alice`(`user-password-1234`))
  - `alice` 가 `enroll`+`confirm` 으로 MFA 를 켠 뒤 `POST /api/logout` → 비밀번호만으로 `POST /api/login` 하면 200 이고 `mfaRequired: true`, `mfaTicket` 이 64 hex 이며 `Set-Cookie` 헤더가 없다.
  - 그 티켓으로 `POST /api/login/mfa {mfaTicket, code}` 에 올바른 코드를 보내면 200, 쿠키 2개, `user.username === 'alice'`, `mustEnrollMfa: false` 이고 그 세션으로 `GET /api/me` 가 200 이다.
  - 같은 코드로 새 티켓을 받아 다시 시도하면 401 `mfa_code_invalid` 다(재사용 거부). 시계를 30초 앞당겨 새 코드를 만들면 200 이다.
  - **`POST /api/login/mfa {mfaTicket, code: '000000'}` 를 5번 부르면 다섯 번 모두 401 `mfa_code_invalid` 이고, 여섯 번째 요청은 429 `'Too many login attempts'` 다**(다섯 번째 실패로 `LOGIN_MAX_FAILURES` 에 닿아 `blockedUntil = now + 60s` 가 서기 때문에 티켓 소멸을 이 요청으로는 확인할 수 없다). **티켓 소멸은 시계를 61초 앞당겨 새 `POST /api/login` 으로 새 티켓을 받은 뒤, 옛 티켓으로 `POST /api/login/mfa` 를 불러 401 `mfa_ticket_invalid` 가 나오는지로 확인한다.** 두 번째 실패 응답 시간이 첫 번째보다 100ms 이상 길다(`computeBackoffMs` 적용). **이 케이스는 다섯 번의 `delayFailedLogin` 실지연 합이 6.2초라 Jest 기본 타임아웃 5초를 넘으므로 `test('…', async () => { … }, 30_000)` 로 타임아웃을 30초로 둔다.**
  - 다른 IP(`X-Forwarded-For` 를 신뢰하도록 `AdminSecurityPolicyRegistry` 설정)에서 같은 티켓을 쓰면 401 `mfa_ticket_invalid` 이고, 그 뒤 원래 IP 로도 같은 티켓이 401 이다.
  - `recoveryCode` 로 로그인하면 200 이고 `GET /api/me` 의 `recoveryCodesRemaining` 이 9 다. 같은 복구 코드로 다시 로그인하면 401 `mfa_code_invalid`. 대문자·하이픈 없이 보내도(`AB12CD34`) 200 이다.
  - `{mfaTicket, code, recoveryCode}` 셋 다 보내면 422 `Provide code or recoveryCode`, `{mfaTicket}` 만 보내도 422 다.
  - 티켓 없이 `POST /api/login/mfa {code}` 만 보내면 401 `mfa_ticket_invalid` 다.
  - `POST /api/login/mfa` 를 CSRF 헤더 없이 불러도 403 `Missing CSRF token` 이 아니다. `POST /api/me/mfa/enroll` 을 CSRF 헤더 없이 부르면 403 이다.
  - `POST /api/login/mfa` 에 허용되지 않은 `Origin` 을 붙이면 403 `Forbidden origin` 이다.
  - 기록된 감사 이벤트(`AuditSinkRegistry` 에 배열 스텁을 두어 수집)에 `mfa_failure`×5, `mfa_success`, `mfa_recovery_used`, `login_success` 가 있고, 1단계만 성공한 시점에는 `login_success` 가 없다. 어떤 이벤트를 `JSON.stringify` 해도 `mfa.secret` 값과 복구 코드 평문이 나타나지 않는다.
- `test/component/server/admin/mfa-enforcement.test.ts` (신규)
  - 서버 옵션 `mfaRequiredForSuperusers: true` 를 저장하고 MFA 없는 슈퍼유저 `admin` 으로 로그인하면 로그인 응답과 `GET /api/validateSession`·`GET /api/me` 의 `mustEnrollMfa` 가 전부 true 다.
  - 그 세션에서 `GET /api/users` 는 403 `mfa_enrollment_required`, `GET /api/me` 는 200, `PUT /api/me/password` 는 403 이 아니고, `GET /api/me/sessions` 도 403 이 아니다.
  - 같은 세션으로 `enroll`+`confirm` 을 마치면 **재로그인 없이** `GET /api/users` 가 200 이고 `GET /api/me` 의 `mustEnrollMfa` 가 false 다.
  - 옵션을 켜기 **전에** 만든 슈퍼유저 세션은 옵션을 켠 뒤에도 `GET /api/users` 가 200 이다(소급 적용 없음).
  - 옵션이 true 여도 일반 유저 `alice` 의 `mustEnrollMfa` 는 false 이고 `GET /api/tunnels` 가 200 이다.
  - MFA 를 켠 슈퍼유저의 `DELETE /api/me/mfa` 는 409 `mfa_required` 다(U4-04 가 만든 검사가 이 옵션으로 동작하는지 확인).
- `test/component/server/admin/mfa-reset.test.ts` (신규)
  - `admin` 이 `POST /api/users/<alice id>/mfa/reset` 하면 200 이고 응답 `user.mfaEnabled` 가 false 이며, alice 의 기존 세션 쿠키로 `GET /api/me` 가 401 이고, alice 가 비밀번호만으로 로그인된다(`mfaRequired` 없음).
  - 한 번 더 부르면 200 이다(멱등). 없는 id 는 404 `user_not_found` 다.
  - 일반 유저 `alice` 가 `POST /api/users/<bob id>/mfa/reset` 을 부르면 403 이다.
  - CSRF 헤더 없이 부르면 403 이다.
  - 감사에 `mfa_reset` 이 있고 `target.id` 가 alice 의 id 다.
- `test/component/server/admin/audit-sink.test.ts` (확장): 새 CUD 라우트 `POST /api/users/:id/mfa/reset` 이 `ADMIN_ROUTES` 순회에 포함되어 `record` 가 불린다.
- `npm run lint` 위반 0건.

기존 `test/component/server/admin/*.test.ts`, `test/unit/server/admin/*.test.ts`(백오프·쿠키·CSRF 테스트 포함) 전부 통과.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run test:browser:install
npm run lint
npx jest --runInBand test/unit/server/admin test/unit/server/rbac test/component/server/admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U4-04(`MfaTickets`·`IdentityStore` MFA 확장·`/api/me/mfa/*`·`mfaRequiredForSuperusers`). U4-01·U4-05 와 병렬 가능.
- 후행: U4-07(로그인 2단계 화면), U4-09(등록 화면·강제 배너).

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §3.3(로그인 흐름·게이트·CSRF 예외), §3.4(API), §6.2(mfa-login), §7(U4-04 를 U4-04·U4-08 로 나눈 뒤쪽)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §4.1(`Result<T>`), §4.3(SessionStore), §4.4(Action·게이트·Principal), §5.1(`routes.ts`), §5.2(`rbacRoutes.ts`·`/api/login`·`/api/me`)
- `docs/design/2026-09-11-program-overview.md` §3.4(CSRF 예외 두 개), §3.1(예외·잠금 규약)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.5, §5.2.1 NFR-SEC-NEW-ENDPOINT-CSRF-001·NFR-SEC-NEW-ENDPOINT-BACKOFF-001, §12 Q1

---

## U4-09

**title**: feat(admin): 내 계정 MFA 등록 화면과 세션 카드, 보안 서버 설정 추가
**labels**: enhancement, area:frontend, unit:4
**body**:
## 목적

U4-04·U4-08 의 MFA API 와 U4-05 의 세션 API 를 관리자 UI 에 붙인다. 이 이슈가 끝나면 사용자는 내 계정 화면에서 QR 코드로 인증 앱을 등록하고 복구 코드를 저장하고 해제·재발급할 수 있으며, 같은 화면의 "Sessions" 카드에서 다른 기기를 로그아웃할 수 있다. 사용자 편집 화면에 "Reset MFA", 서버 설정 화면에 "Security" 카드(슈퍼유저 MFA 강제, 감사 보존 일수, 감사 큐 크기)가 생기고, `mustEnrollMfa` 상태의 슈퍼유저는 `#/me` 에 고정된다. 로그인 2단계 화면은 U4-07 이 이미 만들었다.

## 배경

### 전제하는 산출물 (착수 시 아래가 저장소에 없으면 코멘트를 남기고 중단한다)

| 파일 | 심볼·계약 | 출처 |
|---|---|---|
| `admin/src/ui/*.svelte` | `Button`(`variant`, `size`, `disabled`, `type`, `class`, `onclick`), `Field`(`label`, `hint`, `error`, `for`), `TextInput`(`value` bindable, `id?`, `type`, `autocomplete`, `inputmode`, `oninput`), `NumberInput`(`value` bindable `number \| null`, `id?`, `min`, `max`, `step`), `Checkbox`(`checked` bindable, `id?`, `label`), `Card`(`label`, `ticked`, `compact`), `Chip`(`tone`, `mono`), `Badge`(`tone`), `Modal`(`open` bindable, `title`, `closeOnOverlay`, `footer` 스니펫. `open` 일 때만 렌더하고 `window` 의 `keydown` 에서 `Escape` → `open = false`), `Banner`(`tone`, `dismissible`, `ondismiss`), `toast`, `Loading`. **공통 prop 은 `class` 하나이고 `id?` 는 `TextInput`·`NumberInput`·`Select`·`Checkbox` 에만 있다. `Modal` 에 `closeOnEscape` prop 은 없다** | 단위 1 §6 |
| `admin/src/screens/MeScreen.svelte` | `Card "Account"`(username, display name, role `Chip`, group), "Change password" 버튼 | 단위 3 §4.5 |
| `admin/src/screens/UserEditScreen.svelte` | 하단 고정 바("Save", "Reset password", "Delete"), "Sessions" 행(`#user-sessions`, `#user-session-count`, `#user-end-sessions`) | 단위 3 §4.2, U4-06 |
| `admin/src/screens/ServerSettingsScreen.svelte` | 필드 `input-key`, `input-admin-port`, …, "Apply"(`_isNewValue` 일 때 활성), "Reset", `_apply` → `_checkServerRestart`, 실패 시 오류 모달 | 단위 1 §7.5 |
| `admin/src/controller/MeCtrl.ts` | `me()`, `changePassword()`, `acknowledgeMigration()`, `sessions(): Promise<SessionView[]>`, `logoutOthers(): Promise<{removed: number}>` | 단위 3 §2, U4-06 |
| `admin/src/controller/UsersCtrl.ts` | `instance.list(): Promise<UserView[]>`, `get(id)`, `update(id, patch)` | 단위 3 §2 |
| `admin/src/util/relativeTime.ts` | `relativeTime(fromMs, nowMs): string`, `formatLocal(ms, withSeconds): string` | U4-06 |
| `admin/src/controller/Types.ts` | `SessionView = {id; userId; username; createdAt; lastSeenAt; ip; userAgent; current}`, `UserView`, `MeResponse` | 단위 3 §2, U4-06 |
| `admin/src/me.ts` | `me` 스토어(`/api/me` 결과: `user`, `group`, `sections`, `migrationBanner`, `mustChangePassword`), `loadMe()` | 단위 2 §7, 단위 3 U3-01 |
| `admin/src/App.svelte` | `me.mustChangePassword` 이면 `#/me/password` 고정 + 드로어 메뉴 버튼(`aria-label="Open menu"`) 숨김 | 단위 3 §3(U3-02) |
| `test/helpers/adminApp.ts` | `startAdminApp({fixture, login?: {username, password}, extraLogins?})`, 반환의 `mfaSecret(username)`·`mfaRecoveryCodes(username)`·`advanceClock(ms)`·`sessions()`. fixture `'rbac'`·`'rbac-mfa'` | 단위 1 §8.2, U4-06, U4-07 |
| `test/admin/admin-backend-driver.ts` | IPC `{type: 'calls'}`·`{type: 'login', …}`·`{type: 'mfaSecret', …}`·`{type: 'mfaRecoveryCodes', …}`·`{type: 'advanceClock', ms}`. 가짜 시계는 `createFakeClockRng(Date.now())` 로 seed | U4-06, U4-07 |
| 백엔드 API | `POST /api/me/mfa/enroll`, `POST /api/me/mfa/confirm`, `DELETE /api/me/mfa`, `POST /api/me/mfa/recovery-codes`, `GET /api/me` 의 `mfa: {enabled, recoveryCodesRemaining}`, `UserView.mfaEnabled`(U4-04), `GET /api/me` 의 `mustEnrollMfa`·`POST /api/users/:id/mfa/reset`(U4-08), `GET /api/me/sessions`·`POST /api/me/sessions/logout-others`(U4-05), `/api/serverOption` 의 `mfaRequiredForSuperusers`(U4-04)·`auditRetentionDays`·`auditQueueSize`(U4-01) | |
| `src/server/mfa/Totp.ts`, `src/server/mfa/Base32.ts` | 테스트가 `generate(base32Decode(secret)!, Date.now() + 누적offset)` 로 코드를 계산한다 | U4-03 |

### 실제로 변경할 기존 파일

- `admin/package.json:22-26` `dependencies`: `@types/lodash`, `lodash`, `node-forge`. 여기에 `qrcode` 를 **`dependencies`** 로, `@types/qrcode` 를 **`devDependencies`** 로 추가한다. 두 패키지 모두 exact 버전 고정(`^`·`~` 없이). `admin/package-lock.json` 갱신을 **같은 커밋**에 넣는다.
- `admin/src/me.ts`: `me` 스토어 타입에 `mfa: {enabled: boolean; recoveryCodesRemaining: number}` 와 `mustEnrollMfa: boolean` 을 **이 이슈에서 추가한다**(U4-04·U4-08 은 서버 파일만 바꾼다).
- `admin/src/controller/Types.ts`: `UserView` 에 `mfaEnabled: boolean` 을, `MeResponse` 에 위 두 필드를 **이 이슈에서 추가한다**(같은 이유).
- `admin/src/App.svelte`: `mustChangePassword` 고정 로직 옆에 `mustEnrollMfa` 고정을 더한다.

먼저 열어 볼 파일: `admin/package.json`, `admin/src/screens/MeScreen.svelte`, `admin/src/screens/UserEditScreen.svelte`, `admin/src/screens/ServerSettingsScreen.svelte`, `admin/src/controller/MeCtrl.ts`, `admin/src/controller/UsersCtrl.ts`, `admin/src/App.svelte`, `admin/src/me.ts`, `test/admin/screen-me.test.ts`, `test/admin/screen-users.test.ts`, `test/admin/screen-server-settings.test.ts`, `test/admin/design-system-rules.test.ts`.

## 적용되는 결정

- D2·D3·D5 (디자인 시스템 부품, 모바일 우선, 영어 문구). D6 외부 요청 없음 → QR 은 `qrcode` 패키지가 로컬 canvas 에 그린다. 이미지 URL 서비스 금지.
- D1 → FR-MFA-ENROLL-001(QR + 복구 코드 1회 노출), FR-MFA-SU-POLICY-001, FR-MFA-RESET-001, FR-SESSION-SELF-KILL-001, FR-AUDIT-RETENTION-001(서버 설정으로 변경).

## 만들 것

### 부품에 id 를 붙이는 규약

아래 표에서 `Card id="me-mfa"`·`Button id="mfa-setup"`·`Badge id="mfa-status"` 처럼 적은 것은 **그 부품을 감싸는 요소에 id 를 붙인다는 뜻이다.** 단위 1 §6 의 부품 공통 prop 은 `class` 하나뿐이고 `Button`·`Card`·`Chip`·`Badge`·`Modal`·`Banner` 에는 `id` prop 이 없다. 단위 1 의 부품 파일을 이 이슈에서 고치지 않는다.

| 부품 | 어떻게 |
|---|---|
| `TextInput`, `NumberInput`, `Checkbox` | `id?` 가 계약에 있다. 표에 적힌 대로 prop 으로 넘긴다 |
| `Card` | `<section id="me-mfa"><Card label="Two-factor authentication">…</Card></section>` 로 감싼다 |
| `Button` | `<span id="mfa-setup"><Button variant="primary">Set up</Button></span>` 로 감싼다. **버튼의 `disabled` 를 단언하는 테스트는 `#mfa-done button` 처럼 안쪽 `<button>` 을 고른다** |
| `Badge`, `Chip` | `<span id="mfa-status"><Badge tone="neutral">Off</Badge></span>` 로 감싼다 |
| `Banner` | `<div id="mfa-required-banner"><Banner tone="warn">…</Banner></div>` 로 감싼다 |
| `Modal` | 감싸지 않는다(감싸는 요소는 모달이 닫혀도 남아 "모달이 사라졌다" 를 단언할 수 없다). `class` prop 을 쓰고 선택자를 `.mfa-enroll-modal` 처럼 클래스로 적는다 |

### 의존성

`cd admin && npm install --save-exact qrcode@1.5.4 && npm install --save-exact --save-dev @types/qrcode@1.5.5`(npm 에 그 버전이 없으면 1.5.x 최신을 exact 로). 사용 방식은 한 곳(`admin/src/screens/parts/QrCanvas.svelte`)에서만:

```svelte
<script lang="ts">
  import QRCode from 'qrcode';
  import {toast} from '../../ui/toast';
  let {value, size = 192}: {value: string; size?: number} = $props();
  let canvasEl: HTMLCanvasElement;
  $effect(() => {
    QRCode.toCanvas(canvasEl, value, {width: size, margin: 1, errorCorrectionLevel: 'M'})
      .catch(() => toast.push({tone: 'alarm', message: 'Could not draw the QR code.'}));
  });
</script>
<canvas bind:this={canvasEl} id="mfa-qr" width={size} height={size} aria-label="Scan with your authenticator app"></canvas>
```

`design-system-rules.test.ts` R1 은 `admin/src/ui/**` 안에서 `fetch`·`adminRequest`·`controller/*` import 를 금지하는 규칙이므로 `screens/parts/QrCanvas.svelte` 의 라이브러리 import 와는 무관하다. 새 규칙 R8(아래 수용 기준)이 `qrcode` import 위치를 직접 강제한다.

### 컨트롤러

`admin/src/controller/MeCtrl.ts` 추가:

```ts
    enrollMfa(): Promise<{secret: string; otpauthUri: string; recoveryCodes: string[]}>;   // POST /api/me/mfa/enroll
    confirmMfa(code: string): Promise<{mfa: {enabled: boolean; recoveryCodesRemaining: number}}>;   // POST /api/me/mfa/confirm
    disableMfa(password: string): Promise<void>;                          // DELETE /api/me/mfa (본문 {password})
    regenerateRecoveryCodes(password: string): Promise<string[]>;         // POST /api/me/mfa/recovery-codes
```

`sessions()`·`logoutOthers()` 는 U4-06 이 만든 것을 그대로 쓴다(이 이슈에서 만들거나 고치지 않는다).

`admin/src/controller/UsersCtrl.ts` 추가: `resetMfa(id: string): Promise<UserView>` (`POST /api/users/:id/mfa/reset`).

네 메서드 모두 `adminRequest` 로 호출하고, 실패 응답의 `status`·`code` 를 화면이 분기할 수 있게 그대로 올린다. `fetch` 를 직접 쓰지 않는다.

### `MeScreen` 확장 — MFA 카드

"Two-factor authentication" 카드 `<section id="me-mfa"><Card label="Two-factor authentication">`:

| 상태 | 요소 |
|---|---|
| Off | `<span id="mfa-status"><Badge tone="neutral">Off</Badge></span>` + `<span id="mfa-setup"><Button variant="primary">Set up</Button></span>` |
| Enabled | `<span id="mfa-status"><Badge tone="pulse">Enabled</Badge></span>` + `<span id="mfa-recovery-remaining">{n} recovery codes left</span>` + `<span id="mfa-new-codes"><Button>New recovery codes</Button></span>` + `<span id="mfa-disable"><Button variant="danger">Disable</Button></span>` |

등록 모달(`Modal class="mfa-enroll-modal" title="Set up two-factor authentication" closeOnOverlay={false}`). 순차 3단계(한 번에 한 단계만 그린다. `Tabs` 를 쓰지 않는다). 열릴 때 `enrollMfa()` 를 부른다:

| 단계 | 요소 | 전이 |
|---|---|---|
| 1 Scan | `<QrCanvas value={otpauthUri} />`(내부 `#mfa-qr`), 아래 `<code class="mono" id="mfa-secret">{secret}</code>` + `<span id="mfa-copy-secret"><Button size="sm">Copy</Button></span>`(`navigator.clipboard.writeText`, 실패는 무시) + 문구 "Scan the QR code, or enter the key manually." | `<span id="mfa-next"><Button variant="primary">Next</Button></span>` → 2 |
| 2 Verify | `Field label="6-digit code"` + `TextInput id="mfa-code" inputmode="numeric"`(6자리 절단은 `oninput={(v) => code = v.replace(/\D/g, '').slice(0, 6)}`) + `<span id="mfa-confirm"><Button variant="primary">Verify</Button></span>` | `confirmMfa(code)` 성공 → 3. 401 → `Field error` "The code is incorrect.". 409 `mfa_enrollment_expired` → 토스트 "The setup expired. Start again." + 모달 닫기 |
| 3 Save codes | `<ul id="mfa-recovery-codes">` 항목 10개 `<li class="mono">` + `<span id="mfa-copy-codes"><Button size="sm">Copy all</Button></span>`(줄바꿈으로 이어 붙여 복사) + 문구 "Each code works once. Keep them somewhere safe." + `Checkbox id="mfa-saved" label="I saved these codes"` | `<span id="mfa-done"><Button variant="primary">Done</Button></span>` 은 체크 전 disabled. 클릭 → 모달 닫기 → `loadMe()` → 카드가 Enabled |

- 모달의 "Cancel"(`<span id="mfa-cancel">`, 1·2단계에만) → 닫기. 서버의 pending 은 5분 뒤 스스로 만료한다.
- **3단계에서는 Escape 로 닫히지 않는다.** `Modal` 에 `closeOnEscape` prop 이 없고 이 이슈에서 `ui/Modal.svelte` 를 고치지 않으므로, `MeScreen` 이 3단계일 때 `window` 의 `keydown` 을 **캡처 단계**(`addEventListener('keydown', h, true)`)에서 받아 `Escape` 를 `stopPropagation()` 한다. 컴포넌트가 사라질 때 리스너를 뗀다.
- Disable 모달(`Modal class="mfa-disable-modal" title="Disable two-factor authentication"`): `TextInput type="password" id="mfa-disable-password" autocomplete="current-password"` + `<span id="mfa-disable-confirm"><Button variant="danger">Disable</Button></span>`. 401 → `Field error` "The password is incorrect.". 409 `mfa_required` → 오류 "Superusers must keep two-factor authentication enabled.". 성공 → 닫기 → `loadMe()` → 토스트 "Two-factor authentication disabled."
- New recovery codes 모달(`Modal class="mfa-codes-modal" title="New recovery codes"`): 비밀번호 입력(`TextInput type="password" id="mfa-codes-password"`) + `<span id="mfa-codes-generate"><Button variant="primary">Generate</Button></span>` → 성공하면 같은 모달 안에서 목록(`<ul id="mfa-recovery-codes">`) + "Copy all"(`<span id="mfa-copy-codes">`) + `<span id="mfa-codes-done"><Button variant="primary">Done</Button></span>` 으로 바뀐다. 닫을 때 `loadMe()` 로 남은 개수를 갱신한다. 401 → `Field error` "The password is incorrect."

### `MeScreen` 확장 — 세션 카드

`<section id="me-sessions"><Card label="Sessions">`: `MeCtrl.sessions()` 목록을 `<ul id="me-session-list">` 에 그린다. 항목 `<li class="session-row" data-session-id="{id}">` 는 1행 `{ip}` + 현재 세션이면 `Chip tone="signal"` "this device", 2행 mono `last seen {relativeTime(lastSeenAt, now)}`(U4-06 의 `admin/src/util/relativeTime.ts` 를 import 한다), 3행 mono `userAgent` 를 48자에서 자르고 `…`(`title` 속성에 전체). 그 아래 `<span id="me-logout-others"><Button>Sign out other devices</Button></span>`(현재 외 세션이 0이면 disabled) → `logoutOthers()` → 토스트 "Signed out {n} other device(s)." → 목록 갱신.

### `mustEnrollMfa` 고정

`App.svelte` 에서 `$me.mustEnrollMfa` 이고 `$me.user.mustChangePassword` 가 아니면, `#/me` 와 `#/me/password` 외 어떤 해시든 `#/me` 로 보내고 드로어 메뉴 버튼(`aria-label="Open menu"`)을 숨긴다(단위 3 U3-02 의 `mustChangePassword` 고정과 같은 방식·같은 자리). `MeScreen` 상단에 `<div id="mfa-required-banner"><Banner tone="warn">Superusers must enable two-factor authentication.</Banner></div>` 를 그린다. 등록을 마치면(`loadMe()` 뒤 `mustEnrollMfa === false`) 고정이 풀리고 배너가 사라진다.

### `UserEditScreen` 확장

"Two-factor" 행 `<section id="user-mfa"><Card label="Two-factor">`: `<span id="user-mfa-status">` 안에 `mfaEnabled` 면 `Badge tone="pulse"` "Enabled", 아니면 `Badge tone="neutral"` "Off" + `<span id="user-reset-mfa"><Button variant="danger">Reset MFA</Button></span>`(Off 면 disabled) → 확인 `Modal class="reset-mfa-modal" title="Reset two-factor"` 본문 "Reset two-factor authentication for {username}? Their sessions will end." + `<span id="confirm-reset-mfa"><Button variant="danger">Reset</Button></span>` + "Cancel" → `resetMfa(id)` → 배지 Off + 토스트 "Two-factor authentication reset." U4-06 의 "Sessions" 행이 있으므로 `#user-session-count` 도 다시 읽는다. 생성 화면(`new`)에는 그리지 않는다.

### `ServerSettingsScreen` 확장

`<section id="server-security"><Card label="Security">`:

| 요소 | id | 라벨·범위 |
|---|---|---|
| `Checkbox` | `input-mfa-required-superusers` | "Require two-factor for superusers" |
| `NumberInput` | `input-audit-retention-days` | `Field label="Audit log retention (days)" hint="0 keeps logs forever."`, `min=0 max=3650 step=1` |
| `NumberInput` | `input-audit-queue-size` | `Field label="Audit queue size"`, `min=100 max=100000 step=1` |

세 값은 서버 옵션 객체의 `mfaRequiredForSuperusers`·`auditRetentionDays`·`auditQueueSize` 에 바인딩되어 기존 `_isNewValue`·"Apply"·"Reset" 흐름을 그대로 탄다. 서버 422 메시지는 기존 실패 모달로 보여 준다.

## 변경할 것

- `admin/package.json`, `admin/package-lock.json`: 의존성 2개(같은 커밋).
- `admin/src/screens/parts/QrCanvas.svelte`: 신규.
- `admin/src/controller/{MeCtrl,UsersCtrl,Types}.ts`: 위 메서드·타입(`UserView.mfaEnabled`, `MeResponse.mfa`·`mustEnrollMfa`).
- `admin/src/me.ts`: `me` 스토어 타입에 `mfa`·`mustEnrollMfa`.
- `admin/src/screens/{MeScreen,UserEditScreen,ServerSettingsScreen}.svelte`, `admin/src/App.svelte`: 위 요소와 고정 로직.
- `test/admin/admin-backend-driver.ts`: IPC `{type: 'serverOption', patch}` 추가(드라이버가 `ServerOptionStore` 를 통해 서버 옵션 일부를 갱신한다. 드라이버 전용, 프로덕션 API 아님). `test/helpers/adminApp.ts` 반환에 `serverOption(patch)` 헬퍼.
- 삭제할 파일 없음.

## 하지 말 것

- QR 을 외부 URL(`chart.googleapis.com` 등)로 만들지 않는다. `qrcode` 를 `ui/` 에서 import 하지 않는다(`screens/parts/QrCanvas.svelte` 한 곳). `qrcode` 를 `devDependencies` 에 두지 않는다.
- `qrcode/lib/browser` 처럼 패키지 내부 경로를 직접 import 하지 않는다. 최상위 `'qrcode'` 만 import 한다(내부 경로는 패키지의 공개 계약이 아니라 패치 버전에서 사라질 수 있다).
- `secret`·복구 코드를 `localStorage`·`sessionStorage`·쿠키에 저장하지 않는다. 모달이 닫히면 컴포넌트 상태에서 지운다.
- 복구 코드 목록을 "I saved these codes" 체크 없이 닫을 수 있게 하지 않는다(3단계에는 Cancel 이 없고 `closeOnOverlay={false}` 이며 Escape 를 캡처 단계에서 막는다).
- 코드 입력에 `type="number"` 를 쓰지 않는다(`text` + `inputmode="numeric"`, 앞자리 0 보존).
- `ui/` 부품에 계약 밖 prop(`id`, `maxlength`, `closeOnEscape` 등)을 넘기지 않는다. `ui/Modal.svelte` 를 이 이슈에서 고치지 않는다.
- `mustEnrollMfa` 고정 상태에서 `#/me/password` 이동을 막지 않는다(비밀번호 변경은 허용 액션).
- 세션 카드에 "End" 버튼을 두지 않는다(본인 화면은 "Sign out other devices" 만. 개별 종료는 U4-06 의 `#/sessions`).
- `ServerSettingsScreen` 의 기존 필드·저장 흐름을 바꾸지 않는다. 카드 하나만 추가한다.
- 화면에서 `fetch` 를 직접 부르지 않는다(컨트롤러 경유). hex 색상 리터럴·외부 URL 을 `.svelte` 에 넣지 않는다(R2·R5).
- 로그인 화면(`LoginScreen.svelte`)과 `LoginCtrl` 을 건드리지 않는다(U4-07).

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트. 모든 브라우저 테스트는 `startAdminApp({fixture, login?: {username, password: RBAC_PASSWORDS[username]}})`(admin 은 `login` 생략)으로 시작하고, 뷰포트 400×800, `finally` 에서 `close()`, 마지막에 `expect(errors).toEqual([])`. 코드 계산은 `import {generate} from '../../src/server/mfa/Totp'`, `import {base32Decode} from '../../src/server/mfa/Base32'`.

- `test/admin/design-system-rules.test.ts` (규칙 R8 추가)
  - `admin/src/**/*.svelte` 와 `admin/src/**/*.ts` 중 `qrcode` 를 import 하는 파일이 `admin/src/screens/parts/QrCanvas.svelte` 하나뿐이고, 그 import 가 `from 'qrcode'` 이며 `from 'qrcode/` 로 시작하는 내부 경로 import 가 한 건도 없으면 통과한다.
  - `admin/package.json` 의 `dependencies.qrcode` 가 존재하고 값이 `^`·`~` 로 시작하지 않으며, `devDependencies.qrcode` 는 없고 `devDependencies['@types/qrcode']` 는 있다.
- `test/admin/screen-me-mfa.test.ts` (신규, fixture `'rbac'`)
  - `login: {username: 'alice', …}` → `#/me` → `#mfa-status` 문구 "Off" → `#mfa-setup` 클릭 → `.mfa-enroll-modal` 안에 `#mfa-qr`(canvas, `width` 속성 192, `toDataURL()` 이 같은 크기의 빈 캔버스와 다름)와 `#mfa-secret`(32자 Base32) → `#mfa-next` → `#mfa-code` 에 `generate(base32Decode(secret)!, Date.now())` 입력 → `#mfa-confirm` → `#mfa-recovery-codes li` 10개, 각 문구가 `/^[a-z0-9]{4}-[a-z0-9]{4}$/` → `#mfa-done button` 이 disabled → `#mfa-saved` 체크 → `#mfa-done button` 이 enabled → 클릭 → `.mfa-enroll-modal` 이 DOM 에서 사라짐 → `#mfa-status` "Enabled", `#mfa-recovery-remaining` "10 recovery codes left".
  - 2단계에서 `000000` 입력 후 `#mfa-confirm` → 오류 문구 "The code is incorrect." 가 보이고 `.mfa-enroll-modal` 은 그대로 열려 있다.
  - 3단계에서 Escape 를 눌러도 `.mfa-enroll-modal` 이 열려 있다. 1단계에서 Escape 를 누르면 닫힌다.
  - MFA 를 켠 상태에서 `#mfa-new-codes` → `#mfa-codes-password` 에 `user-password-1234` → `#mfa-codes-generate` → `#mfa-recovery-codes li` 10개가 **이전 목록과 전부 다름** → `#mfa-codes-done`. 잘못된 비밀번호면 "The password is incorrect." 가 보이고 목록이 나타나지 않는다.
  - `#mfa-disable` → `#mfa-disable-password` 정답 → `#mfa-disable-confirm` → 토스트 "Two-factor authentication disabled." → `#mfa-status` "Off".
  - 세션 카드: `extraLogins: [{as: 'alice', userAgent: 'UA-ALICE-1'}]` 로 시작해 alice 로 로그인 → `#me-session-list .session-row` 2개, `Chip` "this device" 가 정확히 1개 → `#me-logout-others` 클릭 → 토스트 "Signed out 1 other device(s)." → 행 1개, `#me-logout-others button` 이 disabled.
- `test/admin/screen-me-mfa-required.test.ts` (신규, fixture `'rbac'`)
  - `serverOption({mfaRequiredForSuperusers: true})` 뒤 `admin` 으로 로그인 → 해시가 `#/me` 이고 `#mfa-required-banner` 문구가 "Superusers must enable two-factor authentication.", 메뉴 버튼(`aria-label="Open menu"`)이 없으며, `#/users` 를 직접 입력해도 `#/me` 로 돌아온다. `#/me/password` 는 막히지 않는다.
  - 같은 화면에서 `#mfa-setup` → 등록 3단계를 마치면 `#mfa-required-banner` 가 사라지고 메뉴 버튼이 나타나며 `#/users` 로 이동할 수 있다.
  - 그 뒤 `#mfa-disable` → 비밀번호 입력 → `#mfa-disable-confirm` → 오류 "Superusers must keep two-factor authentication enabled." 가 보이고 `#mfa-status` 가 "Enabled" 그대로다.
- `test/admin/screen-users.test.ts` (추가)
  - fixture `'rbac-mfa'`, admin 으로 `#/users/<alice id>` → `#user-mfa-status` 문구 "Enabled" → `#user-reset-mfa` 클릭 → `.reset-mfa-modal` 본문에 `alice` → `#confirm-reset-mfa` → 토스트 "Two-factor authentication reset." → `#user-mfa-status` "Off", `#user-reset-mfa button` 이 disabled.
  - `bob`(MFA 없음) 화면에서는 `#user-mfa-status` 가 "Off" 이고 `#user-reset-mfa button` 이 처음부터 disabled 다.
  - 생성 화면(`#/users/new`)에는 `#user-mfa` 가 없다.
- `test/admin/screen-server-settings.test.ts` (추가)
  - `#server-security` 안에 `#input-mfa-required-superusers`(unchecked), `#input-audit-retention-days`(값 90), `#input-audit-queue-size`(값 1000) 이 있다.
  - 체크박스를 체크하면 "Apply" 가 활성된다 → 보존 일수에 `3651` 을 넣고 Apply → 실패 모달에 `auditRetentionDays must be 0 or an integer within 1..3650` 이 보인다 → `30` 으로 고쳐 Apply → 성공 → 새로고침 후 체크가 유지되고 값이 30 이다.
  - 큐 크기에 `99` 를 넣고 Apply → 실패 모달에 `auditQueueSize must be an integer within 100..100000`.
- `test/admin/screen-me.test.ts`: 기존 케이스가 그대로 통과한다(MFA 카드가 추가되어도 Account 카드의 선택자와 문구는 바뀌지 않는다).

기존 `test/admin/*.test.ts` 전부 통과. `npm --prefix admin run check` 오류 0.

## 검증 명령

```
npm --prefix admin install --save-exact qrcode@1.5.4
npm --prefix admin install --save-exact --save-dev @types/qrcode@1.5.5
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm --prefix admin run check
npm --prefix admin run build
npm run test:admin
npm test -- --runInBand
npx jest --runInBand test/supply-chain              # 공급망 게이트(`npm audit --omit=dev --audit-level=moderate` 에서 검토 예외 밖의 moderate 이상 0건 등, #293)
cd admin && node ../scripts/supply-chain-gate.cjs --high-report   # 관리 화면 트리를 감사한다. 루트 전체 트리는 `node scripts/supply-chain-gate.cjs --full-tree-gate` 로 판정한다(#293)
git status --short admin/package.json admin/package-lock.json   # 둘 다 커밋에 포함되었는지
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

첫 두 줄이 `admin/package-lock.json` 을 갱신한 뒤에야 `npm --prefix admin ci` 가 새 의존성으로 설치된다(`ci` 는 lock 파일만 보고 설치하므로 순서를 바꾸면 `qrcode` 없이 빌드가 깨진다).

## 선행 · 후행

- 선행: U4-07(`'rbac-mfa'` fixture·드라이버 IPC 세 개·가짜 시계 seed 규약), U4-06(`MeCtrl.sessions()`·`logoutOthers()`·`util/relativeTime.ts`·`SessionView`·`extraLogins`·`UserEditScreen` Sessions 행). U4-07 의 선행인 U4-08(`mustEnrollMfa`·`POST /api/users/:id/mfa/reset`)이 전이적으로 필요하다.
- 후행: 없음(단위 4 의 마지막 이슈). U5-06(Security 화면)은 별도 `#/security` 화면이며 이 이슈의 `ServerSettingsScreen` Security 카드와 겹치지 않는다.

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §3.3(`mustEnrollMfa`), §3.4(MFA API), §5.2(MeScreen), §5.5(UserEditScreen), §5.6(ServerSettingsScreen), §6.3(브라우저 테스트), §7(U4-07: `qrcode` 의존성 배치·`QRCode.toCanvas`)
- `docs/design/2026-09-11-unit3-rbac-screens.md` §3(`mustChangePassword` 고정 방식), §4.2, §4.5, §4.6, §5(fixture)
- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §3(층 규칙), §6(부품 계약·Modal), §7.5(ServerSettingsScreen), §8.3(브라우저 테스트 규약)
- `docs/design/2026-09-11-program-overview.md` §1 D5·D6, §3.3 테스트 규약
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.4 FR-AUDIT-RETENTION-001, §5.1.5, §5.1.6 FR-SESSION-SELF-KILL-001, §5.2.3

---

## 번호 변경

U4-04(MFA API)와 U4-07(MFA 화면)이 각각 이슈 하나의 상한인 신규·수정 1,500줄을 넘어서 둘로 나누었고, 나눈 뒤쪽을 **U4-08**·**U4-09** 로 파일 끝에 붙였다. U4-01~U4-07 의 기존 번호는 이미 등록된 이슈 번호와 묶여 있으므로 바꾸지 않았다.

- **U4-04** 는 `MfaTickets`·`IdentityStore` MFA 확장·`/api/me/mfa/*` 네 개(enroll·confirm·disable·recovery-codes)만 남겼다.
- **U4-08**(신규)은 `/api/login` 2단계 분기·`POST /api/login/mfa`·CSRF 예외·`mustEnrollMfa` 게이트·`POST /api/users/:id/mfa/reset` 을 맡는다.
- **U4-07** 은 `LoginScreen` 2단계·`LoginCtrl.loginMfa`·드라이버 IPC 세 개·`'rbac-mfa'` fixture 만 남겼다.
- **U4-09**(신규)는 `MeScreen` MFA 카드와 모달 3종·`QrCanvas`·세션 카드·`UserEditScreen` "Reset MFA"·`ServerSettingsScreen` Security 카드를 맡는다.

진행 순서는 **U4-04 → U4-08 → U4-07 → U4-09** 다.
