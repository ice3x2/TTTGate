# CRITICAL 이슈 초안 (13건)

---

## C-01

**title**: 관리자 SPA 가 Svelte 4 클래스 API 를 호출해 부팅되지 않음

**labels**: `bug`, `severity:critical`, `area:frontend`, `regression`

**body**:

## 요약

`admin/package.json` 의 Svelte 가 4에서 5로 올라갔는데 진입점이 Svelte 4의 클래스 생성 API 를 그대로 사용합니다. Svelte 5는 컴포넌트를 클래스가 아니라 함수로 컴파일하므로 이 호출이 실패하고, 관리자 화면에 아무것도 렌더링되지 않습니다.

## 근거

- `admin/src/main.ts:4` — `new App({target: ...})` 형태로 컴포넌트를 인스턴스화합니다.
- `admin/package.json:15` — `svelte` 의존성이 `^5.19.0` 입니다. 실제 설치된 버전은 5.55.5 입니다.
- `admin/svelte.config.js` — `compilerOptions.compatibility.componentApi` 설정이 없습니다. 하위 호환 모드가 꺼져 있습니다.

설치된 컴파일러로 `App.svelte` 를 직접 컴파일해 산출물이 `export default function App($$anchor, $$props)` 형태임을 확인했습니다.

## 재현 조건

Svelte 5 로 빌드한 결과물을 브라우저에서 로드하면 항상 발생합니다.

## 영향

프로덕션 빌드에서는 `anchor.before is not a function`, 개발 서버에서는 `component_api_invalid_new` 가 발생합니다. 어느 쪽이든 관리자 화면이 백지로 남아 서버 설정을 전혀 조작할 수 없습니다.

## 권고

`mount(App, {target})` 으로 교체합니다. 임시 조치가 필요하면 `svelte.config.js` 에 `compilerOptions.compatibility.componentApi = 4` 를 명시할 수 있으나, 이는 Svelte 6에서 제거될 경로이므로 권장하지 않습니다.

## 관련 이슈

이 이슈는 관리자 UI 관련 결함의 선행 조건입니다. 화면이 뜨지 않으면 C-02, C-03, C-04 를 검증할 수조차 없으므로 이것부터 고쳐야 합니다. 네 건을 하나의 마일스톤으로 묶어 처리하십시오.

## 검증 상태

- 기존 테스트 커버: 없음. `admin/` 하위에 테스트가 존재하지 않습니다.
- 도입 시점: 신규. 커밋되지 않은 워킹 트리 변경에서 비롯되었습니다.
- 확인 방법: 설치된 Svelte 컴파일러로 실제 컴파일해 산출물 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.1

---

## C-02

**title**: `InputCertFile` 의 `afterUpdate` 가 Svelte 5 에서 무한 갱신 루프를 일으킴

**labels**: `bug`, `severity:critical`, `area:frontend`, `regression`

**body**:

## 요약

인증서 입력 컴포넌트의 `afterUpdate` 콜백이 자신이 읽는 반응형 상태를 매번 다시 씁니다. Svelte 5의 레거시 `afterUpdate` 는 콜백 실행 전에 컴포넌트의 모든 반응형 소스를 읽으므로, 이 구조가 갱신 깊이 초과로 종료됩니다.

## 근거

- `admin/src/layout/InputCertFile.svelte:69-72` — `afterUpdate` 콜백이 `_resetInputFile` 을 호출합니다.
- `admin/src/layout/InputCertFile.svelte:85` — `_resetInputFile` 이 `_tempCertInfo` 를 조건 없이 재할당합니다. 이어지는 `:86-100` 의 엘리먼트 참조 변형은 존재 여부로 가드되지만, `:85` 는 호출될 때마다 실행됩니다.
- `admin/src/layout/InputCertFile.svelte:5` — `beforeUpdate` 를 임포트만 하고 사용하지 않습니다.

Svelte 5의 레거시 `afterUpdate` 는 이펙트로 구현되며 실행 전 모든 소스를 관찰합니다. 객체 값은 항상 변경으로 판정되므로 이펙트가 스스로를 무한히 재실행시킵니다. Svelte 4는 `afterUpdate` 를 flush 당 한 번으로 중복 제거했기 때문에 이 문제가 드러나지 않았습니다.

## 재현 조건

서버 설정 화면이 표시되어 `InputCertFile` 이 마운트되면 항상 발생합니다.

## 영향

`effect_update_depth_exceeded` 로 컴포넌트가 종료됩니다. 인증서 등록 화면을 사용할 수 없습니다.

## 권고

`afterUpdate` 를 제거하고 `certInfo` prop 변화에만 반응하도록 재작성합니다. 갱신 주기마다 `_tempCertInfo` 가 재할당되지 않게 하는 것이 핵심입니다. 미사용 `beforeUpdate` 임포트도 함께 제거합니다. 같은 레거시 생명주기를 쓰는 `admin/src/component/Gauge.svelte:35` 와 `admin/src/component/Timer.svelte:2` 도 함께 점검이 필요합니다.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 신규. Svelte 5 업그레이드로 표면화되었습니다.
- 확인 방법: Svelte 5 런타임의 레거시 생명주기 구현 확인 및 컴파일 산출물 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.2

---

## C-03

**title**: 관리자 UI 가 CSRF 헤더를 보내지 않아 모든 설정 변경이 403 으로 거부됨

**labels**: `bug`, `severity:critical`, `area:frontend`, `area:admin`, `regression`

**body**:

## 요약

백엔드는 세션 쿠키가 있는 상태 변경 요청에 대해 CSRF double-submit 성립을 의무화하도록 바뀌었습니다. 그런데 관리자 웹 UI 는 헤더를 전혀 싣지 않습니다. `admin/src` 전체에서 `csrf` 문자열이 한 건도 검색되지 않습니다.

## 근거

- `src/server/admin/AdminServer.ts:1329-1340` — 세션 쿠키가 존재하면 `X-CSRF-Token` 헤더와 `csrfToken` 쿠키의 일치를 요구하고, 헤더가 없으면 403 `Missing CSRF token` 을 반환합니다.

프론트엔드의 상태 변경 호출 일곱 곳이 모두 `credentials: "same-origin"` 으로 쿠키만 보내고 헤더는 싣지 않습니다.

| 파일 | 행 | 동작 |
|---|---|---|
| `admin/src/controller/ServerOptionCtrl.ts` | 132 | 서버 옵션 저장 |
| `admin/src/controller/ServerOptionCtrl.ts` | 148 | 터널링 옵션 추가 |
| `admin/src/controller/ServerOptionCtrl.ts` | 164 | 터널링 옵션 삭제 |
| `admin/src/controller/ServerOptionCtrl.ts` | 195 | 리스너 활성화 |
| `admin/src/controller/CertificationCtrl.ts` | 18 | 관리자 인증서 등록 |
| `admin/src/controller/CertificationCtrl.ts` | 57 | 외부 인증서 등록 |
| `admin/src/controller/CertificationCtrl.ts` | 72 | 인증서 삭제 |

## 재현 조건

로그인에 성공해 세션 쿠키를 보유한 상태에서 서버 옵션 저장, 터널링 옵션 추가와 삭제, 인증서 업로드와 삭제 중 무엇이든 시도하면 항상 발생합니다.

## 영향

관리자 화면에서 어떤 설정도 변경할 수 없습니다. 백엔드만 따로 시험하면 정상으로 보이지만, 백엔드와 관리자 UI 를 함께 배포하면 동작하지 않습니다. 프론트엔드는 401 만 세션 만료로 처리하므로 403 은 사용자에게 원인 불명의 실패로 보입니다.

## 권고

공통 fetch 래퍼를 하나 만들고, 모든 상태 변경 요청이 그것을 거치게 하십시오.

토큰은 `document.cookie` 에서 `csrfToken` 값을 읽는 방식을 권장합니다. 서버가 이 쿠키를 `HttpOnly` 없이 발급하므로 스크립트가 읽을 수 있고, 요청마다 추가 왕복이 필요 없습니다. `/api/csrfToken` 엔드포인트는 쿠키가 유실된 경우의 복구 경로로만 쓰십시오.

같은 래퍼에서 응답 상태 코드 판정과 JSON 파싱 오류 처리도 일원화하면, 지금 403 이 원인 불명으로 보이는 문제도 함께 해결됩니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/security/req-12-csrf.test.ts` 는 헤더를 직접 구성해 넣으므로 실제 클라이언트의 누락을 검출하지 못합니다.
- 도입 시점: 신규. 배포본 `1.0.11b` 의 `AdminServer` 에는 CSRF 기능 자체가 없습니다.
- 확인 방법: 백엔드 강제 로직과 프론트엔드 호출부 양쪽 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.3

---

## C-04

**title**: 신규 설치에서 최초 관리자 비밀번호를 설정할 수 없음

**labels**: `bug`, `severity:critical`, `area:frontend`, `area:admin`, `regression`

**body**:

## 요약

서버는 저장된 키가 비어 있을 때 요청 본문의 부트스트랩 토큰을 검증합니다. 그런데 관리자 UI 에는 그 토큰을 입력받는 화면이 없고 전송하지도 않습니다. 신규 설치에서 최초 로그인이 구조적으로 불가능합니다.

## 근거

- `src/server/admin/SessionStore.ts:147-153` — 저장된 키가 비어 있으면 `bootstrapToken` 을 검증합니다.
- `src/server/admin/AdminServer.ts:884-889` — 토큰이 없으면 403 과 `bootstrapRequired` 를 반환합니다. `:856` 은 요청 본문에서 토큰을 꺼내는 지점입니다.
- `admin/src/controller/LoginCtrl.ts:36` — 요청 본문에 `{key: hash}` 만 담습니다.
- `admin/src/layout/Login.svelte:55-56` — 로그인 폼의 입력 요소가 비밀번호 하나뿐이며 토큰 입력 필드가 없습니다.

## 재현 조건

비밀번호가 설정되지 않은 신규 설치에서 관리자 UI 로 로그인을 시도하면 항상 발생합니다.

## 영향

응답의 `success` 가 거짓이 되어 화면에는 "The password is incorrect." 만 표시됩니다. 서버가 함께 보내는 `bootstrapRequired` 플래그를 클라이언트가 읽지 않기 때문입니다. 사용자는 원인을 알 수 없습니다. `README.md` 는 `config/.bootstrap-token` 을 읽어 최초 비밀번호를 설정하라고 안내하지만 그 값을 넣을 곳이 UI 에 존재하지 않습니다.

## 권고

로그인 화면에 부트스트랩 토큰 입력 필드를 추가하고, 403 응답의 `bootstrapRequired` 와 `invalidBootstrapToken` 과 `weakPassword` 플래그별로 구분된 안내를 표시합니다.

## 검증 상태

- 기존 테스트 커버: 서버 측만. `test/component/server/admin/AdminServer.security.test.ts:46` 이 서버 동작을 검증하며 클라이언트 경로는 미커버입니다.
- 도입 시점: 신규.
- 확인 방법: 서버 검증 로직과 클라이언트 요청 본문 양쪽 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.4

---

## C-05

**title**: 페이로드가 빈 `CloseSession` 제어 패킷 하나로 서버와 클라이언트 프로세스가 종료됨

**labels**: `bug`, `severity:critical`, `area:protocol`, `area:server`, `area:client`, `latent`

**body**:

## 요약

`waitReceiveLength` 게터가 길이 검사 없이 4바이트를 읽습니다. 페이로드가 빈 `CloseSession` 패킷은 파싱 단계를 통과하므로, 이 게터에서 범위 초과 예외가 발생합니다. 호출부가 예외 처리 블록 바깥에 있고 프로세스 전역 예외 처리기도 없어 프로세스가 종료됩니다.

## 근거

- `src/commons/CtrlPacket.ts:80-85` — `this._data.readUInt32BE(0)` 을 길이 검사 없이 호출합니다.
- `src/commons/CtrlPacket.ts:282` — 페이로드 길이 검사가 `SyncCtrl` 명령 하나에만 있습니다. 다른 명령은 최소 길이를 확인하지 않으므로 `CloseSession` 은 빈 페이로드로도 정상 파싱됩니다.
- `src/server/TunnelServer.ts:594-596` — 패킷 처리 반복문이 `try` 블록 바깥에 있습니다. `try` 는 `:576-593` 에서 끝납니다.
- `src/server/ClientHandlerPool.ts:336` — 서버 측 호출부. 수신 이벤트 경로이므로 `src/util/SocketHandler.ts:365-372` 의 예외 처리에 걸립니다.
- `src/client/TunnelClient.ts:349` — 클라이언트 측 호출부. `addOnceDrainListener` 콜백 안에 있습니다.
- `src/util/SocketHandler.ts:162-167` — 전송 큐가 비어 있으면 이 콜백을 즉시 실행합니다. 그 경우는 수신 이벤트 경로이므로 예외가 잡힙니다.
- `src/util/SocketHandler.ts:355` — 전송 큐에 데이터가 남아 있으면 콜백이 대기열에 쌓였다가 소켓 종료 이벤트에서 실행됩니다. **종료 이벤트에는 예외 처리가 없습니다.**
- 저장소 전체에 `process.on('uncaughtException')` 등록이 없습니다.

빈 버퍼에 대한 `readUInt32BE(0)` 이 `ERR_BUFFER_OUT_OF_BOUNDS` 를 던지는 것을 Node 런타임에서 실측 확인했습니다.

## 재현 조건

`CtrlCmd.CloseSession` 이면서 `dataLength` 가 0 인 프레임을 제어 채널로 전송합니다. 서버 측은 인증된 제어 채널에서 도달 가능하고, 클라이언트 측은 서버가 보낸 프레임만으로 도달합니다.

클라이언트 프로세스 종료까지 재현하려면 해당 세션의 전송 큐에 데이터가 남아 있어야 합니다. 내부망 엔드포인트로 응답을 보내는 도중에 이 프레임이 도착하는 상황이 여기 해당합니다.

## 영향

영향은 수신 측과 전송 큐 상태에 따라 갈립니다.

| 상황 | 결과 |
|---|---|
| 서버가 수신 | 예외가 잡혀 제어 소켓이 파괴됩니다. 해당 클라이언트의 터널이 끊기고 재연결이 필요합니다. |
| 클라이언트가 수신, 전송 큐 비어 있음 | 예외가 잡혀 제어 소켓이 파괴됩니다. |
| 클라이언트가 수신, 전송 큐에 데이터 잔존 | **처리되지 않은 예외로 클라이언트 프로세스가 종료됩니다.** |

세 번째 경우가 이 이슈를 CRITICAL 로 두는 이유입니다. 내부망 클라이언트가 죽으면 터널 전체가 끊기고, 자동 재기동 수단이 없으면 현장 접근이 필요합니다. 앞의 두 경우도 외부에서 보낸 패킷 하나로 제어 연결을 끊을 수 있다는 점에서 수정 대상입니다.

## 권고

`fromBuffer` 단계에서 명령별 최소 페이로드 길이를 검증해 패킷을 폐기하는 것을 권장안으로 삼으십시오. 잘못된 프레임을 파싱 경계에서 걸러내므로 이후 모든 소비 지점이 함께 보호됩니다.

보조로 게터에도 `this._data.length < 4` 검사를 두어 0 을 반환하게 합니다. 아울러 프로세스 전역 예외 처리기를 마지막 방어선으로 등록하되, 이는 위 두 수정의 대체재가 아닙니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/unit/commons/CtrlPacket.test.ts` 와 `test/commons/r2-req-01-ctrl-payload-limit.test.ts` 는 상한만 검증하고 하한은 검증하지 않습니다.
- 도입 시점: 기존. 배포본 `1.0.11b` 의 `src/commons/CtrlPacket.ts:69-74` 에 동일한 코드가 있습니다.
- 확인 방법: 코드 확인 및 Node 런타임 예외 실측.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.5

---

## C-06

**title**: 비활성 외부 포트에 접속 한 번이면 서버 프로세스가 종료됨

**labels**: `bug`, `severity:critical`, `area:server`, `latent`

**body**:

## 요약

비활성 포트의 연결을 거절하는 경로가 옵션 번들을 설정하기 전에 반환합니다. 그 소켓이 종료될 때 번들을 참조하는 코드가 실행되어 타입 오류가 발생하고, 처리되지 않은 예외로 프로세스가 죽습니다.

## 근거

- `src/server/ExternalPortServerPool.ts:335-338` — 비활성 상태이면 `handler.end_()` 만 호출하고 반환합니다.
- `src/server/ExternalPortServerPool.ts:344` — 옵션 번들은 그 아래에서 설정됩니다.
- `src/server/ExternalPortServerPool.ts:283` — 종료 이벤트에서 `handler.getBundle(OPTION_BUNDLE_KEY).forwardPort` 를 읽습니다.
- 저장소 전체에 `process.on('uncaughtException')` 등록이 없습니다.

## 재현 조건

다음 두 경로 중 하나로 포트를 비활성 상태로 만든 뒤 그 포트에 TCP 접속하면 발생합니다.

1. 터널링 옵션의 `inactiveOnStartup` 을 참으로 두고 서버를 기동합니다. 이 값은 관리자 UI 의 터널 설정 화면과 `config/server.yaml` 의 해당 터널 항목 양쪽에서 지정할 수 있습니다.
2. `active(port, timeout)` 으로 활성화한 포트의 타이머가 만료되기를 기다립니다.

접속은 한 번이면 충분하며, 소켓을 즉시 닫아야 종료 이벤트가 발생해 결함이 드러납니다.

## 영향

`TypeError: Cannot read properties of undefined (reading 'forwardPort')` 가 소켓 이벤트 핸들러 안에서 던져집니다. 서버 프로세스 전체가 죽고 모든 터널이 동시에 끊깁니다.

## 권고

거절 경로에서도 옵션 번들을 먼저 설정하거나, 종료 이벤트에서 번들을 옵셔널 체이닝으로 읽고 미등록 세션은 조기 반환합니다.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 기존. 배포본 `1.0.11b` 의 `src/server/ExternalPortServerPool.ts:313-316` 에 동일한 거절 경로가 있습니다.
- 확인 방법: 실행 재현. 비활성 포트에 1회 접속해 처리되지 않은 타입 오류를 확인했습니다.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.6

---

## C-07

**title**: 요청과 응답이 하나의 `HttpPipe` 를 공유해 응답 본문에 다음 요청의 바이트가 섞임

**labels**: `bug`, `severity:critical`, `area:http`, `latent`

**body**:

## 요약

`HttpHandler` 가 파서 인스턴스를 하나만 두고 요청과 응답 양방향에 함께 사용합니다. 응답을 수신하는 도중에 다음 요청이 도착하면, 그 요청의 바이트가 응답 본문의 일부로 클라이언트에게 되돌아갑니다.

## 근거

- `src/server/http/HttpHandler.ts:21` — `_currentHttpPipe` 를 단일 인스턴스로 둡니다.
- `src/server/http/HttpHandler.ts:123-129` — 응답 모드이면서 종료 상태일 때만 요청 모드로 되돌립니다.
- `src/server/http/HttpPipe.ts:134-144` — `reset()` 이 잔여 버퍼를 폐기합니다.

## 재현 조건

keep-alive 연결에서 응답 본문이 절반만 도착한 상태에서 클라이언트가 다음 요청을 보내면 발생합니다.

## 영향

실제 인스턴스를 구동해 확인한 결과, `Content-Length: 10` 응답의 본문이 `AAAAAGET /` 로 관측되었고 두 번째 요청은 내부망으로 전달되지 않았습니다. 응답 도착 전에 두 번째 요청이 별도 세그먼트로 오면 프로토콜 오류로 소켓이 파괴됩니다. 한 세그먼트에 두 요청이 담기면 두 번째 요청은 조용히 폐기됩니다.

## 권고

요청용과 응답용 파서를 분리하고, 메시지 종료 시 잔여 버퍼를 다음 메시지의 시작 버퍼로 이월합니다. 종료 상태를 쓰기 경로의 명시적 분기로 처리해야 재귀 루프도 함께 사라집니다.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 기존. 배포본 `1.0.11b` 의 `src/server/http/HttpHandler.ts:20` 에 동일한 단일 인스턴스 선언이 있습니다.
- 확인 방법: 실행 재현.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.9

---

## C-08

**title**: chunked 응답의 종료 CRLF 가 하류로 전달되지 않아 클라이언트가 무한 대기함

**labels**: `bug`, `severity:critical`, `area:http`, `latent`

**body**:

## 요약

chunked 종료 시퀀스의 마지막 CRLF 를 파서가 소비만 하고 하류로 전달하지 않습니다. 클라이언트는 메시지가 끝났다는 신호를 받지 못합니다.

## 근거

- `src/server/http/HttpPipe.ts:638-649` — `readChunkedTrailer` 가 종료 CRLF 를 버퍼에서 제거하고 종료 상태로 전환하지만 데이터 콜백을 호출하지 않습니다.
- `src/server/http/HttpPipe.ts:561-571` — 대비되는 경로로, 청크 크기 줄과 CRLF 는 정상 전달됩니다.

## 재현 조건

본문 재작성을 타지 않는 chunked 응답이면 항상 발생합니다. 바이너리 응답 전체가 여기 해당합니다. 감사 과정에서 `image/png` 와 `Transfer-Encoding: chunked` 조합에 본문 `5\r\nhello\r\n0\r\n\r\n` 을 넣었더니 클라이언트는 `5\r\nhello\r\n0\r\n` 까지만 받았습니다.

## 영향

응답이 미완결 상태로 남아 클라이언트가 타임아웃까지 대기하고 연결 재사용이 깨집니다.

## 권고

종료 CRLF 와 trailer 블록을 순수 데이터 전달 모드에서도 그대로 전달합니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/unit/server/http/HttpUtil.branches.test.ts:220` 의 chunked 케이스는 종료 플래그만 확인하고 전달된 바이트를 검사하지 않습니다.
- 도입 시점: 기존.
- 확인 방법: 실행 재현.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.10

---

## C-09

**title**: 로그인 레이트리밋 키에 비밀번호 해시가 포함되어 무차별 대입을 차단하지 못함

**labels**: `bug`, `severity:critical`, `area:admin`, `regression`

**body**:

## 요약

레이트리밋 버킷 키가 제출된 비밀번호의 해시를 포함합니다. 매번 다른 비밀번호를 넣으면 시도마다 새 버킷이 생성되어 실패 카운터가 항상 1 에 머물고 차단 임계값에 도달하지 않습니다.

## 근거

- `src/server/admin/AdminServer.ts:1203-1208` — `extractAccountKey` 가 제출된 비밀번호의 SHA-256 앞 16자를 계정 식별자로 사용합니다.
- `src/server/admin/AdminServer.ts:1210-1212` — `buildLoginAttemptKey` 가 이 값을 카운터 키에 포함합니다.
- `src/server/admin/AdminServer.ts:1228` — 5회 임계값 판정.
- `src/server/admin/AdminServer.ts:1247-1252` — 실패 카운트 기반 지연도 최소값에 고정됩니다.

## 재현 조건

매 시도마다 서로 다른 비밀번호를 제출하면 재현됩니다.

## 영향

사전 공격과 무차별 대입이 사실상 무제한으로 허용됩니다. 부수적으로 `:1232-1237` 의 LRU 상한 10,000 을 공격자가 손쉽게 채워, 실제로 차단되어야 할 정상 버킷을 축출합니다.

## 권고

레이트리밋 키에서 비밀번호 파생값을 제거하고 네트워크 버킷만으로 집계합니다. 단일 비밀번호 인증 체계에는 계정 축이 존재하지 않습니다.

## 검증 상태

- 기존 테스트 커버: 반대로 고정되어 있습니다. `test/unit/server/admin/req-07-rate-limit.test.ts:68-69` 가 "다른 잘못된 비밀번호는 401" 을 정상 동작으로 단언합니다. **수정과 함께 이 테스트를 개정해야 합니다.**
- 도입 시점: 신규. 배포본 `1.0.11b` 에는 `extractAccountKey` 가 존재하지 않습니다.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.11

---

## C-10

**title**: CI 가 코드 변경에 대해 테스트를 한 건도 실행하지 않음

**labels**: `bug`, `severity:critical`, `area:test-ci`, `regression`

**body**:

## 요약

Jest 를 실행하는 워크플로우가 공급망 감사 하나뿐이고, 그것도 공급망 테스트 6개만 돌립니다. 나머지 59개 스위트는 어떤 워크플로우에서도 실행되지 않습니다. 특히 PR 트리거에는 경로 필터가 걸려 있어, `src` 만 수정한 PR 은 이 워크플로우조차 기동시키지 않습니다.

## 근거

- `.github/workflows/supply-chain-audit.yml:103` — `npx jest test/supply-chain/` 이 저장소 전체에서 유일한 Jest 실행입니다. 대상이 공급망 디렉터리로 한정되어 나머지 59개 스위트는 실행되지 않습니다.
- `.github/workflows/supply-chain-audit.yml:4-11` — PR 트리거에만 경로 필터가 걸려 있습니다. 대상은 다음 다섯 개입니다.

```
package.json
package-lock.json
admin/package.json
admin/package-lock.json
.github/workflows/supply-chain-audit.yml
```

- `.github/workflows/supply-chain-audit.yml:12-17` — `push` 는 main 브랜치에서, 스케줄은 매주 월요일, 수동 실행은 언제든 경로 제한 없이 기동합니다. 다만 이들 역시 공급망 테스트 6개만 실행합니다.
- `.github/workflows/build-release.yml:43` — `npm run dist` 만 실행하며 테스트 단계가 없습니다.
- `.github/workflows/build-release-binaries.yml:48` — 동일합니다.

## 재현 조건

`src` 하위 파일만 수정한 PR 을 올리면 재현됩니다. 워크플로우 실행 목록에 아무것도 나타나지 않습니다.

main 브랜치로 푸시하면 공급망 감사가 기동하지만, 거기서도 실행되는 것은 `test/supply-chain/` 아래 6개 파일뿐입니다. 코드 동작을 검증하는 59개 스위트는 어느 경로로도 실행되지 않습니다.

## 영향

65개 스위트 중 59개가 자동 실행 지점을 갖지 못합니다. 여러 차례의 보안 개선 작업에서 축적한 회귀 테스트가 회귀를 막지 못합니다.

테스트가 존재하는데 실행되지 않으므로, 결함이 들어와도 병합 시점에 드러나지 않고 배포 이후에야 발견됩니다.

## 권고

PR 트리거에 `npm test` 잡을 추가하고, 공급망 감사의 `paths` 필터를 코드 테스트 잡에서 분리하십시오. 배포 파이프라인에도 테스트 게이트를 배치합니다.

## 처리 순서

이 이슈와 C-11 은 다른 모든 수정의 회귀 방지 전제입니다. 테스트가 실행되지 않는 상태에서 40건 넘는 수정을 진행하면 새로운 회귀가 들어와도 알 수 없습니다. 다른 이슈에 착수하기 전에 이 두 건을 먼저 처리하십시오.

## 검증 상태

- 기존 테스트 커버: 해당 없음.
- 도입 시점: 신규. `.github/workflows/` 자체가 배포본 `1.0.11b` 에는 없었고 커밋 `6ef348e` 에서 추가되었습니다. 워크플로우를 만들면서 코드 테스트 잡을 두지 않은 것이 이 결함입니다.
- 확인 방법: 워크플로우 파일 전수 확인 및 도입 커밋 추적.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.12

---

## C-11

**title**: 공급망 테스트가 네트워크 실패 시 무조건 통과함

**labels**: `bug`, `severity:critical`, `area:test-ci`, `regression`

**body**:

## 요약

CI 가 실행하는 유일한 테스트군이 감사 명령 실패를 취약점 0건으로 해석합니다. 오프라인이나 레지스트리 장애 환경에서 게이트가 조용히 녹색이 됩니다.

## 근거

- `test/supply-chain/r3-req-04-medium-cleared.test.ts:23` — `npm audit` 실패 시 문자열 `"{}"` 를 반환합니다. 그러면 취약점 목록이 빈 객체가 되어 `expect(hits).toEqual([])` 가 통과합니다.
- `test/supply-chain/r3-req-02-crypto-js-removed.test.ts:51` — `npm ls` 출력이 비면 `expect(true).toBe(true)` 로 빠져나갑니다.

## 재현 조건

오프라인, 레지스트리 장애, 프록시 차단 환경에서 CI 를 실행하면 재현됩니다. 로컬에서는 네트워크를 끊고 `npx jest test/supply-chain/` 을 실행하면 확인할 수 있습니다.

## 영향

실패해야 할 검사가 그대로 통과합니다. 취약한 의존성이 들어와도 차단되지 않습니다. C-10 과 결합하면 저장소에 실효성 있는 자동 검증이 사실상 남지 않습니다.

## 권고

감사 명령의 성공 여부를 먼저 단언하고, 실패를 테스트 실패로 승격합니다. 감사 결과 테스트는 스케줄 잡으로 분리하고, 게이트 자체는 의도적으로 취약한 픽스처로 차단 동작을 확인합니다.

## 검증 상태

- 기존 테스트 커버: 해당 없음.
- 도입 시점: 신규. 공급망 3라운드에서 추가되었습니다.
- 확인 방법: 테스트 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.13

---

## C-12

**title**: `Sentinel` 이 자기 프로세스 대신 PID 1 에 SIGTERM 을 보냄

**labels**: `bug`, `severity:critical`, `area:resource`, `latent`

**body**:

## 요약

프로세스 감시자가 종료 처리에서 `process.kill(1)` 을 호출합니다. 첫 인자는 대상 PID 이고 기본 시그널은 SIGTERM 이므로, 이 호출은 자기 자신이 아니라 PID 1 에 시그널을 보냅니다.

## 근거

- `src/Sentinel.ts:234` — `process.kill(1);`
- `src/Sentinel.ts:231` — 바로 윗줄에서 자신에게 SIGTERM 을 보내지만, Node 는 시그널을 비동기로 처리하므로 현재 동기 실행은 끝까지 진행되어 234행이 반드시 실행됩니다.
- `src/Sentinel.ts:237` — 감시 대상 조회가 3초마다 반복됩니다.

## 재현 조건

데몬 모드로 감시 중일 때 프로세스 조회가 실패하면 진입합니다. 조회는 3초마다 반복되므로 일시적 자원 부족 한 번이면 도달합니다.

실제 장애를 기다리지 않고 확인하려면, `find-process` 호출을 거부된 프로미스를 반환하도록 대체한 단위 테스트를 작성해 해당 분기가 실행되게 하십시오. 그 상태에서 `process.kill` 호출의 첫 인자를 관찰하면 대상이 자기 프로세스가 아님을 확인할 수 있습니다.

## 영향

컨테이너에서는 PID 1 이 컨테이너 주 프로세스이므로 컨테이너 전체가 종료됩니다. 호스트에서 root 권한으로 구동하면 init 에 시그널을 보냅니다.

## 권고

231행과 234행을 함께 정리하십시오. 231행이 이미 자기 자신에게 SIGTERM 을 보내므로, 234행은 그 뒤에 실행되는 잉여 코드입니다.

권장 형태는 231행을 남기고 234행을 제거하거나, 두 줄을 `process.exit(1)` 하나로 합치는 것입니다. 후자가 의도에 더 가까워 보입니다.

아울러 `process.kill` 은 대상 프로세스에 대한 권한이 없으면 `EPERM` 을 던집니다. 이 호출이 catch 블록 안에 있으므로, 지금 구조에서는 그 예외가 또 다른 미처리 예외가 됩니다. 정리 시 이 점도 함께 해소됩니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/` 전체에 `Sentinel` 을 참조하는 테스트가 없습니다. 이 모듈의 커버리지는 0% 입니다.
- 도입 시점: 기존. 배포본 `1.0.11b` 의 `src/Sentinel.ts:234` 에 동일한 코드가 있습니다.
- 확인 방법: 코드 확인 및 `process.kill` 시그니처 대조.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.14

---

## C-13

**title**: 배포 매니페스트에 crypto-js 가 남아 공급망 제거 작업이 배포본에서 무효화됨

**labels**: `bug`, `severity:critical`, `area:test-ci`, `regression`

**body**:

## 요약

직전 커밋이 crypto-js 를 제거했으나 배포 매니페스트에는 그대로 남아 있습니다. 배포본에서 의존성을 설치하면 crypto-js 가 다시 들어옵니다. 검증 테스트는 루트 매니페스트만 읽어 이 잔존을 잡지 못합니다.

## 근거

- `package-build.json:17` — `@types/crypto-js` 항목.
- `package-build.json:23` — `crypto-js` 항목.
- `deploy.js:26` — `package-build.json` 을 `dist.js/package.json` 으로 그대로 복사합니다.
- `test/supply-chain/r3-req-02-crypto-js-removed.test.ts:15` — 검사 대상이 루트 `package.json` 입니다.

## 재현 조건

`node deploy.js` 로 배포본을 만든 뒤 그 디렉터리에서 의존성을 설치하면 재현됩니다.

## 영향

커밋 `b07518b` 이 수행한 crypto-js 제거 작업이 배포 경로에서 완결되지 않았습니다. 공급망 게이트가 통과하면서도 배포물에는 제거 대상이 남습니다.

## 권고

`package-build.json` 에서 두 항목을 제거하고, 공급망 테스트의 검사 대상에 이 파일을 추가합니다.

## 검증 상태

- 기존 테스트 커버: 없음. 검사 대상 파일이 다릅니다.
- 도입 시점: 신규. 공급망 3라운드의 누락입니다.
- 확인 방법: 매니페스트와 배포 스크립트 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.15
