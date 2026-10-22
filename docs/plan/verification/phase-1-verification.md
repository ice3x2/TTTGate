# Phase 1 검증 문서

## 상태

- 진행 상태: `완료`
- 완료 범위:
  - `Environment` root override seam
  - deterministic `ClockRng`
  - `Scheduler` / `TTTClientRuntime`
  - `SystemInfoProvider`
  - `TlsOptionsFactory`
  - `QueueLimiter`
  - `AppCompositionRoot`
  - `SessionStore` / `ServerOptionStore` / `CertificationStore` singleton reset hook
  - `TTTClient` / `TunnelClient` / `EndPointClientPool` 테스트 종료 seam
  - `TunnelHarness` / `resourceStats`
  - `unit` / `component` / `e2e` / `stress` 기준선 테스트 17건
  - security regression red candidate 문서화

## 완료 체크리스트

- [x] helper/fixture 추가 완료
- [x] baseline P0 테스트 통과
- [x] seam 리팩토링이 behavior-preserving임을 확인
- [x] reconnect churn 기준선 수집
- [x] RSS/FD/cache/timer 기준선 수집
- [x] exploit red candidate 문서화

## 테스트 결과

- unit: ✅ `6 suites / 12 tests`
- component: ✅ `1 suite / 3 tests`
- e2e baseline: ✅ `1 suite / 1 test`
- stress baseline: ✅ `1 suite / 1 test`

## 품질 평가

- Plan-Code 정합성: ✅
- 테스트 시나리오 품질: ✅
- 구조적 일관성: ✅

## 이슈

- `SysMonitor`는 현재 실행 환경에서 CPU 정보가 비어 있을 수 있어 control handshake 중 `sysinfo` 전송이 실패했다.
  - Phase 1에서는 `SystemInfoProvider` seam으로 baseline 터널 테스트를 격리했다.
  - 실제 운영 경로의 방어 로직 추가는 후속 phase에서 수행한다.
- `PathResolver`, `FileSystem`, `TransportFactory`, `BufferBudget`, `SpoolStore`는 독립 모듈로 분해하지 않고 실제로 필요한 seam인 `TlsOptionsFactory`, `QueueLimiter`, `AppCompositionRoot`, `TunnelHarness`로 먼저 수렴시켰다.
  - 추가 분해는 Phase 2+ 구현 중 필요할 때 진행한다.

## 회귀 결과

- [x] 기존 정상 기능 유지 확인
- [x] flaky test 0건

## 승인 체크리스트

- [x] 다음 Phase 진입 승인

## evidence

- [Phase 1 evidence](./evidence/baseline/phase-1/2026-04-19-phase-1.md)
- [Red candidate 목록](./evidence/baseline/phase-1/2026-04-19-red-candidates.md)
