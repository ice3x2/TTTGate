# HIGH 이슈 초안 (29건)

본문 형식은 CRITICAL 과 동일하되, 분량을 줄여 요약·근거·재현과 영향·권고·검증 상태 다섯 절로 작성합니다.

---

## H-01

**title**: 유휴 터널 세션이 60초마다 강제 종료됨

**labels**: `bug`, `severity:high`, `area:server`, `regression`

**body**:

## 요약

세션 TTL 이 60초로 고정되어 있고, 활동 시각은 데이터 송수신으로만 갱신됩니다. 조용한 시간이 긴 터널이 1분마다 끊깁니다.

## 근거

- `src/server/TunnelServer.ts:66` — `DEFAULT_SESSION_TTL_MS` 가 60,000 입니다.
- `src/server/TunnelServer.ts:199-230` — TTL 초과 세션을 강제 종료합니다.
- `src/server/TunnelServer.ts:312`, `:333`, `:546` — 활동 시각 갱신 지점이 이 세 곳뿐입니다. 모두 데이터 송수신과 세션 개시이며, TCP keepalive 프로브는 활동으로 집계되지 않습니다.
- `src/server/TunnelServer.ts:160-169` — `configureSessionTtl` 이 최소 1초에서 최대 1시간만 허용해 비활성화가 불가능합니다. 실제 코드에서는 테스트만 이 함수를 호출하므로 운영 환경은 항상 60초로 동작합니다.

## 재현과 영향

세션을 열고 양방향 모두 데이터를 보내지 않은 채 60초가 지나면 발생합니다. 유휴 SSH 세션, RDP, 데이터베이스 커넥션 풀처럼 조용한 시간이 긴 TCP 터널이 1분마다 끊겨 터널링 도구의 핵심 용도가 깨집니다.

## 권고

세 가지를 함께 적용하십시오.

1. 기본 TTL 을 크게 올립니다. 유휴 SSH 세션과 데이터베이스 커넥션 풀을 견디려면 최소 30분이 필요하며, 상용 터널링 도구의 관례를 따르면 1시간이 무난합니다.
2. 허용 범위의 하한을 없애 0 이나 음수로 비활성화할 수 있게 합니다. 지금은 최소 1초라서 끌 수가 없습니다.
3. TTL 을 서버 옵션으로 노출해 운영자가 조정할 수 있게 합니다. 현재는 테스트만 이 값을 바꿀 수 있습니다.

아울러 제어 채널의 세션 관련 패킷 수신을 활동으로 집계하면, 데이터가 흐르지 않는 세션도 살아 있음을 표현할 수 있습니다.

## 검증 상태

- 기존 테스트 커버: 반대로 고정되어 있습니다. `test/e2e/req-09-pool-swap-zombie.test.ts:101` 이 TTL 을 1초로 낮춰 이 동작을 정상으로 단언합니다. **수정과 함께 이 테스트를 개정해야 합니다.**
- 도입 시점: 신규. 배포본 `1.0.11b` 의 `TunnelServer` 에는 세션 TTL 기능 자체가 없습니다.
- 확인 방법: 코드 확인 및 활동 갱신 지점 전수 조사.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.1

---

## H-02

**title**: 파일 캐시 읽기 실패 시 빈 버퍼를 대신 보내고 성공으로 보고해 데이터가 조용히 사라짐

**labels**: `bug`, `severity:high`, `area:resource`, `latent`

**body**:

## 요약

캐시 읽기가 실패하면 빈 버퍼로 대체하는데, 뒤이은 전송 루프는 원래 길이 기준으로 판정하고 송신 누적량에도 원래 길이를 더합니다. 0바이트를 보내고 성공으로 보고합니다.

## 근거

- `src/util/SocketHandler.ts:706` — 읽기 결과가 없으면 `EMPTY_BUFFER` 로 대체합니다.
- `src/util/SocketHandler.ts:597-601` — 0바이트 검사가 `waitItem.length` 라는 원래 길이를 봅니다.
- `src/util/SocketHandler.ts:614` — 쓰기 성공 후 `this._sendLength += length` 를 실행합니다.
- `src/util/FileCache.ts:141-152` — 캐시가 삭제되었거나 파일 서술자가 닫혔거나 해당 식별자가 없으면 값 없음을 반환합니다.
- `src/util/SocketHandler.ts:717-720` — 같은 캐시 항목을 두 번째로 해제하며 전역 캐시 사용량을 이중으로 감산합니다. 그 결과 전역 파일 캐시 상한이 실제보다 느슨해집니다.

## 재현과 영향

캐시가 삭제된 상태에서 큐에 항목이 남아 있으면 발생합니다. 소켓 종료와 쓰기 완료가 겹치는 시점이 여기 해당하며, H-03 의 식별자 재사용이 이 조건을 만듭니다. 임의의 TCP 트래픽을 중계하는 제품에서 데이터가 오류 기록 없이 사라지고 수신 측 스트림이 잘린 채 이어집니다. 파일 전송이 손상되며 원인 추적이 불가능합니다.

## 권고

읽기 실패는 예외 상황이므로 실패로 처리합니다. 쓰기 완료 콜백에 실패를 통지하고 핸들러를 파기하며, 조용한 대체를 제거합니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/unit/util/SocketHandler.resource.test.ts` 는 쿼터 초과 시 fail-closed 동작만 검증합니다.
- 도입 시점: 기존.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.2

---

## H-03

**title**: 파일 캐시 블록 재사용 시 식별자를 재발급하지 않아 전송 중인 데이터가 해제됨

**labels**: `bug`, `severity:high`, `area:resource`, `latent`

**body**:

## 요약

블록을 재사용할 때 길이만 갱신하고 식별자를 새로 발급하지 않습니다. 해제된 식별자가 다음 쓰기에서 다른 데이터에 다시 붙습니다.

## 근거

- `src/util/FileCache.ts:116-120` — 재사용 분기가 `block.length` 만 갱신합니다.
- `src/util/FileCache.ts:129` — 식별자 증가는 신규 블록 분기에서만 일어납니다.
- `src/util/FileCache.ts:154-169` — `remove()` 가 블록을 빈 블록 목록으로 되돌립니다.
- `src/util/SocketHandler.ts:703-705` — 읽기 직후 즉시 해제하므로, 데이터가 아직 전송 중인 동안 그 블록이 재사용 대상이 됩니다.

## 재현과 영향

대용량 전송으로 캐시 스필이 반복되는 상황에서 발생합니다. 같은 식별자를 가진 서로 다른 레코드가 공존하게 되고, 오래된 식별자를 들고 있는 정리 경로가 살아 있는 레코드를 해제하면 H-02 의 조용한 데이터 유실로 이어집니다.

## 권고

재사용 블록에도 새 식별자를 발급하십시오. 이것이 이 이슈의 필수 수정입니다.

해제 시점을 읽기 직후가 아니라 쓰기 완료 콜백으로 옮기는 개선은 범위가 크므로 별도 이슈로 다루는 편이 낫습니다. 식별자 재발급만으로도 서로 다른 데이터가 같은 식별자를 공유하는 상황은 사라집니다.

## 검증 상태

- 기존 테스트 커버: 없음. `src/util/FileCache.ts` 를 직접 대상으로 하는 테스트가 없습니다. `test/unit/util/SocketHandler.resource.test.ts:88` 등이 전역 캐시 크기를 간접 참조할 뿐, 블록 재사용 경로는 다루지 않습니다.
- 도입 시점: 기존.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.3

---

## H-04

**title**: 로그 회전 정규식이 템플릿 리터럴 이스케이프 때문에 깨져 오래된 로그가 삭제되지 않음

**labels**: `bug`, `severity:high`, `area:resource`, `latent`

**body**:

## 요약

로그 파일명 판별 정규식이 템플릿 리터럴 안에 작성되어 숫자 클래스 이스케이프가 문자 `d` 로 축약됩니다. 결과 패턴이 실제 파일명과 일치하지 않아 오래된 로그가 한 건도 삭제되지 않습니다.

## 근거

- `src/util/logger/LogWriter.ts:92` — 날짜 파싱용 정규식.
- `src/util/logger/LogWriter.ts:112` — 파일 필터용 정규식.

실제로 생성되는 패턴은 다음과 같으며, `server-2026.09.05.log` 와 일치하지 않는 것을 확인했습니다.

```
^server-d{4}.d{2}.d{2}.log$
```

- `src/util/logger/LogWriter.ts:62-81` — 파일 목록이 항상 비어 반환되므로 정리 함수가 아무것도 삭제하지 못합니다.
- `src/bootstrap/AppCompositionRoot.ts:11` — 보관 기간 2일 설정이 무효화됩니다. 설정을 지정하지 않았을 때의 기본값 30일도 함께 무효입니다.

## 재현과 영향

서버를 며칠 이상 운영하면 재현됩니다. 터널링 서버는 연결마다 로그를 남기므로 로그 디렉터리가 빠르게 증가해 결국 디스크를 소진합니다.

## 권고

정규식을 문자열 결합이나 `String.raw` 로 작성해 이스케이프가 보존되게 합니다. 로거 이름에 정규식 메타문자가 들어갈 가능성도 함께 이스케이프합니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/util/r2-req-05-errors-redact.test.ts:65-68` 이 `LogWriter` 를 인스턴스화하지만 비밀 정보 가림 동작만 검증하며, 파일 회전과 삭제 경로를 검증하는 테스트는 없습니다.
- 도입 시점: 기존. 배포본 `1.0.11b` 의 `src/util/logger/LogWriter.ts:91`, `:111` 에 동일한 코드가 있습니다.
- 확인 방법: 코드 확인 및 정규식 동작 실측.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.4

---

## H-05

**title**: 소켓 계층 로그가 파일에 기록되지 않고 데몬 모드에서 전부 소실됨

**labels**: `bug`, `severity:high`, `area:resource`, `latent`

**body**:

## 요약

`SocketHandler` 와 `TCPServer` 만 빈 이름으로 로거를 요청합니다. 빈 이름은 파일 출력이 꺼진 기본 writer 로 연결되며, 데몬 모드는 콘솔 출력마저 버립니다.

## 근거

- `src/util/SocketHandler.ts:15` — `getLogger('', ...)`.
- `src/util/TCPServer.ts:8` — 동일합니다.
- `src/util/logger/LoggerConfig.ts:21-28` — 빈 이름은 `file: false` 인 기본 writer 로 연결됩니다.
- `src/Sentinel.ts:264` — 데몬 모드가 자식 프로세스를 `stdio: ['ignore','ignore','ignore']` 로 띄웁니다.

## 재현과 영향

데몬 모드로 운영하면 항상 해당합니다. 파일 캐시 쿼터 초과 경고, 소켓 쓰기 오류, 타임아웃 기록이 하나도 남지 않습니다. H-02 의 데이터 유실이 발생해도 흔적이 없습니다.

## 권고

두 모듈의 로거에 이름을 부여해 파일 출력을 켭니다.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 기존.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.5

---

## H-06

**title**: 클라이언트 제어 연결의 keepalive 가 기본값에서 꺼져 있어 끊어진 터널을 감지하지 못함

**labels**: `bug`, `severity:high`, `area:client`, `latent`

**body**:

## 요약

클라이언트 keepAlive 기본값이 0 이고 그 경우 소켓 keepalive 가 꺼집니다. 제어 연결에는 주기적 트래픽도 없고 하트비트 패킷도 프로토콜에 정의되어 있지 않습니다.

## 근거

- `src/client/ClientApp.ts:122` — 기본값이 0 입니다.
- `src/util/TlsOptionsFactory.ts:27` — 값이 0 이면 소켓 keepalive 를 끕니다.
- `src/commons/CtrlPacket.ts:36-51` — Ping 계열 명령이 정의되어 있지 않습니다.
- `src/client/TunnelClient.ts:112-123` — 연결 옵션 생성부가 keepalive 를 설정하지 않아 데이터 핸들러만 기본값 60초를 받습니다.
- `src/util/TCPServer.ts:11` — 서버는 자체 기본값 10초로 단절을 감지합니다.

## 재현과 영향

NAT 유휴 타임아웃, 케이블 분리, 서버 호스트 전원 차단처럼 종료 신호가 오지 않는 단절에서 재현됩니다. 클라이언트는 끊긴 터널을 무한정 정상으로 인식하고 재연결하지 않으므로, 터널은 프로세스를 수동 재시작할 때까지 죽어 있습니다. 생존 감지가 가장 중요한 제어 연결이 유일하게 keepalive 없이 동작하는 역전 구조입니다.

## 권고

클라이언트 keepAlive 기본값을 서버와 대칭인 양수로 바꾸고, 연결 옵션 생성부에서 제어와 데이터 양쪽에 동일한 값을 적용합니다.

## 검증 상태

- 기존 테스트 커버: 부분적. `test/unit/client/TunnelClient.keepalive.test.ts` 는 명시적으로 지정한 값의 전달만 확인하며, 기본값이 keepalive 를 비활성화한다는 사실은 검증하지 않습니다.
- 도입 시점: 기존.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.6

---

## H-07

**title**: 클라이언트 데이터 핸들러의 종료 이벤트가 처리되지 않아 세션과 내부망 연결이 누수됨

**labels**: `bug`, `severity:high`, `area:client`, `latent`

**body**:

## 요약

데이터 핸들러 소켓의 이벤트 콜백에 연결과 수신 분기만 있고 종료 분기가 없습니다. 데이터 연결만 끊기면 세션이 활성 맵에 영구히 남습니다.

## 근거

- `src/client/TunnelClient.ts:388-420` — `SocketState.Connected` 와 `SocketState.Receive` 분기만 존재합니다.
- `src/client/TunnelClient.ts:257-265` — 대비되는 제어 핸들러는 종료 분기를 가집니다.
- `src/util/SocketHandler.ts:505-508` — 죽은 핸들러에 대한 쓰기가 조용히 버려집니다.
- `src/client/TunnelClient.ts:444-447` — 최초 연결 실패 시 맵에 등록되지 않아 뒤이은 세션 개시 요청이 조용히 실패합니다.

## 재현과 영향

제어 연결은 유지된 채 데이터 연결 하나만 끊어지는 경우입니다. 중간 방화벽이나 로드밸런서가 유휴 데이터 연결을 개별적으로 끊거나 서버가 데이터 소켓만 리셋하는 상황이 해당합니다. 내부망 엔드포인트 소켓이 닫히지 않고 서버에도 종료가 통보되지 않아, 제어 연결이 죽을 때까지 세션과 내부망 커넥션이 누적됩니다.

## 권고

데이터 핸들러 이벤트 콜백에 종료 분기를 추가해 핸들러를 정리하고 엔드포인트 종료를 상위로 통보합니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/unit/client/req-14-connect-race.test.ts` 는 식별자 주입 경합만 검증합니다.
- 도입 시점: 기존.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.7

---

## H-08

**title**: 폐기된 `TunnelClient` 의 지연 콜백이 새 연결의 상태를 오염시킴

**labels**: `bug`, `severity:high`, `area:client`, `latent`

**body**:

## 요약

상태 변경 콜백이 어느 클라이언트에서 온 것인지 확인하지 않습니다. 폐기된 이전 클라이언트의 지연된 종료 이벤트가 이미 살아 있는 새 연결을 무너뜨립니다.

## 근거

- `src/client/TTTClient.ts:48` — 콜백 시그니처의 `client` 인자를 사용하지 않습니다.
- `src/client/TTTClient.ts:53-68` — 종료 상태에서 온라인 플래그를 내리고 엔드포인트 풀을 폐기합니다.
- `src/client/TTTClient.ts:32-46` — 재시작 시 이전 `_tunnelClient` 를 파기하지 않습니다.
- `src/client/TunnelClient.ts:167-171` — 핸드셰이크 실패 시 소켓이 닫히기 전에 종료 콜백을 먼저 호출합니다.

## 재현과 영향

핸드셰이크 실패 후 5초 뒤 재연결이 이루어졌는데, 이전 소켓이 그보다 늦게 종료 이벤트를 발화하면 재현됩니다. 살아 있는 엔드포인트 풀이 폐기되어 클라이언트는 서버에 온라인으로 보이지만 어떤 세션도 열 수 없는 상태가 됩니다. 이어서 중복 재연결 타이머가 등록되어 서버가 동일 이름의 클라이언트를 둘 보게 됩니다.

## 권고

콜백 진입부에서 현재 클라이언트가 아니면 즉시 반환합니다. 재시작 시 이전 클라이언트와 풀을 먼저 정리하고, 연결 성공 분기에서 대기 중인 재연결 타이머를 취소합니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/e2e/req-09-pool-swap-zombie.test.ts` 와 `test/stress/reconnect-churn.test.ts` 는 서버 전체 재시작만 반복하며 핸드셰이크 실패 후 지연 종료 시나리오는 다루지 않습니다.
- 도입 시점: 기존.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.8

---

## H-09

**title**: 클라이언트 재연결 때마다 서버의 `TCPServer` 핸들러 맵에 항목이 누적됨

**labels**: `bug`, `severity:high`, `area:server`, `latent`

**body**:

## 요약

풀 종료 시 소켓 이벤트 콜백을 빈 함수로 교체하는데, 핸들러 맵 정리가 바로 그 콜백 안에만 존재합니다. 소켓은 닫히지만 핸들러 객체가 서버 수명 내내 참조로 남습니다.

## 근거

- `src/server/ClientHandlerPool.ts:545-551` — 종료 시 `onSocketEvent` 를 빈 함수로 교체합니다.
- `src/util/TCPServer.ts:118-123` — `_idHandlerMap.delete` 가 그 콜백 안에만 있습니다.

## 재현과 영향

제어 연결이 끊어져 풀이 종료되면 그 시점에 살아 있던 데이터 핸들러들이 정리되지 않습니다. 감사 과정에서 제어 하나와 데이터 핸들러 하나를 붙인 뒤 제어를 끊었더니, 데이터 소켓이 파괴된 상태인데도 맵에 항목이 남는 것을 확인했습니다. 재연결이 잦은 환경에서 활성 세션 수에 비례해 누적되어 결국 메모리가 고갈됩니다.

## 권고

`TCPServer` 가 소켓의 종료 이벤트에 직접 정리 리스너를 걸게 하는 편을 권장합니다. 그러면 콜백을 누가 교체하든 정리가 보장되며, 같은 근원을 가진 H-10 도 함께 해결됩니다.

## 관련 이슈

H-10 과 근원이 같습니다. 두 이슈는 함께 처리하십시오.

## 검증 상태

- 기존 테스트 커버: 없음. `test/stress/reconnect-churn.test.ts` 는 파일 서술자 수와 캐시 바이트만 확인하므로 이 누수를 잡지 못합니다.
- 도입 시점: 기존.
- 확인 방법: 실행 재현.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.9

---

## H-10

**title**: HTTP 외부 포트가 접속 하나마다 핸들러를 영구 누적함

**labels**: `bug`, `severity:high`, `area:http`, `area:server`, `latent`

**body**:

## 요약

`HttpHandler` 생성자가 소켓 이벤트 콜백을 가로채면서 `TCPServer` 의 핸들러 맵 정리 경로가 끊깁니다. H-09 와 같은 근원이며 HTTP 모드에만 나타납니다.

## 근거

- `src/server/ExternalPortServerPool.ts:349-350` — HTTP 모드에서 `HttpHandler` 를 생성해 바인딩합니다.
- `src/server/http/HttpHandler.ts:100` — 생성자가 `socketHandler.onSocketEvent` 를 가로챕니다.
- `src/util/TCPServer.ts:118-121` — 맵 정리가 원래 콜백 안에만 있습니다.

## 재현과 영향

프로토콜이 `http` 또는 `https` 인 포워딩 포트에 접속했다가 끊으면 매번 발생합니다. 감사 과정에서 HTTP 포트에 10회 접속 후 종료했더니 맵에 10개가 남았고, 같은 시나리오를 TCP 포트로 하면 살아 있는 소켓 수와 정확히 일치했습니다. 웹 트래픽을 중계하는 포트에서 커넥션 수만큼 메모리가 증가합니다.

## 권고

`TCPServer` 가 소켓의 종료 이벤트에 직접 정리 리스너를 걸게 하는 편을 권장합니다. H-09 와 같은 수정으로 두 결함이 함께 해결됩니다. 차선책은 `HttpHandler` 가 원본 콜백을 보관했다가 전달하는 것입니다.

## 관련 이슈

H-09 와 근원이 같습니다. 두 이슈는 함께 처리하십시오.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 기존.
- 확인 방법: 실행 재현.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.10

---

## H-11

**title**: 누적 수신량이 4GiB 를 넘긴 세션은 종료 패킷 생성에서 예외를 던짐

**labels**: `bug`, `severity:high`, `area:protocol`, `latent`

**body**:

## 요약

세션 종료 패킷이 누적 수신량을 32비트로 기록하는데, 그 값의 출처인 카운터는 어디에서도 초기화되지 않습니다. 4GiB 를 넘긴 세션을 닫으면 범위 초과 예외가 발생합니다.

## 근거

- `src/commons/CtrlPacket.ts:140-141` — `Buffer.alloc(4)` 에 `writeUInt32BE` 로 기록합니다.
- `src/util/SocketHandler.ts:364` — 수신 누적 카운터가 초기화되지 않습니다.
- `src/server/ClientHandlerPool.ts:458` — 서버 측 호출부에 예외 처리가 없습니다.
- `src/client/TunnelClient.ts:567`, `:583-585` — 클라이언트 측 `sendCloseSession` 은 본문 전체가 예외 처리로 감싸여 있어 예외가 흡수됩니다. 따라서 이 결함은 서버 측에서만 드러납니다.

32비트 범위를 넘는 값에 대해 `writeUInt32BE` 가 `ERR_OUT_OF_RANGE` 를 던지는 것을 Node 런타임에서 실측 확인했습니다.

## 재현과 영향

한 세션으로 4GiB 를 초과 전송한 뒤 닫으면 발생합니다. 대용량 파일 전송이라는 정상 사용에서 도달하는 경로입니다.

클라이언트는 자체 예외 처리로 보호되므로 이 결함은 서버 측에서만 드러납니다. 서버 호출부가 수신 이벤트 경로 안이면 소켓 계층이 예외를 잡아 해당 제어 소켓을 파괴하고, 경로 밖이면 처리되지 않은 예외가 됩니다. 어느 쪽이든 세션 종료 통보가 실패하므로 상대 측 세션이 정리되지 않고 남습니다.

## 권고

길이 필드를 64비트로 확장하거나, 값을 32비트 범위로 포화시키고 호출부에 예외 처리를 둡니다.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 기존.
- 확인 방법: 코드 확인 및 Node 런타임 예외 실측.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.11

---

## H-12

**title**: 연결 종료로 길이를 구분하는 HTTP/1.1 응답의 본문이 전량 유실됨

**labels**: `bug`, `severity:high`, `area:http`, `latent`

**body**:

## 요약

길이 정보가 없는 응답에 대해 HTTP/1.0 만 본문 있음으로 처리하고 HTTP/1.1 은 즉시 종료 처리합니다. 표준이 허용하는 연결 종료 구분 응답에서 본문이 사라집니다.

## 근거

- `src/server/http/HttpPipe.ts:190-198` — 버전이 `HTTP/1.0` 일 때만 길이 미상 본문 상태로 진입합니다.

## 재현과 영향

`HTTP/1.1 200 OK` 와 `Connection: close` 와 본문 조합에서 전달 바이트가 0 이고 본문이 잔여 버퍼에 남은 채 폐기되는 것을 확인했습니다. 클라이언트가 빈 본문을 받습니다.

## 권고

응답이면서 Content-Length 와 Transfer-Encoding 이 모두 없으면 버전과 무관하게 길이 미상 본문으로 진입시킵니다. 1xx 와 204 와 304 는 예외로 둡니다.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 기존.
- 확인 방법: 실행 재현.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.12

---

## H-13

**title**: 본문 재작성 경로가 바이너리와 비 UTF-8 응답을 파괴함

**labels**: `bug`, `severity:high`, `area:http`, `latent`

**body**:

## 요약

본문을 문자열로 바꾼 뒤 다시 버퍼로 되돌리는 과정에서 UTF-8 로 해석되지 않는 바이트가 대체 문자로 치환됩니다.

## 근거

- `src/server/http/HttpHandler.ts:482-489` — `toString()` 후 `Buffer.from()` 을 수행합니다.
- `src/server/http/HttpUtil.ts:148-172` — 미지원 인코딩은 압축 상태 그대로 반환합니다.
- `src/server/http/HttpUtil.ts:155-161` — 다중 인코딩의 순서를 무시합니다.

## 재현과 영향

감사 과정에서 확인한 손상 사례는 다음과 같습니다.

| 입력 | 결과 |
|---|---|
| `Content-Encoding: zstd` 본문 | 복구 불가능하게 훼손 |
| `charset=euc-kr` 본문 | 모든 바이트가 대체 문자로 치환 |
| `Content-Encoding: br, gzip` | gzip 만 풀고 brotli 계층 훼손 |

한국어 EUC-KR 페이지를 서비스하는 내부망 웹서버가 정확히 이 경로에 해당합니다. 헤더는 원래 인코딩을 유지하므로 클라이언트 디코딩도 실패합니다.

## 권고

문자셋이 UTF-8 이 아니거나 인코딩 토큰이 지원 대상 단일값이 아니면 재작성을 건너뛰고 원본 바이트를 그대로 흘리십시오.

이때 헤더도 원본 그대로 두어야 합니다. 지금은 재작성 여부와 무관하게 `Content-Length` 를 제거하고 `Transfer-Encoding: chunked` 를 붙이므로, 재작성을 건너뛰면 원래 길이 정보를 되살려야 합니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/unit/server/http/HttpHandler.rewrite.test.ts:92` 는 gzip 한계 초과 우회만 검증합니다.
- 도입 시점: 기존.
- 확인 방법: 실행 재현.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.13

---

## H-14

**title**: Host 치환이 모든 헤더 값에 부분 문자열로 적용되어 무관한 헤더를 훼손함

**labels**: `bug`, `severity:high`, `area:http`, `latent`

**body**:

## 요약

호스트 치환 함수가 헤더 이름을 가리지 않고 모든 헤더 값에서 호스트 문자열을 부분 문자열로 찾아 바꿉니다.

## 근거

- `src/server/http/HttpHandler.ts:350-356` — `replaceHostInHeader` 가 전체 헤더를 순회하며 값에 호스트가 포함되면 치환합니다.

## 재현과 영향

짧은 호스트명이나 IP 주소를 쓰는 배포에서 재현됩니다. 감사 과정에서 확인한 사례는 다음과 같습니다.

| 원본 헤더 | 치환 후 |
|---|---|
| `User-Agent: Mozilla/5.0` | `Mozillinternal.example/5.0` |
| `Cookie: sid=aaa` | `sid=internal.exampleaa` |

쿠키와 인증 헤더가 손상되어 로그인 세션이 깨집니다.

## 권고

치환 대상을 Host 헤더로 한정하고, 필요한 다른 헤더는 명시적으로 열거합니다.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 기존.
- 확인 방법: 실행 재현.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.14

---

## H-15

**title**: 재작성 상한을 넘는 텍스트 응답이 통지 없이 사라져 클라이언트가 무한 대기함

**labels**: `bug`, `severity:high`, `area:http`, `latent`

**body**:

## 요약

본문 재작성 상한을 넘으면 실패를 반환하지만, 소켓 파괴는 다음 수신이 있어야 일어납니다. 그 사이 클라이언트는 아무 응답도 받지 못합니다.

## 근거

- `src/server/http/HttpHandler.ts:366-389` — 상한 초과 시 실패를 반환합니다.
- `src/server/http/HttpHandler.ts:116-120` — 소켓 파괴가 다음 수신 시점에 일어납니다.

## 재현과 영향

감사 과정에서 17MiB `text/plain` 응답을 보냈더니 클라이언트가 받은 바이트는 헤더 73바이트뿐이었고 소켓 파괴도 일어나지 않았습니다. 상한을 넘는 텍스트 응답에서 클라이언트가 무한 대기합니다.

## 권고

상한 초과 시 즉시 502 응답을 보내고 소켓을 종료하십시오. 클라이언트가 무한 대기하는 것보다 명시적 오류가 낫습니다.

재작성을 포기하고 원본을 그대로 흘리는 방식은 더 나은 사용자 경험을 주지만, 본문에 내부망 호스트명이 남는다는 부작용이 있으므로 이 이슈의 범위 밖으로 둡니다.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 기존.
- 확인 방법: 실행 재현.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.15

---

## H-16

**title**: 중복 Host 헤더가 검증 없이 내부망으로 전달됨

**labels**: `bug`, `severity:high`, `area:http`, `latent`

**body**:

## 요약

Host 헤더가 여러 개 있어도 거부하지 않고, 첫 번째만 치환한 뒤 나머지는 원문 그대로 내부망에 전달합니다.

## 근거

- `src/server/http/HttpPipe.ts:291-368` — 헤더 파싱이 중복 Host 를 거부하지 않습니다.
- `src/server/http/HttpHandler.ts:350-356` — 치환 함수는 모든 헤더를 순회하지만, 값이 원본 Host 와 다른 두 번째 헤더는 일치하지 않아 그대로 남습니다.

## 재현과 영향

서로 다른 값을 가진 Host 헤더 두 개를 함께 보내면 두 번째가 원문 그대로 도달합니다. 내부 서버가 어느 값을 채택하느냐에 따라 가상 호스트 라우팅과 캐시 키가 갈립니다.

## 권고

Host 헤더가 둘 이상이면 400 으로 거부합니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/security/req-05-smuggling.test.ts` 는 Content-Length 와 Transfer-Encoding 중복만 검증합니다.
- 도입 시점: 기존.
- 확인 방법: 실행 재현.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.16

---

## H-17

**title**: 관리자 설정 저장에 낙관적 잠금이 없어 동시 저장 시 앞선 변경이 조용히 사라짐

**labels**: `bug`, `severity:high`, `area:admin`, `regression`

**body**:

## 요약

리비전 값이 응답에만 실리고 요청에서는 검증되지 않습니다. 두 관리자가 같은 스냅샷에서 저장하면 나중 요청이 앞선 변경을 덮어쓰면서도 양쪽 모두 성공을 반환합니다.

## 근거

- `src/server/admin/AdminServer.ts:425`, `:508`, `:533`, `:591`, `:640` — 리비전을 응답에 싣기만 하고 요청에서는 검증하지 않습니다.
- `src/server/ServerOptionStore.ts:80-102` — 커밋 시 리비전을 증가시키기만 합니다.
- `src/server/admin/AdminServer.ts:412`, `:461`, `:481` — 본문 파싱과 포트 검사와 런타임 적용에 비동기 대기 지점이 있어 두 요청이 교차 실행될 수 있습니다.

## 재현과 영향

두 관리자가 같은 화면에서 서로 다른 필드를 저장하면 재현됩니다. 한쪽 변경이 통지 없이 사라지며, 사용자는 저장에 성공했다고 인식합니다.

## 권고

요청 본문에 클라이언트가 읽은 리비전을 실어 보내게 하고, 서버가 현재 리비전과 대조해 불일치 시 409 로 거부합니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/unit/server/ServerOptionStore.revision.test.ts` 는 단일 커밋만 검증합니다.
- 도입 시점: 신규. 리비전 기능 자체가 개선 작업에서 추가되었습니다.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.17

---

## H-18

**title**: 설정 커밋 실패 시 런타임 롤백이 없어 메모리·디스크·런타임 상태가 어긋남

**labels**: `bug`, `severity:high`, `area:admin`, `regression`

**body**:

## 요약

디스크 쓰기 실패 시 예외가 그대로 올라가 일반 500 응답이 됩니다. 이미 교체된 메모리 설정과 적용된 런타임을 되돌리는 경로가 없습니다.

## 근거

- `src/server/ServerOptionStore.ts:90`, `:91`, `:100`, `:200` — 메모리 교체와 리비전 증가가 디스크 쓰기보다 먼저 일어나고, 쓰기 예외가 그대로 전파됩니다.
- `src/server/admin/AdminServer.ts:481` — 런타임 적용 지점.
- `src/server/admin/AdminServer.ts:517` — 실패 경로가 `recordRollback` 을 호출하지만, `src/server/ServerOptionStore.ts:114-123` 의 이 함수는 롤백 사실을 메타데이터로 기록할 뿐 메모리와 런타임 상태를 실제로 복원하지 않습니다.

## 재현과 영향

디스크 소진이나 권한 오류 상태에서 서버 옵션을 저장하면 재현됩니다. 런타임은 새 설정으로 도는데 디스크는 옛 설정이고 메모리는 새 설정인 세 갈래 불일치가 남습니다. 재기동하면 동작이 또 달라집니다.

## 권고

디스크 쓰기를 먼저 수행하고 성공한 뒤에 메모리와 런타임을 교체하거나, 실패 시 이전 상태로 되돌리는 경로를 명시적으로 둡니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/component/server/admin/AdminServer.apply.test.ts:67` 은 런타임 적용 실패만 다룹니다.
- 도입 시점: 신규.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.18

---

## H-19

**title**: 인증서 파일명이 검증 없이 파일 경로로 사용되어 임의 경로 쓰기와 삭제가 가능함

**labels**: `bug`, `severity:high`, `area:admin`, `latent`

**body**:

## 요약

인증서 등록 시 사용자가 지정한 이름을 그대로 디렉터리와 결합해 경로를 만듭니다. 검증은 PEM 값만 확인하고 이름은 보지 않습니다.

## 근거

- `src/server/CertificationStore.ts:180`, `:183`, `:186` — 사용자 입력 이름을 경로에 결합합니다.
- `src/server/CertificationStore.ts:192-200` — 삭제 경로도 동일합니다.
- `src/server/CertificationStore.ts:375-381` — 검증이 PEM 값만 확인합니다.
- `src/server/admin/AdminServer.ts:349` — 타입 검사와 PEM 키쌍 검증을 수행하지만 이름은 검사하지 않습니다.

## 재현과 영향

인증된 관리자가 인증서 이름에 상위 경로 참조를 넣으면 재현됩니다. 프로세스 권한으로 임의 경로에 PEM 내용을 기록할 수 있고, 다음 갱신 시 그 경로가 삭제됩니다. 관리자 비밀번호 해시 파일을 덮어쓰면 영구 로그인 불가 상태가 됩니다.

## 권고

이름을 기본 파일명으로 축약하고, 경로 구분자나 상위 참조를 포함한 이름은 400 으로 거부합니다.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 기존.
- 확인 방법: 코드 확인 및 경로 결합 동작 실측.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.19

---

## H-20

**title**: 터널링 옵션 hot apply 에 정규화되지 않은 원본이 전달되어 저장 설정과 런타임이 어긋남

**labels**: `bug`, `severity:high`, `area:admin`, `area:server`, `regression`

**body**:

## 요약

응답에는 정규화한 복사본을 담으면서 런타임 적용에는 정규화되지 않은 원본을 넘깁니다. 저장된 설정과 실제 리스너의 동작이 달라집니다.

## 근거

- `src/server/admin/AdminServer.ts:545` — 복사본을 정규화해 응답 결과에 담습니다.
- `src/server/admin/AdminServer.ts:560` — 런타임 적용에는 정규화되지 않은 원본을 넘깁니다.
- `src/server/ExternalPortServerPool.ts:127` — 옵션의 TLS 값을 그대로 사용합니다.
- `src/server/ExternalPortServerPool.ts:77` — 정규화가 생성자에서만 호출됩니다.
- `src/server/ServerOptionStore.ts:334-337` — 저장본에는 정규화가 적용됩니다.

## 재현과 영향

TLS 필드를 생략해 https 터널을 저장하면 재현됩니다. 저장본에는 TLS 사용으로 기록되는데 실제 외부 리스너는 평문으로 열립니다. 재기동하면 TLS 로 바뀌므로 재기동 전후 동작이 달라집니다. keepAlive 와 버퍼 한도 계열 기본값도 같은 방식으로 갈립니다.

## 권고

정규화된 옵션을 런타임에 전달합니다. 응답 결과에서 해당 포트의 정규화된 값을 꺼내 쓰면 됩니다.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 신규.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.20

---

## H-21

**title**: 매칭되지 않는 POST 와 DELETE 요청에 아무 응답도 반환하지 않음

**labels**: `bug`, `severity:high`, `area:admin`, `latent`

**body**:

## 요약

메서드별 라우팅에서 404 폴백이 GET 경로에만 있습니다. 존재하지 않는 POST 나 DELETE 경로를 호출하면 응답이 오지 않습니다.

## 근거

- `src/server/admin/AdminServer.ts:167-178` — 각 메서드 핸들러 호출 후 즉시 반환합니다.
- `src/server/admin/AdminServer.ts:221-238` — POST 라우팅에 폴백이 없습니다.
- `src/server/admin/AdminServer.ts:209-217` — DELETE 라우팅에 폴백이 없습니다.
- `src/server/admin/AdminServer.ts:284-286` — 404 폴백이 GET 경로에만 존재합니다.
- `src/server/admin/AdminServer.ts:158` — 정확 일치 비교 때문에 질의 문자열이 붙은 로그인 경로도 분기에 걸리지 않습니다.

## 재현과 영향

존재하지 않는 POST 경로를 호출하면 재현됩니다. 감사 과정에서 동일 구조의 재현 서버로 확인한 결과, 응답이 전혀 오지 않고 10초 뒤 연결이 초기화되었습니다. 클라이언트는 오류 종류를 구분할 수 없고 그동안 소켓이 점유됩니다.

## 권고

POST 와 DELETE 라우팅 말미에 404 폴백을 추가합니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/component/server/admin/AdminServer.security.test.ts:38` 은 GET 경로만 검증합니다.
- 도입 시점: 기존. 배포본 `1.0.11b` 의 `routePost` 와 `routeDelete` 에도 폴백이 없고 구조가 동일합니다.
- 확인 방법: 실행 재현 및 배포본 커밋 대조.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.21

---

## H-22

**title**: `TCPServer` 재시작 시 서버 이벤트 핸들러가 재부착되지 않아 포트 충돌로 프로세스가 죽음

**labels**: `bug`, `severity:high`, `area:resource`, `latent`

**body**:

## 요약

재시작 시 새 서버 객체를 만들지만 생성자에서 등록한 이벤트 핸들러는 이전 객체에만 남습니다. 리스너 없는 오류 이벤트는 Node 가 예외로 던집니다.

## 근거

- `src/util/TCPServer.ts:160-164` — 재시작 시 새 서버 객체를 생성합니다.
- `src/util/TCPServer.ts:81-105` — 오류와 종료와 리스닝 핸들러가 생성자에서만 등록됩니다.
- `src/util/TCPServer.ts:198-202` — 정지 경로.
- 저장소 전체에 프로세스 전역 예외 처리기가 없습니다.

## 재현과 영향

정지 후 재시작을 거친 리스너에서 포트 충돌이 발생하면 재현됩니다. 처리되지 않은 오류 이벤트로 프로세스가 죽습니다. 외부 포트 설정을 변경하는 hot apply 경로가 이 재시작을 수행합니다.

## 권고

서버 객체 생성 직후 이벤트 핸들러를 재부착합니다.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 기존.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.22

---

## H-23

**title**: `bufferLimitOnServer` 하한 검증 부재로 읽기 백프레셔를 완전히 끌 수 있음

**labels**: `bug`, `severity:high`, `area:server`, `area:resource`, `latent`

**body**:

## 요약

버퍼 한도 검증이 값이 없을 때만 기본값을 채우고 하한을 확인하지 않습니다. 0 이 통과하면 내부적으로 무제한으로 변환되어 백프레셔가 사라집니다.

## 근거

- `src/server/ServerOptionStore.ts:312-313` — 값이 없을 때만 기본값을 채웁니다.
- `src/server/ExternalPortServerPool.ts:342-343` — 1 미만이면 `-1` 로 변환합니다.
- `src/util/SocketHandler.ts:143-149` — 한도가 `-1` 이면 백프레셔 판정이 항상 거짓이 됩니다.
- `src/util/SocketHandler.ts:766-768` — 읽기 정지를 호출하는 지점입니다. 백프레셔 판정이 항상 거짓이므로 이 경로가 한 번도 실행되지 않습니다.

## 재현과 영향

관리자 화면이나 설정 파일에서 서버 버퍼 한도를 0 으로 지정하면 재현됩니다. 느린 수신자 하나가 전역 메모리 예산을 단독으로 소진합니다.

## 권고

검증 단계에서 0 이하 값을 거부하십시오. 사용자가 의도적으로 무제한을 원한다면 별도의 명시적 표기를 두는 편이 안전합니다. 숫자 0 이 "제한 없음" 을 뜻하는 것은 직관에 반하며, 실수로 입력한 0 과 구분되지 않습니다.

## 검증 상태

- 기존 테스트 커버: 부분적. `test/unit/util/QueueLimiter.test.ts` 는 스필 판단만 검증하며, 한도가 무제한일 때 읽기가 멈추지 않는 사실을 확인하는 테스트는 없습니다.
- 도입 시점: 기존.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.23

---

## H-24

**title**: v1 클라이언트가 붙은 서버는 누적 세션 55535개 이후 모든 신규 세션이 실패함

**labels**: `bug`, `severity:high`, `area:protocol`, `regression`

**body**:

## 요약

핸들러 식별자 카운터가 순환 없이 단조 증가하는데 전송 시 16비트로 절단됩니다. 메타를 해석하지 않는 v1 클라이언트에서는 절단된 값이 되돌아와 대조가 실패합니다.

## 근거

- `src/server/ClientHandlerPool.ts:34` — 카운터가 10000 에서 시작합니다.
- `src/server/ClientHandlerPool.ts:296` — 순환 없이 단조 증가합니다.
- `src/commons/CtrlPacket.ts:352` — 전송 시 16비트로 기록합니다.
- `src/server/ClientHandlerPool.ts:368`, `:121-127` — 대조 지점.

## 재현과 영향

legacy 인증을 허용한 서버에 v1 클라이언트가 붙고 누적 세션 수가 55535 를 넘으면 재현됩니다. 절단된 식별자 때문에 대기 세션 탐색과 승격 대조가 모두 실패하여, 해당 클라이언트의 모든 신규 세션이 열리지 않습니다. 서버 재시작 전까지 복구되지 않습니다.

## 권고

카운터를 16비트 범위 안에서 순환시키고 사용 중인 값을 회피하거나, 프로토콜 협상 결과에 따라 wide 식별자 사용을 강제합니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/component/server/ProtocolV2.test.ts:320` 은 v2 양단 조합만 검증하며 v1 과 v2 혼재는 다루지 않습니다.
- 도입 시점: 신규. wide 식별자 메타가 개선 작업에서 도입되었습니다.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.24

---

## H-25

**title**: `DataStatePacket` 뒤에 이어진 바이트가 저장된 뒤 영원히 읽히지 않아 페이로드 선두가 유실됨

**labels**: `bug`, `severity:high`, `area:protocol`, `area:server`, `regression`

**body**:

## 요약

상태 패킷 뒤의 잔여 버퍼를 저장하지만, 그것을 읽는 유일한 지점이 이미 지나간 조건 안에 있습니다. 저장된 바이트가 소비되지 않습니다.

## 근거

- `src/server/TunnelServer.ts:509` — 잔여 버퍼를 저장합니다.
- `src/server/TunnelServer.ts:501` — 유일한 읽기 지점이며, 핸들러 상태가 초기값일 때만 실행됩니다.
- `src/server/TunnelServer.ts:508` — 그 바로 앞에서 상태를 초기화 중으로 바꿉니다.
- `src/server/TunnelServer.ts:524` — 또 다른 저장 지점이지만 이쪽은 정상입니다. 패킷이 미완결일 때 실행되며 핸들러 상태가 그대로 유지되므로 다음 수신에서 `:501` 이 소비합니다. 결함은 `:509` 한 곳입니다.
- `src/types/TunnelHandler.ts:48` — 저장소 선언. 이 저장소를 다루는 지점은 `TunnelServer.ts` 의 `:501`, `:502`, `:503`, `:509`, `:524` 다섯 곳입니다.

## 재현과 영향

상태 패킷과 첫 터널 페이로드가 하나의 수신 청크로 도착하면 발생합니다. 세션 개통 직후 페이로드 선두가 조용히 유실되며, HTTP 터널이라면 요청 라인 일부가 사라집니다.

## 권고

상태 패킷 처리 직후 잔여 버퍼를 즉시 데이터 경로로 넘기거나, 읽기 조건을 상태 전환 이후에도 성립하도록 바꿉니다.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 신규. 데이터 채널 바인딩이 개선 작업에서 도입되었습니다.
- 확인 방법: 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.25

---

## H-26

**title**: `DataStatePacket` 에 길이 필드가 없어 TCP 분할 위치에 따라 세션이 끊기거나 페이로드가 유실됨

**labels**: `bug`, `severity:high`, `area:protocol`, `regression`

**body**:

## 요약

토큰 유무를 버퍼 길이로 판정합니다. TCP 분할 위치에 따라 판정이 뒤집히고, 뒤따르는 페이로드가 합쳐지면 페이로드 앞부분을 토큰 길이로 오독합니다.

## 근거

- `src/commons/DataStatePacket.ts:61-76` — 버퍼 길이가 고정 길이와 같으면 토큰 없는 완결 패킷으로 단정합니다.

## 재현과 영향

감사 과정에서 두 사례를 확인했습니다. 첫째, 토큰을 포함해 보냈는데 TCP 가 고정 길이 경계에서 분할하면 토큰 없는 패킷으로 판정되어, `src/server/ClientHandlerPool.ts:130-134` 의 대조에서 불일치로 세션이 종료됩니다. 둘째, 토큰 없는 패킷 뒤에 터널 페이로드가 같은 세그먼트로 합쳐지면 페이로드 앞 두 바이트를 토큰 길이로 오독합니다. `GET ` 로 시작하는 HTTP 요청은 18245바이트 토큰으로 해석되어 그만큼의 페이로드가 소비되어 사라집니다.

## 권고

prefix 뒤에 토큰 길이 필드를 항상 기록해 경계를 길이로 결정합니다. 토큰이 없으면 길이 0 을 기록하면 하위 호환 판정도 단순해집니다.

## 검증 상태

- 기존 테스트 커버: 없음. `test/unit/commons/DataStatePacket.test.ts` 는 온전한 버퍼 왕복과 최소 길이 미만 케이스만 다룹니다.
- 도입 시점: 신규.
- 확인 방법: 동일 로직을 이식한 재현 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.26

---

## H-27

**title**: 배포 파이프라인에 타입 검사와 테스트 게이트가 없어 결함이 그대로 패키징됨

**labels**: `bug`, `severity:high`, `area:test-ci`, `latent`

**body**:

## 요약

배포 스크립트가 Vite 빌드와 TypeScript 컴파일만 수행합니다. Vite 빌드는 타입을 확인하지 않고, Svelte 타입 검사와 테스트는 호출되지 않습니다.

## 근거

- `deploy.js:12` — admin 빌드를 실행합니다.
- `deploy.js:19` — TypeScript 컴파일을 실행합니다.
- `deploy.js:34` — 바이너리 패키징을 실행합니다.
- `admin/package.json:10` — `check` 스크립트가 정의되어 있으나 파이프라인에서 호출되지 않습니다.
- 의존성 설치 단계가 없어 잠금 파일이 실제 설치에 반영되지 않습니다.

## 재현과 영향

`node deploy.js` 를 실행하면 재현됩니다. C-01 부터 C-04 까지의 프론트엔드 결함이 모두 빌드를 통과해 배포물에 포함됩니다.

## 권고

admin 빌드 앞에 의존성 설치와 Svelte 타입 검사를, TypeScript 컴파일 뒤에 테스트를 게이트로 배치합니다.

## 검증 상태

- 기존 테스트 커버: 해당 없음.
- 도입 시점: 기존.
- 확인 방법: 배포 스크립트 코드 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §5.27

---

## H-28

**title**: 잘못된 제어 프레임 하나로 클라이언트의 터널 연결이 끊김

**labels**: `bug`, `severity:high`, `area:client`, `area:protocol`, `latent`

**body**:

## 요약

서버는 제어 패킷 읽기를 예외 처리로 감싸 실패를 클라이언트 풀 정리로 처리합니다. 클라이언트에는 그 처리가 없어, 예외가 소켓 계층의 일반 오류 경로로 흘러 제어 연결이 파괴됩니다. 같은 프레이밍 코드를 공유하면서 오류 처리 수준만 비대칭입니다.

## 근거

- `src/server/TunnelServer.ts:576-593` — 서버는 `readCtrlPacketList` 를 예외 처리로 감싸고, 실패 시 해당 클라이언트 풀만 정리합니다.
- `src/client/TunnelClient.ts:292` — 클라이언트에는 대응하는 예외 처리가 없습니다.
- `src/util/SocketHandler.ts:365-372` — 수신 이벤트 콜백의 예외는 여기서 잡혀 `procError` 로 넘어갑니다. 따라서 프로세스는 죽지 않습니다.
- `src/util/SocketHandler.ts:386-394` — `procError` 가 소켓을 종료 상태로 만들고 대기 큐를 파기합니다.
- `src/commons/CtrlPacket.ts:395`, `:457` — 잘못된 prefix, 잘못된 command 값, 상한 초과 길이, 누적 상한 초과에서 예외를 던집니다.
- `src/commons/CtrlPacket.ts:293`, `:320` — 절단된 `OpenSession` 페이로드도 예외를 던집니다.

## 재현과 영향

서버가 잘못된 프레임을 하나 보내거나, TLS 를 쓰지 않는 배포에서 중간자가 프레임을 주입하면 재현됩니다. 클라이언트의 제어 연결이 끊기고 진행 중이던 모든 세션이 함께 사라집니다. 재연결 절차가 돌긴 하지만, H-08 이 지적한 지연 콜백 문제와 겹치면 재연결 자체가 어긋날 수 있습니다.

프로세스가 종료되지는 않습니다. 수신 이벤트 경로는 소켓 계층에서 예외를 잡기 때문입니다. 다만 예외를 어디에서 잡느냐에 따라 복구 품질이 달라집니다. 서버처럼 프레이밍 실패를 명시적으로 처리하면 원인을 기록하고 정돈된 순서로 정리할 수 있는데, 지금은 일반 소켓 오류와 구분되지 않습니다.

## 권고

서버 측과 동일하게 `readCtrlPacketList` 호출을 예외 처리로 감싸고, 실패 시 원인을 기록한 뒤 제어 핸들러를 정리하고 재연결 절차로 넘깁니다.

## 관련 이슈

H-29 가 지적한 클라이언트 측 호출부 세 곳이 이 수정 범위 안에 있습니다. 두 이슈를 함께 처리하십시오.

## 검증 상태

- 기존 테스트 커버: 없음.
- 도입 시점: 기존.
- 확인 방법: 서버와 클라이언트 양쪽 코드 대조, 그리고 소켓 계층의 이벤트별 예외 처리 범위 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.7

---

## H-29

**title**: 조작된 메타 페이로드가 도착하면 제어 연결이 끊김

**labels**: `bug`, `severity:high`, `area:protocol`, `regression`

**body**:

## 요약

`CtrlMetaGuards` 는 "가드 실패는 Error throw, 호출부에서 흡수하여 패킷 폐기" 라는 계약을 주석으로 명시합니다. 그런데 실제 호출부 다섯 곳 어디에도 예외 처리가 없습니다. 문서화된 계약과 구현이 어긋나, 패킷 하나를 폐기하면 될 상황에서 연결 전체가 끊깁니다.

## 근거

- `src/commons/CtrlMetaGuards.ts:8` — 계약을 명시한 주석.
- `src/commons/CtrlMetaGuards.ts:120` — JSON 파싱 실패 시 예외를 던집니다.

예외 처리가 없는 호출부는 다음과 같습니다.

| 파일 | 행 | 게터 |
|---|---|---|
| `src/server/ClientHandlerPool.ts` | 311 | `getMessageFromPacket` |
| `src/server/ClientHandlerPool.ts` | 317 | `handlerWideIdMeta` |
| `src/client/TunnelClient.ts` | 296 | `syncCtrlAckMeta` |
| `src/client/TunnelClient.ts` | 322-323 | `newDataHandlerMeta` |
| `src/client/TunnelClient.ts` | 364 | `getMessageFromPacket` |

다섯 곳 모두 수신 이벤트 경로에 있으므로 `src/util/SocketHandler.ts:365-372` 의 예외 처리에 걸립니다. 프로세스는 죽지 않고 소켓이 파괴됩니다.

## 재현과 영향

`SuccessOfOpenSession` 의 페이로드를 JSON 이 아닌 임의 바이트로 채우면 구문 오류가, 스키마를 만족하지 않는 정상 JSON 이면 가드 오류가 발생합니다. 어느 쪽이든 해당 제어 연결이 끊기고 진행 중이던 세션이 사라집니다. 계약대로라면 그 패킷 한 장만 버리고 연결은 유지되어야 합니다.

## 권고

각 호출부를 예외 처리로 감싸 해당 패킷만 폐기하고 연결은 유지합니다. 더 나은 방향은 게터가 예외 대신 값 없음을 반환하도록 바꾸어, 호출부가 명시적으로 분기하게 만드는 것입니다. 그러면 예외를 정상 제어 흐름으로 쓰는 구조 자체가 사라집니다.

## 관련 이슈

H-28 의 수정이 클라이언트 측 세 곳을 함께 덮습니다. 서버 측 두 곳은 별도 처리가 필요합니다.

## 검증 상태

- 기존 테스트 커버: 부분적. `test/commons/r2-req-04-meta-schema.test.ts:126-144` 는 게터가 예외를 던진다는 사실만 검증하고, 호출부가 그것을 흡수하는지는 검증하지 않습니다.
- 도입 시점: 신규. `CtrlMetaGuards` 자체가 개선 작업에서 추가되었으며 배포본 `1.0.11b` 에는 이 모듈이 없습니다.
- 확인 방법: 계약 주석과 호출부 다섯 곳 코드 확인, 그리고 소켓 계층의 예외 처리 범위 확인.

---
근거 문서: `docs/research/2026-09-05-tttgate-full-inspection.md` §4.8
