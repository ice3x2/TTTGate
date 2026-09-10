# 단위 0 이슈 초안 — 검증 기반 강화

근거: [단위 0 설계](../2026-09-11-unit0-verification-foundation.md), [프로그램 개요](../2026-09-11-program-overview.md)

## U0-01

**title**: test(e2e): 자체 대상 서비스와 프로세스 터널 하네스 추가
**labels**: test, area:test-ci, unit:0
**body**:
## 목적

서버 프로세스와 클라이언트 프로세스를 `build/src/app.js` 로 실제로 기동하고, 자체 대상 서비스(HTTP + WebSocket)를 터널 뒤에 두고, Playwright Chromium 이 외부 포트를 거쳐 접속하는 E2E 하네스를 만든다. 이 이슈가 끝나면 `createProcessTunnelHarness()` 한 번으로 서버·클라이언트·대상 서비스가 준비되고, 첫 브라우저 E2E(`tcp-page.test.ts`)가 통과한다. 이후 U0-02·U0-03 과 단위 5(연결 보안)가 이 하네스를 그대로 쓴다.

## 배경

- 기존 터널 하네스 `test/helpers/tunnelHarness.ts:43` `createTunnelHarness(options)` 는 같은 Jest 프로세스 안에서 `TTTServer.create`·`TTTClient.create` 를 직접 호출하는 컴포넌트 하네스다. 프로세스 경계(CLI 인자, `config/*.yaml` 로딩, PID 파일, 시그널)와 브라우저 동작은 검증하지 못한다.
- 프로세스 기동 헬퍼 `test/helpers/smokeProcess.ts:20` `spawnProcess(nodeBin, args, {cwd, env, logPrefix}): SpawnedProcess`. `SpawnedProcess` 는 `{child, pid, stdoutChunks, stderrChunks, readChannel(), waitForExit(timeoutMs), kill(signal?)}`(`:10-18`). 같은 파일 `:68` `getFreePort()`, `:81` `waitUntil(fn, {timeoutMs, intervalMs, label})`. `test/helpers/network.ts:15` 에도 동명의 `getFreePort` 가 있다(중복이지만 이 이슈에서 통합하지 않는다. 하네스는 `smokeProcess.ts` 의 것을 쓴다).
- 서버 프로세스 기동 선례 `scripts/smoke.mjs:230-268`: 임시 루트에 `config/`·`bin/`·`logs/` 를 만들고 `config/server.yaml` 을 써 둔 뒤 `spawn(process.execPath, [APP_JS, "server"], {cwd: tmpRoot})`. `server.yaml` 최소 필드는 `:243-256`.
- 루트 판정 `src/Environment.ts:6`: `process.argv[0]` 에 `node` 가 포함되면 `process.cwd()` 가 루트다. 경로 표 `:9-22`: `config/`, `logs/`, `cache/server`, `cache/client`, `cert/`, `bin/`(`:20`, `-dev` 가 아닐 때 `rootDir/bin`).
- `src/Sentinel.ts:72-76`: `-daemon` 이 없으면 `start()` 가 `bin/.pid_foreground` 에 자기 PID 를 쓴다(`:201-204`, `flag: 'a'`). `bin/` 이 없으면 예외로 죽으므로 루트에 미리 만든다.
- 관리자 TLS 강제 `src/server/AdminSecurityPolicy.ts:71-86`: `adminTls !== true` 면 `-allowLegacyAdminHttp` 없이 오류. `src/server/ServerApp.ts:84-90` 이 그 오류로 `process.exit(1)`. 관리자 인증서는 `CertificationStore.loadAdminCert()`(`src/server/CertificationStore.ts:346`, 파일이 없으면 `:354` `CACertGenerator.genCACert()` 로 자체 서명 생성) 가 만든다. 외부 포트 https 인증서는 `getExternalCert(port)`(`:144-153`) 가 `makeTempCert()`(`:80`) 의 임시 인증서로 대신한다. 따라서 하네스는 인증서 파일을 만들지 않는다.
- HTTP 헬퍼 `test/helpers/http.ts:17` `httpRequest({port, path, method, headers, body})` 는 `http` 전용이다. 관리자 API 는 https 이므로 같은 파일에 `httpsRequest` 를 추가한다(아래). 전역 `fetch` 는 `rejectUnauthorized` 를 받지 않고, `NODE_TLS_REJECT_UNAUTHORIZED=0` 환경변수는 쓰지 않는다.
- 관리자 비밀번호 `src/server/admin/SessionStore.ts:20` `KEY_FILE_NAME = '.key'`(`config/.key`), `:63-70` 기동 시 읽음, `:145-170` `loginWithDetails`: `.key` 가 비어 있으면 부트스트랩 토큰 요구, `:226-229` bcrypt 해시(`$2a$`/`$2b$`/`$2y$`)면 `bcrypt.compare`. 최소 길이 8(`:22`).
- 로그인 API `src/server/admin/AdminServer.ts:227` `POST /api/login`, 본문 `{"key": "<비밀번호>"}`(`:1042`). 성공 시 `Set-Cookie: sessionKey=…; HttpOnly` 와 `csrfToken=…`(`:1053-1063`), 응답 JSON `{success: true, csrfToken}`(`:1065`). 상태 변경 메서드는 `verifyCsrfGuard`(`:156-163`)가 Origin 과 `x-csrf-token` 헤더(`:47-48`)를 검사하고 `/api/login` 만 헤더 검사를 건너뛴다.
- 상태 API: `GET /api/version`(`:287`, 세션 불필요) → `{name, build}`(`:973-975`). `GET /api/clientStatus`(`:260`, 세션 필요, `:843` 없으면 401) → `{statuses: ClientStatus[]}`; `ClientStatus` 는 `src/server/TunnelServer.ts:44-54` `{id, name, clientId, protocolVersion, controlProtocolMode, legacy, uptime, address, activeSessionCount}`. `GET /api/externalServerStatuses`(`:266`) → `{serverTime, statuses: ExternalPortServerStatus[]}`; 타입은 `src/server/ExternalPortServerPool.ts:31-41` `{port, online, sessions, uptime, active, activeStart, activeTimeout, rx, tx}`.
- 외부 포트 리슨 로그 `src/server/ExternalPortServerPool.ts:323-324`: `logger.info(\`Listen - port: ${server.port}\`)`. 콘솔 패턴은 `%d{yyyy-MM-dd hh:mm:ss.SSS} [%p] %c - %m%n`(`src/util/logger/LoggerConfig.ts:76`)이라 stdout 한 줄이 `… - Listen - port: 12345` 형태다.
- 클라이언트 CLI `src/client/ClientApp.ts:132-158`: `-addr host:port`, `-name`, `-clientId`, `-clientSecret`. `config/client.yaml` 은 있을 때만 읽는다(`:60-63`). yaml 에 `allowInsecureTls`·`allowLegacyFallback` 가 참이면 `REFUSE-INSECURE-YAML` 로 종료한다(`:64-93`, 목록은 `__testInternals.INSECURE_FIELD_NAMES`, `:231-237`). 재접속 간격 기본 5000ms(`src/client/TTTClientRuntime.ts:13`).
- 터널 배정 `src/server/TTTServer.ts:63-67`: `allowedClientIds` 가 비어 있지 않은 터널만 특정 클라이언트에 묶인다. `src/server/ServerOptionStore.ts:339-398` `verificationServerOption` 이 `server.yaml` 의 필수 필드(`key`, `adminPort`, `port`)를 검사한다.
- 앱 설정 시 `SocketHandler.fileCacheDirPath` 는 `cache/server`·`cache/client` 를 가리킨다(`src/bootstrap/AppCompositionRoot.ts:17-22`).
- 기준 커밋 `5f772fc` 기준 `ws` 패키지는 설치되어 있지 않다(`package.json` devDependencies 에 없음).

설계 문서와 다른 점: 설계 §3.1 은 `config/client.yaml` 을 미리 쓴다고 했고 §3.2 는 CLI 인자로 클라이언트를 띄운다고 했다. 이 이슈는 둘 다 한다(yaml 을 쓰고 같은 값을 CLI 로도 준다. CLI 가 yaml 을 덮어쓰므로 결과는 같다). 설계 §3.3 의 `ws` 외에 `@types/ws` 가 필요하다(ts-jest 가 `diagnostics: true` 라 타입 선언이 없으면 컴파일 오류). 설계 §3.2 의 `identityFixture`·`adminLogin`·`adminAccess` 옵션은 단위 0 테스트가 쓰지 않으므로 이 이슈에서 구현하지 않는다: `identityFixture`·`adminLogin` 은 U2-09 가, `adminAccess` 는 U5-03 이 설계 §3.2 와 같은 시그니처로 하네스에 추가한다.

먼저 열어 볼 파일: `test/helpers/smokeProcess.ts`, `scripts/smoke.mjs`, `test/helpers/tunnelHarness.ts`, `src/server/admin/AdminServer.ts`(140-300, 1030-1070), `src/server/admin/SessionStore.ts`, `src/client/ClientApp.ts`, `src/Environment.ts`, `test/helpers/adminBrowser.ts`(브라우저 기동·`errors` 수집 방식).

## 적용되는 결정

- D13 E2E 대상은 외부 사이트가 아니라 자체 Node 대상 서비스(`http` + `ws`). 외부 사이트 확인은 CI 밖 수동 절차(U0-06).
- 프로그램 개요 §3.3: 실제 소켓·파일·프로세스가 기본. 임시 루트는 테스트가 만들고 지운다. 고정 포트 금지.

## 만들 것

### `package.json`

devDependencies 에 `"ws": "^8.18.0"`, `"@types/ws": "^8.5.12"` 추가. `npm install --save-dev ws @types/ws` 로 `package-lock.json` 을 함께 갱신한다. 그 외 스크립트·의존성은 바꾸지 않는다.

### `test/e2e/target/targetService.ts` (신규)

의존성: `ws`, Node `http`, `crypto`, `stream`, `url`. 다른 프로젝트 소스를 import 하지 않는다.

```ts
export type TargetCounters = {requests: number; wsConnections: number; wsMessages: number};
export type TargetService = {
    port: number;
    wsPort: number;                 // port 와 같은 값(같은 http.Server 가 Upgrade 를 받는다)
    counters(): TargetCounters;
    close(): Promise<void>;         // 열린 WebSocket 을 모두 닫고 서버를 닫는다. 두 번 불러도 안전
};
export function startTargetService(options?: {slowDelayMs?: number}): Promise<TargetService>;
// 127.0.0.1 의 임의 포트(listen(0))에 뜬다. slowDelayMs 기본 1000: /slow 에 ms 쿼리가 없을 때의 지연.

export function bigPayloadChunk(offset: number, length: number): Buffer;
// 바이트 i(절대 오프셋)의 값은 (i * 31 + (i >>> 16)) & 255. test/e2e/tunnel/large-transfer-cache.test.ts:52 와 같은 식.
export function bigPayloadDigest(mb: number): string;
// mb MiB 를 64KiB 씩 bigPayloadChunk 로 만들어 SHA-256 hex 를 돌려준다. 전체를 한 번에 할당하지 않는다.
```

카운터 규칙: `requests` 는 Upgrade 가 아닌 HTTP 요청 수(경로 무관, 404 포함). `wsConnections` 는 업그레이드가 완료된 연결 수. `wsMessages` 는 클라이언트로부터 받은 메시지 수(서버가 보내는 `tick` 은 세지 않는다).

공통 규칙: 모든 HTTP 응답(404·405·400 포함)에 `Cache-Control: no-store` 를 붙인다(브라우저 캐시 적중으로 요청 수 단언이 흔들리지 않게). 아래 표의 개별 헤더는 이것에 더해지는 것이다.

| 경로 | 응답 | 겨냥하는 터널 기능 |
|---|---|---|
| `GET /` | 200, `text/html; charset=utf-8`. `<title>Target OK</title>`, `<span id="host">{req.headers.host}</span>`, `<script src="/assets/a1.js"></script>` … `a40.js` 40개, `<img src="/assets/i1.png">` … `i10.png` 10개, 마지막에 `<div id="ready"></div>` 와 인라인 스크립트 `window.addEventListener('load', function(){ document.getElementById('ready').textContent = 'ready'; });` | 다중 연결·keep-alive |
| `GET /assets/a{n}.js` (1 ≤ n ≤ 40) | 200, `application/javascript`, `Cache-Control: no-store`, 본문 `window.__loaded=(window.__loaded||0)+1;` | |
| `GET /assets/i{n}.png` (1 ≤ n ≤ 10) | 200, `image/png`, `Cache-Control: no-store`, 1×1 PNG 바이트(서명 `89 50 4E 47 0D 0A 1A 0A` 로 시작) | |
| `GET /absolute` | 200, HTML. `<a id="link" href="http://{req.headers.host}/absolute-target">go</a>` 와 `<p id="text">http://{req.headers.host}</p>` | Host 리라이트(`rewriteHostInTextBody`) |
| `GET /api/cors` | 200, `application/json`, 본문 `{"ok":true}`, 헤더 `Access-Control-Allow-Origin: http://target.invalid` | ACAO 리라이트 |
| `GET /headers` | 200, `application/json`, 본문은 `req.headers` 객체 그대로(키는 Node 가 소문자로 준다) | 커스텀 요청 헤더 |
| `GET /custom-response` | 200, `text/plain`, 헤더 `X-Target: original`, 본문 `original-body` | 커스텀 응답 헤더·본문 치환 |
| `GET /big?mb=N` | `N` 이 1..1024 의 정수가 아니면 400. 200, `application/octet-stream`, `Content-Length: N*1048576`, 64KiB 청크로 `bigPayloadChunk` 를 스트리밍(백프레셔: `res.write` 가 false 면 `drain` 을 기다린다) | 대용량 전송·버퍼 한도 |
| `GET /slow?ms=N` | `N`(없으면 `slowDelayMs`) 뒤에 200, `text/plain`, 본문 `slow-done` | 타임아웃·keep-alive |
| `POST /echo-post` | 200, 요청의 `Content-Type` 을 그대로, 본문을 그대로. GET 이면 405 | 요청 본문 전달 |
| `GET /ws` (Upgrade) | `ws.WebSocketServer({noServer: true})` 로 업그레이드. 받은 텍스트 `m` 을 `echo:` + `m` 으로 돌려준다. 연결 직후 1초 간격으로 `tick:1` … `tick:5` 를 보낸다(연결이 먼저 닫히면 중단) | WebSocket 업그레이드·양방향 |
| `GET /ws-page` | 200, HTML. `<div id="ws-result"></div>` 와 스크립트: `new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws')`, `open` 에서 `hello` 전송, `tick:` 5개와 `echo:hello` 1개를 모두 받으면 `#ws-result` 에 `ok`, `error`·조기 `close` 면 `fail:<사유>` | 브라우저 WebSocket |
| 그 외 | 404, `text/plain`, `not found` | |

Upgrade 요청 중 경로가 `/ws` 가 아니면 소켓을 `destroy()` 한다.

### `test/helpers/processTunnelHarness.ts` (신규)

```ts
import type {SpawnedProcess} from "./smokeProcess";
import type {ClientOption, HttpOption, ServerOption, TunnelingOption} from "../../src/types/TunnelingOption";

export type ProcessTunnelSpec = {
    forwardPort?: number;                // 생략 시 getFreePort()
    protocol: 'tcp' | 'http' | 'https';
    destinationPort: number;             // 대상 서비스 포트. destinationAddress 는 항상 "127.0.0.1"
    httpOption?: HttpOption;
    tls?: boolean;                       // https 외부 포트일 때 true. 인증서는 서버가 자체 생성
    extra?: Partial<TunnelingOption>;    // allowedClientIds, bufferLimitOnServer 등. 단위 5 의 확장 지점
};
export type ProcessTunnelOptions = {
    tunnels: ProcessTunnelSpec[];
    serverOptionExtra?: Partial<ServerOption>;
    clientOptionExtra?: Partial<ClientOption>;   // INSECURE_FIELD_NAMES 의 키가 있으면 생성 시 throw
    clientCount?: number;                        // 기본 1
    startClient?: boolean;                       // 기본 true
    // identityFixture·adminLogin 은 U2-09 가, adminAccess 는 U5-03 이 설계 §3.2 의 시그니처로 추가한다. 이 이슈에서는 만들지 않는다.
};
export type ProcessTunnelHarness = {
    rootDir: string;
    clientRootDirs: string[];
    adminPort: number;
    tunnelPort: number;                          // ServerOption.port (컨트롤 포트)
    tunnels: Array<{forwardPort: number; protocol: 'tcp' | 'http' | 'https'; destinationPort: number}>;
    clientIds: string[];                         // "e2e-client-0", "e2e-client-1", …
    server: SpawnedProcess;
    clients: SpawnedProcess[];                   // stopClient 로 멈춘 자리는 마지막 프로세스가 남는다(exitCode !== null)
    adminRequest(path: string, init?: {method?: string; body?: unknown}): Promise<{status: number; json: any}>;
    waitForClientOnline(timeoutMs?: number): Promise<void>;
    waitForTunnelOnline(forwardPort: number, timeoutMs?: number): Promise<void>;
    restartServer(patch?: {serverOptionExtra?: Partial<ServerOption>}): Promise<void>;
    stopClient(index?: number): Promise<void>;   // 기본 0
    startClient(index?: number): Promise<void>;  // 기본 0
    dispose(): Promise<void>;
};
export function createProcessTunnelHarness(options: ProcessTunnelOptions): Promise<ProcessTunnelHarness>;
export function readRssMiB(pid: number): number | undefined;
// process.platform === 'linux' 에서만 /proc/<pid>/status 의 `VmRSS:\t<n> kB` 줄을 읽어 n/1024 를 돌려준다. 다른 OS 나 파일이 없으면 undefined.
// pidusage 는 Windows 에서 제거된 wmic 에 의존하므로 쓰지 않는다.
export function formatTail(proc: SpawnedProcess, lines: number): string;
```

동작 규칙:

1. `build/src/app.js` 가 없으면 즉시 `Error('Run npm run build first')`.
2. `clientOptionExtra` 의 키가 `ClientApp.__testInternals.INSECURE_FIELD_NAMES` 에 들어 있으면 `Error('clientOptionExtra must not contain insecure fields')`. `tunnels` 가 빈 배열이면 `Error('At least one tunnel is required')`.
3. 포트: `adminPort`, `tunnelPort`, 각 `forwardPort`(생략된 것)를 `smokeProcess.ts` 의 `getFreePort()` 로 얻는다.
4. 서버 루트: `fs.mkdtemp(path.join(os.tmpdir(), 'tttgate-e2e-server-'))` 아래 `config/`, `bin/`, `logs/`, `cache/server`, `cache/client`, `cert/`. 클라이언트 루트 `n` 개: `tttgate-e2e-client-<n>-` 접두어, 같은 디렉터리 구성.
5. `config/server.yaml` 은 객체를 만들어 `yaml` 패키지 `YAML.stringify` 로 쓴다.
   ```ts
   {key: 'e2e-' + 28자 hex, adminPort, adminBindHost: '127.0.0.1', adminTls: true, port: tunnelPort, tls: false,
    controlProtocolMode: 'mixed', allowLegacyControlAuth: false,
    trustedClients: clientIds.map((id, n) => ({clientId: id, clientSecret: `e2e-secret-${n}`, displayName: id})),
    tunnelingOptions: tunnels.map(t => ({forwardPort, protocol: t.protocol, destinationAddress: '127.0.0.1', destinationPort: t.destinationPort,
        tls: t.tls === true, keepAlive: 0, allowedClientIds: clientIds, ...(t.httpOption ? {httpOption: t.httpOption} : {}), ...t.extra})),
    keepAlive: 0, globalMemCacheLimit: 128, ...serverOptionExtra}
   ```
   `clientIds[n] = 'e2e-client-' + n`. `extra.allowedClientIds` 가 있으면 그것이 기본값(모든 클라이언트)을 대체한다.
6. `config/.key` 에 `bcrypt.hashSync('e2e-password-1234', 12) + '\n'` (`bcryptjs`, dependencies 에 이미 있음). 해시는 모듈 수준 상수로 한 번만 계산한다(하네스 생성마다 cost 12 해시를 반복하지 않는다). 계정 선택(`adminLogin`)과 `config/identity.yaml` 직렬화(`identityFixture`, `serializeIdentityFixture`)는 U2-09 가 추가한다.
7. 클라이언트 `n` 의 `config/client.yaml`: `{key: 'hello-TTTGate', host: '127.0.0.1', port: tunnelPort, tls: false, name: clientIds[n], clientId: clientIds[n], clientSecret: 'e2e-secret-<n>', displayName: clientIds[n], globalMemCacheLimit: 128, keepAlive: 0, ...clientOptionExtra}`.
8. 기동: 서버 `spawnProcess(process.execPath, [APP_JS, 'server'], {cwd: rootDir, logPrefix: 'e2e-server'})`. 클라이언트 `spawnProcess(process.execPath, [APP_JS, 'client', '-addr', '127.0.0.1:' + tunnelPort, '-clientId', id, '-clientSecret', secret, '-name', id], {cwd: clientRootDirs[n], logPrefix: 'e2e-client-' + n})`. `logPrefix` 는 환경변수 `TTTGATE_E2E_VERBOSE` 가 `1` 일 때만 준다(기본은 메모리 수집만).
9. 준비 판정: (a) `https://127.0.0.1:<adminPort>/api/version` 이 200 (20초), (b) 각 터널이 `/api/externalServerStatuses` 에서 `online: true` (20초), (c) `startClient !== false` 면 `waitForClientOnline()` (20초). 관리자 포트 없이 서버 stdout 의 `Listen - port: <forwardPort>` 로 판정하는 경로(`adminAccess: false`)는 U5-03 이 추가한다.
10. 기다리는 동안 서버 `child.exitCode !== null` 이 되면 즉시 실패. 모든 실패 메시지 끝에 `formatTail(server, 50)`(stdout + stderr 의 마지막 50줄)을 붙인다. 이 헬퍼는 `export function formatTail(proc: SpawnedProcess, lines: number): string` 으로 내보낸다.
11. `adminRequest(path, init)`: `test/helpers/http.ts` 의 `httpsRequest`(아래 "변경할 것") 로 호출한다(`rejectUnauthorized: false`, `servername: '127.0.0.1'`). 세션이 없으면 먼저 `POST /api/login` 본문 `{"key":"e2e-password-1234"}` 를 보내 `Set-Cookie` 에서 `sessionKey`·`csrfToken` 값을 저장한다. 이후 요청에 `Cookie: sessionKey=<v>; csrfToken=<v>`. 메서드가 GET 이 아니면 `Origin: https://127.0.0.1:<adminPort>`, `X-CSRF-Token: <csrfToken>`, `Content-Type: application/json` 을 붙이고 `JSON.stringify(init.body)` 를 보낸다. `/api/login` 도 CSRF 헤더 검사만 건너뛰고 Origin 검사는 받으므로(`AdminServer.ts:158-163`) 로그인 요청에서 `Origin` 을 빼면 안 된다. 응답이 401 이면 세션을 버리고 한 번만 다시 로그인해서 재시도한다. 반환 `{status, json}`; 본문이 JSON 이 아니면 `json` 은 `null`.
12. `waitForClientOnline(timeoutMs = 20000)`: `/api/clientStatus` 의 `statuses` 가 "실행 중인 클라이언트 수" 와 같고 각 `clientId` 가 기대 집합에 있을 때까지 200ms 간격으로 폴링.
13. `waitForTunnelOnline(forwardPort, timeoutMs = 20000)`: `/api/externalServerStatuses` 의 `statuses.find(s => s.port === forwardPort)?.online === true` 까지 폴링.
14. `restartServer(patch)`: 서버를 `terminate()`(아래 16) 하고, `patch.serverOptionExtra` 가 있으면 5 의 객체에 얕게 병합해 `server.yaml` 을 다시 쓴 뒤 8 의 서버 기동과 9(a)(b) 를 반복하고, 실행 중 클라이언트가 있으면 `waitForClientOnline()` 을 기다린다(클라이언트는 5초 간격으로 스스로 재접속한다). 같은 포트 재바인드가 Windows 에서 `EADDRINUSE` 를 낼 수 있으므로 새 서버 프로세스가 준비 판정 전에 종료하면(`exitCode !== null`) 20초 한도 안에서 다시 spawn 한다(재시도 사이 500ms).
15. `stopClient(index = 0)`: 해당 프로세스를 `terminate()` 하고 `/api/clientStatus` 에서 그 `clientId` 가 사라질 때까지 기다린다(20초). 이미 멈춰 있으면 아무것도 하지 않는다. `startClient(index = 0)`: 8 의 클라이언트 기동을 반복하고 `waitForClientOnline()`. 실행 중이면 `Error('Client is already running')`.
16. `terminate(proc)`: `proc.kill('SIGTERM')` → `waitForExit(5000)` → 아직 살아 있으면 `proc.kill('SIGKILL')` → `waitForExit(5000)`. `process.platform === 'win32'` 에서는 `child.kill()` 이 곧 강제 종료이므로 첫 대기만 한다(Windows 의 `kill()` 은 `exitCode null, signalCode 'SIGTERM'` 으로 끝난다). 끝난 뒤 `child.exitCode !== null || child.signalCode !== null` 을 확인하고 아니면 `Error('Process did not exit: pid …')`.
17. `dispose()`: 클라이언트 전부 → 서버 순으로 `terminate()`, 그 다음 임시 루트를 `fs.rm(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 200})` 로 지운다(Windows 는 자식이 파일 핸들을 늦게 놓는다). 두 번 불러도 안전(두 번째는 즉시 반환). 생성 도중 실패하면 만들어진 것을 `dispose()` 하고 원래 오류를 던진다.
18. 하네스는 `TTTGATE_E2E_VERBOSE` 외의 환경변수를 읽지 않고, `process.env` 를 자식에 그대로 넘긴다(`spawnProcess` 기본 동작).

### `test/e2e/target/targetService.test.ts` (신규)

`test:e2e` 계층(U0-06 이 스크립트에 넣는다)의 대상 서비스 자체 검증. 아래 수용 기준 참조.

### `test/e2e/browser/tcp-page.test.ts` (신규)

`jest.setTimeout(120_000)`. `beforeAll`: `startTargetService()` → `createProcessTunnelHarness({tunnels: [{protocol: 'tcp', destinationPort: target.port}]})` → `chromium.launch()` → `browser.newPage()` → `page.on('pageerror', e => errors.push(e.message))`. `afterAll`: `browser.close()` → `harness.dispose()` → `target.close()` 를 `finally` 로 순서대로. 브라우저 테스트 공통 규칙(뷰포트 기본, `errors` 단언, `finally close`)은 이후 모든 `test/e2e/browser/*.test.ts` 가 같다.

## 변경할 것

- `package.json`: devDependencies 두 항목 추가(위). 다른 필드는 그대로.
- `package-lock.json`: `npm install` 결과. `package.json` 과 같은 커밋에 넣는다.
- `test/helpers/http.ts`: `httpRequest` 옆에 아래를 추가하고 export 목록에 넣는다. 기존 `httpRequest` 는 바꾸지 않는다.
  ```ts
  type HttpsRequestOptions = HttpRequestOptions & {rejectUnauthorized?: boolean; servername?: string};
  const httpsRequest = async (options: HttpsRequestOptions): Promise<HttpResponse> => { /* https.request 로 httpRequest 와 같은 형태. rejectUnauthorized 기본 false, servername 기본 '127.0.0.1' */ };
  ```

## 하지 말 것

- `src/` 수정 금지. 서버·클라이언트 동작이 기대와 다르면 테스트를 완화하지 말고 이슈 코멘트로 보고한다.
- `test/helpers/tunnelHarness.ts`·`scripts/smoke.mjs`·`test/helpers/network.ts` 수정 금지(중복 `getFreePort` 통합은 범위 밖).
- 고정 포트, `sleep` 으로 준비 판정 대체, 외부 네트워크 접근 금지.
- 브라우저 E2E 를 U0-02·03 분량까지 미리 쓰지 않는다. 이 이슈는 `tcp-page.test.ts` 하나다.
- npm 스크립트·CI 워크플로우는 U0-06 에서 바꾼다. 이 이슈에서는 `npx jest <경로>` 로 직접 실행한다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/e2e/target/targetService.test.ts` (실제 `http.request` 와 `ws.WebSocket` 사용, 포트는 서비스가 고른 것)
  - `GET /` 이면 200, `content-type` 이 `text/html` 로 시작하고, 본문에 `<title>Target OK</title>`, `<span id="host">127.0.0.1:<port></span>`, `/assets/a1.js` … `/assets/a40.js` 40개, `/assets/i1.png` … `/assets/i10.png` 10개, `id="ready"` 가 있다.
  - `GET /assets/a7.js` 이면 200, `content-type` `application/javascript`, `cache-control` `no-store`, 본문 `window.__loaded=(window.__loaded||0)+1;` 이다.
  - `GET /assets/i3.png` 이면 200, `content-type` `image/png`, 본문 앞 8바이트가 `89 50 4E 47 0D 0A 1A 0A` 이다.
  - `GET /assets/a41.js` 이면 404 이다.
  - `GET /absolute` 이면 본문에 `href="http://127.0.0.1:<port>/absolute-target"` 와 `<p id="text">http://127.0.0.1:<port></p>` 가 있다.
  - `GET /api/cors` 이면 본문 JSON 이 `{ok: true}` 이고 `access-control-allow-origin` 이 `http://target.invalid` 이다.
  - `GET /headers` 에 `X-Probe: 1` 을 보내면 응답 JSON 의 `x-probe` 가 `1` 이고 `host` 가 `127.0.0.1:<port>` 이다.
  - `GET /custom-response` 이면 `x-target` 이 `original` 이고 본문이 `original-body` 이다.
  - `GET /big?mb=2` 이면 `content-length` 가 `2097152`, 본문 길이 2097152, SHA-256 hex 가 `bigPayloadDigest(2)` 와 같다.
  - `GET /big?mb=0`, `/big?mb=abc`, `/big?mb=1025` 이면 400 이다.
  - `GET /slow?ms=300` 이면 응답까지 300ms 이상 걸리고 본문이 `slow-done` 이다. `startTargetService({slowDelayMs: 150})` 의 `GET /slow` 이면 150ms 이상 걸린다.
  - `POST /echo-post` 본문 `abc-123`(`text/plain`) 이면 본문 `abc-123`, `content-type` `text/plain` 이다. `GET /echo-post` 이면 405 이다.
  - `GET /nope` 이면 404, 본문 `not found` 이다.
  - `GET /`, `GET /custom-response`, `GET /big?mb=1`, `GET /nope` 의 `cache-control` 이 모두 `no-store` 이다.
  - `ws://127.0.0.1:<port>/ws` 로 접속해 `hello` 를 보내면 `echo:hello` 를 받고, 7초 안에 `tick:1` … `tick:5` 를 순서대로 받는다.
  - 위 WebSocket 교환 뒤 `counters()` 가 `wsConnections: 1`, `wsMessages: 1` 이고, `requests` 는 그 테스트 안에서 보낸 HTTP 요청 수와 같다(Upgrade 는 세지 않는다).
  - `/nope-ws` 로 Upgrade 를 시도하면 소켓이 닫힌다(`ws` 가 `error` 또는 `close` 이벤트를 낸다).
  - `close()` 뒤 같은 포트로 `net.connect` 하면 `ECONNREFUSED` 이고, `close()` 를 다시 불러도 resolve 한다.
  - `bigPayloadChunk(0, 4)` 는 `[0, 31, 62, 93]` 이고, `bigPayloadChunk(65536, 1)[0]` 은 `((65536*31 + 1) & 255)` 이다. `bigPayloadDigest(1)` 은 `bigPayloadChunk(0, 1048576)` 의 SHA-256 과 같다.
- `test/e2e/browser/tcp-page.test.ts`
  - `http://127.0.0.1:<fp>/` 를 열면 `#ready` 의 텍스트가 `ready` 이고(`waitForSelector` 30초), `page.evaluate(() => window.__loaded)` 가 `40` 이며, `#host` 의 텍스트가 `127.0.0.1:<fp>` 이다(tcp 모드는 Host 를 바꾸지 않는다).
  - `page.reload()` 를 5회 반복해도 매번 위 셋이 같다.
  - 끝난 뒤 `target.counters().requests >= 255` 이다(51 요청 × 5 이상).
  - `errors` 가 빈 배열이다.
  - `harness.server.child.exitCode` 가 `null` 이다(서버가 도중에 죽지 않았다).
- 하네스 자체 실패 경로(같은 `tcp-page.test.ts` 안의 별도 `test`):
  - `createProcessTunnelHarness({tunnels: []})` 이면 `At least one tunnel is required` 로 reject 한다.
  - `createProcessTunnelHarness({tunnels: [...], clientOptionExtra: {allowInsecureTls: true}})` 이면 `clientOptionExtra must not contain insecure fields` 로 reject 하고 임시 디렉터리를 남기지 않는다.
  - `readRssMiB(process.pid)` 는 `process.platform === 'linux'` 이면 0 보다 큰 수, 아니면 `undefined` 다. `readRssMiB(2147483647)` 은 `undefined` 다.
  - `httpsRequest({port: harness.adminPort, path: '/api/version'})` 가 `statusCode` 200 이고 본문 JSON 에 `name` 이 있다.

기존 `npm test -- --runInBand` 가 그대로 통과한다.

## 검증 명령

```
npm ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npx jest --runInBand test/e2e/target test/e2e/browser/tcp-page.test.ts
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: 없음(단위 0 의 첫 이슈. U0-04·U0-05 와 병렬 가능).
- 후행: U0-02, U0-03(이 하네스로 나머지 브라우저 E2E), U0-06(스크립트·CI), U5-02(연결 보안 런타임 E2E. U5-01 은 순수 로직이라 선행이 없다), U2-09(`identityFixture`·`adminLogin`), U5-03(`adminAccess`).

## 근거 문서

- `docs/design/2026-09-11-unit0-verification-foundation.md` §3.1(원칙), §3.2(하네스), §3.3(대상 서비스), §3.4 첫 행(`tcp-page`), §6 U0-01
- `docs/design/2026-09-11-program-overview.md` §1 D13, §3.1~3.3

---

## U0-02

**title**: test(e2e): HTTP 리라이트·WebSocket·대용량 전송 브라우저 E2E 추가
**labels**: test, area:test-ci, unit:0
**body**:
## 목적

U0-01 의 프로세스 하네스 위에서 HTTP 모드 터널의 리라이트 기능(Host·ACAO·커스텀 헤더·본문 치환), WebSocket 업그레이드, 100 MiB 대용량 전송과 버퍼 한도를 브라우저로 검증한다. 이 이슈가 끝나면 `test/e2e/browser/` 에 3개 파일이 추가되어 통과한다.

## 배경

- 하네스: `test/helpers/processTunnelHarness.ts` `createProcessTunnelHarness`(U0-01). 대상 서비스: `test/e2e/target/targetService.ts` `startTargetService`, `bigPayloadDigest`.
- HTTP 모드 요청 Host 치환 `src/server/http/HttpHandler.ts:225-236`: 요청 `Host` 를 `tunnelOption.destinationAddress`(`:102`, 하네스에서는 `127.0.0.1`, 포트 없음)로 바꾼다. 따라서 http 터널 뒤의 대상은 `req.headers.host === '127.0.0.1'` 을 본다(tcp 모드와 다르다).
- 응답 Host 복원 `:317-320`, 커스텀 응답 헤더 `:322`, 본문 치환 조건 `:326-328`(텍스트 Content-Type 이고 `rewriteHostInTextBody`), 본문 URL 치환 `:549-550` → `modifyUrlsInBody(body, destinationAddress, originHost)`(`:634-657`): `http://127.0.0.1/…` 처럼 호스트가 `destinationAddress` 로 시작하는 URL 의 호스트를 원래 요청 Host(`127.0.0.1:<fp>`)로 바꾼다. 규칙 치환 `modifyBodyByRule`(`:600`).
- `rewriteHostInTextBody` 기본값 true(`:95-97`), `replaceAccessControlAllowOrigin` 기본값 false(`:98-100`). ACAO 치환 `:345-353`: 요청에 `Origin` 이 있으면 그 값, 없으면 `http://` + 원래 Host. 브라우저 동일 출처 GET `fetch` 는 `Origin` 을 보내지 않으므로 결과는 `http://127.0.0.1:<fp>` 다.
- 커스텀 요청 헤더 `:248` `appendCustomHeader(header, customRequestHeaders)`. 타입 `CustomHeader = {name, value, replace}`(`src/types/TunnelingOption.ts:6-10`), `RewriteRule = {from, to}`(`:12-15`), `HttpOption`(`:17-24`).
- 버퍼 한도 `bufferLimitOnServer`(MiB, 최소 1, 기본 8: `src/server/ServerOptionStore.ts:404-412`), `bufferLimitOnClient`(`src/types/TunnelingOption.ts:82`). 서버 프로세스 RSS 는 하네스의 `readRssMiB(pid)`(U0-01, Linux 에서만 `/proc/<pid>/status` 의 `VmRSS`)로 읽는다. `pidusage` 는 Windows 에서 제거된 `wmic` 에 의존하므로 쓰지 않는다.

설계 문서와 다른 점: 설계 §3.4 는 ACAO 가 "요청 Origin 과 같음" 이라 했으나 동일 출처 GET 에는 Origin 이 없으므로 `http://127.0.0.1:<fp>`(페이지 origin)를 단언한다.

먼저 열어 볼 파일: `test/e2e/browser/tcp-page.test.ts`(공통 구조), `src/server/http/HttpHandler.ts`(위 줄들), `test/helpers/processTunnelHarness.ts`.

## 적용되는 결정

- D13 자체 대상 서비스로 결정적 단언.
- 프로그램 개요 §3.3 테스트 규약.

## 만들 것

세 파일 모두 `jest.setTimeout(120_000)`, `beforeAll`/`afterAll` 과 브라우저 공통 규칙은 `tcp-page.test.ts` 와 같다. 페이지 URL 은 `http://127.0.0.1:<harness.tunnels[0].forwardPort>`.

### `test/e2e/browser/http-rewrite.test.ts`

하네스 옵션:

```ts
{tunnels: [{protocol: 'http', destinationPort: target.port, httpOption: {
    rewriteHostInTextBody: true, replaceAccessControlAllowOrigin: true,
    customRequestHeaders: [{name: 'X-Injected', value: 'yes', replace: true}],
    customResponseHeaders: [{name: 'X-Target', value: 'rewritten', replace: true}],
    bodyRewriteRules: [{from: 'original-body', to: 'rewritten-body'}]}}]}
```

### `test/e2e/browser/websocket.test.ts`

하네스 옵션: `{tunnels: [{protocol: 'http', destinationPort: target.port}]}`.

### `test/e2e/browser/large-transfer.test.ts`

하네스 옵션: `{tunnels: [{protocol: 'http', destinationPort: target.port, extra: {bufferLimitOnServer: 4, bufferLimitOnClient: 4}}]}`. 요청은 `page.request.get('http://127.0.0.1:<fp>/big?mb=100', {timeout: 110_000})` — Playwright 기본 30초를 넘기므로 타임아웃을 명시한다(Jest 120초 안). RSS 상한 규칙: 첫 실행에서 Linux 실측 최대 증가량(MiB)을 이슈 코멘트에 적고, 상한은 `max(실측 × 2, 256)` 으로 테스트 상수 `RSS_LIMIT_MIB` 에 둔다(초기값 256). RSS 표본: `readRssMiB(harness.server.pid)` 를 요청 시작 직전에 1회(기준), 요청 중 500ms 간격으로 계속, 응답 완료 후 정리. 표본은 `setInterval` 로 모으고 `finally` 에서 `clearInterval`. `process.platform !== 'linux'` 이면 `readRssMiB` 가 `undefined` 를 돌려주므로 RSS 단언 하나만 건너뛴다(`if(process.platform === 'linux') expect(...)` 형태. 테스트 자체를 skip 하지 않는다). 해시·길이 단언은 모든 OS 에서 한다.

## 변경할 것

없음.

## 하지 말 것

- `src/` 수정 금지. 단언이 실패하면 기능 결함 후보이므로 기대값을 바꾸지 말고 이슈 코멘트로 보고한다.
- 하네스·대상 서비스 수정은 이 이슈에서 필요한 최소(버그 수정)만. 새 옵션을 추가하지 않는다.
- 대용량 테스트에서 `mb` 를 줄이지 않는다(100 고정).

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/e2e/browser/http-rewrite.test.ts`
  - `/absolute` 를 열면 `#link` 의 `href` 속성이 `http://127.0.0.1:<fp>/absolute-target` 이고 `#text` 의 텍스트가 `http://127.0.0.1:<fp>` 이다(대상은 `http://127.0.0.1/…` 를 냈고 터널이 외부 호스트로 치환했다).
  - `/` 를 연 페이지에서 `page.evaluate(() => fetch('/api/cors').then(r => r.headers.get('access-control-allow-origin')))` 가 `http://127.0.0.1:<fp>` 이다.
  - `page.evaluate(() => fetch('/headers').then(r => r.json()))` 의 `x-injected` 가 `yes` 이고 `host` 가 `127.0.0.1` 이다.
  - `page.request.get('http://127.0.0.1:<fp>/custom-response')` 의 헤더 `x-target` 이 `rewritten` 이고 본문이 `rewritten-body` 이다.
  - `errors` 가 빈 배열이다.
- `test/e2e/browser/websocket.test.ts`
  - `/ws-page` 를 열면 30초 안에 `#ws-result` 의 텍스트가 `ok` 이다.
  - 그 뒤 `target.counters()` 가 `wsConnections: 1`, `wsMessages: 1` 이다.
  - `errors` 가 빈 배열이다.
- `test/e2e/browser/large-transfer.test.ts`
  - `page.request.get('http://127.0.0.1:<fp>/big?mb=100', {timeout: 110_000})` 의 상태가 200, `body()` 길이가 `104857600`, SHA-256 hex 가 `bigPayloadDigest(100)` 과 같다.
  - (Linux 에서만) 전송 중 표본의 최대 RSS(MiB) − 기준 RSS(MiB) 가 `RSS_LIMIT_MIB`(`max(첫 실측 × 2, 256)`) 이하다. 다른 OS 에서는 표본이 모두 `undefined` 이고 이 단언만 건너뛴다.
  - 전송 뒤 `/` 를 열면 `#ready` 가 `ready` 이다(대용량 뒤에도 터널이 살아 있다).
  - `harness.server.child.exitCode` 와 `harness.clients[0].child.exitCode` 가 `null` 이다.

기존 `npm test -- --runInBand` 가 그대로 통과한다.

## 검증 명령

```
npm ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npx jest --runInBand test/e2e/browser/http-rewrite.test.ts test/e2e/browser/websocket.test.ts test/e2e/browser/large-transfer.test.ts
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U0-01.
- 후행: U0-06(이 파일들이 `test:e2e:browser` 계층에 들어간다).

## 근거 문서

- `docs/design/2026-09-11-unit0-verification-foundation.md` §3.4(`http-rewrite`, `websocket`, `large-transfer` 행), §6 U0-02
- `docs/design/2026-09-11-program-overview.md` §1 D13, §3.3

---

## U0-03

**title**: test(e2e): TLS·keep-alive·다중 클라이언트·서버 재시작 브라우저 E2E 추가
**labels**: test, area:test-ci, unit:0
**body**:
## 목적

외부 포트 https(자체 서명), keep-alive 타임아웃과 느린 응답, 클라이언트 두 개의 독립 운용과 정지·복구, 서버 프로세스 재시작 뒤 자동 재접속을 브라우저로 검증한다. 이 이슈가 끝나면 `test/e2e/browser/` 에 4개 파일이 추가되어 통과한다.

## 배경

- 하네스: `test/helpers/processTunnelHarness.ts`(U0-01) — `clientCount`, `stopClient`, `startClient`, `restartServer`, `waitForTunnelOnline`, `waitForClientOnline`.
- 외부 포트 TLS: `src/server/ExternalPortServerPool.ts:125-133` 이 `option.tls` 와 `certInfo` 로 `TCPServer.create` 한다. `certInfo` 는 `src/server/TTTServer.ts:502` `CertificationStore.instance.getExternalCert(port)` → 저장된 인증서가 없으면 임시 자체 서명(`src/server/CertificationStore.ts:144-153`).
- keep-alive 타임아웃 `src/server/http/HttpHandler.ts:200-212`: `httpOption.keepAliveTimeout` 이 있으면 `setTimeout(keepAliveTimeout * 1000)` — **단위는 초**다. 없으면 60000ms.
- 클라이언트 배정 `src/server/TTTServer.ts:63-67`, `src/server/TunnelServer.ts:347-349`: `allowedClientIds` 에 든 클라이언트만 그 터널의 세션을 받는다. 배정된 클라이언트가 없으면 세션 열기가 실패한다(`src/server/TTTServer.ts:128-130`).
- 클라이언트 재접속 `src/client/TTTClient.ts:101-112`: 5000ms 뒤 재시도(`TTTClientRuntime.ts:13`), 로그 `Try reconnect after 5000ms`.

설계 문서와 다른 점: 설계 §3.4 는 `keepAliveTimeout: 2`(2초) 로 `/slow?ms=3000` 을 받는다고 했으나, 소스(`HttpHandler.ts:204-205`)는 이 값을 소켓 유휴 타임아웃으로 쓰므로 3초 지연은 2초 타임아웃과 겹쳐 "keep-alive 가 진행 중 응답을 끊지 않음" 과 "유휴 타임아웃이 동작함" 을 한 케이스에서 구분할 수 없다. 이 이슈는 `keepAliveTimeout: 5`(5초) 를 쓰고 두 주장을 나눠 검증한다: (a) 3초 지연 응답(< 5초)이 끊기지 않고 `slow-done` 을 돌려준다, (b) 6초 유휴(> 5초) 뒤에도 새 요청이 200 이다(타임아웃으로 닫힌 연결 대신 브라우저가 새 연결을 연다). 단언이 실패하면 기대값을 바꾸지 말고 이슈 코멘트로 보고한다.

먼저 열어 볼 파일: `test/e2e/browser/tcp-page.test.ts`, `test/helpers/processTunnelHarness.ts`, `src/server/http/HttpHandler.ts:200-212`.

## 적용되는 결정

- D13, 프로그램 개요 §3.3.

## 만들 것

네 파일 모두 `jest.setTimeout(120_000)`, 구조는 `tcp-page.test.ts` 와 같다.

### `test/e2e/browser/tls-external.test.ts`

하네스 `{tunnels: [{protocol: 'https', destinationPort: target.port, tls: true}]}`. 브라우저는 `chromium.launch()` 뒤 `browser.newContext({ignoreHTTPSErrors: true})` 에서 `newPage()`. `page.request` 도 이 컨텍스트의 것이라 자체 서명을 허용한다.

### `test/e2e/browser/slow-and-keepalive.test.ts`

하네스 `{tunnels: [{protocol: 'http', destinationPort: target.port, httpOption: {keepAliveTimeout: 5}}]}`.

### `test/e2e/browser/multi-client.test.ts`

대상 서비스 하나. 하네스:

```ts
{clientCount: 2, tunnels: [
    {protocol: 'tcp', destinationPort: target.port, extra: {allowedClientIds: ['e2e-client-0']}},
    {protocol: 'tcp', destinationPort: target.port, extra: {allowedClientIds: ['e2e-client-1']}}]}
```

### `test/e2e/browser/server-restart.test.ts`

하네스 `{tunnels: [{protocol: 'http', destinationPort: target.port}]}`.

## 변경할 것

없음.

## 하지 말 것

- `src/` 수정 금지. 단언 실패는 이슈 코멘트로 보고.
- 재접속을 앞당기려고 클라이언트 재접속 간격을 바꾸는 옵션을 하네스에 추가하지 않는다(20초 대기가 5초 간격을 충분히 덮는다).
- `sleep` 으로 상태 전이를 판정하지 않는다. 유휴 대기(6초)만 예외이며 그 목적(keepAliveTimeout 5초 경과)을 주석에 적는다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/e2e/browser/tls-external.test.ts`
  - `https://127.0.0.1:<fp>/` 를 열면 `#ready` 가 `ready`, `window.__loaded === 40`, `#host` 가 `127.0.0.1` 이다(https 모드도 HTTP 핸들러가 Host 를 `destinationAddress` 로 바꾼다).
  - `page.evaluate(() => location.protocol)` 이 `https:` 이다.
  - `page.request.get('https://127.0.0.1:<fp>/custom-response')` 가 200, 본문 `original-body` 이다.
  - `errors` 가 빈 배열이다.
- `test/e2e/browser/slow-and-keepalive.test.ts`
  - `/` 를 연 페이지에서 `page.evaluate(() => fetch('/slow?ms=3000').then(r => r.text()))` 가 `slow-done` 이다(keepAliveTimeout 5초가 진행 중 응답을 끊지 않는다).
  - 이어서 `page.evaluate` 로 `fetch('/custom-response')` 를 20회 순차 호출하면 모두 `status === 200` 이다.
  - 6초 유휴 뒤(주석: keepAliveTimeout 5초 경과) `fetch('/custom-response')` 가 200 이다.
  - `harness.server.child.exitCode` 와 `harness.clients[0].child.exitCode` 가 `null`, `errors` 가 빈 배열이다.
- `test/e2e/browser/multi-client.test.ts`
  - 두 외부 포트 `http://127.0.0.1:<fp0>/`, `http://127.0.0.1:<fp1>/` 모두 `#ready` 가 `ready` 이다.
  - `harness.stopClient(0)` 뒤 `page.goto('http://127.0.0.1:<fp0>/', {timeout: 5000})` 이 reject 하거나, resolve 하더라도 `page.waitForSelector('#ready:has-text("ready")', {timeout: 5000})` 이 reject 한다(둘 중 하나면 "접속 실패"). 같은 시점에 `<fp1>` 은 `#ready` 가 `ready` 이다.
  - `harness.startClient(0)` 뒤 20초 안에 `<fp0>` 가 다시 `#ready` `ready` 이다.
  - `errors` 가 빈 배열이다(`goto` 실패는 `pageerror` 가 아니다).
- `test/e2e/browser/server-restart.test.ts`
  - `/` 가 `#ready` `ready` 인 상태에서 `harness.restartServer()` 를 호출하면 resolve 하고, `harness.server.pid` 가 이전 값과 다르다.
  - 그 뒤 20초 안에 `page.goto('/')` 가 `#ready` `ready` 이다(클라이언트 프로세스는 그대로이고 스스로 재접속했다: `harness.clients[0].child.exitCode === null`).
  - `harness.clients[0].readChannel().stdout` 에 `Try reconnect after 5000ms` 가 있다.
  - `errors` 가 빈 배열이다.

기존 `npm test -- --runInBand` 가 그대로 통과한다.

## 검증 명령

```
npm ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npx jest --runInBand test/e2e/browser/tls-external.test.ts test/e2e/browser/slow-and-keepalive.test.ts test/e2e/browser/multi-client.test.ts test/e2e/browser/server-restart.test.ts
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U0-01(U0-02 와 병렬 가능).
- 후행: U0-06.

## 근거 문서

- `docs/design/2026-09-11-unit0-verification-foundation.md` §3.4(`tls-external`, `slow-and-keepalive`, `multi-client`, `server-restart` 행), §6 U0-03
- `docs/design/2026-09-11-program-overview.md` §1 D13, §3.3

---

## U0-04

**title**: test(util): 유틸리티 모듈 8종 동작 고정 테스트 추가
**labels**: test, area:test-ci, unit:0
**body**:
## 목적

커버리지 0% 또는 50% 미만인 `src/util/` 모듈 8개의 현재 동작을 테스트로 고정한다. 이 이슈가 끝나면 `test/unit/util/` 에 8개 파일이 추가되고 각 모듈의 라인 커버리지가 90% 이상이 된다. 동작은 바꾸지 않는다(결함 후보는 이슈 코멘트로 보고).

## 배경

기준 커밋 `5f772fc` 의 커버리지: `Optional.ts` 0%, `ConstructorConsumerHandler.ts` 0%, `PubSub.ts` 0%, `ExMath.ts` 12.5%, `LoggerConfig.ts` 29.7%, `File.ts` 32.2%, `UsablePortChecker.ts` 47.2%. `Dequeue.ts` 는 `ConstructorConsumerHandler` 를 통해서만 간접 실행된다. 기존 유틸 테스트 선례: `test/unit/util/CLI.test.ts`(describe/it 스타일), `test/unit/util/log-retention.test.ts`(임시 디렉터리와 스트림 정리).

모듈별 현재 동작(테스트가 고정할 사실. 줄 번호는 해당 소스):

- `src/util/Optional.ts` (default export `Optional<T>`): `empty()` 는 공유 인스턴스 `EMPTY`(`:4`)라 `Optional.empty() === Optional.empty()`. `ofNullable(value)` 는 `value === null` 일 때만 비어 있다(`:19-21`) — `ofNullable(undefined)` 는 `isPresent() === true`. `get()` 은 비어 있으면 `Error('No value present')`(`:24-26`). `map` 은 `ofNullable(mapper(v))`(`:64`)라 mapper 가 `null` 을 돌려주면 비어 있다. `flatMap` 결과가 `null` 이면 비어 있다(`:72-73`). `or(supplier)` 는 비어 있을 때만 supplier 호출(`:77-84`). `orElse`, `orElseGet`, `orElseThrow`(`:94-100`), `equals`(`:102-113`, 값 `===` 비교), `toString`(`:115-117`: `Optional[v]` / `Optional.empty`).
- `src/util/Dequeue.ts` (default export `Dequeue<T>`): `pushBack/pushFront/popFront/popBack/front/back/size/isEmpty/clear`. `remove(filter)` 는 조건에 맞는 항목을 모두 빼서 순서대로 돌려주고 나머지 순서를 유지한다(`:19-30`). 빈 큐에서 `front/back/popFront/popBack` 은 `undefined`.
- `src/util/ExMath.ts` (default export, 정적): `map(value, in_min, in_max, out_min, out_max)` 선형 사상(`:4-6`, 범위 밖도 그대로 외삽). `floor/ceil/round(value, precision)` 는 `10^precision` 을 곱해 처리(`:7-20`), precision 이 음수면 자릿수 단위.
- `src/util/PubSub.ts` (`export {PubSub, Observer}`): `instance` 싱글턴(`:12-17`), `create()` 는 새 인스턴스(`:25-27`). `_tickPublish` 기본 true(`:9`)라 `publish` 가 `setTimeout(…, 0)` 으로 미룬다(`:37-40`) — 설계 문서는 `setImmediate` 라 했으나 소스는 `setTimeout` 이다. `setTickPublish(false)` 면 동기 호출(`:41-43`). `subscribe/unsubscribe/hasObserver/hasTopic/unsubscribeAll`. `clear()` 는 본문이 비어 있어 아무것도 하지 않는다(`:29-31`).
- `src/util/ConstructorConsumerHandler.ts` (default export): 생성자에 `Consumer<T> = (item) => boolean`. `push` 는 뒤에 넣고 `tryStart`(`:51-54`), `pushFront` 는 앞에 넣고 `tryStart`(`:42-45`), `pushOnly` 는 넣기만(`:38-40`). `tryStart` 는 실행 중이면 false, 아니면 `process.nextTick` 으로 소비 시작 후 true(`:56-63`). 소비자가 false 를 돌려주면 그 항목을 앞에 되돌리고 멈추며 `onPause` 호출(`:77-82`). 큐가 비면 `onPause` 호출(`:66-70`). `callCount >= _stackCutterCount`(기본 100000, `:21`)면 `process.nextTick` 으로 스택을 끊는다(`:83-88`). `removeItem(filter)` 는 `Dequeue.remove` 위임(`:47-49`). `setStackCutterCount` 는 `this` 반환(`:29-32`).
- `src/util/File.ts` (default export `File`): 생성자 `...paths` 를 `Path.join`, 인자 없으면 `process.cwd()`(`:12-20`). `toString/getName/length/lastModified/creation/list/listFiles/delete/deleteAll/createNewFile/exists/canRead/canWrite/getParent/getParentFile/mkdir/mkdirs/isDirectory/isFile/rename`. 존재하지 않는 경로: `length/lastModified/creation` 0, `exists/isFile/isDirectory/canRead/canWrite/delete/deleteAll` false, `list()` 는 `isFile()` 이 false 라 `fs.readdirSync` 가 던진다(`:98-106`). `delete()` 는 빈 디렉터리만 지우고 비어 있지 않으면 false(`:112-126`). `createNewFile` 은 이미 있으면 false(`:150-158`). `mkdir/mkdirs` 는 이미 있으면 false(`:233-255`). `rename` 은 목적지가 이미 있으면 false(`:311-318`), 부모가 없으면 만들어서 이동(`:319-338`). `lastAccess()` 는 `Date.parse(숫자)` 라 존재하는 파일에서도 `NaN` 을 돌려준다(`:85-91`) — 테스트하지 않고 결함 후보로 코멘트에 적는다.
- `src/util/logger/LoggerConfig.ts` (`export {Level, WriteConfig, LoggerConfig}`): `LoggerConfig.create(path)`(`:62-66`). `appendWriteConfig(wc)` 는 `path/history(30)/console(true)/file(true)/pattern/level('info')` 기본값을 채운다(`:71-77`). `default` 미지정 시 첫 항목만 true 가 되고 두 번째부터는 false(`:78-81`; `:79` 의 `find` 콜백은 `config.default = true` 대입이라 첫 기존 항목이 true 로 바뀐 채 반환된다 — 결함 후보, 코멘트로 보고. 관찰되는 결과는 "첫 항목 true, 이후 false"). `default: true` 를 지정하면 나머지가 false 로 바뀐다(`:81-86`). `writeConfig(name)` 은 내부 객체를 그대로 돌려주고(`:108-110`), `writeConfigs`·`defaultWriteConfig` 는 복제본(`:90-98`). `clone()` 은 `cloneWriteConfig` 로 항목별 복사(`:43-50`). `logFileDir` setter(`:53-59`)는 `_defaultPath` 와 `_defaultWriteConfig.path` 를 바꾸지만 이미 추가된 항목은 `path` 가 채워져 있어 바뀌지 않는다 — 설계 문서 "writeConfig 경로에 반영" 과 다르며 소스를 따른다(setter 이후 추가한 항목만 새 경로).
- `src/util/UsablePortChecker.ts` (default export, 정적): `check(port)` 는 `!port || port < 0 || port > 65535` 면 `Error("port is invalid (0 ~ 65535)")`(`:10`), 아니면 `net.createServer().listen(port)`(호스트 미지정) 성공 여부(`:11-21`). `checkPorts`, `findUsablePort(start, end)`(없으면 -1), `findUsablePorts(start, end, count?)`, `findUsedPorts(start, end)`.

먼저 열어 볼 파일: 위 8개 소스 전문, `test/unit/util/CLI.test.ts`, `test/unit/util/log-retention.test.ts`, `test/helpers/network.ts`(`getFreePort`), `docs/guide/test-evidence-policy.md`.

## 적용되는 결정

- 프로그램 개요 §3.1 범위 밖 리팩터링 금지, §3.3 실제 파일·소켓 사용.

## 만들 것

파일은 `test/unit/util/` 아래(`LoggerConfig` 만 소스 경로를 따라 `test/unit/util/logger/`), 파일명은 `<모듈>.test.ts`. `describe(<모듈명>)` 안에 `it` 으로 케이스를 쓴다. 파일 테스트는 `fs.mkdtempSync(path.join(os.tmpdir(), 'tttgate-file-'))` 로 만든 루트를 `afterEach` 에서 `fs.rmSync(root, {recursive: true, force: true})`. 포트 테스트는 `test/helpers/network.ts` 의 `getFreePort` 대신 실제 `net.Server` 를 `listen(0, '127.0.0.1')` 로 열어 그 포트를 쓴다(점유 상태가 곧 픽스처다).

- `test/unit/util/Optional.test.ts`
- `test/unit/util/Dequeue.test.ts`
- `test/unit/util/ExMath.test.ts`
- `test/unit/util/PubSub.test.ts`
- `test/unit/util/ConstructorConsumerHandler.test.ts` — 스택 깊이 관찰을 위해 파일 상단에서 `Error.stackTraceLimit = 200` 으로 올리고 `afterAll` 에서 원래 값으로 되돌린다. 깊이는 소비자 안에서 `new Error().stack!.split('\n').length` 로 잰다.
- `test/unit/util/File.test.ts`
- `test/unit/util/logger/LoggerConfig.test.ts`
- `test/unit/util/UsablePortChecker.test.ts`

## 변경할 것

없음(`src/` 는 손대지 않는다).

## 하지 말 것

- `Optional.ofNullable(undefined)`, `LoggerConfig.appendWriteConfig` 의 `=` 대입, `File.lastAccess` 의 `NaN`, `File.list()` 의 예외를 "고치지" 않는다. 결함 후보는 이슈 코멘트에 파일:줄과 함께 적는다.
- 타이머·소켓을 흉내 내는 스텁을 쓰지 않는다(`jest.useFakeTimers` 금지). `PubSub` 의 지연은 실제 `setTimeout` 으로 기다린다.
- 다른 모듈(`SysMonitor`, `AppCompositionRoot` 등)은 U0-05 범위다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/unit/util/Optional.test.ts`
  - `Optional.empty()` 이면 `isPresent()` false, `isEmpty()` true, `get()` 이 `No value present` 로 던진다.
  - `Optional.of(3)` 이면 `get()` 3, `isPresent()` true.
  - `Optional.ofNullable(null)` 이면 비어 있고 `Optional.empty()` 와 같은 객체다. `Optional.ofNullable(undefined)` 이면 `isPresent()` 가 true 다.
  - `ifPresent` 는 값이 있을 때만 호출되고, `ifPresentOrElse` 는 비어 있으면 두 번째 콜백만 호출된다.
  - `filter(v => v > 5)` 는 `of(3)` 에서 비어 있고 `of(9)` 에서 같은 객체다. 빈 값의 `filter` 는 같은 빈 객체다.
  - `of(2).map(v => v * 2).get()` 은 4, `of(2).map(() => null)` 은 비어 있고, `empty().map(fn)` 은 fn 을 호출하지 않는다.
  - `of(2).flatMap(v => Optional.of(v + 1)).get()` 은 3, `flatMap(() => null as any)` 은 비어 있고, `empty().flatMap(fn)` 은 fn 을 호출하지 않는다.
  - `of(1).or(() => of(2)).get()` 은 1 이고 supplier 가 호출되지 않는다. `empty().or(() => of(2)).get()` 은 2. `empty().or(() => null as any)` 은 비어 있다.
  - `empty().orElse(7)` 7, `of(1).orElse(7)` 1, `empty().orElseGet(() => 8)` 8, `empty().orElseThrow(() => new RangeError('x'))` 가 `RangeError` 로 던지고 `of(1).orElseThrow(fn)` 은 fn 을 호출하지 않는다.
  - `of(1).equals(of(1))` true, `of(1).equals(of(2))` false, `of(1).equals(1)` false, `empty().equals(empty())` true.
  - `of('a').toString()` 은 `Optional[a]`, `empty().toString()` 은 `Optional.empty`.
- `test/unit/util/Dequeue.test.ts`
  - `pushBack(1), pushBack(2), pushFront(0)` 이면 `size()` 3, `front()` 0, `back()` 2, `popFront()` 0, `popBack()` 2, `size()` 1.
  - 빈 큐에서 `front()/back()/popFront()/popBack()` 이 모두 `undefined` 이고 `isEmpty()` true.
  - `[1,2,3,4,5]` 에서 `remove(v => v % 2 === 0)` 이면 반환 `[2,4]`, 남은 순서 `[1,3,5]`(`popFront` 로 확인).
  - `remove(() => false)` 는 `[]` 를 돌려주고 크기가 그대로다.
  - `clear()` 뒤 `size()` 0, `isEmpty()` true.
- `test/unit/util/ExMath.test.ts`
  - `map(5, 0, 10, 0, 100)` 50, `map(15, 0, 10, 0, 100)` 150, `map(-5, 0, 10, 100, 0)` 150.
  - `floor(1.239, 2)` 1.23, `floor(1299, -2)` 1200, `floor(2.7, 0)` 2.
  - `ceil(1.231, 2)` 1.24, `ceil(1201, -2)` 1300, `ceil(2.1, 0)` 3.
  - `round(1.234, 2)` 1.23, `round(1.236, 2)` 1.24, `round(2.5, 0)` 3, `round(1250, -2)` 1300.
- `test/unit/util/PubSub.test.ts`
  - `PubSub.instance === PubSub.instance` 이고 `PubSub.create() !== PubSub.instance` 이며 `create()` 두 번은 서로 다른 객체다.
  - `create()` 한 인스턴스에 두 observer 를 `subscribe('t', …)` 하고 `setTickPublish(false)` 상태에서 `publish('t', 'm')` 이면 구독 순서대로 `('t','m')` 이 동기 호출된다(호출 기록 배열 길이 2, `publish` 반환 직후 확인).
  - `setTickPublish(true)`(기본) 상태에서 `publish` 직후 호출 기록이 0이고, `await new Promise(r => setTimeout(r, 5))` 뒤 1이다.
  - `unsubscribe('t', a)` 뒤 `publish` 는 `b` 만 받고 `hasObserver('t', a)` false, `hasObserver('t', b)` true.
  - `unsubscribeAll('t')` 뒤 `hasTopic('t')` false, `publish('t', 'x')` 는 아무도 받지 않는다.
  - 구독하지 않은 토픽에 `publish` 해도 던지지 않고, `hasObserver('none', fn)` false.
  - `clear()` 를 불러도 던지지 않고 기존 구독이 유지된다(현재 동작).
- `test/unit/util/ConstructorConsumerHandler.test.ts`
  - 항상 true 를 돌려주는 소비자에 `push(1), push(2), push(3)` 하면 `push` 직후 소비 기록이 비어 있고, `await new Promise(r => setImmediate(r))` 뒤 `[1,2,3]` 이다.
  - `pushOnly(1)` 뒤 한 틱을 기다려도 소비 기록이 비어 있고, `tryStart()` 가 true 를 돌려준 뒤 한 틱 뒤 `[1]` 이다.
  - 실행 중(`tryStart()` 직후 같은 틱)에 `tryStart()` 를 다시 부르면 false 다.
  - `pushOnly(2)` 뒤 `pushFront(1)` 하면 소비 순서가 `[1,2]` 다.
  - 소비자가 항목 2 에서 false 를 돌려주면 소비 기록이 `[1,2]` 에서 멈추고 `setOnPause` 콜백이 1회 호출되며, 그 뒤 `removeItem(v => v === 2)` 가 `[2]` 를 돌려주고, `tryStart()` 뒤 `[1,2,3]` 이 된다(3 은 큐에 남아 있던 항목).
  - 큐가 비어 소비가 끝나면 `setOnPause` 콜백이 호출된다.
  - `setStackCutterCount(2)` 가 같은 객체를 돌려주고, 항목 5개를 `pushOnly` 한 뒤 `tryStart()` 하면 소비자가 잰 스택 깊이가 `depth[1] > depth[0]`, `depth[2] > depth[1]`, `depth[3] < depth[2]` 이다(3번째 소비 뒤 `nextTick` 경계).
- `test/unit/util/File.test.ts`
  - `new File()` 의 `toString()` 이 `process.cwd()` 이다. `new File(root, 'a', 'b.txt').toString()` 이 `path.join(root, 'a', 'b.txt')`, `getName()` 이 `b.txt`, `getParent()` 가 `path.resolve(root, 'a')`, `getParentFile().toString()` 도 같다.
  - 존재하지 않는 경로에서 `exists/isFile/isDirectory/canRead/canWrite/delete/deleteAll/createNewFile-이후-exists` 값이 위 "배경" 표와 같고 `length/lastModified/creation` 이 0 이며 `list()` 가 던진다.
  - `createNewFile()` 이 true, 두 번째는 false, `exists()`·`isFile()` true, `isDirectory()` false, `length()` 0. 6바이트를 쓰면 `length()` 6, `lastModified()` 와 `creation()` 이 0 보다 크다.
  - 디렉터리에 파일 두 개를 만들면 `list()` 가 절대 경로 두 개(정렬 후 비교), `listFiles()` 가 `File` 두 개이고 각 `getName()` 이 파일명이다. 파일에 `list()` 하면 `[]`.
  - `mkdir()` true, 두 번째 false, `mkdirs()` 로 두 단계 아래 생성 true, 기존 경로에 `mkdirs()` false. 부모가 없는 경로에 `mkdir()` false.
  - 비어 있지 않은 디렉터리에 `delete()` false, `deleteAll()` true 뒤 `exists()` false. 빈 디렉터리에 `delete()` true. 파일에 `delete()` true.
  - `canRead()`·`canWrite()` 가 존재하는 파일에서 true.
  - `rename(path.join(root, 'moved', 'x.txt'))` 이 true 이고 `toString()` 이 새 경로이며 새 파일이 존재하고 옛 파일이 없다. 이미 존재하는 경로로 `rename` 하면 false 이고 원본이 그대로다. `rename(new File(...))` 도 문자열과 같이 동작한다. `rename(123 as any)` 는 false.
- `test/unit/util/logger/LoggerConfig.test.ts`
  - `LoggerConfig.create('/tmp/x').defaultWriteConfig` 가 `{console: true, default: true, file: false, name: '', level: 'debug', path: path.join(<src/util/logger 디렉터리 절대경로>, 'log'), history: undefined, pattern: undefined}` 와 같다(`create` 는 `_defaultPath` 만 바꾸고 `_defaultWriteConfig.path` 는 필드 초기값 `Path.join(__dirname, 'log')` 그대로다, `:19-28`·`:62-66`. 테스트에서는 `path.join(path.resolve(__dirname, '../../../src/util/logger'), 'log')` 로 계산한다).
  - `appendWriteConfig({name: 'a', console: false})` 뒤 `writeConfig('a')` 가 `path` `/tmp/x`, `history` 30, `file` true, `level` `info`, `pattern` `%d{yyyy-MM-dd hh:mm:ss.SSS} [%p] %c - %m%n`, `default` true 이다. 이어 `appendWriteConfig({name: 'b', console: true})` 하면 `writeConfig('b').default` 가 false 다.
  - `appendWriteConfig({name: 'c', console: true, default: true})` 하면 `c` 만 true 이고 `a`·`b` 는 false 다.
  - `writeConfigs` 길이 3, 각 항목이 `writeConfig(name)` 과 값이 같지만 다른 객체다(`not.toBe`).
  - `removeWriteConfig('b')` true, 두 번째 false, `writeConfig('b')` undefined.
  - `clone()` 뒤 원본의 `writeConfig('a').history = 99` 로 바꿔도 복제본의 `writeConfig('a').history` 가 30 이고, 복제본의 `defaultWriteConfig` 가 원본과 값이 같다.
  - `logFileDir = '/tmp/y'` 뒤 `defaultWriteConfig.path` 가 `/tmp/y`, 이미 추가된 `a` 의 `path` 는 `/tmp/x` 그대로, 이후 `appendWriteConfig({name: 'd', console: true})` 의 `path` 는 `/tmp/y` 다.
- `test/unit/util/UsablePortChecker.test.ts`
  - `check(0)`, `check(-1)`, `check(65536)` 이 `port is invalid (0 ~ 65535)` 로 reject 한다.
  - `net.createServer().listen(0, '127.0.0.1')` 로 얻은 포트 `p` 가 열려 있는 동안 `check(p)` false, `checkPorts([p])` `[]`, `findUsablePort(p, p)` -1, `findUsablePorts(p, p)` `[]`, `findUsedPorts(p, p)` `[p]`.
  - 서버를 닫은 뒤 `check(p)` true, `checkPorts([p])` `[p]`, `findUsablePort(p, p)` p, `findUsablePorts(p, p, 1)` `[p]`, `findUsedPorts(p, p)` `[]`.
  - `findUsablePorts(p, p + 1, 1)` 의 길이가 1 이다(count 에서 멈춘다).

커버리지: 모듈마다 `npx jest --coverage --coverageThreshold='{"global":{}}' --collectCoverageFrom="src/util/<모듈>.ts" test/unit/util/<모듈>.test.ts` 를 실행한 뒤(`--coverageThreshold` 를 비우지 않으면 전역 기준선이 파일 하나에 적용되어 exit 1 이 난다) `coverage/coverage-summary.json` 에서 그 파일의 `lines.pct` 가 90 이상이다(`LoggerConfig` 는 `src/util/logger/LoggerConfig.ts`). 8개 결과를 이슈 완료 코멘트에 표로 적는다.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/util
# 아래 for 루프는 bash 전용이다(Windows 는 Git Bash 에서 실행). --coverageThreshold='{"global":{}}' 는 전역 기준선이 파일 하나에 적용되어 exit 1 이 나는 것을 막는다.
for m in Optional Dequeue ExMath PubSub ConstructorConsumerHandler File UsablePortChecker; do npx jest --coverage --coverageThreshold='{"global":{}}' --collectCoverageFrom="src/util/$m.ts" test/unit/util/$m.test.ts && node -e "const s=require('./coverage/coverage-summary.json');const k=Object.keys(s).find(k=>/src[\\\\/]util[\\\\/]$m\.ts$/.test(k));console.log('$m',s[k].lines.pct);if(s[k].lines.pct<90)process.exit(1)"; done
npx jest --coverage --coverageThreshold='{"global":{}}' --collectCoverageFrom="src/util/logger/LoggerConfig.ts" test/unit/util/logger/LoggerConfig.test.ts && node -e "const s=require('./coverage/coverage-summary.json');const k=Object.keys(s).find(k=>/LoggerConfig\.ts$/.test(k));console.log('LoggerConfig',s[k].lines.pct);if(s[k].lines.pct<90)process.exit(1)"
npm run build && npm run test:browser:install && npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: 없음(U0-01·U0-05 와 병렬 가능).
- 후행: U0-07(커버리지 기준선 상향).

## 근거 문서

- `docs/design/2026-09-11-unit0-verification-foundation.md` §2(현재 상태), §4 표(Optional ~ UsablePortChecker 행), §6 U0-04
- `docs/design/2026-09-11-program-overview.md` §3.1, §3.3
- `docs/guide/test-evidence-policy.md`(순수 알고리즘 테스트·실제 소켓 규칙)

---

## U0-05

**title**: test(component): 프로세스 수명주기·조립 루트 모듈 테스트 추가
**labels**: test, area:test-ci, unit:0
**body**:
## 목적

`SysMonitor`, `AppCompositionRoot`, `ServerApp`, `Sentinel`, `app.ts` 의 현재 동작을 고정한다. 이 이슈가 끝나면 5개 테스트 파일이 통과하고 `Sentinel.ts`·`app.ts` 의 라인 커버리지가 70% 이상이 된다. `ServerApp.ts` 는 프로세스 경계에서 검증한다(아래 배경의 이유로 커버리지 수치 목표에서 제외).

## 배경

- `src/commons/SysMonitor.ts` (`export {SysMonitor, SysInfo}`): `instance` 싱글턴(`:73-78`). `usage()`(`:114-156`)는 `_lastUsageReadTime` 으로부터 500ms 안이면 같은 객체를 돌려준다(`:115-117`). 필드 `{memory: {free, total, process}, cpu: {total, process}, uptime, heap: {used, total}, totalBuffer: {used, total}}`. `sysInfo()`(`:159-206`)는 첫 호출 결과를 캐시한다(`:160-162`). 필드 `{osInfo: {platform, release, type, hostname}, ram, cpuInfo: {model, speed, cores}, network}`. `pidusage` 실패는 삼킨다(`:124-133`).
- `src/bootstrap/AppCompositionRoot.ts`: `configureLogger()`(`:8-16`) 가 `LoggerFactory.cloneConfig()` 에 `logFileDir = Environment.path.logDir` 와 `server(history 2)/client/boot/socket` 네 write config 를 추가해 `LoggerFactory.updateConfig`. `useServerCacheDir/useClientCacheDir`(`:17-22`) 가 `SocketHandler.fileCacheDirPath` 를 `Environment.path.serverCacheDir/clientCacheDir` 로. `applyGlobalMemLimitMiB(limit = 128)`(`:23-25`) 가 `SocketHandler.GlobalMemCacheLimit = limit * 1024 * 1024`. `serverStores()`(`:26-31`) 가 `{serverOptionStore: ServerOptionStore.instance, certStore: CertificationStore.instance}`. `LoggerFactory.cloneConfig()`(`src/util/logger/LoggerFactory.ts:16`)·`updateConfig`(`:27`)는 public. `LoggerConfig.create(path)` 도 public(`src/util/logger/LoggerConfig.ts:62`).
- `src/server/ServerApp.ts`: `ServerApp.start(options?)`(`:65-102`). `-adminPort` 검증 실패 시 `console.error('Invalid admin port number (1 ~ 65535)')` 후 `process.exit(1)`(`:38-43`). `-reset` 이면 `config/` 전체 삭제 후 `serverOptionStore.reset()`·`certStore.reset()`(`:70-74`; `reset()` 은 `src/server/ServerOptionStore.ts:285-294` 에서 기본 옵션 `key: 'srv-<토큰>'`, `adminPort: 9300`, `adminTls: true` 를 새로 쓴다, `:527-540`). 관리자 정책 위반이면 `console.error(message)` 후 `process.exit(1)`(`:84-90`; 메시지에 `admin TLS is disabled` 포함, `src/server/AdminSecurityPolicy.ts:86`). 모듈 변수 `adminServer`·`tttServer`(`:23-24`)는 export 되지 않고 종료 API 가 없다. 그래서 같은 프로세스 안에서 `start()` 를 부르면 서버를 닫을 수 없고 `process.exit` 경로가 Jest 를 죽인다 — 프로세스 경계 테스트만 가능하고 Jest 커버리지에 잡히지 않는다. 설계 문서의 "`ServerApp.ts` 라인 ≥ 70%" 는 이 이유로 적용하지 않는다(소스 무수정 원칙).
- `src/app.ts`: import 시점에 `AppCompositionRoot.configureLogger()`(`:8`) 와 `app()`(`:77`) 이 실행된다. `-daemon` 없이 모드가 없으면 `Usage: TTTGate [server|client] [options]` 를 `console.log`(`:39-72`). `stop` 이면 `Stop TTTGate processes ...` 출력 후 `Sentinel.stop()`(`:18-22`). `server`/`client` 는 `ServerApp.start`/`ClientApp.start`(`:27-38`). 첫 줄 `TTTGate v<version> (<build>)`(`:13`). SIGTERM 핸들러는 소스 어디에도 없다(`grep process.on` 결과 없음) — 시그널로 끝나면 `exitCode` 는 `null`, `signalCode` 는 `SIGTERM` 이다.
- `src/Sentinel.ts`: `create(devMode)`(`:33-46`): `devMode` false 면 `_executePath = process.argv[0]`, `_argvList = process.argv.slice(1)`(`:58-62`), `_argv = process.argv`. `start()`(`:72-88`): `_argv` 에 `-daemon` 이 없으면 `bin/.pid_foreground` 에 자기 PID 를 추가 기록(`flag: 'a'`, `:201-204`)하고 false. 있으면 `EXECUTE_MODE` 미설정 → `boot()`(`:130-155`: 기존 PID 파일 정리 후 `startAllProcess`), `'sentinel'` → `runSentinel()`(`:206-208`, 3초 `setInterval` 로 `find-process` 조회 — 인프로세스에서 부르면 타이머가 남으므로 이 이슈는 부르지 않는다. 기존 `test/component/sentinel-exit.test.ts` 가 프로세스 경계에서 검증한다), `'execute'` → `runApp()` 후 false. `startAllProcess`(`:165-175`) → `exec('execute', 0, …)` → `spawn(_executePath, _argvList, {detached: true, env: {EXECUTE_MODE, APP_PID}, stdio: 'ignore'})` + `unref()`(`:247-274`), `spawn` 이벤트에서 `bin/.pid_app` 기록, 그 PID 로 `exec('sentinel', appPid, …)` → `bin/.pid_sentinel`. `stop()`(`:121-125`) → `processKill('app'|'sentinel'|'foreground')`(`:98-119`): PID 파일의 각 PID 에 `process.kill(pid)`(자기 PID 는 건너뜀, 예외는 삼킴), 파일 삭제, 자기 PID 가 있었으면 그것만 다시 기록. `readPIDFile`(`:179-199`) 은 줄 단위 정수, `isDaemonMode/hasExecuteMode/isSentinelMode`(`:20-30`)는 `process.argv`·`process.env.EXECUTE_MODE`. PID 파일 경로는 `Environment.path.binDir`(`src/Environment.ts:20`, 테스트에서는 `<root>/bin`. `test/helpers/runtime.ts:24-43` `createTestRoot` 는 `bin/` 을 만들지 않으므로 테스트가 만든다).
- 설계 문서의 "PID 파일에 1 을 적어도 PID 1 에 시그널을 보내지 않음" 은 소스에 그런 보호가 없다(`:104-110` 은 자기 PID 만 건너뛴다). 그 케이스를 지금 실행하면 root 컨테이너에서는 실제로 PID 1 에 SIGTERM 이 간다. 이 이슈는 그 케이스를 쓰지 않고 결함 후보로 이슈 코멘트에 남긴다.
- 프로세스 기동 헬퍼: `test/helpers/smokeProcess.ts` `spawnProcess`, `getFreePort`, `waitUntil`. HTTPS 요청 선례: `scripts/smoke.mjs:131-159`.
- 테스트 루트: `test/helpers/runtime.ts` `createTestRoot`, `applyTestRoot`(`Environment.configure({rootDir})` + 레지스트리 리셋), `cleanupTestRoot`.

먼저 열어 볼 파일: 위 5개 소스 전문, `test/component/sentinel-exit.test.ts`, `test/component/sentinel-exit-driver.cjs`, `test/helpers/runtime.ts`, `test/helpers/smokeProcess.ts`, `test/unit/util/log-retention.test.ts:14-29`(스트림 종료 대기 방식).

## 적용되는 결정

- 프로그램 개요 §3.1(범위 밖 리팩터링 금지, 소스 무수정), §3.3(실제 프로세스·파일).
- `docs/guide/test-evidence-policy.md`: 프로세스 종료는 현재 작업이 만든 PID 에만.

## 만들 것

### `test/unit/commons/SysMonitor.test.ts`

`SysMonitor.instance` 로 실측. 500ms 캐시는 실제 시간을 기다린다.

### `test/unit/bootstrap/AppCompositionRoot.test.ts`

`beforeAll`: `createTestRoot('composition')` → `applyTestRoot(root.rootDir)`. `afterAll`: `LoggerFactory.updateConfig(LoggerConfig.create(root.rootDir))` 로 `configureLogger` 가 연 파일 writer 를 끝낸 뒤(`updateConfig` 가 기존 writer 의 `end()` 를 부른다, `LoggerFactory.ts:20-29`) `cleanupTestRoot(root)`. Windows 에서 `EBUSY` 가 나면 `log-retention.test.ts` 처럼 스트림 `close` 를 기다린다.

### `test/component/server/ServerApp.test.ts`

프로세스 경계 테스트. 각 케이스마다 임시 루트(`config/`, `bin/`, `logs/`)를 만들고 `config/server.yaml` 을 `YAML.stringify` 로 쓴다(기본: `key: 'server-app-test'`, `adminPort: <p1>`, `adminBindHost: '127.0.0.1'`, `adminTls: true`, `port: <ctrl>`, `tls: false`, `controlProtocolMode: 'mixed'`, `allowLegacyControlAuth: false`, `trustedClients: []`, `tunnelingOptions: []`, `keepAlive: 0`, `globalMemCacheLimit: 128`). `spawnProcess(process.execPath, [APP_JS, 'server', ...args], {cwd: root})`. 준비 판정은 `https://127.0.0.1:<port>/api/version` 200(`rejectUnauthorized: false`, 20초). 종료는 `kill('SIGTERM')` → `waitForExit(5000)` → 남으면 `SIGKILL`. `afterEach` 에서 반드시 종료·삭제. `jest.setTimeout(60_000)`.

### `test/component/Sentinel.test.ts`

인프로세스 + 실제 자식 프로세스. `beforeEach`: `createTestRoot('sentinel')`, `fs.mkdirSync(path.join(rootDir, 'bin'))`, `applyTestRoot(rootDir)`, `process.argv`·`process.env.EXECUTE_MODE`·`process.env.SENTINEL_TEST_JOURNAL` 저장. `Sentinel.exec` 는 `detached: true` 로 spawn 하고 `windowsHide` 를 주지 않으므로(`:253-263`) Windows 개발 PC 에서는 자식 콘솔 창이 잠깐 뜰 수 있다. 소스 동작이므로 테스트에서 막지 않는다(CI 는 `ubuntu-latest`). `afterEach`: PID 파일에 적힌 자식이 살아 있으면 `process.kill(pid, 'SIGTERM')` 후 `process.kill(pid, 0)` 이 던질 때까지 5초 대기, 환경 복원, `cleanupTestRoot`.

### `test/component/sentinel-daemon-child.cjs` (신규 픽스처)

```js
// Sentinel.exec 가 실제로 띄우는 자식. 자기 정보를 저널에 남기고 SIGTERM 까지 대기한다.
const fs = require("node:fs");
fs.appendFileSync(process.env.SENTINEL_TEST_JOURNAL, JSON.stringify({pid: process.pid,
    mode: process.env.EXECUTE_MODE, appPid: process.env.APP_PID, argv: process.argv.slice(2)}) + "\n");
setInterval(() => {}, 1000);
```

### `test/component/app-entrypoint.test.ts`

두 부분. (1) 인프로세스: `jest.isolateModules(() => { … })` 를 `process.argv` 를 바꿔 두 번(모드 없음, `stop`). 격리 레지스트리는 모듈을 새로 만들므로 바깥의 `applyTestRoot` 가 영향을 주지 않는다. 콜백 안에서 순서대로 (a) `require('../../src/Environment').default.configure({rootDir})` — `src/app` 을 require 하기 전에 해야 `configureLogger` 가 `<rootDir>/logs` 에 쓴다(안 하면 저장소 `logs/` 에 산출물이 남는다), (b) `const LoggerFactory = require('../../src/util/logger/LoggerFactory').default`, `const {LoggerConfig} = require('../../src/util/logger/LoggerConfig')`, (c) `jest.spyOn(console, 'log').mockImplementation(() => {})`, (d) `require('../../src/app')`, (e) 단언 뒤 `LoggerFactory.updateConfig(LoggerConfig.create(rootDir))` 로 writer 를 끝내고 spy 복원. `rootDir` 은 `createTestRoot('app-entry')` 에 `bin/` 을 더한 것. (2) 프로세스 경계: `spawnProcess(process.execPath, [APP_JS, ...])` 세 케이스. `jest.setTimeout(60_000)`.

## 변경할 것

없음(`src/` 무수정).

## 하지 말 것

- `Sentinel.runSentinel()`·`ServerApp.start()`·`ClientApp.start()` 를 Jest 프로세스 안에서 호출하지 않는다(타이머·서버가 남는다).
- 이름으로 프로세스를 죽이지 않는다(`taskkill /IM`, `pkill node` 금지). PID 파일에 적힌, 이 테스트가 만든 PID 만 종료한다.
- PID 1 케이스를 쓰지 않는다(배경 참조).
- `ServerApp.ts` 커버리지를 올리려고 소스에 종료 API 를 추가하지 않는다(별도 이슈 제안으로 코멘트).

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/unit/commons/SysMonitor.test.ts`
  - `SysMonitor.instance === SysMonitor.instance` 이다.
  - `await usage()` 의 `cpu.total` 과 `cpu.process` 가 0 이상 100 이하, `memory.total > 0`, `memory.free >= 0`, `memory.process > 0`, `heap.used <= heap.total`, `totalBuffer.used >= 0`, `uptime >= 0` 이다.
  - 연속 두 번 `usage()` 는 같은 객체(`toBe`)이고, 600ms 뒤 호출은 다른 객체이며 `uptime` 이 이전보다 크다.
  - `await sysInfo()` 의 `cpuInfo.cores >= 1`, `cpuInfo.model` 문자열, `ram > 0`, `osInfo.platform === os.platform()`, `osInfo.hostname === os.hostname()`, `network` 가 객체이고 `Object.keys(os.networkInterfaces())` 와 키가 같다. 두 번째 `sysInfo()` 는 같은 객체다.
- `test/unit/bootstrap/AppCompositionRoot.test.ts`
  - `configureLogger()` 뒤 `LoggerFactory.cloneConfig()` 의 `writeConfig('server')` 가 `history` 2, `console` true, `path` `Environment.path.logDir` 이고, `writeConfig('client')`·`writeConfig('boot')`·`writeConfig('socket')` 이 존재하며 `defaultWriteConfig.path` 가 `Environment.path.logDir` 이다.
  - `useServerCacheDir()` 뒤 `SocketHandler.fileCacheDirPath === Environment.path.serverCacheDir`, `useClientCacheDir()` 뒤 `=== Environment.path.clientCacheDir`.
  - `applyGlobalMemLimitMiB(4)` 뒤 `SocketHandler.GlobalMemCacheLimit === 4194304`, 인자 없이 부르면 `134217728`.
  - `serverStores()` 가 `ServerOptionStore.instance`·`CertificationStore.instance` 와 같은 객체이고 두 번 불러도 같다.
- `test/component/server/ServerApp.test.ts`
  - `server -adminPort <p2>` 로 띄우면 `https://127.0.0.1:<p2>/api/version` 이 200 이고 JSON 에 `name` 과 `build` 가 있으며, `<p1>` 로의 `net.connect` 는 `ECONNREFUSED` 다(CLI 가 yaml 값을 덮어쓴다).
  - 기동 전 `config/decoy.txt` 를 함께 써 두고 `server -reset true -adminPort <p3>` 로 띄우면 `/api/version` 이 `<p3>` 에서 200 이고, 기동 후 `config/decoy.txt` 가 없으며 `config/server.yaml` 과 `config/.server.state.json` 이 존재하고 `server.yaml` 의 `key` 가 `server-app-test` 가 아니라 `srv-` 로 시작한다(`ServerApp.ts:71-73` 이 `config/` 를 지우고 `ServerOptionStore.reset()` 이 기본 두 파일을 다시 만든다. 그 뒤 `SessionStore` 생성자(`SessionStore.ts:38-40`)가 `.key` 가 없어 `config/.bootstrap-token` 을 추가로 만들므로 "두 파일만 있다"고 단언하지 않는다). 기본값의 컨트롤 포트는 9126 고정(`ServerOptionStore.ts:531`)이라 이 케이스는 시작 전에 `net.createServer().listen(9126, '127.0.0.1')` 로 비어 있음을 확인하고 즉시 닫으며, 점유돼 있으면 `Error('Port 9126 is busy; free it before running ServerApp.test.ts')` 로 실패한다(skip 하지 않는다).
  - 정상 기동 뒤 SIGTERM 을 보내면 5초 안에 `exit` 이벤트가 오고 `child.exitCode === 0 || child.signalCode === 'SIGTERM'` 이며(소스에 시그널 핸들러가 없어 Linux 는 시그널 종료, Windows 의 `kill()` 도 `signalCode 'SIGTERM'` 으로 끝난다. 핸들러를 추가하지 않는다), 그 뒤 관리자 포트 `net.connect` 가 `ECONNREFUSED` 다.
  - `server -adminPort 70000` 이면 종료 코드 1 이고 stderr 에 `Invalid admin port number (1 ~ 65535)` 가 있다.
  - `adminTls: false` 인 yaml 로 `server` 를 띄우면 종료 코드 1 이고 stderr 에 `admin TLS is disabled` 가 있다.
- `test/component/Sentinel.test.ts`
  - `process.argv = [process.execPath, 'app.js', 'server']` 에서 `Sentinel.create(false).start()` 가 false 이고 `bin/.pid_foreground` 내용이 `${process.pid}\n` 이다. 한 번 더 부르면 내용이 두 줄(같은 PID) 이다(추가 기록).
  - `isDaemonMode()` 는 argv 에 `-daemon` 이 있을 때만 true, `hasExecuteMode()` 는 `EXECUTE_MODE` 가 정의됐을 때만 true, `isSentinelMode()` 는 `EXECUTE_MODE === 'sentinel'` 일 때만 true 다.
  - `process.env.EXECUTE_MODE = 'execute'`, argv 에 `-daemon` 이 있으면 `start()` 가 false 이고 `bin/` 에 PID 파일이 생기지 않는다.
  - `spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio: 'ignore'})` 로 만든 자식 PID 만 `bin/.pid_app` 에 한 줄로 쓰고 `Sentinel.stop()` 을 부르면 5초 안에 자식의 `exit` 이벤트가 오고(`process.kill` 을 스텁하지 않는다), 호출 뒤 `bin/.pid_app`·`bin/.pid_sentinel`·`bin/.pid_foreground` 가 모두 없으며 Jest 프로세스는 살아 있다. 파일에 `process.pid` 나 다른 PID(특히 1)를 적지 않는다.
  - `process.env.SENTINEL_TEST_JOURNAL = <root>/journal.jsonl`, `process.argv = [process.execPath, <sentinel-daemon-child.cjs 절대경로>, 'server', '-daemon']`, `EXECUTE_MODE` 미설정에서 `Sentinel.create(false).start()` 가 true 이고, 5초 안에 저널에 두 줄이 생기며 첫 줄은 `mode: 'execute'`, `appPid: '0'`, `argv: ['server', '-daemon']`, 둘째 줄은 `mode: 'sentinel'`, `appPid` 가 첫 줄 `pid` 의 문자열이다. `bin/.pid_app` 이 첫 줄 `pid`, `bin/.pid_sentinel` 이 둘째 줄 `pid` 를 담는다. 이어 `Sentinel.stop()` 을 부르면 두 PID 모두 5초 안에 `process.kill(pid, 0)` 이 던진다(종료됨).
- `test/component/app-entrypoint.test.ts`
  - (인프로세스) `process.argv = [process.execPath, 'app.js']` 로 `src/app` 을 격리 require 하면 `console.log` 호출 중 `TTTGate v` 로 시작하는 줄과 `Usage: TTTGate [server|client] [options]` 가 있고 `    stop: stop server or client` 로 끝난다.
  - (인프로세스) `process.argv = [process.execPath, 'app.js', 'stop']` 이면 `Stop TTTGate processes ...` 가 출력되고 `Usage:` 는 출력되지 않으며 예외가 없다.
  - (프로세스) `build/src/app.js` 를 인자 없이 실행하면 stdout 에 `Usage: TTTGate [server|client] [options]` 가 있고 10초 안에 종료 코드 0 으로 끝난다.
  - (프로세스) 임시 루트에 `adminTls: true` yaml 을 쓰고 `server` 로 실행하면 `/api/version` 이 200 이고, SIGTERM 뒤 5초 안에 `exit` 이벤트가 오며 `child.exitCode === 0 || child.signalCode === 'SIGTERM'` 이다.
  - (프로세스) `client -addr 127.0.0.1:<빈 포트> -name e2e-orphan` 으로 실행하면 3초 뒤에도 `exitCode === null` 이고 stdout 에 `Try reconnect after 5000ms` 가 있으며, 이후 종료 시그널로 끝난다.

커버리지: `npm run test:coverage -- --runInBand test/component/Sentinel.test.ts test/component/app-entrypoint.test.ts` 뒤 `coverage/coverage-summary.json` 의 `src/Sentinel.ts`·`src/app.ts` `lines.pct` 가 70 이상이다.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/commons/SysMonitor.test.ts test/unit/bootstrap/AppCompositionRoot.test.ts test/component/server/ServerApp.test.ts test/component/Sentinel.test.ts test/component/app-entrypoint.test.ts
npx jest --coverage --coverageThreshold='{"global":{}}' --collectCoverageFrom="src/Sentinel.ts" --collectCoverageFrom="src/app.ts" test/component/Sentinel.test.ts test/component/app-entrypoint.test.ts && node -e "const s=require('./coverage/coverage-summary.json');for(const f of ['Sentinel.ts','app.ts']){const k=Object.keys(s).find(k=>/src[\\\\/]/.test(k)&&k.endsWith(f));console.log(f,s[k].lines.pct);if(s[k].lines.pct<70)process.exit(1)}"
npm run test:browser:install
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: 없음(U0-01·U0-04 와 병렬 가능).
- 후행: U0-07.

## 근거 문서

- `docs/design/2026-09-11-unit0-verification-foundation.md` §2, §4 표(SysMonitor, AppCompositionRoot, ServerApp, Sentinel, app.ts 행), §6 U0-05
- `docs/design/2026-09-11-program-overview.md` §3.1, §3.3
- `docs/guide/test-evidence-policy.md`(프로세스 종료 규칙)

---

## U0-06

**title**: test(ci): 테스트 계층별 npm 스크립트와 CI 잡 분리
**labels**: test, area:test-ci, unit:0
**body**:
## 목적

테스트를 계층(unit / component / admin / e2e / browser / stress)별로 실행하는 npm 스크립트를 두고, CI 를 빠른 잡과 브라우저 잡 둘로 나눠 둘 다 PR 게이트로 삼는다. 계층·하네스 선택 기준을 정책 문서에 적고, CI 밖 수동 확인 절차를 만든다. 이 이슈가 끝나면 `npm run test:unit` 등 7개 스크립트가 동작하고 `code-regression.yml` 에 `fast`·`browser-e2e` 두 잡이 있다.

## 배경

- `package.json:20-34` 현재 스크립트: `test`(`jest --detectOpenHandles`), `test:admin`(`jest --runInBand test/admin`), `test:browser:install`, `test:coverage`, `lint`, `smoke`, `build`, `pkg`, `dist`, `start`, `server`, `client`, `test:timing`.
- `.github/workflows/code-regression.yml`: 잡 하나 `test`(`name: Build and full test suite`, `ubuntu-latest`, `timeout-minutes: 20`, `env: NODE_ENV: development`), 단계 `checkout@v4` → `setup-node@v4`(node 24, cache npm) → `npm ci --no-audit --no-fund` → `npm ci --prefix admin --no-audit --no-fund` → `npx playwright install --with-deps chromium` → `npm run build` → `npm test -- --runInBand`. `on: pull_request: {}`, `push: branches: [main]`, `workflow_dispatch: {}`, `permissions: contents: read`.
- `test/ci/code-regression-workflow.test.ts` 가 위 잡 이름 `test` 와 명령 목록을 그대로 단언한다(`:15-31`). `test/ci/natural-test-exit.test.ts:8-13` 은 `test`·`test:coverage` 스크립트 문자열을 고정한다(이 둘은 바꾸지 않는다). `test/unit/tools/deploy-gates.test.ts:98` 은 `test:browser:install` 을 고정한다. `test/ci/node24-runtime.test.ts:34` 는 `.github/workflows` 디렉터리를 읽는다.
- 테스트 디렉터리(`ls test`): `admin`, `ci`, `commons`, `component`, `e2e`(`tunnel/`, `target/`, `browser/`, `req-09-pool-swap-zombie.test.ts`), `fixtures`, `helpers`, `security`, `stress`, `supply-chain`, `unit`, `util`.
- `test/util`(`r2-req-*.test.ts` 3개)은 `test/unit/util` 과 다른 디렉터리이고 서로 겹치지 않는다. `test:unit` 은 둘 다 포함한다.
- `test/component/admin-browser-startup.test.ts` 는 `test/helpers/adminBrowser.ts` 로 Vite(admin 의존성)와 Chromium 을 띄운다. `test/component` 를 브라우저 없는 `fast` 잡에서 돌리려면 이 파일이 `test/admin` 으로 가야 한다. 그 외 `test/unit`·`test/component`·`test/security`·`test/supply-chain`·`test/ci`·`test/commons`·`test/util` 에는 Playwright·admin 의존성이 없다(`grep adminBrowser|playwright` 결과: `deploy-gates.test.ts` 는 문자열만 확인).
- 정책 문서 `docs/guide/test-evidence-policy.md`(영문, 31줄). `docs/guide/` 의 다른 문서(`certificate-filenames.md`, `compound-tls-save.md`)도 영문이다.
- `actionlint` 는 저장소에 없고 쓰지 않는다. 워크플로우 유효성은 YAML 파싱 테스트(`test/ci/code-regression-workflow.test.ts`)와 PR 에서 실제로 도는 CI 로 확인한다.
- `test/helpers/SupplyChainGate.ts:11`: `SUPPLY_CHAIN_ONLINE === "1"` 일 때만 온라인 공급망 테스트가 실행되고 아니면 skip 된다. `fast` 잡은 이 변수를 설정하지 않는다.

먼저 열어 볼 파일: `package.json`, `.github/workflows/code-regression.yml`, `test/ci/code-regression-workflow.test.ts`, `test/ci/natural-test-exit.test.ts`, `docs/guide/test-evidence-policy.md`, `test/component/admin-browser-startup.test.ts`.

## 적용되는 결정

- D13(외부 사이트·실제 프레임워크 앱 확인은 CI 밖 수동 절차).
- 프로그램 개요 §3.1(브라우저 테스트 전 `test:browser:install`), §3.3.

## 만들 것

### `package.json` scripts (기존 항목은 유지, 아래를 추가·정렬)

```json
"test":             "jest --detectOpenHandles",
"test:unit":        "jest --detectOpenHandles test/unit test/commons test/util",
"test:component":   "jest --detectOpenHandles --runInBand test/component test/security test/supply-chain test/ci",
"test:admin":       "jest --runInBand test/admin",
"test:e2e":         "jest --runInBand test/e2e/tunnel test/e2e/target test/e2e/req-09-pool-swap-zombie.test.ts",
"test:e2e:browser": "jest --runInBand test/e2e/browser",
"test:stress":      "jest --runInBand test/stress",
"test:coverage":    "jest --detectOpenHandles --coverage"
```

### `.github/workflows/code-regression.yml` (전면 교체)

```yaml
name: Code Regression

on:
  pull_request: {}
  push:
    branches: [main]
  workflow_dispatch: {}

permissions:
  contents: read

jobs:
  fast:
    name: Build, lint, unit and component tests
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      NODE_ENV: development
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - name: Install locked dependencies
        run: npm ci --no-audit --no-fund
      - name: Build
        run: npm run build
      - name: Lint
        run: npm run lint
      - name: Unit tests
        run: npm run test:unit
      - name: Component tests
        run: npm run test:component
  browser-e2e:
    name: Admin, tunnel and browser end-to-end tests
    runs-on: ubuntu-latest
    timeout-minutes: 45
    env:
      NODE_ENV: development
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - name: Install locked dependencies
        run: npm ci --no-audit --no-fund
      - name: Install admin dependencies
        run: npm ci --prefix admin --no-audit --no-fund
      - name: Install test browser
        run: npx playwright install --with-deps chromium
      - name: Build
        run: npm run build
      - name: Admin tests
        run: npm run test:admin
      - name: Tunnel end-to-end tests
        run: npm run test:e2e
      - name: Browser end-to-end tests
        run: npm run test:e2e:browser
```

`if`, `continue-on-error`, `working-directory`, `needs` 를 어느 잡·단계에도 두지 않는다(두 잡은 독립 병렬). `SUPPLY_CHAIN_ONLINE` 을 비롯해 `NODE_ENV` 외의 환경변수를 두지 않는다.

### `docs/guide/test-evidence-policy.md` 에 절 추가 (영문, 파일 끝에)

제목 `## Test layers and harness selection`. 내용:

1. 표 `| Layer | Directories | Script | CI job |`: unit / `test/unit test/commons test/util` / `npm run test:unit` / `fast`; component / `test/component test/security test/supply-chain test/ci` / `npm run test:component` / `fast`; admin / `test/admin` / `npm run test:admin` / `browser-e2e`; e2e (in-process) / `test/e2e/tunnel test/e2e/target test/e2e/req-09-pool-swap-zombie.test.ts` / `npm run test:e2e` / `browser-e2e`; browser e2e / `test/e2e/browser` / `npm run test:e2e:browser` / `browser-e2e`; stress / `test/stress` / `npm run test:stress` / not in CI.
2. 문장: `npm run build` must precede `test:component`, `test:e2e` and `test:e2e:browser`; the process harness fails with `Run npm run build first` otherwise.
3. Harness selection: `test/helpers/tunnelHarness.ts` (`createTunnelHarness`) when the claim is about `TTTServer`/`TTTClient` behaviour inside one process and the test needs direct object access (`getServer()`); `test/helpers/processTunnelHarness.ts` (`createProcessTunnelHarness`) when the claim crosses the process boundary (CLI arguments, `config/*.yaml`, PID files, signals, restart, browser access).
4. U0-01 의 대상 서비스 경로 표(경로 · 응답 · 겨냥하는 기능)를 영문으로 옮긴다.
5. Browser test rules: launch `chromium` per file in `beforeAll`; default viewport (1280×720) unless the test states otherwise; collect `pageerror` into `errors` and assert `expect(errors).toEqual([])`; close browser, harness, then target in `afterAll` inside `finally`; every readiness check polls an observable (`#ready` text, admin API) and never sleeps for a fixed time except a documented idle wait.

### `docs/guide/e2e-manual-checklist.md` (신규, 영문)

제목 `# Manual end-to-end checklist`. 첫 문단: run once before every release; record the date, the TTTGate version and the tester in the table at the end. 절:

1. `## Preparation`: build (`node deploy.js`), start server with `adminTls: true` and one HTTP tunnel, start one client, open the admin page.
2. `## Framework application (dev server with HMR)`: `npx create-next-app@latest e2e-app --ts --no-eslint --no-tailwind --app --src-dir --import-alias "@/*"` → `npm run dev` (port 3000) → tunnel `destinationPort: 3000, protocol: http` → open `http://<server-host>:<forwardPort>/` in Chrome: expected — page renders, DevTools console has no red errors, editing `src/app/page.tsx` refreshes the page within 5 s (HMR WebSocket through the tunnel), DevTools Network shows the `_next/webpack-hmr` WebSocket as `101`.
3. `## Public site (no login)`: tunnel `destinationAddress: example.com, destinationPort: 80, protocol: http, httpOption: {rewriteHostInTextBody: true}` → open `http://<server-host>:<forwardPort>/`: expected — the "Example Domain" page renders, the `More information...` link points at `https://www.iana.org/...` (external links untouched).
4. `## TLS external port`: same tunnel with `tls: true` → `https://…`: expected — browser warns about the self-signed certificate, proceeding shows the page.
5. `## Results`: 표 `| Date | Version | Tester | Framework app | Public site | TLS | Notes |` 빈 행 하나.

각 절은 `Steps` 번호 목록, `Expected` 목록, `[ ]` 확인란을 가진다.

### `test/ci/code-regression-workflow.test.ts` (갱신)

```ts
const fastCommands = ["npm ci --no-audit --no-fund", "npm run build", "npm run lint", "npm run test:unit", "npm run test:component"];
const browserCommands = ["npm ci --no-audit --no-fund", "npm ci --prefix admin --no-audit --no-fund",
    "npx playwright install --with-deps chromium", "npm run build", "npm run test:admin", "npm run test:e2e", "npm run test:e2e:browser"];
```

전면 갱신. 기존 첫 테스트(`on` 검사)는 유지. 두 번째 테스트를 `test.each([["fast", fastCommands], ["browser-e2e", browserCommands]])` 로 바꾸고 잡마다 `runs-on === "ubuntu-latest"`, `env` 가 `{NODE_ENV: "development"}` 뿐임, `if`·`continue-on-error`·`working-directory` 부재, `steps[0]` `checkout`·`steps[1]` `setup-node`(node 24), `steps.filter(s => s.run).map(s => s.run)` 이 명령 목록과 순서까지 같음을 단언한다. 새 테스트 하나: `Object.keys(workflow.jobs)` 가 정확히 `["fast", "browser-e2e"]` 이고 어느 잡에도 `needs` 가 없다. `actionlint` 는 쓰지 않는다.

### `test/ci/npm-test-layers.test.ts` (신규)

`package.json` 을 읽어 위 8개 스크립트 문자열을 정확히 단언하고, 각 스크립트가 가리키는 경로(`test/unit`, `test/commons`, `test/util`, `test/component`, `test/security`, `test/supply-chain`, `test/ci`, `test/admin`, `test/e2e/tunnel`, `test/e2e/target`, `test/e2e/req-09-pool-swap-zombie.test.ts`, `test/e2e/browser`, `test/stress`)가 존재하는지 `fs.existsSync` 로 확인한다. 또 `test/**/*.test.ts` 전부(`test/helpers`·`test/fixtures` 제외)가 위 계층 경로 중 하나의 아래에 있음을 단언한다(계층 밖 테스트 파일 0개).

## 변경할 것

- `git mv test/component/admin-browser-startup.test.ts test/admin/admin-browser-startup.test.ts`. 상대 import(`../helpers/adminBrowser`, `../fixtures/admin-ready-child.cjs`)는 깊이가 같아 그대로다. 내용은 바꾸지 않는다.
- `package.json` scripts(위). `test`·`test:coverage`·`test:browser:install`·`test:admin` 문자열은 그대로.
- `.github/workflows/code-regression.yml` 전면 교체(위).
- `test/ci/code-regression-workflow.test.ts` 갱신(위).
- `docs/guide/test-evidence-policy.md` 절 추가(위). 기존 본문은 한 글자도 바꾸지 않는다.

## 하지 말 것

- `supply-chain-audit.yml`, `build-release-binaries.yml` 등 다른 워크플로우 수정 금지.
- `jest.config.ts` 의 `testMatch`·`testPathIgnorePatterns` 수정 금지(`npm test` 는 여전히 전체를 돈다). 커버리지 threshold 는 U0-07.
- 두 잡 사이에 `needs` 를 걸지 않는다. 캐시 공유·아티팩트 전달을 추가하지 않는다.
- `test:stress` 를 CI 에 넣지 않는다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/ci/code-regression-workflow.test.ts`
  - `workflow.jobs` 의 키가 `["fast", "browser-e2e"]` 이면 통과, 다르면 실패한다.
  - `fast` 잡의 `run` 명령 목록이 `fastCommands` 와 순서까지 같고, `browser-e2e` 가 `browserCommands` 와 같다.
  - 두 잡 모두 `runs-on` 이 `ubuntu-latest` 이고 `env` 키가 `NODE_ENV` 하나다(`SUPPLY_CHAIN_ONLINE` 없음).
  - 어느 잡·단계에도 `if`, `continue-on-error`, `working-directory`, `needs` 가 없다.
  - 두 잡 모두 `steps[0].uses` 가 `actions/checkout@`, `steps[1].uses` 가 `actions/setup-node@`, `node-version` `24` 다.
  - `on.pull_request` 가 `{}`, `on.push.branches` 에 `main` 이 있다(기존).
- `test/ci/npm-test-layers.test.ts`
  - 8개 스크립트 문자열이 위와 정확히 같다.
  - 스크립트가 가리키는 경로가 모두 존재한다.
  - 계층 밖 `*.test.ts` 가 0개다(`test/component/admin-browser-startup.test.ts` 가 남아 있으면 이 케이스는 통과하지만 `fast` 잡이 브라우저를 요구하므로, 별도 케이스로 `fs.existsSync('test/component/admin-browser-startup.test.ts') === false` 와 `fs.existsSync('test/admin/admin-browser-startup.test.ts') === true` 를 단언한다).
- `test/ci/natural-test-exit.test.ts`(기존): `test`·`test:coverage` 문자열이 그대로라 통과한다.
- 문서: `docs/guide/test-evidence-policy.md` 에 `## Test layers and harness selection` 절이 있고 `docs/guide/e2e-manual-checklist.md` 가 존재한다 — `test/ci/npm-test-layers.test.ts` 에 두 파일의 존재와 절 제목 문자열 포함을 단언하는 케이스를 넣는다.

각 스크립트를 실제로 실행해 모두 통과한다(아래 검증 명령).

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npm run test:unit
npm run test:component
npm run test:admin
npm run test:e2e
npm run test:e2e:browser
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U0-01, U0-02, U0-03, U0-04, U0-05(모든 계층에 파일이 있어야 스크립트가 빈 선택으로 실패하지 않는다).
- 후행: U0-07(이 이슈가 끝난 뒤 커버리지를 실측한다).

## 근거 문서

- `docs/design/2026-09-11-unit0-verification-foundation.md` §3.5(수동 확인), §5.1(스크립트), §5.2(CI), §5.3(문서), §6 U0-06
- `docs/design/2026-09-11-program-overview.md` §1 D13, §3.1, §4 완료 기준(브라우저 E2E 가 `browser-e2e` 잡에서 통과)

---

## U0-07

**title**: test(ci): 커버리지 기준선을 실측값 기준으로 상향
**labels**: test, area:test-ci, unit:0
**body**:
## 목적

U0-04·U0-05 로 올라간 실측 커버리지에서 0.5pt 를 뺀 값으로 `jest.config.ts` 의 `coverageThreshold` 를 올리고, 그 값을 고정하는 테스트를 갱신한다. 이 이슈가 끝나면 `npm run test:coverage -- --runInBand` 가 새 기준선으로 통과하고, 이후 단위(1~5)는 이 기준선을 내리지 못한다.

## 배경

- `jest.config.ts:28-35` 현재 기준선 `lines: 64.26, functions: 69.74, branches: 52.23, statements: 63.71`. `collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"]`(`:25`), `coverageReporters: ["text", "lcov", "json-summary"]`(`:27`) → `coverage/coverage-summary.json` 의 `total.{lines,statements,functions,branches}.pct`.
- `test/ci/whole-source-coverage.test.ts:28-32` 가 위 네 값을 `toEqual` 로 고정한다. 기준선을 바꾸면 이 테스트도 같이 바꿔야 한다.
- 기준 커밋 `5f772fc` 실측(`docs/plan/verification/epic61-final-verification.md:40`): 라인 78.25%, 브랜치 70.43%, 함수 81.39%(전체 `npm run test:coverage -- --runInBand`, 약 25분).
- 프로그램 개요 §3.3: 기준선은 내리지 않는다. 0번 단위가 올린 뒤 그 값을 유지한다.

먼저 열어 볼 파일: `jest.config.ts`, `test/ci/whole-source-coverage.test.ts`, `coverage/coverage-summary.json`(실행 후).

## 적용되는 결정

- 프로그램 개요 §3.3(기준선 불하향), §4 완료 기준(기준선이 U0-07 값 이상).

## 만들 것

### 실측 절차 (이슈 코멘트에 결과를 남긴다)

1. `refactor/admin` 최신(U0-06 병합 후)에서 `npm ci --include=dev && npm --prefix admin ci --include=dev && npm run test:browser:install && npm run build`.
2. `npm run test:coverage -- --runInBand` 실행(브라우저 E2E 포함 전체). 통과·실패와 무관하게 `coverage/coverage-summary.json` 이 생성된다.
3. `node -e "const t=require('./coverage/coverage-summary.json').total;for(const k of ['lines','statements','functions','branches'])console.log(k,t[k].pct,Math.floor((t[k].pct-0.5)*100)/100)"` 로 실측과 기준선 후보(실측 − 0.5, 소수 둘째 자리 내림)를 얻는다.
4. 라인 후보 < 80 또는 브랜치 후보 < 72 이면 이슈 코멘트에 실측값과 이유(어느 모듈이 낮은지 `coverage-summary.json` 상위 5개 미커버 파일)를 적고 후보 값을 그대로 쓴다.

### `jest.config.ts`

`coverageThreshold.global` 네 값을 후보로 교체. 다른 설정은 그대로.

### `test/ci/whole-source-coverage.test.ts` (갱신)

- `:28-32` 의 기대 객체를 새 값으로 교체.
- 테스트 추가 `whole-source coverage floors never drop below the issue52 baselines`: `config.coverageThreshold.global` 의 `lines >= 64.26`, `statements >= 63.71`, `functions >= 69.74`, `branches >= 52.23`.
- 테스트 추가 `whole-source coverage floors are not above the recorded measurement`: 저장소에 `docs/plan/verification/unit0-coverage-baseline.json` 을 만들어(아래) 그 파일의 `measured` 각 항목이 `config.coverageThreshold.global` 의 같은 항목 + 0.5 이상임을 단언한다(기준선이 실측보다 높게 잡히는 실수를 막는다).

### `docs/plan/verification/unit0-coverage-baseline.json` (신규)

```json
{"commit": "<실측한 커밋 해시>", "command": "npm run test:coverage -- --runInBand", "date": "<YYYY-MM-DD>",
 "measured": {"lines": 0, "statements": 0, "functions": 0, "branches": 0},
 "threshold": {"lines": 0, "statements": 0, "functions": 0, "branches": 0}}
```

`measured` 는 3 의 실측값, `threshold` 는 `jest.config.ts` 에 넣은 값과 같아야 한다(`whole-source-coverage.test.ts` 가 `threshold` 와 `config.coverageThreshold.global` 의 동일성도 단언한다).

## 변경할 것

- `jest.config.ts` `coverageThreshold.global` 네 값.
- `test/ci/whole-source-coverage.test.ts` 기대값 갱신과 테스트 두 개 추가.

## 하지 말 것

- 기준선을 어떤 항목도 내리지 않는다.
- 커버리지를 올리려고 테스트를 추가하지 않는다(그것은 U0-04·U0-05). 이 이슈는 수치 반영만 한다.
- `collectCoverageFrom` 에 제외 패턴을 추가하지 않는다(`whole-source-coverage.test.ts:34-40` 이 막는다).
- 실측을 부분 실행(`test/unit` 만 등)으로 대체하지 않는다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/ci/whole-source-coverage.test.ts`
  - `config.coverageThreshold.global` 이 `unit0-coverage-baseline.json` 의 `threshold` 와 `toEqual` 이면 통과, 다르면 실패한다.
  - 네 항목 각각이 issue52 기준선(`64.26 / 63.71 / 69.74 / 52.23`) 이상이다.
  - `baseline.measured[k] >= config.coverageThreshold.global[k] + 0.5` 가 네 항목 모두 참이다.
  - 기존 `includes every eligible production source file`·`admits future source paths` 케이스가 그대로 통과한다.
- `npm run test:coverage -- --runInBand` 가 종료 코드 0 으로 끝난다(threshold 통과).
- 라인 기준선 ≥ 80, 브랜치 기준선 ≥ 72 이거나, 아니면 이슈 코멘트에 실측값과 이유가 적혀 있다.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npx jest --runInBand test/ci/whole-source-coverage.test.ts
npm run test:coverage -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U0-06(실행 체계가 정리된 뒤 측정해야 값이 안정적이다. U0-06 은 U0-01~05 를 선행으로 두므로 모든 단위 0 테스트가 실측에 포함된다).
- 후행: 없음. 단위 1~5 모든 이슈가 이 기준선을 유지한다.

## 근거 문서

- `docs/design/2026-09-11-unit0-verification-foundation.md` §2(기준선 표), §4 마지막 문단(기준선 조정 규칙), §6 U0-07
- `docs/design/2026-09-11-program-overview.md` §3.3, §4 완료 기준
- `docs/plan/verification/epic61-final-verification.md`(기준 커밋 실측)

---
