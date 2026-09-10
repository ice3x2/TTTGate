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
| `test/component/server/admin/audit-sink.test.ts` | — | `ADMIN_ROUTES` 를 순회해 CUD 항목 전수가 `record` 를 부르는지 단언 (PRD K3) |

### 실제로 변경할 기존 파일 (현재 저장소 기준)

- `src/util/SecretRedactor.ts:3-16` `isSensitiveKey(key)`: 소문자 정규화 뒤 `key`, `clientsecret`, `cert`, `ca`, `password`, `sessionkey`, `bootstraptoken` 완전 일치 또는 접미사 `secret`·`token`·`password`·`privatekey` 를 민감 키로 본다. `:1` `REDACTED_VALUE = "[REDACTED]"`. `:18` `redactSecrets(value)` 가 객체를 재귀 순회하며 민감 키의 값을 `[REDACTED]` 로 바꾼다. `totp`, `code`, `recoveryCode` 는 지금 민감 키가 아니다.
- `src/types/TunnelingOption.ts:52-66` `type ServerOption = {sessionTtlMs?, key, adminPort?, adminBindHost?, adminTls?, port, tls, controlProtocolMode?, allowLegacyControlAuth?, trustedClients?, tunnelingOptions, globalMemCacheLimit?, keepAlive}`. 감사 관련 필드 없음. `:100-106` `resolveSessionTtlMs(value)` 가 `{success: true; ttlMs} | {success: false; message}` 를 돌려주는 검증 함수의 본보기.
- `src/server/ServerOptionStore.ts:339` `public verificationServerOption(option: ServerOption): {success: boolean, message: string, serverOption?: ServerOption}`. `:351-353` 에서 `resolveSessionTtlMs` 로 `sessionTtlMs` 를 검증·기본값 채움. 이 함수 안에서 새 옵션 두 개를 같은 방식으로 검증한다.
- `src/Environment.ts:11` `logDir: Path.join(rootDir, 'logs')`. `Environment.path.logDir` 로 읽는다. `Environment.configure({rootDir})` 가 테스트 루트로 바꾼다.
- `src/util/logger/LogWriter.ts:53` 가 `fs.createWriteStream(this._filePath, {flags: 'a'})` 로 로그 파일을 열고 `:184-186` 에서 날짜가 바뀌면 `nextLogFile()` 로 교체하며 `:65-84` `sweepOldFiles()` 로 `history` 일 초과 파일을 지운다. `FileAuditSink` 는 이 클래스를 **재사용하지 않는다**(로그 줄 포맷·콘솔 출력이 섞여 있고 큐 상한·선점·배압 거부가 없다). 구조만 참고한다.
- `src/bootstrap/AppCompositionRoot.ts:10` `config.logFileDir = Environment.path.logDir` — 로그 디렉터리가 결정되는 곳. 감사 디렉터리는 그 하위 `audit/`.
- `src/server/ServerApp.ts:26-35` `startService(serverOption, adminCertInfo)`: `TTTServer.create` → `new AdminServer(...)` → `listen` → `tttServer.start()`. `AuditSinkRegistry.set` 은 `new AdminServer` 앞에 둔다.

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
export const isAuditEventType = (value: string): value is AuditEventType => value in AUDIT_EVENT_TYPES;
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
    flush(): Promise<void>;                        // 큐가 빌 때까지 대기 (테스트·종료용)
    pruneRetention(now: number = Date.now()): string[];   // 보존 기간 초과 파일 삭제(동기), 삭제한 파일명 반환. 테스트는 now 를 주입
    startRetentionTimer(): void;                   // 기동 직후 1회 pruneRetention() + 24시간 간격 setInterval(...).unref()
    close(): Promise<void>;                        // 타이머 해제, flush, 스트림 end. 이후 reserve() 는 false, record() 는 reject
    get queueLength(): number; get reservedCount(): number;
    static fileNameFor(atMs: number): string;      // 'audit-YYYY-MM-DD.jsonl' (UTC)
}
```

동작 규칙:

1. **경로.** `dir/audit-YYYY-MM-DD.jsonl`, 날짜는 `new Date(event.at).toISOString().slice(0, 10)`(UTC). 디렉터리는 첫 쓰기 전에 `fs.mkdirSync(dir, {recursive: true, mode: 0o700})`. 파일은 `flags: 'a'`, `mode: 0o600`(Windows 는 무시된다). 파일 이름이 바뀌면 이전 스트림을 `end()` 하고 새 스트림을 연다.
2. **한 줄 형식.** `JSON.stringify(redacted) + '\n'`. `JSON.stringify` 결과에는 개행이 들어가지 않는다(문자열 안 개행은 `\n` 으로 이스케이프된다).
3. **redaction.** `record()` 진입 시 `event.detail` 이 있으면 `redactSecrets(event.detail)` 결과로 바꾼 새 객체를 큐에 넣는다(입력 객체를 변경하지 않는다). `actor`·`target`·`summary` 는 redaction 대상이 아니다(민감 값이 들어오면 안 되는 필드이며, 넣지 않는 것은 호출부 책임).
4. **선점과 거부.** 상태는 배열 `queue` 와 정수 `reserved` 둘뿐이고 불변식은 `queue.length + reserved <= queueSize` 다. `reserve()` 는 `queue.length + reserved >= queueSize` 이면 false 를 돌려주고 `logger.warn('audit queue full (n)')` 을 남긴다. 아니면 `reserved += 1` 후 true. `record()` 는 `reserved > 0` 이면 `reserved -= 1` 하고 push(선점된 칸을 쓴다); `reserved === 0` 이면 `queue.length >= queueSize` 일 때 `Promise.reject(new AuditBackpressureError())`, 아니면 push. push 뒤 드레인이 돌고 있지 않으면 `setImmediate(drain)` 을 예약하고 `Promise.resolve()` 를 돌려준다. 선점은 소유되지 않고 개수로만 센다(어느 호출자의 `record()` 든 선점된 칸을 하나 소비한다). `audited()` 가 `reserve()` 한 번에 `record()` 를 정확히 한 번 부르므로 선점이 새지 않는다. `reserve()` 없이 `record()` 만 부르는 호출부(`IdentityStore` 가드, 로그인 이벤트, `pruneRetention`)는 여유가 있을 때만 성공한다.
5. **드레인과 배압.** `drain()` 은 큐 앞에서 하나를 꺼내 `stream.write(line)` 한다. `write` 가 `false` 를 돌려주면 `stream.once('drain', ...)` 을 기다린 뒤 계속한다. 큐가 비면 드레인 플래그를 내린다. 스트림 `error` 이벤트는 `logger.error` 로 남기고 스트림을 버린 뒤 다음 쓰기에서 다시 연다(같은 파일). 큐를 비우지 않는다.
6. **보존.** `pruneRetention(now)` 은 `retentionDays === 0` 이면 아무것도 하지 않고 `[]`. 그 외에는 `fs.readdirSync(dir)` 중 `^audit-(\d{4}-\d{2}-\d{2})\.jsonl$` 에 맞고 파일명 날짜(UTC 00:00)가 `now - retentionDays × 86,400,000` 보다 **작은**(더 오래된) 것을 `fs.unlinkSync`. 삭제 파일이 1개 이상이면 `record({at: now, actor: {userId: 'system'}, type: 'audit_retention_pruned', outcome: 'success', summary: 'Pruned N audit files', detail: {files, retentionDays}})` 를 자기 자신에게 기록한다(큐가 가득 차 reject 되면 `logger.warn` 만 남긴다). 디렉터리가 없으면 `[]`.
7. **타이머.** `startRetentionTimer()` 는 즉시 `pruneRetention()` 을 호출하고 `setInterval(() => this.pruneRetention(), 86_400_000)` 에 `unref()` 를 건다. `close()` 가 `clearInterval`.

### 서버 옵션 두 개

`src/types/TunnelingOption.ts` `ServerOption` 에 추가:

```ts
    auditRetentionDays?: number,   // 기본 90. 0 = 무제한. 그 외 정수 1..3650
    auditQueueSize?: number,       // 기본 1000. 정수 100..100000
```

`resolveSessionTtlMs`(`:100-106`) 바로 아래에 같은 형태로 두 함수를 만들고 export 한다:

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

서버 옵션이 `/api/serverOption` 으로 바뀌어 두 값이 달라지면 기존 `applyServerOption` 경로에서 `AuditSinkRegistry.current()` 가 `FileAuditSink` 이면 `close()` 후 새 인스턴스로 교체한다(교체 중 큐에 남은 이벤트는 `close()` 의 flush 가 다 쓴다. 교체 순서: 새 인스턴스 `set` → 옛 인스턴스 `close()`).

### `src/util/SecretRedactor.ts` 변경

`isSensitiveKey` 의 완전 일치 목록에 `"totp"`, `"code"`, `"recoverycode"` 를 추가한다(`:11` `bootstraptoken` 다음 줄. 입력 키는 소문자 정규화되므로 `recoveryCode` 도 덮인다). 다른 규칙은 건드리지 않는다.

## 변경할 것

- `src/server/audit/AuditSink.ts`: `AuditEvent.type` 의 타입을 `string` 에서 `AuditEventType` 으로 좁힌다.
- `src/server/admin/AdminServer.ts`, `src/server/admin/routes.ts`, `src/server/rbac/IdentityStore.ts`: `audited(req, principal, 'user_created', ...)` 처럼 문자열 리터럴로 적힌 type 을 전부 `AUDIT_EVENT_TYPES.user_created` 형태로 바꾼다. `route()` 의 `authorize` 403/404 지점에 `access_denied` 기록이 없으면 추가한다(단위 2 가 이미 넣었다면 상수만 교체). **`audited()` 의 본문은 바꾸지 않는다.**
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

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/unit/server/audit/AuditEventTypes.test.ts`
  - `AUDIT_EVENT_TYPE_LIST` 의 길이가 41 이고 표의 모든 이름을 포함하면 통과한다.
  - `isAuditEventType('user_created')` 가 true, `isAuditEventType('nope')` 가 false 이다.
- `test/unit/server/audit/FileAuditSink.test.ts` (임시 루트: `createTestRoot()` 의 `rootDir/logs/audit`)
  - `record()` 한 이벤트 1건 뒤 `flush()` 하면 `audit-<UTC 날짜>.jsonl` 이 존재하고 내용이 정확히 한 줄이며 `JSON.parse` 결과가 입력 이벤트와 같다.
  - `at` 을 `2026-09-11T23:59:59.000Z` 로 둔 1건, `2026-09-12T00:00:00.000Z` 로 둔 1건을 기록하면 파일이 두 개(`audit-2026-09-11.jsonl`, `audit-2026-09-12.jsonl`)이고 각각 한 줄이다.
  - `queueSize: 3` 에서 `openStream` 스텁의 `write` 가 false 를 돌려주고 `drain` 을 내지 않는 상태로 `reserve()` 를 3번 부르면 모두 true, 네 번째는 false 이고 `reservedCount` 가 3 이다. 이어 `record()` 3번은 모두 resolve 되고 `queueLength` 3, `reservedCount` 0, 네 번째 `record()` 는 `AuditBackpressureError` 로 reject 된다.
  - `queueSize: 3` 에서 `reserve()` 없이 `record()` 를 4번 부르면 네 번째가 reject 되고 `queueLength` 가 3 이다.
  - `reserve()` 2번 뒤 `record()` 1번이면 `reservedCount` 가 1, `queueLength` 가 1 이고 `queue.length + reserved` 가 2 다.
  - `write` 가 처음에 false 를 돌려주고 100ms 뒤 `drain` 을 내는 스텁에서 `record()` 3건 → `flush()` 하면 `write` 호출 순서가 기록 순서와 같고 `drain` 전에는 두 번째 `write` 가 호출되지 않는다.
  - `detail: {password: 'p', totp: '123456', code: '111111', recoveryCode: 'abcd-efgh', note: 'x'}` 를 기록하면 파일의 줄에서 `password`·`totp`·`code`·`recoveryCode` 값이 `"[REDACTED]"` 이고 `note` 는 `"x"` 이다. 입력 객체의 `detail.password` 는 `'p'` 그대로다.
  - `retentionDays: 2` 에서 디렉터리에 `audit-2026-09-08.jsonl`, `audit-2026-09-09.jsonl`, `audit-2026-09-10.jsonl`, `audit-2026-09-11.jsonl`, `other.txt` 를 미리 두고 `pruneRetention(Date.UTC(2026, 8, 11, 12))` 하면 반환값이 `['audit-2026-09-08.jsonl']` 이고 그 파일만 사라지며 `other.txt` 는 남는다. `flush()` 후 `audit-2026-09-11.jsonl` 마지막 줄의 `type` 이 `'audit_retention_pruned'` 이고 `detail.files` 가 `['audit-2026-09-08.jsonl']`, `detail.retentionDays` 가 2 다.
  - `retentionDays: 0` 이면 위 배치에서 `pruneRetention(같은 now)` 이 `[]` 를 돌려주고 파일이 하나도 사라지지 않는다.
  - `retentionDays: 1`, `now = Date.UTC(2026, 8, 11, 0, 0, 30)` 이면 `audit-2026-09-10.jsonl` 은 남고(만 1일 미만) `audit-2026-09-09.jsonl` 만 지워진다.
  - 디렉터리가 없을 때 `pruneRetention()` 이 `[]` 를 돌려준다.
  - POSIX(`process.platform !== 'win32'`)에서 기록 후 파일 mode 가 `0o600`, 디렉터리 mode 가 `0o700` 이다(Windows 에서는 이 케이스를 `test.skip`).
  - `close()` 뒤 `reserve()` 가 false 이고 `record()` 는 reject 된다.
- `test/unit/server/ServerOptionStore.test.ts` (기존 파일에 케이스 추가)
  - `auditRetentionDays` 생략 → 90, `0` → 0, `3650` → 3650, `3651` → `success: false` 와 메시지 `'auditRetentionDays must be 0 or an integer within 1..3650'`, `1.5` → 실패, `-1` → 실패.
  - `auditQueueSize` 생략 → 1000, `99` → 실패 메시지 `'auditQueueSize must be an integer within 100..100000'`, `100000` → 통과, `100001` → 실패.
- `test/unit/util/SecretRedactor.test.ts` (기존 파일이 있으면 추가, 없으면 신규)
  - `redactSecrets({totp: '1', code: '2', recoveryCode: '3', Code: '4', keep: '5'})` 가 `{totp: '[REDACTED]', code: '[REDACTED]', recoveryCode: '[REDACTED]', Code: '[REDACTED]', keep: '5'}` 이다.
- `test/component/server/admin/audit-sink.test.ts` (확장)
  - `ADMIN_ROUTES` 의 모든 CUD 항목 호출 뒤 기록된 이벤트의 `type` 이 전부 `AUDIT_EVENT_TYPE_LIST` 에 있다.
- `test/component/server/admin/audit-file.test.ts` (신규, 실제 `AdminServer` + 실제 `FileAuditSink`)
  - 슈퍼유저로 로그인 → `POST /api/groups` → `DELETE /api/groups/:id` → `flush()` 하면 오늘 파일에 `login_success`, `group_created`, `group_deleted` 세 줄이 이 순서로 있고 각 줄의 `actor.username` 이 `'admin'`, `ip` 가 `'127.0.0.1'` 또는 `'::1'`, `sessionIdHash` 가 `SessionStore.sessionIdOf(쿠키의 sessionKey)` 와 같다.
  - 잘못된 비밀번호로 로그인하면 `login_failure` 줄의 `detail.username` 이 입력값이고 `detail.password` 키가 없다.
  - `queueSize: 100` 의 `FileAuditSink` 를 `openStream` 스텁(`write` false, `drain` 없음)으로 `AuditSinkRegistry.set` 한 뒤 `POST /api/groups` 를 101번 부르면 앞 100번은 200/409 이고 101번째는 503 `{success: false, status: 503, code: 'audit_unavailable'}` 이며 그 요청은 그룹을 만들지 않는다(`GET /api/groups` 개수 불변).

기존 `test/component/server/admin/*.test.ts`, `test/unit/server/**` 전부 통과.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/server/audit test/unit/server/ServerOptionStore.test.ts test/unit/util test/component/server/admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U2-08 (단위 2 의 `AuditSink`·`audited()`·`routes.ts`·`IdentityStore`·터널 소유권까지 모두 있어야 이벤트 타입 표의 호출부가 전부 존재한다).
- 후행: U4-02(조회 API 가 이 파일 형식을 읽는다), U4-04·U4-05(MFA·세션 이벤트 타입 사용), U5-05·U5-07·U5-08(연결 보안 이벤트).

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
    static decodeCursor(s: string): AuditCursor | undefined;     // 형식이 틀리면 undefined (throw 금지)
}
```

읽기 규칙:

1. **파일 선택.** `dir` 의 `audit-YYYY-MM-DD.jsonl` 을 파일명 날짜 **내림차순**으로 정렬한다. `from`·`to` 가 있으면 날짜가 `[UTC날짜(from), UTC날짜(to)]` 밖인 파일은 열지 않는다. 디렉터리가 없으면 빈 결과.
2. **한 파일 안의 순서.** 파일은 append-only 이므로 줄 순서가 시간순이다. 하루 파일 하나를 `readline.createInterface({input: fs.createReadStream(path)})` 로 라인 배열에 올린 뒤 `reverse()` 해 최신순으로 만든다. 한 번에 파일 하나까지만 메모리에 두고, 다음 파일로 넘어가기 전에 앞 파일 배열을 버린다.
3. **커서.** 첫 페이지는 최신 파일의 `offset 0` 부터. 뒤집힌 배열의 `offset` 부터 순서대로 파싱·필터해 `limit` 만큼 채운다. 채워지면 마지막으로 소비한 라인의 다음 인덱스와 그 파일의 전체 라인 수를 `{file, offset, total}` 으로 인코딩해 `nextCursor` 로 준다. 다음 페이지에서 커서의 파일을 다시 읽었을 때 전체 라인 수 `n` 이 `total` 보다 크면(오늘 파일에 새 이벤트가 append 된 경우) `offset + (n - total)` 부터 이어 간다 — 뒤집힌 인덱스는 append 로 밀리지만 `total` 로 보정하므로 페이지 사이에 같은 이벤트가 다시 보이지 않는다. `n < total` 이면(파일이 바뀐 비정상 상황) `offset 0` 부터. 파일 끝에 이르면 다음(더 오래된) 파일의 `offset 0` 으로 넘어간다(그 파일의 `total` 은 그때 읽은 라인 수). 마지막 파일까지 다 소비하면 `nextCursor` 를 넣지 않는다. 커서의 `file` 이 더 이상 없으면(보존 삭제) 그보다 오래된 파일부터 이어 간다.
4. **손상된 줄.** `JSON.parse` 가 실패하거나 `at`·`type`·`outcome` 이 없는 줄은 건너뛰고 파일당 1회만 `logger.warn` 을 남긴다. 파싱 실패로 요청이 실패하지 않는다.
5. **`limit`.** `AuditQuery` 는 검증된 정수 1..500 만 받는다. 쿼리 문자열 → 숫자 변환과 검증은 라우트 핸들러가 한다.
6. **타입 목록.** `GET /api/audit/types` 는 파일을 읽지 않고 `AUDIT_EVENT_TYPE_LIST` 를 돌려준다.

### 라우트 2개 (`routes.ts`)

| 메서드·경로 | action | 요청 | 응답 |
|---|---|---|---|
| `GET /api/audit` | 함수형: `ctx.principal.role === 'superuser' ? 'audit:read-all' : 'audit:read-self'` | 쿼리 `from`, `to`(epoch ms 정수), `userId`, `type`, `targetKind`, `targetId`, `outcome`, `limit`(기본 100, 최대 500), `cursor` | `{events, nextCursor?}` 최신순. 일반 유저는 요청의 `userId` 를 무시하고 `principal.userId` 로 강제 |
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

먼저 쓰고 붉은 상태를 확인할 테스트:

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
  - `decodeCursor('***')` 가 `undefined` 이고, `decodeCursor(encodeCursor({file: 'audit-2026-09-10.jsonl', offset: 2, total: 4}))` 가 같은 객체다. `total` 이 없는 JSON 을 인코딩한 값은 `undefined`.
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
npm run lint
npx jest --runInBand test/unit/server/audit test/component/server/admin/audit-api.test.ts test/component/server/admin/audit-file.test.ts
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U4-01.
- 후행: U4-06(AuditScreen 이 두 엔드포인트를 쓴다).

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §2.3(조회 API·커서), §6.1(AuditQuery 테스트), §6.2(audit-api), §7(U4-02)
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

- `src/util/timingSafeStringEqual.ts` `timingSafeStringEqual(a: string | Buffer, b: string | Buffer, encoding: BufferEncoding = 'hex', expectedLength?: number): boolean`. 길이 불일치도 상수 시간으로 false. 비밀값 비교는 저장소 규칙(`npm run lint` = `scripts/lint-auth-compare.mjs src --strict`, `token|secret|hmac|sessionId` 식별자에 `===`·`!==` 금지)에 따라 **이 함수만** 쓴다. 코드는 6자리 ASCII 이므로 `encoding: 'utf8'`.
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
  - `findRecoveryCodeHash(['h1', 'h2', 'h3'], 'h2')` 가 1, `'h9'` 가 -1.
- `npm run lint` 가 `src/server/mfa/*.ts` 에 대해 위반 0건.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/server/mfa
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: 없음. 언제든 시작할 수 있다.
- 후행: U4-04(로그인 2단계와 MFA API), U4-07(브라우저 테스트가 `generate`·`base32Decode` 로 코드를 계산).

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §3.1(Totp), §6.1(Totp 테스트 벡터), §7(U4-03)
- `docs/design/2026-09-11-program-overview.md` §3.1(예외 규약)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.5
- RFC 6238 부록 B(테스트 벡터), RFC 4226 §5.3(동적 절단)·부록 D, RFC 4648 §6·§10(Base32)

---

## U4-04

**title**: feat(admin): MFA 등록·해제 API 와 2단계 로그인 흐름 추가
**labels**: enhancement, area:admin, unit:4
**body**:
## 목적

U4-03 의 `Totp` 위에 사용자가 MFA 를 등록·확인·해제·복구 코드 재발급할 수 있는 `/api/me/mfa/*`, 슈퍼유저가 남의 MFA 를 초기화하는 `/api/users/:id/mfa/reset`, 그리고 MFA 가 켜진 사용자의 로그인을 비밀번호 + 코드 두 단계(`/api/login` → `/api/login/mfa`)로 바꾼다. 서버 옵션 `mfaRequiredForSuperusers` 가 true 면 MFA 없는 슈퍼유저는 로그인 뒤 등록 전까지 `me:*` 외 API 가 403 이다. 화면은 U4-07.

## 배경

### 전제하는 산출물 (착수 시 아래가 저장소에 없으면 코멘트를 남기고 중단한다)

| 파일 | 심볼 | 출처 |
|---|---|---|
| `src/server/mfa/Totp.ts`, `src/server/mfa/Base32.ts` | `generateSecret`, `verify`, `otpauthUri`, `generateRecoveryCodes`, `hashRecoveryCode`, `normalizeRecoveryCode`, `findRecoveryCodeHash`, `base32Encode`, `base32Decode` | U4-03 |
| `src/server/rbac/IdentityStore.ts` | `IdentityStore.instance`, `user(id)`, `userByUsername(name)`, `verifyPassword(username, password): Promise<{user} \| {reason}>`, `updateUser(id, patch)`, 원자 저장(`Files.writeAtomicSync`) | 단위 2 §4.1 |
| `src/server/rbac/IdentityTypes.ts` | `type User = {id; username; displayName; role; status; groupId; passwordHash; mustChangePassword; migratedFromLegacyAdmin; migrationAcknowledged; createdAt; updatedAt}` | 단위 2 §3 |
| `src/server/rbac/AdminAuthorizer.ts` | `type Action`, `authorize(principal, action, target)`, `mustChangePassword` 게이트(`me:read`·`me:password` 외 403 `password_change_required`) | 단위 2 §4.4 |
| `src/server/rbac/Principal.ts` | `Principal` | 단위 2 §4.4 |
| `src/server/admin/SessionStore.ts` | `type Session`, `newSession(userId, {ip, userAgent})`, `resolveSession(keys)`, `removeSessionsOfUser(userId)`, `static sessionIdOf(key)` | 단위 2 §4.3 |
| `src/server/admin/routes.ts`, `AdminServer.ts` | `ADMIN_ROUTES`, `POST /api/login` 핸들러가 `IdentityStore.verifyPassword` 를 쓰고 쿠키 2개 + `{user, mustChangePassword}` 를 돌려줌, `audited()` | 단위 2 §5.1·§5.2 |
| `src/server/audit/AuditEventTypes.ts` | `AUDIT_EVENT_TYPES.mfa_*`, `login_*` — U4-01 이 아직 없으면 같은 이름의 문자열 리터럴을 쓰고 U4-01 이 상수로 치환한다 | U4-01 |
| `test/component/server/admin/rbac-login.test.ts` | 로그인 테스트 헬퍼 패턴 | 단위 2 §8.2 |

### 실제로 변경할 기존 파일 (현재 저장소 기준)

- `src/server/admin/AdminServer.ts:34-38` 백오프 상수 `LOGIN_WINDOW_MS = 60_000`, `LOGIN_BLOCK_MS = 60_000`, `LOGIN_MAX_FAILURES = 5`, `LOGIN_ATTEMPT_MAP_LIMIT = 10_000`. `:68` `_loginAttempts: Map<string, LoginAttemptState>`. `:1360` `getClientAddress(req)`, `:1399` `buildLoginAttemptKey(req)`(IPv4 /24, IPv6 /64 버킷), `:1402` `isLoginBlocked(req)`, `:1407` `recordLoginFailure(req)`, `:1432` `resetLoginAttempts(req)`, `:1435` `delayFailedLogin(req)`(`computeBackoffMs(failedCount)` 만큼 대기). MFA 실패도 이 네 함수를 그대로 부른다.
- `src/server/admin/AdminServer.ts:160` `const skipCsrfHeader = (pathname == '/api/login');` 과 `:1495` `verifyCsrfGuard(req, res, skipCsrfHeader)`: `skipCsrfHeader` 가 true 면 Origin 화이트리스트 검사만 하고 CSRF 헤더 검사를 건너뛴다. 여기에 `/api/login/mfa` 를 추가한다.
- `src/server/admin/AdminServer.ts:1053-1065` 로그인 성공 시 `sessionKey` 쿠키(HttpOnly, SameSite=Strict, TLS 면 Secure, Max-Age 12h)와 `csrfToken` 쿠키를 발급하고 `{success: true, ..., csrfToken}` 을 돌려준다. MFA 성공 응답은 이 블록을 `issueSession(req, res, user)` 로 뽑아 재사용한다.
- `src/types/TunnelingOption.ts:52-66` `ServerOption`. `mfaRequiredForSuperusers?: boolean` 추가.
- `src/server/ServerOptionStore.ts:339` `verificationServerOption`: `option.adminTls = option.adminTls === true;`(`:386`) 옆에 `option.mfaRequiredForSuperusers = option.mfaRequiredForSuperusers === true;` 추가.
- `src/util/SecretRedactor.ts:12` `secret` 접미사 규칙이 `mfa.secret` 을 덮는다. `totp`·`code`·`recoverycode` 키 추가는 U4-01 범위이며 이 이슈는 `SecretRedactor` 를 건드리지 않는다.

먼저 열어 볼 파일: `src/server/admin/AdminServer.ts`(150~175행, 1035~1075행, 1355~1445행, 1488~1560행), `src/server/admin/routes.ts`, `src/server/rbac/IdentityStore.ts`, `src/server/rbac/IdentityTypes.ts`, `src/server/rbac/AdminAuthorizer.ts`, `src/server/admin/SessionStore.ts`, `src/server/mfa/Totp.ts`, `test/component/server/admin/rbac-login.test.ts`.

## 적용되는 결정

- D1 → FR-MFA-ENROLL-001(등록·해제, QR + 복구 코드 1회 노출), FR-MFA-ENFORCE-001(비밀번호 + 코드, 복구 코드 1회성), FR-MFA-SU-POLICY-001(슈퍼유저 강제 토글), FR-MFA-RESET-001(슈퍼유저 초기화 + 감사), NFR-SEC-NEW-ENDPOINT-BACKOFF-001(MFA·복구 코드 실패도 백오프), NFR-SEC-NEW-ENDPOINT-CSRF-001(새 상태 변경 API 는 CSRF 적용. 예외는 `/api/login/mfa` 하나).
- PRD §12 Q1 가정: `mfaRequiredForSuperusers` 기본 false. Q4 가정: 강제 대상이 아니면 일반 유저·슈퍼유저 모두 본인 MFA 해제 가능.
- 프로그램 개요 §3.4: CSRF 헤더 예외는 `/api/login` 과 `/api/login/mfa` 두 개뿐이고 이 둘도 Origin 검사는 받는다.

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
    consumeRecoveryCode(id: string, hash: string): Result<{remaining: number}>;   // findRecoveryCodeHash 로 찾아 제거. 없으면 {success: false, status: 401, code: 'recovery_code_invalid'}
```

`UserView`(단위 2 §5.2) 에 `mfaEnabled: boolean` 을 추가하고 `mfa` 객체 자체는 어떤 API 응답에도 넣지 않는다. `/api/me` 응답에 `mfa: {enabled: boolean; recoveryCodesRemaining: number}` 와 `mustEnrollMfa: boolean` 을 추가한다. `/api/validateSession` 에 `mustEnrollMfa` 를 추가한다.

### `src/server/mfa/MfaTickets.ts` (신규, 메모리)

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
  → peek(ticket, ip) 가 undefined: recordLoginFailure + delayFailedLogin, 401 {code: 'mfa_ticket_invalid', message: 'The sign-in expired. Start again.'}
  → code: Totp.verify(base32Decode(mfa.secret), code, now, mfa.lastUsedStep)
       ok → markMfaStep(userId, step), 감사 mfa_success
       아니면 → fail(ticket) (5회째면 티켓 삭제), recordLoginFailure + delayFailedLogin, 감사 mfa_failure(detail.reason), 401 {code: 'mfa_code_invalid', message: 'The code is incorrect.'}
  → recoveryCode: normalizeRecoveryCode → undefined 면 위 실패 경로. 아니면 consumeRecoveryCode(userId, hashRecoveryCode(code, userId))
       성공 → 감사 mfa_recovery_used(detail.remaining), 계속
       실패 → 위 실패 경로와 동일, code 'mfa_code_invalid'
  → 성공: consume(ticket), resetLoginAttempts(req), issueSession(req, res, user) → 응답은 /api/login 성공과 같은 형태 (user, mustChangePassword, mustEnrollMfa, csrfToken, 쿠키 2개), 감사 login_success
```

- `/api/login/mfa` 는 `routes.ts` 에서 `action: 'public'`. `AdminServer.ts:160` 의 `skipCsrfHeader` 를 `(pathname == '/api/login' || pathname == '/api/login/mfa')` 로 바꾼다. Origin 검사는 그대로 받는다.
- **강제 게이트.** `issueSession` 시점에 `serverOption.mfaRequiredForSuperusers === true && user.role === 'superuser' && user.mfa?.enabled !== true` 이면 세션에 `mustEnrollMfa: true` 를 둔다(`Session` 타입에 `mustEnrollMfa: boolean` 추가, `Principal` 에도 `mustEnrollMfa: boolean` 추가). `authorize` 는 `mustChangePassword` 게이트 **다음**에 `mustEnrollMfa` 게이트를 둔다: `me:read`, `me:password`, `me:mfa`, `me:sessions` 외 전부 `{allowed: false, status: 403, code: 'mfa_enrollment_required'}`. `POST /api/me/mfa/confirm` 성공 시 그 세션의 `mustEnrollMfa` 를 false 로 바꾼다(`SessionStore.updateSession(key, patch: {mustEnrollMfa?: boolean})` 추가). 게이트는 로그인 시점에만 계산한다(옵션을 켠 순간 기존 세션은 잠기지 않는다).
- `Action` 에 `'me:mfa'` 를 추가한다. 슈퍼유저·일반 유저 모두 허용, `mustChangePassword` 게이트 뒤.

### MFA API (`routes.ts`)

| 메서드·경로 | action | 요청 | 응답·동작 |
|---|---|---|---|
| `POST /api/me/mfa/enroll` | `me:mfa` | — | 이미 `enabled` 면 409 `mfa_already_enabled`. 아니면 `secret = generateSecret()`, `codes = generateRecoveryCodes()` 를 `pendingEnrollments.set(userId, ...)` 하고 `{secret: base32Encode(secret), otpauthUri, recoveryCodes}` — **이 응답에만 평문**. 감사 없음(아직 등록 아님) |
| `POST /api/me/mfa/confirm` | `me:mfa` | `{code}` | `pendingEnrollments.peek(userId)` 가 없으면 409 `mfa_enrollment_expired`. `verify(secret, code, now, -1)` 실패면 `fail(userId)`(5회째면 pending 삭제) + 401 `mfa_code_invalid`. 성공: `consume`, `setMfa(id, {enabled: true, secret: base32, enrolledAt: now, lastUsedStep: step, recoveryCodeHashes: codes.map(hash)})`, 세션 `mustEnrollMfa=false`, 감사 `mfa_enrolled`. 응답 `{mfa: {enabled: true, recoveryCodesRemaining: 10}}` |
| `DELETE /api/me/mfa` | `me:mfa` | `{password}` | `verifyPassword(username, password)` 실패 401 `password_incorrect`. `mfaRequiredForSuperusers && role === 'superuser'` 면 409 `mfa_required`. `enabled` 아니면 409 `mfa_not_enabled`. 성공: `clearMfa`, 감사 `mfa_disabled`. 응답 `{mfa: {enabled: false, recoveryCodesRemaining: 0}}` |
| `POST /api/me/mfa/recovery-codes` | `me:mfa` | `{password}` | 비밀번호 검증(401). `enabled` 아니면 409 `mfa_not_enabled`. 새 10개 생성 → `replaceRecoveryCodeHashes`(기존 전부 무효). 응답 `{recoveryCodes}` 평문 1회. 감사 `mfa_recovery_codes_regenerated`(target user, `detail` 없음) |
| `POST /api/users/:id/mfa/reset` | `user:manage` | — | 대상 없음 404 `user_not_found`. `clearMfa(id)` + `SessionStore.removeSessionsOfUser(id)`. `enabled` 가 아니었어도 200(멱등). 감사 `mfa_reset`(target user). 응답 `{user: UserView}` |

비밀번호 확인 실패(`DELETE /api/me/mfa`, `recovery-codes`)는 로그인 백오프 버킷에 기록하지 않는다(세션이 있는 요청이며 기존 `PUT /api/me/password` 와 같은 취급).

요청·응답 예시:

```
POST /api/login  {"username": "alice", "password": "user-password-1234"}
→ 200 {"success": true, "partial": false, "failedScopes": [], "warnings": [], "message": "",
       "mfaRequired": true, "mfaTicket": "3c1f...(64 hex)"}

POST /api/login/mfa  {"mfaTicket": "3c1f...", "code": "287082"}
→ 200 Set-Cookie: sessionKey=...; HttpOnly; SameSite=Strict   Set-Cookie: csrfToken=...; SameSite=Strict
      {"success": true, "partial": false, "failedScopes": [], "warnings": [], "message": "", "csrfToken": "…",
       "user": {"id": "u_…", "username": "alice", "displayName": "Alice", "role": "regular"},
       "mustChangePassword": false, "mustEnrollMfa": false}

POST /api/login/mfa  {"mfaTicket": "3c1f...", "code": "000000"}
→ 401 {"success": false, "status": 401, "code": "mfa_code_invalid", "message": "The code is incorrect."}

POST /api/login/mfa  {"mfaTicket": "expired", "recoveryCode": "ab12-cd34"}
→ 401 {"success": false, "status": 401, "code": "mfa_ticket_invalid", "message": "The sign-in expired. Start again."}

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

POST /api/users/u_1234/mfa/reset
→ 200 {"success": true, ..., "user": {"id": "u_1234", "username": "bob", "mfaEnabled": false, "…": "…"}}

GET /api/me  (mfaRequiredForSuperusers=true, MFA 없는 슈퍼유저)
→ 200 {"success": true, ..., "user": {...}, "mustEnrollMfa": true, "mfa": {"enabled": false, "recoveryCodesRemaining": 0}}
GET /api/users  (같은 세션)
→ 403 {"success": false, "status": 403, "code": "mfa_enrollment_required", "message": "Enable two-factor authentication first."}
```

## 변경할 것

- `src/server/admin/AdminServer.ts`: `:160` CSRF 예외 확장; 로그인 핸들러 분기; `issueSession` 추출; 핸들러 6개 추가; `/api/me`·`/api/validateSession` 응답 확장; `MfaTicketStore`·`PendingEnrollmentStore` 필드와 60초 sweep 타이머(`unref`, `close()` 에서 해제).
- `src/server/admin/routes.ts`: 라우트 6개 추가(`POST /api/login/mfa` public, `POST /api/me/mfa/enroll`, `POST /api/me/mfa/confirm`, `DELETE /api/me/mfa`, `POST /api/me/mfa/recovery-codes` 는 `me:mfa`, `POST /api/users/:id/mfa/reset` 은 `user:manage`).
- `src/server/admin/SessionStore.ts`: `Session.mustEnrollMfa: boolean`, `updateSession(key, patch)`.
- `src/server/rbac/{IdentityTypes,IdentityStore,Principal,AdminAuthorizer}.ts`: 위 확장.
- `src/types/TunnelingOption.ts`, `src/server/ServerOptionStore.ts`: `mfaRequiredForSuperusers`.
- 삭제할 파일 없음.

## 하지 말 것

- `Totp.ts`·`Base32.ts` 를 수정하지 않는다(U4-03). 코드·해시 비교를 `AdminServer` 안에서 직접 하지 않는다(`verify`·`findRecoveryCodeHash` 경유).
- `secret` 을 `identity.yaml` 외 어디에도(로그·감사 detail·`UserView`·`/api/me`) 넣지 않는다. 감사 `detail` 에 `code`·`recoveryCode` 를 넣지 않는다(U4-01 뒤에는 redaction 되지만 넣지 않는다).
- MFA 티켓을 쿠키로 주지 않는다. 본문 필드로만.
- 1단계 비밀번호 성공 시점에 `resetLoginAttempts` 나 `login_success` 기록을 하지 않는다.
- `/api/login/mfa` 를 제외한 새 POST/DELETE 를 CSRF 예외에 넣지 않는다.
- 티켓·pending 저장소에 잠금이나 `async-mutex` 를 쓰지 않는다. 항목 갱신은 새 객체 `set`.
- 예외를 제어 흐름으로 쓰지 않는다: 티켓 없음·만료·형식 오류는 `undefined`·반환값 분기.
- `lastUsedStep` 을 메모리에만 두지 않는다(재기동 뒤에도 재사용 거부). 저장은 `IdentityStore` 원자 저장.
- 비밀번호 검증 실패 백오프 규칙(`LOGIN_MAX_FAILURES` 등)을 바꾸지 않는다.
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
  - `mustEnrollMfa: true` 주체는 `me:read`·`me:password`·`me:mfa`·`me:sessions` 만 허용이고 `tunnel:list` 는 `{allowed: false, status: 403, code: 'mfa_enrollment_required'}` 이다.
  - `mustChangePassword: true` 와 `mustEnrollMfa: true` 가 같이 있으면 `me:mfa` 는 403 `password_change_required` 다(비밀번호 게이트가 먼저).
  - 일반 유저와 슈퍼유저 모두 `me:mfa` 허용.
- `test/unit/server/rbac/IdentityStore.test.ts` (추가)
  - `setMfa` → 새 인스턴스 `load()` 뒤 `user(id).mfa` 가 같다. `clearMfa` 뒤 `mfa` 가 `undefined`. `markMfaStep` 뒤 `lastUsedStep` 갱신. `consumeRecoveryCode` 가 해당 해시만 제거하고 `remaining` 이 9, 없는 해시는 `status: 401`.
- `test/component/server/admin/mfa-login.test.ts` (신규, 실제 `AdminServer`. 테스트가 `generate(base32Decode(secret), now)` 로 코드를 계산한다. fixture: `admin`(`test-password-1234`), 일반 유저 `alice`(`user-password-1234`))
  - `alice` 로 로그인 → `POST /api/me/mfa/enroll` 200 이고 `secret` 이 32자 Base32, `otpauthUri` 가 `otpauth://totp/TTTGate:alice?secret=<secret>&issuer=TTTGate&algorithm=SHA1&digits=6&period=30`, `recoveryCodes` 10개 → `POST /api/me/mfa/confirm {code}` 200 → `GET /api/me` 의 `mfa.enabled` 가 true, `recoveryCodesRemaining` 이 10, `GET /api/users`(admin)의 alice 항목 `mfaEnabled` true 이고 `mfa` 키 없음 → `POST /api/logout`.
  - 비밀번호만으로 `POST /api/login` 하면 200 이고 `mfaRequired: true`, `mfaTicket` 64 hex, `Set-Cookie` 헤더 없음.
  - `POST /api/login/mfa {mfaTicket, code: '000000'}` 를 5번 부르면 다섯 번 모두 401 `mfa_code_invalid` 이고 여섯 번째(올바른 코드)는 401 `mfa_ticket_invalid` 이다. 두 번째 실패 응답 시간이 첫 번째보다 100ms 이상 길다(백오프 적용).
  - 새로 `POST /api/login` 하면 429(백오프 차단, `LOGIN_MAX_FAILURES` 도달)이다. `ClockRngProvider` 시계를 61초 앞당긴 뒤 다시 `POST /api/login` → 티켓 → 올바른 코드 → 200, 쿠키 2개, `user.username === 'alice'`. 그 세션으로 `GET /api/me` 가 200.
  - 같은 코드로 다시 로그인(새 티켓)하면 401 `mfa_code_invalid` (재사용 거부). 시계를 30초 앞당겨 새 코드면 200.
  - 다른 IP(`X-Forwarded-For` 를 신뢰하도록 `AdminSecurityPolicyRegistry` 설정)에서 같은 티켓을 쓰면 401 `mfa_ticket_invalid`.
  - `recoveryCode` 로 로그인하면 200 이고 `GET /api/me` 의 `recoveryCodesRemaining` 이 9. 같은 복구 코드로 다시 로그인하면 401. 대문자·하이픈 없이 보내도(`AB12CD34`) 200.
  - `{mfaTicket, code, recoveryCode}` 셋 다 보내면 422, `{mfaTicket}` 만 보내면 422.
  - `DELETE /api/me/mfa {password: 'wrong'}` 401 `password_incorrect`, `{password: 정답}` 200 → 이후 `POST /api/login` 이 바로 세션을 준다.
  - 등록 후 `POST /api/me/mfa/recovery-codes` 뒤 예전 복구 코드는 401, 새 코드는 200.
  - `POST /api/me/mfa/confirm` 을 pending 없이 부르면 409 `mfa_enrollment_expired`. `enroll` 뒤 시계를 301초 앞당기고 `confirm` 하면 409.
  - 이미 enabled 인 상태에서 `enroll` 은 409 `mfa_already_enabled`.
  - 기록된 감사 이벤트(`AuditSinkRegistry` 에 배열 스텁을 두어 수집)에 `mfa_enrolled`, `mfa_failure`×5, `mfa_success`, `mfa_recovery_used`, `mfa_recovery_codes_regenerated`, `mfa_disabled`, `login_success` 가 있고 어떤 이벤트를 `JSON.stringify` 해도 `secret` 값 문자열이 나타나지 않는다.
  - `mfaRequiredForSuperusers: true` 로 서버 옵션을 저장하고 MFA 없는 슈퍼유저 `admin` 으로 로그인하면 응답과 `GET /api/validateSession`·`GET /api/me` 의 `mustEnrollMfa` 가 true, `GET /api/users` 403 `mfa_enrollment_required`, `GET /api/me` 200, `PUT /api/me/password` 는 403 이 아님, `enroll`+`confirm` 뒤 `GET /api/users` 200. `DELETE /api/me/mfa` 는 409 `mfa_required`.
  - `admin` 이 `POST /api/users/<alice id>/mfa/reset` 하면 alice 의 기존 세션이 401 이 되고 alice 는 비밀번호만으로 로그인된다. 감사에 `mfa_reset` 이 있고 `target.id` 가 alice 의 id. 한 번 더 부르면 200(멱등). 없는 id 는 404.
  - `POST /api/login/mfa` 를 CSRF 헤더 없이 불러도 403 `Missing CSRF token` 이 아니다. `POST /api/me/mfa/enroll` 을 CSRF 헤더 없이 부르면 403 이다.
  - `POST /api/login/mfa` 에 허용되지 않은 `Origin` 을 붙이면 403 `Forbidden origin`.
- `test/component/server/admin/audit-sink.test.ts` (확장): 새 CUD 라우트 5개(`/api/login/mfa` 제외)가 `ADMIN_ROUTES` 순회에 포함되어 `record` 가 불린다.
- `npm run lint` 위반 0건.

기존 `test/component/server/admin/*.test.ts`, `test/unit/server/admin/*.test.ts`(백오프·쿠키 테스트 포함) 전부 통과.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/server/mfa test/unit/server/rbac test/unit/server/ServerOptionStore.test.ts test/component/server/admin
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U4-03, U2-08(단위 2 의 터널 소유권까지). U4-01·U4-05 와 병렬 가능(모두 `routes.ts` 에 항목을 더하므로 병합 시 배열 항목 충돌만 해결).
- 후행: U4-07(MFA 화면).

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §3.2(저장·서버 옵션), §3.3(로그인 흐름·게이트·CSRF 예외), §3.4(API), §6.2(mfa-login), §7(U4-04)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §3(사용자 레코드), §4.1(IdentityStore), §4.3(SessionStore), §4.4(Action·게이트), §5.1(`routes.ts`), §5.2(`/api/login`·`/api/me`·`UserView`)
- `docs/design/2026-09-11-program-overview.md` §3.4(CSRF 예외 두 개), §3.1(예외·잠금 규약)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.5, §5.2.1 NFR-SEC-NEW-ENDPOINT-CSRF-001·NFR-SEC-NEW-ENDPOINT-BACKOFF-001, §12 Q1·Q4

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
| `src/server/admin/SessionStore.ts` | `type Session = {key; userId; createdAt; lastSeenAt; timeout; ip; userAgent?}`, `newSession(userId, {ip, userAgent})`, `resolveSession(keys)`, `removeSession(key)`, `removeSessionsOfUser(userId): number`, `listSessions(): Session[]`, `static sessionIdOf(key): string` | 단위 2 §4.3 |
| `src/server/admin/routes.ts`, `AdminServer.ts` | `ADMIN_ROUTES`, `audited()`, `POST /api/logout` 핸들러(만료 `Set-Cookie` 2개) | 단위 2 §5.1·§5.2 |
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
- "사용자별 세션", "현재 세션 제외 제거" 는 새 메서드를 만들지 않고 `AdminServer` 핸들러가 `listSessions().filter(...)` 와 `removeSession(key)` 로 조합한다(대상 키를 먼저 배열로 모은 뒤 삭제. `Map` 순회 중 삭제 금지).

### API (`routes.ts`)

`SessionView = {id: string; userId: string; username: string; createdAt: number; lastSeenAt: number; ip: string; userAgent: string; current: boolean}`. `id = SessionStore.sessionIdOf(key)`. `username` 은 `IdentityStore.user(userId)?.username ?? userId`(legacy-fallback 주체 `legacy-admin` 은 그대로). `userAgent` 는 없으면 `''`. `current` 는 요청 세션과 같은 키인지.

| 메서드·경로 | action | 요청 | 응답·동작 |
|---|---|---|---|
| `GET /api/sessions` | `session:manage` | — | `{sessions: SessionView[]}` `lastSeenAt` 내림차순 |
| `DELETE /api/sessions/:id` | `session:manage` | — | `removeSessionById(id)`. 없으면 404 `session_not_found`. 본인 세션이면 응답에 만료 `Set-Cookie` 2개(`sessionKey`, `csrfToken`, `Max-Age=0`)를 붙인다. 응답 `{removed: true, self: boolean}`. 감사 `session_killed`(target `{kind: 'session', id}`, `detail.userId` 대상 사용자) |
| `DELETE /api/users/:id/sessions` | `session:manage` | — | 사용자 없음 404 `user_not_found`. `removeSessionsOfUser(id)`. 본인이면 만료 쿠키. 응답 `{removed: n, self: boolean}`. 감사 `sessions_killed_for_user`(target user, `detail.removed`) |
| `GET /api/me/sessions` | `me:sessions` | — | `{sessions: SessionView[]}` 본인 것만, `lastSeenAt` 내림차순 |
| `POST /api/me/sessions/logout-others` | `me:sessions` | — | 본인 세션 중 현재 키가 아닌 것을 전부 `removeSession`. 응답 `{removed: n}`. 감사 `sessions_killed_self_others`(target user 본인, `detail.removed`) |

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
- `src/server/admin/routes.ts`: 라우트 5개 추가.
- `src/server/admin/AdminServer.ts`: 핸들러 5개. 만료 쿠키를 만드는 코드가 `POST /api/logout` 핸들러 안에 인라인이면 `expireSessionCookies(res)` 로 뽑아 세 곳(logout, `DELETE /api/sessions/:id` self, `DELETE /api/users/:id/sessions` self)에서 쓴다.
- `src/server/rbac/AdminAuthorizer.ts`: `session:manage`·`me:sessions` 가 이미 있으면 변경 없음. 없으면 추가(슈퍼유저만 / 모두).
- 삭제할 파일 없음.

## 하지 말 것

- 세션 키(64바이트 hex)를 응답·로그·감사 detail 에 넣지 않는다. `id`(16 hex) 만.
- `sessionIdOf` 를 다시 만들거나 `AdminServer` 에 해시 계산을 인라인하지 않는다(단위 2 의 한 곳).
- `removeSessionById` 외의 메서드를 `SessionStore` 에 추가하지 않는다.
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
  - 만료된 세션(`ClockRngProvider` 시계를 12시간 + 1ms 앞당김)은 `removeSessionById` 가 `undefined` 를 돌려준다.
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
npm run lint
npx jest --runInBand test/unit/server/admin test/component/server/admin/sessions-api.test.ts test/component/server/admin/audit-sink.test.ts
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U2-08(단위 2 의 터널 소유권까지). U4-01·U4-04 와 병렬 가능(모두 `routes.ts` 에 항목을 더하므로 병합 시 배열 항목 충돌만 해결).
- 후행: U4-06(SessionsScreen·UserEditScreen 세션 행), U4-07(MeScreen 세션 카드).

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

U4-02·U4-05 의 API 위에 감사 로그 화면(`#/audit`)과 세션 관리 화면(`#/sessions`)을 만들고, 드로어 NAV 에 "Audit log"·"Sessions" 항목을 추가하며, 사용자 편집 화면에 "Sessions" 행(개수 + "End all sessions")을 붙인다. 슈퍼유저는 전체 이벤트를 필터·페이지로 보고 세션을 끊을 수 있고, 일반 유저는 "My activity" 제목으로 자기 이벤트만 본다. MFA 관련 화면은 U4-07.

## 배경

### 전제하는 산출물 (착수 시 아래가 저장소에 없으면 코멘트를 남기고 중단한다)

| 파일 | 심볼·계약 | 출처 |
|---|---|---|
| `admin/src/ui/*.svelte` | `Button`, `Field`, `TextInput`, `Select`, `Card`(`label`, `compact`), `Chip`(`tone`, `mono`), `Badge`(`tone`), `Tabs`(`items`, `active` bindable, `onchange`), `Modal`(`open` bindable, `title`, `closeOnOverlay`, `footer` 스니펫), `toast` 스토어, `Loading`. tone 값 `'signal' \| 'pulse' \| 'alarm' \| 'trace' \| 'warn' \| 'neutral'` | 단위 1 §6 |
| `admin/src/router.ts` | `type Screen`, `type Route = {screen; param?}`, `route` 스토어, `navigate(hash)`, `parseHash(hash)` | 단위 1 §5.1, 단위 3 §3 |
| `admin/src/shell/nav.ts` | `NAV: Array<{hash; title; screen; section}>`. 순서 Status, Tunnels, Server settings, Users, Groups, Security, Audit log, Sessions, My account. `Drawer` 가 `me.sections.includes(section)` 인 항목만 그림 | 단위 3 §3 |
| `admin/src/App.svelte` | route → `Shell` `title`/`back` 계산, 섹션 가드(`#/denied`), `sessionInvalid()` 컨텍스트 | 단위 1 §5.2·§5.3, 단위 3 §3 |
| `admin/src/me.ts` | `me` 스토어(`/api/me` 결과: `user`, `group`, `sections`, `migrationBanner`, `mustChangePassword`), `loadMe()` | 단위 2 §7, 단위 3 U3-01 |
| `admin/src/controller/AdminRequest.ts` | `adminRequest(path, options): Promise<any>` — CSRF 헤더·401→`InvalidSession` 처리 | 현재 저장소 `:36` |
| `admin/src/controller/UsersCtrl.ts` | `instance.list(): Promise<UserView[]>` | 단위 3 §2 |
| `admin/src/controller/MeCtrl.ts` | `instance.me()`, `changePassword()`, `acknowledgeMigration()` | 단위 3 §2 |
| `admin/src/controller/Types.ts` | `UserView`, `MeResponse` | 단위 3 §2 |
| `admin/src/screens/UserEditScreen.svelte` | 수정 화면 하단 고정 바("Save", "Reset password", "Delete") | 단위 3 §4.2 |
| `test/helpers/adminApp.ts` | `startAdminApp({fixture, loginAs}) → {page, url, errors, calls(), close}`. 뷰포트 400×800 기본. `'rbac'` fixture: `admin`(`test-password-1234`), 그룹 `field`, `alice`(20001)·`bob`(20002)·`carol`(default)·`dave`(임시 비밀번호) — 일반 유저 비밀번호 `user-password-1234` | 단위 1 §8.2, 단위 3 §5 |
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

`admin/src/controller/MeCtrl.ts` 추가: `sessions(): Promise<SessionView[]>`(`GET /api/me/sessions`), `logoutOthers(): Promise<{removed: number}>`(`POST /api/me/sessions/logout-others`). U4-07 의 MeScreen 세션 카드가 같은 두 메서드를 쓴다.

`admin/src/controller/Types.ts` 추가:

```ts
export type AuditEventView = {at: number; actor: {userId: string; username?: string; role?: string}; sessionIdHash?: string; ip?: string;
    type: string; target?: {kind: string; id: string}; outcome: 'success' | 'failure'; summary: string; detail?: Record<string, unknown>};
export type AuditQueryInput = {from?: number; to?: number; userId?: string; type?: string; outcome?: 'success' | 'failure'; limit?: number; cursor?: string};
export type SessionView = {id: string; userId: string; username: string; createdAt: number; lastSeenAt: number; ip: string; userAgent: string; current: boolean};
```

`admin/src/util/relativeTime.ts`(신규): `relativeTime(fromMs: number, nowMs: number): string` → `< 60초` "just now", `< 60분` "{n} min ago", `< 24시간` "{n} h ago", 그 외 "{n} d ago". `formatLocal(ms: number, withSeconds: boolean): string` → 로컬 `YYYY-MM-DD HH:mm` 또는 `YYYY-MM-DD HH:mm:ss`. 단위 테스트 `test/admin/relativeTime.test.ts`.

### 라우트·NAV

- `router.ts` `Screen` 에 `'audit' | 'sessions'` 추가. `#/audit` → `{screen: 'audit'}`, `#/sessions` → `{screen: 'sessions'}`. `test/admin/router.test.ts` 의 `parseHash` 표에 두 행 추가.
- `App.svelte` title 표: `audit` → `me.role === 'superuser' ? 'Audit log' : 'My activity'`, `sessions` → `'Sessions'`. back 없음.
- `nav.ts`: `{hash: '#/audit', title: 'Audit log', screen: 'audit', section: 'audit'}`, `{hash: '#/sessions', title: 'Sessions', screen: 'sessions', section: 'sessions'}` 를 단위 3 이 정한 순서 자리(Security 다음, My account 앞)에 둔다. 일반 유저에게는 `me.sections` 에 `audit`(그룹 속성 `my_audit`)·`sessions`(`my_sessions`) 가 있을 때만 보인다.

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
| 사용자 전체 종료 | `Button variant="danger" id="sessions-end-all-user"` "End all for user" | 필터에 사용자가 선택된 경우에만 활성. 확인 `Modal` 제목 "End all sessions" 본문 "End all sessions for {username}?"(본인이면 "End all sessions for {username}? You will be signed out.") + `Button id="confirm-end-all"` "End all" + "Cancel" |
| 목록 | `<ul id="sessions-list">`, 항목 `<li class="session-row" data-session-id="{id}">` 안에 `Card compact` | 1행: `<span class="session-user">{username}</span>` + 현재 세션이면 `Chip tone="signal"` "this device"; 2행 mono: `started {formatLocal(createdAt, false)}` · `last seen {relativeTime(lastSeenAt, now)}`; 3행 mono: `{ip}` · `{userAgent 를 48자에서 자르고 '…', title 속성에 전체}`; 오른쪽 `Button variant="danger" size="sm" class="session-end"` "End" |
| 개별 종료 확인 | `Modal` 제목 "End session" 본문 "End this session for {username}?"(본인이면 "End this session? You will be signed out.") + `Button id="confirm-end"` "End" + "Cancel" | 확인 → `kill(id)` → `self` 면 `sessionInvalid()`(로그인 화면으로), 아니면 목록 갱신 + `toast` "Session ended." |
| 갱신 | `setInterval(load, 10_000)`, 언마운트 시 `clearInterval` | 갱신 중 모달이 열려 있으면 목록만 바꾸고 모달은 유지 |
| 빈 상태 | `<p id="sessions-empty">` "No active sessions." | |

일반 유저 분기(`me.user.role === 'regular'`): 필터·"End all for user"·"End" 버튼 없음. `MeCtrl.sessions()` 목록과 `Button id="sessions-logout-others"` "Sign out other devices"(확인 없이 즉시 `MeCtrl.logoutOthers()` → 토스트 "Signed out {n} other device(s)." → 목록 갱신).

### `UserEditScreen` 확장 (수정 화면, `#/users/:id`)

- "Sessions" 행 `Card label="Sessions" id="user-sessions"`: `<span id="user-session-count">{n} active session(s)</span>`(`SessionsCtrl.list()` 를 `userId` 로 세어 표시) + `Button variant="danger" id="user-end-sessions"` "End all sessions"(n = 0 이면 disabled) → 확인 `Modal`("End all sessions for {username}?") → `killAllForUser(id)` → 개수 갱신 + 토스트 "Ended {n} session(s)."
- 생성 화면(`new`)에는 그리지 않는다.

### 테스트 fixture

`test/helpers/adminApp.ts` 의 `'rbac'` fixture 를 쓰되, `startAdminApp` 에 `extraLogins?: Array<{as: string; userAgent: string}>` 옵션을 추가한다: 브라우저 로그인 전에 드라이버 IPC `{type: 'login', username, userAgent}` 로 해당 사용자 세션을 서버 측에서 만들어 둔다(드라이버가 `POST /api/login` 을 로컬로 호출). 반환에 `sessions(): Promise<SessionView[]>`(드라이버가 `GET /api/sessions` 를 admin 세션으로 호출) 와 `seedAudit(n: number): Promise<void>`(드라이버가 `AuditSinkRegistry.current().record` 로 `user_updated` 이벤트 n 건을 기록하고 `flush`) 를 더한다. `admin-backend-driver.ts` 가 `FileAuditSink` 를 `rootDir/logs/audit` 에 연결하지 않았으면 연결한다(U4-01 의 `ServerApp` 코드와 같은 세 줄). `'rbac'` fixture 의 `default` 그룹 `admin_ui_section_access` 에서 `my_audit` 을 뺀 변형 `'rbac-no-audit'` 을 추가한다(carol 용).

## 변경할 것

- `admin/src/router.ts`, `admin/src/shell/nav.ts`, `admin/src/App.svelte`: 위 라우트·NAV·title.
- `admin/src/screens/UserEditScreen.svelte`: Sessions 행.
- `admin/src/controller/MeCtrl.ts`, `Types.ts`: 위 메서드·타입.
- `test/admin/router.test.ts`: 두 행 추가.
- `test/helpers/adminApp.ts`, `test/admin/admin-backend-driver.ts`: fixture·IPC 확장.
- 삭제할 파일 없음.

## 하지 말 것

- 화면에서 `fetch` 를 직접 부르지 않는다(컨트롤러 경유). `ui/` 부품에 API 호출을 넣지 않는다.
- hex 색상 리터럴·외부 URL 을 `.svelte` 에 넣지 않는다(`design-system-rules.test.ts` R2·R5).
- 감사 이벤트를 클라이언트에서 필터하지 않는다(서버 쿼리). 예외는 세션 화면의 사용자 필터(목록이 작다).
- 감사 목록을 한 번에 500건 요청하지 않는다(50 고정 + Load more).
- 폴링 간격을 바꾸지 않는다(10초). 폴링 중 오류가 `InvalidSession` 이면 `sessionInvalid()`, 그 외에는 토스트 없이 다음 주기 재시도.
- 이 이슈에서 MFA 관련 요소(MeScreen 카드, 로그인 2단계, "Reset MFA", Security 카드)를 만들지 않는다(U4-07).
- 일반 유저 `#/sessions` 에 슈퍼유저 전용 요소를 숨김(`hidden`)으로 두지 않는다. 아예 그리지 않는다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트. 모든 브라우저 테스트는 뷰포트 400×800(`startAdminApp` 기본), `finally` 에서 `close()`, 마지막에 `expect(errors).toEqual([])`.

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
  - `alice` 로 로그인(그룹 `field` 의 `admin_ui_section_access` 에 `my_audit` 포함) → 드로어 "Audit log" 클릭 → 제목 "My activity", `#audit-filter-user` 가 없고, 모든 `.audit-meta` 가 `@alice` 로 시작한다.
  - `'rbac-no-audit'` fixture 로 `carol` 로그인 → 드로어에 "Audit log" 없음, `#/audit` 직접 입력 → `#/denied`.
- `test/admin/screen-sessions.test.ts`
  - `startAdminApp({fixture: 'rbac', loginAs: 'admin', extraLogins: [{as: 'alice', userAgent: 'UA-ALICE-1'}, {as: 'alice', userAgent: 'UA-ALICE-2'}]})` → 드로어 "Sessions" → `#/sessions`, `#sessions-list .session-row` 3개, `Chip` "this device" 가 정확히 1개(admin 행), alice 행 둘의 3행에 `UA-ALICE-1`·`UA-ALICE-2`.
  - alice 첫 행의 `.session-end` 클릭 → 모달 "End session" 본문에 `alice` → `#confirm-end` → 토스트 "Session ended." → 행 2개 → `sessions()` 로 서버 측도 2개.
  - `#sessions-filter-user` 를 alice 로 → 행 1개 → `#sessions-end-all-user` 활성 → 클릭 → 모달 → `#confirm-end-all` → 행 0개(필터 유지) → 필터 해제 → admin 행 1개.
  - admin 행 `.session-end` → 모달 본문에 "You will be signed out." → `#confirm-end` → 로그인 화면(`#login-password` 존재).
  - `alice` 로 로그인(`my_sessions` 포함) + `extraLogins` alice 1개 → `#/sessions` → `#sessions-filter-user` 없음, `.session-end` 없음, 행 2개, `#sessions-logout-others` 클릭 → 토스트 "Signed out 1 other device(s)." → 행 1개.
- `test/admin/screen-users.test.ts` (추가)
  - `extraLogins` 로 alice 세션 2개를 만든 뒤 admin 으로 `#/users/<alice id>` → `#user-session-count` 문구 "2 active session(s)" → `#user-end-sessions` → 모달 → 확인 → 토스트 "Ended 2 session(s)." → 문구 "0 active session(s)", 버튼 disabled.
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
- 후행: U4-07(MeScreen 세션 카드가 이 이슈의 `MeCtrl.sessions()`·`logoutOthers()`·`util/relativeTime.ts`·`extraLogins` fixture 를 그대로 쓴다. U4-07 은 이 이슈가 끝난 뒤 시작한다).

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §5.1(AuditScreen), §5.4(SessionsScreen), §5.5(UserEditScreen 세션 행), §6.3(브라우저 테스트), §7(U4-06)
- `docs/design/2026-09-11-unit3-rbac-screens.md` §2(컨트롤러 패턴), §3(NAV 순서·section 필터·가드), §4.2(UserEditScreen 하단 바), §5(`rbac` fixture)
- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §3(층 규칙), §5(라우터·Shell title), §6(부품 계약), §8.2·§8.3(드라이버·브라우저 테스트 규약)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §3(`admin_ui_section_access` → `my_audit`·`my_sessions`), §4.4(`sections`)
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.4, §5.1.6, §5.2.3 NFR-USAB-HIDE-001

---

## U4-07

**title**: feat(admin): MFA 등록·해제 화면과 2단계 로그인, 세션 카드, Security 설정 추가
**labels**: enhancement, area:frontend, unit:4
**body**:
## 목적

U4-04 의 MFA API 와 U4-05 의 세션 API 를 관리자 UI 에 붙인다. 이 이슈가 끝나면 사용자는 내 계정 화면에서 QR 코드로 인증 앱을 등록하고 복구 코드를 저장하고 해제·재발급할 수 있으며, MFA 가 켜진 계정의 로그인 화면은 비밀번호 뒤에 코드 입력 단계를 보여 준다. 내 계정 화면에 "Sessions" 카드, 사용자 편집 화면에 "Reset MFA", 서버 설정 화면에 "Security" 카드(슈퍼유저 MFA 강제, 감사 보존 일수, 감사 큐 크기)가 생긴다. `mustEnrollMfa` 상태의 슈퍼유저는 `#/me` 에 고정된다.

## 배경

### 전제하는 산출물 (착수 시 아래가 저장소에 없으면 코멘트를 남기고 중단한다)

| 파일 | 심볼·계약 | 출처 |
|---|---|---|
| `admin/src/ui/*.svelte` | `Button`, `Field`, `TextInput`(`inputmode`), `NumberInput`, `Checkbox`, `Card`, `Chip`, `Badge`, `Modal`(`closeOnOverlay`), `toast`, `Loading`, `Banner` | 단위 1 §6 |
| `admin/src/screens/LoginScreen.svelte` | `#login-username`, `#login-password`, `#login-message`(role=alert), "OK" 버튼, `onsuccess` 콜백, `localStorage['tttgate.lastUsername']` | 단위 1 §7.1, 단위 2 §7(U2-10) |
| `admin/src/controller/LoginCtrl.ts` | 정적 `login(username, password, bootstrapToken?)` → `{success, user?, mustChangePassword?, ...}` | 단위 2 §7 |
| `admin/src/screens/MeScreen.svelte` | `Card "Account"`(username, display name, role Chip, group), "Change password" 버튼 | 단위 3 §4.5 |
| `admin/src/screens/UserEditScreen.svelte` | 하단 고정 바, "Sessions" 행(`#user-sessions`, `#user-session-count`) | 단위 3 §4.2, U4-06 |
| `admin/src/screens/ServerSettingsScreen.svelte` | 필드 `input-key`, `input-admin-port`, …, "Apply"(`_isNewValue` 일 때 활성), "Reset", `_apply` → `_checkServerRestart` | 단위 1 §7.5 |
| `admin/src/controller/MeCtrl.ts` | `me()`, `changePassword()`, `acknowledgeMigration()`, `sessions(): Promise<SessionView[]>`, `logoutOthers(): Promise<{removed: number}>` | 단위 3 §2, U4-06 |
| `admin/src/util/relativeTime.ts` | `relativeTime(fromMs, nowMs): string`, `formatLocal(ms, withSeconds): string` | U4-06 |
| `admin/src/controller/Types.ts` | `SessionView` | U4-06 |
| `admin/src/me.ts` | `me` 스토어에 `mustChangePassword`, `mfa: {enabled, recoveryCodesRemaining}`, `mustEnrollMfa`(U4-04 의 `/api/me` 확장), `loadMe()` | 단위 3 U3-01, U4-04 |
| `admin/src/App.svelte` | `me.mustChangePassword` 이면 `#/me/password` 고정 + 메뉴 버튼 숨김 | 단위 3 §3(U3-02) |
| `admin/src/controller/Types.ts` | `UserView`(`mfaEnabled` 포함, U4-04), `MeResponse` | 단위 3 §2 |
| `test/helpers/adminApp.ts` | `startAdminApp({fixture, loginAs, extraLogins})`, 드라이버 IPC | 단위 1 §8.2, U4-06 |
| 백엔드 API | `POST /api/login`(`mfaRequired`, `mfaTicket`), `POST /api/login/mfa`, `POST /api/me/mfa/enroll`, `POST /api/me/mfa/confirm`, `DELETE /api/me/mfa`, `POST /api/me/mfa/recovery-codes`, `POST /api/users/:id/mfa/reset`(U4-04), `GET /api/me/sessions`, `POST /api/me/sessions/logout-others`(U4-05), `/api/serverOption`(`mfaRequiredForSuperusers` U4-04, `auditRetentionDays`·`auditQueueSize` U4-01) | |
| `src/server/mfa/Totp.ts`, `src/server/mfa/Base32.ts` | 테스트가 `generate(base32Decode(secret), Date.now())` 로 코드를 계산한다 | U4-03 |

### 실제로 변경할 기존 파일

- `admin/package.json:19-23` `dependencies`: `@types/lodash`, `lodash`, `node-forge`. 여기에 `qrcode` 를 **`dependencies`** 로, `@types/qrcode` 를 **`devDependencies`** 로 추가한다. 두 패키지 모두 exact 버전 고정(`^` 없이). `admin/package-lock.json` 갱신을 **같은 커밋**에 넣는다.
- `admin/src/controller/LoginCtrl.ts:26` `login(...)`: 반환 타입에 `mfaRequired?: boolean; mfaTicket?: string` 추가. `loginMfa(ticket, {code} | {recoveryCode})` 추가.

먼저 열어 볼 파일: `admin/package.json`, `admin/src/screens/LoginScreen.svelte`, `admin/src/screens/MeScreen.svelte`, `admin/src/screens/UserEditScreen.svelte`, `admin/src/screens/ServerSettingsScreen.svelte`, `admin/src/controller/LoginCtrl.ts`, `admin/src/controller/MeCtrl.ts`, `admin/src/App.svelte`, `admin/src/me.ts`, `test/admin/screen-login.test.ts`, `test/admin/screen-me.test.ts`, `test/admin/screen-server-settings.test.ts`.

## 적용되는 결정

- D2·D3·D5 (디자인 시스템 부품, 모바일 우선, 영어 문구). D6 외부 요청 없음 → QR 은 `qrcode` 패키지가 로컬 canvas 에 그린다. 이미지 URL 서비스 금지.
- D1 → FR-MFA-ENROLL-001(QR + 복구 코드 1회 노출), FR-MFA-ENFORCE-001, FR-MFA-SU-POLICY-001, FR-MFA-RESET-001, FR-SESSION-SELF-KILL-001, FR-AUDIT-RETENTION-001(서버 설정으로 변경).

## 만들 것

### 의존성

`cd admin && npm install --save-exact qrcode@1.5.4 && npm install --save-exact --save-dev @types/qrcode@1.5.5` (npm 에 그 버전이 없으면 1.5.x 최신을 exact 로). 사용 방식은 한 곳(`admin/src/screens/parts/QrCanvas.svelte`)에서만:

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

`design-system-rules.test.ts` R1 은 `ui/` 만 검사하므로 `screens/parts/` 의 라이브러리 import 는 허용된다.

### 컨트롤러

`admin/src/controller/LoginCtrl.ts` 추가:

```ts
    public static async loginMfa(mfaTicket: string, input: {code: string} | {recoveryCode: string}): Promise<LoginResult>;   // POST /api/login/mfa
```

`admin/src/controller/MeCtrl.ts` 추가:

```ts
    enrollMfa(): Promise<{secret: string; otpauthUri: string; recoveryCodes: string[]}>;   // POST /api/me/mfa/enroll
    confirmMfa(code: string): Promise<{mfa: {enabled: boolean; recoveryCodesRemaining: number}}>;   // POST /api/me/mfa/confirm
    disableMfa(password: string): Promise<void>;                          // DELETE /api/me/mfa (본문 {password})
    regenerateRecoveryCodes(password: string): Promise<string[]>;         // POST /api/me/mfa/recovery-codes
```

`sessions()`·`logoutOthers()` 는 U4-06 이 만든 것을 그대로 쓴다(이 이슈에서 만들거나 고치지 않는다).

`admin/src/controller/UsersCtrl.ts` 추가: `resetMfa(id): Promise<UserView>` (`POST /api/users/:id/mfa/reset`).

### `LoginScreen` 2단계

| 요소 | id | 문구·동작 |
|---|---|---|
| 비밀번호 폼 | 기존 | `login()` 응답이 `mfaRequired` 이면 `mfaTicket` 을 컴포넌트 상태에 두고 폼을 `hidden` 으로 숨긴다. 아래 단계 표시 |
| 안내 | `<p id="login-mfa-hint">` | "Enter the 6-digit code from your authenticator app." |
| 코드 입력 | `TextInput id="login-mfa-code" inputmode="numeric" autocomplete="one-time-code"` | `maxlength` 6. Enter 또는 "Verify" 로 제출 |
| 제출 | `Button variant="primary" id="login-mfa-submit"` "Verify" | `loginMfa(ticket, {code})`. 성공 → `onsuccess()` |
| 복구 코드 전환 | `<button type="button" id="login-use-recovery">` "Use a recovery code instead" | 코드 입력을 `TextInput id="login-recovery-code" autocomplete="off"` 로 바꾸고 안내 "Enter one of your recovery codes." 와 링크 문구 "Use the authenticator app instead"(`id="login-use-code"`) |
| 처음으로 | `<button type="button" id="login-mfa-back">` "Start over" | 티켓 버리고 비밀번호 폼으로 |
| 오류 | 기존 `#login-message` (role=alert) | 아래 표 |

오류 문구(`#login-message`):

| 응답 | 문구 |
|---|---|
| 401 `mfa_code_invalid` | "The code is incorrect." |
| 401 `mfa_ticket_invalid` | "The sign-in expired. Start again." + 비밀번호 폼으로 되돌림(`#login-password` 비움, 티켓 제거) |
| 429 | "Too many attempts. Try again later." |
| 빈 코드 제출 | "Enter the code." |
| 그 외 | `result.message` 또는 "Unable to connect to the server." |

### `MeScreen` 확장

"Two-factor authentication" `Card label="Two-factor authentication" id="me-mfa"`:

| 상태 | 요소 |
|---|---|
| Off | `Badge tone="neutral" id="mfa-status"` "Off" + `Button variant="primary" id="mfa-setup"` "Set up" |
| Enabled | `Badge tone="pulse" id="mfa-status"` "Enabled" + `<span id="mfa-recovery-remaining">{n} recovery codes left</span>` + `Button id="mfa-new-codes"` "New recovery codes" + `Button variant="danger" id="mfa-disable"` "Disable" |

등록 모달(`Modal title="Set up two-factor authentication" closeOnOverlay={false}` `id="mfa-enroll-modal"`). 순차 3단계(한 번에 한 단계만 그린다. `Tabs` 아님). 열릴 때 `enrollMfa()` 호출:

| 단계 | 요소 | 전이 |
|---|---|---|
| 1 Scan | `QrCanvas value={otpauthUri}`(`#mfa-qr`), 아래 `<code class="mono" id="mfa-secret">{secret}</code>` + `Button size="sm" id="mfa-copy-secret"` "Copy"(`navigator.clipboard.writeText`, 실패 무시) + 문구 "Scan the QR code, or enter the key manually." | `Button variant="primary" id="mfa-next"` "Next" → 2 |
| 2 Verify | `Field label="6-digit code"` + `TextInput id="mfa-code" inputmode="numeric"` + `Button variant="primary" id="mfa-confirm"` "Verify" | `confirmMfa(code)` 성공 → 3. 401 → `Field error` "The code is incorrect." 409 `mfa_enrollment_expired` → 토스트 "The setup expired. Start again." + 모달 닫기 |
| 3 Save codes | `<ul id="mfa-recovery-codes">` 항목 10개 `<li class="mono">` + `Button size="sm" id="mfa-copy-codes"` "Copy all"(줄바꿈으로 이어 붙여 복사) + 문구 "Each code works once. Keep them somewhere safe." + `Checkbox id="mfa-saved" label="I saved these codes"` | `Button variant="primary" id="mfa-done"` "Done" 은 체크 전 disabled. 클릭 → 모달 닫기 → `loadMe()` → 카드 Enabled |

- 모달의 "Cancel"(`id="mfa-cancel"`, 1·2단계에만) → 닫기. 서버의 pending 은 5분 뒤 스스로 만료.
- 3단계에서는 Escape 로 닫히지 않는다(`Modal` 에 `closeOnEscape` prop 이 없으면 `Modal` 을 건드리지 않고 `MeScreen` 이 `keydown` 캡처 단계에서 `Escape` 를 `stopPropagation` 한다).
- Disable 모달(`Modal title="Disable two-factor authentication"` `id="mfa-disable-modal"`): `TextInput type="password" id="mfa-disable-password" autocomplete="current-password"` + `Button variant="danger" id="mfa-disable-confirm"` "Disable". 401 → `Field error` "The password is incorrect." 409 `mfa_required` → 오류 "Superusers must keep two-factor authentication enabled." 성공 → 닫기 → `loadMe()` → 토스트 "Two-factor authentication disabled."
- New recovery codes 모달(`id="mfa-codes-modal"`): 비밀번호 입력(`id="mfa-codes-password"`) + "Generate"(`id="mfa-codes-generate"`) → 성공하면 같은 모달 안에서 목록(`#mfa-recovery-codes`) + "Copy all" + "Done"(`id="mfa-codes-done"`) 으로 바뀐다. `loadMe()` 로 남은 개수 갱신.

"Sessions" `Card label="Sessions" id="me-sessions"`: `MeCtrl.sessions()` 목록(`<ul id="me-session-list">`, 항목 `<li class="session-row" data-session-id>` 1행 `{ip}` + 현재면 `Chip tone="signal"` "this device", 2행 mono `last seen {relativeTime(lastSeenAt, now)}`(U4-06 의 `admin/src/util/relativeTime.ts` import), 3행 mono userAgent 48자) + `Button id="me-logout-others"` "Sign out other devices"(현재 외 세션이 0이면 disabled) → `logoutOthers()` → 토스트 "Signed out {n} other device(s)." → 목록 갱신.

`mustEnrollMfa` 고정: `App.svelte` 에서 `me.mustEnrollMfa` 이면(그리고 `mustChangePassword` 가 아니면) `#/me` 와 `#/me/password` 외 어떤 해시든 `#/me` 로 보내고 드로어 메뉴 버튼을 숨긴다(단위 3 의 `mustChangePassword` 고정과 같은 방식). `MeScreen` 상단에 `Banner tone="warn" id="mfa-required-banner"` "Superusers must enable two-factor authentication." 등록 완료(`loadMe()` 뒤 `mustEnrollMfa === false`) 시 고정 해제·배너 제거.

### `UserEditScreen` 확장

"Two-factor" 행 `Card label="Two-factor" id="user-mfa"`: `Badge id="user-mfa-status"` (`mfaEnabled` ? `tone="pulse"` "Enabled" : `tone="neutral"` "Off") + `Button variant="danger" id="user-reset-mfa"` "Reset MFA"(Off 면 disabled) → 확인 `Modal`("Reset two-factor authentication for {username}? Their sessions will end.") + `Button id="confirm-reset-mfa"` "Reset" → `resetMfa(id)` → 배지 Off + 토스트 "Two-factor authentication reset." U4-06 의 "Sessions" 행이 있으면 개수도 다시 읽는다.

### `ServerSettingsScreen` 확장

"Security" `Card label="Security" id="server-security"`:

| 요소 | id | 라벨·범위 |
|---|---|---|
| `Checkbox` | `input-mfa-required-superusers` | "Require two-factor for superusers" |
| `NumberInput` | `input-audit-retention-days` | "Audit log retention (days)", 힌트 "0 keeps logs forever.", `min=0 max=3650 step=1` |
| `NumberInput` | `input-audit-queue-size` | "Audit queue size", `min=100 max=100000 step=1` |

세 값은 서버 옵션 객체의 `mfaRequiredForSuperusers`·`auditRetentionDays`·`auditQueueSize` 에 바인딩되어 기존 `_isNewValue`·"Apply"·"Reset" 흐름을 그대로 탄다. 서버 422 메시지는 기존 실패 모달로.

## 변경할 것

- `admin/package.json`, `admin/package-lock.json`: 의존성 2개(같은 커밋).
- `admin/src/controller/{LoginCtrl,MeCtrl,UsersCtrl,Types}.ts`: 위 메서드·타입.
- `admin/src/screens/{LoginScreen,MeScreen,UserEditScreen,ServerSettingsScreen}.svelte`, `admin/src/App.svelte`: 위 요소.
- `test/admin/admin-backend-driver.ts` IPC 에 `{type: 'serverOption', patch}`(서버 옵션 일부 갱신), `{type: 'mfaSecret', username}`(테스트가 코드를 계산하도록 `identity.yaml` 의 `mfa.secret` 반환. 드라이버 전용, 프로덕션 API 아님), `{type: 'advanceClock', ms}` 추가. fixture `'rbac-mfa'`(`'rbac'` + alice 에 `mfa` 레코드와 복구 코드 해시 10개를 심고, 평문 복구 코드를 IPC `mfaRecoveryCodes` 로 돌려줌) 추가.
- 삭제할 파일 없음.

## 하지 말 것

- QR 을 외부 URL(`chart.googleapis.com` 등)로 만들지 않는다. `qrcode` 를 `ui/` 에서 import 하지 않는다(`screens/parts/QrCanvas.svelte` 한 곳). `qrcode` 를 `devDependencies` 에 두지 않는다.
- `secret`·복구 코드를 `localStorage`·`sessionStorage`·쿠키에 저장하지 않는다. 모달이 닫히면 컴포넌트 상태에서 지운다.
- 복구 코드 목록을 "I saved these codes" 체크 없이 닫을 수 있게 하지 않는다(3단계에는 Cancel 없음, `closeOnOverlay={false}`, Escape 무시).
- 로그인 2단계에서 티켓을 `localStorage` 에 넣지 않는다. 새로고침하면 처음부터.
- 코드 입력에 `type="number"` 를 쓰지 않는다(`text` + `inputmode="numeric"`, 앞자리 0 보존).
- `mustEnrollMfa` 고정 상태에서 `#/me/password` 이동을 막지 않는다(비밀번호 변경은 허용 액션).
- 세션 카드에 "End" 버튼을 두지 않는다(본인 화면은 "Sign out other devices" 만).
- `ServerSettingsScreen` 의 기존 필드·저장 흐름을 바꾸지 않는다. 카드 하나만 추가.
- `ui/Modal.svelte` 를 이 이슈에서 고치지 않는다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트. 모든 브라우저 테스트는 뷰포트 400×800, `finally` 에서 `close()`, 마지막에 `expect(errors).toEqual([])`. 코드 계산은 `import {generate} from '../../src/server/mfa/Totp'`, `import {base32Decode} from '../../src/server/mfa/Base32'`.

- `test/admin/design-system-rules.test.ts` (추가 규칙 R8)
  - `admin/src/**/*.svelte` 와 `admin/src/**/*.ts` 중 `from 'qrcode'` 를 import 하는 파일이 `screens/parts/QrCanvas.svelte` 하나뿐이면 통과.
  - `admin/package.json` 의 `dependencies.qrcode` 가 존재하고 `^`·`~` 없이 시작하며, `devDependencies.qrcode` 는 없고 `devDependencies['@types/qrcode']` 는 있다.
- `test/admin/screen-me-mfa.test.ts`
  - `alice` 로 로그인 → `#/me` → `#mfa-status` 문구 "Off" → `#mfa-setup` 클릭 → `#mfa-enroll-modal` 안에 `#mfa-qr`(canvas, `width` 192, `toDataURL()` 이 빈 캔버스와 다름) 와 `#mfa-secret`(32자 Base32) → `#mfa-next` → `#mfa-code` 에 `generate(base32Decode(secret), Date.now())` 입력 → `#mfa-confirm` → `#mfa-recovery-codes li` 10개, 각 문구가 `/^[a-z0-9]{4}-[a-z0-9]{4}$/` → `#mfa-done` 이 disabled → `#mfa-saved` 체크 → `#mfa-done` 활성 → 클릭 → 모달 사라짐 → `#mfa-status` "Enabled", `#mfa-recovery-remaining` "10 recovery codes left".
  - 2단계에서 `000000` 입력 → 오류 문구 "The code is incorrect." 가 보이고 모달은 열려 있다.
  - 3단계에서 Escape 를 눌러도 모달이 열려 있다.
  - `#mfa-new-codes` → `#mfa-codes-password` 에 정답 → `#mfa-codes-generate` → `#mfa-recovery-codes li` 10개(이전 목록과 전부 다름) → `#mfa-codes-done`. 잘못된 비밀번호면 "The password is incorrect."
  - `#mfa-disable` → `#mfa-disable-password` 정답 → `#mfa-disable-confirm` → 토스트 "Two-factor authentication disabled." → `#mfa-status` "Off".
  - IPC `serverOption {mfaRequiredForSuperusers: true}` 뒤 `admin` 로그인 → 해시가 `#/me` 이고 `#mfa-required-banner` 문구 "Superusers must enable two-factor authentication.", 메뉴 버튼(`aria-label="Open menu"`) 없음, `#/users` 입력해도 `#/me` 로 돌아옴 → 등록 완료 → 배너 사라지고 메뉴 버튼 등장 → `#mfa-disable` 클릭 → 비밀번호 → 오류 "Superusers must keep two-factor authentication enabled."
  - 세션 카드: `extraLogins` 로 alice 세션 1개 추가 → `#me-session-list .session-row` 2개, "this device" 1개 → `#me-logout-others` → 토스트 "Signed out 1 other device(s)." → 행 1개, 버튼 disabled.
- `test/admin/screen-login-mfa.test.ts`
  - `'rbac-mfa'` fixture → `#login-username` alice, `#login-password` `user-password-1234` → "OK" → `#login-password` 가 보이지 않고 `#login-mfa-code` 가 보이며 `#login-mfa-hint` 문구 "Enter the 6-digit code from your authenticator app."
  - `000000` → "Verify" → `#login-message` "The code is incorrect." → 올바른 코드(IPC `mfaSecret`) → alice 의 기본 화면(`#/tunnels`)에 도착, `page.on('load')` 횟수 1(새로고침 없음).
  - 새 세션에서 1단계 뒤 `#login-use-recovery` → `#login-recovery-code` 가 보이고 `#login-mfa-code` 는 없음 → 복구 코드(IPC `mfaRecoveryCodes` 중 하나) → "Verify" → 로그인 성공. 같은 복구 코드로 다시 시도 → "The code is incorrect."
  - 1단계 뒤 IPC `advanceClock 121000` 후 올바른 코드 → "The sign-in expired. Start again." 이고 `#login-password` 가 다시 보인다.
  - `#login-mfa-back` → 비밀번호 폼으로 복귀.
- `test/admin/screen-users.test.ts` (추가)
  - `'rbac-mfa'` fixture, admin 으로 `#/users/<alice id>` → `#user-mfa-status` "Enabled" → `#user-reset-mfa` → 모달 → `#confirm-reset-mfa` → 토스트 "Two-factor authentication reset." → `#user-mfa-status` "Off", 버튼 disabled. `bob`(MFA 없음) 화면에서는 처음부터 disabled.
- `test/admin/screen-server-settings.test.ts` (추가)
  - `#server-security` 안에 `#input-mfa-required-superusers`(unchecked), `#input-audit-retention-days`(값 90), `#input-audit-queue-size`(값 1000) → 체크박스 체크 → "Apply" 활성 → 보존 일수 `3651` 입력 → Apply → 실패 모달에 `auditRetentionDays must be 0 or an integer within 1..3650` → `30` 으로 고쳐 Apply → 성공 → 새로고침 후 체크 유지, 값 30.
- `test/admin/screen-login.test.ts`, `test/admin/screen-me.test.ts`: 기존 케이스 그대로 통과(MFA 없는 계정은 2단계가 나타나지 않는다).

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
git status --short admin/package.json admin/package-lock.json   # 둘 다 커밋에 포함되었는지
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U4-04, U4-06, U3-06(단위 3 전체). U4-06 이 만드는 `MeCtrl.sessions()`·`logoutOthers()`·`util/relativeTime.ts`·`SessionView`·`extraLogins` fixture·`UserEditScreen` Sessions 행을 그대로 쓰므로 U4-06 뒤에 시작한다(둘 다 마지막 파동이라 직렬화 비용이 작다).
- 후행: 없음(단위 4 의 마지막 이슈). U5-06(Security 화면)은 별도 `#/security` 화면이며 이 이슈의 `ServerSettingsScreen` Security 카드와 겹치지 않는다.

## 근거 문서

- `docs/design/2026-09-11-unit4-audit-mfa-sessions.md` §3.3(로그인 흐름·`mustEnrollMfa`), §3.4(MFA API), §5.2(MeScreen), §5.3(LoginScreen), §5.5(UserEditScreen), §5.6(ServerSettingsScreen), §6.3(브라우저 테스트), §7(U4-07: `qrcode` 의존성 배치·`QRCode.toCanvas`)
- `docs/design/2026-09-11-unit3-rbac-screens.md` §3(`mustChangePassword` 고정 방식), §4.2, §4.5, §4.6, §5(fixture)
- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §3(층 규칙), §6(부품 계약·Modal), §7.1(LoginScreen), §7.5(ServerSettingsScreen), §8.3(브라우저 테스트 규약)
- `docs/design/2026-09-11-program-overview.md` §1 D5·D6, §3.3 테스트 규약
- `docs/plan/prd/TTTGate-admin-rbac.md` §5.1.4 FR-AUDIT-RETENTION-001, §5.1.5, §5.1.6 FR-SESSION-SELF-KILL-001, §5.2.3

---
