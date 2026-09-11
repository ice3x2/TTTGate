# 단위 0 — 검증 기반 강화

| 항목 | 내용 |
|---|---|
| 상위 문서 | [프로그램 개요](./2026-09-11-program-overview.md) |
| 적용 결정 | D13 |
| 선행 단위 | 없음. 가장 먼저 시작한다 |
| 후행 단위 | 1~5 전부. 특히 5(연결 보안)는 이 단위의 프로세스 E2E 하네스로만 검증할 수 있다 |
| 대상 디렉터리 | `test/`, `scripts/`, `.github/workflows/`, `jest.config.ts`, `package.json` |

## 1. 목표

세 가지를 만든다.

1. **프로세스 수준 터널 E2E 하네스.** 서버 프로세스와 클라이언트 프로세스를 `build/src/app.js` 로 실제 기동하고, 자체 대상 서비스(HTTP + WebSocket)를 터널 뒤에 두고, Playwright 브라우저가 외부 포트를 거쳐 접속해 검증한다. 기존 `test/helpers/tunnelHarness.ts` 는 같은 프로세스 안에서 `TTTServer`·`TTTClient` 를 직접 생성하는 컴포넌트 하네스라서, 프로세스 경계(CLI 인자, 설정 파일 로딩, 데몬·PID 파일, 시그널)와 브라우저 동작은 검증하지 못한다.
2. **모듈·기능별 테스트 보강.** 커버리지 0% 모듈 6개와 50% 미만 모듈 6개에 동작 고정 테스트를 붙이고, 커버리지 기준선을 실측값으로 올린다.
3. **테스트 실행 체계 정리.** 테스트 계층(unit / component / admin / e2e / browser)마다 npm 스크립트를 두고, CI 가 빠른 계층과 느린 계층을 분리 실행하되 둘 다 PR 게이트로 삼는다.

## 2. 현재 상태 (기준 커밋 `5f772fc`)

| 항목 | 값 |
|---|---|
| 테스트 스위트 / 케이스 | 151 / 971 (4 skip) — 에픽 #61 최종 검증 기록(`docs/plan/verification/epic61-final-verification.md`). 테스트 파일은 152개. `npm test -- --runInBand` 약 25분 |
| 커버리지 (src 전체) | 라인 78.25%, 브랜치 70.43%, 함수 81.39% |
| `jest.config.ts` 기준선 | 라인 64.26, 함수 69.74, 브랜치 52.23, 구문 63.71 (실측보다 14pt 낮음) |
| 0% 모듈 (괄호는 커버리지 계측 라인 수) | `src/Sentinel.ts`(123), `src/server/ServerApp.ts`(74), `src/app.ts`(59), `src/util/Optional.ts`(42), `src/util/ConstructorConsumerHandler.ts`(38), `src/util/PubSub.ts`(32) |
| 50% 미만 모듈 | `src/util/ExMath.ts` 12.5%, `src/util/logger/LoggerConfig.ts` 29.7%, `src/util/File.ts` 32.2%, `src/bootstrap/AppCompositionRoot.ts` 44.4%, `src/util/UsablePortChecker.ts` 47.2%, `src/commons/SysMonitor.ts` 48.3% |
| E2E | `test/e2e/tunnel/*.test.ts` 3개 + `test/e2e/req-09-*.test.ts`. 모두 인프로세스 하네스. 브라우저를 거치는 터널 검증 없음 |
| 프로세스 기동 | `scripts/smoke.mjs` 가 `build/src/app.js server` 를 임시 루트(`config/`·`bin/`·`logs/` 생성, `adminTls: true`)에서 spawn 해 관리자 TLS 와 컨트롤 리슨을 확인한다(npm `smoke`). 클라이언트 프로세스 기동은 없음 |
| CI | `code-regression.yml` 이 모든 PR 과 `main` push 마다 `npm ci` → admin `npm ci` → Playwright 설치 → `npm run build` → `npm test -- --runInBand` 를 한 잡으로 실행 |
| 정책 | `docs/guide/test-evidence-policy.md`: 실제 소켓·파일 기본, 스텁은 선언된 경계에서만 |

## 3. 프로세스 E2E 하네스

### 3.1 설계 원칙

- 서버와 클라이언트는 **별도 프로세스**로 `process.execPath build/src/app.js server|client` 를 실행한다. `Environment` 는 `node` 로 실행될 때 `process.cwd()` 를 루트로 삼으므로, 임시 루트를 `cwd` 로 주고 `config/server.yaml`, `config/client.yaml` 을 미리 써 둔다(`scripts/smoke.mjs:229-258` 와 같은 방식). 루트에는 `config/`, `bin/`(Sentinel 이 `.pid_foreground` 를 쓴다), `logs/` 디렉터리를 미리 만든다.
- 관리자 포트는 **`adminTls: true`** 로 띄운다. `src/server/AdminSecurityPolicy.ts:75-86` 이 `adminTls !== true` 를 `-allowLegacyAdminHttp` 없이는 거부하고 `ServerApp.ts:88-92` 가 종료하기 때문이다. 관리자 인증서 파일이 없으면 `CertificationStore.loadAdminCert`(`:346`, `genCACert` 호출 `:354`) 가 자체 서명 인증서를 생성하므로 하네스는 인증서를 만들지 않는다. `adminRequest` 는 Node `https.request({rejectUnauthorized: false})` 로 구현한다(전역 `fetch` 는 이 옵션을 받지 않는다). `test/helpers/http.ts` 에 `httpsRequest` 를 추가해 쓴다. `NODE_TLS_REJECT_UNAUTHORIZED=0` 환경변수는 쓰지 않는다.
- 대상 서비스는 하네스와 같은 Jest 프로세스 안에서 띄운다(포트만 터널이 가리키면 되므로 별도 프로세스가 필요 없다).
- 브라우저는 `playwright` 의 Chromium. 관리자 UI 테스트와 같은 패키지를 쓴다.
- 포트는 전부 `getFreePort()` 로 얻는다. 고정 포트 금지.
- 종료는 `SIGTERM` → 5초 대기 → `SIGKILL`. Windows 에서는 `child.kill()` 이 곧 강제 종료이므로 대기 없이 진행한다. 하네스는 자식 프로세스가 남지 않았음을 `child.exitCode !== null || child.signalCode !== null` 로 확인한다(Windows 의 `kill()` 은 `exitCode null, signalCode 'SIGTERM'` 으로 끝난다).
- 로그: 자식의 stdout/stderr 를 메모리에 모으고 실패 시 단언 메시지에 마지막 50줄을 붙인다.

### 3.2 `test/helpers/processTunnelHarness.ts`

```ts
export type ProcessTunnelOptions = {
    tunnels: Array<{
        forwardPort?: number;                // 생략 시 자동 할당
        protocol: 'tcp' | 'http' | 'https';
        destinationPort: number;             // 대상 서비스 포트
        httpOption?: HttpOption;             // TunnelingOption.httpOption 그대로
        tls?: boolean;                       // https 외부 포트일 때 자체 서명 인증서 자동 생성
        extra?: Partial<TunnelingOption>;    // 5 단위가 rateLimit 등을 넣는 확장 지점
    }>;
    serverOptionExtra?: Partial<ServerOption>;   // 5 단위의 connectionSecurity 등
    clientOptionExtra?: Partial<ClientOption>;
    clientCount?: number;                    // 기본 1. 2 이상이면 trustedClients 를 그 수만큼 만든다
    startClient?: boolean;                   // 기본 true
    identityFixture?: unknown;               // [U2-09 가 추가] config/identity.yaml 로 직렬화(YAML). 2 단위(U2-09)가 형식을 정한다. 사용자 항목은 평문 `password` 필드를 받고 하네스가 bcrypt cost 12 로 `passwordHash` 를 채운다(같은 평문은 모듈 수준 캐시로 한 번만 해시). 지정하면 `.key` 는 쓰지 않는다
    adminAccess?: boolean;                   // [U5-03 이 추가] 기본 true. false 면 준비 판정을 서버 stdout 의 `Listen - port: <forwardPort>` 하나로만 하고 adminRequest·waitForClientOnline·waitForTunnelOnline 을 제공하지 않는다(관리자 포트와 외부 포트가 모두 막히는 국가 필터 시나리오용)
    adminLogin?: {username: string; password: string};   // [U2-09 가 추가] adminRequest 가 로그인할 계정. 기본 {username:'admin', password:'e2e-password-1234'}. identityFixture 를 쓰면 그 안에 이 계정(슈퍼유저)이 있어야 한다
};
export type ProcessTunnelHarness = {
    rootDir: string;                         // 임시 루트 (서버)
    clientRootDirs: string[];
    adminPort: number;
    tunnelPort: number;                      // 서버의 컨트롤 포트 (ServerOption.port)
    tunnels: Array<{forwardPort: number; protocol: string; destinationPort: number}>;
    server: SpawnedProcess;                  // test/helpers/smokeProcess.ts 의 형태: {child, pid, stdoutChunks, stderrChunks, readChannel(), waitForExit(), kill()}
    clients: SpawnedProcess[];
    adminRequest(path: string, init?: {method?: string; body?: unknown}): Promise<{status: number; json: any}>;
                                             // 로그인 세션·CSRF 를 유지한 관리자 API 호출 (대상 검증이 아니라 설정 변경용)
    waitForClientOnline(timeoutMs?: number): Promise<void>;   // /api/clientStatus 가 clientCount 만큼 보고할 때까지
    waitForTunnelOnline(forwardPort: number, timeoutMs?: number): Promise<void>;
    restartServer(patch?: {serverOptionExtra?: Partial<ServerOption>}): Promise<void>;   // patch 가 있으면 server.yaml 을 다시 써서 기동. 같은 포트 재바인드가 Windows 에서 EADDRINUSE 를 낼 수 있으므로 준비 판정을 20초까지 재시도
    stopClient(index?: number): Promise<void>;
    startClient(index?: number): Promise<void>;
    dispose(): Promise<void>;                // 프로세스 종료 + 임시 루트 삭제. 두 번 불러도 안전
};
export function createProcessTunnelHarness(options: ProcessTunnelOptions): Promise<ProcessTunnelHarness>;
```

`[U2-09 가 추가]`·`[U5-03 이 추가]` 로 표시한 옵션은 U0-01 이 만들지 않는다(단위 0 의 어떤 테스트도 쓰지 않는 경로를 미리 만들면 해석 여지만 늘어난다). 필요한 이슈가 자기 범위에서 추가하되 위 시그니처를 따른다.

- `page.request.get('/big?mb=100', {timeout: 110_000})` 처럼 대용량 요청은 Playwright 기본 30초를 넘기므로 타임아웃을 명시한다.

- `server.yaml` 최소 내용(`scripts/smoke.mjs:243-256` 기준): `key`(임의 32자), `adminPort`, `adminBindHost: "127.0.0.1"`, `adminTls: true`, `port`, `tls: false`, `controlProtocolMode: "mixed"`, `allowLegacyControlAuth: false`, `trustedClients: [{clientId, clientSecret}]`, `tunnelingOptions: [...]`, `keepAlive: 0`, `globalMemCacheLimit: 128`. `ServerOptionStore.verificationServerOption` 이 받아들이는 형태여야 한다.
- 관리자 접근을 위해 `.key` 에 비밀번호 `e2e-password-1234` 의 bcrypt 해시(cost 12)를 미리 둔다. `adminRequest` 는 최초 호출 때 `/api/login` 으로 세션과 CSRF 쿠키를 얻는다.
- 서버 CLI: `app.js server` (adminPort 는 yaml). 클라이언트 CLI: `app.js client -addr 127.0.0.1:<tunnelPort> -clientId <id> -clientSecret <secret> -name e2e-client-<n>`.
- 준비 완료 판정(`adminAccess: true`): 서버는 `https://127.0.0.1:<adminPort>/api/version` 200, 터널은 `/api/externalServerStatuses` 에서 `online: true`, 클라이언트는 `/api/clientStatus` 길이. `adminAccess: false` 면 서버 stdout 에 `Listen - port: <forwardPort>` 가 각 터널마다 나타날 때까지 기다리는 것이 **유일한** 판정이다(`ExternalPortServerPool.onServerEvent` 의 Listen 로그). 이 옵션을 쓰는 시나리오는 외부 포트도 막아 두므로 HTTP 요청으로는 준비를 판정할 수 없다.

### 3.3 대상 서비스 — `test/e2e/target/targetService.ts`

의존성: `ws`(devDependency, `^8`). 그 외에는 Node `http`, `crypto`, `stream` 만 쓴다.

```ts
export type TargetService = {port: number; wsPort: number /* = port, 같은 서버 */; close(): Promise<void>;
    counters(): {requests: number; wsConnections: number; wsMessages: number}};
export function startTargetService(options?: {slowDelayMs?: number}): Promise<TargetService>;
```

| 경로 | 응답 | 겨냥하는 터널 기능 |
|---|---|---|
| (공통) | 모든 응답에 `Cache-Control: no-store`(브라우저 캐시 적중으로 요청 수 단언이 흔들리지 않게) | |
| `GET /` | HTML. 제목 `Target OK`, 본문에 `<span id="host">{req.headers.host}</span>` 와 `<script src="/assets/a{1..40}.js">` 40개, `<img src="/assets/i{1..10}.png">` 10개, 끝에 `<div id="ready">ready</div>` 를 모든 스크립트가 실행되면 채우는 인라인 스크립트 | 다중 연결·keep-alive |
| `GET /assets/a{n}.js` | `window.__loaded=(window.__loaded||0)+1` (Content-Type application/javascript, `Cache-Control: no-store`) | |
| `GET /assets/i{n}.png` | 1×1 PNG 바이트 | |
| `GET /absolute` | HTML. `<a id="link" href="http://{req.headers.host}/absolute-target">go</a>` 와 본문 텍스트에 `http://{host}` 를 그대로 포함 | Host 리라이트(`rewriteHostInTextBody`) |
| `GET /api/cors` | JSON `{"ok":true}`, `Access-Control-Allow-Origin: http://target.invalid` | ACAO 리라이트(`replaceAccessControlAllowOrigin`) |
| `GET /headers` | JSON: 요청 헤더 전부 | 커스텀 요청 헤더 |
| `GET /custom-response` | 헤더 `X-Target: original`, 본문 `original-body` | 커스텀 응답 헤더, 본문 치환 |
| `GET /big?mb=100` | `mb` MiB 를 64KiB 청크로 스트리밍. 청크는 결정적 패턴(오프셋 기반)이라 수신 측에서 SHA-256 을 미리 계산할 수 있다 | 대용량 전송·버퍼 한도·파일 캐시 |
| `GET /slow?ms=3000` | `ms` 뒤에 `slow-done` | 타임아웃·keep-alive |
| `GET /echo-post` (POST) | 본문을 그대로 돌려줌 | 요청 본문 전달 |
| `GET /ws` (Upgrade) | WebSocket. 받은 텍스트를 `echo:` 접두어로 돌려주고, 연결 직후 1초 간격으로 `tick:{n}` 을 5회 푸시 | WebSocket 업그레이드·양방향 |
| `GET /ws-page` | HTML. 같은 호스트의 `/ws` 에 접속해 `tick` 5개와 에코 1개를 받으면 `<div id="ws-result">` 에 `ok` 를 쓰는 스크립트 | 브라우저 WebSocket |

TCP 모드 검증용으로는 별도 서비스가 필요 없다. 같은 HTTP 서비스를 `protocol: 'tcp'` 터널 뒤에 두면 브라우저가 그대로 접속한다.

### 3.4 브라우저 E2E — `test/e2e/browser/*.test.ts`

Jest 타임아웃 120초. 각 파일은 `beforeAll` 에서 하네스 하나를 만들고 `afterAll` 에서 `dispose`. 브라우저는 `chromium.launch()` 후 `page.on('pageerror')` 수집.

| 파일 | 터널 | 시나리오와 단언 |
|---|---|---|
| `tcp-page.test.ts` | tcp | `http://127.0.0.1:<fp>/` 열기 → `#ready` 텍스트 `ready`, `window.__loaded === 40`, `#host` 가 `127.0.0.1:<fp>`(브라우저가 보낸 Host 가 그대로 대상에 도달). 새로고침 5회 반복해도 동일. `counters().requests >= 51*5` |
| `http-rewrite.test.ts` | http, `httpOption: {rewriteHostInTextBody: true, replaceAccessControlAllowOrigin: true, customRequestHeaders: [{name:'X-Injected', value:'yes', replace:true}], customResponseHeaders: [{name:'X-Target', value:'rewritten', replace:true}], bodyRewriteRules: [{from:'original-body', to:'rewritten-body'}]}` | `/absolute` 의 `#link` href 가 `http://127.0.0.1:<fp>/absolute-target`(대상 호스트가 외부 포트 호스트로 치환됨). `fetch('/api/cors')` 응답 헤더 ACAO 가 `http://127.0.0.1:<fp>` 와 같음(동일 출처 GET 은 Origin 헤더를 보내지 않으므로 서버가 `protocol + host` 로 폴백한다. `HttpHandler.ts:351`). `/headers` JSON 에 `x-injected: yes`. `/custom-response` 헤더 `x-target: rewritten`, 본문 `rewritten-body` |
| `websocket.test.ts` | http | `/ws-page` → `#ws-result` 가 `ok` (30초 내). `counters().wsConnections === 1`, `wsMessages === 1` |
| `large-transfer.test.ts` | http, `bufferLimitOnServer: 4`, `bufferLimitOnClient: 4` | `page.request.get('/big?mb=100')` 본문 SHA-256 이 기대값과 같고 길이 100 MiB. 전송 중 서버 프로세스 RSS 가 시작 대비 +256 MiB 를 넘지 않음(버퍼 한도 4 MiB 가 작동하면 메모리로 다 담지 않는다). RSS 는 `process.platform === 'linux'` 에서만 `/proc/<pid>/status` 의 `VmRSS` 로 읽어 단언하고 다른 OS 에서는 그 단언만 건너뛴다(`pidusage` 는 Windows 에서 제거된 `wmic` 에 의존하므로 쓰지 않는다). 하네스가 `readRssMiB(pid): number | undefined` 헬퍼를 제공한다 |
| `tls-external.test.ts` | https(`tls: true`, 자체 서명) | `chromium.launch({ignoreHTTPSErrors})` 로 `https://127.0.0.1:<fp>/` → `#ready`. 자체 서명이므로 `page.request` 도 `ignoreHTTPSErrors: true` |
| `slow-and-keepalive.test.ts` | http, `httpOption.keepAliveTimeout: 5`(단위는 **초**. `HttpHandler.ts:204-205` 가 ×1000 한다) | `/slow?ms=3000` 이 `slow-done` 을 반환(keep-alive 타임아웃이 진행 중 응답을 끊지 않음). 이어서 같은 페이지에서 `fetch` 20회 순차 호출 모두 200. 6초 유휴 뒤 재요청도 200(유휴 연결이 닫힌 뒤 새 연결로 복구) |
| `multi-client.test.ts` | tcp 2개, `clientCount: 2`(각 터널이 `allowedClientIds` 로 다른 클라이언트를 지정) | 두 외부 포트 모두 `#ready`. 클라이언트 0 정지 → 터널 0 은 접속 실패(`page.goto` 가 reject 하거나 `#ready` 가 5초 안에 나타나지 않음), 터널 1 은 정상. 클라이언트 0 재기동 → 터널 0 복구 |
| `server-restart.test.ts` | http | 페이지 정상 → `restartServer()` → 20초 내 다시 `#ready`(클라이언트 자동 재접속) |

### 3.5 수동 확인 절차 — `docs/guide/e2e-manual-checklist.md`

CI 밖에서 사람이 하는 확인을 표로 둔다. 실제 프레임워크 앱(예: `npx create-next-app` 으로 만든 앱을 dev 모드로 띄워 HMR 웹소켓 포함) 과 외부 사이트(로그인 없는 공개 페이지 1개)를 터널 뒤에 두고 브라우저로 여는 절차, 기대 결과, 확인란. 릴리스 전 1회 수행을 규칙으로 적는다.

## 4. 모듈 테스트 보강

각 모듈에 대해 **고정할 동작**을 명시한다. 테스트 파일은 `test/unit/<src 경로 대응>/<모듈>.test.ts`. 실제 파일·소켓·프로세스를 쓰고, 스텁은 정책 문서가 허용하는 경계에서만 쓴다.

| 모듈 | 테스트 파일 | 고정할 동작 |
|---|---|---|
| `src/util/Optional.ts` | `test/unit/util/Optional.test.ts` | `empty/of/ofNullable`, `get` 이 비어 있을 때 던지는 오류, `isPresent/isEmpty`, `ifPresent/ifPresentOrElse`, `filter/map/flatMap` 의 빈 값 전파, `or/orElse/orElseGet` |
| `src/util/Dequeue.ts` | `test/unit/util/Dequeue.test.ts` | 양끝 push/pop 순서, `remove(filter)` 가 제거된 항목을 돌려주고 나머지 순서를 유지, `front/back` 이 빈 큐에서 undefined, `size/isEmpty/clear` |
| `src/util/ExMath.ts` | `test/unit/util/ExMath.test.ts` | `map` 선형 사상(범위 밖 값 포함), `floor/ceil/round` 의 precision 0·2·음수 |
| `src/util/PubSub.ts` | `test/unit/util/PubSub.test.ts` | 구독·발행 순서, `unsubscribe` 후 미수신, `unsubscribeAll`, `hasObserver/hasTopic`, `setTickPublish(true)` 일 때 발행이 `setTimeout(0)` 으로 미뤄짐(`await new Promise(r => setTimeout(r, 5))` 로 확인), `instance` 와 `create` 의 분리 |
| `src/util/ConstructorConsumerHandler.ts` | `test/unit/util/ConstructorConsumerHandler.test.ts` | `push` 후 `tryStart` 가 소비자를 순서대로 호출, `pushFront` 우선, `pushOnly` 는 시작하지 않음, `removeItem`, `setStackCutterCount` 로 재귀 깊이 끊김(카운트 이상에서 `setImmediate` 경계가 생김을 호출 스택 깊이로 확인), `setOnPause` 콜백 |
| `src/util/File.ts` | `test/unit/util/File.test.ts` | 임시 루트에서 `createNewFile/exists/length/lastModified/list/listFiles/delete/deleteAll/canRead`, 존재하지 않는 경로에서의 반환값 |
| `src/util/logger/LoggerConfig.ts` | `test/unit/util/logger/LoggerConfig.test.ts` | `create` 기본값, `appendWriteConfig/removeWriteConfig/writeConfig`, `clone` 이 깊은 복사인지(원본 수정이 복제본에 영향 없음), `logFileDir` setter 는 이후 추가되는 writeConfig 에만 반영되고 이미 추가된 것은 바꾸지 않음(현재 동작 고정) |
| (공통) | 각 모듈 라인 커버리지 ≥ 90% 확인 명령: `npx jest --coverage --collectCoverageFrom="src/util/<모듈>.ts" test/unit/util/<모듈>.test.ts` 실행 후 `coverage/coverage-summary.json` 의 해당 파일 `lines.pct` | |
| `src/util/UsablePortChecker.ts` | `test/unit/util/UsablePortChecker.test.ts` | 실제 `net.Server` 를 하나 열어 두고 `check` 가 false, 닫으면 true. `findUsablePort/findUsablePorts/findUsedPorts` 가 열린 포트를 건너뛰거나 포함 |
| `src/commons/SysMonitor.ts` | `test/unit/commons/SysMonitor.test.ts` | `usage()` 의 필드 형태·범위(cpu 0..100, memory.total > 0, heap.used ≤ heap.total, `uptime` 증가), 500ms 캐시(`SysMonitor.ts:115`): 500ms 안의 두 호출은 같은 객체, 600ms 뒤 호출은 다른 객체, `sysInfo()` 의 cpuInfo/osInfo/network 필드 존재 |
| `src/bootstrap/AppCompositionRoot.ts` | `test/unit/bootstrap/AppCompositionRoot.test.ts` | 조립되는 인스턴스의 타입과 단일성(같은 루트에서 두 번 조립 시 동일 객체인지), 존재하는 분기 전부 |
| `src/server/ServerApp.ts` | `test/component/server/ServerApp.test.ts` | 임시 루트에서 `-adminPort` CLI 가 yaml 값을 덮어씀, `-reset true` 가 `config/` 를 지운 뒤 기본 `server.yaml`·`.server.state.json` 두 파일만 다시 만듦(`ServerApp.ts:71-73`), 기동 후 `/api/version` 응답, 종료 시 관리자 포트가 닫힘 |
| `src/Sentinel.ts` | `test/component/Sentinel.test.ts` | `-daemon` 없이 `start()` 가 false 를 돌려주고 `foreground` PID 파일을 쓴다. `isDaemonMode/hasExecuteMode/isSentinelMode` 가 argv·`EXECUTE_MODE` 에 따라 결정. `Sentinel.stop()` 이 PID 파일의 **자기 자신이 아닌** 프로세스에 시그널을 보낸다(자식 프로세스 하나를 spawn 해 그 PID 만 PID 파일에 적고 stop 이 그것을 종료시키는지 확인. `process.kill` 을 스텁하지 않는다). **PID 1 케이스는 테스트하지 않는다**: `Sentinel.processKill`(`src/Sentinel.ts:103-110`)은 자기 PID 만 건너뛰고 파일의 모든 PID 에 `process.kill` 을 부르므로, 파일에 1 을 적는 테스트는 root 컨테이너 CI 에서 실제로 PID 1 을 죽인다. 가드 추가는 동작 변경이라 이 단위 범위 밖이며, 발견 사실만 U0-05 완료 코멘트에 적는다 |
| `src/app.ts` | `test/component/app-entrypoint.test.ts` | `build/src/app.js` 를 인자 없이 실행하면 stdout 에 `Usage: TTTGate [server|client] [options]` 를 출력하고 종료 코드 0 으로 끝난다(`src/app.ts:39-73` 현재 동작. 바꾸지 않는다). `server` 로 실행하면 `/api/version` 응답 후 SIGTERM 에 5초 안에 끝난다. 단언은 `child.exitCode === 0 || child.signalCode === 'SIGTERM'`(현재 `src/` 에 시그널 핸들러가 없어 Linux 는 시그널 종료, Windows 는 `kill()` 강제 종료). **시그널 핸들러를 새로 추가하지 않는다**(동작 변경은 이 단위 범위 밖). `client -addr` 로 실행하면 서버 없이도 재접속을 시도하며 크래시하지 않음(3초 유지 후 종료) |

기준선 조정: 보강이 끝난 뒤 `npm run test:coverage` 실측값에서 0.5pt 를 뺀 값으로 `coverageThreshold` 를 올린다(라인 ≥ 80, 브랜치 ≥ 72 를 기대한다). 실측이 그 아래면 이슈 코멘트에 실측값과 이유를 적고 실측−0.5 로 둔다.

## 5. 실행 체계

### 5.1 npm 스크립트

```json
"test":            "jest --detectOpenHandles",
"test:unit":       "jest --detectOpenHandles test/unit test/commons test/util",
"test:component":  "jest --detectOpenHandles --runInBand test/component test/security test/supply-chain test/ci",
"test:admin":      "jest --runInBand test/admin",
"test:e2e":        "jest --runInBand test/e2e/tunnel test/e2e/target test/e2e/req-09-pool-swap-zombie.test.ts",
"test:e2e:browser":"jest --runInBand test/e2e/browser",
"test:stress":     "jest --runInBand test/stress",
"test:coverage":   "jest --detectOpenHandles --coverage"
```

`test/e2e/browser` 는 `npm run build` 가 선행되어야 한다. `test/component/admin-browser-startup.test.ts` 는 Vite·Chromium 을 요구하므로 U0-06 이 `test/admin/` 으로 옮긴다(`fast` 잡에 브라우저 의존성이 없게). 하네스는 `build/src/app.js` 가 없으면 "Run npm run build first" 오류로 즉시 실패한다.

### 5.2 CI (`code-regression.yml`)

잡 두 개. 둘 다 `pull_request` 와 `push` 에 실행되고 둘 다 필수.

- `fast`: `npm ci` → `npm run build` → `npm run lint` → `npm run test:unit` → `npm run test:component`.
- `browser-e2e`: `npm ci` → admin `npm ci` → `npx playwright install --with-deps chromium` → `npm run build` → `npm run test:admin` → `npm run test:e2e` → `npm run test:e2e:browser`.

`test/ci/code-regression-workflow.test.ts` 가 워크플로우 파일을 읽어 두 잡의 존재와 명령 순서를 단언한다(기존 테스트 갱신).

### 5.3 테스트 문서

`docs/guide/test-evidence-policy.md` 에 절을 추가한다: 계층별 디렉터리, 스크립트, 하네스 선택 기준(인프로세스 `tunnelHarness` vs 프로세스 `processTunnelHarness`), 대상 서비스 경로 표(3.3), 브라우저 테스트 공통 규칙(뷰포트, `errors` 단언, `finally close`).

## 6. 이슈 분할

| # | 제목 | 만드는 것 | 수용 기준 | 선행 |
|---|---|---|---|---|
| U0-01 | 대상 서비스와 프로세스 하네스 | `ws` devDependency, `test/e2e/target/targetService.ts`, `test/helpers/processTunnelHarness.ts`, `test/e2e/browser/tcp-page.test.ts` | `tcp-page.test.ts` 통과. 하네스 단위 테스트 `test/e2e/target/targetService.test.ts`(경로별 응답 형태, `/big` 해시, `/ws` 에코) | — |
| U0-02 | HTTP 리라이트·WebSocket·대용량 E2E | `http-rewrite.test.ts`, `websocket.test.ts`, `large-transfer.test.ts` | 3개 통과 | U0-01 |
| U0-03 | TLS·keep-alive·다중 클라이언트·재시작 E2E | `tls-external.test.ts`, `slow-and-keepalive.test.ts`, `multi-client.test.ts`, `server-restart.test.ts` | 4개 통과 | U0-01 |
| U0-04 | 유틸 모듈 테스트 | Optional, Dequeue, ExMath, PubSub, ConstructorConsumerHandler, File, LoggerConfig, UsablePortChecker | 8개 파일 통과, 각 모듈 라인 커버리지 ≥ 90% | — |
| U0-05 | 프로세스·조립 모듈 테스트 | SysMonitor, AppCompositionRoot, ServerApp(프로세스 경계로만 검증: `ServerApp` 에 종료 API 가 없고 `process.exit` 경로가 있어 인프로세스 테스트 불가), Sentinel, app.ts | 5개 파일 통과, `Sentinel.ts`·`app.ts` 라인 ≥ 70% | — |
| U0-06 | 실행 체계와 CI 분리 | npm 스크립트, `code-regression.yml` 잡 2개, `test/ci/code-regression-workflow.test.ts` 전면 갱신(현재는 `jobs.test` 와 명령 5개를 정확히 단언한다), 정책 문서 절 추가, `docs/guide/e2e-manual-checklist.md` | `test/ci` 통과. 워크플로우 테스트는 YAML 을 파싱해 `fast`·`browser-e2e` 두 잡의 `runs-on` 과 `steps[].run` 순서를 단언한다(actionlint 는 설치되어 있지 않으므로 쓰지 않는다) | U0-01~05 |
| U0-07 | 커버리지 기준선 상향 | `jest.config.ts` threshold, `test/ci/whole-source-coverage.test.ts:29` 의 기대값(현재 `{64.26, 63.71, 69.74, 52.23}` 를 정확히 단언)을 새 기준선으로 갱신 | `npm run test:coverage` 통과, 기준선이 4절 규칙대로 설정됨, `whole-source-coverage.test.ts` 통과 | U0-06 (실행 체계가 정리된 뒤 측정해야 값이 안정적) |

U0-01 → U0-02·U0-03 은 직렬(하네스 선행), U0-04·U0-05 는 U0-01 과 병렬 가능, U0-06 → U0-07 은 마지막.

`fast` CI 잡은 `SUPPLY_CHAIN_ONLINE` 을 설정하지 않는다(`test/supply-chain` 의 온라인 테스트는 skip 되고, `npm audit` 를 부르는 `r3-req-*` 는 네트워크가 있는 러너에서만 의미가 있다).
