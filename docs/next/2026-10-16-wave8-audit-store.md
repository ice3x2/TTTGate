# 핸드오프 — 에픽 #125 파동 8 이어서 (#109 커밋 직전)

작성 2026-10-16 · 이 문서는 `docs/next/2026-09-15-wave8-admin-rbac.md` 를 보완한다. **확정 결정 11건·루프 절차·함정 전체 목록은 그 문서에 있으므로 둘을 모두 읽어라.**

## 0. 다음 세션의 첫 행동

**#109 는 닫혔다.** 커밋 `3721d18`, 병합 `e683fb3`, 에픽 32/52. 워크트리와 브랜치도 제거했다.

**#120 은 착수했다가 작업물을 잃었다. 처음부터 다시 해야 한다.** 워크트리 `C:\Work\git\_Snoworca\TTTGate-wt\120`(브랜치 `feat/u5-120-security-routes`)은 남아 있으나 **내용이 비어 있다**(HEAD = `e683fb3`, 변경 0건). 구현자가 사용량 한도로 종료되면서 `git reset` 으로 워킹트리를 되돌렸고, `git fsck --lost-found` 의 매달린 커밋은 모두 2026-04~09 의 다른 작업이라 복구 수단이 없다.

잃은 것이 무엇이었는지는 §11 에 적어 두었다. **그 절을 먼저 읽으면 같은 설계를 두 번 고민하지 않는다.**

첫 명령은 이것이다.

```powershell
Set-Location C:\Work\git\_Snoworca\TTTGate-wt\120
git status --porcelain      # 비어 있어야 한다
gh issue view 120 --json body --jq .body > $env:TEMP\i120.md
```

워크트리가 이미 있으니 다시 만들지 마라. `node_modules` junction 도 걸려 있다. 끊어져 있으면 §6 의 명령으로 다시 걸어라.

그다음 §1 의 루프를 따른다. 닫는 절차는 §8 이 #109 의 예로 남아 있으니 이슈 번호만 바꿔 쓰면 된다.

## 1. 최종 작업 목표

GitHub 에픽 `https://github.com/ice3x2/TTTGate/issues/125` 의 **남은 이슈 20건을 모두 닫는다.**

이슈 하나당 루프는 다음과 같다. 사용자가 정한 순서다.

```
워크트리 분리 → 문제 해결 계획 수립 → TDD 로 구현 → 다른 서브에이전트로 코드 리뷰와 개선 루프
→ 병합 → 워크트리 제거 → 이슈에 댓글 달고 닫기 → 에픽 이슈에 해결 상태로 개선 → 텔레그램 보고
```

텔레그램 보고의 제목 형식은 정확히 이것이다.

```
TTTGate #{이슈 제목}  ({전체이슈 개수}/{현재까지 처리된 이슈 개수})
```

`#101` 때 보낸 예: `TTTGate #test(admin): 레거시 admin 승격 E2E 와 롤백 백업·마이그레이션 문서 추가  (52/31)`

## 2. 현재까지의 작업

### 에픽 진척

`gh issue view 125` 의 체크리스트 기준 **32/52** 다. 체크 32, 미체크 20.

### 이번 세션이 한 것

1. **관리자 화면 시안 확정** — `docs/design/2026-10-15-admin-console-mockup.html` (3,119줄, 커밋 전 untracked). 열한 차례 검증·수정 루프를 돌려 210여 건을 처리했다. 화면 이슈 11건(#102~#108·#114·#115·#121·#128)의 모양 근거다.
2. **#101 완료** — 이전 세션의 커밋 전 작업물을 인계받아 검증·수정·병합·닫기까지 했다. 커밋 `5329a98`, 병합 `da7d1d6`.
3. **#109 구현 중** — 워크트리에 작업물이 있고 커밋 전이다. 이 문서의 주제다.
4. **`CLAUDE.md` 에 규칙 추가** — 프로젝트 `CLAUDE.md` 끝에 "작업 진행 방식" 절. **서브에이전트는 최대 한 개, 모든 작업은 직렬.** 변경이 커밋되지 않았다(`git status` 에 ` M CLAUDE.md`).

### #101 에서 고친 결함 (기록용)

`.key` 가 기동 전과 같다는 단언이 **재작성을 배제하지 못했다.** `admin.passwordHash === keyContent.trim()` 과 `bcrypt.compareSync(평문, keyContent)` 둘만으로는, 서버가 같은 평문을 새 salt 로 다시 해시해 양쪽을 바꾼 경우를 가려낼 수 없다(bcrypt 는 salt 가 해시 안에 있다). 하네스의 `ADMIN_PASSWORD_HASH` 를 export 해 원문과 직접 대조하도록 고쳤다.

## 3. #109 워킹트리 상태

워크트리 `C:\Work\git\_Snoworca\TTTGate-wt\109`, 브랜치 `feat/u4-109-file-audit-store`, HEAD 는 기준 커밋 `da7d1d6` 그대로(커밋 0건).

`node_modules` 와 `admin/node_modules` 는 원본 저장소로 가는 **junction** 이다. 제거할 때 §8 의 순서를 반드시 지켜라.

### 커밋할 파일 (20개)

신규 6개:

```
src/server/audit/AuditEventTypes.ts
src/server/audit/FileAuditSink.ts
test/component/server/admin/audit-file.test.ts
test/unit/server/audit/AuditEventTypes.test.ts
test/unit/server/audit/FileAuditSink.test.ts
test/unit/server/audit/auditSinkSwap.test.ts
```

수정 14개:

```
src/server/ServerApp.ts
src/server/ServerOptionStore.ts
src/server/TTTServer.ts
src/server/admin/AdminServer.ts
src/server/admin/rbacRoutes.ts
src/server/admin/routes.ts
src/server/audit/AuditSink.ts
src/server/rbac/IdentityStore.ts
src/types/TunnelingOption.ts
src/util/SecretRedactor.ts
test/component/server/admin/audit-sink.test.ts
test/unit/server/ServerOptionStore.test.ts
test/unit/server/rollback-backup.test.ts
test/unit/util/SecretRedactor.test.ts
```

### 커밋에서 **빼야** 하는 것

```
reports/req-01-chi2.json      # 난수 분포 통계, 실행마다 값이 달라진다
reports/req-01-entropy.json   # 엔트로피 측정, 같은 이유
config/.server.state.json     # 테스트가 만든 런타임 파일, .gitignore 에 없다
config/identity.yaml          # 테스트가 만든 런타임 파일, .gitignore 에 없다
```

`reports/auth-compare.json` 은 작성 시점에 더티하지 않다(`scannedFiles: 65` 로 커밋된 그대로). 다만 `npm run lint` 를 돌리면 더러워지므로, 린트를 돌린 뒤에는 그것까지 함께 되돌려라.

커밋 직전에 반드시 이것을 돌려라.

```
git checkout -- reports/
rm -f config/.server.state.json config/identity.yaml
```

근거: `docs/next/2026-10-05-wave8-resume.md` 가 "`npm run lint` 가 `reports\auth-compare.json` 을 더럽힌다. 커밋 전에 `git checkout -- reports/`" 라고 적는다. 이슈 #109 의 "변경할 것" 에 `reports/` 와 `config/` 는 없다.

## 4. 관련 문서의 절대 경로

- 이슈 본문(SSOT): `gh issue view 109 --json body --jq .body`
- 이슈 #109 근거 문서
  - `C:\Work\git\_Snoworca\TTTGate\docs\design\2026-09-11-unit4-audit-mfa-sessions.md`
  - `C:\Work\git\_Snoworca\TTTGate\docs\design\issues\unit4.md`
  - `C:\Work\git\_Snoworca\TTTGate\docs\plan\prd\TTTGate-admin-rbac.md`
- 이전 핸드오프
  - `C:\Work\git\_Snoworca\TTTGate\docs\next\2026-09-15-wave8-admin-rbac.md` — **확정 결정 11건·루프·함정의 원본. 반드시 읽어라**
  - `C:\Work\git\_Snoworca\TTTGate\docs\next\2026-10-05-wave8-resume.md`
  - `C:\Work\git\_Snoworca\TTTGate\docs\next\2026-09-12-wave3-admin-rbac.md`
  - `C:\Work\git\_Snoworca\TTTGate\docs\next\2026-09-11-admin-rbac-implementation.md`
- 화면 시안(확정): `C:\Work\git\_Snoworca\TTTGate\docs\design\2026-10-15-admin-console-mockup.html`
- 폐기된 시안: `C:\Work\git\_Snoworca\TTTGate\docs\design\2026-10-06-rbac-screens-mockup.html` — 사용자가 "끔찍하다" 고 평가해 폐기했다. 지울지 여부를 아직 답받지 못했다
- 프로젝트 지침: `C:\Work\git\_Snoworca\TTTGate\CLAUDE.md`

## 5. 확정된 결정

`2026-09-15-wave8-admin-rbac.md` 의 확정 결정 11건은 그대로 유효하다. 이번 세션이 더한 것은 다음 다섯이다. **재논의 대상이 아니다.**

### D-A. #109 의 싱크 교체 지점은 `TTTServer.applyServerOption` 이다

이슈 본문은 `ServerApp.updateServerOption(option)` 에 두라고 적었으나 **이 저장소의 `ServerApp` 에는 그 메서드가 없다.** `ServerApp` 은 `{start(options?)}` 객체다(워크트리 `src/server/ServerApp.ts:82`, 메인 `:72`). 저장된 옵션을 실행 중 서버에 반영하는 단 하나의 경로는 `TTTServer.applyServerOption(nextOption, previousOption)`(워크트리 `src/server/TTTServer.ts:301`, 메인 `:282`)이고 `AdminServer.ts:641-642` 가 그것을 부른다.

그 함수는 이미 "이전 값과 다를 때만 반영" 하는 관용구를 쓴다 — geo 는 `canonicalEquals` 가드로, `globalMemCacheLimit` 은 `!==` 가드로 거른다. **`sessionTtl` 은 그 예가 아니다**: `configureSessionTtl` 은 조건 없이 매번 불린다(워크트리 `TTTServer.ts:323`). `sessionTtlMs` 의 `!==` 비교는 `recordAppliedServerOption()`(`:274` 부근)이 리비전 표식을 올릴 때만 쓴다.

구현은 그 안의 `private static applyAuditOption(nextOption)` 한 곳이다. 새 `ServerApp.updateServerOption` 을 만들지 마라 — 적용 경로가 둘로 갈린다.

### D-B. `close()` 뒤에도 선점한 칸의 기록은 받는다

`src/server/audit/FileAuditSink.ts` 의 `record()` 첫 줄이 `if(this._closed && this._reserved === 0)` 다. `this._closed` 만 보고 거부하면 **감사 설정을 바꾸는 저장의 `server_option_updated` 줄이 사라진다.**

까닭: `AdminServer.audited()`(워킬트리 `src/server/admin/AdminServer.ts:355`, 메인 `:354`)가 `reserve()` 시점의 싱크 참조를 고정해 두고 핸들러가 끝난 뒤 그 참조에 기록한다. 그런데 `onUpdateServerOption` 핸들러가 `audited()` **안에서** `applyServerOption` → `applyAuditOption` 을 불러 옛 싱크를 닫는다. 그래서 잡아 둔 칸이 있는데도 기록이 reject 되고 `logger.error` 로만 끝났다. 이슈가 "드롭 금지" 를 핵심 계약으로 못박은 바로 그 구멍이다.

`audited()` 는 고치지 않는다(이슈 "하지 말 것" 1번).

### D-C. 선점은 소유되지 않는다

`reserve()` 는 개수만 센다. 어느 호출자의 `record()` 든 선점된 칸 하나를 소비한다. 테스트를 쓸 때 "선점 뒤 첫 `record()` 가 거부된다" 고 기대하지 마라 — 첫 것이 그 칸을 쓴다.

### D-D. `#101` 테스트는 최상위 민감 필드 네 개를 모두 벗긴다

`test/unit/server/rollback-backup.test.ts` 의 `saving an option that carries none of the rollback-sensitive fields creates no backup` 가 `connectionSecurity`·`mfaRequiredForSuperusers`·`auditRetentionDays`·`auditQueueSize` 를 모두 구조 분해로 벗긴다. `#109` 가 뒤 둘을 민감 필드로 쓰고 `verificationServerOption` 이 그 둘을 항상 기본값(90·1000)으로 채우기 때문이다. **단언을 뒤집지 마라** — 그러면 그 테스트가 잡던 것이 사라진다.

### D-E. 서브에이전트는 최대 한 개, 모든 작업은 직렬

프로젝트 `CLAUDE.md` 의 "작업 진행 방식" 절에 적혀 있다. 이 세션이 그것을 어겨 거짓 실패를 세 번 겪었다(§6).

## 6. 함정 — 반드시 읽어라

### 부하가 만드는 거짓 실패

이 저장소의 전체 테스트는 **4,692초**(약 78분) 걸린다. 다른 테스트나 Playwright 를 **병행하면 타임아웃과 `ECONNRESET` 로 거짓 실패가 난다.** 이번 세션에서 세 번 겪었다.

| 실행 | 실패 | 단독 재실행 결과 |
|---|---|---|
| #101 의 첫 타깃 실행 | 3건 | 13건 전부 통과 |
| #109 의 첫 전체 실행 | 4건 | 그 가운데 3건은 단독 통과 |
| #109 의 두 번째 전체 실행 | 9건 | **무효** — 실행 중에 파일을 고쳤다 |

판정 방법: 실패한 묶음만 **다른 작업 없이** 다시 돌린다. 통과하면 부하였다. 실패 사유가 `Exceeded timeout of 5000 ms` 나 `read ECONNRESET` 이면 부하를 강하게 의심하라.

**전체 테스트를 띄워 둔 채로 소스를 고치지 마라.** 그 실행은 무효가 되고 78분을 버린다. 이번 세션이 그 실수를 했다.

### PowerShell 로 돌려라

Git Bash 의 GNU tar 가 드라이브 문자를 호스트로 오해해 아카이브 테스트가 실패한다. 출력은 파일로 받아라. `Select-Object -First N` 을 파이프에 쓰면 파이프라인 조기 종료로 jest 가 죽는다.

```powershell
Set-Location C:\Work\git\_Snoworca\TTTGate-wt\109
$out = "<scratchpad>\full.txt"
npm test -- --runInBand *> $out
Write-Output "exit=$LASTEXITCODE"
Select-String -Path $out -Pattern '^(Tests|Test Suites):' | ForEach-Object { $_.Line }
```

### 워크트리 제거 순서

`git worktree remove --force` 가 junction 을 따라가 **원본 `node_modules` 를 비운다.** 먼저 링크를 끊어라.

```powershell
$wt = 'C:\Work\git\_Snoworca\TTTGate-wt\109'
foreach ($n in @('node_modules','admin\node_modules')) {
  $p = Join-Path $wt $n
  if (Test-Path $p) { $i = Get-Item $p -Force; if ($i.LinkType) { $i.Delete() } }
}
```

끊은 뒤 원본이 온전한지 확인하라. 정상값은 `node_modules` 380개 전후, `admin/node_modules` 43개 전후다(의존성이 늘면 바뀜다 — junction 을 끔기 전과 뒤의 갯수가 같은지를 보라).

### 중복 id 검사의 거짓 양성

HTML 문서에서 `grep 'id="..."'` 로 세면 `<code>` 안의 문자열까지 센다. 태그 안의 속성만 세라.

```bash
node -e "const h=require('fs').readFileSync('<file>','utf8');const ids=[...h.matchAll(/<[a-zA-Z][^>]*?\sid=\"([^\"]+)\"/g)].map(m=>m[1]);const d=ids.filter((v,i)=>ids.indexOf(v)!==i);console.log(ids.length,[...new Set(d)])"
```

### Python heredoc 에서 한국어

Windows 의 Python 이 stdin 을 cp949 로 읽어 한국어 리터럴이 깨진다. 한국어 블록은 **파일로 먼저 쓰고** `encoding='utf-8'` 로 읽어 치환하라. `/tmp` 는 Python 에서 보이지 않으니 워크트리 안에 임시 디렉터리를 만들어 쓰고 지워라.

### 사용량 한도가 작업물을 지운다

**이 세션에서 실제로 잃었다.** `#120` 의 구현자가 사용량 한도(HTTP 429)로 종료되면서 `git reset` 으로 워킹트리를 되돌렸다. 신규 테스트 파일 하나와 라우트·핸들러 변경이 모두 사라졌고, `git fsck --lost-found` 의 매달린 커밋은 전부 다른 시기의 것이라 복구 수단이 없었다.

**방지 방법은 중간 커밋이다.** 구현 서브에이전트에게 "커밋하지 마라" 고 지시하지 말고, **red 를 확인한 직후와 green 을 만든 직후에 각각 WIP 커밋을 남기라**고 지시하라. 최종 메시지는 나중에 `git reset --soft` 로 합치거나 `--amend` 로 다듬으면 된다. 커밋되지 않은 작업물은 한도·크래시·에이전트 오작동에 모두 취약하다.

서브에이전트 지시문에 이것을 넣어라.

```
구현을 시작하기 전에 현재 상태로 기준을 남기고, red 확인 직후와 green 직후에
각각 `git add -A; git commit -m "wip: <단계>"` 를 하시오. 최종 커밋 메시지는
제가 정리합니다. 커밋하지 않은 채로 턴을 끝내지 마시오.
```
### 서브에이전트가 멈춘다

이번 세션의 구현자가 **18시간 동안 아무것도 진척시키지 못했다.** 배경 작업을 기다리다 멈춘 채로 있었다. 진척이 없으면 `TaskStop` 으로 중단하고 직접 처리하라. 중단 전에 워킹트리를 확인해 **뮤테이션이 남아 있지 않은지** 보라.

## 7. 남은 작업

### #109 를 닫기 전에 할 것

1. **전송 테스트는 다시 돌릴 필요가 없다** — 전송 실행의 실패 4건은 조사를 마쳤다(§9-1). `security-bans` 는 부하여서이고, `roundtrip-once` 는 **#109 와 무관한 기존 결함**이다. 둘 다 #109 를 닫는 것을 마지 않는다.
2. **MEDIUM 2건 판단** — 리뷰가 지적했다. 이슈 수용 기준이 요구하지 않으므로 **닫기를 막지는 않는다.** 그대로 둘지 테스트를 더할지 판단하고, 그대로 두면 이슈 댓글에 사실로 적어라.
   - `FileAuditSink.startRetentionTimer()` 를 어떤 테스트도 덮지 않는다. 본문을 `{}` 로 비워도 전 스위트가 통과한다. 보존 삭제가 하루 한 번 돈다는 기능 전체가 무검증이다
   - 워킬트리 `ServerApp.ts:40-46` 의 싱크 생성·등록 블록도 무검증이다. 통째로 지우면 기본 `LoggerAuditSink` 로 돌아가 파일이 하나도 생기지 않는데 전 스위트가 통과한다
3. **커밋 범위 정리** — §3 의 `git checkout -- reports/` 와 런타임 파일 삭제

### #109 커밋 메시지 (리뷰가 제안, 서명 0건)

```
feat(server): 감사 이벤트를 날짜별 jsonl 파일에 append-only 로 남긴다

큐 상한을 reserve() 로 선점해 가득 차면 CUD API 가 핸들러 실행 없이 503 으로
실패하고(드롭 금지), 쓰기 대기 항목도 큐에 남겨 배압 경계가 아직 디스크에
닿지 않은 이벤트 수를 정확히 세게 한다. 파일 이름은 UTC 날짜로 고정하고
보존 기간이 지난 파일을 하루 한 번 지우며 삭제 사실을 스스로 기록한다.

이벤트 타입 41 개를 상수 파일 하나로 모으고 AuditEvent.type 을 그 유니온으로
좁혀, 기존 호출부의 문자열 리터럴을 모두 상수로 치환한다. 서버 옵션
auditRetentionDays(기본 90, 0 은 무제한)·auditQueueSize(기본 1000)를 더하고,
저장된 값이 달라질 때만 새 싱크를 먼저 등록한 뒤 옛 싱크를 닫는다.
일회용 코드 계열 키(totp·code·recoveryCode)를 민감 키로 올린다.

Closes #109
```

### #109 다음 이슈 순서

에픽 체크리스트의 미체크 순서 그대로다.

```
#120(다음) → #122 → #92 → #110 → #112 → #113 → #123 → #124
→ #102 → #127 → #103 → #104 → #105 → #106 → #107 → #108 → #114 → #121 → #115 → #128
```

화면 이슈 11건(#102~#108·#114·#115·#121·#128)은 §4 의 확정 시안이 모양 근거다. 명세의 식별자와 오류 문구까지 시안에 담겨 있다.

### 이슈 밖에서 드러난 문제

착수할 때 함께 다뤄라.

1. **#136 — 사용자 결정 필요.** Keep-Alive 입력의 `min=1` 과 "0 or less disables keep-alive." 안내가 모순이다. 서버는 0 이하를 비활성으로 지원한다(`SocketHandler.ts:265` 의 `if(options.keepAlive > 0)`, 그리고 `ServerOptionStore.ts` 의 keepAlive 정규화 — 워킬트리 `:500-501`, 메인 `:494-495` 의 `option.keepAlive < 0` 이면 `-1` 로 뚝는 부분). **최소값을 0 으로 내리는 쪽이 동작과 맞다.** 사용자가 답하지 않았다
2. **`docs/design/issues/unit3.md` 의 오류** — 요약 표가 `Stop and Remove` 버튼의 조건을 구현 코드와 다르게 적었다. 구현(`TunnelEditScreen.svelte:315-317`의 `{#if option.isSync}`)이 맞다
3. **`Button.svelte` 에 `id` prop 이 없다** — `unit4.md` 만 "감싸는 요소에 id 를 붙인다" 규약을 적고 `unit2.md`·`unit5.md` 는 적지 않는다. 그대로 구현하면 세 단위가 서로 다른 방식을 쓴다. `nav-sign-out`·`geo-save` 가 그 경우다
4. **#114 착수 시 주의** — 감사 범위 탭의 키보드 이동이 `admin/src/ui/Tabs.svelte` 에 없다. `unit4.md` 가 단위 1 의 부품 수정을 금지하므로 별도 이슈로 분리해야 한다
5. **`#97` 산출물의 누락** — `access_denied` 의 `detail` 이 `{action, path}` 이고 `status` 가 없다(`AdminServer.ts:287`). 이슈 #109 의 이벤트 타입 표는 `detail.status` 를 요구한다. #109 의 범위는 상수 치환뿐이라 고치지 않았다
6. **`.gitignore` 누락** — 테스트가 만드는 `config/.server.state.json`·`config/identity.yaml` 이 추적되지 않은 채 남는다. `.gitignore` 에 없다. 어느 이슈의 범위도 아니다

## 8. #109 를 닫는 절차

```powershell
# 1. 재확인 (§7-1). 실패하면 그 묶음만 단독으로 다시
cd C:\Work\git\_Snoworca\TTTGate-wt\109
npx jest --runInBand test/component/roundtrip-once.test.ts test/component/server/admin/security-bans.test.ts

# 2. 커밋 범위 정리
git checkout -- reports/
Remove-Item config\.server.state.json, config\identity.yaml -ErrorAction SilentlyContinue

# 3. 커밋 (§7 의 메시지, 서명 0건)
git add -A
git commit -F <message-file>
git log -1 --format="%B" | Select-String -Pattern 'Co-Authored-By|Generated|Assisted|\[bot\]|\[ai\]|noreply@anthropic'   # 0건이어야 한다

# 4. 병합
cd C:\Work\git\_Snoworca\TTTGate
git merge --no-ff feat/u4-109-file-audit-store -m "Merge branch 'feat/u4-109-file-audit-store' into refactor/admin"

# 5. junction 끊고 워크트리 제거 (§6 의 순서)
#    끊은 뒤 원본 node_modules 가 380개·43개인지 확인
git worktree remove --force C:\Work\git\_Snoworca\TTTGate-wt\109
git branch -d feat/u4-109-file-audit-store

# 6. 이슈 댓글 + 닫기
gh issue comment 109 --body-file <comment-file>
gh issue close 109 --reason completed

# 7. 에픽 체크리스트 갱신 (#109 를 [x] 로)
#    갱신 뒤 checked 32 / unchecked 20 이어야 한다

# 8. 텔레그램 보고 (§1 의 제목 형식, 32/52)
```

## 9. 검증 결과 (#109, 이 문서 작성 시점)

| 검증 | 결과 |
|---|---|
| `npm run build` | 통과 |
| `npm run lint` | 통과, 위반 0건(`scannedFiles: 89`) |
| 감사 테스트 + 컴포넌트 2묶음 | 6묶음 43건 통과(1 skip) |
| 고친 `#101` 테스트 + 감사 + 서버옵션 + redactor | 7묶음 52건 통과(1 skip) |
| 전체 테스트 | 231묶음 2,302건 통과, **4건 실패**(2묶음), 4,692초 |

### 9-1. 전체 테스트의 실패 4건 — 조사 결과

| 묶음 | 전체 실행 | 워크트리 단독 | 기준 커밋 `da7d1d6` 단독 | 판정 |
|---|---|---|---|---|
| `test/component/server/admin/security-bans.test.ts` | 1건 실패 | **통과** | — | 부하였다 |
| `test/component/roundtrip-once.test.ts` | 3건 실패 | 3건 실패 | **2건 실패** | **#109 와 무관한 기존 결함** |

`roundtrip-once` 는 `#109` 의 변경이 전혀 없는 기준 커밋에서도 실패한다. 실패 사유도 감사와 무관하다.

- `real tunnel first-bad response …` — `Exceeded timeout of 5000 ms for a test`
- `real tunnel extra response …` — `TypeError: Cannot convert undefined or null to object` at `ObjectUtil.cloneDeep` (`Object.keys(obj)`, `src/util/ObjectUtil.ts:88`)

워크트리에서 3건, 기준에서 2건으로 수가 다른 것은 세 번째 케이스가 부하에 따라 갈리기 때문이다. 어느 쪽이든 **`#109` 가 원인이 아니다.**

**별도 이슈로 올릴 것:** `ObjectUtil.cloneDeep` 이 `null`·`undefined` 를 받으면 던진다. `roundtrip-once` 의 `extra response` 케이스가 그 경로를 탄다. 이 결함은 에픽 #125 의 어느 이슈 범위도 아니다.

### 뮤테이션 검증 (모두 되돌렸고 복원 뒤 재통과 확인)

| 뮤테이션 | 결과 |
|---|---|
| `close()` 뒤 선점 칸 기록을 다시 거부(D-B 복귀) | 1건 붉어짐 |

### 사실 확인

- `AUDIT_EVENT_TYPES` 의 키가 정확히 **41개**, 키와 값이 모두 일치, 중복 0
- `pruneRetention` 의 경계가 이슈의 두 예시와 산술 일치 — 보존 2일·`now=2026-09-11T12:00Z` → `audit-2026-09-08.jsonl` 만, 보존 1일·`now=2026-09-11T00:00:30Z` → `audit-2026-09-09.jsonl` 만
- `FileAuditSink` 에 `throw new AuditBackpressureError` 0건, 잠금·세마포어 0건
- `drain()` 이 `queue[0]` 으로 읽고 `write` 콜백 뒤에 `shift()` — 배압 경계 정확
- `src/server/` 에 남은 감사 type 문자열 리터럴 0건

### 리뷰 결과 (서브에이전트)

CRITICAL 0 · HIGH 1(고쳤다, D-B) · MEDIUM 2(§7-2) · LOW 8. 이슈의 "만들 것"·"변경할 것"·"하지 말 것"·"수용 기준" 명시 항목은 모두 충족한다고 보고했다.

## 10. 사용자 게이트

두 가지에 답을 받지 못했다.

1. **#136 의 방향** — Keep-Alive 최소값을 0 으로 내릴지, 안내 문구를 지울지(§7)
2. **폐기 시안 삭제** — `docs/design/2026-10-06-rbac-screens-mockup.html` 을 지울지

사용자 지시: "앞으로 사용자 결정 게이트가 나오면 모두 권장을 자동 선택하시오." 다만 위 둘은 제품 동작과 파일 삭제라 권장만 제시하고 답을 기다렸다. 다음 세션이 다시 물어도 좋고, 권장대로(최소값 0, 시안 삭제) 진행해도 좋다.

## 11. #120 — 잃어버린 작업물의 내용 (다시 할 때 그대로 쓸 수 있다)

작업물은 사라졌지만 **착수 전 조사와 설계 판단은 이 절에 남아 있다.** 이슈 본문을 읽은 뒤 이 절을 읽으면 조사 단계를 건너뛸 수 있다.

### 11.1 이슈 본문과 코드의 차이 — 범위가 셋으로 줄어든다

이슈는 "여섯 라우트 전부" 를 완성하라고 적지만 **셋은 이미 완성되어 있다.** `#117`(U5-02)과 `#119`(U5-04)가 이미 `security:manage` 로 등록하고 감사까지 붙여 두었다.

| 라우트 | 상태 | 위치 |
|---|---|---|
| `GET /api/security/bans` | **이미 있다** | `routes.ts:170`, 핸들러 `AdminServer.ts:1536` |
| `DELETE /api/security/bans/(?<port>[^/]+)/(?<ip>[^/]+)` | **이미 있다. 감사 메타까지** | `routes.ts:171-172`, 핸들러 `:1542` |
| `GET /api/security/stats` | **이미 있다** | `routes.ts:174`, 핸들러 `:1558` |
| `GET /api/security/geo` | 없다 | 만들 것 |
| `PUT /api/security/geo` | 없다 | 만들 것. 감사 메타 필요 |
| `GET /api/security/countries` | 없다 | 만들 것 |

**이미 있는 셋을 건드리지 마라.** 줄 번호는 메인 저장소 `e683fb3` 기준이다.

`AUDIT_EVENT_TYPES` 에 `security_geo_updated`·`security_ban_removed` 가 **둘 다 있다**(`src/server/audit/AuditEventTypes.ts:28`). #109 가 넣었으므로 이슈의 "없으면 추가하라" 조건은 이미 해소되었다. 추가하지 마라.

### 11.2 전제 산출물 — 전부 있다 (다시 확인하지 않아도 된다)

| 산출물 | 위치 |
|---|---|
| `normalizeConnectionSecurity(input)` | `src/server/security/connectionSecurity.ts:11` |
| `listCountries()` | `src/server/security/countries.ts:32` (re-export) |
| `TTTServer.applyConnectionSecurity(next)` | `src/server/TTTServer.ts:200` |
| `GeoFilter.lookupCountry(ip)` | `src/server/security/GeoFilter.ts:30` |
| `AdmissionController.snapshot()` | `src/server/security/AdmissionController.ts:125` |

### 11.3 구현 모양 (잃어버린 작업물이 쓴 것, 검토해서 이슈 요구와 맞았다)

`src/server/admin/routes.ts` 에 더한 것:

```ts
// 국가 필터는 서버에 하나뿐이라 대상 id 가 고정이다. 정규화된 값은 핸들러가 auditDetail 로 더한다.
const securityGeoAudit = (): AuditRouteMeta =>
    auditMeta(AUDIT_EVENT_TYPES.security_geo_updated, {kind: 'security', id: 'geo'});

// U5-05 / #120 — 국가 필터는 서버 전역 설정이라 슈퍼유저 전용이다(결정 D10).
{method: 'GET',  pattern: new RegExp('^/api/security/geo$'),       action: 'security:manage', handler: 'onGetSecurityGeo'},
{method: 'PUT',  pattern: new RegExp('^/api/security/geo$'),       action: 'security:manage',
    audit: securityGeoAudit, handler: 'onUpdateSecurityGeo'},
{method: 'GET',  pattern: new RegExp('^/api/security/countries$'), action: 'security:manage', handler: 'onGetSecurityCountries'},
```

`src/server/admin/AdminServer.ts` 에 더한 핸들러 셋(약 40줄):

```ts
private currentGeoConfig(): GeoConfig {
    return ServerOptionStore.instance.serverOption.connectionSecurity?.geo ?? {...DEFAULT_GEO_CONFIG};
}

private onGetSecurityGeo = async (ctx: RouteContext) => {
    this.sendApiSuccess(ctx.res, {geo: this.currentGeoConfig()});
}

private onUpdateSecurityGeo = async (ctx: RouteContext) => {
    const {res} = ctx;
    const normalized = normalizeConnectionSecurity({geo: ctx.body});
    if(!normalized.success) { this.sendApiFailure(res, 422, {message: normalized.message}); return; }
    const value: ConnectionSecurityOption = normalized.value;
    let committed = false;
    await ServerOptionStore.instance.runConfigurationMutation(async () => {
        const store = ServerOptionStore.instance;
        const serverOption = store.serverOption;
        serverOption.connectionSecurity = value;
        committed = store.commitPreparedServerOption(serverOption).success;
    });
    if(!committed) { this.sendApiFailure(res, 500, {message: 'Unable to commit server option.'}); return; }
    // 런타임 반영은 applyServerOption 이 아니라 이 전용 진입점으로만 한다(#118 U5-03).
    this._tttServer?.applyConnectionSecurity(value);
    // 감사 메타는 요청 전에 계산되므로 정규화된 값은 여기서 더한다.
    ctx.auditDetail({...value.geo});
    this.sendApiSuccess(res, {geo: value.geo, warnings: normalized.warnings});
}

private onGetSecurityCountries = async (ctx: RouteContext) => {
    this.sendApiSuccess(ctx.res, {countries: listCountries()});
}
```

핸들러 표(`AdminServer.ts:164` 부근의 `onGetSecurityBans` 등록 묶음)에 셋을 더해야 한다.

**이 모양은 이슈의 금지 항목을 모두 지킨다.** 확인한 것은 다음이다.

- `applyServerOption` 으로 우회하지 않고 `applyConnectionSecurity` 를 부른다
- `throw` 0건 — 조건문으로 분기한다
- 비밀값을 `===` 로 비교하지 않는다
- 기존 `bans`·`stats` 핸들러를 건드리지 않는다
- 정규화된 값을 `ctx.auditDetail` 로 넘긴다(감사 메타가 요청 전에 계산되므로)

### 11.4 테스트 (11 케이스, 이슈 수용 기준 전부)

`test/component/server/admin/security-api.test.ts` 신규. 맨 위에 `jest.setTimeout(30_000)`. 수집기 스텁에 **`reserve()` 를 반드시 포함**하라 — 빠뜨리면 `audited()` 첫 줄에서 터진다.

케이스 제목(잃어버린 작업물이 쓴 것):

1. 세션이 없으면 여섯 라우트가 모두 401
2. 일반 유저는 여섯 라우트가 모두 403
3. 슈퍼유저 `GET /api/security/geo` 는 기본값을 돌려준다
4. `PUT /api/security/geo` 는 CSRF 헤더가 없으면 403
5. `PUT /api/security/geo` 가 국가 코드를 정규화해 저장하고 감사를 남긴다
6. allow 모드에 국가가 비면 422 이고 실패 감사가 남는다
7. `GET /api/security/countries` 는 249개를 name 오름차순으로 돌려준다
8. `GET /api/security/bans` 는 차단 항목을 싣고 DB 미로드면 country 키가 없다
9. `DELETE /api/security/bans/:port/:ip` 가 차단을 지우고 감사를 남긴다
10. 정규화되지 않은 IPv4-mapped 주소로는 차단이 지워지지 않는다
11. `GET /api/security/stats` 가 현재 GeoConfig 와 포트별 집계를 함께 돌려준다

함께 고친 기존 테스트: `routes.test.ts`(라우트 표 전수 비교에 셋 추가), `security-bans.test.ts`, `security-stats.test.ts`.

### 11.5 확인된 검증 결과 (잃어버린 작업물 기준)

| 검증 | 결과 |
|---|---|
| TDD red | 4묶음 중 2묶음 실패, **9건** |
| red 의 성격 | 라우트 부재(`404`)와 단언 불일치(`toEqual`)가 **함께** 나왔다 — 테스트가 동작을 실제로 검사한다 |
| `npm run lint` | 위반 0건(`scannedFiles: 89`) |
| `npx jest test/component/server/admin test/unit/server` | 71묶음 중 **2묶음 9건 실패** — 미완 상태에서 끊겼다 |

마지막 실행의 9건 실패는 **구현이 끝나기 전에 끊긴 것**이므로 결함 근거로 쓰지 마라. 다시 할 때 처음부터 돌려라.
