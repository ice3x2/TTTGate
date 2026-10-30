# GitHub Actions 워크플로

| 워크플로 | 파일 | 언제 도는가 | 하는 일 |
|---|---|---|---|
| Code Regression | `code-regression.yml` | 모든 PR, main 에 push, 수동 실행, 릴리스 워크플로가 부를 때 | 빌드·린트·단위 테스트, 컴포넌트 테스트, 타입 검사, 관리 화면·터널·브라우저 E2E 를 네 작업으로 나눠 병렬로 돌립니다. |
| Release | `release.yml` | 버전 태그를 push 할 때, 수동 실행 | Code Regression 과 온라인 공급망 감사를 통과하면 소스 배포판과 다섯 플랫폼 바이너리를 만들어 초안(draft) 릴리스에 올립니다. |
| Supply Chain Audit | `supply-chain-audit.yml` | 의존성 파일이 바뀐 main 대상 PR, main 에 push, 매주 월요일, 수동 실행, 릴리스 워크플로가 부를 때 | 의존성 보안 권고(advisory)를 확인합니다. 온라인 감사는 매주 월요일, 수동 실행, 릴리스 때 돕니다. |

## 릴리스 만들기

1. 세 파일의 버전을 릴리스할 버전으로 올리고 main 에 병합합니다. 태그 형식은 기존 릴리스를 따라 `v` 없이 씁니다(예: `2.0.0`).
   - `package.json` 의 `version`
   - `package-lock.json` 의 최상위 `version` 과 `packages[""].version`
   - `package-build.json` 의 `version` (소스 배포판의 `package.json` 이 됩니다)
2. main 의 그 커밋에 같은 이름의 태그를 올립니다. 태그는 하나씩 올립니다. GitHub 는 한 번에 태그를 세 개 넘게 올리면 워크플로를 실행하지 않으므로 `git push --tags` 는 쓰지 않습니다.

   ```bash
   git tag 2.0.0 <main 의 커밋>
   git push origin 2.0.0
   ```

3. Release 워크플로가 자동으로 돕니다. 순서는 다음과 같습니다.
   1. 태그가 `package.json`·`package-build.json` 의 `version` 과 같은지 확인합니다. 다르면 여기서 멈춥니다.
   2. Code Regression 의 네 작업과 온라인 공급망 감사를 병렬로 돌립니다(보통 20~50분). 하나라도 실패하면 패키징하지 않습니다. 스트레스 테스트(`npm run test:stress`)는 여기에 들어가지 않으므로, 필요하면 릴리스 전에 따로 돌립니다.
   3. `npm run dist -- --skip-tests` 로 빌드하고 바이너리를 만듭니다. 테스트는 2단계에서 이미 돌렸으므로 다시 돌리지 않습니다.
   4. 소스 배포판과 바이너리를 압축하고, 릴리스 노트를 써서 초안 릴리스에 올립니다.
4. **Releases** 화면에서 초안 릴리스를 확인합니다. 릴리스 노트를 고친 뒤 **Publish release** 를 눌러 공개합니다.

태그를 올렸는데 실패했다면, 원인을 고친 커밋을 main 에 병합합니다. 그다음 태그를 지우고 같은 이름으로 다시 올립니다.

```bash
git push origin :refs/tags/2.0.0
git tag -f 2.0.0 <고친 main 의 커밋>
git push origin 2.0.0
```

### 수동 실행

Actions 화면에서 **Release** 를 고르고 **Run workflow** 를 누릅니다. **Use workflow from** 에서 브랜치가 아니라 **버전 태그**를 고릅니다. 브랜치를 고르면 1단계(태그 확인)에서 바로 멈춥니다.

```bash
gh workflow run release.yml --ref 2.0.0
```

### 권한

Release 워크플로의 패키징 작업만 `contents: write` 권한을 받습니다. 저장소의 기본 토큰 권한(`read`)은 바꾸지 않아도 됩니다.

## 만들어지는 파일

| 파일 | 내용 |
|---|---|
| `TTTGate-{version}-dist.tar.gz`, `TTTGate-{version}-dist.zip` | Node.js 소스 배포판 |
| `TTTGate-{version}-linux-x64.tar.gz` | Linux x64 바이너리 |
| `TTTGate-{version}-linux-arm64.tar.gz` | Linux ARM64 바이너리 |
| `TTTGate-{version}-win-x64.zip` | Windows x64 바이너리 |
| `TTTGate-{version}-win-arm64.zip` | Windows ARM64 바이너리 |
| `TTTGate-{version}-alpine-x64.tar.gz` | Alpine Linux x64 바이너리 |

바이너리 압축 파일에는 그 플랫폼의 `bin/TTTGate-*` 실행 파일과 관리 화면의 `web/` 자산이 들어 있습니다. 압축을 푼 구조를 그대로 두고 루트에서 실행합니다.

```bash
./bin/TTTGate-linux-x64 server -adminPort 9300
# Windows:
bin/TTTGate-win-x64.exe server -adminPort 9300
```

### 소스 배포판 실행

Node.js 24 이상에서 소스 배포판을 새 디렉터리에 풀고, 그 디렉터리에서 실행합니다. 압축 파일의 루트에 파일이 바로 들어 있으므로 먼저 디렉터리를 만듭니다. 배포판에는 `app.js`, `package.json`, 관리 화면의 `web/` 자산과 런타임 `bin/` 디렉터리가 들어 있습니다.

```bash
mkdir TTTGate-2.0.0 && tar -xzf TTTGate-2.0.0-dist.tar.gz -C TTTGate-2.0.0 && cd TTTGate-2.0.0
npm install --omit=dev
node app.js server -adminPort 9300
# 클라이언트:
node app.js client -addr <server_address>
```

실행 파일과 관리 화면은 실제 빌드 날짜를 보고합니다(예: `TTTGate v2.0.0 (20261030)`). 실행할 때 `TTTGATE_BUILD` 환경 변수를 주면 그 값을 씁니다.

배포판에는 배포 전용 lockfile 이 없습니다. 그래서 `npm ci` 가 아니라 위의 설치 명령을 씁니다. 의존성은 배포 manifest 의 버전 범위로 설치되므로, 같은 해석 결과를 보장하지는 않습니다.

## 로컬에서 배포판 만들기

`npm run dist` 는 의존성 설치, 관리 화면 검사, 빌드, 전체 테스트를 차례로 통과해야 배포판을 만듭니다. 전체 테스트는 오래 걸립니다.

| 명령 | 하는 일 |
|---|---|
| `npm run dist` | 모든 단계를 거쳐 소스 배포판과 바이너리를 만듭니다. |
| `npm run dist -- --skip-binaries` | 바이너리는 만들지 않습니다. |
| `npm run dist -- --skip-tests` | 브라우저 설치와 전체 테스트를 건너뜁니다. 같은 커밋이 Code Regression 을 통과했을 때만 씁니다(Release 워크플로가 이렇게 씁니다). |

## 공급망 감사로 막혔을 때

주간 감사나 릴리스가 공급망 감사에서 실패하면 다음 순서로 처리합니다.

1. 실패 로그에서 권고 번호(GHSA-…)와 패키지를 확인합니다. 로컬에서는 다음 명령으로 같은 판정을 봅니다.
   - 서버 운영 의존성: `node scripts/supply-chain-gate.cjs --server-gate`
   - 관리 화면: `cd admin && node ../scripts/supply-chain-gate.cjs --admin-high-report`
2. 수정 버전이 있으면 그 버전으로 올립니다. 이것이 기본입니다. 소스 배포판도 같은 버전을 쓰도록 `package-build.json` 의 범위도 함께 올립니다.
3. 수정 버전이 없으면, TTTGate 가 영향받는 API 를 쓰는지 검토합니다. 쓰지 않을 때만 `scripts/supply-chain-gate.cjs` 의 `REVIEWED_ADVISORIES` 에 예외를 올립니다.
   - 권고 번호, 패키지, 검토일(`reviewedOn`), 재검토일(`reviewBy`), 이유를 적습니다. 재검토일은 검토일에서 180일 안이어야 합니다.
   - 검토할 때의 등급(`severity`, `moderate` 또는 `high`)도 적습니다. 권고 등급이 그보다 올라가면 `(reviewed as X, now Y)` 를 붙여 다시 막습니다. 영향 API 를 다시 검토한 뒤 등급을 고칩니다. 등급을 빠뜨리면 `(reviewed severity missing)` 을 붙여 막습니다.
   - 예외는 서버 운영 의존성의 moderate·high 검사에 함께 쓰입니다. critical 은 예외로도 통과하지 않습니다.
   - 재검토일 당일 UTC 00:00 부터 다시 막힙니다(로그에 `review expired` 가 붙습니다). 그 사이에 수정 버전이 나오면 올리고 예외를 지웁니다. 수정 버전이 아직 없으면 영향 API 를 다시 검토한 뒤 `reviewedOn` 과 `reviewBy` 를 새 날짜로 바꿉니다.
   - 로그 항목에 권고 번호가 없거나 `(unresolved via)` 가 붙으면 예외로 풀 수 없습니다. 권고를 특정할 수 없기 때문입니다. 업그레이드나 `overrides` 로 풉니다.
   - 예외를 올릴 때는 영향 API 를 쓰지 않음을 지키는 테스트를 `test/supply-chain/reviewed-advisories.test.ts` 에 함께 더합니다.
   - 예외로 통과한 권고는 감사 로그에 경고(`reviewed advisory accepted`)로 남습니다.
4. 수정 버전이 없는 critical 은 예외로 풀 수 없습니다. 그 의존성을 다른 패키지로 바꾸거나 빼고, 하위 의존성이면 `overrides` 로 고친 버전을 강제합니다. 어느 쪽도 어려우면 정보보호팀과 검토합니다.
5. 관리 화면 감사는 critical 만 막고 high 는 경고로 남깁니다. 검토 예외는 서버 운영 의존성에만 쓰이므로, 관리 화면의 high 경고는 업그레이드(필요하면 `overrides`)로 풉니다.
