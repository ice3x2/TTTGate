# CLAUDE.md

이 파일은 Claude Code(claude.ai/code)가 이 저장소에서 코드 작업을 할 때 가이드를 제공합니다.

## 프로젝트 개요

TTTGate는 내부 네트워크에 대한 외부 접근을 용이하게 하는 다목적 네트워크 터널링 도구입니다. NAT 뒤에 있는 내부 PC와 외부 서버 간의 안전하고 효율적인 통신을 가능하게 합니다.

## 개발 환경 및 기술 스택

### 핵심 기술
- **백엔드**: Node.js 18+ / TypeScript 5.1+
- **프론트엔드**: Svelte 4 + Vite 4
- **테스팅**: Jest (설정되어 있으나 테스트 파일 없음)
- **패키징**: pkg (크로스 플랫폼 바이너리)
- **개발 도구**: ts-node-dev (핫 리로드)

### 지원 플랫폼
- Linux (x64, arm64)
- Windows (x64, arm64)  
- Alpine Linux (x64)

## 주요 개발 명령어

### 백엔드 개발
```bash
# TypeScript 빌드
npm run build

# 서버 개발 모드 (핫 리로드)
npm run server

# 클라이언트 개발 모드 (핫 리로드)
npm run client

# 테스트 실행
npm test

# 프로덕션 빌드 및 패키징
npm run dist

# 바이너리 패키징
npm run pkg
```

### 프론트엔드 (관리자 인터페이스)
```bash
cd admin

# 개발 서버 시작 (포트 5173)
npm run dev

# 프로덕션 빌드
npm run build

# 빌드 미리보기
npm run preview

# Svelte 타입 체크
npm run check
```

### 통합 빌드
```bash
# 전체 배포 패키지 생성 (관리자 UI + 백엔드)
node deploy.js
```

## 아키텍처 구조

### 프로젝트 디렉터리 구조
```
TTTGate/
├── src/                     # 메인 TypeScript 소스
│   ├── app.ts              # 메인 엔트리 포인트 (서버/클라이언트 라우팅)
│   ├── client/             # 클라이언트 모듈
│   ├── server/             # 서버 모듈  
│   ├── commons/            # 공통 유틸리티
│   ├── types/              # TypeScript 타입 정의
│   └── util/               # 유틸리티 모듈
├── admin/                  # Svelte 관리자 웹 인터페이스
│   ├── src/
│   │   ├── App.svelte     # 메인 앱 컴포넌트
│   │   ├── controller/    # API 제어 로직
│   │   ├── layout/        # 레이아웃 컴포넌트
│   │   └── component/     # 재사용 가능 컴포넌트
│   └── vite.config.ts     # Vite 설정
├── build/                  # TypeScript 컴파일 결과
├── dist/                   # 최종 배포 파일
└── logs/                   # 애플리케이션 로그
```

### 핵심 아키텍처 구성요소

#### 1. 애플리케이션 엔트리 (`src/app.ts`)
- 서버/클라이언트 모드 라우팅
- 데몬 모드 및 프로세스 모니터링 지원
- CLI 인자 파싱 및 설정 관리

#### 2. 서버 아키텍처 (`src/server/`)
- **ServerApp.ts**: 메인 서버 애플리케이션 관리
- **TTTServer.ts**: 터널링 서버 핵심 로직
- **AdminServer.ts**: 웹 관리 인터페이스 서버
- **ClientHandlerPool.ts**: 클라이언트 연결 풀 관리
- **ExternalPortServerPool.ts**: 외부 포트 서버 풀

#### 3. 클라이언트 아키텍처 (`src/client/`)
- **ClientApp.ts**: 메인 클라이언트 애플리케이션
- **TTTClient.ts**: 터널링 클라이언트 핵심 로직
- **TunnelClient.ts**: 터널 연결 관리
- **EndPointClientPool.ts**: 엔드포인트 클라이언트 풀

#### 4. 공통 모듈 (`src/commons/`)
- **CtrlPacket.ts**: 제어 패킷 정의
- **DataStatePacket.ts**: 데이터 상태 패킷
- **CACertGenerator.ts**: 인증서 생성기
- **SysMonitor.ts**: 시스템 모니터링

#### 5. 관리자 웹 인터페이스 (`admin/`)
- **Svelte 4** 기반 SPA
- **Vite** 번들러 사용
- API 프록시: `/api` → `localhost:9300/api`
- TypeScript 지원 활성화

## 개발 워크플로우

### 새로운 기능 개발
1. **타입 정의**: `src/types/`에 필요한 타입 추가
2. **공통 로직**: `src/commons/` 또는 `src/util/`에 공통 기능 구현
3. **서버/클라이언트**: 해당 디렉터리에 기능 구현
4. **관리자 UI**: `admin/src/`에 프론트엔드 구현
5. **빌드 테스트**: `npm run build && node deploy.js`

### 빌드 파이프라인 (`deploy.js`)
1. 기존 배포 디렉터리 정리
2. 관리자 UI 빌드 (`npm run build` in admin/)
3. TypeScript 컴파일 (`npm run build`)
4. 웹 자산 복사
5. 최종 배포 패키지 생성

### 개발 모드 실행
```bash
# 서버 모드 (백그라운드에서 관리자 UI도 서비스)
npm run server

# 별도 터미널에서 관리자 UI 개발 서버
cd admin && npm run dev
```

### 프로덕션 빌드 및 테스트
```bash
# 전체 빌드
node deploy.js

# 서버 테스트
node build/src/app.js server -adminPort 9300

# 클라이언트 테스트
node build/src/app.js client -addr localhost
```

## 구성 시스템

### 환경 설정 (`src/Environment.ts`)
- 개발/프로덕션 모드 자동 감지
- 경로 구성: 로그, 설정, 캐시, 인증서, 웹 디렉터리
- 버전 정보 관리

### 클라이언트 설정 (`src/types/TunnelingOption.ts`)
```typescript
type ClientOption = {
    key: string,           // 인증 키
    host: string,         // 서버 호스트
    port: number,         // 서버 포트
    tls: boolean,         // TLS 사용 여부
    name: string,         // 클라이언트 이름
    globalMemCacheLimit: number,  // 메모리 캐시 제한 (MiB)
    keepAlive: number     // Keep-Alive 타임아웃
}
```

### 서버 설정
- 관리자 포트 설정 (`-adminPort`)
- TLS 구성 및 인증서 관리
- 버퍼 제한 및 메모리 관리
- 데몬 모드 및 프로세스 모니터링

## TypeScript 설정

### 메인 프로젝트 (`tsconfig.json`)
- **Target**: ESNext
- **Module**: CommonJS
- **Strict Mode**: 활성화
- **출력 디렉터리**: `./build`
- JSON 모듈 해석 지원

### 관리자 UI (`admin/tsconfig.json`)
- **Svelte 전용 설정** 확장
- **Module**: ESNext (ES 모듈)
- JavaScript 파일 체크 활성화
- Isolated 모듈 모드

## 로깅 시스템

### 로거 구성 (`src/util/logger/LoggerFactory.ts`)
- **서버 로거**: 콘솔 + 파일 (2일 히스토리)
- **클라이언트 로거**: 콘솔 출력
- **부트 로거**: 시스템 시작 로그
- 로그 디렉터리: `logs/`

### 로그 카테고리
- `server`: 서버 관련 로그
- `client`: 클라이언트 관련 로그  
- `boot`: 시스템 부팅 로그

## 보안 고려사항

### 인증서 관리 (`src/server/CertificationStore.ts`)
- 관리자 인터페이스 TLS 인증서
- 외부 연결용 인증서
- 자동 인증서 생성 기능

### 인증 시스템
- 기본 인증 키: 서버-클라이언트 간 공유
- 세션 기반 관리자 인증
- TLS 암호화 지원

## 성능 및 모니터링

### 메모리 관리
- 글로벌 메모리 캐시 제한 (기본 128MiB)
- 소켓 핸들러 버퍼 관리
- 프로세스 메모리 모니터링

### 시스템 모니터링 (`src/commons/SysMonitor.ts`)
- CPU 사용률 추적
- 메모리 사용량 모니터링
- 프로세스 상태 감시

## 특별 고려사항

### CLI 호환성
- 개발 모드 (`-dev` 플래그) 지원
- 백그라운드 실행 (`-daemon` 플래그)
- 크로스 플랫폼 실행 파일 생성

### 네트워크 프로토콜
- TCP/HTTP/HTTPS 터널링 지원
- Keep-Alive 연결 관리
- HTTP 헤더 및 바디 리라이팅 기능

### 개발 시 주의사항
- **no test files**: Jest는 설정되어 있지만 테스트 파일이 없음
- **memory management**: 대용량 파일 전송 시 메모리 제한 고려
- **cross-platform**: 다양한 OS/아키텍처 지원 필요
- **binary packaging**: pkg를 사용한 실행 파일 생성 시 경로 처리 주의