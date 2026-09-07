# GitHub Actions Workflows

## 사용 가능한 워크플로우

### 1. build-release.yml
기본 빌드 및 Draft Release 생성 (소스 배포판만)

### 2. build-release-binaries.yml
전체 빌드 및 Draft Release 생성 (소스 + 바이너리)

## 사용 방법

### GitHub UI에서 실행

1. GitHub 저장소의 **Actions** 탭으로 이동
2. 왼쪽 사이드바에서 원하는 워크플로우 선택:
   - `Build and Create Draft Release` (소스만)
   - `Build Binaries and Create Draft Release` (소스 + 바이너리)
3. **Run workflow** 버튼 클릭
4. 필요한 정보 입력:
   - **version**: 릴리스 버전 (예: `v1.0.11b`)
   - **release_title**: 릴리스 제목 (선택사항)
   - **build_binaries**: 바이너리 빌드 여부 (두 번째 워크플로우만)
5. **Run workflow** 클릭

### GitHub CLI로 실행

```bash
# 소스 배포판만
gh workflow run build-release.yml \
  -f version=v1.0.11b \
  -f release_title="Stable Release v1.0.11b"

# 소스 + 바이너리
gh workflow run build-release-binaries.yml \
  -f version=v1.0.11b \
  -f release_title="Stable Release v1.0.11b" \
  -f build_binaries=true
```

## 워크플로우 설명

### build-release.yml (기본)
- Node.js 소스 배포판 생성 (`dist.tar.gz`)
- 자동 릴리스 노트 생성
- Draft Release 생성

### build-release-binaries.yml (전체)
- Node.js 소스 배포판 생성 (`dist.tar.gz`, `dist.zip`)
- 플랫폼별 바이너리 생성:
  - Linux x64 / ARM64
  - Windows x64 / ARM64
  - Alpine Linux x64
- 자동 릴리스 노트 생성
- Draft Release 생성

## 생성되는 파일

### 소스 배포판
- `TTTGate-{version}-dist.tar.gz` - tar.gz 형식
- `TTTGate-{version}-dist.zip` - zip 형식

### 플랫폼 바이너리
- `TTTGate-{version}-linux-x64.tar.gz` - Linux x64
- `TTTGate-{version}-linux-arm64.tar.gz` - Linux ARM64
- `TTTGate-{version}-win-x64.zip` - Windows x64
- `TTTGate-{version}-win-arm64.zip` - Windows ARM64
- `TTTGate-{version}-alpine-x64.tar.gz` - Alpine Linux x64

### 소스 배포판 실행

Node.js 24 이상에서 소스 아카이브를 새 디렉터리에 풀고 그 디렉터리에서 실행합니다.
배포판에는 `app.js`, `package.json`, 관리자 `web/` 자산과 런타임 `bin/` 디렉터리가 들어 있습니다.

```bash
npm install --omit=dev
node app.js server -adminPort 9300
# 클라이언트:
node app.js client -addr <server_address>
```

배포 전용 lockfile을 포함하지 않으므로 `npm ci`가 아닌 위 설치 명령을 사용합니다.
의존성은 배포 manifest의 버전 범위로 설치되며, 동일 해석 결과를 보장하는 잠금 배포는 아닙니다.

## Draft Release 게시

1. 워크플로우 실행 완료 후 **Releases** 페이지로 이동
2. **Draft** 상태의 릴리스 확인
3. 릴리스 노트 검토 및 필요시 수정
4. **Publish release** 버튼 클릭하여 정식 게시

## 주의사항

- 워크플로우는 수동 실행만 가능 (`workflow_dispatch`)
- Draft 릴리스로 생성되므로 검토 후 수동 게시 필요
- 바이너리 빌드는 시간이 오래 걸릴 수 있음 (5-10분)
- GitHub Actions의 `GITHUB_TOKEN`이 자동으로 사용됨
