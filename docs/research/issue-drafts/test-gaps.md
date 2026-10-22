# 테스트·검증 체계 이슈 초안 (14건)

보고서 7장(테스트 충분성)에서 도출한 항목입니다. CRITICAL 과 HIGH 초안에 흡수되지 않은 것만 담았습니다.

---

## T-01

**title**: 터널 왕복 E2E 가 TCP 평문 단일 시나리오뿐이라 제품 핵심 경로가 검증되지 않음

**labels**: `bug`, `severity:high`, `area:test-ci`

**body**:

## 요약

이 제품의 본질은 외부 요청이 터널을 타고 내부 엔드포인트에 도달하고 응답이 돌아오는 것입니다. 그 왕복을 검증하는 테스트는 한 건이며, 20바이트 문자열 하나를 TCP 로 echo 하는 것이 전부입니다.

## 근거

- `test/e2e/tunnel/baseline-tunnel.test.ts:17` — 유일한 왕복 테스트입니다.
- `test/helpers/tunnelHarness.ts:66-74` — 프로토콜을 `tcp`, TLS 를 꺼짐으로 고정합니다.
- `test/helpers/tunnelHarness.ts:15-17` — `serverOptionOverride` 와 `tunnelingOptionOverride` 와 `clientOptionOverride` 확장 지점이 정의되어 있으나, 하네스를 쓰는 세 파일 어디에서도 사용되지 않습니다.
- `docs/plan/integration-test-guide.md` — P1 기준선 항목으로 "HTTP tunnel 기본 프록시 동작" 을 명시했으나 구현되지 않았습니다.

## 검증되지 않는 것

- HTTP 모드 터널 프록시 동작
- TLS 를 켠 터널 왕복
- 여러 터널링 옵션 동시 운용
- HTTP 모드와 TCP 모드 혼용
- 서버 재시작 중의 세션 거동

HTTP 계층에서 발견된 결함 여덟 건이 모두 이 공백 안에 있습니다.

## 권고

하네스의 기존 확장 지점을 사용해 HTTP 모드 왕복과 TLS 왕복을 먼저 추가합니다. 확장 지점이 이미 준비되어 있으므로 하네스 구조 변경 없이 시작할 수 있습니다.

## 검증 상태

- 확인 방법: 테스트 파일 정독 및 하네스 확장 지점 사용처 전수 검색.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §7.4

---

## T-02

**title**: 왕복 테스트 헬퍼가 실패를 10초 재시도로 덮어 초기 바이트 유실을 통과시킴

**labels**: `bug`, `severity:high`, `area:test-ci`

**body**:

## 요약

왕복 헬퍼가 페이로드 불일치 시 예외를 던지고, 상위 대기 함수가 10초 동안 50밀리초 간격으로 전체 왕복을 재시도합니다. 첫 시도에서 바이트가 유실되어도 재시도가 성공하면 테스트가 통과합니다.

## 근거

- `test/helpers/tunnelHarness.ts:170-179` — 불일치 시 예외를 던지고 재시도 대상이 됩니다.
- `test/e2e/req-09-pool-swap-zombie.test.ts:85-92` — 이 헬퍼로 "초기 바이트 손실 0" 을 주장합니다.

## 영향

검증하려는 요구사항이 실제로는 검증되지 않습니다. 풀 교체 시점의 바이트 유실이라는 결함이 있어도 테스트가 녹색으로 남습니다.

## 권고

첫 왕복 결과만 단언하는 별도 경로를 두어, 초기 손실 요구사항을 재시도 없이 검증합니다. 연결 수립 대기와 데이터 정확성 검증을 분리하는 것이 핵심입니다.

## 검증 상태

- 확인 방법: 헬퍼와 호출부 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §7.5

---

## T-03

**title**: `--forceExit` 가 자원 누수 신호를 차단해 핸들러 누수를 가림

**labels**: `bug`, `severity:high`, `area:test-ci`

**body**:

## 요약

테스트 스크립트가 `--forceExit` 를 사용합니다. 프로세스가 종료되지 않는다는 가장 강한 자원 누수 신호가 차단됩니다.

## 근거

- `package.json` 의 `test` 스크립트 — `jest --detectOpenHandles --forceExit`.
- `test/helpers/resourceStats.ts:54-65` — 상주 메모리와 힙과 파일 서술자와 캐시 바이트를 수집합니다. 그러나 프로세스가 종료되지 못하는 상태 자체는 이 수치들로 드러나지 않습니다.

## 영향

H-09 와 H-10 이 지적한 핸들러 맵 누수가 이 옵션 뒤에 가려져 있을 가능성이 있습니다. 누수가 있어도 테스트가 정상 종료된 것처럼 보입니다.

## 권고

`--forceExit` 를 제거해 누수를 실패로 승격합니다. 제거 후 종료되지 않는 스위트가 드러나면 그것이 곧 수정 대상입니다. 단계적으로 진행하려면 신규 테스트부터 이 옵션 없이 실행하는 별도 잡을 두는 방법도 있습니다.

## 검증 상태

- 확인 방법: 테스트 스크립트 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §7.5, §9.5.4

---

## T-04

**title**: 관리자 UI 에 테스트와 러너와 스크립트가 전혀 없음

**labels**: `bug`, `severity:high`, `area:test-ci`, `area:frontend`

**body**:

## 요약

`admin/` 하위에 테스트 파일도, 테스트 러너 설정도, 테스트 스크립트도 없습니다. 루트 `test/` 에도 프론트엔드를 다루는 항목이 없습니다.

## 근거

- `admin/package.json` — `scripts` 에 테스트 항목이 없습니다.
- `admin/` 전체에 테스트 파일과 러너 설정 파일이 존재하지 않습니다.

## 영향

Svelte 4 에서 5 로의 메이저 업그레이드와 crypto-js 제거라는 파괴적 변경이 동시에 이루어졌는데 회귀를 잡을 자동 검증 수단이 하나도 없습니다. C-01 부터 C-04 까지 네 건의 CRITICAL 이 발견되지 않은 채 남아 있었다는 사실이 이 위험을 실증합니다.

## 권고

최소한의 스모크 테스트부터 도입합니다. 우선순위는 두 가지입니다. 첫째, 로그인 비밀번호 해시가 서버가 기대하는 값과 일치하는지 확인하는 계약 테스트. 둘째, 주요 컴포넌트가 오류 없이 마운트되는지 확인하는 테스트입니다. 후자가 있었다면 C-01 과 C-02 를 즉시 잡았을 것입니다.

## 검증 상태

- 확인 방법: `admin/` 디렉터리 전수 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §7.5, §9.5.3

---

## T-05

**title**: `/api/emptyKey` 엔드포인트가 라우팅되지 않아 최초 설정 안내와 비밀번호 강도 검사가 죽어 있음

**labels**: `bug`, `severity:high`, `area:admin`, `area:frontend`, `regression`

**body**:

## 요약

클라이언트가 호출하는 `/api/emptyKey` 경로가 서버 라우팅 표에서 제거되었고, 핸들러 본문도 무조건 404 를 반환하는 스텁으로 바뀌었습니다. 배포본 `1.0.11b` 에서는 두 가지 모두 정상 동작했으므로 개선 작업이 만든 회귀입니다.

## 근거

- `admin/src/controller/LoginCtrl.ts:10` — `/api/emptyKey` 를 호출합니다.
- `src/server/admin/AdminServer.ts:841-843` — `onGetEmptyKey` 가 무조건 404 를 반환하는 스텁입니다. 실제 조회 로직이 없습니다.
- 이 핸들러를 참조하는 라우팅 분기도 저장소 전체에 없습니다.
- 배포본 대조: `git show eac7d0c:src/server/admin/AdminServer.ts` 의 `:154-155` 에 라우팅 분기가 있고 `:516-519` 가 `SessionStore.isEmptyKey()` 결과를 반환했습니다.

## 재현과 영향

관리자 UI 를 로드하면 항상 발생합니다. 응답의 `emptyKey` 가 undefined 가 되어 `admin/src/layout/Login.svelte` 의 최초 설정 안내와 비밀번호 강도 사전 검사가 통째로 비활성화됩니다. C-04 와 함께 신규 설치 경험을 무너뜨립니다.

## 권고

두 가지를 함께 해야 기능이 살아납니다. 라우팅 분기를 되살리는 것만으로는 부족하고, 스텁이 된 핸들러 본문도 배포본처럼 실제 조회 결과를 반환하도록 복원해야 합니다.

대안으로, 클라이언트가 로그인 응답의 `bootstrapRequired` 플래그로 최초 설정 여부를 판단하게 계약을 정리하는 방법이 있습니다. 이 경우 엔드포인트와 핸들러를 모두 제거하고 클라이언트 호출도 없앱니다. C-04 와 함께 처리한다면 이쪽이 더 단순합니다.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 신규. 배포본 `1.0.11b` 에서는 정상 동작했습니다.
- 확인 방법: 라우팅 표와 핸들러 본문 확인, 배포본 커밋 대조.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §9.1

---

## T-06

**title**: 커버리지 게이트가 68개 모듈 중 16개만 계측해 수치가 실태를 반영하지 않음

**labels**: `bug`, `severity:medium`, `area:test-ci`

**body**:

## 요약

커버리지 계측 대상이 16개 파일로 한정되어 있습니다. 테스트가 이미 존재하는 모듈조차 계측에서 빠져, 보고되는 수치가 스위트의 실제 도달 범위를 나타내지 못합니다.

## 근거

- `jest.config.ts:36-57` — `collectCoverageFrom` 이 16개 파일만 나열합니다.
- `jest.config.ts:63-69` — 임계값이 그 16개에만 적용됩니다.

계측에서 빠졌으나 테스트가 존재하는 모듈은 `SocketHandler`, `CtrlPacket`, `DataStatePacket`, `ClientHandlerPool`, `ExternalPortServerPool`, `TTTServer`, `IdentityRegistry`, `CertificationStore`, `HttpHandler`, `ServerOptionStore`, `BufferReader`, `BufferWriter` 등입니다.

## 실측값

`src` 전체를 대상으로 직접 측정한 값은 다음과 같습니다.

| 지표 | 값 |
|---|---|
| 라인 | 64.26% |
| 구문 | 63.71% |
| 함수 | 69.74% |
| 브랜치 | 52.23% |

커버리지 0% 모듈은 `Sentinel`, `ServerApp`, `app.ts`, `Optional`, `ConstructorConsumerHandler`, `PubSub` 여섯 개입니다.

## 권고

계측 범위를 `src` 전체로 넓히고, 위 실측값을 기준선으로 삼아 하락을 막습니다. 기준선을 넘는 목표치는 그다음 단계에서 정합니다.

## 검증 상태

- 확인 방법: 설정 파일 확인 및 전체 범위 커버리지 직접 측정.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §7.2, §9.4.4

---

## T-07

**title**: 대용량 전송과 캐시 스필 경로가 터널을 통해 한 번도 검증되지 않음

**labels**: `bug`, `severity:high`, `area:test-ci`, `area:resource`

**body**:

## 요약

터널을 실제로 통과하는 최대 페이로드가 22바이트 수준입니다. 모두 단일 TCP 세그먼트에 담기므로 분할 전송과 재조립과 백프레셔와 캐시 스필이 한 번도 발동하지 않습니다.

## 근거

- `test/e2e/req-09-pool-swap-zombie.test.ts:85` — 터널을 지나는 최대 페이로드가 정의된 지점입니다.
- `test/unit/util/SocketHandler.resource.test.ts:79` — 스필 로직이 4KiB 청크로 단독 검증될 뿐입니다.
- `src/util/FileCache.ts` — 어떤 테스트도 이 모듈을 참조하지 않습니다.

## 영향

기본값 128MiB 인 전역 메모리 캐시 한도가 한 번도 발동하지 않습니다. H-02 와 H-03 이 지적한 데이터 유실 연쇄가 정확히 이 미검증 경로에 있습니다.

## 권고

수십 MiB 페이로드를 터널로 왕복시켜 스필과 회수를 확인하는 E2E 를 추가합니다. 송수신 바이트를 해시로 대조해 무결성까지 검증해야 H-02 를 잡을 수 있습니다.

## 검증 상태

- 확인 방법: 테스트 파일 정독 및 `FileCache` 참조 전수 검색.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §7.4

---

## T-08

**title**: 테스트 하네스가 다중 클라이언트 동시 접속을 구조적으로 표현하지 못함

**labels**: `bug`, `severity:high`, `area:test-ci`

**body**:

## 요약

하네스가 클라이언트 수를 1로 하드코딩합니다. 여러 클라이언트가 동시에 붙는 상황을 테스트로 표현할 수 없습니다.

## 근거

- `test/helpers/tunnelHarness.ts:129` — 클라이언트 상태 배열의 길이가 1인지 확인합니다.
- `test/helpers/tunnelHarness.ts:83` — 신뢰 클라이언트 목록이 원소 하나로 구성됩니다.

## 영향

클라이언트별 세션 격리와 한쪽 단절의 파급이 검증되지 않습니다. 이 제품은 여러 내부망 클라이언트를 하나의 서버에 붙이는 것이 기본 사용 형태이므로, 검증 공백이 실제 사용 형태와 정확히 어긋납니다.

## 권고

하네스를 클라이언트 N개로 일반화하고, 동시 접속과 개별 단절 시나리오를 추가합니다.

## 검증 상태

- 확인 방법: 하네스 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §7.4

---

## T-09

**title**: NO-MOCK 정책 선언과 실제 테스트가 어긋남

**labels**: `bug`, `severity:medium`, `area:test-ci`

**body**:

## 요약

설정 파일이 실환경 테스트만 허용한다고 선언하지만, 일부 테스트가 TCP 서버를 빈 객체로 대체합니다.

## 근거

- `jest.config.ts:4` — "실환경 테스트만 허용(NO-MOCK)" 이라고 선언합니다.
- `test/unit/server/TunnelServer.keepalive.test.ts:10` — `TCPServer.create` 를 대체합니다.
- `test/unit/server/http/HttpHandler.rewrite.test.ts:25`, `:96` — 동일한 방식입니다.

## 영향

keepAlive 가 실제 리스너에 반영되는지가 아니라 인자 전달 여부만 확인됩니다. H-06 이 지적한 keepalive 기본값 문제를 이 테스트가 잡지 못한 이유이기도 합니다.

## 권고

정책을 현실에 맞게 개정하거나 두 테스트를 실환경 소켓 기반으로 바꿉니다. 선언과 실제가 어긋난 상태로 두면 정책이 판단 기준으로 기능하지 못합니다.

## 검증 상태

- 확인 방법: 설정 주석과 테스트 코드 대조.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §7.5

---

## T-10

**title**: HTTP 본문 재작성 테스트가 정상 경로를 단언하지 않아 기능이 망가져도 통과함

**labels**: `bug`, `severity:medium`, `area:test-ci`, `area:http`

**body**:

## 요약

본문 호스트 치환 테스트가 우회 조건만 확인하고, 정상 조건에서 실제로 치환이 일어나는지 단언하지 않습니다.

## 근거

- `test/unit/server/http/HttpHandler.rewrite.test.ts:135` — 한도 초과 시 우회 동작만 검증합니다.

## 영향

치환 기능 자체가 망가져도 테스트가 통과합니다. H-13 과 H-14 가 지적한 재작성 결함이 이 공백 안에 있습니다.

## 권고

한도 이내 본문에서 치환이 실제로 일어남을 단언하는 정상 경로 테스트를 추가합니다.

## 검증 상태

- 확인 방법: 테스트 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §7.5

---

## T-11

**title**: TLS 신뢰 거부 테스트가 연결 성립을 배제하지 않아 위양성으로 통과할 수 있음

**labels**: `bug`, `severity:medium`, `area:test-ci`

**body**:

## 요약

신뢰되지 않은 인증서를 거부하는지 확인하는 테스트가 연결 미성립을 단언하지 않습니다. 연결이 성립한 뒤 닫혀도 통과합니다.

## 근거

- `test/component/client/TlsVerification.test.ts:79` — 거부 케이스에 연결 성립 배제 단언이 없습니다.
- `test/component/client/TlsVerification.test.ts:115-118` — 대비되는 긍정 케이스는 연결 성립을 단언합니다.

## 영향

TLS 검증이 무력화되어도 테스트가 녹색으로 남을 수 있습니다.

## 권고

거부 테스트에 연결 성립 이벤트가 발생하지 않았음을 단언하는 검사를 추가합니다.

## 검증 상태

- 확인 방법: 테스트 코드 확인 및 긍정 케이스와 대조.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §7.5

---

## T-12

**title**: SRS 요구사항 366건과 테스트 사이에 추적 링크가 없음

**labels**: `bug`, `severity:medium`, `area:test-ci`

**body**:

## 요약

요구사항 문서에 테스트 파일 참조가 한 건도 없습니다. 테스트 쪽 REQ 번호 체계와 SRS 번호 체계가 서로 연결되지 않습니다.

## 근거

- `docs/plan/srs/` — 366개 요구사항이 등록되어 있으나 개별 요구사항과 테스트 파일을 잇는 매핑이 없습니다. `test/` 라는 문자열이 산문 속에 두 번 나타날 뿐입니다.
- `docs/plans/plan-remediation-r1.md` 부터 `r3.md` — 별도의 REQ 번호 체계를 사용합니다.

## 영향

요구사항 하나를 짚어 그것을 검증하는 테스트가 무엇인지 찾을 방법이 없습니다. 요구사항이 구현되었다는 주장과 검증되었다는 주장을 구분할 수 없습니다.

## 권고

요구사항 추적 매트릭스에 테스트 파일 열을 추가하고, 테스트 쪽 REQ 주석을 SRS 번호로 연결합니다.

## 검증 상태

- 확인 방법: 요구사항 문서와 테스트 디렉터리 상호 참조 검색.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §7.5, §9.5.5

---

## T-13

**title**: 부하 상태에서 `lint-auth-compare` 테스트가 간헐적으로 실패함

**labels**: `bug`, `severity:medium`, `area:test-ci`

**body**:

## 요약

자식 프로세스를 생성하는 테스트가 시스템 부하가 높을 때 비정상 종료 코드를 반환합니다.

## 근거

- `test/unit/tools/lint-auth-compare.test.ts:92` — 자식 프로세스의 종료 코드가 0인지 단언합니다.

전수검사 중 다른 작업이 병렬로 도는 상태에서 이 테스트를 포함한 3개 스위트가 실패했고, 부하가 없는 상태로 재실행하니 65개 전부 통과했습니다. 실패 시 반환된 종료 코드는 정상 범위를 벗어난 값이었습니다.

## 영향

CI 러너처럼 자원이 빠듯한 환경에서 간헐적 실패가 발생할 수 있습니다. 간헐적 실패는 신뢰를 떨어뜨려, 진짜 실패까지 재실행으로 넘기게 만듭니다.

## 권고

자식 프로세스 실행에 여유 있는 타임아웃을 두고, 실패 시 표준 오류 출력을 단언 메시지에 포함해 원인 진단이 가능하게 합니다.

## 검증 상태

- 확인 방법: 부하 상태와 정상 상태에서 각각 실행해 결과 대조.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §7.5

---

## T-14

**title**: 테스트가 작업 트리에 산출물을 남김

**labels**: `bug`, `severity:medium`, `area:test-ci`

**body**:

## 요약

테스트 실행이 저장소 작업 트리에 파일을 생성하고 정리하지 않습니다.

## 근거

- `test/unit/server/req-04-constant-time-compare.test.ts:27` — 산출물 경로를 작업 트리 안에 둡니다.
- `test/e2e/req-09-pool-swap-zombie.test.ts:25-26` — 동일합니다.

현재 `test/.tmp-req04-lint/auth-compare.json` 이 미추적 상태로 남아 있습니다.

## 영향

기능 결함은 아니지만 위생 문제입니다. 미추적 파일이 쌓이면 실제 변경분을 가려 검토를 방해합니다.

## 권고

두 산출물 경로를 시스템 임시 디렉터리로 옮기거나, 테스트 종료 시 제거합니다.

## 검증 상태

- 확인 방법: 테스트 코드 확인 및 작업 트리 상태 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §7.5
