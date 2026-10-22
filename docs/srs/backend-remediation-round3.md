# SRS — TTTGate 의존성 공급망 감사 (라운드 3)

- **문서 종류**: 연구문서 유래 SRS (Dependabot 감사 기반)
- **작성일**: 2026-04-22
- **출처**: `refactor/safecode` @ `8884495` 푸시 후 GitHub Dependabot 108건 경고
- **범위**: `package.json`, `package-lock.json`, `admin/package.json`, `admin/package-lock.json`
- **제외**: 애플리케이션 코드 결함(라운드 1·2에서 완료)
- **목표**: 런타임 직접 노출 CRITICAL/HIGH 취약점 제거 + CI 공급망 게이트 정착.

---

## 1. 배경

Dependabot 경고 108건 (manifest × advisory 중복 포함) — 고유 advisory ≈ 50여 개.
대부분은 빌드/개발 의존성(vite/rollup/esbuild/svelte SSR/picomatch 등)이며 실전 런타임 영향 미미.
그러나 **런타임 직접 사용 패키지의 심각 취약점**이 식별되어 별도 라운드로 처리한다.

---

## 2. 요구사항

### R3-REQ-01 — node-forge 업그레이드 (HIGH)
- **근거**: `node-forge` GHSA 6건 HIGH 집중 — RSA-PKCS/Ed25519 서명 위조, basicConstraints bypass, ASN.1 Unbounded Recursion, `modInverse()` 무한 루프 DoS, ASN.1 Validator Desync.
- **영향 경로**: `src/commons/CACertGenerator.ts` (서버 인증서 자동 생성).
- **요구사항**:
  - `node-forge ≥ 1.3.1` 로 고정.
  - `package.json` / `admin/package.json` 동시 업데이트.
  - 회귀 검증: 기존 Admin TLS 인증서 생성·지문 검증 테스트 PASS 유지.
- **검증**: `npm audit --production --audit-level=high`에서 `node-forge` advisory 0건 확인. smoke 5체크 PASS.
- **심각도**: HIGH

### R3-REQ-02 — crypto-js 사용 감사·제거/교체 (CRITICAL)
- **근거**: `GHSA-xwcq-pm8m-c4vf` — PBKDF2 구현이 현재 표준 대비 1,300,000배 약함. `admin` 체인은 fixed, 서버 체인은 open.
- **요구사항**:
  - `grep -r "crypto-js"` → 사용처 존재 여부 확인.
  - **사용처 없음**: `npm uninstall` / lockfile prune.
  - **사용처 존재**: Node `crypto` 모듈로 대체 (PBKDF2는 `crypto.pbkdf2`).
- **검증**: `npm ls crypto-js` 결과 `(empty)` 또는 교체 후 회귀 PASS.
- **심각도**: CRITICAL

### R3-REQ-03 — form-data / @babel/traverse CRITICAL (CRITICAL)
- **근거**:
  - `form-data` (`GHSA-fjxv-7rqg-78g4`) — boundary 생성에 `Math.random` 사용, 예측 가능.
  - `@babel/traverse` (`GHSA-67hx-6x53-jw92`) — 악의적 Babel 플러그인 컴파일 시 임의 코드 실행 (빌드 타임).
- **요구사항**:
  - `npm audit fix` 1차 적용 + 전이 의존성 lockfile 고정.
  - `form-data` 직접 의존성이 아니면 상위 패키지 업그레이드로 전이 해결.
  - `@babel/*` 체인은 최신 `major` 업그레이드 검토.
- **검증**: `npm audit --production --audit-level=critical` 0건.
- **심각도**: CRITICAL (form-data runtime), HIGH-as-CRIT (babel buildtime)

### R3-REQ-04 — 런타임 직접 노출 MEDIUM 정리 (MEDIUM)
- **근거**: `yaml` / `js-yaml` / `lodash` / `qs` / `nanoid` / `diff` / `formidable` — 런타임 경로 또는 간접 의존성.
- **요구사항**:
  - 각 패키지별 사용 경로 확인 후 업스트림 상위 버전으로 단일화.
  - `lodash` 사용처가 admin 프런트 전용이면 admin 번들에만 반영.
- **검증**: `npm audit --production --audit-level=moderate`에서 해당 패키지 advisory 0건.
- **심각도**: MEDIUM

### R3-REQ-05 — 빌드/개발 의존성 정리 (LOW)
- **근거**: `vite`/`rollup`/`esbuild`/`svelte` SSR 등 — 빌드 타임 전용.
- **요구사항**:
  - `vite` 5.x 또는 rollup 4.latest로 메이저 업그레이드 검토.
  - `admin/package.json` `vite`/`svelte` 버전 최신화.
  - SSR 경고는 admin SPA가 CSR 전용이므로 실전 영향 없음을 문서에 명시.
- **검증**: `npm run build` (admin + server) 0 error, `node deploy.js` 통과.
- **심각도**: LOW

### R3-REQ-06 — CI 공급망 게이트 (MEDIUM)
- **근거**: 라운드 2 완료 후 공급망 관리 부재 → 향후 동일 누적 재발 위험.
- **요구사항**:
  - GitHub Actions workflow 추가 — `npm audit --production --audit-level=high` PR 차단 게이트.
  - 의존성 업데이트 자동 PR (Dependabot `auto-merge` with test PASS).
  - Monthly SBOM 생성 스케줄 (`cyclonedx-npm` 또는 동등).
- **검증**: 의도적 HIGH 의존성 주입 PR이 CI에서 실패함을 증명하는 dry-run.
- **심각도**: MEDIUM

---

## 3. 범위 외

- `.github/dependabot.yml` 설정 튜닝 (별도 트랙)
- admin 프런트엔드 보안 라운드 (Task #24 — U-01~U-05)
- 라이선스 감사 (supply-chain은 보안만 다룸)

---

## 4. 테스트 원칙 (라운드 2 승계)

1. **NO-MOCK**: `npm audit` / `npm ls` 는 실제 CLI 호출.
2. **LIVE-PROCESS**: smoke 5체크 실 서버 기동.
3. **DETERMINISM**: lockfile 재생성 고정 시드.
4. **EVIDENCE-BASED DOD**: `npm audit` JSON 출력 커밋.
5. **NEGATIVE TESTS**: CI 게이트 dry-run (의도 실패 증명).
6. **ISOLATION**: 임시 디렉터리 `npm install`.
7. **NO-FLAKE**: 재시도 숨김 금지.
8. **SCOPE LOCK**: `test/supply-chain/r3-req-XX-*.test.ts` 네이밍.

---

## 5. 비기능 요구사항

- 라운드 1+2 기존 257 tests 회귀 0건.
- `npm run build`, `npm run lint`, `scripts/smoke.mjs` 5체크 유지.
- `package-lock.json` 결정론적 재생성 (`npm ci` 호환).
- 이전 `jest.config.ts` `coverageThreshold=60` 유지.

---

## 6. 산출물

- 업그레이드된 `package.json` / `admin/package.json` + lockfile.
- `.github/workflows/supply-chain-audit.yml` 신규.
- R3-REQ-01~06 별 검증 스크립트/테스트.
- `reports/npm-audit-before.json` / `reports/npm-audit-after.json` 증거 스냅샷.
