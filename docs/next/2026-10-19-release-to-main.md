# 핸드오프 — `refactor/admin` 을 `main` 으로 병합한 뒤

작성 2026-10-19 · 이 문서는 `docs/next/2026-10-16-wave8-audit-store.md` 를 대신한다. 그 문서의 "다음 행동(#120 재구현)"은 이미 끝났으므로 따르지 마라. 함정 목록(§6)은 지금도 유효하다.

## 0. 다음 세션의 첫 행동

**2026-10-31 기준 남은 일이 있다.** #293(공급망 감사 실패)의 PR #294 는 `develop` 을 향한다. 다음 순서로 마치고 이슈를 닫는다.

1. PR #294 를 `develop` 에 병합하고, `develop` → `main` PR 을 만들어 병합한다.
2. main 에서 Supply Chain Audit 을 수동 실행해 모든 작업이 성공하는지 본다: `gh workflow run supply-chain-audit.yml --ref main`
3. 2.0.0 초안 릴리스(공개 전)에는 node-forge 1.4.0 이 들어 있다. **공개하지 않는다.** 옛 초안과 태그를 지우고 고친 main 에서 다시 만든다.
   - `gh release delete 2.0.0 --repo ice3x2/TTTGate --yes --cleanup-tag`
   - `git tag 2.0.0 <main 커밋>` → `git push origin 2.0.0`
   - Release 워크플로가 성공하고, 초안이 하나뿐이며 파일 7개가 있는지 확인한다.
4. Dependabot 경고 중 `undici`·`vite`(13건)는 main 병합 뒤 닫혀야 한다. `deepmerge` 2건은 수정 버전이 없어 남는다.

2026-10-21 에는 열린 이슈·PR·Dependabot 경고가 모두 0건이었다.

- `refactor/admin` 은 `main` 에 세 번 병합됐다: PR #185(`6a295dc`, 에픽 #125 와 #130~#191), PR #193(`137e4a9`, #192 개발 의존성 정리와 jest 30), PR #196(`dc6a0a3`, 테스트 불안정 해소 #194·#195·#197~#199).
- 남은 운영 의존성 경고 `node-forge` GHSA-86w9-cpqp-85rv 2건은 수정 버전이 없어 '감수 가능한 위험'으로 닫았다. #180 의 검토 예외(`scripts/supply-chain-gate.cjs`)에 **재검토 기한 2027-01-31** 이 있다. 그 전에 node-forge 새 버전이 나오면 올려라. → 2026-10-31 #293 에서 수정 버전(1.4.2)으로 올리고 이 예외를 지웠다. 개발 의존성의 low 권고(`deepmerge`, `jest` 계열)는 수정 버전이 없어 남아 있다(개발 의존성이라 서버 감사(`--omit=dev`)에 들어가지 않는다).

새 작업을 시작하기 전에 상태를 확인하라.

```powershell
Set-Location C:\Work\git\_Snoworca\TTTGate
gh run list --repo ice3x2/TTTGate --branch main --limit 3
gh issue list --repo ice3x2/TTTGate --state open
gh api "repos/ice3x2/TTTGate/dependabot/alerts?state=open" --jq length
```

## 1. 현재 상태

| 항목 | 값 |
|---|---|
| `main` | `af114a3` — PR #292(`develop` → `main`, 2.0.0) 병합 커밋(2026-10-31) |
| 작업 흐름 | 작업 브랜치를 `develop` 에 병합하고, `develop` 을 `main` 에 병합한다(예: PR #291 → PR #292) |
| 열린 이슈·PR·Dependabot 경고 | 2026-10-31: 이슈 #293·#244, PR #294, 경고 15건(§0 4번) |
| 테스트 도구 | jest 30, ts-jest 29.4, `tsconfig.jest.json`, `test/setup/forgeBigInteger.ts`(setupFiles) |
| 남은 워크트리·작업 브랜치·stash | 2026-10-31: 작업 트리 `C:\Work\git\_Snoworca\TTTGate-wt\supply`(브랜치 `fix/supply-chain-advisories`). #293 을 마치면 지운다 |
| 릴리스 태그·바이너리 | 2026-10-31: 태그 `2.0.0` 과 초안 릴리스가 있다(공개 전, 다시 만들어야 함 — §0). `release.yml` 이 태그 push 로 돈다 |

### 2026-10-16 이후에 한 일

1. **에픽 #125 의 남은 20건 완료** — #120·#122·#92·#110·#112·#113·#123·#124 와 화면 이슈 11건, 그리고 #127.
2. **보안·안정성 후속 수정 #130~#184** — 리뷰와 부하 시험에서 나온 문제를 하나씩 고쳤다. 중심 주제는 다음과 같다.
   - 인증 전 공격면: 핸드셰이크 기한·상한(#157·#165·#174), HTTP 헤더·본문 파싱(#166·#168·#176), rate-limit 우회(#167·#175), XFF 신뢰(#171·#178)
   - 권한 경계: 경로 포트 해석(#138), 세션 소유권(#158), mTLS strict(#159), 클라이언트 이름 위조(#162), 권한 판정 전 본문 읽기(#173)
   - 메모리·배압: 업로드 배압(#130·#163), 일시정지 사유(#169), 버퍼 상한(#147), 전역 메모리 예산(#183)
   - 업그레이드 호환: 이전 설정의 속도 제한·세션 TTL 보존(#182)
   - 약한 서버(0.5코어·512MB) 기한 조정(#181)과 그 결과 문서(#184)
3. **통합 정리 커밋 2건** — `d7244db`, `f809727`. 여러 브랜치를 병합하면서 어긋난 테스트를 맞췄다.

## 2. 이 세션(2026-10-19~21)이 한 일

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

5. 병합 뒤 Dependabot 경고를 확인하고 #192 로 등록했다.
6. 사용자가 "#192 도 자동으로, 모든 이슈를 해결" 을 지시했다. #192 를 처리하고 PR #193 으로 `main` 에 병합했다(§4).
7. 사용자가 "WSL 에서만 실패하는 테스트 2건도 원인 찾아 고치라" 고 지시했다. 근본 원인을 찾아 #194 로 고치고, 검증 중 드러난 #195·#197~#199 와 함께 PR #196 으로 병합했다(§5).

## 3. CI 에서 드러난 것 — PR #185

`refactor/admin` 은 이 PR 에서 처음 CI(Linux)를 거쳤다. 네 번 돌려 통과했다.

| 회차 | 결과 | 원인과 조치 |
|---|---|---|
| 1 | `test:unit` 1건 실패 | `File.test.ts` 가 Windows 전용 금지 문자로 실패를 만들었다 → #189 |
| 2 | 1307건 통과, 종료 코드 1 | 테스트 뒤에 찍힌 로그 때문에 jest 가 `process.exitCode = 1` 을 남겼다 → #190 |
| 3 | 30분 제한으로 취소 | 단위(15분)와 컴포넌트(30분)를 한 작업에서 돌렸다 → #191 |
| 4 | 모두 통과 | 단위 13분, 컴포넌트 29분 32초, E2E 17분 |

#189 를 처리하면서 WSL 에서 `test:component` 를 미리 돌려 같은 종류의 결함(1024 미만 포트)을 하나 더 찾아 함께 고쳤다.

## 4. #192 — 개발 의존성 정리 (PR #193)

| 조치 | 해소한 경고 |
|---|---|
| 루트에서 쓰지 않는 `vite` ^4 제거 | vite·esbuild·postcss·nanoid |
| `nodemon` 제거, `ts-node-dev` → `node --watch --require ts-node/register` | chokidar → braces |
| jest·@types/jest 30, ts-jest 29.4, `@types/picomatch`(jest 30 타입 누락 보완) | jest 29 계열 |
| `overrides.argparse` ^2.0.1 (js-yaml 3 은 argparse 를 CLI 에서만 씀) | sprintf-js |
| admin `npm audit fix` | devalue, source-map-js |

ts-jest 29.4 는 `isolatedModules` 옵션을 tsconfig 에서 읽는다. 루트 `tsconfig.json` 은 빌드용이라 `false` 이고, 이를 `true` 로 바꾸면 타입 재수출 85곳에서 TS1205 가 난다. 그래서 jest 전용 `tsconfig.jest.json` 을 두었다. `jest.config.ts` 와 `test/fixtures/artifact-sandbox.cjs` 가 이것을 쓴다.

jest 30 으로 바꾸자 `compound-admission-controls.test.ts` 가 시간 초과로 실패했다. 이 파일만 기본 5초 제한이었고 테스트당 4~5초가 걸렸다. 시간 초과 뒤에는 정리 전에 다음 테스트가 시작되어 두 번째도 실패했고, CI 에서는 jest 가 종료하지 못해 90분에 취소됐다. 60초로 고쳤다(`81ff0c7`).

## 5. 남아 있는 것

### 리뷰가 남긴 LOW (막는 문제 아님)

- `Tabs` 의 클릭은 같은 탭을 다시 눌러도 `onchange` 를 부른다. 원래 있던 동작이고 새로고침 용도로 둔다.
- #186 의 404 테스트는 '남의 터널'이 아니라 '없는 포트'로 404 를 만든다. 판정기의 같은 `NOT_FOUND` 분기를 지난다.

### 해결한 테스트 불안정 (#194·#195·#197~#199, PR #196)

WSL 에서만 실패하던 `ProtocolV2`·`client-owner` 를 계측으로 조사해 근본 원인을 찾았다.

- **#194 근본 원인**: jest 의 node 환경은 Node 21+ 의 전역 `navigator` 를 복사하고, node-forge 의 `jsbn` 은 `navigator` 가 있으면 곱셈 `am1` 을 고른다. jest 의 격리 환경에서 `am1` 은 약 40배 느려(RSA 서명 3번 70ms → 3,895ms) 인증서를 만들거나 확인하는 테스트마다 이벤트 루프가 1.5~10초 멈췄다. 여기에 WSL VM 의 주기적 정지가 겹치면 3초 기한 단언이 실패했다. `setupFiles` 에서 `navigator` 를 지워 `am3` 를 쓰게 했다. **운영 런타임(일반 Node)은 영향이 없다.**
- 효과: 2초 넘게 멈춘 스위트 50/109 → 0. CI 단위 18분 → 약 4분, 컴포넌트 30분 → 약 7분. Windows 단위 17분 → 4분.
- 빨라진 뒤 드러난 기존 불안정도 고쳤다: Sentinel 저널 순서 경쟁(#195), `getFreePort` 의 임시 포트 경쟁으로 인한 `EADDRINUSE`(#197), REQ-01 카이제곱 검정의 1% 우연 실패(#198), 상태 화면 폴링 2초 창 경계(#199).


## 6. 함정

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

### 이 PC 의 npm 은 기본으로 개발 의존성을 뺀다

Windows npm 사용자 설정에 `omit=dev` 가 있다. `npm ci`·`npm install`·`npm audit` 에 **`--include=dev` 를 붙여라.** 빼면 jest 없이 설치되고 감사도 운영 의존성만 본다. 2026-10-20 에 이것 때문에 처음 설치를 다시 했다.

### jest 30 은 WSL 에서 Windows 용 `node_modules` 로 돌지 않는다

jest 30 의 모듈 해석기(`unrs-resolver`)는 플랫폼별 네이티브 바이너리를 쓴다. Windows 에서 설치한 `node_modules` 로 WSL 에서 jest 를 돌리면 `Module ts-jest in the transform option was not found` 가 난다. Linux 쪽을 확인하려면 WSL 의 Linux 경로(예: scratchpad)에 저장소를 복제하고 그 안에서 `npm ci --include=dev` 로 따로 설치해 돌려라. 이번에 그렇게 해서 `test:component` 를 31분에 돌렸다.

### 이 PC 의 WSL 은 약 33초마다 0.6~1.5초 멈춘다

테스트와 무관한 프로세스로 측정한 VM 전체 정지다. 저장소에서 고칠 대상이 아니다. 수 초 단위 기한을 단언하는 테스트를 새로 쓸 때는 고정 창 대신 "조건이 보일 때까지 넉넉한 기한 안에서 기다림" 으로 써라(#199 참조). 테스트 안에서 이벤트 루프 지연을 재려면 `perf_hooks.monitorEventLoopDelay` 를 `--setupFilesAfterEnv` 로 거는 방법이 이번에 쓸모 있었다.

### `reports/` 는 커밋하지 마라

`npm run lint` 와 일부 테스트가 `reports/*.json` 의 시각·수치를 다시 쓴다. 커밋 전에 `git checkout -- reports/` 로 되돌려라.

### 테스트 시간

Windows 에서 CI 와 같은 다섯 묶음을 차례로 돌리면 약 28분이다(단위 4, 컴포넌트 7, 관리자 15, E2E 1, 브라우저 1). CI 는 작업별로 단위 약 4분, 컴포넌트 약 7분, E2E 약 13분이다(#194 이후). PowerShell 의 `*>` 는 출력 파일을 UTF-16 으로 쓴다. WSL 에서 읽으려면 `iconv -f UTF-16LE -t UTF-8` 로 바꿔라. 다른 작업과 병행하면 타임아웃과 `ECONNRESET` 으로 거짓 실패가 난다. 실패한 묶음만 단독으로 다시 돌려 판정하라. PowerShell 에서 출력은 파일로 받아라.

## 7. 관련 문서

- 이전 핸드오프: `C:\Work\git\_Snoworca\TTTGate\docs\next\2026-10-16-wave8-audit-store.md` — §6 함정 목록
- 확정 결정 11건·루프 절차의 원본: `C:\Work\git\_Snoworca\TTTGate\docs\next\2026-09-15-wave8-admin-rbac.md`
- 화면 시안(확정): `C:\Work\git\_Snoworca\TTTGate\docs\design\2026-10-15-admin-console-mockup.html`
- 업그레이드 안내: `C:\Work\git\_Snoworca\TTTGate\docs\guide\MIGRATION.md`
- 프로젝트 지침: `C:\Work\git\_Snoworca\TTTGate\CLAUDE.md` — 서브에이전트는 최대 한 개, 모든 작업은 직렬
- 공급망 검토 예외: `C:\Work\git\_Snoworca\TTTGate\scripts\supply-chain-gate.cjs` 의 `REVIEWED_ADVISORIES`
- 에픽: https://github.com/ice3x2/TTTGate/issues/125 · 병합 PR: https://github.com/ice3x2/TTTGate/pull/185 , https://github.com/ice3x2/TTTGate/pull/193
