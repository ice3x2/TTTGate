# Phase 6 검증 문서

## 완료 체크리스트

- [x] README/sample config 동기화
- [x] version/config source 정리
- [x] `POL-5.6` 정책 문서화
- [x] final validation 채움

## 테스트 결과

- full matrix: ✅
- mixed-version canary rehearsal: ✅
- doc verification: ✅
- soak/stress: ✅
- `npm run build`: ✅
- `npm test -- --runInBand`: ✅ (`28 suites / 65 tests passed`)

## 품질 평가

- 문서 정합성: ✅
- 배포 준비도: ✅
- 정책 명확성: ✅

## 이슈

- 없음

## 구현 요약

- `Environment.version.name`이 실제 runtime 위치에서 `package.json` 버전을 읽도록 정리했다.
- 저장소 루트 `config.yaml`을 제거하고 `config/server.sample.yaml`, `config/client.sample.yaml`, `config/README.md`로 실제 런타임 경로 기준의 샘플을 제공한다.
- 신규 HTTP/HTTPS 터널의 `replaceAccessControlAllowOrigin` 기본값을 `false`로 바꾸고, 기존 저장 설정에서 필드가 비어 있으면 load 시 legacy `true`를 유지하면서 경고를 남긴다.
- README, CLI help, mixed-version rollout/cutover/rollback 문서를 secure-by-default 동작과 일치시켰다.
- 문서 정합성 검증 테스트와 버전/CORS migration 테스트를 추가했다.

## 증적 문서

- [2026-04-20 Phase 6 증적](./evidence/hardened/phase-6/2026-04-20-phase-6.md)

## 회귀 결과

- [x] 문서 기반 설치 검증 통과
- [x] mixed-version 배포 검증 통과

## 승인 체크리스트

- [x] 저장소 기준 최종 배포 승인
- [x] 운영 canary/rollback 절차 문서화 완료
