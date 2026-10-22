# SRS — TTTGate 백엔드 결함 제거 라운드 2

- **문서 종류**: 연구문서 유래 SRS (라운드 1 후속 — 도윤 X-01~X-06 감사 기반)
- **작성일**: 2026-04-21
- **범위**: `src/commons/CtrlPacket.ts`, `src/commons/DataStatePacket.ts`, `src/util/BufferReader.ts`, `src/util/Errors.ts`, `src/util/SecretRedactor.ts`, `src/util/ResourcePolicy.ts`, `src/util/logger/**` (일부)
- **제외**: 라운드 1에서 이미 처리된 영역 (`src/server/admin`, `src/server/http`, `src/util/TlsOptionsFactory`, `src/util/timingSafeStringEqual`, `src/util/ClockRng`, `src/util/ObjectUtil`, `src/server/TunnelServer`, `src/client/**`)
- **근거**: 도윤(fullstack-3) 횡단 감사 X-01~X-06 + 원 분석의 REQ-23 이월 항목
- **목표**: 프로토콜 견고성·경계 검증·DoS·민감정보 노출·설정 일관성 마감.

---

## 1. 개요

라운드 1에서 의도적으로 이월한 공통 프로토콜·유틸 층의 잔존 결함을 제거한다. 라운드 1은 서버/클라/TLS/Admin/HTTP 축에 집중했고, 이번 라운드 2는 **프로토콜 파서 견고성 + 민감정보 경계 + 설정 일관성** 3축을 다룬다. 6건 전부 해결 목표.

---

## 2. 선행 조건

- 기준 커밋: 라운드 1 완료 직후 HEAD
- 라운드 1의 도구(Jest, ESLint strict, smoke 5체크, timingSafeStringEqual 등) 재사용
- 기존 197 tests 회귀 0건
- Mock 금지 (SPEC §5 라운드 1 원칙 승계)

---

## 3. 요구사항

### R2-REQ-01 — CtrlPacket 페이로드 한도 재정의 (X-01)
- **근거**: 도윤 X-01. `src/commons/CtrlPacket.ts:45,264`. `MAX_PAYLOAD_SIZE + HEADER_LEN` 혼재로 실제 허용치 누수.
- **요구사항**:
  - `MAX_PAYLOAD_SIZE`를 **순수 페이로드 바이트 한도**로 정의(기본 64000).
  - 수신 검증: `if (dataLength > MAX_PAYLOAD_SIZE) reject`. 헤더 길이 별도 검사.
  - 송신 측도 동일 한도 적용.
- **검증**: 64001B 페이로드 거부 + 64000B 정상 통과 + 4GB 음수/대수 거부 단위 테스트.
- **심각도**: HIGH

### R2-REQ-02 — BufferReader 엔디언 일관화 (X-02)
- **근거**: 도윤 X-02. `src/util/BufferReader.ts` LE/BE 메서드 혼재.
- **요구사항**:
  - 네트워크 프로토콜은 BE 원칙. 기본 메서드(`readUInt32`, `readInt32` 등)는 **BE로 통일**.
  - LE가 필요한 경로는 **명시적 suffix**(`readUInt32LE`, `readInt32LE`) 사용.
  - `DataStatePacket`/`CtrlPacket`의 읽기/쓰기 엔디언 교차 확인 후 불일치 제거.
  - `BufferWriter`도 동일 검사.
- **검증**: 엔디언별 round-trip 테스트(BE 쓰고 BE 읽기 / LE 쓰고 LE 읽기) + 현재 프로토콜 파싱 회귀 0건.
- **심각도**: HIGH

### R2-REQ-03 — CtrlPacketStreamer 누적 버퍼 상한 (X-03)
- **근거**: 도윤 X-03. `src/commons/CtrlPacket.ts:370-381`. 불완전 패킷 누적 시 DoS.
- **요구사항**:
  - Streamer에 `maxPendingBytes = HEADER_LEN + MAX_PAYLOAD_SIZE * 2` 상한(예: 128030B).
  - 초과 시 즉시 버퍼 폐기 + 연결 종료 요청(상위 콜백).
  - `Buffer.concat` 호출 전 선판정.
- **검증**: 악의 피어가 헤더 조각만 보내는 재현 페이로드로 상한 도달 시 연결 종료 테스트.
- **심각도**: MEDIUM

### R2-REQ-04 — CtrlPacket 메타 JSON 스키마 검증 (X-04)
- **근거**: 도윤 X-04. `src/commons/CtrlPacket.ts:95-108,209-241`. `JSON.parse` 후 스키마 검증 없음.
- **요구사항**:
  - 각 메타 타입(SyncCtrlAck, NewDataHandler, HandlerWideId, log, sysinfo 등)별 런타임 가드 `assertXMeta(obj): asserts obj is XMeta`.
  - 필드명·타입·길이·값 범위 화이트리스트.
  - `JSON.parse`에 `reviver`로 `__proto__`/`constructor`/`prototype` 키 drop.
  - 가드 실패 시 패킷 폐기 + 로그(redacted).
- **검증**: prototype pollution 페이로드(`{"__proto__": {"polluted": true}}`) 거부 + 정상 메타 통과 + 잘못된 타입 거부 단위 테스트 각 1건.
- **심각도**: MEDIUM

### R2-REQ-05 — Errors.toString redactSecrets 통합 (X-05)
- **근거**: 도윤 X-05. `src/util/Errors.ts` + `src/util/SecretRedactor.ts`. 예외 메시지/stack에 비밀값 누출 가능.
- **요구사항**:
  - `Errors.toString` 및 `Errors.serialize` 출력에 `redactSecrets` 적용.
  - 문자열 레벨 정규식 필터 추가: `key=...`, `-----BEGIN`, `Authorization: ...`, `token=...`, `secret=...`, bcrypt 해시 패턴, hex 64자+ 패턴.
  - Logger post-processor 훅으로도 우회 경로 차단 (logger 진입 시 최종 redact).
- **검증**: `new Error("authKey=abcdef...")`의 toString 결과에 원본 비밀이 포함되지 않고 `***`로 치환되는 테스트. bcrypt/PEM 패턴 동일.
- **심각도**: MEDIUM

### R2-REQ-06 — ResourcePolicyRegistry 엄격 모드 경고/예외 (X-06)
- **근거**: 도윤 X-06. `src/util/ResourcePolicy.ts:23-35,43-62`. 무음 클램프로 운영자 오류 삼킴.
- **요구사항**:
  - 잘못된 ratio(>0.95, ≤0.05), 음수 byte limit, NaN 등 발견 시 `logger.warn` 필수.
  - `RESOURCE_POLICY_STRICT=1` 환경변수 또는 `configureStrict(true)` API 제공 시 `RangeError` throw.
  - `timingSafeStringEqual`의 `expectedLength` 0/음수 → throw 정책과 대칭성 확보.
- **검증**: 기본 모드에서 WARN 로그 포함 + strict 모드에서 throw 확인 단위 테스트.
- **심각도**: LOW

---

## 4. 범위 외 (후속)
- `admin/` 프론트엔드 보안 라운드 (Task #24, 도윤 U-01~U-05 재활용)
- `src/util/logger` 세부 회전 정책, 로그 레벨 일관화 (이 라운드에선 post-processor 훅만)

---

## 5. 테스트 원칙 (라운드 1 승계)

1. **NO-MOCK**: `jest.mock`, `sinon`, `nock`, `msw`, `useFakeTimers`, `memfs`, 가짜 객체 전면 금지
2. **LIVE-PROCESS**: 프로토콜 검증은 실 Buffer / 실 소켓 페어
3. **DETERMINISM**: 랜덤/타이밍 의존 최소화
4. **EVIDENCE-BASED DOD**: 실행 가능·측정 가능
5. **NEGATIVE TESTS**: 악성 입력 거부 증명 필수
6. **ISOLATION**: 임시 디렉터리, 포트 0
7. **NO-FLAKE**: 재시도/여유 숨김 금지
8. **SCOPE LOCK**: `test/**/req-XX-<kebab>.test.ts` (라운드 2 접두사는 `r2-req-XX-`)

---

## 6. 비기능 요구사항

- 라운드 1 197 tests 회귀 0건
- `npm run build` / `npm run lint` / `node scripts/smoke.mjs` 유지
- ESLint strict 0 error 유지
- `jest.config.ts` `collectCoverageFrom`에 이번 라운드 대상 파일 추가, threshold 60 유지

---

## 7. 산출물

- 코드 수정 패치 (commons/util 중심)
- R2-REQ-01~06 별 테스트 파일 (`test/**/r2-req-XX-*.test.ts`)
- 변경 요약
