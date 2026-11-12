import fs from "fs";
import path from "path";
import {en} from "../../../admin/src/i18n/en";
import {ko} from "../../../admin/src/i18n/ko";

// 이슈 370 — 관리 화면 한국어 문구 정비. 기준은 docs/design/2026-11-13-korean-wording-final.md(최종 목록)다.
// 이 파일은 test/unit 에 있어 CI 의 fast 작업(npm run test:unit)이 매번 돌린다.
//
// 대조 방식(AC-2): 기대값을 아래 EXPECTED 에 키별로 고정하고, 최종 목록의 표를 읽어 두 가지를 확인한다.
//   1. 표에 나온 모든 키가 EXPECTED · KEPT · OWNED_BY_OTHER_ISSUES · SPECIAL 가운데 한 곳에 있다(빠뜨린 항목이 없다).
//   2. 표의 "최종 권장" 칸이 EXPECTED 값과 같다(고정한 값이 목록과 어긋나지 않는다).
// 표만 읽어 기대값을 만들지 않는 까닭: 한 줄에 키가 여럿이거나("a / b"), 말줄임표로 줄였거나, 코드 변경을 설명하는 줄이 있어
// 기계적으로 읽으면 규칙이 흐려진다. 기대값은 사람이 읽을 수 있게 고정하고, 표는 그 값이 목록과 같은지만 확인한다.

const root = path.resolve(__dirname, "../../..");
const FINAL_LIST = path.join(root, "docs/design/2026-11-13-korean-wording-final.md");

/** 최종 목록의 "최종 권장" 을 그대로 옮긴 값. 키 하나에 값 하나다. */
const EXPECTED: Readonly<Record<string, string>> = {
    // 2.1 HIGH
    "tunnelEdit.rateLimit": "연결 횟수 제한",
    "tunnelEdit.rateLimitEnabled": "연결 횟수 제한 사용",
    "security.reasonExceeded": "연결 횟수 초과",
    "security.fromBanNote": "{port} 포트 일시 차단(연결 횟수 초과)에서 옮김",
    "security.promoteConfirm": "{ip} 주소를 모든 터널에서 차단할까요? 차단을 풀 때까지는 서버를 다시 시작해도 이 주소의 연결을 거절합니다. 연결 횟수 제한에 따른 일시 차단은 풀립니다.",
    "tunnelEdit.maxPerIp": "IP당 최대 연결 횟수",
    "tunnelEdit.secureTunneling": "TLS 사용(외부 포트와 대상 서버)",
    "clients.tlsNotice": "등록 코드를 쓰려면 서버 설정에서 \"터널 서버 포트에 TLS 사용\"을 켜세요. 그 전까지는 클라이언트를 직접 설정하세요.",
    "serverError.TLS_REQUIRED": "등록 코드를 쓰려면 서버 설정에서 \"터널 서버 포트에 TLS 사용\"을 켜세요.",
    "status.activeSession": "연결 수",
    // 2.2 MEDIUM
    "tunnelEdit.clientBufferNote": "클라이언트 버퍼: 0 이하면 제한하지 않습니다.",
    "tunnelEdit.readOnlyNote": "이 터널은 볼 수만 있습니다.",
    "tunnelEdit.keepAlive": "Keep-Alive 간격(ms)",
    "tunnelEdit.start": "터널 만들기",
    "tunnelEdit.applyAndRestart": "저장하고 다시 시작",
    "tunnelEdit.applied": "터널을 저장했습니다.",
    "tunnel.applyFailed": "터널을 저장하지 못했습니다: {reason}",
    "tunnelEdit.stopAndRemove": "터널 삭제",
    "tunnelEdit.removed": "터널을 삭제하고 외부 포트를 닫았습니다.",
    "tunnelEdit.removeConfirm": "{port} 터널을 삭제할까요? 외부 포트를 닫고 지금 연결을 모두 끊습니다. 되돌릴 수 없습니다.",
    "tunnelEdit.removeFailed": "터널을 삭제하지 못했습니다: {reason}",
    "tunnelEdit.startupHint": "서버가 시작할 때, 터널을 만들 때, 포트를 열지 못한 터널을 저장할 때 씁니다. 그 밖에는 저장해도 켜짐·꺼짐 상태와 남은 시간이 그대로입니다. 켜진 터널은 저장하면 지금 연결이 끊길 수 있습니다.",
    "server.closeStall": "남은 데이터 전송 대기 시간(ms)",
    "server.closeStallHint": "닫는 중인 연결에서 남은 데이터가 이 시간 동안 하나도 나가지 않으면 연결을 끊습니다. 1,000~600,000ms. 적용한 뒤 닫히기 시작하는 연결부터 씁니다.",
    "server.closeGrace": "상대가 닫을 때까지 기다리는 시간(ms)",
    "tunnelEdit.serverBufferInvalid": "서버 버퍼는 1 MiB 이상이어야 합니다.",
    "tunnelEdit.serverBufferNote": "서버 버퍼: 1 MiB 이상이며 소수도 쓸 수 있습니다.",
    "tunnelEdit.rateLimitNote": "측정 구간 안에 \"IP당 최대 연결 횟수\"보다 많이 연결한 IP를 일시 차단합니다. 브라우저는 페이지 하나에 연결을 여러 개 열므로 HTTP 터널은 넉넉하게 정하세요.",
    "clients.confirmFailed": "코드 유효 기간을 적용하지 못했습니다. 유효 기간이 15분인 새 코드로 바꿉니다.",
    "tunnelEdit.allowedIp": "IP 제한",
    "tunnelEdit.changeOwner": "소유자 바꾸기",
    "tunnelEdit.trustedClientIds": "허용 신뢰 클라이언트",
    "group.myAuditLog": "내 활동",
    "group.myProfile": "내 계정",
    "security.reasonConcurrency": "동시 연결 한도",
    "auditEvent.conn_limit_hit": "동시 연결 한도 도달",
    "auditEvent.mfa_enrolled": "2단계 인증 켜짐",
    "auditEvent.mfa_disabled": "2단계 인증 꺼짐",
    "clients.rotated": "{clientId} 클라이언트의 비밀값을 재발급했습니다. 연결이 끊겼으니 다시 등록하세요.",
    "clients.rotateConfirm": "{clientId} 클라이언트의 비밀값을 재발급할까요? 다시 등록할 때까지 연결이 끊깁니다.",
    "clients.newSecret": "비밀값 재발급",
    "clients.neverWarning": "비밀번호처럼 다루세요. 새 코드를 발급하거나, 비밀값을 재발급하거나, 클라이언트를 삭제하거나, 터널 서버 설정(포트·TLS·인증 키 등)을 바꾸거나, 서버를 다시 시작하면 더는 쓸 수 없습니다.",
    "tunnelEdit.httpOptions": "HTTP 헤더·본문 바꾸기",
    "group.httpRewrite": "HTTP 헤더·본문 바꾸기",
    "group.rewritePermissions": "HTTP 헤더·본문 바꾸기 권한",
    "serverError.rewrite_not_allowed": "HTTP 헤더·본문 바꾸기는 그룹에 허용되지 않습니다.",
    "cert.key": "개인 키",
    "cert.noUploadNote": "인증서를 올리지 않으면 자동으로 만든 인증서를 씁니다.",
    "server.adminPort": "관리 화면 포트",
    "server.securityCard": "로그인과 기록",
    "group.visibility": "메뉴와 공개 범위",
    "group.zeroUnlimited": "0이면 제한하지 않습니다.",
    "group.maxTunnelsHint": "0이면 터널을 만들 수 없습니다.",
    "group.enterNumberUnlimited": "숫자를 입력하세요. 0이면 제한하지 않습니다.",
    "server.adminTls": "관리 화면에 TLS(HTTPS) 사용",
    "server.tunnelTls": "터널 서버 포트에 TLS 사용",
    "tunnelStatus.blocked": "거절 {count}",
    // 최종 목록 값과 다르다. 아래 CHANGED_AFTER_LIST 를 보라.
    "server.restarted": "서버 설정을 적용했습니다.",
    // 2.3 LOW
    "serverError.passkey_counter_stale": "패스키를 확인하지 못했습니다. 다시 시도하세요.",
    "me.passkeyAddedSetUpApp": "패스키를 추가했습니다. IP 주소로 접속하면 패스키를 쓸 수 없으니 인증 앱도 설정하세요.",
    "server.closeGraceHint": "한쪽이 닫기 신호(FIN)를 보낸 뒤 상대가 닫을 때까지 기다리는 시간입니다. 1,000~120,000ms. 적용한 뒤 FIN을 주고받는 연결부터 씁니다.",
    "tunnelEdit.spillNote": "버퍼가 차면 디스크로 넘깁니다.",
    "serverError.listener_stop_failed": "{forwardPort} 포트를 닫지 못했습니다.",
    "serverError.previous_tunnel_not_found": "고치려던 터널이 없습니다. 목록을 다시 불러오세요.",
    "tunnelEdit.idsOverrideNames": "신뢰 클라이언트를 골랐으므로 위의 허용 클라이언트 이름은 무시합니다.",
    "tunnelEdit.allowedClientNames": "허용 클라이언트 이름(세미콜론으로 구분)",
    "tunnelEdit.destinationCertHint": "고르면 클라이언트가 자체 서명 인증서를 포함해 대상 서버의 어떤 인증서든 받아들입니다. 믿을 수 있는 네트워크에서만 쓰세요.",
    "tunnels.stale": "상태를 새로 고치지 못함 · 다시 시도 중",
    "clients.runOnHost": "클라이언트가 돌아갈 컴퓨터에서 이 명령을 실행하세요. 코드는 한 번만 쓸 수 있습니다.",
    "group.mySessions": "세션",
    "serverError.admin_port_conflict": "관리 화면 포트와 터널 서버 포트는 같을 수 없습니다.",
    "server.keepAlive": "Keep-Alive 간격(ms)",
    "server.keepAliveHint": "0 이하면 Keep-Alive를 끕니다.",
    "clock.labelEndingSoon": "곧 꺼짐, {left}, {ends}",
    "auditEvent.tunnel_ip_refreshed": "허용 IP 갱신",
    "tunnels.ipRefreshFailed": "{title} 터널의 허용 IP를 내 IP로 바꾸지 못했습니다.",
    "clients.add": "신뢰 클라이언트 추가",
    "clients.created": "{clientId} 클라이언트를 추가했습니다.",
    "share.sharedUsers": "공유 대상",
    "group.adminSections": "보이는 메뉴",
    "status.info": "시스템 정보",
    "status.clientList": "연결된 클라이언트",
    "tunnelEdit.externalPort": "외부 포트",
    "tunnelEdit.startup": "시작 상태",
    "tunnelEdit.inactiveOnStartup": "꺼진 채로 시작",
    "tunnelEdit.allowedIpHint": "이 터널을 켠 사람과 \"내 IP로 바꾸기\"를 누른 사람의 IP에서 온 연결만 받습니다. 터널 앞에 CDN이나 리버스 프록시가 있으면 끄세요.",
    "security.promoteFull": "차단 목록이 가득 찼습니다. 이 주소가 이미 목록에 특정 포트로 올라 있을 때만 영구 차단할 수 있습니다. 아니면 다른 주소의 차단을 먼저 푸세요.",
    "password.minHint": "8자 이상 입력하세요.",
    "user.usernameHint": "3~32자. 영문 소문자, 숫자, 마침표(.), 밑줄(_), 하이픈(-)",
    "user.usernameInvalid": "사용자 이름은 영문 소문자·숫자·마침표(.)·밑줄(_)·하이픈(-)으로 3~32자 입력하세요.",
    "login.usernameInvalid": "사용자 이름은 영문 소문자·숫자·마침표(.)·밑줄(_)·하이픈(-)으로 3~32자 입력하세요.",
    "groups.members": "구성원 {count}명",
    "group.summaryTunnels": "터널 최대 {max}개",
    "me.setUp": "설정하기",
    "tunnelEdit.optional": "선택 입력",
    "user.removePasskeys": "패스키 모두 삭제",
    "user.statusActive": "사용 중",
    "user.statusDisabled": "사용 중지",
    "users.statusActive": "사용 중",
    "users.statusDisabled": "사용 중지",
    "serverError.last_superuser": "사용 중인 슈퍼유저가 적어도 한 명은 있어야 합니다.",
    "sysinfo.release": "OS 버전",
    "sysinfo.clock": "클럭 속도(MHz)",
    "server.auditQueueSize": "감사 기록 대기열 크기",
    "server.queueRequired": "대기열 크기를 입력하세요.",
    "serverError.tunnel_remove_failed": "{forwardPort} 포트 터널은 이미 삭제되었습니다.",
    "server.tunnelPort": "터널 서버 포트",
    "status.uptime": "연결된 지",
    "header.replace": "기존 헤더 바꾸기",
    "serverError.login_blocked": "로그인 시도가 너무 많습니다. 잠시 뒤에 다시 시도하세요.",
    "serverError.login_concurrency_limit": "로그인 시도가 너무 많습니다. 잠시 뒤에 다시 시도하세요.",
    "serverError.mfa_enrollment_expired": "설정 시간이 지났습니다. 처음부터 다시 설정하세요.",
    "groups.superuserUnlimited": "슈퍼유저는 그룹 제한을 받지 않습니다.",
    "audit.noMatchesYet": "지금까지 불러온 기록에는 일치하는 것이 없습니다. 더 오래된 기록을 찾으려면 더 불러오세요.",
    "auditEvent.admin_cert_updated": "관리 화면 인증서 변경",
    "tunnelEdit.ownerGroupUnknown": "소유자의 그룹을 읽지 못해, 고른 클라이언트가 그 그룹에 허용되는지 확인하지 못했습니다.",
    "server.statusUnknown": "서버 상태를 확인하지 못했습니다.",
    "server.statusUnknownTls": "서버 상태를 확인하지 못했습니다. TLS 인증서 오류일 수 있습니다.",
    "serverError.buffer_limit_exceeded": "서버 버퍼가 서버 설정의 메모리 캐시 한도보다 큽니다.",
    "tunnels.changeFailed": "{title} 터널을 켜거나 끄지 못했습니다.",
    "me.newRecoveryCodes": "복구 코드 재발급",
    "user.resetPasswordConfirm": "@{username} 사용자에게 새 임시 비밀번호를 발급할까요? 이 사용자의 세션은 모두 끝납니다.",
    "auditEvent.group_attributes_changed": "그룹 설정 변경",
};

/**
 * 최종 목록 뒤 PR 373 리뷰에서 바꾼 키. listed 는 목록의 "최종 권장" 이고, 지금 값은 EXPECTED 에 있다.
 * 요구 문서(최종 목록)는 고치지 않고, 목록 대조는 listed 로 한다.
 */
const CHANGED_AFTER_LIST: Readonly<Record<string, {listed: string; reason: string}>> = {
    "server.restarted": {
        listed: "서버 설정을 적용했습니다. 관리 화면 포트나 TLS를 바꿨다면 TTTGate 서버를 다시 시작해야 반영됩니다.",
        reason: "리뷰 L-2: C-1 수정 뒤 이 창은 관리 화면 포트·TLS 를 바꾸지 않았을 때만 뜬다. 바꿨을 때는 server.restartToOpen · server.restartRequired 가 뜨므로 조건문이 틀렸다.",
    },
};

/** "유지"(보류) 판정. 지금 문구를 그대로 둔다. */
const KEPT: Readonly<Record<string, string>> = {
    "tunnelEdit.injectRequestHeader": "요청 헤더 넣기",
    "tunnelEdit.injectResponseHeader": "응답 헤더 넣기",
    "tunnel.notRunning": "실행 중이 아님",
    "cert.incorrectNote": "올바르지 않은 인증서를 올리면 HTTP로 동작합니다.",
    "ipLimit.andMore": "그 밖에 {count}개",
    // 문구는 그대로 두고, 코드가 자릿점을 붙인 값을 넘긴다(ServerSettingsScreen).
    "server.millisecondsRequired": "시간을 밀리초로 입력하세요({min}~{max}).",
};

/** 이슈 370 §3 제외: 다른 이슈가 같은 표준어로 반영한다. 이 이슈는 값을 확인하지 않는다. */
const OWNED_BY_OTHER_ISSUES: ReadonlySet<string> = new Set([
    "tunnelStatus.stats", "tunnelEdit.bufferLimit", "group.maxDurationHint", "timer.title", "tunnelStatus.timeLimit",
    "tunnelStatus.timeLimitFailed", "clock.noLimit", "group.maxDuration", "serverError.timeout_invalid", "auditEvent.tunnel_autoexpire",
    // 이슈 368 이 clock.ends·clock.dateTime 으로 나눴다. "{time}에 꺼짐" 은 tunnelRow.test.ts 가 확인한다.
    "clock.endsToday", "clock.endsOtherDay",
]);

/** 최종 권장 칸이 코드 변경을 함께 설명하는 줄. 값은 아래 따로 확인한다. */
const SPECIAL: ReadonlySet<string> = new Set(["nav.status"]);

type Row = {keys: string[]; final: string};

/** 최종 목록 2절(2.1~2.3)의 표 줄. `a.b` / `c` 처럼 줄인 키는 앞 키의 이름공간을 붙인다. */
const finalListRows = (): Row[] => {
    const markdown = fs.readFileSync(FINAL_LIST, "utf8");
    const section = markdown.slice(markdown.indexOf("## 2. 최종 통합 목록"), markdown.indexOf("## 3. 최종 용어 표"));
    return section.split("\n")
        .filter((line) => line.startsWith("| ") && !line.startsWith("| key") && !line.startsWith("|---"))
        .map((line) => {
            const cells = line.slice(2, -2).split(" | ");
            let namespace = "";
            const keys = [...cells[0].matchAll(/`([^`]+)`/g)].map(([, key]) => {
                if(key.includes(".")) namespace = key.split(".")[0];
                return key.includes(".") ? key : `${namespace}.${key}`;
            });
            return {keys, final: cells[2]};
        });
};

describe("AC-2 최종 목록과 ko.ts", () => {
    const rows = finalListRows();

    test("최종 목록 2절은 132줄이다", () => {
        expect(rows).toHaveLength(132);
    });

    test("목록에 나온 키는 모두 분류되어 있다", () => {
        const classified = (key: string) => key in EXPECTED || key in KEPT || OWNED_BY_OTHER_ISSUES.has(key) || SPECIAL.has(key);
        expect(rows.flatMap((row) => row.keys).filter((key) => !classified(key))).toEqual([]);
    });

    test("고정한 기대값은 목록의 최종 권장과 같다", () => {
        const mismatched = rows
            .filter((row) => row.keys.length > 0 && row.keys.every((key) => key in EXPECTED))
            .filter((row) => {
                const values = row.keys.map((key) => CHANGED_AFTER_LIST[key]?.listed ?? EXPECTED[key]);
                // 말줄임표로 줄인 칸은 앞부분만 같으면 된다(server.statusUnknown / statusUnknownTls 의 "오류: " 빼기).
                if(row.final.endsWith(" …")) return !values.every((value) => value.startsWith(row.final.slice(0, -2)));
                return [...new Set(values)].join(" / ") !== row.final;
            })
            .map((row) => `${row.keys.join(", ")}: ${row.final}`);
        expect(mismatched).toEqual([]);
    });

    test("목록의 키 가운데 기대값이 있는 것은 모두 목록에 나온다", () => {
        const listed = new Set(rows.flatMap((row) => row.keys));
        expect(Object.keys(EXPECTED).filter((key) => !listed.has(key))).toEqual([]);
    });

    test("ko.ts 값이 최종 권장과 같다", () => {
        const korean: Record<string, string> = ko;
        expect(Object.keys(EXPECTED).filter((key) => korean[key] !== EXPECTED[key]).map((key) => `${key}: ${korean[key]}`)).toEqual([]);
    });

    test("유지 판정 키는 지금 문구 그대로다", () => {
        const korean: Record<string, string> = ko;
        expect(Object.keys(KEPT).filter((key) => korean[key] !== KEPT[key])).toEqual([]);
    });
});

describe("AC-3 메뉴는 '서버 상태', 터널 편집 상태 카드는 새 키의 '상태'", () => {
    test("nav.status 는 서버 상태다", () => {
        expect(ko["nav.status"]).toBe("서버 상태");
    });

    test("tunnelStatus.title 은 ko '상태', en 'Status' 다", () => {
        const korean: Record<string, string> = ko;
        const english: Record<string, string> = en;
        expect([korean["tunnelStatus.title"], english["tunnelStatus.title"]]).toEqual(["상태", "Status"]);
    });

    test("터널 편집 상태 카드는 nav.status 가 아니라 tunnelStatus.title 을 쓴다", () => {
        const source = fs.readFileSync(path.join(root, "admin/src/screens/parts/TunnelStatusArea.svelte"), "utf8");
        expect(source).not.toContain("t('nav.status')");
        expect(source).toContain("t('tunnelStatus.title')");
    });
});

describe("FR-2 새 키를 쓰는 코드", () => {
    test("서버 설정의 보안 카드는 nav.security 대신 server.securityCard 를 쓰고, 영어는 지금처럼 Security 다", () => {
        const source = fs.readFileSync(path.join(root, "admin/src/screens/ServerSettingsScreen.svelte"), "utf8");
        expect(source).not.toContain("t('nav.security')");
        expect(source).toContain("t('server.securityCard')");
        const english: Record<string, string> = en;
        expect(english["server.securityCard"]).toBe(en["nav.security"]);
    });

    test("N7·C-3 일반 사용자 쪽 신뢰 클라이언트 칸도 tunnelEdit.trustedClientIds 를 쓴다", () => {
        const source = fs.readFileSync(path.join(root, "admin/src/screens/TunnelEditScreen.svelte"), "utf8");
        expect(source).not.toContain("t('nav.trustedClients')");
        expect(source.match(/label=\{t\('tunnelEdit\.trustedClientIds'\)\}/g)).toHaveLength(2);
    });

    test("C-2 연결 횟수 제한 칸 오류에 번역하지 않은 범위 표기가 남지 않는다", () => {
        const source = fs.readFileSync(path.join(root, "admin/src/screens/TunnelEditScreen.svelte"), "utf8");
        expect(source).not.toMatch(/'1\.\.\d+'/);
    });
});

describe("FR-2 최종 목록 4.3 의 en.ts 수정", () => {
    test.each([
        ["tunnelEdit.secureTunneling", "Use TLS (external port and destination)"],
        ["tunnelStatus.blocked", "Rejected {count}"],
        // 최종 목록 4.3 과 다르다. CHANGED_AFTER_LIST 의 리뷰 L-2 를 보라.
        ["server.restarted", "Server settings applied."],
        ["clients.neverWarning", "This code stays valid until it is used, a new code is issued, the client gets a new secret, the client is deleted, the tunnel server settings (port, TLS, key, etc.) change, or the server restarts. Treat it like a password."],
        ["auditEvent.group_attributes_changed", "Group settings changed"],
    ] as Array<[keyof typeof en, string]>)("%s", (key, value) => {
        expect(en[key]).toBe(value);
    });
});

describe("AC-1·FR-3·FR-4 '속도 제한' 대신 '연결 횟수 제한'", () => {
    const koSource = fs.readFileSync(path.join(root, "admin/src/i18n/ko.ts"), "utf8");
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

    test("ko.ts 와 README 에 '속도 제한' 이 없다", () => {
        expect(koSource).not.toContain("속도 제한");
        expect(readme).not.toContain("속도 제한");
    });

    test("README 한국어 절은 '터널별 연결 횟수 제한' 이라고 부른다", () => {
        expect(readme).toContain("터널별 연결 횟수 제한");
        expect(readme).not.toContain("레이트 리미트");
    });

    test("README 한국어 메모리 표는 HTTP 본문을 '다시 쓰기' 가 아니라 '바꾸기' 라고 부른다(리뷰 L-4)", () => {
        expect(readme).toContain("| HTTP 본문 바꾸기(`rewriteHostInTextBody`) |");
        expect(readme).not.toContain("본문 다시 쓰기");
    });

    test("README 는 바뀐 화면 이름을 쓴다", () => {
        expect(readme).not.toContain("Secure tunneling Server/Client");
        expect(readme).toContain("**Use TLS (external port and destination)**");
        expect(readme).not.toContain("the control port settings change");
        expect(readme).not.toContain("제어 포트 설정이 바뀌거나");
    });

    test.each([
        ["rate limit", "연결 횟수 제한"],
        ["ends (시각)", "꺼짐"],
        ["HTTP rewrite", "HTTP 헤더·본문 바꾸기"],
        ["connection", "연결 (터널 트래픽에만, 로그인은 세션)"],
        ["apply", "적용 (서버 설정)·저장 (터널)"],
    ])("머리 용어 목록: %s → %s", (term, korean) => {
        const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        expect(koSource).toMatch(new RegExp(`^//\\s+${escape(term)}\\s+${escape(korean)}$`, "m"));
    });
});
