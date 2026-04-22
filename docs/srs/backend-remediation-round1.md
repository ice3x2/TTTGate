# SRS — TTTGate 백엔드 결함 제거 라운드 1

- **문서 종류**: 연구문서 유래 SRS(백엔드 정적 분석 결과 기반)
- **작성일**: 2026-04-21
- **범위**: `src/server/`, `src/client/`, `src/commons/`, `src/util/`, `src/types/`, `src/app.ts`
- **제외**: `admin/` 프론트엔드 (별도 라운드), `src/commons/`·`src/util/`·`src/types/` 중 이번 라운드 미분석분 (후속 이월: REQ-23)
- **근거 보고**: 팀원 4명 분석 회의록 (한결 S-01~S-07, 노을 C-01~C-05, 가드 SEC-01~SEC-10)
- **목표**: P0(Critical)부터 P3(Low)까지 **모두 해결**. ZERO TOLERANCE 스펙-계획 일치 게이트 적용.

---

## 1. 개요

TTTGate는 NAT 뒤의 내부 네트워크를 외부 서버로 노출하는 터널링 도구다. 본 SRS는 최근 `refactor/safecode` 브랜치의 백엔드 구조·보안·안정성 정적 분석에서 발견된 22건의 결함을 요구사항으로 정규화한 것이다. 22건 전부를 이번 라운드에서 해결하는 것이 목표다.

---

## 2. 선행 조건

- 기준 커밋: `refactor/safecode` HEAD (`258c057`)
- Node.js 18+, TypeScript 5.1+
- 변경은 **백엔드만**. admin/ 프론트엔드는 touch 금지 (단, 백엔드 API 스펙이 바뀌면 호환 유지 확인은 필요)
- 테스트: Jest 설정 존재하나 테스트 파일 없음 — **이번 라운드에서 새로 작성**. Mock 금지 (요구사항별 DoD는 실제 코드 경로/런타임 검증으로 측정)

---

## 3. 요구사항

### P0 — Critical (즉시)

#### REQ-01 — 핸드셰이크/바인딩 토큰을 `crypto.randomBytes`로 교체
- **근거**: SEC-01. `src/commons/ProtocolV2.ts:49-56` `createOpaqueToken`이 `ClockRngProvider.current().random()` → 기본값 `src/util/ClockRng.ts:11` `Math.random()`.
- **현상**: v2 프로토콜의 `challengeNonce`(HMAC 입력, 리플레이 방지)와 `IdentityRegistry.issueBindingToken`의 토큰이 예측 가능.
- **요구사항**: `createOpaqueToken`과 `ClockRng`의 토큰용 경로를 `crypto.randomBytes`로 대체. 단 성능 민감한 지터 계산용은 분리 유지. `SessionStore.newSession`(`src/server/SessionStore.ts:78`)의 패턴 재사용.
- **검증**: `createOpaqueToken`이 `crypto.randomBytes`를 호출하는지 정적 검사 + 생성 토큰 1만 개 샘플의 엔트로피 측정(치첨 분포) + `IdentityRegistry.issueBindingToken`의 토큰이 동일 입력에 대해 매번 달라지는 단위 테스트.

#### REQ-02 — `allowInsecureTls`/`allowLegacyFallback` YAML 저장 금지 + TLS 설정 강화
- **근거**: C-01 + SEC-03 통합.
- **현상**:
  - `src/client/TunnelClient.ts:121`·`src/client/ClientApp.ts:140/156-160`에서 `allowInsecureTls`가 `rejectUnauthorized`를 즉시 끄고, `-save` 시 `client.yaml`에 평문 영속화.
  - `src/util/TlsOptionsFactory.ts:52` `secureProtocol: "TLSv1_2_server_method"`로 TLS 1.3 차단 + cipher/minVersion/maxVersion 미설정.
- **요구사항**:
  - `allowInsecureTls`, `allowLegacyFallback`는 **CLI/env 인자로만** 허용. YAML 저장 시 해당 필드를 기록하지 않음.
  - YAML 로드 시 해당 필드가 발견되면 WARN 로그 + `--yes-insecure` 플래그 없으면 프로세스 시작 거부.
  - `TlsOptionsFactory`에서 `secureProtocol` 제거 후 `minVersion: 'TLSv1.2'`, `maxVersion: 'TLSv1.3'`, ECDHE-AEAD 화이트리스트 cipher, `honorCipherOrder: true` 적용.
- **검증**: (a) YAML 저장 후 파일 내 `allowInsecureTls` 문자열 부재 확인 (b) `--yes-insecure` 없이 insecure 옵션 로드 시 exit code ≠ 0 (c) TLS 1.0/1.1/약한 cipher로 handshake 시도 시 거부 단위 테스트.

#### REQ-03 — `/api/serverOptionHash` 인증·Origin 반사·원본 파괴 delete 수정
- **근거**: SEC-05 + S-04 + S-03 통합.
- **현상**: `src/server/AdminServer.ts:824-833` `onGetServerOptionHash`는 `checkSession` 없이 응답, `Access-Control-Allow-Origin`에 요청 Origin 반사, `Vary: Origin` 누락. 추가로 `onGetServerOption`(767-774)가 스토어의 **원본 객체**에서 `delete pureServerOption['tunnelingOptions']` 수행 → 런타임 상태 파괴.
- **요구사항**:
  - `onGetServerOptionHash`에 `checkSession` 호출 추가.
  - `Access-Control-Allow-Origin`은 자기 호스트(리슨 URL) 화이트리스트만 허용. `Vary: Origin` 헤더 추가.
  - `onGetServerOption`/`onGetServerOptionHash`는 `ObjectUtil.cloneDeep`로 복제한 뒤 `delete`.
- **검증**: 세션 쿠키 없이 `/api/serverOptionHash` 호출 시 401/403, 임의 Origin 요청 시 CORS 헤더 미노출, 두 엔드포인트 연속 호출 후 `ServerOptionStore.instance.serverOption.tunnelingOptions`가 그대로 보존되는 통합 테스트.

### P1 — High

#### REQ-04 — 인증 관련 문자열 비교 `timingSafeEqual` 통일
- **근거**: SEC-02 + D 합의.
- **현상**: `src/server/TunnelServer.ts:581`(proof `!==`), `:607`(legacy authKey `!=`) 등 일반 비교.
- **요구사항**: `src/util/` 신규 헬퍼 `timingSafeStringEqual(a, b, encoding?)` 추가(길이 선검증 + `Buffer.from` 정규화 + `crypto.timingSafeEqual`). proof, legacy authKey, 기타 인증/토큰/해시 문자열 비교 전수 교체.
- **검증**: `TunnelServer.ts` 내 인증 관련 문자열 비교 연산자 `!==`/`!=`/`===`/`==` 0건 정적 검사 + 동일 길이 0/1 차이 문자열에 대한 상수 시간성 마이크로벤치(편향 < 5%).

#### REQ-05 — HTTP Request Smuggling 방어 (CL/TE 충돌 거부)
- **근거**: SEC-08.
- **현상**: `src/commons/HttpPipe.ts:291-307` `findAndSetLengthValue`가 Content-Length와 Transfer-Encoding 공존 시 chunked 우선 후 CL 헤더를 그대로 하류로 전달.
- **요구사항**: CL+TE 공존 시 RFC 7230 §3.3.3에 따라 400 Bad Request 반환. TE 처리 경로에선 CL 헤더 strip 강제.
- **검증**: 재현 페이로드(CL: 4\r\nTE: chunked)에 대한 통합 테스트 → 400 응답 + 하류 소켓에 요청 유입 없음 확인.

#### REQ-06 — HTTP 헤더 CRLF/NUL 인젝션 차단 + obs-fold 제거
- **근거**: SEC-09.
- **현상**: `HttpPipe.ts:707-710` header name/value `trim()`만, `:623` path split만. `HttpUtil.ts:15-35` 재직렬화 시 value의 CR/LF 통과. `HttpPipe.ts:694` obs-fold(multi-line continuation) 수용.
- **요구사항**: header name은 RFC 7230 token 정규식(`/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/`)만 허용. value는 `\r`/`\n`/`\0` 발견 시 400 거부. path도 동일 검사. obs-fold 수용 코드 제거.
- **검증**: CRLF 포함 헤더 페이로드로 400 반환 테스트 + 재직렬화 결과 문자열에 `\r\n` 외 위치의 `\r`/`\n` 0건 정적 검사.

#### REQ-07 — 로그인 레이트리밋 키 설계 개편
- **근거**: SEC-04 + S-06.
- **현상**: `AdminServer.ts:944/947-964`가 `req.socket.remoteAddress`만 키로 사용. NAT 공유 환경 정당 사용자 DoS + IPv6 임시주소 우회.
- **요구사항**: 실패 카운터 키 = `account + network-bucket` (IPv4 /24, IPv6 /64). 글로벌 실패 누적 시 지수 지연. 맵 LRU 상한(예: 10k). XFF 신뢰 정책을 `AdminSecurityPolicy`에 명시 플래그로 편입(`trustXForwardedFor`, 기본 false).
- **검증**: (a) 동일 NAT에서 정당 계정 로그인 성공 중 다른 계정 5회 실패해도 정당 계정 잠김 없음 (b) XFF 신뢰 off 상태에서 XFF 헤더 무시 (c) 맵 크기 상한 초과 시 LRU 축출 테스트.

#### REQ-08 — Admin 인증서 hot-apply (`setSecureContext`) 적용
- **근거**: S-02.
- **현상**: `AdminServer.ts:252-266` `onUpdateAdminCert`가 certStore 저장만 하고 https 서버 컨텍스트 교체 없음 → "저장 성공" 오인.
- **요구사항**: 생성자 `options`를 필드에 보존. `onUpdateAdminCert` 성공 경로에서 `(this._server as https.Server).setSecureContext({key, cert, ca?})` 호출. 빈 CA 제외 로직 유지. 외부 TLS 포트(`tls.Server`)에도 동일 적용. TLS→HTTP 전환은 기존 restart 예약 유지. REQ-02의 cipher/minVersion도 이 지점에서 함께 적용(일관성).
- **검증**: 동일 admin 인스턴스에 인증서 두 번 교체 후 새 handshake가 새 cert를 제시하는 통합 테스트(openssl s_client).

#### REQ-09 — Pool swap / waitBuffer / 좀비 세션 — 양방향 close 계약 감사
- **근거**: C-02 + C-04 + S-05 통합.
- **현상 3축**:
  1. `TTTClient.ts:32-46/62-68` EndPointClientPool swap 시 구 Pool의 callback=null → 잔여 소켓의 end/close가 서버로 전파되지 않음.
  2. `TunnelClient.ts:569-591` `writeWaitBuffer`가 `_waitBufferQueueMap` 부재 시 silent false → 초기 바이트 drop.
  3. `TunnelServer.ts:534-540` + `TTTServer.ts:144-148` send 실패 시 `closeSession` 주석 처리 → 좀비 세션.
- **요구사항**:
  - Pool swap 계약: 구 Pool은 잔여 소켓 강제 `destroy()` + 새 Ctrl 연결 수립 직후 "orphan close" 일괄 통보(recover 단계).
  - `_waitBufferQueueMap`은 `connectDataHandler` Initializing 진입 시(`TunnelClient.ts:385`) 선할당.
  - 서버 `closeSession` 경로 활성화 + session-TTL/heartbeat 폴백(무응답 N초 초과 시 서버측 강제 종료).
- **검증**: (a) 고의 Ctrl 재연결 루프 후 서버 측 열린 세션 수가 0으로 수렴하는 통합 테스트 (b) 초기 바이트 prepend 프로토콜(간단한 echo-first 서버) 구동 시 첫 바이트 손실 0건.

#### REQ-10 — HTTP 헤더 CRLF 기반 response splitting 방지 (REQ-06 하위 검증 연계)
- **근거**: SEC-09 연계. (별도 REQ 유지 사유: 재작성 경로 `rewriteHostInTextBody` 등에서의 발생 방지 보장 필요)
- **요구사항**: `src/commons/HttpPipe.ts`의 `rewriteHostInTextBody` 및 응답 헤더 재작성 경로에서 value 치환 전 CRLF 검사. 치환 결과 문자열에 CRLF가 새로 생기는 경우 차단.
- **검증**: 악의적 호스트 치환 입력(`"\r\nX-Evil: 1"`)에 대한 차단 확인.

### P2 — Medium

#### REQ-11 — AdminServer JSON 본문 크기·타임아웃 제한
- **근거**: SEC-06.
- **요구사항**: `AdminServer.ts:740-754` `readJson`에 본문 상한 1MiB + `req.setTimeout(10_000)` + 서버 `headersTimeout: 15_000` / `requestTimeout: 30_000`.
- **검증**: 1MiB+1 body 요청 시 413 반환, 아이들 소켓 10초 후 타임아웃 발생 테스트.

#### REQ-12 — 상태 변경 API CSRF 토큰·Origin 검증
- **근거**: SEC-07.
- **요구사항**: 모든 POST/PUT/DELETE `/api/*`에 대해 Origin 헤더가 자기 호스트 화이트리스트에 있는지 검증. 불일치 시 403. 추가로 double-submit CSRF 쿠키/헤더(`X-CSRF-Token`) 검증 or 세션 설정 시 발급된 커스텀 토큰 요구. `allowLegacyAdminHttp` 경로에서 특히 필수.
- **검증**: 크로스 오리진 fetch 시 403 + 정상 동일 오리진 호출은 통과 통합 테스트.

#### REQ-13 — Chunked size parseInt 엄격화
- **근거**: SEC-10.
- **요구사항**: `HttpPipe.ts:469` `parseInt(sizeText, 16)` 전에 `/^[0-9a-fA-F]+$/` 정규식 검증. 불일치·음수·NaN → 400 거부.
- **검증**: `0xFF`, `-1`, `+FF` 입력에 대한 거부 테스트.

#### REQ-14 — `TunnelClient.connectDataHandler` race 해소
- **근거**: C-03.
- **요구사항**: `TunnelClient.ts:379-413` `SocketHandler.connect` 호출 **전에** `handlerID/sessionID/bindingToken` 주입(팩토리 인자 추가) 또는 `Initializing` 상태에서 Connected 콜백을 속성 완비 전까지 지연.
- **검증**: 동기 Connected 발행을 흉내낸 단위 테스트에서 `handler.handlerID`가 항상 정의되는지 확인.

#### REQ-15 — 클라이언트 옵션 범위 검증 공통화 (YAML 포함)
- **근거**: C-05.
- **요구사항**: `ClientApp.ts:29-39`의 CLI 전용 범위 검사를 `normalizationClientOption`에 공통화. port 1~65535, keepAlive 양수, globalMemCacheLimit 16 이상 등. 실패 시 기본값 폴백 + WARN.
- **검증**: `port: -1` YAML 로드 시 기본값으로 폴백하고 WARN 로그 포함되는 통합 테스트.

#### REQ-16 — `SessionStore.isSessionValid` 비동기 안전성 + Cookie 파싱 방어
- **근거**: S-07.
- **요구사항**: `SessionStore.ts:97-112` `forEach` 대신 `for...of` 사용(차후 await 확장 대비). Cookie 파싱은 `split('=')` → `indexOf('=')` 기반으로 변경(값에 `=` 포함 시에도 손상 없음).
- **검증**: `sid=abc=xy` 형태 쿠키에 대해 `abc=xy`를 정확히 추출하는 단위 테스트.

### P3 — Low

#### REQ-17 — `trustedClients` 변경 감지를 canonical 비교로 변경
- **근거**: S-01.
- **요구사항**: `TTTServer.ts:193`·`AdminServer.ts:361`의 `JSON.stringify` 비교를 `ObjectUtil.equalsDeep` 또는 키 정렬 후 구조 비교로 변경.
- **검증**: 키 순서만 다른 동일 배열에서 재시작 트리거되지 않는 단위 테스트.

### P2 보강 (한결 관찰 기반 추가)

#### REQ-18 — `AdminServer.onGetWebResource` 경로 정규화 재검증(Windows 대소문자/백슬래시)
- **근거**: 한결 추가 관찰.
- **요구사항**: `realPath.endsWith("index.html")` 및 `Path.relative` 사용을 Windows case-insensitive 파일 시스템 및 backslash 정규화에 맞게 보강. `Path.posix`·`toLowerCase()` 기반 비교.
- **검증**: `INDEX.HTML`, `index.html/`, backslash 섞인 경로에 대한 동작 일관성 테스트.

#### REQ-19 — `AdminServer.listen` 에러 리스너 누적 방지
- **근거**: 한결 추가 관찰.
- **요구사항**: `listening` 리스너 제거 시 `error` 리스너도 함께 `removeAllListeners('error')` 또는 `once` 패턴 사용.
- **검증**: 여러 번 `listen` 호출 후 `_server.listeners('error').length ≤ 1` 확인.

### P3 보강 — 테스트 인프라

#### REQ-20 — Jest 테스트 인프라 가동 + 최소 커버리지 0 → N%
- **현상**: Jest 설정만 있고 테스트 파일 0건.
- **요구사항**: 본 계획의 각 REQ 검증 테스트를 `tests/` 하위에 배치. `jest.config.js`에 ts-jest 설정, `npm test` 실제 통과. 목표 라인 커버리지: 수정 영역에 한해 60%+.
- **검증**: `npm test` 성공 + `--coverage` 보고서 생성.

#### REQ-21 — 공용 `timingSafeStringEqual` 헬퍼 문서화 및 사용처 린트 규칙
- **근거**: REQ-04 후행.
- **요구사항**: 신규 헬퍼의 JSDoc + 사용 지침. ESLint 커스텀 규칙(또는 `ripgrep` 기반 사전 커밋 훅)으로 `authKey`/`proof`/`token` 이름 변수의 `===`/`!==` 비교 검출 시 경고.
- **검증**: 사전 커밋 훅 실행 시 의도적 위반 라인에서 경고 발생.

#### REQ-22 — 배포 스모크 테스트 스크립트
- **요구사항**: `deploy.js` 이후 서버/클라이언트 바이너리 기동 → admin TLS handshake OK + ctrl 1개 세션 성립 → 자동 teardown 하는 `scripts/smoke.mjs` 추가.
- **검증**: CI 없이 로컬에서 `node scripts/smoke.mjs` exit code 0.

---

## 4. 범위 외 (후속 라운드)

- REQ-23: `src/commons/CtrlPacket.ts`, `DataStatePacket.ts`, `CACertGenerator.ts`, `SysMonitor.ts`, `src/util/` 잔여, `src/types/`, `src/Environment.ts`, `src/Sentinel.ts` 프로토콜 정합성·메모리·로깅 분석 (도윤 이월).
- REQ-24: `admin/` 프론트엔드 {@html} XSS, 클라이언트 해시, CSRF, 개인키 JSON 전송 등 (도윤 선행 U-01~U-05 보유).

---

## 5. 테스트 원칙 (본 라운드 전체에 적용, 우선순위 규칙)

아래 원칙은 **모든 REQ의 검증 절차에 공통으로 적용**된다. 개별 REQ의 "검증" 항목은 이 원칙을 따른다.

### 5.1 핵심 원칙

1. **Mock 금지 (NO-MOCK)**
   - 테스트 더블(`jest.mock`, `sinon.stub`, 수동 mock 객체, `nock`·`msw` 등 HTTP mocker)은 **전면 금지**.
   - 외부 의존(TLS handshake, HTTP 파서, 소켓, 파일시스템, 인증서)은 **실제 구현**을 사용한다.
   - 대안: `net.createServer` + ephemeral 포트 페어, `tls.createSecureContext` + 테스트 전용 CA, `fs` 임시 디렉터리(`tmp-promise`).

2. **실환경 재현 (LIVE-PROCESS)**
   - 본 프로젝트는 프로토콜·소켓·인증서가 본질. 테스트는 **실제 프로세스 경계**를 가진 통합 테스트를 기본으로 한다.
   - 서버/클라이언트 동시 기동 시나리오는 `child_process.spawn`으로 실행하여 종단간 검증.
   - 단위 테스트는 순수 함수(파서, 정규화, 인코딩)에만 허용.

3. **결정성 (DETERMINISM)**
   - `Math.random`, `Date.now`에 테스트가 의존하지 않도록 한다. 필요 시 **의존성 주입**으로 교체(실제 `crypto.randomBytes` 사용 여부 자체가 검증 대상인 REQ-01은 예외).
   - 포트는 모두 `0` 바인딩 후 실제 할당 포트를 읽어 사용.
   - 타임아웃에 의존하는 테스트는 시간 가속/가짜 타이머 대신 **짧고 결정적인 실제 대기**(수백 ms 이하)를 사용.

4. **근거 있는 통과 (EVIDENCE-BASED DOD)**
   - 각 REQ의 DoD(Definition of Done)는 **실행 가능하고 측정 가능**해야 한다("동작한다"는 서술은 실패 판정).
   - 통과 근거로 다음 중 하나 이상을 반드시 제출: (a) `npm test -- --testPathPattern=req-XX` 녹색, (b) 정적 검사 리포트(grep/ESLint 결과), (c) 재현 페이로드·스크립트.

5. **부정적 증거 중시 (NEGATIVE TESTS)**
   - 보안·경계 REQ는 "잘 동작함" 외에 **악성 입력이 거부됨**을 증명해야 한다.
   - 재현 페이로드는 테스트 파일 상단 주석으로 출처·원리 명시.

6. **격리 (ISOLATION)**
   - 테스트 간 파일시스템, 포트, 전역 상태 공유 금지. 각 테스트는 `beforeEach`에서 임시 디렉터리·임시 포트 할당.
   - Jest `--runInBand` 없이도 안정 동작해야 한다.

7. **플래키 금지 (NO-FLAKE)**
   - `retry` 속성 사용 금지. 실패 시 재현 경로를 즉시 보고.
   - 타임아웃이 간헐적으로 터지면 원인을 해결할 뿐 여유 추가로 감추지 않는다.

8. **범위 고정 (SCOPE LOCK)**
   - REQ당 테스트 파일은 `tests/req-XX-<kebab>.test.ts` 1~N개로 **REQ 경계를 넘지 않는다**.
   - 한 테스트에서 여러 REQ를 동시에 검증하지 않는다.

### 5.2 금지·허용 빠른 표

| 항목 | 허용 | 금지 |
|---|---|---|
| TLS | 실제 `tls.createServer` + 테스트 CA | `tls.createSecureContext` mock |
| HTTP | 실제 `http.request` + 실제 파서 | `nock`, `msw`, fetch mocker |
| 소켓 | `net.createServer` + 포트 0 | EventEmitter 가짜 소켓 |
| 파일 | `fs` + 임시 디렉터리 | `memfs` 같은 가상 FS |
| 시간 | 결정적 실제 대기(≤ 500ms) | fake timers, jest.useFakeTimers() |
| 랜덤 | `crypto.randomBytes` (실제) | seed 고정 PRNG (REQ-01과 상충) |
| 의존성 주입 | 실제 구현 교체(로거 등) | 테스트용 mock 객체 |

### 5.3 비기능 요구사항 (기타)

- 모든 수정은 기능 회귀 0건 (기존 터널 통신 시나리오 통과).
- `npm run build` 및 `node deploy.js` 성공.
- 변경 최소주의 — REQ당 영향 파일 명시. 변경 외 파일 touch 금지.
- CI 없이도 로컬에서 `npm test` + `node scripts/smoke.mjs` 단독 실행 가능.

---

## 6. 산출물

- 코드 수정 패치
- 각 REQ별 테스트 (`tests/req-XX-*.test.ts`)
- 테스트 실행 결과 (npm test 출력)
- 변경 요약 PR 본문
