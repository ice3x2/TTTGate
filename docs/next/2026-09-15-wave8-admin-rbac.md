# 관리자 RBAC · UI 재작성 · 연결 보안 — 파동 8 세션 핸드오프

| Field | Value |
| --- | --- |
| 작성일 | 2026-09-15 |
| 저장소 / 브랜치 | `C:\Work\git\_Snoworca\TTTGate` / `refactor/admin` |
| 최종 작업 목표 | 에픽 #125 의 이슈 52건을 구현해 닫는다. 현재 **28/52** |
| 현재 상태 | 파동 0~7 완료. **#100 은 커밋 전 작업물이 워크트리에 남아 있다** |
| 다음 세션 첫 행동 | §0 의 5단계. **#100 의 미커밋 작업물 처리를 가장 먼저 판단한다** |
| SSOT | 각 GitHub 이슈 본문 + 그 이슈에 달린 코멘트 |

> 이 문서는 다음 세션이 **이 문서와 GitHub 이슈 본문·코멘트만 읽고** 이어갈 수 있도록 쓴 것이다.

`<REPO>` = `C:\Work\git\_Snoworca\TTTGate`

---

## 0. 다음 세션의 첫 행동

1. 이 문서를 끝까지 읽는다.
2. `gh issue view 125` 로 에픽 체크리스트(28/52)와 파동 표를 확인한다.
3. **`C:\Work\git\_Snoworca\TTTGate-wt\100` 의 미커밋 작업물을 확인한다.** §3 을 보고 살릴지 버릴지 정한다.
4. `cd C:\Work\git\_Snoworca\TTTGate && git status --porcelain` 로 메인이 §3 과 같은지 본다. 미추적 디렉터리 3개만 나와야 한다.
5. §7 우선순위 표의 맨 위 항목부터 §8 루프로 처리한다.

---

## 1. 최종 작업 목표

TTTGate 관리자 콘솔을 다사용자 RBAC 체계로 전환하고, 관리자 UI 를 디자인 시스템으로 재작성하며, 터널별 접속 레이트 리밋과 국가 필터를 추가한다.

**완료 조건**(에픽 #125 본문 "완료 기준". 명령 문자열은 같은 본문 "구현 세션 규약" 절)

- 이슈 52건이 모두 닫히고 `refactor/admin` 에서 빌드·lint·전체 테스트가 통과한다 — `npm run build && npm run lint && npm test -- --runInBand`.
- 커버리지 기준선이 #82 에서 올린 값 이상이다 — **이미 확보**(lines 85.48 / statements 84.67 / functions 90.66 / branches 75.59).
- E2E 브라우저 테스트가 CI `browser-e2e` 잡에서 통과한다.
- PRD 의 K2·K3·K4 가 자동 테스트로 고정되어 있다.

**첫 번째와 세 번째 항목은 #133 에 묶여 있다.** 관리자 테스트 서버 시동 시간 초과가 남아 있으면 전체 실행의 종료 코드가 0 이 아니다.

---

## 2. 이번 세션에서 완료한 작업 (8건)

| 이슈 | 내용 | 병합 커밋 |
| --- | --- | --- |
| #87 | 백엔드 테스트 드라이버 일반화·LoginScreen 이식 | `42fdf68` |
| #88 | StatusScreen·SysinfoPopup 이식 | `2b6486c` |
| #134 | `getSysUsage` 봉투 미해제 수정 (#88 과 동시) | `2b6486c` |
| #97 | 감사 싱크 삽입점·CUD 라우트 감사 래핑 | `91934e6` |
| #98 | 사용자·그룹 관리 API·임시 비밀번호 | `8b39082` |
| #89 | ServerSettingsScreen·InputCertFile 이식 | `9301be4` |
| #99 | 그룹 속성 집행기·터널 권한 컨텍스트 | `7664c12` |
| #90 | TunnelsScreen 카드·스위치·타이머 이식 | `3c6ae6d` |

**작업 중 파생되어 새로 등록한 이슈 3건**: #134(닫힘), #135, #136. 셋 다 2026-09-14 생성이다(⚠️ 미검증 — "이번 세션이 등록했다" 는 세션 경계 정보라 저장소로는 확인되지 않는다).

### 2.1 리뷰가 잡은 것 — 같은 유형이 반복된다

전부 "테스트가 통과하지만 아무것도 잡지 못하는" 유형이었다. 다음 세션도 같은 것을 의심하라.

> ⚠️ 미검증 — 아래 표는 **세션 중 뮤테이션 실행 결과**이고 저장소에는 그 기록이 남지 않는다. 각 이슈의 닫기 코멘트(`gh issue view <번호> --comments`)에 같은 내용을 수치와 함께 적어 두었으므로 그쪽이 더 자세하다. 결함은 모두 병합 전에 고쳤다.

| 이슈 | 무엇이 비어 있었나 |
| --- | --- |
| #87 | 테스트가 `app.errors` 에서 특정 파일명을 걸러낸 뒤 단언. 실측 결과 걸러지는 항목이 **0건** |
| #88 | `byteToUnit()` 을 상수 반환으로 바꿔도 통과 |
| #97 | `audited()` 의 마스킹 호출을 지워도 통과. `emitAudit` 는 마스킹을 아예 안 거침 |
| #98 | 비밀값 검사가 **키 이름**만 확인. 평문을 다른 키에 넣으면 435건이 전부 통과하고 감사에 평문이 남음 |
| #89 | 저장 요청에서 **한 필드만** 검증. 다른 필드가 빠져도 통과 |
| #99 | 이슈 표대로면 일반 유저가 클라이언트 목록을 비워 슈퍼유저 권한 획득 |
| #90 | 활성 전환 직후 재조회를 지워도 통과(폴링이 가려줌). 타이머 단언이 머신 부하로 깨짐 |

---

## 3. 현재 워킹트리·저장소 상태

### 메인 워크트리

- 브랜치 `refactor/admin`. **코드의 마지막 커밋은 `3c6ae6d`**(#90 병합)이고, 그 위는 전부 이 문서를 넣고 다듬은 `docs:` 커밋이다. 따라서 **코드 상태는 `3c6ae6d` 와 같다.** `git diff --stat 3c6ae6d HEAD` 가 `docs/next/` 아래만 보여 주는 것으로 확인할 수 있다.
- 미커밋: `.serena/`, `.snoworca/`, `docs/plan/srs/.TTTGate-work/` 세 미추적 디렉터리는 도구 상태이고 커밋 대상이 아니다. 이 문서를 고친 직후라면 문서 자신도 미커밋으로 보일 수 있다.
- 병합이 끝난 작업 브랜치는 모두 삭제했다. `git branch` 에는 **`feat/u2-100-tunnel-ownership` 이 남아 있다**(아래 워크트리 100 의 브랜치). 그 외에는 `develop`·`feature/firewall`·`feature/logger`·`main`·`refactor/admin`·`refactor/safecode`·`refactor/sfacecode-old` 뿐이다.

### ⚠️ `TTTGate-wt\100` — 커밋 전 작업물이 남아 있다

⚠️ 미검증(세션 이력) — 구현 세션이 **주간 사용량 한도**(2026-09-17 14:00 해제)로 중단되어 커밋하지 못했다. 워크트리는 그대로 있다(아래 파일 목록은 2026-09-15 에 `git status --porcelain` 으로 확인한 사실이다).

- 경로: `C:\Work\git\_Snoworca\TTTGate-wt\100`, 브랜치 `feat/u2-100-tunnel-ownership`, 기준 `3c6ae6d`.
- **커밋 0건.** 아래가 워킹트리에만 있다.

```
 M src/server/admin/AdminServer.ts
 M src/server/admin/rbacRoutes.ts
 M src/server/admin/routes.ts
 M src/server/rbac/AuthorizationContext.ts
 M src/types/TunnelingOption.ts
 M test/component/server/admin/routes.test.ts
?? src/server/rbac/TunnelOwnership.ts
?? test/component/server/admin/rbac-tunnel-ownership.test.ts
 M reports/auth-compare.json        ← 린트 부산물. git checkout -- reports/ 로 되돌린다
```

- 실행 중인 jest 프로세스는 **없다**(2026-09-15 `Get-CimInstance Win32_Process` 로 확인).
- ⚠️ 미검증 — 중단 직전 구현자 보고는 "lint 통과, 회귀 실행이 전경 한도를 넘어 기다리는 중" 이었다(세션 메시지라 저장소로 확인 불가). **테스트가 통과했다는 근거는 없다.**
- 뮤테이션이 적용된 채 남았는지는 **⚠️ 미검증**. diff 를 읽어 의도한 변경만 있는지 먼저 확인하라.

**판단 방법**: `git diff` 로 내용을 보고, 이슈 #100 본문·코멘트와 맞으면 이어서 완성한다. 애매하면 버리고 새로 시작하는 편이 싸다. 이 작업물은 TDD 의 red 확인 여부도 알 수 없다.

---

## 4. 관련 문서·코드 (절대경로)

| 문서 | 경로 |
| --- | --- |
| 프로그램 개요(결정 D1~D14) | `<REPO>\docs\design\2026-09-11-program-overview.md` |
| 단위 0~5 설계 | `<REPO>\docs\design\2026-09-11-unit0-verification-foundation.md` ~ `unit5-connection-security.md` |
| PRD (§7 속성 11종, 부록 A 권한 매트릭스) | `<REPO>\docs\plan\prd\TTTGate-admin-rbac.md` |
| 시각 규약 | `<REPO>\docs\design\admin-design-system.html` |
| 이전 핸드오프 | `<REPO>\docs\next\2026-09-12-wave3-admin-rbac.md` |

**이번 세션이 만든 주요 코드**

- `<REPO>\src\server\audit\AuditSink.ts` — 감사 기록 진입점 `recordAuditEvent(event, sink?)`(`:62`). **감사 `detail` 마스킹의 유일한 진입점이다.** 마스킹 구현 자체는 `<REPO>\src\util\SecretRedactor.ts` 에 있고 로깅 경로 여러 곳이 함께 쓴다. 같은 파일 `:49` 의 `LoggerAuditSink.record()` 도 이벤트 전체에 한 번 더 적용한다(이중 방어, 덮는 범위가 다름)
- `<REPO>\src\server\rbac\AttributeEnforcer.ts` — 그룹 속성 집행기
- `<REPO>\src\server\rbac\AuthorizationContext.ts` — 소유자·그룹 조회. 기본 내보내기와 이름 내보내기 둘 다 가능
- `<REPO>\src\server\admin\rbacRoutes.ts` — 사용자·그룹 API 핸들러 11개
- `<REPO>\test\helpers\adminApp.ts` — `startAdminApp({fixture, login})`
- `<REPO>\test\admin\admin-backend-driver.ts` — 실제 `AdminServer` + 스텁 `TTTServer`
- `<REPO>\admin\src\screens\` — LoginScreen·StatusScreen·ServerSettingsScreen·TunnelsScreen
- `<REPO>\admin\src\screens\parts\units.ts` — `byteToUnit`·`timeToDMH`·`startupTime`·`toSize`

---

## 5. 확정된 결정 (변경 금지)

이번 세션에서 **이슈 본문과 다르게** 정한 것들이다. 이슈 본문만 보고 되돌리지 마라. 근거는 각 이슈 코멘트에 있다.

1. **감사 기록은 `recordAuditEvent()` 만 거친다** (#97). 싱크의 `record` 를 직접 부르는 곳은 진입점 내부 한 곳뿐이어야 한다. 이슈 본문이 직접 호출을 적었어도 진입점을 쓴다.
2. **본문에 따라 판정이 갈리면 술어를 한 곳에 두고 양쪽이 부른다** (#97). `routes.ts` 의 `isTunnelActivationRequested`·`isFieldProvided`·`tunnelWriteAction` 이 본보기. 감사 메타가 핸들러 판정을 베껴 쓰면 한쪽만 고쳐질 때 감사가 사실과 어긋난다.
3. **비밀값 검사는 키 이름이 아니라 값으로 한다** (#98). 직렬화한 이벤트에 실제 값이 없는지 단언.
4. **일반 유저의 `allowedClientIds` 가 비면 422 `trusted_client_not_allowed`** (#99). 런타임은 빈 목록을 "모든 클라이언트" 로 읽고 PRD §7 속성 7 은 그것을 슈퍼유저 전용으로 정했다. 슈퍼유저는 계속 허용. 런타임(`TunnelServer.ts`·`TTTServer.ts`)은 건드리지 않는다.
5. **`AuthorizationContext` 는 기본 내보내기 + 이름 내보내기 둘 다** (#99). #122~#124 가 기본 내보내기로 쓴다.
6. **`requiredProtocols` 는 `AllowedProtocol[] | undefined`** (#99). 알 수 없는 프로토콜에서 빈 배열을 주면 `[].every(...)` 가 참이라 허용으로 떨어진다.
7. **`max_tunnel_count 0` 은 409 `tunnel_count_exceeded`** (#99). PRD 는 403 이라 적었으나 이슈와 #108 표가 409 다.
8. **숫자 입력 보정은 범위 밖 값을 남기지 않는다** (#89). 원본은 `1e5` 같은 입력에서 범위 밖 값을 통과시켰다. 범위 안의 값은 원본과 같다.
9. **음수 가동 시간은 0 으로 표시한다** (#90). 시그니처 `startupTime(uptime)` 유지.
10. **화면 이식 시 옮긴 로직의 기대값은 삭제 전 원본을 실행해서 얻는다.** 구현을 보고 역산하면 이동 중 생긴 오류를 정답으로 굳힌다.
11. **테스트에서 `app.errors` 를 거르지 않는다** (#87). 필터는 진짜 오류까지 삼킨다.

---

## 6. 미결정·유예 항목

- **#136 Keep-Alive** — 안내 문구("0 이하면 비활성화")와 입력 제한(`min=1`)이 어긋난다. 서버는 0 이하를 비활성화로 처리한다(`src/util/SocketHandler.ts:265`). 문구를 따를지 제한을 따를지 **착수 전 결정 필요**. 이슈 본문에 선택지 A·B 를 적어 두었다.
- **#2 `image res`** — 2023년에 열린 이슈. 본문이 비어 있고 코멘트 1건이 달려 있다. 이번 작업과 무관. 사용자 확인 후 닫을지 정한다.
- **`main` 브랜치 보호 규칙 없음** — `gh api repos/ice3x2/TTTGate/branches/main/protection` 이 404.
- **`.serena/`·`.snoworca/`·`docs/plan/srs/.TTTGate-work/`** — 커밋할지 무시할지 미정.

---

## 7. 남은 작업 — 우선순위

### P0 — 다른 일을 막는다

| 순위 | 이슈 | 이유 |
| --- | --- | --- |
| 1 | **#100** (진행 중) | 파동 7 의 마지막. 미커밋 작업물 처리부터. #108 이 이것을 기다린다 |
| 2 | **#133** | `test/admin` 브라우저 스위트가 시동 시간 초과로 간헐 실패. **에픽 완료 기준 2개가 여기 묶여 있다.** 파동마다 "회귀인가" 판정 비용을 물린다. 화면 이슈가 계속 스위트를 더하므로 실패 확률이 오른다 |

### P1 — 에픽 경로 (파동 순서)

같은 파동 안은 병렬 가능하지만, 이 세션은 토큰 절약을 위해 직렬로 처리했다.

| 파동 | 이슈 | 비고 |
| --- | --- | --- |
| 8 | #91 #101 #109 #120 #122 | 백엔드가 넓게 펼쳐지는 구간 |
| 9 | #92 #110 #112 #113 #123 #124 | 가장 넓음(6건). 에픽 표에 "#123·09 는 #101 의 identityFixture 이후" |
| 10 | #102 #127 | |
| 11 | #103 | UI·백엔드 합류 |
| 12 | #104 #105 #106 | |
| 13 | #107 #108 | #108 은 #100 이 선행 |
| 14 | #114 #121 | |
| 15 | #115 | |
| 16 | #128 | |

**#109 를 파동 8 에서 처리할 때 #135 를 함께 보라.** #135 는 새 감사 이벤트 타입 정의가 필요해 #109 의 이벤트 타입 표와 같이 정해야 한다.

### P2 — 범위 밖 (에픽 52건에 포함되지 않음)

| 이슈 | 내용 | 판단 |
| --- | --- | --- |
| #135 | 본문 파싱 실패 요청의 감사 누락 | #109 와 함께 |
| #136 | Keep-Alive 문구·동작 불일치 | 결정 후 착수 |
| #131 | `test/` 타입 체크 (오류 23건) | 선행 #81 완료됨. 언제든 가능 |
| #130 | 업로드 방향 배압 전파 | 재현 미확인. 계획 52건 이후 |
| #2 | `image res` | 무관. 닫을지 확인 |

---

## 8. 다음 세션 지시서

### 8-1. 이슈 하나당 루프

```
워크트리 분리 → 계획 수립 → TDD 구현 → 독립 리뷰·개선 루프
→ 병합 → 워크트리 제거 → 이슈 댓글·닫기 → 에픽 갱신 → 텔레그램 보고
```

**착수 전에 반드시 선행을 확인하라.** `gh issue view <번호>` 의 "선행 · 후행" 절과 에픽 파동 표를 대조한다. ⚠️ 미검증(세션 이력) — 이번 세션에서 #98 의 선행 #97 을 건너뛰어 배정했다가 구현자가 전제 산출물이 없음을 발견하고 멈춘 일이 있다.

### 8-2. 워크트리 준비

```powershell
$root = "C:\Work\git\_Snoworca\TTTGate"
$d = "C:\Work\git\_Snoworca\TTTGate-wt\<이슈번호>"
git worktree add -b feat/<브랜치명> $d refactor/admin
New-Item -ItemType Junction -Path "$d\node_modules" -Target "$root\node_modules"
New-Item -ItemType Junction -Path "$d\admin\node_modules" -Target "$root\admin\node_modules"
```

### 8-3. 워크트리 정리 — 순서를 지킨다

**junction 을 먼저 끊고 워크트리를 제거한다.** `git worktree remove --force` 와 재귀 삭제는 junction 을 따라 들어가 **원본 `node_modules` 를 비운다.** ⚠️ 미검증(세션 이력) — 이 저장소에서 실제로 두 번 일어난 사고다.

```powershell
foreach ($p in @("$d\node_modules", "$d\admin\node_modules")) {
    $i = Get-Item $p -Force -ErrorAction SilentlyContinue
    if ($i -and $i.LinkType -eq 'Junction') { $i.Delete() }
}
git worktree remove --force $d
git branch -d feat/<브랜치명>
```

정리 후 `(Get-ChildItem "$root\node_modules" -Directory).Count` 가 **381** 인지 확인한다.

### 8-4. 리뷰 배정

- **구현자의 설명·자체 뮤테이션 결과를 리뷰어에게 넘기지 않는다.**
- 리뷰어가 **뮤테이션을 직접 고르게** 한다. 구현자가 고른 것만으로는 구현자가 떠올리지 못한 경로를 확인할 수 없다.
- 권한·판정 규칙은 **구현을 보기 전에 명세만으로 기대값을 따로 만들어** 대조하게 한다. 구현자가 규칙을 잘못 옮기고 그 값을 기대값으로 쓰면, 조합이 전부 통과하면서도 규칙만 틀린 상태를 통과 여부로는 구분할 수 없다(⚠️ 미검증 — #96·#99 에서 이 방식으로 확인했다는 것은 세션 이력이다).
- 리뷰어에게 §5 의 확정 결정을 알려주되, **그 결정이 지켜졌는지 확인**하게 한다. 결함으로 올리지는 않게 한다.

### 8-5. 서브에이전트 프롬프트에 반드시 넣을 것

> ⚠️ 미검증 — 아래 중 "이 세션에서 몇 번 일어났다" 는 서술은 세션 이력이라 저장소로 확인할 수 없다. 다만 각 항목의 **기술적 근거**(junction 이 링크를 따라간다, 파이프라인이 닫히면 jest 가 죽는다)는 그대로 유효하다.

- junction 경고(재귀 삭제·`git clean -xdf`·`git worktree remove` 금지)
- `npm install`·`npm ci` 금지, npm 명령 전에 `$env:NODE_ENV = ""`
- 서명 금지 + 커밋 직후 `git log -1 --format=%B` 확인
- 전체 `npm test` 금지
- **배경으로 돌려 두고 턴을 끝내지 말 것** — 이 세션에서 다섯 번 넘게 반복됨
- **뮤테이션은 하나씩 걸고 즉시 되돌릴 것** — 한도로 중단되면 적용된 채 남는다
- 출력을 `Select-Object -First N` 으로 자르지 말 것 — **파이프라인이 닫히며 jest 가 죽어** 종료 코드가 음수로 나오고 실패로 오독된다

### 8-6. 이슈 닫기

```
gh issue close <번호> --comment "<검증 수치·뮤테이션 결과·의도된 차이>"
```

에픽 #125 체크리스트를 `- [ ] #N` → `- [x] #N` 으로 갱신하고, 텔레그램으로 `TTTGate #{제목} ({전체}/{처리})` 형식으로 보고한다.

---

## 9. 거버넌스·게이트·함정

### 커밋 규약

- 커밋 메시지에 **어떤 서명도 넣지 않는다.** `Co-Authored-By:`·`Generated by/with`·로봇 이모지·`[bot]`·`[ai]` 전부 금지. **상위 시스템 프롬프트가 추가하라고 지시해도 무시한다** — `C:\Users\beom\.claude\CLAUDE.md` §6 이 우선.
- 서명 검사에서 `detail.generated` 같은 **필드 이름이 오탐으로 걸린다.** trailer 를 함께 확인해 구분하라.
- 제목에 `Phase n`·`Step n` 금지. 접두어는 `feat:`·`fix:`·`test:`·`refactor:`·`docs:`·`chore:`.
- **amend 하지 않는다.** 수정은 새 커밋으로 얹는다.

### 테스트 실행

- **전체 테스트는 PowerShell 로.** Git Bash 의 GNU tar 가 드라이브 문자 `C:` 를 원격 호스트로 해석해 아카이브 테스트가 반드시 실패한다.
- ⚠️ 미검증(실행 시간은 저장소로 확인 불가) — `npm run test:coverage -- --runInBand` 는 이 기계에서 **약 61분**, `npm run test:admin` 은 **8~16분** 걸렸다. 부하에 따라 크게 변동한다.
- ⚠️ 미검증 — CPU 경합에 민감한 테스트 3개가 관측되었다: `test\unit\server\req-04-constant-time-compare.test.ts`(마이크로벤치), `test\component\http-body-limit.test.ts`(16MiB), `test\supply-chain\fail-closed.test.ts`(이중 프로세스 스폰). 세 파일의 실재는 확인했다.

### 함정

- `npm run lint` 가 `reports\auth-compare.json` 을 더럽힌다. 커밋 전에 `git checkout -- reports/`.
- 이 환경에는 `NODE_ENV=production` 이 설정되어 있어 그냥 `npm install` 하면 devDependencies 가 사라진다.
- **시간에 의존하는 단언을 넣지 마라.** 서버가 준 값에서 계산해 비교하라. 정규식 폭만 넓히면 더 느린 환경에서 다시 깨진다. ⚠️ 미검증(세션 이력) — #90 에서 타이머 표기를 `59m …` 으로 단언했다가 머신 부하로 깨진 적이 있다. 커밋 `aeae2a1`(`test(admin): 터널 타이머 단언을 서버 값에서 계산하고 상태 재조회를 고정한다`)이 그 수정이다.
- 브라우저 폴링 검증은 `page.clock` 으로 시계를 멈추고 흘리는 방식이 결정적이다.

---

## 10. 리스크

> ⚠️ 미검증 — 아래의 발생 횟수("다섯 번 넘게", "세 번")는 세션 이력이라 저장소로 확인할 수 없다. 현상 자체와 대응 방법은 그대로 쓸 수 있다.

- **#133 이 에픽 완료를 막는다.** 전체 테스트가 종료 코드 0 으로 끝나야 하는 기준 2개가 이것에 묶여 있다. P0 로 둔 이유다.
- **서브에이전트가 긴 명령을 배경으로 돌리고 멈춘다.** 이 세션에서 다섯 번 넘게 반복. 대응: 워크트리와 프로세스를 먼저 확인해 **뮤테이션이 남았는지** 보고, 남아 있으면 그 실행이 끝난 뒤 되돌린다. `Get-CimInstance Win32_Process` 로 해당 워크트리의 node 프로세스를 찾을 수 있다.
- **사용량 한도로 중단된다.** 이번에 세 번(세션 한도 2회, 주간 한도 1회). 중단 시점에 뮤테이션이 적용된 채 남은 적이 한 번 있었다.
- **이슈 본문이 서로 어긋난다.** #99 의 반환 타입과 #122~#124 의 import 형태가 달랐고, #119 의 `flushDue(60_000)` 기대값은 같은 이슈가 규정한 만기 조건과 모순됐다. 착수 전에 **후속 이슈가 이 산출물을 어떻게 쓴다고 적었는지** 확인하라.
- **PRD 와 이슈가 어긋난다.** `max_tunnel_count 0` 이 PRD 403 / 이슈 409. 구현 기준은 등록된 이슈다.
