# 구현 계획 — TTTGate 의존성 공급망 감사 (라운드 3)

- **문서 종류**: 구현 계획 (snoworca-planner §5.1)
- **작성일**: 2026-04-22
- **SPEC**: `docs/srs/backend-remediation-round3.md`
- **모드**: Normal (Opus×1 플래너)
- **Plan Revision**: 2 (평가자 Sonnet×2 findings 반영)
- **Phase 수**: 4
- **TASK 수**: 15
- **Mock 금지**: 전 Phase 적용 (SPEC §4 원칙 1)

---

## 0. Revision 2 반영 사항

| Finding | 심각도 | 조치 |
|---------|--------|------|
| 평가자1 HIGH (순서) | HIGH | **R3-REQ-03의 런타임 CRITICAL(form-data)을 Phase 1로 분리**. `@babel/traverse`는 빌드타임이므로 Phase 2 유지. Phase 1 = CRITICAL 전용. |
| 평가자2 HIGH (파일 P1-T4) | HIGH | P1-T4에 `npm ls crypto-js --prefix admin` 확인 + admin 번들 재빌드 후 lockfile 추적 추가. |
| 평가자1 MEDIUM (DoD P3) | MEDIUM | P3 DoD "잔존 시 문서화" 면제 조항 제거 → "MEDIUM 0건 OR 이월 REQ-ID 명시 + 승인" 이원화. |
| 평가자2 MEDIUM (P2-T6 negative) | MEDIUM | P2-T6에 multipart boundary 예측 negative 테스트 + `@babel/traverse` 잔존 grep 추가. |
| 평가자2 MEDIUM (P2-T3 fallback) | MEDIUM | R4 리스크에 `npm audit fix --force` 금지, major 업그레이드 감지 시 `resolutions`/`overrides` 수동 pin 절차 명시. |
| 평가자1 LOW (P4-T4 Mock) | LOW | P4-T4 자동(YAML 정적) vs 수동(의도 실패 PR) 범위 명시. |
| 평가자2 LOW (P3-T2 GHSA) | LOW | P3-T2에 `yaml GHSA-48c2-rrv3-qjmp`, `lodash GHSA-xxjr-mmjv-4gpg`, `qs GHSA-6rw7-vpxm-498p`, `js-yaml GHSA-mh29-5h37-fv8m`, `nanoid GHSA-mwcw-c2x4-8c55` 명시. |

---

## 1. 개요

SPEC R3-REQ-01 ~ R3-REQ-06 총 6건(CRIT 2 / HIGH 1 / MED 2 / LOW 1)을 4 Phase로 분해.

- **Phase 1 (CRITICAL 전용)**: R3-REQ-02 crypto-js 제거 + R3-REQ-03 런타임 CRITICAL(form-data) 분리 처리.
- **Phase 2 (런타임 HIGH + 빌드 CRIT)**: R3-REQ-01 node-forge 업그레이드 + `@babel/traverse` 빌드타임 CRITICAL.
- **Phase 3 (런타임 MEDIUM)**: R3-REQ-04 yaml/js-yaml/lodash/qs 등 정리.
- **Phase 4 (빌드타임 + CI 게이트)**: R3-REQ-05 dev 의존성 + R3-REQ-06 CI supply-chain 게이트.

---

## 2. 선행 조건

| 항목 | 조건 |
|------|------|
| 기준 커밋 | `refactor/safecode` @ `8884495` |
| 기존 테스트 | 257 tests PASS |
| 빌드 | `npm run build` 0 error |
| 증거 스냅샷 | `reports/npm-audit-before.json` 생성 후 커밋 |

---

## 3. Phase별 상세

### Phase 1 — crypto-js 제거 (R3-REQ-02, CRITICAL)

**의존성**: 없음 (최선행).
**근거**: `crypto-js`는 서버 체인 open CRITICAL. 현 코드는 **SHA512 단독 사용**이며 Node `crypto.createHash('sha512')`로 1:1 치환 가능.

| TASK-ID | 파일 | 변경 요약 |
|---------|------|-----------|
| P1-T1 | `src/server/admin/AdminServer.ts:1038` | `CryptoJS.SHA512(x).toString()` → `crypto.createHash('sha512').update(x).digest('hex')`. 상단 import 정리. |
| P1-T2 | `src/server/admin/SessionStore.ts:185` | 동일 치환. |
| P1-T3 | `src/server/CertificationStore.ts:388` | 동일 치환. |
| P1-T4 | `admin/src/controller/LoginCtrl.ts`, `admin/src/layout/InputCertFile.svelte` | admin 프런트엔드는 브라우저 환경 — Web Crypto `crypto.subtle.digest('SHA-512', ...)` 또는 `crypto-js` 최신 버전(admin 체인 fixed 상태)로 유지. **평가자2 HIGH 반영**: `npm ls crypto-js --prefix admin` 실행 → fixed 상태 재확인 + admin 체인 version 고정(package.json `"crypto-js": "^4.2.0"` 등). admin 번들 재빌드 후 `dist/` 디렉터리 변경 lockfile 추적. |
| P1-T7 | `package.json` | **Revision 2 신규**: R3-REQ-03 런타임 CRITICAL — `form-data` 전이 의존성 상위 패키지 식별(`npm ls form-data`) 후 상위 패키지 업그레이드. direct 의존성이면 `^4.0.4` 이상 고정. |
| P1-T8 | `test/supply-chain/r3-req-03-form-data.test.ts` (신규) | **Revision 2 신규**: `require('form-data/package.json').version >= '4.0.4'` assertion + multipart boundary 예측 negative 테스트(`form-data` 인스턴스 10개 생성 후 boundary uniqueness 증명). |
| P1-T5 | `package.json` | `crypto-js` 의존성 서버 측 제거. `npm uninstall crypto-js` + lockfile 재생성. admin은 별도 체인. |
| P1-T6 | `test/supply-chain/r3-req-02-crypto-js-removed.test.ts` (신규) | `npm ls crypto-js` 루트 0건 확인 + 기존 SHA512 해시가 Node crypto 치환 후에도 동일 bytes 출력 증명(고정 입력 회귀). |

**DoD**
- [ ] `grep -r "crypto-js" src/` 결과 0건 (admin/ 제외).
- [ ] `npm ls crypto-js` (루트) 결과 `(empty)`. `npm ls crypto-js --prefix admin` 결과 fixed 버전 고정 확인.
- [ ] 기존 AdminServer hash 기능 회귀 PASS (`serverOptionHash` API 동일 출력).
- [ ] `npm audit --production --audit-level=critical` 서버 체인 0건 (crypto-js + form-data).
- [ ] multipart boundary negative 테스트 PASS (10회 boundary 문자열 전부 고유).
- [ ] 회귀 257 + 신규 ≥ 2 PASS.

---

### Phase 2 — node-forge 업그레이드 + @babel/traverse 빌드 CRIT (R3-REQ-01, R3-REQ-03 잔여)

**의존성**: Phase 1 완료.
**근거**: node-forge HIGH 6건 + `@babel/traverse` 빌드타임 CRITICAL. (form-data 런타임 CRIT은 Revision 2로 Phase 1 이동.)

| TASK-ID | 파일 | 변경 요약 |
|---------|------|-----------|
| P2-T1 | `package.json` | `node-forge` → `^1.3.1` 이상으로 고정. `admin/package.json` 동일. |
| P2-T2 | `package-lock.json` | 재생성. 이전 lockfile 백업. |
| P2-T3 | `package.json` 전이 의존성 | `npm audit fix` 적용. `form-data`, `@babel/traverse` 체인 해결. 수동 업그레이드 필요 시 `npm update`. |
| P2-T4 | `src/commons/CACertGenerator.ts` | node-forge API 호환성 회귀 확인 (1.x major 내 최신화이므로 API 변경 없음 예상). 변경 없음이 목표. |
| P2-T5 | `test/supply-chain/r3-req-01-node-forge.test.ts` (신규) | `require('node-forge/package.json').version >= '1.3.1'` 검증 + 기존 `CACertGenerator` 단위 테스트 회귀 호출. |
| P2-T6 | `test/supply-chain/r3-req-03-critical-fixed.test.ts` (신규) | `npm audit --production --audit-level=critical --json` 실행 후 CRITICAL count 0 assertion. **Revision 2 보강**: `@babel/traverse` 버전 `require('@babel/traverse/package.json').version` 최소 안전 버전 이상 검증 + `package-lock.json` grep으로 `@babel/traverse` 버전 중복 존재 여부 확인(복수 버전 동시 존재 시 HIGH warning). |

**DoD**
- [ ] `npm ls node-forge` → `1.3.1` 이상 표기.
- [ ] `reports/npm-audit-after.json` 생성, CRITICAL=0, HIGH에서 node-forge advisory 0건.
- [ ] Admin TLS 인증서 생성·지문 안정성 smoke (b)/(c) PASS.
- [ ] 회귀 257 + 신규 ≥ 2 PASS.

---

### Phase 3 — 런타임 MEDIUM 정리 (R3-REQ-04)

**의존성**: Phase 2 완료.
**근거**: yaml/js-yaml/lodash/qs/nanoid/diff/formidable MEDIUM 계열.

| TASK-ID | 파일 | 변경 요약 |
|---------|------|-----------|
| P3-T1 | `package.json` | `yaml` 업그레이드. stack overflow MED 해소. |
| P3-T2 | `package.json` 전이 | `lodash` (`GHSA-xxjr-mmjv-4gpg` prototype pollution) / `qs` (`GHSA-6rw7-vpxm-498p` arrayLimit bracket DoS) / `nanoid` (`GHSA-mwcw-c2x4-8c55` 비정수 predictable) 간접 의존성 lockfile 갱신. `js-yaml` (`GHSA-mh29-5h37-fv8m` merge prototype pollution) 해소. `yaml` (`GHSA-48c2-rrv3-qjmp` stack overflow)는 P3-T1 범위. |
| P3-T3 | `admin/package.json` | `lodash` admin 체인 업데이트 (frontend 사용 — `InputCertFile.svelte` 등 확인). |
| P3-T4 | `test/supply-chain/r3-req-04-medium-cleared.test.ts` (신규) | `npm audit --production --audit-level=moderate --json` 출력에서 yaml/lodash/qs advisory 0건 assertion. |

**DoD (Revision 2: 면제 조항 제거, 이원화)**
- [ ] `npm audit --production --audit-level=moderate` 런타임 MEDIUM **0건** — 또는 잔존 advisory의 REQ-ID별 이월 승인 기록(`docs/srs/r3-deferred.md`에 GHSA, 패키지, 이월 사유, 후속 라운드 명시) 제출.
- [ ] 기존 ClientApp YAML 파싱 회귀 PASS (`test/unit/client/req-02-insecure-tls-yaml.test.ts` 유지).
- [ ] smoke 5체크 PASS.

---

### Phase 4 — 빌드타임 의존성 + CI 게이트 (R3-REQ-05, R3-REQ-06)

**의존성**: Phase 3 완료.
**근거**: vite/rollup/esbuild/svelte 빌드 의존성 + 재발 방지 CI 게이트.

| TASK-ID | 파일 | 변경 요약 |
|---------|------|-----------|
| P4-T1 | `admin/package.json` | `vite` 5.x 또는 현 major 최신. `svelte` 4.x 최신. `rollup` 4.x 최신. |
| P4-T2 | `admin/vite.config.ts` | vite 5 마이그레이션 시 설정 호환성 검증. |
| P4-T3 | `.github/workflows/supply-chain-audit.yml` (신규) | `on: [pull_request, schedule(monthly)]` → `npm ci && npm audit --production --audit-level=high` 실패 시 PR 차단. admin 체인도 동일 적용. |
| P4-T4 | `test/supply-chain/r3-req-06-ci-gate-dryrun.test.ts` (신규) | **Revision 2 범위 명시**: (1) **자동 범위** = workflow YAML 파싱하여 `audit-level: high` 존재 + `npm audit` step 존재 + `exit 1` 트리거 경로 존재 assertion. (2) **수동 범위** = 의도 실패 PR(고의 HIGH 의존성 추가) 1회 실행 후 CI 차단 증거 스크린샷을 `reports/r3-ci-gate-evidence.png`에 커밋. 자동 파트는 Jest에서, 수동 파트는 Phase 4 DoD 체크리스트에서 확인. |

**DoD**
- [ ] `admin/npm run build` 0 error. `node deploy.js` 통과.
- [ ] `.github/workflows/supply-chain-audit.yml` 존재 + `audit-level: high` 명시.
- [ ] 전체 회귀 257 + 신규 ≥ 4 PASS.
- [ ] `reports/npm-audit-after.json` 커밋 (before/after 비교 가능).

---

## 4. 스펙 매핑 (ZERO TOLERANCE)

| SPEC REQ | 심각도 | Phase | TASK-ID | 검증 파일 |
|----------|--------|-------|---------|-----------|
| R3-REQ-01 node-forge 업그레이드 | HIGH | 2 | P2-T1, P2-T4 | `r3-req-01-node-forge.test.ts` (P2-T5) |
| R3-REQ-02 crypto-js 제거 | CRITICAL | 1 | P1-T1~T5 | `r3-req-02-crypto-js-removed.test.ts` (P1-T6) |
| R3-REQ-03 form-data/@babel CRIT | CRITICAL | 2 | P2-T3 | `r3-req-03-critical-fixed.test.ts` (P2-T6) |
| R3-REQ-04 런타임 MEDIUM | MEDIUM | 3 | P3-T1~T3 | `r3-req-04-medium-cleared.test.ts` (P3-T4) |
| R3-REQ-05 빌드타임 의존성 | LOW | 4 | P4-T1, P4-T2 | admin 빌드 회귀 (P4-T2) |
| R3-REQ-06 CI 게이트 | MEDIUM | 4 | P4-T3 | `r3-req-06-ci-gate-dryrun.test.ts` (P4-T4) |

**커버리지**: 6/6 (100%).

---

## 5. 리스크 및 완화

| # | 리스크 | 영향 | 완화 |
|---|--------|------|------|
| R1 | node-forge 1.x → 1.3.x 사이 API 변경으로 CACertGenerator 회귀 | TLS 인증서 생성 실패 | 1.x 내 minor 업그레이드이므로 API 호환. P2-T4로 회귀 확인. 실패 시 1.x 내 최대 호환 버전으로 단계적 조정. |
| R2 | crypto-js 제거 후 기존 hash 출력 bytes 변경 | `serverOptionHash` 값 변경으로 admin 클라이언트 세션 재로그인 필요 | SHA512는 표준 알고리즘이므로 bytes 동일. P1-T6에서 고정 입력 회귀 증명. |
| R3 | admin vite 5 마이그레이션이 config 호환성 파괴 | admin 빌드 실패 | Phase 4에서 분리 진행. 실패 시 4.x 최신 유지하고 vite 5는 후속 라운드로 이월. |
| R4 | `npm audit fix` 가 lockfile 광범위 변경하여 재검토 부담 | PR 리뷰 시간 증가 | Phase별로 커밋 분리. `npm audit fix --dry-run` 먼저 실행 후 scope 확인. **Revision 2 보강**: `npm audit fix --force` **절대 금지** (semver-major 강제 업그레이드 유발). major 상위 패키지 필요 시 `package.json` `overrides` 필드로 **수동 pin** 선호 — 예: `"overrides": {"form-data": "^4.0.4"}`. `axios`/`superagent` 등 form-data 상위 패키지가 major 업그레이드를 요구하면 **별도 PR로 분리** 후 회귀 전수 검증. |
| R5 | admin 체인 crypto-js는 fixed 상태이지만 향후 open 가능성 | 재발 | P4-T3 CI 게이트가 admin 체인도 포함. |
| R6 | CI 게이트가 운영 배포 긴급 수정 PR도 차단 | 배포 속도 저하 | `audit-level: high`만 차단, moderate 이하는 WARN. 긴급 bypass는 `label: supply-chain-waiver` 수동 승인 경로 추가. |

---

## 6. 메타

```yaml
mode: Normal
planner: Opus x1
plan_revision: 2
phase_count: 4
task_count: 16
req_coverage: "6/6"
mock_policy: forbidden
test_naming: "test/supply-chain/r3-req-XX-<kebab>.test.ts"
zero_tolerance_spec_alignment: enforced
round_3_focus: "공급망 감사 + 런타임 CRIT/HIGH 제거 + CI 게이트"
revision_2_notes: "HIGH 2건(form-data Phase 1 이동, admin crypto-js 잔존 확인) + MEDIUM 3건(P3 DoD 면제 조항 제거, P2-T6 negative 보강, audit fix major fallback) + LOW 2건(P4-T4 자동/수동 범위, P3-T2 GHSA ID 명시) 반영. TASK 수 14 → 16(P1-T7/P1-T8 신규)."
```
