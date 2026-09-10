# 단위 5 이슈 초안 — 연결 보안

근거: [단위 5 설계](../2026-09-11-unit5-connection-security.md), [프로그램 개요](../2026-09-11-program-overview.md)

## U5-01

**title**: feat(server): 시계를 주입받는 터널별 접속 레이트 리미터와 수락 판정기 추가
**labels**: enhancement, area:server, unit:5
**body**:
## 목적

외부 접속을 소켓 수락 직후 판정하는 순수 로직을 만든다: 원격 IP 하나가 창(window) 안에 한도보다 많이 접속하면 그 IP 를 해당 터널에서 일정 시간 차단하는 `ConnectionRateLimiter`, 판정 단계를 한 곳에 묶는 `AdmissionController`, 주소 정규화 `address.ts`, 공용 타입 `AdmissionPolicy.ts`. 이 이슈는 기존 소스를 한 줄도 바꾸지 않고 `src/server/security/` 와 단위 테스트만 만든다. 시각은 모두 인자로 받아 테스트가 시계를 주입한다. 소켓 경로에 끼워 넣는 일은 U5-02 가 한다.

## 배경

- `src/server/security/` 디렉터리는 없다. 이 이슈가 만든다.
- 후속 이슈가 붙일 지점(참고만, 이 이슈에서 손대지 않는다): `src/util/TCPServer.ts:114-123` `onBind` (U5-02), `src/server/ExternalPortServerPool.ts:111-161` `startServer` (U5-02), `src/server/admin/AdminServer.ts:74-108` 생성자 (U5-03).
- `src/types/TunnelingOption.ts:71-84` `type TunnelingOption` 에는 아직 `rateLimit` 필드가 없다(U5-02 가 추가). 따라서 이 이슈의 `configureTunnel` 은 `TunnelingOption` 을 import 하지 않고 구조적 타입을 받는다.
- 단위 테스트 관례: `test/unit/server/*.test.ts`(예: `test/unit/server/AdminSecurityPolicy.test.ts`), Jest 설정 `jest.config.ts` 의 `testMatch: test/**/*.test.(js|ts)`.
- 관리자 서버의 IPv6 매핑 주소 정규화 선례: `src/server/admin/AdminServer.ts:1377-1396` `getNetworkBucket` 이 `/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i` 로 `::ffff:` 접두사를 벗긴다. 같은 규칙을 `address.ts` 에 둔다(관리자 서버 코드는 바꾸지 않는다).

먼저 열어 볼 파일: `docs/design/2026-09-11-unit5-connection-security.md` §4.1·4.2·4.4, `test/unit/server/AdminSecurityPolicy.test.ts`(테스트 파일 형식), `src/server/admin/AdminServer.ts:1377-1396`.

## 적용되는 결정

- D8 레이트 리밋은 터널별 접속 횟수 기준. IP 가 창 안에 N 회 넘게 접속하면 일정 시간 차단.
- D11 차단 IP 조회는 O(1). 판정은 자원 할당 전에 끝난다(삽입은 U5-02).

## 만들 것

### `src/server/security/AdmissionPolicy.ts`

```ts
export type AdmissionScope = {kind: 'tunnel'; port: number; protocol: 'tcp' | 'http' | 'https'} | {kind: 'admin'};
export type AdmissionReason = 'geo-deny' | 'rate-limit-ban' | 'rate-limit-exceeded' | 'concurrency-limit';
export type AdmissionDecision = {allowed: true} | {allowed: false; reason: AdmissionReason; retryAfterMs?: number};
export interface AdmissionPolicy {
    admit(scope: AdmissionScope, remoteAddress: string | undefined, now?: number): AdmissionDecision;
}
export const ADMIT: AdmissionDecision = Object.freeze({allowed: true});   // 허용 판정은 이 상수 하나를 재사용한다(할당 0)
```

### `src/server/security/address.ts`

```ts
export function normalizeRemoteAddress(addr: string): string;
export function isPrivateAddress(ip: string): boolean;
```

- `normalizeRemoteAddress`: `::ffff:1.2.3.4` → `1.2.3.4`(대소문자 무시), `%zone` 접미사 제거(`fe80::1%eth0` → `fe80::1`), 그 외는 입력 그대로. 순수 함수.
- `isPrivateAddress` 가 true 인 범위(정규화된 주소 기준):

| 범위 | 판정 |
|---|---|
| `10.0.0.0/8` | 첫 옥텟 10 |
| `172.16.0.0/12` | 첫 옥텟 172, 둘째 옥텟 16..31 |
| `192.168.0.0/16` | 첫 두 옥텟 192.168 |
| `127.0.0.0/8` | 첫 옥텟 127 |
| `169.254.0.0/16` | 첫 두 옥텟 169.254 |
| `fc00::/7` | 소문자 정규화 후 `fc` 또는 `fd` 로 시작 |
| `::1` | 정확히 `::1` |

그 외(공인 IPv4, 나머지 IPv6, IP 형식이 아닌 문자열)는 false.

### `src/server/security/ConnectionRateLimiter.ts`

```ts
import {AdmissionDecision} from "./AdmissionPolicy";
export type RateLimitConfig = {windowMs: number; maxConnections: number; banMs: number};
export const MAX_TRACKED_IPS_PER_PORT = 10_000;
export class ConnectionRateLimiter {
    configurePort(port: number, config: RateLimitConfig | undefined): void;   // undefined = 해제(포트 항목 삭제)
    banned(port: number, ip: string, now: number): AdmissionDecision | undefined;   // 차단 중이면 판정, 아니면 undefined. Map.get 한 번
    admit(port: number, ip: string, now: number): AdmissionDecision;
    bans(now: number): Array<{port: number; ip: string; bannedUntil: number; hits: number}>;
    unban(port: number, ip: string): boolean;
    prune(now: number): void;
    ports(): number[];                                                        // 설정된 포트 목록(오름차순)
    stats(port: number): {rejectedBans: number; rejectedExceeded: number; bannedIps: number};
}
```

- 자료구조: `Map<number /*port*/, PortState>`, `PortState = {config: RateLimitConfig; bans: Map<string, {until: number; hits: number}>; windows: Map<string, number[]>; rejectedBans: number; rejectedExceeded: number}`. 창 배열은 시간 오름차순(push 순서).
- `banned(port, ip, now)`: 포트 항목이 없으면 `undefined`. `bans.get(ip)` 가 있고 `until > now` 면 `rejectedBans++` 후 `{allowed: false, reason: 'rate-limit-ban', retryAfterMs: until - now}`. `until <= now` 면 항목을 지우고 `undefined`.
- `admit(port, ip, now)` 순서:
  1. 포트 항목이 없으면 `ADMIT`.
  2. `banned(...)` 가 판정을 주면 그대로 반환.
  3. `windows.get(ip)`: 없으면 새 배열. 있으면 `findIndex(t => t > now - windowMs)` 로 창 밖 앞부분을 `splice` 로 잘라낸다. `now` 를 push. `windows.delete(ip); windows.set(ip, arr)` 로 삽입 순서를 갱신한다(Map 의 첫 키가 가장 오래 전에 접속한 IP).
  4. 새 IP 를 넣기 전에 `windows.size >= MAX_TRACKED_IPS_PER_PORT` 이면 `windows.keys().next().value` 를 지운다. `bans` 에도 같은 상한을 둔다(설계 §4.2 는 `windows` 만 명시했지만 IP 를 바꿔 가며 차단만 쌓는 경우를 막기 위해 같은 규칙을 적용한다).
  5. `arr.length > maxConnections` 이면 `bans.set(ip, {until: now + banMs, hits: arr.length})`, `windows.delete(ip)`, `rejectedExceeded++`, `{allowed: false, reason: 'rate-limit-exceeded', retryAfterMs: banMs}`.
  6. 아니면 `ADMIT`.
- `bans(now)`: `until > now` 인 항목을 `port` 오름차순, 같은 포트 안에서는 `bannedUntil` 오름차순으로.
- `unban(port, ip)`: 있으면 지우고 true.
- `prune(now)`: 모든 포트에서 `until <= now` 인 차단 삭제; 창 배열이 비었거나 마지막 항목이 `now - windowMs` 이전이면 창 항목 삭제.
- `stats(port)`: 항목이 없으면 전부 0. `bannedIps === bans.size`.
- 이 파일에서 `Date.now` 를 호출하지 않는다.

### `src/server/security/AdmissionController.ts`

```ts
export type TunnelRateLimitSource = {forwardPort: number; rateLimit?: {enabled: boolean; windowMs: number; maxConnections: number; banMs: number}};
export const PRUNE_INTERVAL_MS = 30_000;
export class AdmissionController implements AdmissionPolicy {
    static get instance(): AdmissionController;
    static resetForTest(): void;                       // 인스턴스 폐기 + prune interval clearInterval
    readonly rateLimiter: ConnectionRateLimiter;
    configureTunnel(option: TunnelRateLimitSource): void;   // rateLimit?.enabled 면 configurePort(port, {windowMs, maxConnections, banMs}), 아니면 configurePort(port, undefined)
    configureConcurrency(provider: (port: number) => number): void;   // 포트별 현재 세션 수 공급 함수. 저장만 한다(사용은 U5-08)
    releaseTunnel(port: number): void;                 // configurePort(port, undefined) + 거절 카운터 삭제
    admit(scope: AdmissionScope, remoteAddress: string | undefined, now: number = Date.now()): AdmissionDecision;
    denials(scope: number | 'admin'): {geo: number; rateLimit: number};
}
```

- `admit` 순서(설계 §4.4 의 네 단계. 이 이슈는 (1)·(3)만 구현하고 (2)·(4) 자리는 주석으로 비워 둔다):
  1. `remoteAddress === undefined` → `ADMIT`. `ip = normalizeRemoteAddress(remoteAddress)`.
  2. `scope.kind === 'tunnel'` 이면 `rateLimiter.banned(scope.port, ip, now)` 가 판정을 줄 때 반환. ← D11 의 O(1) 경로. `admin` 스코프는 레이트 리밋 단계(2·4)를 건너뛴다(로그인 백오프가 따로 있다).
  3. (자리) geo — U5-03 이 삽입.
  4. `scope.kind === 'tunnel'` 이면 `rateLimiter.admit(scope.port, ip, now)` 가 거절일 때 반환.
  5. (자리) 동시 연결 상한 — U5-08 이 삽입.
  6. `ADMIT`.
- `denials(scope)`: `scope` 가 포트면 `{geo: <카운터>, rateLimit: stats.rejectedBans + stats.rejectedExceeded}`, `'admin'` 이면 `{geo: <카운터>, rateLimit: 0}`. geo 카운터 저장소 `Map<number | 'admin', number>` 는 이 이슈에서 항상 0 이다(U5-03 이 증가시킨다).
- prune 타이머: 첫 `configureTunnel` 때 `setInterval(() => this.rateLimiter.prune(Date.now()), PRUNE_INTERVAL_MS).unref()` 를 한 번만 만든다. `resetForTest` 가 지운다. `Date.now` 직접 호출은 이 파일의 `admit` 기본 인자와 이 타이머 콜백 두 곳뿐이다.
- 거절 로그를 남기지 않는다(U5-04 가 집계 로그를 만든다).

### 테스트 파일

- `test/unit/server/security/ConnectionRateLimiter.test.ts`
- `test/unit/server/security/address.test.ts`
- `test/unit/server/security/AdmissionController.test.ts`

## 변경할 것

없음. 기존 파일을 수정하지 않는다.

## 하지 말 것

- `TCPServer`, `ExternalPortServerPool`, `AdminServer`, `TunnelingOption` 을 건드리지 않는다(U5-02·03).
- `security/*` 가 `src/server/rbac`, `src/server/admin`, `src/util/TCPServer` 를 import 하지 않는다.
- 거절 로그, `snapshot()`, API, 화면을 만들지 않는다.
- 예외를 제어 흐름으로 쓰지 않는다. `banned` 는 "없음" 을 `undefined` 로 돌려준다.
- 공유 상태에 잠금·대기 플래그를 두지 않는다. `Map` 의 키 단위 갱신과 불변 판정 객체(`ADMIT`)로 처리한다.
- `ConnectionRateLimiter`·`admit` 본문에서 `Date.now` 를 호출하지 않는다. 시각은 인자다.
- 창 배열을 `filter` 로 새로 만들거나 정렬하지 않는다(`splice` 로 앞부분만 잘라낸다).
- 성능 케이스를 통과시키려고 판정 객체 캐시 같은 최적화를 넣지 않는다(Map 조회 한 번이면 충분하다).

## 수용 기준

모든 테스트는 시각을 `now` 인자로 주입한다(`Date.now`·`jest.useFakeTimers` 사용 금지).

- `test/unit/server/security/ConnectionRateLimiter.test.ts` (`configurePort(1, {windowMs: 1000, maxConnections: 3, banMs: 5000})` 기준)
  - `now=0,1,2` 세 번 `admit(1,'1.1.1.1')` 이면 모두 `allowed: true` 이다.
  - 네 번째(`now=3`)이면 `{allowed: false, reason: 'rate-limit-exceeded', retryAfterMs: 5000}` 이다.
  - 그 뒤 `now=10` 에 `admit` 이면 `{allowed: false, reason: 'rate-limit-ban', retryAfterMs: 4993}` 이고 `banned(1,'1.1.1.1',10)` 도 같은 값이다. `banned(1,'2.2.2.2',10)` 은 `undefined` 이다.
  - `now=5003` 에 `admit` 이면 `allowed: true` 이다(차단 만료).
  - `now=0,1,2` 허용 후 `now=1001` 에 `admit` 이면 허용이다(창 슬라이딩). 이어 `now=1002,1003` 허용, `now=1004` 이면 `rate-limit-exceeded` 이다.
  - 포트 1 에서 차단된 IP 가 포트 2(같은 설정)에서는 허용이다.
  - `configurePort(1, undefined)` 뒤 어떤 IP 든 허용이고 `stats(1)` 이 전부 0, `ports()` 에 1 이 없다.
  - 차단 뒤 `unban(1,'1.1.1.1')` 이 true 이고 다음 `admit` 이 허용이다. 없는 항목의 `unban` 은 false 이다.
  - `bans(10)` 이 `[{port: 1, ip: '1.1.1.1', bannedUntil: 5003, hits: 4}]` 이다. `bans(5003)` 은 `[]` 이다.
  - `prune(6000)` 뒤 `stats(1).bannedIps === 0` 이고, `now=0` 에 한 번 접속한 IP 의 창 항목도 사라져 이후 `now=6001,6002,6003` 세 번이 허용된다.
  - `10.0.0.{n}` 꼴 IP 를 `MAX_TRACKED_IPS_PER_PORT + 1` 개 접속시킨 뒤 첫 IP 를 `maxConnections` 번 다시 접속시켜도 허용된다(첫 IP 의 창이 제거되었음).
  - 성능: 한 IP 를 차단 상태로 만든 뒤 워밍업 100,000 회 후 `admit(1, ip, now)` 1,000,000 회의 소요 시간이 `process.hrtime.bigint()` 기준 500ms 이내이고 반환값이 전부 `reason: 'rate-limit-ban'` 이다.
- `test/unit/server/security/address.test.ts`
  - `normalizeRemoteAddress('::ffff:1.2.3.4')` 는 `'1.2.3.4'`, `'::FFFF:1.2.3.4'` 도 `'1.2.3.4'`, `'fe80::1%eth0'` 는 `'fe80::1'`, `'8.8.8.8'` 은 그대로이다.
  - `10.1.2.3`, `172.16.0.1`, `172.31.255.255`, `192.168.0.1`, `127.0.0.1`, `169.254.1.1`, `fc00::1`, `fd12::1`, `::1` 은 `isPrivateAddress` 가 true 이고 `172.32.0.1`, `8.8.8.8`, `2001:4860::8888`, `'not-an-ip'` 는 false 이다.
- `test/unit/server/security/AdmissionController.test.ts` (`beforeEach` 에 `AdmissionController.resetForTest()`)
  - `admit({kind:'tunnel', port: 1, protocol:'tcp'}, undefined, 0)` 은 허용이다.
  - `admit({kind:'admin'}, '8.8.8.8', 0)` 은 허용이다.
  - `configureTunnel({forwardPort: 1, rateLimit: {enabled: true, windowMs: 1000, maxConnections: 1, banMs: 1000}})` 뒤 같은 IP 의 두 번째 `admit` 이 `rate-limit-exceeded`, 세 번째가 `rate-limit-ban` 이고 `denials(1)` 이 `{geo: 0, rateLimit: 2}` 이다.
  - `rateLimit: {enabled: false, …}` 또는 `rateLimit` 없이 `configureTunnel` 하면 100 번 `admit` 이 전부 허용이다.
  - `releaseTunnel(1)` 뒤 `denials(1)` 이 `{geo: 0, rateLimit: 0}` 이다.
  - `'::ffff:9.9.9.9'` 와 `'9.9.9.9'` 는 같은 창을 쓴다(`maxConnections: 1` 에서 각각 한 번씩 접속하면 두 번째가 거절).
  - `configureConcurrency(fn)` 을 부른 뒤에도 판정 결과가 바뀌지 않는다(저장만).
  - `resetForTest()` 뒤 `AdmissionController.instance` 가 새 객체이고 설정이 비어 있다.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/server/security
npm test -- --runInBand
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건, 제목에 단계 표식 없음 확인
```

## 선행 · 후행

- 선행: 없음(단위 5 의 첫 이슈, 파동 0).
- 후행: U5-02(수락 판정 삽입).

## 근거 문서

- `docs/design/2026-09-11-unit5-connection-security.md` §1.1, §4.1·4.2·4.4, §8.1(RateLimiter·address), §9(U5-01)
- `docs/design/2026-09-11-program-overview.md` §1 D8·D11, §3.1·3.2

---

## U5-02

**title**: feat(server): 외부 포트 수락 경로에 판정을 삽입하고 터널 레이트 리밋 옵션을 추가
**labels**: enhancement, area:server, unit:5
**body**:
## 목적

U5-01 의 판정기를 실제 소켓 경로에 끼운다. `TCPServer` 가 수락 직후 `admit` 콜백을 부르고, 거절이면 `SocketHandler`·버퍼·컨트롤 터널 통보 어느 것도 만들지 않고 소켓을 닫는다. `TunnelingOption.rateLimit` 이 생겨 모든 터널이 프로토콜별 기본값(D9)으로 레이트 리밋을 켠 채 기동하고, 상태 API 에 거절 수·차단 IP 수가 나타나며, 차단 목록 조회·해제 API 가 세션 검사만으로 임시 제공된다. 프로세스 E2E 로 6 번째 접속이 즉시 끊기고 메모리가 늘지 않음을 고정한다.

## 배경

- `src/util/TCPServer.ts:21` — `interface ServerOption {port: number, tls?: boolean, ca?: string, cert?: string, key?: string, keepAlive?: number}`. `:83-86` `createServer()` 가 `tls.createServer(…, this.onBind)` / `net.createServer(this.onBind)`. `:114-123` `onBind = (socket) => {…}` 가 `:115` 에서 옵션 리터럴을 만들고 `:116` 에서 곧바로 `SocketHandler.bound(option, …)` 를 부르며 `_idHandlerMap.set` 후 `Bound` 이벤트를 올린다. 판정은 `:115` 앞에 들어간다. `_idHandlerMap`(`:29`)은 private 이고 크기를 읽는 공개 메서드가 없다.
- `src/util/SocketHandler.ts:263` — `public static bound(options: {socket: net.Socket, port: number, addr: string, tls: boolean, keepAlive: number}, event: OnSocketEvent, onOwnerTerminal?: (handler: SocketHandler) => void): SocketHandler`. 호출 즉시 `setNoDelay`·`setKeepAlive` 를 건다.
- `src/server/ExternalPortServerPool.ts:31-41` — `type ExternalPortServerStatus = {port, online, sessions, uptime, active, activeStart, activeTimeout, rx, tx}`. `:74-86` 생성자. `:111-161` `startServer(option, certInfo?)`: `:125-132` `options` 리터럴, `:133` `TCPServer.create(options)`, `:139-140` 초기 상태 `_statusMap.set`, `:142-146` `start` 콜백의 `err` 분기. `:213-220` `getServerStatus(port)` 는 저장된 객체를 **동일 참조**로 돌려준다(`:218`) 또는 기본 리터럴(`:216`). `:394-401` `updateCount`. `:403-420` `stop(port)`. `:494-522` `stopAll()`. `_statusMap` 은 private.
- `src/server/TTTServer.ts:236` 이 `getServerStatus` 반환 객체를 직접 수정(`restoredStatus.activeTimeout = …`)하므로 `getServerStatus` 가 새 객체를 돌려주면 안 된다. `:333-382` `applyTunnelingOption` 은 `stop(port)` → `startServer(nextOption)`.
- `src/server/ServerOptionStore.ts:20` `type TunnelingOptionNormalizationMode = "new-config" | "legacy-load"`. `:339-402` `verificationServerOption(option)` 의 `:341-349` 터널 순회가 `normalizeServerBufferLimit` 만 부른다. `:404-412` `private normalizeServerBufferLimit(option): {success: boolean; message: string}` — 옵션을 제자리에서 고친다. `:414-417` `verificationTunnelingOption(option, normalizationMode = "new-config"): {success, forwardPort, message}` 가 `:427-428` 에서 `normalizeServerBufferLimit` 를 부른다. 로드 경로 `:332-333` 은 `'legacy-load'`.
- `src/types/TunnelingOption.ts:4` `type Protocol`, `:71-84` `type TunnelingOption`(`rateLimit` 없음), `:187-205` export 목록.
- `src/server/admin/AdminServer.ts:213-222` `routeDelete`, `:247-` `routeGet` 은 `if/else` 체인(단위 2 의 라우트 표 전환 U2-03 전). `:843-850` `checkSession(req, res)` 가 401 을 처리. `:1330` `sendApiSuccess`, `:1334` `sendApiFailure`. `:1206-1212` `onGetExternalServerStatuses` 는 `externalServerStatuses()` 를 그대로 싣는다(상태 필드 추가가 자동 노출).
- 단위 2 U2-03 의 `routes.test.ts` 는 "기존 경로 15개 + U5-02 가 추가한 `/api/security/bans` 2개" 를 기대한다. 경로 문자열은 정확히 `GET /api/security/bans`, `DELETE /api/security/bans/:port/:ip` 이어야 한다.
- 테스트 도구: `test/helpers/network.ts` `getFreePort()`, `test/helpers/runtime.ts` `createTestRoot/applyTestRoot/cleanupTestRoot`, `test/component/server/ExternalPortServerPool.test.ts`(풀 컴포넌트 테스트 본보기), `test/component/server/admin/admin-routes.test.ts:35-42`(세션 얻는 방식: `/api/login` 에 `key`·`bootstrapToken`, 응답 쿠키에서 `sessionKey`·`csrfToken`).
- 설계 문서와 다른 점: §8.2 의 "`_idHandlerMap` 크기" 단언은 private 이라 `TCPServer.handlerCount` 게터를 추가해 단언한다. TLS 외부 포트(`tls: true`)는 `tls.createServer` 가 핸드셰이크를 끝낸 뒤 `onBind` 를 부르므로 핸드셰이크 비용은 판정 앞에 든다 — §2 결정(`onBind` 첫 줄)을 따르고 사실만 적어 둔다.

먼저 열어 볼 파일: `src/util/TCPServer.ts`, `src/server/ExternalPortServerPool.ts`, `src/server/ServerOptionStore.ts`(`:332-470`), `src/types/TunnelingOption.ts`, `src/server/admin/AdminServer.ts`(`:213-290`, `:843-850`, `:1206-1212`), `src/server/security/AdmissionController.ts`(U5-01), `test/component/server/ExternalPortServerPool.test.ts`.

### 전제하는 산출물

| 산출물 | 만드는 이슈 | 쓰는 곳 |
|---|---|---|
| `src/server/security/{AdmissionPolicy,address,ConnectionRateLimiter,AdmissionController}.ts` | U5-01 | 전부 |
| `test/helpers/processTunnelHarness.ts` 의 `createProcessTunnelHarness(options)`(`tunnels[].extra`, `server.pid`, `adminRequest`, `readRssMiB(pid)`, `dispose`) | U0-01 | `test/e2e/browser/rate-limit.test.ts` |
| `test/e2e/target/targetService.ts` 의 `startTargetService()`(`GET /` 가 `#ready` 를 채움) | U0-01 | 같은 E2E |

착수 시 없으면 이슈에 "U5-01/U0-01 미완료로 중단" 코멘트를 남기고 중단한다.

## 적용되는 결정

- D9 기본값: 모든 터널 기본 켜짐. TCP 60초/30회/10분 차단, HTTP·HTTPS 60초/300회/10분 차단. `customized` 는 UI 가 기록하고 서버는 검증만.
- D11 판정은 소켓 수락 직후, 어떤 자원도 할당하기 전에.

## 만들 것

### `src/types/TunnelingOption.ts` (추가)

```ts
type RateLimitOption = {enabled: boolean; windowMs: number; maxConnections: number; banMs: number; customized: boolean};
const RATE_LIMIT_RANGE = {windowMs: [1000, 3_600_000], maxConnections: [1, 100_000], banMs: [1000, 86_400_000]} as const;
const defaultRateLimit = (protocol: Protocol | undefined): RateLimitOption => …;
const normalizeRateLimit = (protocol: Protocol | undefined, input: unknown):
    {success: true; rateLimit: RateLimitOption} | {success: false; message: string} => …;
```

- `TunnelingOption` 에 `rateLimit?: RateLimitOption` 추가.
- `defaultRateLimit`: `'http'`·`'https'` → `{enabled: true, windowMs: 60000, maxConnections: 300, banMs: 600000, customized: false}`; `'tcp'`·`undefined` → `maxConnections: 30`, 나머지 동일.
- `normalizeRateLimit`(입력을 고치지 않고 새 객체 반환):
  - `undefined` → 프로토콜 기본값.
  - 객체가 아니면(배열·null·원시값) `'rateLimit must be an object'`.
  - `enabled` 없음 → true; boolean 아니면 `'rateLimit.enabled must be boolean'`.
  - `windowMs`·`maxConnections`·`banMs`: 없음 → 기본값; 있으면 `Number.isInteger` 이고 `RATE_LIMIT_RANGE` 안. 아니면 `'rateLimit.<필드> must be an integer within <min>..<max>'`.
  - `customized` 없음 → false; boolean 아니면 `'rateLimit.customized must be boolean'`.
  - 알 수 없는 키는 버린다.
- export 목록에 `RateLimitOption`, `RATE_LIMIT_RANGE`, `defaultRateLimit`, `normalizeRateLimit` 추가.

### `TCPServer` 의 `admit`

```ts
type AdmitVerdict = {allowed: true} | {allowed: false; reason: string; retryAfterMs?: number; rejectResponse?: Buffer};
interface ServerOption {…기존…, admit?: (remoteAddress: string | undefined) => AdmitVerdict}
```
`AdmitVerdict` 는 `AdmissionDecision & {rejectResponse?: Buffer}` 와 구조적으로 호환되는 지역 타입이다(`util/` 이 `server/security` 를 import 하지 않는다). `TCPServer` 는 프로토콜을 모른다. `onBind` 첫 줄:
```ts
if(this._options.admit) {
    const verdict = this._options.admit(socket.remoteAddress);
    if(!verdict.allowed) {
        if(verdict.rejectResponse) socket.end(verdict.rejectResponse); else socket.destroy();
        return;
    }
}
```
`public get handlerCount(): number { return this._idHandlerMap.size; }` 추가. `rejectResponse` 는 이 이슈에서 아무도 채우지 않는다(U5-08 이 http/https 의 `concurrency-limit` 에만 채운다).

### `ExternalPortServerPool` 연결

- `ExternalPortServerStatus` 에 `rejected: {geo: number; rateLimit: number}`, `bannedIps: number` 추가. 초기 상태(`:139-140`)와 기본 리터럴(`:216`)에 0 을 넣는다.
- 생성자 끝: `AdmissionController.instance.configureConcurrency((port) => this._statusMap.get(port)?.sessions ?? 0)`.
- `startServer` 의 `options`(`:125-132`)에 추가:
  ```ts
  admit: (addr) => {
      const protocol = option.protocol ?? 'tcp';
      const d = AdmissionController.instance.admit({kind: 'tunnel', port: option.forwardPort, protocol}, addr);
      if(!d.allowed && d.reason === 'concurrency-limit' && (protocol === 'http' || protocol === 'https')) return {...d, rejectResponse: HTTP_503};
      return d;
  }
  ```
  `HTTP_503 = Buffer.from('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')` 상수를 이 파일에 둔다(`concurrency-limit` 은 U5-08 전까지 발생하지 않지만 래핑은 지금 완성한다).
- `:133` `TCPServer.create(options)` 직후 `AdmissionController.instance.configureTunnel(option)`. `start` 콜백 `err` 분기(`:142-146`)에서 `reject(err)` 전에 `releaseTunnel(option.forwardPort)`.
- `getServerStatus(port)`(`:213-220`): 저장된 객체가 있으면 반환 전에 **제자리에서** 갱신한다(참조 유지):
  ```ts
  const denials = AdmissionController.instance.denials(port);
  status.rejected.geo = denials.geo; status.rejected.rateLimit = denials.rateLimit;
  status.bannedIps = AdmissionController.instance.rateLimiter.stats(port).bannedIps;
  return status;
  ```
- `stop(port)`(`:411` `server.stop` 콜백 안, `resolve` 전)와 `stopAll()`(각 포트의 `stop` 콜백)에서 `AdmissionController.instance.releaseTunnel(port)`.

### `ServerOptionStore` 정규화

- `verificationTunnelingOption`(`:427-428` 버퍼 정규화 직후, 두 모드 공통):
  ```ts
  const rateLimit = normalizeRateLimit(option.protocol, option.rateLimit);
  if(!rateLimit.success) return {success: false, forwardPort: option.forwardPort, message: rateLimit.message};
  option.rateLimit = rateLimit.rateLimit;
  ```
- `verificationServerOption` 의 터널 순회(`:343-348`)에서 `normalizeServerBufferLimit` 뒤에 같은 정규화를 적용한다(`/api/serverOption` 으로 `tunnelingOptions` 가 통째로 올 때도 채워지게).

### 임시 차단 목록 API (`AdminServer`, 세션 검사만)

| 메서드·경로 | 응답 |
|---|---|
| `GET /api/security/bans` | `{serverTime: number, bans: Array<{port, ip, bannedUntil, hits}>}` |
| `DELETE /api/security/bans/:port/:ip` | `{removed: boolean}` |

- `routeGet` 에 `url == "/api/security/bans"` 분기, `routeDelete` 에 `url.startsWith("/api/security/bans/")` 분기를 추가한다. 핸들러 `onGetSecurityBans`·`onDeleteSecurityBan` 은 `checkSession` 으로 시작한다.
- `GET`: `const now = Date.now(); sendApiSuccess(res, {serverTime: now, bans: AdmissionController.instance.rateLimiter.bans(now)})`.
- `DELETE`: 경로에서 `port`(`Number`, 1..65535 아니면 400 `'invalid port'`)와 `ip`(`decodeURIComponent`, 비어 있으면 400 `'invalid ip'`)를 뽑아 `sendApiSuccess(res, {removed: rateLimiter.unban(port, ip)})`.
- 응답 예: `{"success":true,"partial":false,"failedScopes":[],"warnings":[],"message":"","serverTime":1757548800000,"bans":[{"port":20001,"ip":"203.0.113.9","bannedUntil":1757549400000,"hits":31}]}`, `{"success":true,…,"removed":true}`.
- `country` 필드와 권한·감사는 U5-03·U5-05 가 더한다. CSRF 는 기존 `route()` 가 DELETE 에 자동 적용한다.

### 테스트 파일 (신규)

- `test/unit/server/security/TunnelingOption.rateLimit.test.ts`
- `test/unit/server/ServerOptionStore.rateLimit.test.ts`
- `test/component/server/admission-tcp.test.ts`
- `test/component/server/ExternalPortServerPool.admission.test.ts`
- `test/component/server/admin/security-bans.test.ts`
- `test/e2e/browser/rate-limit.test.ts`

## 변경할 것

- `src/util/TCPServer.ts`(`ServerOption.admit`, `AdmitVerdict`, `onBind`, `handlerCount`), `src/server/ExternalPortServerPool.ts`(상태 필드, `configureConcurrency` 주입, `admit` 래핑, `configureTunnel/releaseTunnel`, `getServerStatus` 제자리 갱신), `src/server/ServerOptionStore.ts`(두 정규화 지점), `src/types/TunnelingOption.ts`(타입·함수), `src/server/admin/AdminServer.ts`(bans 라우트 2개).
- `src/server/TTTServer.ts`: 변경 없음(`applyTunnelingOption` 의 `stop` → `startServer` 가 `releaseTunnel` → `configureTunnel` 을 자연히 부른다).

## 하지 말 것

- 관리자 포트(`AdminServer` 생성자)에 판정을 넣지 않는다(U5-03).
- `GeoFilter`, `connectionSecurity`, `/api/security/geo|countries|stats`, 화면을 만들지 않는다.
- 거절 로그를 남기지 않는다(U5-04). `logger.warn` 을 연결마다 부르지 않는다.
- `rejectResponse` 를 `concurrency-limit` 외의 사유나 tcp 터널에 채우지 않는다. 그 외 거절은 어떤 바이트도 보내지 않고 `destroy()`.
- `server.yaml` 에 `rateLimit` 이 처음 쓰일 때의 `.bak` 백업(단위 2 §3.1)은 U2-09 범위다.
- `util/TCPServer.ts` 가 `server/security/*` 를 import 하지 않는다.
- `getServerStatus` 가 새 객체를 돌려주도록 바꾸지 않는다.
- `AdminServer` 를 라우트 표로 바꾸지 않는다(U2-03). 두 분기만 `if/else` 체인에 더한다.
- 예외를 제어 흐름으로 쓰지 않는다. 검증 실패는 `{success: false, message}`.
- 새 코드의 `Date.now` 호출은 `AdminServer` 핸들러와 풀의 기존 관례 자리에서만.

## 수용 기준

- `test/unit/server/security/TunnelingOption.rateLimit.test.ts`
  - `defaultRateLimit('tcp').maxConnections === 30`, `('http')`·`('https')` 는 300, `(undefined)` 는 30. 나머지 필드는 `{enabled: true, windowMs: 60000, banMs: 600000, customized: false}`.
  - `normalizeRateLimit('http', undefined)` 가 `defaultRateLimit('http')` 와 깊은 동치.
  - `normalizeRateLimit('tcp', {maxConnections: 5})` 는 `{enabled: true, windowMs: 60000, maxConnections: 5, banMs: 600000, customized: false}`.
  - `windowMs: 999`, `windowMs: 3600001`, `maxConnections: 0`, `maxConnections: 100001`, `banMs: 86400001`, `windowMs: 1.5`, `windowMs: '60000'` 은 각각 `success: false` 이고 message 가 `rateLimit.<필드> must be an integer within <min>..<max>`.
  - `enabled: 'yes'`, `customized: 1`, `null`, `[]` 는 `success: false`.
  - `Object.freeze` 한 입력을 넣어도 통과한다(입력 불변).
- `test/unit/server/ServerOptionStore.rateLimit.test.ts` (임시 루트, 기존 `ServerOptionStore.test.ts` 방식)
  - `rateLimit` 없는 tcp 터널을 `verificationTunnelingOption(option, 'legacy-load')` 하면 `option.rateLimit` 이 `defaultRateLimit('tcp')`.
  - `rateLimit: {maxConnections: 0}` 이면 `success: false`, message 에 `rateLimit.maxConnections` 포함.
  - `rateLimit` 없는 터널 2개(tcp, http)를 담은 `server.yaml` 을 로드하면 `[0].rateLimit.maxConnections === 30`, `[1]` 은 300.
  - `verificationServerOption` 에 `rateLimit` 없는 터널을 담은 `tunnelingOptions` 를 주면 반환 옵션의 터널에 `rateLimit` 이 채워져 있다.
- `test/component/server/admission-tcp.test.ts` (실제 `TCPServer` + `net.connect`)
  - `admit: () => ({allowed: false, reason: 'rate-limit-ban'})` 인 서버에 접속하면 클라이언트 소켓이 1초 안에 `close` 되고 수신 0 바이트, `handlerCount === 0`, `setOnServerEvent` 콜백이 `Bound` 를 받지 않는다.
  - `admit: () => ({allowed: false, reason: 'concurrency-limit', rejectResponse: Buffer.from('X')})` 이면 클라이언트가 정확히 `X` 를 받은 뒤 `close` 되고 `handlerCount === 0`.
  - `admit: () => ({allowed: true})` 이면 `Bound` 가 한 번 오고 `handlerCount === 1`.
  - `admit` 이 없으면 `Bound` 가 온다(기존 동작).
  - `admit` 콜백 인자가 `'127.0.0.1'` 또는 `'::ffff:127.0.0.1'`.
- `test/component/server/ExternalPortServerPool.admission.test.ts` (실제 풀, `getFreePort`, `beforeEach` 에 `AdmissionController.resetForTest()`)
  - `rateLimit: {enabled: true, windowMs: 60000, maxConnections: 2, banMs: 60000, customized: false}` tcp 터널을 `startServer` 한 뒤 `net.connect` 3 번: 앞 둘 유지, 셋째 즉시 `close`(수신 0), `getServerStatus(port)` 가 `rejected.rateLimit === 1`, `bannedIps === 1`, `sessions === 2`.
  - `stop(port)` 뒤 `AdmissionController.instance.rateLimiter.stats(port)` 전부 0.
  - 다시 `startServer` 하면 2 번까지 허용된다.
  - `AdmissionController.instance` 에 주입된 세션 카운터가 위 상태에서 2 를 돌려준다(`configureConcurrency` 로 넘긴 함수를 컨트롤러가 `sessionCount(port)` 로 노출: U5-01 의 컨트롤러에 `sessionCount(port): number` 읽기 메서드를 이 이슈에서 추가).
- `test/component/server/admin/security-bans.test.ts` (실제 `AdminServer`, 세션은 `admin-routes.test.ts` 방식)
  - 세션 없이 `GET /api/security/bans` 는 401, `DELETE /api/security/bans/1/1.1.1.1` 도 401.
  - 세션으로 `GET` 이 200, `bans: []`, `serverTime` 숫자.
  - `AdmissionController.instance.configureTunnel({forwardPort: 20001, rateLimit: {enabled: true, windowMs: 60000, maxConnections: 1, banMs: 600000}})` 후 `admit` 을 `'203.0.113.9'` 로 2 회 부르면 `GET` 의 `bans[0]` 이 `{port: 20001, ip: '203.0.113.9', hits: 2}` 를 포함하고 `bannedUntil > serverTime`.
  - `DELETE /api/security/bans/20001/203.0.113.9`(CSRF 헤더 포함)가 `removed: true`, 이어 `GET` 이 `[]`. 같은 DELETE 를 다시 하면 `removed: false`. CSRF 헤더 없이 DELETE 는 403.
  - `DELETE /api/security/bans/70000/1.1.1.1` 은 400.
- `test/e2e/browser/rate-limit.test.ts` (프로세스 하네스, Jest 타임아웃 120초)
  - 터널: tcp `extra: {rateLimit: {enabled: true, windowMs: 5000, maxConnections: 5, banMs: 3000, customized: false}}` 와 http(기본값). 대상 `startTargetService()`.
  - tcp 포트 `net.connect` 5 회(연결 후 바로 `end`)는 모두 `connect` 를 받는다. 6 회째는 1초 안에 `close`, 수신 0 바이트.
  - `adminRequest('/api/security/bans')` 의 `bans` 에 해당 포트 항목이 1 개 있다.
  - 이어 100 회 더 시도한 뒤: `process.platform === 'linux'` 이면 `readRssMiB(harness.server.pid)` 를 1초 간격 3 회 읽어 그 최소값이 기동 직후 측정값 +32 MiB 이내이다. 다른 OS 에서는 이 단언만 건너뛴다.
  - `adminRequest('/api/externalServerStatuses')` 의 해당 포트 항목이 `rejected.rateLimit >= 96`, `bannedIps === 1`.
  - 3.5초 대기 뒤 `net.connect` 가 성공하고 `GET / HTTP/1.0\r\n\r\n` 을 보내면 `Target OK` 가 포함된 응답을 받는다. `adminRequest('/api/security/bans')` 의 `bans` 가 `[]`.
  - 브라우저: http 터널 `http://127.0.0.1:<fp>/` 를 10 회 새로고침해도 매번 `#ready` 텍스트가 `ready`(기본값 300). `page.on('pageerror')` 배열이 비어 있다.

기존 `test/component/server/**`, `test/unit/server/**`, `test/admin/**`, `test/e2e/tunnel/**` 가 그대로 통과한다.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/server test/component/server
npm run test:browser:install
npx jest --runInBand test/e2e/browser/rate-limit.test.ts
npm test -- --runInBand
git log -1 --format=%B   # 서명 0건, 제목에 단계 표식 없음 확인
```

## 선행 · 후행

- 선행: U5-01, U0-01.
- 후행: U5-03, U5-04, U5-08, U5-09. U2-03(라우트 표)이 이 이슈의 bans 라우트 2개를 표로 옮긴다.

## 근거 문서

- `docs/design/2026-09-11-unit5-connection-security.md` §2, §3.2, §4.4(상태 필드), §4.5(삽입·`admit` 래핑·`configureConcurrency`), §5(bans 임시 API), §8.1(rateLimit), §8.2(`admission-tcp`), §8.3(`rate-limit.test.ts`), §9(U5-02)
- `docs/design/2026-09-11-program-overview.md` §1 D9·D11, §3.1·3.2·3.4
- `docs/design/2026-09-11-unit0-verification-foundation.md` §3.2(`readRssMiB`, `adminRequest`), §3.3·§3.4(`large-transfer.test.ts` 의 RSS 규칙)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §9(U2-03 의 `routes.test.ts` 기대 목록)

---

## U5-03

**title**: feat(server): geoip-lite 국가 필터를 외부 포트와 관리자 포트 수락에 적용
**labels**: enhancement, area:server, unit:5
**body**:
## 목적

원격 IP 의 국가 코드로 접속을 허용·차단하는 서버 전역 설정(`connectionSecurity.geo`)을 도입한다. 이 이슈가 끝나면 모든 외부 포트와 관리자 페이지가 같은 판정을 받고, 설정은 `server.yaml` 에 저장되어 기동 시와 `/api/serverOption` 저장 시 런타임에 반영되며, 국가 DB 는 `mode: off` 인 서버에서는 메모리에 올라오지 않는다. 배포 바이너리(`pkg`)에 country DB 두 파일이 포함되고, DB 갱신 스크립트와 릴리스 절차 문서가 생긴다. 관리 API 권한과 화면은 후속 이슈다.

## 배경

- U5-01·02 의 `src/server/security/*`. `AdmissionController.admit` 의 3 단계 자리("geo — U5-03 이 삽입"), `denials(scope)` 의 geo 카운터(아직 항상 0).
- `src/server/admin/AdminServer.ts:74-108` 생성자. `:87` `https.createServer(options, …)`, `:91` `http.createServer(…)`. `:98-101` 영구 `'error'` 핸들러(주석: `removeAllListeners` 금지). `'connection'` 이벤트는 TLS 핸드셰이크 전 원시 소켓에서 발생한다. `:1269-1289` `close()`.
- `src/server/ServerApp.ts:26-35` `startService` 가 `:29` `TTTServer.create` → `:30` `new AdminServer` → `:31` `listen` → `:32` `tttServer.start()`.
- `src/server/TTTServer.ts:266-331` `applyServerOption(nextOption, previousOption)`. `:189-194` `controlOptionsChanged` 는 `port, tls, key, keepAlive, controlProtocolMode, allowLegacyControlAuth, trustedClients` 만 비교하므로 `connectionSecurity` 변경이 컨트롤 터널 재시작을 일으키지 않는다. `:196-254` `captureRuntimeState/restoreRuntimeState`(`:204` 시작)가 `_appliedServerOption` 을 저장·복원한다.
- `src/server/admin/AdminServer.ts:456-` `onUpdateServerOption`: `:463` `prepareServerOption` 실패 시 `:465` **400** `'Invalid server option'`(메시지 버림). `:549` `applyServerOption(serverOption, currentServerOption)`. 설계 §3.1 의 "422 메시지" 는 U5-05 의 `PUT /api/security/geo` 가 낸다. 기존 400 은 바꾸지 않는다.
- `src/server/ServerOptionStore.ts:339-402` `verificationServerOption`: 제자리 정규화, `{success, message, serverOption}` 반환, `warnings` 채널 없음.
- `src/types/TunnelingOption.ts:52-68` `type ServerOption`(`connectionSecurity` 없음).
- `package.json` `pkg` 블록 `{"scripts": "build/**/*.js", "targets": [...5개], "outputPath": "dist/bin/"}` — `assets` 없음. `dependencies` 에 `@types/*` 가 함께 있는 것이 관례. `scripts.lint` 는 `node scripts/lint-auth-compare.mjs src --strict`(비밀값 비교는 `timingSafeStringEqual` 만 허용).
- `test/unit/tools/deploy-gates.test.ts:96-99` 가 루트 `package.json` 을 읽어 단언하는 본보기(현재는 스테이지 순서와 스크립트 문자열만 검사).
- `test/supply-chain/r3-req-04-medium-cleared.test.ts` 가 `npm audit --omit=dev --audit-level=moderate` 0건 게이트다. `scripts/supply-chain-gate.cjs` 가 감사와 의존성 트리를 검사한다.
- `docs/guide/` 에 `release-checklist.md` 는 없다(생성). `scripts/` 에 `.mjs`/`.cjs` 스크립트가 있다.
- 컴포넌트 테스트 본보기: `test/component/server/admin/AdminServer.security.test.ts`(`new AdminServer({} as any, false)` → `listen(0)`, `test/helpers/http.ts` `httpRequest`).
- 설계 문서와 다른 점: `applyServerOption` 훅을 `TTTServer.applyConnectionSecurity()` 메서드로 두어 U5-05 의 `PUT /api/security/geo` 도 같은 진입점을 쓰게 한다. 경고 조건은 `allow` 뿐 아니라 `deny` 모드에도 적용한다(같은 조건에서 사설망 관리자 접속을 막는다).

먼저 열어 볼 파일: `src/server/security/AdmissionController.ts`, `src/server/admin/AdminServer.ts`(`:74-108`, `:456-580`), `src/server/ServerApp.ts`, `src/server/TTTServer.ts`(`:189-331`), `src/server/ServerOptionStore.ts`(`:339-402`), `src/types/TunnelingOption.ts`, `package.json`, `test/unit/tools/deploy-gates.test.ts`, `test/supply-chain/r3-req-04-medium-cleared.test.ts`, `node_modules/geoip-lite/lib/geoip.js`(설치 후: 데이터 디렉터리 결정 방식과 city→country 폴백).

### 전제하는 산출물

| 산출물 | 만드는 이슈 | 쓰는 곳 |
|---|---|---|
| `AdmissionController` 3 단계 자리·`denials` geo 카운터 | U5-01 | `GeoFilter` 삽입 |
| `ExternalPortServerPool` 의 `admit` 래핑, 상태 필드 `rejected.geo` | U5-02 | 컴포넌트·E2E |
| 프로세스 하네스 `adminAccess: false`(서버 stdout 의 `Listen - port:` 로 준비 판정), `serverOptionExtra`, `restartServer({serverOptionExtra})`, `server.stdoutChunks` | U0-01 | `geo-filter.test.ts` |

없으면 코멘트하고 중단한다.

## 적용되는 결정

- D10 국가 허용·차단 목록은 서버 전역 하나. 관리자 페이지에도 적용.
- D11 차단 IP 조회(레이트 리밋)가 국가 조회보다 먼저다.

## 만들 것

### 의존성·패키징

- `npm install --save geoip-lite@^1.4.10 @types/geoip-lite@^1.4.4` → `dependencies` 두 항목 + `package-lock.json` 갱신. 레지스트리 최신은 `geoip-lite@2.0.3` 이지만 설계 §4.3 의 `^1.4.10` 을 따른다.
- 설치 직후 `npx jest --runInBand test/supply-chain` 을 실행한다. `npm audit --omit=dev --audit-level=moderate` 게이트가 실패하면 **구현을 멈추고** 이슈에 감사 결과를 코멘트한다(게이트를 완화하거나 버전을 임의로 올리지 않는다).
- `pkg` 블록에 `"assets": ["node_modules/geoip-lite/data/geoip-country.dat", "node_modules/geoip-lite/data/geoip-country6.dat"]` 추가(city DB 제외 — 플랫폼 바이너리 5개 각각에 들어가므로 최소 크기).
- `scripts` 에 `"geoip:update": "node scripts/geoip-update.mjs"` 추가.

### `src/types/TunnelingOption.ts` (추가)

```ts
type GeoMode = 'off' | 'allow' | 'deny';
type GeoConfig = {mode: GeoMode; countries: string[]; applyToAdmin: boolean; unknownPolicy: 'allow' | 'deny'};
type ConnectionSecurityOption = {geo: GeoConfig};
const DEFAULT_GEO_CONFIG: Readonly<GeoConfig> = Object.freeze({mode: 'off', countries: [], applyToAdmin: true, unknownPolicy: 'allow'});
```
`ServerOption` 에 `connectionSecurity?: ConnectionSecurityOption` 추가. export 목록에 세 타입과 상수 추가.

### `src/server/security/countries.ts`

```ts
export const ISO_ALPHA2: ReadonlySet<string>;           // ISO 3166-1 alpha-2 공식 배정 249개, 대문자, 배열 리터럴로 적는다
export function countryName(code: string): string;       // new Intl.DisplayNames(['en'], {type: 'region'}).of(code) ?? code (인스턴스는 모듈 로드 시 1회)
export function listCountries(): Array<{code: string; name: string}>;   // name 오름차순(localeCompare 'en')
```

### `src/server/security/connectionSecurity.ts`

```ts
export function normalizeConnectionSecurity(input: unknown):
    {success: true; value: ConnectionSecurityOption; warnings: string[]} | {success: false; message: string};
```

- `undefined` → `{geo: {...DEFAULT_GEO_CONFIG}}`, warnings `[]`.
- 객체가 아니면 `'connectionSecurity must be an object'`. `geo` 없음 → 기본 geo; 객체가 아니면 `'connectionSecurity.geo must be an object'`.
- `mode` 없음 → `'off'`; 열거값 밖 → `'connectionSecurity.geo.mode must be one of off, allow, deny'`.
- `countries` 없음 → `[]`; 배열 아님 → `'connectionSecurity.geo.countries must be an array'`; 항목이 문자열 아님 → `'connectionSecurity.geo.countries[<i>] must be a string'`; `trim().toUpperCase()` 후 `ISO_ALPHA2` 에 없음 → `'connectionSecurity.geo.countries[<i>] is not an ISO 3166-1 alpha-2 code: <값>'`. 중복은 첫 등장만 남긴다.
- `applyToAdmin` 없음 → true; boolean 아님 → `'connectionSecurity.geo.applyToAdmin must be boolean'`.
- `unknownPolicy` 없음 → `'allow'`; 열거값 밖 → `'connectionSecurity.geo.unknownPolicy must be allow or deny'`.
- `mode === 'allow' && countries.length === 0` → `'allow mode requires at least one country'`.
- 경고(저장 허용): `mode !== 'off' && unknownPolicy === 'deny' && applyToAdmin === true` 면 `'unknownPolicy=deny with applyToAdmin=true also blocks private and loopback addresses from the admin console'`.
- 새 객체 반환, 알 수 없는 키 버림.

### `src/server/security/GeoFilter.ts`

```ts
export class GeoFilter {
    configure(config: GeoConfig): void;
    isDatabaseLoaded(): boolean;
    lookupCountry(ip: string): string | undefined;
    decide(ip: string, scope: AdmissionScope): AdmissionDecision;
    stats(): {rejected: number; lookups: number};
}
```

- `configure`: `countries` 를 `Set` 으로 보관. `mode !== 'off'` 이고 미로드면 그 시점에 `require('geoip-lite')`(파일 최상단 import 금지 — 로드 시 약 60MB). `off` 로 되돌려도 이미 로드된 DB 는 내리지 않는다.
- `lookupCountry(ip)`: `isPrivateAddress(ip)` → `undefined`(조회 없음). DB 미로드 → `undefined`(로드하지 않는다). 그 외 `lookups++` 후 `geoip.lookup(ip)?.country`.
- `decide(ip, scope)`: `mode === 'off'` → `ADMIT`. `scope.kind === 'admin' && !applyToAdmin` → `ADMIT`. `country = lookupCountry(ip)`; `undefined` → `unknownPolicy === 'allow' ? ADMIT : DENY`. `allow` → 목록에 있으면 `ADMIT` 아니면 `DENY`. `deny` → 목록에 있으면 `DENY` 아니면 `ADMIT`. `DENY = {allowed: false, reason: 'geo-deny'}` 상수, 반환 시 `rejected++`.

### `scripts/geoip-update.mjs`

`process.env.MAXMIND_LICENSE_KEY` 가 없으면 stderr 에 `MAXMIND_LICENSE_KEY is not set; keeping the bundled GeoLite2 database` 를 쓰고 종료 코드 2. 있으면 `spawnSync(process.execPath, ['node_modules/geoip-lite/scripts/updatedb.js', 'license_key=' + key], {stdio: 'inherit'})` 의 종료 코드로 끝난다.

### `docs/guide/release-checklist.md`

절 세 개: "GeoIP 데이터베이스"(MaxMind 키가 있으면 릴리스 전 `npm run geoip:update` 로 갱신, 없으면 패키지 동봉 DB 사용·수개월 오차 허용, 갱신 후 `npm run build && npm run pkg` 재실행, 바이너리에는 country DB 두 파일만 들어간다는 사실), "고지"(`node_modules/geoip-lite/README.md` License 절이 요구하는 MaxMind GeoLite2 attribution 문구를 그대로 옮기고 배포물 고지 문서에 포함), "확인란".

### 테스트 파일 (신규)

- `test/unit/server/security/GeoFilter.test.ts`
- `test/unit/server/security/geoip-country-fallback.test.ts`
- `test/unit/server/security/countries.test.ts`
- `test/unit/server/security/connectionSecurity.test.ts`
- `test/unit/server/ServerOptionStore.connectionSecurity.test.ts`
- `test/component/server/admission-admin.test.ts`
- `test/component/server/admission-geo-tunnel.test.ts`
- `test/e2e/browser/geo-filter.test.ts`

## 변경할 것

- `src/server/security/AdmissionController.ts`: `readonly geo: GeoFilter`, `configureGeo(config: GeoConfig): void`(생성 시 `DEFAULT_GEO_CONFIG`). `admit` 3 단계: `const g = this.geo.decide(ip, scope); if(!g.allowed) { <scope 키의 geo 카운터>++; return g; }` — admin 스코프에도 적용(레이트 리밋 단계만 건너뛴다). `denials(scope).geo` 가 카운터를 돌려준다.
- `src/server/admin/AdminServer.ts:101` 직후(생성자):
  ```ts
  this._server.on('connection', (socket) => {
      if(!AdmissionController.instance.admit({kind: 'admin'}, socket.remoteAddress).allowed) socket.destroy();
  });
  ```
- `src/server/TTTServer.ts`: `public applyConnectionSecurity(next: ConnectionSecurityOption | undefined): void` — `const geo = next?.geo ?? DEFAULT_GEO_CONFIG; AdmissionController.instance.configureGeo(geo); this._appliedServerOption.connectionSecurity = {geo: {...geo, countries: [...geo.countries]}};`. `applyServerOption`(`:266`) 의 `ttl` 검사 직후 `if(!ObjectUtil.canonicalEquals(previousOption.connectionSecurity?.geo ?? DEFAULT_GEO_CONFIG, nextOption.connectionSecurity?.geo ?? DEFAULT_GEO_CONFIG)) this.applyConnectionSecurity(nextOption.connectionSecurity);`. `restoreRuntimeState`(`:204-254`) 의 `_appliedServerOption` 복원 자리에서 `this.applyConnectionSecurity(state.serverOption.connectionSecurity)`. `controlOptionsChanged` 는 손대지 않는다.
- `src/server/ServerApp.ts:29` 직전: `AdmissionController.instance.configureGeo(serverOption.connectionSecurity?.geo ?? DEFAULT_GEO_CONFIG)`.
- `src/server/ServerOptionStore.ts` `verificationServerOption`: `trustedClients` 정규화 뒤 `return` 전에 `normalizeConnectionSecurity(option.connectionSecurity)` → 실패면 `{success: false, message}`, 성공이면 `option.connectionSecurity = value`(경고는 버린다; U5-05 가 같은 함수로 경고를 싣는다).
- `test/unit/tools/deploy-gates.test.ts`: 테스트 추가 —
  ```ts
  test("packaged binaries bundle the geoip-lite country databases", () => {
      expect(require('../../../package.json').pkg.assets).toEqual(expect.arrayContaining([
          'node_modules/geoip-lite/data/geoip-country.dat', 'node_modules/geoip-lite/data/geoip-country6.dat']));
      expect(require('../../../package.json').scripts['geoip:update']).toBe('node scripts/geoip-update.mjs');
  });
  ```

## 하지 말 것

- `/api/security/geo|countries|stats` 를 만들지 않는다(U5-04·05). 화면을 만들지 않는다(U5-06).
- `geoip-lite` 를 파일 최상단에서 `import` 하지 않는다. `mode: off` 서버가 DB 를 로드하면 안 된다.
- `pkg.assets` 에 city DB 나 `data/**/*` 글롭을 넣지 않는다.
- 외부 포트 판정에 두 번째 삽입점을 만들지 않는다(U5-02 의 `admit` 콜백 한 곳).
- `onUpdateServerOption` 의 400 을 422 로 바꾸지 않는다.
- 국가 코드 목록을 `Intl` 로 생성하려 하지 않는다(열거 API 없음). 리터럴로 적는다.
- `.bak` 백업(단위 2 §3.1)은 U2-09 범위.
- 공급망 게이트 실패를 우회하지 않는다(버전 상향·`--audit-level` 완화 금지, 중단·코멘트).
- 예외를 제어 흐름으로 쓰지 않는다(`geoip.lookup` 의 null 은 정상 분기).
- 테스트에서 특정 IP 의 국가를 하드코딩하지 않는다(`lookupCountry` 를 먼저 읽는다).

## 수용 기준

- `test/unit/server/security/countries.test.ts`
  - `ISO_ALPHA2.size === 249`, 모든 항목 `/^[A-Z]{2}$/`, `KR`·`US`·`AU` 포함.
  - `countryName('KR')` 이 비어 있지 않고 `'KR'` 이 아니다. `countryName('ZZ') === 'ZZ'`.
  - `listCountries()` 길이 249, `name` 오름차순.
- `test/unit/server/security/connectionSecurity.test.ts`
  - `undefined` → 기본값, warnings `[]`.
  - `{geo: {mode: 'allow', countries: ['kr', ' us ', 'KR']}}` → `countries` 가 `['KR','US']`.
  - `{geo: {mode: 'allow', countries: []}}` → `success: false`, `'allow mode requires at least one country'`.
  - `{geo: {mode: 'deny', countries: ['XX']}}` → `'connectionSecurity.geo.countries[0] is not an ISO 3166-1 alpha-2 code: XX'`.
  - `{geo: {mode: 'block'}}`, `{geo: {applyToAdmin: 'yes'}}`, `{geo: {unknownPolicy: 'maybe'}}`, `{geo: {countries: 'KR'}}`, `'text'` → 각각 `success: false`.
  - `mode: 'allow'`/`'deny'` + `countries: ['KR']` + `unknownPolicy: 'deny'` + `applyToAdmin: true` → 성공, warnings 길이 1. `applyToAdmin: false` → warnings `[]`.
- `test/unit/server/security/GeoFilter.test.ts` (각 테스트가 새 `GeoFilter`)
  - `configure({mode: 'off', …})` 뒤 `isDatabaseLoaded() === false`, `decide('8.8.8.8', {kind:'tunnel', port:1, protocol:'tcp'})` 허용, `stats().lookups === 0`.
  - `configure({mode: 'deny', countries: [], applyToAdmin: true, unknownPolicy: 'allow'})` 뒤 `isDatabaseLoaded() === true`.
  - `lookupCountry('8.8.8.8')`·`('1.1.1.1')` 이 각각 두 글자 대문자(`c1`, `c2` 로 읽어 둔다).
  - `mode: 'allow', countries: [c1]` → `8.8.8.8` 허용; `c2 !== c1` 이면 `1.1.1.1` 은 `{allowed: false, reason: 'geo-deny'}`.
  - `mode: 'deny', countries: [c1]` → `8.8.8.8` 이 `geo-deny`, `stats().rejected === 1`.
  - `127.0.0.1`, `10.0.0.1`, `::1` 은 `unknownPolicy: 'allow'` 면 허용, `'deny'` 면 `geo-deny`, `lookups` 불변.
  - `applyToAdmin: false` 면 `mode: 'deny', unknownPolicy: 'deny'` 에서도 `decide('127.0.0.1', {kind:'admin'})` 허용, `{kind:'tunnel', …}` 은 `geo-deny`.
- `test/unit/server/security/geoip-country-fallback.test.ts`
  - 임시 디렉터리에 `node_modules/geoip-lite/data/geoip-country.dat`·`geoip-country6.dat` **만** 복사하고(city 파일 없음) `jest.isolateModules` 안에서 `geoip-lite` 가 데이터 디렉터리를 결정하는 방식(`node_modules/geoip-lite/lib/geoip.js` 에서 확인: 환경 변수 `GEODATADIR` 또는 동등한 설정)으로 그 디렉터리를 가리키게 한 뒤 `require('geoip-lite').lookup('8.8.8.8')?.country` 가 두 글자 대문자이다. 데이터 디렉터리를 바꿀 방법이 없으면 이슈에 코멘트하고 이 테스트 대신 `pkg` 로 만든 바이너리에서 `--dev` 없이 `lookup` 이 되는지 수동 확인 절차를 `release-checklist.md` 에 적는다.
- `test/unit/server/ServerOptionStore.connectionSecurity.test.ts`
  - `connectionSecurity` 없는 `server.yaml` 로드 → `geo` 기본값.
  - `connectionSecurity: {geo: {mode: 'allow', countries: []}}` 인 `server.yaml` 은 로드 실패(`readServerOption().success === false`).
  - `verificationServerOption` 에 `{geo: {mode: 'deny', countries: ['kr']}}` → 반환 옵션 `countries` 가 `['KR']`.
- `test/component/server/admission-admin.test.ts` (실제 `AdminServer`, `beforeEach` 에 `resetForTest`)
  - `configureGeo({mode: 'deny', countries: ['US'], applyToAdmin: true, unknownPolicy: 'deny'})` 뒤 `httpRequest({port, path: '/api/version'})` 이 거부된다(`ECONNRESET` 또는 `socket hang up` 으로 reject).
  - `applyToAdmin: false` → 200. `unknownPolicy: 'allow'` → 200. `mode: 'off'` → 200 이고 `AdmissionController.instance.geo.isDatabaseLoaded() === false`.
- `test/component/server/admission-geo-tunnel.test.ts` (실제 `ExternalPortServerPool`)
  - `configureGeo({mode: 'deny', countries: [], applyToAdmin: true, unknownPolicy: 'deny'})` 에서 tcp 터널 `net.connect` 가 1초 안에 `close`, 수신 0, `getServerStatus(port).rejected.geo === 1`.
  - `unknownPolicy: 'allow'` 로 다시 `configureGeo`(리스너 재시작 없이) → 접속 유지.
- `test/e2e/browser/geo-filter.test.ts` (프로세스 하네스, `adminAccess: false`, Jest 타임아웃 120초)
  - `serverOptionExtra: {connectionSecurity: {geo: {mode: 'allow', countries: ['KR'], unknownPolicy: 'deny', applyToAdmin: true}}}` 로 기동 → stdout 에 `Listen - port: <fp>` 가 나타난 뒤 외부 포트 `net.connect` 가 1초 안에 `close`(수신 0), 관리자 포트 `https` 요청(`rejectUnauthorized: false`, `/api/version`)이 오류로 끝난다(상태 코드 없음).
  - `restartServer({serverOptionExtra: {connectionSecurity: {geo: {mode: 'allow', countries: ['KR'], unknownPolicy: 'allow', applyToAdmin: true}}}})` → 외부 포트 접속과 `/api/version` 200 모두 성공.
  - `restartServer({… unknownPolicy: 'deny', applyToAdmin: false})` → 외부 포트만 끊기고 `/api/version` 은 200.
- `test/unit/tools/deploy-gates.test.ts` 새 테스트 통과. `test/supply-chain/**` 통과.
- 기존 `test/component/server/admin/**` 전부 통과.

## 검증 명령

```
npm ci --include=dev
npx jest --runInBand test/supply-chain
npm run build
npm run lint
npx jest --runInBand test/unit/server test/unit/tools test/component/server
npm run test:browser:install
npx jest --runInBand test/e2e/browser/geo-filter.test.ts test/e2e/browser/rate-limit.test.ts
npm test -- --runInBand
git log -1 --format=%B   # 서명 0건, 제목에 단계 표식 없음 확인
```

## 선행 · 후행

- 선행: U5-02.
- 후행: U5-05(보안 관리 API).

## 근거 문서

- `docs/design/2026-09-11-unit5-connection-security.md` §1.2, §2(관리자 서버), §3.1, §4.3, §4.4(geo 단계), §4.5(`AdminServer`·`ServerApp`·`applyServerOption`), §8.1(Geo·countries·폴백), §8.2(`admission-admin`), §8.3(`geo-filter.test.ts`), §9(U5-03)
- `docs/design/2026-09-11-program-overview.md` §1 D10·D11, §3.1·3.2
- `docs/design/2026-09-11-unit0-verification-foundation.md` §3.2(`adminAccess`, `restartServer`)

---

## U5-04

**title**: feat(server): 접속 거절을 1분 단위로 집계해 로그와 통계 API 로 노출
**labels**: enhancement, area:server, unit:5
**body**:
## 목적

수락 판정에서 거절된 접속을 건마다 로그에 남기지 않고 포트·사유별로 1분에 한 줄로 묶어 기록한다. 함께 `AdmissionController.snapshot()` 을 만들어 포트별 거절 수·차단 IP 수를 한 번에 읽을 수 있게 하고, `GET /api/security/stats`(세션 검사만) 로 노출한다. 접속 시도 공격이 와도 로그가 공격 비용이 되지 않고, 운영자가 API 로 현재 거절 상황을 볼 수 있다. 권한은 U5-05 가 얹는다.

## 배경

- U5-01 의 `AdmissionController`: `admit` 이 거절을 돌려주는 지점(2·4 단계; U5-03 병합 후에는 3 단계도), `denials(scope)`, 30초 prune 타이머(`PRUNE_INTERVAL_MS`). `ConnectionRateLimiter.stats(port)`, `ports()`.
- 이 이슈는 U5-03 과 같은 파동(둘 다 U5-02 선행)이라 U5-03 산출물(`GeoFilter`, `GeoConfig`)에 의존하지 않는다. `snapshot()` 에 `geo` 설정을 합치는 것은 U5-05 가 한다. `admit` 의 거절 지점에 `record` 호출을 넣을 때 U5-03 이 먼저 병합되어 3 단계가 있으면 거기에도 넣고, 아니면 U5-03 담당자가 넣도록 이슈 코멘트를 남긴다.
- `src/server/admin/AdminServer.ts:247-` `routeGet` `if/else` 체인(U5-02 가 `/api/security/bans` 분기를 추가한 상태). `:843-850` `checkSession`. `:1330` `sendApiSuccess`. 이 이슈는 U2-03(라우트 표 전환)과 같은 파동이다: 착수 시 `AdminServer` 에 라우트 표(`ADMIN_ROUTES`)가 이미 있으면 표에 `action: 'session'` 항목으로 추가하고 `test/component/server/admin/routes.test.ts` 의 기대 목록에 `GET /api/security/stats` 를 더한다. 없으면 `if/else` 체인에 추가하고 U2-03 이 옮기도록 U2-03 이슈에 코멘트한다.
- `src/util/logger/LoggerFactory.ts:50` `LoggerFactory.getLogger(name, module?)`. 서버 모듈은 `getLogger('server', '<Module>')`.
- 세션을 얻는 테스트 방식: `test/component/server/admin/admin-routes.test.ts:35-42`.

먼저 열어 볼 파일: `src/server/security/AdmissionController.ts`, `src/server/security/ConnectionRateLimiter.ts`, `src/server/admin/AdminServer.ts`(`:247-290`, `:843-850`, `:1317-1340`), `test/component/server/admin/security-bans.test.ts`(U5-02, 세션 처리 재사용).

### 전제하는 산출물

| 산출물 | 만드는 이슈 |
|---|---|
| `AdmissionController`(`denials`, prune 타이머), `ConnectionRateLimiter.ports/stats` | U5-01 |
| `AdmissionController` 가 실제 풀에 연결됨, bans 라우트 | U5-02 |

없으면 코멘트하고 중단한다.

## 적용되는 결정

- D11 판정 경로의 비용을 늘리지 않는다. 집계는 카운터 증가 한 번이다.

## 만들 것

### `src/server/security/DenialAggregator.ts`

```ts
import {AdmissionReason, AdmissionScope} from "./AdmissionPolicy";
export const DENIAL_LOG_WINDOW_MS = 60_000;
export class DenialAggregator {
    constructor(sink: (line: string) => void, windowMs: number = DENIAL_LOG_WINDOW_MS);
    record(scope: AdmissionScope, reason: AdmissionReason, now: number): void;
    flushDue(now: number): number;     // windowStart + windowMs <= now 인 버킷을 sink 로 내보내고 삭제. 내보낸 줄 수
    flushAll(now: number): number;     // 모든 버킷을 내보내고 삭제
    pending(): number;                 // 아직 내보내지 않은 버킷 수
}
```

- 버킷 키 `` `${scope.kind === 'admin' ? 'admin' : scope.port}|${reason}` ``, 값 `{scopeLabel, reason, count, windowStart}`. `record`: 없으면 `{count: 1, windowStart: now}`, 있으면 `count++`.
- 줄 형식(정확히): `admission denied port=<scopeLabel> reason=<reason> count=<count> (last <초>s)`, `<초>` 는 `Math.round(windowMs / 1000)`. 예 `admission denied port=20001 reason=rate-limit-ban count=1532 (last 60s)`, 관리자는 `port=admin`.
- `flushDue`/`flushAll`: 버킷을 먼저 지우고 나서 `sink` 를 부른다(sink 가 던져도 버킷은 남지 않는다).
- 시각은 인자로만 받는다.

### `AdmissionController` 확장

```ts
readonly denialLog: DenialAggregator;    // sink = (line) => logger.warn(line), logger = LoggerFactory.getLogger('server', 'Admission')
snapshot(): {ports: Record<string, {rejectedBans: number; rejectedExceeded: number; rejectedGeo: number; bannedIps: number}>; admin: {rejectedGeo: number}};
```

### `GET /api/security/stats`

- `checkSession` 실패 401. 성공 시 `sendApiSuccess(res, {serverTime: Date.now(), stats: AdmissionController.instance.snapshot()})`.
- 응답 예:
  ```json
  {"success":true,"partial":false,"failedScopes":[],"warnings":[],"message":"","serverTime":1757548800000,
   "stats":{"ports":{"20001":{"rejectedBans":12,"rejectedExceeded":3,"rejectedGeo":0,"bannedIps":1}},"admin":{"rejectedGeo":0}}}
  ```

### 테스트 파일 (신규)

- `test/unit/server/security/DenialAggregator.test.ts`
- `test/unit/server/security/AdmissionController.snapshot.test.ts`
- `test/component/server/admin/security-stats.test.ts`

## 변경할 것

- `src/server/security/AdmissionController.ts`: `denialLog` 생성; `admit` 이 거절 판정을 반환하는 모든 지점 직전에 `this.denialLog.record(scope, decision.reason, now)`(거절 한 건당 호출 하나); prune 타이머 콜백을 `const now = Date.now(); this.rateLimiter.prune(now); this.denialLog.flushDue(now);` 로; `resetForTest` 는 타이머만 지우고 버킷은 버린다(flush 하지 않음); `snapshot()` 은 `rateLimiter.ports()` 각각의 `stats(port)` + `denials(port).geo` 를 합쳐 `ports[String(port)]`, `admin.rejectedGeo = denials('admin').geo`.
- `src/server/admin/AdminServer.ts`: stats 라우트와 핸들러 `onGetSecurityStats`.

## 하지 말 것

- 거절 한 건마다 로그를 남기지 않는다. `logger.warn` 은 sink 에서만.
- `/api/security/geo|countries` 를 만들지 않는다(U5-05). 권한 검사를 넣지 않는다(세션만).
- `snapshot()` 에 `GeoFilter` 설정을 넣지 않는다(U5-03 에 의존하지 않는다).
- 타이머를 하나 더 만들지 않는다(30초 prune 타이머 공유).
- `DenialAggregator` 안에서 `Date.now` 를 호출하지 않는다.
- 예외를 제어 흐름으로 쓰지 않는다. sink 오류를 잡아 재시도하지 않는다.

## 수용 기준

- `test/unit/server/security/DenialAggregator.test.ts` (sink 는 배열 push, `windowMs: 60000`)
  - 포트 20001 `rate-limit-ban` 을 `now=0..1531`(1,532 회) `record` 후 `flushDue(59_999)` 는 0 이고 배열이 비어 있다.
  - `flushDue(60_000)` 은 1 이고 유일한 줄이 정확히 `admission denied port=20001 reason=rate-limit-ban count=1532 (last 60s)`.
  - 같은 포트 `rate-limit-exceeded` 와 `{kind:'admin'}` `geo-deny` 를 1 회씩 `record` 후 `flushAll(0)` 이 2 이고 `port=20001 reason=rate-limit-exceeded count=1`, `port=admin reason=geo-deny count=1` 이 각각 하나.
  - flush 뒤 같은 키를 다시 `record` 하면 새 창으로 시작한다(`flushDue(그 시각 + 59_999)` 가 0).
  - sink 가 던져도 `flushAll` 이 던지지 않고 `pending() === 0`.
- `test/unit/server/security/AdmissionController.snapshot.test.ts`
  - `configureTunnel` 로 포트 1(`maxConnections: 1`) 설정 후 같은 IP 로 `now=0,1,2` 3 회 `admit` → `snapshot()` 이 `{ports: {"1": {rejectedBans: 1, rejectedExceeded: 1, rejectedGeo: 0, bannedIps: 1}}, admin: {rejectedGeo: 0}}`.
  - 그 상태에서 `denialLog.pending() === 2`, `denialLog.flushDue(60_000) === 2`.
  - `releaseTunnel(1)` 뒤 `snapshot().ports` 가 `{}`.
- `test/component/server/admin/security-stats.test.ts` (실제 `AdminServer`)
  - 세션 없이 401. 세션으로 200, body 가 `{success: true, stats: {ports: {}, admin: {rejectedGeo: 0}}}` 포함, `serverTime` 숫자.
  - `configureTunnel({forwardPort: 20001, rateLimit: {enabled: true, windowMs: 1000, maxConnections: 1, banMs: 1000}})` 후 같은 IP 로 2 회 `admit` 하면 `stats.ports["20001"].rejectedExceeded === 1`.
  - `Cache-Control` 이 `no-cache, no-store, must-revalidate`.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/server/security test/component/server/admin
npm test -- --runInBand
git log -1 --format=%B   # 서명 0건, 제목에 단계 표식 없음 확인
```

## 선행 · 후행

- 선행: U5-02.
- 후행: U5-05(권한·`geo` 합치기), U5-08(`conn_limit_hit` 집계가 같은 원칙).

## 근거 문서

- `docs/design/2026-09-11-unit5-connection-security.md` §4.4(집계 로그·snapshot), §5(`GET /api/security/stats`), §9(U5-04)
- `docs/design/2026-09-11-program-overview.md` §3.1, §3.4
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §5.1·§9(U2-03 라우트 표)

---

## U5-05

**title**: feat(server): 보안 관리 API 에 security:manage 권한·감사 이벤트 적용, geo·countries 추가
**labels**: enhancement, area:server, unit:5
**body**:
## 목적

슈퍼유저가 국가 필터를 읽고 저장하며(`geo`), 국가 목록을 받고(`countries`), 차단 목록을 보고 해제하며(`bans`, U5-02 의 임시 라우트), 거절 통계를 조회하는(`stats`, U5-04) REST API 를 완성한다. 여섯 라우트 전부 단위 2 의 라우트 표에 `security:manage` 로 등록되어 일반 유저에게 403 이고, 상태 변경은 CSRF 를 받으며, 국가 필터 저장과 차단 해제는 감사 이벤트로 남는다. U5-06 의 화면이 붙을 수 있게 된다.

## 배경

- U5-02 의 `GET/DELETE /api/security/bans*`(세션 검사만), U5-04 의 `GET /api/security/stats`(세션 검사만), U5-03 의 `normalizeConnectionSecurity(input)`(warnings 포함), `listCountries()`, `TTTServer.applyConnectionSecurity(next)`, `GeoFilter.lookupCountry(ip)`(DB 미로드면 `undefined`).
- 단위 2 산출물: `AdminServer` 라우트 표(`Route = {method, pattern: RegExp, action, handler}`, `RouteContext = {req, res, params, principal, ip}`, U2-03), `route()` 의 세션·`authorize` 흐름과 `Action` 의 `'security:manage'`(슈퍼유저만, U2-04), `audited(req, principal, type, target, fn)`·`AuditSinkRegistry`(U2-05), 슈퍼유저·일반 유저 세션을 만드는 테스트 방식(`test/component/server/admin/rbac-users-groups.test.ts`, U2-06), `AuthorizationContext`(U2-08).
- `src/server/ServerOptionStore.ts:47-57` `runConfigurationMutation`, `:59-63` `serverOption`(깊은 복사), `:110-120` `commitPreparedServerOption`.
- `src/server/admin/AdminServer.ts:1317-1340` 응답 헬퍼. CSRF 실패는 `:1520-1555` 403 `'Missing CSRF token'`/`'CSRF token mismatch'`. 비밀값 비교는 `timingSafeStringEqual`(`src/util/timingSafeStringEqual.ts`)만 허용(`npm run lint`).

### 전제하는 산출물

| 산출물 | 만드는 이슈 |
|---|---|
| 라우트 표·`route()` 세션 흐름 | U2-03 |
| `AdminAuthorizer`·`'security:manage'`·`route()` 의 `authorize` 호출 | U2-04 |
| `audit/AuditSink.ts`(`AuditEvent`, `AuditSinkRegistry`), `AdminServer.audited()` | U2-05 |
| 슈퍼유저·일반 유저 세션 테스트 방식 | U2-06 |
| `AuthorizationContext`, 터널 소유권 | U2-08 |
| `connectionSecurity.ts`, `countries.ts`, `applyConnectionSecurity`, `GeoFilter.lookupCountry` | U5-03 |
| `snapshot()`, stats 라우트 | U5-04 |

없으면 코멘트하고 중단한다.

먼저 열어 볼 파일: `src/server/admin/AdminServer.ts`(라우트 표, `audited`), `src/server/admin/routes.ts`(U2-03), `src/server/rbac/AdminAuthorizer.ts`, `src/server/audit/AuditSink.ts`, `src/server/security/{connectionSecurity,countries,AdmissionController,GeoFilter,ConnectionRateLimiter}.ts`, `test/component/server/admin/rbac-users-groups.test.ts`, `test/component/server/admin/routes.test.ts`.

## 적용되는 결정

- D10 국가 필터는 서버 전역. 터널 소유자가 만질 설정이 아니므로 슈퍼유저 전용.

## 만들 것

### 라우트 (모두 `action: 'security:manage'`)

| 메서드·경로 | pattern | 요청 | 응답 |
|---|---|---|---|
| `GET /api/security/geo` | `/^\/api\/security\/geo$/` | — | `{geo: GeoConfig}` |
| `PUT /api/security/geo` | 같음 | `GeoConfig`(부분 허용) | `{geo, warnings}` 또는 422 |
| `GET /api/security/countries` | `/^\/api\/security\/countries$/` | — | `{countries: Array<{code, name}>}` |
| `GET /api/security/bans` | `/^\/api\/security\/bans$/` | — | `{serverTime, bans: Array<{port, ip, country?, bannedUntil, hits}>}` |
| `DELETE /api/security/bans/:port/:ip` | `/^\/api\/security\/bans\/(\d{1,5})\/([^/]+)$/` | — | `{removed: boolean}` |
| `GET /api/security/stats` | `/^\/api\/security\/stats$/` | — | `{serverTime, stats}` |

요청·응답 예:

```
GET /api/security/geo
→ 200 {"success":true,"partial":false,"failedScopes":[],"warnings":[],"message":"",
       "geo":{"mode":"off","countries":[],"applyToAdmin":true,"unknownPolicy":"allow"}}

PUT /api/security/geo   (X-CSRF-Token 필수)
   {"mode":"allow","countries":["kr","us"],"applyToAdmin":true,"unknownPolicy":"deny"}
→ 200 {"success":true,…,"warnings":["unknownPolicy=deny with applyToAdmin=true also blocks private and loopback addresses from the admin console"],
       "geo":{"mode":"allow","countries":["KR","US"],"applyToAdmin":true,"unknownPolicy":"deny"}}
   {"mode":"allow","countries":[]}
→ 422 {"success":false,"status":422,"message":"allow mode requires at least one country"}

GET /api/security/countries
→ 200 {"success":true,…,"countries":[{"code":"AF","name":"Afghanistan"},…]}   (249개, name 오름차순)

GET /api/security/bans
→ 200 {"success":true,…,"serverTime":1757548800000,
       "bans":[{"port":20001,"ip":"203.0.113.9","country":"US","bannedUntil":1757549400000,"hits":31}]}

DELETE /api/security/bans/20001/203.0.113.9
→ 200 {"success":true,…,"removed":true}

GET /api/security/stats
→ 200 {"success":true,…,"serverTime":…,"stats":{"geo":{…GeoConfig},"ports":{"20001":{…}},"admin":{"rejectedGeo":0}}}
```

### 핸들러 규칙

- `GET geo`: `ServerOptionStore.instance.serverOption.connectionSecurity?.geo ?? DEFAULT_GEO_CONFIG`.
- `PUT geo`: `normalizeConnectionSecurity({geo: body})` 실패 → 422 `{message}`. 성공 → `runConfigurationMutation` 안에서 `serverOption = store.serverOption; serverOption.connectionSecurity = value; commitPreparedServerOption(serverOption)`; 실패 500 `'Unable to commit server option.'`; 성공 → `this._tttServer.applyConnectionSecurity(value)` → `{geo: value.geo, warnings}`. `audited(req, principal, 'security_geo_updated', {kind: 'security', id: 'geo'}, …)`, `summary` `` `country filter set to ${mode}` ``, `detail` `{mode, countries, applyToAdmin, unknownPolicy}`.
- `GET countries`: `listCountries()`.
- `GET bans`(U5-02 핸들러를 표로 옮기며 확장): 각 항목에 `country: AdmissionController.instance.geo.lookupCountry(ip)`(`undefined` 면 키 생략). DB 미로드 상태에서 로드를 유발하지 않는다.
- `DELETE bans`(U5-02 핸들러를 표로 옮김): `params.port` `Number`, `params.ip` `decodeURIComponent`. `audited(req, principal, 'security_ban_removed', {kind: 'security', id: `${port}/${ip}`}, …)`, `summary` `` `ban removed port=${port} ip=${ip}` ``, `detail: {port, ip, removed}`.
- `GET stats`(U5-04 핸들러를 표로 옮기며 확장): `{serverTime, stats: {geo: <현재 GeoConfig>, ...AdmissionController.instance.snapshot()}}`.

### 테스트 파일 (신규)

- `test/component/server/admin/security-api.test.ts`

## 변경할 것

- `src/server/admin/AdminServer.ts`(및 `routes.ts`): U5-02·U5-04 가 만든 세 라우트의 `action` 을 `'session'` 에서 `'security:manage'` 로 바꾸고 새 라우트 세 개를 추가한다. 핸들러가 `checkSession` 을 직접 부르지 않게 한다.
- `test/component/server/admin/routes.test.ts`(U2-03): 기대 목록에 `GET/PUT /api/security/geo`, `GET /api/security/countries` 를 더한다.
- `test/component/server/admin/security-bans.test.ts`(U5-02), `security-stats.test.ts`(U5-04): "세션만 있으면 200" 케이스를 "슈퍼유저 200, 일반 유저 403" 으로 갱신한다(삭제하지 않는다).
- `src/server/audit/AuditSink.ts` 에 이벤트 타입 상수 목록이 있으면 `'security_geo_updated'`, `'security_ban_removed'` 를 추가한다.
- `test/component/server/admin/audit-sink.test.ts`(U2-05)가 라우트 표의 CUD 항목을 전수 순회한다면 PUT·DELETE 두 개가 자동으로 검사된다. 통과해야 한다.

## 하지 말 것

- 화면을 만들지 않는다(U5-06).
- `POST /api/tunnelingOption` 의 `rateLimit` 처리를 바꾸지 않는다.
- `PUT geo` 를 `TTTServer.applyServerOption` 으로 우회하지 않는다(`applyConnectionSecurity` 를 부른다).
- `GET bans` 에서 국가 DB 를 강제로 로드하지 않는다.
- 일반 유저에게 부분 정보를 주지 않는다(전부 403).
- `/api/login`·`/api/version` 외의 CSRF 예외를 만들지 않는다.
- 비밀값을 `===` 로 비교하지 않는다(lint). 이 이슈의 경로 파라미터(port, ip)는 비밀값이 아니다.
- 예외를 제어 흐름으로 쓰지 않는다.

## 수용 기준

- `test/component/server/admin/security-api.test.ts` (실제 `AdminServer` + 스텁 `TTTServer`(`applyConnectionSecurity` 호출 기록), 슈퍼유저 세션 `su`, 일반 유저 세션 `ru`, `AuditSinkRegistry.set(수집기)`, `beforeEach` 에 `AdmissionController.resetForTest()`)
  - 세션 없이 여섯 라우트 각각 401. `ru` 로 각각 403.
  - `su` `GET /api/security/geo` 200, `geo` 기본값.
  - `su` `PUT /api/security/geo` 에 CSRF 헤더 없이 → 403 `'Missing CSRF token'`.
  - `su` + CSRF 로 `{mode:'allow', countries:['kr','us'], unknownPolicy:'deny'}` PUT → 200, `geo.countries` `['KR','US']`, `warnings` 길이 1, 스텁 `applyConnectionSecurity` 1 회 호출, 임시 루트 `config/server.yaml` 에 `connectionSecurity:` 와 `mode: allow`, 수집기에 `{type: 'security_geo_updated', outcome: 'success', target: {kind:'security', id:'geo'}}` 1 건.
  - `{mode:'allow', countries:[]}` PUT → 422 `'allow mode requires at least one country'`, 수집기에 `security_geo_updated` `outcome: 'failure'` 1 건 추가.
  - `GET /api/security/countries` 200, 249 개, `name` 오름차순.
  - `configureTunnel({forwardPort: 20001, rateLimit: {enabled:true, windowMs: 60000, maxConnections: 1, banMs: 600000}})` 후 `admit` 을 `'203.0.113.9'` 로 2 회 → `GET bans` 의 `bans[0]` 이 `{port: 20001, ip: '203.0.113.9', hits: 2}` 포함, `bannedUntil > serverTime`, `country` 키 없음(DB 미로드).
  - `DELETE /api/security/bans/20001/203.0.113.9` → `removed: true`, 수집기에 `security_ban_removed` 성공 1 건, 이어 `GET bans` 가 `[]`; 재시도 `removed: false`.
  - `DELETE /api/security/bans/20001/%3A%3Affff%3A1.2.3.4` → 200, `removed: false`.
  - `GET /api/security/stats` → `stats.geo.mode === 'allow'`(위 PUT 이후), `stats.ports["20001"]` 존재, `stats.admin.rejectedGeo === 0`.
- `routes.test.ts`, `audit-sink.test.ts`, `security-bans.test.ts`, `security-stats.test.ts` 와 기존 `test/component/server/admin/**`, `test/admin/**` 전부 통과.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/component/server/admin test/unit/server
npm test -- --runInBand
git log -1 --format=%B   # 서명 0건, 제목에 단계 표식 없음 확인
```

## 선행 · 후행

- 선행: U5-03, U5-04, U2-08.
- 후행: U5-06(보안 화면).

## 근거 문서

- `docs/design/2026-09-11-unit5-connection-security.md` §5, §9(U5-05)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §4.4(`security:manage`), §4.6(`AuditSink`·`audited`), §5.1(라우트 표), §9(U2-03~07)
- `docs/design/2026-09-11-program-overview.md` §3.4

---

## U5-06

**title**: feat(admin): 보안 화면과 터널 편집의 Rate limit 카드, 터널 카드 Blocked 표시
**labels**: enhancement, area:frontend, unit:5
**body**:
## 목적

슈퍼유저가 관리자 UI 에서 국가 필터를 설정하고 차단된 IP 를 해제하는 "Security" 화면을 만들고, 터널 편집 화면에 접속 레이트 리밋 카드를 넣으며, 터널 카드에 거절 건수를 표시한다. 단위 5 의 모든 설정이 화면에서 편집된다.

## 배경

- 단위 1: `admin/src/router.ts`(`Screen`, `parseHash`, `navigate`), `admin/src/nav.ts`(`NAV`), `admin/src/shell/Drawer.svelte`, `admin/src/ui/*`(`Button Field TextInput NumberInput Select Checkbox Switch Card Chip Badge Modal Toast toast`), `admin/src/screens/TunnelsScreen.svelte`, `admin/src/screens/TunnelEditScreen.svelte`(필드 id `input-external-port` … `select-protocol`, `_onChangeProtocol`, 하단 고정 바).
- 단위 2 U2-10: `LoginCtrl.login(username, password)`, `admin/src/me.ts` 의 `me` 스토어, Drawer 의 "Sign out".
- 단위 3: U3-01 `rbac` fixture(슈퍼유저 `admin`, 일반 유저 `alice`)·`startAdminApp({fixture, loginAs})`·`section` 기반 NAV 필터·라우트 가드·`#/denied`, NAV 순서 "Status, Tunnels, Server settings, Users, Groups, Security(5 단위), Audit log(4), Sessions(4), My account", 컨트롤러 패턴(`controller/*Ctrl.ts` `instance` 싱글턴, `adminRequest`), `controller/Types.ts`; U3-06 터널 화면의 소유권·읽기 전용 반영.
- 단위 2 §4.4: 슈퍼유저 `sections` 에 `'security'` 가 이미 포함된다. 일반 유저에게는 없다.
- U5-05 의 API 여섯 개. 백엔드 드라이버(`test/admin/admin-backend-driver.ts`, 실제 `AdminServer` + 스텁 `TTTServer`, IPC `{type:'calls'}`)가 띄우는 `AdminServer` 에 그대로 존재하고, 드라이버 프로세스의 `AdmissionController.instance` 가 실제 리미터다.
- U5-02 의 `RateLimitOption`·`defaultRateLimit`, 상태 필드 `rejected/bannedIps`. 스텁 `externalServerStatuses`(단위 1 §8.2)는 `{port, online, active, sessions, rx, tx, uptime, activeStart, activeTimeout}` 만 돌려준다.

### 전제하는 산출물

| 산출물 | 만드는 이슈 |
|---|---|
| `ui/*`, `router.ts`, `nav.ts`, `Drawer.svelte` | U1-02~04 |
| `TunnelsScreen.svelte`, `TunnelEditScreen.svelte` | U1-08, U1-09 |
| `me` 스토어·로그아웃 | U2-10 |
| `rbac` fixture, `startAdminApp({fixture:'rbac', loginAs})`, section 필터·가드 | U3-01 |
| 터널 화면 소유권·읽기 전용 | U3-06 |
| `/api/security/*` 전부(권한 포함) | U5-05 |

없으면 코멘트하고 중단한다.

먼저 열어 볼 파일: `admin/src/router.ts`, `admin/src/nav.ts`, `admin/src/screens/TunnelsScreen.svelte`, `admin/src/screens/TunnelEditScreen.svelte`, `admin/src/controller/Types.ts`, `admin/src/controller/ServerOptionCtrl.ts`, `test/admin/admin-backend-driver.ts`, `test/helpers/adminApp.ts`, `test/admin/screen-tunnels.test.ts`, `test/admin/screen-access.test.ts`.

## 적용되는 결정

- D5 UI 문구 영어 단일.
- D9 프로토콜 변경 시 사용자가 직접 고치지 않은 값만 새 기본값으로(`customized`).
- D10 국가 필터는 전역·슈퍼유저 전용.

## 만들 것

### `admin/src/controller/Types.ts` (추가)

```ts
export type GeoConfig = {mode: 'off' | 'allow' | 'deny'; countries: string[]; applyToAdmin: boolean; unknownPolicy: 'allow' | 'deny'};
export type CountryEntry = {code: string; name: string};
export type BanEntry = {port: number; ip: string; country?: string; bannedUntil: number; hits: number};
export type RateLimitOption = {enabled: boolean; windowMs: number; maxConnections: number; banMs: number; customized: boolean};
```
`TunnelingOption` 타입에 `rateLimit?: RateLimitOption`, 상태 타입에 `rejected?: {geo: number; rateLimit: number}; bannedIps?: number` 추가.

### `admin/src/util/rateLimit.ts`

`defaultRateLimit(protocol: 'tcp' | 'http' | 'https' | undefined): RateLimitOption` — 서버(`src/types/TunnelingOption.ts`)와 같은 값(tcp/undefined 30, http/https 300, windowMs 60000, banMs 600000, enabled true, customized false). 관리자 번들은 서버 TS 를 import 하지 않으므로 사본이며, 값이 다르면 서버 응답이 기준이다.

### `admin/src/controller/SecurityCtrl.ts` (`instance` 싱글턴)

| 메서드 | API |
|---|---|
| `getGeo(): Promise<GeoConfig>` | `GET /api/security/geo` |
| `putGeo(geo): Promise<{geo: GeoConfig; warnings: string[]}>` | `PUT /api/security/geo`(422 는 `message` 를 담은 오류로, 기존 컨트롤러 관례) |
| `countries(): Promise<CountryEntry[]>` | `GET /api/security/countries` |
| `bans(): Promise<{serverTime: number; bans: BanEntry[]}>` | `GET /api/security/bans` |
| `unban(port, ip): Promise<boolean>` | `DELETE /api/security/bans/${port}/${encodeURIComponent(ip)}` |

### 라우트·NAV

- `router.ts`: `Screen` 에 `'security'`, `#/security` → `{screen: 'security'}`, `App.svelte` title 표에 `security → "Security"`, back 없음, `section: 'security'`.
- `nav.ts`: Groups 다음, Audit log 앞에 `{hash: '#/security', title: 'Security', screen: 'security', section: 'security'}`.

### `admin/src/screens/SecurityScreen.svelte`

마운트 시 `getGeo()`, `countries()`, `bans()` 병렬 호출. `bans()` 는 10초 `setInterval` 갱신, 언마운트 시 `clearInterval`. `InvalidSession` 이면 `sessionInvalid()`.

**"Country filter" 카드** (`Card label="Country filter"`):
- `Select id="geo-mode"` options `[{value:'off', label:'Off'}, {value:'allow', label:'Allow only listed'}, {value:'deny', label:'Deny listed'}]`.
- 선택된 국가 칩 `<div id="geo-selected">`: `Chip mono` 텍스트 `{CODE}` + `<button aria-label="Remove {CODE}">×</button>`. `mode === 'off'` 면 국가 영역 전체 `disabled`.
- `TextInput id="geo-country-filter" placeholder="Filter countries"`(name·code 부분 일치, 대소문자 무시).
- `<div id="geo-country-list">`: 필터 결과마다 `Checkbox id="geo-country-{CODE}" label="{name} ({CODE})"`. 체크 → 선택에 추가, 해제 → 제거.
- `Checkbox id="geo-apply-admin" label="Apply to admin console"`.
- `Select id="geo-unknown-policy"` options `[{value:'allow', label:'Allow unknown/private addresses'}, {value:'deny', label:'Deny unknown/private addresses'}]`.
- `Button id="geo-save" variant="primary"` "Save" — 로드 값과 다를 때만 enabled. 성공 → `toast.push({tone:'pulse', message:'Country filter saved.'})`, `warnings` 각각 `toast.push({tone:'warn', message})`, 기준값 갱신. 422 → `<p id="geo-error" role="alert">` 에 서버 message.
- `mode === 'allow'` 이고 선택 0 개면 Save disabled + `#geo-error` 에 `Allow mode requires at least one country.`(클라이언트 선검사).

**"Banned addresses" 카드** (`Card label="Banned addresses"`):
- `<table id="ban-table">` 헤더 `Port · IP · Country · Remaining · (빈칸)`. 행 `<tr data-ban="{port}/{ip}">`: port(mono), ip(mono), country(없으면 `—`), remaining(`bannedUntil - serverTime` 을 `m:ss`, 응답 `serverTime` 기준, 1초마다 감소), `Button size="sm"` "Unban".
- Unban → `unban(port, ip)` → 재조회 → `toast.push({tone:'pulse', message:`Unbanned ${ip}.`})`.
- 비면 표 대신 `<p id="ban-empty">No banned addresses.</p>`.

### `TunnelEditScreen.svelte` "Rate limit" 카드

`select-protocol` 아래, HTTP options 절 앞에 `Card label="Rate limit"`:
- `Switch ariaLabel="Rate limit enabled"`(`on = option.rateLimit.enabled`).
- `Field label="Window (seconds)"` + `NumberInput id="input-rate-window" min=1 max=3600`(값 `Math.round(windowMs / 1000)`, 저장 시 ×1000).
- `Field label="Max connections per IP"` + `NumberInput id="input-rate-max" min=1 max=100000`.
- `Field label="Ban duration (minutes)"` + `NumberInput id="input-rate-ban" min=1 max=1440`(값 `Math.round(banMs / 60000)`, 저장 시 ×60000).
- 힌트 문구(정확히): `Blocks an IP that opens more than N connections within the window. Browsers open several connections per page; keep HTTP limits higher.`
- 세 NumberInput 중 하나라도 `oninput` → `option.rateLimit.customized = true`.
- `_onChangeProtocol` 끝: `if(!option.rateLimit.customized) option.rateLimit = defaultRateLimit(newProtocol)`.
- 새 터널의 초기 `rateLimit` 은 `defaultRateLimit('tcp')`. 기존 터널은 서버 값.
- 저장 본문에 `rateLimit` 포함. 범위 밖 값은 `Field error`(`1..3600` 형식) + 저장 버튼 disabled(기존 buffer limit 검증 방식).
- 읽기 전용 터널(U3-06)에서는 카드 입력 전부 disabled.

### `TunnelsScreen.svelte` 카드 2행

online 카드 mono 상태 문자열 끝에 `n = (status.rejected?.rateLimit ?? 0) + (status.rejected?.geo ?? 0)` 가 0 보다 크면 ` · Blocked {n}` 을 `<span data-blocked>` 로 덧붙인다. 0 이면 그리지 않는다.

### 테스트 보조 (변경)

- `test/admin/admin-backend-driver.ts`: 스텁 `externalServerStatuses` 항목에 `rejected`·`bannedIps` 추가 — 포트 20001 `{geo: 0, rateLimit: 0}`·0, 포트 20002 `{geo: 2, rateLimit: 5}`·1. IPC `{type: 'seed-ban', port, ip}` 를 받으면 `AdmissionController.instance.configureTunnel({forwardPort: port, rateLimit: {enabled: true, windowMs: 60000, maxConnections: 1, banMs: 600000}})` 후 `admit({kind:'tunnel', port, protocol:'tcp'}, ip)` 2 회 호출하고 `{type: 'seed-ban-done'}` 회신.
- `test/helpers/adminApp.ts`: 반환 객체에 `seedBan(port: number, ip: string): Promise<void>` 추가.

### 테스트 파일

- `test/admin/screen-security.test.ts`(신규), `test/admin/screen-tunnels.test.ts`·`test/admin/screen-access.test.ts`(케이스 추가).

## 변경할 것

- `admin/src/router.ts`, `admin/src/nav.ts`, `admin/src/App.svelte`(title 표), `admin/src/controller/Types.ts`, `admin/src/screens/TunnelsScreen.svelte`, `admin/src/screens/TunnelEditScreen.svelte`, `test/admin/admin-backend-driver.ts`, `test/helpers/adminApp.ts` — 위 "만들 것" 대로.

## 하지 말 것

- 서버 코드(`src/**`)를 바꾸지 않는다. API 가 부족하면 코멘트로 보고.
- 국가 목록을 클라이언트에 하드코딩하지 않는다.
- 새 `ui/` 부품을 만들지 않는다. 색상 hex 금지(R2), 외부 URL 금지(R5), `ui/` 안에서 `adminRequest` 금지(R1).
- 화면 안에서 역할을 다시 검사하지 않는다(`section` 필터·가드가 처리).
- `customized` 를 서버에서 계산하려 하지 않는다.
- `Blocked` 를 offline 카드에 그리지 않는다.
- `windowMs`·`banMs` 를 밀리초로 노출하지 않는다.

## 수용 기준

모든 브라우저 테스트는 뷰포트 400×800, `finally` 에서 `close()`, 끝에 `expect(errors).toEqual([])`.

- `test/admin/screen-security.test.ts` (`startAdminApp({fixture: 'rbac', loginAs: 'admin'})`)
  - 드로어에 "Security" 항목이 있고 선택하면 해시 `#/security`, 헤더 제목 "Security".
  - `#geo-mode` 값 `off`, `#ban-empty` 텍스트 `No banned addresses.`.
  - `#geo-mode` 를 `allow` 로 → `#geo-save` disabled, `#geo-error` 에 `Allow mode requires at least one country.`.
  - `#geo-country-filter` 에 `kor` → `#geo-country-list` 에 `#geo-country-KR` 이 보이고 항목 수 < 249. 체크 → `#geo-selected` 에 `KR` 칩, `#geo-save` enabled.
  - `#geo-unknown-policy` 를 `deny`, `#geo-apply-admin` 체크 유지 → Save → 토스트 `Country filter saved.` 와 `unknownPolicy=deny with applyToAdmin=true` 로 시작하는 경고 토스트. 새로고침 뒤 `#geo-mode` `allow`, 칩 `KR`.
  - `[aria-label="Remove KR"]` 클릭 → 칩 사라짐, Save disabled + 오류 문구.
  - `#geo-mode` `off` → Save → `Country filter saved.` 만, 경고 토스트 없음.
  - `seedBan(20001, '203.0.113.9')` 후 `page.reload()` → `#ban-table tr[data-ban="20001/203.0.113.9"]` 에 `203.0.113.9` 와 `Unban`. 클릭 → 토스트 `Unbanned 203.0.113.9.` → `#ban-empty`.
- `test/admin/screen-tunnels.test.ts` 추가 케이스
  - `[data-port="20002"]` 안 `[data-blocked]` 텍스트 `Blocked 7`; `[data-port="20001"]` 에는 `[data-blocked]` 없음.
  - `#/tunnels/20001`: `#input-rate-window` `60`, `#input-rate-max` `30`, `#input-rate-ban` `10`, `[aria-label="Rate limit enabled"]` on.
  - `#select-protocol` 을 `http` 로 → `#input-rate-max` `300`.
  - `#input-rate-max` 에 `50` 입력 후 `#select-protocol` 을 `tcp` 로 → `50` 유지.
  - 저장 → `calls()` 마지막 `applyTunnelingOption` 인자의 `rateLimit` 이 `{enabled: true, windowMs: 60000, maxConnections: 50, banMs: 600000, customized: true}`.
  - `#/tunnels/new` 의 카드가 `defaultRateLimit('tcp')` 값.
  - `#input-rate-window` 에 `0` → `Field error` 표시, 저장 disabled.
- `test/admin/screen-access.test.ts` 추가: `loginAs: 'alice'` 는 드로어에 "Security" 없음, `#/security` 직접 입력 → `#/denied`.
- `test/admin/design-system-rules.test.ts` R1·R2·R5 통과, `npm --prefix admin run check` 통과.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm --prefix admin run check
npm run test:admin
git log -1 --format=%B   # 서명 0건, 제목에 단계 표식 없음 확인
```

## 선행 · 후행

- 선행: U5-05, U3-06.
- 후행: 없음(단위 5 의 마지막 화면).

## 근거 문서

- `docs/design/2026-09-11-unit5-connection-security.md` §3.2(`customized`), §6.1·6.2·6.3, §9(U5-06)
- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §5.1, §5.5, §6, §7.3·7.4, §8.2
- `docs/design/2026-09-11-unit3-rbac-screens.md` §2, §3, §5, §6(U3-01·U3-06)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §4.4(`sections`), §7(U2-10)
- `docs/design/2026-09-11-program-overview.md` §1 D5·D9·D10

---

## U5-07

**title**: feat(server): 그룹 최대 터널 수명으로 활성 타임아웃을 제한하고 자동 만료를 감사
**labels**: enhancement, area:server, unit:5
**body**:
## 목적

PRD 속성 3 `max_tunnel_duration_ms` 를 데이터 평면에서 집행한다. 일반 유저가 소유한 터널은 그룹 값이 0 보다 크면 활성 시간이 그 값을 넘지 못한다: 활성화 요청의 타임아웃은 상한으로 잘리고, 타임아웃 없이 켜진 터널(기동 시 자동 활성 포함)도 상한 뒤 비활성화된다. 상한으로 만료되면 감사 이벤트 `'tunnel_autoexpire'` 가 남는다.

## 배경

- `src/server/ExternalPortServerPool.ts:473-491` `active(port, timeout?)`: `:478` `timeout == undefined` 면 `status.activeTimeout`, `:484-489` `timeout > 0` 이면 `setTimeout(async () => { await this.inactive(port); }, timeout * 1000)`. `:452-461` `inactive(port)`. `:464-471` `setActiveTimeout`. `:139-140` `startServer` 초기 상태 `active: !option.inactiveOnStartup, activeTimeout: 0` — **타이머는 걸지 않는다**.
- `src/server/TTTServer.ts:110-119` `restoreExternalPortStatus` 가 옵션 적용 후 `active(port, lastServerStatus.activeTimeout)` 를 부른다(상한 자동 적용 경로). `:475-477` `activeExternalPortServer(port, timeout)`. `:512-527` `start()` 는 `startServer` 만 부른다. `:47-59` 생성자가 풀 콜백 세 개를 설정한다.
- 단위 2 §6 `AuthorizationContext = {ownerOf(port): {userId, groupId, role} | undefined, groupAttributes(groupId), portsOfGroup(groupId), isSuperuserOwned(port)}`(`src/server/rbac/AuthorizationContext.ts`, U2-08). `system:migrated` 소유는 `ownerOf → undefined`.
- 단위 2 §4.6 `AuditSinkRegistry.current().record(event)`(U2-05). 감사 이벤트 타입은 이 단위에서 문자열 리터럴로 쓰고 U4-01 이 상수로 치환한다(같은 파동이라 기다리지 않는다).
- 단위 2 §3 `max_tunnel_duration_ms: int ≥ 0 (0 = 무제한)`, 기본 0.

### 전제하는 산출물

| 산출물 | 만드는 이슈 |
|---|---|
| `src/server/rbac/AuthorizationContext.ts`, `TunnelingOption.ownerId` | U2-08 |
| `src/server/audit/AuditSink.ts`(`AuditSinkRegistry`, `AuditEvent`) | U2-05 |
| `IdentityStore.instance.load()`·`resetForTest`, `config/identity.yaml` 형식 | U2-01 |

없으면 코멘트하고 중단한다.

먼저 열어 볼 파일: `src/server/ExternalPortServerPool.ts`(`:452-491`), `src/server/TTTServer.ts`(`:47-59`, `:110-119`, `:512-527`), `src/server/rbac/AuthorizationContext.ts`, `src/server/audit/AuditSink.ts`, `test/unit/server/rbac/IdentityStore.test.ts`(identity.yaml 픽스처 작성법).

## 적용되는 결정

- D1 PRD v0.2 범위. 속성 3 의 집행 지점은 런타임.

## 만들 것

### `src/server/security/TunnelLifetimePolicy.ts`

```ts
export type LifetimeContext = {
    ownerOf(port: number): {userId: string; groupId: string; role: 'superuser' | 'regular'} | undefined;
    groupAttributes(groupId: string): {max_tunnel_duration_ms: number};
};
export function maxActiveSeconds(port: number, context: LifetimeContext): number | undefined;
```
`ownerOf` 가 `undefined` 또는 `superuser` → `undefined`. `max_tunnel_duration_ms <= 0` → `undefined`. 그 외 `Math.ceil(ms / 1000)`(최소 1). 순수 함수.

### `ExternalPortServerPool` 확장

```ts
public set ActiveTimeoutCap(cap: ((port: number) => number | undefined) | null);
public set OnAutoExpireCallback(callback: ((port: number, info: {timeoutSeconds: number; cappedByGroup: boolean}) => void) | null);
```
`active(port, timeout?)` `:478` 직후:
```ts
const cap = this._activeTimeoutCap?.(port);
const cappedByGroup = cap !== undefined && (timeout <= 0 || cap < timeout);
if(cappedByGroup) timeout = cap;
```
`status.activeTimeout` 은 잘린 값. 타이머 콜백: `await this.inactive(port); this._onAutoExpire?.(port, {timeoutSeconds: timeout, cappedByGroup});`. `clearActiveTimeout` 으로 취소된 타이머는 콜백을 부르지 않는다(기존).

### `TTTServer` 연결

- 생성자: `this._externalPortServerPool.ActiveTimeoutCap = (port) => maxActiveSeconds(port, AuthorizationContext);`
  ```ts
  this._externalPortServerPool.OnAutoExpireCallback = (port, info) => {
      if(!info.cappedByGroup) return;
      void AuditSinkRegistry.current().record({at: Date.now(), actor: {userId: 'system'}, type: 'tunnel_autoexpire',
          target: {kind: 'tunnel', id: String(port)}, outcome: 'success',
          summary: `tunnel ${port} expired after ${info.timeoutSeconds}s (group limit)`, detail: {port, timeoutSeconds: info.timeoutSeconds}});
  };
  ```
  사용자가 직접 정한 타임아웃 만료(`cappedByGroup: false`)는 감사하지 않는다(속성 3 의 집행이 아니다).
- `start()`(`:516-525`): `startServer` 성공 직후 `if(!tunnelOption.inactiveOnStartup && maxActiveSeconds(tunnelOption.forwardPort, AuthorizationContext) !== undefined) await this._externalPortServerPool.active(tunnelOption.forwardPort);`.

### 테스트 파일 (신규)

- `test/unit/server/security/TunnelLifetimePolicy.test.ts`
- `test/component/server/security/tunnel-lifetime.test.ts`

## 변경할 것

- `src/server/ExternalPortServerPool.ts`: 두 setter, `active` 규칙, 타이머 콜백.
- `src/server/TTTServer.ts`: 생성자 연결, `start()` 자동 활성.

## 하지 말 것

- `ExternalPortServerPool` 이 `rbac/*` 를 import 하지 않는다(콜백 주입).
- `inactive()` 를 바꾸지 않는다. 수명 만료 외의 비활성화에 감사를 붙이지 않는다.
- 속성 6·11 을 건드리지 않는다(U5-08·09).
- 상한을 `server.yaml` 에 쓰지 않는다.
- 감사 이벤트 타입 상수 파일(`AuditEventTypes.ts`)을 만들지 않는다(U4-01). 리터럴 `'tunnel_autoexpire'` 를 쓴다.
- `TunnelLifetimePolicy` 안에서 `Date.now` 를 호출하지 않는다.

## 수용 기준

- `test/unit/server/security/TunnelLifetimePolicy.test.ts` (가짜 컨텍스트)
  - `ownerOf → undefined` → `undefined`. `role: 'superuser'` 는 그룹 값 5000 이어도 `undefined`. `regular` + `0` → `undefined`.
  - `2000` → 2, `1500` → 2, `1` → 1, `43_200_000` → 43200.
- `test/component/server/security/tunnel-lifetime.test.ts` (임시 루트; `identity.yaml` 에 그룹 `g_field` `max_tunnel_duration_ms: 2000`, 일반 유저 `u_alice`(g_field), 슈퍼유저 `u_admin`; `server.yaml` 에 tcp 터널 A `ownerId: u_alice`, B `ownerId: u_admin`, C `ownerId` 없음, 모두 `inactiveOnStartup: false`, 포트 `getFreePort`; `AuditSinkRegistry.set(수집기)`; `TTTServer.create(serverOption)` → `start()`; `afterEach` 에 `close()`·`resetForTest`)
  - `start()` 직후 A `active === true`, `activeTimeout === 2`; B·C `activeTimeout === 0`.
  - 2.5초 뒤 A `active === false`, B·C `active === true`.
  - 수집기에 `{type: 'tunnel_autoexpire', target: {kind: 'tunnel', id: String(A)}, outcome: 'success'}` 정확히 1 건, B·C 이벤트 없음.
  - `activeExternalPortServer(A, 10)` 후 `activeTimeout === 2`; `activeExternalPortServer(A, 1)` 후 `1`.
  - `activeExternalPortServer(B, 1)` 후 1.5초 뒤 B `active === false` 이고 `tunnel_autoexpire` 는 여전히 A 의 1 건뿐.
  - `applyTunnelingOption(A옵션 사본, A옵션)` 으로 재생성해도 `activeTimeout === 2` 이고 2.5초 뒤 비활성화.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/server/security test/component/server
npm test -- --runInBand
git log -1 --format=%B   # 서명 0건, 제목에 단계 표식 없음 확인
```

## 선행 · 후행

- 선행: U2-08.
- 후행: 없음.

## 근거 문서

- `docs/design/2026-09-11-unit5-connection-security.md` §2(활성 타임아웃), §7(공통 행·속성 3 행), §9(U5-07)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §3, §4.6, §6, §9(U2-05·U2-08)
- `docs/plan/prd/TTTGate-admin-rbac.md` §7 속성 3

---

## U5-08

**title**: feat(server): 그룹 동시 연결 상한을 수락 판정에 넣고 HTTP 터널은 503 으로 거절
**labels**: enhancement, area:server, unit:5
**body**:
## 목적

PRD 속성 6 `max_concurrent_connections` 를 수락 판정의 마지막 단계로 집행한다. 일반 유저 그룹이 소유한 모든 터널의 세션 수 합이 상한에 이르면 새 접속을 거절한다. HTTP·HTTPS 터널은 `503 Service Unavailable` 을 쓴 뒤 닫고(U5-02 의 `rejectResponse` 래핑이 이미 처리), TCP 터널은 무응답으로 닫는다. 거절은 감사 이벤트 `'conn_limit_hit'` 로 포트·그룹별 1분 1회 남는다.

## 배경

- U5-01 의 `AdmissionController.admit` 5 단계 자리, `configureConcurrency(provider)`(저장만), `AdmissionReason` 의 `'concurrency-limit'`. U5-02 가 풀 생성자에서 `configureConcurrency((port) => this._statusMap.get(port)?.sessions ?? 0)` 를 주입했고, `startServer` 의 `admit` 래핑이 http/https 의 `concurrency-limit` 에 `HTTP_503` 을 채우며, `TCPServer.onBind` 가 `rejectResponse` 를 `socket.end` 로 보낸다. `sessionCount(port)` 읽기 메서드.
- `src/server/ExternalPortServerPool.ts:394-401` `updateCount` 가 Bound 시 +1(`:380`), End/Closed 시 −1(`:303`). 판정은 Bound 전이므로 거절된 연결은 세지 않는다.
- U5-04 의 `DenialAggregator` 는 로그용. 감사 집계는 별도 게이트.
- 단위 2 §6 `AuthorizationContext.ownerOf`, `groupAttributes`, `portsOfGroup(groupId): number[]`(U2-08). 단위 2 §3 `max_concurrent_connections: int ≥ 0`, 기본 100. **0 의 의미가 PRD 에 없다.** 속성 3 과 같이 0 = 상한 없음으로 정한다(이슈 코멘트로 기록).
- 단위 0 §3.2 하네스 `identityFixture`(U2-09 이 직렬화 구현; 사용자 항목은 평문 `password` 를 받고 하네스가 해시). `adminLogin` 옵션.
- 단위 2 §4.6 `LoggerAuditSink` 가 기본 sink 이며 `logger.info('audit', JSON)` 으로 기록. 서버 로거는 콘솔+파일이므로 프로세스 하네스 `server.stdoutChunks` 에 나타난다.
- 설계 문서와 다른 점: §7 은 "그룹→포트 목록은 `configureTunnel` 때 갱신" 이라 하지만, 소유자 재할당(`PUT /api/tunnelingOption/:port/owner`)과 그룹 속성 변경은 `configureTunnel` 을 거치지 않으므로 캐시가 낡는다. 이 이슈는 판정 시점에 `AuthorizationContext` 를 읽는다(Map 조회 몇 번, 캐시 없음).

### 전제하는 산출물

| 산출물 | 만드는 이슈 |
|---|---|
| `configureConcurrency` 주입, `admit` 래핑·`rejectResponse`, `sessionCount` | U5-02 |
| `AuthorizationContext`, `TunnelingOption.ownerId` | U2-08 |
| `AuditSinkRegistry` | U2-05 |
| 프로세스 하네스 `identityFixture` 직렬화 | U2-09 |

없으면 코멘트하고 중단한다.

먼저 열어 볼 파일: `src/server/security/AdmissionController.ts`, `src/server/ExternalPortServerPool.ts`(`:111-161`, `:394-401`), `src/server/TTTServer.ts`(`:47-59`), `src/server/rbac/AuthorizationContext.ts`, `test/e2e/browser/legacy-admin-migration.test.ts`(U2-09, `identityFixture` 사용 예).

## 적용되는 결정

- D11 판정은 자원 할당 전. 동시 연결 상한도 `onBind` 첫 줄의 `admit` 안에서 끝난다.
- D1 PRD 범위. 속성 6 의 "거부(503)" 는 HTTP 터널만 가능하므로 TCP 는 무응답 종료(설계 §4.5).

## 만들 것

### `src/server/security/ConcurrencyLimiter.ts`

```ts
export type ConcurrencyContext = {
    ownerOf(port: number): {userId: string; groupId: string; role: 'superuser' | 'regular'} | undefined;
    groupAttributes(groupId: string): {max_concurrent_connections: number};
    portsOfGroup(groupId: string): number[];
};
export type ConcurrencyDenial = {groupId: string; limit: number; sessions: number};
export class ConcurrencyLimiter {
    constructor(context: ConcurrencyContext, sessionsOf: (port: number) => number);
    decide(port: number): {decision: AdmissionDecision; denial?: ConcurrencyDenial};
}
```
`decide`: `owner = ownerOf(port)`; `undefined`/`superuser` → `ADMIT`. `limit = groupAttributes(owner.groupId).max_concurrent_connections`; `limit <= 0` → `ADMIT`. `sessions = Σ sessionsOf(p) for p in portsOfGroup(owner.groupId)`; `sessions >= limit` → `{decision: {allowed: false, reason: 'concurrency-limit'}, denial: {groupId, limit, sessions}}`. 아니면 `ADMIT`.

### `src/server/security/AuditRateGate.ts`

```ts
export class AuditRateGate {
    constructor(intervalMs: number = 60_000);
    allow(key: string, now: number): boolean;   // 마지막 통과로부터 intervalMs 이상이면 기록하고 true
    prune(now: number): void;
}
```

### `AdmissionController` 확장

```ts
attachConcurrency(limiter: ConcurrencyLimiter | null): void;
set onConcurrencyDenied(callback: ((port: number, denial: ConcurrencyDenial, now: number) => void) | null);
```
`admit` 5 단계: `scope.kind === 'tunnel'` 이고 limiter 가 있으면 `const {decision, denial} = limiter.decide(scope.port)`; 거절이면 `denialLog.record(scope, 'concurrency-limit', now)`(U5-04 병합 후), `if(denial && this._auditGate.allow(`${scope.port}|${denial.groupId}`, now)) this._onConcurrencyDenied?.(scope.port, denial, now)`, 반환. `_auditGate = new AuditRateGate(60_000)`, prune 타이머에서 `prune(now)`.

### `TTTServer` 연결 (생성자)

```ts
const controller = AdmissionController.instance;
controller.attachConcurrency(new ConcurrencyLimiter(AuthorizationContext, (port) => controller.sessionCount(port)));
controller.onConcurrencyDenied = (port, denial, now) => {
    void AuditSinkRegistry.current().record({at: now, actor: {userId: 'system'}, type: 'conn_limit_hit',
        target: {kind: 'tunnel', id: String(port)}, outcome: 'failure',
        summary: `connection limit hit port=${port} group=${denial.groupId} limit=${denial.limit}`,
        detail: {port, groupId: denial.groupId, limit: denial.limit, sessions: denial.sessions}});
};
```

### 테스트 파일 (신규)

- `test/unit/server/security/ConcurrencyLimiter.test.ts`
- `test/unit/server/security/AuditRateGate.test.ts`
- `test/component/server/admission-concurrency.test.ts`
- `test/e2e/browser/concurrency-limit.test.ts`

## 변경할 것

- `src/server/security/AdmissionController.ts`(5 단계, `attachConcurrency`, `onConcurrencyDenied`, 게이트 prune), `src/server/TTTServer.ts`(생성자 연결).
- `TCPServer`·`ExternalPortServerPool` 은 바꾸지 않는다(U5-02 가 `rejectResponse` 경로를 완성했다). `admit` 래핑이 `HTTP_503` 을 채우는지 확인만 한다.

## 하지 말 것

- `AdmissionController`·`ExternalPortServerPool` 이 `rbac/*` 를 import 하지 않는다(`TTTServer` 만 `AuthorizationContext` 를 넘긴다).
- TCP 터널에 바이트를 보내지 않는다. 503 은 `concurrency-limit` 사유에만.
- 거절 건마다 감사 이벤트를 남기지 않는다(포트·그룹별 1분 1회).
- 슈퍼유저 소유·`system:migrated` 터널에 상한을 적용하지 않는다.
- 포트→그룹 캐시를 만들지 않는다.
- `updateCount` 방식을 바꾸지 않는다.
- 감사 타입 상수 파일을 만들지 않는다(U4-01). 리터럴 `'conn_limit_hit'`.
- `ConcurrencyLimiter`·`AuditRateGate` 안에서 `Date.now` 를 호출하지 않는다.

## 수용 기준

- `test/unit/server/security/ConcurrencyLimiter.test.ts` (가짜 컨텍스트: 그룹 `g` 포트 1·2, `limit 3`)
  - `sessionsOf` `{1: 2, 2: 0}` → `decide(1)` 허용; `{1: 2, 2: 1}` → `concurrency-limit`, `denial` `{groupId: 'g', limit: 3, sessions: 3}`.
  - `limit 0` → 세션 100 이어도 허용. `ownerOf → undefined`/`superuser` → 허용.
  - 컨텍스트의 `groupAttributes` 를 호출 사이에 바꾸면(3 → 5) 다음 `decide` 가 새 값을 쓴다.
- `test/unit/server/security/AuditRateGate.test.ts`
  - `allow('k', 0)` true, `allow('k', 59_999)` false, `allow('k', 60_000)` true, `allow('j', 1)` true. `prune(120_000)` 뒤 `allow('k', 120_000)` true.
- `test/component/server/admission-concurrency.test.ts` (실제 풀, `attachConcurrency(new ConcurrencyLimiter(가짜 컨텍스트, port => controller.sessionCount(port)))`, tcp 터널 T 와 http 터널 H 가 같은 그룹 `limit 2`, `onConcurrencyDenied` 수집기)
  - T 에 `net.connect` 2 개 유지 중 H 에 `net.connect` → 소켓이 정확히 `HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n` 을 받은 뒤 `close`.
  - 같은 상태에서 T 의 3 번째 `net.connect` 는 수신 0 바이트로 `close`.
  - `getServerStatus(T).sessions === 2`, `rejected.rateLimit === 0`.
  - T 에 3·4 번째를 시도하면 수집기가 T 키로 1 회만 호출된다(H 는 별도 1 회).
  - 유지하던 연결 하나를 끊고 100ms 뒤 T 연결이 성공한다.
- `test/e2e/browser/concurrency-limit.test.ts` (프로세스 하네스, `identityFixture`: 그룹 `g_field` `max_concurrent_connections: 3`, 일반 유저 `u_alice`, 슈퍼유저 `admin`(`adminLogin` 기본 계정); 터널 tcp·http 각각 `extra: {ownerId: 'u_alice'}`; 대상 `startTargetService()`; Jest 타임아웃 120초)
  - tcp 포트에 `net.connect` 3 개를 열어 둔 채 4 번째는 1초 안에 수신 0 바이트로 `close`.
  - 같은 상태에서 Node `http.get('http://127.0.0.1:<http fp>/')` 이 503, 헤더 `connection: close`.
  - 3 개 중 하나를 `end()` 하고 500ms 뒤 `http.get` 이 200 이고 본문에 `Target OK`.
  - `server.stdoutChunks.join('')` 에 `"type":"conn_limit_hit"` 가 정확히 2 회(tcp 1 + http 1). 4 번째 tcp 시도를 3 번 반복해도 tcp 건수는 1.
  - `adminRequest('/api/security/stats')` 의 `stats.ports[<tcp fp>]` 존재.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/server/security test/component/server
npm run test:browser:install
npx jest --runInBand test/e2e/browser/concurrency-limit.test.ts test/e2e/browser/rate-limit.test.ts
npm test -- --runInBand
git log -1 --format=%B   # 서명 0건, 제목에 단계 표식 없음 확인
```

## 선행 · 후행

- 선행: U5-02, U2-09.
- 후행: 없음.

## 근거 문서

- `docs/design/2026-09-11-unit5-connection-security.md` §4.4(4 단계·`configureConcurrency`), §4.5(`rejectResponse`·503), §7(공통 행·속성 6 행), §9(U5-08)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §3, §4.6, §6, §9(U2-05·07·08)
- `docs/design/2026-09-11-unit0-verification-foundation.md` §3.2(`identityFixture`, `adminLogin`)
- `docs/plan/prd/TTTGate-admin-rbac.md` §7 속성 6

---

## U5-09

**title**: feat(server): 그룹 대역폭 프리셋을 토큰 버킷으로 양방향 전송에 적용
**labels**: enhancement, area:server, unit:5
**body**:
## 목적

PRD 속성 11 `rate_limit` 프리셋(`unlimited | 1MB/s | 10MB/s | 100MB/s`)을 데이터 평면에서 집행한다. 일반 유저 그룹이 소유한 터널의 외부→클라이언트, 클라이언트→외부 두 방향 바이트가 그룹 하나의 토큰 버킷을 공유해 1초 평균 전송량이 프리셋 ±5% 안에 들어온다(PRD K4). `unlimited` 는 버킷을 만들지 않는다.

## 배경

- `src/server/ExternalPortServerPool.ts:289-320` `onHandlerEvent`: `:293-301` `SocketState.Receive` 분기가 `status.rx += data.length` 후 `_onHandlerEventCallback(sessionID, state, {data, receiveLength})` 로 넘긴다(외부→클라이언트). `:302-315` End/Closed 분기.
- `:223-245` `send(id, data)`: `:232-242` 가 `lastSendTime`, `handler.sendData(data, cb)`, `:236` `if(handler instanceof HttpHandler) this.closeIfSatisfiedLength(handler)`, `:240` `status.tx += data.length`(클라이언트→외부). `:253-266` `closeSession(id, endLength)` — `closeIfSatisfiedLength` 가 `:275` 에서 `endLength <= sendLength` 를 기다리므로 아직 쓰지 않은 바이트가 있으면 닫히지 않는다.
- `:361` `bufferSizeLimit = option.bufferLimitOnServer == undefined || option.bufferLimitOnServer < 1 ? -1 : option.bufferLimitOnServer * 1024 * 1024`(`ServerOptionStore.ts:407` 이 기본 8 로 채우므로 정규화된 옵션에서는 양수).
- `src/util/SocketHandler.ts:177-193` `pauseRead()`/`resumeRead()` 가 있다(설계 §7 의 `handler.socket.pause()` 대신 이것을 쓴다). `src/server/http/HttpHandler.ts:21` `HttpHandler` 는 `_socketHandler` 를 감싸며 `pauseRead/resumeRead` 를 노출하지 않는다 — 위임 메서드를 추가한다. `src/types/EndpointHandler.ts` 의 `EndpointHandler | EndpointHttpHandler` 유니온.
- `src/server/TTTServer.ts:47-59` 생성자.
- 단위 2 §3 `rate_limit: 'unlimited' | '1MB/s' | '10MB/s' | '100MB/s'`, 기본 `'unlimited'`. §6 `AuthorizationContext`(U2-08).
- 단위 0 §3.3 대상 서비스 `GET /big?mb=N`(64KiB 청크), `POST /echo-post`. §3.4 `large-transfer.test.ts`(U0-02).

### 전제하는 산출물

| 산출물 | 만드는 이슈 |
|---|---|
| `src/server/security/` 배치, `AdmissionController` 연결(참조만) | U5-01·02 |
| `AuthorizationContext`, `TunnelingOption.ownerId` | U2-08 |
| 프로세스 하네스 `identityFixture` | U2-09 |
| 대상 서비스 `/big`, `/echo-post`, `large-transfer.test.ts` | U0-01·02 |

없으면 코멘트하고 중단한다.

먼저 열어 볼 파일: `src/server/ExternalPortServerPool.ts`(`:223-320`, `:361`), `src/util/SocketHandler.ts`(`:150-200`, `:516`), `src/server/http/HttpHandler.ts`, `src/server/TTTServer.ts`(`:47-59`), `test/e2e/browser/large-transfer.test.ts`.

## 적용되는 결정

- D1 PRD 범위. K4(프리셋 ±5%)를 자동 테스트로 고정.
- 개요 §3.5: 대역폭 프리셋은 그룹 합산 송수신 상한이며 접속 레이트 리밋(D8)과 별개.

## 만들 것

### `src/server/security/BandwidthLimiter.ts`

```ts
export type BandwidthPreset = 'unlimited' | '1MB/s' | '10MB/s' | '100MB/s';
export const PRESET_BYTES_PER_SECOND: Readonly<Record<BandwidthPreset, number>> =
    {unlimited: 0, '1MB/s': 1_048_576, '10MB/s': 10_485_760, '100MB/s': 104_857_600};
export const REFILL_INTERVAL_MS = 100;
export class BandwidthLimiter {
    consume(groupId: string, bytesPerSecond: number, bytes: number, now: number): number;   // 0 = 즉시, n > 0 = n ms 뒤
    release(groupId: string): void;
    bucket(groupId: string): {capacity: number; tokens: number; updatedAt: number} | undefined;   // 테스트 읽기용
}
```

- 버킷 `{capacity: bytesPerSecond, tokens: 0 (비어서 시작), updatedAt: now}`. `bytesPerSecond <= 0` 이면 버킷 없이 0. `capacity` 가 바뀌면 새 버킷(`tokens: 0`).
- 보충: `steps = Math.floor((now - updatedAt) / REFILL_INTERVAL_MS)`; `tokens = Math.min(capacity, tokens + steps * capacity / 10)`; `updatedAt += steps * REFILL_INTERVAL_MS`. 타이머 없이 호출 시점 계산.
- 소비: `tokens -= bytes`(음수 허용). `wait = tokens >= 0 ? 0 : Math.ceil(-tokens / capacity * 1000)`.
- 시각은 인자로만.

### `ExternalPortServerPool` 확장

```ts
public set BandwidthPolicy(policy: ((port: number) => {groupId: string; bytesPerSecond: number} | undefined) | null);
```

**외부→클라이언트** (Receive 분기, `_onHandlerEventCallback` 호출 **뒤**):
```ts
const policy = this._bandwidthPolicy?.(portNumber);
if(policy) {
    const wait = this._bandwidth.consume(policy.groupId, policy.bytesPerSecond, data.length, Date.now());
    if(wait > 0) { handler.pauseRead(); setTimeout(() => handler.resumeRead(), wait); }
}
```
(`Date.now` 는 이 파일의 기존 관례대로 호출부에서. 리미터 안에서는 부르지 않는다.)

**클라이언트→외부** (`send`):
- `:232-242` 의 실제 쓰기(`lastSendTime`, `sendData`, http 가드 `closeIfSatisfiedLength`, `tx`)를 `private writeToHandler(handler, data): void` 로 뽑는다.
- `_sendQueues = new Map<number, {chunks: Buffer[]; bytes: number; limit: number; timer: NodeJS.Timeout | null}>()`.
- `send` 새 흐름: 핸들러 검사(`closeInitiated`, http 길이 검사)는 기존대로. `policy` 없으면 `writeToHandler` 후 true. 있으면: 큐가 있으면 `enqueue`; 없으면 `wait = consume(...)`; 0 이면 `writeToHandler`; 아니면 큐 생성 → `enqueue` → `scheduleDrain(id, wait)`.
- `enqueue`: `bytes += data.length`; `bytes > limit` 이면 큐 삭제 + `closeIfSatisfiedLength(handler, true)`(강제 종료) + false 반환. `limit = (option.bufferLimitOnServer ?? 8) * 1024 * 1024`(핸들러 번들의 옵션).
- `drain(id)`: 핸들러가 없거나 `closeInitiated` 면 큐 삭제. 머리 청크를 `writeToHandler`; 다음 청크가 있으면 `wait = consume(...)`; 0 이면 계속, 아니면 `scheduleDrain`. 큐가 비면 삭제 후 `closeIfSatisfiedLength(handler)` 1 회.
- 세션 종료(End/Closed 분기, `destroyHandlers`)에서 큐·타이머 삭제.

### `HttpHandler` 위임

`public pauseRead(): void { this._socketHandler.pauseRead(); }`, `public resumeRead(): void { this._socketHandler.resumeRead(); }`.

### `TTTServer` 연결 (생성자)

```ts
this._externalPortServerPool.BandwidthPolicy = (port) => {
    const owner = AuthorizationContext.ownerOf(port);
    if(!owner || owner.role === 'superuser') return undefined;
    const bytesPerSecond = PRESET_BYTES_PER_SECOND[AuthorizationContext.groupAttributes(owner.groupId).rate_limit] ?? 0;
    return bytesPerSecond > 0 ? {groupId: owner.groupId, bytesPerSecond} : undefined;
};
```

### 테스트 파일 (신규)

- `test/unit/server/security/BandwidthLimiter.test.ts`
- `test/component/server/bandwidth-send-queue.test.ts`
- `test/e2e/browser/bandwidth-preset.test.ts`

## 변경할 것

- `src/server/ExternalPortServerPool.ts`: setter, Receive 삽입, `send` 분리·큐, 종료 시 큐 정리.
- `src/server/http/HttpHandler.ts`: 위임 두 개.
- `src/server/TTTServer.ts`: 생성자 연결.

## 하지 말 것

- `ExternalPortServerPool` 이 `rbac/*` 를 import 하지 않는다(정책 함수 주입).
- `setInterval` 로 버킷을 보충하지 않는다.
- 슈퍼유저·migrated·`unlimited` 에 버킷을 만들지 않는다.
- 큐 청크를 합치거나 쪼개지 않는다.
- 큐 상한 초과 시 데이터를 버리고 계속 가지 않는다(세션을 닫는다).
- `SocketHandler` 의 버퍼·백프레셔 로직을 바꾸지 않는다.
- `BandwidthLimiter` 안에서 `Date.now` 를 호출하지 않는다.
- 예외를 제어 흐름으로 쓰지 않는다.

## 수용 기준

- `test/unit/server/security/BandwidthLimiter.test.ts` (`C = 1_048_576`)
  - `consume('g', C, 65_536, 0)` 은 `63`(`ceil(65536/1048576*1000)`).
  - 이어 `consume('g', C, 0, 100)` 은 0, `bucket('g').tokens` 가 `toBeCloseTo(39_321.6, 0)`.
  - `consume('g', C, 0, 2_000)` 뒤 `tokens === C`.
  - 가득 찬 버킷에서 `consume('g', C, C, 2_000)` 은 0, 바로 다음 같은 호출은 `1000`.
  - `consume('g', 0, 1_000_000, 0)` 은 0, `bucket('g')` 은 `undefined`.
  - `consume('g', C, 10, 0)` 후 `consume('g', 10_485_760, 10, 0)` 은 새 버킷(`capacity === 10_485_760`, `tokens === -10`), 반환 `1`.
  - 100ms 간격으로 `C/10` 씩 10 회 소비하면 모두 0 이고 마지막 `tokens >= 0`.
- `test/component/server/bandwidth-send-queue.test.ts` (실제 풀, tcp 터널, `BandwidthPolicy = () => ({groupId: 'g', bytesPerSecond: 1_048_576})`, 외부 `net.connect` 클라이언트가 수신 바이트를 모음)
  - `send(id, 64KiB)` 48 회(3 MiB) 연속 호출 → 모두 true, 클라이언트가 3 MiB 를 순서대로(청크 i 의 첫 바이트 `i % 256`) 받고, 첫 호출부터 마지막 수신까지 2.7초 이상 3.3초 이하.
  - 마지막 `send` 직후 `closeSession(id, 3 MiB)` → 3 MiB 를 모두 받은 뒤에야 `end`.
  - `bufferLimitOnServer: 1` 터널에서 64KiB × 40 연속 `send` → 큐 상한 초과 시점 이후 `send` 가 false, 클라이언트 소켓 `close`, `sessions === 0`.
  - 외부 클라이언트가 2 MiB 를 보내면 `OnHandlerEventCallback` 수신 합 2 MiB, 첫 수신부터 마지막까지 1.7초 이상(`pauseRead` 작동).
- `test/e2e/browser/bandwidth-preset.test.ts` (프로세스 하네스, `identityFixture`: 그룹 `g_slow` `rate_limit: '1MB/s'` 의 `u_alice`, 그룹 `g_fast` `'unlimited'` 의 `u_bob`, 슈퍼유저 `admin`; http 터널 S `extra: {ownerId: 'u_alice'}`, F `extra: {ownerId: 'u_bob'}`; 대상 `startTargetService()`; Jest 타임아웃 120초)
  - S 로 `page.request.get('http://127.0.0.1:<S>/big?mb=5')` 본문 5 MiB, SHA-256 일치, `5 MiB / elapsed` 가 `1_048_576 × 0.95` 이상 `× 1.05` 이하.
  - F 로 같은 요청은 1초 안.
  - S 로 `page.request.post('http://127.0.0.1:<S>/echo-post', {data: 5 MiB})` 응답 본문이 요청과 같고, 총 10 MiB / elapsed 가 `1_048_576` 의 ±5% 안(두 방향이 한 버킷 공유).
  - `page.on('pageerror')` 비어 있음.
- 기존 `test/e2e/tunnel/large-transfer-cache.test.ts`, `test/e2e/browser/large-transfer.test.ts`(슈퍼유저·migrated 소유, 버킷 없음) 통과.

## 검증 명령

```
npm ci --include=dev
npm run build
npm run lint
npx jest --runInBand test/unit/server/security test/component/server
npm run test:browser:install
npx jest --runInBand test/e2e/browser/bandwidth-preset.test.ts test/e2e/browser/large-transfer.test.ts test/e2e/tunnel
npm test -- --runInBand
git log -1 --format=%B   # 서명 0건, 제목에 단계 표식 없음 확인
```

## 선행 · 후행

- 선행: U5-02, U2-09, U0-02(`large-transfer.test.ts` 회귀 기준).
- 후행: 없음.

## 근거 문서

- `docs/design/2026-09-11-unit5-connection-security.md` §2(바이트 흐름), §7(속성 11 행·프리셋 값), §8.3(`bandwidth-preset.test.ts`), §9(U5-09)
- `docs/design/2026-09-11-unit2-rbac-model-api.md` §3(`rate_limit`), §6, §9(U2-08·08)
- `docs/design/2026-09-11-unit0-verification-foundation.md` §3.3, §3.4
- `docs/design/2026-09-11-program-overview.md` §3.5, §4 완료 기준 K4
- `docs/plan/prd/TTTGate-admin-rbac.md` §7 속성 11

---

## 번호 변경

설계 문서 §9 가 8건에서 9건으로 재분할되어 이전 초안의 번호를 아래처럼 옮겼다. 파일 안의 선행·후행 표기는 모두 새 번호다.

| 이전 | 새 번호 | 내용 |
|---|---|---|
| U5-01(리미터+삽입+옵션) | U5-01(순수 리미터) + U5-02(삽입·옵션·bans 임시 API) | 분할 |
| U5-02 | U5-03 | 국가 필터 |
| U5-03 | U5-04 | 거절 통계 |
| U5-04 | U5-05 | 보안 관리 API |
| U5-05 | U5-06 | 화면 |
| U5-06 | U5-07 | 속성 3 |
| U5-07 | U5-08 | 속성 6 |
| U5-08 | U5-09 | 속성 11 |
