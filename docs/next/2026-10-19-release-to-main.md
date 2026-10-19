# 핸드오프 — `refactor/admin` 을 `main` 으로 병합

작성 2026-10-19 · 이 문서는 `docs/next/2026-10-16-wave8-audit-store.md` 를 대신한다. 그 문서의 "다음 행동(#120 재구현)"은 이미 끝났으므로 따르지 마라. 함정 목록(§6)은 지금도 유효하다.

## 0. 다음 세션의 첫 행동

**구현 이슈는 남아 있지 않다.** 열린 이슈는 0건이다. 에픽 #125 는 52/52 로 닫혔고, 후속 수정 이슈 #130~#184 도 모두 병합하고 닫았다.

다음 일은 **`refactor/admin` → `main` PR 의 CI 결과를 확인하고 병합하는 것**이다. PR 을 연 뒤의 상태는 §3 을 보라.

```powershell
Set-Location C:\Work\git\_Snoworca\TTTGate
gh pr list --repo ice3x2/TTTGate --head refactor/admin
gh pr checks <PR 번호> --repo ice3x2/TTTGate
```

## 1. 현재 상태

| 항목 | 값 |
|---|---|
| 작업 브랜치 | `refactor/admin` (원격과 같음) |
| `main` 대비 | 커밋 380여 개 앞섬, `main` 쪽 고유 커밋 2개 |
| 마지막 병합 | `71c8f5a` — #184 (512MB 서버 부하 시험 결과 문서) |
| 열린 이슈 | 0건 |
| 남은 워크트리·작업 브랜치 | 없음 |

### 2026-10-16 이후에 한 일

1. **에픽 #125 의 남은 20건 완료** — #120·#122·#92·#110·#112·#113·#123·#124 와 화면 이슈 11건, 그리고 #127.
2. **보안·안정성 후속 수정** — 리뷰와 부하 시험에서 나온 문제를 이슈 #130~#184 로 등록하고 하나씩 고쳤다. 중심 주제는 다음과 같다.
   - 인증 전 공격면: 핸드셰이크 기한·상한(#157·#165·#174), HTTP 헤더·본문 파싱(#166·#168·#176), rate-limit 우회(#167·#175), XFF 신뢰(#171·#178)
   - 권한 경계: 경로 포트 해석(#138), 세션 소유권(#158), mTLS strict(#159), 클라이언트 이름 위조(#162), 권한 판정 전 본문 읽기(#173)
   - 메모리·배압: 업로드 배압(#130·#163), 일시정지 사유(#169), 버퍼 상한(#147), 전역 메모리 예산(#183)
   - 업그레이드 호환: 이전 설정의 속도 제한·세션 TTL 보존(#182)
   - 약한 서버(0.5코어·512MB) 기한 조정(#181)과 그 결과 문서(#184)
3. **통합 정리 커밋 2건** — `d7244db`, `f809727`. 여러 브랜치를 병합하면서 어긋난 테스트를 맞췄다.

## 2. 이 세션(2026-10-19)이 한 일

1. 재부팅 뒤 상태를 점검했다. 잃은 작업물은 없다.
2. 커밋하지 않고 남아 있던 문서를 커밋했다: `CLAUDE.md` 의 "작업 진행 방식" 절, 확정 시안 `docs/design/2026-10-15-admin-console-mockup.html`, 2026-10-16 핸드오프, 이 문서.
3. 쓸모없어진 stash 2개를 지웠다(#182·#120 의 WIP, 두 이슈 모두 병합됨). 빈 워크트리 폴더 `TTTGate-wt\92` 와 `TTTGate-wt\_out` 도 지웠다.
4. `refactor/admin` → `main` PR 을 열었다.

## 3. PR 과 병합

- CI(`code-regression.yml`)는 **PR 과 `main` push 에서만 돈다.** 그래서 `refactor/admin` 의 코드는 이 PR 에서 처음 CI 를 거친다. 실패하면 원인부터 확인하라. §5 의 "부하가 만드는 거짓 실패"일 수 있다.
- `main` 에만 있는 커밋이 2개 있다. 충돌이 나면 `refactor/admin` 쪽을 기준으로 맞춘다.
- 병합 방식(merge commit / squash)과 병합 뒤 릴리스 태그는 **사용자가 정한다.** 묻지 않고 병합하지 마라.

## 4. 남아 있는 작은 문제 (이슈로 등록되지 않음)

2026-10-16 문서 §7 "이슈 밖에서 드러난 문제" 6건을 다시 확인했다. 3건은 해결됐다(#136 Keep-Alive, `Button` 의 `id` prop, `unit3.md` 의 버튼 조건). 아래 3건은 남아 있다.

1. **`access_denied` 감사에 `status` 가 없다** — `src/server/admin/AdminServer.ts:1778` 의 `detail` 이 `{action, path}` 뿐이다. #109 의 이벤트 표는 `detail.status` 를 요구한다.
2. **`.gitignore` 누락** — 테스트와 실행이 만드는 `config/.server.state.json` 이 무시 목록에 없다. `config/.key`·`config/server.yaml` 은 이미 있다.
3. **`admin/src/ui/Tabs.svelte` 에 키보드 이동이 없다** — 감사 화면의 범위 탭에서 화살표 키로 옮겨 갈 수 없다.

사용자 결정을 기다리는 것이 하나 더 있다.

- **폐기한 시안 `docs/design/2026-10-06-rbac-screens-mockup.html`** — 커밋하지 않은 채 남아 있다. 지울지 묻지 못했다.

## 5. 함정

2026-10-16 문서 §6 이 원본이다. 이번에 새로 확인한 것만 적는다.

### WSL 에서 보면 파일 750여 개가 "수정됨"으로 보인다

작업은 Windows 쪽 git(`core.autocrlf=true`)으로 했다. 디스크 파일은 CRLF 이고 인덱스는 LF 다. WSL 의 git 에는 autocrlf 가 없어서 모든 파일을 변경으로 본다. **실제 변경이 아니다.** 실제 변경만 보려면 다음을 쓴다.

```bash
git diff --ignore-all-space --ignore-cr-at-eol --stat
```

WSL 에서 커밋해야 하면 `git -c core.autocrlf=input add <파일>` 로 올려라. 그냥 `git add` 하면 CRLF 가 저장소에 들어간다.

### `reports/` 는 커밋하지 마라

`npm run lint` 와 일부 테스트가 `reports/*.json` 의 시각·수치를 다시 쓴다. 커밋 전에 `git checkout -- reports/` 로 되돌려라.

### 전체 테스트는 78분이다

다른 작업과 병행하면 타임아웃과 `ECONNRESET` 으로 거짓 실패가 난다. 실패한 묶음만 단독으로 다시 돌려 판정하라. PowerShell 에서 출력은 파일로 받아라.

## 6. 관련 문서

- 이전 핸드오프: `C:\Work\git\_Snoworca\TTTGate\docs\next\2026-10-16-wave8-audit-store.md` — §6 함정 목록
- 확정 결정 11건·루프 절차의 원본: `C:\Work\git\_Snoworca\TTTGate\docs\next\2026-09-15-wave8-admin-rbac.md`
- 화면 시안(확정): `C:\Work\git\_Snoworca\TTTGate\docs\design\2026-10-15-admin-console-mockup.html`
- 프로젝트 지침: `C:\Work\git\_Snoworca\TTTGate\CLAUDE.md` — 서브에이전트는 최대 한 개, 모든 작업은 직렬
- 에픽: https://github.com/ice3x2/TTTGate/issues/125
