# 핸드오프 — `refactor/admin` 을 `main` 으로 병합한 뒤

작성 2026-10-19 · 이 문서는 `docs/next/2026-10-16-wave8-audit-store.md` 를 대신한다. 그 문서의 "다음 행동(#120 재구현)"은 이미 끝났으므로 따르지 마라. 함정 목록(§6)은 지금도 유효하다.

## 0. 다음 세션의 첫 행동

**`refactor/admin` 은 `main` 에 병합됐다.** PR #185, 병합 커밋 `6a295dc`. 에픽 #125(52/52)와 후속 이슈 #130~#191 은 모두 닫혔다.

열린 이슈는 **#192 하나**다. 병합 뒤 Dependabot 이 다시 계산한 경고 88건을 정리하는 일이다. 운영 의존성 쪽 새 위험은 없고(§4), 급하지 않다.

먼저 `main` 의 CI 결과를 확인하라. 이 문서를 쓸 때 `main` push 의 CI(실행 39243797336)가 돌고 있었다. 같은 커밋 내용이 PR 에서는 모두 통과했다.

```powershell
Set-Location C:\Work\git\_Snoworca\TTTGate
gh run list --repo ice3x2/TTTGate --branch main --limit 3
gh issue view 192 --repo ice3x2/TTTGate
```

## 1. 현재 상태

| 항목 | 값 |
|---|---|
| `main` | `6a295dc` — PR #185 병합 커밋 |
| `refactor/admin` | `main` 과 같은 커밋에서 이 문서를 커밋한 상태(원격 반영) |
| 열린 이슈 | #192 (개발 의존성 경고) |
| 남은 워크트리·작업 브랜치·stash | 없음 |
| 릴리스 태그·바이너리 | 만들지 않았다. `build-release*.yml` 은 수동 실행(`workflow_dispatch`)이다 |

### 2026-10-16 이후에 한 일

1. **에픽 #125 의 남은 20건 완료** — #120·#122·#92·#110·#112·#113·#123·#124 와 화면 이슈 11건, 그리고 #127.
2. **보안·안정성 후속 수정 #130~#184** — 리뷰와 부하 시험에서 나온 문제를 하나씩 고쳤다. 중심 주제는 다음과 같다.
   - 인증 전 공격면: 핸드셰이크 기한·상한(#157·#165·#174), HTTP 헤더·본문 파싱(#166·#168·#176), rate-limit 우회(#167·#175), XFF 신뢰(#171·#178)
   - 권한 경계: 경로 포트 해석(#138), 세션 소유권(#158), mTLS strict(#159), 클라이언트 이름 위조(#162), 권한 판정 전 본문 읽기(#173)
   - 메모리·배압: 업로드 배압(#130·#163), 일시정지 사유(#169), 버퍼 상한(#147), 전역 메모리 예산(#183)
   - 업그레이드 호환: 이전 설정의 속도 제한·세션 TTL 보존(#182)
   - 약한 서버(0.5코어·512MB) 기한 조정(#181)과 그 결과 문서(#184)
3. **통합 정리 커밋 2건** — `d7244db`, `f809727`. 여러 브랜치를 병합하면서 어긋난 테스트를 맞췄다.

## 2. 이 세션(2026-10-19)이 한 일

1. 재부팅 뒤 상태를 점검했다. 잃은 작업물은 없었다. 직전 세션은 #184 를 닫은 직후에 끊겼다.
2. 커밋하지 않고 남아 있던 문서를 커밋했다: `CLAUDE.md` 의 "작업 진행 방식" 절, 확정 시안 `docs/design/2026-10-15-admin-console-mockup.html`, 2026-10-16 핸드오프, 이 문서.
3. 정리: 쓸모없어진 stash 2개(`8393eaf` #182, `328fc50` #120 — 둘 다 다른 형태로 병합됨), 빈 폴더 `TTTGate-wt\92`, 테스트 출력 폴더 `TTTGate-wt\_out`(1,689개, 78MB), 폐기한 시안 `docs/design/2026-10-06-rbac-screens-mockup.html`.
4. 사용자가 "모두 자동으로 처리" 를 지시했다. 아래 이슈 6건을 등록하고 기존 루프(워크트리 → TDD → 리뷰 → 병합 → 닫기)로 처리한 뒤 PR #185 를 merge commit 으로 병합했다.

| 이슈 | 내용 | 병합 |
|---|---|---|
| #186 | `access_denied` 감사 `detail.status` 추가(403·404 구별) | `bc44262` |
| #187 | `.gitignore` 에 `.server.state.json` 추가 | `bb88870` |
| #188 | `Tabs` 부품의 화살표·Home·End 키보드 이동과 roving tabindex | `30acc2c` |
| #189 | Linux CI 에서 실패하던 플랫폼 의존 테스트 2건 | `d395751` |
| #190 | 정리하지 않은 기한 타이머 때문에 `test:unit` 이 전부 통과해도 종료 코드 1 | `9ddd99f` |
| #191 | CI 의 컴포넌트 테스트를 별도 작업(90분)으로 분리 | `2d9c336` |

5. 병합 뒤 Dependabot 경고를 확인하고 #192 로 등록했다(§4).

## 3. CI 에서 드러난 것 — PR #185

`refactor/admin` 은 이 PR 에서 처음 CI(Linux)를 거쳤다. 네 번 돌려 통과했다.

| 회차 | 결과 | 원인과 조치 |
|---|---|---|
| 1 | `test:unit` 1건 실패 | `File.test.ts` 가 Windows 전용 금지 문자로 실패를 만들었다 → #189 |
| 2 | 1307건 통과, 종료 코드 1 | 테스트 뒤에 찍힌 로그 때문에 jest 가 `process.exitCode = 1` 을 남겼다 → #190 |
| 3 | 30분 제한으로 취소 | 단위(15분)와 컴포넌트(30분)를 한 작업에서 돌렸다 → #191 |
| 4 | 모두 통과 | 단위 13분, 컴포넌트 29분 32초, E2E 17분 |

#189 를 처리하면서 WSL 에서 `test:component` 를 미리 돌려 같은 종류의 결함(1024 미만 포트)을 하나 더 찾아 함께 고쳤다.

## 4. 남아 있는 것

### #192 — 개발 의존성 경고

| 범위 | 결과 |
|---|---|
| 루트·admin 운영 의존성(`npm audit --omit=dev`) | 각각 high 1 — `node-forge`(수정 버전 없음, #180 의 검토 예외) |
| 루트 전체 | 46건 — 모두 개발 의존성. 상당수가 jest 30·vite 8 메이저 업그레이드로만 고쳐진다 |

메이저 업그레이드는 테스트 도구 자체를 바꾸므로 단계를 나눠 전체 테스트와 CI 로 확인하라.

### 리뷰가 남긴 LOW (막는 문제 아님)

- `Tabs` 의 클릭은 같은 탭을 다시 눌러도 `onchange` 를 부른다. 원래 있던 동작이고 새로고침 용도로 둔다.
- #186 의 404 테스트는 '남의 터널'이 아니라 '없는 포트'로 404 를 만든다. 판정기의 같은 `NOT_FOUND` 분기를 지난다.

### 확정하지 못한 것

- `test/component/server/ProtocolV2.test.ts` 의 "rejects legacy handshakes from an address that keeps failing" 이 WSL 에서 전체 실행 직후 두 번 실패했다. 그 뒤 단독 실행 4번과 CI 는 모두 통과했다. 부하로 보지만 확정하지 못했다. 다시 실패하면 조사하라.

## 5. 함정

2026-10-16 문서 §6 이 원본이다. 이번에 새로 확인한 것만 적는다.

### WSL 에서 보면 파일 750여 개가 "수정됨"으로 보인다

작업은 Windows 쪽 git(`core.autocrlf=true`)으로 한다. 디스크 파일은 CRLF 이고 인덱스는 LF 다. WSL 의 git 에는 autocrlf 가 없어서 모든 파일을 변경으로 본다. **실제 변경이 아니다.** 실제 변경만 보려면 다음을 쓴다.

```bash
git diff --ignore-all-space --ignore-cr-at-eol --stat
```

WSL 에서 커밋해야 하면 `git -c core.autocrlf=input add <파일>` 로 올려라. 그냥 `git add` 하면 CRLF 가 저장소에 들어간다. 가장 안전한 것은 git 명령을 `powershell.exe` 로 Windows git 에서 실행하는 것이다.

Windows git 으로 만든 워크트리(`TTTGate-wt\<번호>`)는 WSL git 이 다루지 못한다. git 명령은 `powershell.exe` 로 실행하라.

### Windows 에서만 통과하는 테스트를 조심하라

CI 는 Linux 다. 이번에 겪은 것은 다음과 같다.

- Windows 에서만 금지되는 파일 이름(`<` 등)으로 실패를 만드는 테스트(#189)
- 1024 미만 포트를 실제로 여는 테스트. Linux 에서는 root 가 아니면 열 수 없다(#189)
- 테스트가 만든 객체의 타이머가 파일이 끝난 뒤 로그를 남기는 것. `test:unit` 은 `--detectOpenHandles` 라 한 프로세스에서 돌고, jest 는 그때 `process.exitCode = 1` 을 남긴다. 전부 통과해도 실패한다(#190). `create` 로 객체를 만드는 테스트는 `test/helpers/createdInstances.ts` 의 `cleanupCreatedInstances` 를 써라

WSL 에서 Linux 쪽을 미리 확인할 수 있다.

- 단위·컴포넌트 테스트는 그대로 돈다. 컴포넌트 테스트 가운데 프로세스를 띄우는 것은 먼저 `npx tsc -b` 로 `build/` 를 만들어야 한다.
- `admin/node_modules` 의 `esbuild`·`rollup` 이 Windows 용이라 관리자 화면 테스트(Playwright)는 WSL 에서 돌지 않는다.
- 공급망 테스트(`npm ls`)는 Windows 에서 설치한 `node_modules` 의 extraneous 패키지 때문에 WSL 에서 실패한다. CI 는 `npm ci` 로 설치하므로 해당하지 않는다.
- WSL 에서 테스트를 돌리면 메인 작업 트리의 `reports/` 가 다시 쓰인다. 끝나면 되돌려라.

### `reports/` 는 커밋하지 마라

`npm run lint` 와 일부 테스트가 `reports/*.json` 의 시각·수치를 다시 쓴다. 커밋 전에 `git checkout -- reports/` 로 되돌려라.

### 테스트 시간

Windows 전체 테스트는 약 78분이다. CI 는 작업별로 단위 13분, 컴포넌트 30분, E2E 17분이다. 다른 작업과 병행하면 타임아웃과 `ECONNRESET` 으로 거짓 실패가 난다. 실패한 묶음만 단독으로 다시 돌려 판정하라. PowerShell 에서 출력은 파일로 받아라.

## 6. 관련 문서

- 이전 핸드오프: `C:\Work\git\_Snoworca\TTTGate\docs\next\2026-10-16-wave8-audit-store.md` — §6 함정 목록
- 확정 결정 11건·루프 절차의 원본: `C:\Work\git\_Snoworca\TTTGate\docs\next\2026-09-15-wave8-admin-rbac.md`
- 화면 시안(확정): `C:\Work\git\_Snoworca\TTTGate\docs\design\2026-10-15-admin-console-mockup.html`
- 업그레이드 안내: `C:\Work\git\_Snoworca\TTTGate\docs\guide\MIGRATION.md`
- 프로젝트 지침: `C:\Work\git\_Snoworca\TTTGate\CLAUDE.md` — 서브에이전트는 최대 한 개, 모든 작업은 직렬
- 에픽: https://github.com/ice3x2/TTTGate/issues/125 · 병합 PR: https://github.com/ice3x2/TTTGate/pull/185
