# 단위 4 — 감사 로그 · MFA · 세션 관리

| 항목 | 내용 |
|---|---|
| 상위 문서 | [프로그램 개요](./2026-09-11-program-overview.md), [단위 2](./2026-09-11-unit2-rbac-model-api.md), [PRD](../plan/prd/TTTGate-admin-rbac.md) §5.1.4~5.1.6 §5.2.1 §5.2.5 §12 |
| 적용 결정 | D1 |
| 선행 단위 | API 이슈(U4-01~05)는 2(U4-03 은 선행 없음). 화면 이슈(U4-06~07)는 3 |
| 후행 단위 | 5(속성 집행 이슈가 감사 이벤트를 남긴다) |
| 대상 | `src/server/audit/`, `src/server/mfa/`(신규), `src/server/admin/{AdminServer,SessionStore}.ts`, `src/types/TunnelingOption.ts`(서버 옵션), `admin/src/screens/`, `admin/package.json`(`qrcode`) |

## 1. 목표

PRD 의 보안 기능 3종을 만든다.

1. **감사 로그.** 2 단위가 만든 `AuditSink` 삽입점에 파일 기반 append-only 저장을 붙이고, 조회 API 와 화면을 만든다. 보존 기간은 서버 옵션(기본 90일).
2. **TOTP MFA.** 사용자가 스스로 등록·해제하고, 등록된 사용자의 로그인은 비밀번호 + 코드(또는 복구 코드)를 요구한다. 슈퍼유저 MFA 강제 토글, 슈퍼유저에 의한 초기화.
3. **세션 관리.** 세션 목록, 특정 세션·특정 사용자 전체 강제 종료, 본인 "다른 기기에서 로그아웃".

PRD §12 미결 질문은 현재 가정대로 간다: Q1 MFA 강제 기본 off, Q3 보존 기간 상한 없음(`auditRetentionDays: 0` 이 무제한. 양수는 검증 범위 1..3650 이며 이는 입력 오류 방지용이지 정책 상한이 아니다), Q4 일반 유저 본인 MFA 해제 가능(강제 대상이 아니면), Q5 슈퍼유저끼리 세션 강제 종료 가능(본인 포함).

## 2. 감사 로그

### 2.1 저장 — `src/server/audit/FileAuditSink.ts`

- 경로 `Environment.path.logDir/audit/audit-YYYY-MM-DD.jsonl`(UTC 날짜). 한 줄에 `AuditEvent` 하나(JSON, 개행 없음). 파일은 `fs.createWriteStream(path, {flags: 'a'})` 로 열고 날짜가 바뀌면 교체.
- 쓰기 큐: 메모리 배열, 상한 `auditQueueSize`(서버 옵션, 기본 1000). `AuditSink.reserve(): boolean`(2 단위가 인터페이스에 정의, `audited()` 가 핸들러 실행 전에 호출)을 `FileAuditSink` 가 구현한다: 큐에 여유가 있으면 1칸을 선점하고 true, 가득 차면 false(→ `audited()` 가 실행 없이 503 `audit_unavailable`). `record()` 는 선점한 칸에 넣는다. 드롭 금지(NFR-PERF-AUDIT-WRITE-001). `audited()` 자체는 이 단위에서 바꾸지 않는다. 드레인은 `setImmediate` 루프에서 스트림 `write` 의 배압(`false` 반환 시 `drain` 대기)을 존중한다.
- 파일 권한 `0o600`(Windows 는 무시). 디렉터리 `0o700`.
- 보존: `FileAuditSink.pruneRetention(now = Date.now()): string[]`(삭제한 파일명 반환)을 public 으로 두고, 하루 1회(기동 직후 + 24시간 간격, `unref`) 인터벌이 그것을 부른다. `auditRetentionDays` 보다 오래된 파일을 삭제하고 삭제 자체를 `audit_retention_pruned` 이벤트로 남긴다. 테스트는 `now` 를 주입한다.
- 무결성: API 로는 읽기만 제공한다(NFR-SEC-AUDIT-INTEGRITY-001). 수정·삭제 엔드포인트 없음. `SecretRedactor`(`src/util/SecretRedactor.ts` 의 `redactSecrets(obj)`, 리터럴 `[REDACTED]`, 기존 규칙이 `password`·`*secret`·`*token` 키를 덮는다)를 `detail` 에 적용하고 키 `totp`, `code`, `recoveryCode` 를 추가 규칙으로 등록한다(U4-01 범위).

### 2.2 이벤트 타입 (NFR-VISI-LOGIN-EVENTS-001 포함)

| type | 발생 | target |
|---|---|---|
| `login_success`, `login_failure` | `/api/login` | user (실패 시 username 만 `detail.username`) |
| `mfa_success`, `mfa_failure`, `mfa_recovery_used` | `/api/login/mfa` | user |
| `mfa_enrolled`, `mfa_disabled`, `mfa_reset`, `mfa_recovery_codes_regenerated` | 등록·해제·초기화·복구 코드 재발급 | user |
| `logout`, `session_killed`, `sessions_killed_for_user`, `sessions_killed_self_others` | 세션 | session / user |
| `user_created`, `user_updated`, `user_deleted`, `user_status_changed`, `role_changed`, `temp_password_issued`, `password_changed`(`detail.firstLogin: boolean`) | 사용자 | user |
| `group_created`, `group_updated`, `group_attributes_changed`(`detail.changedKeys`), `group_deleted` | 그룹 | group |
| `tunnel_created`, `tunnel_updated`, `tunnel_deleted`, `tunnel_activated`, `tunnel_deactivated`, `tunnel_reassigned`, `tunnel_cert_updated`, `tunnel_cert_deleted` | 터널 | tunnel(id = port) |
| `server_option_updated`, `admin_cert_updated` | 서버 | server |
| `security_geo_updated`, `security_ban_removed` | 5 단위 | security |
| `access_denied` | `authorize` 가 403/404 를 낼 때 | (action 을 `detail.action`) |
| `last_superuser_guard_hit`(`IdentityStore` 가드가 409 를 낼 때, 단위 2 §4.1), `conn_limit_hit`·`tunnel_autoexpire`(단위 5 §7), `audit_retention_pruned`(2.1) | 가드·런타임 | |

2 단위의 `audit-sink.test.ts` 를 확장해 라우트 표의 모든 CUD 항목이 위 표의 타입 중 하나를 내는지 단언한다(K3).

### 2.3 조회 API

| 메서드·경로 | action | 요청 | 응답 |
|---|---|---|---|
| `GET /api/audit` | 함수형: 슈퍼유저면 `audit:read-all`, 아니면 `audit:read-self` | 쿼리 `from`, `to`(epoch ms), `userId`, `type`, `targetKind`, `targetId`, `outcome`, `limit`(≤ 500, 기본 100), `cursor` | `{events: AuditEvent[], nextCursor?: string}`. 최신순. 일반 유저는 `actor.userId === 본인` 으로 강제 필터 |
| `GET /api/audit/types` | 위와 같음 | — | `{types: string[]}` |

- 읽기는 날짜 파일을 최신 날짜부터 하나씩 연다. 하루 파일 하나는 `readline` 으로 라인 배열에 올린 뒤 뒤집어(최신순) 필터를 적용한다. 파일 하나까지만 메모리에 올리고 여러 파일을 동시에 올리지 않는다. `cursor` 는 `{file, offset}` 을 base64 로 인코딩하며 `offset` 은 그 파일의 최신순 0 기반 라인 인덱스다.
- 조회 자체는 감사하지 않는다.

## 3. MFA (TOTP)

### 3.1 구현 — `src/server/mfa/Totp.ts` (외부 의존성 없음)

- RFC 6238 / RFC 4226. HMAC-SHA1, 30초 스텝, 6자리, 허용 오차 ±1 스텝. 비밀은 20바이트 `crypto.randomBytes`, Base32 인코딩(RFC 4648, 패딩 없음)으로 URI 에 싣는다.
- `otpauth://totp/TTTGate:{username}?secret={base32}&issuer=TTTGate&algorithm=SHA1&digits=6&period=30`.
- 재사용 방지: 마지막으로 성공한 스텝 카운터를 사용자 레코드에 저장(`mfa.lastUsedStep`), 같거나 작은 스텝의 코드는 거부.
- 복구 코드: 10개, 각 `xxxx-xxxx`(소문자·숫자 8자, `crypto.randomInt`). 저장은 `sha256(code + userId)` hex. 사용하면 항목 삭제. 남은 개수는 `/api/me` 에 노출.

### 3.2 저장 (`identity.yaml` 사용자 레코드 확장)

```yaml
mfa:
  enabled: true
  secret: <base32>            # SecretRedactor 대상. 감사·API 응답에 절대 노출 금지
  enrolledAt: 1757548800000
  lastUsedStep: 58584960
  recoveryCodeHashes: [ ... ]
```

서버 옵션: `mfaRequiredForSuperusers: boolean`(기본 false), `auditRetentionDays: number`(기본 90, 0 = 무제한, 그 외 1..3650), `auditQueueSize: number`(기본 1000, 100..100000). `verificationServerOption` 에 검증 추가. `/api/serverOption` 으로 편집(슈퍼유저).

### 3.3 로그인 흐름 변경

```
POST /api/login {username, password}
  → 비밀번호 실패: 401 (백오프)
  → 성공, mfa.enabled === false: 세션 발급 (기존)
  → 성공, mfa.enabled === true: 200 {success: true, mfaRequired: true, mfaTicket}
       mfaTicket: 32바이트 hex, 서버 메모리 Map<ticket, {userId, ip, expiresAt: now+120s, attempts}>. 세션 아님.
POST /api/login/mfa {mfaTicket, code} | {mfaTicket, recoveryCode}
  → 티켓 없음·만료·IP 불일치: 401 mfa_ticket_invalid
  → 코드 실패: 401, 티켓 attempts++, 백오프 버킷에 실패 기록(NFR-SEC-NEW-ENDPOINT-BACKOFF-001), attempts ≥ 5 면 티켓 폐기
  → 성공: 티켓 폐기, 세션 발급(쿠키 2개), 응답은 /api/login 성공과 동일
```

- `mfaRequiredForSuperusers === true` 인데 슈퍼유저에게 MFA 가 없으면 로그인 성공 후 세션에 `mustEnrollMfa: true` 를 두고, `mustChangePassword` 와 같은 게이트로 `me:*` 외 403 `mfa_enrollment_required`. `/api/validateSession`·`/api/me` 가 `mustEnrollMfa` 를 돌려준다.
- `/api/login/mfa` 는 CSRF 헤더 예외 목록에 `/api/login` 과 함께 둔다(세션 이전 단계). Origin 검사는 유지.

### 3.4 API

| 메서드·경로 | action | 요청 | 응답 |
|---|---|---|---|
| `POST /api/me/mfa/enroll` | `me:mfa` | — | `{secret, otpauthUri, recoveryCodes: string[]}` — 이 응답에만 평문. 서버는 `pendingEnrollment` 로 사용자 레코드 외 메모리에 5분 보관(아직 enabled 아님) |
| `POST /api/me/mfa/confirm` | `me:mfa` | `{code}` | 코드가 pending secret 과 맞으면 `mfa.enabled = true` 로 저장. 감사 `mfa_enrolled` |
| `DELETE /api/me/mfa` | `me:mfa` | `{password}` | 현재 비밀번호 확인 후 해제. `mfaRequiredForSuperusers` 대상이면 409 `mfa_required` |
| `POST /api/me/mfa/recovery-codes` | `me:mfa` | `{password}` | 복구 코드 재발급(기존 전부 무효) |
| `POST /api/users/:id/mfa/reset` | `user:manage` | — | 해당 사용자 MFA 해제 + 세션 제거. 감사 `mfa_reset` |

`Action` 에 `me:mfa` 를 추가한다(일반·슈퍼 모두 허용, `mustChangePassword` 게이트 뒤).

## 4. 세션 관리

### 4.1 API

| 메서드·경로 | action | 응답·동작 |
|---|---|---|
| `GET /api/sessions` | `session:manage` | `{sessions: Array<{id, userId, username, createdAt, lastSeenAt, ip, userAgent, current: boolean}>}`. `id` = `sha256(sessionKey).slice(0,16)`(2 단위의 `sessionIdHash` 와 동일). 세션 키 자체는 노출하지 않는다 |
| `DELETE /api/sessions/:id` | `session:manage` | 해당 세션 제거(본인 것도 가능. 그러면 응답 후 쿠키 만료). 감사 `session_killed` |
| `DELETE /api/users/:id/sessions` | `session:manage` | 그 사용자의 세션 전부. 감사 `sessions_killed_for_user` |
| `GET /api/me/sessions` | `me:sessions` | 본인 세션 목록 |
| `POST /api/me/sessions/logout-others` | `me:sessions` | 현재 세션 외 본인 세션 제거. 감사 `sessions_killed_self_others` |

`SessionStore.listSessions()`·`sessionIdOf(key)`(2 단위) 에 `removeSessionById(id)` 를 추가한다. 세션은 메모리 저장 그대로다(재기동 시 소멸, 기존 동작).

## 5. 화면 (3 단위 이후)

### 5.1 `AuditScreen` (`#/audit`, section `audit`)

- 필터 바(`Card`): `Select` type(전체 + `/api/audit/types`), 슈퍼유저에게만 `Select` user(전체 + 사용자 목록), `Select` outcome, 기간 프리셋 `Tabs`(24h / 7d / 30d / all). 적용 버튼 없이 변경 즉시 조회.
- 목록: 이벤트마다 한 행 `Card`(compact). 1행 mono 시각(로컬, `YYYY-MM-DD HH:mm:ss`) + `Badge` outcome(`success` pulse / `failure` alarm) + type `Chip`; 2행 `summary`; 3행 mono `actor @username · target kind:id · ip`. 탭하면 `detail` JSON 을 `<pre class="mono">` 로 펼침.
- 하단 "Load more"(`nextCursor` 있을 때). 비면 "No events in this range."
- 일반 유저 화면 제목은 "My activity", 사용자 필터 없음.

### 5.2 `MeScreen` 확장

- "Two-factor authentication" `Card`: 상태 배지(Enabled / Off). Off → `Button variant="primary"` "Set up" → 등록 흐름 모달(3단계 `Tabs` 가 아니라 순차 화면): (1) QR(`qrcode` 패키지로 `otpauthUri` 를 canvas 에 그림, 아래에 mono secret 과 "Copy"), (2) `TextInput id="mfa-code"` 6자리 확인, (3) 복구 코드 10개 mono 목록 + "Copy all" + "I saved these codes" `Checkbox` 가 체크되어야 "Done". Enabled → "Disable"(비밀번호 확인 모달), "New recovery codes"(비밀번호 확인 → 목록 모달). 남은 복구 코드 수 표시.
- "Sessions" `Card`: 본인 세션 목록(현재 세션 `Chip` "this device"), "Sign out other devices" 버튼.
- `mustEnrollMfa` 상태: `#/me` 로 고정(강제 변경과 같은 방식), 상단 안내 "Superusers must enable two-factor authentication."

### 5.3 `LoginScreen` 확장

- `/api/login` 이 `mfaRequired` 를 돌려주면 비밀번호 폼을 숨기고 `TextInput id="login-mfa-code"`(6자리, `inputmode="numeric"`) + "Use a recovery code instead" 링크(→ `id="login-recovery-code"`). 실패 문구: "The code is incorrect." / 티켓 만료 시 "The sign-in expired. Start again." + 처음으로.

### 5.4 `SessionsScreen` (`#/sessions`, section `sessions`, 슈퍼유저)

- 표: user · started · last seen · IP · user agent(줄임) · "End" 버튼(확인 모달, 본인 세션이면 "You will be signed out."). 상단 필터 `Select` user 와 "End all for user" 버튼. 10초 주기 갱신.

### 5.5 `UserEditScreen` 확장

- "Two-factor" 행: 상태 + "Reset MFA"(확인 모달 → `POST /api/users/:id/mfa/reset`). "Sessions" 행: 개수 + "End all sessions".

### 5.6 `ServerSettingsScreen` 확장

- "Security" `Card`: `Checkbox` "Require two-factor for superusers", `NumberInput` "Audit log retention (days)", `NumberInput` "Audit queue size".

## 6. 테스트

### 6.1 단위

- `test/unit/server/mfa/Totp.test.ts`: RFC 6238 부록 B 테스트 벡터(SHA1, 비밀 = ASCII `12345678901234567890` 20바이트, 시간 59·1111111109·1234567890·2000000000 → 8자리 코드 `94287082`·`07081804`·`89005924`·`69279037`, 6자리 구현은 뒤 6자리 `287082`·`081804`·`005924`·`279037` 로 비교) — 구현이 표준과 맞는지의 근거. ±1 스텝 허용, 재사용 거부, Base32 왕복, 복구 코드 형식·해시·1회성.
- `test/unit/server/audit/FileAuditSink.test.ts`: 임시 로그 디렉터리에 JSONL 기록, 날짜 교체, 큐 상한 도달 시 거부, 배압(`write` 가 false 를 돌려주는 느린 스트림 스텁 — 파일시스템 경계 스텁 허용) 존중, 보존 삭제, redaction.
- `test/unit/server/audit/AuditQuery.test.ts`: 3일치 파일에서 필터·정렬·커서 페이지.

### 6.2 컴포넌트 (실제 `AdminServer`)

- `test/component/server/admin/mfa-login.test.ts`: 등록 → 확인 → 로그아웃 → 비밀번호만으로는 `mfaRequired` → 잘못된 코드 5회 후 티켓 폐기 → 새 로그인 → 올바른 코드(테스트가 `Totp.generate(secret, now)` 로 계산) → 세션. 복구 코드 로그인과 1회성. 백오프 지연이 MFA 실패에도 적용(응답 시간 측정). `mfaRequiredForSuperusers` 게이트.
- `test/component/server/admin/sessions-api.test.ts`: 세션 3개 만들고 목록·개별 종료(종료된 쿠키는 401)·사용자 전체 종료·logout-others.
- `test/component/server/admin/audit-api.test.ts`: 일련의 CUD 뒤 `/api/audit` 에 이벤트가 순서대로 있고, 일반 유저는 본인 것만, 비밀번호 필드가 `[REDACTED]`. `audit-sink.test.ts` 확장(2.2 전수).

### 6.3 브라우저

- `screen-audit.test.ts`, `screen-me-mfa.test.ts`(등록 모달에서 secret 을 읽어 테스트가 코드를 계산해 입력), `screen-login-mfa.test.ts`, `screen-sessions.test.ts`, `screen-server-settings.test.ts` 에 Security 카드 케이스 추가.

## 7. 이슈 분할

| # | 제목 | 만드는 것 | 수용 기준 | 선행 |
|---|---|---|---|---|
| U4-01 | 파일 감사 저장소와 보존 | `FileAuditSink`(`reserve`/`record`/큐/배압/날짜 교체/보존 삭제), 서버 옵션 2개(`auditRetentionDays`, `auditQueueSize`), `ServerApp` 에서 `AuditSinkRegistry.set`, `audit/AuditEventTypes.ts`(단위 5 가 먼저 문자열 리터럴로 쓴 `conn_limit_hit`·`tunnel_autoexpire` 를 상수로 치환), redaction 키 추가, 2.2 표대로 기존 CUD 헬퍼 호출부의 type 지정 | 6.1 FileAuditSink, `audit-sink.test.ts` 확장(2.2 전수) | U2-08 |
| U4-02 | 감사 조회 API | `AuditQuery`, `/api/audit`, `/api/audit/types` | 6.1 AuditQuery, 6.2 audit-api | U4-01 |
| U4-03 | TOTP 구현 | `mfa/Totp.ts`(generate/verify/secret/base32/otpauth URI), 복구 코드 생성·해시·검증 | 6.1 Totp | — |
| U4-04 | 로그인 2단계와 MFA API | 사용자 레코드 확장, `/api/login` 분기, `/api/login/mfa`(티켓·백오프·CSRF 예외), `/api/me/mfa/*`, `/api/users/:id/mfa/reset`, `mfaRequiredForSuperusers` 옵션과 게이트 | 6.2 mfa-login | U4-03, U2-08 |
| U4-05 | 세션 관리 API | `SessionStore` 확장, `/api/sessions*`, `/api/me/sessions*` | 6.2 sessions-api | U2-08 |
| U4-06 | 감사 로그·세션 화면 | `AuditScreen`, `SessionsScreen`, `UserEditScreen` 확장(세션 행), NAV 항목, 컨트롤러 | `screen-audit`, `screen-sessions` | U4-02, U4-05, U3-06 |
| U4-07 | MFA 화면 | `qrcode` 의존성(admin `dependencies`, `@types/qrcode` 는 `devDependencies`; `import QRCode from 'qrcode'` 후 `QRCode.toCanvas(canvasEl, otpauthUri)`), `MeScreen` MFA 카드·세션 카드, `LoginScreen` 2단계, `UserEditScreen` MFA 리셋, `ServerSettingsScreen` Security 카드 | `screen-me-mfa`, `screen-login-mfa`, server-settings 추가 케이스 | U4-04, U4-05, U4-06(공유 `MeCtrl.sessions()`·`logoutOthers()`·`util/relativeTime.ts` 는 U4-06 이 만든다), U3-06 |

U4-01→02 직렬. U4-03 은 선행이 없어 언제든 시작할 수 있고, U4-04·U4-05 는 U2-08 이후 U4-01 과 병렬 가능. U4-06·07 은 3 단위 이후.
