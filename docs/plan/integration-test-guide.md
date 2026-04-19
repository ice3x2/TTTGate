# 통합 테스트 가이드

## 목표

개선 전에 원래 기능이 잘 되는지 확인하고, 개선 후에도 정상 기능은 유지되며 취약 동작만 차단되었는지를 검증한다.

## evidence 구조

- `docs/plan/verification/evidence/baseline/<phase>/`
- `docs/plan/verification/evidence/hardened/<phase>/`

각 phase는 동일한 시나리오, 동일한 메트릭, 동일한 출력 포맷으로 `baseline`과 `hardened`를 비교한다.

## 핵심 전략

1. 정상 기능 기준선 테스트를 먼저 만든다.
2. 취약 동작 주변 정상 흐름을 고정한다.
3. exploit 차단 테스트는 red 상태로 먼저 추가할 수 있으면 먼저 추가한다.
4. seam 리팩토링은 behavior-preserving 범위로만 선행한다.
5. 모든 Phase는 `baseline green + new security green + regression green`이 아니면 종료하지 않는다.

## 테스트 계층

### 계층 1. 순수 단위/계약 테스트

- 대상:
  - `CtrlPacket`
  - `DataStatePacket`
  - `SessionStore`
  - `ServerOptionStore`
  - path resolution helper
  - TLS option builder
  - queue accounting/lifecycle helper
- 목적:
  - parser/serializer contract 고정
  - option normalization과 CLI 파싱 검증

### 계층 2. 컴포넌트 테스트

- 대상:
  - `AdminServer` with temp root
  - `ServerOptionStore` + staged write
  - `CertificationStore`
  - `FileCache`
  - `SocketHandler`
- 목적:
  - 파일 시스템, 세션, staged apply, cache quota, timeout behavior 검증

### 계층 3. E2E 기준선 테스트

- 구성:
  - tunnel server
  - tunnel client
  - echo endpoint
  - HTTP endpoint
  - raw external client
- 목적:
  - 실제 터널 데이터 흐름과 reconnect, close, config update 기본 동작 고정

### 계층 4. 보안/회귀 테스트

- 대상:
  - path traversal
  - bootstrap 선점
  - TLS trust failure
  - spoofed identity
  - unbound data channel
  - queue overflow
  - slowloris
- 목적:
  - 차단되어야 하는 exploit path가 실제로 막히는지 확인

### 계층 5. 장시간/부하 테스트

- 대상:
  - reconnect churn
  - slow receiver pressure
  - FileCache quota stress
  - mixed-version handshake churn
- 목적:
  - 누수와 자원 회수, plateau 형성, 장기 안정성 검증

## 기준선 테스트 우선순위

### P0 기준선

- 관리자 정적 자산 정상 서빙
- 정상 로그인/세션 검증
- server-client control 연결
- external TCP tunnel echo
- reconnect 후 재연결
- config load/save roundtrip

### P1 기준선

- HTTP tunnel 기본 프록시 동작
- external port on/off 및 상태 조회
- 인증서 파일 저장/로드 정상 경로
- keepAlive option parsing

## exploit 차단 테스트 우선순위

### P0 exploit regression

- `../` path traversal read
- remote bootstrap first-login
- MITM cert validation bypass
- 공개 기본 key로 client 등록
- 무제한 pending queue 성장

### P1 exploit regression

- spoofed `allowedClientNames`
- data channel replay/attach mismatch
- `-reset false` destructive reset
- partial apply leaving service down

## fixture와 helper 설계

### helper

- `createTempRoot()`
- `allocatePorts()`
- `startServerWithTempRoot()`
- `startClientWithTempRoot()`
- `startEchoEndpoint()`
- `startHttpEndpoint()`
- `createRawTcpClient()`
- `createTlsClientWithCA()`
- `waitForEvent()`
- `collectResourceStats()`

### fixture

- `fixtures/web/index.html`
- `fixtures/config/server.valid.yaml`
- `fixtures/config/server.invalid.yaml`
- `fixtures/certs/*`
- `fixtures/http/*`

## 공통 메트릭

- `build_success`
- `unit_pass_rate`
- `integration_pass_rate`
- `admin_unauth_block_rate`
- `bootstrap_reject_rate`
- `secret_redaction_leak_count`
- `ctrl_handshake_success_rate`
- `ctrl_handshake_reject_rate`
- `session_open_success_rate`
- `reconnect_success_rate`
- `handshake_latency_p95`
- `data_bind_reject_rate`
- `end_to_end_byte_integrity`
- `rss_peak_mb`
- `heap_peak_mb`
- `fd_count`
- `file_cache_bytes`
- `config_apply_success_rate`
- `rollback_success_rate`
- `cert_apply_propagation_s`
- `throughput_mbps`
- `latency_p95`
- `crash_count`
- `unexpected_restart_count`

## 정량 승인 기준

- `build_success = 100%`
- `unit_pass_rate = 100%`
- `integration_pass_rate = 100%`
- `admin_unauth_block_rate = 100%`
- `bootstrap_reject_rate = 100%`
- `secret_redaction_leak_count = 0`
- invalid case에 대한 `ctrl_handshake_reject_rate = 100%`
- invalid case에 대한 `data_bind_reject_rate = 100%`
- `session_open_success_rate >= baseline - 1 percentage point`
- `reconnect_success_rate >= baseline - 1 percentage point`
- `handshake_latency_p95 <= baseline * 1.20`
- `end_to_end_byte_integrity = 100%`
- `config_apply_success_rate = 100%`
- `rollback_success_rate = 100%`
- `crash_count = 0`
- `unexpected_restart_count = 0`
- stress 종료 60초 내 `fd_count <= baseline + 5`
- stress 종료 60초 내 `file_cache_bytes <= baseline + 1 MiB`

## seam/adapter 전략

- `Environment` override seam
- deterministic `ClockRng`
- `TlsOptionsFactory`
- `FileSystemFacade`
- `ListenerApplyCoordinator`
- queue and lifecycle metric hooks

## Phase별 테스트 게이트

### Phase 1 게이트

- baseline P0 green
- flaky test 0
- helper/fixture documented

### Phase 2 게이트

- baseline admin flows green
- traversal/bootstrap/security regressions green
- legacy/new install mode matrix green

### Phase 3 게이트

- pressure, slowloris, cache quota, reconnect leak green
- RSS/fd/cache/timer 메트릭 수집
- decompress upper bound regression green

### Phase 4 게이트

- protocol v1/v2 matrix green
- trust failure, spoofed identity, replay attach green
- invalid challenge/PoP reject green
- invalid packet ID/state reject green

### Phase 5 게이트

- staged apply/rollback green
- CLI/reset/keepAlive regression green

### Phase 6 게이트

- full matrix green
- canary checklist complete
- manual doc verification complete

## 실행 프로파일

- `Baseline Smoke`
- `Security Regression`
- `Soak`
- `Load`

## 승인 기준

- baseline 정상 기능 테스트 100% 통과
- 보안/회귀 테스트 100% 통과
- 장시간/부하 테스트의 핵심 메트릭 허용 범위 내
- 문서와 실제 secure-by-default 동작 일치
