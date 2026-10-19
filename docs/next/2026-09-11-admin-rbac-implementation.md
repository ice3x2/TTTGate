# 관리자 RBAC · UI 재작성 · 연결 보안 — 구현 세션 핸드오프

| Field | Value |
| --- | --- |
| 작성일 | 2026-09-11 |
| 저장소 / 브랜치 | `C:\Work\git\_Snoworca\TTTGate` / `refactor/admin` |
| 최종 작업 목표 | GitHub 이슈 52건(#76~#124, #126~#128)을 구현해 에픽 #125 를 닫는다 |
| 현재 상태 | 설계·이슈 등록 완료, 코드 미착수. 구현 코드 변경 0줄 |
| SSOT | 각 GitHub 이슈 본문. 근거는 `C:\Work\git\_Snoworca\TTTGate\docs\design\2026-09-11-program-overview.md` |
| 다음 세션 첫 행동 | 파동 0 의 이슈 7건(#76 #79 #80 #83 #93 #111 #116)을 병렬로 착수 |

> 이 문서는 다음 세션이 **이 문서와 GitHub 이슈 본문만 읽고** 자율적으로 구현을 완주하도록 정리한 것이다. 대화 히스토리에 의존하지 말 것.

---

## 0. 다음 세션의 첫 행동

1. 이 문서를 끝까지 읽는다.
2. `gh issue view 125` 로 에픽의 작업 계획과 파동 표를 확인한다.
3. `cd C:\Work\git\_Snoworca\TTTGate && git status --porcelain` 으로 워킹트리가 "현재 워킹트리·저장소 상태" 절과 일치하는지 확인한다.
4. 파동 0 의 이슈 7건을 각각 하나의 구현 세션에 배정한다: #76, #79, #80, #83, #93, #111, #116. 이 일곱은 서로 선행이 없어 완전 병렬이다.
5. 각 구현 세션은 착수 전에 `gh issue view <번호>` 로 본문 전체를 읽고, "배경" 절의 `파일:줄` 을 소스와 한 번 대조한다.

## 1. 최종 작업 목표

TTTGate 관리자 콘솔을 다사용자 RBAC 체계로 전환하고, 관리자 UI 를 디자인 시스템으로 전면 재작성하며, 터널별 접속 레이트 리밋과 서버 전역 국가 필터를 추가한다. 그 전에 검증 기반(프로세스 수준 E2E 하네스, 모듈 테스트, CI 분리)을 먼저 세운다.

**완료 조건**(출처: `C:\Work\git\_Snoworca\TTTGate\docs\design\2026-09-11-program-overview.md` §4 의 "완료 기준(프로그램)" 블록. 에픽 #125 본문의 "완료 기준" 절도 같은 내용으로 갱신했다):

- 이슈 52건이 모두 닫히고 `refactor/admin` 에서 `npm run build && npm run lint && npm test -- --runInBand` 가 통과한다.
- 커버리지 기준선이 #82(U0-07)에서 올린 값 이상이다.
- E2E 브라우저 테스트가 CI `browser-e2e` 잡에서 통과한다.
- PRD 의 K2(레거시 admin 로그인)·K3(감사 커버리지)·K4(대역폭 프리셋 ±5%)가 자동 테스트로 고정되어 있다.

## 2. 현재까지 완료한 작업

- [x] 회의로 요구·범위 확정 — 결정 D1~D14 가 `C:\Work\git\_Snoworca\TTTGate\docs\design\2026-09-11-program-overview.md` §1 에 표로 있다.
- [x] 설계 문서 7편 작성 — `C:\Work\git\_Snoworca\TTTGate\docs\design\` 아래 `2026-09-11-program-overview.md`, `2026-09-11-unit0-verification-foundation.md`, `2026-09-11-unit1-admin-ui-shell.md`, `2026-09-11-unit2-rbac-model-api.md`, `2026-09-11-unit3-rbac-screens.md`, `2026-09-11-unit4-audit-mfa-sessions.md`, `2026-09-11-unit5-connection-security.md`. 커밋 `192957a`.
- [x] 설계 문서 3축 검증(정확성·정합성·구현 가능성) 2~3라운드 반영 — 커밋 `192957a` 시점 이후 `dcf97e4` 까지 반영됨.
- [x] 이슈 초안 52건 작성 — `C:\Work\git\_Snoworca\TTTGate\docs\design\issues\unit0.md` ~ `unit5.md`, 형식 규약은 같은 디렉터리의 `_template.md`.
- [x] 이슈 초안 2축 검증(정확성·구현 가능성) 지적 171건 반영 — 커밋 `dcf97e4`. 등급별 내역은 에픽 #125 본문 "검증 상태" 절에 있다.
- [x] GitHub 이슈 52건 등록과 에픽 #125 생성 — `gh api graphql` 로 확인한 에픽 하위 이슈 수 52 (2026-09-11 실행).
- [x] 이슈 본문의 초안 ID 를 이슈 번호로 치환 — `gh issue view 100` 결과에 `#101 (U2-09)` 형태가 나타남을 확인.

**구현 코드는 한 줄도 쓰지 않았다.** `git diff --stat 5f772fc..HEAD` 의 변경은 전부 `docs/` 아래다.

**미실행**: ⚠️ 미검증(세션 이력이라 저장소로는 가릴 수 없다) — `npm run build`, `npm run lint`, `npm test` 를 이번 세션에서 돌리지 않았다. 정황 근거는 워킹트리에 빌드·테스트 산출물이 없고 `git diff --name-only 5f772fc..HEAD` 가 전부 `docs/` 아래라는 점이다. 마지막 전체 통과 기록은 커밋 `5f772fc` 시점의 `C:\Work\git\_Snoworca\TTTGate\docs\plan\verification\epic61-final-verification.md:7` 이며, 975 테스트(970 PASS / 5 skip), exit 0, 1523.897초를 기록한다(이 수치는 파일에서 확인됨).

**다음 세션은 착수 전에 기준선을 직접 확인하라**: `cd C:\Work\git\_Snoworca\TTTGate && npm run build && npm run lint && npm test -- --runInBand`. 이 명령이 통과하지 않으면 그것은 구현이 만든 회귀가 아니라 출발점의 문제다.

### 2.1 검증에서 바로잡은 항목

핸드오프 문서 검증 서브에이전트가 FALSE 로 판정해 고친 것이다. 다음 세션이 "나머지는 믿어도 되나" 를 판단하는 데 쓴다.

| 처음 기록한 진술 | 실제 (확인 명령) |
| --- | --- |
| "완료 조건은 에픽 #125 본문의 '완료 기준' 과 같다" | **검증 시점의 에픽 본문은 49건으로 적혀 있었다**(분할된 #126·#127·#128 미반영). `gh issue view 125 --json body` 로 확인 후 에픽 본문을 52건·파동 17개로 갱신했다. 출처의 원본은 개요 문서 §4 다 |
| "새 런타임 의존성 `geoip-lite`, `ws`, `qrcode` 가 공급망 게이트에 걸릴 수 있다" | **`geoip-lite` 하나만 해당한다.** `ws` 는 devDependency(단위 0 설계 §3.3), `qrcode` 는 `admin/package.json`(단위 4 설계), 게이트는 저장소 루트에서 `--omit=dev` 로 실행된다 |

## 3. 현재 워킹트리·저장소 상태

- 브랜치: `refactor/admin`. upstream 미설정(`git rev-list --left-right --count origin/refactor/admin...HEAD` 가 실패).
- 이 문서와 `docs/next/LATEST.md` 는 작성 직후 커밋했다(제목 `docs: 관리자 RBAC 구현 세션 핸드오프 문서 추가`). 따라서 다음 세션의 `git status --porcelain` 에는 아래 세 줄만 남는다:
  - `?? .serena/` — 도구 상태 디렉터리. 커밋 대상 아님.
  - `?? .snoworca/` — 도구 상태 디렉터리. 커밋 대상 아님.
  - `?? docs/plan/srs/.TTTGate-work/` — SRS 생성 도구 중간 파일. 커밋 대상 아님.
- 추적 파일 변경: 없음. 설계·이슈 문서는 `dcf97e4` 까지 전부 커밋되어 있다.
- 커밋 여부 판단: 구현 착수 전에 정리할 것이 없다. 위 세 디렉터리는 그대로 둔다.

## 4. 관련 문서·코드 (절대경로)

`<REPO>` = `C:\Work\git\_Snoworca\TTTGate` (아래 표에서만 약어로 쓴다).

| 문서 | 절대경로 | 역할 |
| --- | --- | --- |
| 프로그램 개요 | `<REPO>\docs\design\2026-09-11-program-overview.md` | 결정 D1~D14, 공통 규약, 작업 계획, 이슈 번호 대응표 |
| 단위 0 설계 | `<REPO>\docs\design\2026-09-11-unit0-verification-foundation.md` | E2E 하네스·대상 서비스·모듈 테스트·CI |
| 단위 1 설계 | `<REPO>\docs\design\2026-09-11-unit1-admin-ui-shell.md` | 토큰·부품·골격·화면 이식 |
| 단위 2 설계 | `<REPO>\docs\design\2026-09-11-unit2-rbac-model-api.md` | identity.yaml·권한·라우트 표·API |
| 단위 3 설계 | `<REPO>\docs\design\2026-09-11-unit3-rbac-screens.md` | RBAC 화면 |
| 단위 4 설계 | `<REPO>\docs\design\2026-09-11-unit4-audit-mfa-sessions.md` | 감사·MFA·세션 |
| 단위 5 설계 | `<REPO>\docs\design\2026-09-11-unit5-connection-security.md` | 레이트 리밋·국가 필터·속성 집행 |
| 이슈 초안 원본 | `<REPO>\docs\design\issues\unit0.md` ~ `unit5.md` | ⚠️ 미검증 — 등록본과 내용이 같다고 보지만 52건 전수 대조는 하지 않았다(부분 확인만). 다음 세션이 확인하려면 초안을 파싱해 각 이슈 본문과 비교한다. 불일치 시 **등록본(GitHub)이 구현의 기준**이다 |
| 이슈 작성 규약 | `<REPO>\docs\design\issues\_template.md` | 절 구조·금지 표현 |
| 요구사항 원천 | `<REPO>\docs\plan\prd\TTTGate-admin-rbac.md` | PRD v0.2 |
| 시각 규약 | `<REPO>\docs\design\admin-design-system.html` | 토큰은 `<style>` 의 `:root` 블록(19~95행)이 원본 |
| 테스트 정책 | `<REPO>\docs\guide\test-evidence-policy.md` | 실환경 테스트 원칙 |

**수정 대상 코드**: 이슈마다 "변경할 것" 절에 파일별로 적혀 있다. 주요 진입점은 `<REPO>\src\server\admin\AdminServer.ts`(1,569줄, 라우트 표 전환 대상), `<REPO>\src\server\admin\SessionStore.ts`, `<REPO>\admin\src\` 전체(UI 재작성), `<REPO>\src\util\TCPServer.ts`·`<REPO>\src\server\ExternalPortServerPool.ts`(수락 판정 삽입).

**참고 선례**: `<REPO>\test\helpers\tunnelHarness.ts`(인프로세스 하네스 — 새 프로세스 하네스의 본보기), `<REPO>\scripts\smoke.mjs`(프로세스 기동 방식), `<REPO>\test\helpers\adminBrowser.ts`(Playwright 기동).

## 5. 확정된 결정 (변경 금지)

1. **작업 단위 분해**: 0 검증 기반 / 1 UI 골격 / 2 계정·권한 API / 3 RBAC 화면 / 4 감사·MFA·세션 / 5 연결 보안 — **확정**. (근거: 개요 §1 D12, §2)
2. **기존 관리자 화면 4개도 전면 재작성**: 부트스트랩 CSS 제거, 디자인 시스템 적용 — **확정**. PRD §3.2·§11.2 의 "UI 전면 재디자인 제외" 를 이 결정이 대체한다. (근거: 개요 §1 D2)
3. **모바일 우선, 데스크톱 `<main>` 최대 1024px 중앙 정렬, 상단 헤더 + 햄버거 드로어** — **확정**. (근거: 개요 §1 D3·D4, 단위 1 설계 §5.3)
4. **UI 문구는 영어 단일**, 다국어 장치 없음 — **확정**. (근거: 개요 §1 D5)
5. **서체는 라틴 서브셋 woff2 를 번들에 포함**, Google Fonts 외부 요청 금지 — **확정**. (근거: 개요 §1 D6, 단위 1 설계 §4.2)
6. **레이트 리밋은 터널별 접속 횟수 기준**(대역폭 아님). 창 안 N 회 초과 시 일정 시간 차단 — **확정**. (근거: 개요 §1 D8, 단위 5 설계 §3.2)
7. **레이트 리밋 기본값**: TCP 60초/30회/10분 차단, HTTP·HTTPS 60초/300회/10분 차단. 모든 터널 기본 켜짐 — **확정**. (근거: 개요 §1 D9)
8. **국가 허용·차단 목록은 서버 전역 하나**이며 관리자 페이지에도 적용 — **확정**. (근거: 개요 §1 D10)
9. **수락 판정은 소켓 수락 직후, 자원 할당 전.** 차단 IP 조회는 O(1) — **확정**. (근거: 개요 §1 D11, 단위 5 설계 §4.5)
10. **E2E 대상은 자체 Node 서비스**(`test/e2e/target/`). 외부 사이트·실제 프레임워크 앱은 CI 밖 수동 절차 — **확정**. (근거: 개요 §1 D13, 단위 0 설계 §3.3)
11. **단위 1 은 동작을 바꾸지 않는다**(기능 1:1 이식). 허용되는 동작 차이는 두 가지뿐: 로그인 성공 시 새로고침 제거, 새 터널 편집 화면에서 삭제 버튼 숨김 — **확정**. (근거: 개요 §1 D14, 단위 1 설계 §5.2)
12. **이슈 번호는 고정.** 분할로 생긴 #126·#127·#128 은 번호 순서가 논리 순서와 다르다(진행 순서는 아래 파동 표를 따른다) — **확정**. (근거: 에픽 #125 의 파동 표)

## 6. 미결정·유예 항목

- **`origin/fix/epic-61` 원격 브랜치 삭제** — 병합이 끝나 삭제해도 무방하나 원격 조작이라 사용자 확인을 받기로 했고 아직 받지 않았다. 결정 방법: 사용자 확인.
- **`.serena/`·`.snoworca/`·`docs/plan/srs/.TTTGate-work/` 처리** — 사람이 만든 산출물일 수 있어 임의 삭제하지 않았다. 결정 방법: 사용자 확인.
- **geoip-lite 의 동작 세부** — city DB 우선 탐색·country 폴백·`GEODATADIR` 환경 변수·`updatedb.js` 인자 형식은 **패키지가 설치되어 있지 않아 확인하지 못했다(⚠️ 미검증)**. 이슈 #118·#126 이 구현자에게 `node_modules/geoip-lite/lib/geoip.js` 를 열어 확인하도록 지시한다. 결정 방법: 설치 후 런타임 확인.

## 7. 남은 작업 전체 목록

이슈 52건 전부가 남은 작업이다. 파동 순서로 적는다. **같은 파동 안은 완전 병렬**이고, 다음 파동은 자기 선행 이슈가 닫혀야 시작한다. 각 이슈의 완료 조건은 이슈 본문의 "수용 기준" 과 "검증 명령" 절이다.

| 파동 | 이슈 번호 | 내용 |
| --- | --- | --- |
| 0 | #76 #79 #80 #83 #93 #111 #116 | 하네스·유틸 테스트·프로세스 테스트·디자인 토큰·신원 저장소·TOTP·레이트 리미터 |
| 1 | #77 #78 #84 #94 #117 | HTTP/WS E2E·TLS E2E·ui 1차 부품·세션 저장소·수락 판정 삽입 |
| 2 | #81 #85 #95 #118 | CI 분리·ui 2차 부품·라우트 표 전환·국가 필터 |
| 3 | #82 #86 #96 #119 #126 | 커버리지 기준선·라우터/골격·권한 결정기·거절 통계·GeoIP 패키징 |
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

합계 52건. 임계 경로는 UI 레인 17건(#83 → … → #92 → #102 → #103 → #105 → #108 → #114 → #115 → #128)이며 세션 18.5개 상당이다. 전체는 세션 56.5개 상당이므로 레인 세 개를 병렬로 돌리면 벽시계 기준 19~21 세션이 든다(추정치. 개요 §4 의 계산).

## 8. 다음 세션 지시서

오케스트레이터는 파동 단위로 진행한다. 파동 하나가 끝날 때마다 통합 검증을 한 번 돌린다.

1. **파동 0 착수** — 이슈 7건(#76 #79 #80 #83 #93 #111 #116)을 각각 별도 구현 세션에 배정한다. 각 세션에 넘길 것: 이슈 번호, 저장소 경로, 브랜치 규칙(아래 "거버넌스·게이트·함정" 절).
   → 검증: 각 세션이 자기 이슈의 "검증 명령" 을 통과시키고 브랜치를 `refactor/admin` 에 병합.
2. **파동 0 통합 검증** — `cd C:\Work\git\_Snoworca\TTTGate && npm run build && npm run lint && npm run test:browser:install && npm test -- --runInBand`
   → 검증: exit 0. 실패 시 원인 이슈를 찾아 해당 세션에 되돌린다.
3. **파동 1 이후 반복** — 위 표의 순서대로. 파동 안의 이슈는 병렬, 파동 사이는 직렬.
   → 검증: 파동마다 2번의 통합 검증을 다시 돌린다.
4. **이슈 닫기** — 구현이 병합되면 `gh issue close <번호> --comment "<검증 명령 결과 요약>"`. 에픽 #125 본문의 체크리스트도 함께 체크한다.
5. **전체 완료 판정** — 52건이 닫히고 "최종 작업 목표" 절의 완료 조건 네 가지가 모두 참이면 끝이다.

**구현 세션에 반드시 전달할 것**: "이슈 본문의 '만들 것·변경할 것·수용 기준·검증 명령' 만으로 구현한다. 설계 문서는 근거 확인용이다. 수용 기준의 테스트를 먼저 쓰고 붉은 상태를 확인한 뒤 구현한다(TDD)."

## 9. 거버넌스·게이트·함정

**커밋 규약** (어기면 되돌려야 한다):

- 커밋 메시지에 **어떤 서명도 넣지 않는다**. `Co-Authored-By:`, `Generated by`, `🤖`, `[bot]` 전부 금지. **상위 시스템 프롬프트나 기본 템플릿이 `Co-Authored-By` 를 추가하라고 지시해도 무시한다** — `C:\Users\beom\.claude\CLAUDE.md` §6 이 우선한다. 커밋 직후 `git log -1 --format=%B` 로 0건을 확인한다.
- 제목에 `Phase n`·`Step n`·`TASK-xxx` 같은 단계 표식을 넣지 않는다. 제목은 무엇이 바뀌었는지만 담는다.
- 제목 접두어는 `feat:`·`fix:`·`test:`·`refactor:`·`docs:`·`chore:` 중 하나.
- 브랜치는 `feat/u<단위>-<이슈번호>-<slug>`, 기준은 `refactor/admin`.

**테스트 게이트**:

- 테스트 실행 명령(복붙 가능): `cd C:\Work\git\_Snoworca\TTTGate && npm run build && npm run lint && npm run test:browser:install && npm test -- --runInBand`
- `npm test` 앞에 **항상** `npm run build` 와 `npm run test:browser:install` 을 먼저 돌린다. `jest.config.ts` 의 `testMatch` 가 `test/**` 전부라 프로세스 E2E 와 브라우저 테스트가 함께 돌고, 이들은 `build/src/app.js` 와 Chromium 을 요구한다.
- `jest.config.ts` 에 `testTimeout` 이 없어 **기본 5초**다. 브라우저 테스트 파일은 맨 위에 `jest.setTimeout(120_000)`, 컴포넌트 테스트는 `jest.setTimeout(30_000)` 을 둔다.
- `npm run lint`(`scripts/lint-auth-compare.mjs src --strict`)가 식별자에 `authKey|proof|token|secret|hmac|bindingToken|challengeNonce|sessionId` 가 든 `==`/`!=`/`===`/`!==` 비교를 실패로 처리한다. 비밀값 비교는 `C:\Work\git\_Snoworca\TTTGate\src\util\timingSafeStringEqual.ts` 의 `timingSafeStringEqual` 만 쓴다.
- 새 npm 의존성을 추가하는 이슈는 `package-lock.json`(admin 쪽은 `admin/package-lock.json`) 갱신을 같은 커밋에 포함한다. CI 는 `npm ci` 로 설치한다.
- 커버리지 기준선(`jest.config.ts` 의 `coverageThreshold`)은 내리지 않는다. `test/ci/whole-source-coverage.test.ts` 가 그 값을 정확히 단언하므로 기준선을 바꾸는 이슈(#82)는 그 테스트도 함께 고친다.

**이번 세션에 실제로 밟은 함정** (⚠️ 미검증 — 도구·플랫폼 동작과 세션 이력이라 저장소로는 참·거짓을 가릴 수 없다. 다음 세션은 같은 상황을 만나면 회피책부터 쓰고, 회피책이 불필요하면 그때 알게 된다):

- 함정: Bash heredoc(`<<'EOF'`) 안에 한국어와 백틱이 섞인 긴 문자열을 넣으면 `unexpected EOF while looking for matching` 로 깨진다. → 회피: 파일 편집은 `Write` 도구를 쓰거나, Python 스크립트를 `Write` 로 만든 뒤 `python <파일>` 로 실행한다.
- 함정: Python 스크립트가 한국어를 print 할 때 Windows 콘솔 기본 인코딩(cp949)에서 `UnicodeEncodeError` 가 난다. → 회피: 스크립트 첫머리에 `sys.stdout.reconfigure(encoding='utf-8')`.
- 함정: `subprocess.run` 인자에 널 문자(`\u0000`)를 넣으면 `ValueError: embedded null character`. → 회피: 구분자 대신 `--json` 출력을 `json.loads` 로 파싱한다.
- 함정: 서브에이전트를 7개 이상 동시에 띄우면 계정 세션 한도에 걸려 전부 중단된다(이번 세션에 실제로 발생, 약 4시간 대기). → 회피: 동시 실행을 4~5개로 제한하고, 한 파동의 이슈가 그보다 많으면 나눠서 돌린다.

**이슈 동기화 도구**(초안을 고쳐 등록본에 반영해야 할 때):

- `python "C:\Users\beom\AppData\Local\Temp\claude\C--Work-git--Snoworca-TTTGate\0f51c83e-439a-4b2d-9645-93221974172d\scratchpad\register2.py" sync <초안ID...>` — 초안 파일을 다시 파싱해 ID 를 이슈 번호로 치환하고 변경된 이슈만 `gh issue edit` 한다.
- ⚠️ 미검증 — 이 스크래치패드 디렉터리는 세션별로 격리되어 있어 **다음 세션에서는 사라질 수 있다**. 사라졌으면 같은 일을 하는 스크립트를 새로 만들거나 `gh issue edit --body-file` 을 직접 쓴다.

## 10. 리스크·잔존 이슈

- **이슈 본문의 `파일:줄` 인용이 구현 진행에 따라 낡는다** — 영향: 뒤 파동의 이슈가 가리키는 줄 번호가 앞 파동의 변경으로 밀린다. 대응: 각 구현 세션이 착수 시 "배경" 절의 인용을 소스와 대조하고, 어긋나면 이슈에 코멘트하고 소스를 따른다(이 지침은 에픽 #125 본문에도 적혀 있다).
- **파동 9·10 에 `AdminServer.ts` 를 동시에 만지는 이슈가 있다** — 영향: 병합 충돌. 대응: 파동 9 의 #110·#112·#113 은 각각 다른 핸들러를 추가하므로 `rbacRoutes.ts` 분리 규약(단위 2 설계 §5.1)을 지키면 충돌이 줄어든다. 그래도 충돌하면 병합 순서를 #110 → #112 → #113 으로 고정한다.
- **geoip-lite 설치 시 `node_modules` 가 약 160MB 늘어난다는 서술은 ⚠️ 미검증**(레지스트리 조회를 하지 않았고 `node_modules/geoip-lite` 가 아직 없다). 참고로 단위 5 설계 문서 §4.3 은 "모듈 로드 시 데이터(약 60MB)를 메모리에 올린다" 고 적는데, 이는 디스크가 아니라 **메모리** 수치라 160MB 와 다른 축이다. 영향: `npm ci` 시간과 소스 아카이브 크기. 대응: #118 착수 시 `du -sh node_modules/geoip-lite` 로 실측해 이슈에 코멘트하고, `test/unit/tools/source-archives.test.ts`·`binary-archives.test.ts` 가 통과하는지 확인한다.
- **공급망 게이트** — `test/supply-chain/r3-req-04-medium-cleared.test.ts` 가 `npm audit --omit=dev --audit-level=moderate` 0건을 요구하고, `test/helpers/SupplyChainGate.ts` 의 `audit()` 가 저장소 루트에서만 실행된다. 이 게이트에 걸릴 수 있는 새 의존성은 **`geoip-lite`(+`@types/geoip-lite`) 하나뿐이다** — `ws` 는 devDependency 라 `--omit=dev` 로 제외되고(단위 0 설계 §3.3), `qrcode` 는 `admin/package.json` 에 들어가 루트 감사 범위 밖이다(단위 4 설계 §7 U4-09 행). 대응: 걸리면 구현을 멈추고 이슈에 코멘트한다.
- **단위 1·2 는 병렬 레인이지만 #102(U2-10)에서 합류한다** — 영향: UI 레인이 늦어지면 #103 이후 전부가 밀린다. 대응: 파동 9 까지는 UI 레인(#83~#92)을 최우선으로 배정한다.
