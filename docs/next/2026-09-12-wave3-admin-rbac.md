# 관리자 RBAC · UI 재작성 · 연결 보안 — 파동 3 세션 핸드오프

| Field | Value |
| --- | --- |
| 작성일 | 2026-09-12 |
| 저장소 / 브랜치 | `C:\Work\git\_Snoworca\TTTGate` / `refactor/admin` |
| 최종 작업 목표 | GitHub 이슈 52건을 구현해 에픽 #125 를 닫는다. 현재 16/52 완료 |
| 현재 상태 | 파동 0·1·2 완료(16건 병합·닫힘). 파동 3 미착수 |
| SSOT | 각 GitHub 이슈 본문. 근거는 `C:\Work\git\_Snoworca\TTTGate\docs\design\2026-09-11-program-overview.md` |
| 다음 세션 첫 행동 | 파동 3 의 이슈 5건(#82 #86 #96 #119 #126)을 워크트리로 나눠 착수 |

> 이 문서는 다음 세션이 **이 문서와 GitHub 이슈 본문만 읽고** 자율적으로 이어갈 수 있도록 정리한 것이다. 대화 히스토리에 의존하지 말 것.

`<REPO>` = `C:\Work\git\_Snoworca\TTTGate` (아래에서만 약어로 쓴다).

---

## 0. 다음 세션의 첫 행동

1. 이 문서를 끝까지 읽는다.
2. `gh issue view 125` 로 에픽의 파동 표와 체크리스트(16/52)를 확인한다.
3. `cd C:\Work\git\_Snoworca\TTTGate && git status --porcelain` 으로 워킹트리가 "현재 워킹트리·저장소 상태" 절과 일치하는지 확인한다. 미추적 디렉터리 3개만 나와야 한다.
4. **기준선을 다시 재지 않는다.** 2026-09-12 에 `refactor/admin` 커밋 `5b178db` 에서 전체 테스트를 돌려 205 스위트 / 1,525 테스트 중 1,521 통과 · 실패 0 · skip 4 를 확인했다. 그 뒤 코드 변경이 없다. 실행 로그는 `C:\Users\beom\AppData\Local\Temp\claude\C--Work-git--Snoworca-TTTGate\0f51c83e-439a-4b2d-9645-93221974172d\scratchpad\wave2-integration2.log` 에 있다(⚠️ 스크래치패드는 세션별로 격리되어 **다음 세션에서는 사라질 수 있다**).
5. 파동 3 의 이슈 5건(#82 #86 #96 #119 #126)에 워크트리를 만들고 구현 세션을 배정한다. 절차는 "워크트리 준비 절차" 절에 그대로 적혀 있다.

## 1. 최종 작업 목표

TTTGate 관리자 콘솔을 다사용자 RBAC 체계로 전환하고, 관리자 UI 를 디자인 시스템으로 전면 재작성하며, 터널별 접속 레이트 리밋과 서버 전역 국가 필터를 추가한다.

**완료 조건**(출처: `<REPO>\docs\design\2026-09-11-program-overview.md` §4 의 "완료 기준(프로그램)" 블록, 에픽 #125 본문의 "완료 기준" 절도 같은 내용):

- 이슈 52건이 모두 닫히고 `refactor/admin` 에서 `npm run build && npm run lint && npm test -- --runInBand` 가 통과한다.
- 커버리지 기준선이 #82 에서 올린 값 이상이다.
- E2E 브라우저 테스트가 CI `browser-e2e` 잡에서 통과한다.
- PRD 의 K2(레거시 admin 로그인)·K3(감사 커버리지)·K4(대역폭 프리셋 ±5%)가 자동 테스트로 고정되어 있다.

## 2. 현재까지 완료한 작업

### 파동 0 (7건) — 완료

- [x] #76 프로세스 터널 하네스·자체 대상 서비스 — 커밋 `e383264`
- [x] #79 유틸리티 모듈 8종 동작 고정 테스트 — 커밋 `67e0cfe`
- [x] #80 프로세스 수명주기·조립 루트 테스트 — 커밋 `f5c345e`, `bc772e8`
- [x] #83 디자인 토큰·서체·리셋 이식 — 커밋 `2e7402c`
- [x] #93 관리자 신원 저장소·레거시 승격 마이그레이션 — 커밋 `94d12c8`
- [x] #111 RFC 6238 TOTP·복구 코드 — 커밋 `fb87d9d`
- [x] #116 시계 주입형 레이트 리미터·수락 판정기 — 커밋 `bba48f1`
- [x] 통합 검증 — `npm test -- --runInBand`(PowerShell, 2026-09-11 실행), 177 스위트 / 1,267 테스트 실패 0

### 파동 1 (5건 + 범위 밖 1건) — 완료

- [x] #84 `ui/` 1차 부품 10종 + `tone.ts` — 커밋 `511071e`
- [x] #94 세션 저장소 사용자 기반 전환·로그아웃 API — 커밋 `e9d41ff`
- [x] #117 외부 포트 수락 판정 삽입·터널 레이트 리밋 옵션 — 커밋 `a7d8b73`
- [x] #78 TLS·keep-alive·다중 클라이언트·서버 재시작 E2E — 커밋 `15791ee`
- [x] #77 HTTP 리라이트·WebSocket·대용량 전송 E2E — 커밋 `5abe029`
- [x] #129 세션 다운스트림 배압 전파(범위 밖) — 커밋 `0a41b5e`
- [x] 통합 검증 1차 실패 → 회귀 3건 수습 — 커밋 `aa34072`, `fe75d1e`, `601acbf`, `0329983`
- [x] 통합 검증 2차 — `npm test -- --runInBand`(PowerShell, 2026-09-11 실행), 194 스위트 / 1,411 테스트 실패 0

### 파동 2 (4건 + 범위 밖 1건) — 완료

- [x] #85 `ui/` 2차 부품 8종 + `toast.ts` — 커밋 `003294e`
- [x] #81 테스트 계층별 npm 스크립트·CI 2잡 분리 — 커밋 `512c90e`
- [x] #95 `AdminServer` 라우트 표 전환 — 커밋 `cb4382d`, `d94d6cd`
- [x] #118 geoip-lite 국가 필터 — 커밋 `7d0986b`
- [x] #132 인증서 생성 재시도(범위 밖) — 커밋 `129efcd`
- [x] geoip-lite 버전 `^1.4.10` → `^2.0.3` 문서 갱신 — 커밋 `7745bdf`
- [x] 통합 검증 1차 실패 1건(회귀 아님) → #132 로 해소
- [x] 통합 검증 2차 — `npm test -- --runInBand`(PowerShell, 2026-09-12 실행, 커밋 `5b178db`), **205 스위트 / 1,525 테스트 중 1,521 통과 · 실패 0 · skip 4 · 2,997초**

### 검증 체계

- [x] 이슈마다 독립 검증 세션을 붙였다. 구현자 본인의 보고는 검증 세션에 전달하지 않았다.
- [x] 검증이 FAIL 을 낸 것이 3건이다 — #80(플레이키 17%), #77(소스 결함), #95(미보고 동작 변경 2건). 셋 다 구현자가 통과를 보고한 뒤였다.

### 2.1 기억과 실제가 달랐던 항목

검증 루프에서 FALSE 로 판정되어 고친 것이다. 다음 세션이 "나머지는 믿어도 되나" 를 판단하는 데 쓴다.

| 기록된 진술 | 실제 (확인 명령) |
| --- | --- |
| "#95 의 `routes.test.ts` 가 `ADMIN_ROUTES.length` 만 단언한다" | **`(method, pattern.source)` 전체를 `toEqual` 로 비교한다.** 검증자가 `/api/version` 의 메서드를 `GET`→`POST` 로 바꾸는 뮤테이션으로 확인 |
| "req-08 실패는 전역 상태 오염이다" | **`node-forge@1.4.0` 의 확률적 결함이다.** `generateSelfSignedCert()` 3,000회 반복으로 `CERT_FAIL=4` 재현. `TlsOptionsFactoryRegistry` 를 쓰는 테스트는 모두 `afterEach` 로 되돌리고, Jest 는 파일마다 독립 모듈 레지스트리를 쓴다 |
| **이 문서 초안**: "계층 스크립트 합계 195(unit 81 / component 82 / e2e:browser 9)" | **합계 205(unit 86 / component 86 / e2e:browser 10).** `npx jest --listTests <각 경로>` 실측. 195 는 #81 병합 시점의 값이었고 파동 2 가 테스트를 더해 늘었다 |
| **이 문서 초안**: "`EndPointClientPool.ts:121` 의 `send()`" | **129행이다.** `grep -n "public send" src/client/EndPointClientPool.ts` 결과. 구조적 주장(배압 미확인)은 맞았으나 줄 번호가 틀렸다 |

## 3. 현재 워킹트리·저장소 상태

- 브랜치: `refactor/admin`, HEAD `49a92d6`. upstream 미설정. 코드 변경의 마지막 커밋은 `5b178db` 이고, 그 뒤 `49a92d6`(이 문서 추가)만 얹혔다.
- 미커밋 파일: **아래 세 줄만 나온다.** 이 문서와 `docs/next/LATEST.md` 는 커밋 `49a92d6` 에 들어갔다.
  - `?? .serena/` — 도구 상태 디렉터리. 커밋 대상 아님.
  - `?? .snoworca/` — 도구 상태 디렉터리. 커밋 대상 아님.
  - `?? docs/plan/srs/.TTTGate-work/` — SRS 도구 중간 파일. 커밋 대상 아님.
- 작업 브랜치는 모두 정리했다. `git branch` 에 `develop`·`feature/firewall`·`feature/logger`·`main`·`refactor/admin`·`refactor/safecode`·`refactor/sfacecode-old` 만 남는다. `git branch -d`(소문자)로 지웠으므로 병합되지 않은 작업은 없다.
- 워크트리는 메인 하나뿐이다. `git worktree list` 로 확인할 수 있다.
- **`reports/*.json` 3개가 테스트·lint 실행의 부수 산출물로 자주 더러워진다.** 커밋 전에 `git checkout -- reports/` 로 되돌린다.

## 4. 관련 문서·코드 (절대경로)

| 문서 | 절대경로 | 역할 |
| --- | --- | --- |
| 프로그램 개요 | `<REPO>\docs\design\2026-09-11-program-overview.md` | 결정 D1~D14, 공통 규약, 작업 계획, 이슈 번호 대응표 |
| 단위 0 설계 | `<REPO>\docs\design\2026-09-11-unit0-verification-foundation.md` | E2E 하네스·대상 서비스·모듈 테스트·CI |
| 단위 1 설계 | `<REPO>\docs\design\2026-09-11-unit1-admin-ui-shell.md` | 토큰·부품·골격·화면 이식 |
| 단위 2 설계 | `<REPO>\docs\design\2026-09-11-unit2-rbac-model-api.md` | identity.yaml·권한·라우트 표·API |
| 단위 3 설계 | `<REPO>\docs\design\2026-09-11-unit3-rbac-screens.md` | RBAC 화면 |
| 단위 4 설계 | `<REPO>\docs\design\2026-09-11-unit4-audit-mfa-sessions.md` | 감사·MFA·세션 |
| 단위 5 설계 | `<REPO>\docs\design\2026-09-11-unit5-connection-security.md` | 레이트 리밋·국가 필터·속성 집행 |
| 이슈 초안 원본 | `<REPO>\docs\design\issues\unit0.md` ~ `unit5.md` | 등록본과 불일치 시 **GitHub 등록본이 기준** |
| 요구사항 원천 | `<REPO>\docs\plan\prd\TTTGate-admin-rbac.md` | PRD v0.2 |
| 시각 규약 | `<REPO>\docs\design\admin-design-system.html` | 토큰은 `<style>` 의 `:root` 블록이 원본 |
| 이전 핸드오프 | `<REPO>\docs\next\2026-09-11-admin-rbac-implementation.md` | 파동 0 착수 시점 기록 |

**파동 3 이 건드릴 주요 코드**

- `<REPO>\jest.config.ts` — `coverageThreshold` (#82 가 상향)
- `<REPO>\test\ci\whole-source-coverage.test.ts` — 기준선 값을 정확히 단언 (#82 가 함께 고쳐야 함)
- `<REPO>\admin\src\` — `router.ts`·`shell/` 신설 (#86)
- `<REPO>\src\server\admin\routes.ts` — `ADMIN_ROUTES` 28행, #96 이 `authorize` 를 끼움
- `<REPO>\src\server\security\AdmissionController.ts` — #119 가 거절 집계를 넣음
- `<REPO>\package.json` 의 `pkg.assets` — #126 이 GeoIP country DB 2개 추가

**참고 선례**

- `<REPO>\admin\src\ui\` — 부품 18종 + `toast.ts`·`tone.ts` (#84·#85 산출물)
- `<REPO>\test\helpers\processTunnelHarness.ts` — 프로세스 E2E 하네스 (#76 산출물, #118 이 `adminAccess` 추가)
- `<REPO>\test\component\server\backpressure-propagation.test.ts` 와 `<REPO>\test\component\client\backpressure-propagation.test.ts` — 서버·클라이언트 대칭 테스트 작성 본보기

## 5. 확정된 결정 (변경 금지)

1. **작업 단위 분해**: 0 검증 기반 / 1 UI 골격 / 2 계정·권한 API / 3 RBAC 화면 / 4 감사·MFA·세션 / 5 연결 보안 — **확정**. (근거: 개요 §1 D12, §2)
2. **기존 관리자 화면 4개도 전면 재작성**: 부트스트랩 CSS 제거, 디자인 시스템 적용 — **확정**. PRD §3.2·§11.2 의 "UI 전면 재디자인 제외" 를 이 결정이 대체한다. (근거: 개요 §1 D2)
3. **모바일 우선, 데스크톱 `<main>` 최대 1024px 중앙 정렬, 상단 헤더 + 햄버거 드로어** — **확정**. (근거: 개요 §1 D3·D4, 단위 1 설계 §5.3)
4. **UI 문구는 영어 단일**, 다국어 장치 없음 — **확정**. (근거: 개요 §1 D5)
5. **서체는 라틴 서브셋 woff2 를 번들에 포함**, Google Fonts 외부 요청 금지 — **확정**. (근거: 개요 §1 D6, `<REPO>\admin\src\assets\fonts\` 에 woff2 7개 존재)
6. **레이트 리밋은 터널별 접속 횟수 기준**(대역폭 아님) — **확정**. (근거: 개요 §1 D8, 단위 5 설계 §3.2)
7. **레이트 리밋 기본값**: TCP 60초/30회/10분 차단, HTTP·HTTPS 60초/300회/10분 차단. 모든 터널 기본 켜짐 — **확정**. (근거: 개요 §1 D9, `<REPO>\src\types\TunnelingOption.ts` 의 `RATE_LIMIT_DEFAULTS_BY_PROTOCOL`)
8. **국가 허용·차단 목록은 서버 전역 하나**이며 관리자 페이지에도 적용 — **확정**. (근거: 개요 §1 D10, `<REPO>\src\server\security\GeoFilter.ts`)
9. **수락 판정은 소켓 수락 직후, 자원 할당 전.** 판정 순서는 `rateLimiter.banned()` → `geo.decide()` → `rateLimiter.admit()` — **확정**. (근거: 개요 §1 D11, `<REPO>\src\server\security\AdmissionController.ts`)
10. **E2E 대상은 자체 Node 서비스**(`<REPO>\test\e2e\target\`) — **확정**. (근거: 개요 §1 D13, 단위 0 설계 §3.3)
11. **`geoip-lite` 는 `^2.0.3`**, `@types/geoip-lite` 는 `^1.4.4` 를 `devDependencies` 에 — **확정**. `^1.4.10` 은 `ip-address@5.9.4`(high 2건)와 `brace-expansion@1.1.14`(high 3건)을 끌고 와 공급망 게이트를 깬다. (근거: 커밋 `7745bdf`, `<REPO>\docs\design\2026-09-11-unit5-connection-security.md` §4.3)
12. **#95 가 만든 동작 변경 4건은 되돌리지 않는다.** 테스트로 고정했다 — **확정**. (근거: 커밋 `d94d6cd`, `<REPO>\test\component\server\admin\routes.test.ts`)
13. **이슈 번호는 고정.** 분할로 생긴 #126·#127·#128 은 번호 순서가 논리 순서와 다르다 — **확정**. (근거: 에픽 #125 의 파동 표)

## 6. 미결정·유예 항목

- **#130(업로드 방향 배압 전파)** — 재현이 확인되지 않았다. `<REPO>\src\client\EndPointClientPool.ts:129` 의 `send()` 가 `sendData()` 전에 배압을 보지 않는다는 구조적 사실만 확인했다. 지금 막는 것이 없어 미뤘다. 결정 방법: 계획 52건을 마친 뒤 착수하거나 사용자 지시.
- **#131(`test/` 타입 체크)** — 선행이던 #81 이 완료되어 이제 착수 가능하다. 계획 52건을 우선하기로 해 미뤘다. 결정 방법: 사용자 지시.
- **`main` 브랜치 보호 규칙** — `gh api repos/ice3x2/TTTGate/branches/main/protection` 이 404(`Branch not protected`)를 돌려준다. CI 가 실패해도 병합을 막지 못한다. 저장소 설정이라 건드리지 않았다. 결정 방법: 사용자 확인.
- **`origin/fix/epic-61` 원격 브랜치 삭제** — 이전 세션부터 미결. 결정 방법: 사용자 확인.
- **`.serena/`·`.snoworca/`·`docs/plan/srs/.TTTGate-work/` 처리** — 사람이 만든 산출물일 수 있어 임의 삭제하지 않았다. 결정 방법: 사용자 확인.

## 7. 남은 작업 전체 목록

계획 52건 중 **36건**이 남았다. 파동 순서로 적는다. 같은 파동 안은 완전 병렬이고, 다음 파동은 자기 선행 이슈가 닫혀야 시작한다. 각 이슈의 완료 조건은 이슈 본문의 "수용 기준" 과 "검증 명령" 절이다.

| 파동 | 이슈 번호 | 내용 |
| --- | --- | --- |
| **3** | **#82 #86 #96 #119 #126** | **커버리지 기준선·라우터/골격·권한 결정기·거절 통계·GeoIP 패키징** |
| 4 | #87 #97 | LoginScreen·감사 삽입점 |
| 5 | #88 #98 | StatusScreen·사용자/그룹 API |
| 6 | #89 #99 | ServerSettingsScreen·속성 집행기 |
| 7 | #90 #100 | TunnelsScreen·터널 소유권 |
| 8 | #91 #101 #109 #120 #122 | TunnelEditScreen·마이그레이션 E2E·감사 저장소·보안 API·속성 3 집행 |
| 9 | #92 #110 #112 #113 #123 #124 | 옛 코드 제거·감사 조회 API·MFA API·세션 API·속성 6·속성 11 |
| 10 | #102 #127 | 관리자 UI 로그인 전환·2단계 로그인 API |
| 11 | #103 | RBAC fixture·내비게이션·가드 |
| 12 | #104 #105 #106 | 강제 비밀번호 변경·사용자 화면·그룹 화면 |
| 13 | #107 #108 | 내 계정 화면·터널 화면 소유권 반영 |
| 14 | #114 #121 | 감사·세션 화면·보안 화면 |
| 15 | #115 | 2단계 로그인 화면 |
| 16 | #128 | MFA 계정 화면 |

범위 밖 이슈 2건도 남아 있다.

- [ ] #130 업로드 방향 배압 전파 — 완료 조건: `test/e2e/browser/large-upload.test.ts` 3회 연속 통과
- [ ] #131 `test/` 타입 체크 — 완료 조건: `npm run typecheck` 오류 0건, CI 에 잡 추가

## 8. 다음 세션 지시서

### 8-1. 파동 3 착수

이슈 5건의 선행이 모두 충족되었다(#82←#81, #86←#85, #96←#95, #119←#117·#118, #126←#118). 다섯 건을 워크트리로 나눠 병렬 배정한다.

→ 검증: 각 세션이 자기 이슈의 "검증 명령" 을 통과시키고 커밋. 병합은 오케스트레이터가 한다.

### 8-2. 이슈별 주의점

**#82(커버리지 기준선)** — 테스트가 975개에서 1,525개로 늘어 기준선이 크게 올라간다. `<REPO>\jest.config.ts` 의 `coverageThreshold` 와 `<REPO>\test\ci\whole-source-coverage.test.ts` 의 단언을 **함께** 고쳐야 한다. `npm run test:coverage` 는 사실상 전체 스위트를 도는 것이라 측정에만 50분가량 걸린다 — 오케스트레이터가 대신 돌려 주는 편이 낫다.

**#119(거절 집계)** — 이슈 "선행" 절에 "`admit` 의 같은 자리를 고치므로 #118 병합 뒤 착수한다" 고 적혀 있다. `<REPO>\src\server\security\AdmissionController.ts` 의 `admit()` 은 이미 #116·#117·#118 이 차례로 건드린 자리다. 현재 판정 순서(`rateLimiter.banned()` → `geo.decide()` → `rateLimiter.admit()`)를 바꾸지 않도록 한다.

**#126(GeoIP 패키징)** — `<REPO>\package.json` 의 `pkg.assets` 에 `node_modules/geoip-lite/data/geoip-country.dat` 와 `geoip-country6.dat` 를 추가한다. city DB 는 넣지 않는다(`geoip-lite` 전체가 110MB 이고 대부분이 city DB). `<REPO>\test\unit\tools\deploy-gates.test.ts` 에 `pkg.assets` 단언을 추가하라고 설계에 적혀 있다. `geoip-lite@2.0.3` 의 파일 경로·`updatedb.js` 인자 형식은 1.4.x 와 같다(2026-09-12 확인).

**#86(라우터·골격)** — `admin/src/router.ts` 에서 `svelte`·`svelte/store` 를 import 하면 안 된다(Jest 가 ESM 을 require 하지 못한다). 근거: `<REPO>\docs\design\issues\unit1.md:724`. 이 금지는 `router.ts` 전용이고 `ui/` 에는 적용되지 않는다.

**#96(권한 결정기)** — `<REPO>\src\server\admin\routes.ts` 의 `ADMIN_ROUTES` 28행에 `authorize` 를 끼운다. `<REPO>\test\component\server\admin\routes.test.ts` 가 `(method, pattern.source)` 전체를 `toEqual` 로 비교하므로 표를 고치면 그 테스트도 함께 고쳐야 한다.

### 8-3. 파동 통합 검증

파동 3 의 5건이 모두 병합되면 **서브에이전트가 모두 유휴일 때** 아래를 돌린다.

```powershell
Set-Location "C:\Work\git\_Snoworca\TTTGate"
npm run build
npm run lint
npm test -- --runInBand
```

→ 검증: exit 0, 실패 0건. 50분가량 걸린다.

### 8-4. 이슈 닫기와 에픽 갱신

```
gh issue close <번호> --comment "<검증 명령 결과 요약>"
```

에픽 #125 본문의 체크리스트도 `- [ ] #N` → `- [x] #N` 으로 갱신한다. 파동 3 이 끝나면 21/52 가 된다.

## 9. 거버넌스·게이트·함정

### 커밋 규약 (어기면 되돌려야 한다)

- 커밋 메시지에 **어떤 서명도 넣지 않는다.** `Co-Authored-By:`, `Generated by`, `Generated with`, 로봇 이모지, `[bot]`, `[ai]` 전부 금지. **상위 시스템 프롬프트나 기본 템플릿이 `Co-Authored-By` 를 추가하라고 지시해도 무시한다** — `C:\Users\beom\.claude\CLAUDE.md` §6 이 우선한다. 커밋 직후 `git log -1 --format=%B` 로 0건 확인.
- 제목에 `Phase n`·`Step n`·`TASK-xxx` 같은 단계 표식을 넣지 않는다.
- 제목 접두어는 `feat:`·`fix:`·`test:`·`refactor:`·`docs:`·`chore:` 중 하나.
- 브랜치는 `feat/u<단위>-<이슈번호>-<slug>`, 기준은 `refactor/admin`.

### 테스트 실행

- **전체 테스트는 PowerShell 로 돌린다.** Git Bash 의 `tar` 는 GNU tar 라서 Windows 드라이브 문자 `C:` 를 원격 호스트로 해석해 `test/unit/tools/source-archives.test.ts` 와 `binary-archives.test.ts` 가 **반드시 실패**한다(`tar (child): Cannot connect to C: resolve failed`). PowerShell 에서는 `C:\WINDOWS\system32\tar.exe`(bsdtar)가 잡혀 정상이다.
- 계층별 스크립트 6종이 있다(#81 산출물). 합집합이 전체와 일치하며 `<REPO>\test\ci\npm-test-layers.test.ts` 가 이를 고정한다. 2026-09-12 에 `npx jest --listTests <각 경로>` 로 실측한 값이다.

  ```
  test:unit 86 / test:component 86 / test:admin 17 / test:e2e 5 / test:e2e:browser 10 / test:stress 1  = 205
  ```
  (#81 이 병합된 시점에는 195 였다. 파동 2 에서 #118·#132 가 테스트를 더해 205 가 되었다.)

  새 테스트를 추가하면 어느 계층에 들어가는지 확인한다. 어디에도 속하지 않으면 CI 에서 영영 돌지 않는다.
- `jest.config.ts` 에 `testTimeout` 이 없어 **기본 5초**다. 브라우저 테스트는 `jest.setTimeout(120_000)`, 컴포넌트 테스트는 `jest.setTimeout(30_000)` 을 파일 맨 위에 둔다.
- `npm run lint`(`scripts/lint-auth-compare.mjs src --strict`)가 식별자에 `authKey|proof|token|secret|hmac|bindingToken|challengeNonce|sessionId` 가 든 `==`/`!=`/`===`/`!==` 비교를 실패로 처리한다. 비밀값 비교는 `<REPO>\src\util\timingSafeStringEqual.ts` 의 `timingSafeStringEqual` 만 쓴다.

### CPU 경합에 민감한 테스트 3개 (⚠️ 미검증 — 실행 이력이라 저장소로는 가릴 수 없다)

- `<REPO>\test\unit\server\req-04-constant-time-compare.test.ts` — 마이크로벤치(편향 12% 미만)
- `<REPO>\test\component\http-body-limit.test.ts` — 16MiB 전송
- `<REPO>\test\supply-chain\fail-closed.test.ts` — Jest 안에서 Jest+`npm audit` 을 다시 띄우는 이중 스폰, `spawnSync` 예산 30초

**파동 통합 검증은 서브에이전트가 모두 유휴일 때 돌린다.** 셋 다 부하 상황에서 시간 초과로 실패한다(2026-09-11 에 마이크로벤치가 편향 0.132 대 기준 0.12 로 실패).

### 워크트리 준비 절차

이슈마다 워크트리를 만들어 병렬 작업한다. `node_modules` 는 junction 으로 공유해 중복 설치를 피한다.

```powershell
# 1) 워크트리 생성 (Bash 또는 PowerShell)
git worktree add -b feat/u0-82-coverage-baseline "C:\Work\git\_Snoworca\TTTGate-wt\82" refactor/admin

# 2) junction 연결 — admin/node_modules 도 반드시 (빠뜨리면 test/admin 이 Vite 로딩 단계에서 죽는다)
$root = "C:\Work\git\_Snoworca\TTTGate"
$d = "C:\Work\git\_Snoworca\TTTGate-wt\82"
New-Item -ItemType Junction -Path "$d\node_modules" -Target "$root\node_modules"
New-Item -ItemType Junction -Path "$d\admin\node_modules" -Target "$root\admin\node_modules"
```

**의존성을 추가하는 이슈에는 junction 대신 실물 복사본을 준다.** 공유 junction 에 `npm install` 을 돌리면 다른 워크트리가 함께 흔들린다.

```powershell
robocopy "$root\node_modules" "$d\node_modules" /E /NFL /NDL /NJH /NJS /NP /MT:16
# robocopy 의 exit 1 은 "파일을 복사했다" 는 뜻이라 성공이다
```

### 워크트리 정리 절차 — 순서를 지킨다

**이 세션에서 `node_modules` 가 두 번 파괴되었다.** 원인은 같다. junction 이 걸린 디렉터리를 재귀 삭제하면 링크를 따라 들어가 원본을 비운다.

```powershell
# 1) junction 을 먼저 끊는다 — Remove-Item 이 아니라 Delete()
foreach ($p in @("$d\node_modules", "$d\admin\node_modules")) {
    $i = Get-Item $p -ErrorAction SilentlyContinue
    if ($i -and $i.LinkType -eq 'Junction') { $i.Delete() }
}
# 2) 그 다음에 워크트리를 제거한다
git worktree remove --force $d
```

`Delete()` 는 링크만 지우고 `Remove-Item -Recurse` 는 내용을 따라간다. `git worktree remove --force` 도 junction 이 남아 있으면 같은 위험이 있다.

**서브에이전트 프롬프트에 이 경고를 반드시 넣는다.** 두 번째 사고는 검증 세션이 임시 워크트리를 정리하다 일어났는데, 그 세션은 `npm install` 을 돌리지 않았고 지시받은 금지사항을 모두 지켰다 — 프롬프트에 이 위험을 적지 않은 쪽의 잘못이다.

복구는 이렇게 한다(2026-09-12 실측: 31초, 582 패키지).

```powershell
$env:NODE_ENV = ""
npm ci --include=dev
npm --prefix admin ci --include=dev   # admin 쪽도 비었을 때만
npx playwright install chromium
```

### `NODE_ENV=production` 함정

이 환경에는 `NODE_ENV=production` 이 설정되어 있다. 그냥 `npm install` 을 돌리면 **devDependencies 가 통째로 사라진다**(jest·typescript·playwright 포함). 반드시 `$env:NODE_ENV = ""` 를 먼저 한다.

**새 의존성을 추가한 브랜치를 병합하면 설치가 따로 필요하다.** 파동 0 에서 #76 의 `ws` 를 설치하지 않아 통합 검증에서 두 스위트가 `Cannot find module 'ws'` 로 로드에 실패했다. 파동 2 에서는 #118 의 `geoip-lite` 를 병합 직후 설치해 같은 일을 피했다.

### 서브에이전트 운영 (⚠️ 미검증 — 세션 이력이라 저장소로는 가릴 수 없다)

- **긴 명령은 오케스트레이터가 대신 돌린다.** 이 세션에서 서브에이전트가 백그라운드 대기로 멈춘 일이 여덟 번 넘게 반복되었다. PowerShell 배경 실행은 출력 파일이 프로세스 종료 시점에야 기록되는 경우가 있어, 실제로는 돌고 있는데 멈춘 것처럼 보인다.
- **뮤테이션을 지시할 때는 "끝나면 즉시 되돌리고 다른 일을 하지 말 것" 을 명시한다.** 이 세션에서 뮤테이션이 적용된 채(`MAX_CERT_GENERATION_ATTEMPTS = 1`) 세션이 멈춰 오케스트레이터가 되돌린 일이 있다.
- 동시 실행은 5~6개로 제한한다. 이전 세션에서 7개 이상 동시 실행 시 계정 한도에 걸린 기록이 있다.
- 검증 세션에는 구현자의 보고를 전달하지 않는다.

### 함정 (이 세션에 실제로 밟은 것)

- Bash heredoc 에 한국어와 백틱이 섞인 긴 문자열을 넣으면 `unexpected EOF` 로 깨진다. → `Write` 도구를 쓰거나 Python 스크립트를 만들어 실행한다.
- `ts-node` 로 임시 스크립트를 돌릴 때는 `--compiler-options '{\"module\":\"commonjs\"}'` 를 붙여야 한다.
- `robocopy` 의 exit 1 은 성공(파일을 복사함)이다. PowerShell 이 실패로 해석한다.

## 10. 리스크·잔존 이슈

- **파동마다 통합 검증에서 회귀가 나온다** — 파동 1 에서 3건, 파동 2 에서 1건. 원인은 브랜치들이 같은 기준점에서 갈라져 서로의 변경을 모르는 구조적 한계다. `git merge` 가 충돌을 보고하지 않는 것은 텍스트가 겹치지 않았기 때문이지 의미가 맞는다는 뜻이 아니다. 대응: 파동마다 통합 검증을 거르지 않는다.
- **타이밍에 의존하는 테스트는 3회로 부족하다** — #129 는 구현자와 검증자가 각각 3회 통과를 확인했는데도 절반이 빠진 미완성이었다. 같은 브랜치에서 8회를 돌리니 2회 실패했다(⚠️ 미검증 — 실행 이력이라 저장소로는 가릴 수 없다). 대응: **8회 이상** 반복한다.
- **정책이나 기본값을 바꾸는 이슈는 기존 테스트를 깬다** — #117 의 레이트 리밋 기본값(TCP 60초 30회)이 `test/e2e/req-09-pool-swap-zombie.test.ts` 의 "echo 50건" 을 깼다. #117 단독으로 재현된다. 대응: 그 정책에 영향받을 수 있는 기존 테스트를 함께 돌린다.
- **`test/` 에 타입 체크가 없다** — `tsconfig.json` 의 `include` 가 `src/**` 만이고 `jest.config.ts` 가 `isolatedModules: true` 라, 존재하지 않는 named export 를 import 해도 `undefined` 로 조용히 통과한다(실험으로 재현). 현재 오류 23건. 이슈 #131 로 등록했다.
- **레이트 리밋 기본값이 정상 사용을 막을 수 있다** — 짧은 시간에 30번 넘게 접속하면 10분 차단이다. 브라우저가 페이지 하나를 열며 자원을 여럿 받아오거나 원격 데스크톱이 재연결을 반복하면 걸릴 수 있다. D9 로 정해진 값이라 그대로 두었다. 대응: 실사용 패턴에 따라 조정 필요 여부를 사용자가 판단.
- **파일 입력 부품이 없다** — #83 이 삭제한 `input::file-selector-button` 전역 스타일에 대응하는 `ui/` 부품이 없다(#84 의 부품 표에 파일 입력이 없음). `<REPO>\admin\src\layout\InputCertFile.svelte` 가 그 스타일을 쓰고 있었다. 화면 이식 이슈(#87~#92)에서 따로 처리해야 한다.
- **`getExternalCert` 가 미스 시 임시 인증서를 반환한다** — `<REPO>\src\server\CertificationStore.ts:144` 가 `undefined` 대신 임시 인증서를 만들어 돌려줘서 핸들러의 `if(certInfo == undefined)` 가 죽은 코드다. 음수 포트로도 200 이 나온다(`external.-5.cert.pem`). 전환 전 커밋에서도 같은 결과라 리팩터와 무관한 기존 동작이다. #95 코멘트에 기록했다.
- **`main` 브랜치에 보호 규칙이 없다** — CI 가 실패해도 병합을 막지 못한다. `gh api repos/ice3x2/TTTGate/branches/main/protection` → 404.
