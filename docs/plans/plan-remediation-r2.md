# 구현 계획 — TTTGate 백엔드 결함 제거 라운드 2

- **문서 종류**: 구현 계획 (snoworca-planner §5.1)
- **작성일**: 2026-04-21
- **SPEC**: `docs/srs/backend-remediation-round2.md`
- **모드**: Normal (Opus×1)
- **Plan Revision**: 3 (라운드 3 개정 반영: 잔존 MEDIUM/LOW 마감)
- **Phase 수**: 3
- **TASK 수**: 9
- **Mock 금지**: 전 Phase 적용 (SPEC §5 원칙 1 NO-MOCK)

---

## 0. 라운드 3 개정 반영 사항 (이번 리비전)

Phase 1 게이트 통과(CRIT/HIGH 0) 확인됨. 잔존 MEDIUM/LOW를 반영하여 마감.

| Finding | 심각도 | 조치 | 영향 Phase/TASK |
|---------|--------|------|------------------|
| NF-01 (평가자1) | MEDIUM | `readInt8`/`readUInt8`의 `readIntLE(1)`/`readUIntLE(1)` 위임 체인을 **제거** — `Buffer.readInt8(0)`/`Buffer.readUInt8(0)` 직접 호출로 교체. 위임 체인에 남은 `Math.pow` 경로 완전 차단. | P1-T1 (구현 주의), P1 DoD (grep 추가) |
| NF-03 (평가자2) | MEDIUM | P2-T6에 line 232 `handlerWideIdMeta` 공용 블록의 **3개 CtrlCmd 전부(FailOfOpenSession / SuccessOfOpenSession / SuccessOfOpenSessionAck)** + line 238의 `CloseSession` = **총 4개 CtrlCmd 케이스** 명시. 누락되어 있던 `SuccessOfOpenSessionAck` 보강. | P2-T3 scope_note 레이블, P2-T6 |
| NF-04 (평가자2) | MEDIUM | `parseOpenData`(line 303-309)는 `BufferReader` 바이너리 파싱이며 `JSON.parse`가 없음. **`assertOpenOptMeta` 가드 불필요 → 제거**. 가드 목록을 6개 → **5개**로 축소(assertMessageMeta, assertSyncCtrlAckMeta, assertNewDataHandlerMeta, assertHandlerWideIdMeta, assertAckCtrlV2Meta). 6곳 JSON.parse ↔ 5 guard 매핑(line 232/238은 동일 `assertHandlerWideIdMeta` 공유) 명시. | P2-T3, P2-T6 |
| NF-02 (평가자1) | LOW | P2-T2: `onOverflow` 미주입 시 **기본 throw** 동작 테스트 케이스 1건 추가. | P2-T5 |
| NF-03 (평가자1) | LOW | P2-T1 설명에 "`fromBuffer` 내 `this.HEADER_LEN` static 참조 — `CtrlPacket.HEADER_LEN` static 참조 또는 `MAX_PAYLOAD_SIZE` 단일화로 제거" 주석 추가. | P2-T1 |

자기검증: MEDIUM 3건(NF-01, NF-03-eval2, NF-04) + LOW 2건(NF-02, NF-03-eval1) 반영 + req_mapping 6/6 유지 + HIGH 0 + MEDIUM 0 잔존.

라운드 2 개정 사항은 §0.1로 이동(이력 보존).

### 0.1 라운드 2 이력 (참고용)

| Finding | 심각도 | 조치 | 영향 Phase/TASK |
|---------|--------|------|------------------|
| F-01 | HIGH | R2-REQ-04 가드 적용 범위를 `JSON.parse` 6곳 전부로 확장. 공용 헬퍼 `safeJsonParse(data, assertFn)` 도입. | P2-T3, P2-T6 |
| F-02 | HIGH | Phase 1 DoD 재정의 — BE 기본 메서드 한정. | P1 DoD |
| F-03 | MEDIUM | 리스크 R8 신설 — 핫패스 가드 성능. | §6 R8 |
| F-04 | MEDIUM | 리스크 R1 보강 — 4개 디렉터리 전수 grep. | §6 R1, P1-T2 |
| F-05 | LOW | `[REDACTED]` 기준 명시. | P3-T1 |

---

## 1. 개요

SPEC R2-REQ-01 ~ R2-REQ-06 총 6건(HIGH 2 / MEDIUM 3 / LOW 1)을 3 Phase로 분해한다.
Phase는 **의존성 기준**으로 구성되며, 하위 유틸(BufferReader)부터 상위 프로토콜(CtrlPacket/Streamer/Schema),
마지막으로 경계 계층(Errors 민감정보 / ResourcePolicy 정책)으로 진행한다.

- **Phase 1 (기반 유틸)**: R2-REQ-02 BufferReader/BufferWriter 엔디언 일관화.
  이후 Phase에서 `CtrlPacket`/`DataStatePacket` 읽기·쓰기 회귀를 돌려야 하므로 최우선.
- **Phase 2 (프로토콜 견고성)**: R2-REQ-01 페이로드 한도 재정의 + R2-REQ-03 Streamer 누적 상한 +
  R2-REQ-04 메타 JSON 스키마 가드. 세 건 모두 `CtrlPacket.ts` 단일 파일을 공유하므로
  동일 Phase 내에서 병합 변경으로 충돌을 최소화한다.
- **Phase 3 (경계/운영 정책)**: R2-REQ-05 Errors↔SecretRedactor 통합 + R2-REQ-06 ResourcePolicy 엄격 모드.
  프로토콜 계층과 독립, 마지막에 적용.

모든 변경은 **실 Buffer / 실 소켓** 기반 테스트로 증명하며 Mock은 전면 금지한다.

---

## 2. 선행 조건

| 항목 | 조건 |
|------|------|
| 기준 커밋 | 라운드 1 완료 HEAD (`refactor/safecode` 최신) |
| 기존 테스트 | 197 tests 전수 PASS (회귀 0) |
| 빌드 | `npm run build` 0 error |
| Lint | `npm run lint` 0 error (ESLint strict) |
| Smoke | `node scripts/smoke.mjs` 5체크 PASS |
| 브랜치 | `refactor/r2-remediation` 신규 분기 권장 |
| 도구 재사용 | Jest, `timingSafeStringEqual`, `redactSecrets` 기존 유틸 |

---

## 3. 테스트 원칙 (SPEC §5 승계)

1. **NO-MOCK**: `jest.mock`, `sinon`, `nock`, `msw`, `useFakeTimers`, `memfs`, 가짜 객체 전면 금지.
2. **LIVE-PROCESS**: 프로토콜 검증은 실제 `Buffer`/실제 `net.Socket` 페어로 수행.
3. **DETERMINISM**: 타이밍·난수 의존 최소화. 필요 시 고정 시드.
4. **EVIDENCE-BASED DOD**: 모든 DoD는 실행 가능하며 출력으로 PASS/FAIL 확인 가능.
5. **NEGATIVE TESTS**: 악성 입력 거부를 반드시 증명 (거부 경로 별도 테스트).
6. **ISOLATION**: 임시 디렉터리(`os.tmpdir()` + `fs.mkdtempSync`), 포트 0 사용.
7. **NO-FLAKE**: 재시도 루프·sleep 은폐 금지. 실패는 그대로 실패로.
8. **SCOPE LOCK**: 파일명 `test/**/r2-req-XX-<kebab>.test.ts` 형식 고정.

---

## 4. Phase별 상세

### Phase 1 — BufferReader/BufferWriter 엔디언 일관화 (R2-REQ-02)

**의존성**: 없음 (최선행).
**목표**: 멀티바이트 **BE 기본 메서드는 공식 Node.js API로 환원**, LE 경로는 명시적 suffix로 유지.
**영향도**: `CtrlPacket`, `DataStatePacket`, 기존 197 tests.
**범위 정의 (F-02 반영)**:
- **대상(BE 기본)**: `readInt8`, `readInt16`, `readInt32`, `readUInt8`, `readUInt16`, `readUInt32` (및 Writer 대칭).
- **유지(명시적 LE)**: `readUIntLE`, `readIntLE` 메서드 자체는 LE 의미 보존 목적이므로 `Math.pow(256, ...)` 경로 유지 허용.
- **신설(명시적 LE suffix)**: `readInt16LE`, `readInt32LE`, `readUInt16LE`, `readUInt32LE` 및 Writer 대칭.

| TASK-ID | 파일 | 변경 요약 |
|---------|------|-----------|
| P1-T1 | `src/util/BufferReader.ts` | BE 기본 메서드 6종(`readInt8`/`readInt16`/`readInt32`/`readUInt8`/`readUInt16`/`readUInt32`)을 **공식 Node.js Buffer BE API**(`readInt8`, `readInt16BE`, `readInt32BE`, `readUInt8`, `readUInt16BE`, `readUInt32BE`) 기반으로 재작성. `readUInt32`는 이미 BE(line 130)이므로 유지. `readUIntLE`/`readIntLE`(line 73-91) LE 경로는 명시적 LE 목적이므로 **변경하지 않음**. 추가로 `readInt16LE`, `readInt32LE`, `readUInt16LE`, `readUInt32LE` 명시 suffix 메서드 신설(내부 `Buffer.read*LE` 호출). **구현 주의사항 (NF-01 반영)**: `readInt8`/`readUInt8` 구현을 **`Buffer.readInt8(0)` / `Buffer.readUInt8(0)` 직접 호출로 교체**한다. 기존 `readIntLE(1)` / `readUIntLE(1)` **위임 체인을 제거**하여 1바이트 경로에서도 `Math.pow` 잔존 가능성을 0으로 만든다. **verify_files (읽기 전용 grep 대상)**: `src/commons/CtrlPacket.ts`, `src/commons/DataStatePacket.ts`. |
| P1-T2 | `src/util/BufferWriter.ts` | 대칭으로 `writeInt16/32`, `writeUInt16/32` 기본을 **BE로 통일**하고 `*LE` 명시 suffix 추가. 기존 호출부에서 의도치 않게 LE를 쓰고 있었는지 **전수 grep**. **verify_files (읽기 전용 grep 대상)**: `src/client/**`, `src/server/**`, `src/commons/**`, `src/util/**`. |
| P1-T3 | `test/util/r2-req-02-buffer-endian.test.ts` (신규) | 실 `Buffer.alloc`으로 BE round-trip(`writeUInt32`→`readUInt32`) 2바이트/4바이트/8바이트 각 샘플 + LE round-trip 각각 2바이트/4바이트 샘플 + 교차 엔디언 실패 케이스(BE 쓰고 LE 읽으면 값 불일치) 증명. `DataStatePacket`/`CtrlPacket` 샘플 1건씩 기존 직렬화 bytes와 완전 일치 회귀 픽스처(hex 스냅샷) 포함. |

**DoD (측정 가능) — F-02 + NF-01 반영 재정의**
- [ ] **BE 기본 메서드 6종 구현 블록**(`readInt8`/`readInt16`/`readInt32`/`readUInt8`/`readUInt16`/`readUInt32` 및 Writer 대칭) **내부에 `Math.pow(256` 0건** (grep 확인). LE suffix 경로(`readUIntLE`/`readIntLE`)는 대상 외.
- [ ] **(NF-01) `readInt8` / `readUInt8` 구현 블록에 `readIntLE|readUIntLE` 위임 호출 grep 0건** — 1바이트 경로가 LE 위임을 우회하여 직접 `Buffer.readInt8(0)` / `Buffer.readUInt8(0)`을 호출함을 증명.
- [ ] BE 기본 메서드 6종이 각각 `Buffer.read*BE`(또는 1바이트의 경우 `Buffer.readInt8/readUInt8`) 단일 호출로 환원되었는지 코드 리뷰.
- [ ] 신규 테스트 파일 PASS, Jest 회귀 197 + 신규 ≥ 3 tests.
- [ ] `npm run build` 0 error, `npm run lint` 0 error.
- [ ] `scripts/smoke.mjs` 5체크 PASS (프로토콜 실 소켓 경로 손상 없음 확인).
- [ ] `src/client/**`, `src/server/**`, `src/commons/**`, `src/util/**` 호출부 BE/LE 의도 전수 확인 기록 (P1-T2 verify 결과 커밋 메시지에 포함).

---

### Phase 2 — CtrlPacket 페이로드 한도 + Streamer 상한 + 메타 JSON 스키마 (R2-REQ-01 / R2-REQ-03 / R2-REQ-04)

**의존성**: Phase 1 완료.
**목표**: 프로토콜 파서 DoS·경계·prototype pollution 내성 확보.
**영향도**: `src/commons/CtrlPacket.ts` 단일 파일 집중 + 신규 가드 모듈.

| TASK-ID | 파일 | 변경 요약 |
|---------|------|-----------|
| P2-T1 | `src/commons/CtrlPacket.ts` | (R2-REQ-01) line 45 `MAX_PAYLOAD_SIZE = 64000`을 **순수 페이로드 한도**로 명시 주석. line 264 `dataLength > MAX_PAYLOAD_SIZE + this.HEADER_LEN` → `dataLength > MAX_PAYLOAD_SIZE` 로 정정. 송신 측 `toBuffer` 직전에 `this._data.length > MAX_PAYLOAD_SIZE` 가드 추가(throw `RangeError`). `dataLength` 음수/NaN/4GB 경계는 `readUInt32`가 unsigned이므로 음수는 발생 불가이나, 상한 검증으로 커버. **NF-03(eval1) 반영**: `fromBuffer` 내 `this.HEADER_LEN` static 참조 오류 — `CtrlPacket.HEADER_LEN` static 참조로 교정하거나 `MAX_PAYLOAD_SIZE` 비교식으로 단일화하여 dead path 제거. |
| P2-T2 | `src/commons/CtrlPacket.ts` `CtrlPacketStreamer` | (R2-REQ-03) `maxPendingBytes = HEADER_LEN + MAX_PAYLOAD_SIZE * 2` 상수 정의. `feed(buffer)` 진입 시 현재 dequeue 누적 합 + `buffer.length` 계산 → 초과 시 **즉시 `_dequeue.clear()` + `onOverflow` 콜백(ctor 주입)** 호출. `onOverflow` **미주입 시 기본 동작은 `RangeError` throw** (하위 호환, 소비자 기존 try/catch로 흡수). `readPacket` 내부 `while` 루프의 `Buffer.concat` 전에도 상한 재확인. 상위 소비자(`TunnelServer`, `TunnelClient`)는 기존 try/catch로 에러 흡수됨을 확인만 하고 코드는 변경하지 않음. |
| P2-T3 | `src/commons/CtrlPacket.ts` + 신규 `src/commons/CtrlMetaGuards.ts` | (R2-REQ-04) **F-01 반영: `JSON.parse` 6곳 전부 적용**. **NF-04 반영: `parseOpenData`(line 303-309)는 `BufferReader` 바이너리 파싱이므로 `JSON.parse`가 없고 가드 대상이 아님 → `assertOpenOptMeta` 제거, 가드는 5종으로 축소**. 메타 타입별 순수 함수 `assertMessageMeta`, `assertSyncCtrlAckMeta`, `assertNewDataHandlerMeta`, `assertHandlerWideIdMeta`, `assertAckCtrlV2Meta` 구현 — 총 **5개 가드**. 각 가드는 (a) 필드 존재 (b) `typeof` 검사 (c) 문자열 길이 상한(기본 8192) (d) 숫자 범위(port: 1..65535 등) 화이트리스트 — **O(필드수) 경량 검사만, 깊은 순회 금지(F-03 반영)**. 공용 헬퍼 `safeJsonParse<T>(data: Buffer \| string, assertFn: (o:unknown)=>asserts o is T): T` 신설 — 내부에 reviver `(k,v)=> (k==='__proto__'\|\|k==='constructor'\|\|k==='prototype') ? undefined : v` 고정 적용 + 직후 `assertFn` 호출. **6곳 JSON.parse ↔ 5 guard 매핑**: line 107 `getMessageFromPacket` → `assertMessageMeta`, line 213 `syncCtrlAckMeta` getter → `assertSyncCtrlAckMeta`, line 220 `newDataHandlerMeta` getter → `assertNewDataHandlerMeta`, line 232 `handlerWideIdMeta`(FailOfOpenSession / SuccessOfOpenSession / **SuccessOfOpenSessionAck** 3개 CtrlCmd 공용) → `assertHandlerWideIdMeta`, line 238 `handlerWideIdMeta`(CloseSession) → `assertHandlerWideIdMeta` (동일 가드 공유), line 318 `parseAckCtrlData` → `assertAckCtrlV2Meta`. 실패 시 `null` 반환 또는 상위로 `Error` 전파(각 호출부 기존 시그니처 유지 원칙). |
| P2-T4 | `test/commons/r2-req-01-ctrl-payload-limit.test.ts` | 64000B 페이로드 정상 파싱 / 64001B 거부(`Data length too large` 검증) / 송신 시 `toBuffer` throw / `dataLength=0xFFFFFFFF` 거부. 실 `Buffer` 생성, Mock 금지. |
| P2-T5 | `test/commons/r2-req-03-streamer-overflow.test.ts` | `CtrlPacketStreamer` 인스턴스에 헤더 조각(5B) 을 `maxPendingBytes` 초과 때까지 반복 feed → `onOverflow` 콜백 호출 + `_dequeue` 비움 확인. **NF-02 반영: `onOverflow` 미주입 인스턴스에 동일 초과 입력 시 `RangeError` throw 케이스 1건 추가**. 정상 패킷 분할 전송(헤더 8B / 나머지) 1회 시나리오는 기존 동작 유지 회귀 증명. |
| P2-T6 | `test/commons/r2-req-04-meta-schema.test.ts` | **NF-03(eval2) 반영: line 232 블록의 3개 CtrlCmd(FailOfOpenSession / SuccessOfOpenSession / SuccessOfOpenSessionAck) + line 238의 CloseSession = 총 4개 CtrlCmd 케이스 명시**. 전체 검증 대상은 **5개 getter × CtrlCmd 케이스** 조합: (a) `getMessageFromPacket` (line 107), `syncCtrlAckMeta` getter (line 213), `newDataHandlerMeta` getter (line 220), `handlerWideIdMeta` (line 232, 3개 CtrlCmd: FailOpen / SuccessOpen / **SuccessOpenAck**), `handlerWideIdMeta` (line 238, CloseSession), `parseAckCtrlData` (line 318) 각각에 `{"__proto__":{"polluted":true}, ...정상필드...}` 직렬화 payload 주입 → parse 후 `({}).polluted === undefined` 증명 (b) 각 경로별 필수 필드 누락 메타 거부 (c) 각 경로별 정상 메타 통과 (d) `parseAckCtrlData`에 잘못된 타입(port를 문자열로) 주입 → 거부. |

**DoD (측정 가능)**
- [ ] R2-REQ-01: `grep "MAX_PAYLOAD_SIZE + this.HEADER_LEN"` 0건. 64001B 음성 / 64000B 양성 테스트 PASS. `this.HEADER_LEN` dead 참조 제거 확인.
- [ ] R2-REQ-03: `maxPendingBytes` 상수 정의 존재, overflow 테스트 PASS (콜백 경로 + 기본 throw 경로 모두), 정상 분할 전송 회귀 PASS.
- [ ] R2-REQ-04: `CtrlMetaGuards.ts` 신규 파일 존재, `safeJsonParse` 공용 헬퍼 존재, **CtrlPacket.ts의 `JSON.parse` 6곳 전부 `safeJsonParse`로 환원**(직접 `JSON.parse` 잔존 0건 grep 확인), **5개 가드(Message/SyncCtrlAck/NewDataHandler/HandlerWideId/AckCtrlV2)** export, 6곳↔5가드 매핑표 주석 포함. `handlerWideIdMeta` 경로 3 + 1 = **4개 CtrlCmd 케이스** 모두 `__proto__` 오염 음성 PASS.
- [ ] 회귀: 기존 197 + Phase 1 신규 + Phase 2 신규 ≥ 13 tests 전수 PASS (NF-02 추가 1건 반영).
- [ ] Smoke 5체크 PASS.

---

### Phase 3 — Errors 민감정보 redact 통합 + ResourcePolicy 엄격 모드 (R2-REQ-05 / R2-REQ-06)

**의존성**: Phase 2 완료(프로토콜 에러 경로 안정화 이후 로거 통합).
**목표**: 예외·로그 경로 비밀값 노출 차단 + 운영자 설정 오류 가시화.

| TASK-ID | 파일 | 변경 요약 |
|---------|------|-----------|
| P3-T1 | `src/util/SecretRedactor.ts` | 문자열 레벨 `redactSecretString(text: string): string` 신규 export. 정규식 화이트리스트: `/authorization:\s*\S+/gi`, `/-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g`, `/\b(key\|token\|secret\|password\|authkey)\s*[:=]\s*\S+/gi`, `/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g` (bcrypt), `/\b[a-f0-9]{64,}\b/gi` (hex ≥64). **치환은 기존 `SecretRedactor.REDACTED_VALUE = "[REDACTED]"` 상수를 재사용(F-05 반영: SPEC의 `***`는 예시이며 코드 구현 기준값은 `[REDACTED]`)**. 기존 객체 redactor는 유지. |
| P3-T2 | `src/util/Errors.ts` | `toString` 반환 직전 `redactSecretString` 적용. `serialize(error): {message, stack, cause}` 신규 메서드도 추가하여 전 필드 redact. `printError` 내부에서 `message`, stack 각각 redact. |
| P3-T3 | `src/util/logger/LoggerFactory.ts` | 로거 생성 시 **post-processor 훅** 주입: 최종 write 직전 문자열 메시지에 `redactSecretString` 적용. 구조화 객체 payload는 기존 `redactSecrets` 객체 버전으로 처리 (우회 경로 차단 목적). 구현 방식은 기존 로거 어댑터 내 `format` 함수 래핑(Mock 금지, 실 로거 사용). |
| P3-T4 | `src/util/ResourcePolicy.ts` | `clampRatio`/`normalizeByteLimit` 진입 시 **부적합 입력 감지 → `logger.warn`** 1회 출력(`ResourcePolicy: invalid ratio=<v>, clamped to <fallback>`). `strict` 플래그: 모듈 레벨 `let strict = process.env.RESOURCE_POLICY_STRICT === "1"`, export `configureStrict(on: boolean): void`. strict일 때 clamp 대신 `RangeError` throw. `current()`에서도 strict 시 override 검증 단계에서 throw. |
| P3-T5 | `test/util/r2-req-05-errors-redact.test.ts` | (a) `new Error("authKey=abcdef123456")` → `Errors.toString(e)` 결과에 `abcdef123456` 미포함, `[REDACTED]` 포함. (b) bcrypt 해시 원문 미노출. (c) PEM 블록 미노출. (d) Logger post-processor 경로에서 동일 보장. 실 로거(파일 기반) 사용, 임시 디렉터리에서 검증. |
| P3-T6 | `test/util/r2-req-06-resource-policy-strict.test.ts` | (a) 기본 모드: `ResourcePolicyRegistry.configure({highWatermarkRatio: 1.5})` → `current().highWatermarkRatio === 0.95` + WARN 로그 captured. (b) strict: `configureStrict(true)` 후 동일 호출 → `RangeError` throw. (c) `RESOURCE_POLICY_STRICT=1` env로 모듈 재로드 시 strict 활성 (테스트 격리 위해 `jest.isolateModules` 허용 — Mock 아님, 모듈 캐시 분리 Node API). |

**DoD (측정 가능)**
- [ ] R2-REQ-05: 비밀 토큰 원본 문자열이 `Errors.toString`/로거 출력 어디에도 미포함(grep 기반 assertion). 5가지 패턴(Authorization, PEM, key=, bcrypt, hex≥64) 각 1건 negative test PASS. 치환 토큰은 `[REDACTED]`.
- [ ] R2-REQ-06: WARN 로그 1건 이상 captured + strict 모드 throw 검증 PASS. `RESOURCE_POLICY_STRICT=1` 경로 별도 PASS.
- [ ] `npm run lint` 0 error, `npm run build` 0 error.
- [ ] 전체 회귀: 197 (라운드1) + Phase 1 (≥3) + Phase 2 (≥9, NF-02 포함) + Phase 3 (≥6) tests 모두 PASS.
- [ ] Smoke 5체크 PASS.
- [ ] `jest.config.ts` `collectCoverageFrom`에 `src/commons/CtrlPacket.ts`, `src/commons/CtrlMetaGuards.ts`, `src/util/BufferReader.ts`, `src/util/Errors.ts`, `src/util/SecretRedactor.ts`, `src/util/ResourcePolicy.ts` 포함, threshold 60 유지.

---

## 5. 스펙 매핑 (ZERO TOLERANCE)

| SPEC REQ | 심각도 | Phase | TASK-ID | 검증 테스트 파일 |
|----------|--------|-------|---------|------------------|
| R2-REQ-01 페이로드 한도 재정의 | HIGH | 2 | P2-T1 | `test/commons/r2-req-01-ctrl-payload-limit.test.ts` (P2-T4) |
| R2-REQ-02 BufferReader 엔디언 일관화 | HIGH | 1 | P1-T1, P1-T2 | `test/util/r2-req-02-buffer-endian.test.ts` (P1-T3) |
| R2-REQ-03 Streamer 누적 상한 | MEDIUM | 2 | P2-T2 | `test/commons/r2-req-03-streamer-overflow.test.ts` (P2-T5) |
| R2-REQ-04 메타 JSON 스키마 | MEDIUM | 2 | P2-T3 | `test/commons/r2-req-04-meta-schema.test.ts` (P2-T6) |
| R2-REQ-05 Errors↔redact 통합 | MEDIUM | 3 | P3-T1, P3-T2, P3-T3 | `test/util/r2-req-05-errors-redact.test.ts` (P3-T5) |
| R2-REQ-06 ResourcePolicy 엄격 모드 | LOW | 3 | P3-T4 | `test/util/r2-req-06-resource-policy-strict.test.ts` (P3-T6) |

**커버리지**: 6 / 6 (100%).

---

## 6. 리스크 및 완화

| # | 리스크 | 영향 | 완화 |
|---|--------|------|------|
| R1 | Phase 1 엔디언 변경이 기존 `DataStatePacket`/`CtrlPacket` 직렬화 bytes를 무심코 변경 | 프로토콜 호환성 파괴, 구버전 클라와 불일치 | **F-04 반영**: 현행 `readInt16`/`readUInt16`은 이미 BE(`bytes[0]*256+bytes[1]`), `readUInt32`는 `readUInt32BE` 호출 중이라 BE 공식 API 환원 시 실제 바이트 변경 가능성 낮음. `DataStatePacket`은 `Buffer.*BE` 직접 사용 → `BufferReader` 변경 영향 밖. **`BufferWriter` 대칭 환원은 호출부 의도 확인 필수**. P1-T3에서 hex 스냅샷 회귀 픽스처로 기존 bytes 불변 증명, 실제 소켓 페어 엔드투엔드 smoke 필수. 구현 전 현행 bytes 샘플을 먼저 캡처. P1-T2는 `src/client/**`, `src/server/**`, `src/commons/**`, `src/util/**` 전수 grep으로 LE 의존 호출부 검출. |
| R2 | R2-REQ-01 한도 재정의가 이미 운영 중인 경계 근처 페이로드(예: 64001~64009B)를 거부하여 실전 장애 | 기능 회귀 | SPEC 기준 `MAX_PAYLOAD_SIZE=64000` 유지이며 기존 `+HEADER_LEN` 여유분(약 15B)은 **의도치 않은 초과분**이었음을 `docs/plans/plan-remediation-r2.md` 및 커밋 메시지에 명시. 운영 모니터링 가이드 추가. |
| R3 | R2-REQ-03 overflow 콜백 시그니처 변경이 `CtrlPacketStreamer` 소비자 전 경로에 파급 | API 브레이킹 | ctor **옵션 파라미터**로 `{onOverflow?: (err)=>void, maxPendingBytes?: number}` 도입, 미지정 시 기본 throw 동작으로 하위 호환. 기존 호출부 변경 0건 목표. P2-T5에서 기본 throw 경로 명시 테스트(NF-02). |
| R4 | R2-REQ-04 스키마 가드가 기존 v1 AckCtrl 메타(v2 없는 경우)를 거부 | 하위 호환 파괴 | `parseAckCtrlData`는 v2 블록 존재 시만 `assertAckCtrlV2Meta` 호출. 기존 try/catch fallback 유지. 5개 가드 각각 실패 시 기존 시그니처(`null` 반환 또는 throw) 준수. |
| R5 | R2-REQ-05 문자열 redact 정규식 과매칭으로 일반 hex 식별자(git SHA 등) 오탐 | 로그 가독성 저하 | hex 임계값 64자로 설정(git SHA 40자 미만). 오탐 발생 시 whitelist 추가 가이드 문서화. |
| R6 | R2-REQ-06 strict 모드 활성 시 운영 중 즉시 throw로 서버 크래시 | 운영 리스크 | strict는 **명시적 opt-in**(env 또는 `configureStrict`)만으로 활성, 기본은 WARN만. 릴리스 노트에 변경 점 명시. |
| R7 | Jest 모듈 캐시 격리 사용이 "Mock 금지" 원칙 회색지대 | 원칙 위반 오해 | `jest.isolateModules`는 모듈 캐시 분리이며 함수 대체(Mock)가 아님을 테스트 주석과 본 계획 §3에 명시. |
| R8 | **F-03 반영: `assertXMeta` 가드가 패킷 핫패스에서 매 수신마다 필드 순회 → 성능 영향** | **처리량 저하, 지연 증가** | **가드는 O(필드수) 경량 검사(typeof + 문자열 길이 상한)만 수행, 깊은 순회·정규식·재귀 금지. 기본 필드 개수 ≤ 8. 필요 시 `process.env.CTRL_META_DEEP_VALIDATE === "1"`일 때만 deep validate 활성. 마이크로 벤치(10k parse) 기준 기존 대비 < 5% 오버헤드 목표.** |

---

## 7. 메타

```yaml
mode: Normal
planner: Opus x1
plan_revision: 3
phase_count: 3
task_count: 9
req_coverage: "6/6"
mock_policy: forbidden
test_naming: "test/**/r2-req-XX-<kebab>.test.ts"
zero_tolerance_spec_alignment: enforced
round_2_notes: "HIGH F-01(P2-T3 범위 확장 6곳 + safeJsonParse), HIGH F-02(P1 DoD 재정의 BE 기본 메서드 한정), MEDIUM F-03(R8 성능 가드), MEDIUM F-04(R1 보강 + grep 전수 디렉터리 명시), LOW F-05([REDACTED] 기준 명시)"
round_3_notes: "MEDIUM NF-01(P1-T1 readInt8/UInt8 위임 체인 제거 + DoD grep 추가), MEDIUM NF-03-eval2(P2-T6 line 232 3개 CtrlCmd + line 238 CloseSession = 4개 CtrlCmd 케이스 명시, SuccessOfOpenSessionAck 누락 보강), MEDIUM NF-04(assertOpenOptMeta 제거, 가드 6→5개로 축소, 6 JSON.parse ↔ 5 guard 매핑 명시), LOW NF-02(P2-T5 onOverflow 미주입 기본 throw 케이스 추가), LOW NF-03-eval1(P2-T1 fromBuffer this.HEADER_LEN dead 참조 제거 주석)"
```
