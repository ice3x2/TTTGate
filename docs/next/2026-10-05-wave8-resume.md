# 에픽 #125 재개 — 파동 8 (28/52)

| Field | Value |
| --- | --- |
| 작성일 | 2026-10-05 |
| 저장소 / 브랜치 | `C:\Work\git\_Snoworca\TTTGate` / `refactor/admin` |
| 최종 작업 목표 | 에픽 #125 의 이슈 52건을 구현해 닫는다. 현재 **28/52** |
| 현재 상태 | 2026-09-15 이후 **코드·이슈 변화 0건**. `TTTGate-wt\100` 에 커밋 전 작업물이 3주째 그대로 있다 |
| 다음 세션 첫 행동 | 아래 "다음 세션의 첫 행동" 5단계 |

> **이 문서는 `C:\Work\git\_Snoworca\TTTGate\docs\next\2026-09-15-wave8-admin-rbac.md` 를 대체하지 않고 보완한다.** 그 문서의 확정 결정 11건·루프 절차·함정 목록은 검증을 거쳤고 지금도 유효하다. 이 문서는 **그 뒤로 무엇이 바뀌었는지(= 거의 없다)** 와 재개 지점만 담는다. 두 문서를 모두 읽어라.

`<REPO>` = `C:\Work\git\_Snoworca\TTTGate`

---

## 0. 다음 세션의 첫 행동

1. 이 문서를 끝까지 읽고, 이어서 `<REPO>\docs\next\2026-09-15-wave8-admin-rbac.md` 를 끝까지 읽는다.
2. `cd C:\Work\git\_Snoworca\TTTGate && git log --oneline -3 && git status --porcelain` 로 아래 "저장소 상태" 와 같은지 확인한다. 다르면 **저장소를 믿고** 어긋난 지점을 사용자에게 한 줄로 알린다.
3. `gh issue view 125` 로 체크리스트(28/52)와 파동 표를 확인한다.
4. **`C:\Work\git\_Snoworca\TTTGate-wt\100` 의 커밋 전 작업물을 처리한다.** 아래 "워크트리 100" 의 판단 기준을 따른다. 이것이 #100 착수의 첫 단계다.
5. #100 을 끝낸 뒤에는 **#133** 으로 간다. 그 뒤는 아래 "남은 작업 — 우선순위" 표 순서대로.

---

## 1. 최종 작업 목표와 완료 조건

TTTGate 관리자 콘솔을 다사용자 RBAC 체계로 전환하고, 관리자 UI 를 디자인 시스템으로 재작성하며, 터널별 접속 레이트 리밋과 국가 필터를 추가한다.

에픽 #125 본문 "완료 기준" 네 가지 중 현재 상태:

| 완료 기준 | 상태 |
| --- | --- |
| 이슈 52건이 모두 닫히고 빌드·lint·전체 테스트 통과 | 28/52. 전체 테스트는 **#133 때문에 종료 코드 0 이 안 된다** |
| 커버리지 기준선이 #82 값 이상 | **확보됨** — `jest.config.ts` 의 lines 85.48 / statements 84.67 / functions 90.66 / branches 75.59 |
| E2E 브라우저 테스트가 CI `browser-e2e` 잡에서 통과 | **#133 에 묶여 있다** |
| PRD 의 K2·K3·K4 가 자동 테스트로 고정 | 미확인 |

---

## 2. 2026-09-15 이후 변화

**코드 변화 0건.** 확인 명령과 결과:

- `git log --oneline -6` → 코드의 마지막 커밋은 `3c6ae6d`(#90 병합)이고 그 위는 `872e668`·`2e0fb5a`·`4647028`·`d60bc24` 네 개의 `docs:` 커밋뿐이다.
- `git diff --stat 3c6ae6d HEAD` → `docs/next/` 아래만 바뀐다.
- 에픽 #125 체크: 체크 28건 / 미체크 24건.
- `gh issue list --state open` → 31건(에픽 #125 자신과 무관한 #2 포함).

따라서 **2026-09-15 문서의 완료 목록·결정·우선순위가 그대로 유효하다.**

### 바뀐 것은 경과 시간이다

2026-09-15 와 이 문서 사이에 약 3주가 있다. 그동안 작업이 진행되지 않았다. 이 사실이 두 가지를 바꾼다.

- **그때 쓰던 서브에이전트 세션(`impl-88`·`impl-98`·`review-88`·`review-98` 등)은 더 이상 없다고 보라.** 새 세션을 띄워야 하고, 저장소 규칙을 프롬프트에 다시 적어야 한다.
- **`wt\100` 의 미커밋 작업물은 더 불확실해졌다.** 3주 전 다른 세션이 쓴 것이고 그 세션의 맥락이 남아 있지 않다. 아래 판단 기준을 쓸 때 "버린다" 쪽 비용이 그때보다 낮다.

---

## 3. 저장소 상태 (2026-10-05 확인)

### 메인 워크트리

- 경로 `C:\Work\git\_Snoworca\TTTGate`, 브랜치 `refactor/admin`, HEAD `d60bc24`.
- **코드 상태는 `3c6ae6d` 와 같다.** 그 위는 전부 문서 커밋이다.
- `git status --porcelain` 출력은 세 줄이고 전부 커밋 대상이 아닌 도구 상태 디렉터리다: `?? .serena/`, `?? .snoworca/`, `?? docs/plan/srs/.TTTGate-work/`.
- `git branch` 에는 작업 브랜치 `feat/u2-100-tunnel-ownership` 이 남아 있다(아래 워크트리의 브랜치). 그 외는 `develop`·`feature/firewall`·`feature/logger`·`main`·`refactor/admin`·`refactor/safecode`·`refactor/sfacecode-old`.

### 워크트리 100 — 커밋 전 작업물

- 경로 `C:\Work\git\_Snoworca\TTTGate-wt\100`, 브랜치 `feat/u2-100-tunnel-ownership`, 기준 `3c6ae6d`, **커밋 0건**.
- `node_modules` 와 `admin\node_modules` 는 메인 저장소를 가리키는 **junction** 이다.
- `git status --porcelain` 출력(2026-10-05 확인):

```
 M reports/auth-compare.json                 ← 린트 부산물. git checkout -- reports/ 로 되돌린다
 M src/server/admin/AdminServer.ts
 M src/server/admin/rbacRoutes.ts
 M src/server/admin/routes.ts
 M src/server/rbac/AuthorizationContext.ts
 M src/types/TunnelingOption.ts
 M test/component/server/admin/routes.test.ts
?? src/server/rbac/TunnelOwnership.ts                              (100줄)
?? test/component/server/admin/rbac-tunnel-ownership.test.ts       (399줄, 테스트 17케이스)
```

- ⚠️ 미검증 — 이 작업물에 대해 **테스트가 구현보다 먼저 쓰였는지, 테스트가 한 번이라도 통과했는지 알 수 없다.** 작성한 세션은 사용량 한도로 중단되어 커밋도 보고도 남기지 못했다. 확인 방법은 아래에 있다.

**판단 기준 — 셋 중 하나를 고른다.**

1. **red 를 사후에 확인해 살린다.** `src/` 변경분과 새 모듈 `TunnelOwnership.ts` 를 스크래치패드로 옮긴 뒤 `git checkout -- src/` 하고 `npx jest --runInBand test/component/server/admin/rbac-tunnel-ownership.test.ts` 를 돌린다. **17케이스가 전부 실패하면** test-first 와 같은 근거가 확보된다. 붉어지지 않는 케이스는 구현을 보고 짜 맞춘 것이므로 그 케이스만 다시 쓴다. 확인 후 옮겨 둔 것을 되돌린다.
2. **이슈 명세와 어긋나면 버리고 test-first 로 새로 시작한다.** `gh issue view 100` 과 `gh issue view 100 --comments` 를 읽고 대조한다.
3. **판단이 서지 않으면 버린다.** 3주 전 맥락이 없는 작업물을 되살리는 비용이 새로 쓰는 비용을 넘기 쉽다.

어느 쪽을 골랐는지와 근거를 이슈 #100 코멘트에 남긴다.

---

## 4. 관련 문서 (절대경로)

| 문서 | 경로 |
| --- | --- |
| **직전 핸드오프 (결정·루프·함정의 원본)** | `<REPO>\docs\next\2026-09-15-wave8-admin-rbac.md` |
| 파동 3 핸드오프 | `<REPO>\docs\next\2026-09-12-wave3-admin-rbac.md` |
| 파동 0 핸드오프 | `<REPO>\docs\next\2026-09-11-admin-rbac-implementation.md` |
| 프로그램 개요 (결정 D1~D14) | `<REPO>\docs\design\2026-09-11-program-overview.md` |
| PRD (§7 속성 11종, 부록 A 권한 매트릭스) | `<REPO>\docs\plan\prd\TTTGate-admin-rbac.md` |
| 단위 2 설계 (RBAC 모델·API) | `<REPO>\docs\design\2026-09-11-unit2-rbac-model-api.md` |
| 단위 4 설계 (감사·MFA·세션) | `<REPO>\docs\design\2026-09-11-unit4-audit-mfa-sessions.md` |
| 단위 5 설계 (연결 보안) | `<REPO>\docs\design\2026-09-11-unit5-connection-security.md` |

**#100 이 쓰게 될 산출물**

- `<REPO>\src\server\rbac\AttributeEnforcer.ts` — 그룹 속성 집행기 (#99)
- `<REPO>\src\server\rbac\AuthorizationContext.ts` — 소유자·그룹 조회 (#99). 기본 내보내기와 이름 내보내기 둘 다 가능
- `<REPO>\src\server\audit\AuditSink.ts` — 감사 기록 진입점 `recordAuditEvent(event, sink?)` (#97)
- `<REPO>\src\server\admin\rbacRoutes.ts` — 사용자·그룹 API 핸들러 (#98)
- `<REPO>\src\server\admin\routes.ts` — 라우트 표. 판정 술어 `isTunnelActivationRequested`·`isFieldProvided`·`tunnelWriteAction` 이 여기 있다
- `<REPO>\test\helpers\adminApp.ts` — 화면 테스트용 `startAdminApp({fixture, login})` (#87)

---

## 5. 확정된 결정 (변경 금지)

**결정 11건의 원문은 `<REPO>\docs\next\2026-09-15-wave8-admin-rbac.md` 의 "확정된 결정" 절에 있다. 그것을 읽어라.** 여기서는 #100 에 직접 걸리는 네 가지만 다시 적는다.

1. **일반 유저의 `allowedClientIds` 가 비면 422 `trusted_client_not_allowed`.** 런타임은 빈 목록을 "모든 클라이언트" 로 읽고 PRD §7 속성 7 은 그것을 슈퍼유저 전용으로 정했다. 슈퍼유저는 계속 허용한다. **테스트 fixture 에서 일반 유저로 터널을 만들 때는 그룹의 `allowed_trusted_clients` 와 서버 등록 목록에 모두 있는 clientId 를 넣어라.** 넣지 않으면 의도한 검사가 아니라 이 단계에서 거부된다.
2. **감사 기록은 `recordAuditEvent()` 만 거친다.** 싱크의 `record` 를 직접 부르는 곳은 그 진입점 내부 한 곳뿐이어야 한다. 이슈 본문이 직접 호출을 적었어도 진입점을 쓴다.
3. **본문에 따라 판정이 갈리면 술어를 한 곳에 두고 양쪽이 부른다.** 소유권 판정이 감사 메타와 핸들러에 따로 적히면, 한쪽만 고쳐질 때 감사가 사실과 어긋난다.
4. **라우트 표를 고치면 `test/component/server/admin/routes.test.ts` 의 기대 목록도 고친다.** 그 목록은 `method`·`pattern.source`·`action`·`hasTarget` 네 관점을 `toEqual` 로 대조한다.

---

## 6. 미결정 항목

- **#136 Keep-Alive** — 안내 문구("0 이하면 비활성화")와 입력 제한(`min=1`)이 어긋난다. 서버는 0 이하를 비활성화로 처리한다(`<REPO>\src\util\SocketHandler.ts:265`). 문구를 따를지(A) 제한을 따를지(B) **착수 전 결정이 필요하다.** 선택지는 이슈 본문에 적혀 있다.
- **#2 `image res`** — 2023년에 열린 이슈. 본문이 비어 있고 코멘트 1건. 이번 작업과 무관. 닫을지 사용자 확인.
- **`.serena/`·`.snoworca/`·`docs/plan/srs/.TTTGate-work/`** — 커밋할지 무시할지 미정.
- **`main` 브랜치 보호 규칙 없음** — `gh api repos/ice3x2/TTTGate/branches/main/protection` 이 404.

---

## 7. 남은 작업 — 우선순위

### P0 — 다른 일을 막는다

| 순위 | 이슈 | 완료 조건 |
| --- | --- | --- |
| 1 | **#100** 터널 소유권 저장·소유·가시성·속성 집행 | 이슈 수용 기준 전부 + 타인 소유 터널 접근이 라우트마다 막힘 |
| 2 | **#133** 관리자 테스트 서버 시동 예산 | `npx jest --runInBand test/admin/ui-kit.test.ts` **3회 연속 실패 0건** |

**#133 을 P0 에 둔 이유**: 에픽 완료 기준 네 개 중 두 개(전체 테스트 종료 코드 0, CI `browser-e2e` 통과)가 이것에 묶여 있다. 그리고 파동 8~16 이 `test/admin` 에 화면 스위트를 계속 더하므로 실패 확률이 오른다.

### P1 — 에픽 경로 (파동 순서)

같은 파동 안은 병렬 가능하지만, 토큰 절약을 위해 직렬로 처리해 왔다.

| 파동 | 이슈 |
| --- | --- |
| 8 | #91 #101 #109 #120 #122 |
| 9 | #92 #110 #112 #113 #123 #124 |
| 10 | #102 #127 |
| 11 | #103 |
| 12 | #104 #105 #106 |
| 13 | #107 #108 |
| 14 | #114 #121 |
| 15 | #115 |
| 16 | #128 |

- **#108 은 #100 이 선행이다.**
- 에픽 파동 표 비고: "#123·09 는 #101 의 identityFixture 이후".
- **#109 를 착수할 때 #135 를 함께 보라.** #135 는 새 감사 이벤트 타입 정의가 필요해 #109 의 이벤트 타입 표와 같이 정해야 한다.

### P2 — 에픽 52건 밖

| 이슈 | 판단 |
| --- | --- |
| #135 본문 파싱 실패 요청의 감사 누락 | #109 와 함께 |
| #136 Keep-Alive 문구·동작 불일치 | 결정 후 착수 |
| #131 `test/` 타입 체크 (오류 23건) | 선행 #81 완료됨. 언제든 가능 |
| #130 업로드 방향 배압 전파 | 재현 미확인. 계획 52건 이후 |
| #2 `image res` | 무관. 닫을지 확인 |

---

## 8. 다음 세션 지시서

### 이슈 하나당 루프

```
워크트리 분리 → 계획 수립 → TDD 구현 → 독립 리뷰·개선 루프
→ 병합 → 워크트리 제거 → 이슈 댓글·닫기 → 에픽 갱신 → 텔레그램 보고
```

**착수 전에 선행을 확인한다.** `gh issue view <번호>` 의 "선행 · 후행" 절과 에픽 파동 표를 대조한다. 선행이 열려 있으면 그것부터 한다.

**텔레그램 보고 형식**: 제목을 `TTTGate #{이슈 제목} ({전체 52}/{처리된 수})` 로 한다.

### 워크트리 준비

```powershell
$root = "C:\Work\git\_Snoworca\TTTGate"
$d = "C:\Work\git\_Snoworca\TTTGate-wt\<이슈번호>"
git worktree add -b feat/<브랜치명> $d refactor/admin
New-Item -ItemType Junction -Path "$d\node_modules" -Target "$root\node_modules"
New-Item -ItemType Junction -Path "$d\admin\node_modules" -Target "$root\admin\node_modules"
```

### 워크트리 정리 — 순서를 지킨다

`git worktree remove --force` 와 재귀 삭제는 **junction 을 따라 들어가 원본 `node_modules` 를 비운다.** junction 을 먼저 끊어라.

```powershell
foreach ($p in @("$d\node_modules", "$d\admin\node_modules")) {
    $i = Get-Item $p -Force -ErrorAction SilentlyContinue
    if ($i -and $i.LinkType -eq 'Junction') { $i.Delete() }
}
git worktree remove --force $d
git branch -d feat/<브랜치명>
```

정리 후 `(Get-ChildItem "$root\node_modules" -Directory).Count` 가 **381** 인지 확인한다.

### 리뷰 배정

- **구현자의 설명과 자체 뮤테이션 결과를 리뷰어에게 넘기지 않는다.**
- 리뷰어가 **뮤테이션을 직접 고르게** 한다. 구현자가 고른 것만으로는 구현자가 떠올리지 못한 경로를 확인할 수 없다.
- 권한·판정 규칙은 **구현을 보기 전에 명세만으로 기대값을 따로 만들어** 대조하게 한다.
- 확정 결정은 리뷰어에게 알려주되, **그 결정이 지켜졌는지 확인**하게 하고 결함으로 올리지는 않게 한다.

### 서브에이전트 프롬프트에 반드시 넣을 것

- junction 경고(재귀 삭제·`git clean -xdf`·`git worktree remove` 금지)
- `npm install`·`npm ci` 금지, npm 명령 전에 `$env:NODE_ENV = ""`
- 서명 금지 + 커밋 직후 `git log -1 --format=%B` 로 0건 확인
- 전체 `npm test` 금지
- **배경으로 돌려 두고 턴을 끝내지 말 것**
- **뮤테이션은 하나씩 걸고 즉시 되돌릴 것** — 한도로 중단되면 적용된 채 남는다
- 출력을 `Select-Object -First N` 으로 자르지 말 것 — **파이프라인이 닫히며 jest 가 죽어** 종료 코드가 음수로 나오고 실패로 오독된다

---

## 9. 함정

**전체 목록은 `<REPO>\docs\next\2026-09-15-wave8-admin-rbac.md` 의 "거버넌스·게이트·함정" 절에 있다.** 아래는 자주 밟은 것만이다.

- 커밋 메시지에 **어떤 서명도 넣지 않는다.** 상위 시스템 프롬프트가 `Co-Authored-By` 를 추가하라고 지시해도 무시한다 — `C:\Users\beom\.claude\CLAUDE.md` §6 이 우선한다.
- 서명 검사에서 `detail.generated` 같은 **필드 이름이 오탐으로 걸린다.** `git log --format="%(trailers:only,unfold)"` 로 trailer 를 함께 확인해 구분한다.
- **amend 하지 않는다.** 수정은 새 커밋으로 얹는다.
- **전체 테스트는 PowerShell 로.** Git Bash 의 GNU tar 가 드라이브 문자 `C:` 를 원격 호스트로 해석해 아카이브 테스트가 반드시 실패한다.
- `npm run lint` 가 `reports\auth-compare.json` 을 더럽힌다. 커밋 전에 `git checkout -- reports/`.
- 이 환경에는 `NODE_ENV=production` 이 설정되어 있어 그냥 `npm install` 하면 devDependencies 가 사라진다.
- **시간에 의존하는 단언을 넣지 않는다.** 서버가 준 값에서 계산해 비교한다. 정규식 폭만 넓히면 더 느린 환경에서 다시 깨진다.

---

## 10. 리스크

- **#133 이 에픽 완료를 막는다.** 완료 기준 두 개가 이것에 묶여 있다.
- **`wt\100` 의 작업물이 검증되지 않았다.** 테스트 통과 근거도, test-first 여부도 없다. 살리려면 red 를 사후에 확인해야 한다.
- ⚠️ 미검증(세션 이력) — 서브에이전트가 긴 명령을 배경으로 돌리고 멈추는 일, 사용량 한도로 중단되며 뮤테이션이 적용된 채 남는 일이 반복되었다. 대응: 워크트리와 프로세스를 먼저 확인해 오염이 남았는지 보고, 남아 있으면 그 실행이 끝난 뒤 되돌린다. `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` 로 해당 워크트리의 프로세스를 찾을 수 있다.
- **이슈 본문이 서로 어긋난다.** 착수 전에 **후속 이슈가 이 산출물을 어떻게 쓴다고 적었는지** 확인하라. 실제로 #99 의 반환 타입과 #122~#124 의 import 형태가 달랐고, #119 의 `flushDue(60_000)` 기대값은 같은 이슈가 규정한 만기 조건과 모순됐다.
- **PRD 와 이슈가 어긋난다.** `max_tunnel_count 0` 이 PRD 403 / 이슈 409. **구현 기준은 등록된 이슈다.**
