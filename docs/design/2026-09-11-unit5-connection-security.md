# 단위 5 — 연결 보안 (접속 레이트 리밋 · 국가 필터 · 런타임 속성 집행)

| 항목 | 내용 |
|---|---|
| 상위 문서 | [프로그램 개요](./2026-09-11-program-overview.md) |
| 적용 결정 | D8 D9 D10 D11 |
| 선행 단위 | 0 (프로세스 E2E 하네스). 런타임 이슈(U5-01~04)는 0 만 있으면 시작 가능. API·화면 이슈(U5-05~06)는 2·3, 속성 집행 이슈(U5-07~09)는 2 가 끝나야 시작 |
| 대상 | `src/server/security/`(신규), `src/util/TCPServer.ts`, `src/server/ExternalPortServerPool.ts`, `src/server/admin/AdminServer.ts`, `src/types/TunnelingOption.ts`, `src/server/ServerOptionStore.ts`, `admin/src/screens/` |

## 1. 목표

1. **접속 레이트 리밋(터널별).** 원격 IP 하나가 창(window) 안에 한도보다 많이 접속하면 그 IP 를 일정 시간 해당 터널에서 차단한다. 판정은 소켓 수락 직후, `SocketHandler`·버퍼·컨트롤 터널 통보 어느 것도 일어나기 전에 끝난다. 차단 중인 IP 의 판정은 해시 조회 한 번이다.
2. **국가 필터(서버 전역).** 원격 IP 의 국가 코드로 허용 목록 또는 차단 목록을 적용한다. 모든 외부 포트와 관리자 페이지에 같은 판정을 쓴다.
3. **PRD 런타임 속성 집행.** 속성 3(`max_tunnel_duration_ms`), 6(`max_concurrent_connections`), 11(`rate_limit` 대역폭 프리셋)은 데이터 평면에서 집행되므로 이 단위가 맡는다. 속성의 저장·검증·API 는 2 단위가 한다.

## 2. 현재 상태와 삽입 지점

- 외부 포트 수락: `src/util/TCPServer.ts:83-86`(`createServer`: `net.createServer(this.onBind)` / `tls.createServer(...)`)과 `:114-123`(`onBind`). `onBind(socket)` 이 즉시 `SocketHandler.bound(...)` 로 핸들러를 만들고 `Bound` 이벤트를 올린다. → **`onBind` 첫 줄에서 판정한다.** 거절이면 `socket.destroy()` 하고 아무것도 만들지 않는다.
- `Bound` 를 받은 `ExternalPortServerPool.onServerEvent`(`src/server/ExternalPortServerPool.ts:322-383`)가 세션 ID 를 발급하고 `HttpHandler` 를 만들고 `_onNewSessionCallback` 으로 컨트롤 터널에 통보한다. 여기까지 오면 이미 비용이 든 뒤다.
- 터널 옵션 적용: `TTTServer.applyTunnelingOption`(`src/server/TTTServer.ts:333`) 이 리스너를 `stop` → `startServer(nextOption)` 으로 재생성한다. 따라서 터널별 레이트 리밋 설정은 `startServer` 가 받는 `TunnelingOption` 에 실려 오면 된다.
- 관리자 서버: `src/server/admin/AdminServer.ts:74-110`(생성자)가 `https.createServer`(`:87`) / `http.createServer`(`:91`) 를 만든다. `'connection'` 이벤트는 TLS 핸드셰이크 전 원시 소켓에서 발생하므로 → **`this._server.on('connection', socket => …)` 에서 판정한다.**
- 외부 포트 활성 타임아웃: `ExternalPortServerPool.active(port, timeout)`(`:473`) 이 `timeout` 초 뒤 `inactive` 를 예약한다. 속성 3 은 이 `timeout` 의 상한이다.
- 세션 수: `ExternalPortServerPool.updateCount`(`:394`) 가 포트별 `status.sessions` 를 증감한다. 속성 6 은 소유자 그룹 단위 합산이 필요하다.
- 바이트 흐름: 외부 → 클라이언트 방향은 `onHandlerEvent` 의 `SocketState.Receive`(`:293`), 클라이언트 → 외부 방향은 `send(id, data)`(`:223`). 속성 11 의 토큰 버킷은 이 두 지점에 건다.
- 참고 구현: `feature/firewall` 브랜치(2025-05, 병합 불가)의 `src/server/Firewall/Block.ts` 가 `geoip-lite` 로 포트별 국가·IP 차단을 구현했다. 접근 방식만 참고한다.

## 3. 설정 모델

### 3.1 서버 전역 — `ServerOption.connectionSecurity` (`config/server.yaml`)

```yaml
connectionSecurity:
  geo:
    mode: off            # off | allow | deny   (기본 off)
    countries: []        # ISO 3166-1 alpha-2 대문자. allow 면 허용 목록, deny 면 차단 목록
    applyToAdmin: true   # 관리자 페이지에도 적용 (기본 true)
    unknownPolicy: allow # allow | deny. 국가를 알 수 없는 IP(사설·루프백·DB 미수록)의 처리 (기본 allow)
```

- 필드가 없으면 위 기본값으로 해석한다(읽기 호환).
- `verificationServerOption` 에 검증 추가: `mode` 열거값, `countries` 각 항목이 `src/server/security/countries.ts` 의 `ISO_ALPHA2` 집합에 속함, `allow` 모드에서 `countries` 가 비면 거부(모든 접속을 막게 되므로 422 메시지 "allow mode requires at least one country").
- `unknownPolicy: deny` + `allow` 모드는 사설망에서 관리자 페이지 접속을 막을 수 있으므로, `applyToAdmin: true` 와 함께 저장하려 하면 경고(`warnings`)를 응답에 싣되 저장은 허용한다.

### 3.2 터널별 — `TunnelingOption.rateLimit`

```yaml
tunnelingOptions:
  - forwardPort: 20001
    protocol: tcp
    rateLimit:
      enabled: true          # 기본 true
      windowMs: 60000        # 1000..3600000
      maxConnections: 30     # 1..100000
      banMs: 600000          # 1000..86400000
      customized: false      # UI 가 사용자 편집 여부를 기록. 서버는 검증만 한다
```

- 기본값(D9): `protocol === 'tcp'` → `{windowMs: 60000, maxConnections: 30, banMs: 600000}`; `http`·`https` → `{windowMs: 60000, maxConnections: 300, banMs: 600000}`. `rateLimit` 필드가 없는 기존 옵션은 로드 시 프로토콜에 맞는 기본값으로 채운다. 지점은 `ServerOptionStore.verificationTunnelingOption(option, mode)`(`:414`, 로드 시 `'legacy-load'`, 저장 시 `'new-config'`)이며, 기존 `normalizeServerBufferLimit`(`:404`)와 같은 방식으로 정규화 함수를 두고 그 안에서 호출한다.
- `src/types/TunnelingOption.ts` 에 `RateLimitOption` 타입과 `defaultRateLimit(protocol)` 순수 함수를 둔다. UI 도 같은 규칙을 갖되 서버 응답 값을 기준으로 삼는다.

## 4. 런타임 구성요소 — `src/server/security/`

```
src/server/security/
  AdmissionPolicy.ts        타입: AdmissionScope, AdmissionDecision, AdmissionPolicy 인터페이스
  ConnectionRateLimiter.ts  포트·IP 별 창 카운터와 차단 목록
  GeoFilter.ts              geoip-lite 조회와 허용·차단 판정
  AdmissionController.ts    차단 맵 → GeoFilter → 창 카운트 → 동시 연결 순으로 묶는 단일 진입점 (싱글턴, resetForTest)
  countries.ts              ISO_ALPHA2: ReadonlySet<string>, countryName(code): string (Intl.DisplayNames)
```

### 4.1 타입

```ts
export type AdmissionScope = {kind: 'tunnel'; port: number; protocol: 'tcp' | 'http' | 'https'} | {kind: 'admin'};
export type AdmissionDecision =
    | {allowed: true}
    | {allowed: false; reason: 'geo-deny' | 'rate-limit-ban' | 'rate-limit-exceeded' | 'concurrency-limit'; retryAfterMs?: number};
export interface AdmissionPolicy { admit(scope: AdmissionScope, remoteAddress: string | undefined, now?: number): AdmissionDecision; }
```

`remoteAddress` 는 `::ffff:1.2.3.4` 형태를 IPv4 로 정규화한다(`normalizeRemoteAddress(addr)` 순수 함수, `countries.ts` 옆 `address.ts`). `undefined`(소켓이 이미 닫힘)는 허용으로 둔다.

### 4.2 `ConnectionRateLimiter`

```ts
export type RateLimitConfig = {windowMs: number; maxConnections: number; banMs: number};
export class ConnectionRateLimiter {
    configurePort(port: number, config: RateLimitConfig | undefined): void;   // undefined = 해제
    admit(port: number, ip: string, now: number): AdmissionDecision;
    bans(now: number): Array<{port: number; ip: string; bannedUntil: number; hits: number}>;
    unban(port: number, ip: string): boolean;
    prune(now: number): void;             // 만료된 차단·오래된 타임스탬프 제거
    stats(port: number): {rejectedBans: number; rejectedExceeded: number; bannedIps: number};
}
```

- 자료구조: `Map<port, {config, bans: Map<ip, {until, hits}>, windows: Map<ip, number[]>}>`. `admit` 순서: (1) `bans.get(ip)` 가 있고 `until > now` 면 `{allowed:false, reason:'rate-limit-ban', retryAfterMs}` — 해시 조회 한 번(D11). (2) 만료된 차단은 지운다. (3) `windows.get(ip)` 배열에서 `now - windowMs` 보다 오래된 앞부분을 잘라내고(`findIndex` 후 `splice`, 배열은 시간순) `now` 를 push. (4) 길이가 `maxConnections` 를 넘으면 `bans.set(ip, {until: now + banMs, hits})`, `windows.delete(ip)`, `{allowed:false, reason:'rate-limit-exceeded', retryAfterMs: banMs}`. (5) 아니면 허용.
- `prune` 은 `AdmissionController` 가 30초 간격 `setInterval(…).unref()` 로 부른다. 창 배열이 비었거나 마지막 항목이 `windowMs` 보다 오래됐으면 항목을 지운다.
- 메모리 상한: 포트당 `windows` 항목 10,000 개를 넘으면 가장 오래된 항목부터 지운다(공격자가 IP 를 바꿔 가며 항목을 늘리는 경우). 상수 `MAX_TRACKED_IPS_PER_PORT = 10_000`.
- 시각은 인자로 받는다(테스트가 시계를 주입). `Date.now` 직접 호출 금지.

### 4.3 `GeoFilter`

```ts
export type GeoConfig = {mode: 'off' | 'allow' | 'deny'; countries: string[]; applyToAdmin: boolean; unknownPolicy: 'allow' | 'deny'};
export class GeoFilter {
    configure(config: GeoConfig): void;
    lookupCountry(ip: string): string | undefined;      // geoip-lite; 사설·루프백·미수록은 undefined
    isDatabaseLoaded(): boolean;                         // 지연 로드 여부(테스트용. Jest 의 require.cache 는 실제 레지스트리가 아니라 단언에 못 쓴다)
    decide(ip: string, scope: AdmissionScope): AdmissionDecision;
    stats(): {rejected: number; lookups: number};
}
```

- 의존성 `geoip-lite@^1.4.10`, `@types/geoip-lite`. `require('geoip-lite')` 는 모듈 로드 시 데이터(약 60MB)를 메모리에 올리므로 **`mode !== 'off'` 로 처음 설정될 때 지연 로드**한다. `off` 인 서버는 메모리 비용을 내지 않는다.
- 사설 범위 판정(`10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, fc00::/7, ::1`)은 조회 전에 `address.ts` 의 `isPrivateAddress` 로 끝낸다.
- `decide`: `mode === 'off'` → 허용. `scope.kind === 'admin' && !applyToAdmin` → 허용. 국가 `undefined` → `unknownPolicy`. `allow` → 목록에 있으면 허용, 없으면 `geo-deny`. `deny` → 목록에 있으면 `geo-deny`.
- 패키징: `package.json` 의 `pkg` 블록에 `"assets": ["node_modules/geoip-lite/data/geoip-country.dat", "node_modules/geoip-lite/data/geoip-country6.dat"]` 를 추가한다(city DB 는 제외. 5개 플랫폼 바이너리 각각에 들어가므로 크기를 최소로). `geoip-lite` 는 city 파일을 먼저 찾으므로, city 파일이 없을 때 country 파일로 폴백해 `lookup().country` 가 나오는지 단위 테스트로 확인한다. `test/unit/tools/deploy-gates.test.ts` 에 `expect(require('../../../package.json').pkg.assets).toEqual(expect.arrayContaining(['node_modules/geoip-lite/data/geoip-country.dat', 'node_modules/geoip-lite/data/geoip-country6.dat']))` 단언을 추가한다(현재 이 테스트는 스테이지 순서만 검사한다). 런타임 의존성 추가는 `test/supply-chain/r3-req-04-medium-cleared.test.ts` 의 `npm audit --omit=dev --audit-level=moderate` 0건 게이트를 통과해야 한다. `deploy.js` 가 `dist.js/` 에 소스 배포본을 만들 때 `node_modules` 는 실행 환경에서 `npm ci` 로 설치되므로 추가 조치 없음.
- DB 갱신: `scripts/geoip-update.mjs` 가 `node_modules/geoip-lite/scripts/updatedb.js license_key=$MAXMIND_LICENSE_KEY` 를 실행한다. 릴리스 절차 문서(`docs/guide/release-checklist.md` 가 없으면 생성)에 "MaxMind 키가 있으면 릴리스 전 갱신, 없으면 패키지 동봉 DB 사용(수개월 오차 허용)" 을 적는다.

### 4.4 `AdmissionController`

```ts
export class AdmissionController implements AdmissionPolicy {
    static get instance(): AdmissionController; static resetForTest(): void;
    readonly geo: GeoFilter; readonly rateLimiter: ConnectionRateLimiter;
    configureGeo(config: GeoConfig): void;
    configureTunnel(option: TunnelingOption): void;   // rateLimit.enabled 면 configurePort, 아니면 해제
    configureConcurrency(provider: (port: number) => number): void;   // 포트별 현재 세션 수 공급 함수 주입(7절 속성 6)
    releaseTunnel(port: number): void;
    admit(scope, remoteAddress, now = Date.now()): AdmissionDecision;   // 순서: (1) rateLimiter 의 차단 맵 조회(O(1), D11) → (2) geo → (3) rateLimiter 의 창 카운트 → (4) 동시 연결 상한(7절)
    snapshot(): {geo: GeoConfig; ports: Record<number, ReturnType<ConnectionRateLimiter['stats']>>};
}
```

- 거절 로그는 포트·사유별로 1분에 한 줄로 묶는다(`logger.warn('admission denied port=20001 reason=rate-limit-ban count=1532 (last 60s)')`). 건마다 로그를 남기면 로그 자체가 공격 비용이 된다.
- `ExternalPortServerStatus`(`ExternalPortServerPool.getServerStatus`)에 `rejected: {geo: number; rateLimit: number}` 와 `bannedIps: number` 를 추가한다. `/api/externalServerStatuses` 가 그대로 노출한다.

### 4.5 삽입

- `TCPServer.create(options)` 의 `options` 에 `admit?: (remoteAddress: string | undefined) => AdmissionDecision & {rejectResponse?: Buffer}` 를 추가한다. `onBind` 첫 줄: `if(this._options.admit) { const d = this._options.admit(socket.remoteAddress); if(!d.allowed) { if(d.rejectResponse) socket.end(d.rejectResponse); else socket.destroy(); return; } }`. `util/` 이 `server/security` 를 import 하지 않도록 콜백으로 넘기고(의존 방향), `TCPServer` 는 프로토콜을 모른다. `rejectResponse` 는 `ExternalPortServerPool` 이 http/https 터널의 `concurrency-limit` 에만 채운다(4.5 아래).
- 그룹 합산 세션 수는 `AdmissionController.configureConcurrency(provider: (port: number) => number)` 로 `ExternalPortServerPool` 이 공급 함수를 주입한다(`security → server` 역방향 import 를 만들지 않는다).
- `ExternalPortServerPool.startServer(option)` 이 `TCPServer.create({..., admit})` 로 만들고 `configureTunnel(option)` 을 부른다. `admit` 래핑: `addr => { const d = AdmissionController.instance.admit({kind:'tunnel', port, protocol}, addr); if(!d.allowed && d.reason === 'concurrency-limit' && (protocol === 'http' || protocol === 'https')) return {...d, rejectResponse: HTTP_503}; return d; }` (`HTTP_503` 은 4.5 끝의 바이트열). `stop(port)` 에서 `releaseTunnel(port)`.
- `AdminServer` 생성자 끝에 `this._server.on('connection', socket => { if(!AdmissionController.instance.admit({kind:'admin'}, socket.remoteAddress).allowed) socket.destroy(); })`.
- `ServerApp` 기동 시 `AdmissionController.instance.configureGeo(serverOption.connectionSecurity.geo)`. `/api/serverOption` 저장 경로(`TTTServer.applyServerOption`)에서 `connectionSecurity` 가 바뀌면 `configureGeo` 를 다시 부른다(리스너 재시작 불필요).

HTTP 터널에서 `concurrency-limit` 거절만은 소켓을 바로 닫지 않고 `HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n` 을 쓴 뒤 `end()` 한다(PRD 속성 6 의 503 요구). TCP 터널은 HTTP 상태 코드를 보낼 수 없으므로 PRD 와 달리 무응답 `destroy()` 한다. 나머지 사유는 프로토콜과 무관하게 어떤 바이트도 보내지 않고 `destroy()` 한다.

## 5. 관리 API

권한 검사는 2 단위의 `AdminAuthorizer` 를 쓴다. 아래는 모두 **슈퍼유저 전용**이다(`security:manage` 권한). 2 단위 이전에 구현할 때(U5-02 의 bans 임시 API)는 세션 검사만 두고, U5-05 가 2 단위 완료 후 권한을 얹는다.

| 메서드·경로 | 요청 | 응답 |
|---|---|---|
| `GET /api/security/geo` | — | `{geo: GeoConfig}` |
| `PUT /api/security/geo` | `GeoConfig` | `{geo, warnings}`. `ServerOptionStore.runConfigurationMutation` 안에서 `serverOption.connectionSecurity.geo` 갱신 → 원자 저장 → `configureGeo`. 검증 실패 422. `audited()` 로 `security_geo_updated` 기록 |
| `GET /api/security/countries` | — | `{countries: Array<{code, name}>}` (249개, 이름순) |
| `GET /api/security/bans` | — | `{bans: Array<{port, ip, country?: string, bannedUntil, hits}>}` |
| `DELETE /api/security/bans/:port/:ip` | — | `{removed: boolean}`. `audited()` 로 `security_ban_removed` 기록 |
| `GET /api/security/stats` | — | `AdmissionController.snapshot()` |

터널별 `rateLimit` 은 기존 `POST /api/tunnelingOption` 본문의 일부다. `verificationTunnelingOption` 이 범위를 검사한다.

## 6. 화면 (3 단위 이후)

### 6.1 TunnelEditScreen 에 "Rate limit" 카드 추가

- `Switch` "Enabled", `NumberInput` "Window (seconds)"(1..3600, 저장 시 ×1000), "Max connections per IP"(1..100000), "Ban duration (minutes)"(1..1440, 저장 시 ×60000).
- 사용자가 세 값 중 하나라도 편집하면 `customized = true`. 프로토콜 `Select` 변경 시 `customized === false` 면 `defaultRateLimit(protocol)` 로 값을 바꾼다(D9).
- 힌트 문구: "Blocks an IP that opens more than N connections within the window. Browsers open several connections per page; keep HTTP limits higher."

### 6.2 TunnelsScreen 카드

- 2행 상태 문자열 끝에 `Blocked {rejected.rateLimit + rejected.geo}` 를 mono 로 덧붙인다(0 이면 생략).

### 6.3 SecurityScreen (`#/security`, NAV 항목 "Security", 슈퍼유저만 표시)

- "Country filter" 카드: `Select` mode(Off / Allow only listed / Deny listed), 국가 다중 선택(검색 가능한 체크 목록: `TextInput` 필터 + `Checkbox` 목록, 선택된 항목은 상단에 `Chip` 으로 표시하고 × 로 제거), `Checkbox` "Apply to admin console", `Select` unknownPolicy("Allow unknown/private addresses" / "Deny"). 저장 버튼 → `PUT /api/security/geo`. 경고가 오면 `Toast tone="warn"`.
- "Banned addresses" 카드: 표(port · IP · country · remaining · Unban). 10초 주기 갱신. 비면 "No banned addresses."
- 브라우저 테스트 `test/admin/screen-security.test.ts`.

## 7. PRD 런타임 속성 집행 (2 단위 이후)

2 단위가 제공하는 조회 인터페이스(`src/server/rbac/AuthorizationContext.ts`, 2 단위 문서 6절)를 쓴다: `ownerOf(port): {userId, groupId, role} | undefined`, `groupAttributes(groupId): GroupAttributes`, `portsOfGroup(groupId): number[]`. 감사 이벤트는 `AuditSinkRegistry.current().record(...)`(2 단위 §4.6, U2-05 이후 항상 존재)로 남긴다.

| 속성 | 집행 지점 | 동작 |
|---|---|---|
| (공통) | 감사 이벤트 타입은 이 단위에서 문자열 리터럴(`'tunnel_autoexpire'`, `'conn_limit_hit'`)로 쓰고, U4-01 이 `AuditEventTypes.ts` 상수로 치환한다(U5-07·08 이 U4-01 과 같은 파동이라 상수를 기다리지 않는다) | |
| 3 `max_tunnel_duration_ms` | `ExternalPortServerPool.active(port, timeout)` 진입, 기동 시 자동 활성 | 소유자가 일반 유저이고 그룹 값 > 0 이면 `timeout = min(timeout || ∞, limit/1000)`. 만료로 `inactive` 되면 감사 이벤트 `tunnel_autoexpire` |
| 6 `max_concurrent_connections` | `AdmissionController.admit` 의 마지막 단계 | 그룹 합산 세션 수(`Σ status.sessions` over 그룹 소유 포트) `>= limit` 이면 `concurrency-limit`. 그룹→포트 목록은 `configureTunnel` 때 갱신. 감사 이벤트 `conn_limit_hit` 는 포트·그룹별 1분 1회로 묶음 |
| 11 `rate_limit` 대역폭 프리셋 | `src/server/security/BandwidthLimiter.ts` | 그룹별 토큰 버킷(용량 = 초당 바이트, 100ms 마다 1/10 보충). 외부→클라이언트: `onHandlerEvent` Receive 에서 `consume(bytes)` 가 대기 ms 를 돌려주면 `handler.socket.pause()` 후 `setTimeout(resume)`. 클라이언트→외부: `send(id, data)` 에서 대기가 필요하면 핸들러별 FIFO 큐에 넣고 순서대로 흘려보낸다(핸들러당 큐 상한은 `bufferLimitOnServer` 를 재사용). `unlimited` 는 버킷을 만들지 않는다 |

프리셋 값: `'unlimited' | '1MB/s' | '10MB/s' | '100MB/s'` → `0 | 1_048_576 | 10_485_760 | 104_857_600` bytes/s.

## 8. 테스트

### 8.1 단위 (`test/unit/server/security/`)

- `ConnectionRateLimiter.test.ts`: 창 안 N 회까지 허용, N+1 회에 `rate-limit-exceeded` 와 `retryAfterMs`, 차단 중 `rate-limit-ban`, `banMs` 경과 후 허용, 창 슬라이딩(오래된 타임스탬프 제거), 포트가 다르면 독립, `unban`, `prune` 이 만료 항목 제거, `MAX_TRACKED_IPS_PER_PORT` 초과 시 오래된 IP 제거, 100만 회 `admit` 이 차단 상태에서 500ms 안(O(1) 근거. CI 러너 편차를 고려한 값).
- `GeoFilter.test.ts`: `off` 허용, 사설·루프백은 `unknownPolicy`, `allow`/`deny` 판정(알려진 공인 IP 2개: `8.8.8.8`→US, `1.1.1.1`→AU 는 geoip-lite 동봉 DB 기준 — DB 갱신으로 바뀔 수 있으므로 테스트는 `lookupCountry` 결과를 먼저 읽고 그 값으로 목록을 구성), `applyToAdmin: false` 면 admin 스코프 허용, 지연 로드(`off` 상태에서 `isDatabaseLoaded() === false`, `allow` 설정 후 `true`).
- `address.test.ts`: `::ffff:` 정규화, 사설 범위 표.
- `countries.test.ts`: 249 개, `countryName('KR')` 이 비어 있지 않음.
- `TunnelingOption.rateLimit.test.ts`: `defaultRateLimit`, 정규화(필드 없음 → 프로토콜 기본값), 검증 범위.

### 8.2 컴포넌트 (`test/component/server/`)

- `admission-tcp.test.ts`: 인프로세스 `TCPServer` 에 `admit` 콜백을 주고 거절 시 소켓이 어떤 바이트도 받지 못하고 닫히는지, `SocketHandler` 가 생성되지 않는지(`_idHandlerMap` 크기).
- `admission-admin.test.ts`: 실제 `AdminServer` 를 띄우고 `configureGeo({mode:'deny', countries:[<127.0.0.1 의 국가 = undefined 이므로 unknownPolicy:'deny'>]})` 로 접속이 끊기는지, `applyToAdmin:false` 면 접속되는지.

### 8.3 E2E (`test/e2e/browser/`, 프로세스 하네스)

- `rate-limit.test.ts`: tcp 터널 `rateLimit {windowMs: 5000, maxConnections: 5, banMs: 3000}`. `net.connect` 를 5회 → 모두 성공, 6회째 즉시 종료(`close` 이벤트, 수신 0바이트). 서버 프로세스 RSS 가 100 회 추가 시도 뒤에도 +32 MiB 이내(GC 잡음을 고려해 3회 측정 최소값으로 판정. 측정은 단위 0 하네스의 `readRssMiB`, Linux 에서만 단언). 3초 뒤 다시 성공. `/api/security/bans` 에 항목이 있었다가 사라짐. 브라우저: http 터널 기본값(300)으로 `/` 를 10회 새로고침해도 `#ready`(정상 사용자가 걸리지 않음).
- `geo-filter.test.ts`: 하네스 `adminAccess: false`(준비 판정을 서버 로그로) + `connectionSecurity.geo {mode:'allow', countries:['KR'], unknownPolicy:'deny', applyToAdmin:true}` 로 기동 → 외부 포트 접속과 관리자 포트 접속(`https` 요청) 모두 끊김(127.0.0.1 은 unknown). `restartServer({serverOptionExtra: {connectionSecurity: {geo: {…unknownPolicy:'allow'}}}})` → 둘 다 정상. `applyToAdmin:false` + `unknownPolicy:'deny'` → 외부 포트만 끊김.
- `bandwidth-preset.test.ts`(U5-09): 하네스 `identityFixture`(U2-09 이 만든 형식)로 그룹 프리셋 `1MB/s` 의 일반 유저와 그 사용자 소유(`ownerId`) http 터널을 심고 `/big?mb=5` 다운로드 5초 ±5% (K4). `unlimited` 는 1초 안.

## 9. 이슈 분할

| # | 제목 | 만드는 것 | 수용 기준 | 선행 |
|---|---|---|---|---|
| U5-01 | 접속 레이트 리미터 | `security/{AdmissionPolicy,ConnectionRateLimiter,AdmissionController,address}.ts`(순수 로직, 시계 주입) | 8.1 의 RateLimiter·address 테스트(성능 케이스 포함) | — |
| U5-02 | 수락 판정 삽입과 터널 옵션 | `TCPServer.admit`, `ExternalPortServerPool` 연결(`configureTunnel/releaseTunnel`, `configureConcurrency` 주입), `RateLimitOption` 타입·기본값·정규화·검증, 상태 필드 `rejected/bannedIps`, `GET /api/security/bans`·`DELETE /api/security/bans/:port/:ip` 를 **세션 검사만으로 임시 제공**(U5-05 가 권한을 얹는다) | 8.1 rateLimit 옵션 테스트, 8.2 `admission-tcp`, 8.3 `rate-limit.test.ts` | U5-01, U0-01 |
| U5-03 | 국가 필터 | `geoip-lite` 의존성(+`package-lock.json`), `GeoFilter`, `countries.ts`, `connectionSecurity` 설정·검증, `AdminServer` connection 훅, `ServerApp`·`applyServerOption` 연결, pkg assets(country DB 두 파일만), `scripts/geoip-update.mjs`, 릴리스 문서 | 8.1 Geo·countries(city 파일 부재 시 country 폴백 포함), 8.2 `admission-admin`, 8.3 `geo-filter.test.ts`, deploy-gates 단언, `npm test -- test/supply-chain` 통과(`npm audit --omit=dev --audit-level=moderate` 0건 게이트. 실패하면 구현을 멈추고 이슈에 코멘트) | U5-02 |
| U5-04 | 거절 통계와 집계 로그 | 1분 집계 로그, `snapshot()`, `/api/security/stats` 의 데이터 부분(세션 검사만) | 단위 테스트: 집계 로그가 60초에 1줄 | U5-02 |
| U5-05 | 보안 관리 API | `/api/security/geo|countries|bans|stats` 전부에 `security:manage` 권한, 감사 이벤트 2종 | `test/component/server/admin/security-api.test.ts`(실제 AdminServer, 슈퍼유저·일반 유저 403), CSRF 적용 확인 | U5-03, U5-04, U2-08 |
| U5-06 | 보안 화면과 터널 편집의 레이트 리밋 카드 | `SecurityScreen`, NAV 항목(슈퍼유저), TunnelEdit 카드, 카드 목록 `Blocked` | `screen-security.test.ts`, `screen-tunnels.test.ts` 추가 케이스(프로토콜 변경 시 기본값 전환, customized 유지) | U5-05, U3-06 |
| U5-07 | 속성 3 터널 최대 수명 집행 | `active` 상한, 자동 만료 감사 | 컴포넌트 테스트: 한도 2초 그룹 사용자 터널이 2초 뒤 inactive, `tunnel_autoexpire` 기록 | U2-08 |
| U5-08 | 속성 6 그룹 동시 연결 상한 | 그룹 합산 카운트(`configureConcurrency` 공급 함수), `concurrency-limit`, HTTP 503(`rejectResponse`), `conn_limit_hit` | E2E(`identityFixture` 사용): 한도 3 그룹의 tcp 터널에 4번째 연결 즉시 종료, http 터널은 503 | U5-02, U2-09 |
| U5-09 | 속성 11 대역폭 프리셋 | `BandwidthLimiter`, 두 방향 삽입 | 8.3 `bandwidth-preset.test.ts`, 단위 테스트(토큰 버킷 보충·대기 계산) | U5-02, U2-09 |
