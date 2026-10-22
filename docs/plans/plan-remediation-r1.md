# 구현 계획 — TTTGate 백엔드 결함 제거 라운드 1 (Round 2 개정판)

- **SPEC 출처**: `docs/srs/backend-remediation-round1.md` (REQ-01 ~ REQ-22 전건)
- **대상 브랜치**: `refactor/safecode` (HEAD `258c057`)
- **모드**: Normal (Opus × 1 시니어 플래너, Sonnet × 2 평가)
- **라운드**: 5 (라운드 4 FAIL → 라운드 5 개선 / CRITICAL F-P4-01 + HIGH F-P4-02/P4/P5 반영)
- **전체 Phase 수**: 7
- **전체 TASK 수**: 26
- **REQ 커버리지**: 22/22 (100%) — 하단 §5 스펙 매핑 표에서 검증

> **ZERO TOLERANCE — Mock 금지 (NO-MOCK)**
> 본 계획의 모든 TASK는 Mock/Stub/`jest.mock`/`nock`/`msw`/가짜 타이머·소켓·FS 사용을 **절대 금지**한다. 외부 의존(TLS handshake, HTTP 파서, 소켓, 파일시스템, 인증서, 랜덤)은 항상 **실제 구현**을 사용하며, 통합 테스트는 `child_process.spawn` 또는 `net/tls.createServer` + ephemeral 포트 + 임시 FS로 구동한다.

> **SCOPE-LOCK OVERRIDE — 테스트 디렉토리 경로**
> SPEC §5는 `tests/` 경로를 전제하나, 저장소에는 이미 `test/helpers/`, `test/unit/`, `test/e2e/`, `test/security/` 구조가 존재한다. **기존 `test/` 경로를 사용**하되 SPEC이 정의한 파일명 규약(`req-XX-<kebab>.test.ts`, REQ당 1파일)은 **SCOPE-LOCK 동등 강제**한다(원칙 8). 이 오버라이드는 본 문단과 §3 원칙 표에서만 효력을 가지며 SPEC 본문은 수정하지 않는다.

---

## 1. 개요 및 라운드별 반영 사항

### 1.0 라운드 4 반영 사항 (HIGH-1 ~ HIGH-4, MEDIUM-A/B)

라운드 3 FAIL 판정(까칠 리뷰어)에 따른 재개정.

| ID | 지적 | 반영 위치 |
|---|---|---|
| HIGH-1 | coverageThreshold 임의 40 하향 → 계획(lines=60) 불일치, ZERO TOLERANCE 위반 | **계획을 고쳐라 원칙 적용**: Phase 1 `collectCoverageFrom`을 "실제 Phase 1 수정/증명 범위"(현재 `src/Environment.ts`)로 좁히고 threshold=60 복원. 후속 Phase에서 `collectCoverageFrom` 배열을 확장하며 threshold 60 유지 가능 여부를 동시 증명. P1-T1 summary/dod에 명시. |
| HIGH-2 | `lint-auth-compare.test.ts`가 `cwd/reports/auth-compare.json`을 오염하여 P7-T2 DoD와 충돌 | `scripts/lint-auth-compare.mjs`에 `--report-dir` 인자 추가(기본 `cwd/reports`로 CLI 호환 유지). 테스트는 tmp 디렉터리로 리포트 격리. |
| HIGH-3 | `scripts/smoke.mjs` Windows teardown: `spawn('taskkill', ...)` await 없이 Promise.race → 좀비/stderr 미가시/`rmSync` silent 실패, 하드캡·main.catch·finally 3경로 exit 레이스 | `spawnSync('taskkill', ['/T','/F','/PID', pid])` 동기 대기 + `res.stderr` 로깅 + `child.pid === undefined` 선체크 + `rmSync` 실패 `console.warn` 가시화. 단일 exit path `finalize()` 도입. |
| HIGH-4 | "ctrl session 1 established" 거짓 문구 — 실제로는 TCP listener 도달성만 확인. 원칙 §5.4 EVIDENCE-BASED DoD 위배 | 로그 문구를 `"ctrl port reachable (session establish deferred to P7-T3)"`로 변경. 계획 P1-T3 DoD 문구도 동기화. 실 세션 수립은 P7-T3에서 구현. |
| MEDIUM-A | `.eslintrc.cjs no-restricted-syntax`의 operator 정규식 그룹핑 오류(`/^===|!==|==|!=$/` → 의미상 `/^===/ OR /!==/ OR /==/ OR /!=$/`) | `/^(===|!==|==|!=)$/`로 괄호 그룹핑 정정(좌/우 identifier 셀렉터 모두). |
| MEDIUM-B | `SessionStore.security` 전체 `describe.skip`(Windows)이 chmod 외 로직까지 skip하여 과도 | chmod 모드 비트(0o600) 검증 `expect`만 `if(isPosix)` 가드. Windows에서도 bootstrap 흐름/legacy → bcrypt 업그레이드 테스트는 실행. |

본 계획은 SPEC의 22개 결함 요구사항(REQ-01~REQ-22)을 7개 Phase·26개 TASK로 분해한다. Phase는 의존성 기반 토폴로지 정렬을 따르고 Phase 내부 TASK는 병렬 가능하도록 파일 중첩을 최소화했다.

### 1.2 라운드 1 → 라운드 2 변경 요약 (HIGH/MEDIUM/LOW 해결)

| ID | 평가 지적 | 반영 위치 |
|---|---|---|
| H-1 | P5-T6 DoD의 리스너 상한이 SPEC(`≤1`)과 불일치(`≤2`) | P5-T6 DoD를 `≤ 1`로 강화. 운영 error 핸들러는 **named function + 참조 보존**, listen 전용 핸들러는 성공/실패 직후 `removeListener(named)`. `removeAllListeners` 사용 금지(영구 핸들러 말소 방지). **영구 error 핸들러 보존 검증**(`listeners('error').length >= 1`) 포함. H-4 통합. |
| H-2 | P2-T2 req_ids에 REQ-20 오매핑 | P2-T2.req_ids = `["REQ-01"]`로 수정. REQ-20은 P1-T1 단독 유지. |
| H-3 | P6 depends_on이 `["P2","P3"]`로 과도 + P3-T3↔P6-T3 ClientApp.ts 재수정 충돌 | **옵션 (b) 파일 경계 분리** 선택: P3-T3는 `ClientApp.ts`의 YAML 저장/로드 게이트 로직만, P6-T3는 `src/types/TunnelingOption.ts`의 `normalizationClientOption`만 수정. `ClientApp.ts`는 P6-T3에서 호출부 치환만(인라인 범위 검증 제거). 각 TASK의 files 필드로 강제. **P6-T4는 depends_on=["P1"]로 단축**(순수 단위 테스트). |
| H-4 | `removeAllListeners`가 영구 핸들러까지 말소할 위험 | H-1에 통합. named function 참조 보존 + `removeListener(named)` 방식으로 설계 고정. |
| H-5 | Phase 3/5/7 smoke 실행이 오래된 빌드 대상일 위험 | 해당 Phase DoD 앞에 **`node deploy.js` 재실행 단계를 명시**(MD 본문·JSON `phase_dod` 양측). |
| M-1 | P3-T2 req_ids에 REQ-08 오매핑 | P3-T2.req_ids = `["REQ-02"]`로 축소. REQ-08은 P3-T5 단독 매핑(req_mapping 유지). |
| M-2 | 지수 지연 실측 플래키 우려 | **지연 계산을 순수 함수로 분리**: `src/server/admin/loginBackoff.ts` 신설, `computeBackoffMs(failCount): number = Math.min(2^failCount*100, 5000)`. 단위 테스트로 반환값 직접 검증. 통합 테스트는 **하한만**(`>= 400ms`) 확인(상한 숨김 금지 — 플래키 원인을 제거한 결정적 검증). |
| M-3 | P6-T1 부정 시나리오 누락 | "이미 close된 세션 ID에 orphan close 재통보 시 활성 세션 무영향" 테스트 추가. |
| M-4 | selfsigned 패키지 의존성 리스크 누락 | `package.json` 실측 결과 `node-forge ^1.3.1` 이미 존재, `selfsigned` 부재. **인증서 생성에 `node-forge` 사용**(대안 1). 추가 의존 도입 금지. 리스크 R9 신설. |
| M-5 | SPEC `tests/` vs 계획 `test/` 불일치 오버라이드 근거 | 문서 상단 **SCOPE-LOCK OVERRIDE** 블록 신설. §3 원칙 표에도 반영. |
| L-1 | `severity_gate` 구조화 | JSON 루트 `severity_gate`를 객체로 전환. |
| L-2 | P5-T6 heap 측정 강등 | heap 측정을 **권고(optional)** 로 강등. DoD 필수 항목은 리스너 개수 검증으로 고정. |
| L-3 | P1-T2 DoD에 lint exit 수치 명시 | `npm run lint` **exit 0 (warn 허용, error 0건)** 명시. |
| L-4 | P5-T4 수동 스모크 자동화 | smoke 스크립트에 admin SPA GET `/api/serverOption`의 `Access-Control-Allow-Origin`/`Vary` 헤더 자동 체크 추가(P7-T3에 반영) + CSRF 누락 POST 1건 403 확인. |

### 1.3 경로 매핑 (SPEC 약식 → 실제)

| SPEC 약식 | 실제 경로 |
|---|---|
| `src/server/AdminServer.ts` | `src/server/admin/AdminServer.ts` |
| `src/server/SessionStore.ts` | `src/server/admin/SessionStore.ts` |
| `src/commons/HttpPipe.ts` | `src/server/http/HttpPipe.ts` |
| `src/commons/HttpUtil.ts` | `src/server/http/HttpUtil.ts` |

---

## 2. 선행조건·전제

- Node.js 18+ (특히 `tls.Server#setSecureContext`, `crypto.timingSafeEqual`, `https.Server` headers/requestTimeout API).
- TypeScript 5.1+, ts-jest 29, **node-forge ^1.3.1** (이미 존재 — 신규 의존 없음).
- `admin/` 프론트엔드는 touch 금지. REQ-03/REQ-07/REQ-12 변경에 대한 호환성은 P5-T4 + P7-T3 smoke에서 자동 검증.
- `refactor/safecode` 이후 추가 마이그레이션 없음.
- 본 라운드는 **계획만 작성**. 코드 수정은 후속 `snoworca-coder` 단계.

---

## 3. 테스트 원칙 요약 (SPEC §5 압축)

| # | 원칙 | 요점 |
|---|---|---|
| 1 | **NO-MOCK** | `jest.mock`/`sinon`/수동 mock/`nock`/`msw`/fake timer 전면 금지. |
| 2 | **LIVE-PROCESS** | 프로토콜·소켓 검증은 `child_process.spawn` 또는 실 `tls/net/http.createServer`+ephemeral 포트. |
| 3 | **DETERMINISM** | 랜덤·타이밍 의존 최소화(REQ-01 검증 대상 제외). 가능하면 **순수 함수 분리 + 단위 검증**(예: `computeBackoffMs`). |
| 4 | **EVIDENCE-BASED DoD** | 모든 완료 주장은 근거 파일(coverage/lcov, reports/*.json, 테스트 녹색 로그) 1개 이상. |
| 5 | **NEGATIVE TESTS** | 보안 REQ는 악성 입력 거부 증명 필수. 재현 페이로드 출처를 파일 상단 주석에 명시. |
| 6 | **ISOLATION** | 포트는 `0` 바인딩, 임시 디렉토리 사용. 전역 공유 금지. |
| 7 | **NO-FLAKE** | 타임아웃 숨김/retry 금지. 타이밍 의존 테스트는 순수 함수 분리 후 하한만 통합 검증. |
| 8 | **SCOPE LOCK** | `test/**/req-XX-<kebab>.test.ts` 경로 규약(SPEC `tests/`는 오버라이드 — §1). REQ 1건당 테스트 파일 1개 원칙. |

---

## 4. Phase별 계획

### Phase 1 — 테스트·린트 인프라 가동 (기반)

**목표**: 이후 Phase가 기댈 Jest/ESLint·헬퍼·스모크 기반을 먼저 세운다.

**선행조건**: 없음.

**Tasks**:

- **P1-T1 — Jest 설정 강화 및 커버리지 인프라**
  - **REQ**: REQ-20
  - **파일**: `jest.config.ts`(신규), `package.json`(scripts.test, scripts.test:coverage, jest 인라인 제거), `tsconfig.json`(검토만)
  - **변경 요약**: 루트 `jest.config.ts` 신설. `testMatch: ["<rootDir>/test/**/*.test.(js|ts)"]`. **`collectCoverageFrom`은 Phase별 증분 확장 방식** — Phase 1에서는 Phase 1 실 증명 범위(`src/Environment.ts`)만 포함하고, Phase 2에서 `src/util/ClockRng.ts`/`src/util/timingSafeStringEqual.ts`, Phase 3에서 `src/util/TlsOptionsFactory.ts`/`src/commons/ProtocolV2.ts`, Phase 5에서 `src/server/admin/**`, Phase 7에서 `src/client/**`/`src/server/http/**`/`src/server/TunnelServer.ts`/`src/server/TTTServer.ts`/`src/server/IdentityRegistry.ts` 등 잔여 모듈로 배열을 점진 확장한다. **`coverageThreshold.global.lines: 60`은 Phase 1부터 고정** — 매 Phase에서 collectCoverageFrom을 확장할 때마다 threshold 60 유지 가능 여부를 동시에 증명한다(round 4 HIGH-1 정정 사유: 계획 `lines=60`을 임의 하향 금지, 대신 실제 범위를 좁혀 정직하게 증명). `package.json#jest` 인라인 제거.
  - **test (Mock 금지)**: `npm test` 실제 실행, `test/unit/Environment.version.test.ts` 녹색.
  - **DoD**: ① `npm test` exit 0, ② `npm run test:coverage`로 `coverage/lcov.info` 생성 **+ threshold 60 통과(exit 0)**, ③ `jest --showConfig`의 `testMatch`가 `test/**`이고 `collectCoverageFrom`이 해당 Phase 증명 범위를 포함(Phase 1은 `src/Environment.ts` 포함), ④ `package.json`에 `jest` 인라인 grep 0건.

- **P1-T2 — 보안 린트 규칙 추가**
  - **REQ**: REQ-21 (선행 warn 단계; error 승격은 P7-T2)
  - **파일**: `.eslintrc.cjs`(신규), `package.json`(devDependencies: eslint/@typescript-eslint/*, scripts.lint), `scripts/lint-auth-compare.mjs`(폴백 스크립트)
  - **변경 요약**: `no-restricted-syntax` 휴리스틱 규칙 2종(`authKey|proof|token|secret|hmac` 식별자 대상 `===/!==/==/!=` 탐지). 초기 severity = **warn**. `scripts/lint-auth-compare.mjs`는 Node 내장 fs 글롭 기반 ripgrep 대안, 경고 리포트 `reports/auth-compare.json` 생성.
  - **test (Mock 금지)**: `test/unit/tools/lint-auth-compare.test.ts` — 임시 디렉토리에 위반 파일 작성, `child_process.spawnSync`로 실 스크립트 실행, stdout 경고 확인.
  - **DoD**: ① `npm run lint` **exit 0 (warn 허용, error 0건)** — 수치 명시, ② 위반 재현 테스트 녹색, ③ `reports/auth-compare.json` 생성.

- **P1-T3 — 배포 스모크 스크립트 (기초)**
  - **REQ**: REQ-22
  - **파일**: `scripts/smoke.mjs`(신규), `test/helpers/smokeProcess.ts`(신규)
  - **변경 요약**: `build/src/app.js` 또는 ts-node 경유 서버 기동, 포트 `0` 바인딩, 실 `tls.connect`로 admin handshake, 클라이언트 `spawn`으로 세션 1건 성립 확인, 20초 하드캡.
  - **test (Mock 금지)**: 스크립트 자체가 실환경 통합 검증.
  - **DoD**: ① `node deploy.js && node scripts/smoke.mjs` exit 0, ② 하드코딩 포트 grep 0건, ③ `admin tls ok`/`ctrl port reachable (session establish deferred to P7-T3)` 로그 (round 4 HIGH-4: 실제 세션 수립 없이 TCP 도달성만 확인하므로 정직한 문구로 변경 — EVIDENCE-BASED DoD 준수. 실 CtrlPacket 세션 수립은 P7-T3에서 구현).

**Phase 1 DoD**: `npm test` + `npm run lint` exit 0 (warn 허용, error 0건) + `node scripts/smoke.mjs` exit 0.

---

### Phase 2 — 공용 보안 헬퍼

**목표**: 이후 축이 공용 사용할 상수 시간 비교 헬퍼와 보안 RNG 분리 선도입.

**선행조건**: Phase 1.

**Tasks**:

- **P2-T1 — `timingSafeStringEqual` 헬퍼 신설**
  - **REQ**: REQ-04, REQ-21(헬퍼 문서화 측)
  - **파일**: `src/util/timingSafeStringEqual.ts`(신규)
  - **변경 요약**: `(a, b, encoding="utf8") => boolean`. 길이 불일치도 상수 시간(패딩 후 `crypto.timingSafeEqual`). JSDoc에 REQ-04/REQ-21 참조.
  - **test (Mock 금지)**: `test/unit/util/req-04-timing-safe-string-equal.test.ts` — 5케이스 + 100k 마이크로벤치(편향 < 5%).
  - **DoD**: ① 테스트 녹색, ② `reports/req-04-bench.json`, ③ `timingSafeEqual` import 존재.

- **P2-T2 — `ClockRng` 토큰·지터 경로 분리**
  - **REQ**: **REQ-01 (only)** — H-2 반영
  - **파일**: `src/util/ClockRng.ts`
  - **변경 요약**: `secureRandomBytes(n: number): Buffer` 메서드 추가(`crypto.randomBytes` 위임). 기존 `random()`은 지터 전용. 주석으로 "never use random() for tokens" 명시.
  - **test (Mock 금지)**: `test/unit/util/req-01-clockrng-secure.test.ts` — 10000회 생성, Shannon 엔트로피 > 7.5 bit/byte, 중복 0건.
  - **DoD**: ① 테스트 녹색, ② `reports/req-01-entropy.json`, ③ `rg "Math.random" src/util/ClockRng.ts`가 `random()` 경로만 매치.

**Phase 2 DoD**: 헬퍼 2종 녹색 + `npm run build` exit 0.

---

### Phase 3 — Crypto·TLS 축 (REQ-01/02/04/08)

**선행조건**: Phase 2.

**Tasks**:

- **P3-T1 — `createOpaqueToken`·`issueBindingToken` crypto.randomBytes화**
  - **REQ**: REQ-01
  - **파일**: `src/commons/ProtocolV2.ts`, `src/server/IdentityRegistry.ts`, `src/server/admin/SessionStore.ts`(교차 확인)
  - **변경 요약**: `secureRandomBytes(length).toString("hex")`로 교체. `rng.random()` 잔존 경로는 지터 한정 주석화.
  - **test (Mock 금지)**: `test/unit/commons/req-01-create-opaque-token.test.ts` — 10000개 중복 0건, hex 정규식, 카이제곱 p > 0.01, `issueBindingToken` 동일 입력 10000회 고유.
  - **DoD**: ① 녹색, ② `rg "Math.random|rng\.random" src/commons/ProtocolV2.ts` 0건, ③ `reports/req-01-chi2.json`.

- **P3-T2 — `TlsOptionsFactory` 서버/클라이언트 TLS 강화**
  - **REQ**: **REQ-02 (only)** — M-1 반영
  - **파일**: `src/util/TlsOptionsFactory.ts`
  - **변경 요약**: `secureProtocol` 제거. `minVersion: 'TLSv1.2'`, `maxVersion: 'TLSv1.3'`, ECDHE-AEAD cipher 화이트리스트, `honorCipherOrder: true`. 클라이언트 옵션도 `minVersion/maxVersion` 대칭 적용.
  - **test (Mock 금지)**: `test/security/req-02-tls-settings.test.ts` — 실 `tls.createServer`/`tls.connect` 4케이스(TLSv1.3 성공, TLSv1_method 거부, 약한 cipher 거부, getProtocol() 확인). 인증서는 **node-forge로 런타임 생성** 또는 `test/helpers/fixtures/*.pem`(M-4).
  - **DoD**: ① 녹색, ② `rg "secureProtocol" src/util/TlsOptionsFactory.ts` 0건, ③ TLS 1.3 handshake 로그 증거.

- **P3-T3 — `allowInsecureTls`/`allowLegacyFallback` YAML 저장 금지 + `--yes-insecure` 게이트**
  - **REQ**: REQ-02 (YAML 부분)
  - **파일**: `src/client/ClientApp.ts` **(YAML save/load 게이트 로직 전용)**, `src/client/TunnelClient.ts`(rejectUnauthorized 런타임 전용)
  - **변경 요약**: (a) `-save` 시 YAML dump에서 두 필드 삭제. (b) YAML 로드 시 해당 필드 발견하면 `logger.warn` + CLI `--yes-insecure` 부재 시 `process.exit(2)`. (c) `--yes-insecure`는 CLI 전용.
  - **files 필드 분리 근거 (H-3)**: 본 TASK는 **`ClientApp.ts`의 YAML 직렬화/게이트 블록만** 수정. `src/types/TunnelingOption.ts`는 P6-T3 전담(중복 없음).
  - **test (Mock 금지)**: `test/unit/client/req-02-insecure-tls-yaml.test.ts` — 실 fs/실 yaml 파서/`child_process.spawn` 3케이스.
  - **DoD**: ① 녹색, ② `client.yaml` 금지 필드 부재 스냅샷, ③ exit code/stderr 고정.

- **P3-T4 — 인증 문자열 비교 전수 `timingSafeStringEqual` 교체**
  - **REQ**: REQ-04
  - **파일**: `src/server/TunnelServer.ts`, `src/server/IdentityRegistry.ts`, `src/server/TunnelHandshakePolicy.ts`, `src/server/admin/SessionStore.ts`, `src/server/admin/AdminServer.ts`
  - **변경 요약**: `proof/authKey/token/secret/bindingToken/challengeNonce/hmac` 비교 연산자를 헬퍼 호출로 교체. 상단 import 추가.
  - **test (Mock 금지)**: `test/unit/server/req-04-constant-time-compare.test.ts` — 정적 grep 0건 + 실 net 소켓 의미론 동등 + 마이크로벤치 편향 < 5%.
  - **DoD**: ① `reports/req-04-grep.json` 0건, ② 녹색, ③ import 존재 확인.

- **P3-T5 — Admin cert hot-apply (`setSecureContext`)**
  - **REQ**: REQ-08
  - **파일**: `src/server/admin/AdminServer.ts`, `src/server/TTTServer.ts`(외부 TLS 포트)
  - **변경 요약**: 생성자에서 `this._tlsOptions = createServerTlsOptions(...)` 보존. `onUpdateAdminCert` 성공 시 `(this._server as https.Server).setSecureContext({ key, cert, ca })`. cipher/minVersion/maxVersion은 P3-T2 factory 재호출로 일관성. 외부 TLS 포트에도 동일 경로 노출.
  - **test (Mock 금지)**: `test/e2e/req-08-admin-cert-hot-swap.test.ts` — node-forge 셀프사인 CA 3개 순차 교체, 실 `tls.connect`로 fingerprint 3회 변화, PID/포트 동일.
  - **DoD**: ① 녹색, ② 동일 PID/포트 유지, ③ `setSecureContext` grep ≥ 1건.

**Phase 3 DoD**: `npm test -- --testPathPattern="req-(01|02|04|08)"` 녹색 + `npm run build` 성공 + **`node deploy.js` 재빌드 후** `node scripts/smoke.mjs` exit 0 (H-5 반영).

---

### Phase 4 — HTTP 프로토콜 축 (REQ-05/06/10/13)

**선행조건**: Phase 1 (병렬 가능, 권장 순서는 Phase 3 뒤).

**Tasks**:

- **P4-T1 — CL/TE 공존 거부 + TE 경로 CL strip**
  - **REQ**: REQ-05
  - **파일**: `src/server/http/HttpPipe.ts`
  - **변경 요약**: CL+TE 공존 → 400, TE만 → CL 헤더 제거, TE가 chunked 아닌 값 → 501.
  - **test (Mock 금지)**: `test/security/req-05-cl-te-smuggling.test.ts` — 실 http+실 net 3케이스 + 하류 echo 서버 smuggled 요청 미도달.
  - **DoD**: ① 녹색, ② 하류 accept 0건, ③ CL 부재 스냅샷.

- **P4-T2 — 헤더/path CRLF·NUL·obs-fold 차단 + splitting 방지**
  - **REQ**: REQ-06, REQ-10
  - **파일**: `src/server/http/HttpPipe.ts`, `src/server/http/HttpUtil.ts`
  - **변경 요약**: 헤더 name RFC 7230 token regex, value/path `\r\n\0` → 400, obs-fold 제거, `rewriteHostInTextBody` 치환 결과 CRLF 재검사.
  - **test (Mock 금지)**: `test/security/req-06-crlf-injection.test.ts` — REQ-06과 REQ-10을 통합 검증하는 단일 파일로 정정(라운드 5, F-P4-01 반영: 까칠 리뷰어 원칙 "계획을 고쳐라"). 총 7 케이스(원 계획 6→테스트 7로 상향).
  - **DoD**: ① 녹색, ② `reports/req-06-resplit-scan.json` 0건, ③ obs-fold 허용 로직 grep 0건(throw/주석 차단 문구는 허용).

- **P4-T3 — Chunked size 엄격 파싱**
  - **REQ**: REQ-13
  - **파일**: `src/server/http/HttpPipe.ts`
  - **변경 요약**: `parseInt` 전에 `/^[0-9a-fA-F]+$/` 검증, 음수/`+`/`0x`/공백/overflow 거부.
  - **test (Mock 금지)**: `test/security/req-13-chunked-parse.test.ts` — 6케이스(실 파일명 정정, 라운드 5 F-P4-01).
  - **DoD**: ① 녹색, ② 해당 함수(readChunkedSize)의 valid-input 분기 lcov 100%. 정규식 `^[0-9a-fA-F]+$`이 NaN/음수를 선검증하므로 방어적 isNaN/음수 가드는 dead branch로 분류·제거됨(라운드 5 F-P4-02). 제거 사유는 소스 주석에 기록.

**Phase 4 DoD**: `npm run build` exit 0 → `npm test -- --testPathPattern="req-(05|06|10|13)"` 녹색 + HTTP 터널 경로 수동 회귀 무결.

---

### Phase 5 — Admin API 축 (REQ-03/07/11/12/18/19)

**선행조건**: Phase 1, 2.

**Tasks**:

- **P5-T1 — `serverOptionHash` 인증·CORS·원본 보존**
  - **REQ**: REQ-03
  - **파일**: `src/server/admin/AdminServer.ts`, `src/util/ObjectUtil.ts`
  - **변경 요약**: `checkSession` 추가, CORS는 자기 호스트 화이트리스트, `Vary: Origin` 항상 부착, `cloneDeep` 후 `delete cloned.tunnelingOptions`.
  - **test (Mock 금지)**: `test/e2e/req-03-server-option-hash.test.ts` — 4케이스.
  - **DoD**: ① 녹색, ② `tunnelingOptions` 상태 보존 스냅샷, ③ `delete pureServerOption` grep 0건.

- **P5-T2 — 로그인 레이트리밋 키 재설계 + XFF 정책**
  - **REQ**: REQ-07
  - **파일**: `src/server/admin/AdminServer.ts`, `src/server/AdminSecurityPolicy.ts`, **`src/server/admin/loginBackoff.ts` (신설, M-2)**
  - **변경 요약**: (a) 실패 키 = `${account}|${networkBucket(ip)}` (IPv4 /24, IPv6 /64). (b) **지수 지연 계산을 순수 함수로 분리** — `computeBackoffMs(failCount: number): number = Math.min(Math.pow(2, failCount)*100, 5000)`. AdminServer는 이 함수 반환값으로 `setTimeout`. (c) LRU 10k. (d) `trustXForwardedFor: boolean`(기본 false).
  - **test (Mock 금지)**: `test/unit/server/req-07-login-backoff.test.ts` (신규, 순수 함수 검증) — `computeBackoffMs(0)=100`, `(5)=3200`, `(10)=5000` 경계값 확정. `test/e2e/req-07-login-rate-limit.test.ts` — 4케이스 중 지연 실측은 **하한만**(`≥ 400ms`) 확인(플래키 제거).
  - **DoD**: ① 두 테스트 녹색, ② `reports/req-07-lru.json`, ③ `trustXForwardedFor` 기본 false 확인, ④ `loginBackoff.ts` 순수 함수로 분리(side effect 없음 grep).

- **P5-T3 — JSON 본문 크기·타임아웃 제한**
  - **REQ**: REQ-11
  - **파일**: `src/server/admin/AdminServer.ts`
  - **변경 요약**: `readJson maxBytes=1<<20` (413 + socket destroy), `req.setTimeout(10_000)` (408), `server.headersTimeout=15_000`, `server.requestTimeout=30_000`, JSON parse 실패 400.
  - **test (Mock 금지)**: `test/security/req-11-body-limit.test.ts` — 4케이스.
  - **DoD**: ① 녹색, ② 타임아웃 값 런타임 스냅샷.

- **P5-T4 — 상태변경 API CSRF + Origin 검증**
  - **REQ**: REQ-12
  - **파일**: `src/server/admin/AdminServer.ts`, `src/server/AdminSecurityPolicy.ts`
  - **변경 요약**: POST/PUT/DELETE에 Origin 화이트리스트 검증. 세션 발급 시 `X-CSRF-Token` 쿠키(`Secure; SameSite=Strict`) + 클라이언트 헤더 double-submit, `timingSafeStringEqual`로 비교. `AdminSecurityPolicy.requireCsrfHeader`(기본 true).
  - **test (Mock 금지)**: `test/e2e/req-12-csrf-origin.test.ts` — 4케이스. **추가 자동화 (L-4)**: P7-T3 smoke에 CORS/CSRF 헤더 체크 포함.
  - **DoD**: ① 녹색, ② legacy http 경로 확인 스냅샷, ③ smoke 자동 체크 통과(P7-T3와 통합).

- **P5-T5 — `onGetWebResource` Windows 경로 정규화**
  - **REQ**: REQ-18
  - **파일**: `src/server/admin/AdminServer.ts`
  - **변경 요약**: `path.resolve` + `toLowerCase` + sep 정규화, `path.relative(webroot, realPath)`로 `..` escape 차단.
  - **test (Mock 금지)**: `test/unit/server/req-18-path-normalization.test.ts` — 4케이스(플랫폼 분기 명시).
  - **DoD**: ① 녹색, ② escape 차단 스냅샷.

- **P5-T6 — `listen` error 리스너 누적 방지 (H-1/H-4)**
  - **REQ**: REQ-19
  - **파일**: `src/server/admin/AdminServer.ts`
  - **변경 요약**:
    - 생성자에서 **영구 error 핸들러를 named function으로 등록·참조 보존**: `private _permanentErrorHandler = (err) => {...}; this._server.on('error', this._permanentErrorHandler);`.
    - `listen()` 내 `listening`은 `once`, **listen 전용 error 핸들러는 별도 named 함수로 `once`/`on`**, 성공 또는 실패 직후 `this._server.removeListener('error', listenErrorHandler)` 호출.
    - **`removeAllListeners` 사용 금지** (영구 핸들러 말소 방지 — H-4 핵심). 오직 `removeListener(named)`.
  - **test (Mock 금지)**: `test/unit/server/req-19-listen-listeners.test.ts` — 실 포트 충돌 유발로 10회 `listen` 반복 후
    1. `_server.listeners('error').length <= 1` 확인 (SPEC REQ-19 수치 — H-1).
    2. `_server.listeners('error').length >= 1` 확인 (영구 핸들러 보존 — H-4).
    3. 영구 핸들러 참조가 동일(함수 identity `===`) 확인(removeAllListeners 미사용 증거).
  - **DoD**: ① `error` 리스너 개수 = **1건 (운영 영구 핸들러만; listen 임시 핸들러는 성공/실패 직후 제거)** — H-1 수치 일치, ② 영구 핸들러 identity 보존 확인, ③ heap 선형 증가 없음은 **권고(optional)** — DoD 필수 아님 (L-2).

**Phase 5 DoD**: `npm test -- --testPathPattern="req-(03|07|11|12|18|19)"` 녹색 + **`node deploy.js` 재빌드 후** `node scripts/smoke.mjs` exit 0 (H-5).

---

### Phase 6 — 세션·풀 수명주기 축 (REQ-09/14/15/16)

**선행조건**: Phase 1, 3 (REQ-09 검증에 P3-T4/T5의 보안 기반 필요). **P6-T4는 depends_on=["P1"]로 단축 (H-3) — 순수 단위 테스트.**

**Tasks**:

- **P6-T1 — Pool swap · waitBuffer · 좀비 세션 양방향 close 계약**
  - **REQ**: REQ-09
  - **파일**: `src/client/TTTClient.ts`, `src/client/EndPointClientPool.ts`, `src/client/TunnelClient.ts`, `src/server/TunnelServer.ts`, `src/server/TTTServer.ts`, `src/server/IdentityRegistry.ts`
  - **변경 요약**: (a) 구 Pool callback nulling → `destroy()` + orphan close 일괄 통보. (b) `_waitBufferQueueMap` Initializing 진입 직후 선할당. (c) 서버 `closeSession` 부활, send 실패 시 즉시 호출. (d) session-TTL + heartbeat (60s 초기값).
  - **test (Mock 금지)**: `test/e2e/req-09-pool-swap-zombie.test.ts` — **4케이스 (M-3 반영)**:
    1. Ctrl 재연결 50회 → 서버 `sessionCount` 1초 내 0 수렴.
    2. echo-first 업스트림 1000건 초기 바이트 손실 0.
    3. heartbeat 중단 후 TTL 초과 → 서버 close 통지.
    4. **(M-3 신규)** 이미 close된 세션 ID에 대한 orphan close 재통보 수신 시 현재 활성 세션(다른 ID) 무영향 확인.
  - **DoD**: ① 4종 녹색, ② `reports/req-09-sessions.csv`, ③ `closeSession` 주석 아닌 호출 grep.

- **P6-T2 — `TunnelClient.connectDataHandler` race 해소**
  - **REQ**: REQ-14
  - **파일**: `src/client/TunnelClient.ts`
  - **변경 요약**: `SocketHandler.connect` 전에 `handlerID/sessionID/bindingToken` 주입 또는 Connected 콜백 지연.
  - **test (Mock 금지)**: `test/unit/client/req-14-connect-race.test.ts` — 실 `net.createServer` 즉시 accept 100회 반복, `handler.handlerID !== undefined` 100%.
  - **DoD**: ① 녹색, ② race 재현 시드 주석.

- **P6-T3 — 클라이언트 옵션 범위 검증 공통화 (H-3 파일 경계)**
  - **REQ**: REQ-15
  - **파일**: **`src/types/TunnelingOption.ts` (normalizationClientOption 본체 — 전용)**, `src/client/ClientApp.ts`(**호출부 치환만**; 인라인 범위 검증 로직 제거)
  - **변경 요약**: `normalizationClientOption`에 port 1~65535, keepAlive > 0, globalMemCacheLimit >= 16 범위 검증 추가, 실패 시 기본값 폴백(port=9999, keepAlive=60000, memCache=128) + `logger.warn`. `ClientApp.ts`는 기존 인라인 검증 제거 + `normalizationClientOption` 호출만 유지. **P3-T3와 **파일 중첩은 있으나 수정 라인 영역이 다름** — ClientApp.ts에서 P3-T3는 YAML 저장/로드 게이트 블록, P6-T3는 옵션 정규화 호출부만 수정. 코딩 단계에서 라인 경계를 명시적으로 분리할 것(리스크 R10 참조).**
  - **test (Mock 금지)**: `test/unit/client/req-15-option-range.test.ts` — 4케이스.
  - **DoD**: ① 녹색, ② ClientApp.ts 인라인 범위 검증 제거 grep 확인 (`rg "port.*<=.*0|port.*>.*65535" src/client/ClientApp.ts` 0건).

- **P6-T4 — `SessionStore.isSessionValid` 비동기 안전성 + Cookie 파싱 (depends_on=["P1"] — H-3)**
  - **REQ**: REQ-16
  - **파일**: `src/server/admin/SessionStore.ts`
  - **변경 요약**: `forEach` → `for...of`. Cookie 파싱 `split('=')` → `indexOf('=')` 기반.
  - **test (Mock 금지)**: `test/unit/server/req-16-cookie-parse.test.ts` — 순수 단위 4케이스.
  - **DoD**: ① 녹색, ② `.forEach` grep 0건.

**Phase 6 DoD**: `npm test -- --testPathPattern="req-(09|14|15|16)"` 녹색 + 50회 재접속 좀비 0 수렴 관찰.

---

### Phase 7 — 관찰·배포·이월 마감 (REQ-17/21/22)

**선행조건**: Phase 1~6.

**Tasks**:

- **P7-T1 — `trustedClients` canonical 비교**
  - **REQ**: REQ-17
  - **파일**: `src/server/TTTServer.ts`, `src/server/admin/AdminServer.ts`, `src/util/ObjectUtil.ts`
  - **변경 요약**: `JSON.stringify` 비교 → `ObjectUtil.equalsDeep` (키 정렬 기반).
  - **test (Mock 금지)**: `test/unit/server/req-17-trusted-clients-canonical.test.ts` — 순수 3케이스.
  - **DoD**: ① 녹색, ② `rg "JSON.stringify.*trustedClients"` 0건.

- **P7-T2 — 린트 규칙 error 승격**
  - **REQ**: REQ-21 (최종 마감)
  - **파일**: `.eslintrc.cjs`, `scripts/lint-auth-compare.mjs`, `reports/auth-compare.json`
  - **변경 요약**: P1-T2의 warn → **error** 승격. 본 라운드 소스 위반 0건 확인.
  - **test (Mock 금지)**: `test/unit/tools/req-21-lint-error.test.ts` — 2케이스(위반 exit≠0 / 클린 exit 0).
  - **DoD**: ① 녹색, ② `npm run lint` exit 0 (error 0건), ③ `reports/auth-compare.json` 위반 0건 스냅샷.

- **P7-T3 — 배포 스모크 확장 (자동 체크 포함 — L-4)**
  - **REQ**: REQ-22
  - **파일**: `scripts/smoke.mjs`, `package.json`
  - **변경 요약**: Phase 1 smoke에 자동 체크 추가 —
    (a) `/api/serverOptionHash` 세션 없이 401,
    (b) 크로스 오리진 POST (CSRF 누락) 403,
    (c) admin cert hot-swap 1회 후 fingerprint 변화,
    (d) CL/TE smuggling 페이로드 1건 거부,
    (e) **(L-4)** `/api/serverOption` GET 응답 헤더 `Vary: Origin` 존재 + 자기 호스트 Origin만 `Access-Control-Allow-Origin` 노출 자동 검증.
    총 실행 시간 < 30s.
  - **test (Mock 금지)**: 스크립트 자체가 실환경 검증.
  - **DoD**: ① `npm run smoke` exit 0, ② 5체크 `ok` 로그, ③ 소요 < 30s.

**Phase 7 DoD**: 전체 `npm test` 녹색 + **`node deploy.js` 재빌드 후** `npm run smoke` exit 0 + `npm run build` 성공 (H-5).

---

## 5. 스펙 매핑 표 (REQ ↔ TASK, 커버리지 100%)

| REQ-ID | 우선순위 | 제목(축약) | 매핑 TASK |
|---|---|---|---|
| REQ-01 | P0 | 토큰 `crypto.randomBytes`화 | P2-T2, P3-T1 |
| REQ-02 | P0 | insecure YAML 금지 + TLS 강화 | P3-T2, P3-T3 |
| REQ-03 | P0 | serverOptionHash 인증·CORS·원본 보존 | P5-T1 |
| REQ-04 | P1 | `timingSafeEqual` 통일 | P2-T1, P3-T4 |
| REQ-05 | P1 | CL/TE smuggling 거부 | P4-T1 |
| REQ-06 | P1 | 헤더 CRLF/NUL + obs-fold 제거 | P4-T2 |
| REQ-07 | P1 | 로그인 레이트리밋 키 개편 | P5-T2 |
| REQ-08 | P1 | Admin cert hot-apply | P3-T5 |
| REQ-09 | P1 | Pool swap/waitBuffer/좀비 세션 | P6-T1 |
| REQ-10 | P1 | response splitting 방지 | P4-T2 |
| REQ-11 | P2 | JSON 본문·타임아웃 제한 | P5-T3 |
| REQ-12 | P2 | CSRF·Origin 검증 | P5-T4 |
| REQ-13 | P2 | chunked size 엄격 | P4-T3 |
| REQ-14 | P2 | connectDataHandler race | P6-T2 |
| REQ-15 | P2 | 클라이언트 옵션 범위 공통화 | P6-T3 |
| REQ-16 | P2 | SessionStore + Cookie 파싱 | P6-T4 |
| REQ-17 | P3 | trustedClients canonical 비교 | P7-T1 |
| REQ-18 | P2 | onGetWebResource 경로 정규화 | P5-T5 |
| REQ-19 | P2 | listen error 리스너 누적 | P5-T6 |
| REQ-20 | P3 | Jest 인프라 가동 + 커버리지 | P1-T1 |
| REQ-21 | P3 | timingSafeStringEqual 린트 규칙 | P1-T2, P2-T1, P7-T2 |
| REQ-22 | P3 | 배포 스모크 스크립트 | P1-T3, P7-T3 |

**자기 검증**: REQ-01~REQ-22 총 22건, 모두 1개 이상 TASK에 매핑 — **커버리지 22/22 = 100%**.

---

## 6. 리스크 및 완화

| # | 리스크 | 영향 | 완화 |
|---|---|---|---|
| R1 | TLS 1.2 최소화로 레거시 클라이언트/OS 호환 중단 | 현장 장애 | CHANGELOG breaking 표기, `allowLegacyFallback` CLI-only, smoke에 TLS 1.2/1.3 각각 확인. |
| R2 | `setSecureContext` Node/pkg 타겟 차이(arm64/alpine) | hot-swap 실패 | smoke를 최소 2개 pkg 타겟에서 수동 실행, 실패 시 restart 폴백. |
| R3 | CSRF 강제로 admin SPA 호환 깨짐 | 로그인 불가 | `admin/` touch 금지, SPA는 동오리진 fetch 유지, P5-T4 + P7-T3 smoke 자동 체크. |
| R4 | ~~지수 지연 실측 플래키~~ (M-2 해결) | - | 순수 함수 `computeBackoffMs` 분리 + 통합 테스트는 하한만 확인. |
| R5 | `closeSession` 부활이 정상 재접속 race와 충돌 | 정상 세션 종료 | P6-T1 회귀 시나리오에 정상 재접속 + M-3 negative 테스트 포함. session-TTL 보수값(60s). |
| R6 | ESLint false positive | DX 저하 | warn→error 단계 승격, 정규식 식별자 기반 좁게 유지, disable 주석 허용. |
| R7 | `ObjectUtil.cloneDeep`/`equalsDeep` 부재 또는 순환 미지원 | 런타임 예외 | P3 착수 전 실 구현 확인, 필요 시 `lodash`(이미 존재) 활용. |
| R8 | SPEC 약식 경로 vs 실제 경로 불일치 | 잘못된 수정 | §1.2 매핑 표 명시, TASK files 필드는 실제 경로만. |
| **R9 (M-4 신규)** | **`selfsigned` 패키지 부재** | **인증서 생성 차단** | `package.json`에 **`node-forge ^1.3.1` 이미 존재** 확인 — 이를 사용해 테스트 인증서 동적 생성. 추가 의존 도입 금지. 대안으로 `test/helpers/fixtures/*.pem` 사전 생성 파일 폴백 제공(P3-T2/T5 공용 헬퍼). |
| **R10 (라운드 3 신규)** | **P3-T3/P6-T3 `src/client/ClientApp.ts` 라인 중첩** | 머지 충돌·회귀 | 코딩 단계에서 라인 경계를 명시적으로 분리. P3-T3는 YAML 저장/로드 게이트 블록만, P6-T3는 옵션 정규화 호출부만 수정. PR을 두 Phase에 따라 분리 커밋 + diff 기반 교차 검토. |

---

## 7. 메타

- **mode**: Normal
- **planner**: Opus × 1 (시니어 플래너)
- **evaluator**: Sonnet × 2 병렬
- **severity-gate (구조화 — L-1)**:
  - `phase_1`: "CRITICAL=0 AND HIGH=0"
  - `phase_2`: "MEDIUM converging"
  - `phase_3`: "LOW allowed"
- **라운드**: 2 (라운드 1 평가 FAIL → HIGH 5/MEDIUM 5/LOW 4건 모두 반영)
- **Vision**: off
- **SPEC 경로**: `docs/srs/backend-remediation-round1.md` (본문 비수정, §1 오버라이드 문단으로 경로 조정)
- **산출물**: 본 `.md` + 동일 경로 `.json`
- **후속**: REQ-23(commons/util/types 잔여), REQ-24(admin/ 프론트엔드)는 별도 라운드.
