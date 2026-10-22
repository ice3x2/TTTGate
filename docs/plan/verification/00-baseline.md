# Baseline 검증 문서

## 목적

보안 수정을 시작하기 전에 현재 정상 기능과 현재 운영 환경의 관측값을 고정 포맷으로 기록한다. 이 문서는 이후 `hardened` 결과와 같은 메트릭으로 비교하기 위한 기준점이다.

## 수집 항목

- [x] `npm run build`
- [x] `npm test -- --runInBand`
- [x] 관리자 로그인/조회 기본 흐름
- [x] TCP tunnel echo
- [x] reconnect 성공 여부
- [x] 현재 기본 key/TLS/buffer/keepAlive 설정
- [x] RSS/FD/cache/timer baseline

## evidence 경로

- `verification/evidence/baseline/phase-0/`
- [2026-04-19-baseline.md](./evidence/baseline/phase-0/2026-04-19-baseline.md)
- [2026-04-19-phase-1.md](./evidence/baseline/phase-1/2026-04-19-phase-1.md)
- [2026-04-19-red-candidates.md](./evidence/baseline/phase-1/2026-04-19-red-candidates.md)

## 수집 결과

- 수정 전 상태:
  - `npm run build` 성공
  - `npm test -- --runInBand` 실패
  - 사유: `No tests found`
- Phase 1 기준선 하네스 추가 후 상태:
  - `npm run build` 성공
  - `npm test -- --runInBand` 성공
  - 결과: `6 suites / 12 tests passed`
- 현재 기준선에 포함된 정상 흐름:
  - 관리자 정적 자산 서빙
  - 관리자 로그인 후 세션 검증
  - `SessionStore` 세션 발급/만료
  - `ServerOptionStore` 기본 설정 생성/터널 옵션 정규화 경로
  - `CtrlPacket`, `DataStatePacket` 바이너리 계약
  - server-client-external TCP echo 터널 왕복
  - server restart 후 client reconnect와 재개통
  - RSS/FD/cache/socket buffer 자원 메트릭 수집
- 잔여 baseline 항목:
  - 없음

## 승인 기준

- [x] baseline 증적이 이후 phase와 1:1 비교 가능한 형식으로 저장됨
- [x] 현재 정상 기능과 현재 취약 동작이 구분되어 문서화됨
