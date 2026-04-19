# Phase 5 검증 문서

## 완료 체크리스트

- [x] staged apply/rollback 적용
- [x] partial failure reporting 적용
- [x] keepAlive/CLI 정리 완료
- [x] response envelope 정리 완료

## 테스트 결과

- staged apply: ✅
- rollback: ✅
- CLI parser: ✅
- keepAlive propagation: ✅
- `npm run build`: ✅
- `npm test -- --runInBand`: ✅ (`26 suites / 61 tests passed`)

## 품질 평가

- 설정 안정성: ✅
- 운영 가시성: ✅
- 사용성: ✅

## 이슈

- 없음

## 구현 요약

- `ServerOptionStore`, `CertificationStore`에 atomic temp-file commit과 revision metadata를 추가했다.
- `AdminServer` 설정/인증서 API는 preflight 후 runtime apply가 성공했을 때만 commit하며, 재시작 필요 범위는 `partial`과 `restartRequiredScopes`로 노출한다.
- `CLI.parseCommandLine()`으로 모드 판별과 옵션 해석을 분리했고 `app.ts`/`ClientApp.ts`/`ServerApp.ts`가 이를 공통 사용한다.
- `TunnelClient`와 `TunnelServer` control channel의 `keepAlive` 전달이 실제 소켓까지 연결되도록 수정했다.
- `ExternalPortServerPool.stop()`의 성공 의미와 forward-port map 정리를 바로잡았다.

## 증적 문서

- [2026-04-20 Phase 5 증적](./evidence/hardened/phase-5/2026-04-20-phase-5.md)

## 회귀 결과

- [x] 기존 서비스 유지 확인
- [x] partial failure 시 영향 범위 정확

## 승인 체크리스트

- [x] 다음 Phase 진입 승인
