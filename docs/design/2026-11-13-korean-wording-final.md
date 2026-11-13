# TTTGate 관리 화면 한국어 문구 검토 — 3회차(최종 통합본)

- 기준 소스: `origin/develop` 8400fd5 의 `admin/src/i18n/ko.ts`·`en.ts`(2회차와 같은 커밋)
- 다시 확인한 코드: `src/server/TTTServer.ts`, `src/server/ExternalPortServerPool.ts`, `src/server/admin/AdminServer.ts`, `src/server/admin/passkeyRoutes.ts`, `src/server/admin/blocklistRoutes.ts`, `src/server/security/IpBlocklist.ts`, `src/server/security/AdmissionController.ts`, `src/server/security/TunnelLifetimePolicy.ts`, `src/server/rbac/IdentityStore.ts`, `admin/src/screens/*.svelte`, `admin/src/screens/parts/*`, `admin/src/controller/ServerOptionCtrl.ts`, `admin/src/controller/adminAddress.ts`, `admin/src/shell/nav.ts`
- 이미 정한 용어("연결 횟수 제한", "HTTP 헤더·본문 바꾸기", "켜 둘 시간", "자동 꺼짐까지", 터널 트래픽은 "연결", 로그인만 "세션")는 그대로 따른다.
- 3차 판정: **확정** = 2차 최종안 그대로 / **수정** = 문구나 심각도를 고침 / **보류** = 바꾸지 않음(지금 문구 유지)
- 심각도: HIGH = 뜻이 틀리거나 이해를 막음 / MEDIUM = 어색하거나 화면끼리 어긋남, 또는 안내가 사실과 일부 다름 / LOW = 다듬기

---

## 1. 사실 확인(3차)

| 2차 주장 | 3차 확인 | 근거 |
|---|---|---|
| 저장하면 외부 포트 리스너를 멈췄다 다시 열고 연결이 끊긴다. "이름만 바꾼 경우"는 예외다 | **대체로 맞음. 예외가 더 넓다.** 이름·공유 대상·IP 제한·허용 IP 목록만 바꾸면 리스너를 다시 시작하지 않는다(`sameExceptName`). 그 밖의 설정을 바꾸면 리스너가 돌던 포트를 멈추고(`stop` → `removeHandlerByForwardPort`) 다시 연다. IP 제한을 켜면 허용되지 않은 IP 의 연결만 따로 끊는다(`enforceActivatorIps`). | `TTTServer.ts:590-636`, `ExternalPortServerPool.ts:652-668`, `AdminServer.ts:972-975` |
| `startupHint`: "꺼진 터널을 저장할 때 씁니다" | **틀림.** 리스너가 돌고 있으면 꺼진 터널도 상태를 이어받아 꺼진 채로 남는다(`inherits = inheritedStatus.online`, `restoreExternalPortStatus`). "시작할 때 꺼 두기"는 서버 시작·새 터널, 그리고 리스너가 돌지 않던(포트를 열지 못한) 터널을 저장할 때만 쓴다. en.ts 원문 "a tunnel that is not Online"의 Online 은 리스너 상태인데, ko 가 이를 "켜져 있지 않은"으로 옮기며 뜻이 바뀌었다. | `TTTServer.ts:609-611, 635-636, 204-216` |
| `tunnelStatus.blocked` 는 거절한 연결 수다 | **맞음.** `rejected.rateLimit + rejected.geo` 이고, 이 값은 `rate-limit-ban + rate-limit-exceeded`·`geo-deny` 판정 수다. 차단 목록·IP 제한·동시 연결 한도로 거절한 수는 들어가지 않는다. | `TunnelStatusArea.svelte:33`, `ExternalPortServerPool.ts:289-291`, `AdmissionController.ts:239-241` |
| `server.restarted`: 관리 화면 포트·TLS 변경은 프로세스를 다시 시작해야 한다 | **맞음.** `restartRequiredScopes: ["admin-server"]`. | `TTTServer.ts:522-525`, `AdminServer.ts:799` |
| 같은 항목: "화면도 옛 관리 포트로 돌아간다" | **틀림.** 확인 창의 확인을 누르면 `adminBaseUrl(location, serverOption, previousAdminPort)` 가 **새** 포트·TLS 주소로 옮긴다. 그 포트는 프로세스를 다시 시작하기 전까지 열리지 않으므로 화면이 열리지 않는다. 문구가 아니라 코드 문제다(7절). | `ServerSettingsScreen.svelte:209-213`, `adminAddress.ts` |
| `nav.status` 를 "서버 상태"로 바꾸면 같은 키를 쓰는 알림 창 제목도 함께 맞는다 | **빠진 곳 있음.** 터널 편집 화면의 상태 카드 제목도 `nav.status` 다. 그대로 바꾸면 터널 편집 카드에 "서버 상태"가 보인다. | `TunnelStatusArea.svelte:61` |
| `passkey_counter_stale` 문구는 사용자에게 보인다 | **보이지 않음.** 패스키 로그인 경로는 이 코드를 받으면 `reject('verification')` 으로 일반 패스키 거절 응답을 보낸다. 문구는 고쳐 두되 심각도는 LOW 다. | `passkeyRoutes.ts:278` |
| `group.maxDurationHint`: 늘리면 "소유자가 정한" 시간까지 돌아간다 | **틀림.** 되돌아가는 값은 그 터널을 **켠 사람**이 고른 시간(`requestedTimeout`)이다. 공유받은 사용자가 켰으면 그 사람의 값이다. 상한은 소유자 그룹과 켠 사람 그룹 가운데 짧은 쪽이며, 시작 시각은 그대로라 전체 켜 둘 시간에 걸린다. en.ts 의 "the time their owners asked for"도 같은 오류다. | `ExternalPortServerPool.ts:740-777`, `TunnelLifetimePolicy.ts:21-33` |
| `ipLimit.andMore` 는 한 줄 표시 글이다 | **아님.** 보조 기술용 이름을 `', '` 로 이어 붙인다: "IP 제한, 켜짐, 허용 IP 1.2.3.4, 그 밖에 2개". 쉼표 뒤에 의존 명사 "외"로 시작하는 조각("외 2개")은 어색하다. | `ipLimit.ts:46-47` |
| `clients.neverWarning` 위에는 다른 안내가 없다 | **있음.** 바로 위 줄에 `clients.neverExpires`("만료 없음")가 보이고, 그 위에 `clients.runOnHost`("코드는 한 번만 쓸 수 있습니다")가 있다. 2차안의 "이 코드는 기한이 없습니다"와 "코드를 쓰거나"는 겹친다. | `TrustedClientsScreen.svelte:336-344` |
| 2차의 나머지 사실 확인(제어 포트 칸 없음, `secureTunneling` = 외부 포트 TLS + 대상 TLS, `activeSession` = 터널 연결 수, 클라이언트 버퍼 `< 1` = 무제한, `readOnlyNote` 대상, `cert.incorrectNote` 숨김, 헤더 줄 "헤더 바꾸기" 체크박스, `promoteFull` 조건, 등록 코드 무효화 조건) | **모두 맞음.** | `TTTServer.ts:111-116, 221-225, 305-322`, `ExternalPortServerPool.ts:161-168, 223-231`, `TunnelEditScreen.svelte:452-455, 489-496`, `HeaderAppender.svelte:37`, `IpBlocklist.ts:65-88` |

---

## 2. 최종 통합 목록

판정 이력은 "1차 / 2차 / 3차" 순이다. "—"는 그 회차에 다루지 않았다는 뜻이다.

### 2.1 HIGH (11)

| key | 현재 | 최종 권장 | 이유 | 심각도 | 판정 이력 |
|---|---|---|---|---|---|
| `tunnelEdit.rateLimit` | 속도 제한 | 연결 횟수 제한 | 결정된 용어. 구간 안의 연결 횟수를 센다(`ConnectionRateLimiter`). "속도"는 대역폭으로 읽힌다. | HIGH | 제안 / 채택 / 확정 |
| `tunnelEdit.rateLimitEnabled` | 속도 제한 사용 | 연결 횟수 제한 사용 | 같은 기능의 스위치 이름. | HIGH | 제안 / 채택 / 확정 |
| `security.reasonExceeded` | 속도 제한 초과 | 연결 횟수 초과 | 거절 표 머리글이라 짧은 꼴. | HIGH | 제안 / 채택 / 확정 |
| `security.fromBanNote` | {port} 포트의 속도 제한 일시 차단에서 옮김 | {port} 포트 일시 차단(연결 횟수 초과)에서 옮김 | 차단 목록 "메모" 칸에 저장되는 값. 같은 줄에 주소가 있어 "주소를"은 겹친다. | HIGH | 제안 / 수정 / 확정 |
| `security.promoteConfirm` | {ip} 주소를 모든 터널에서 차단할까요? … 속도 제한에 따른 일시 차단은 풀립니다. | {ip} 주소를 모든 터널에서 차단할까요? 차단을 풀 때까지는 서버를 다시 시작해도 이 주소의 연결을 거절합니다. 연결 횟수 제한에 따른 일시 차단은 풀립니다. | 용어 변경. | HIGH | 제안 / 채택 / 확정 |
| `tunnelEdit.maxPerIp` | IP당 최대 연결 수 | IP당 최대 연결 횟수 | "최대 동시 연결 수"(그룹)와 구분된다. | HIGH | 제안 / 채택 / 확정 |
| `tunnelEdit.secureTunneling` | 서버·클라이언트 사이 보안 터널 | TLS 사용(외부 포트와 대상 서버) | 실제로는 외부 포트를 TLS 로 열고 클라이언트가 대상에 TLS 로 붙는다. 서버–클라이언트 구간과 무관하다. **en.ts 도 고친다.** | HIGH | 제안 / 수정 / 확정 |
| `clients.tlsNotice` | 등록 코드를 쓰려면 서버 설정에서 제어 포트의 TLS를 켜세요. 그 전까지는 클라이언트를 직접 설정하세요. | 등록 코드를 쓰려면 서버 설정에서 "터널 서버 포트에 TLS 사용"을 켜세요. 그 전까지는 클라이언트를 직접 설정하세요. | 화면에 "제어 포트"라는 칸이 없다. `server.tunnelTls` 와 함께 바꾼다. | HIGH | 제안 / 채택 / 확정 |
| `serverError.TLS_REQUIRED` | 등록 코드를 쓰려면 제어 포트의 TLS를 켜세요. | 등록 코드를 쓰려면 서버 설정에서 "터널 서버 포트에 TLS 사용"을 켜세요. | 위와 같은 안내를 같은 문장으로. | HIGH | 제안 / 수정 / 확정 |
| `tunnelStatus.stats` | 가동 시간 {uptime} · 세션 {sessions} · RX {rx} · TX {tx} | 지금: 가동 시간 {uptime} · 연결 {sessions} · RX {rx} · TX {tx} / 2.4.0: 켜진 지 {since} · 연결 {count} · RX {rx} · TX {tx} | 터널 트래픽은 "연결". "켜진 지"는 2.4.0 의 `activatedAt` 과 함께 넣는다. | HIGH | 제안 / 수정 / 확정 |
| `status.activeSession` | 활성 세션 | 연결 수 | 값은 클라이언트가 처리 중인 터널 연결 수(`activatedSessionCount`). | HIGH | 제안 / 채택 / 확정 |

### 2.2 MEDIUM (58)

| key | 현재 | 최종 권장 | 이유 | 심각도 | 판정 이력 |
|---|---|---|---|---|---|
| `tunnelEdit.bufferLimit` | 세션당 버퍼 한도(MiB) | 연결당 버퍼 한도(MiB) | 설계안 ③. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelEdit.clientBufferNote` | 클라이언트 버퍼: 0 이하이면 지금의 무제한 설정을 그대로 둡니다. | 클라이언트 버퍼: 0 이하면 제한하지 않습니다. | `< 1` 이면 `-1`(무제한). 2.4.0 에서는 설계안의 "1 이상 64 이하로 정합니다."로 바뀐다. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelEdit.readOnlyNote` | 이 터널은 보기 전용으로 공유되었습니다. | 이 터널은 볼 수만 있습니다. | 공유받지 않은 사용자(그룹 공개·보기 전용 권한)도 본다. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelEdit.keepAlive` | Keep-Alive 제한 시간(ms) | Keep-Alive 간격(ms) | `setKeepAlive(true, ms)` 의 대기 시간. "제한 시간"은 끊는 시간으로 읽힌다. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelEdit.start` | 시작 | 터널 만들기 | 저장 전 새 터널의 버튼. "꺼 두기"면 켜지지 않는다. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelEdit.applyAndRestart` | 적용하고 다시 시작 | 저장하고 다시 시작 | 대부분의 저장은 리스너를 다시 시작해 연결이 끊긴다. "다시 시작"이 그 경고 구실을 한다. 이름·공유·IP 제한만 바꾸면 다시 시작하지 않지만, 버튼을 바꿔 가며 보일 근거로는 약하다. 360px 에서 "터널 삭제"와 한 줄에 들어간다. | MEDIUM | 제안("저장") / 수정 / 확정 |
| `tunnelEdit.applied` | 터널 설정을 적용했습니다. | 터널을 저장했습니다. | 만들기·저장 모두에 맞다. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnel.applyFailed` | 터널 설정을 적용하지 못했습니다: {reason} | 터널을 저장하지 못했습니다: {reason} | 위와 같다. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelEdit.stopAndRemove` | 멈추고 삭제 | 터널 삭제 | 확인 창 제목과 같다. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelEdit.removed` | 터널 설정을 삭제하고 외부 서버를 멈췄습니다. | 터널을 삭제하고 외부 포트를 닫았습니다. | "외부 서버"는 대상 서버로 오해된다. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelEdit.removeConfirm` | {port} 터널을 삭제할까요? 외부 서버가 멈춥니다. | {port} 터널을 삭제할까요? 외부 포트를 닫고 지금 연결을 모두 끊습니다. 되돌릴 수 없습니다. | 결과를 알리고 다른 삭제 확인과 맞춘다. | MEDIUM | 제안 / 수정 / 확정 |
| `tunnelEdit.removeFailed` | 실패: {reason} | 터널을 삭제하지 못했습니다: {reason} | 다른 실패 문구와 같은 꼴. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelEdit.startupHint` | 서버가 시작할 때, 터널을 만들 때, 켜져 있지 않은 터널을 저장할 때 적용됩니다. 켜진 터널을 저장하면 켜짐 상태와 타이머를 그대로 둡니다. | 서버가 시작할 때, 터널을 만들 때, 포트를 열지 못한 터널을 저장할 때 씁니다. 그 밖에는 저장해도 켜짐·꺼짐 상태와 남은 시간이 그대로입니다. 켜진 터널은 저장하면 지금 연결이 끊길 수 있습니다. | **4차 수정.** 리스너가 돌지 않던 터널("포트를 열 수 없음")을 저장하면 상태를 이어받지 않고 이 설정을 따른다(`TTTServer.ts:612, 636`). **3차 사실 수정.** 리스너가 돌던 꺼진 터널은 저장해도 꺼진 채로 남는다(1절). 연결은 이름·공유·IP 제한만 바꾼 경우엔 끊기지 않으므로 "끊길 수 있습니다". | MEDIUM | 제안 / 수정 / 수정 / 수정(4차) |
| `group.maxDurationHint` | 0은 무제한입니다. 이미 켜진 터널에도 적용됩니다. 값을 줄이면 바로 짧아지고, 늘리거나 0으로 바꾸면 소유자가 정한 시각까지 다시 켜 둡니다. | 0이면 제한하지 않습니다. 이미 켜진 터널에도 바로 적용됩니다. 줄이면 켜진 터널의 남은 시간이 바로 줄어듭니다. 늘리거나 0으로 바꾸면 켠 사람이 고른 켜 둘 시간으로 돌아갑니다. | **3차 사실 수정.** 되돌아가는 값은 소유자가 아니라 켠 사람의 요청값이다(1절). 꺼진 터널을 다시 켜는 것으로 읽히지 않게 대상("켜진 터널")을 적는다. | MEDIUM | 제안 / 수정 / 수정 |
| `timer.title` | 터널 사용 시간 제한 | 켜 둘 시간 | 결정(설계안 ①). | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelStatus.timeLimit` | 시간 제한 | 자동 꺼짐까지 | 결정. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelStatus.timeLimitFailed` | 시간 제한을 바꾸지 못했습니다. | 켜 둘 시간을 바꾸지 못했습니다. | 설계안. | MEDIUM | 제안 / 채택 / 확정 |
| `clock.noLimit` | 시간 제한 없음 | 자동으로 끄지 않음 | 설계안. | MEDIUM | 제안 / 채택 / 확정 |
| `group.maxDuration` | 최대 터널 사용 시간(시간) | 한 번에 켜 둘 수 있는 최대 시간(시간) | 설계안(책임자 승인). | MEDIUM | 제안 / 채택 / 확정 |
| `serverError.timeout_invalid` | 시간 제한은 0초에서 10년 사이여야 합니다. | 켜 둘 시간은 0초~10년 사이여야 합니다. | 같은 값을 같은 이름으로. | MEDIUM | 제안 / 채택 / 확정 |
| `auditEvent.tunnel_autoexpire` | 터널 시간 만료 | 터널 자동 꺼짐 | "터널 켜짐·꺼짐"과 같은 꼴. | MEDIUM | 제안 / 채택 / 확정 |
| `server.closeStall` | 닫기 정체 제한 시간(ms) | 남은 데이터 전송 대기 시간(ms) | "닫기 정체"는 뜻이 잡히지 않는다. | MEDIUM | 제안 / 채택 / 확정 |
| `server.closeStallHint` | 남은 출력이 진행 없이 머물 수 있는 시간입니다. 지나면 연결을 닫습니다. 1000~600000. 적용한 뒤 닫기 시작하는 연결부터 적용됩니다. | 닫는 중인 연결에서 남은 데이터가 이 시간 동안 하나도 나가지 않으면 연결을 끊습니다. 1,000~600,000ms. 적용한 뒤 닫히기 시작하는 연결부터 씁니다. | 원문 뜻(진행 없음)과 맞는다. | MEDIUM | 제안 / 채택 / 확정 |
| `server.closeGrace` | 닫기 유예 제한 시간(ms) | 상대가 닫을 때까지 기다리는 시간(ms) | 명사형 "닫기를"을 피한다. | MEDIUM | 제안 / 수정 / 확정 |
| `tunnelEdit.serverBufferInvalid` | 서버 버퍼는 1 MiB 이상의 유한한 수여야 합니다. | 서버 버퍼는 1 MiB 이상이어야 합니다. | "유한한 수"는 수학 용어. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelEdit.serverBufferNote` | 서버 버퍼: 1 MiB 이상의 유한한 값이며 소수도 쓸 수 있습니다. | 서버 버퍼: 1 MiB 이상이며 소수도 쓸 수 있습니다. | 설계안과 같다. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelEdit.rateLimitNote` | 측정 구간 안에 연결을 N개보다 많이 연 IP를 일시 차단합니다. 브라우저는 … | 측정 구간 안에 "IP당 최대 연결 횟수"보다 많이 연결한 IP를 일시 차단합니다. 브라우저는 페이지 하나에 연결을 여러 개 열므로 HTTP 터널은 넉넉하게 정하세요. | "N"이 정의되지 않았다. | MEDIUM | 제안 / 채택 / 확정 |
| `clients.confirmFailed` | 만료 기한을 확정하지 못했습니다. 15분짜리 새 코드로 바꿉니다. | 코드 유효 기간을 적용하지 못했습니다. 유효 기간이 15분인 새 코드로 바꿉니다. | 칸 이름("코드 유효 기간")과 맞춘다. | MEDIUM | 제안 / 수정 / 확정 |
| `tunnelEdit.allowedIp` | 허용 IP | IP 제한 | 목록·거절 사유와 같다. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelEdit.changeOwner` | 소유자 변경 | 소유자 바꾸기 | 버튼·창 제목 공용 키. 2.4.0 안내와 맞다. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelEdit.trustedClientIds` | 신뢰 클라이언트 ID | 허용 신뢰 클라이언트 | 칸에는 표시 이름이 보인다. | MEDIUM | 제안 / 채택 / 확정 |
| N7 터널 편집 일반 사용자 쪽 신뢰 클라이언트 칸 | `nav.trustedClients`(신뢰 클라이언트) | `tunnelEdit.trustedClientIds`(허용 신뢰 클라이언트)를 쓰도록 코드 수정 | 같은 칸을 역할에 따라 다른 이름으로 본다. | MEDIUM | — / 신규 / 확정 |
| `group.myAuditLog` | 내 감사 로그 | 내 활동 | 메뉴 이름과 같다. | MEDIUM | 제안 / 채택 / 확정 |
| `group.myProfile` | 내 프로필 | 내 계정 | 메뉴 이름과 같다. | MEDIUM | 제안 / 채택 / 확정 |
| `security.reasonConcurrency` | 연결 한도 | 동시 연결 한도 | 연결 횟수 제한과 구분. | MEDIUM | 제안 / 채택 / 확정 |
| `auditEvent.conn_limit_hit` | 연결 한도 도달 | 동시 연결 한도 도달 | 위와 같다. | MEDIUM | 제안 / 채택 / 확정 |
| `auditEvent.mfa_enrolled` / `mfa_disabled` | 2단계 인증 등록 / 2단계 인증 해제 | 2단계 인증 켜짐 / 2단계 인증 꺼짐 | 내 계정 카드의 켜짐·꺼짐·끄기와 맞춘다. | MEDIUM | 제안 / 채택 / 확정 |
| `clients.rotated` | {clientId} 클라이언트의 비밀값을 새로 만들었습니다. 연결이 끊겼으니 다시 등록하세요. | {clientId} 클라이언트의 비밀값을 재발급했습니다. 연결이 끊겼으니 다시 등록하세요. | 감사 사건과 같은 동사. | MEDIUM | 제안 / 채택 / 확정 |
| `clients.rotateConfirm` | {clientId} 클라이언트의 비밀값을 새로 만들까요? 다시 등록할 때까지 연결이 끊깁니다. | {clientId} 클라이언트의 비밀값을 재발급할까요? 다시 등록할 때까지 연결이 끊깁니다. | 위와 같다. | MEDIUM | 제안 / 채택 / 확정 |
| `clients.newSecret` | 새 비밀값 | 비밀값 재발급 | 줄 버튼·창 제목·확인 버튼 공용 키라 동작 이름이 맞다. | MEDIUM | 제안 / 채택 / 확정 |
| `clients.neverWarning` | 이 코드는 쓰이거나, 새 코드를 발급하거나, … 제어 포트 설정이 바뀌거나, 서버를 다시 시작할 때까지 유효합니다. 비밀번호처럼 다루세요. | 비밀번호처럼 다루세요. 새 코드를 발급하거나, 비밀값을 재발급하거나, 클라이언트를 삭제하거나, 터널 서버 설정(포트·TLS·인증 키 등)을 바꾸거나, 서버를 다시 시작하면 더는 쓸 수 없습니다. | **3차 수정.** 바로 위에 "만료 없음"과 "코드는 한 번만 쓸 수 있습니다"가 이미 보이므로 2차안의 "기한이 없습니다"와 "코드를 쓰거나"를 뺀다. "제어 포트"는 화면에 없는 말이고 무효화 조건은 포트만이 아니다(`controlOptionsChanged`). | MEDIUM | 제안 / 수정 / 수정 |
| `tunnelEdit.httpOptions` | HTTP 옵션 | HTTP 헤더·본문 바꾸기 | 결정된 용어. | MEDIUM | 제안("HTTP 내용 바꾸기") / 수정 / 확정 |
| `group.httpRewrite` | HTTP 다시 쓰기 | HTTP 헤더·본문 바꾸기 | 결정된 용어. 하위 권한(CORS·호스트·헤더·본문)이 모두 헤더나 본문이다. | MEDIUM | 제안 / 수정 / 확정 |
| `group.rewritePermissions` | HTTP 다시 쓰기 권한 | HTTP 헤더·본문 바꾸기 권한 | 위와 같다. | MEDIUM | 제안 / 수정 / 확정 |
| `serverError.rewrite_not_allowed` | HTTP 다시 쓰기 옵션은 그룹에 허용되지 않습니다. | HTTP 헤더·본문 바꾸기는 그룹에 허용되지 않습니다. | 위와 같다. | MEDIUM | 제안 / 수정 / 확정 |
| `cert.key` | 키 | 개인 키 | 같은 칸의 오류 문구와 같다. | MEDIUM | 제안 / 채택 / 확정 |
| `cert.noUploadNote` | 인증서를 올리지 않으면 임의로 만든 키를 씁니다. | 인증서를 올리지 않으면 자동으로 만든 인증서를 씁니다. | `tunnelEdit.generatedCert` 와 같다. | MEDIUM | 제안 / 채택 / 확정 |
| `server.adminPort` | 관리 서비스 포트 번호 | 관리 화면 포트 | `server.tunnelPort` 와 짝을 맞춘다. | MEDIUM | 제안 / 채택 / 확정 |
| `nav.status` | 상태 | 서버 상태 (+ 터널 편집 상태 카드는 새 키로 "상태" 유지) | **3차 수정.** 같은 키가 터널 편집 화면의 상태 카드 제목(`TunnelStatusArea.svelte:61`)에도 쓰인다. 코드에서 그 카드를 새 키(예: `tunnelStatus.title` = "상태")로 바꾼 뒤에만 이 문구를 바꾼다. | MEDIUM | 제안 / 채택 / 수정 |
| 서버 설정 보안 카드(새 키, 예: `server.securityCard`) | 보안(`nav.security` 재사용) | 로그인과 기록 | 2단계 인증 요구와 감사·거절 로그 보관, 대기열이 함께 있다. | MEDIUM | 제안("로그인·감사 기록") / 수정 / 확정 |
| `group.visibility` | 공개 범위 | 메뉴와 공개 범위 | 카드 안에 메뉴 선택과 터널 공개 범위가 함께 있다. | MEDIUM | 제안 / 채택 / 확정 |
| `group.zeroUnlimited` | 0은 무제한 | 0이면 제한하지 않습니다. | 안내 문장 꼴을 맞춘다. | MEDIUM | 제안 / 채택 / 확정 |
| `group.maxTunnelsHint` | 0이면 터널을 만들 수 없음 | 0이면 터널을 만들 수 없습니다. | 위와 같다. | MEDIUM | 제안 / 채택 / 확정 |
| `group.enterNumberUnlimited` | 숫자를 입력하세요. 0은 무제한입니다. | 숫자를 입력하세요. 0이면 제한하지 않습니다. | 위와 같다. | MEDIUM | 제안 / 채택 / 확정 |
| `server.adminTls` | 관리 TLS | 관리 화면에 TLS(HTTPS) 사용 | 무엇을 켜는지 말한다. | MEDIUM | 제안 / 채택 / 확정 |
| `server.tunnelTls` | 터널 TLS | 터널 서버 포트에 TLS 사용 | 등록 코드 안내가 이 이름을 인용한다. `tlsNotice`·`TLS_REQUIRED` 와 한 번에 바꾼다. | MEDIUM | 제안 / 채택 / 확정 |
| `tunnelStatus.blocked` (N1) | 차단 {count} | 거절 {count} | 값은 거절한 **연결** 수다(1절). "차단 3"은 주소 셋을 차단한 것으로 읽힌다. en.ts "Blocked"도 함께 고치기를 권한다. | MEDIUM | — / 신규 / 확정 |
| `server.restarted` (N2) | 서버 설정을 바꾸고 서버를 다시 시작했습니다. | 서버 설정을 적용했습니다. 관리 화면 포트나 TLS를 바꿨다면 TTTGate 서버를 다시 시작해야 반영됩니다. | **3차 수정.** 이 창은 관리 화면 설정을 바꾸지 않았을 때도 뜨므로 조건문으로 쓴다. 2차 근거 중 "옛 포트로 돌아간다"는 틀렸다(1절). 화면 이동 문제는 7절 코드 항목. | MEDIUM | — / 신규 / 수정 |

### 2.3 LOW (63)

| key | 현재 | 최종 권장 | 이유 | 심각도 | 판정 이력 |
|---|---|---|---|---|---|
| `serverError.passkey_counter_stale` | 패스키의 사용 횟수가 늘지 않았습니다. | 패스키를 확인하지 못했습니다. 다시 시도하세요. | 주된 원인은 동시 로그인. **3차: 심각도 MEDIUM→LOW.** 로그인 경로는 이 코드를 화면에 넘기지 않는다(1절). | LOW | 제안 / 수정 / 수정(심각도) |
| `me.passkeyAddedSetUpApp` | 패스키를 추가했습니다. IP 주소로 로그인하려면 인증 앱도 설정하세요. | 패스키를 추가했습니다. IP 주소로 접속하면 패스키를 쓸 수 없으니 인증 앱도 설정하세요. | 이유를 붙인다. **3차: 심각도 MEDIUM→LOW.** 지금 문구도 뜻은 통한다. | LOW | 제안 / 수정 / 수정(심각도) |
| `server.closeGraceHint` | FIN 뒤에 상대가 연결을 닫기를 기다리는 시간입니다. 1000~120000. 적용한 뒤 FIN을 보내거나 받는 연결부터 적용됩니다. | 한쪽이 닫기 신호(FIN)를 보낸 뒤 상대가 닫을 때까지 기다리는 시간입니다. 1,000~120,000ms. 적용한 뒤 FIN을 주고받는 연결부터 씁니다. | 칸 이름과 맞춘다. | LOW | 제안 / 채택 / 확정 |
| `tunnelEdit.spillNote` | 한도가 0보다 크면 넘친 데이터를 파일 캐시에 씁니다. | 버퍼가 차면 디스크로 넘깁니다. | **3차 수정.** 2.4.0 설계안 버퍼 카드의 문구와 같게 한다(뜻은 2차안과 같고 짧다). | LOW | 제안 / 채택 / 수정 |
| `serverError.listener_stop_failed` | 외부 포트 {forwardPort}의 리스너를 멈추지 못했습니다. | {forwardPort} 포트를 닫지 못했습니다. | "을(를)"과 "리스너"를 피한다. | LOW | 제안 / 수정 / 확정 |
| `serverError.previous_tunnel_not_found` | 원래 설정한 터널이 없습니다. | 고치려던 터널이 없습니다. 목록을 다시 불러오세요. | 원인과 할 일. | LOW | 제안 / 채택 / 확정 |
| `tunnelEdit.idsOverrideNames` | 신뢰 클라이언트 ID를 정했으므로 위의 클라이언트 이름은 쓰지 않습니다. | 신뢰 클라이언트를 골랐으므로 위의 허용 클라이언트 이름은 무시합니다. | 이름 칸이 바로 위에 있다. | LOW | 제안 / 채택 / 확정 |
| `tunnelEdit.allowedClientNames` | 허용 클라이언트 이름(이름은 세미콜론(;)으로 구분) | 허용 클라이언트 이름(세미콜론으로 구분) | **3차 수정.** 2차안 "세미콜론 ; 으로"는 기호 뒤 조사가 떨어지고 띄어쓰기가 어색하다. 괄호 겹침 없이 줄인다. | LOW | 제안 / 채택 / 수정 |
| `tunnelEdit.destinationCertHint` | 켜면 클라이언트가 자체 서명 인증서를 포함해 … | 고르면 클라이언트가 자체 서명 인증서를 포함해 대상 서버의 어떤 인증서든 받아들입니다. 믿을 수 있는 네트워크에서만 쓰세요. | 체크박스다. | LOW | 제안 / 채택 / 확정 |
| `tunnelEdit.injectRequestHeader` / `injectResponseHeader` | 요청 헤더 넣기 / 응답 헤더 넣기 | (유지) | 줄마다 "기존 헤더 바꾸기"가 있어 "추가"는 좁다. | LOW | 제안("추가") / 거절 / 보류 |
| `tunnels.stale` | 갱신하지 못함 · 다시 시도 중 | 상태를 새로 고치지 못함 · 다시 시도 중 | 무엇을 못 했는지. | LOW | 제안 / 채택 / 확정 |
| `tunnel.notRunning` | 실행 중이 아님 | (유지) | 상태 항목 자체가 없을 때. `cannotOpenPort` 와 구분된다. | LOW | 제안 / 거절 / 보류 |
| `cert.incorrectNote` | 올바르지 않은 인증서를 올리면 HTTP로 동작합니다. | (유지) | 관리 화면 TLS 에서만 보인다. | LOW | 제안 / 거절 / 보류 |
| `clients.runOnHost` | 클라이언트 호스트에서 이 명령을 실행하세요. 코드는 한 번만 쓸 수 있습니다. | 클라이언트가 돌아갈 컴퓨터에서 이 명령을 실행하세요. 코드는 한 번만 쓸 수 있습니다. | **4차 수정.** "둘 컴퓨터"의 "둘"은 숫자 2로도 읽힌다. **3차 수정.** 2차안 "실행할 컴퓨터에서 … 실행하세요"는 동사가 겹친다. | LOW | 제안 / 수정 / 수정 / 수정(4차) |
| `group.mySessions` | 내 세션 | 세션 | 메뉴 이름과 같다. | LOW | 제안 / 채택 / 확정 |
| `serverError.admin_port_conflict` | 입력 오류: 관리 서버 포트와 터널 서버 포트는 같을 수 없습니다. | 관리 화면 포트와 터널 서버 포트는 같을 수 없습니다. | 칸 이름과 맞춘다. | LOW | 제안 / 채택 / 확정 |
| `server.keepAlive` | Keep-Alive(ms) | Keep-Alive 간격(ms) | 같은 `setKeepAlive` 값. | LOW | 제안 / 채택 / 확정 |
| `server.keepAliveHint` | 0 이하면 keep-alive를 끕니다. | 0 이하면 Keep-Alive를 끕니다. | 표기 통일. | LOW | 제안 / 채택 / 확정 |
| `clock.endsToday` / `endsOtherDay` / `labelEndingSoon` | {time} 종료 / {month}월 {day}일 {time} 종료 / 곧 종료, {left}, {ends} | {time}에 꺼짐 / {month}월 {day}일 {time}에 꺼짐 / 곧 꺼짐, {left}, {ends} | 설계안 "…에 꺼집니다"와 같다. | LOW | 제안 / 채택 / 확정 |
| `ipLimit.andMore` | 그 밖에 {count}개 | (유지) | **3차 보류.** 이 값은 보조 기술용 이름에서 쉼표 뒤에 따로 읽힌다(1절). "외 2개"는 앞 명사 없이 의존 명사로 시작해 어색하다. | LOW | 제안("외 {count}개") / 채택 / 보류 |
| `auditEvent.tunnel_ip_refreshed` | 허용 IP 반영 | 허용 IP 갱신 | 버튼 이름과 잇는다. | LOW | 제안 / 채택 / 확정 |
| `tunnels.ipRefreshFailed` | {title} 터널에 내 IP를 반영하지 못했습니다. | {title} 터널의 허용 IP를 내 IP로 바꾸지 못했습니다. | 위와 같다. | LOW | 제안 / 채택 / 확정 |
| `clients.add` | 클라이언트 추가 | 신뢰 클라이언트 추가 | 화면 이름과 맞춘다. | LOW | 제안 / 채택 / 확정 |
| `clients.created` | {clientId} 클라이언트를 만들었습니다. | {clientId} 클라이언트를 추가했습니다. | 버튼과 같은 동사. | LOW | 제안 / 채택 / 확정 |
| `share.sharedUsers` | 공유한 사용자 | 공유 대상 | 보이는 칸 이름과 같다. | LOW | 제안 / 채택 / 확정 |
| `group.adminSections` | 관리 화면 메뉴 | 보이는 메뉴 | 뜻이 바로 드러난다. | LOW | 제안 / 채택 / 확정 |
| `status.info` | 정보 | 시스템 정보 | 열리는 창 제목과 같다. | LOW | 제안 / 채택 / 확정 |
| `status.clientList` | 클라이언트 목록 | 연결된 클라이언트 | 빈 상태 문구와 같다. | LOW | 제안 / 채택 / 확정 |
| `tunnelEdit.externalPort` | 외부 서버 포트 | 외부 포트 | 오류 문구·설계안과 같다. | LOW | 제안 / 채택 / 확정 |
| `tunnelEdit.startup` / `inactiveOnStartup` | 시작할 때 / 시작할 때 꺼 두기 | 시작 상태 / 꺼진 채로 시작 | 반복 제거. | LOW | 제안 / 채택 / 확정 |
| `tunnelEdit.allowedIpHint` | 이 터널을 켰거나 자기 IP를 반영한 사람의 IP에서 온 연결만 받습니다. 터널 앞에 CDN이나 리버스 프록시가 있으면 끄세요. | 이 터널을 켠 사람과 "내 IP로 바꾸기"를 누른 사람의 IP에서 온 연결만 받습니다. 터널 앞에 CDN이나 리버스 프록시가 있으면 끄세요. | 동작을 버튼 이름으로 가리킨다. | LOW | 제안 / 채택 / 확정 |
| `security.promoteFull` | 차단 목록이 가득 찼습니다. 이 주소가 이미 한 터널에서 차단된 경우에만 영구 차단할 수 있습니다. | 차단 목록이 가득 찼습니다. 이 주소가 이미 목록에 특정 포트로 올라 있을 때만 영구 차단할 수 있습니다. 아니면 다른 주소의 차단을 먼저 푸세요. | **3차 수정.** 2차안 "한 포트에 대해 차단 목록에 있을 때"는 번역투다. 조건(`IpBlocklist.ts:79`)과 할 일은 그대로. | LOW | 제안 / 수정 / 수정 |
| `password.minHint` | 8자 이상 | 8자 이상 입력하세요. | 오류 문구와 같다. | LOW | 제안 / 채택 / 확정 |
| `user.usernameHint` | 3~32자, 영문 소문자, 숫자, . _ - | 3~32자. 영문 소문자, 숫자, 마침표(.), 밑줄(_), 하이픈(-) | 기호 이름을 붙인다. | LOW | 제안 / 수정 / 확정 |
| `user.usernameInvalid` / `login.usernameInvalid` | 사용자 이름은 3~32자의 영문 소문자, 숫자, . _ - 로 입력하세요. | 사용자 이름은 영문 소문자·숫자·마침표(.)·밑줄(_)·하이픈(-)으로 3~32자 입력하세요. | 기호 뒤 조사가 붙는다. | LOW | 제안 / 채택 / 확정 |
| `server.millisecondsRequired` | 시간을 밀리초로 입력하세요({min}~{max}). | (문구 유지, 코드에서 자릿점 붙인 값을 넘김) | `ServerSettingsScreen.svelte:169-170` 이 숫자를 그대로 넘긴다. | LOW | 제안 / 수정 / 확정 |
| `groups.members` | 구성원: {count} | 구성원 {count}명 | 단위. | LOW | 제안 / 채택 / 확정 |
| `group.summaryTunnels` | 터널≤{max} | 터널 최대 {max}개 | 기호 제거. | LOW | 제안 / 채택 / 확정 |
| `me.setUp` | 설정 | 설정하기 | 버튼 이름. | LOW | 제안 / 채택 / 확정 |
| `tunnelEdit.optional` | 선택 | 선택 입력 | "고르세요"로 오해되지 않는다. | LOW | 제안 / 채택 / 확정 |
| `user.removePasskeys` | 패스키 삭제 | 패스키 모두 삭제 | 한 개 삭제와 구분. | LOW | 제안 / 채택 / 확정 |
| `user.statusActive` / `statusDisabled`, `users.statusActive` / `statusDisabled` | 활성 / 비활성 | 사용 중 / 사용 중지 | 쉬운 말. | LOW | 제안 / 채택 / 확정 |
| `serverError.last_superuser` (N4) | 활성 슈퍼유저가 적어도 한 명은 있어야 합니다. | 사용 중인 슈퍼유저가 적어도 한 명은 있어야 합니다. | 계정 상태 이름과 짝. | LOW | — / 신규 / 확정 |
| `sysinfo.release` | 릴리스 | OS 버전 | `os.release()`. "OS 정보" 묶음 아래다. | LOW | 제안("커널 버전") / 수정 / 확정 |
| `sysinfo.clock` | 클럭 | 클럭 속도(MHz) | 값이 단위 없이 나온다. | LOW | 제안 / 수정 / 확정 |
| `server.auditQueueSize` | 감사 큐 크기 | 감사 기록 대기열 크기 | 쉬운 말. | LOW | 제안 / 채택 / 확정 |
| `server.queueRequired` (N5) | 큐 크기를 입력하세요. | 대기열 크기를 입력하세요. | 칸 이름과 짝. | LOW | — / 신규 / 확정 |
| `serverError.tunnel_remove_failed` (N3) | 외부 포트 {forwardPort}의 서버는 이미 삭제되었습니다. | {forwardPort} 포트 터널은 이미 삭제되었습니다. | "외부 서버" 제거. | LOW | — / 신규 / 확정 |
| `server.tunnelPort` (N6) | 터널 서버 포트 번호 | 터널 서버 포트 | "관리 화면 포트"와 짝. | LOW | — / 신규 / 확정 |
| `status.uptime` (N8) | 가동 시간 | 연결된 지 | 클라이언트가 붙은 뒤 지난 시간(`handlerPool.createTime`). | LOW | — / 신규 / 확정 |
| `header.replace` (N9) | 헤더 바꾸기 | 기존 헤더 바꾸기 | 같은 이름 헤더를 바꿀지 고르는 체크박스다. | LOW | — / 신규 / 확정 |
| `serverError.login_blocked` / `login_concurrency_limit` (N10) | 로그인 시도가 너무 많습니다. | 로그인 시도가 너무 많습니다. 잠시 뒤에 다시 시도하세요. | `login.tooManyAttempts` 와 같다. | LOW | — / 신규 / 확정 |
| `serverError.mfa_enrollment_expired` (N11) | 설정 시간이 지났습니다. 다시 시작하세요. | 설정 시간이 지났습니다. 처음부터 다시 설정하세요. | 서버 재시작으로 읽히지 않게. | LOW | — / 신규 / 확정 |
| `groups.superuserUnlimited` (N12) | 슈퍼유저는 속성 제한을 받지 않습니다. | 슈퍼유저는 그룹 제한을 받지 않습니다. | "속성"은 내부 용어. | LOW | — / 신규 / 확정 |
| `audit.noMatchesYet` (N13) | 지금까지 훑은 범위에는 일치하는 기록이 없습니다. 더 오래된 기록을 찾으려면 더 불러오세요. | 지금까지 불러온 기록에는 일치하는 것이 없습니다. 더 오래된 기록을 찾으려면 더 불러오세요. | 버튼 이름과 잇는다. | LOW | — / 신규 / 확정 |
| `auditEvent.admin_cert_updated` (N14) | 관리 인증서 변경 | 관리 화면 인증서 변경 | "관리 화면" 통일. | LOW | — / 신규 / 확정 |
| `tunnelEdit.ownerGroupUnknown` (N15) | 소유자의 그룹을 읽지 못해 이 ID들이 그룹에 허용되는지 확인하지 않았습니다. | 소유자의 그룹을 읽지 못해, 고른 클라이언트가 그 그룹에 허용되는지 확인하지 못했습니다. | 번역투·뜻 오해 제거. | LOW | — / 신규 / 확정 |
| `server.statusUnknown` / `statusUnknownTls` (N16) | 오류: 서버 상태를 확인하지 못했습니다. … | 서버 상태를 확인하지 못했습니다. … | 알림 창 제목이 이미 있다. | LOW | — / 신규 / 확정 |
| `serverError.buffer_limit_exceeded` (N17) | 서버 버퍼가 서버의 메모리 캐시 한도보다 큽니다. | 서버 버퍼가 서버 설정의 메모리 캐시 한도보다 큽니다. | 어디서 보는지 알린다. | LOW | — / 신규 / 확정 |
| `tunnels.changeFailed` (3차 신규) | {title} 터널을 바꾸지 못했습니다. | {title} 터널을 켜거나 끄지 못했습니다. | 목록 스위치 실패에만 쓰인다(`TunnelsScreen.svelte:122, 141`). "바꾸지"는 설정 저장 실패로 읽힌다. `serverError.tunnel_state_change_failed` 와 같은 말. | LOW | — / — / 신규 |
| `me.newRecoveryCodes` (3차 신규) | 새 복구 코드 | 복구 코드 재발급 | 버튼과 창 제목에 함께 쓰인다(`MeScreen.svelte:357, 517`). 감사 사건 "복구 코드 재발급"·"비밀값 재발급"과 같은 말. 360px 2단계 인증 카드의 버튼 셋(앱 교체·이것·끄기)이 한 줄에 들어간다(약 300px). | LOW | — / — / 신규 |
| `user.resetPasswordConfirm` (3차 신규) | @{username} 사용자에게 새 임시 비밀번호를 발급할까요? 지금 로그인한 세션은 모두 로그아웃됩니다. | @{username} 사용자에게 새 임시 비밀번호를 발급할까요? 이 사용자의 세션은 모두 끝납니다. | "세션이 로그아웃된다"는 주어가 어긋난다. 같은 화면의 `resetMfaConfirm`·`removePasskeysConfirm` 과 같은 문장. | LOW | — / — / 신규 |
| `auditEvent.group_attributes_changed` (3차 신규) | 그룹 속성 변경 | 그룹 설정 변경 | **4차 수정.** attributes 에는 권한·한도 말고도 보이는 메뉴·공개 범위·2단계 인증 요구가 있어 "권한·한도"는 좁다(`routes.ts:398`, `Types.ts:122-136`). 이름만 바꾸면 `group_updated`("그룹 수정")로 따로 남는다. | LOW | — / — / 신규 / 수정(4차) |

> 개수는 행 기준이다. 한 행에 키가 여럿이면(예: `clock.*` 셋) 한 건으로 센다. "보류" 4건(`injectRequestHeader`/`injectResponseHeader`, `tunnel.notRunning`, `cert.incorrectNote`, `ipLimit.andMore`)은 바꾸지 않는 결정이지만 이력을 남기려고 목록에 둔다.

---

## 3. 최종 용어 표

| 개념 | 지금 표현 | 최종 표준어 | 영향 키 |
|---|---|---|---|
| 터널의 IP당 연결 횟수 제한 | 속도 제한, 속도 제한 사용, 속도 제한 초과, IP당 최대 연결 수 | **연결 횟수 제한** / 사유 "연결 횟수 초과" / 칸 "IP당 최대 연결 횟수" | `tunnelEdit.rateLimit`, `rateLimitEnabled`, `maxPerIp`, `rateLimitNote`, `security.reasonExceeded`, `fromBanNote`, `promoteConfirm`, 머리 주석 |
| 그룹 대역폭 제한 | 대역폭 | 대역폭(유지) | `group.bandwidth` |
| 터널로 들어온 TCP 연결 | 연결, 세션, 활성 세션, 세션당 | **연결** | `tunnelStatus.stats`, `status.activeSession`, `tunnelEdit.bufferLimit` |
| 관리 화면 로그인 | 세션, 활성 세션 | **세션**(로그인에만) | `sessions.*`, `user.sessions`, `user.activeSessions`, `nav.sessions`, `group.mySessions`, `user.resetPasswordConfirm` |
| 동시 연결 상한 | 최대 동시 연결 수, 연결 한도 | 칸 "최대 동시 연결 수" / 사유·사건 "동시 연결 한도" | `group.maxConcurrent`, `security.reasonConcurrency`, `auditEvent.conn_limit_hit` |
| 거절한 연결 | 차단 {count}, 거절 | **거절** | `tunnelStatus.blocked`, `security.denialsByPort`, `recentDenials` |
| 주소 차단 | 차단, 일시 차단, 영구 차단 | 주소를 막는 동작만 **차단**(차단 목록·일시 차단·영구 차단) | `security.*` |
| 켜 둘 시간 | 터널 사용 시간 제한, 시간 제한, 시간 제한 없음, 최대 터널 사용 시간, 터널 시간 만료 | **켜 둘 시간** / 남은 시간 "자동 꺼짐까지" / 없음 "자동으로 끄지 않음" / 그룹 "한 번에 켜 둘 수 있는 최대 시간" / 사건 "터널 자동 꺼짐" | `timer.title`, `tunnelStatus.timeLimit`, `timeLimitFailed`, `clock.noLimit`, `group.maxDuration`, `maxDurationHint`, `serverError.timeout_invalid`, `auditEvent.tunnel_autoexpire`, `tunnelEdit.startupHint` |
| 자동으로 꺼지는 시각 | 종료, 곧 종료 | **꺼짐** | `clock.endsToday`, `endsOtherDay`, `labelEndingSoon`, 머리 주석 |
| 켜 둘 시간을 정한 사람 | 소유자가 정한 | **켠 사람이 고른** | `group.maxDurationHint`(en.ts 포함) |
| 터널이 켜진 뒤 지난 시간 | 가동 시간 | 2.4.0 부터 "켜진 지"(새 필드) / 지금은 "가동 시간" 유지 | `tunnelStatus.stats` |
| 클라이언트가 붙은 뒤 지난 시간 | 가동 시간 | **연결된 지** | `status.uptime` |
| 상태 화면·카드 | 상태 | 메뉴 **서버 상태** / 터널 편집 카드 "상태"(새 키) | `nav.status`, 새 키 `tunnelStatus.title` |
| 켠 사람의 IP만 받기 | 허용 IP, IP 제한 | 칸·목록·사유 **IP 제한** / 체크박스 "켠 사람의 IP에서만 받기" | `tunnelEdit.allowedIp`, `ipLimit.*`, `security.reasonActivatorIp` |
| 내 IP 갱신 | 반영, 허용 IP 반영 | 버튼 **내 IP로 바꾸기** / 사건 "허용 IP 갱신" | `auditEvent.tunnel_ip_refreshed`, `tunnels.ipRefreshFailed`, `tunnelEdit.allowedIpHint` |
| HTTP rewrite | HTTP 다시 쓰기, HTTP 옵션 | **HTTP 헤더·본문 바꾸기** (API 필드 이름 `HTTP_REWRITE` 는 유지) | `group.httpRewrite`, `group.rewritePermissions`, `tunnelEdit.httpOptions`, `serverError.rewrite_not_allowed`, 머리 주석 |
| 서버–클라이언트 사이 포트 | 터널 서버 포트 번호, 터널 TLS, 제어 포트 | **터널 서버 포트** / TLS 칸 "터널 서버 포트에 TLS 사용" | `server.tunnelPort`, `server.tunnelTls`, `clients.tlsNotice`, `serverError.TLS_REQUIRED`, `clients.neverWarning`, `serverError.admin_port_conflict` |
| 관리 화면 포트·TLS | 관리 서비스 포트 번호, 관리 서버 포트, 관리 TLS, 관리 인증서 | **관리 화면**("관리 화면 포트", "관리 화면에 TLS(HTTPS) 사용", "관리 화면 인증서") / 네트워크 오류의 "관리 서버"는 유지 | `server.adminPort`, `server.adminTls`, `serverError.admin_port_conflict`, `auditEvent.admin_cert_updated`, `server.restarted` |
| 외부 포트/대상 TLS | 서버·클라이언트 사이 보안 터널 | **TLS 사용(외부 포트와 대상 서버)** | `tunnelEdit.secureTunneling`(en.ts 포함) |
| 터널이 연 공개 포트 | 외부 서버 포트, 외부 서버 | **외부 포트** | `tunnelEdit.externalPort`, `removed`, `removeConfirm`, `serverError.tunnel_remove_failed`, `listener_stop_failed` |
| 다시 발급(비밀값·복구 코드) | 새로 만들기, 새 비밀값, 새 복구 코드 | **재발급** | `clients.rotated`, `rotateConfirm`, `newSecret`, `neverWarning`, `me.newRecoveryCodes` |
| 2단계 인증 켜고 끄기 | 등록·해제 | **켜기·끄기**(사건 "켜짐·꺼짐") | `auditEvent.mfa_enrolled`, `mfa_disabled` |
| 터널 저장 | 적용하고 다시 시작, 적용, 시작 | 새 터널 **터널 만들기** / 저장된 터널 **저장하고 다시 시작** / 결과 "터널을 저장했습니다." | `tunnelEdit.start`, `applyAndRestart`, `applied`, `tunnel.applyFailed`, `startupHint` |
| 터널 켜기·끄기 실패 | 바꾸지 못했습니다 | **켜거나 끄지 못했습니다** | `tunnels.changeFailed`, `serverError.tunnel_state_change_failed` |
| 터널 삭제 | 멈추고 삭제 | **터널 삭제** | `tunnelEdit.stopAndRemove`, `removeFailed` |
| 소유자 바꾸기 | 소유자 변경 | 버튼·창 제목 **소유자 바꾸기** / 확인 버튼 "넘기기" / 사건 "터널 소유자 변경"(명사형 유지) | `tunnelEdit.changeOwner` |
| 터널에 허용할 신뢰 클라이언트 | 신뢰 클라이언트 ID, 신뢰 클라이언트 | **허용 신뢰 클라이언트** | `tunnelEdit.trustedClientIds`, 일반 사용자 칸 코드(N7), `group.allowedTrustedClients`, `tunnelEdit.ownerGroupUnknown` |
| 그룹이 보일 메뉴 | 내 감사 로그, 내 프로필, 내 세션 | 메뉴 이름 그대로 **내 활동·내 계정·세션** | `group.myAuditLog`, `myProfile`, `mySessions` |
| 그룹 속성(attributes) | 속성, 속성 제한 | 화면에는 **그룹 제한**(슈퍼유저 안내)·**그룹 설정**(감사 사건) (API 필드 오류 문구는 유지) | `groups.superuserUnlimited`, `auditEvent.group_attributes_changed` |
| 계정 상태 | 활성 / 비활성 | **사용 중 / 사용 중지** | `user.statusActive`, `statusDisabled`, `users.*`, `serverError.last_superuser` |
| 0의 뜻(안내 문장) | 0은 무제한, 0이면 … | 안내 "0이면 제한하지 않습니다." / 선택지 값 "무제한" | `group.zeroUnlimited`, `maxTunnelsHint`, `enterNumberUnlimited`, `maxDurationHint`, `tunnelEdit.clientBufferNote` |
| 인증서 | 키, 임의로 만든 키 | **개인 키**, **자동으로 만든 인증서** | `cert.key`, `cert.noUploadNote` |
| 버퍼 넘침 | 파일 캐시 | **디스크** | `tunnelEdit.spillNote` |
| Keep-Alive | Keep-Alive(ms), Keep-Alive 제한 시간(ms), keep-alive | **Keep-Alive 간격(ms)** | `server.keepAlive`, `keepAliveHint`, `tunnelEdit.keepAlive` |
| 감사 기록 대기열 | 감사 큐, 큐 | **대기열** | `server.auditQueueSize`, `server.queueRequired` |
| 로그와 기록 | 감사 로그, 감사 기록 | 기능·메뉴·보관 기간은 **감사 로그·거절 로그** / 한 건 한 건은 **기록** | `nav.auditLog`, `server.auditRetention`, `server.denialRetention`, `audit.*`, `server.auditQueueSize` |
| HTTP 헤더 줄 | 넣기, 헤더 바꾸기 | 칸 "요청·응답 헤더 넣기"(유지) / 줄 체크박스 "기존 헤더 바꾸기" | `tunnelEdit.injectRequestHeader`, `injectResponseHeader`, `header.replace` |

`ko.ts` 머리 주석 용어 목록에서 함께 고칠 줄: `rate limit  연결 횟수 제한`, `ends (시각)  꺼짐`, `HTTP rewrite  HTTP 헤더·본문 바꾸기`, `connection  연결 (터널 트래픽에만, 로그인은 세션)`, `apply  적용 (서버 설정)·저장 (터널)`.

---

## 4. ko.ts 밖에서 바꿔야 하는 것

### 4.1 코드 변경이 있어야 문구가 맞는 것

| 항목 | 할 일 | 관련 키 |
|---|---|---|
| 터널 편집 상태 카드 | `TunnelStatusArea.svelte:61` 의 `t('nav.status')` 를 새 키(예: `tunnelStatus.title`, ko "상태" / en "Status")로 바꾼다. 그 뒤에 `nav.status` 를 "서버 상태"로 바꾼다. | `nav.status` |
| 서버 설정 보안 카드 | `ServerSettingsScreen.svelte:274` 의 `t('nav.security')` 를 새 키(예: `server.securityCard`)로 바꾼다. | 새 키 |
| 일반 사용자 신뢰 클라이언트 칸(N7) | `TunnelEditScreen.svelte:514` 의 `t('nav.trustedClients')` 를 `t('tunnelEdit.trustedClientIds')` 로 바꾼다. | `tunnelEdit.trustedClientIds` |
| 밀리초 범위 오류 | `ServerSettingsScreen.svelte:169-170` 에서 `{min}`·`{max}` 를 자릿점 붙인 문자열(`tr.number`)로 넘긴다. | `server.millisecondsRequired` |
| 켜진 지 | `tunnelStatus.stats` 의 "켜진 지 {since}"는 2.4.0 의 `activatedAt` 필드와 함께 넣는다. 그 전에는 "세션"→"연결"만 바꾼다. | `tunnelStatus.stats` |

### 4.2 문구와 별개로 발견한 코드 문제(보고만 함)

| 항목 | 내용 | 영향 |
|---|---|---|
| 관리 화면 포트·TLS 변경 뒤 화면 이동 | 저장 확인 창의 확인을 누르면 `adminBaseUrl(location, serverOption, previousAdminPort)` 가 **새** 포트·TLS 주소로 옮긴다. 관리 리스너는 프로세스를 다시 시작해야 바뀌므로 그 주소는 열리지 않는다. 옛 주소에 머물거나, 다시 시작이 필요하다고 알린 뒤 옮겨야 한다. | 사용자가 빈 화면(연결 실패)을 본다. `server.restarted` 문구만으로는 막지 못한다. |
| 연결 횟수 제한 칸의 오류 | `TunnelEditScreen.svelte:589, 593, 597` 이 `'1..3600'`·`'1..100000'`·`'1..1440'` 을 번역 없이 오류로 보인다. 예: "1~3,600 사이로 입력하세요." 같은 키가 필요하다. | 한국어 화면에 영어식 범위 표기가 그대로 보인다. |
| 신뢰 클라이언트 칸의 표시 이름 | 슈퍼유저 쪽 칸은 표시 이름을 보이고(`:532`), 일반 사용자 쪽 칸은 클라이언트 ID 를 보인다(`:518`). | 같은 칸이 역할에 따라 다르게 보인다(N7 과 함께 정리 권장). |

### 4.3 en.ts 도 함께 고칠 것

| key | 지금 en | 권장 en | 이유 |
|---|---|---|---|
| `tunnelEdit.secureTunneling` | Secure tunneling Server/Client | Use TLS (external port and destination) | 뜻이 틀렸다(HIGH). |
| `group.maxDurationHint` | …until the time their owners asked for. | …until the time the person who turned them on chose. | 소유자가 아니라 켠 사람이다. |
| `tunnelStatus.blocked` | Blocked {count} | Rejected {count} | 거절한 연결 수다. |
| `server.restarted` | Server settings have been changed. The server has been restarted. | Server settings applied. If you changed the admin port or TLS, restart TTTGate to apply them. | 관리 화면 변경은 프로세스를 다시 시작해야 한다. |
| `clients.neverWarning` | …the control port settings change… | …the tunnel server settings (port, TLS, key, etc.) change… | 화면에 "control port"가 없다. |
| `auditEvent.group_attributes_changed` | Group attributes changed | Group settings changed | 4차 추가(선택). ko 와 같은 범위. |

---

## 5. 3차에서 바뀐 것

### 5.1 2차 최종안을 고친 항목(12)

| key | 2차 최종안 | 3차 최종안 | 이유 |
|---|---|---|---|
| `tunnelEdit.startupHint` | …꺼진 터널을 저장할 때 씁니다. 켜진 터널은 저장하면 지금 연결이 끊기지만, 켜진 상태와 남은 시간은 그대로입니다. | 서버가 시작할 때와 터널을 만들 때 씁니다. 저장해도 켜짐·꺼짐 상태와 남은 시간은 그대로입니다. 켜진 터널은 저장하면 지금 연결이 끊길 수 있습니다. | 사실 오류(꺼진 터널도 상태를 이어받음), 이름·공유·IP 제한만 바꾸면 끊기지 않음 |
| `group.maxDurationHint` | …소유자가 정한 켜 둘 시간만큼 다시 늘어납니다. | …켠 사람이 고른 켜 둘 시간으로 돌아갑니다. | 사실 오류(`requestedTimeout` 은 켠 사람의 값) |
| `nav.status` | 서버 상태 | 서버 상태 + 터널 편집 카드용 새 키 | 같은 키가 터널 편집 카드 제목에도 쓰인다 |
| `server.restarted` | 서버 설정을 적용했습니다. 관리 화면 포트와 TLS 변경은 서버 프로그램을 다시 시작해야 반영됩니다. | 서버 설정을 적용했습니다. 관리 화면 포트나 TLS를 바꿨다면 TTTGate 서버를 다시 시작해야 반영됩니다. | 관리 화면을 안 바꿔도 뜨는 창이라 조건문으로. 2차 근거("옛 포트로 돌아간다")는 틀림 |
| `clients.neverWarning` | 이 코드는 기한이 없습니다. 비밀번호처럼 다루세요. 코드를 쓰거나, … | 비밀번호처럼 다루세요. 새 코드를 발급하거나, … 더는 쓸 수 없습니다. | 바로 위 "만료 없음"·"한 번만 쓸 수 있습니다"와 겹침 제거 |
| `clients.runOnHost` | 클라이언트를 실행할 컴퓨터에서 이 명령을 실행하세요. … | 클라이언트를 둘 컴퓨터에서 이 명령을 실행하세요. … | "실행"이 겹침 |
| `security.promoteFull` | …이미 한 포트에 대해 차단 목록에 있을 때만… | …이미 목록에 특정 포트로 올라 있을 때만… | 번역투 |
| `tunnelEdit.allowedClientNames` | 허용 클라이언트 이름(세미콜론 ; 으로 구분) | 허용 클라이언트 이름(세미콜론으로 구분) | 기호 뒤 조사·띄어쓰기 |
| `tunnelEdit.spillNote` | 버퍼가 차면 넘친 데이터를 디스크에 임시로 씁니다. | 버퍼가 차면 디스크로 넘깁니다. | 2.4.0 설계안 문구와 통일 |
| `ipLimit.andMore` | 외 {count}개 | (지금 "그 밖에 {count}개" 유지) | 쉼표 뒤 단독 조각이라 의존 명사로 시작할 수 없음 |
| `serverError.passkey_counter_stale` | (문구 그대로) MEDIUM | (문구 그대로) LOW | 화면에 닿지 않는 코드 |
| `me.passkeyAddedSetUpApp` | (문구 그대로) MEDIUM | (문구 그대로) LOW | 지금 문구도 뜻이 통함 |

### 5.2 3차에서 새로 찾은 항목(4, 모두 LOW)

`tunnels.changeFailed`, `me.newRecoveryCodes`, `user.resetPasswordConfirm`, `auditEvent.group_attributes_changed` — 2.3 표 참고. 이와 별개로 코드 문제 3건(4.2)과 en.ts 동반 수정 5건(4.3)을 정리했다.

### 5.3 남은 HIGH·MEDIUM

3차 수정을 반영하면 **열린 HIGH·MEDIUM 은 없다.** 모든 HIGH(11)·MEDIUM(58)은 최종 문구가 정해졌다. 다만 다음 둘은 문구만으로 끝나지 않으므로 구현 때 함께 처리해야 한다.

- `nav.status`(MEDIUM): 터널 편집 카드용 새 키를 먼저 만들지 않으면 터널 편집 화면에 "서버 상태"가 잘못 보인다.
- 관리 화면 포트·TLS 변경 뒤 화면 이동(4.2): 문구 밖의 동작 문제다. `server.restarted` 를 고쳐도 사용자는 열리지 않는 주소로 옮겨진다.

---

## 6. 4차(독립 검증) 결과

3차가 고치거나 더한 16건만 `origin/develop` 8400fd5 소스로 다시 확인했다. 13건 확인, 3건 수정.

| key | 4차 판정 | 근거 |
|---|---|---|
| `tunnelEdit.startupHint` | **수정** | 3차 사실(꺼진 터널도 상태를 이어받음, 이름·공유·IP 제한만 바꾸면 리스너를 다시 시작하지 않음, IP 제한을 켜면 허용되지 않은 연결만 끊음)은 맞다. 다만 리스너가 돌지 않던 터널은 저장할 때 이 설정을 따른다(`TTTServer.ts:612` `inherits = inheritedStatus.online`, `:636` `activateNewListener`). 그 예외를 다시 넣었다. |
| `group.maxDurationHint` | 확인 | `reapplyActiveCap` 이 `requestedTimeout` 과 원래 시작 시각으로 다시 건다(`ExternalPortServerPool.ts:743-746`). 켜 둘 시간을 바꾼 사람도 새 켠 사람이 된다(`TTTServer.ts:767-769`). 상한은 소유자·켠 사람 그룹 중 짧은 쪽(`TunnelLifetimePolicy.ts`). |
| `nav.status` | 확인 | 메뉴(`nav.ts:13`), 화면 제목 기본값(`nav.ts:60`), 상태 화면 알림(`StatusScreen.svelte:132`), 터널 편집 상태 카드(`TunnelStatusArea.svelte:61`). 마지막만 새 키가 필요하다. |
| `server.restarted` | 확인 | 설정 해시가 바뀌면 늘 뜬다(`ServerSettingsScreen.svelte:208-214`). 관리 포트·바인드 주소·TLS 만 프로세스 재시작이 필요하다(`TTTServer.ts:523-526`). 관리 화면 인증서는 `setSecureContext` 로 바로 바뀐다. |
| `clients.neverWarning` | 확인 | 무효화 조건은 `controlOptionsChanged`(port·tls·key·keepAlive·controlProtocolMode·allowLegacyControlAuth, `TTTServer.ts:314-318`)와 `beginControlRebuild`. |
| `clients.runOnHost` | **수정** | "둘 컴퓨터"의 "둘"이 숫자로 읽힌다. → "클라이언트가 돌아갈 컴퓨터에서 …". |
| `security.promoteFull` | 확인 | `IpBlocklist.ts:79-85`: 가득 찼어도 이미 특정 포트로 올라 있는 주소만 넓힐 수 있다. |
| `tunnelEdit.allowedClientNames` · `spillNote` · `ipLimit.andMore` | 확인 | `spillNote` 는 설계안 버퍼 카드 문구와 같다. `andMore` 는 `ipLimit.ts:46` 에서 쉼표로 잇는 조각이다. |
| `serverError.passkey_counter_stale` · `me.passkeyAddedSetUpApp` | 확인 | `passkeyRoutes.ts:278` 은 `reject('verification')` 으로 바꿔 보낸다. LOW 가 맞다. |
| `tunnels.changeFailed` | 확인 | `TunnelsScreen.svelte:122, 141` 은 켜기·끄기(`request`)에서만 쓰인다. |
| `me.newRecoveryCodes` | 확인 | 버튼(`MeScreen.svelte:357`)과 창 제목(`:517`). |
| `user.resetPasswordConfirm` | 확인 | 임시 비밀번호를 발급하면 `SessionStore.removeSessionsOfUser` 로 그 사용자의 세션을 모두 끊는다(`rbacRoutes.ts:224-225`). |
| `auditEvent.group_attributes_changed` | **수정** | attributes 범위가 "권한·한도"보다 넓다. → "그룹 설정 변경". |

코드 문제 3건(4.2)은 모두 사실로 확인했다. 관리 화면 이동 문제는 `checkChangeServerOption` 이 새 주소를 먼저 묻고 실패하면 옛 주소로 해시를 확인해 성공으로 처리한 뒤, 확인 창이 새 주소로 옮기는 흐름이다(`ServerOptionCtrl.ts`, `ServerSettingsScreen.svelte:213`). 연결 횟수 제한 칸 오류는 `TunnelEditScreen.svelte:589, 593, 597`, 신뢰 클라이언트 칸 차이는 `:514, :518`(ID) / `:529, :532`(표시 이름)다.

최종 개수: HIGH 11 · MEDIUM 58 · LOW 63(행 기준, 유지 5건 포함). 4차 수정으로 심각도가 바뀐 항목은 없다.
