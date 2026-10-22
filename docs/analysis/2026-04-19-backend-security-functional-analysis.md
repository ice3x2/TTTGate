# TTTGate 백엔드 보안 및 기능 분석 보고서

## 1. 개요

- 작성일: 2026-04-19
- 대상 범위: `src/server`, `src/client`, `src/commons`, `src/util`, 관리자 백엔드(`src/server/admin`, `src/server/http`)
- 분석 방식:
  - 메인 에이전트의 로컬 정적 분석
  - 보안 분석 에이전트 5명의 병렬 검토 결과 취합
  - 보조 검증으로 `npm run build` 실행
- 제외 범위:
  - 프론트엔드 Svelte UI 상세 분석
  - 실제 네트워크 재현 공격 및 장시간 부하 테스트

이번 분석의 초점은 서버/클라이언트 백엔드 전반의 보안 이슈와 기능적 문제를 함께 찾는 것이었다. 결론부터 말하면, 현재 코드는 터널 제어 채널 신뢰 경계, 관리자 서버 노출면, 자원 고갈 방어, 설정 적용 일관성 측면에서 구조적인 취약점이 크다.


## 2. 요약

- 치명적 이슈:
  - 인증 없이 관리자 서버에서 임의 파일 읽기가 가능하다.
  - 초기 관리자 비밀번호 설정이 먼저 요청한 외부 사용자에게 열려 있다.
  - 기본 제어 채널이 공개 기본 키, 평문 전송, 인증서 미검증 조합으로 매우 취약하다.
  - 세션 개통 전 대기 큐와 백프레셔 보호가 사실상 없어 메모리 DoS에 취약하다.
- 높은 우선순위 이슈:
  - `allowedClientNames`가 인증 수단이 아니라 자기신고 문자열이라 우회 가능하다.
  - 데이터 채널이 제어 채널에 암호학적으로 바인딩되지 않아 세션 교란 여지가 있다.
  - 미인증 연결에 초기화 타임아웃이 없어 slowloris류 연결 고갈 공격에 취약하다.
  - 공유 키, 인증서, 비밀번호 해시가 로그와 파일에 과도하게 남는다.
  - 관리자 서버는 기본적으로 평문 HTTP로 모든 인터페이스에 노출된다.
  - HTTP 터널이 기본적으로 백엔드의 CORS 정책을 완화한다.
- 기능/운영 이슈:
  - 터널 옵션 업데이트가 원자적이지 않아 실패 시 서비스가 내려간 채 남을 수 있다.
  - 인증서 변경 API는 성공을 반환해도 실행 중 리스너에 즉시 반영되지 않는다.
  - 재연결 때 `EndPointClientPool`의 정리 인터벌이 누적된다.
  - `keepAlive` 설정이 실제 제어 채널에는 반영되지 않는다.
  - `-reset false`가 오히려 리셋을 수행한다.
  - 장기 운영 시 16비트 핸들러 ID 한계로 오류가 날 수 있다.


## 3. 확인한 범위

- 서버 진입 및 설정:
  - `src/app.ts`
  - `src/server/ServerApp.ts`
  - `src/server/ServerOptionStore.ts`
  - `src/types/TunnelingOption.ts`
- 관리자 백엔드:
  - `src/server/admin/AdminServer.ts`
  - `src/server/admin/SessionStore.ts`
- 터널 서버/클라이언트:
  - `src/server/TTTServer.ts`
  - `src/server/TunnelServer.ts`
  - `src/server/ClientHandlerPool.ts`
  - `src/server/ExternalPortServerPool.ts`
  - `src/client/ClientApp.ts`
  - `src/client/TTTClient.ts`
  - `src/client/TunnelClient.ts`
  - `src/client/EndPointClientPool.ts`
- 프로토콜/저수준 I/O:
  - `src/commons/CtrlPacket.ts`
  - `src/commons/DataStatePacket.ts`
  - `src/util/SocketHandler.ts`
  - `src/util/TCPServer.ts`
  - `src/util/FileCache.ts`
  - `src/server/http/HttpHandler.ts`
  - `src/server/http/HttpPipe.ts`
  - `src/server/http/HttpUtil.ts`
- 인증서/환경/유틸:
  - `src/server/CertificationStore.ts`
  - `src/commons/CACertGenerator.ts`
  - `src/util/CLI.ts`
  - `src/Environment.ts`
  - `config.yaml`


## 4. 치명적 이슈

### 4.1 인증 없이 관리자 서버에서 임의 파일 읽기 가능

- 관련 코드:
  - `src/server/admin/AdminServer.ts:129-175`
  - `src/server/admin/AdminServer.ts:179-209`
  - `src/Environment.ts:19`
  - `src/util/File.ts:12-20`
- 문제:
  - 정적 리소스 라우트가 `req.url` 경로 조각을 그대로 `webDir`에 이어 붙이고, 최종 경로가 실제로 `webDir` 하위인지 검증하지 않는다.
  - `..`가 포함된 요청으로 저장소 루트 밖으로 쉽게 탈출할 수 있다.
- 로컬 확인:
  - `GET /../config/.key`는 `.../TTTGate/config/.key`로 해석될 수 있다.
  - `GET /../cert/admin/admin.key.pem`는 `.../TTTGate/cert/admin/admin.key.pem`로 해석될 수 있다.
- 영향:
  - 비인증 공격자가 `config/server.yaml`, `config/.key`, 인증서 JSON, PEM 개인키, 로그, 소스 파일을 읽을 수 있다.
  - 이 경로 하나로 터널 공유 키, 관리자 비밀번호 해시, TLS 개인키가 모두 노출될 수 있다.
- 권장:
  - `resolve` 후 반드시 `webDir` prefix를 검증해야 한다.
  - 정적 파일은 allowlist 기반으로만 서빙해야 한다.
  - 알 수 없는 `/api/*` GET 요청을 정적 파일 fallback으로 넘기지 말고 즉시 404로 종료해야 한다.

### 4.2 초기 관리자 비밀번호를 외부 사용자가 선점할 수 있음

- 관련 코드:
  - `src/server/admin/SessionStore.ts:84-99`
  - `src/server/admin/AdminServer.ts:516-535`
  - `src/server/admin/AdminServer.ts:154-156`
- 문제:
  - `.key` 파일이 없으면 첫 `POST /api/login` 요청의 `key` 값이 그대로 관리자 비밀번호로 저장된다.
  - `/api/emptyKey`가 현재 초기화 상태를 비인증으로 노출한다.
  - 별도 bootstrap token, 로컬 전용 제한, 최초 1회 수동 확인 절차가 없다.
- 영향:
  - 신규 설치, `config` 삭제 후 재시작, 잘못된 `reset` 수행 직후 외부 사용자가 먼저 접속하면 관리자 계정을 영구 선점할 수 있다.
  - 이후 설정 변경, 인증서 교체, 포트 제어, 터널 구성 변경까지 모두 장악 가능하다.
- 권장:
  - 초기 비밀번호 설정은 로컬 CLI 또는 1회용 bootstrap token으로 제한해야 한다.
  - `/api/emptyKey`는 제거하거나 로컬 전용으로 바꿔야 한다.
  - 서버 측에서 최소 길이, 복잡도, 초기화 완료 상태를 강제해야 한다.

### 4.3 제어 채널 기본 보안 경계가 무너져 있음

- 관련 코드:
  - `src/types/TunnelingOption.ts:65`
  - `src/server/ServerOptionStore.ts:177-181`
  - `src/server/ServerOptionStore.ts:259-267`
  - `src/client/ClientApp.ts:42-44`
  - `src/client/ClientApp.ts:62-69`
  - `src/util/SocketHandler.ts:169-174`
  - `src/client/TunnelClient.ts:430-439`
  - `src/commons/CtrlPacket.ts:108-117`
  - `src/server/TunnelServer.ts:475-489`
  - `src/server/CertificationStore.ts:71-87`
- 문제:
  - 기본 인증 키가 공개 상수 `hello-TTTGate`이다.
  - 기본 설정이 `tls=false`다.
  - TLS를 켜도 클라이언트는 `rejectUnauthorized: false`로 서버 인증서를 검증하지 않는다.
  - 터널 서버는 임시 self-signed 인증서를 사용한다.
  - 인증은 고정 shared key를 `AckCtrl` 패킷에 담아 보내는 방식이며, 서버는 `AckCtrl`의 직전 상태와 `packet.ID === handler.id`도 강제하지 않는다.
- 영향:
  - 평문 스니핑, MITM, 기본값 악용, replay류 공격으로 임의 클라이언트 등록과 터널 트래픽 가로채기가 가능하다.
  - 사용자는 TLS를 켰다고 생각해도 실제로는 상대 인증이 없는 암호화일 뿐이다.
- 권장:
  - 기본값을 `TLS 필수 + 인증서 검증 필수 + 공개 기본 키 제거`로 바꿔야 한다.
  - `AckCtrl`은 nonce/challenge 또는 mTLS 기반으로 재설계해야 한다.
  - 운영자가 기본값 그대로 기동하면 실패하도록 만들어야 한다.

### 4.4 세션 개통 전 대기 큐와 백프레셔 보호가 사실상 없음

- 관련 코드:
  - `src/util/SocketHandler.ts:417-432`
  - `src/util/SocketHandler.ts:585-599`
  - `src/server/ServerOptionStore.ts:194-199`
  - `src/server/ClientHandlerPool.ts:139-187`
  - `src/server/ClientHandlerPool.ts:189-203`
  - `src/server/ClientHandlerPool.ts:346-365`
  - `src/client/TunnelClient.ts:163-203`
  - `src/client/TunnelClient.ts:521-539`
- 문제:
  - `bufferLimitOnServer`와 `bufferLimitOnClient` 기본값이 `-1`이고, 이 경우 `SocketHandler`는 파일 캐시와 전역 메모리 계수 자체를 쓰지 않는다.
  - 세션이 `OnlineSession`이 되기 전 애플리케이션 큐가 계속 커지지만 바이트 상한, 세션당 상한, `socket.pause()/resume()`이 없다.
- 영향:
  - 느린 수신자 하나만 있어도 서버/클라이언트 양쪽에서 무제한 RAM 점유가 가능하다.
  - 외부 포트로 대량 데이터를 빠르게 밀어 넣어 OOM 기반 DoS를 유발할 수 있다.
- 권장:
  - 기본 버퍼 상한을 유한값으로 바꿔야 한다.
  - 전역 상한은 per-socket 제한과 무관하게 항상 적용해야 한다.
  - 세션당/전역 대기 큐 바이트 상한, 하이워터마크 기반 `pause()/resume()`, overflow 시 즉시 종료가 필요하다.


## 5. 높은 우선순위 이슈

### 5.1 `allowedClientNames`는 인증 통제가 아니라 자기신고 문자열임

- 관련 코드:
  - `src/commons/CtrlPacket.ts:108-117`
  - `src/client/TunnelClient.ts:430-439`
  - `src/server/TunnelServer.ts:285-296`
  - `src/server/TunnelServer.ts:212-240`
  - `src/server/TTTServer.ts:40-53`
- 문제:
  - 클라이언트는 `AckCtrl`에서 임의의 `name`을 보내고, 서버는 이를 그대로 신뢰해 ACL과 라우팅에 사용한다.
  - 같은 이름의 중복 접속도 막지 않는다.
- 영향:
  - 유효한 shared key만 알면 허용된 이름을 사칭해 특정 포트 세션을 탈취하거나 일부 트래픽을 지속적으로 가로챌 수 있다.
- 권장:
  - 이름 기반 ACL을 폐기하고 인증서 fingerprint, 공개키, 개별 토큰처럼 서버가 신뢰하는 식별자로 바꿔야 한다.

### 5.2 데이터 채널이 제어 채널에 암호학적으로 바인딩되지 않음

- 관련 코드:
  - `src/commons/DataStatePacket.ts:24-54`
  - `src/server/TunnelServer.ts:301-356`
  - `src/server/TunnelServer.ts:336-383`
  - `src/server/ClientHandlerPool.ts:105-125`
- 문제:
  - 데이터 채널은 `ctrlID`, `handlerID`, `sessionID` 메타데이터만으로 승인되고, 실제로 해당 제어 채널에서 파생된 소켓인지 검증하지 않는다.
- 영향:
  - ID를 관찰하거나 추측할 수 있는 공격자, 또는 제어 채널을 선점한 공격자가 pending session 하이재킹과 세션 교란을 일으킬 수 있다.
- 권장:
  - `NewDataHandler`에 1회용 토큰을 넣고 `DataStatePacket`에서 검증하거나, control/data 채널을 동일 세션 키나 mTLS로 묶어야 한다.

### 5.3 미인증 control/data 소켓에 핸드셰이크 타임아웃이 없음

- 관련 코드:
  - `src/server/TunnelServer.ts:246-264`
  - `src/server/TunnelServer.ts:336-364`
  - `src/util/SocketHandler.ts:138-154`
  - `src/util/SocketHandler.ts:187-197`
- 문제:
  - 새로 바인드된 control/data 연결은 `Unknown` 또는 초기화 상태로 오래 남아도 강제 종료되지 않는다.
- 영향:
  - 인증 키가 없어도 idle connection 또는 partial packet을 대량으로 유지해 파일 디스크립터와 메모리를 고갈시키는 slowloris형 DoS가 가능하다.
- 권장:
  - control/data 공통으로 짧은 handshake deadline을 두고, 미인증 연결 수를 IP별/전역으로 제한해야 한다.

### 5.4 비밀정보가 로그와 디스크에 과도하게 남음

- 관련 코드:
  - `src/server/ServerApp.ts:46`
  - `src/client/ClientApp.ts:17-24`
  - `src/client/ClientApp.ts:125-131`
  - `src/client/TTTClient.ts:40-42`
  - `src/server/ServerOptionStore.ts:116-119`
  - `src/server/CertificationStore.ts:144-170`
  - `src/util/Files.ts:39-72`
- 문제:
  - 서버/클라이언트 시작 로그에 옵션 객체 전체가 찍혀 shared key가 그대로 남는다.
  - `server.yaml`, `client.yaml`, `.adminCert.json`, `.externalCert.json`, PEM 키 파일에 비밀이 평문 저장된다.
  - 파일 권한을 명시적으로 제한하지 않는다.
- 영향:
  - 로그 수집기, 백업, 공유 볼륨, 느슨한 `umask`만으로도 공유 키와 개인키가 유출될 수 있다.
- 권장:
  - `key`, `cert`, `private key`, token류는 전부 redaction 해야 한다.
  - 비밀 파일은 별도 저장소와 `0600` 수준 권한으로 관리해야 한다.

### 5.5 관리자 인터페이스가 기본적으로 평문 HTTP로 외부 인터페이스에 노출됨

- 관련 코드:
  - `src/server/ServerOptionStore.ts:177-181`
  - `src/server/ServerOptionStore.ts:259-267`
  - `src/server/admin/AdminServer.ts:40-58`
  - `src/server/admin/AdminServer.ts:529-530`
  - `src/server/admin/AdminServer.ts:644-659`
- 문제:
  - `adminTls` 기본값이 `false`이고, `listen(port)`는 바인드 주소를 지정하지 않아 외부 인터페이스 전체에 열릴 수 있다.
  - TLS가 아닐 때 세션 쿠키 `Secure`도 빠진다.
- 영향:
  - 네트워크 감청, 세션 탈취, 관리 UI의 의도치 않은 외부 노출 위험이 크다.
- 권장:
  - 관리자 서버는 기본적으로 `127.0.0.1` 또는 명시적 bind address에만 바인드해야 한다.
  - `adminTls`를 기본 `true`로 바꾸고 HSTS와 `Secure` 쿠키를 강제해야 한다.

### 5.6 HTTP 터널이 기본적으로 백엔드 CORS 정책을 완화함

- 관련 코드:
  - `src/server/ServerOptionStore.ts:247-249`
  - `src/server/http/HttpHandler.ts:196-199`
  - `src/server/http/HttpHandler.ts:284-291`
- 문제:
  - `replaceAccessControlAllowOrigin` 기본값이 `true`이고, 응답 시 요청 `Origin`을 그대로 `Access-Control-Allow-Origin`에 반사한다.
- 영향:
  - 터널이 백엔드가 의도한 CORS 제한을 기본적으로 무력화할 수 있다.
  - 특히 백엔드가 credentials 허용 또는 토큰 기반 인증을 쓸 때 위험하다.
- 권장:
  - 기본값을 `false`로 바꾸고, 필요한 경우 명시적 allowlist 기반으로만 허용해야 한다.

### 5.7 파일 캐시가 디스크 고갈과 이벤트 루프 정체를 유발할 수 있음

- 관련 코드:
  - `src/util/FileCache.ts:95-129`
  - `src/util/FileCache.ts:146-175`
  - `src/util/SocketHandler.ts:417-432`
  - `src/util/SocketHandler.ts:604-615`
- 문제:
  - 캐시 파일/총량 상한이 없고, `openSync`, `writeSync`, `readSync`, `fstatSync`가 hot path에서 수행된다.
  - 디스크 장애 예외를 상위에서 제대로 격리하지 않는다.
- 영향:
  - 느린 상대방 하나만 있어도 전체 프로세스가 디스크 I/O 병목과 디스크 고갈로 흔들릴 수 있다.
  - `ENOSPC`, `EIO`가 프로세스 장애로 이어질 수 있다.
- 권장:
  - handler별/전역 디스크 quota, 명시적 실패 정책, 비동기 I/O 또는 별도 worker 분리가 필요하다.

### 5.8 터널 설정 변경과 인증서 변경이 원자적이지 않음

- 관련 코드:
  - `src/server/admin/AdminServer.ts:310-345`
  - `src/server/admin/AdminServer.ts:349-360`
  - `src/server/admin/AdminServer.ts:214-228`
  - `src/server/admin/AdminServer.ts:444-451`
  - `src/server/ServerOptionStore.ts:62-75`
  - `src/server/TTTServer.ts:129-148`
  - `src/server/ServerApp.ts:23-40`
  - `src/server/ServerApp.ts:90-91`
- 문제:
  - 터널 옵션은 새 값을 저장한 뒤 기존 리스너를 중지하고 재시작한다. 재시작 실패 시 설정 롤백이 없다.
  - 인증서 업데이트 API는 파일만 바꾸고 실행 중 리스너는 즉시 재로딩하지 않는다.
  - `oldAdminCertInfo`는 시작 시점 값만 들고 있어 이후 옵션 롤백 과정에서 최신 인증서를 덮어쓸 수 있다.
- 영향:
  - 잘못된 편집 한 번으로 포트 서버가 내려간 채 남거나, 최신 인증서가 의도치 않게 옛 값으로 되돌아갈 수 있다.
- 권장:
  - 새 리스너/인증서 적용 성공 후에만 설정을 commit하는 2단계 적용이 필요하다.
  - 인증서 변경 후 롤백 스냅샷도 갱신해야 한다.


## 6. 중간 우선순위 기능/안정성 이슈

### 6.1 `keepAlive` 설정이 실제 제어 채널에는 반영되지 않음

- 관련 코드:
  - `src/client/ClientApp.ts:95-105`
  - `src/client/TunnelClient.ts:101-114`
  - `src/server/ServerApp.ts:76-85`
  - `src/server/TTTServer.ts:34`
  - `src/server/TunnelServer.ts:68-72`
- 문제:
  - 클라이언트와 서버 모두 `keepAlive` 설정을 받지만 실제 제어 채널에서는 클라이언트가 30000ms 하드코딩, 서버는 생성 시 누락 상태다.
- 영향:
  - 운영자는 NAT 타임아웃을 조정했다고 생각하지만 실제 연결 동작은 달라 재연결 문제가 계속 남을 수 있다.
- 권장:
  - 설정값을 control channel connect/listen까지 일관되게 전달해야 한다.

### 6.2 `-reset false`가 오히려 리셋을 수행함

- 관련 코드:
  - `src/server/ServerApp.ts:60-64`
- 문제:
  - 조건식이 `options['reset'] == '' || options['reset'].toLowerCase() == 'false'`라서 `-reset false`가 파괴적 리셋으로 해석된다.
- 영향:
  - 자동화 스크립트나 운영 실수로 설정과 인증서가 의도치 않게 삭제될 수 있다.
- 권장:
  - `reset`은 명시적 참일 때만 수행해야 한다.

### 6.3 CLI 모드 판별과 도움말이 실제 동작과 어긋남

- 관련 코드:
  - `src/app.ts:22-35`
  - `src/app.ts:63-82`
  - `src/util/CLI.ts:4-29`
- 문제:
  - 옵션이 `server|client`보다 먼저 오면 모드 판별이 실패할 수 있다.
  - 실제 지원하는 `-keepAlive`는 도움말에 없다.
- 영향:
  - 같은 명령이 옵션 순서에 따라 다르게 동작하고, 운영 사용성이 떨어진다.
- 권장:
  - 모드와 옵션 파싱을 분리하고, 도움말과 실제 지원 옵션을 일치시켜야 한다.

### 6.4 재연결 시 `EndPointClientPool` 인터벌 누적

- 관련 코드:
  - `src/client/EndPointClientPool.ts:33-35`
  - `src/client/EndPointClientPool.ts:162-169`
  - `src/client/TTTClient.ts:31-60`
- 문제:
  - `TTTClient.start()`가 재연결마다 새 `EndPointClientPool`을 만들지만 `closeAll()`은 `setInterval`을 정리하지 않는다.
- 영향:
  - 연결 flap이 반복되면 stale pool과 타이머가 누적되어 CPU wakeup과 메모리 사용량이 늘어난다.
- 권장:
  - `dispose()` 또는 `destroy()`를 만들어 interval, callback, map을 모두 정리해야 한다.

### 6.5 강제 종료 타임아웃과 drain 완료 판정이 실제 소켓 종료보다 앞설 수 있음

- 관련 코드:
  - `src/server/ExternalPortServerPool.ts:89-103`
  - `src/server/ExternalPortServerPool.ts:240-247`
  - `src/client/EndPointClientPool.ts:38-52`
  - `src/client/EndPointClientPool.ts:93-103`
  - `src/util/SocketHandler.ts:126-132`
  - `src/util/SocketHandler.ts:449-489`
  - `src/util/SocketHandler.ts:553-578`
  - `src/client/TunnelClient.ts:291-304`
- 문제:
  - timeout 시 핸들러를 맵에서 먼저 지우고 `end_()`를 호출하는데, `end_()`는 대기 큐가 남아 있으면 실제 close를 미룬다.
  - `addOnceDrainListener()`는 큐가 비었다는 이유만으로 성공 처리할 수 있어 in-flight write와 순서 경쟁이 난다.
- 영향:
  - 논리적으로는 종료됐는데 실제 소켓/FD/파일캐시가 남을 수 있고, 간헐적 데이터 truncation과 `waitReceiveLength` 불일치가 생길 수 있다.
- 권장:
  - 실제 `Closed` 이벤트 확인 전까지 추적을 유지하고, in-flight write 추적을 분리해야 한다.

### 6.6 프로토콜 핸들러 ID가 16비트라 장기 운영 시 한계가 있음

- 관련 코드:
  - `src/commons/CtrlPacket.ts:58`
  - `src/commons/CtrlPacket.ts:209`
  - `src/commons/CtrlPacket.ts:273`
  - `src/util/SocketHandler.ts:37`
  - `src/server/ClientHandlerPool.ts:23`
- 문제:
  - 런타임 ID는 계속 증가하지만 패킷 직렬화는 `UInt16`이다.
- 영향:
  - 충분한 세션/연결이 누적되면 ID 충돌 또는 `RangeError`로 새 세션 생성이 불안정해질 수 있다.
- 권장:
  - 프로토콜 ID를 32비트로 올리고 end-to-end로 맞추는 편이 안전하다.

### 6.7 `ExternalPortServerPool`의 상태 정리가 일부 잘못됨

- 관련 코드:
  - `src/server/ExternalPortServerPool.ts:289-297`
  - `src/server/ExternalPortServerPool.ts:363-368`
- 문제:
  - 서버 종료 시 `_portServerMap.delete(destPort)`를 호출해 forward port가 아니라 destination port 기준으로 맵을 정리한다.
  - `stop()`은 성공 시 `false`, 에러 시 `true`를 resolve한다.
- 영향:
  - 상태 조회와 stop 결과 해석이 어긋날 수 있고, 추후 유지보수 시 오동작을 유발한다.
- 권장:
  - 맵 정리 키와 반환 의미를 실제 동작에 맞춰 정리해야 한다.

### 6.8 일부 관리자 API 응답이 의도한 JSON 형태를 보장하지 않음

- 관련 코드:
  - `src/server/admin/AdminServer.ts:83-88`
  - `src/server/admin/AdminServer.ts:582-605`
- 문제:
  - 예외 처리에서 `res.end({success: false, ...})`처럼 객체를 그대로 넘긴다.
  - `let value = {success: true, message: ''} && status;` 구문은 실제로 `status`만 반환한다.
- 영향:
  - 클라이언트가 응답 구조를 안정적으로 기대하기 어렵고, 운영 가시성이 나빠진다.
- 권장:
  - 모든 응답은 `JSON.stringify`와 고정된 response envelope을 사용해야 한다.

### 6.9 버전/설정 파일 표기가 실제 런타임과 엇갈림

- 관련 코드:
  - `src/Environment.ts:23-26`
  - `package.json`
  - `config.yaml:1-4`
- 문제:
  - 런타임 버전은 `1.0.9`, 패키지 버전은 `1.0.11b`다.
  - 저장소 루트 `config.yaml`은 실제 런타임 경로와 스키마에 맞지 않는다.
- 영향:
  - 운영자가 잘못된 파일을 수정하거나 버전 정보를 오판하기 쉽다.
- 권장:
  - 실제 사용하는 설정 파일 위치와 버전 소스를 하나로 통일해야 한다.


## 7. 추가 관찰

- `src/server/admin/SessionStore.ts:47-80`
  - 세션 토큰이 `Date.now() + Math.random()` 기반이다.
  - `sweepSession()` 호출처를 찾지 못했다.
- `src/server/http/HttpHandler.ts:366-372`, `src/server/http/HttpHandler.ts:455-470`, `src/server/http/HttpUtil.ts:8-9`
  - 압축 해제 후 실제 비압축 크기 상한이 적용되지 않는다.
  - `MAX_UNCOMPRESSED_SIZE` 상수는 선언만 되어 있다.
- `src/util/Files.ts:22-29`
  - `Files.read()`가 바이너리 파일을 `binary` 인코딩 문자열로 읽는다.
  - 일부 정적 바이너리 자산 전송 시 타입/인코딩 혼선 여지가 있다.


## 8. 검증 결과

- 빌드:
  - `npm run build` 통과
- 테스트:
  - Jest 설정은 있으나 실제 `test/` 디렉터리의 테스트 파일은 확인되지 않았다.
- 해석:
  - 현재 코드는 타입스크립트 컴파일은 되지만, 보안 및 운영 안정성을 검증하는 자동화 테스트 기반은 매우 약하다.


## 9. 우선 조치 권고

### 1차 즉시 조치

- 관리자 정적 파일 경로 탈출 차단
- 초기 관리자 bootstrap 절차 재설계
- 기본 shared key 제거 및 강제 랜덤화
- control/data 채널 TLS 검증 활성화
- 세션 개통 전 큐/버퍼 상한 강제
- 미인증 연결 초기화 타임아웃 추가

### 2차 조치

- `allowedClientNames`를 신뢰 가능한 식별자로 교체
- 데이터 채널을 제어 채널과 암호학적으로 바인딩
- 파일 캐시 quota와 예외 처리 강화
- 관리자 서버 기본 bind/TLS 정책 강화
- CORS 재작성 기본값 비활성화

### 3차 조치

- 설정/인증서 업데이트를 원자적 적용으로 변경
- 재연결/종료 경로의 타이머, drain, close 순서 정리
- 프로토콜 ID 폭 확장
- CLI/버전/설정 파일 사용성 정리
- 회귀 테스트와 장기 부하 테스트 추가


## 10. 결론

TTTGate 백엔드는 이미 여러 안정화 수정 흔적이 보이지만, 현재 구조는 여전히 “초기 배포 보안”, “제어 채널 신뢰”, “자원 고갈 방어”, “운영 중 설정 적용” 네 축에서 큰 리스크를 안고 있다.

가장 위험한 지점은 관리자 서버의 비인증 파일 읽기와 초기 관리자 비밀번호 선점, 그리고 공개 기본 키와 인증서 미검증 상태의 제어 채널이다. 이 세 가지는 단독으로도 치명적이고, 서로 결합되면 전체 시스템 장악으로 이어질 수 있다.

앞으로 이 프로젝트에서 보안 이슈와 사용성을 개선하려면, 우선 위 1차 즉시 조치를 먼저 막고 나서 설정 적용 원자성, 종료/재연결 수명주기, 테스트 체계를 정리하는 순서가 가장 현실적이다.
